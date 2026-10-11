/**
 * Brand precedence: BRAND in the environment is the default, an explicit admin choice in Settings wins,
 * the old `brand` key (stored by onboarding without a choice) is ignored.
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

describe('brand precedence', () => {
  it('BRAND is the default; the old accidental `brand` key is ignored', async () => {
    dbm.setSetting('brand', 'tohuus'); // what onboarding used to store silently
    expect(dbm.defaultBrand()).toBe('fredirando');
    expect(dbm.brand()).toBe('fredirando');
    const s = (await call('GET', '/settings')).json;
    expect(s).toMatchObject({ brand: 'fredirando', brandDefault: 'fredirando' });
  });

  it('an explicit choice in Settings wins over BRAND; choosing the default removes it', async () => {
    expect((await call('PATCH', '/settings', { brand: 'tohuus' })).status).toBe(200);
    expect(choice()).toBe('tohuus');
    expect(dbm.brand()).toBe('tohuus');
    expect((await call('GET', '/settings')).json.brand).toBe('tohuus');
    await call('PATCH', '/settings', { brand: 'fredirando' });
    expect(choice()).toBeNull();
    expect(dbm.brand()).toBe('fredirando');
  });

  it('onboarding stores a look only when it was changed from the one shown', async () => {
    await call('PUT', '/onboarding/home', { household: 'Rotdornweg', brand: 'fredirando' });
    expect(choice()).toBeNull();
    expect(dbm.brand()).toBe('fredirando');
    await call('PUT', '/onboarding/home', { brand: 'tohuus' });
    expect(choice()).toBe('tohuus');
    expect(dbm.brand()).toBe('tohuus');
    // sending the look that is shown now (tohuus) keeps the choice
    await call('PUT', '/onboarding/home', { brand: 'tohuus' });
    expect(choice()).toBe('tohuus');
    dbm.chooseBrand('fredirando');
    expect(choice()).toBeNull();
  });
});
