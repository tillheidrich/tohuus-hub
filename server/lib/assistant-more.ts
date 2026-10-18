/**
 * Assistant tools for what came on 17/18 Oct 2026 (Till: "Check bitte, dass der KI-Assistent das alles kann"):
 *  - „Wie kocht ihr?“ (cook-style.ts): cook_style_set – admins only, like Settings › Haushalt › Wie kocht ihr?
 *  - Kalender lesen (calsync.ts): calendar_status, calendar_change – household members (no guests), like the app;
 *    only the existing server functions (ignoreKind, reviveKind, setCalsyncSettings, requestRescan)
 *  - Bons (imports.ts): receipts_list, receipt_change (update / reopen / delete) – the receipts the person may see
 *
 * Rules: every write is something the person asked for, with an undo. Changing or deleting a receipt takes two
 * messages: the first call (without confirm) only says what would happen – what is taken back – and remembers that
 * it was asked; confirm=true works only in a later message (the person's yes), within 30 minutes.
 */
import { db, getSetting, setSetting } from '../db.js';
import { fmtDay, t } from '../i18n.js';
import type { ToolDef } from './ai.js';
import { emit } from './bus.js';
import { BIN_KINDS, binKindOf, calsyncSettings, calsyncView, ignoreKind, kindState, requestRescan, reviveKind, setCalsyncSettings, type BinOffset } from './calsync.js';
import { localDay } from './catalog.js';
import { COOK_STYLES, setCookStyles, type CookStyle } from './cook-style.js';
import { applyImport, deleteImport, reopenImport, updateImportHead } from './imports.js';
import { fmtMoney } from './money.js';
import { receiptVisible, VISIBLE_TO } from './spending.js';
import { addDays } from './spend2.js';
import { norm } from './text.js';

type Ctx = { actor: string; userId: number | null; admin?: boolean; guest?: boolean; turnStart?: number };
type Rec = (kind: string, summary: string, undo: unknown) => void;

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

export const MORE_TOOL_DEFS: ToolDef[] = [
  fn(
    'cook_style_set',
    'Change "Wie kocht ihr?" – which kitchen machines the household cooks with (normal = stove and oven). Admins only, only after a yes. Machine recipes are only proposed for machines listed here.',
    { styles: { type: 'array', items: { type: 'string', enum: [...COOK_STYLES] } } },
    ['styles'],
  ),
  fn(
    'calendar_status',
    'Kalender lesen: how many weeks ahead the iPhone reads the household calendar, the last read, evening/morning, and the bin kinds found (on, new = not chosen yet, off) with next dates. ToHuus only gets kind + day, never event titles.',
    {},
  ),
  fn(
    'calendar_change',
    'Change Kalender lesen – only after a yes. kind + on=false switches a found kind off (e.g. Grünschnitt: its task is deleted, later reads do not bring it back), on=true back on. weeks: 2–26 read ahead. offset: evening = the evening before, morning = on the day. rescan=true: the iPhone reads again when ToHuus opens next.',
    {
      kind: { type: 'string', description: 'bio, paper, yellow, rest, green, bulky, tree – or the word, e.g. Grünschnitt, Gelbe Tonne' },
      on: { type: 'boolean' },
      weeks: { type: 'integer', minimum: 2, maximum: 26 },
      offset: { type: 'string', enum: ['evening', 'morning'] },
      rescan: { type: 'boolean' },
    },
  ),
  fn(
    'receipts_list',
    'Receipts (Bons): id, shop, purchase day, total, state (to_check, booked, discarded), lines. Filter by shop and/or day, from, to (YYYY-MM-DD, heute, gestern).',
    { shop: { type: 'string' }, day: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } },
  ),
  fn(
    'receipt_change',
    'Change one receipt: update (shop, date YYYY-MM-DD, total), reopen (back to "to check", its stock bookings are taken back) or delete (gone; stock bookings and products only it created are taken back). First call WITHOUT confirm: you get what would happen – tell the person exactly that and ask. Call again with confirm=true only after their yes in a new message.',
    {
      id: { type: 'integer' },
      action: { type: 'string', enum: ['update', 'reopen', 'delete'] },
      shop: { type: 'string' },
      date: { type: 'string', description: 'new purchase day, YYYY-MM-DD' },
      total: { type: 'number' },
      confirm: { type: 'boolean' },
    },
    ['id', 'action'],
  ),
];

