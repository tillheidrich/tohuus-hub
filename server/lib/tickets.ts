/**
 * "Bons": receipt-style tickets (shopping list, kitchen ticket, care task, kid wish, recipe card, week plan, fridge note).
 * A ticket is a list of layout blocks; it renders to SVG (→ PNG via sharp, → 1-bit raster for ESC/POS)
 * and to plain monospace text (text-mode printing, Gotify, e-mail fallback). No prices: these are not cash receipts.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from './sharp-safe.js';
import { config } from '../config.js';
import { readImage } from './images.js';
import { brand, db, getSetting } from '../db.js';
import { locale, t } from '../i18n.js';
import { localDay } from './catalog.js';
import { careView, codeFor, getCareTask, qrUrl } from './care.js';
import { getPlan, weekDays } from './plan.js';
import { getRecipe } from './recipes.js';
import { storeView } from './shop.js';
import { qrMatrix, qrPath } from './qr.js';
import { effectiveFor } from './variants.js';

export const TICKET_TYPES = ['shopping', 'order', 'care', 'wish', 'recipe', 'week', 'note', 'test'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];
export const isTicketType = (s: unknown): s is TicketType => typeof s === 'string' && (TICKET_TYPES as readonly string[]).includes(s);

export type Paper = 58 | 80;
export const DOTS: Record<Paper, number> = { 58: 384, 80: 576 };
/** printer font A columns – used for the plain-text rendering */
export const COLS: Record<Paper, number> = { 58: 32, 80: 48 };

export interface TicketSpec {
  type: TicketType;
  id?: number | null;
  /** shopping list: walking order of this store */
  store_id?: number | null;
  /** note: free text; week: start day (YYYY-MM-DD) */
  text?: string | null;
  title?: string | null;
  day?: string | null;
  /** who made it ("from Sam") */
  from?: string | null;
}

type Size = 's' | 'm' | 'l' | 'xl' | 'xxl';
type Align = 'left' | 'center';
export type Block =
  | { k: 'text'; text: string; size?: Size; bold?: boolean; align?: Align; /** shrink until the longest word fits */ fit?: boolean }
  | { k: 'banner'; text: string; size?: Size }
  | { k: 'rule'; style?: 'dash' | 'solid' | 'double' }
  | { k: 'kv'; left: string; right: string; bold?: boolean }
  | { k: 'check'; text: string; sub?: string | null }
  | { k: 'item'; qty: string; text: string; subs?: string[]; plain?: boolean }
  | { k: 'qr'; url: string; caption?: string }
  | { k: 'space'; h?: number }
  | { k: 'image'; png: Buffer; w: number; h: number };

export interface Ticket {
  type: TicketType;
  title: string;
  /** short file name stem, e.g. "einkaufszettel" */
  file: string;
  blocks: Block[];
  /** used as photo caption / mail subject */
  summary: string;
}

const FONT = 'DejaVu Sans Mono, Liberation Mono, Menlo, Consolas, monospace';
const PX: Record<Size, number> = { s: 18, m: 22, l: 30, xl: 40, xxl: 58 };
const CHAR = 0.602; // advance of DejaVu Sans Mono per em

// ---------------------------------------------------------------- helpers

// control characters are not allowed in XML: one in a guest's name used to make librsvg fail the whole ticket
const xml = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Word wrap for a monospace column count; very long words are split. */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while ([...word].length > cols) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push([...word].slice(0, cols).join(''));
        word = [...word].slice(cols).join('');
      }
      if (!line) line = word;
      else if ([...line].length + 1 + [...word].length <= cols) line += ' ' + word;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

const len = (s: string) => [...s].length;

function stamp(d = new Date()) {
  const f = new Intl.DateTimeFormat(locale(), { timeZone: config.timezone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return f.format(d);
}
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(day + 'T12:00:00Z'));
const sqlDate = (s: string) => new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
const num = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: 2 });

