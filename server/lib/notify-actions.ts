/**
 * Buttons on notifications ("Add to list", "Accept", "Approve", "Done") – one implementation shared by
 * Web Push (/api/push/action) and the Telegram bot's inline keyboards.
 */
import { config } from '../config.js';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { addToShopping, getProduct } from './catalog.js';
import { completeCareTask, getCareTask } from './care.js';
import { answerWish } from './kids.js';
import { setOrderStatus } from './orders.js';

export const NOTIFY_ACTIONS = ['shop-add', 'order-accept', 'order-done', 'kid-approve', 'kid-decline', 'care-done'] as const;
export type NotifyAction = (typeof NOTIFY_ACTIONS)[number];
export const isNotifyAction = (s: unknown): s is NotifyAction => typeof s === 'string' && (NOTIFY_ACTIONS as readonly string[]).includes(s);

/** Which id in the notification data an action works on. */
export const ACTION_KEY: Record<NotifyAction, string> = {
  'shop-add': 'product_id',
  'order-accept': 'order_id',
  'order-done': 'order_id',
  'kid-approve': 'wish_id',
  'kid-decline': 'wish_id',
  'care-done': 'care_task_id',
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
  const o = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(ref) as { id: number; status: string } | undefined;
  if (!o) throw httpError(404, 'not found');
  if (action === 'order-accept') {
    if (o.status === 'new') setOrderStatus(o.id, 'accepted');
    const status = o.status === 'new' ? 'accepted' : o.status;
    return { ok: true, summary: o.status === 'new' ? t('Accepted by {name}', { name: actor }) : statusText(o.status), status };
  }
  // order-done
  if (o.status === 'new' || o.status === 'accepted') setOrderStatus(o.id, 'done');
  const status = o.status === 'new' || o.status === 'accepted' ? 'done' : o.status;
  return { ok: true, summary: status === 'done' && o.status !== 'done' ? t('Served by {name}', { name: actor }) : statusText(o.status), status };
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
