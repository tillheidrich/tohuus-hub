import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-data-test-'));
process.env.DATA_DIR = dir;

let dbm: typeof import('../server/db');
let auth: typeof import('../server/lib/auth');
let data: typeof import('../server/lib/data');
let backup: typeof import('../server/lib/backup');

beforeAll(async () => {
  dbm = await import('../server/db');
  auth = await import('../server/lib/auth');
  data = await import('../server/lib/data');
  backup = await import('../server/lib/backup');
  const { db } = dbm;
  db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234'));
  db.prepare(`INSERT INTO locations (name) VALUES ('Flurschrank')`).run();
  db.prepare(`INSERT INTO products (name) VALUES ('Milch')`).run();
  db.prepare(`INSERT INTO meal_plan (day, title) VALUES ('2026-10-10', 'Pasta')`).run();
  dbm.setSetting('ha', { url: 'https://ha.example', token: 'HA-SECRET-TOKEN', cookidooCalendar: 'calendar.x' });
  dbm.setSetting('notify', { ntfyUrl: 'https://ntfy.sh/NTFY-SECRET', haWebhookUrl: 'https://ha/api/webhook/HOOK-SECRET', digestHour: 7 });
  dbm.setSetting('backup.webdav', { url: 'https://dav.example', user: 'till', password: 'DAV-SECRET' });
  dbm.setSetting('household.name', 'Testhaus');
  auth.createApiToken('Claude', 'mcp');
  auth.createSession(1);
});

describe('export', () => {
  it('contains every household table but no credentials', () => {
    const out = data.buildExport() as any;
    const json = JSON.stringify(out);
    for (const secret of ['HA-SECRET-TOKEN', 'NTFY-SECRET', 'HOOK-SECRET', 'DAV-SECRET', 'scrypt$']) expect(json).not.toContain(secret);
    expect(out.format).toBe('tohuus-export');
    expect(out.version).toBeGreaterThanOrEqual(2);
    expect(out.schema.named).toContain('data-1');
    for (const t of ['meal_plan', 'movements', 'orders', 'order_lines', 'imports', 'import_lines', 'users', 'recipes', 'cook_log', 'products', 'settings', 'guest_links'])
      expect(out.tables).toHaveProperty(t);
    for (const t of ['sessions', 'api_tokens', 'invites', '_migrations']) expect(out.tables).not.toHaveProperty(t);
    expect(out.tables.users[0]).not.toHaveProperty('password_hash');
    expect(out.tables.users[0].name).toBe('Till');
    const ha = JSON.parse(out.tables.settings.find((s: any) => s.key === 'ha').value);
    expect(ha).toEqual({ url: 'https://ha.example', cookidooCalendar: 'calendar.x' });
    expect(out.tables.settings.find((s: any) => s.key === 'backup.webdav')?.value ?? '').not.toContain('DAV');
  });

  it('can be rebuilt into a full database that keeps secrets and passwords', async () => {
    const out = data.buildExport();
    const work = path.join(dir, 'rebuild.db');
    await backup.buildFromExport(out, work);
    const w = new Database(work, { readonly: true });
    expect((w.prepare('SELECT title FROM meal_plan').get() as any).title).toBe('Pasta');
    expect((w.prepare(`SELECT password_hash FROM users WHERE name = 'Till'`).get() as any).password_hash).toMatch(/^scrypt\$/);
    expect(JSON.parse((w.prepare(`SELECT value FROM settings WHERE key = 'ha'`).get() as any).value).token).toBe('HA-SECRET-TOKEN');
    expect((w.prepare('SELECT COUNT(*) n FROM api_tokens').get() as any).n).toBe(1);
    w.close();
  });

  it('rejects files that are not exports', () => {
    expect(() => backup.exportTablesOf({ hello: 'world' })).toThrow();
  });
});

