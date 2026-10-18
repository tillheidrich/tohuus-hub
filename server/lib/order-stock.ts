/**
 * „Bring mir was“: soft stock reservation for open wishes and the per-device id of a guest.
 * (Moved out of the former party mode on 18 Oct 2026 – used by the menu, household wishes and guest links.)
 */
import type { Request, Response } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { randomToken } from './auth.js';
import type { listProducts } from './catalog.js';

const httpError = (status: number, msg: string) => Object.assign(new Error(msg), { status });

/** Quantities promised to open orders that haven't been booked out of stock yet. */
export function reservedByProduct(excludeOrderId?: number): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT l.product_id AS id, SUM(l.qty) AS qty FROM order_lines l JOIN orders o ON o.id = l.order_id
       WHERE o.status IN ('new','accepted') AND o.stock_booked = 0 AND l.product_id IS NOT NULL ${excludeOrderId ? 'AND o.id != ?' : ''}
       GROUP BY l.product_id`,
    )
    .all(...(excludeOrderId ? [excludeOrderId] : [])) as { id: number; qty: number }[];
  return new Map(rows.map((r) => [r.id, r.qty]));
}

type P = ReturnType<typeof listProducts>[number];

/** How many more can be promised. Untracked and fill-level items are never counted down. */
export function availableQty(p: Pick<P, 'id' | 'track_mode' | 'total'>, reserved: Map<number, number>) {
  if (p.track_mode === 'none') return Infinity;
  if (p.track_mode === 'level') return p.total > 0 ? Infinity : 0;
  return Math.max(0, p.total - (reserved.get(p.id) ?? 0));
}

/** Throws 409 when an order would promise more than is in the house (counting open orders). */
export function assertAvailable(lines: { product_id: number; qty: number }[], products: Map<number, P>) {
  const reserved = reservedByProduct();
  const want = new Map<number, number>();
  for (const l of lines) want.set(l.product_id, (want.get(l.product_id) ?? 0) + l.qty);
  for (const [id, qty] of want) {
    const p = products.get(id);
    if (!p) continue;
    const left = availableQty(p, reserved);
    if (qty > left) throw httpError(409, left <= 0 ? t('{name} is all gone – sorry!', { name: p.name }) : t('Only {n} × {name} left.', { n: left, name: p.name }));
  }
}

const CLIENT_COOKIE = 'sw_gc';
/** Per-device guest id (cookie): a guest only sees the wishes sent from their own phone. */
export function guestClientId(req: Request, res: Response): string {
  const c = req.cookies?.[CLIENT_COOKIE];
  if (typeof c === 'string' && /^[A-Za-z0-9_-]{16,48}$/.test(c)) return c;
  const id = randomToken(16);
  res.cookie(CLIENT_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.baseUrl.startsWith('https://'),
    path: '/api/guest',
    maxAge: 365 * 86400_000,
  });
  if (req.cookies) req.cookies[CLIENT_COOKIE] = id;
  return id;
}
