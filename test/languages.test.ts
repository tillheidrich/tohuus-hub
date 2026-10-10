import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-languages-'));
process.env.LANGUAGE = 'sv';

import { LANGUAGES, LANG_CODES, commaDecimal, isLang, localeOf, toLang } from '../server/languages';

describe('language list', () => {
  it('lists en, de and sv with native names and locales', () => {
    expect(LANG_CODES).toEqual(['en', 'de', 'sv']);
    expect(LANGUAGES.map((l) => l.name)).toEqual(['English', 'Deutsch', 'Svenska']);
    expect(localeOf('sv')).toBe('sv-SE');
  });
  it('maps browser languages and junk to a supported language', () => {
    expect(toLang('sv-FI')).toBe('sv');
    expect(toLang('de_AT')).toBe('de');
    expect(toLang('fr-FR')).toBe('en');
    expect(toLang(undefined)).toBe('en');
    expect(isLang('sv')).toBe(true);
    expect(isLang('SV')).toBe(false);
    expect(commaDecimal('sv')).toBe(true);
    expect(commaDecimal('en')).toBe(false);
  });
});

const placeholders = (s: string) => (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort().join(',');

describe('Swedish dictionaries', () => {
  it('keep every placeholder of the English key (web)', async () => {
    const { sv } = await import('../web/src/locales/sv/index');
    const bad = Object.entries(sv).filter(([k, v]) => placeholders(k) !== placeholders(v) || !v.trim());
    expect(bad).toEqual([]);
  });

  it('server t() answers in Swedish when the household language is sv', async () => {
    const { setSetting, lang } = await import('../server/db');
    const { t, locale } = await import('../server/i18n');
    setSetting('language', 'sv');
    expect(lang()).toBe('sv');
    expect(locale()).toBe('sv-SE');
    expect(t('Shopping list')).toBe('Inköpslista');
    expect(t('{name} is out', { name: 'Mjölk' })).toBe('Mjölk är slut');
    setSetting('language', 'xx');
    expect(lang()).toBe('en');
  });
});

describe('Swedish demo household', () => {
  beforeAll(async () => {
    const { setSetting } = await import('../server/db');
    setSetting('language', 'sv');
    const seed = await import('../server/seed');
    seed.ensureBaseData();
    seed.seedDemo();
  });
  it('names products, units and recipes in Swedish', async () => {
    const { db } = await import('../server/db');
    const names = (db.prepare('SELECT name FROM products').all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain('Krossade tomater');
    expect(names).toContain('Packtejp');
    const eggs = db.prepare("SELECT size, unit FROM products WHERE name = 'Ägg från frigående höns'").get() as { size: string; unit: string };
    expect(eggs).toEqual({ size: '10 st', unit: 'st' });
    const titles = (db.prepare('SELECT title FROM recipes').all() as { title: string }[]).map((r) => r.title);
    expect(titles).toContain('Pannkakor');
  });
});
