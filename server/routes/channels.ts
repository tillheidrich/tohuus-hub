/** More notification channels: Telegram (two-way), Gotify, Matrix */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
