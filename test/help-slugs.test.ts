import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** docs/help-slugs.md is the contract with the website; the app may only link slugs listed there. */
describe('help slugs', () => {
  const root = path.join(__dirname, '..');
  const doc = fs.readFileSync(path.join(root, 'docs/help-slugs.md'), 'utf8');
  const docSlugs = [...doc.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
  const web = fs.readFileSync(path.join(root, 'web/src/help.tsx'), 'utf8');
  const list = web.slice(web.indexOf('HELP_SLUGS = ['), web.indexOf('] as const'));
  const webSlugs = [...list.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);

  it('web list and docs list are the same', () => {
    expect(docSlugs.length).toBeGreaterThan(10);
    expect(webSlugs).toEqual(docSlugs);
  });

  it('every slug used in the web app is listed', () => {
    const used = new Set<string>();
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/(?:slug=|helpUrl\()["'`]([a-z0-9-]+)["'`]/g)) used.add(m[1]);
      }
    };
    walk(path.join(root, 'web/src'));
    for (const s of used) expect(docSlugs).toContain(s);
  });
});
