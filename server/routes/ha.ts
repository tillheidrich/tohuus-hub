/** Home Assistant integration API (HACS integration lives in ha-integration/) */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
