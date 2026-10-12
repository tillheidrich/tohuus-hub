/**
 * Stable, versioned API for the Home Assistant custom integration (ha-integration/, HACS "ToHuus Hub").
 * Everything here is read by one integration poll (/api/ha/v1/state) or called by HA services/entities.
 * Keep the response shapes backwards compatible within v1 – the integration ships separately.
 */
import { hasClimate } from './places.js';
import type { Response } from 'express';
import { config } from '../config.js';
import { db, getSetting, lang, migrate, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { emit, onEmit } from './bus.js';
import { householdId, perHousehold } from './tenancy.js';
import { randomToken } from './auth.js';
import { addInterval, completeCareTask, findCareTask, listCareTasks, type IntervalUnit } from './care.js';
import { addToShopping, adjustStock, fmtQty, getProduct, listProducts, localDay, markUsedUp, matchProduct } from './catalog.js';
import { eatFirst } from './fresh.js';
import { boxesSummary, listBoxes } from './labels.js';
import { listWishes } from './kids.js';
import { listDisplays } from './kiosk.js';
import { liveParty, partyView } from './party.js';
import { addPlan, getPlan } from './plan.js';
import { suggest } from './recipes.js';
import { quickAdd } from './shop.js';
import { notPrivate } from './share-core.js';
import { haAway } from './away.js';
import { afterUntick } from './shopping-trust.js';

export const HA_API_VERSION = 1;

migrate(
  'ha-1',
  `CREATE TABLE IF NOT EXISTS ha_todo_pos (
     item_id INTEGER PRIMARY KEY REFERENCES shopping_items(id) ON DELETE CASCADE,
     pos REAL NOT NULL
   );`,
);

export class HaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A random id per installation, so Home Assistant can tell two ToHuus Hubs apart (config entry unique_id). */
export function instanceId(): string {
  let id = getSetting<string>('ha.instanceId', '');
  if (!id) {
    id = randomToken(12);
    setSetting('ha.instanceId', id);
  }
  return id;
}

export const absUrl = (p: string | null | undefined) => (!p ? null : /^https?:\/\//.test(p) ? p : `${config.baseUrl}${p.startsWith('/') ? '' : '/'}${p}`);

// ------------------------------------------------------------------ products

/** "12", "#12", 12 or a name ("Milch") → product. Names need a confident match. */
export function resolveProduct(ref: string | number | null | undefined) {
  if (ref === null || ref === undefined || ref === '') return undefined;
  if (typeof ref === 'number') return getProduct(ref);
  const s = String(ref).trim();
  if (/^#?\d+$/.test(s)) return getProduct(Number(s.replace('#', '')));
  const m = matchProduct(s);
  return m && m.score >= 0.6 ? getProduct(m.productId) : undefined;
}

function needProduct(ref: string | number | null | undefined) {
  const p = resolveProduct(ref);
  if (!p) throw new HaApiError(404, t('Product not found'));
  return p;
}

// ------------------------------------------------------------------ shopping list as a to-do list

export interface TodoItem {
  uid: string;
  summary: string;
  status: 'needs_action' | 'completed';
  description: string | null;
  product_id: number | null;
  qty: number | null;
  added_by: string | null;
  source: string;
  created_at: string;
  checked_at: string | null;
}

interface ShopRow {
  id: number;
  product_id: number | null;
  text: string;
  qty: number | null;
  note: string | null;
  source: string;
  added_by: string | null;
  checked_at: string | null;
  created_at: string;
  pos: number | null;
}

function shopRows(): ShopRow[] {
  // open items, plus what was ticked off within the last day (HA shows it as completed)
  return db
    .prepare(
      `SELECT s.id, s.product_id, s.text, s.qty, s.note, s.source, s.added_by, s.checked_at, s.created_at, h.pos
       FROM shopping_items s LEFT JOIN ha_todo_pos h ON h.item_id = s.id
       WHERE (s.checked_at IS NULL OR s.checked_at > datetime('now', '-1 day')) AND ${notPrivate('s.id')}`,
    )
    .all() as ShopRow[];
}

/**
 * Order: open before completed. Within open, items never moved in HA come first (newest first, like the app),
 * then the ones placed by drag and drop in HA (by position).
 */
export function orderTodo<T extends Pick<ShopRow, 'checked_at' | 'created_at' | 'pos' | 'id'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (!a.checked_at !== !b.checked_at) return a.checked_at ? 1 : -1;
    if (a.checked_at && b.checked_at) return b.checked_at.localeCompare(a.checked_at);
    if ((a.pos === null) !== (b.pos === null)) return a.pos === null ? -1 : 1;
    if (a.pos !== null && b.pos !== null && a.pos !== b.pos) return a.pos - b.pos;
    return b.created_at.localeCompare(a.created_at) || b.id - a.id;
  });
}

