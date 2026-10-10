import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config } from './config.js';
import './db.js';
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
app.set('trust proxy', true);
app.use(express.json({ limit: '4mb' }));
app.use(cookieParser());
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
  next();
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
  app.use(express.static(webDir, { index: false, maxAge: '1h', setHeaders: (res, p) => {
    if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } }));
  const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
  app.get(/.*/, (_req, res) => res.type('html').setHeader('Cache-Control', 'no-cache').send(html));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Ungültige Eingabe', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return;
  }
  const msg = (err as Error)?.message ?? 'Fehler';
  console.error('[error]', msg);
  res.status(500).json({ error: msg });
});

app.listen(config.port, () => {
  console.log(`Stockwerk läuft auf :${config.port} (${config.baseUrl})`);
  startScheduler();
});
