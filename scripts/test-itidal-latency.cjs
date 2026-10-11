// Local-only deterministic replay of the actual camera component, session hook,
// prayer engine and stage card. Native capture/Core ML execution is not simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');

const cameraSource = fs.readFileSync('components/PrayerCamera.tsx', 'utf8');
const swiftCamera = fs.readFileSync('modules/local-classification/ios/LocalClassificationView.swift', 'utf8');
const swiftClassifier = fs.readFileSync('modules/local-classification/ios/PoseClassifier.swift', 'utf8');
const intervalMs = Number(swiftCamera.match(/now - lastInference >= ([\d.]+)/)[1]) * 1000;
const stabilityMs = Number(cameraSource.match(/const POSE_STABILITY_MS = ([\d_]+)/)[1].replaceAll('_', ''));
// Pin the pre-fix version so later local commits cannot silently change the baseline.
const baselineRevision = '2211693f639b37baaa635ec1cdb37203b940c55b';
const baselineCameraSource = execFileSync('git', ['show', `${baselineRevision}:components/PrayerCamera.tsx`], { encoding: 'utf8' });
const beforeOnly = process.argv.includes('--before-only');
const classes = [...swiftClassifier.match(/static let poses = \[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(classes, ['BOWING', 'PROSTRATING', 'SITTING', 'STANDING']);
assert.match(swiftClassifier, /scores\[candidate\] > scores\[index\]/);

function reactHarness() {
  let cursor = 0, dirty = true;
  const slots = [], effects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useState(initial) {
      const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (v) => {
        const next = typeof v === 'function' ? v(slots[i].value) : v;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      }];
    },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    },
  };
  return {
    react,
    render(fn) {
      for (let pass = 0; pass < 30; pass++) {
        cursor = 0; dirty = false;
        const result = fn();
        effects.splice(0).forEach((effect) => effect());
        if (!dirty) return result;
      }
      throw new Error('Render loop');
    },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); },
  };
}

