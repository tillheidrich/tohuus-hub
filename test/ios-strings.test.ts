import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * iOS translations: every L("…") / LF("…") / LC("…") / LCF("…") literal in the Swift sources (app, share extension,
 * widgets, Watch, Watch widgets, Shared) needs a German entry in Localizable.xcstrings (LC/LCF: Cooking.xcstrings or
 * Localizable). Format specifiers (%@, %d, %lld …) must match between key and German text, every purpose string
 * (NS…UsageDescription) needs a German text, and the keys only reached through L(variable)
 * (ios/tools/strings_de_dynamic.json) must be in the catalog.
 * Run `npx vitest run test/ios-strings.test.ts` – the failure lists file:line and key.
 * Fix: add the German text to Localizable.xcstrings (pattern in /tmp/tohuus-agent-rules.md or ios/tools/gen_strings.py).
 */
const IOS = path.join(__dirname, '..', 'ios');
const RES = path.join(IOS, 'ToHuus', 'Resources');
const DIRS = ['ToHuus', 'ToHuusShare', 'ToHuusWidget', 'ToHuusWatch', 'ToHuusWatchWidgets', 'Shared'];

type Entry = { localizations?: Record<string, { stringUnit?: { state?: string; value?: string } }> };
const catalog = (name: string): Record<string, Entry> => JSON.parse(fs.readFileSync(path.join(RES, `${name}.xcstrings`), 'utf8')).strings;
const deOf = (e?: Entry) => {
  const u = e?.localizations?.de?.stringUnit;
  return u?.state === 'translated' && u.value ? u.value : undefined;
};

function swiftFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return swiftFiles(p);
    return e.name.endsWith('.swift') ? [p] : [];
  });
}

/** Swift string literal → the text it stands for (escapes \n \t \" \\ \u{…}) */
const unescapeSwift = (s: string) =>
  s.replace(/\\u\{([0-9a-fA-F]+)\}|\\(.)/g, (_, hex: string | undefined, c: string) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : c === 'n' ? '\n' : c === 't' ? '\t' : c);

type Use = { fn: string; key: string; where: string };
export function swiftKeys(): { uses: Use[]; interpolated: string[] } {
  const re = /(?<![\w.])(LCF|LC|LF|L)\(\s*"((?:[^"\\\n]|\\.)*)"/g;
  const uses: Use[] = [];
  const interpolated: string[] = [];
  for (const d of DIRS) {
    for (const f of swiftFiles(path.join(IOS, d))) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(re)) {
        const where = `${path.relative(IOS, f)}:${src.slice(0, m.index).split('\n').length}`;
        // L("… \(x) …") builds the key at runtime – it can never be in the catalog; use LF("… %@ …", x)
        if (m[2].includes('\\(')) interpolated.push(`${where}  ${m[2]}`);
        else uses.push({ fn: m[1], key: unescapeSwift(m[2]), where });
      }
    }
  }
  return { uses, interpolated };
}

/** printf specifiers without position (%1$@ → %@), "% a" in "80 % and" is no specifier */
const specs = (s: string) =>
  [...s.matchAll(/%(?:\d+\$)?[-+#0]*\d*(?:\.\d+)?(?:ll|l|h|q|z|t|j)?[@dDuUxXoOfeEgGcCsSpaA%]/g)].map((m) => m[0].replace(/\d+\$/, '')).sort();

describe('iOS translations', () => {
  const loc = catalog('Localizable');
  const cooking = catalog('Cooking');
  const { uses, interpolated } = swiftKeys();

  it('finds the L()/LF()/LC() calls', () => {
    expect(new Set(uses.map((u) => u.key)).size).toBeGreaterThan(3000);
  });

  it('builds no keys with string interpolation', () => {
    expect(interpolated, `L() with \\( … ) – use LF("… %@ …", value):\n${interpolated.join('\n')}`).toEqual([]);
  });

  it('every Swift text has a German translation', () => {
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const u of uses) {
      const id = `${u.fn.startsWith('LC') ? 'LC' : 'L'}|${u.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const e = u.fn.startsWith('LC') ? (deOf(cooking[u.key]) ? cooking[u.key] : loc[u.key]) : loc[u.key];
      if (!deOf(e)) missing.push(`${u.where}  ${JSON.stringify(u.key)}`);
    }
    expect(missing, `missing German translations:\n${missing.join('\n')}`).toEqual([]);
  });

  it('keys reached through L(variable) are in the catalog', () => {
    const dyn = Object.keys(JSON.parse(fs.readFileSync(path.join(IOS, 'tools', 'strings_de_dynamic.json'), 'utf8')));
    expect(dyn.filter((k) => !deOf(loc[k]))).toEqual([]);
  });

  it('every catalog entry is translated and keeps its format specifiers', () => {
    const bad: string[] = [];
    for (const [name, tbl] of [['Localizable', loc], ['Cooking', cooking], ['AppShortcuts', catalog('AppShortcuts')]] as const) {
      for (const [k, e] of Object.entries(tbl)) {
        const de = deOf(e);
        if (!de) bad.push(`${name}: not translated  ${JSON.stringify(k)}`);
        else if (specs(de).join() !== specs(k).join()) bad.push(`${name}: ${JSON.stringify(k)} → ${JSON.stringify(de)}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('every purpose string (NS…UsageDescription) has a German text', () => {
    const info = catalog('InfoPlist');
    const watchInfo = fs.existsSync(path.join(IOS, 'ToHuusWatch', 'InfoPlist.xcstrings'))
      ? (JSON.parse(fs.readFileSync(path.join(IOS, 'ToHuusWatch', 'InfoPlist.xcstrings'), 'utf8')).strings as Record<string, Entry>)
      : {};
    const yml = fs.readFileSync(path.join(IOS, 'project.yml'), 'utf8');
    const missing: string[] = [];
    // app: keys under info.properties; Watch app: INFOPLIST_KEY_… build settings
    for (const m of yml.matchAll(/^\s+(INFOPLIST_KEY_)?(NS\w+UsageDescription):/gm)) {
      const tbl = m[1] ? watchInfo : info;
      if (!deOf(tbl[m[2]])) missing.push(`${m[1] ? 'ToHuusWatch' : 'ToHuus'}: ${m[2]}`);
    }
    expect(missing.length + Object.keys(info).length).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });
});
