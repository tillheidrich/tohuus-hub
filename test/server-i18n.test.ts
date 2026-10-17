import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-server-i18n-'));

/**
 * Every literal t('…') in server/ needs a German translation in server/locales/de-*.ts.
 * Run `npx vitest run test/server-i18n.test.ts` – the failure lists the missing keys.
 */
const ROOT = path.join(__dirname, '..', 'server');

// strings that are the same in German on purpose (names, loan words); keys made only of placeholders pass anyway
const SAME_IN_GERMAN = new Set<string>([
  'Budget', 'Post', 'Home Assistant Assist', 'Timer', 'Dashboard', 'Admin', 'live', 'Display', 'ToHuus Cloud',
  'Cappuccino', 'Espresso', 'Extras', 'Toppings', 'Snacks', 'Pizza', 'Person {n}', 'Party', 'Party: {name}', 'Sofa', 'optional', 'Link', 'Passkey',
]);
const onlyPlaceholders = (s: string) => !/\p{L}/u.test(s.replace(/\{\w+\}/g, ''));

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'locales' ? [] : files(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** the literal first argument of each t(…) call; template literals with ${} are skipped */
function serverKeys(): Map<string, string> {
  const out = new Map<string, string>();
  const re = /(?<![\w$.])t\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/g;
  for (const f of files(ROOT)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(re)) {
      if (m[1] === '`' && m[2].includes('${')) continue;
      const key = m[2].replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
      if (!key.trim()) continue;
      const line = src.slice(0, m.index).split('\n').length;
      if (!out.has(key)) out.set(key, `${path.relative(ROOT, f)}:${line}`);
    }
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('server translations', () => {
  it('finds the t() calls', () => {
    expect(serverKeys().size).toBeGreaterThan(200);
  });

  it('every server text has a German translation with the same placeholders', async () => {
    const { t, withLang } = await import('../server/i18n');
    const missing: string[] = [];
    const badVars: string[] = [];
    for (const [key, where] of serverKeys()) {
      const de = withLang('de', () => t(key));
      if (de === key && !SAME_IN_GERMAN.has(key) && !onlyPlaceholders(key)) missing.push(`${where}  ${JSON.stringify(key)}`);
      else if (de !== key && placeholders(de).join() !== placeholders(key).join()) badVars.push(`${where}  ${JSON.stringify(key)} → ${JSON.stringify(de)}`);
    }
    expect(missing, `missing German translations:\n${missing.join('\n')}`).toEqual([]);
    expect(badVars, `placeholders differ:\n${badVars.join('\n')}`).toEqual([]);
  });
});
