// Local rendering-contract checks. Native UIKit pixels are not simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness(platform) {
  const cache = new Map();
  let state;
  const jsx = (type, props, key) => ({ type, props, key });
  const react = {
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect() {},
    useMemo: (fn) => fn(),
  };
  const native = {
    Platform: { OS: platform, select: (options) => options[platform] ?? options.default },
    StyleSheet: { create: (styles) => styles, hairlineWidth: 0.5 },
    View: 'View', Text: 'Text', Pressable: 'Pressable', Image: 'Image',
    SafeAreaView: 'SafeAreaView', ScrollView: 'ScrollView',
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      exports, console, Date,
      require(name) {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
        if (name === 'react-native') return native;
        if (name === 'react-native-svg') return { SvgXml: 'SvgXml' };
        if (name === 'expo-linear-gradient') return { LinearGradient: 'Gradient' };
        if (name === 'expo-router') return { router: { canGoBack: () => true, back() {}, replace() {}, push() {} } };
        if (name.endsWith('/FontAwesomeIcon')) return { FontAwesomeIcon: 'FontIcon' };
        if (name.endsWith('/PrayerCamera')) return { PrayerCamera: 'Camera' };
        if (platform !== 'ios' && name.endsWith('/PrayerPoseIcon')) return { PrayerPoseIcon: 'LegacyPoseIcon' };
        if (name.endsWith('/usePrayerSession')) return { usePrayerSession: () => ({ selectedPrayer: 'FAJR', prayerState: state, sessionId: 1 }) };
        if (name.endsWith('/useEngineConnection')) return { useEngineConnection: () => ({ engineStatus: 'connected' }) };
        if (name.endsWith('/useSahwAlertAudio')) return { useSahwAlertAudio() {} };
        if (name.endsWith('/usePageTheme')) return { usePageTheme: () => false, themeParam: () => ({}) };
        const base = path.resolve(path.dirname(file), name);
        if (/\.png$/.test(base)) return base;
        if (/\.json$/.test(base)) return JSON.parse(fs.readFileSync(base, 'utf8'));
        const candidates = platform === 'ios'
          ? [`${base}.ios.tsx`, `${base}.tsx`, `${base}.ts`]
          : [`${base}.tsx`, `${base}.ts`];
        const resolved = candidates.find((candidate) => fs.existsSync(candidate));
        assert(resolved, `Unexpected dependency: ${name}`);
        return load(resolved);
      },
    });
    return exports;
  }
  const engine = load(path.resolve('services/prayerEngine.ts'));
  state = engine.createInitialPrayerState('FAJR');
  return { load: (file) => load(path.resolve(file)), engine };
}

function find(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap((child) => find(child, predicate));
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...find(tree.props?.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree && typeof tree === 'object') return text(tree.props?.children);
  return tree == null ? '' : String(tree);
}
function style(node) {
  const value = typeof node.props.style === 'function' ? node.props.style({ pressed: false }) : node.props.style;
  return Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
}
function verifyRTL(tree, inherited = 'ltr') {
  if (Array.isArray(tree)) return tree.forEach((child) => verifyRTL(child, inherited));
  if (!tree || typeof tree !== 'object') return;
  const styles = style(tree);
  const direction = styles.direction ?? inherited;
  if (styles.flexDirection?.startsWith('row')) {
    assert.equal(direction, 'rtl', 'Arabic rows must inherit RTL');
    assert.equal(styles.flexDirection, 'row', 'No double reversal in RTL');
  }
  if (tree.type === 'Text' && /[\u0600-\u06ff]/.test(text(tree))) {
    assert.equal(styles.writingDirection, 'rtl');
    assert.notEqual(styles.textAlign, 'right', 'iOS Fabric would flip explicit right alignment');
  }
  verifyRTL(tree.props.children, direction);
}

