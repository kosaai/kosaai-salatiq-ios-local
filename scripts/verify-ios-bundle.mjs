import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const folder = 'validation-output/ios-export/_expo/static/js/ios';
const file = fs.readdirSync(folder).find((name) => name.startsWith('entry-') && name.endsWith('.js.map'));
const map = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
const normalized = map.sources.map((s) => s.replaceAll('\\', '/'));
for (const name of ['components/LocalClassificationCamera.ios.tsx', 'services/engineConnection.ios.ts', 'components/StartupSplash.ios.tsx']) {
  assert(normalized.some((s) => s.endsWith(name)), `${name} not resolved for iOS`);
}
for (const name of ['services/predictionApi.ts', 'services/engineConnection.ts', 'services/predictionApi.android.ts', 'components/LocalClassificationCamera.android.tsx']) {
  assert(!normalized.some((s) => s.endsWith(name)), `Forbidden iOS implementation: ${name}`);
}
const projectCode = map.sourcesContent.filter((_, i) => /\/(services|hooks|components|screens|modules|src\/app)\//.test('/' + normalized[i]) && !normalized[i].includes('node_modules/')).join('\n');
assert(!/EXPO_PUBLIC_API_URL|\/health\b|\/predict\b|fetch\(/.test(projectCode));
const appDelegate = fs.readFileSync('ios/slatk/AppDelegate.swift', 'utf8');
assert.match(appDelegate, /#else\s+return Bundle\.main\.url\(forResource: "main", withExtension: "jsbundle"\)/);
const metadata = JSON.parse(fs.readFileSync('validation-output/ios-export/metadata.json', 'utf8'));
assert(metadata.fileMetadata.ios.assets.length > 0);
console.log('PASS: iOS export resolves local Core ML camera/readiness, excludes remote API implementations/URLs, and Release delegate loads embedded JS.');
console.log('Export/project check only; final IPA content/offline execution cannot be verified without a device build.');
