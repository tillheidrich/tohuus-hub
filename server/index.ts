// must run before anything opens the database: applies a staged restore
import './lib/restore-boot.js';
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
import { r as dataRoutes, pub as dataPublic } from './routes/data.js';
import { startBackups } from './lib/backup.js';
import { r as partyRoutes, board as partyBoard } from './routes/party.js';
import { r as freshRoutes } from './routes/fresh.js';
import { r as shopRoutes } from './routes/shop.js';
import { r as homeRoutes } from './routes/home.js';
import { r as kioskRoutes, pub as kioskPublic } from './routes/kiosk.js';
import { r as kidsRoutes, kid as kidDevice } from './routes/kids.js';
import { r as onboardRoutes } from './routes/onboard.js';
import { r as retailRoutes } from './routes/retail.js';
import { r as channelsRoutes, pub as channelsPublic } from './routes/channels.js';
import { r as intlRoutes } from './routes/intl.js';
import { r as cook2Routes } from './routes/cook2.js';
import { r as authRoutes, pub as authPublic } from './routes/auth.js';
import { r as spend2Routes } from './routes/spend2.js';
import { r as printRoutes } from './routes/print.js';
import { r as shareRoutes, pub as sharePublic } from './routes/share.js';
import { r as labelsRoutes } from './routes/labels.js';
import { r as awayRoutes } from './routes/away.js';
import { r as plan2Routes } from './routes/plan2.js';
import { r as recipes2Routes } from './routes/recipes2.js';
import { r as qualityRoutes } from './routes/quality.js';
import { r as peopleRoutes, pub as peoplePublic } from './routes/people.js';
import { r as tourRoutes } from './routes/tour.js';
import { r as ha2Routes, ha2Guest } from './routes/ha2.js';
import { r as menuRoutes } from './routes/menu.js';
import { r as designRoutes } from './routes/design.js';
import { householdAppearance } from './lib/appearance.js';
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
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
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
  res.status(403).json({ error: t('Request from another site') });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// MCP (Claude, ChatGPT, …) — stateless Streamable HTTP
app.all('/mcp', handleMcp);
app.all('/mcp/:secret', handleMcp);

app.use('/img', express.static(path.join(config.dataDir, 'images'), { maxAge: '30d', immutable: true, fallthrough: false }));

// iPhone shortcut (personal list token) and the share-target fallback – before the routers that require a session
app.use(sharePublic);
app.use('/api/guest', guest);
app.use('/api/guest', ha2Guest);
app.use('/api/party-board', partyBoard);
app.use(kioskPublic);
app.use('/api/kid', kidDevice);
app.use('/api', dataPublic);
app.use('/api', channelsPublic);
app.use('/api', authPublic);
app.use('/api', peoplePublic);
app.use('/api', core);
app.use('/api', imports);
app.use('/api', recipes);
app.use('/api', ha);
app.use('/api', guestAdmin);
app.use('/api', dataRoutes);
app.use('/api', partyRoutes);
app.use('/api', freshRoutes);
app.use('/api', shopRoutes);
app.use('/api', homeRoutes);
app.use('/api', kioskRoutes);
app.use('/api', kidsRoutes);
app.use('/api', onboardRoutes);
app.use('/api', retailRoutes);
app.use('/api', channelsRoutes);
app.use('/api', intlRoutes);
app.use('/api', cook2Routes);
app.use('/api', authRoutes);
app.use('/api', spend2Routes);
app.use('/api', printRoutes);
app.use('/api', shareRoutes);
app.use('/api', labelsRoutes);
app.use('/api', awayRoutes);
app.use('/api', plan2Routes);
app.use('/api', recipes2Routes);
app.use('/api', qualityRoutes);
app.use('/api', peopleRoutes);
app.use('/api', tourRoutes);
app.use('/api', ha2Routes);
app.use('/api', menuRoutes);
app.use('/api', designRoutes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = [path.join(here, 'web'), path.join(here, '../dist/web')].find((d) => fs.existsSync(path.join(d, 'index.html')));
if (webDir) {
  // brand-dependent app icons / manifest / title (ToHuus Hub or the Fredirando house theme)
  const BRAND_FILES: Record<string, string> = {
    '/icon.svg': 'fredirando.svg',
    '/apple-touch-icon.png': 'fredirando-touch.png',
    '/icon-192.png': 'fredirando-192.png',
    '/icon-512.png': 'fredirando-512.png',
    '/icon-maskable-192.png': 'fredirando-maskable-192.png',
    '/icon-maskable-512.png': 'fredirando-maskable-512.png',
    '/favicon-32.png': 'fredirando-32.png',
    '/icon-light.svg': 'fredirando-light.svg',
    '/icon-dark.svg': 'fredirando-dark.svg',
    '/icon-1024.png': 'fredirando-1024.png',
  };
  app.get(Object.keys(BRAND_FILES), (req, res, next) => {
    if (brand() !== 'fredirando') return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(webDir, BRAND_FILES[req.path]));
  });
  // manifest per brand and household theme (colours match the --paper token of web/src/styles.css)
  const PAPER = { tohuus: { light: '#f5f2eb', dark: '#0f1513' }, fredirando: { light: '#fff7f0', dark: '#170f0b' } } as const;
  app.get('/manifest.webmanifest', (_req, res) => {
    const m = JSON.parse(fs.readFileSync(path.join(webDir, 'manifest.webmanifest'), 'utf8'));
    const b = brand() === 'fredirando' ? 'fredirando' : 'tohuus';
    const c = PAPER[b][householdAppearance().theme === 'dark' ? 'dark' : 'light'];
    Object.assign(m, { background_color: c, theme_color: c });
    if (b === 'fredirando') Object.assign(m, { name: 'Fredirando', short_name: 'Fredirando', description: t('Ordered. Delivered. From kitchen & pantry.') });
    res.type('application/manifest+json').setHeader('Cache-Control', 'no-cache').send(JSON.stringify(m));
  });
  app.use(express.static(webDir, { index: false, maxAge: '1h', setHeaders: (res, p) => {
    if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  const fredi = html
    .replace(/<title>.*<\/title>/, '<title>Fredirando</title>')
    .replace(/content="ToHuus Hub"/g, 'content="Fredirando"')
    .replace(/content="#f5f2eb"/g, 'content="#fff7f0"')
    .replace(/content="#0f1513"/g, 'content="#170f0b"')
    .replace(/<html lang="[^"]*"/, '<html lang="de" data-brand="fredirando"');
  // the document language follows the household setting
  // … and the household theme is known before the first paint (web/public/theme-boot.js reads it)
  const withLang = (doc: string) => doc.replace(/<html lang="[^"]*"/, `<html lang="${lang()}" data-theme-default="${householdAppearance().theme}"`);
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
  console.log(`ToHuus Hub running on :${config.port} (${config.baseUrl})`);
  startScheduler();
  startBackups();
});
