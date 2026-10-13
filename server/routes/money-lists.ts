/** Geldlisten: split costs of an occasion (docs/money.md › "Geldlisten"). Members only – never permanent guests. */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import {
  addFromSource,
  addItem,
  addPayment,
  createMoneyList,
  deleteItem,
  deleteMoneyList,
  deletePayment,
  getMoneyList,
  listMoneyLists,
  moneySources,
  MoneyListError,
  setPeople,
  updateItem,
  updateItems,
  updateMoneyList,
} from '../lib/money-lists.js';

export const r = Router();
r.use('/money/lists', requireAuth);
r.use('/money/sources', requireAuth);

const uid = (req: Request) => req.actor?.userId ?? null;
const id = (v: unknown) => z.coerce.number().int().positive().parse(v);

const h = (fn: (req: Request) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.actor?.houseGuest) return void res.status(403).json({ error: 'forbidden' });
    res.json(fn(req));
  } catch (e) {
    if (e instanceof MoneyListError) res.status(e.status).json({ error: e.message });
    else next(e);
  }
};

const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shopping'), list_id: z.number().int().min(0).nullable().optional(), which: z.enum(['open', 'checked', 'all']).optional() }),
  z.object({ kind: z.literal('trip'), trip_id: z.number().int().positive() }),
  z.object({ kind: z.literal('entries'), keys: z.array(z.string().regex(/^[le]:\d+$/)).min(1).max(500) }),
  z.object({ kind: z.literal('receipt'), import_id: z.number().int().positive() }),
]);
const person = z.object({ id: z.number().int().positive().optional(), user_id: z.number().int().positive().nullable().optional(), name: z.string().max(60).nullable().optional() });
const pid = z.number().int().positive().nullable().optional();

r.get('/money/lists', h((req) => listMoneyLists(uid(req))));
r.get('/money/sources', h((req) => moneySources(uid(req))));

r.post(
  '/money/lists',
  h((req) => {
    const b = z
      .object({
        title: z.string().max(80).nullable().optional(),
        note: z.string().max(300).nullable().optional(),
        mode: z.enum(['equal', 'items']).optional(),
        visibility: z.enum(['household', 'private']).optional(),
        share_with: z.array(z.number().int().positive()).max(40).optional(),
        people: z.array(person).max(40).optional(),
        count: z.number().int().min(1).max(40).optional(),
        from: source.optional(),
        items: z.array(z.object({ name: z.string().min(1).max(120), amount: z.number().min(-999999).max(999999), qty: z.number().nullable().optional() })).max(200).optional(),
      })
      .parse(req.body);
    return createMoneyList(b, uid(req));
  }),
);

r.get('/money/lists/:id', h((req) => getMoneyList(id(req.params.id), uid(req))));
r.patch(
  '/money/lists/:id',
  h((req) => {
    const b = z
      .object({
        title: z.string().min(1).max(80).optional(),
        note: z.string().max(300).nullable().optional(),
        mode: z.enum(['equal', 'items']).optional(),
        visibility: z.enum(['household', 'private']).optional(),
        share_with: z.array(z.number().int().positive()).max(40).optional(),
        settled: z.boolean().optional(),
      })
      .parse(req.body);
    return updateMoneyList(id(req.params.id), b, uid(req));
  }),
);
r.delete('/money/lists/:id', h((req) => deleteMoneyList(id(req.params.id), uid(req))));

r.put('/money/lists/:id/people', h((req) => setPeople(id(req.params.id), z.object({ people: z.array(person).min(1).max(40) }).parse(req.body).people, uid(req))));

const item = z.object({ name: z.string().min(1).max(120).optional(), amount: z.number().min(-999999).max(999999).optional(), qty: z.number().min(0).max(9999).nullable().optional(), paid_by: pid, for_person: pid });
r.post('/money/lists/:id/items', h((req) => addItem(id(req.params.id), item.parse(req.body), uid(req))));
/** More from a source ({ from }) */
r.post('/money/lists/:id/items/import', h((req) => addFromSource(id(req.params.id), z.object({ from: source }).parse(req.body).from, uid(req))));
/** Several at once: { ids: [..] | 'all', paid_by?, for_person? } */
r.post(
  '/money/lists/:id/items/bulk',
  h((req) => {
    const b = z.object({ ids: z.union([z.literal('all'), z.array(z.number().int().positive()).max(500)]), paid_by: pid, for_person: pid }).parse(req.body);
    return updateItems(id(req.params.id), b.ids, { paid_by: b.paid_by, for_person: b.for_person }, uid(req));
  }),
);
r.patch('/money/lists/:id/items/:itemId', h((req) => updateItem(id(req.params.id), id(req.params.itemId), item.parse(req.body), uid(req))));
r.delete('/money/lists/:id/items/:itemId', h((req) => deleteItem(id(req.params.id), id(req.params.itemId), uid(req))));

r.post(
  '/money/lists/:id/payments',
  h((req) => addPayment(id(req.params.id), z.object({ from: z.number().int().positive(), to: z.number().int().positive(), amount: z.number().positive().max(999999) }).parse(req.body), uid(req))),
);
r.delete('/money/lists/:id/payments/:paymentId', h((req) => deletePayment(id(req.params.id), id(req.params.paymentId), uid(req))));
