/** Purchase rhythm (rhythm.ts): what is probably due, from receipts and list ticks – no stock needed. */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { acceptRhythm, dismissRhythm, rhythmList, RhythmError } from '../lib/rhythm.js';

export const r = Router();

const actorName = (req: any): string => req.actor?.name ?? 'unknown';
const fail = (res: any, e: unknown) => {
  if (e instanceof RhythmError) return res.status(e.status).json({ error: e.message });
  throw e;
};

r.get('/rhythm', requireAuth, (req, res) => {
  const all = rhythmList();
  res.json(req.query.all === '1' ? all : all.filter((x) => !x.muted));
});

r.post('/rhythm/:productId/accept', requireAuth, (req, res) => {
  try {
    res.json(acceptRhythm(Number(req.params.productId), actorName(req)));
  } catch (e) {
    fail(res, e);
  }
});

r.post('/rhythm/:productId/dismiss', requireAuth, (req, res) => {
  try {
    res.json(dismissRhythm(Number(req.params.productId)));
  } catch (e) {
    fail(res, e);
  }
});
