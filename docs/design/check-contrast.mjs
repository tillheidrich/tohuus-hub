/**
 * WCAG 2.2 AA check of the Dutch Detail token layer – reads the real values from web/src/styles.css
 * (the first `:root {` block = light, `:root[data-theme='dark'] {` = dark) and checks every text/background
 * and control/background pair the components use. Run from the repo root:  node docs/design/check-contrast.mjs
 * Exit code 1 when a pair fails. Text needs 4.5:1, control borders and large graphics 3:1.
 */
import fs from 'node:fs';

const css = fs.readFileSync('web/src/styles.css', 'utf8');
const block = (re) => {
  const m = re.exec(css);
  if (!m) throw new Error(`block not found: ${re}`);
  const body = css.slice(m.index + m[0].length, css.indexOf('}', m.index));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((x) => [x[1], x[2]]));
};
const light = block(/:root \{/);
const dark = { ...light, ...block(/:root\[data-theme='dark'\] \{/) };

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background, minimum]
const TEXT = 4.5;
const UI = 3;
const PAIRS = [
  ['ink', 'canvas', TEXT], ['ink', 'surface', TEXT], ['ink', 'surface-2', TEXT],
  ['ink-2', 'canvas', TEXT], ['ink-2', 'surface', TEXT], ['ink-2', 'surface-2', TEXT],
  ['ink-3', 'canvas', TEXT], ['ink-3', 'surface', TEXT],
  ['line-strong', 'canvas', UI], ['line-strong', 'surface', UI],
  ['primary-text', 'canvas', TEXT], ['primary-text', 'surface', TEXT], ['primary-text', 'primary-soft', TEXT],
  ['on-primary', 'primary', TEXT], ['on-primary', 'primary-dark', TEXT], ['primary', 'canvas', UI],
  ['warning', 'canvas', TEXT], ['warning', 'surface', TEXT], ['warning', 'warning-soft', TEXT],
  ['low', 'canvas', TEXT], ['low', 'low-soft', TEXT],
  ['empty', 'canvas', TEXT], ['empty', 'empty-soft', TEXT], ['on-status', 'empty', TEXT],
  ['info', 'canvas', TEXT], ['info', 'info-soft', TEXT],
  ['on-block', 'block', TEXT], ['on-block-2', 'block', TEXT],
  ['on-rail', 'rail', TEXT], ['rail-2', 'rail', TEXT],
  ['ink', 'sand', TEXT], ['ink', 'sage-soft', TEXT], ['ink', 'primary-soft', TEXT],
  ['tint-ink', 'tint-1', TEXT], ['tint-ink', 'tint-3', TEXT],
  ['on-accent-fixed', 'mustard', TEXT],
];

let fails = 0;
for (const [name, t] of [['light', light], ['dark', dark]]) {
  console.log(`\n${name}`);
  for (const [fg, bg, min] of PAIRS) {
    if (!t[fg] || !t[bg]) {
      console.log(`  ?    --${fg} on --${bg}: token missing`);
      fails++;
      continue;
    }
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) fails++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} --${fg} ${t[fg]} on --${bg} ${t[bg]}  ${r.toFixed(2)}:1 (min ${min})`);
  }
}
console.log(fails ? `\n${fails} pair(s) fail` : '\nall pairs pass WCAG 2.2 AA');
process.exit(fails ? 1 : 0);
