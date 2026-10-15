/**
 * Shared by scripts/ui-audit.mjs and scripts/a11y-audit.mjs: argument parsing, sign-in, optional seeding of
 * realistic data, the list of routes and sheets, and a browser context per viewport/theme/text size.
 * Playwright is not a repo dependency – install it outside the repo and set NODE_PATH (docs/ui-audit.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    console.error('playwright not found – install it outside the repo and set NODE_PATH (see docs/ui-audit.md)');
    process.exit(2);
  }
}

// ------------------------------------------------------------------ args
export function args(defaults = {}) {
  const argv = process.argv.slice(2);
  const opt = (name, def) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : (def ?? defaults[name]);
  };
  const flag = (name) => argv.includes(`--${name}`);
  return {
    argv,
    opt,
    flag,
    BASE: (argv.find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:8080').replace(/\/$/, ''),
    OUT: path.resolve(opt('out', 'audit-out')),
    VIEWPORTS: opt('viewports', '390x844,768x1024,1280x800')
      .split(',')
      .map((v) => v.split('x').map(Number)),
    THEMES: opt('themes', 'light,dark').split(','),
    ONLY: opt('only', '')
      .split(',')
      .filter(Boolean),
    EXEC: process.env.PW_CHROMIUM ?? findChromium(),
  };
}

export function findChromium() {
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort();
  for (const d of dirs.reverse()) {
    for (const p of ['chrome-linux/chrome', 'chrome-linux64/chrome']) if (fs.existsSync(path.join(root, d, p))) return path.join(root, d, p);
  }
  return undefined;
}

// ------------------------------------------------------------------ session
let BASE = 'http://localhost:8080';
export const setBase = (b) => (BASE = b);

export async function api(ctx, method, p, body) {
  const r = await ctx.request.fetch(`${BASE}/api${p}`, { method, data: body ?? undefined, headers: { 'content-type': 'application/json' } });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* not json */
  }
  return { status: r.status(), json };
}

export async function signIn(ctx, opt) {
  let email = opt('email');
  let password = opt('password');
  const inst = (await api(ctx, 'GET', '/instance')).json ?? {};
  if (!email && inst.mode === 'cloud' && inst.signup) {
    email = `audit-${Date.now()}@example.org`;
    password = 'audit-geheim-1234';
    const s = await api(ctx, 'POST', '/cloud/signup', { email, password, name: 'Mira', householdName: 'Familie Berg', form: 'family', lang: 'de', region: 'DE', client: 'web' });
    if (s.status !== 200) throw new Error(`signup failed: ${s.status} ${JSON.stringify(s.json)}`);
  } else {
    const l = await api(ctx, 'POST', '/auth/login', { name: email, email, password });
    if (l.status !== 200) throw new Error(`login failed: ${l.status} ${JSON.stringify(l.json)}`);
  }
  // quiet start: no setup redirect, no tour, demo data in, theme follows the browser
  await api(ctx, 'PATCH', '/onboarding', { closed: true, skipped: true, started: true, checklistDismissed: true });
  await api(ctx, 'POST', '/tour/start', { choice: 'demo' });
  const st = (await api(ctx, 'GET', '/tour')).json;
  if (!st?.demo?.rows) await api(ctx, 'POST', '/tour/demo', {});
  await api(ctx, 'PUT', '/tour', { status: 'skipped' });
  await api(ctx, 'PATCH', '/appearance/household', { theme: 'system', userChoice: true });
  await api(ctx, 'PATCH', '/appearance/me', { theme: null });
  return { email, password, inst };
}

/**
 * Realistic data for the newer screens (--seed): a private shopping list and one shared with a person, wish lists
 * (one for a child with reserved/bought wishes and several links, one private), two money lists, expenses with
 * lines for a person. Runs once per household (skipped when wish lists exist). Members need invitations, which
 * need a confirmed e-mail address in the cloud – add them beforehand if the screens should show several people.
 */