const SECTION_LABEL: Record<string, string> = {
  produce: 'Fruit & veg',
  bakery: 'Bread & bakery',
  chilled: 'Dairy & chilled',
  frozen: 'Frozen',
  pantry: 'Pantry & cans',
  snacks: 'Snacks & sweets',
  drinks: 'Drinks',
  drugstore: 'Drugstore',
  household: 'Household',
  other: 'Other',
  elsewhere: 'Other stores',
};

/** One store every open item was marked for ("Where to buy?") – then the slip may name it. Otherwise none. */
export function commonStore(lists: string[][]): string | null {
  if (!lists.length || lists.some((l) => !l.length)) return null;
  const [first, ...rest] = lists;
  const n = (s: string) => s.trim().toLowerCase();
  const hit = first.find((s) => rest.every((l) => l.some((x) => n(x) === n(s))));
  return hit ?? null;
}

const household = () => getSetting<string>('household.name', '') || t('Our home');
const fredi = () => brand() === 'fredirando';

function header(title: string, meta: [string, string][] = []): Block[] {
  const b: Block[] = [
    { k: 'text', text: fredi() ? 'FREDIRANDO' : 'TOHUUS HUB', size: 's', bold: true, align: 'center' },
    { k: 'text', text: household(), size: 'l', bold: true, align: 'center' },
    { k: 'rule', style: 'double' },
    { k: 'banner', text: title.toLocaleUpperCase(locale()) },
    { k: 'space', h: 6 },
    { k: 'kv', left: t('Date'), right: stamp() },
    ...meta.map(([l, r]): Block => ({ k: 'kv', left: l, right: r })),
    { k: 'rule', style: 'dash' },
  ];
  return b;
}

