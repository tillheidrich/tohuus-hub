/** Onboarding, help, what's new, polish */
import { Router } from 'express';
import { z } from 'zod';
import { db, setSetting } from '../db.js';
import { LANG_CODES } from '../languages.js';
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
import { BASE_LOCATIONS, baseName } from '../lib/basedata.js';
import { CLIMATES, FORMS, PRESETS, homePreset, setHomeSetup, templatesFor } from '../lib/places.js';

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

const STEP_NEXT: Record<string, string> = { home: 'where', where: 'places', places: 'spots', spots: 'invite', invite: 'stock' };
/** Move the stored step on – never backwards (another device may already be further). */
function advance(from: string) {
  const cur = onboardState().step;
  return updateOnboardState({ started: true, step: (cur === from ? STEP_NEXT[from] ?? cur : cur) as any });
}

const roomAdd = z.union([
  z.string().max(60),
  z.object({
    name: z.string().max(60).optional(),
    key: z.string().max(40).nullable().optional(),
    icon: z.string().max(40).nullable().optional(),
    climate: z.enum(CLIMATES).nullable().optional(),
    parent_id: z.number().int().positive().nullable().optional(),
  }),
]);
const rooms = z.object({ keep: z.array(z.number().int()).max(300), add: z.array(roomAdd).max(40).default([]) });

/** Step 1: household name, language and who lives here (household form). Rooms are still accepted (older clients). */
r.put('/onboarding/home', requireAdmin, (req, res) => {
  const b = z
    .object({
      household: z.string().trim().min(1).max(60).optional(),
      language: z.enum(LANG_CODES).optional(),
      form: z.enum(FORMS).nullable().optional(),
      preset: z.enum(PRESETS).nullable().optional(),
      rooms: rooms.optional(),
    })
    .parse(req.body ?? {});
  if (b.household) setSetting('household.name', b.household);
  if (b.language) setSetting('language', b.language);
  if (b.form !== undefined || b.preset !== undefined) setHomeSetup({ form: b.form, preset: b.preset });
  const out = b.rooms ? setRooms(b.rooms) : null;
  const state = advance('home');
  emit('settings', 'stock');
  res.json({ ok: true, rooms: out, state });
});

/** Step 2: "Wie wohnt ihr?" – null = skipped. Only steers suggestions and the illustration. */
r.put('/onboarding/where', requireAdmin, (req, res) => {
  const b = z.object({ preset: z.enum(PRESETS).nullable() }).parse(req.body ?? {});
  setHomeSetup({ preset: b.preset });
  res.json({ ok: true, state: advance('where') });
});

/** Step 3: "Welche Orte möchtet ihr verwalten?" – free multi-select, an empty selection is fine. */
r.put('/onboarding/places', requireAdmin, (req, res) => {
  const b = rooms.parse(req.body ?? {});
  const out = setRooms(b as any);
  res.json({ ok: true, rooms: out, state: advance('places') });
});

/** Step 4 (optional): storage spots inside the chosen places (shelves, devices …). */
r.put('/onboarding/spots', requireAdmin, (req, res) => {
  const b = z.object({ add: z.array(roomAdd).max(60).default([]) }).parse(req.body ?? {});
  const keep = (db.prepare(`SELECT id FROM locations`).all() as { id: number }[]).map((x) => x.id);
  const out = setRooms({ keep, add: b.add as any });
  res.json({ ok: true, rooms: out, state: advance('spots') });
});

/** Suggestions for step 3 (by preset) and step 4 (`?spots=1`). */
r.get('/onboarding/place-templates', (req, res) => {
  const p = z.enum(PRESETS).nullable().catch(null).parse(req.query.preset ?? homePreset());
  res.json(templatesFor(p, req.query.spots === '1'));
});

/** Base rooms that could be added back as chips (`name` in the household language, en/de for matching renamed rooms). */
r.get('/onboarding/room-templates', (_req, res) => res.json(BASE_LOCATIONS.map((l) => ({ key: l.key, en: l.en, de: l.de, name: baseName(l), icon: l.icon }))));

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