const describe = (r: Pick<ShopRow, 'qty' | 'note'>) => {
  const parts = [r.qty && r.qty !== 1 ? `${String(r.qty).replace('.', ',')}×` : '', r.note ?? ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
};

export function todoItems(): TodoItem[] {
  return orderTodo(shopRows()).map((r) => ({
    uid: String(r.id),
    summary: r.text,
    status: r.checked_at ? 'completed' : 'needs_action',
    description: describe(r),
    product_id: r.product_id,
    qty: r.qty,
    added_by: r.added_by,
    source: r.source,
    created_at: r.created_at,
    checked_at: r.checked_at,
  }));
}

function shopItem(uid: string) {
  const id = Number(uid);
  // private entries are invisible to Home Assistant – so it can't change or delete them by guessing an id either
  const it = Number.isInteger(id) ? (db.prepare(`SELECT * FROM shopping_items WHERE id = ? AND ${notPrivate()}`).get(id) as ShopRow | undefined) : undefined;
  if (!it) throw new HaApiError(404, t('Item not found'));
  return it;
}

/** HA "add item" – parsed like the quick add ("2 milk, bread" → two lines). */
export function todoCreate(summary: string, actor: string, description?: string | null) {
  const text = summary.trim();
  if (!text) throw new HaApiError(400, t('Title is missing'));
  const added = quickAdd(text, actor, 'ha');
  if (description?.trim() && added.length === 1) {
    db.prepare('UPDATE shopping_items SET note = ? WHERE id = ?').run(description.trim().slice(0, 200), added[0].id);
    emit('shopping');
  }
  return added.map((a) => ({ uid: String(a.id), summary: a.text, created: a.created }));
}

export function todoUpdate(uid: string, b: { summary?: string; status?: 'needs_action' | 'completed'; description?: string | null }, actor: string) {
  const it = shopItem(uid);
  if (b.summary !== undefined && b.summary.trim() && b.summary.trim() !== it.text) {
    db.prepare('UPDATE shopping_items SET text = ? WHERE id = ?').run(b.summary.trim().slice(0, 200), it.id);
  }
  if (b.description !== undefined && (b.description ?? null) !== describe(it)) {
    // the description we hand out is "2× · note" – a quantity prefix edited in HA goes back into qty
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*×\s*(?:·\s*)?/.exec(b.description ?? '');
    const qty = m ? Number(m[1].replace(',', '.')) : null;
    const note = (m ? (b.description ?? '').slice(m[0].length) : (b.description ?? '')).trim();
    db.prepare('UPDATE shopping_items SET qty = ?, note = ? WHERE id = ?').run(qty && qty > 0 ? qty : null, note ? note.slice(0, 200) : null, it.id);
  }
  if (b.status === 'completed' && !it.checked_at) {
    db.prepare(`UPDATE shopping_items SET checked_at = datetime('now'), checked_by = ?, in_basket = 0 WHERE id = ?`).run(actor, it.id);
  } else if (b.status === 'needs_action' && it.checked_at) {
    db.prepare('UPDATE shopping_items SET checked_at = NULL, checked_by = NULL, in_basket = 0 WHERE id = ?').run(it.id);
    afterUntick(it.id, actor);
  }
  emit('shopping');
  return todoItems().find((x) => x.uid === String(it.id))!;
}

export function todoDelete(uids: string[]) {
  const del = db.prepare(`DELETE FROM shopping_items WHERE id = ? AND ${notPrivate()}`);
  const delPos = db.prepare('DELETE FROM ha_todo_pos WHERE item_id = ?');
  let n = 0;
  db.transaction(() => {
    for (const u of uids) {
      const id = Number(u);
      if (!Number.isInteger(id)) continue;
      delPos.run(id);
      n += del.run(id).changes;
    }
  })();
  if (n) emit('shopping');
  return { deleted: n };
}

/** Drag and drop in HA: put `uid` right after `previousUid` (null = to the top). Renumbers the open list. */
export function todoMove(uid: string, previousUid: string | null) {
  const it = shopItem(uid);
  const open = orderTodo(shopRows()).filter((r) => !r.checked_at && r.id !== it.id);
  const at = previousUid === null ? 0 : open.findIndex((r) => String(r.id) === previousUid) + 1;
  if (previousUid !== null && at === 0) throw new HaApiError(404, t('Item not found'));
  open.splice(at, 0, it);
  const up = db.prepare('INSERT INTO ha_todo_pos (item_id, pos) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET pos = excluded.pos');
  db.transaction(() => open.forEach((r, i) => up.run(r.id, (i + 1) * 10)))();
  emit('shopping');
  return { ok: true };
}

// ------------------------------------------------------------------ calendars

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function range(start?: unknown, end?: unknown) {
  const s = typeof start === 'string' && DAY.test(start.slice(0, 10)) ? start.slice(0, 10) : localDay(-7);
  let e = typeof end === 'string' && DAY.test(end.slice(0, 10)) ? end.slice(0, 10) : localDay(28);
  // cap at ~13 months so a year view in HA stays cheap
  const max = addInterval(s, 400, 'day');
  if (e > max) e = max;
  return { start: s, end: e < s ? s : e };
}

const SLOT_LABEL = () => ({ mittag: t('Lunch'), abend: t('Dinner') }) as Record<string, string>;

export function mealEvents(start?: unknown, end?: unknown) {
  const r = range(start, end);
  return getPlan(r.start, r.end).map((e) => ({
    uid: `meal-${e.id}`,
    id: e.id,
    date: e.day,
    slot: e.slot,
    summary: e.title,
    description: [SLOT_LABEL()[e.slot] ?? e.slot, e.note, e.cooked ? t('cooked') : null].filter(Boolean).join(' · '),
    recipe_id: e.recipe_id,
    image_url: absUrl(e.image_path),
    url: e.recipe_id ? `${config.baseUrl}/rezepte/${e.recipe_id}` : `${config.baseUrl}/kochen`,
    cooked: Boolean(e.cooked),
  }));
}

/** Care tasks in a date range – with recurrences projected forward from the next due date. */
export function careEvents(start?: unknown, end?: unknown) {
  const r = range(start, end);
  const today = localDay(0);
  const out: { uid: string; task_id: number; date: string; summary: string; description: string; state: string; overdue: boolean }[] = [];
  for (const c of listCareTasks()) {
    if (!c.next_due) continue;
    let day = c.next_due;
    // an overdue task shows on today, so it doesn't vanish into the past
    if (day < today) {
      if (today >= r.start && today <= r.end)
        out.push({ uid: `care-${c.id}-${today}`, task_id: c.id, date: today, summary: c.name, description: [t('overdue since {day}', { day }), c.location?.name, c.assignee?.name].filter(Boolean).join(' · '), state: c.state, overdue: true });
      if (!c.interval_n || !c.interval_unit) continue;
      while (day < today) day = addInterval(day, c.interval_n, c.interval_unit as IntervalUnit);
      if (day === today) day = addInterval(day, c.interval_n, c.interval_unit as IntervalUnit);
    }
    let guard = 0;
    while (day <= r.end && guard++ < 400) {
      if (day >= r.start) out.push({ uid: `care-${c.id}-${day}`, task_id: c.id, date: day, summary: c.name, description: [c.location?.name, c.assignee?.name, c.note].filter(Boolean).join(' · '), state: day === c.next_due ? c.state : 'ok', overdue: false });
      if (!c.interval_n || !c.interval_unit) break;
      day = addInterval(day, c.interval_n, c.interval_unit as IntervalUnit);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary));
}

// ------------------------------------------------------------------ the one big state call

export function haState() {
  const products = listProducts();
  const tracked = products.filter((p) => p.track_mode !== 'none');
  const watched = (p: (typeof products)[number]) => p.min_qty > 0 || p.track_mode === 'level';
  const item = (p: (typeof products)[number]) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    qty: p.total,
    qty_text: fmtQty(p, p.total),
    unit: p.unit,
    best_before: p.nextExpiry ?? null,
    image_url: absUrl(p.image_path),
  });
  const low = tracked.filter((p) => p.status === 'low' && watched(p)).map(item);
  const empty = tracked.filter((p) => p.status === 'empty' && watched(p)).map(item);
  const expiring = tracked
    .filter((p) => p.status === 'expiring' || p.status === 'expired')
    .map(item)
    .sort((a, b) => (a.best_before ?? '9').localeCompare(b.best_before ?? '9'));
  const expired = expiring.filter((p) => p.status === 'expired');

  const todo = todoItems();
  const openTodo = todo.filter((x) => x.status === 'needs_action');

  const orders = db
    .prepare(
      `SELECT o.id, o.guest_name, o.status, o.note, o.created_at,
         (SELECT json_group_array(json_object('name', name, 'qty', qty)) FROM order_lines WHERE order_id = o.id) AS lines
       FROM orders o WHERE status IN ('new','accepted') ORDER BY id DESC LIMIT 30`,
    )
    .all() as any[];

  const care = listCareTasks();
  const due = care.filter((c) => c.state === 'overdue' || c.state === 'today' || c.state === 'soon');
  const nextCare = care.filter((c) => c.next_due).sort((a, b) => a.next_due!.localeCompare(b.next_due!))[0] ?? null;

  const eat = eatFirst({ limit: 20 });
  const boxes = boxesSummary();
  const today = localDay(0);
  const planned = getPlan(today, today);
  const tonightPlan = planned.find((p) => p.slot === 'abend') ?? planned[0] ?? null;
  const idea = tonightPlan ? null : (suggest({ limit: 1 })[0] ?? null);
  const tomorrow = getPlan(localDay(1), localDay(1));
  const SLOT_ORDER: Record<string, number> = { mittag: 0, abend: 1 };
  const nextMeal =
    getPlan(today, localDay(14))
      .filter((p) => !p.cooked)
      .sort((a, b) => a.day.localeCompare(b.day) || (SLOT_ORDER[a.slot] ?? 9) - (SLOT_ORDER[b.slot] ?? 9))[0] ?? null;

  const lp = liveParty();
  const party = lp ? partyView(lp) : null;
  const wishes = listWishes('pending');
  const displays = listDisplays().map((d) => ({ id: d.id, name: d.name, layout: d.layout }));
  const imports = (db.prepare(`SELECT COUNT(*) AS n FROM imports WHERE status = 'review'`).get() as { n: number }).n;

  return {
    api: HA_API_VERSION,
    instance_id: instanceId(),
    household: getSetting('household.name', t('Our home')),
    base_url: config.baseUrl,
    language: lang(),
    generated_at: new Date().toISOString(),
    counts: {
      products: tracked.length,
      low: low.length,
      empty: empty.length,
      expiring: expiring.length,
      expired: expired.length,
      shopping: openTodo.length,
      orders_open: orders.length,
      orders_new: orders.filter((o) => o.status === 'new').length,
      care_due: due.length,
      care_overdue: due.filter((c) => c.state === 'overdue').length,
      eat_first: eat.length,
      leftovers: eat.filter((e) => e.kind === 'leftover').length,
      frozen_boxes: boxes.counts.freezer,
      leftover_boxes: boxes.counts.fridge,
      kid_wishes: wishes.length,
      imports_to_review: imports,
    },
    low,
    empty,
    expiring,
    shopping: openTodo.map((x) => ({ uid: x.uid, summary: x.summary, description: x.description })),
    /** the full list for HA's to-do entity, completed items of the last day included */
    todo: todo.map((x) => ({ uid: x.uid, summary: x.summary, status: x.status, description: x.description })),
    orders: orders.map((o) => ({ id: o.id, name: o.guest_name, status: o.status, note: o.note, created_at: o.created_at, items: JSON.parse(o.lines) })),
    care: {
      due: due.map((c) => ({ id: c.id, name: c.name, state: c.state, next_due: c.next_due, days: c.days, location: c.location?.name ?? null, assignee: c.assignee?.name ?? null })),
      next: nextCare ? { id: nextCare.id, name: nextCare.name, next_due: nextCare.next_due, state: nextCare.state } : null,
    },
    eat_first: eat.map((e) => ({ id: e.id, name: e.name, kind: e.kind, use_by: e.use_by, days_left: e.days_left, qty: e.qty, unit: e.unit, opened: e.opened, image_url: absUrl(e.image_path) })),
    /** leftover & freezer containers (area: labels): everything put away, what to take out for a planned meal */
    boxes: {
      fridge_portions: boxes.counts.fridge_portions,
      freezer_portions: boxes.counts.freezer_portions,
      /** false: the household has no frozen place – the integration then leaves out the frozen-portions sensor (area: home) */
      has_freezer: hasClimate('frozen'),
      items: listBoxes({ status: 'active', limit: 30 }).map((b) => ({ code: b.code, name: b.name, place: b.place, portions: b.left, eat_by: b.eat_by, days_left: b.days_left, state: b.state, url: b.url })),
      thaw: boxes.thaw.map((x) => ({ day: x.day, slot: x.slot, meal: x.title, code: x.box.code, name: x.box.name })),
    },
    tonight: tonightPlan
      ? { source: 'plan', title: tonightPlan.title, recipe_id: tonightPlan.recipe_id, slot: tonightPlan.slot, cooked: Boolean(tonightPlan.cooked), image_url: absUrl(tonightPlan.image_path), url: tonightPlan.recipe_id ? `${config.baseUrl}/rezepte/${tonightPlan.recipe_id}` : `${config.baseUrl}/kochen` }
      : idea
        ? { source: 'idea', title: idea.recipe.title, recipe_id: idea.recipe.id, slot: 'abend', cooked: false, image_url: absUrl(idea.recipe.image_path), url: `${config.baseUrl}/rezepte/${idea.recipe.id}`, reasons: idea.reasons }
        : null,
    tomorrow: tomorrow.map((p) => ({ title: p.title, slot: p.slot, recipe_id: p.recipe_id })),
    next_meal: nextMeal ? { id: nextMeal.id, date: nextMeal.day, slot: nextMeal.slot, title: nextMeal.title, recipe_id: nextMeal.recipe_id, image_url: absUrl(nextMeal.image_path) } : null,
    party: party
      ? { status: 'live', id: party.id, name: party.name, started_at: party.started_at, ends_at: party.auto_end_at ?? party.ends_at, open_orders: party.open_orders, new_orders: party.new_orders, orders_total: party.orders_total, guest_url: party.guest_url }
      : { status: 'off' },
    kid_wishes: wishes.map((w) => ({ id: w.id, kid: w.kid_name, name: w.name, qty: w.qty, created_at: w.created_at, image_url: absUrl(w.image_path) })),
    displays,
    /** away mode (trip): state home | planned | before | away | back – for a binary sensor "away" */
    away: haAway(),
  };
}