function footer(url: string | null, caption: string, note?: string): Block[] {
  const b: Block[] = [{ k: 'rule', style: 'dash' }];
  // a QR only makes sense with an absolute address the phone can open
  if (url && /^https?:\/\//.test(url)) b.push({ k: 'qr', url, caption });
  b.push({ k: 'text', text: note ?? t('Not a till receipt · made at home'), size: 's', align: 'center' });
  return b;
}

const appUrl = (p: string) => `${config.baseUrl}${p}`;

// ---------------------------------------------------------------- builders

class NotFound extends Error {
  status = 404;
}

function shoppingTicket(spec: TicketSpec): Ticket {
  // the store only sorts the aisles; which store an item is for comes from "Where to buy?" alone (set by people)
  const v = storeView(spec.store_id ?? null);
  const open = v.sections.flatMap((s) => s.items);
  const meta: [string, string][] = [];
  const shared = commonStore(open.map((i) => i.buy_at));
  if (shared) meta.push([t('Store'), shared]);
  meta.push([t('Items'), String(v.open)]);
  const body: Block[] = [];
  if (!v.open) body.push({ k: 'text', text: t('The shopping list is empty.'), align: 'center' });
  for (const s of v.sections) {
    body.push({ k: 'text', text: t(SECTION_LABEL[s.key] ?? 'Other').toLocaleUpperCase(locale()), size: 's', bold: true });
    for (const i of s.items) {
      const q = i.qty && i.qty !== 1 ? `${num(i.qty)} ` : '';
      const where = !shared && i.buy_at.length ? t('at {stores}', { stores: i.buy_at.join(', ') }) : null;
      const note = i.note && !/^\d/.test(i.note) ? i.note : null;
      body.push({ k: 'check', text: `${q}${i.product_name ?? i.text}`, sub: [note, where].filter(Boolean).join(' · ') || null });
    }
    body.push({ k: 'space', h: 6 });
  }
  return {
    type: 'shopping',
    title: t('Shopping slip'),
    file: 'shopping-list',
    summary: t('Shopping list ({n})', { n: v.open }),
    blocks: [...header(t('Shopping slip'), meta), ...body, ...footer(appUrl('/einkauf'), t('Open the list in the app'), spec.from ? t('Thanks, {name}!', { name: spec.from }) : undefined)],
  };
}

interface OrderRow {
  id: number;
  guest_name: string;
  note: string | null;
  created_at: string;
  user_id: number | null;
  party_id: number | null;
  guest_link_id: number | null;
  for_user_id?: number | null;
}

/**
 * Who ordered. Every order carries a name since wave 6 (guests must give one), and the kitchen ticket is for the
 * people preparing it – so the name is always printed, also at parties (the public party board still follows the
 * party's "show names" switch).
 */
export function orderWho(o: OrderRow): { name: string | null; sofa: boolean } {
  return { name: o.guest_name?.trim() || null, sofa: Boolean(o.user_id) };
}

function orderTicket(spec: TicketSpec): Ticket {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(spec.id)) as OrderRow | undefined;
  if (!o) throw new NotFound(t('Order not found'));
  const lines = db.prepare('SELECT name, qty, options, note FROM order_lines WHERE order_id = ? ORDER BY id').all(o.id) as { name: string; qty: number; options: string; note: string | null }[];
  const who = orderWho(o);
  const no = `#${String(o.id).padStart(3, '0')}`;
  const time = new Intl.DateTimeFormat(locale(), { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }).format(sqlDate(o.created_at));
  // a household request ("bring me a vanilla ice cream") is a wish slip, not a kitchen order
  const home = !o.guest_link_id && !o.party_id;
  const title = fredi() ? t('Delivery note') : home ? t('Please bring') : t('Kitchen ticket');
  const meta: [string, string][] = [
    [home ? t('Wish') : t('Order'), no],
    [home ? t('Asked at') : t('Ordered at'), time],
  ];
  if (fredi()) meta.push([t('Delivery to'), who.sofa ? t('Sofa') : (who.name ?? t('Guest'))]);
  else if (who.name) meta.push([home ? t('For') : who.sofa ? t('From') : t('Guest'), who.name]);
  const asked = home && o.for_user_id ? (db.prepare('SELECT name FROM users WHERE id = ?').get(o.for_user_id) as { name: string } | undefined)?.name : null;
  if (asked) meta.push([t('Who brings it'), asked]);
  const body: Block[] = [{ k: 'text', text: no, size: 'xl', bold: true, align: 'center' }, { k: 'space', h: 4 }];
  for (const l of lines) {
    let opts: string[] = [];
    try {
      opts = JSON.parse(l.options);
    } catch {
      /* ignore */
    }
    body.push({ k: 'item', qty: `${l.qty}×`, text: l.name, subs: [...opts.map((x) => `+ ${x}`), ...(l.note ? [`„${l.note}“`] : [])] });
  }
  if (o.note) {
    body.push({ k: 'space', h: 6 });
    body.push({ k: 'text', text: t('Wish: {note}', { note: o.note }), bold: true });
  }
  if (fredi()) body.push({ k: 'space', h: 6 }, { k: 'kv', left: t('Courier'), right: spec.from ?? t('the household') }, { k: 'kv', left: t('Tip'), right: t('a smile') });
  return {
    type: 'order',
    title,
    file: fredi() ? 'delivery-note' : 'kitchen-ticket',
    summary: `${title} ${no}`,
    blocks: [...header(title, meta), ...body, ...footer(appUrl(home ? '/bestellen' : '/bar'), home ? t('Open in the app') : t('Open the order board'), fredi() ? t('Thanks for ordering with Fredirando!') : undefined)],
  };
}

