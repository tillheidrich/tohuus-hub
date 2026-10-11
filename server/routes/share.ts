/** Share target, discreet entries, start mode */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
