/**
 * StoreKit 2 / App Store Server Notifications v2 – verified on our own server (no RevenueCat).
 *
 * A signed transaction (JWS, ES256) carries its certificate chain in the `x5c` header: leaf → Apple intermediate
 * → Apple Root CA G3. We check that the chain ends in the embedded Apple root (byte for byte), that every
 * certificate is valid and signed by the next one, that leaf and intermediate carry Apple's marker extensions,
 * and finally the JWS signature with the leaf key. Only then the payload is trusted.
 */
import crypto from 'node:crypto';
import { compactVerify, decodeProtectedHeader } from 'jose';
import { APPLE_ROOT_CA_G3 } from './apple-root.js';

export class AppleVerifyError extends Error {
  status = 400;
}

let roots: crypto.X509Certificate[] = [new crypto.X509Certificate(APPLE_ROOT_CA_G3)];
/** tests: trust a locally generated root instead of Apple's */
export function setAppleRootsForTests(pems: string[] | null) {
  roots = (pems ?? [APPLE_ROOT_CA_G3]).map((p) => new crypto.X509Certificate(p));
}

// DER of the OIDs Apple puts into its StoreKit certificates
const oidDer = (oid: string) => {
  const parts = oid.split('.').map(Number);
  const bytes = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const b: number[] = [];
    let v = p;
    do {
      b.unshift(v & 0x7f);
      v = Math.floor(v / 128);
    } while (v > 0);
    for (let i = 0; i < b.length - 1; i++) b[i] |= 0x80;
    bytes.push(...b);
  }
  return Buffer.from([0x06, bytes.length, ...bytes]);
};
/** leaf: Mac App Store receipt signing; intermediate: Apple Worldwide Developer Relations CA G6 marker */
export const LEAF_OID = '1.2.840.113635.100.6.11.1';
export const INTERMEDIATE_OID = '1.2.840.113635.100.6.2.1';
const hasOid = (c: crypto.X509Certificate, oid: string) => c.raw.includes(oidDer(oid));

function validAt(c: crypto.X509Certificate, at: Date) {
  return new Date(c.validFrom) <= at && at <= new Date(c.validTo);
}

/** Verify a StoreKit JWS and return its payload. `at` = the moment the chain must be valid (default: now). */
export async function verifyAppleJws<T = Record<string, unknown>>(jws: string, at = new Date()): Promise<T> {
  if (typeof jws !== 'string' || jws.length > 30_000 || jws.split('.').length !== 3) throw new AppleVerifyError('not a signed Apple payload');
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(jws);
  } catch {
    throw new AppleVerifyError('not a signed Apple payload');
  }
  if (header.alg !== 'ES256') throw new AppleVerifyError('unexpected signature algorithm');
  const x5c = header.x5c;
  if (!Array.isArray(x5c) || x5c.length < 2 || x5c.length > 4) throw new AppleVerifyError('certificate chain missing');
  let chain: crypto.X509Certificate[];
  try {
    chain = x5c.map((b) => new crypto.X509Certificate(Buffer.from(b, 'base64')));
  } catch {
    throw new AppleVerifyError('certificate chain unreadable');
  }
  const last = chain[chain.length - 1];
  // the last certificate must BE a trusted root, or be issued by one
  const anchor = roots.find((r) => r.raw.equals(last.raw)) ?? roots.find((r) => last.checkIssued(r) && last.verify(r.publicKey));
  if (!anchor) throw new AppleVerifyError('certificate chain does not end in the Apple root');
  const full = anchor.raw.equals(last.raw) ? chain : [...chain, anchor];
  for (let i = 0; i < full.length - 1; i++) {
    const c = full[i];
    const issuer = full[i + 1];
    if (!c.checkIssued(issuer) || !c.verify(issuer.publicKey)) throw new AppleVerifyError('certificate chain broken');
    if (i > 0 && !c.ca) throw new AppleVerifyError('intermediate is not a CA');
  }
  for (const c of full) if (!validAt(c, at)) throw new AppleVerifyError('certificate expired or not yet valid');
  if (!hasOid(full[0], LEAF_OID)) throw new AppleVerifyError('leaf certificate is not a StoreKit signing certificate');
  if (full.length > 2 && !hasOid(full[1], INTERMEDIATE_OID)) throw new AppleVerifyError('intermediate is not an Apple WWDR certificate');
  try {
    const { payload } = await compactVerify(jws, full[0].publicKey, { algorithms: ['ES256'] });
    return JSON.parse(Buffer.from(payload).toString('utf8')) as T;
  } catch {
    throw new AppleVerifyError('signature invalid');
  }
}

/** JWSTransactionDecodedPayload – the fields we use */
export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  appAccountToken?: string;
  environment?: string;
  type?: string;
  signedDate?: number;
}

/** responseBodyV2DecodedPayload */
export interface AppleNotification {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  signedDate?: number;
  data?: {
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
    status?: number;
  };
}

export interface AppleRenewal {
  originalTransactionId?: string;
  autoRenewProductId?: string;
  /** 1 = renews automatically, 0 = switched off by the customer */
  autoRenewStatus?: number;
  /** when the next renewal will be charged (ms) */
  renewalDate?: number;
  productId?: string;
  gracePeriodExpiresDate?: number;
  expirationIntent?: number;
}

export const appleBundleId = () => process.env.APPLE_BUNDLE_ID || 'de.heidrichdigital.tohuus';
/** StoreKit environments accepted for everyone (default: Production only). */
export const appleEnvironments = () => (process.env.APPLE_ENVIRONMENTS || 'Production').split(',').map((x) => x.trim()).filter(Boolean);
/** Accounts (e-mails) allowed to buy in the Sandbox (TestFlight testers): APPLE_SANDBOX_ACCOUNTS=a@x.de,b@y.de */
export const appleSandboxAccounts = () =>
  (process.env.APPLE_SANDBOX_ACCOUNTS ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
