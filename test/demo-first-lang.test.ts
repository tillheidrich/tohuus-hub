/**
 * Demo data on a fresh self-hosted server (Paket E): nobody chose a language yet (no LANGUAGE, no setting), so the
 * demo used to come in English (config.language defaults to 'en') – a German app showed English sample products.
 * Now it follows the first-start rule of instance-lang.ts (German unless someone chose), without fixing the language.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-demo-first-lang-'));
process.env.MULTI_TENANT = '';
delete process.env.LANGUAGE;

it('seeds German sample products and leaves the language open', async () => {
  const dbm = await import('../server/db');
  const routes = path.join(__dirname, '../server/routes');
  for (const f of fs.readdirSync(routes).filter((x) => x.endsWith('.ts'))) await import(path.join(routes, f));
  const seed = await import('../server/seed');
  seed.ensureBaseData({ places: true });
  expect(dbm.getSetting<string | null>('language', null)).toBeNull();
  expect(seed.seedDemo()).toBe(true);
  const names = (dbm.db.prepare('SELECT name FROM products').all() as { name: string }[]).map((r) => r.name);
  expect(names).toEqual(expect.arrayContaining(['Erdbeer-Eis', 'Paketband']));
  expect(names).not.toContain('Strawberry ice cream');
  // the first admin's app or browser still decides the household language (instance-lang.ts)
  expect(dbm.getSetting<string | null>('language', null)).toBeNull();
}, 60_000);
