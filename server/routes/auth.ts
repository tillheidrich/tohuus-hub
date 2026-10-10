/** Sign-in methods: magic link, SSO (OIDC), passkeys, devices */
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';

export const r = Router();
r.use(requireAuth);
