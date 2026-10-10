import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const folder = 'validation-output/ios-export/_expo/static/js/ios';
// CI supplies the source map emitted by the actual Xcode Release bundle phase.
// With no argument, retain the existing Expo-export verification command.
const sourceMap = process.argv[2] ?? path.join(folder, fs.readdirSync(folder).find((name) => name.startsWith('entry-') && name.endsWith('.js.map')));
const map = JSON.parse(fs.readFileSync(sourceMap, 'utf8'));
assert(Array.isArray(map.sourcesContent) && map.sourcesContent.some((source) => typeof source === 'string'), 'Source map must include source contents for offline verification');
const normalized = map.sources.map((s) => s.replaceAll('\\', '/'));
for (const name of ['components/LocalClassificationCamera.ios.tsx', 'services/engineConnection.ios.ts', 'components/StartupSplash.ios.tsx']) {
  const index = normalized.findIndex((s) => s.endsWith(name));
  assert(index >= 0, `${name} not resolved for iOS`);
  assert.equal(typeof map.sourcesContent[index], 'string', `${name} source contents missing`);
}
for (const name of ['services/predictionApi.ts', 'services/engineConnection.ts', 'services/predictionApi.android.ts', 'components/LocalClassificationCamera.android.tsx']) {
  assert(!normalized.some((s) => s.endsWith(name)), `Forbidden iOS implementation: ${name}`);
}
const projectCode = map.sourcesContent.filter((_, i) => /\/(services|hooks|components|screens|modules|src\/app)\//.test('/' + normalized[i]) && !normalized[i].includes('node_modules/')).join('\n');
assert(!/EXPO_PUBLIC_API_URL|\/health\b|\/predict\b|fetch\(/.test(projectCode), 'iOS application sources contain a remote API dependency');
const appDelegate = fs.readFileSync('ios/slatk/AppDelegate.swift', 'utf8');
assert.match(appDelegate, /#else\s+return Bundle\.main\.url\(forResource: "main", withExtension: "jsbundle"\)/);
if (!process.argv[2]) {
  const metadata = JSON.parse(fs.readFileSync('validation-output/ios-export/metadata.json', 'utf8'));
  assert(metadata.fileMetadata.ios.assets.length > 0);
}
console.log('PASS: iOS bundle resolves local Core ML camera/readiness, excludes remote API implementations/URLs, and Release delegate loads embedded JS.');
console.log('Static bundle/project check; installed offline operation requires a real iPhone acceptance test.');
