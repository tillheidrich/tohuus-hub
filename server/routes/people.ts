/** Profile pictures, child profiles, permanent guests, recipe ratings (area: people) */
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { t } from '../i18n.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { AuthError } from '../lib/auth-sessions.js';
import {
  ANIMALS,
  canEditPerson,
  canRateFor,
  createChild,
  createGuest,
  createLoginLink,
  directory,
  favourites,
  getPerson,
  listPeople,
  logMeal,
  openLoginLink,
  personProfile,
  ratePerson,
  recipeRatings,
  removeChild,
  setColor,
  setFace,
  setGuestAccess,
  setKind,
  setPhoto,
  setPrefs,
  updateChild,
} from '../lib/people.js';
import { GUEST_LEVELS, LEVEL_AREAS, isHouseGuest } from '../lib/people-policy.js';
import { uploadQuota } from '../lib/plans.js';

export const r = Router();
r.use(requireAuth);
/** public: opening a login link (mounted before the session check in server/index.ts) */
export const pub = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
const actorName = (req: Request) => req.actor?.name ?? '?';

const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (e instanceof z.ZodError) return next(e);
      const status = e instanceof AuthError ? e.status : (e as { status?: number }).status;
      if (status) return void res.status(status).json({ error: (e as Error).message });
      next(e);
    }
  };

const forbidden = () => Object.assign(new Error(t('You can’t change this person.')), { status: 403 });
/** family members only (no permanent guests) – parents act for their children */
const family = (req: Request) => {
  if (isHouseGuest(req.actor)) throw Object.assign(new Error(t('Only household members can do this.')), { status: 403 });
};

const face = z.discriminatedUnion('type', [
  z.object({ type: z.literal('initials') }),
  z.object({ type: z.literal('animal'), animal: z.string().refine((a) => ANIMALS.includes(a)) }),
]);
const list = z.array(z.string().trim().max(40)).max(30);
const prefs = z.object({ likes: list.optional(), dislikes: list.optional(), allergies: list.optional() });
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const level = z.enum(GUEST_LEVELS);
const key = (req: Request) => {
  const k = req.params.key ? String(req.params.key) : 'me';
  return k === 'me' ? `u${req.actor?.userId ?? 0}` : k;
};

// ---------------------------------------------------------------- everyone

r.get('/people', wrap((req) => ({ people: listPeople(req.actor), animals: ANIMALS, levels: GUEST_LEVELS, areas: LEVEL_AREAS })));
r.get('/people/directory', wrap(() => directory()));

/** Me as a person – permanent guests see their level and until when an override runs. */
r.get(
  '/people/me',
  wrap((req) => {
    if (req.actor?.kind !== 'user' || !req.actor.userId) return { person: null, guest: null };
    const person = getPerson(`u${req.actor.userId}`, req.actor);
    return { person, guest: req.actor.houseGuest ? { ...req.actor.houseGuest, areas: LEVEL_AREAS[req.actor.houseGuest.level] } : null };
  }),
);

// pictures, colour, likes – /people/me/… for yourself (also guests), /people/person/:key/… for others
const editRoutes = (prefix: string) => {
  r.put(
    `${prefix}/face`,
    wrap((req) => {
      const k = key(req);
      if (!canEditPerson(req.actor, k)) throw forbidden();
      return setFace(k, face.parse(req.body));
    }),
  );
  r.post(
    `${prefix}/photo`,
    upload.single('image'),
    uploadQuota,
    wrap(async (req) => {
      const k = key(req);
      if (!canEditPerson(req.actor, k)) throw forbidden();
      if (!req.file?.buffer) throw Object.assign(new Error(t('No image received')), { status: 400 });
      return setPhoto(k, req.file.buffer);
    }),
  );
  r.delete(
    `${prefix}/photo`,
    wrap((req) => {
      const k = key(req);
      if (!canEditPerson(req.actor, k)) throw forbidden();
      return setFace(k, k.startsWith('k') ? { type: 'animal', animal: ANIMALS[0] } : { type: 'initials' });
    }),
  );
  r.put(
    `${prefix}/color`,
    wrap((req) => {
      const k = key(req);
      if (!canEditPerson(req.actor, k)) throw forbidden();
      setColor(k, z.object({ color }).parse(req.body).color);
      return { ok: true };
    }),
  );
  r.put(
    `${prefix}/prefs`,
    wrap((req) => {
      const k = key(req);
      if (!canEditPerson(req.actor, k)) throw forbidden();
      return setPrefs(k, prefs.parse(req.body));
    }),
  );
};
editRoutes('/people/me');
editRoutes('/people/person/:key');

