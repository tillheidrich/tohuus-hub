import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// isolated database for this test file – must be set before any server module is imported
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-design-'));
process.env.LANGUAGE = 'en';

let ap: typeof import('../server/lib/appearance');
let uid = 0;

beforeAll(async () => {
  const { db } = await import('../server/db');
  const { ensureBaseData } = await import('../server/seed');
  ensureBaseData();
  ap = await import('../server/lib/appearance');
  const info = db.prepare("INSERT INTO users (name, role, password_hash) VALUES ('Mila', 'member', 'x')").run();
  uid = Number(info.lastInsertRowid);
});

describe('appearance (light / dark / system)', () => {
  it('defaults to light for everyone without personal choice', () => {
    expect(ap.householdAppearance()).toEqual({ theme: 'light', userChoice: false });
    expect(ap.appearanceFor(uid).theme).toBe('light');
    expect(ap.appearanceFor(null).theme).toBe('light');
  });

  it('applies the household theme to everyone', () => {
    ap.setHouseholdAppearance({ theme: 'system' });
    expect(ap.appearanceFor(uid)).toMatchObject({ household: 'system', theme: 'system', mine: null });
  });

  it('ignores a personal choice until the admin allows it, and keeps it for later', () => {
    ap.setPersonalTheme(uid, 'dark');
    expect(ap.appearanceFor(uid).theme).toBe('system');
    ap.setHouseholdAppearance({ userChoice: true });
    expect(ap.appearanceFor(uid)).toMatchObject({ theme: 'dark', mine: 'dark', userChoice: true });
    ap.setHouseholdAppearance({ userChoice: false });
    expect(ap.appearanceFor(uid).theme).toBe('system');
    expect(ap.personalTheme(uid)).toBe('dark');
  });

  it('falls back to the household when the member resets their choice', () => {
    ap.setHouseholdAppearance({ userChoice: true, theme: 'light' });
    ap.setPersonalTheme(uid, null);
    expect(ap.appearanceFor(uid)).toMatchObject({ theme: 'light', mine: null });
  });

  it('rejects unknown values', () => {
    ap.setHouseholdAppearance({ theme: 'neon' as never });
    expect(ap.householdAppearance().theme).toBe('light');
  });
});
