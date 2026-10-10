import fs from 'node:fs';

const files = { STANDING: 'قيام.svg', BOWING: 'ركوع.svg', PROSTRATING: 'سجود.svg', SITTING: 'جلوس.svg' };
const icons = Object.fromEntries(Object.entries(files).map(([pose, file]) => [pose, fs.readFileSync(`icons/${file}`, 'utf8')]));
fs.mkdirSync('assets/ios', { recursive: true });
fs.writeFileSync('assets/ios/pose-icons.json', JSON.stringify(icons) + '\n');
console.log('Embedded exact original SVG artwork as local JS strings for iOS; no asset fetch/download.');
