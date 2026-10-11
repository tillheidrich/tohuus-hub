/** Profile pictures, child profiles, permanent guests, recipe ratings */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
