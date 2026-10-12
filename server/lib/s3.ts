/**
 * S3-compatible object storage for ToHuus Cloud backups (Hetzner Object Storage, MinIO …): config from
 * BACKUP_S3_*, AWS Signature V4 for path-style requests, and the few calls the backups need (PUT, GET, DELETE,
 * ListObjectsV2). Plain fetch, no SDK.
 *
 * Must not import db.ts / config.ts: the restore scripts (scripts/restore-*.ts) bundle this file on its own.
 *
 * The endpoint is configured by the operator and may well live in a private network (MinIO next to the app), so the
 * requests use their own dispatcher instead of the cloud's global private-address-blocking one (server/lib/net.ts).
 */
import crypto from 'node:crypto';
import { Agent, fetch } from 'undici';

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  prefix: string;
}

export function s3Config(env = process.env): S3Config | null {
  const endpoint = (env.BACKUP_S3_ENDPOINT ?? '').replace(/\/+$/, '');
  if (!endpoint || !env.BACKUP_S3_BUCKET || !env.BACKUP_S3_ACCESS_KEY || !env.BACKUP_S3_SECRET_KEY) return null;
  return {
    endpoint,
    bucket: env.BACKUP_S3_BUCKET,
    region: env.BACKUP_S3_REGION || 'us-east-1',
    accessKey: env.BACKUP_S3_ACCESS_KEY,
    secretKey: env.BACKUP_S3_SECRET_KEY,
    prefix: (env.BACKUP_S3_PREFIX ?? 'tohuus').replace(/^\/+|\/+$/g, ''),
  };
}

const hmac = (key: Buffer | string, s: string) => crypto.createHmac('sha256', key).update(s).digest();
const hex = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Signed request headers for a path-style S3 request (exported for tests). */
export function signS3(c: S3Config, method: string, key: string, body: Buffer, now = new Date(), query: Record<string, string> = {}) {
  const url = new URL(key ? `${c.endpoint}/${c.bucket}/${key.split('/').map(enc).join('/')}` : `${c.endpoint}/${c.bucket}`);
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(query[k])}`)
    .join('&');
  url.search = canonicalQuery;
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = hex(body);
  const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonical = [method, url.pathname, canonicalQuery, ...Object.keys(headers).sort().map((h) => `${h}:${headers[h]}`), '', signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${c.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hex(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${c.secretKey}`, dateStamp), c.region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
  return {
    url: url.toString(),
    headers: { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
  };
}

// operator-configured endpoint: allowed to be private (MinIO in the same network), unlike household requests
const s3Agent = new Agent({ connections: 8 });

async function s3Request(c: S3Config, method: 'GET' | 'PUT' | 'DELETE', key: string, opts: { body?: Buffer; query?: Record<string, string>; timeoutMs?: number } = {}) {
  const body = opts.body ?? Buffer.alloc(0);
  const { url, headers } = signS3(c, method, key, body, new Date(), opts.query);
  return fetch(url, {
    method,
    headers: method === 'PUT' ? { ...headers, 'Content-Type': 'application/octet-stream' } : headers,
    body: method === 'PUT' ? body : undefined,
    dispatcher: s3Agent,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
}

/** PUT one object (key without the prefix – it is added here). */
export async function putObject(c: S3Config, key: string, body: Buffer, timeoutMs = 10 * 60_000): Promise<void> {
  const r = await s3Request(c, 'PUT', `${c.prefix}/${key}`, { body, timeoutMs });
  await r.body?.cancel();
  if (!r.ok) throw new Error(`S3 upload failed with status ${r.status}`);
}

/** GET one object by its full key (prefix included, as listed). */
export async function getObject(c: S3Config, fullKey: string): Promise<Buffer> {
  const r = await s3Request(c, 'GET', fullKey, { timeoutMs: 5 * 60_000 });
  if (!r.ok) {
    await r.body?.cancel();
    throw new Error(`S3 download failed with status ${r.status}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

/** DELETE one object by its full key; a missing object counts as deleted. */
export async function deleteObject(c: S3Config, fullKey: string): Promise<boolean> {
  const r = await s3Request(c, 'DELETE', fullKey);
  await r.body?.cancel();
  return r.ok || r.status === 404;
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** ListObjectsV2 under a full prefix, page by page (up to `maxPages` × 1000 keys). */
export async function* listObjects(c: S3Config, fullPrefix: string, maxPages = 1000): AsyncGenerator<{ key: string; size: number }> {
  let token: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const query: Record<string, string> = { 'list-type': '2', prefix: fullPrefix };
    if (token) query['continuation-token'] = token;
    const r = await s3Request(c, 'GET', '', { query });
    const xml = await r.text();
    if (!r.ok) throw new Error(`S3 list failed with status ${r.status}`);
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = m[1].match(/<Key>([^<]+)<\/Key>/)?.[1];
      if (key) yield { key: unxml(key), size: Number(m[1].match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0) };
    }
    token = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    if (!token || !/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    token = unxml(token);
  }
}
