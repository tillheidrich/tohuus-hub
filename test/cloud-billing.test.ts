/**
 * Apple billing in ToHuus Cloud: signed transactions and App Store Server Notifications v2, verified against a
 * locally generated certificate chain (root → "WWDR" intermediate → signing leaf, with Apple's marker
 * extensions). The trusted root is injected for the test; production trusts only the embedded Apple Root CA G3.
 * Needs the openssl CLI (skipped without it).
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CompactSign } from 'jose';
import { Agent, fetch } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const hasOpenssl = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-billing-'));
const certs = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-certs-'));
const PORT = 48000 + Math.floor(Math.random() * 90);
const base = `http://localhost:${PORT}`;
Object.assign(process.env, {
  MULTI_TENANT: 'true',
  TOHUUS_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
  DATA_DIR: dir,
  PORT: String(PORT),
  BASE_URL: base,
  LANGUAGE: 'en',
  // TestFlight purchases (Sandbox) only count for tester accounts
  APPLE_SANDBOX_ACCOUNTS: 'buyer@example.org,other@example.org',
});
const local = new Agent();
const BUNDLE = 'de.heidrichdigital.tohuus';

function ossl(...args: string[]) {
  execFileSync('openssl', args, { cwd: certs, stdio: 'pipe' });
}
function makeChain(name: string, opts: { leafOid?: boolean } = {}) {
  const ext = (file: string, body: string) => fs.writeFileSync(path.join(certs, file), body);
  ossl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${name}-root.key`);
  ossl('req', '-x509', '-new', '-key', `${name}-root.key`, '-subj', `/CN=${name} Root`, '-days', '3650', '-out', `${name}-root.pem`, '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  ossl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${name}-int.key`);
  ossl('req', '-new', '-key', `${name}-int.key`, '-subj', `/CN=${name} WWDR`, '-out', `${name}-int.csr`);
  ext(`${name}-int.ext`, 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n1.2.840.113635.100.6.2.1=ASN1:NULL\n');
  ossl('x509', '-req', '-in', `${name}-int.csr`, '-CA', `${name}-root.pem`, '-CAkey', `${name}-root.key`, '-CAcreateserial', '-days', '3650', '-out', `${name}-int.pem`, '-extfile', `${name}-int.ext`);
  ossl('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', `${name}-leaf.key`);
  ossl('req', '-new', '-key', `${name}-leaf.key`, '-subj', `/CN=${name} StoreKit`, '-out', `${name}-leaf.csr`);
  ext(`${name}-leaf.ext`, `basicConstraints=CA:FALSE\n${opts.leafOid === false ? '' : '1.2.840.113635.100.6.11.1=ASN1:NULL\n'}`);
  ossl('x509', '-req', '-in', `${name}-leaf.csr`, '-CA', `${name}-int.pem`, '-CAkey', `${name}-int.key`, '-CAcreateserial', '-days', '3650', '-out', `${name}-leaf.pem`, '-extfile', `${name}-leaf.ext`);
  const der = (f: string) => new crypto.X509Certificate(fs.readFileSync(path.join(certs, f))).raw.toString('base64');
  return {
    rootPem: fs.readFileSync(path.join(certs, `${name}-root.pem`), 'utf8'),
    x5c: [der(`${name}-leaf.pem`), der(`${name}-int.pem`), der(`${name}-root.pem`)],
    key: crypto.createPrivateKey(fs.readFileSync(path.join(certs, `${name}-leaf.key`))),
  };
}

let good: ReturnType<typeof makeChain>;
let rogue: ReturnType<typeof makeChain>;
let noOid: ReturnType<typeof makeChain>;
const sign = (chain: ReturnType<typeof makeChain>, payload: unknown) =>
  new CompactSign(Buffer.from(JSON.stringify(payload))).setProtectedHeader({ alg: 'ES256', x5c: chain.x5c }).sign(chain.key);

let cookie = '';
let household = '';
let otherHousehold = '';
let server: { close: () => void } | null = null;

async function call(method: string, p: string, body?: unknown, withCookie = true) {
  const res = await fetch(base + p, {
    method,
    dispatcher: local,
    headers: { 'content-type': 'application/json', origin: base, ...(withCookie && cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie().find((c) => c.startsWith('sw_session='));
  if (set && withCookie) cookie = set.split(';')[0];
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* none */
  }
  return { status: res.status, json, text };
}

