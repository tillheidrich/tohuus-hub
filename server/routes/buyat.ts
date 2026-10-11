/** "Where to buy?" on products and shopping items (wave 6). Values are only ever set here, by a person. */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { BUY_AT_MAX, buyAtSuggestions, setItemBuyAt, setProductBuyAt } from '../lib/buyat.js';

export const r = Router();
r.use(requireAuth);

const list = z.object({ buy_at: z.array(z.string().trim().max(40)).max(BUY_AT_MAX) });
const fail = (res: any, e: unknown) => res.status((e as any).status ?? 500).json({ error: (e as Error).message });

r.get('/buy-at/suggestions', (_req, res) => res.json(buyAtSuggestions()));

r.put('/products/:id/buy-at', (req, res) => {
  try {
    res.json({ buy_at: setProductBuyAt(Number(req.params.id), list.parse(req.body).buy_at) });
  } catch (e) {
    fail(res, e);
  }
});

r.put('/shop/items/:id/buy-at', (req, res) => {
  try {
    res.json(setItemBuyAt(Number(req.params.id), list.parse(req.body).buy_at));
  } catch (e) {
    fail(res, e);
  }
});
