/** Keeping stock fresh: quick check, freeze/opened, leftovers, forecasts */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
