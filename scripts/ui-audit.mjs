#!/usr/bin/env node
/**
 * UI layout audit for the ToHuus web app – visits every route, settings tab and the main sheets at several
 * viewports, light and dark, and with large text, takes a screenshot of each and reports layout faults:
 *
 *   overflow     text box wider than its element while overflow is visible (text runs out of its box)
 *   clipped      text cut off by overflow hidden without an ellipsis / line clamp
 *   offscreen    element sticking out of the viewport (left/right), or the whole page scrolls sideways
 *   icon-overlap text lying on an icon (svg/img) inside the same button / row
 *   wrap-under   button label wrapping underneath its icon
 *
 * Usage (playwright must be resolvable – install it in a scratch dir and set NODE_PATH, see docs/ui-audit.md):
 *   node scripts/ui-audit.mjs http://localhost:8080 [--out dir] [--email x --password y] [--only /einkauf,/kochen]
 *        [--viewports 390x844,768x1024,1280x800] [--themes light,dark] [--no-large | --large-only] [--no-dialogs] [--strict]
 * Without credentials on a cloud server it signs up a fresh household (de) and loads the demo data
 * (POST /api/cloud/signup, POST /api/tour/demo). Self-hosted: pass the admin name as --email.
 * Writes <out>/report.json, <out>/report.md and one PNG per page/viewport/theme. Exit code 0 always
 * (it is an audit, not a gate) unless --strict, then 1 when anything was found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('playwright not found – install it outside the repo and set NODE_PATH (see docs/ui-audit.md)');
  process.exit(2);
}

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);
const BASE = (argv.find((a) => /^https?:\/\//.test(a)) ?? 'http://localhost:8080').replace(/\/$/, '');
const OUT = path.resolve(opt('out', 'ui-audit-out'));
const VIEWPORTS = opt('viewports', '390x844,768x1024,1280x800')
  .split(',')
  .map((v) => v.split('x').map(Number));
const THEMES = opt('themes', 'light,dark').split(',');
const ONLY = opt('only', '')
  .split(',')
  .filter(Boolean);
const EXEC = process.env.PW_CHROMIUM ?? findChromium();
fs.mkdirSync(OUT, { recursive: true });

function findChromium() {
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort();
  for (const d of dirs.reverse()) {
    for (const p of ['chrome-linux/chrome', 'chrome-linux64/chrome']) if (fs.existsSync(path.join(root, d, p))) return path.join(root, d, p);
  }
  return undefined;
}

// ------------------------------------------------------------------ session
async function api(ctx, method, p, body) {
  const r = await ctx.request.fetch(`${BASE}/api${p}`, { method, data: body ?? undefined, headers: { 'content-type': 'application/json' } });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* not json */
  }
  return { status: r.status(), json };
}