export type HaState = ReturnType<typeof haState>;

// ------------------------------------------------------------------ services

export function svcConsume(ref: string | number, qty: number, actor: string) {
  const p = needProduct(ref);
  return adjustStock({ productId: p.id, delta: -Math.abs(qty), reason: 'consume', actor });
}

export function svcAddStock(ref: string | number, qty: number, actor: string, opts: { bestBefore?: string | null; locationId?: number | null } = {}) {
  const p = needProduct(ref);
  return adjustStock({ productId: p.id, delta: Math.abs(qty), reason: 'purchase', actor, bestBefore: opts.bestBefore ?? null, locationId: opts.locationId ?? null });
}

export function svcUsedUp(ref: string | number, actor: string) {
  const p = needProduct(ref);
  return markUsedUp(p.id, actor);
}

/** Adds text (parsed) or a known product to the shopping list. */
export function svcAddShopping(input: { text?: string; product?: string | number; qty?: number | null }, actor: string) {
  if (input.product !== undefined && input.product !== '') {
    const p = resolveProduct(input.product);
    if (p) return [{ ...addToShopping({ productId: p.id, text: p.name, qty: input.qty ?? null, source: 'ha', addedBy: actor }), text: p.name }];
    if (!input.text) return [{ ...addToShopping({ text: String(input.product), qty: input.qty ?? null, source: 'ha', addedBy: actor }), text: String(input.product) }];
  }
  if (!input.text?.trim()) throw new HaApiError(400, t('Title is missing'));
  return quickAdd(input.text, actor, 'ha');
}

