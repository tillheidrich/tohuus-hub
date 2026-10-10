/** What do we eat today, household recipe variants & substitutions, Cookidoo push from HA */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
