/** Onboarding, help, what's new, polish */
import { Router } from 'express';
import { z } from 'zod';
import { db, setSetting } from '../db.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import {
  STEPS,
  createStarterSet,
  getUserPref,
  gettingStarted,
  onboardState,
  setRooms,
  setUserPref,
  starterSets,
  updateOnboardState,
} from '../lib/onboard.js';
import { BASE_LOCATIONS } from '../lib/basedata.js';

export const r = Router();
r.use(requireAuth);

const actorName = (req: any) => req.actor?.name ?? 'unbekannt';
const uid = (req: any): number | null => req.actor?.userId ?? null;

/** Everything the app needs for the first-run experience of the current user. */
r.get('/onboarding', (req, res) => {
  const s = gettingStarted(uid(req));
  const admin = req.actor?.role === 'admin';
  res.json({ ...s, admin, wizardDue: admin && s.wizardDue });
});

r.patch('/onboarding', requireAdmin, (req, res) => {
  const b = z
    .object({
      step: z.enum(STEPS as [string, ...string[]]).optional(),
      started: z.boolean().optional(),
      closed: z.boolean().optional(),
      skipped: z.boolean().optional(),
      checklistDismissed: z.boolean().optional(),
      stockPath: z.enum(['receipt', 'scan', 'starter']).nullable().optional(),
    })
    .parse(req.body ?? {});
  res.json(updateOnboardState(b as any));
});

/** Members may hide the checklist for the household too – it's just a hint card. */
r.post('/onboarding/checklist/dismiss', (_req, res) => {
  res.json(updateOnboardState({ checklistDismissed: true }));
});

/** Step 1: household name, language, look and rooms in one go. */
r.put('/onboarding/home', requireAdmin, (req, res) => {
  const b = z
    .object({
      household: z.string().trim().min(1).max(60).optional(),
      language: z.enum(['en', 'de']).optional(),
      brand: z.enum(['tohuus', 'fredirando']).optional(),
      rooms: z.object({ keep: z.array(z.number().int()).max(60), add: z.array(z.string().max(60)).max(20).default([]) }).optional(),
    })
    .parse(req.body ?? {});
  if (b.household) setSetting('household.name', b.household);
  if (b.language) setSetting('language', b.language);
  if (b.brand) setSetting('brand', b.brand);
  const rooms = b.rooms ? setRooms(b.rooms) : null;
  const state = updateOnboardState({ started: true, step: onboardState().step === 'home' ? 'invite' : onboardState().step });
  emit('settings', 'stock');
  res.json({ ok: true, rooms, state });
});

/** Base rooms that could be added back as chips (in both languages, the client shows the household one). */
r.get('/onboarding/room-templates', (_req, res) => res.json(BASE_LOCATIONS.map((l) => ({ key: l.key, en: l.en, de: l.de, icon: l.icon }))));

/** Step 3: typical staples per room. */
r.get('/onboarding/starter', (_req, res) => res.json(starterSets()));

r.post('/onboarding/starter', (req, res) => {
  const b = z
    .object({
      items: z
        .array(z.object({ room: z.enum(BASE_LOCATIONS.map((l) => l.key) as [string, ...string[]]), key: z.string().max(40), level: z.number().int().min(0).max(3) }))
        .min(1)
        .max(120),
    })
    .parse(req.body ?? {});
  const out = createStarterSet(b.items as any, actorName(req));
  if (req.actor?.role === 'admin') updateOnboardState({ stockPath: 'starter' });
  res.json(out);
});

// ---------------------------------------------------------------- per-user: what's new

r.get('/me/prefs', (req, res) => {
  const id = uid(req);
  if (!id) return void res.json({ whatsNewSeen: null, createdAt: null });
  const u = db.prepare('SELECT created_at FROM users WHERE id = ?').get(id) as { created_at: string } | undefined;
  res.json({ whatsNewSeen: getUserPref<string | null>(id, 'whatsnew.seen', null), createdAt: u?.created_at ?? null });
});

r.put('/me/prefs/whats-new', (req, res) => {
  const { seen } = z.object({ seen: z.string().regex(/^\d{4}-\d{2}-\d{2}(\.\d{1,2})?$/) }).parse(req.body ?? {});
  const id = uid(req);
  if (id) {
    const cur = getUserPref<string | null>(id, 'whatsnew.seen', null);
    // never go backwards (two devices)
    if (!cur || seen > cur) setUserPref(id, 'whatsnew.seen', seen);
  }
  res.json({ ok: true });
});
