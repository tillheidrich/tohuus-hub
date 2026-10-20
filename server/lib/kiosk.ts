/**
 * Everyday kitchen / wall display ("kiosk").
 *
 * An admin creates a display (name, layout, widgets, night hours) and gets a read-only URL /display/<token>.
 * The token is shown once and stored only as a sha256 hash (like API tokens and guest links).
 * The display page is server-rendered HTML with a tiny ES5 script, so it also runs on old tablets;
 * the same data feeds a server-rendered PNG for e-ink frames and Home Assistant.
 *
 * Privacy: a display only ever shows what its widgets list – no guest names, no notes, no spending,
 * member names only when the household allows names on the login screen (data area setting).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type OverlayOptions } from 'sharp';
import sharp from './sharp-safe.js';
import { config } from '../config.js';
import { db, getSetting, lang, migrate } from '../db.js';
import { locale, t } from '../i18n.js';
import { randomToken, sha256 } from './auth.js';
import { onEmit } from './bus.js';
import { dueCareTasks } from './care.js';
import { localDay } from './catalog.js';
import { showNamesOnLogin } from './data.js';
import { eatFirst } from './fresh.js';
import { overview } from './overview.js';
import { getPlan } from './plan.js';
import { householdAppearance } from './appearance.js';
import { ScopedMap } from './tenancy.js';

migrate(
  'kiosk-1',
  `CREATE TABLE displays (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    layout TEXT NOT NULL DEFAULT 'kitchen' CHECK (layout IN ('kitchen','hallway','minimal')),
    widgets TEXT NOT NULL DEFAULT '[]',
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL DEFAULT '',
    night_from TEXT,
    night_to TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT,
    last_seen_via TEXT
  );`,
);

// ---------------------------------------------------------------- model

export const LAYOUTS = ['kitchen', 'hallway', 'minimal'] as const;
export type Layout = (typeof LAYOUTS)[number];
// 'party' (banner of the former party mode) was dropped on 18 Oct 2026 – stored lists lose it in cleanWidgets()
export const WIDGETS = ['clock', 'meals', 'eat_first', 'low', 'shopping', 'care'] as const;
export type Widget = (typeof WIDGETS)[number];

/** What each layout shows unless the admin switches widgets off or on. */
export const LAYOUT_WIDGETS: Record<Layout, Widget[]> = {
  kitchen: ['clock', 'meals', 'eat_first', 'low', 'shopping'],
  hallway: ['clock', 'meals', 'shopping', 'care'],
  minimal: ['clock', 'meals', 'shopping'],
};

export interface DisplayRow {
  id: number;
  name: string;
  layout: Layout;
  widgets: string;
  token_hash: string;
  prefix: string;
  night_from: string | null;
  night_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  last_seen_via: string | null;
}

