/**
 * One look since wave 6 (Dutch Detail): every household is ToHuus. BRAND in the environment, the old `brand` key
 * and an explicit `brand.choice` from older versions are all ignored; old clients sending a look get no error.
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-brand-'));
process.env.LANGUAGE = 'en';
process.env.BRAND = 'fredirando';

let dbm: typeof import('../server/db');
let base = '';
let token = '';
let close: () => void = () => {};

beforeAll(async () => {
  dbm = await import('../server/db');
  (await import('../server/seed')).ensureBaseData();
  const auth = await import('../server/lib/auth');
  token = auth.createApiToken('Full', 'full').token; // full tokens act as admin
  const express = (await import('express')).default;
  const core = await import('../server/routes/core');
  const onboard = await import('../server/routes/onboard');
  const app = express();
  app.use(express.json());
  app.use('/api', core.r);
  app.use('/api', onboard.r);
  await new Promise<void>((resolve) => {
    const srv = app.listen(0, () => {
      base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      close = () => srv.close();
      resolve();
    });
  });
});
afterAll(() => {
  close();
  delete process.env.BRAND;
});

const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(base + '/api' + p, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json()) as any };
};
const choice = () => dbm.getSetting<string | null>('brand.choice', null);

describe('one brand', () => {
  it('BRAND=fredirando and old settings keys no longer change the look', async () => {
    dbm.setSetting('brand', 'fredirando');
    dbm.setSetting('brand.choice', 'fredirando');
    expect(dbm.defaultBrand()).toBe('tohuus');
    expect(dbm.brand()).toBe('tohuus');
    const s = (await call('GET', '/settings')).json;
    expect(s).toMatchObject({ brand: 'tohuus', brandDefault: 'tohuus' });
  });

  it('an old client choosing a look in Settings is accepted and ignored (stored override removed)', async () => {
    expect((await call('PATCH', '/settings', { brand: 'fredirando' })).status).toBe(200);
    expect(choice()).toBeNull();
    expect(dbm.brand()).toBe('tohuus');
    expect((await call('GET', '/settings')).json.brand).toBe('tohuus');
  });

  it('onboarding with a look still works and keeps ToHuus', async () => {
    expect((await call('PUT', '/onboarding/home', { household: 'Rotdornweg', brand: 'fredirando' })).status).toBe(200);
    expect(dbm.brand()).toBe('tohuus');
    expect(choice()).toBeNull();
  });
});
