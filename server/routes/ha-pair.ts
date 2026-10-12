import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { t } from '../i18n.js';
import { rateLimited, rateLimitedGlobal, requireAdmin, requireAuth } from '../lib/auth.js';
import { PairError, cancelPairing, claimPairing, pairingStatus, startPairing } from '../lib/ha-pair.js';

/**
 * Home Assistant pairing by code (docs/home-assistant.md). Mounted before the routers that require a session:
 * `claim` is public (the integration has no token yet), `start`/`status`/`cancel` need a household admin.
 */
export const pub = Router();

const admin = [requireAuth, requireAdmin];

pub.post('/ha/pair/start', ...admin, (req: Request, res: Response) => {
  if (rateLimited('ha-pair-start', 20, 60 * 60_000)) return void res.status(429).json({ error: t('Too many attempts. Please wait a few minutes.') });
  res.json(startPairing(req.actor?.name ?? 'ToHuus'));
});

pub.get('/ha/pair/status', ...admin, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(pairingStatus());
});

pub.delete('/ha/pair', ...admin, (_req, res) => {
  cancelPairing();
  res.json({ ok: true });
});

pub.post('/ha/pair/claim', (req: Request, res: Response, next: NextFunction) => {
  try {
    // per address and overall: 31^8 codes, 10 tries per 10 minutes per address
    if (rateLimitedGlobal(`ha-pair:${req.ip}`, 10, 10 * 60_000) || rateLimitedGlobal('ha-pair:all', 300, 10 * 60_000))
      return void res.status(429).json({ error: t('Too many attempts. Please wait a few minutes.'), code: 'too_many_attempts' });
    const b = z.object({ code: z.string().max(40), name: z.string().max(200).nullish() }).parse(req.body ?? {});
    res.setHeader('Cache-Control', 'no-store');
    res.json(claimPairing(b));
  } catch (e) {
    if (e instanceof PairError) return void res.status(e.status).json({ error: e.message, code: e.code });
    next(e);
  }
});