export function svcPlanMeal(input: { day?: string | null; recipe?: string | number | null; title?: string | null; slot?: 'mittag' | 'abend' }) {
  const day = input.day && DAY.test(input.day) ? input.day : localDay(0);
  let recipeId: number | null = null;
  if (input.recipe !== undefined && input.recipe !== null && input.recipe !== '') {
    const s = String(input.recipe).trim();
    if (/^#?\d+$/.test(s)) recipeId = Number(s.replace('#', ''));
    else {
      const q = s.toLowerCase();
      const rows = db.prepare('SELECT id, title FROM recipes').all() as { id: number; title: string }[];
      const hit = rows.find((r) => r.title.toLowerCase() === q) ?? rows.find((r) => r.title.toLowerCase().includes(q));
      if (hit) recipeId = hit.id;
      else if (!input.title) input.title = s;
    }
  }
  try {
    return { id: addPlan({ day, recipe_id: recipeId, title: input.title ?? undefined, slot: input.slot ?? 'abend', source: 'ha' }), day };
  } catch (e) {
    throw new HaApiError(400, (e as Error).message);
  }
}

export function svcCompleteCare(ref: string | number, actor: string) {
  const s = typeof ref === 'string' && /^#?\d+$/.test(ref.trim()) ? Number(ref.trim().replace('#', '')) : ref;
  const task = findCareTask(s);
  if (!task) throw new HaApiError(404, t('Task not found'));
  return completeCareTask(task.id, actor);
}

// ------------------------------------------------------------------ live events for the integration

type Client = { res: Response };
// per household (ToHuus Cloud): connected integrations and the last notification they have seen
const clientsByHousehold = new Map<string, Set<Client>>();
const householdClients = () => {
  const id = householdId();
  let s = clientsByHousehold.get(id);
  if (!s) clientsByHousehold.set(id, (s = new Set()));
  return s;
};
const lastNote = perHousehold(() => ({ id: -1 }));
const maxNotificationId = () => (db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM notifications').get() as { id: number }).id;
let wired = false;

function wire() {
  if (lastNote().id < 0) lastNote().id = maxNotificationId();
  if (wired) return;
  wired = true;
  onEmit((topics) => {
    const clients = householdClients();
    const last = lastNote();
    if (!clients.size) {
      if (topics.includes('notifications') || last.id < 0) last.id = maxNotificationId();
      return;
    }
    const send = (event: string, data: unknown) => {
      const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const c of clients) c.res.write(line);
    };
    send('change', { topics, at: Date.now() });
    if (topics.includes('notifications')) {
      const rows = db.prepare('SELECT id, event, title, body, payload, created_at FROM notifications WHERE id > ? ORDER BY id LIMIT 20').all(Math.max(0, last.id)) as {
        id: number;
        event: string;
        title: string;
        body: string;
        payload: string | null;
        created_at: string;
      }[];
      for (const r of rows) {
        last.id = r.id;
        let payload: any = {};
        try {
          payload = r.payload ? JSON.parse(r.payload) : {};
        } catch {
          /* old rows */
        }
        send('tohuus', { id: r.id, event: r.event, title: r.title, message: r.body, url: payload.url ?? config.baseUrl, data: payload.data ?? {}, at: payload.at ?? r.created_at });
      }
    }
  });
}

/** Push a custom event to every connected integration (ha2: `bridge` = "please sync now"). Returns the number of listeners. */
export function sendHaEvent(event: string, data: unknown) {
  const clients = householdClients();
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.res.write(line);
  return clients.size;
}

const MAX_HA_CLIENTS = 20;
/** Server-sent events: `change` (topics, like /api/events) and `tohuus` (each notification with its event type). */
export function addHaClient(res: Response) {
  wire();
  const clients = householdClients();
  if (clients.size >= MAX_HA_CLIENTS) {
    res.status(503).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 5000\nevent: hello\ndata: ${JSON.stringify({ api: HA_API_VERSION, instance_id: instanceId() })}\n\n`);
  const c = { res };
  clients.add(c);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(c);
  });
}
