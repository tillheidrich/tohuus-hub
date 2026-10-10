/** Regions: currency, units, country receipts (UK, US, SE), OFF country */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
