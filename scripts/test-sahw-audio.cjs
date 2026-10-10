// Exercise the read-only audio boundary against real, unchanged engine events.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(process.argv[2] || 'validation-output/prayer');
const engine = require(path.join(root, 'services/prayerEngine.js'));
const { createSahwAudioEventTracker } = require(path.join(root, 'services/sahwAudio.js'));
const { fajrSequence } = require(path.join(root, 'constants/fajrSequence.js'));
const { maghribSequence } = require(path.join(root, 'constants/maghribSequence.js'));
const { fourRakahSequence } = require(path.join(root, 'constants/fourRakahSequence.js'));
const poseFor = (stage) => ({
  STANDING: 'STANDING', BOWING: 'BOWING', ITIDAL: 'STANDING',
  SUJUD_1: 'PROSTRATING', SUJUD_2: 'PROSTRATING',
  SITTING_BETWEEN_SUJUD: 'SITTING', TASHAHHUD: 'SITTING',
})[stage];

const originalNow = Date.now;
let now = 1_000_000;
Date.now = () => now;
try {
  for (const [prayer, sequence] of [
    ['FAJR', fajrSequence], ['MAGHRIB', maghribSequence],
    ['DHUHR', fourRakahSequence], ['ASR', fourRakahSequence], ['ISHA', fourRakahSequence],
  ]) {
    const tracker = createSahwAudioEventTracker();
    const claim = (state, session = 0) => tracker.consume(session, state.sahwAlerts, state.activeSahwEvent);
    let state = engine.createInitialPrayerState(prayer);
    assert.equal(claim(state), 0);
    for (const stage of sequence) {
      state = engine.advancePrayerSequence(state, poseFor(stage.stage));
      assert.equal(claim(state), 0, 'Normal prayer must never play the alert');
      now += 2_000;
    }
    state = engine.advancePrayerSequence(state, 'STANDING');
    assert.equal(claim(state), 0);
    now += 9_999;
    state = engine.confirmFinalTashahhudTimeout(state);
    assert.equal(claim(state), 0, 'No audio before the 10-second protection expires');
    now++;
    state = engine.confirmFinalTashahhudTimeout(state);
    const firstEvent = state.activeSahwEvent;
    assert(firstEvent);
    assert.equal(claim(state), 1, 'New history plus activation is exactly one sound');
    for (let frame = 0; frame < 100; frame++) {
      state = engine.advancePrayerSequence(state, frame % 2 ? 'BOWING' : 'STANDING');
      assert.equal(state.activeSahwEvent, firstEvent);
      assert.equal(claim(state), 0, 'Repeated results/renders must never replay the active event');
    }
    state = engine.advancePrayerSequence(state, 'SITTING');
    assert.equal(state.activeSahwEvent, null);
    assert.equal(claim(state), 0, 'Recovery must not play another sound');
    state = engine.advancePrayerSequence(state, 'STANDING');
    assert.equal(claim(state), 0);
    now += 10_000;
    state = engine.confirmFinalTashahhudTimeout(state);
    assert.notEqual(state.activeSahwEvent, firstEvent);
    assert.equal(state.sahwAlerts.length, 1, 'Engine reuses history for the same type/rakah');
    assert.equal(claim(state), 1, 'A genuinely new activation with the same type/stage must play');
    assert.equal(claim(state), 0);
    assert.equal(claim(engine.createInitialPrayerState(prayer), 1), 0, 'New session clears history safely');

    // An event may be created AND recovered within one engine update; its new
    // history entry is the existing durable evidence even when active is null.
    const instantTracker = createSahwAudioEventTracker();
    let skipped = engine.createInitialPrayerState(prayer);
    skipped = engine.advancePrayerSequence(skipped, 'STANDING');
    instantTracker.consume(2, skipped.sahwAlerts, skipped.activeSahwEvent);
    skipped = engine.advancePrayerSequence(skipped, 'PROSTRATING');
    assert.equal(skipped.activeSahwEvent, null);
    assert.equal(skipped.sahwAlerts.length, 1);
    assert.equal(instantTracker.consume(2, skipped.sahwAlerts, null), 1);
    assert.equal(instantTracker.consume(2, skipped.sahwAlerts, null), 0);
    console.log(`${prayer}: one-shot activation, 100 duplicate updates, same-stage reactivation, recovery, session reset and immediately recovered event passed.`);
  }
} finally {
  Date.now = originalNow;
}