function find(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((item) => find(item, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...find(tree.props?.children, predicate)];
}

async function pipeline(prayer, cadence = intervalMs, { baseline = false, platform = 'ios' } = {}) {
  let now = 1_000_000, frame = -1, nextTimer = 0, appStateListener;
  const timers = new Map(), cache = new Map(), delivered = [], trace = [];
  const sessionReact = reactHarness(), cameraReact = reactHarness(), cardReact = reactHarness();
  const jsx = (type, props) => ({ type, props });
  let session, cameraTree, cardTree;
  const native = {
    Platform: { OS: platform }, AppState: { currentState: 'active', addEventListener(_name, fn) { appStateListener = fn; return { remove() {} }; } },
    StyleSheet: { create: (value) => value, absoluteFill: {} },
    ActivityIndicator: 'ActivityIndicator', View: 'View', Text: 'Text', Pressable: 'Pressable',
  };
  const mocks = {
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'react-native': native,
    'expo-camera': { CameraView: 'ExpoCamera', useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })] },
    'expo-image-manipulator': {}, 'expo-linear-gradient': { LinearGradient: 'Gradient' },
  };
  function load(file, harness) {
    const key = `${file}:${harness === cameraReact ? 'camera' : harness === cardReact ? 'card' : 'session'}`;
    if (cache.has(key)) return cache.get(key);
    const exports = {};
    cache.set(key, exports);
    const source = baseline && file === 'components/PrayerCamera.tsx' ? baselineCameraSource : fs.readFileSync(file, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, {
      exports, __DEV__: false, console, Date: { now: () => now },
      setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, due: now + ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
      require(name) {
        if (name === 'react') return harness.react;
        if (mocks[name]) return mocks[name];
        if (name.endsWith('/theme')) return { colors: {}, lightColors: {} };
        if (name.endsWith('/predictionApi')) return { predictImage() { throw new Error('iOS network path'); } };
        if (name === './LocalClassificationCamera') return { LocalClassificationCamera: 'NativeFrontCamera' };
        if (name === './FontAwesomeIcon') return { FontAwesomeIcon: 'Icon' };
        if (name === './PrayerPoseIcon') return { PrayerPoseIcon: 'PoseIcon' };
        if (name.startsWith('.')) return load(path.normalize(path.join(path.dirname(file), `${name}.ts`)), harness);
        throw new Error(`Unexpected dependency ${name}`);
      },
    }, { filename: file });
    return exports;
  }
  const { usePrayerSession } = load('hooks/usePrayerSession.ts', sessionReact);
  const { PrayerCamera } = load('components/PrayerCamera.tsx', cameraReact);
  const { PrayerStageCard } = load('components/PrayerStageCard.tsx', cardReact);
  const engine = load('services/prayerEngine.ts', sessionReact);
  function render() {
    session = sessionReact.render(() => usePrayerSession());
    cameraTree = cameraReact.render(() => PrayerCamera({
      engineStatus: 'connected', onCheckEngine: async () => 'connected', sessionId: session.sessionId, isDarkMode: false,
      prayerState: session.prayerState,
      preSujudTransitionStartedAt: session.prayerState.preSujudTransitionStartedAt,
      postSujudTransitionStartedAt: session.prayerState.postSujudTransitionStartedAt,
      firstTashahhudStartedAt: session.prayerState.firstTashahhudStartedAt,
      onStatusChange: session.setCameraStatus, onStartNewPrayerSession: session.startNewPrayerSession,
      onPoseDetected(pose, confidence) {
        delivered.push({ frame, at: now, pose, confidence });
        session.applyEngineEvent({ state: { currentPose: pose, confidence } });
      },
    }));
    cardTree = cardReact.render(() => PrayerStageCard({ prayer: session.selectedPrayer, engineStatus: 'connected',
      currentPose: session.prayerState.currentPose, state: session.prayerState, isDarkMode: false }));
  }
  function advance(ms) {
    const target = now + ms;
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break;
      now = due[1].due; timers.delete(due[0]); due[1].fn(); render();
    }
    now = target; render();
  }
  const camera = () => find(cameraTree, (node) => node.type === 'NativeFrontCamera')[0];
  render();
  session.selectPrayer(prayer); render();
  await find(cameraTree, (node) => node.type === 'Pressable')[0].props.onPress(); render();
  camera().props.onCameraReady(); render();
  find(cameraTree, (node) => node.props?.accessibilityLabel === 'بدء الصلاة')[0].props.onPress(); render();
  advance(5000);
  assert.equal(camera().props.inferenceEnabled, true);
  return {
    get state() { return session.prayerState; }, trace,
    get awaitingItidal() { return engine.isAwaitingItidal(session.prayerState); },
    eligible: engine.isAwaitingItidal,
    wait: advance,
    applyState(state) { session.applyEngineEvent({ state }); render(); },
    foreground(active) { appStateListener(active ? 'active' : 'background'); render(); },
    unavailable() { camera().props.onCameraUnavailable(); render(); },
    ready() { camera().props.onCameraReady(); render(); },
    async stopResume() {
      find(cameraTree, (node) => node.type === 'Pressable')[0].props.onPress(); render();
      advance(2000);
      await find(cameraTree, (node) => node.type === 'Pressable')[0].props.onPress(); render();
      camera().props.onCameraReady(); render();
      assert.equal(camera().props.inferenceEnabled, true);
    },
    restart() {
      const previousSession = session.sessionId;
      session.startNewPrayerSession(); render();
      find(cameraTree, (node) => node.props?.accessibilityLabel === 'بدء الصلاة')[0].props.onPress(); render();
      advance(5000);
      return previousSession;
    },
    feed(scores, { step = cadence, resultSession = session.sessionId, rawPose } = {}) {
      assert.equal(scores.length, classes.length);
      assert(Math.abs(scores.reduce((sum, score) => sum + score, 0) - 1) < 0.02);
      // Match the Swift argmax and tie behavior; do not add a confidence gate.
      let index = 0;
      for (let candidate = 1; candidate < scores.length; candidate++) if (scores[candidate] > scores[index]) index = candidate;
      advance(step); frame++;
      const pose = rawPose ?? classes[index], confidence = scores[index];
      const previousStage = session.prayerState.prayerStage;
      const previousDelivered = delivered.length;
      camera().props.onPrediction({ nativeEvent: { pose, confidence, sessionId: resultSession } }); render();
      const icons = find(cardTree, (node) => node.type === 'PoseIcon');
      const item = { frame, at: now, scores, pose, confidence, stage: session.prayerState.prayerStage,
        delivered: delivered.length > previousDelivered, changedStage: previousStage !== session.prayerState.prayerStage,
        displayStage: icons[0]?.props.stage };
      trace.push(item);
      if (item.stage !== null) assert.equal(item.displayStage, item.stage, 'Real stage card must display the confirmed stage without a second delay');
      return item;
    },
    close() { sessionReact.unmount(); cameraReact.unmount(); cardReact.unmount(); },
  };
}

