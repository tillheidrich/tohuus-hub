/**
 * Security review 2026-10-12, smaller findings: interrupted self-host encryption never yields an empty database,
 * sharp refuses decompression bombs, the 500 handler hides internals in production, web-link limits.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-lows-'));

describe('interrupted self-host encryption', () => {
  it('restores the kept plain original when the database file is missing', async () => {
    const { recoverSelfhostDb } = await import('../server/db');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-recover-'));
    const file = path.join(dir, 'tohuus.db');
    const plain = new Database(`${file}.plain-backup-2026-10-12`);
    plain.exec(`CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('milk')`);
    plain.close();
    expect(recoverSelfhostDb(file, null)).toBe('tohuus.db.plain-backup-2026-10-12');
    const d = new Database(file);
    expect((d.prepare('SELECT x FROM t').get() as { x: string }).x).toBe('milk');
    d.close();
    // an existing database is never touched
    expect(recoverSelfhostDb(file, null)).toBeNull();
  });

  it('prefers a verified encrypted copy', async () => {
    const { recoverSelfhostDb, openDbFile } = await import('../server/db');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-recover2-'));
    const file = path.join(dir, 'tohuus.db');
    const key = crypto.randomBytes(32);
    const enc = openDbFile(`${file}.encrypting`, key);
    enc.exec(`CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('bread')`);
    enc.close();
    expect(recoverSelfhostDb(file, key)).toBe(`${file}.encrypting`);
    const d = openDbFile(file, key);
    expect((d.prepare('SELECT x FROM t').get() as { x: string }).x).toBe('bread');
    d.close();
  });

  it('nothing to recover: no file is created', async () => {
    const { recoverSelfhostDb } = await import('../server/db');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-recover3-'));
    expect(recoverSelfhostDb(path.join(dir, 'tohuus.db'), null)).toBeNull();
    expect(fs.existsSync(path.join(dir, 'tohuus.db'))).toBe(false);
  });
});

describe('sharp', () => {
  it('refuses images above 40 megapixels', async () => {
    const sharp = (await import('../server/lib/sharp-safe')).default;
    const big = await (await import('sharp')).default({ create: { width: 8000, height: 6000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
    await expect(sharp(big).resize(100).toBuffer()).rejects.toThrow(/pixel limit/i);
    const ok = await (await import('sharp')).default({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).png().toBuffer();
    expect((await sharp(ok).metadata()).width).toBe(100);
  }, 30_000);
});