function careTicket(spec: TicketSpec, actor?: string): Ticket {
  const row = getCareTask(Number(spec.id));
  if (!row) throw new NotFound(t('Task not found'));
  const c = careView(row);
  const meta: [string, string][] = [];
  if (c.next_due) meta.push([t('Due'), dayLabel(c.next_due)]);
  if (c.assignee) meta.push([t('Who'), c.assignee.name]);
  const body: Block[] = [{ k: 'text', text: c.name, size: 'l', bold: true }];
  if (c.location) body.push({ k: 'kv', left: t('Where'), right: c.location.name });
  if (c.product) {
    const stock = c.product.stock != null && c.product.track_mode === 'count' ? ` (${t('{n} in the house', { n: num(c.product.stock) })})` : '';
    body.push({ k: 'kv', left: t('You need'), right: '' }, { k: 'check', text: `${c.consume_qty && c.consume_qty !== 1 ? `${num(c.consume_qty)} × ` : ''}${c.product.name}${stock}` });
  }
  if (c.note) {
    // a multi-line note reads as steps – each one gets a box
    const lines = c.note.split('\n').map((l) => l.trim()).filter(Boolean);
    body.push({ k: 'space', h: 6 });
    if (lines.length > 1) body.push(...lines.map((l): Block => ({ k: 'check', text: l.replace(/^[-*•\d.)\s]+/, '') || l })));
    else body.push({ k: 'text', text: lines[0] ?? '' });
  }
  if (c.interval_n && c.interval_unit) body.push({ k: 'space', h: 4 }, { k: 'text', text: ({ day: t('Repeats every {n} days', { n: c.interval_n }), week: t('Repeats every {n} weeks', { n: c.interval_n }), month: t('Repeats every {n} months', { n: c.interval_n }), year: t('Repeats every {n} years', { n: c.interval_n }) })[c.interval_unit], size: 's' });
  const code = codeFor('care', c.id, actor);
  return {
    type: 'care',
    title: t('Care ticket'),
    file: 'care-ticket',
    summary: `${t('Care ticket')}: ${c.name}`,
    blocks: [...header(t('Care ticket'), meta), ...body, ...footer(qrUrl(code), t('Scan when done'))],
  };
}

async function picture(imagePath: string | null | undefined, w: number): Promise<Block | null> {
  const f = readImage(imagePath);
  if (!f) return null;
  try {
    const png = await sharp(f).resize({ width: w, height: w, fit: 'inside' }).flatten({ background: '#ffffff' }).greyscale().normalise().png().toBuffer({ resolveWithObject: true });
    return { k: 'image', png: png.data, w: png.info.width, h: png.info.height };
  } catch {
    return null;
  }
}

async function wishTicket(spec: TicketSpec, paper: Paper): Promise<Ticket> {
  const w = db
    .prepare(
      `SELECT w.id, w.name, w.qty, w.status, w.created_at, k.name AS kid_name, p.image_path
       FROM kid_wishes w JOIN kid_profiles k ON k.id = w.kid_id LEFT JOIN products p ON p.id = w.product_id WHERE w.id = ?`,
    )
    .get(Number(spec.id)) as { id: number; name: string; qty: number; status: string; created_at: string; kid_name: string; image_path: string | null } | undefined;
  if (!w) throw new NotFound(t('Wish not found'));
  const pic = await picture(w.image_path, Math.round(DOTS[paper] * 0.6));
  const body: Block[] = [
    { k: 'text', text: t('{name} wishes for', { name: w.kid_name }), size: 'l', align: 'center' },
    { k: 'space', h: 8 },
    ...(pic ? [pic, { k: 'space', h: 8 } as Block] : []),
    { k: 'text', text: `${w.qty > 1 ? `${w.qty}× ` : ''}${w.name}`, size: 'xxl', bold: true, align: 'center', fit: true },
    { k: 'space', h: 10 },
    { k: 'text', text: w.status === 'approved' ? t('Yes – coming right up!') : w.status === 'declined' ? t('Not right now.') : t('Waiting for a yes'), size: 'l', align: 'center' },
  ];
  return {
    type: 'wish',
    title: t('Wish ticket'),
    file: 'wish',
    summary: t('{name} wishes for {item}', { name: w.kid_name, item: w.name }),
    blocks: [...header(t('Wish ticket')), ...body, ...footer(null, '', t('Made with love at home'))],
  };
}

