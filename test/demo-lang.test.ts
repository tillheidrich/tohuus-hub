/** The demo household in German: a household that started in English and switched to German gets German demo data. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-demo-lang-'));
process.env.LANGUAGE = 'en';

it('German names for products, categories and places', async () => {
  const dbm = await import('../server/db');
  const routes = path.join(__dirname, '../server/routes');
  for (const f of fs.readdirSync(routes).filter((x) => x.endsWith('.ts'))) await import(path.join(routes, f));
  const seed = await import('../server/seed');
  seed.ensureBaseData({ places: true }); // created in English
  const names = (sql: string) => (dbm.db.prepare(sql).all() as { name: string }[]).map((r) => r.name);
  expect(names('SELECT name FROM categories')).toContain('Drinks');
  dbm.db.prepare(`UPDATE categories SET name = 'Unsere Snacks' WHERE name = 'Snacks & sweets'`).run(); // a name somebody chose
  dbm.setSetting('language', 'de');
  expect(seed.seedDemo({ force: true })).toBe(true);
  const cats = names('SELECT name FROM categories');
  expect(cats).toEqual(expect.arrayContaining(['Getränke', 'Kühlregal', 'Obst & Gemüse', 'Drogerie', 'Unsere Snacks']));
  expect(cats).not.toContain('Drinks');
  const places = names('SELECT name FROM locations');
  expect(places).toEqual(expect.arrayContaining(['Kühlschrank', 'Gefrierfach', 'Vorratsschrank']));
  expect(places).not.toContain('Fridge');
  expect(names('SELECT name FROM products')).toEqual(expect.arrayContaining(['Vanille-Eis', 'Paketband']));
  expect(names('SELECT title AS name FROM recipes').length).toBeGreaterThan(0);
}, 60_000);
