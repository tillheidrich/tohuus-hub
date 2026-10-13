// must run before anything opens the database: applies a staged restore
import './lib/restore-boot.js';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { config } from './config.js';
import { UsageLimitError } from './lib/limits.js';
import { gzipApi, precompressedStatic } from './lib/compress.js';
import { lang, onDbReady } from './db.js';
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
import { r as moneyListRoutes } from './routes/money-lists.js';
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
import { pub as haPairPublic } from './routes/ha-pair.js';
import { r as menuRoutes } from './routes/menu.js';
import { r as designRoutes } from './routes/design.js';
import { r as invitesRoutes, pub as invitesPublic } from './routes/invites.js';
import { r as buyAtRoutes } from './routes/buyat.js';
import { r as featureRoutes } from './routes/features.js';
import { r as aiSettingsRoutes } from './routes/ai-settings.js';
import { pub as oauthPub, r as oauthRoutes } from './routes/oauth.js';
import { r as operatorRoutes } from './routes/operator.js';
import { r as moveRoutes } from './routes/move.js';
import { r as iosCompat } from './routes/ios-compat.js';
import { requestCounter } from './lib/operator.js';
import { startStats, statsCounter } from './lib/stats.js';
import { cloudRecipes as cloudRecipesRoutes, cloudRecipesPublic } from './routes/cloud-recipes.js';
import { startCatalogScheduler } from './lib/cloud-recipes.js';
import { startRenewalReminders } from './lib/renewals.js';
import { AiError } from './lib/ai.js';
import { r as list2Routes, pub as list2Public } from './routes/list2.js';
import { caldav } from './lib/caldav.js';
import { r as houseGuideRoutes, houseGuest } from './routes/house-guide.js';
import { r as wishRoutes } from './routes/wishes.js';
import { r as factsRoutes } from './routes/facts.js';
import { householdAppearance } from './lib/appearance.js';
import { setGlobalDispatcher } from 'undici';
import { privateBlockingAgent } from './lib/net.js';
import { cloudContext } from './lib/cloud-auth.js';
import { appAuth, cloud as cloudRoutes, cloudPub, instance, wellKnown } from './routes/cloud.js';
import { appleAuth } from './routes/cloud-apple.js';
import { r as billingRoutes, pub as billingPublic } from './routes/billing.js';
import { serveImage, signImagesForTokenClients } from './lib/images.js';
import { NoHouseholdError, currentHousehold } from './lib/tenancy.js';
import { QuotaError, bodyQuota } from './lib/plans.js';
import { startCloudBackups } from './lib/cloud-backup.js';

// ToHuus Cloud: no outbound request of any household may reach a private/internal address (HA, webhooks, feeds …)
if (config.multiTenant) setGlobalDispatcher(privateBlockingAgent);
import { ensureBaseData, seedDemo } from './seed.js';

// a new household gets no places unasked – onboarding asks which ones it has (area: home); the demo brings its own
onDbReady(() => ensureBaseData({ places: false }));
if (config.seedDemo && !config.multiTenant) seedDemo();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
// JSON/text API answers > 1 kB gzipped (before the image signer, which rewrites bodies first) – lib/compress.ts
app.use('/api', gzipApi);
// ToHuus Cloud: pick the household of this request (session, app token, token prefix) – lib/cloud-auth.ts
if (config.multiTenant) app.use(cloudContext);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  );
  next();
});

// cloud operator page: requests and 5xx per hour, status class only (lib/operator.ts)
if (config.multiTenant) app.use('/api', requestCounter);
// cloud usage statistics: feature events per day and platform, counts only (lib/stats.ts)
if (config.multiTenant) app.use('/api', statsCounter);

// storage quota: the database counts too – large JSON writes are refused when the household is full (plans.ts)
app.use('/api', bodyQuota);

// CSRF: cookie-authenticated writes must come from our own origin (sibling subdomains share SameSite=Lax)
const ownOrigin = new URL(config.baseUrl).origin;
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // only Bearer/x-api-key requests are token-authenticated (resolveActor never falls back to the cookie for them)
  // Apple's form_post comes from appleid.apple.com; it is bound to our own state cookie instead (routes/cloud-apple.ts)
  if (config.multiTenant && req.path === '/auth/apple/callback') return next();
  if (req.path.startsWith('/guest/') || req.headers.authorization?.startsWith('Bearer ') || typeof req.headers['x-api-key'] === 'string') return next();
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  if (origin === ownOrigin || site === 'same-origin' || (!origin && !site)) return next();
  res.status(403).json({ error: t('Request from another site') });
});

app.get('/health', (_req, res) => res.json({ ok: true }));
// ToHuus Cloud: apple-app-site-association (webcredentials – passkeys in the iPhone app)
if (config.multiTenant) app.use(wellKnown);

// OAuth 2.1 for MCP: metadata, client registration, consent, tokens (routes/oauth.ts)
app.use(oauthPub);
// CalDAV bridge for Apple Reminders / Nextcloud Tasks (list2): /caldav/*, /.well-known/caldav – Basic auth with an
// app-specific password, outside /api (no cookies, no CSRF) – lib/caldav.ts
app.use(caldav);

// MCP (Claude, ChatGPT, …) — stateless Streamable HTTP
app.all('/mcp', handleMcp);
app.all('/mcp/:secret', handleMcp);

// images need a signed-in member, an app/API token or a short-lived signed URL (guest links, displays, HA, apps)
app.use(signImagesForTokenClients);
app.get('/img/:name', serveImage);
app.use('/img', (_req, res) => void res.status(404).end());