function scores(pose, confidence = 0.97, competitor, competitorConfidence = 0) {
  const rest = (1 - confidence - competitorConfidence) / (competitor ? 2 : 3);
  return classes.map((label) => label === pose ? confidence : label === competitor ? competitorConfidence : rest);
}
const stages = [
  ['Qiyam', 'STANDING', 'STANDING'], ['standing -> Ruku', 'BOWING', 'BOWING'],
  ['Ruku -> I\'tidal', 'STANDING', 'ITIDAL'], ['I\'tidal -> Sujud', 'PROSTRATING', 'SUJUD_1'],
  ['Sujud -> sitting', 'SITTING', 'SITTING_BETWEEN_SUJUD'], ['sitting -> Sujud', 'PROSTRATING', 'SUJUD_2'],
];
const holdFrames = Math.ceil(stabilityMs / intervalMs) + 3;
const repeat = (value, count = holdFrames) => Array.from({ length: count }, () => value);

function sequenceFor(kind, previous, target) {
  const overlap = (pose, confidence) => scores(pose, confidence, pose === target ? previous : target, 0.98 - confidence);
  if (kind === 'clear') return repeat(scores(target));
  if (kind === 'noisy') return [scores(target), overlap(target, 0.60), overlap(previous, 0.51),
    overlap(target, 0.80), overlap(target, 0.60), overlap(previous, 0.52), ...repeat(scores(target))];
  if (kind === 'one-blip') return [scores(target), scores(target), scores(previous), ...repeat(scores(target))];
  if (kind === 'slow') return [scores(previous), overlap(previous, 0.70), overlap(previous, 0.52),
    overlap(target, 0.51), overlap(previous, 0.51), overlap(target, 0.55), overlap(target, 0.60),
    overlap(previous, 0.51), ...repeat(scores(target))];
  throw new Error(kind);
}

async function measure(prayer, kind, cadence, options) {
  const h = await pipeline(prayer, cadence, options), rows = [];
  try {
    repeat(scores('STANDING')).forEach((value) => h.feed(value));
    assert.equal(h.state.prayerStage, 'STANDING');
    for (let transition = 1; transition < stages.length; transition++) {
      const [name, target, expectedStage] = stages[transition];
      const previous = stages[transition - 1][1];
      // A transient descent/rising classifier error is rejected before the actual transition.
      const beforeNoise = h.state.prayerStage;
      const noise = h.feed(scores(target));
      assert.equal(noise.delivered, false);
      assert.equal(h.state.prayerStage, beforeNoise, `${name}: one-frame noise must not advance`);
      repeat(scores(previous)).forEach((value) => h.feed(value));
      assert.equal(h.state.prayerStage, beforeNoise);
      const transitionKind = kind === 'rising-noisy' ? (expectedStage === 'ITIDAL' ? 'noisy' : 'clear') : kind;
      const frames = sequenceFor(transitionKind, previous, target).map((value) => h.feed(value));
      const first = frames.find((item) => item.pose === target);
      // "Clearly" is a measurement marker (>= 0.8), never an application threshold.
      const clear = frames.find((item) => item.pose === target && item.confidence >= 0.8);
      const confirmed = frames.find((item) => item.stage === expectedStage);
      assert(first && clear && confirmed, `${name} must confirm`);
      assert(confirmed.delivered, 'Engine stage and filtered callback update on the same frame');
      assert.equal(frames.filter((item) => item.delivered && item.pose === target).length, 1, 'Stable pose is delivered once, including after fast I\'tidal confirmation');
      assert.equal(h.state.sahwAlerts.length, 0, 'Valid/noisy movement must not create Sahw events');
      assert.equal(h.state.activeSahwEvent, null);
      rows.push({ prayer, kind, name, cadenceMs: cadence, firstFrame: first.frame, firstClearFrame: clear.frame,
        confirmedFrame: confirmed.frame, extraFrames: confirmed.frame - first.frame,
        latencyMs: Math.round(confirmed.at - first.at),
        clearLatencyMs: confirmed.at >= clear.at ? Math.round(confirmed.at - clear.at) : null });
    }
    return rows;
  } finally { h.close(); }
}