export async function seed(ctx) {
  if ((await api(ctx, 'GET', '/wishes/lists')).json?.length) return;
  const users = (await api(ctx, 'GET', '/users')).json ?? [];
  const me = users[0]?.id;
  const other = users.find((u) => u.id !== me)?.id;
  const priv = (await api(ctx, 'POST', '/list/lists', { name: 'Geburtstagskuchen für Sam', kind: 'other', visibility: 'private' })).json;
  for (const text of ['Mascarpone 500 g', 'Löffelbiskuits', 'Kakaopulver', 'Kerzen in Grün']) await api(ctx, 'POST', '/shopping', { text, list_id: priv?.id });
  if (other) await api(ctx, 'POST', '/list/lists', { name: 'Drogerie', kind: 'store', visibility: 'people', share_with: [other] });
  const mk = async (l, body) => (l?.id ? (await api(ctx, 'POST', `/wishes/lists/${l.id}/items`, body)).json : null);
  const w1 = (await api(ctx, 'POST', '/wishes/lists', { name: 'Weihnachten für Mika', for_name: 'Mika', note: 'Was Mika sich wünscht – bis Mitte Dezember' })).json;
  const w2 = (await api(ctx, 'POST', '/wishes/lists', { name: 'Neue Kekse & Fundstücke' })).json;
  const w3 = (await api(ctx, 'POST', '/wishes/lists', { name: 'Geschenk für Sam', ...(other ? { for_user_id: other } : { for_name: 'Sam' }), visibility: 'private' })).json;
  const a = await mk(w1, { title: 'Holzeisenbahn-Erweiterungsset mit Brücke und Tunnel', price: 39.99, priority: 1, note: 'Passt zur Bahn von Oma, Spurweite prüfen', links: [{ label: 'Shop', url: 'https://example.org/bahn', price: 39.99 }, { label: 'Idealo', url: 'https://example.org/idealo/bahn', price: 34.9 }] });
  await mk(w1, { title: 'Bilderbuch „Der kleine Drache Kokosnuss“', price: 12, priority: 2, giver_name: 'Oma' });
  const c = await mk(w1, { title: 'Regenjacke Größe 110', price: 45, priority: 3, note: 'Gerne in Gelb' });
  await mk(w2, { title: 'Dinkel-Hafer-Kekse mit Zartbitter', note: 'Aus dem Artikel über neue Supermarktprodukte', links: [{ url: 'https://example.org/kekse' }] });
  await mk(w2, { title: 'Espressokanne 6 Tassen', price: 29.95, links: [{ label: 'Shop', url: 'https://example.org/kanne' }] });
  await mk(w3, { title: 'Kopfhörer mit Geräuschunterdrückung', price: 129, priority: 1 });
  if (a?.id) await api(ctx, 'POST', `/wishes/items/${a.id}/status`, { status: 'reserved', by_name: 'Oma' });
  if (c?.id) await api(ctx, 'POST', `/wishes/items/${c.id}/status`, { status: 'bought' });
  const people = [...users.slice(0, 3).map((u) => ({ user_id: u.id })), { name: 'Jonas (Nachbar)' }];
  const ml = (await api(ctx, 'POST', '/money/lists', { title: 'Pizzaabend Freitag', mode: 'items', people })).json;
  if (ml?.id) {
    const ppl = ml.people ?? (await api(ctx, 'GET', `/money/lists/${ml.id}`)).json?.people ?? [];
    const items = [['Pizzateig x3', 6.47], ['Mozzarella x4', 4.36], ['Getränke (Cola 6×1,5 l)', 7.14], ['Tiramisu', 5.99], ['Pfand', -1.5]];
    for (const [i, [name, amount]] of items.entries()) await api(ctx, 'POST', `/money/lists/${ml.id}/items`, { name, amount, paid_by: ppl[i % Math.min(2, ppl.length)]?.id });
    await api(ctx, 'PATCH', `/money/lists/${ml.id}`, { mode: 'equal' });
  }
  await api(ctx, 'POST', '/money/lists', { title: 'Urlaub Ostsee', mode: 'equal', count: 4, visibility: 'private', items: [{ name: 'Ferienwohnung', amount: 640 }, { name: 'Tanken', amount: 82.4 }] });
  const day = new Date().toISOString().slice(0, 10);
  await api(ctx, 'POST', '/spend/expenses', { day, amount: 23.85, store: 'Drogerie', category: 'Drogerie', note: 'Zahnpasta, Sonnencreme, Windeln', items: [{ name: 'Sonnencreme LSF 50', price: 8.95, for_user_id: other ?? me }, { name: 'Windeln Gr. 5', price: 14.9 }] });
  await api(ctx, 'POST', '/spend/expenses', { day, amount: 19.99, store: 'Buchhandlung', category: 'Geschenke', note: 'Buch als Geschenk', private_for: me });
}

