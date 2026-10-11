/** Rotating meal plans and family food votes */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
