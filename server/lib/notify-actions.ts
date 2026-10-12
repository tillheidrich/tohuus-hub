/**
 * Buttons on notifications ("Add to list", "Accept", "Approve", "Done") – one implementation shared by
 * Web Push (/api/push/action) and the Telegram bot's inline keyboards.
 */
import { config } from '../config.js';
import { db } from '../db.js';
import { emit } from './bus.js';
import { t } from '../i18n.js';
import { addToShopping, getProduct } from './catalog.js';
import { completeCareTask, getCareTask } from './care.js';
import { answerWish } from './kids.js';
import { orderKind, setOrderStatus } from './orders.js';

export const NOTIFY_ACTIONS = ['shop-add', 'order-accept', 'order-done', 'order-decline', 'kid-approve', 'kid-decline', 'care-done', 'addon-accept', 'addon-decline'] as const;
export type NotifyAction = (typeof NOTIFY_ACTIONS)[number];
export const isNotifyAction = (s: unknown): s is NotifyAction => typeof s === 'string' && (NOTIFY_ACTIONS as readonly string[]).includes(s);

/** Which id in the notification data an action works on. */
export const ACTION_KEY: Record<NotifyAction, string> = {
  'shop-add': 'product_id',
  'order-accept': 'order_id',
  'order-done': 'order_id',
  'order-decline': 'order_id',
  'kid-approve': 'wish_id',
  'kid-decline': 'wish_id',
  'care-done': 'care_task_id',
  // "Bringst du noch … mit?" (trip add-on): the list row id
  'addon-accept': 'request_id',
  'addon-decline': 'request_id',
};

const httpError = (status: number, msg: string) => Object.assign(new Error(msg), { status });

export interface ActionResult {
  ok: true;
  /** short, human, localised: shown in the edited Telegram message / toast */
  summary: string;
  [k: string]: unknown;
}

/** Run a notification action as `actor`. Throws an error with `.status` (404) when the target is gone. */
export function runNotifyAction(action: NotifyAction, data: Record<string, unknown>, actor: string): ActionResult {
  const ref = Number(data[ACTION_KEY[action]]);
  if (action === 'kid-approve' || action === 'kid-decline') {
    const r = answerWish(ref, action === 'kid-approve' ? 'approve' : 'decline', actor);
    const summary = r.already
      ? t('Already answered')
      : r.status === 'approved'
        ? t('Allowed by {name}', { name: actor })
        : t('Declined by {name}', { name: actor });
    return { ok: true, summary, ...r };
  }
  if (action === 'addon-accept' || action === 'addon-decline') {
    const row = db.prepare(`SELECT id, text, checked_at, origin_detail FROM shopping_items WHERE id = ? AND source = 'trip'`).get(ref) as
      | { id: number; text: string; checked_at: string | null; origin_detail: string | null }
      | undefined;
    if (!row) throw httpError(404, 'not found');
    if (action === 'addon-accept') return { ok: true, summary: t('{name} brings it', { name: actor }) };
    // "Geht nicht": the row stays on the list for everyone, only the claim for this trip goes
    db.prepare(`DELETE FROM claims WHERE kind = 'shopping' AND ref_id = ?`).run(row.id);
    emit('shopping');
    return { ok: true, summary: t('Stays on the list – {name} can’t bring it', { name: actor }) };
  }
  if (action === 'shop-add') {
    const p = getProduct(ref);
    if (!p) throw httpError(404, 'not found');
    const r = addToShopping({ productId: p.id, text: p.name, source: 'auto', addedBy: actor });
    return { ok: true, summary: r.created ? t('On the list ({name})', { name: actor }) : t('Already on the list'), ...r };
  }
  if (action === 'care-done') {
    const task = getCareTask(ref);
    if (!task) throw httpError(404, 'not found');
    // a second tap on the same (old) notification must not move the due date twice
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date());
    if (task.last_done === today && (!task.next_due || task.next_due > today)) return { ok: true, summary: t('Already done today'), next_due: task.next_due, already: true };
    const r = completeCareTask(ref, actor);
    const next = r.task.next_due;
    return {
      ok: true,
      summary: next ? t('Done by {name} – next time: {date}', { name: actor, date: fmtShort(next) }) : t('Done by {name}', { name: actor }),
      next_due: next,
      on_shopping_list: r.on_shopping_list,
    };
  }
  const o = db.prepare('SELECT id, status, user_id, guest_link_id, party_id FROM orders WHERE id = ?').get(ref) as
    | { id: number; status: string; user_id: number | null; guest_link_id: number | null; party_id: number | null }
    | undefined;
  if (!o) throw httpError(404, 'not found');
  const kind = orderKind(o);
  const by = { userId: actorUserId(actor), name: actor };
  const open = o.status === 'new' || o.status === 'accepted';
  if (action === 'order-accept') {
    if (o.status === 'new') setOrderStatus(o.id, 'accepted', { by });
    const status = o.status === 'new' ? 'accepted' : o.status;
    return { ok: true, summary: o.status === 'new' ? (kind === 'home' ? t('{name} is bringing it', { name: actor }) : t('Accepted by {name}', { name: actor })) : statusText(o.status), status, kind };
  }
  if (action === 'order-decline') {
    if (open) setOrderStatus(o.id, 'declined', { by });
    return { ok: true, summary: open ? t('{name} can’t right now', { name: actor }) : statusText(o.status), status: open ? 'declined' : o.status, kind };
  }
  // order-done
  if (open) setOrderStatus(o.id, 'done', { by });
  const status = open ? 'done' : o.status;
  return { ok: true, summary: status === 'done' && o.status !== 'done' ? (kind === 'home' ? t('Brought by {name}', { name: actor }) : t('Served by {name}', { name: actor })) : statusText(o.status), status, kind };
}

/** A notification button only knows the actor's display name; map it back to a member when it is unique. */
function actorUserId(name: string): number | null {
  const rows = db.prepare('SELECT id FROM users WHERE name = ? COLLATE NOCASE').all(name) as { id: number }[];
  return rows.length === 1 ? rows[0].id : null;
}

function statusText(status: string) {
  if (status === 'done') return t('Already served');
  if (status === 'declined') return t('Already declined');
  if (status === 'accepted') return t('Already accepted');
  return status;
}

function fmtShort(day: string) {
  const d = new Date(day + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? day : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
}