function recipeTicket(spec: TicketSpec): Ticket {
  const r = getRecipe(Number(spec.id));
  if (!r) throw new NotFound(t('Recipe not found'));
  // the household's own variant (swaps, "without onions") if the variants module knows the recipe
  let ings: { text: string; qty: number | null; unit: string | null; optional: boolean; changed: boolean }[] = (r.ingredients as any[]).map((i) => ({
    text: i.text,
    qty: i.qty ?? null,
    unit: i.unit ?? null,
    optional: Boolean(i.optional),
    changed: false,
  }));
  let variant = false;
  try {
    const eff = effectiveFor(r.id);
    if (eff) {
      ings = eff.filter((i) => i.change !== 'remove').map((i) => ({ text: i.text, qty: i.qty, unit: i.unit, optional: i.optional, changed: i.change !== 'none' }));
      variant = eff.some((i) => i.change !== 'none');
    }
  } catch {
    /* variants are optional */
  }
  const meta: [string, string][] = [];
  if (r.servings) meta.push([t('Servings'), String(r.servings)]);
  if (r.time_min) meta.push([t('Time'), t('{n} min', { n: r.time_min })]);
  const body: Block[] = [{ k: 'text', text: r.title, size: 'l', bold: true }];
  if (variant) body.push({ k: 'text', text: t('Our version'), size: 's', bold: true });
  body.push({ k: 'space', h: 6 }, { k: 'text', text: t('Ingredients').toLocaleUpperCase(locale()), size: 's', bold: true });
  for (const i of ings) {
    const amount = i.qty != null && !new RegExp(`^\\s*${String(i.qty).replace('.', '[.,]')}`).test(i.text) ? `${num(i.qty)}${i.unit ? ` ${i.unit}` : ''} ` : '';
    body.push({ k: 'check', text: `${amount}${i.text}${i.changed ? ' *' : ''}`, sub: i.optional ? t('optional') : null });
  }
  const steps = (r.steps as { text: string; tm?: { time?: string | null; temp?: string | null; speed?: string | null } | null }[]) ?? [];
  if (steps.length) {
    body.push({ k: 'space', h: 8 }, { k: 'text', text: t('Steps').toLocaleUpperCase(locale()), size: 's', bold: true });
    steps.forEach((s, n) => {
      const tm = s.tm ? [s.tm.time, s.tm.temp, s.tm.speed ? `${t('speed')} ${s.tm.speed}` : null].filter(Boolean).join(' / ') : '';
      body.push({ k: 'item', qty: `${n + 1}.`, text: s.text, subs: tm ? [tm] : [], plain: true });
    });
  }
  if (variant) body.push({ k: 'space', h: 4 }, { k: 'text', text: t('* changed in our version'), size: 's' });
  return {
    type: 'recipe',
    title: t('Recipe card'),
    file: 'recipe',
    summary: r.title,
    blocks: [...header(t('Recipe card'), meta), ...body, ...footer(appUrl(`/rezepte/${r.id}`), t('Open the recipe'))],
  };
}

function weekTicket(spec: TicketSpec): Ticket {
  const from = spec.day && /^\d{4}-\d\d-\d\d$/.test(spec.day) ? spec.day : localDay(0);
  const days = weekDays(from, 7);
  const plan = getPlan(days[0], days[6]);
  const body: Block[] = [];
  for (const d of days) {
    const entries = plan.filter((p) => p.day === d);
    body.push({ k: 'text', text: dayLabel(d), size: 's', bold: true });
    if (!entries.length) body.push({ k: 'text', text: '  –' });
    for (const e of entries) body.push({ k: 'check', text: e.title, sub: e.note });
    body.push({ k: 'space', h: 4 });
  }
  return {
    type: 'week',
    title: t('Week plan'),
    file: 'week-plan',
    summary: t('Week plan from {day}', { day: dayLabel(days[0]) }),
    blocks: [...header(t('Week plan'), [[t('Week'), `${dayLabel(days[0])} – ${dayLabel(days[6])}`]]), ...body, ...footer(appUrl('/kochen'), t('Open the week plan'))],
  };
}

