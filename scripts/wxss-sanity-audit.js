// WXSS comment sanity audit
// Checks that all /* and */ are paired in core WXSS files.
const fs = require('fs');
const path = require('path');

const FILES = [
  'miniprogram/pages/menu/menu.wxss',
  'miniprogram/pages/shopping/shopping.wxss',
  'miniprogram/pages/fridge/fridge.wxss',
  'miniprogram/pages/index/index.wxss',
  'miniprogram/pages/meal/meal.wxss',
  'miniprogram/pages/mine/mine.wxss',
  'miniprogram/app.wxss',
  'miniprogram/custom-tab-bar/index.wxss',
];

let failures = 0;
const ROOT = path.join(__dirname, '..');

for (const rel of FILES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  const content = fs.readFileSync(full, 'utf8');
  const opens = (content.match(/\/\*/g) || []).length;
  const closes = (content.match(/\*\//g) || []).length;
  if (opens !== closes) {
    console.error(`FAIL: ${rel}: /* count=${opens}, */ count=${closes} — unterminated comment`);
    failures++;
  } else {
    console.log(`OK: ${rel} (${opens} comment blocks)`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} file(s) with unbalanced CSS comments.`);
  process.exit(1);
}
console.log('\nAll WXSS files have balanced comments.');
