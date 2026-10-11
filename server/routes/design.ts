/** Appearance settings: household theme (admins) and the personal theme (members, when allowed) */
import { Router } from 'express';
import { z } from 'zod';
import { t } from '../i18n.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { THEMES, appearanceFor, setHouseholdAppearance, setPersonalTheme } from '../lib/appearance.js';
import { emit } from '../lib/bus.js';

export const r = Router();
r.use(requireAuth);

const uid = (req: any): number | null => (req.actor?.kind === 'user' ? (req.actor?.userId ?? null) : null);

r.get('/appearance', (req, res) => res.json(appearanceFor(uid(req))));

r.patch('/appearance/household', requireAdmin, (req, res) => {
  const b = z.object({ theme: z.enum(THEMES).optional(), userChoice: z.boolean().optional() }).parse(req.body);
  setHouseholdAppearance(b);
  emit('settings');
  res.json(appearanceFor(uid(req)));
});

r.patch('/appearance/me', (req, res) => {
  const b = z.object({ theme: z.enum(THEMES).nullable() }).parse(req.body);
  const id = uid(req);
  if (!id) return void res.status(400).json({ error: t('Only members with an account can choose their own appearance.') });
  const cur = appearanceFor(id);
  if (b.theme && !cur.userChoice) return void res.status(403).json({ error: t('Your household uses one appearance for everyone.') });
  setPersonalTheme(id, b.theme);
  res.json(appearanceFor(id));
});
