/** Shopping: store mode, offline, claims, quick add, web push, HA todo */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