const tx = (over: Record<string, unknown> = {}) => ({
  transactionId: `t-${crypto.randomUUID()}`,
  originalTransactionId: 'orig-1',
  bundleId: BUNDLE,
  productId: 'de.heidrichdigital.tohuus.plus.monthly',
  purchaseDate: Date.now(),
  expiresDate: Date.now() + 30 * 86400_000,
  appAccountToken: household,
  environment: 'Sandbox',
  type: 'Auto-Renewable Subscription',
  ...over,
});

beforeAll(async () => {
  if (!hasOpenssl) return;
  good = makeChain('good');
  rogue = makeChain('rogue');
  noOid = makeChain('nooid', { leafOid: false });
  const mod = await import('../server/index');
  server = mod.server;
  const apple = await import('../server/lib/apple');
  apple.setAppleRootsForTests([good.rootPem, noOid.rootPem]);
  await new Promise((r) => setTimeout(r, 150));
  const other = await call('POST', '/api/cloud/signup', { email: 'other@example.org', password: 'geheim1234', name: 'O', householdName: 'Other' }, false);
  otherHousehold = other.json.household.id;
  const s = await call('POST', '/api/cloud/signup', { email: 'buyer@example.org', password: 'geheim1234', name: 'Buyer', householdName: 'Buyers' });
  household = s.json.household.id;
}, 60_000);

afterAll(() => server?.close());