async function signIn(ctx) {
  let email = opt('email');
  let password = opt('password');
  const inst = (await api(ctx, 'GET', '/instance')).json ?? {};
  if (!email && inst.mode === 'cloud' && inst.signup) {
    email = `audit-${Date.now()}@example.org`;
    password = 'audit-geheim-1234';
    const s = await api(ctx, 'POST', '/cloud/signup', { email, password, name: 'Mira', householdName: 'Familie Berg', form: 'family', lang: 'de', region: 'DE', client: 'web' });
    if (s.status !== 200) throw new Error(`signup failed: ${s.status} ${JSON.stringify(s.json)}`);
  } else {
    const l = await api(ctx, 'POST', '/auth/login', { name: email, password });
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

// ------------------------------------------------------------------ what to visit
async function targets(ctx, inst) {
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
    '/geld',
    '/mehr',
    '/wo',
    '/hausinfo',
    '/abgleich',
    '/pflege',
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
    '/teilen',
    '/willkommen',
    ...['home', 'account', 'members', 'places', 'notify', 'access', 'ha', 'displays', 'print', 'recipes', 'data', ...(inst.mode === 'cloud' ? ['plan'] : [])].map((t) => `/einstellungen?tab=${t}`),
  ].filter(Boolean);
  return routes.map((r) => ({ name: r, path: r }));
}

/** Sheets and dialogs: open by clicking; a step that finds nothing is reported as "not reached". */
const DIALOGS = [
  { name: 'sheet:add', path: '/', open: async (p) => p.evaluate(() => window.dispatchEvent(new Event('tohuus:add'))) },
  { name: 'sheet:assistant', path: '/', open: async (p) => p.locator('.assist-fab').first().click() },
  { name: 'sheet:item-editor', path: '/einkauf', open: async (p) => p.locator('main .icon-btn.plain[aria-label="Mehr"], main .icon-btn.plain[aria-label="More"]').first().click() },
  { name: 'sheet:new-product', path: '/bestand', open: async (p) => p.locator('main .page-head .btn.primary').first().click() },
  { name: 'sheet:recipe-import', path: '/kochen?add=1', open: async () => {} },
  { name: 'sheet:plan-entry', path: '/kochen?view=week', open: async (p) => p.locator('.wadd').first().click() },
  { name: 'sheet:plan-meal', path: '/kochen?view=week', open: async (p) => p.locator('.wmeal').first().click() },
];
// ------------------------------------------------------------------ the detector (runs in the page)
function detect() {
  const out = [];
  const vw = window.innerWidth;
  const seen = new Set();
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    // visually hidden helpers (sr-only)
    if (r.width <= 1 && r.height <= 1) return false;
    if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return false;
    return true;
  };
  const desc = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    if (cls.length) s += `.${cls.join('.')}`;
    const p = el.parentElement;
    if (p && p !== document.body) {
      const pc = typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : '';
      s = `${p.tagName.toLowerCase()}${pc ? '.' + pc : ''} > ${s}`;
    }
    return s;
  };
  const text = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const ignored = (el) => el.closest('[data-audit-ignore], .sr-only, .visually-hidden, .skip-link');
  const add = (kind, el, extra = '') => {
    const key = `${kind}|${desc(el)}|${text(el)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, el: desc(el), text: text(el), extra });
  };
  /** inside a container that scrolls sideways on purpose (chips rows, carousels) */
  const inScroller = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && a.scrollWidth > a.clientWidth + 1) return a;
    }
    return null;
  };
  /** an ancestor with overflow hidden/clip cuts the element off on purpose (decorative discs, carousels) */
  const clippedByAncestor = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const c = getComputedStyle(a);
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible') return true;
    }
    return false;
  };
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const all = [...document.querySelectorAll('body *')].filter((el) => !(el instanceof SVGElement) && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION'].includes(el.tagName));

  if (document.documentElement.scrollWidth > vw + 1) out.push({ kind: 'offscreen', el: 'html', text: '', extra: `page scrolls sideways: ${document.documentElement.scrollWidth}px > ${vw}px` });

  for (const el of all) {
    if (ignored(el) || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const textual = hasOwnText(el);
    // 1 / 2 – horizontal overflow of text
    if (textual && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
      if (cs.overflowX === 'visible') add('overflow', el, `${el.scrollWidth}px in ${el.clientWidth}px`);
      else if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') {
        // text-overflow only works on block containers – on a flex/grid box the „…" never shows
        const flexy = /flex|grid/.test(cs.display);
        if (cs.textOverflow !== 'ellipsis' || flexy) add('clipped', el, `cut without ellipsis (${el.scrollWidth}px in ${el.clientWidth}px${flexy ? ', ellipsis on a flex box' : ''})`);
      }
    }
    // a child box sticking out of its parent (button wider than its card, chip past the row end …)
    if (cs.overflowX === 'visible' && cs.display !== 'inline' && r.width > 0 && !inScroller(el)) {
      for (const c of el.children) {
        if (c instanceof SVGElement || ignored(c)) continue;
        const ccs = getComputedStyle(c);
        if (ccs.position === 'absolute' || ccs.position === 'fixed') continue;
        const cr = c.getBoundingClientRect();
        if (cr.width < 2 || cr.height < 2 || !visible(c)) continue;
        if (cr.right > r.right + 2 || cr.left < r.left - 2) {
          // negative margins for full-bleed rows are deliberate when they stay inside the viewport
          const ml = Number.parseFloat(ccs.marginLeft) || 0;
          const mr = Number.parseFloat(ccs.marginRight) || 0;
          if ((ml < 0 || mr < 0) && cr.left >= -1 && cr.right <= vw + 1) continue;
          add('sticks-out', c, `${Math.round(Math.max(cr.right - r.right, r.left - cr.left))}px past ${desc(el)}`);
        }
      }
    }
    // vertical clipping of text (fixed heights)
    if (textual && (cs.overflowY === 'hidden' || cs.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 2 && cs.webkitLineClamp === 'none' && cs.textOverflow !== 'ellipsis')
      add('clipped', el, `cut vertically (${el.scrollHeight}px in ${el.clientHeight}px)`);
    // 3 – out of the viewport
    if (cs.position !== 'fixed' || r.width < vw) {
      if ((r.right > vw + 1 || r.left < -1) && r.width > 4 && !inScroller(el) && !clippedByAncestor(el)) {
        // only report the outermost offender
        const p = el.parentElement;
        const pr = p?.getBoundingClientRect();
        if (!pr || (pr.right <= vw + 1 && pr.left >= -1) || inScroller(p)) add('offscreen', el, `x ${Math.round(r.left)}…${Math.round(r.right)} of ${vw}`);
      }
    }
  }

  // 4 / 5 – text over icons, labels wrapping under their icon
  const rowOf = (el) => el.closest('button, a, [role="button"], label, li, .row, .item, .chip, .tab, .navlink, .action, .badge, .pill, summary, h1, h2, h3, p');
  const textRects = (root, skip) => {
    const rects = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      const pe = n.parentElement;
      if (!pe || skip.contains(pe) || pe.closest('svg') || ignored(pe) || pe.closest('.badge-dot, .count') || !visible(pe)) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const rc of rg.getClientRects()) if (rc.width > 1 && rc.height > 1) rects.push({ rc, el: pe });
    }
    return rects;
  };
  for (const icon of document.querySelectorAll('svg, img')) {
    if (icon.parentElement?.closest('svg')) continue; // nested svg parts
    if (ignored(icon)) continue;
    const ir = icon.getBoundingClientRect();
    if (ir.width < 8 || ir.height < 8 || ir.width > 120) continue; // icons only, no illustrations / photos
    const cs = getComputedStyle(icon);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const row = rowOf(icon);
    if (!row) continue;
    for (const { rc, el } of textRects(row, icon)) {
      const ix = Math.min(rc.right, ir.right) - Math.max(rc.left, ir.left);
      const iy = Math.min(rc.bottom, ir.bottom) - Math.max(rc.top, ir.top);
      if (ix > 2 && iy > 2 && ix * iy > 12) {
        // text drawn over an icon that sits behind it on purpose (background art) is rare; report all
        add('icon-overlap', el, `text over ${icon.tagName.toLowerCase()} in ${desc(row)}`);
        break;
      }
    }
    // label wrapping under the icon: one text element has a line beside the icon and a later line under it
    if (row.matches('button, a, [role="button"], .chip, .tab, .navlink, .badge, .pill') && ir.height < 40) {
      const byEl = new Map();
      for (const l of textRects(row, icon)) byEl.set(l.el, [...(byEl.get(l.el) ?? []), l.rc]);
      for (const [el, rcs] of byEl) {
        const beside = rcs.some((rc) => rc.top < ir.bottom - 1 && rc.bottom > ir.top + 1 && rc.left >= ir.right - 2);
        const under = rcs.some((rc) => rc.top >= ir.bottom - 1 && rc.left < ir.right - 2 && rc.right > ir.left);
        if (beside && under) add('wrap-under', el, `label wraps underneath its icon in ${desc(row)}`);
      }
    }
  }
  // 6 – count badges covering their icon (tab bar, sidebar): more than a corner is too much
  for (const b of document.querySelectorAll('.badge-dot')) {
    const icon = b.parentElement?.querySelector(':scope > svg');
    if (!icon || !visible(b)) continue;
    const br = b.getBoundingClientRect();
    const ir = icon.getBoundingClientRect();
    const ix = Math.min(br.right, ir.right) - Math.max(br.left, ir.left);
    const iy = Math.min(br.bottom, ir.bottom) - Math.max(br.top, ir.top);
    if (ix > 0 && iy > 0 && (ix * iy) / (ir.width * ir.height) > 0.06) add('icon-overlap', b, `badge covers ${Math.round(((ix * iy) / (ir.width * ir.height)) * 100)}% of its icon`);
  }
  return out;
}

/** At the end of the page: controls hidden under the floating assistant button or the tab bar. */
function covered() {
  const out = [];
  const bars = [...document.querySelectorAll('.assist-fab, .tabbar')].filter((e) => getComputedStyle(e).display !== 'none' && !e.hidden);
  if (!bars.length) return out;
  const rects = bars.map((b) => b.getBoundingClientRect());
  for (const el of document.querySelectorAll('main button, main a[href], main input, main select, main textarea, main [role="button"]')) {
    if (el.closest('.assist-fab, .tabbar, [role="dialog"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    for (const b of rects) {
      const ix = Math.min(r.right, b.right) - Math.max(r.left, b.left);
      const iy = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
      if (ix > 4 && iy > 4 && ix * iy > 0.5 * r.width * r.height) {
        out.push({ kind: 'covered', el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''), text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40), extra: 'under the floating button / tab bar at the end of the page' });
        break;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ run
const browser = await chromium.launch({ executablePath: EXEC });
const setupCtx = await browser.newContext();
const session = await signIn(setupCtx);
const storage = await setupCtx.storageState();
let list = [...(await targets(setupCtx, session.inst)), ...(flag('no-dialogs') ? [] : DIALOGS)];
if (ONLY.length) list = list.filter((t) => ONLY.some((o) => t.name === o || t.path === o || t.name.startsWith(o)));
await setupCtx.close();

const runs = [];
if (!flag('large-only')) for (const [w, h] of VIEWPORTS) for (const theme of THEMES) runs.push({ w, h, theme, large: false });
if (!flag('no-large')) runs.push({ w: 390, h: 844, theme: 'light', large: true });

const report = [];
for (const run of runs) {
  const tag = `${run.w}x${run.h}-${run.theme}${run.large ? '-large' : ''}`;
  const ctx = await browser.newContext({
    viewport: { width: run.w, height: run.h },
    deviceScaleFactor: 1,
    colorScheme: run.theme,
    reducedMotion: 'reduce',
    storageState: storage,
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
  for (const t of list) {
    const file = `${t.name.replace(/^\//, '').replace(/[^\w-]+/g, '_') || 'heute'}--${tag}.png`;
    const entry = { page: t.name, viewport: tag, issues: [], screenshot: file };
    try {
      // the app keeps an event stream open, so "networkidle" never comes – wait for the page instead
      await page.goto(BASE + t.path, { waitUntil: 'load', timeout: 20000 });
      await page.waitForSelector('main .page-fade, main, .login, .card', { timeout: 10000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"], .skeleton'), null, { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (t.open) {
        try {
          await t.open(page);
          await page.waitForSelector('[role="dialog"], .sheet', { timeout: 4000 });
          await page.waitForTimeout(400);
        } catch (e) {
          entry.issues.push({ kind: 'not-reached', el: '', text: '', extra: String(e.message ?? e).split('\n')[0] });
        }
      }
      entry.issues.push(...(await page.evaluate(detect)));
      if (!t.open) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(150);
        entry.issues.push(...(await page.evaluate(covered)));
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await page.screenshot({ path: path.join(OUT, file) });
      if (!t.open && (await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 40))) {
        const hide = await page.addStyleTag({ content: '.tabbar, .assist-fab, .fab-wrap { visibility: hidden !important; }' });
        await page.screenshot({ path: path.join(OUT, file.replace(/\.png$/, '.full.png')), fullPage: true });
        await hide.evaluate((n) => n.remove());
      }
    } catch (e) {
      entry.issues.push({ kind: 'error', el: '', text: '', extra: String(e.message ?? e).split('\n')[0] });
    }
    report.push(entry);
    const n = entry.issues.length;
    process.stdout.write(`${n ? '✗' : '✓'} ${tag} ${t.name}${n ? ` (${n})` : ''}\n`);
  }
  await ctx.close();
}
await browser.close();

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const md = ['# UI audit', '', `Base: ${BASE} · ${new Date().toISOString()}`, ''];
const total = report.reduce((s, e) => s + e.issues.length, 0);
md.push(`${report.length} page views, ${total} findings.`, '');
for (const e of report.filter((x) => x.issues.length)) {
  md.push(`## ${e.page} · ${e.viewport}`, '');
  for (const i of e.issues) md.push(`- **${i.kind}** \`${i.el}\` ${i.text ? `“${i.text}” ` : ''}${i.extra}`);
  md.push('');
}
fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n'));
console.log(`\n${total} findings in ${report.length} page views → ${path.join(OUT, 'report.md')}`);
process.exit(flag('strict') && total ? 1 : 0);
