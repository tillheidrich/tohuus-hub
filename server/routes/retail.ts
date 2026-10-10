/** More retailers, e-mail inbox for receipts, use-by vs best-before, waste value */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