/** One person: what they like, what they don't, what was cooked for them most. */
r.get('/people/person/:key', wrap((req) => personProfile(key(req), req.actor)));

// ---------------------------------------------------------------- ratings

r.get('/people/recipes/:id/ratings', wrap((req) => recipeRatings(Number(req.params.id), req.actor)));

r.put(
  '/people/recipes/:id/ratings',
  wrap((req) => {
    const b = z.object({ person: z.string().max(12), value: z.number().int().min(1).max(5).nullable() }).parse(req.body);
    const k = b.person === 'me' ? `u${req.actor?.userId ?? 0}` : b.person;
    if (!canRateFor(req.actor, k)) throw forbidden();
    ratePerson(Number(req.params.id), k, b.value, actorName(req), 'detail');
    return recipeRatings(Number(req.params.id), req.actor);
  }),
);

/** After "cooked it": one tap per person at the table. */
r.post(
  '/people/recipes/:id/meal',
  wrap((req) => {
    const b = z.object({ entries: z.array(z.object({ person: z.string().max(12), value: z.number().int().min(1).max(5).nullable() })).max(30) }).parse(req.body);
    for (const e of b.entries) if (!canRateFor(req.actor, e.person)) throw forbidden();
    logMeal(Number(req.params.id), b.entries, actorName(req));
    return recipeRatings(Number(req.params.id), req.actor);
  }),
);

r.get('/people/favourites', wrap((req) => favourites(req.actor)));

// ---------------------------------------------------------------- children (admins; the same profiles as kid mode)

const childInput = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  color: color.optional(),
  birth_year: z.number().int().nullable().optional(),
  face: face.optional(),
  likes: list.optional(),
  dislikes: list.optional(),
  allergies: list.optional(),
});

r.post(
  '/people/children',
  requireAdmin,
  wrap((req) => {
    const b = childInput.parse(req.body);
    if (!b.name) throw Object.assign(new Error(t('Please enter a name.')), { status: 400 });
    return createChild(b);
  }),
);
r.patch('/people/children/:id', requireAdmin, wrap((req) => updateChild(Number(req.params.id), childInput.parse(req.body))));
r.delete(
  '/people/children/:id',
  requireAdmin,
  wrap((req) => {
    removeChild(Number(req.params.id));
    return { ok: true };
  }),
);

// ---------------------------------------------------------------- permanent guests (admins)

r.post(
  '/people/guests',
  requireAdmin,
  wrap((req) => {
    const b = z.object({ name: z.string().trim().min(1).max(40), color: color.optional(), level: level.default('order'), email: z.string().trim().max(254).nullable().optional() }).parse(req.body);
    return createGuest(b);
  }),
);

r.patch(
  '/people/guests/:id',
  requireAdmin,
  wrap((req) => {
    const b = z
      .object({
        level: level.optional(),
        override: z.object({ level: z.enum([...GUEST_LEVELS, 'paused']), until: z.string().max(40) }).nullable().optional(),
      })
      .parse(req.body);
    return setGuestAccess(Number(req.params.id), b, req.actor);
  }),
);

/** Make a member a permanent guest (or back). */
r.put(
  '/people/users/:id/kind',
  requireAdmin,
  wrap((req) => {
    const b = z.object({ kind: z.enum(['member', 'guest']), level: level.optional() }).parse(req.body);
    return setKind(Number(req.params.id), b.kind, req.actor, b.level);
  }),
);

/** "Send login link": by e-mail, or a link / QR code to hand over when mail isn't set up. */
r.post(
  '/people/users/:id/login-link',
  requireAdmin,
  wrap((req) => {
    const b = z.object({ deliver: z.enum(['email', 'link']).default('link'), email: z.string().trim().max(254).nullable().optional() }).parse(req.body ?? {});
    family(req);
    return createLoginLink(Number(req.params.id), req.actor, b.deliver, b.email);
  }),
);

// ---------------------------------------------------------------- public

pub.post('/people/login/open', wrap((req, res) => openLoginLink(req, res, z.object({ token: z.string().max(200) }).parse(req.body).token)));
