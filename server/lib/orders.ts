/** Orders from the sofa (household members) and from guests – one code path. */
import { z } from 'zod';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { listProducts } from './catalog.js';
import { notify } from './notify.js';

export const orderSchema = z.object({
  guest_name: z.string().trim().min(1).max(40).optional(),
  note: z.string().max(300).nullable().optional(),
  lines: z
    .array(
      z.object({
        product_id: z.number(),
        qty: z.number().int().min(1).max(20),
        options: z.array(z.string().max(40)).max(10).default([]),
        note: z.string().trim().max(120).nullable().optional(),
      }),
    )
    .max(30),
});
export type OrderInput = z.infer<typeof orderSchema>;

type MenuProduct = ReturnType<typeof listProducts>[number];

function menuItem(p: MenuProduct, group: string) {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    image_path: p.image_path,
    image_credit: p.image_credit,
    group,
    options: p.order_options,
    available: p.track_mode === 'none' ? true : p.total > 0,
    // stock numbers are only shown roughly
    hint: p.track_mode === 'none' || !p.orderable ? null : p.total <= 0 ? t('all gone') : p.total <= 2 ? t('only a few left') : null,
    bar: p.orderable,
  };
}

/**
 * Guests see the bar menu. Household members additionally get everything that is in the house,
 * grouped by category – "bring me the crisps" works too.
 */
export function orderMenu(member: boolean) {
  const products = listProducts();
  const bar = products.filter((p) => p.orderable).map((p) => menuItem(p, p.order_group ?? t('Other')));
  if (!member) return bar;
  const cats = new Map((db.prepare('SELECT id, name, sort FROM categories').all() as { id: number; name: string; sort: number }[]).map((c) => [c.id, c]));
  const rest = products
    .filter((p) => !p.orderable && p.track_mode !== 'none' && p.total > 0)
    .sort((a, b) => (cats.get(a.category_id ?? -1)?.sort ?? 99) - (cats.get(b.category_id ?? -1)?.sort ?? 99))
    .map((p) => menuItem(p, cats.get(p.category_id ?? -1)?.name ?? t('Other')));
  return [...bar, ...rest];
}

export function createOrder(input: OrderInput, who: { guestLinkId?: number | null; userId?: number | null; name: string; linkName?: string | null }) {
  const member = Boolean(who.userId);
  const products = new Map(listProducts().filter((p) => p.orderable || (member && p.track_mode !== 'none')).map((p) => [p.id, p]));
  // only orderable products, options only from the product's own choices
  const lines = input.lines
    .filter((l) => products.has(l.product_id))
    .map((l) => {
      const allowed = new Set(products.get(l.product_id)!.order_options.flatMap((o: any) => o.choices as string[]));
      return { ...l, options: l.options.filter((o) => allowed.has(o)), note: l.note?.trim() || null };
    });
  // a free-text wish ("a blanket, please") is an order too – for household members
  if (!lines.length && !(member && input.note?.trim())) throw Object.assign(new Error(t('Nothing orderable in the basket.')), { status: 400 });
  const name = (input.guest_name?.trim() || who.name).slice(0, 40);
  const oid = db.transaction(() => {
    const id = Number(
      db.prepare('INSERT INTO orders (guest_link_id, user_id, guest_name, note) VALUES (?, ?, ?, ?)').run(who.guestLinkId ?? null, who.userId ?? null, name, input.note?.trim() || null).lastInsertRowid,
    );
    const ins = db.prepare('INSERT INTO order_lines (order_id, product_id, name, qty, options, note) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of lines) ins.run(id, l.product_id, products.get(l.product_id)!.name, l.qty, JSON.stringify(l.options), l.note);
    return id;
  })();
  emit('orders');
  const text = lines
    .map((l) => {
      const extra = [...l.options, ...(l.note ? [`„${l.note}“`] : [])];
      return `${l.qty}× ${products.get(l.product_id)!.name}${extra.length ? ` (${extra.join(', ')})` : ''}`;
    })
    .join(', ');
  void notify({
    event: 'order.new',
    title: t('Order from {name}', { name }),
    message: input.note ? (text ? t('{items} – “{note}”', { items: text, note: input.note }) : `„${input.note}“`) : text,
    path: '/bar',
    data: { order_id: oid, guest: name, link: who.linkName ?? null, items: lines.length },
  });
  return oid;
}

export function listOrders(where: string, arg: number) {
  const rows = db
    .prepare(
      `SELECT o.id, o.guest_name, o.status, o.note, o.created_at, o.updated_at,
         (SELECT json_group_array(json_object('name', name, 'qty', qty, 'options', json(options), 'note', note)) FROM order_lines WHERE order_id = o.id) AS lines
       FROM orders o WHERE ${where} ORDER BY id DESC LIMIT 20`,
    )
    .all(arg) as any[];
  return rows.map((o) => ({ ...o, lines: JSON.parse(o.lines) }));
}
