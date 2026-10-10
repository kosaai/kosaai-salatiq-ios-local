const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
const readiness = {};
vm.runInNewContext(transpile('services/localReadiness.ts'), { exports: readiness });
const ready = { permissionGranted: true, cameraReady: true, cameraActive: true, foreground: true, engineStatus: 'connected', prayerStarted: false, countdown: null, pendingSession: null };
assert.equal(readiness.canStartLocalPrayer(ready), true);
for (const [key, value] of Object.entries({ permissionGranted: false, cameraReady: false, cameraActive: false, foreground: false, engineStatus: 'error', prayerStarted: true, countdown: 5, pendingSession: 1 })) {
  assert.equal(readiness.canStartLocalPrayer({ ...ready, [key]: value }), false, key);
}

async function main() {
  let now = 10_000, cursor = 0, dirty = true, tree;
  let permission = { granted: false };
  const slots = [], effects = [], timers = new Map(), predictions = [];
  let nextTimer = 1, appState;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
    useState(initial) {
      const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (v) => { const next = typeof v === 'function' ? v(slots[i].value) : v; if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }];
    },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const props = {
    engineStatus: 'error', sessionId: 0, isDarkMode: false,
    preSujudTransitionStartedAt: null, postSujudTransitionStartedAt: null, firstTashahhudStartedAt: null,
    onStatusChange() {}, onCheckEngine: async () => 'error',
    onPoseDetected: (...args) => predictions.push(args), onStartNewPrayerSession() {},
  };
  const exports = {};
  const native = {
    Platform: { OS: 'ios' },
    AppState: { currentState: 'active', addEventListener(_name, fn) { appState = fn; return { remove() {} }; } },
    StyleSheet: { create: (s) => s, absoluteFill: {} },
    ActivityIndicator: 'ActivityIndicator', View: 'View', Text: 'Text', Pressable: 'Pressable',
  };
  vm.runInNewContext(transpile('components/PrayerCamera.tsx'), {
    exports, __DEV__: false, console,
    Date: { now: () => now },
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react-native') return native;
      if (name === 'expo-camera') return { CameraView: 'ExpoCamera', useCameraPermissions: () => [permission, async () => permission] };
      if (name === 'expo-image-manipulator') return {}; // iOS must never call it
      if (name === 'expo-linear-gradient') return { LinearGradient: 'Gradient' };
      if (name === '../constants/theme') return { colors: {}, lightColors: {} };
      if (name === '../services/localReadiness') return readiness;
      if (name === '../services/predictionApi') return { predictImage() { throw new Error('Network/image inference must never run on iOS'); } };
      if (name === './FontAwesomeIcon') return { FontAwesomeIcon: 'Icon' };
      if (name === './LocalClassificationCamera') return { LocalClassificationCamera: 'NativeFrontCamera' };
      throw new Error(name);
    },
  });
  function render() {
    for (let pass = 0; pass < 20; pass++) {
      cursor = 0; dirty = false; tree = exports.PrayerCamera(props);
      effects.splice(0).forEach((fn) => fn());
      if (!dirty) return;
    }
    throw new Error('Render loop');
  }
  function find(predicate, item = tree) {
    if (Array.isArray(item)) return item.flatMap((v) => find(predicate, v));
    if (!item || typeof item !== 'object') return [];
    return [...(predicate(item) ? [item] : []), ...find(predicate, item.props?.children ?? null)];
  }
  const camera = () => find((n) => n.type === 'NativeFrontCamera')[0];
  const start = () => find((n) => n.props?.accessibilityLabel === 'بدء الصلاة')[0];
  function advance(ms) {
    const target = now + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break;
      now = due[1].due; timers.delete(due[0]); due[1].fn(); render();
    }
    now = target; render();
  }
  function predict(pose, sessionId = props.sessionId) {
    camera().props.onPrediction({ nativeEvent: { pose, confidence: 0.9, sessionId } }); render();
  }
  render();
  await find((n) => n.type === 'Pressable')[0].props.onPress(); render();
  assert.equal(camera(), undefined, 'Denied permission cannot start capture');
  permission = { granted: true };
  render();
  await find((n) => n.type === 'Pressable')[0].props.onPress(); render();
  assert.equal(start().props.disabled, true);
  assert.equal(camera().props.facing, 'front');
  assert.equal(find((n) => n.props?.accessibilityLabel === 'تبديل الكاميرا').length, 0);
  camera().props.onCameraReady(); render();
  assert.equal(start().props.disabled, true, 'Camera alone cannot enable Start without model');
  props.engineStatus = 'connected'; render();
  assert.equal(start().props.disabled, false);
  start().props.onPress(); render();
  assert.equal(camera().props.inferenceEnabled, false);
  predict('STANDING'); assert.equal(predictions.length, 0);
  advance(4_999); assert.equal(camera().props.inferenceEnabled, false);
  advance(1); assert.equal(camera().props.inferenceEnabled, true);
  predict('STANDING'); advance(999); predict('STANDING'); assert.equal(predictions.length, 0);
  advance(1); predict('STANDING'); assert.equal(predictions.length, 1);
  for (let i = 0; i < 100; i++) predict('STANDING');
  assert.equal(predictions.length, 1, 'Stable pose is delivered once');
  predict('BOWING'); advance(1_000); predict('BOWING', -1); assert.equal(predictions.length, 1, 'Stale session ignored');
  predict('BOWING'); assert.equal(predictions.length, 2);
  appState('background'); render(); advance(5_000); predict('SITTING');
  assert.equal(predictions.length, 2, 'Background frames ignored');
  assert.equal(camera().props.inferenceEnabled, false);
  appState('active'); camera().props.onCameraReady(); render();
  predict('SITTING'); advance(999); predict('SITTING'); assert.equal(predictions.length, 2);
  advance(1); predict('SITTING'); assert.equal(predictions.length, 3, 'Stability restarts after background');
  props.sessionId = 1; render();
  assert.equal(start().props.disabled, false);
  start().props.onPress(); render(); advance(2_000);
  camera().props.onCameraUnavailable(); render(); advance(5_000);
  assert.equal(camera().props.inferenceEnabled, false, 'Interrupted countdown cannot begin classification');
  assert.equal(start().props.disabled, true);
  slots.forEach((s) => s.cleanup?.());
  console.log('PASS: real PrayerCamera component with simulated native events: permission/model/session readiness, front-only UI, 5-second countdown, 1-second stability, duplicate/stale result filtering, foreground/interruption cancellation. No network path invoked.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
