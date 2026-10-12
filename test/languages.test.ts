import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported.
// LANGUAGE=sv: an install that was started in Swedish before Swedish was removed as a UI language.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-languages-'));
process.env.LANGUAGE = 'sv';

import { LANGUAGES, LANG_CODES, commaDecimal, isLang, localeOf, toLang } from '../server/languages';

describe('language list', () => {
  it('lists en and de with native names and locales', () => {
    expect(LANG_CODES).toEqual(['en', 'de']);
    expect(LANGUAGES.map((l) => l.name)).toEqual(['English', 'Deutsch']);
    expect(localeOf('de')).toBe('de-DE');
    expect(localeOf('sv')).toBe('en-GB');
  });
  it('maps browser languages and junk to a supported language', () => {
    expect(toLang('sv-FI')).toBe('en');
    expect(toLang('de_AT')).toBe('de');
    expect(toLang('fr-FR')).toBe('en');
    expect(toLang(undefined)).toBe('en');
    expect(isLang('sv')).toBe(false);
    expect(isLang('de')).toBe(true);
    expect(isLang('DE')).toBe(false);
    expect(commaDecimal('de')).toBe(true);
    expect(commaDecimal('en')).toBe(false);
  });
});

describe('Swedish removed as UI language (migration lang-sv-removed-1)', () => {
  it('switches a Swedish household to English and gives base places and categories their English names back', async () => {
    const { db, getSetting, setSetting, lang } = await import('../server/db');
    // the state a Swedish household left behind – written before the places module (and its migration) loads
    setSetting('language', 'sv');
    const loc = db.prepare('INSERT INTO locations (name, kind) VALUES (?, ?)');
    loc.run('Kylskåp', 'fridge');
    loc.run('Källare', 'cellar');
    loc.run('Min egen hylla', 'other');
    const cat = db.prepare('INSERT INTO categories (name) VALUES (?)');
    cat.run('Glass');
    cat.run('Torrvaror');
    cat.run('Godis från farmor');
    expect(lang()).toBe('en');

    await import('../server/lib/places');

    expect(getSetting('language', null)).toBe('en');
    const locs = (db.prepare('SELECT name FROM locations ORDER BY id').all() as { name: string }[]).map((r) => r.name);
    expect(locs).toEqual(expect.arrayContaining(['Fridge', 'Cellar', 'Min egen hylla']));
    expect(locs).not.toContain('Kylskåp');
    const cats = (db.prepare('SELECT name FROM categories ORDER BY id').all() as { name: string }[]).map((r) => r.name);
    expect(cats).toEqual(expect.arrayContaining(['Ice cream', 'Pantry', 'Godis från farmor']));
    expect(cats).not.toContain('Glass');
  });

  it('serves English and the English demo household afterwards', async () => {
    const { db } = await import('../server/db');
    const { t, locale } = await import('../server/i18n');
    expect(locale()).toBe('en-GB');
    expect(t('Shopping list')).toBe('Shopping list');
    const seed = await import('../server/seed');
    db.exec('DELETE FROM locations; DELETE FROM categories;');
    seed.ensureBaseData();
    seed.seedDemo();
    const titles = (db.prepare('SELECT title FROM recipes').all() as { title: string }[]).map((r) => r.title);
    expect(titles).not.toContain('Pannkakor');
    expect(titles.length).toBeGreaterThan(0);
  });
});