function noteTicket(spec: TicketSpec): Ticket {
  const text = (spec.text ?? '').trim().slice(0, 1200);
  if (!text) throw Object.assign(new Error(t('Write a few words first.')), { status: 400 });
  const title = spec.title?.trim().slice(0, 40) || t('Fridge note');
  const big = len(text) <= 40;
  return {
    type: 'note',
    title,
    file: 'note',
    summary: title,
    blocks: [
      ...header(title, spec.from ? [[t('From'), spec.from]] : []),
      { k: 'space', h: 6 },
      { k: 'text', text, size: big ? 'xl' : 'm', bold: big, align: big ? 'center' : 'left', fit: true },
      { k: 'space', h: 6 },
      ...footer(null, '', t('Stick it on the fridge')),
    ],
  };
}

function testTicket(spec: TicketSpec, paper: Paper): Ticket {
  return {
    type: 'test',
    title: t('Test print'),
    file: 'test',
    summary: t('Test print'),
    blocks: [
      ...header(t('Test print'), [[t('Paper'), `${paper} mm`]]),
      { k: 'text', text: t('If you can read this, the printer works.'), bold: true },
      { k: 'space', h: 6 },
      { k: 'text', text: 'ÄÖÜ äöü ß · Å Ä Ö å ä ö · € é ñ' },
      { k: 'text', text: '1234567890'.repeat(5).slice(0, COLS[paper]), size: 's' },
      { k: 'check', text: t('Checkbox') },
      { k: 'item', qty: '2×', text: t('Example item'), subs: ['+ ' + t('option'), '„' + t('note') + '“'] },
      ...footer(config.baseUrl, t('Opens ToHuus Hub'), spec.from ? t('Printed by {name}', { name: spec.from }) : undefined),
    ],
  };
}

export async function buildTicket(spec: TicketSpec, paper: Paper = 58, actor?: string): Promise<Ticket> {
  switch (spec.type) {
    case 'shopping':
      return shoppingTicket(spec);
    case 'order':
      return orderTicket(spec);
    case 'care':
      return careTicket(spec, actor);
    case 'wish':
      return wishTicket(spec, paper);
    case 'recipe':
      return recipeTicket(spec);
    case 'week':
      return weekTicket(spec);
    case 'note':
      return noteTicket(spec);
    default:
      return testTicket(spec, paper);
  }
}

// ---------------------------------------------------------------- SVG layout

