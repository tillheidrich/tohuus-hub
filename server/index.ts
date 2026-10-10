import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { config } from './config.js';
import { brand, lang } from './db.js';
import { t } from './i18n.js';
import { startScheduler } from './lib/scheduler.js';
import { handleMcp } from './mcp/server.js';
import { r as core } from './routes/core.js';
import { guest, guestAdmin } from './routes/guest.js';
import { r as ha } from './routes/ha.js';
import { r as imports } from './routes/imports.js';
import { r as recipes } from './routes/recipes.js';
import { ensureBaseData, seedDemo } from './seed.js';

ensureBaseData();
if (config.seedDemo) seedDemo();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
  next();
});

// CSRF: cookie-authenticated writes must come from our own origin (sibling subdomains share SameSite=Lax)
const ownOrigin = new URL(config.baseUrl).origin;
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/guest/') || req.headers.authorization || req.headers['x-api-key']) return next();
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  if (origin === ownOrigin || site === 'same-origin' || (!origin && !site)) return next();
  res.status(403).json({ error: 'Fremde Herkunft' });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// MCP (Claude, ChatGPT, …) — stateless Streamable HTTP
app.all('/mcp', handleMcp);
app.all('/mcp/:secret', handleMcp);

app.use('/img', express.static(path.join(config.dataDir, 'images'), { maxAge: '30d', immutable: true, fallthrough: false }));

app.use('/api/guest', guest);
app.use('/api', core);
app.use('/api', imports);
app.use('/api', recipes);
app.use('/api', ha);
app.use('/api', guestAdmin);
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = [path.join(here, 'web'), path.join(here, '../dist/web')].find((d) => fs.existsSync(path.join(d, 'index.html')));
if (webDir) {
  // brand-dependent app icons / manifest / title (Stockwerk or the Fredirando house theme)
  const BRAND_FILES: Record<string, string> = {
    '/icon.svg': 'fredirando.svg',
    '/apple-touch-icon.png': 'fredirando-touch.png',
    '/icon-192.png': 'fredirando-192.png',
    '/icon-512.png': 'fredirando-512.png',
  };
  app.get(Object.keys(BRAND_FILES), (req, res, next) => {
    if (brand() !== 'fredirando') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDir, BRAND_FILES[req.path]));
  });
  app.get('/manifest.webmanifest', (_req, res, next) => {
    if (brand() !== 'fredirando') return next();
    const m = JSON.parse(fs.readFileSync(path.join(webDir, 'manifest.webmanifest'), 'utf8'));
    Object.assign(m, { name: 'Fredirando', short_name: 'Fredirando', description: t('Ordered. Delivered. From kitchen & cellar.'), background_color: '#fff8f3', theme_color: '#f2601d' });
    res.type('application/manifest+json').setHeader('Cache-Control', 'no-cache').send(JSON.stringify(m));
  });
  app.use(express.static(webDir, { index: false, maxAge: '1h', setHeaders: (res, p) => {
    if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  const fredi = html
    .replace(/<title>.*<\/title>/, '<title>Fredirando</title>')
    .replace(/content="Stockwerk"/g, 'content="Fredirando"')
    .replace(/content="#f3f2ee"/g, 'content="#fff8f3"')
    .replace(/<html lang="[^"]*"/, '<html lang="de" data-brand="fredirando"');
  // the document language follows the household setting
  const withLang = (doc: string) => doc.replace(/<html lang="[^"]*"/, `<html lang="${lang()}"`);
  app.get(/.*/, (_req, res) => res.type('html').setHeader('Cache-Control', 'no-cache').send(withLang(brand() === 'fredirando' ? fredi : html)));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: t('Invalid input'), issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return;
  }
  if (err instanceof MulterError) {
    res.status(413).json({ error: t('File too large (max. 15 MB)') });
    return;
  }
  const msg = (err as Error)?.message ?? t('Error');
  console.error('[error]', msg);
  res.status(500).json({ error: msg });
});

app.listen(config.port, () => {
  console.log(`Stockwerk running on :${config.port} (${config.baseUrl})`);
  startScheduler();
});