describe('guest link tokens', () => {
  it('hashes plain tokens in place and still finds the link by the presented token', () => {
    const { db } = dbm;
    db.prepare(`INSERT INTO guest_links (token, name) VALUES ('oldPlainToken123', 'Grillabend')`).run();
    expect(data.normalizeGuestTokens()).toBe(1);
    const stored = (db.prepare(`SELECT token FROM guest_links WHERE name = 'Grillabend'`).get() as any).token;
    expect(stored).toBe(auth.sha256('oldPlainToken123'));
    expect(auth.guestFromToken('oldPlainToken123')?.name).toBe('Grillabend');
    // knowing the stored hash is useless
    expect(auth.guestFromToken(stored)).toBeNull();
    // idempotent
    expect(data.normalizeGuestTokens()).toBe(0);
    expect(auth.guestFromToken('oldPlainToken123')?.name).toBe('Grillabend');
  });

  it('rotating gives a new working token and kills the old one', () => {
    const id = (dbm.db.prepare(`SELECT id FROM guest_links WHERE name = 'Grillabend'`).get() as any).id;
    const fresh = data.rotateGuestLink(id)!;
    expect(fresh).toBeTruthy();
    expect(auth.guestFromToken(fresh)?.name).toBe('Grillabend');
    expect(auth.guestFromToken('oldPlainToken123')).toBeNull();
  });
});

describe('invites', () => {
  const msgs = { invalid: 'invalid', taken: 'taken' };
  it('work exactly once', () => {
    const inv = data.createInvite({ name: 'Lea', role: 'member' });
    expect(data.findInvite(inv.token)?.name).toBe('Lea');
    const u = data.acceptInvite(inv.token, { password: 'leapass123' }, msgs);
    expect(u.name).toBe('Lea');
    expect(() => data.acceptInvite(inv.token, { password: 'leapass123' }, msgs)).toThrow('invalid');
    expect(data.pendingInvites()).toHaveLength(0);
  });
  it('refuse names that are taken', () => {
    const inv = data.createInvite({ name: 'Till', role: 'member' });
    expect(() => data.acceptInvite(inv.token, { password: 'whatever123' }, msgs)).toThrow('taken');
    expect(data.acceptInvite(inv.token, { name: 'Till 2', password: 'whatever123' }, msgs).name).toBe('Till 2');
  });
});

describe('backup rotation', () => {
  const day = (i: number) => new Date(Date.UTC(2026, 9, 10) - i * 86400000).toISOString().slice(0, 10);
  it('keeps 14 daily and 8 weekly nightly snapshots', () => {
    const items = Array.from({ length: 120 }, (_, i) => ({ name: `n${i}`, kind: 'nightly' as const, day: day(i) }));
    const del = new Set(backup.planRotation(items));
    const kept = items.filter((i) => !del.has(i.name));
    expect(kept).toHaveLength(22);
    expect(kept.slice(0, 14).map((k) => k.day)).toEqual(items.slice(0, 14).map((k) => k.day));
    const weeks = new Set(kept.slice(14).map((k) => backup.isoWeek(k.day)));
    expect(weeks.size).toBe(8);
  });
  it('keeps the newest per day and limits manual snapshots', () => {
    const items = [
      { name: 'b', kind: 'nightly' as const, day: '2026-10-10' },
      { name: 'a', kind: 'nightly' as const, day: '2026-10-10' },
      ...Array.from({ length: 12 }, (_, i) => ({ name: `m${i}`, kind: 'manual' as const, day: '2026-10-09' })),
    ];
    const del = backup.planRotation(items);
    expect(del).toContain('a');
    expect(del).not.toContain('b');
    expect(del.filter((d) => d.startsWith('m'))).toEqual(['m10', 'm11']);
  });
  it('computes ISO weeks', () => {
    expect(backup.isoWeek('2026-01-01')).toBe('2026-W01');
    expect(backup.isoWeek('2027-01-01')).toBe('2026-W53');
    expect(backup.isoWeek('2026-10-10')).toBe('2026-W41');
  });
  it('takes a real snapshot that validates', async () => {
    const item = await backup.createBackup('manual');
    const f = backup.backupFile(item.name)!;
    expect(backup.validateDbFile(f).products).toBe(1);
    expect(backup.backupFile('../tohuus.db')).toBeNull();
  });
});

describe('webdav target', () => {
  it('requires https except for localhost', () => {
    expect(backup.checkWebdavUrl('https://cloud.example/remote.php/dav/files/x/Backups')).toBeNull();
    expect(backup.checkWebdavUrl('http://localhost:8080/dav')).toBeNull();
    expect(backup.checkWebdavUrl('http://192.168.1.10/dav')).toBeTruthy();
    expect(backup.checkWebdavUrl('ftp://x')).toBeTruthy();
  });
});