const prayers = ['FAJR', 'MAGHRIB', 'DHUHR', 'ASR', 'ISHA'];
async function rejectedRises(prayer, options) {
  for (const [name, poses] of [
    ['single false standing', ['STANDING', ...Array(10).fill('BOWING')]],
    ['two isolated standing', ['STANDING', 'BOWING', 'STANDING', ...Array(10).fill('BOWING')]],
    ['two consecutive then bowing', ['STANDING', 'STANDING', ...Array(10).fill('BOWING')]],
    ['remaining in Ruku', Array(20).fill('BOWING')],
    ['persistent alternation', Array.from({ length: 20 }, (_, i) => i % 2 ? 'BOWING' : 'STANDING')],
  ]) {
    const h = await pipeline(prayer, intervalMs, options);
    try {
      repeat(scores('STANDING')).forEach((value) => h.feed(value));
      repeat(scores('BOWING')).forEach((value) => h.feed(value));
      assert.equal(h.state.prayerStage, 'BOWING');
      assert.equal(h.awaitingItidal, true, `${prayer}: real confirmed Ruku is eligible`);
      for (const pose of poses) {
        h.feed(scores(pose));
        assert.equal(h.state.prayerStage, 'BOWING', `${prayer}: ${name}`);
        assert.equal(h.state.sahwAlerts.length, 0);
      }
    } finally { h.close(); }
  }
}

