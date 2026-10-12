/**
 * A tiny S3-compatible server for tests (no network): path-style PUT / GET / DELETE of objects and ListObjectsV2
 * (`?list-type=2&prefix=…`, pages of `pageSize` keys with continuation tokens). Every request is recorded; each
 * one must carry an AWS SigV4 Authorization header for the configured access key.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeS3 {
  url: string;
  bucket: string;
  objects: Map<string, Buffer>;
  calls: { method: string; key: string; query: string; signed: boolean }[];
  /** keys (without bucket) whose PUT answers 500 */
  failPut: Set<string>;
  config(prefix?: string): { endpoint: string; bucket: string; region: string; accessKey: string; secretKey: string; prefix: string };
  close(): Promise<void>;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function startFakeS3(opts: { bucket?: string; accessKey?: string; pageSize?: number } = {}): Promise<FakeS3> {
  const bucket = opts.bucket ?? 'test-bucket';
  const accessKey = opts.accessKey ?? 'AKTEST';
  const pageSize = opts.pageSize ?? 1000;
  const objects = new Map<string, Buffer>();
  const calls: FakeS3['calls'] = [];
  const failPut = new Set<string>();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const parts = u.pathname.split('/').slice(1);
    const b = decodeURIComponent(parts[0] ?? '');
    const key = parts.slice(1).map(decodeURIComponent).join('/');
    const signed = new RegExp(`^AWS4-HMAC-SHA256 Credential=${accessKey}/\\d{8}/[^/]+/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$`).test(String(req.headers.authorization ?? ''));
    calls.push({ method: req.method ?? '', key, query: u.search, signed });
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (b !== bucket || !signed) {
        res.statusCode = 403;
        return void res.end('<Error><Code>AccessDenied</Code></Error>');
      }
      if (req.method === 'PUT') {
        if (failPut.has(key)) {
          res.statusCode = 500;
          return void res.end();
        }
        objects.set(key, Buffer.concat(chunks));
        return void res.end();
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        res.statusCode = 204;
        return void res.end();
      }
      if (req.method === 'GET' && !key && u.searchParams.get('list-type') === '2') {
        const prefix = u.searchParams.get('prefix') ?? '';
        const after = u.searchParams.get('continuation-token') ?? '';
        const all = [...objects.keys()].filter((k) => k.startsWith(prefix) && k > after).sort();
        const page = all.slice(0, pageSize);
        const truncated = all.length > page.length;
        res.setHeader('Content-Type', 'application/xml');
        return void res.end(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><Prefix>${esc(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><IsTruncated>${truncated}</IsTruncated>${page
            .map((k) => `<Contents><Key>${esc(k)}</Key><Size>${objects.get(k)!.length}</Size></Contents>`)
            .join('')}${truncated ? `<NextContinuationToken>${esc(page[page.length - 1])}</NextContinuationToken>` : ''}</ListBucketResult>`,
        );
      }
      if (req.method === 'GET') {
        const o = objects.get(key);
        if (!o) {
          res.statusCode = 404;
          return void res.end('<Error><Code>NoSuchKey</Code></Error>');
        }
        return void res.end(o);
      }
      res.statusCode = 405;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    bucket,
    objects,
    calls,
    failPut,
    config: (prefix = 'tohuus') => ({ endpoint: url, bucket, region: 'eu-central', accessKey, secretKey: 'secret', prefix }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