export const MORE_TOOLS = MORE_TOOL_DEFS.map((d) => d.function.name);
/** topics of assistant-context.ts topicsOf → these tools (merged into assistant-tools.ts TOOLS_BY_TOPIC) */
export const MORE_TOOLS_BY_TOPIC: Record<string, string[]> = {
  kitchen: ['cook_style_set'],
  calendar: ['calendar_status', 'calendar_change'],
  receipts: ['receipts_list', 'receipt_change', 'money_summary'],
};

// ------------------------------------------------------------------ „Wie kocht ihr?“

const STYLE_KEY = 'cooking.styles';
const styleName = (s: CookStyle) =>
  ({ normal: t('stove and oven'), thermomix: 'Thermomix', 'monsieur-cuisine': 'Monsieur Cuisine', 'other-machine': t('another cooking machine') })[s];
const joinAnd = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${t('and')} ${xs[xs.length - 1]}`);

function cookStyleSet(ctx: Ctx, a: any, record: Rec) {
  // the app: PUT /api/cook2/style is requireAdmin
  if (!ctx.admin) return { error: 'Only an admin of the household can change this (Settings › Household › How do you cook?). Say so kindly.' };
  const want = Array.isArray(a.styles) ? a.styles.filter((s: unknown): s is CookStyle => (COOK_STYLES as readonly string[]).includes(String(s))) : [];
  if (!want.length) return { error: 'styles missing: normal, thermomix, monsieur-cuisine, other-machine' };
  const before = getSetting<unknown>(STYLE_KEY, null);
  const after = setCookStyles(want);
  emit('settings', 'recipes');
  record('cook_style', t('How you cook: {styles}', { styles: joinAnd(after.map(styleName)) }), { kind: 'cook_style', before });
  return { ok: true, styles: after };
}

// ------------------------------------------------------------------ Kalender lesen

/** "green", "Grünschnitt", "Gelbe Tonne", "Biotonne" → the kind key */
function kindKey(word: unknown): string | null {
  const w = String(word ?? '').trim();
  if (!w) return null;
  const direct = BIN_KINDS.find((k) => k.key === w.toLowerCase());
  if (direct) return direct.key;
  const byRule = binKindOf(w);
  if (byRule) return byRule;
  const n = norm(w);
  return BIN_KINDS.find((k) => norm(t(k.name)).includes(n) || norm(k.name).includes(n))?.key ?? null;
}
const kindName = (key: string) => t(BIN_KINDS.find((k) => k.key === key)?.name ?? key);

function calendarStatus(ctx: Ctx) {
  const v = calsyncView(ctx.userId);
  return {
    reads_weeks_ahead: v.horizon_weeks,
    allowed_weeks: `${v.horizon_min_weeks}–${v.horizon_max_weeks}`,
    last_read: v.last_sync,
    window: v.window,
    bins_due: v.settings.offset === 'evening' ? 'the evening before the collection' : 'on the collection day',
    rescan_requested: Boolean(v.rescan_requested),
    kinds: v.kinds
      .filter((k) => k.state !== null)
      .map((k) => ({ key: k.key, name: k.name, state: k.state === 'ignored' ? 'off' : k.state, next: k.next, dates_ahead: k.dates, every_days: k.rhythm_days })),
    note: 'Only the iPhone reads the calendar (the calendars the person picked, on the device); the browser cannot.',
  };
}

function calendarChange(ctx: Ctx, a: any, record: Rec) {
  // the app: /api/calsync/* – household members, no guests (routes/home.ts noCalGuest)
  if (!ctx.userId || ctx.guest) return { error: 'Only household members can change this.' };
  const done: string[] = [];
  if (a.kind !== undefined || a.on !== undefined) {
    const key = kindKey(a.kind);
    if (!key) return { error: `Unknown kind "${a.kind}". Kinds: ${BIN_KINDS.map((k) => `${k.key} (${t(k.name)})`).join(', ')}` };
    if (typeof a.on !== 'boolean') return { error: 'Say on=true or on=false.' };
    const hadRow = Boolean(db.prepare('SELECT 1 FROM calsync_kinds WHERE kind = ?').get(key));
    const before = hadRow ? kindState(key) : 'new';
    if (a.on) reviveKind(key);
    else ignoreKind(key);
    const summary = a.on ? t('{kind}: taken over from the calendar again', { kind: kindName(key) }) : t('{kind}: switched off – the task is gone and won’t come back', { kind: kindName(key) });
    record('calendar_kind', summary, { kind: 'cal_kind', key, before, hadRow });
    done.push(summary);
  }
  if (a.weeks !== undefined || a.offset !== undefined) {
    const before = calsyncSettings();
    const next = setCalsyncSettings({
      ...(typeof a.weeks === 'number' ? { weeks: a.weeks } : {}),
      ...(a.offset === 'evening' || a.offset === 'morning' ? { offset: a.offset as BinOffset } : {}),
    });
    const summary = t('Calendar: reads {weeks} weeks ahead, bins {when}', {
      weeks: next.weeks,
      when: next.offset === 'evening' ? t('the evening before') : t('on the day'),
    });
    record('calendar_settings', summary, { kind: 'cal_settings', before });
    done.push(summary);
  }
  if (a.rescan === true) {
    requestRescan();
    const summary = t('The iPhone reads the calendar again the next time ToHuus opens');
    record('calendar_rescan', summary, null);
    done.push(summary);
  }
  if (!done.length) return { error: 'Nothing to change: give kind+on, weeks, offset or rescan.' };
  return { ok: true, done, status: calendarStatus(ctx) };
}

// ------------------------------------------------------------------ Bons

interface ImportRow {
  id: number;
  kind: string;
  status: string;
  title: string;
  shop: string | null;
  total: number | null;
  meta: string;
  created_at: string;
}
const readMeta = (raw: string | null | undefined): Record<string, any> => {
  try {
    return JSON.parse(raw || '{}') ?? {};
  } catch {
    return {};
  }
};
const dayOfReceipt = (r: ImportRow) => {
  const d = readMeta(r.meta).date;
  return typeof d === 'string' && /^\d{4}-\d\d-\d\d/.test(d) ? d.slice(0, 10) : r.created_at.slice(0, 10);
};
const STATE: Record<string, string> = { review: 'to_check', applied: 'booked', discarded: 'discarded' };

/** "2026-10-17", "heute", "gestern", "vorgestern", "17.", "17.10.", "17.10.2026" → YYYY-MM-DD (never in the future for "17."). */
export function receiptDay(input: unknown, ref = localDay(0)): string | null {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return s;
  if (s === 'heute' || s === 'today') return ref;
  if (s === 'gestern' || s === 'yesterday') return addDays(ref, -1);
  if (s === 'vorgestern') return addDays(ref, -2);
  const m = s.match(/^(?:den\s+|am\s+)?(\d{1,2})\.(?:\s*(\d{1,2})\.(?:\s*(\d{2,4}))?)?$/);
  if (!m) return null;
  const [y0, mo0] = ref.split('-').map(Number);
  const d = Number(m[1]);
  let mo = m[2] ? Number(m[2]) : mo0;
  let y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : y0;
  if (!m[2] && d > Number(ref.slice(8, 10))) {
    // "der 25." on the 18th: last month
    mo -= 1;
    if (mo === 0) [mo, y] = [12, y - 1];
  }
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) || mo > 12 || d > 31 ? null : iso;
}

function receiptsList(ctx: Ctx, a: any) {
  const uid = ctx.userId ?? 0;
  const rows = db
    .prepare(`SELECT i.id, i.kind, i.status, i.title, i.shop, i.total, i.meta, i.created_at, (SELECT COUNT(*) FROM import_lines l WHERE l.import_id = i.id) AS lines FROM imports i WHERE ${VISIBLE_TO} ORDER BY i.id DESC LIMIT 300`)
    .all(uid, uid) as (ImportRow & { lines: number })[];
  const day = receiptDay(a.day);
  const from = receiptDay(a.from);
  const to = receiptDay(a.to);
  const shop = typeof a.shop === 'string' && a.shop.trim() ? norm(a.shop) : '';
  const hits = rows
    .map((r) => ({ r, day: dayOfReceipt(r) }))
    .filter((x) => (!day || x.day === day) && (!from || x.day >= from) && (!to || x.day <= to))
    .filter((x) => !shop || norm(`${x.r.shop ?? ''} ${x.r.title}`).includes(shop))
    .slice(0, 15);
  return {
    receipts: hits.map(({ r, day: d }) => ({ id: r.id, shop: r.shop ?? r.title, day: d, total: r.total != null ? fmtMoney(r.total) : null, state: STATE[r.status] ?? r.status, lines: r.lines })),
    more: hits.length === 15 ? 'only the 15 newest – narrow it down' : undefined,
  };
}

/** what a reopen or delete takes back – for the summary the person says yes to */
function takesBack(id: number, imp: ImportRow) {
  const meta = readMeta(imp.meta);
  const bookings = imp.status === 'applied' ? (db.prepare(`SELECT COUNT(*) n FROM movements WHERE ref = ? AND delta != 0`).get(`import:${id}`) as { n: number }).n : 0;
  return {
    stock_bookings: bookings,
    products_it_created: Array.isArray(meta.createdProducts) ? meta.createdProducts.length : 0,
    list_ticks: Array.isArray(meta.tickedItems) ? meta.tickedItems.length : 0,
    // a purchase told to the assistant has its own expense entry; deleting the receipt keeps it (like the app)
    expense_stays: meta.expenseId ? true : undefined,
  };
}

/** asked-for changes waiting for the person's yes: `${userId}:${id}:${action}` → when it was asked and what */
const pending = new Map<string, { at: number; sig: string }>();
const PENDING_MS = 30 * 60_000;

function receiptChange(ctx: Ctx, a: any, record: Rec) {
  if (!ctx.userId || ctx.guest) return { error: 'Only household members can change receipts.' };
  const id = Number(a.id);
  const imp = Number.isInteger(id) ? (db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as ImportRow | undefined) : undefined;
  // personal receipts only for the person they belong to (spending.ts receiptVisible), like GET /imports/:id
  if (!imp || !receiptVisible(id, ctx.userId)) return { error: `No receipt ${a.id}. Use receipts_list.` };
  const action = ['update', 'reopen', 'delete'].includes(a.action) ? (a.action as 'update' | 'reopen' | 'delete') : null;
  if (!action) return { error: 'action: update, reopen or delete' };
  const head = { shop: typeof a.shop === 'string' ? a.shop.trim() || null : undefined, date: a.date !== undefined ? receiptDay(a.date) : undefined, total: typeof a.total === 'number' ? a.total : undefined };
  if (action === 'update') {
    if (a.date !== undefined && !head.date) return { error: 'date: YYYY-MM-DD' };
    if (head.shop === undefined && head.date === undefined && head.total === undefined) return { error: 'Give shop, date or total.' };
  }
  const receipt = { id, shop: imp.shop ?? imp.title, day: dayOfReceipt(imp), total: imp.total != null ? fmtMoney(imp.total) : null, state: STATE[imp.status] ?? imp.status };
  const key = `${ctx.userId}:${id}:${action}`;
  const sig = action === 'update' ? JSON.stringify(head) : action;
  const asked = pending.get(key);
  const now = Date.now();
  const turn = ctx.turnStart ?? now;
  const confirmed = a.confirm === true && asked && asked.sig === sig && asked.at < turn && now - asked.at < PENDING_MS;
  if (!confirmed) {
    pending.set(key, { at: now, sig });
    return {
      needs_yes: true,
      would: action,
      receipt,
      ...(action === 'update' ? { new: { shop: head.shop, day: head.date, total: head.total != null ? fmtMoney(head.total) : undefined } } : { takes_back: takesBack(id, imp) }),
      ask: 'Tell the person in one or two sentences what happens (and what is taken back) and ask. Only after their yes in the next message call again with confirm=true.',
    };
  }
  pending.delete(key);
  const where = imp.shop ?? imp.title;
  const day = fmtDay(dayOfReceipt(imp));
  if (action === 'update') {
    const before = { shop: imp.shop, total: imp.total, title: imp.title, meta: imp.meta };
    updateImportHead(id, { ...(head.shop !== undefined ? { shop: head.shop } : {}), ...(head.date !== undefined ? { date: head.date } : {}), ...(head.total !== undefined ? { total: head.total } : {}) });
    record('receipt_update', t('Receipt from {shop} ({day}) changed', { shop: where, day }), { kind: 'receipt_head', id, before });
    return { ok: true, receipt: { ...receipt, shop: head.shop ?? receipt.shop, day: head.date ?? receipt.day, total: head.total != null ? fmtMoney(head.total) : receipt.total } };
  }
  if (action === 'reopen') {
    const out = reopenImport(id, ctx.actor);
    record('receipt_reopen', t('Receipt from {shop} ({day}) is to be checked again', { shop: where, day }), imp.status === 'applied' ? { kind: 'receipt_apply', id } : null);
    return { ok: true, state: 'to_check', stock_bookings_taken_back: out.reverted };
  }
  // delete: keep a copy of the receipt and its lines, so the undo can put it back (and book it again)
  const row = db.prepare('SELECT * FROM imports WHERE id = ?').get(id) as Record<string, unknown>;
  const lines = db.prepare('SELECT * FROM import_lines WHERE import_id = ? ORDER BY sort').all(id) as Record<string, unknown>[];
  const out = deleteImport(id, ctx.actor);
  record('receipt_delete', t('Receipt from {shop} ({day}) deleted', { shop: where, day }), { kind: 'receipt_restore', row, lines, rebook: imp.status === 'applied' });
  return { ok: true, deleted: receipt, stock_bookings_taken_back: out.reverted, products_removed: out.removedProducts };
}

/** test hook: forget the asked-for changes */
export const _resetPending = () => pending.clear();

// ------------------------------------------------------------------ run and undo

export function runMoreTool(ctx: Ctx, name: string, a: any, record: Rec): unknown {
  if (!MORE_TOOLS.includes(name)) return undefined;
  switch (name) {
    case 'cook_style_set':
      return cookStyleSet(ctx, a, record);
    case 'calendar_status':
      if (!ctx.userId || ctx.guest) return { error: 'Only household members can see this.' };
      return calendarStatus(ctx);
    case 'calendar_change':
      return calendarChange(ctx, a, record);
    case 'receipts_list':
      if (ctx.guest) return { error: 'Receipts are not shared with guests.' };
      return receiptsList(ctx, a);
    case 'receipt_change':
      return receiptChange(ctx, a, record);
  }
  return undefined;
}

function insertRow(table: string, r: Record<string, unknown>) {
  const cols = Object.keys(r);
  db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => r[c] as any));
}

/** Undo for these tools (assistant-tools.ts › runUndo). */
export function undoMore(u: { kind?: string; [k: string]: any }, _userId?: number | null): boolean {
  switch (u?.kind) {
    case 'cook_style':
      setSetting(STYLE_KEY, u.before ?? null);
      emit('settings', 'recipes');
      return true;
    case 'cal_kind': {
      if (u.before === 'on') reviveKind(u.key);
      else {
        ignoreKind(u.key);
        // it was only found, not decided: back to "new" (it is offered again after the next read)
        if (!u.hadRow || u.before === 'new') db.prepare('DELETE FROM calsync_kinds WHERE kind = ?').run(u.key);
      }
      emit('care');
      return true;
    }
    case 'cal_settings':
      setCalsyncSettings(u.before);
      return true;
    case 'receipt_head': {
      const b = u.before as { shop: string | null; total: number | null; title: string; meta: string };
      db.prepare('UPDATE imports SET shop = ?, total = ?, title = ?, meta = ? WHERE id = ?').run(b.shop, b.total, b.title, b.meta, u.id);
      emit('imports');
      return true;
    }
    case 'receipt_apply': {
      const st = db.prepare('SELECT status FROM imports WHERE id = ?').get(u.id) as { status: string } | undefined;
      if (st?.status === 'review') applyImport(u.id, 'undo');
      return true;
    }
    case 'receipt_restore': {
      const row = { ...(u.row as Record<string, unknown>) };
      if (db.prepare('SELECT 1 FROM imports WHERE id = ?').get(row.id)) return true;
      // products the booking created were removed with it: their lines make them again when it is booked again
      const meta = readMeta(row.meta as string);
      meta.createdProducts = [];
      Object.assign(row, { status: u.rebook ? 'review' : row.status, applied_at: u.rebook ? null : row.applied_at, meta: JSON.stringify(meta) });
      insertRow('imports', row);
      for (const l0 of u.lines as Record<string, unknown>[]) {
        const l = { ...l0 };
        if (l.product_id != null && !db.prepare('SELECT 1 FROM products WHERE id = ?').get(l.product_id)) Object.assign(l, { product_id: null, action: l.action === 'skip' ? 'skip' : 'new' });
        insertRow('import_lines', l);
      }
      if (u.rebook) applyImport(Number(row.id), 'undo');
      emit('imports', 'stock', 'products', 'shopping');
      return true;
    }
  }
  return false;
}