async function resetProtection() {
  for (const reset of ['persistent Ruku', 'sitting', 'prostrating', 'unknown', 'result gap', 'state update', 'background', 'interruption', 'camera stop']) {
    const h = await pipeline('FAJR');
    try {
      repeat(scores('STANDING')).forEach((value) => h.feed(value));
      repeat(scores('BOWING')).forEach((value) => h.feed(value));
      h.feed(scores('STANDING')); h.feed(scores('STANDING'));
      assert.equal(h.state.prayerStage, 'BOWING');
      if (reset === 'persistent Ruku') { h.feed(scores('BOWING')); h.feed(scores('BOWING')); }
      if (reset === 'sitting') h.feed(scores('SITTING'));
      if (reset === 'prostrating') h.feed(scores('PROSTRATING'));
      if (reset === 'unknown') {
        // Exercise the invalid-result reset boundary of the actual component.
        h.feed(scores('STANDING'), { rawPose: 'UNKNOWN' });
      }
      if (reset === 'result gap') h.wait(stabilityMs);
      if (reset === 'state update') h.applyState({ confidence: 0.88 });
      if (reset === 'background') { h.foreground(false); h.wait(2000); h.foreground(true); h.ready(); }
      if (reset === 'interruption') { h.unavailable(); h.wait(2000); h.ready(); }
      if (reset === 'camera stop') await h.stopResume();
      const first = h.feed(scores('STANDING'));
      assert.equal(first.stage, 'BOWING', `${reset}: old standing evidence must not carry over`);
      const second = h.feed(scores('STANDING'));
      assert.equal(second.stage, 'BOWING', `${reset}: need fresh three-standing support`);
      const third = h.feed(scores('STANDING'));
      assert.equal(third.stage, 'ITIDAL', `${reset}: a fresh valid rise must still work`);
    } finally { h.close(); }
  }
  const context = await pipeline('FAJR');
  try {
    repeat(scores('STANDING')).forEach((value) => context.feed(value));
    repeat(scores('BOWING')).forEach((value) => context.feed(value));
    const ruku = context.state;
    assert.equal(context.eligible(ruku), true);
    for (const changed of [
      { ...ruku, prayerStage: 'STANDING' },
      { ...ruku, sequence: { ...ruku.sequence, pendingBowing: false } },
      { ...ruku, sequence: { ...ruku.sequence, rukuDone: true } },
      { ...ruku, activeSahwEvent: { alertType: 'EXTRA_BOWING', recoveryStageIds: [] } },
      { ...ruku, prayerCompleted: true },
      { ...ruku, expectedIndex: 3 },
      { ...ruku, currentRakah: 2 },
    ]) assert.equal(context.eligible(changed), false, 'Only a current confirmed Ruku awaiting its own I\'tidal is eligible');
    context.feed(scores('STANDING')); context.feed(scores('STANDING'));
    context.applyState({ prayerStage: 'STANDING' });
    for (let i = 0; i < 3; i++) {
      context.feed(scores('STANDING'));
      assert.equal(context.state.prayerStage, 'STANDING', 'Leaving Ruku invalidates pending rising support');
    }
  } finally { context.close(); }
  const newest = await pipeline('FAJR');
  try {
    repeat(scores('STANDING')).forEach((value) => newest.feed(value));
    repeat(scores('BOWING')).forEach((value) => newest.feed(value));
    for (let i = 0; i < 3; i++) newest.feed(scores('STANDING'), { step: 100 });
    assert.equal(newest.state.prayerStage, 'BOWING', 'Three bunched standing results lack 500ms evidence');
    newest.feed(scores('BOWING'), { step: 400 });
    assert.equal(newest.state.prayerStage, 'BOWING', 'Three-of-four votes cannot confirm on a newest BOWING result');
    newest.feed(scores('STANDING'));
    assert.equal(newest.state.prayerStage, 'ITIDAL', 'A fresh standing observation with sufficient support can confirm');
  } finally { newest.close(); }
  const h = await pipeline('FAJR');
  try {
    // Unconfirmed Ruku must not enable the special path.
    repeat(scores('STANDING')).forEach((value) => h.feed(value));
    h.feed(scores('BOWING')); h.feed(scores('BOWING'));
    assert.equal(h.awaitingItidal, false);
    repeat(scores('STANDING')).forEach((value) => h.feed(value));
    assert.equal(h.state.prayerStage, 'STANDING');
    repeat(scores('BOWING')).forEach((value) => h.feed(value));
    h.feed(scores('STANDING')); h.feed(scores('STANDING'));
    const staleSession = h.restart();
    for (let i = 0; i < 3; i++) h.feed(scores('STANDING'), { resultSession: staleSession });
    assert.equal(h.state.prayerStage, null, 'Stale session observations must not be counted');
    h.feed(scores('STANDING')); h.feed(scores('STANDING')); h.feed(scores('STANDING'));
    assert.equal(h.state.prayerStage, null, 'New-session Qiyam keeps the general 1000ms protection');
    repeat(scores('STANDING')).forEach((value) => h.feed(value));
    assert.equal(h.state.prayerStage, 'STANDING');
    repeat(scores('BOWING')).forEach((value) => h.feed(value));
    for (let i = 0; i < 10; i++) h.feed(scores('STANDING'), { step: 1 });
    assert.equal(h.state.prayerStage, 'BOWING', 'Rapid duplicate/bunched results cannot bypass the 500ms evidence span');
  } finally { h.close(); }
}

