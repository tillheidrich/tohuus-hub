/** Spending analytics: charts, periods, budgets, include/exclude, manual expenses */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
