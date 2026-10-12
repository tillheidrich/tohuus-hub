import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-facts-'));

/** "Gut zu wissen": every number has a primary source with link and retrieval date; both languages say the same. */
describe('facts', async () => {
  const { facts, rawFacts } = await import('../server/lib/facts');
  const PRIMARY = /(^|\.)(umweltbundesamt\.de|zugutfuerdietonne\.de|verbraucherzentrale\.de|boeckler\.de|bbk\.bund\.de|gesetze-im-internet\.de|destatis\.de|thuenen\.de|bmel\.de|bzfe\.de)$/;
  const nums = (s: string) => (s.replace(/(\d) (\d{3})\b/g, '$1$2').match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.').replace(/^(\d)\.(\d{3})$/, '$1$2')).sort();

  it('10–15 facts, each sourced from a primary source with a date', () => {
    const all = rawFacts();
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.length).toBeLessThanOrEqual(15);
    expect(new Set(all.map((f) => f.id)).size).toBe(all.length);
    for (const f of all) {
      expect(f.sources.length, f.id).toBeGreaterThan(0);
      for (const s of f.sources) {
        expect(s.url, f.id).toMatch(/^https:\/\//);
        expect(new URL(s.url).hostname, f.id).toMatch(PRIMARY);
        expect(s.retrieved, f.id).toMatch(/^\d{4}-\d\d-\d\d$/);
      }
      for (const k of ['title', 'text', 'tohuus'] as const) for (const l of ['de', 'en'] as const) expect(f[k][l]?.length, `${f.id} ${k} ${l}`).toBeGreaterThan(5);
    }
  });

  it('German and English texts carry the same numbers', () => {
    for (const f of rawFacts()) expect(nums(f.text.en), f.id).toEqual(nums(f.text.de));
  });

  it('localised output', () => {
    expect(facts('en').facts[0].title).toBe('Most of it happens at home');
    expect(facts('de').facts[0].title).toBe('Der größte Teil fällt zu Hause an');
  });
});