async function completePrayers() {
  for (const prayer of prayers) {
    const h = await pipeline(prayer);
    try {
      const sequenceFile = prayer === 'FAJR' ? 'fajrSequence' : prayer === 'MAGHRIB' ? 'maghribSequence' : 'fourRakahSequence';
      // Read the real sequence via a tiny isolated loader, not a fabricated prayer.
      const exports = {};
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(`constants/${sequenceFile}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText, { exports });
      for (const expected of exports[sequenceFile]) {
        const pose = { STANDING: 'STANDING', BOWING: 'BOWING', ITIDAL: 'STANDING', SUJUD_1: 'PROSTRATING',
          SUJUD_2: 'PROSTRATING', SITTING_BETWEEN_SUJUD: 'SITTING', TASHAHHUD: 'SITTING' }[expected.stage];
        repeat(scores(pose)).forEach((value) => h.feed(value));
        assert.equal(h.state.prayerStage, expected.stage, `${prayer}/${expected.id}`);
        assert.equal(h.state.sahwAlerts.length, 0);
        assert.equal(h.awaitingItidal, expected.stage === 'BOWING');
      }
      assert.equal(h.state.prayerCompleted, true);
      assert.equal(h.state.currentRakah, h.state.totalRakahs);
    } finally { h.close(); }
  }
}

async function main() {
  const comparisons = [];
  for (const prayer of prayers) {
    for (const kind of ['clear', 'one-blip', 'noisy', 'slow']) {
      const before = await measure(prayer, kind, intervalMs, { baseline: true });
      before.forEach((row) => assert.equal(row.extraFrames, { clear: 4, 'one-blip': 7, noisy: 10, slow: 9 }[kind]));
      const after = beforeOnly ? before : await measure(prayer, kind, intervalMs);
      for (let i = 0; i < before.length; i++) {
        const special = before[i].name === "Ruku -> I'tidal";
        const expectedFrames = special && !beforeOnly ? { clear: 2, 'one-blip': 3, noisy: 3, slow: 3 }[kind] : before[i].extraFrames;
        assert.equal(after[i].extraFrames, expectedFrames, `${prayer}/${kind}/${before[i].name}`);
        assert.equal(after[i].latencyMs, expectedFrames * intervalMs);
        comparisons.push({ prayer, kind, transition: before[i].name, beforeFrames: before[i].extraFrames,
          afterFrames: after[i].extraFrames, beforeMs: before[i].latencyMs, afterMs: after[i].latencyMs });
      }
    }
    await rejectedRises(prayer, { baseline: true });
    if (!beforeOnly) await rejectedRises(prayer, {});
  }
  if (!beforeOnly) {
    await resetProtection();
    await completePrayers();
    // Shared code must retain exactly the original timings on Android.
    for (const kind of ['clear', 'noisy', 'slow']) {
      const android = await measure('FAJR', kind, intervalMs, { platform: 'android' });
      android.forEach((row) => assert.equal(row.extraFrames, { clear: 4, noisy: 10, slow: 9 }[kind]));
    }
    const cadence = Math.ceil(intervalMs / (1000 / 30)) * (1000 / 30);
    const quantized = await measure('FAJR', 'clear', cadence);
    quantized.forEach((row) => assert.equal(row.latencyMs, row.name === "Ruku -> I'tidal" ? 533 : 1067));
  }
  console.table(comparisons.filter((row) => row.prayer === 'FAJR'));
  console.log(`PASS: ${beforeOnly ? 'BEFORE baseline' : 'BEFORE/AFTER'}: 100 transition comparisons across five prayers; isolated standing/continued Ruku/alternation rejected; no Sahw alerts.`);
  if (!beforeOnly) console.log('PASS: evidence resets, lifecycle/session/state gates, burst rejection, all rakahs of all five prayers; unrelated transition timings and Android timings unchanged; 30fps-quantized I\'tidal latency 533ms.');
  const output = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (output) fs.writeFileSync(output, JSON.stringify({ intervalMs, stabilityMs, comparisons }, null, 2) + '\n');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