// Execute the real hook with simulated React effects/player, without installing
// a test renderer or claiming that host simulation validates native audibility.
function playbackHarness() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let status = { isLoaded: false, didJustFinish: false };
  const seeks = [];
  const player = {
    isLoaded: false, loop: true, plays: 0, pauses: 0,
    seekTo(seconds) {
      assert.equal(seconds, 0);
      return new Promise((resolve, reject) => seeks.push({ resolve, reject }));
    },
    play() { this.plays++; },
    pause() { this.pauses++; },
  };
  const sameDeps = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps)) {
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const audio = {
    useAudioPlayer(source, options) {
      assert.equal(source.uri, process.env.TEST_PLATFORM === 'ios' ? 'file:///app/subhan_allah.mp3' : 'file:///android_res/raw/subhan_allah.mp3');
      assert.equal(options.downloadFirst, false);
      return player;
    },
    useAudioPlayerStatus() { return status; },
    setAudioModeAsync() { return Promise.resolve(); },
  };
  const code = ts.transpileModule(fs.readFileSync('hooks/useSahwAlertAudio.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleExports = {};
  vm.runInNewContext(code, {
    exports: moduleExports,
    require(name) {
      if (name === 'react') return react;
      if (name === 'expo-audio') return audio;
      if (name === 'react-native') return { Platform: { OS: process.env.TEST_PLATFORM ?? 'android' } };
      if (name === '../modules/local-classification') return { localClassification: { alertAudioUri: 'file:///app/subhan_allah.mp3' } };
      if (name === '../services/sahwAudio') return { createSahwAudioEventTracker };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return {
    player, seeks,
    render(session, state, nextStatus = status) {
      status = nextStatus;
      cursor = 0;
      effects = [];
      moduleExports.useSahwAlertAudio(session, state);
      effects.forEach((effect) => effect());
    },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); },
  };
}

async function verifyPlayback() {
  const h = playbackHarness();
  const active = { alertType: 'EXTRA_BOWING', sourceStageId: 'R1_ITIDAL', recoveryStageIds: ['R1_ITIDAL'] };
  const alert = { type: 'EXTRA_BOWING', kind: 'EXTRA', rakah: 1, message_ar: '', skippedStages: [] };
  const state = { sahwAlerts: [alert], activeSahwEvent: active };
  h.render(0, { sahwAlerts: [], activeSahwEvent: null });
  h.render(0, state);
  h.render(0, state);
  assert.equal(h.seeks.length, 0, 'New event waits for preload rather than being lost');
  h.render(0, state, { isLoaded: true, didJustFinish: false });
  assert.equal(h.seeks.length, 1);
  h.render(0, state);
  h.seeks.shift().resolve();
  await Promise.resolve();
  assert.equal(h.player.plays, 1);
  for (let update = 0; update < 100; update++) h.render(0, { ...state, sahwAlerts: [...state.sahwAlerts] });
  assert.equal(h.player.plays, 1);
  assert.equal(h.seeks.length, 0);
  h.render(0, state, { isLoaded: true, didJustFinish: true });
  h.render(0, { ...state, activeSahwEvent: null });
  const reactivated = { ...state, activeSahwEvent: { ...active } };
  h.render(0, reactivated);
  assert.equal(h.seeks.length, 1, 'Next event plays even though native player.isLoaded is false after end');
  h.seeks.shift().resolve();
  await Promise.resolve();
  assert.equal(h.player.plays, 2);
  h.render(0, reactivated, { isLoaded: true, didJustFinish: false });
  h.render(0, reactivated, { isLoaded: true, didJustFinish: true });
  assert.equal(h.seeks.length, 0, 'Finishing a sound alone must never replay it');

  const pending = { ...state, activeSahwEvent: { ...active } };
  h.render(0, pending);
  const staleSeek = h.seeks.shift();
  h.render(1, { sahwAlerts: [], activeSahwEvent: null });
  staleSeek.resolve();
  await Promise.resolve();
  assert.equal(h.player.plays, 2, 'New session cancels stale asynchronous playback');
  assert.equal(h.player.pauses, 1);
  h.render(1, state);
  const unmountedSeek = h.seeks.shift();
  h.unmount();
  unmountedSeek.resolve();
  await Promise.resolve();
  assert.equal(h.player.plays, 2, 'Unmount cancels asynchronous playback');
  assert.equal(h.player.loop, false);
  console.log('Actual audio hook (simulated player/effects): preload wait, one play per event, 100 duplicate renders, subsequent playback, no loop, session/unmount cancellation passed.');
}
verifyPlayback().catch((error) => { console.error(error); process.exitCode = 1; });