// ------------------------------------------------------------------ what to visit
export async function targets(ctx, inst, fresh) {
  const first = async (p, pick) => {
    const r = await api(ctx, 'GET', p);
    try {
      return pick(r.json);
    } catch {
      return null;
    }
  };
  const productId = await first('/products', (j) => (Array.isArray(j) ? j : j.products ?? j.items)[0].id);
  const recipeId = await first('/recipes', (j) => (Array.isArray(j) ? j : j.recipes ?? j.items)[0].id);
  if (!(await api(ctx, 'GET', '/imports')).json?.length) {
    // a typed list gives the receipt review page something to show
    await ctx.request.post(`${BASE}/api/imports/upload`, { multipart: { text: '2x Milch 1,5%\nHaferdrink Barista\nSpülmaschinentabs Classic 40 Stück\nBio-Vollkorn-Dinkelbrötchen' } }).catch(() => {});
  }
  const importId = await first('/imports', (j) => (Array.isArray(j) ? j : j.imports ?? j.items)[0].id);
  const wishListId = await first('/wishes/lists', (j) => j[0].id);
  const privateListId = await first('/list/lists', (j) => j.find((l) => l.id && l.visibility !== 'household').id);
  const operator = inst.mode === 'cloud' && (await api(ctx, 'GET', '/operator/status')).status === 200;
  const routes = [
    '/',
    '/einkauf',
    '/bestand',
    productId && `/bestand/${productId}`,
    '/kochen',
    '/kochen?view=ideas',
    '/kochen?view=week',
    '/kochen?view=recipes',
    recipeId && `/rezepte/${recipeId}`,
    '/einkauf/wuensche',
    wishListId && `/einkauf/wuensche/${wishListId}`,
    '/geld',
    '/mehr',
    '/wo',
    '/hausinfo',
    '/abgleich',
    '/pflege',
    '/fokus',
    '/denkarbeit',
    '/rueckblick',
    '/urlaub',
    '/import',
    '/import?mode=photo',
    '/import?mode=text',
    '/import?mode=url',
    '/import/quality',
    importId && `/import/${importId}`,
    '/lieblinge',
    '/ausgaben',
    '/bestellen',
    '/bestellen/karte',
    '/bar',
    '/merkt-sich',
    '/etiketten',
    '/scan',
    '/so-funktioniert-tohuus',
    '/gut-zu-wissen',
    '/hilfe',
    '/uebergabe',
    '/teilen',
    '/willkommen',
    ...['home', 'account', 'members', 'places', 'notify', 'access', 'ha', 'displays', 'print', 'recipes', 'data', ...(inst.mode === 'cloud' ? ['plan'] : [])].map((t) => `/einstellungen?tab=${t}`),
  ].filter(Boolean);
  const extra = [
    // Geld › "Nur meins" and a private shopping list (remembered per device in localStorage)
    { name: '/geld (nur meins)', path: '/geld', local: { 'sw.money.view': 'mine' } },
    privateListId && { name: '/einkauf (private Liste)', path: '/einkauf', local: { 'sw.shop.list': String(privateListId) } },
    // back office (only when the audit account is in OPERATOR_EMAILS)
    ...(operator ? ['uebersicht', 'statistik', 'konten', 'beta', 'geschenke', 'rezepte', 'einstellungen', 'haushalte', 'protokoll'].map((h) => ({ name: `/betrieb#${h}`, path: `/betrieb#${h}`, operator: true })) : []),
    // signed out: sign-in and sign-up (beta code, shop choice)
    { name: 'anon:/', path: '/', as: 'anon' },
    ...(inst.mode === 'cloud' && inst.signup ? [{ name: 'anon:/signup', path: '/signup', as: 'anon' }] : []),
    // a household that has not answered the sample-data question yet
    ...(fresh ? [{ name: 'fresh:/willkommen', path: '/willkommen', as: 'fresh' }] : []),
  ].filter(Boolean);
  return [...routes.map((r) => ({ name: r, path: r })), ...extra];
}