app.use('/api', instance);
app.use('/api', factsRoutes);
app.use('/api', appAuth);
app.use('/api', billingPublic);
if (config.multiTenant) {
  // Sign in with Apple (app token or cookie session, web redirect flow) – routes/cloud-apple.ts
  app.use('/api', appleAuth);
  app.use('/api', cloudPub);
  app.use('/api', cloudRoutes);
  // operator page /betrieb: aggregates only (lib/operator.ts)
  app.use('/api', operatorRoutes);
  // ToHuus-Rezepte: the central recipe catalogue (lib/cloud-recipes.ts)
  app.use('/api', cloudRecipesPublic);
  app.use('/api', cloudRecipesRoutes);
}

// iPhone shortcut (personal list token) and the share-target fallback – before the routers that require a session
app.use(sharePublic);
app.use('/api/guest', guest);
app.use('/api/guest', ha2Guest);
app.use('/api/guest', houseGuest);
app.use('/api/party-board', partyBoard);
app.use(kioskPublic);
app.use('/api/kid', kidDevice);
app.use('/api', dataPublic);
app.use('/api', invitesPublic);
app.use('/api', channelsPublic);
app.use('/api', authPublic);
// Home Assistant pairing by code: claim is public (the integration has no token yet)
app.use('/api', haPairPublic);
app.use('/api', peoplePublic);
app.use('/api', list2Public);
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
app.use('/api', moneyListRoutes);
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
app.use('/api', invitesRoutes);
app.use('/api', buyAtRoutes);
app.use('/api', billingRoutes);
app.use('/api', featureRoutes);
app.use('/api', aiSettingsRoutes);
app.use('/api', oauthRoutes);
app.use('/api', moveRoutes);
app.use('/api', list2Routes);
// names the iPhone app 0.2 was built against (docs/ios-api-0.2.md) – thin aliases
app.use('/api', iosCompat);
app.use('/api', houseGuideRoutes);
app.use('/api', wishRoutes);
// the text stays 'not found': iPhone app builds up to 1.0 (5) hide a feature by exactly this answer
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found', code: 'not_found' }));

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = [path.join(here, 'web'), path.join(here, '../dist/web')].find((d) => fs.existsSync(path.join(d, 'index.html')));
if (webDir) {
  // manifest per household theme (colours match the --canvas token of web/src/styles.css; one brand: ToHuus)
  const CANVAS = { light: '#f7f5ef', dark: '#0f1513' } as const;
  // cloud pages outside a household (sign-in, signup) use the defaults
  const theme = () => (config.multiTenant && !currentHousehold() ? 'light' : householdAppearance().theme);
  app.get('/manifest.webmanifest', (_req, res) => {
    const m = JSON.parse(fs.readFileSync(path.join(webDir, 'manifest.webmanifest'), 'utf8'));
    const c = CANVAS[theme() === 'dark' ? 'dark' : 'light'];
    Object.assign(m, { background_color: c, theme_color: c, description: t('Less on your mind. More at home.') });
    res.type('application/manifest+json').setHeader('Cache-Control', 'no-cache').send(JSON.stringify(m));
  });
  // pre-compressed .br/.gz from the build (scripts/precompress.mjs) for clients that accept them
  app.use(precompressedStatic(webDir, (p) => (p.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600')));
  app.use(express.static(webDir, { index: false, maxAge: '1h', setHeaders: (res, p) => {
    if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  // a file the build no longer has (a chunk of an older version) is a 404 – never the app page with 200, which the
  // service worker would keep as that script and every later visit of the page would stay white
  app.use((req, res, next) => (/^\/assets\//.test(req.path) || /\.(?:m?js|css|map|woff2?|png|webp|svg|json)$/i.test(req.path) ? res.status(404).type('text/plain').send('not found') : next()));
  const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  // the document language follows the household setting
  // … and the household theme is known before the first paint (web/public/theme-boot.js reads it)
  const withLang = (doc: string) => doc.replace(/<html lang="[^"]*"/, `<html lang="${lang()}" data-theme-default="${theme()}"`);
  app.get(/.*/, (_req, res) => res.type('html').setHeader('Cache-Control', 'no-cache').send(withLang(html)));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: t('Invalid input'), issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return;
  }
  if (err instanceof NoHouseholdError) {
    res.status(401).json({ error: t('Please sign in again.'), code: 'unauthorized' });
    return;
  }
  if (err instanceof QuotaError) {
    res.status(413).json(err.toJSON());
    return;
  }
  if (err instanceof UsageLimitError) {
    res.status(err.status).json(err.toJSON());
    return;
  }
  if (err instanceof AiError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof MulterError) {
    res.status(413).json({ error: t('File too large (max. 15 MB)') });
    return;
  }
  const e = err as { message?: string; status?: unknown; expose?: boolean; stack?: string };
  // deliberate client errors (status < 500) and translated messages for people (userError) are shown as they are
  if (typeof e?.status === 'number' && e.status >= 400 && e.status < 500) return void res.status(e.status).json({ error: e.message ?? t('Error') });
  if (e?.expose && e.message) {
    console.error('[error]', e.message);
    return void res.status(500).json({ error: e.message });
  }
  // anything else: no internals in production (paths, SQL, stack) – a reference to find it in the log
  const ref = crypto.randomBytes(4).toString('hex');
  console.error(`[error ${ref}]`, e?.stack ?? e?.message ?? err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? t('That didn’t work. Please try again in a moment – if it happens again, tell us the code {ref}.', { ref }) : (e?.message ?? t('Error')), ref });
});

export { app };
export const server = app.listen(config.port, () => {
  console.log(`ToHuus Hub running on :${config.port} (${config.baseUrl})`);
  startScheduler();
  if (config.multiTenant) startCloudBackups();
  if (config.multiTenant) startRenewalReminders();
  if (config.multiTenant) startStats();
  if (config.multiTenant) startCatalogScheduler();
  else startBackups();
});