export interface DisplayInput {
  name?: string;
  layout?: Layout;
  widgets?: Widget[] | null;
  night_from?: string | null;
  night_to?: string | null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const httpError = (status: number, msg: string) => Object.assign(new Error(msg), { status });

function cleanWidgets(list: readonly string[] | null | undefined, layout: Layout): Widget[] {
  if (!list) return [...LAYOUT_WIDGETS[layout]];
  const set = new Set(list);
  return WIDGETS.filter((w) => set.has(w));
}

function cleanNight(v: string | null | undefined): string | null {
  return v && HHMM.test(v) ? v : null;
}

export function widgetsOf(d: Pick<DisplayRow, 'widgets' | 'layout'>): Widget[] {
  try {
    return cleanWidgets(JSON.parse(d.widgets), d.layout);
  } catch {
    return [...LAYOUT_WIDGETS[d.layout]];
  }
}

export const displayPath = (token: string) => `/display/${token}`;
export const displayUrl = (token: string) => `${config.baseUrl}${displayPath(token)}`;
export const imageUrl = (token: string, w = 800, h = 480, mode: ImageMode = 'gray') => `${config.baseUrl}/api/display/${token}/image.png?w=${w}&h=${h}&mode=${mode}`;

/** Admin view – never contains the token. */
export function displayView(d: DisplayRow) {
  return {
    id: d.id,
    name: d.name,
    layout: d.layout,
    widgets: widgetsOf(d),
    prefix: d.prefix,
    night_from: d.night_from,
    night_to: d.night_to,
    created_by: d.created_by,
    created_at: d.created_at,
    updated_at: d.updated_at,
    last_seen_at: d.last_seen_at,
    last_seen_via: d.last_seen_via,
  };
}
export type DisplayView = ReturnType<typeof displayView>;

export const getDisplay = (id: number) => db.prepare('SELECT * FROM displays WHERE id = ?').get(id) as DisplayRow | undefined;

export function listDisplays(): DisplayView[] {
  return (db.prepare('SELECT * FROM displays ORDER BY id').all() as DisplayRow[]).map(displayView);
}

function newToken() {
  const token = randomToken(24);
  return { token, hash: sha256(token), prefix: token.slice(0, 4) };
}

export function createDisplay(input: DisplayInput, actor: string) {
  const layout: Layout = input.layout && LAYOUTS.includes(input.layout) ? input.layout : 'kitchen';
  const name = (input.name ?? '').trim().slice(0, 60) || t('Kitchen display');
  const widgets = cleanWidgets(input.widgets, layout);
  // night hours: default 22:00–06:00; explicit null switches dimming off
  const from = input.night_from === undefined ? '22:00' : cleanNight(input.night_from);
  const to = input.night_to === undefined ? '06:00' : cleanNight(input.night_to);
  const tk = newToken();
  const id = Number(
    db
      .prepare('INSERT INTO displays (name, layout, widgets, token_hash, prefix, night_from, night_to, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, layout, JSON.stringify(widgets), tk.hash, tk.prefix, from && to ? from : null, from && to ? to : null, actor).lastInsertRowid,
  );
  return { display: displayView(getDisplay(id)!), token: tk.token };
}

export function updateDisplay(id: number, input: DisplayInput) {
  const d = getDisplay(id);
  if (!d) throw httpError(404, t('Display not found.'));
  const layout: Layout = input.layout && LAYOUTS.includes(input.layout) ? input.layout : d.layout;
  // switching the layout without a widget list resets the widgets to that layout's defaults
  const widgets = input.widgets !== undefined ? cleanWidgets(input.widgets, layout) : layout !== d.layout ? [...LAYOUT_WIDGETS[layout]] : widgetsOf(d);
  const name = input.name !== undefined ? input.name.trim().slice(0, 60) || d.name : d.name;
  let from = d.night_from;
  let to = d.night_to;
  if (input.night_from !== undefined) from = cleanNight(input.night_from);
  if (input.night_to !== undefined) to = cleanNight(input.night_to);
  if (!from || !to) from = to = null;
  db.prepare(`UPDATE displays SET name = ?, layout = ?, widgets = ?, night_from = ?, night_to = ?, updated_at = datetime('now') WHERE id = ?`).run(
    name,
    layout,
    JSON.stringify(widgets),
    from,
    to,
    id,
  );
  bumpVersion();
  return displayView(getDisplay(id)!);
}

/** New link for an existing display: the old URL stops working at once. */
export function rotateDisplay(id: number) {
  const d = getDisplay(id);
  if (!d) throw httpError(404, t('Display not found.'));
  const tk = newToken();
  db.prepare(`UPDATE displays SET token_hash = ?, prefix = ?, updated_at = datetime('now') WHERE id = ?`).run(tk.hash, tk.prefix, id);
  bumpVersion();
  return { display: displayView(getDisplay(id)!), token: tk.token };
}

/** Revoke: the display and its link are gone. */
export function deleteDisplay(id: number) {
  const n = db.prepare('DELETE FROM displays WHERE id = ?').run(id).changes;
  bumpVersion();
  return n > 0;
}

export function findDisplay(token: string | undefined | null): DisplayRow | undefined {
  if (!token || !TOKEN_RE.test(token)) return undefined;
  return db.prepare('SELECT * FROM displays WHERE token_hash = ?').get(sha256(token)) as DisplayRow | undefined;
}

/** "Last seen" – written at most once a minute per display. */
export function touchDisplay(id: number, via: 'screen' | 'image' | 'json') {
  db.prepare(
    `UPDATE displays SET last_seen_at = datetime('now'), last_seen_via = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-60 seconds') OR last_seen_via IS NOT ?)`,
  ).run(via, id, via);
}

// ---------------------------------------------------------------- time helpers

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Minutes since midnight in the household's time zone. */
export function localMinutes(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** Inside the night window? Handles windows across midnight (22:00–06:00). */
export function isNight(from: string | null, to: string | null, minutes: number) {
  if (!from || !to || !HHMM.test(from) || !HHMM.test(to)) return false;
  const a = minutesOf(from);
  const b = minutesOf(to);
  if (a === b) return false;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

export function greetingKey(minutes: number) {
  const h = Math.floor(minutes / 60);
  if (h >= 5 && h < 11) return 'Good morning';
  if (h >= 11 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 22) return 'Good evening';
  return 'Good night';
}

const fmtTime = (nowMs: number) => new Intl.DateTimeFormat(locale(), { timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(nowMs));
const fmtDate = (nowMs: number) => new Intl.DateTimeFormat(locale(), { timeZone: config.timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(nowMs));

function inDays(days: number | null, past: 'overdue' | 'expired' = 'overdue') {
  if (days === null) return '';
  if (days < 0) return past === 'expired' ? t('expired') : days === -1 ? t('since yesterday') : t('overdue by {n} days', { n: -days });
  if (days === 0) return t('today');
  if (days === 1) return t('tomorrow');
  return t('in {n} days', { n: days });
}

// ---------------------------------------------------------------- data (only what the widgets need)

export interface DisplayData {
  display: { name: string; layout: Layout; widgets: Widget[]; night_from: string | null; night_to: string | null };
  household: string;
  language: string;
  now: string;
  time: string;
  date: string;
  greeting: string;
  night: boolean;
  meals?: { today: MealItem[]; tomorrow: MealItem[] };
  eat_first?: { items: { name: string; image_path: string | null; when: string; urgent: boolean; leftover: boolean; opened: boolean }[]; more: number };
  low?: { empty: number; low: number; items: { name: string; image_path: string | null; status: 'low' | 'empty' }[] };
  shopping?: { count: number; items: string[] };
  care?: { count: number; items: { name: string; state: string; when: string; who: string | null }[] };
}
interface MealItem {
  title: string;
  slot: string;
  slot_label: string;
  image_path: string | null;
  cooked: boolean;
}

export function displayData(d: DisplayRow, nowMs = Date.now()): DisplayData {
  const widgets = widgetsOf(d);
  const on = (w: Widget) => widgets.includes(w);
  const minutes = localMinutes(nowMs);
  const out: DisplayData = {
    display: { name: d.name, layout: d.layout, widgets, night_from: d.night_from, night_to: d.night_to },
    household: getSetting('household.name', t('Our home')),
    language: lang(),
    now: new Date(nowMs).toISOString(),
    time: fmtTime(nowMs),
    date: fmtDate(nowMs),
    greeting: t(greetingKey(minutes)),
    night: isNight(d.night_from, d.night_to, minutes),
  };
  if (on('meals')) {
    const today = localDay(0);
    const tomorrow = localDay(1);
    const rows = getPlan(today, tomorrow);
    const meal = (r: (typeof rows)[number]): MealItem => ({
      title: r.title,
      slot: r.slot,
      slot_label: r.slot === 'mittag' ? t('Lunch') : t('Dinner'),
      image_path: r.image_path ?? null,
      cooked: Boolean(r.cooked),
    });
    out.meals = { today: rows.filter((r) => r.day === today).map(meal), tomorrow: rows.filter((r) => r.day === tomorrow).map(meal) };
  }
  if (on('eat_first')) {
    const list = eatFirst({ limit: 30 });
    out.eat_first = {
      items: list.slice(0, 6).map((x) => ({
        name: x.name,
        image_path: x.image_path,
        when: x.kind === 'leftover' && x.days_left === null ? t('leftover') : inDays(x.days_left, 'expired'),
        urgent: x.days_left !== null && x.days_left <= 1,
        leftover: x.kind === 'leftover',
        opened: x.opened,
      })),
      more: Math.max(0, list.length - 6),
    };
  }
  if (on('low') || on('shopping')) {
    const ov = overview();
    if (on('low')) {
      const att = ov.attention.filter((a) => a.status === 'low' || a.status === 'empty');
      out.low = {
        empty: ov.counts.empty,
        low: ov.counts.low,
        items: att.slice(0, 8).map((a) => ({ name: a.name, image_path: a.image_path, status: a.status as 'low' | 'empty' })),
      };
    }
    if (on('shopping')) out.shopping = { count: ov.counts.shopping, items: ov.shopping.map((s: { text: string }) => s.text).slice(0, 8) };
  }
  if (on('care')) {
    const names = showNamesOnLogin();
    // a shared display: no tasks for someone a member looks after (health data, carefor.ts)
    const due = dueCareTasks({ outside: true });
    out.care = {
      count: due.length,
      items: due.slice(0, 6).map((c) => ({ name: c.name, state: c.state, when: inDays(c.days), who: names ? (c.assignee?.name ?? null) : null })),
    };
  }
  return out;
}

// ---------------------------------------------------------------- fonts (self-hosted, from the web build)

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSET_DIRS = [path.join(here, 'web', 'assets'), path.join(here, '../../dist/web/assets'), path.join(process.cwd(), 'dist/web/assets')];
/** Pango (sharp text) cannot read WOFF2, so the PNG renderer uses TTF copies of the same OFL fonts (server/assets/fonts). */
const TTF_DIRS = [path.join(here, '../assets/fonts'), path.join(here, '../server/assets/fonts'), path.join(process.cwd(), 'server/assets/fonts')];

/** UI font Familjen Grotesk (variable), display font Hedvig Letters Serif – both SIL OFL 1.1, emitted by the Vite build. */
let fontCache: { webUi: string | null; webDisplay: string | null; file: string | null } | null = null;
function findIn(dirs: string[], re: RegExp) {
  for (const d of dirs) {
    try {
      const f = fs.readdirSync(d).find((n) => re.test(n));
      if (f) return { dir: d, name: f };
    } catch {
      /* not there */
    }
  }
  return null;
}
/** Font files: web URLs for the HTML page, a file path for the PNG renderer. Missing fonts fall back to system sans. */
export function fonts() {
  if (fontCache) return fontCache;
  const ui = findIn(ASSET_DIRS, /^familjen-grotesk-latin-wght-normal.*\.woff2$/);
  const disp = findIn(ASSET_DIRS, /^hedvig-letters-serif-latin-400-normal.*\.woff2$/);
  const ttf = findIn(TTF_DIRS, /^familjen-grotesk-latin-wght\.ttf$/);
  fontCache = {
    webUi: ui ? `/assets/${ui.name}` : null,
    webDisplay: disp ? `/assets/${disp.name}` : null,
    file: ttf ? path.join(ttf.dir, ttf.name) : null,
  };
  return fontCache;
}

// ---------------------------------------------------------------- HTML page (server-rendered, ES5-friendly)

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const safeImg = (p: string | null | undefined) => (p && /^\/img\/[A-Za-z0-9._\/-]+$/.test(p) ? p : null);

function thumb(p: string | null | undefined, cls = 'th') {
  const src = safeImg(p);
  return src ? `<span class="${cls}"><img src="${esc(src)}" alt="" loading="lazy"></span>` : `<span class="${cls} none"></span>`;
}

function card(key: string, title: string, body: string, extra = '') {
  return `<section class="card w-${key}"><h2>${esc(title)}${extra}</h2>${body}</section>`;
}

function mealsCard(d: DisplayData, withTomorrow: boolean) {
  const m = d.meals!;
  const block = (items: MealItem[], big: boolean) =>
    items.length
      ? items
          .map(
            (x) =>
              `<div class="meal ${big ? 'big' : ''} ${x.cooked ? 'done' : ''}">${safeImg(x.image_path) ? thumb(x.image_path, big ? 'th lg' : 'th') : ''}<div><div class="eyebrow">${esc(x.slot_label)}${x.cooked ? ` · ${esc(t('cooked'))}` : ''}</div><div class="mt">${esc(x.title)}</div></div></div>`,
          )
          .join('')
      : `<div class="none-txt">${esc(t('Nothing planned yet'))}</div>`;
  let html = `<div class="sub-h">${esc(t('Today'))}</div>${block(m.today, true)}`;
  if (withTomorrow) html += `<div class="sub-h">${esc(t('Tomorrow'))}</div>${block(m.tomorrow, false)}`;
  return card('meals', t('Meal plan'), html);
}

function eatFirstCard(d: DisplayData) {
  const e = d.eat_first!;
  const body = e.items.length
    ? `<ul class="rows">${e.items
        .map(
          (x) =>
            `<li>${thumb(x.image_path)}<span class="nm">${esc(x.name)}</span><span class="pill ${x.urgent ? 'hot' : x.leftover ? 'info' : ''}">${esc(x.when)}${x.opened ? ` · ${esc(t('opened'))}` : ''}</span></li>`,
        )
        .join('')}</ul>${e.more ? `<div class="more">${esc(t('+{n} more', { n: e.more }))}</div>` : ''}`
    : `<div class="none-txt">${esc(t('Nothing urgent – all good.'))}</div>`;
  return card('eat_first', t('Eat first'), body);
}

function lowCard(d: DisplayData) {
  const l = d.low!;
  const body = l.items.length
    ? `<div class="chips">${l.items.map((x) => `<span class="chip ${x.status}">${esc(x.name)}<small>${esc(x.status === 'empty' ? t('empty') : t('low'))}</small></span>`).join('')}</div>`
    : `<div class="none-txt">${esc(t('Everything is stocked.'))}</div>`;
  const n = l.empty + l.low;
  return card('low', t('Low & out'), body, n ? ` <span class="n">${n}</span>` : '');
}

function shoppingCard(d: DisplayData) {
  const s = d.shopping!;
  const body = s.count
    ? `<div class="big-n"><b>${s.count}</b><span>${esc(s.count === 1 ? t('item on the list') : t('items on the list'))}</span></div><ul class="list">${s.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${s.count > s.items.length ? `<div class="more">${esc(t('+{n} more', { n: s.count - s.items.length }))}</div>` : ''}`
    : `<div class="none-txt">${esc(t('The shopping list is empty.'))}</div>`;
  return card('shopping', t('Shopping list'), body);
}

function careCard(d: DisplayData) {
  const c = d.care!;
  const body = c.items.length
    ? `<ul class="rows">${c.items
        .map((x) => `<li><span class="dot ${esc(x.state)}"></span><span class="nm">${esc(x.name)}${x.who ? `<small>${esc(x.who)}</small>` : ''}</span><span class="pill ${x.state === 'overdue' ? 'hot' : ''}">${esc(x.when)}</span></li>`)
        .join('')}</ul>`
    : `<div class="none-txt">${esc(t('Nothing due at home.'))}</div>`;
  return card('care', t('Due at home'), body, c.count ? ` <span class="n">${c.count}</span>` : '');
}

/** The changing part of the page (refreshed by the script without reloading). */
export function mainHtml(d: DisplayData) {
  const w = new Set(d.display.widgets);
  const cols: string[][] = [];
  if (d.display.layout === 'kitchen') {
    cols.push(w.has('meals') ? [mealsCard(d, true)] : []);
    cols.push([...(w.has('eat_first') ? [eatFirstCard(d)] : []), ...(w.has('low') ? [lowCard(d)] : []), ...(w.has('care') ? [careCard(d)] : [])]);
    cols.push(w.has('shopping') ? [shoppingCard(d)] : []);
  } else if (d.display.layout === 'hallway') {
    cols.push([...(w.has('meals') ? [mealsCard(d, false)] : []), ...(w.has('eat_first') ? [eatFirstCard(d)] : [])]);
    cols.push([...(w.has('care') ? [careCard(d)] : []), ...(w.has('low') ? [lowCard(d)] : [])]);
    cols.push(w.has('shopping') ? [shoppingCard(d)] : []);
  } else {
    cols.push([...(w.has('meals') ? [mealsCard(d, true)] : [])]);
    cols.push([...(w.has('shopping') ? [shoppingCard(d)] : []), ...(w.has('care') ? [careCard(d)] : []), ...(w.has('eat_first') ? [eatFirstCard(d)] : []), ...(w.has('low') ? [lowCard(d)] : [])]);
  }
  const used = cols.filter((c) => c.length);
  if (!used.length) return `<div class="empty-all">${esc(t('No widgets switched on for this display.'))}</div>`;
  return used.map((c) => `<div class="col">${c.join('')}</div>`).join('');
}

export function fragment(d: DisplayData) {
  return { main: mainHtml(d), layout: d.display.layout, widgets: d.display.widgets, night_from: d.display.night_from, night_to: d.display.night_to, at: d.now };
}

const CSS = `
:root{--paper:#f7f5ef;--surface:#fffdf9;--surface-2:#efebe2;--ink:#181d1a;--ink-2:#454d48;--ink-3:#5b635d;--line:#dedcd3;--accent:#176b50;--accent-soft:#e4eee6;--empty:#9e2f24;--empty-soft:#f6e1dc;--empty-ink:#7a2219;--low:#a5502f;--low-soft:#f6e6dd;--low-ink:#7d3b21;--exp:#9a6400;--exp-soft:#f5ead2;--info:#2f5e7a;--info-soft:#e2ecf1;--hero:#104e3c;--hero-ink:#f7f5ef;--hero-2:#c9dccf;--fade:rgba(255,253,249,0);--shadow:none}
html.t-dark{--paper:#0f1513;--surface:#17201c;--surface-2:#1e2924;--ink:#eef0ea;--ink-2:#b3bdb6;--ink-3:#8f9a93;--line:#28332e;--accent:#74cda2;--accent-soft:#1c3229;--empty:#f08a7a;--empty-soft:#3a1d19;--empty-ink:#f6a597;--low:#e89a78;--low-soft:#3a2418;--low-ink:#f2b79c;--exp:#e4b05a;--exp-soft:#33290f;--exp-ink:#f0c777;--info:#8fb6d4;--info-soft:#1b2a36;--hero:#134a3a;--fade:rgba(23,32,28,0);--shadow:none}
@media (prefers-color-scheme:dark){html.t-system{--paper:#0f1513;--surface:#17201c;--surface-2:#1e2924;--ink:#eef0ea;--ink-2:#b3bdb6;--ink-3:#8f9a93;--line:#28332e;--accent:#74cda2;--accent-soft:#1c3229;--empty:#f08a7a;--empty-soft:#3a1d19;--empty-ink:#f6a597;--low:#e89a78;--low-soft:#3a2418;--low-ink:#f2b79c;--exp:#e4b05a;--exp-soft:#33290f;--exp-ink:#f0c777;--info:#8fb6d4;--info-soft:#1b2a36;--hero:#134a3a;--fade:rgba(23,32,28,0);--shadow:none}}
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px;font-size:calc(8px + 1.05vmin);-webkit-text-size-adjust:100%;background:var(--paper)}
body{font-family:'Familjen Grotesk Variable',-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:var(--ink);background:var(--paper);min-height:100vh;overflow:hidden;-webkit-font-smoothing:antialiased;cursor:default;-webkit-user-select:none;user-select:none}
#app{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-flex-direction:column;flex-direction:column;height:100vh;padding:2.2rem 2.4rem 1.2rem}
.top{display:-webkit-flex;display:flex;-webkit-align-items:flex-end;align-items:flex-end;-webkit-justify-content:space-between;justify-content:space-between;margin-bottom:1.6rem}
.time{font-family:'Hedvig Letters Serif',Georgia,serif;font-size:5.6rem;font-weight:400;line-height:.9;letter-spacing:-.02em;font-synthesis:none}
.date{font-size:1.5rem;color:var(--ink-2);margin-top:.5rem;font-weight:500}
.greet{text-align:right}
.greet b{display:block;font-family:'Hedvig Letters Serif',Georgia,serif;font-size:2.1rem;font-weight:400;letter-spacing:-.01em;font-synthesis:none}
.greet span{color:var(--ink-3);font-size:1.15rem}
#main{display:-webkit-flex;display:flex;-webkit-flex:1;flex:1;min-height:0;margin:0 -.6rem}
.col{-webkit-flex:1 1 0;flex:1 1 0;min-width:0;display:-webkit-flex;display:flex;-webkit-flex-direction:column;flex-direction:column;padding:0 .6rem}
.card{position:relative;-webkit-flex:none;flex:none;background:var(--surface);border-radius:.6rem;border:2px solid var(--ink);padding:1.4rem 1.5rem;margin-bottom:1.2rem;box-shadow:var(--shadow);overflow:hidden;min-height:0}
.col{overflow:hidden}
.col .card:last-child{-webkit-flex:1 1 auto;flex:1 1 auto;margin-bottom:0}
.card:after{content:'';position:absolute;left:0;right:0;bottom:0;height:1.4rem;background:-webkit-linear-gradient(var(--fade),var(--surface));background:linear-gradient(var(--fade),var(--surface))}
h2{font-size:1.05rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3);font-weight:600;margin-bottom:1rem}
h2 .n{display:inline-block;background:var(--ink);color:var(--paper);border-radius:999px;padding:0 .55rem;margin-left:.3rem;letter-spacing:0}
.eyebrow{font-size:.95rem;color:var(--ink-3);font-weight:500}
.sub-h{font-size:.95rem;font-weight:600;color:var(--ink-3);margin:1rem 0 .5rem}.sub-h:first-of-type{margin-top:0}
.meal{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;margin-bottom:.8rem}
.meal>div{min-width:0}
.meal .mt{font-size:1.45rem;font-weight:600;line-height:1.2;word-wrap:break-word;overflow-wrap:break-word;-webkit-hyphens:auto;hyphens:auto}
.meal.big .mt{font-family:'Hedvig Letters Serif',Georgia,serif;font-size:1.95rem;font-weight:400;font-synthesis:none;letter-spacing:-.01em;line-height:1.15}
.meal.done .mt{color:var(--ink-3)}
.th{display:inline-block;-webkit-flex:none;flex:none;width:3.2rem;height:3.2rem;border-radius:.4rem;background:var(--surface-2);overflow:hidden;margin-right:1rem}
.th.lg{width:6rem;height:6rem;border-radius:3rem 3rem .4rem .4rem}
.th img{width:100%;height:100%;object-fit:cover;display:block}
.th.none{background:var(--surface-2)}
.rows{list-style:none}
.rows li{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;-webkit-align-items:center;align-items:center;padding:.45rem 0;border-bottom:1px solid var(--line)}
.rows li:last-child{border-bottom:0}
.rows .th{width:2.6rem;height:2.6rem;margin-right:.8rem}
.nm{-webkit-flex:1 1 5em;flex:1 1 5em;min-width:0;padding-right:.6rem;font-size:1.3rem;font-weight:550;line-height:1.2;-webkit-hyphens:auto;hyphens:auto}
.nm small{display:block;font-size:.9rem;color:var(--ink-3);font-weight:500}
.pill{-webkit-flex:none;flex:none;margin:.15rem 0 .15rem auto;background:var(--surface-2);color:var(--ink-2);border-radius:.3rem;padding:.25rem .75rem;font-size:1rem;font-weight:600}
.pill.hot{background:var(--exp-soft);color:var(--exp)}.pill.info{background:var(--info-soft);color:var(--info)}
.dot{-webkit-flex:none;flex:none;width:.8rem;height:.8rem;border-radius:50%;background:var(--ink-3);margin-right:.8rem}
.dot.overdue{background:var(--empty)}.dot.today{background:var(--exp)}.dot.soon{background:var(--low)}
.chips{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;margin:-.25rem}
.chip{margin:.25rem;border-radius:.3rem;padding:.4rem .8rem;font-size:1.15rem;font-weight:550;background:var(--low-soft);color:var(--low-ink)}
.chip small{margin-left:.45rem;font-size:.85rem;opacity:.75}
.chip.empty{background:var(--empty-soft);color:var(--empty-ink)}
.big-n{display:-webkit-flex;display:flex;-webkit-align-items:baseline;align-items:baseline;margin-bottom:.8rem}
.big-n b{font-family:'Hedvig Letters Serif',Georgia,serif;font-size:3.6rem;line-height:1;font-weight:400;font-synthesis:none;margin-right:.6rem}
.big-n span{font-size:1.2rem;color:var(--ink-2)}
.list{list-style:none}
.list li{font-size:1.35rem;font-weight:500;padding:.4rem 0;border-bottom:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.list li:last-child{border-bottom:0}
.more{margin-top:.6rem;color:var(--ink-3);font-size:1rem}
.none-txt{color:var(--ink-3);font-size:1.25rem;padding:.4rem 0}
.empty-all{margin:auto;color:var(--ink-3);font-size:1.5rem}
.foot{display:-webkit-flex;display:flex;-webkit-justify-content:space-between;justify-content:space-between;color:var(--ink-3);font-size:.85rem;margin-top:.8rem}
.st:before{content:'';display:inline-block;width:.55rem;height:.55rem;border-radius:50%;background:var(--accent);margin-right:.4rem;vertical-align:middle}
.st.off:before{background:var(--low)}
.dim{position:fixed;left:0;top:0;right:0;bottom:0;background:#000;opacity:0;pointer-events:none;-webkit-transition:opacity 2s;transition:opacity 2s}
html.night .dim{opacity:.62}
html.night.awake .dim{opacity:.15}
.l-hallway .time{font-size:6.4rem}
.l-minimal .card{box-shadow:none;border:1px solid var(--line)}
h2:before{content:'';display:inline-block;width:.55rem;height:.55rem;background:var(--ink);margin-right:.55rem;vertical-align:.1rem}
@media (orientation:portrait){
 #app{padding:1.8rem 1.6rem 1rem}
 .top{-webkit-flex-direction:column;flex-direction:column;-webkit-align-items:flex-start;align-items:flex-start}
 .greet{text-align:left;margin-top:1rem}
 #main{-webkit-flex-direction:column;flex-direction:column;overflow:hidden}
 .col{-webkit-flex:none;flex:none;margin-bottom:1.2rem}
 .col .card:last-child{-webkit-flex:none;flex:none}
 .col:last-child{-webkit-flex:1;flex:1;min-height:0;margin-bottom:0}
 html{font-size:calc(8px + 1.15vmin)}
}
@media (max-width:600px){html{font-size:13px}.time{font-size:4.2rem}#app{height:auto;min-height:100vh}body{overflow:auto}}
`;

function fontFaces() {
  const f = fonts();
  let css = '';
  if (f.webUi) css += `@font-face{font-family:'Familjen Grotesk Variable';font-style:normal;font-display:swap;font-weight:400 700;src:url(${f.webUi}) format('woff2')}`;
  if (f.webDisplay) css += `@font-face{font-family:'Hedvig Letters Serif';font-style:normal;font-display:swap;font-weight:400;src:url(${f.webDisplay}) format('woff2')}`;
  return css;
}

/** Full page for /display/<token>. */
export function pageHtml(token: string, d: DisplayData) {
  const greets = JSON.stringify(['Good morning', 'Good afternoon', 'Good evening', 'Good night'].map((k) => t(k)));
  return `<!doctype html>
<html lang="${esc(d.language)}" class="l-${esc(d.display.layout)}${d.night ? ' night' : ''} t-${householdAppearance().theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="theme-color" content="${householdAppearance().theme === 'dark' ? '#111413' : '#f6f3ed'}">
<meta name="robots" content="noindex">
<title>${esc(d.display.name)} · ${esc(d.household)}</title>
<noscript><meta http-equiv="refresh" content="60"></noscript>
<style>${fontFaces()}${CSS}</style>
</head>
<body>
<div id="app" data-token="${esc(token)}" data-greet="${esc(greets)}" data-night-from="${esc(d.display.night_from ?? '')}" data-night-to="${esc(d.display.night_to ?? '')}" data-layout="${esc(d.display.layout)}" data-offline="${esc(t('offline – retrying'))}" data-live="${esc(t('live'))}">
<header class="top">
${d.display.widgets.includes('clock') ? `<div><div class="time" id="time">${esc(d.time)}</div><div class="date" id="date">${esc(d.date)}</div></div>` : '<div></div>'}
<div class="greet"><b id="greet">${esc(d.greeting)}</b><span>${esc(d.household)}</span></div>
</header>
<div id="main">${mainHtml(d)}</div>
<div class="foot"><span>${esc(d.display.name)}</span><span class="st" id="st">${esc(t('live'))}</span></div>
</div>
<div class="dim"></div>
<script src="/display-app.js" defer></script>
</body>
</html>`;
}

export function invalidHtml(language: string) {
  return `<!doctype html><html lang="${esc(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(t('Display'))}</title><style>body{font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f3ed;color:#121715;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}h1{font-size:28px;margin:0 0 8px}p{color:#5e6965;font-size:18px;margin:0}</style></head><body><div><h1>${esc(t('This display link is no longer valid.'))}</h1><p>${esc(t('Create a new link under Settings › Connections & devices › Displays & family tablet.'))}</p></div></body></html>`;
}

/**
 * Display script – plain ES5 so it runs on old iPads and Android tablets.
 * Clock, greeting and night dimming tick locally; data comes via SSE with a 60 s fallback poll.
 */
export const DISPLAY_JS = `(function(){
var app=document.getElementById('app');if(!app)return;
var token=app.getAttribute('data-token'),lang=document.documentElement.lang||'en',html=document.documentElement;
var greets=[];try{greets=JSON.parse(app.getAttribute('data-greet'))}catch(e){}
var nf=app.getAttribute('data-night-from'),nt=app.getAttribute('data-night-to'),layout=app.getAttribute('data-layout');
var st=document.getElementById('st');
function pad(n){return n<10?'0'+n:''+n}
function mins(s){if(!s||s.length<5)return null;return parseInt(s.substr(0,2),10)*60+parseInt(s.substr(3,2),10)}
function night(m){var a=mins(nf),b=mins(nt);if(a===null||b===null||a===b)return false;return a<b?(m>=a&&m<b):(m>=a||m<b)}
function cls(name,on){var c=' '+html.className+' ',has=c.indexOf(' '+name+' ')>=0;if(on&&!has)html.className=(html.className+' '+name).replace(/^\\s+/,'');if(!on&&has)html.className=c.replace(' '+name+' ',' ').replace(/^\\s+|\\s+$/g,'')}
function tick(){var d=new Date(),m=d.getHours()*60+d.getMinutes();
var te=document.getElementById('time');if(te)te.innerHTML=pad(d.getHours())+':'+pad(d.getMinutes());
var de=document.getElementById('date');if(de){try{de.innerHTML=d.toLocaleDateString(lang,{weekday:'long',day:'numeric',month:'long'})}catch(e){}}
var h=d.getHours(),g=document.getElementById('greet');if(g&&greets.length===4)g.innerHTML=greets[h>=5&&h<11?0:h>=11&&h<17?1:h>=17&&h<22?2:3];
cls('night',night(m))}
function status(ok){if(!st)return;st.className=ok?'st':'st off';st.innerHTML=app.getAttribute(ok?'data-live':'data-offline')}
var busy=false;
function load(){if(busy)return;busy=true;var x=new XMLHttpRequest();x.open('GET','/api/display/'+token+'/fragment?_='+new Date().getTime(),true);
x.onreadystatechange=function(){if(x.readyState!==4)return;busy=false;
if(x.status===200){try{var r=JSON.parse(x.responseText);if(r.layout!==layout){location.reload();return}
document.getElementById('main').innerHTML=r.main;nf=r.night_from||'';nt=r.night_to||'';status(true);tick()}catch(e){status(false)}}
else if(x.status===404){location.reload()}else{status(false)}};
try{x.send()}catch(e){busy=false;status(false)}}
var timer=null;function soon(){if(timer)clearTimeout(timer);timer=setTimeout(load,700)}
if(window.EventSource){try{var es=new EventSource('/api/display/'+token+'/events');es.addEventListener('change',soon);es.onopen=function(){status(true)};es.onerror=function(){status(false)}}catch(e){}}
setInterval(load,60000);setInterval(tick,10000);tick();
setTimeout(function(){location.reload()},6*3600*1000);
var lock=null;function wake(){try{if(navigator.wakeLock&&document.visibilityState==='visible'){navigator.wakeLock.request('screen').then(function(l){lock=l})['catch'](function(){})}}catch(e){}}
wake();document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'){wake();load()}});
var aw=null;function touch(){wake();cls('awake',true);if(aw)clearTimeout(aw);aw=setTimeout(function(){cls('awake',false)},30000)}
document.addEventListener('click',touch);document.addEventListener('touchstart',touch);
})();`;

// ---------------------------------------------------------------- PNG for e-ink frames and Home Assistant

export type ImageMode = 'bw' | 'gray' | 'color';
export interface ImageOpts {
  w: number;
  h: number;
  mode: ImageMode;
}

let version = 0;
const bumpVersion = () => {
  version++;
};
onEmit(() => bumpVersion());
const pngCache = new ScopedMap<string, { at: number; v: number; buf: Buffer }>();
const CACHE_MS = 60_000;

const pango = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
function clip(s: string, max: number) {
  const x = s.replace(/\s+/g, ' ').trim();
  return x.length > max ? x.slice(0, Math.max(1, max - 1)).trimEnd() + '…' : x;
}

interface TextOpts {
  x: number;
  y: number;
  size: number;
  weight?: number;
  color?: string;
  maxW: number;
  lines?: number;
}

/** Server-side PNG of the minimal layout. Text goes through Pango with the self-hosted Familjen Grotesk font file. */
export async function renderPng(d: DisplayData, o: ImageOpts): Promise<Buffer> {
  const W = Math.round(o.w);
  const H = Math.round(o.h);
  const portrait = H > W * 1.1;
  const s = portrait ? Math.min(W / 480, H / 800) : Math.min(W / 800, H / 480);
  const pad = Math.round(28 * s);
  const ink = '#000000';
  const ink2 = o.mode === 'bw' ? '#000000' : '#555555';
  const line = o.mode === 'bw' ? '#000000' : '#bbbbbb';
  const font = fonts().file;
  const layers: OverlayOptions[] = [];
  const shapes: string[] = [];

  const text = async (str: string, t0: TextOpts) => {
    if (!str) return 0;
    const lines = t0.lines ?? 1;
    const approx = Math.max(4, Math.floor((t0.maxW / (t0.size * 0.56)) * lines));
    const markup = `<span foreground="${t0.color ?? ink}" weight="${t0.weight ?? 400}">${pango(clip(str, approx))}</span>`;
    try {
      const img = sharp({
        text: { text: markup, font: `Familjen Grotesk ${Math.max(6, Math.round(t0.size))}px`, ...(font ? { fontfile: font } : {}), width: Math.max(10, Math.round(t0.maxW)), rgba: true, wrap: 'word', dpi: 72 },
      });
      let { data, info } = await img.png().toBuffer({ resolveWithObject: true });
      const maxH = Math.round(t0.size * 1.3 * lines);
      const left = Math.round(t0.x);
      const top = Math.round(t0.y);
      const cw = Math.min(info.width, W - left);
      const ch = Math.min(info.height, maxH, H - top);
      if (cw <= 0 || ch <= 0) return 0;
      if (cw < info.width || ch < info.height) data = await sharp(data).extract({ left: 0, top: 0, width: cw, height: ch }).png().toBuffer();
      layers.push({ input: data, left, top });
      return ch;
    } catch {
      return 0;
    }
  };

  // header: weekday + date (big), household + "as of" (small) – e-ink refreshes slowly, so no big clock
  let y = pad;
  const headSize = Math.min(40 * s, (W - pad * 2) / Math.max(8, d.date.length * 0.6));
  const headH = await text(d.date, { x: pad, y, size: headSize, weight: 700, maxW: W - pad * 2 });
  y += Math.max(headH, headSize * 1.1) + Math.round(4 * s);
  await text(`${d.household} · ${t('as of {time}', { time: d.time })}`, { x: pad, y, size: 18 * s, color: ink2, maxW: W - pad * 2 });
  y += Math.round(30 * s);
  shapes.push(`<rect x="${pad}" y="${y}" width="${W - pad * 2}" height="${Math.max(1, Math.round(2 * s))}" fill="${ink}"/>`);
  y += Math.round(18 * s);

  // footer lines (care / eat first / low) – computed first to know how much room the columns get
  const foot: string[] = [];
  if (d.care && d.care.count) foot.push(`${t('Due at home')}: ${d.care.items.slice(0, 3).map((c) => `${c.name} (${c.when})`).join(', ')}`);
  if (d.eat_first && d.eat_first.items.length) foot.push(`${t('Eat first')}: ${d.eat_first.items.slice(0, 3).map((x) => `${x.name} (${x.when})`).join(', ')}`);
  if (d.low && d.low.items.length) foot.push(`${t('Low & out')}: ${d.low.items.slice(0, 4).map((x) => x.name).join(', ')}`);
  const footSize = 17 * s;
  const footH = foot.length ? foot.length * Math.round(footSize * 1.45) + Math.round(14 * s) : 0;
  const bodyBottom = H - pad - footH;

  // columns: meals | shopping (stacked in portrait)
  const hasMeals = Boolean(d.meals);
  const hasShop = Boolean(d.shopping);
  const gap = Math.round(24 * s);
  const both = hasMeals && hasShop;
  const colW = both && !portrait ? Math.floor((W - pad * 2 - gap) / 2) : W - pad * 2;
  let mealsBottom = y;
  if (hasMeals) {
    let my = y;
    const meal = async (label: string, items: MealItem[], big: boolean) => {
      await text(label.toUpperCase(), { x: pad, y: my, size: 15 * s, weight: 600, color: ink2, maxW: colW });
      my += Math.round(22 * s);
      if (!items.length) {
        await text(t('Nothing planned yet'), { x: pad, y: my, size: (big ? 22 : 18) * s, color: ink2, maxW: colW });
        my += Math.round((big ? 34 : 28) * s);
      }
      for (const m of items.slice(0, 2)) {
        const prefix = items.length > 1 || m.slot === 'mittag' ? `${m.slot_label}: ` : '';
        const h = await text(`${prefix}${m.title}`, { x: pad, y: my, size: (big ? 28 : 20) * s, weight: big ? 700 : 500, maxW: colW, lines: big ? 2 : 1 });
        my += Math.max(h, (big ? 28 : 20) * s * 1.2) + Math.round(6 * s);
      }
      my += Math.round(10 * s);
    };
    await meal(t('Today'), d.meals!.today, true);
    if (my < bodyBottom - 50 * s) await meal(t('Tomorrow'), d.meals!.tomorrow, false);
    mealsBottom = my;
  }
  if (hasShop) {
    const sx = both && !portrait ? pad + colW + gap : pad;
    let sy = both && portrait ? mealsBottom + Math.round(6 * s) : y;
    if (both && !portrait) shapes.push(`<rect x="${pad + colW + Math.round(gap / 2)}" y="${y}" width="${Math.max(1, Math.round(1.5 * s))}" height="${Math.max(0, bodyBottom - y - 10 * s)}" fill="${line}"/>`);
    const sw = both && !portrait ? colW : W - pad * 2;
    await text(t('Shopping list').toUpperCase(), { x: sx, y: sy, size: 15 * s, weight: 600, color: ink2, maxW: sw });
    sy += Math.round(22 * s);
    const sh = d.shopping!;
    if (!sh.count) {
      await text(t('The shopping list is empty.'), { x: sx, y: sy, size: 20 * s, color: ink2, maxW: sw });
    } else {
      await text(String(sh.count), { x: sx, y: sy - 4 * s, size: 44 * s, weight: 700, maxW: sw });
      await text(sh.count === 1 ? t('item on the list') : t('items on the list'), { x: sx + (String(sh.count).length * 26 + 14) * s, y: sy + 16 * s, size: 18 * s, color: ink2, maxW: sw - 60 * s });
      sy += Math.round(58 * s);
      const rowH = Math.round(29 * s);
      const room = Math.max(0, Math.floor((bodyBottom - sy) / rowH));
      const shown = sh.items.slice(0, Math.min(room, 8));
      for (const it of shown) {
        shapes.push(`<circle cx="${sx + 5 * s}" cy="${sy + 12 * s}" r="${Math.max(1.5, 4 * s)}" fill="${ink}"/>`);
        await text(it, { x: sx + 18 * s, y: sy, size: 20 * s, maxW: sw - 18 * s });
        sy += rowH;
      }
      const rest = sh.count - shown.length;
      if (rest > 0 && sy + rowH <= bodyBottom + rowH) await text(t('+{n} more', { n: rest }), { x: sx + 18 * s, y: sy, size: 16 * s, color: ink2, maxW: sw });
    }
  }

  if (foot.length) {
    let fy = H - pad - footH + Math.round(14 * s);
    shapes.push(`<rect x="${pad}" y="${fy - Math.round(10 * s)}" width="${W - pad * 2}" height="${Math.max(1, Math.round(1.5 * s))}" fill="${line}"/>`);
    for (const f of foot) {
      await text(f, { x: pad, y: fy, size: footSize, maxW: W - pad * 2 });
      fy += Math.round(footSize * 1.45);
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${shapes.join('')}</svg>`;
  // composite runs last in a sharp pipeline: materialise it, then drop alpha and reduce colours
  const flat = await sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
  const img = sharp(flat).flatten({ background: '#ffffff' }).removeAlpha();
  if (o.mode === 'bw') return img.greyscale().threshold(150).png({ palette: true, colours: 2, dither: 0 }).toBuffer();
  if (o.mode === 'gray') return img.greyscale().toColourspace('b-w').png().toBuffer();
  return img.png().toBuffer();
}

/** Cached PNG (60 s, dropped on any data change). */
export async function displayPng(d: DisplayRow, o: ImageOpts, nowMs = Date.now()) {
  const key = `${d.id}:${o.w}x${o.h}:${o.mode}`;
  const hit = pngCache.get(key);
  if (hit && hit.v === version && nowMs - hit.at < CACHE_MS) return hit.buf;
  const buf = await renderPng(displayData(d, nowMs), o);
  if (pngCache.size > 100) pngCache.clear();
  pngCache.set(key, { at: nowMs, v: version, buf });
  return buf;
}

// ---------------------------------------------------------------- status (MCP)

export function displayStatus() {
  return listDisplays().map((d) => ({
    id: d.id,
    name: d.name,
    layout: d.layout,
    widgets: d.widgets,
    night_dimming: d.night_from && d.night_to ? `${d.night_from}–${d.night_to}` : 'off',
    last_seen: d.last_seen_at ? `${d.last_seen_at} UTC` : 'never',
    last_seen_via: d.last_seen_via,
    link_starts_with: d.prefix,
  }));
}
