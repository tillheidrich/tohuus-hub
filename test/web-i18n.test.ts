import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { de } from '../web/src/locales/de/index';

/**
 * Every literal t('…') in web/src needs a German entry in web/src/locales/de/*.ts with the same {placeholders},
 * and every fragment file there has to be registered in index.ts.
 * Run `npx vitest run test/web-i18n.test.ts` – the failure lists the missing keys with file:line.
 */
const ROOT = path.join(__dirname, '..', 'web', 'src');
const LOCALES = path.join(ROOT, 'locales', 'de');

// the same in German on purpose (names, loan words); keys made only of placeholders/symbols pass anyway
const SAME_IN_GERMAN = new Set<string>([
  'Budget', 'Admin', 'Dashboard', 'Display', 'Timer', 'Home Assistant', 'ToHuus', 'ToHuus Cloud', 'Link', 'Passkey',
  'Snacks', 'Extras', 'Toppings', 'Pizza', 'optional', 'live', 'Post', 'Plus', 'Free', 'Matrix', 'Telegram', 'Gotify', 'ntfy',
  'Webhook', 'Cookidoo', 'Thermomix', 'Markdown', 'CSV', 'JSON', 'PDF', 'Name', 'Status', 'Start', 'Info', 'Tag', 'Sofa',
  'Bring mir was', // feature name, German in both languages
]);
const onlyPlaceholders = (s: string) => !/\p{L}/u.test(s.replace(/\{\w+\}/g, ''));

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'locales' ? [] : files(p);
    // i18n.ts itself only has t('…') in its doc comment
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && e.name !== 'i18n.ts' ? [p] : [];
  });
}

const STR = String.raw`(['"\x60])((?:\\.|(?!\1)[^\\])*)\1`;
const unescape = (s: string) => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');

/** literal keys of t(…): plain first argument and both arms of t(cond ? 'a' : 'b'); template literals with ${} are skipped */
export function webKeys(): Map<string, string> {
  const out = new Map<string, string>();
  const direct = new RegExp(String.raw`(?<![\w$.])t\(\s*` + STR + String.raw`\s*[,)]`, 'g');
  const ternary = new RegExp(String.raw`(?<![\w$.])t\(\s*[^()'"\x60?]{1,80}\?\s*` + STR + String.raw`\s*:\s*` + STR.replace('\\1', '\\3') + String.raw`\s*[,)]`, 'g');
  for (const f of files(ROOT)) {
    const src = fs.readFileSync(f, 'utf8');
    const add = (key: string, q: string, idx: number) => {
      if (q === '`' && key.includes('${')) return;
      const k = unescape(key);
      if (!k.trim()) return;
      if (!out.has(k)) out.set(k, `${path.relative(ROOT, f)}:${src.slice(0, idx).split('\n').length}`);
    };
    for (const m of src.matchAll(direct)) add(m[2], m[1], m.index!);
    for (const m of src.matchAll(ternary)) {
      add(m[2], m[1], m.index!);
      add(m[4], m[3], m.index!);
    }
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('web translations', () => {
  it('finds the t() calls', () => {
    expect(webKeys().size).toBeGreaterThan(1000);
  });

  it('registers every German fragment in index.ts', () => {
    const index = fs.readFileSync(path.join(LOCALES, 'index.ts'), 'utf8');
    const unregistered = fs
      .readdirSync(LOCALES)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .filter((f) => !index.includes(`from './${f.replace(/\.ts$/, '')}'`));
    expect(unregistered).toEqual([]);
  });

  it('every web text has a German translation with the same placeholders', () => {
    const missing: string[] = [];
    const badVars: string[] = [];
    for (const [key, where] of webKeys()) {
      const v = de[key];
      if (v === undefined) {
        if (!SAME_IN_GERMAN.has(key) && !onlyPlaceholders(key)) missing.push(`${where}  ${JSON.stringify(key)}`);
      } else if (placeholders(v).join() !== placeholders(key).join()) badVars.push(`${where}  ${JSON.stringify(key)} → ${JSON.stringify(v)}`);
    }
    expect(missing, `missing German translations:\n${missing.join('\n')}`).toEqual([]);
    expect(badVars, `placeholders differ:\n${badVars.join('\n')}`).toEqual([]);
  });

  it('German dictionary entries keep the placeholders of their English key', () => {
    const bad = Object.entries(de)
      .filter(([k, v]) => placeholders(v).join() !== placeholders(k).join())
      .map(([k, v]) => `${JSON.stringify(k)} → ${JSON.stringify(v)}`);
    expect(bad, `placeholders differ:\n${bad.join('\n')}`).toEqual([]);
  });
});
