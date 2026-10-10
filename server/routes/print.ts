/** Digital receipts/tickets and thermal/receipt printers */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