export function renderSvg(ticket: Ticket, paper: Paper): { svg: string; width: number; height: number } {
  const W = DOTS[paper];
  const PAD = paper === 58 ? 10 : 16;
  const CW = W - PAD * 2;
  const cols = (px: number, width = CW) => Math.max(4, Math.floor(width / (px * CHAR)));
  const el: string[] = [];
  let y = PAD + 4;
  const textEl = (s: string, x: number, yy: number, px: number, o: { bold?: boolean; anchor?: 'start' | 'middle' | 'end'; fill?: string } = {}) =>
    el.push(
      `<text x="${x}" y="${yy}" font-size="${px}" font-family="${FONT}"${o.bold ? ' font-weight="bold"' : ''}${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''}${o.fill ? ` fill="${o.fill}"` : ''} xml:space="preserve">${xml(s)}</text>`,
    );
  const lh = (px: number) => Math.round(px * 1.28);

  for (const b of ticket.blocks) {
    switch (b.k) {
      case 'text': {
        let px = PX[b.size ?? 'm'];
        if (b.fit) {
          const longest = Math.max(1, ...b.text.split(/\s+/).map(len));
          while (px > PX.m && cols(px) < longest) px -= 2;
        }
        for (const line of wrap(b.text, cols(px))) {
          y += lh(px);
          textEl(line, b.align === 'center' ? W / 2 : PAD, y - Math.round(px * 0.28), px, { bold: b.bold, anchor: b.align === 'center' ? 'middle' : 'start' });
        }
        break;
      }
      case 'banner': {
        const px = PX[b.size ?? 'l'];
        const lines = wrap(b.text, cols(px, CW - 12));
        const h = lines.length * lh(px) + 10;
        el.push(`<rect x="${PAD}" y="${y + 4}" width="${CW}" height="${h}" fill="#000"/>`);
        let yy = y + 4 + 5;
        for (const line of lines) {
          yy += lh(px);
          textEl(line, W / 2, yy - Math.round(px * 0.28), px, { bold: true, anchor: 'middle', fill: '#fff' });
        }
        y += h + 4;
        break;
      }
      case 'rule': {
        y += 12;
        if (b.style === 'double') el.push(`<rect x="${PAD}" y="${y - 3}" width="${CW}" height="2" fill="#000"/><rect x="${PAD}" y="${y + 2}" width="${CW}" height="2" fill="#000"/>`);
        else if (b.style === 'solid') el.push(`<rect x="${PAD}" y="${y - 1}" width="${CW}" height="2" fill="#000"/>`);
        else el.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#000" stroke-width="2" stroke-dasharray="7 5"/>`);
        y += 8;
        break;
      }
      case 'kv': {
        const px = PX.m;
        const c = cols(px);
        const right = b.right;
        const lines = wrap(b.left, c);
        if (len(b.left) + 1 + len(right) > c) {
          // long value: own line(s) under the label
          for (const l of lines) {
            y += lh(px);
            textEl(l, PAD, y - Math.round(px * 0.28), px, { bold: b.bold });
          }
          if (right) for (const r of wrap(right, c)) {
            y += lh(px);
            textEl(r, W - PAD, y - Math.round(px * 0.28), px, { anchor: 'end', bold: true });
          }
          break;
        }
        lines.forEach((l, i) => {
          y += lh(px);
          textEl(l, PAD, y - Math.round(px * 0.28), px, { bold: b.bold });
          if (i === 0 && right) textEl(right, W - PAD, y - Math.round(px * 0.28), px, { anchor: 'end', bold: true });
        });
        break;
      }
      case 'check': {
        const px = PX.m;
        const box = Math.round(px * 0.8);
        const indent = Math.round(px * 1.35);
        const lines = wrap(b.text, cols(px, CW - indent));
        y += 4;
        el.push(`<rect x="${PAD + 1}" y="${y + Math.round((lh(px) - box) / 2)}" width="${box}" height="${box}" fill="none" stroke="#000" stroke-width="2.5"/>`);
        for (const l of lines) {
          y += lh(px);
          textEl(l, PAD + indent, y - Math.round(px * 0.28), px);
        }
        if (b.sub)
          for (const s of wrap(b.sub, cols(PX.s, CW - indent))) {
            y += lh(PX.s);
            textEl(s, PAD + indent, y - Math.round(PX.s * 0.28), PX.s);
          }
        break;
      }
      case 'item': {
        const px = b.plain ? PX.m : PX.l;
        const qw = Math.round((len(b.qty) + 1) * px * CHAR);
        const lines = wrap(b.text, cols(px, CW - qw));
        y += 4;
        lines.forEach((l, i) => {
          y += lh(px);
          if (i === 0) textEl(b.qty, PAD, y - Math.round(px * 0.28), px, { bold: true });
          textEl(l, PAD + qw, y - Math.round(px * 0.28), px, { bold: !b.plain });
        });
        for (const s of b.subs ?? [])
          for (const l of wrap(s, cols(PX.m, CW - qw))) {
            y += lh(PX.m);
            textEl(l, PAD + qw, y - Math.round(PX.m * 0.28), PX.m);
          }
        break;
      }
      case 'qr': {
        const m = qrMatrix(b.url);
        const n = m.length + 8; // quiet zone of 4 modules
        const cell = Math.max(3, Math.floor(Math.min(CW * 0.5, 220) / n));
        const size = n * cell;
        const x0 = Math.round((W - size) / 2);
        y += 6;
        el.push(`<path d="${qrPath(m, x0 + 4 * cell, y + 4 * cell, cell)}" fill="#000"/>`);
        y += size;
        if (b.caption)
          for (const l of wrap(b.caption, cols(PX.s))) {
            y += lh(PX.s);
            textEl(l, W / 2, y - Math.round(PX.s * 0.28), PX.s, { anchor: 'middle' });
          }
        break;
      }
      case 'space':
        y += b.h ?? 10;
        break;
      case 'image': {
        const x0 = Math.round((W - b.w) / 2);
        el.push(`<image x="${x0}" y="${y}" width="${b.w}" height="${b.h}" href="data:image/png;base64,${b.png.toString('base64')}"/>`);
        y += b.h;
        break;
      }
    }
  }
  const height = Math.ceil(y + PAD + 8);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}"><rect width="100%" height="100%" fill="#fff"/>${el.join('')}</svg>`;
  return { svg, width: W, height };
}