const ios = harness('ios');
const { PrayerStageCard } = ios.load('components/PrayerStageCard.tsx');
const { PrayerPoseIcon } = ios.load('components/PrayerPoseIcon.ios.tsx');
const icons = JSON.parse(fs.readFileSync('assets/ios/pose-icons.json', 'utf8'));
const stageCases = [
  ['STANDING', 'قيام', 'STANDING'], ['BOWING', 'ركوع', 'BOWING'],
  ['ITIDAL', 'اعتدال', 'STANDING'], ['SUJUD_1', 'السجود الأول', 'PROSTRATING'],
  ['SITTING_BETWEEN_SUJUD', 'الجلوس بين السجدتين', 'SITTING'],
  ['SUJUD_2', 'السجود الثاني', 'PROSTRATING'], ['TASHAHHUD', 'التشهد', 'SITTING'],
];
const poses = [null, 'STANDING', 'BOWING', 'PROSTRATING', 'SITTING', 'TRANSITION', 'UNKNOWN'];
function card(state, raw = state.currentPose) {
  return PrayerStageCard({ prayer: state.prayerType, state, currentPose: raw, engineStatus: 'connected', isDarkMode: false });
}
function checkIcon(tree, label, pose) {
  const labelNode = find(tree, (node) => node.type === 'Text' && text(node).startsWith('المرحلة الحالية:'))[0];
  assert.equal(text(labelNode), `المرحلة الحالية: ${label}`);
  const iconNode = find(tree, (node) => node.type === PrayerPoseIcon)[0];
  assert(iconNode, 'Known semantic stages must display an icon, even with missing raw pose');
  assert.equal(iconNode.props.pose, pose);
  const svg = find(PrayerPoseIcon(iconNode.props), (node) => node.type === 'SvgXml')[0];
  // Compare the artwork paths, rather than reproducing the crop/color code.
  const artworkPaths = (xml) => [...xml.matchAll(/\bd=(['"])(.*?)\1/g)].map((match) => match[2]).join('|');
  assert.equal(artworkPaths(svg.props.xml), artworkPaths(icons[pose]));
  verifyRTL(tree);
}
for (const [stage, label, expectedPose] of stageCases) {
  for (const raw of poses) {
    const state = { ...ios.engine.createInitialPrayerState(), prayerStage: stage, currentPose: raw };
    checkIcon(card(state, raw), label, expectedPose);
    // The icon component itself also prioritizes a semantic stage over raw ML.
    const svg = find(PrayerPoseIcon({ stage, pose: raw }), (node) => node.type === 'SvgXml')[0];
    assert(svg, `${stage} with ${raw} must render SVG`);
  }
}

// Reproduce skipped-first-Sujud with a raw Ruku observation through the real
// engine: both during the ten-second grace and after its missing-stage alert.
const originalNow = Date.now;
let now = 1_000_000;
Date.now = () => now;
try {
  for (const prayer of ['FAJR', 'DHUHR', 'ASR', 'MAGHRIB', 'ISHA']) {
    let state = ios.engine.createInitialPrayerState(prayer);
    for (const pose of ['STANDING', 'BOWING', 'STANDING', 'BOWING']) {
      state = ios.engine.advancePrayerSequence(state, pose);
      now += 2_000;
    }
    assert.equal(state.prayerStage, 'ITIDAL');
    assert.equal(state.currentPose, 'BOWING');
    checkIcon(card(state), 'اعتدال', 'STANDING');
    now += 10_000;
    state = ios.engine.confirmPreSujudTransitionTimeout(state);
    assert(state.sahwAlerts.some((alert) => alert.type === 'MISSING_STAGE'));
    checkIcon(card(state), 'اعتدال', 'STANDING');
    for (const raw of poses) checkIcon(card({ ...state, currentPose: raw }), 'اعتدال', 'STANDING');
  }
} finally {
  Date.now = originalNow;
}
const extraState = {
  ...ios.engine.createInitialPrayerState(), prayerStage: 'ITIDAL', currentPose: 'BOWING',
  sahwAlerts: [{ type: 'EXTRA_BOWING', kind: 'EXTRA', message_ar: 'ركوع زائد', rakah: 1, skippedStages: [] }],
};
checkIcon(card(extraState), 'ركوع زائد', 'BOWING');

const { PrayerOverviewCard } = ios.load('components/PrayerOverviewCard.tsx');
const overview = PrayerOverviewCard({ prayer: 'FAJR', state: ios.engine.createInitialPrayerState(), isDarkMode: false });
assert(text(overview).includes('تتم معالجة صور الكاميرا محلياً'));
assert(!text(overview).includes('عبر الخادم'));
verifyRTL(overview);
const home = ios.load('screens/HomeScreen.tsx').HomeScreen();
verifyRTL(home);
const prayerButtons = find(home, (node) => node.type === 'Pressable' && node.props.accessibilityState);
assert.deepEqual(prayerButtons.map((button) => text(button)), ['الفجر', 'الظهر', 'العصر', 'المغرب', 'العشاء']);
const timeline = find(card(ios.engine.createInitialPrayerState()), (node) => node.key === 1)[0];
assert(timeline);
assert.equal(style(timeline).flexDirection, 'row');
assert.deepEqual(find(timeline, (node) => node.type === 'Text').map(text), ['قيام', 'ركوع', 'اعتدال', 'سجود أول', 'جلوس', 'سجود ثانٍ']);
const { PageShell } = ios.load('components/PageShell.tsx');
verifyRTL(PageShell({ title: 'المزيد', isDarkMode: false }));
const more = ios.load('screens/MoreScreen.tsx').MoreScreen();
verifyRTL(PageShell(more.props));
const about = ios.load('screens/AboutSalatiqScreen.tsx').AboutSalatiqScreen();
verifyRTL(PageShell(about.props));
const { SahwAlert } = ios.load('components/SahwAlert.tsx');
verifyRTL(SahwAlert({ alert: extraState.sahwAlerts[0] }));

// Shared source changes retain Android's existing ordering and local wording.
const android = harness('android');
const androidOverview = android.load('components/PrayerOverviewCard.tsx').PrayerOverviewCard({ prayer: 'FAJR', state: android.engine.createInitialPrayerState(), isDarkMode: false });
assert.equal(style(androidOverview).flexDirection, 'row-reverse');
assert(text(androidOverview).includes('تتم المعالجة بأمان على جهازك'));
assert.equal(style(android.load('screens/HomeScreen.tsx').HomeScreen()).direction, undefined);
console.log('PASS: iOS RTL rendering contracts, local-processing text, 49 stage/raw-pose combinations, five-prayer skipped-Sujud errors and extra-Ruku icon consistency.');
