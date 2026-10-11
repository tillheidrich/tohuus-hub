/** The order menu editor (/bestellen/karte). Reading is open to every signed-in person; permanent guests can't edit. */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import {
  AVAILABILITY,
  addItem,
  applyTemplate,
  createGroup,
  deleteGroup,
  findItem,
  itemPatchSchema,
  menuView,
  newItemSchema,
  orderGroups,
  orderItems,
  removeItem,
  renameGroup,
  suggestions,
  templateList,
  updateItem,
} from '../lib/menu.js';

export const r = Router();
r.use(requireAuth);

const num = (s: unknown) => Number.parseInt(String(s), 10);

/** Wrap a handler: friendly errors with their status (zod errors go to the global handler as 400). */
const h =
  (fn: (req: any, res: any) => unknown) =>
  (req: any, res: any, next: any) => {
    try {
      const out = fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status) res.status(status).json({ error: (e as Error).message });
      else next(e);
    }
  };

r.get('/menu', h(() => menuView()));
r.get('/menu/suggestions', h((req) => suggestions(String(req.query.q ?? '').slice(0, 60))));
r.get('/menu/templates', h(() => templateList()));
r.post('/menu/templates/:key', h((req) => applyTemplate(String(req.params.key))));

r.post(
  '/menu/groups',
  h((req) => ({ id: createGroup(z.object({ name: z.string().max(40) }).parse(req.body).name) })),
);
r.put(
  '/menu/groups/order',
  h((req) => {
    orderGroups(z.object({ ids: z.array(z.number().int()).max(100) }).parse(req.body).ids);
    return { ok: true };
  }),
);
r.patch(
  '/menu/groups/:id',
  h((req) => {
    renameGroup(num(req.params.id), z.object({ name: z.string().max(40) }).parse(req.body).name);
    return { ok: true };
  }),
);
r.delete(
  '/menu/groups/:id',
  h((req) => {
    const b = z.object({ move_to: z.number().int().nullable().optional(), remove_items: z.boolean().optional() }).parse({
      move_to: req.query.move_to ? num(req.query.move_to) : (req.body?.move_to ?? null),
      remove_items: req.query.remove_items === '1' || req.body?.remove_items === true,
    });
    deleteGroup(num(req.params.id), { moveTo: b.move_to, removeItems: b.remove_items });
    return { ok: true };
  }),
);
r.put(
  '/menu/groups/:id/items',
  h((req) => {
    orderItems(num(req.params.id), z.object({ ids: z.array(z.number().int()).max(200) }).parse(req.body).ids);
    return { ok: true };
  }),
);

r.post(
  '/menu/items',
  h((req) => {
    const id = addItem(newItemSchema.parse(req.body));
    return { id, item: findItem(id) };
  }),
);
r.patch(
  '/menu/items/:id',
  h((req) => {
    const id = updateItem(num(req.params.id), itemPatchSchema.parse(req.body));
    return { id, item: findItem(id) };
  }),
);
r.post(
  '/menu/items/:id/availability',
  h((req) => {
    const id = updateItem(num(req.params.id), { availability: z.object({ availability: z.enum(AVAILABILITY) }).parse(req.body).availability });
    return { id, item: findItem(id) };
  }),
);
r.delete(
  '/menu/items/:id',
  h((req) => {
    removeItem(num(req.params.id));
    return { ok: true };
  }),
);