/** A second household right after sign-up – setup and the "Beispieldaten?" question still open. */
export async function freshHousehold(browser, opt) {
  const ctx = await browser.newContext();
  const email = opt('fresh-email', `audit-fresh-${Date.now()}@example.org`);
  const password = 'audit-geheim-1234';
  let s = await api(ctx, 'POST', '/cloud/signup', { email, password, name: 'Sam', householdName: 'WG Lindenstraße', form: 'wg', lang: 'de', region: 'DE', client: 'web' });
  if (s.status === 409 || s.status === 400) s = await api(ctx, 'POST', '/auth/login', { name: email, email, password });
  if (s.status !== 200) {
    console.warn(`fresh household skipped: ${s.status} ${JSON.stringify(s.json)}`);
    await ctx.close();
    return null;
  }
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/** Sheets and dialogs: open by clicking; a step that finds nothing is reported as "not reached". */
export const DIALOGS = [
  { name: 'sheet:add', path: '/', open: async (p) => p.evaluate(() => window.dispatchEvent(new Event('tohuus:add'))) },
  { name: 'sheet:assistant', path: '/', open: async (p) => p.locator('.assist-fab').first().click() },
  { name: 'sheet:item-editor', path: '/einkauf', open: async (p) => p.locator('main .icon-btn.plain[aria-label="Mehr"], main .icon-btn.plain[aria-label="More"]').first().click() },
  { name: 'sheet:new-product', path: '/bestand', open: async (p) => p.locator('main .page-head .btn.primary').first().click() },
  { name: 'sheet:recipe-import', path: '/kochen?add=1', open: async () => {} },
  { name: 'sheet:plan-entry', path: '/kochen?view=week', open: async (p) => p.locator('.wadd').first().click() },
  { name: 'sheet:plan-meal', path: '/kochen?view=week', open: async (p) => p.locator('.wmeal').first().click() },
  { name: 'sheet:expense', path: '/geld', open: async (p) => p.locator('.money-page .page-head .btn.primary').first().click() },
  { name: 'sheet:money-list', path: '/geld', open: async (p) => p.locator('.mq-row').first().click() },
  { name: 'sheet:money-list-new', path: '/geld', open: async (p) => p.locator('.mq-lists .hcard-h .btn').first().click() },
  { name: 'sheet:wish', path: 'wish', open: async (p) => p.locator('.wish-title').first().click() },
  {
    name: 'sheet:wish-share',
    path: 'wish',
    open: async (p) => {
      await p.locator('.wish-actions .btn').first().click();
      await p.locator('.wish-actions .btn').first().click();
    },
  },
  { name: 'sheet:wish-new-list', path: '/einkauf/wuensche', open: async (p) => p.locator('.wish-toolbar .btn').first().click() },
];


/** Browser context for one run (viewport, theme, 20 px text) – `storage` null = signed out. */
export async function runContext(browser, run, storage) {
  const ctx = await browser.newContext({
    viewport: { width: run.w, height: run.h },
    deviceScaleFactor: 1,
    colorScheme: run.theme,
    reducedMotion: 'reduce',
    ...(storage ? { storageState: storage } : {}),
    locale: 'de-DE',
    hasTouch: run.w < 700,
  });
  await ctx.addInitScript((large) => {
    try {
      sessionStorage.setItem('sw.onb.redirected', '1');
      localStorage.setItem('sw.theme', 'system');
      // browser text size 20px: the CDP font setting below does not survive every navigation in headless
      // Chromium, so the root size is set directly as well (the app sizes everything in rem from it)
      if (large) document.addEventListener('DOMContentLoaded', () => document.documentElement.style.setProperty('font-size', '20px'));
      if (large === 'app') localStorage.setItem('sw.listPrefs', JSON.stringify({ density: 'normal', fontScale: 1.25 }));
    } catch {
      /* ignore */
    }
  }, run.large);
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  if (run.large) {
    // browser default font size 20px (the Dynamic Type equivalent of a desktop browser)
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 20, fixed: 20 } });
  }
  return { ctx, page };
}