describe.skipIf(!hasOpenssl)('Apple billing', () => {
  it('starts in the 14-day trial (Plus)', async () => {
    const s = await call('GET', '/api/billing/status');
    expect(s.json).toMatchObject({ plan: 'trial', source: 'none', limits: { historyDays: null, assistantPerMonth: 1500 } });
    expect(s.json.trialEndsAt).toBeTruthy();
    expect(s.json.products.map((p: any) => p.id)).toContain('de.heidrichdigital.tohuus.haushalt.yearly');
  });

  it('accepts a verified transaction for this household', async () => {
    const r = await call('POST', '/api/billing/apple/transaction', { signedTransaction: await sign(good, tx()) });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ plan: 'plus', source: 'apple' });
    expect(r.json.renewsAt).toBeTruthy();
  });

  it('refuses foreign roots, missing Apple markers, tampering, other apps, other households and unknown products', async () => {
    const bad = async (signed: string) => (await call('POST', '/api/billing/apple/transaction', { signedTransaction: signed })).status;
    expect(await bad(await sign(rogue, tx()))).toBe(400);
    expect(await bad(await sign(noOid, tx()))).toBe(400);
    const ok = await sign(good, tx());
    const [h, , s] = ok.split('.');
    const forged = Buffer.from(JSON.stringify(tx({ productId: 'de.heidrichdigital.tohuus.plus.yearly', expiresDate: Date.now() + 3650 * 86400_000 }))).toString('base64url');
    expect(await bad(`${h}.${forged}.${s}`)).toBe(400);
    expect(await bad(await sign(good, tx({ bundleId: 'com.example.other' })))).toBe(400);
    expect(await bad(await sign(good, tx({ appAccountToken: otherHousehold })))).toBe(400);
    expect(await bad(await sign(good, tx({ productId: 'de.heidrichdigital.tohuus.lifetime' })))).toBe(400);
    expect(await bad('not-a-jws')).toBe(400);
    // nothing of that changed the other household
    const acc = await import('../server/lib/accounts');
    expect(acc.getHousehold(otherHousehold)!.plan).toBe('trial');
  });

  it('Sandbox only for tester accounts; an older transaction never shortens a later expiry', async () => {
    const real = process.env.APPLE_SANDBOX_ACCOUNTS;
    process.env.APPLE_SANDBOX_ACCOUNTS = 'someone-else@example.org';
    try {
      expect((await call('POST', '/api/billing/apple/transaction', { signedTransaction: await sign(good, tx()) })).status).toBe(400);
      expect((await call('POST', '/api/billing/apple/transaction', { signedTransaction: await sign(good, tx({ environment: 'Production' })) })).status).toBe(200);
    } finally {
      process.env.APPLE_SANDBOX_ACCOUNTS = real;
    }
    const acc = await import('../server/lib/accounts');
    const far = Date.now() + 300 * 86400_000;
    await call('POST', '/api/billing/apple/transaction', { signedTransaction: await sign(good, tx({ expiresDate: far, productId: 'de.heidrichdigital.tohuus.plus.yearly' })) });
    const until = acc.getHousehold(household)!.plan_expires_at;
    // a late monthly transaction of another subscription (other original id) must not shorten it
    await call('POST', '/api/billing/apple/transaction', { signedTransaction: await sign(good, tx({ originalTransactionId: 'orig-old', expiresDate: Date.now() + 5 * 86400_000 })) });
    expect(acc.getHousehold(household)!.plan_expires_at).toBe(until);
  });

  it('App Store Server Notifications v2: renew, idempotent, expire, refund', async () => {
    const note = async (type: string, t: Record<string, unknown>, subtype?: string, uuid = crypto.randomUUID()) =>
      call(
        'POST',
        '/api/billing/apple/notifications',
        {
          signedPayload: await sign(good, {
            notificationType: type,
            subtype,
            notificationUUID: uuid,
            data: { bundleId: BUNDLE, environment: 'Sandbox', signedTransactionInfo: await sign(good, tx(t)) },
          }),
        },
        false,
      );
    const acc = await import('../server/lib/accounts');
    const renewUuid = crypto.randomUUID();
    const r1 = await note('DID_RENEW', { productId: 'de.heidrichdigital.tohuus.haushalt.yearly', expiresDate: Date.now() + 365 * 86400_000 }, undefined, renewUuid);
    expect(r1.status, r1.text).toBe(200);
    expect(acc.getHousehold(household)!.plan).toBe('haushalt');
    const dup = await note('DID_RENEW', {}, undefined, renewUuid);
    expect(dup.json.duplicate).toBe(true);
    expect((await note('EXPIRED', {}, 'VOLUNTARY')).status).toBe(200);
    expect((await call('GET', '/api/billing/status')).json.plan).toBe('free');
    await note('SUBSCRIBED', {}, 'RESUBSCRIBE');
    expect((await call('GET', '/api/billing/status')).json.plan).toBe('plus');
    await note('REFUND', {});
    expect((await call('GET', '/api/billing/status')).json.plan).toBe('free');
    // a notification signed by somebody else changes nothing
    const fake = await call(
      'POST',
      '/api/billing/apple/notifications',
      { signedPayload: await sign(rogue, { notificationType: 'SUBSCRIBED', notificationUUID: crypto.randomUUID(), data: { signedTransactionInfo: await sign(rogue, tx()) } }) },
      false,
    );
    expect(fake.status).toBe(400);
    expect((await call('GET', '/api/billing/status')).json.plan).toBe('free');
  });

  it('the real Apple Root CA G3 is embedded', async () => {
    const { APPLE_ROOT_CA_G3, APPLE_ROOT_CA_G3_SHA256 } = await import('../server/lib/apple-root');
    const c = new crypto.X509Certificate(APPLE_ROOT_CA_G3);
    expect(c.fingerprint256.replace(/:/g, '')).toBe(APPLE_ROOT_CA_G3_SHA256);
    expect(c.subject).toContain('Apple Root CA - G3');
  });
});
