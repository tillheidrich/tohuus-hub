/**
 * Compression without a dependency (self-hosters often run without a compressing reverse proxy):
 *  - web files: pre-compressed `.br` / `.gz` written at build time (scripts/precompress.mjs) are sent when the
 *    browser accepts them; ETag and Cache-Control as for the plain file.
 *  - API: JSON and text answers above 1 kB are gzipped on the fly (zlib); Express' ETag stays (computed on the body
 *    that is sent, with `Vary: Accept-Encoding`).
 */
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MIN = 1024;

/** Serve `<file>.br` / `<file>.gz` from `root` when present and accepted; otherwise fall through to express.static. */
export function precompressedStatic(root: string, cacheControl: (file: string) => string | null) {
  const available = new Set<string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.br') || p.endsWith('.gz')) available.add(p);
    }
  };
  try {
    walk(root);
  } catch {
    /* no build */
  }
  return (req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !available.size) return next();
    let rel: string;
    try {
      rel = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) return next();
    const accept = String(req.headers['accept-encoding'] ?? '');
    const enc = /\bbr\b/.test(accept) && available.has(file + '.br') ? 'br' : /\bgzip\b/.test(accept) && available.has(file + '.gz') ? 'gzip' : null;
    if (!enc) {
      if (available.has(file + '.br') || available.has(file + '.gz')) res.setHeader('Vary', 'Accept-Encoding');
      return next();
    }
    const comp = file + (enc === 'br' ? '.br' : '.gz');
    let st: fs.Stats;
    try {
      st = fs.statSync(comp);
    } catch {
      return next();
    }
    const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${enc}"`;
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('ETag', etag);
    const cc = cacheControl(file);
    if (cc) res.setHeader('Cache-Control', cc);
    if (req.headers['if-none-match'] === etag) return void res.status(304).end();
    res.type(path.extname(file));
    res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', String(st.size));
    if (req.method === 'HEAD') return void res.end();
    fs.createReadStream(comp).pipe(res);
  };
}

/** gzip JSON/text API answers above 1 kB when the client accepts gzip. */
export function gzipApi(req: Request, res: Response, next: NextFunction) {
  if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) return next();
  const send = res.send.bind(res);
  res.send = (body?: unknown) => {
    try {
      const type = String(res.getHeader('Content-Type') ?? '');
      const isText = /json|text\/|javascript|xml|csv/.test(type) && !/event-stream/.test(type);
      if (isText && !res.getHeader('Content-Encoding') && (typeof body === 'string' || Buffer.isBuffer(body))) {
        const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
        if (buf.length > MIN) {
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Vary', 'Accept-Encoding');
          // compressed on the libuv thread pool – never blocks the request loop
          zlib.gzip(buf, { level: 6 }, (err, out) => {
            if (err) {
              res.removeHeader('Content-Encoding');
              return void send(buf);
            }
            send(out);
          });
          return res;
        }
      }
    } catch {
      /* send uncompressed */
    }
    return send(body as any);
  };
  next();
}