/** PNG (for sharing and the browser preview) */
export async function renderPng(ticket: Ticket, paper: Paper): Promise<Buffer> {
  const { svg } = renderSvg(ticket, paper);
  return sharp(Buffer.from(svg), { density: 72 }).flatten({ background: '#ffffff' }).png({ compressionLevel: 9, palette: true }).toBuffer();
}

/** Grey pixels of the rendered ticket – input for the ESC/POS raster. */
export async function renderGrey(ticket: Ticket, paper: Paper): Promise<{ data: Buffer; width: number; height: number; photo: boolean }> {
  const { svg } = renderSvg(ticket, paper);
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 }).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, photo: ticket.blocks.some((b) => b.k === 'image') };
}

// ---------------------------------------------------------------- plain text

const center = (s: string, cols: number) => ' '.repeat(Math.max(0, Math.floor((cols - len(s)) / 2))) + s;

/** Monospace text version of a ticket (text-mode printing, Gotify, e-mail). QR codes become their link. */
export function renderText(ticket: Ticket, cols: number): string {
  const out: string[] = [];
  for (const b of ticket.blocks) {
    switch (b.k) {
      case 'text':
        for (const l of wrap(b.text, cols)) out.push(b.align === 'center' ? center(l, cols) : l);
        break;
      case 'banner':
        out.push(center(`*** ${b.text} ***`, cols));
        break;
      case 'rule':
        out.push((b.style === 'double' ? '=' : '-').repeat(cols));
        break;
      case 'kv': {
        if (len(b.left) + 1 + len(b.right) > cols) {
          out.push(...wrap(b.left, cols));
          if (b.right) out.push(...wrap(b.right, cols).map((r) => ' '.repeat(Math.max(0, cols - len(r))) + r));
          break;
        }
        out.push(b.right ? b.left + ' '.repeat(Math.max(1, cols - len(b.left) - len(b.right))) + b.right : b.left);
        break;
      }
      case 'check':
        wrap(b.text, cols - 4).forEach((l, i) => out.push((i === 0 ? '[ ] ' : '    ') + l));
        if (b.sub) out.push(...wrap(b.sub, cols - 4).map((l) => '    ' + l));
        break;
      case 'item': {
        const pad = len(b.qty) + 1;
        wrap(b.text, cols - pad).forEach((l, i) => out.push((i === 0 ? b.qty + ' ' : ' '.repeat(pad)) + l));
        for (const s of b.subs ?? []) out.push(...wrap(s, cols - pad).map((l) => ' '.repeat(pad) + l));
        break;
      }
      case 'qr':
        if (b.caption) out.push(center(b.caption, cols));
        out.push(b.url);
        break;
      case 'space':
        if (out[out.length - 1] !== '') out.push('');
        break;
      case 'image':
        break;
    }
  }
  return out.join('\n');
}
