/**
 * Settings › Data, plan & account › Data & reset (lib/wipe.ts, docs/data-and-reset.md).
 *
 * Only people who signed in themselves: no API/MCP tokens, no guests, no kids' devices – deleting whole areas is
 * deliberately not offered to the assistant, MCP or scripts. Admins clear areas, everything or the sample data;
 * every member may delete their own private entries. Allowed in the read-only state of the cloud (plans.ts).
 */
import { Router } from 'express';
import { z } from 'zod';
import { db, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { requireAuth } from '../lib/auth.js';
import { demoStatus, startChoice } from '../lib/tour.js';
import {
  AREAS,
  RESTORE_DAYS,
  WipeError,
  areaCounts,
  finalizeWipe,
  getWipe,
  mayHandle,
  mineCount,
  restoreWipe,
  wipeAreas,
  wipeDemo,
  wipeEverything,
  wipeHistory,
  wipeMine,
  type WipeActor,
} from '../lib/wipe.js';

export const r = Router();
r.use(requireAuth);

/** Words that confirm "everything" and "money" (the household language and English always work). */
export const wipeWords = () => [t('DELETE'), 'DELETE'].map((w) => w.trim().toLocaleUpperCase());

interface Who {
  actor: WipeActor;
  admin: boolean;
}

/** A person signed in as themselves (member or admin) – or null (token, guest, house guest, kid device). */
export function wipeWho(a: any): Who | null {
  if (!a || a.kind !== 'user' || a.userId == null || a.houseGuest) return null;
  const u = db.prepare('SELECT role, kind FROM users WHERE id = ?').get(a.userId) as { role: string; kind?: string } | undefined;
  if (!u || (u.kind && u.kind !== 'member')) return null;
  return { actor: { userId: a.userId, name: a.name ?? '' }, admin: a.role === 'admin' && u.role === 'admin' };
}

const deny = (res: any) => res.status(403).json({ error: t('Only members of the household can do this.'), code: 'wipe.forbidden' });
const fail = (res: any, e: unknown) => res.status(e instanceof WipeError ? e.status : 500).json({ error: (e as Error).message });

r.get('/data/wipe', (req, res) => {
  const who = wipeWho(req.actor);
  if (!who) return void deny(res);
  const demo = who.admin ? demoStatus() : null;
  res.json({
    admin: who.admin,
    restoreDays: RESTORE_DAYS,
    confirmWord: t('DELETE'),
    areas: who.admin ? areaCounts(who.actor.userId) : null,
    demo: demo ? { rows: demo.rows, products: demo.products, recipes: demo.recipes, used: demo.used } : null,
    mine: mineCount(who.actor.userId!),
    history: wipeHistory(who.actor.userId, who.admin),
  });
});

const body = z.object({
  target: z.enum(['areas', 'everything', 'demo', 'mine']),
  areas: z.array(z.enum(AREAS)).max(AREAS.length).default([]),
  keepPlaces: z.boolean().default(true),
  keepRecipes: z.boolean().default(false),
  includeUsed: z.boolean().default(false),
  confirm: z.string().max(40).optional(),
});

r.post('/data/wipe', async (req, res) => {
  const who = wipeWho(req.actor);
  if (!who) return void deny(res);
  const b = body.parse(req.body ?? {});
  if (b.target !== 'mine' && !who.admin) return void deny(res);
  const strong = b.target === 'everything' || (b.target === 'areas' && b.areas.includes('money'));
  if (strong && !wipeWords().includes((b.confirm ?? '').trim().toLocaleUpperCase())) {
    res.status(400).json({ error: t('Type {word} to confirm.', { word: t('DELETE') }), code: 'wipe.confirm' });
    return;
  }
  try {
    if (b.target === 'mine') return void res.json({ ok: true, wipe: wipeMine(who.actor) });
    if (b.target === 'demo') {
      const out = wipeDemo(b.includeUsed, who.actor);
      if (startChoice().choice === null) setSetting('tour.start', 'empty');
      return void res.json({ ok: true, wipe: out, kept: out.kept });
    }
    if (b.target === 'everything') return void res.json({ ok: true, wipe: await wipeEverything({ keepPlaces: b.keepPlaces }, who.actor) });
    res.json({ ok: true, wipe: await wipeAreas(b.areas, { keepPlaces: b.keepPlaces, keepRecipes: b.keepRecipes }, who.actor) });
  } catch (e) {
    fail(res, e);
  }
});

r.post('/data/wipe/:id/restore', (req, res) => {
  const who = wipeWho(req.actor);
  if (!who) return void deny(res);
  const w = getWipe(Number(req.params.id));
  if (!w || !mayHandle(w, { userId: who.actor.userId, admin: who.admin })) return void res.status(404).json({ error: t('Not found.') });
  try {
    res.json({ ok: true, ...restoreWipe(w.id, who.actor) });
  } catch (e) {
    fail(res, e);
  }
});

/** "Endgültig löschen": the snapshot and the held files go now instead of after the restore window. */
r.post('/data/wipe/:id/final', (req, res) => {
  const who = wipeWho(req.actor);
  if (!who) return void deny(res);
  const w = getWipe(Number(req.params.id));
  if (!w || !mayHandle(w, { userId: who.actor.userId, admin: who.admin })) return void res.status(404).json({ error: t('Not found.') });
  try {
    res.json({ ok: true, wipe: finalizeWipe(w.id) });
  } catch (e) {
    fail(res, e);
  }
});
