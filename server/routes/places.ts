/** Places as a tree with climate and archive, household form and home preset (area: home). */
import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import {
  CLIMATES,
  FORMS,
  PRESETS,
  PlaceError,
  createPlace,
  deletePlace,
  homeSetup,
  homeSnapshot,
  homePreset,
  listPlaces,
  reorderPlaces,
  setHomeSetup,
  templatesFor,
  updatePlace,
} from '../lib/places.js';

export const r = Router();
r.use(requireAuth);

const id = (v: unknown) => z.coerce.number().int().positive().parse(v);
const fail = (res: any, e: unknown) => {
  if (e instanceof PlaceError) return void res.status(e.status).json({ error: e.message });
  throw e;
};

const climate = z.enum(CLIMATES);
const name = z.string().trim().min(1).max(60);

/** Places for pickers and lists; `?all=1` also archived ones (Settings). */
r.get('/locations', (req, res) => res.json(listPlaces({ all: req.query.all === '1' || req.query.all === 'true' })));

r.post('/locations', requireAdmin, (req, res) => {
  const b = z
    .object({
      name: name.optional(),
      key: z.string().max(40).nullable().optional(),
      kind: z.string().max(30).nullable().optional(),
      icon: z.string().max(40).nullable().optional(),
      climate: climate.nullable().optional(),
      parent_id: z.number().int().positive().nullable().optional(),
      hint: z.string().max(200).nullable().optional(),
      owner_user_id: z.number().int().positive().nullable().optional(),
    })
    .parse(req.body ?? {});
  try {
    res.json({ id: createPlace(b) });
  } catch (e) {
    fail(res, e);
  }
});

r.patch('/locations/:id', requireAdmin, (req, res) => {
  const b = z
    .object({
      name: name.optional(),
      icon: z.string().max(40).optional(),
      kind: z.string().max(30).optional(),
      sort: z.number().optional(),
      hint: z.string().max(200).nullable().optional(),
      parent_id: z.number().int().positive().nullable().optional(),
      climate: climate.nullable().optional(),
      archived: z.boolean().optional(),
      owner_user_id: z.number().int().positive().nullable().optional(),
    })
    .parse(req.body ?? {});
  try {
    res.json(updatePlace(id(req.params.id), b));
  } catch (e) {
    fail(res, e);
  }
});

r.delete('/locations/:id', requireAdmin, (req, res) => {
  try {
    res.json(deletePlace(id(req.params.id)));
  } catch (e) {
    fail(res, e);
  }
});

/** New order (siblings top to bottom). */
r.put('/locations/order', requireAdmin, (req, res) => {
  const b = z.object({ ids: z.array(z.number().int().positive()).min(1).max(300) }).parse(req.body ?? {});
  res.json(reorderPlaces(b.ids));
});

/** Suggestions: rooms by home preset, or storage spots (`?spots=1`). */
r.get('/locations/templates', (req, res) => {
  const p = z.enum(PRESETS).nullable().catch(null).parse(req.query.preset ?? homePreset());
  res.json(templatesFor(p, req.query.spots === '1'));
});

/** Household form and home preset. */
r.get('/home/setup', (_req, res) => res.json(homeSnapshot()));

r.put('/home/setup', requireAdmin, (req, res) => {
  const b = z.object({ form: z.enum(FORMS).nullable().optional(), preset: z.enum(PRESETS).nullable().optional() }).parse(req.body ?? {});
  setHomeSetup(b);
  res.json(homeSetup());
});