/**
 * Contexts per run: the audit household (default), signed out (`as: 'anon'`) and the fresh household (`as: 'fresh'`),
 * opened on first use. Returns the page for a target, with per-device settings (`local`) applied and the back office
 * unlocked (`operator`).
 */
export function pages(browser, run, { storage, fresh, password }) {
  const open = new Map();
  const get = async (t) => {
    const key = t.as ?? 'main';
    if (!open.has(key)) open.set(key, await runContext(browser, run, key === 'anon' ? null : key === 'fresh' ? fresh : storage));
    const { ctx, page } = open.get(key);
    if (t.operator) await api(ctx, 'POST', '/operator/unlock', { password });
    return page;
  };
  return { get, close: async () => Promise.all([...open.values()].map(({ ctx }) => ctx.close())) };
}

/** Open a target and wait until it has settled (no skeletons). Sheets are opened by `t.open`. */
export async function visit(page, t) {
  // the app keeps an event stream open, so "networkidle" never comes – wait for the page instead
  if (t.local) {
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 20000 });
    await page.evaluate((kv) => Object.entries(kv).forEach(([k, v]) => localStorage.setItem(k, v)), t.local);
  }
  await page.goto(BASE + t.path, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('main .page-fade, main, .login, .card', { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"], .skeleton'), null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(600);
  let error = null;
  if (t.open) {
    try {
      await t.open(page);
      await page.waitForSelector('[role="dialog"], .sheet', { timeout: 4000 });
      await page.waitForTimeout(400);
    } catch (e) {
      error = String(e.message ?? e).split('\n')[0];
    }
  }
  return { error };
}

/** Undo per-device settings of a target (so the next one starts from the defaults). */
export async function reset(page, t) {
  if (t.local) await page.evaluate((keys) => keys.forEach((k) => localStorage.removeItem(k)), Object.keys(t.local)).catch(() => {});
}

/** Sign in (and seed), the fresh household, and the list of everything to visit. */
export async function prepare(browser, a) {
  setBase(a.BASE);
  const setupCtx = await browser.newContext();
  const session = await signIn(setupCtx, a.opt);
  if (a.flag('seed')) await seed(setupCtx);
  const storage = await setupCtx.storageState();
  const fresh = session.inst.mode === 'cloud' && !a.flag('no-fresh') ? await freshHousehold(browser, a.opt) : null;
  const firstWish = (await api(setupCtx, 'GET', '/wishes/lists')).json?.[0]?.id;
  let list = [
    ...(await targets(setupCtx, session.inst, fresh)),
    ...(a.flag('no-dialogs') ? [] : DIALOGS.map((d) => (d.path === 'wish' ? { ...d, path: firstWish ? `/einkauf/wuensche/${firstWish}` : '/einkauf/wuensche' } : d))),
  ];
  if (a.ONLY.length) list = list.filter((t) => a.ONLY.some((o) => t.name === o || t.path === o || t.name.startsWith(o)));
  await setupCtx.close();
  return { session, storage, fresh, list };
}

/** Screenshot / report file name of a target. */
export const fileName = (t, tag) => `${t.name.replace(/^\//, '').replace(/[^\w-]+/g, '_') || 'heute'}--${tag}.png`;
