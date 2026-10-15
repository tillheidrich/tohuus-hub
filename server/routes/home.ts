/** Home care: maintenance cycles, spending, QR labels */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { fmtDay, t } from '../i18n.js';
import { requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { addToShopping, adjustStock, getProduct, listProducts, localDay, productView } from '../lib/catalog.js';
import {
  CARE_TEMPLATES,
  canSeeTask,
  UNITS,
  careLog,
  careView,
  codeFor,
  completeCareTask,
  createCareTask,
  deleteCareTask,
  dueCareTasks,
  getCareTask,
  learnedEveryDays,
  promiseCareTask,
  listCareTasks,
  recentlyDone,
  qrUrl,
  resolveCode,
  revokeCode,
  undoCareTask,
  updateCareTask,
  type QrKind,
} from '../lib/care.js';
import { focusPrefs, freshStart, setFocusPrefs, suggestSteps } from '../lib/focus.js';
import { LOAD_ANSWERS, loadCards, setLoadAnswer, taskFromCard } from '../lib/loadcards.js';
import { BLICK_AREAS, type BlickArea, blickOverview, setCompareOptIn } from '../lib/blick.js';
import { pointsWeek, setPointsSettings } from '../lib/points.js';
import { reviewAllowed, reviewSeason, yearReview } from '../lib/review.js';
import { BIN_KINDS, calsyncView, reviveKind, setCalendarAiConsent, setCalsyncSettings, suggestFromEvents, syncDates } from '../lib/calsync.js';
import { eventIcs } from '../lib/calendar.js';
import { FreshError, markOpened } from '../lib/fresh.js';
import { requireFeature } from '../lib/limits.js';
import { priceHistory, pricedProducts, setSpendingTarget, spendingCsv, spendingSummary, spendingTarget } from '../lib/spending.js';

export const r = Router();
r.use(requireAuth);

const actorName = (req: Request) => req.actor?.name ?? t('Someone');
const num = (v: unknown) => Number(v);
const day = z.string().regex(/^\d{4}-\d\d-\d\d$/);
/** domain errors (invalid interval, missing date …) are the user's input, not a server fault */
function userError<T>(res: Response, fn: () => T) {
  try {
    res.json(fn());
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
}

// ---------------------------------------------------------------- care tasks

const careBody = z.object({
  name: z.string().max(120).optional(),
  template: z.string().max(40).nullable().optional(),
  interval_n: z.number().int().min(1).max(1000).nullable().optional(),
  interval_unit: z.enum(UNITS as [string, ...string[]]).nullable().optional(),
  next_due: day.nullable().optional(),
  last_done: day.nullable().optional(),
  lead_days: z.number().int().min(0).max(365).nullable().optional(),
  location_id: z.number().int().nullable().optional(),
  product_id: z.number().int().nullable().optional(),
  consume_qty: z.number().min(0).max(100).nullable().optional(),
  assignee_user_id: z.number().int().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  category: z.enum(['house', 'care']).optional(),
  visibility: z.enum(['household', 'private']).optional(),
  anchor: z.enum(['done', 'due']).optional(),
  as_needed: z.boolean().optional(),
  checklist: z.array(z.object({ text: z.string().max(120), done: z.boolean().optional().default(false) })).max(30).nullable().optional(),
  doer_key: z.string().max(20).nullable().optional(),
  rotation: z.array(z.string().max(20)).max(12).nullable().optional(),
  due_time: z.string().max(5).nullable().optional(),
  duration_min: z.number().int().min(5).max(1440).nullable().optional(),
  place: z.string().max(120).nullable().optional(),
});

const viewerOf = (req: Request) => req.actor?.userId ?? null;
/** a member with an account – not a guest (focus routes) */
const memberOf = (req: Request) => (req.actor?.houseGuest ? null : (req.actor?.userId ?? null));
/** a task this person may see – a private task of someone else answers 404 like a missing one */
function visibleTask(req: Request, res: Response, id: number) {
  const row = getCareTask(id);
  if (!row || !canSeeTask(row, viewerOf(req))) {
    res.status(404).json({ error: t('Task not found') });
    return null;
  }
  return row;
}

r.get('/care', (req, res) => {
  const tasks = listCareTasks({ viewer: viewerOf(req) });
  const used = new Set(tasks.map((x) => x.template).filter(Boolean));
  res.json({
    tasks,
    templates: CARE_TEMPLATES.map((x) => ({ ...x, added: used.has(x.key) })),
    users: db.prepare('SELECT id, name, color FROM users ORDER BY id').all(),
    me: viewerOf(req),
    today: localDay(0),
  });
});

r.get('/care/due', (req, res) => res.json(dueCareTasks({ viewer: viewerOf(req) })));
/** done lately, with who did it – the work stays visible */
r.get('/care/recent', (req, res) => res.json(recentlyDone(viewerOf(req), Math.min(60, Math.max(1, Number(req.query.days) || 14)))));

/** one task as a calendar entry to download ("In den Kalender") */
r.get('/care/:id/ics', (req, res) => {
  const row = visibleTask(req, res, num(req.params.id));
  if (!row) return;
  const task = careView(row);
  if (!task.next_due) return void res.status(400).json({ error: t('This task has no date yet') });
  res.setHeader('Content-Disposition', `attachment; filename="tohuus-${task.id}.ics"`);
  res.type('text/calendar; charset=utf-8').send(eventIcs(task));
});

/** "Wer hat was im Blick": who was involved per area; shares only when every member agreed to compare */
r.get('/blick', (req, res) => {
  if (req.actor?.role === 'guest' || req.actor?.houseGuest) return res.status(403).json({ error: t('Not available for guests') });
  res.json(blickOverview(viewerOf(req), Math.min(90, Math.max(7, Number(req.query.days) || 28))));
});
r.put('/blick/compare', (req, res) => {
  const id = viewerOf(req);
  if (id == null || req.actor?.kind !== 'user') return res.status(403).json({ error: t('Only for signed-in members') });
  setCompareOptIn(id, z.object({ on: z.boolean() }).parse(req.body).on);
  res.json(blickOverview(id));
});

// ---------------------------------------------------------------- Denkarbeit-Check (lib/loadcards.ts, docs/mental-load.md)

r.get('/blick/cards', (req, res) => {
  const uid = memberOf(req);
  if (!uid) return void res.status(403).json({ error: t('Only for signed-in members') });
  res.json(loadCards(uid));
});
r.put('/blick/cards/:key', (req, res) => {
  const uid = memberOf(req);
  if (!uid) return void res.status(403).json({ error: t('Only for signed-in members') });
  const b = z.object({ answer: z.enum(LOAD_ANSWERS).nullable() }).parse(req.body);
  try {
    setLoadAnswer(uid, String(req.params.key), b.answer);
    res.json(loadCards(uid));
  } catch (e) {
    res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message });
  }
});
/** "Daraus eine Aufgabe machen": a task "when needed" that I keep in mind. */
r.post('/blick/cards/:key/task', (req, res) => {
  const uid = memberOf(req);
  if (!uid) return void res.status(403).json({ error: t('Only for signed-in members') });
  try {
    res.json(taskFromCard(uid, String(req.params.key)));
  } catch (e) {
    res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message });
  }
});

r.post('/care', (req, res) => {
  const b = careBody.parse(req.body);
  userError(res, () => createCareTask(b as any, viewerOf(req)));
});

r.get('/care/:id', (req, res) => {
  const row = visibleTask(req, res, num(req.params.id));
  if (!row) return;
  res.json({ ...careView(row), log: careLog(row.id), learned_every_days: learnedEveryDays(row.id) });
});

r.patch('/care/:id', (req, res) => {
  const b = careBody.extend({ archived: z.boolean().optional() }).parse(req.body);
  const row = visibleTask(req, res, num(req.params.id));
  if (!row) return;
  // making a household task private: it becomes the private task of the person who does it
  if (b.visibility === 'private' && row.visibility !== 'private') {
    if (!viewerOf(req)) {
      res.status(400).json({ error: t('Only household members can keep private tasks') });
      return;
    }
    db.prepare('UPDATE care_tasks SET owner_user_id = ? WHERE id = ?').run(viewerOf(req), row.id);
  }
  userError(res, () => updateCareTask(num(req.params.id), b as any));
});

r.delete('/care/:id', (req, res) => {
  if (!visibleTask(req, res, num(req.params.id))) return;
  deleteCareTask(num(req.params.id));
  res.json({ ok: true });
});

r.post('/care/:id/done', (req, res) => {
  const b = z.object({ done_on: day.nullable().optional(), next_due: day.nullable().optional(), note: z.string().max(500).nullable().optional() }).parse(req.body ?? {});
  if (!visibleTask(req, res, num(req.params.id))) return;
  userError(res, () => completeCareTask(num(req.params.id), actorName(req), { doneOn: b.done_on, nextDue: b.next_due, note: b.note, actorUserId: viewerOf(req) }));
});

r.post('/care/:id/undo', (req, res) => {
  if (!visibleTask(req, res, num(req.params.id))) return;
  userError(res, () => undoCareTask(num(req.params.id), actorName(req)));
});

// ---------------------------------------------------------------- focus: small steps, fresh start, gentle mode (lib/focus.ts)

/** Propose small steps for a task (AI if allowed for this person, else built-in). Saves nothing. */
r.post('/care/:id/steps/suggest', async (req, res) => {
  const row = visibleTask(req, res, num(req.params.id));
  if (!row) return;
  res.json(await suggestSteps({ name: row.name, note: row.note }));
});
/** Steps for a name that isn't a task yet (the "new task" sheet). */
r.post('/focus/steps', async (req, res) => {
  const b = z.object({ name: z.string().min(1).max(200), note: z.string().max(500).nullable().optional() }).parse(req.body);
  if (!memberOf(req)) return void res.status(403).json({ error: t('Only household members can do this') });
  res.json(await suggestSteps(b));
});
/** "Neu anfangen": overdue tasks I keep in mind (or nobody does) move to a fresh start. */
r.post('/care/fresh-start', (req, res) => {
  const uid = memberOf(req);
  if (!uid) return void res.status(403).json({ error: t('Only household members can do this') });
  const b = z.object({ per_day: z.number().int().min(1).max(5).optional() }).parse(req.body ?? {});
  res.json(freshStart(uid, b.per_day ?? 2));
});
/** My focus settings – personal, nobody else sees them. */
r.get('/focus/prefs', (req, res) => res.json(focusPrefs(memberOf(req))));
r.put('/focus/prefs', (req, res) => {
  const uid = memberOf(req);
  if (!uid) return void res.status(403).json({ error: t('Only household members can do this') });
  const b = z
    .object({
      gentle: z.boolean().optional(),
      todayMax: z.number().int().min(1).max(10).nullable().optional(),
      bundleHour: z.number().int().min(0).max(23).nullable().optional(),
      timerMin: z.number().int().min(1).max(60).optional(),
    })
    .parse(req.body ?? {});
  res.json(setFocusPrefs(uid, b));
});

// ---------------------------------------------------------------- stars (lib/points.ts, docs/points.md) – off by default

r.get('/points', (req, res) => {
  if (req.actor?.role === 'guest' || req.actor?.houseGuest) return void res.status(403).json({ error: t('Not available for guests') });
  res.json(pointsWeek(memberOf(req)));
});
r.put('/points/settings', (req, res) => {
  if (req.actor?.role !== 'admin') return void res.status(403).json({ error: t('Only admins can change this.') });
  const b = z.object({ on: z.boolean(), areas: z.array(z.enum(BLICK_AREAS as unknown as [BlickArea, ...BlickArea[]])).max(4) }).parse(req.body);
  try {
    setPointsSettings(b);
    res.json(pointsWeek(memberOf(req)));
  } catch (e) {
    res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message });
  }
});

// ---------------------------------------------------------------- Kalender lesen (lib/calsync.ts, docs/calendar-sync.md)

const noCalGuest = (req: any, res: any) => {
  if (req.actor?.role === 'guest' || req.actor?.houseGuest || !memberOf(req)) {
    res.status(403).json({ error: t('Only household members can do this') });
    return true;
  }
  return false;
};
const DAY = z.string().regex(/^\d{4}-\d\d-\d\d$/);
r.get('/calsync', (req, res) => {
  if (noCalGuest(req, res)) return;
  res.json(calsyncView(memberOf(req)));
});
/** The phone's matches: kind + day only, never titles. */
r.post('/calsync/dates', (req, res) => {
  if (noCalGuest(req, res)) return;
  const kinds = BIN_KINDS.map((k) => k.key) as [string, ...string[]];
  const b = z
    .object({ source: z.string().min(4).max(80), from: DAY, to: DAY, dates: z.array(z.object({ kind: z.enum(kinds), day: DAY })).max(400) })
    .parse(req.body);
  res.json(syncDates(b));
});
r.put('/calsync/settings', (req, res) => {
  if (noCalGuest(req, res)) return;
  res.json({ settings: setCalsyncSettings(z.object({ offset: z.enum(['evening', 'morning']) }).parse(req.body)) });
});
r.post('/calsync/kinds/:kind/revive', (req, res) => {
  if (noCalGuest(req, res)) return;
  reviveKind(z.enum(BIN_KINDS.map((k) => k.key) as [string, ...string[]]).parse(req.params.kind));
  res.json(calsyncView(memberOf(req)));
});
/** "KI darf Kalendereinträge mit Aufgaben abgleichen" – per person, own consent */
r.put('/calsync/ai', (req, res) => {
  if (noCalGuest(req, res)) return;
  res.json(setCalendarAiConsent(memberOf(req)!, z.object({ consent: z.boolean() }).parse(req.body).consent));
});
r.post('/calsync/suggest', async (req, res) => {
  if (noCalGuest(req, res)) return;
  const b = z
    .object({ events: z.array(z.object({ title: z.string().max(200), day: DAY, time: z.string().regex(/^\d\d:\d\d$/).nullable().optional() })).max(200) })
    .parse(req.body);
  try {
    res.json(await suggestFromEvents(memberOf(req)!, b.events));
  } catch (e) {
    const err = e as { status?: number; code?: string; message: string };
    res.status(err.status ?? (err.code === 'ai.disabled' ? 403 : 502)).json({ error: err.message, code: err.code });
  }
});

// ---------------------------------------------------------------- Rückblick (lib/review.ts, docs/review.md) – off by default

r.get('/review', (req, res) => {
  if (req.actor?.role === 'guest' || req.actor?.houseGuest) return void res.status(403).json({ error: t('Not available for guests') });
  // ?peek=1: only whether it is on and in season – cheap enough for "Heute"
  if (req.query.peek === '1') return void res.json({ allowed: reviewAllowed(), season: reviewAllowed() ? reviewSeason() : null });
  const y = z.coerce.number().int().min(2000).max(2100).optional().safeParse(req.query.year || undefined);
  res.json(yearReview(memberOf(req), y.success ? y.data : undefined));
});

/** "Mach ich – heute / morgen / am Wochenende / am …": a promise with a day; { when: null } takes it back. */
r.post('/care/:id/promise', (req, res) => {
  const { when } = z.object({ when: z.string().max(10).nullable() }).parse(req.body);
  const row = visibleTask(req, res, num(req.params.id));
  if (!row) return;
  const uid = memberOf(req);
  if (!uid) return void res.status(403).json({ error: t('Only household members can do this') });
  userError(res, () => promiseCareTask(row.id, uid, when));
});

/** "I'll take care of it" – or let go again. No points, no ranking. */
r.post('/care/:id/claim', (req, res) => {
  const { claim } = z.object({ claim: z.boolean() }).parse(req.body);
  const row = visibleTask(req, res, num(req.params.id));
  if (!row) return;
  const uid = req.actor?.userId ?? null;
  if (claim && !uid) {
    res.status(400).json({ error: t('Only household members can take on a task') });
    return;
  }
  res.json(updateCareTask(row.id, { assignee_user_id: claim ? uid : null }));
});

// ---------------------------------------------------------------- spending

const month = z.string().regex(/^\d{4}-\d\d$/);

r.get('/spending', (req, res) => {
  const m = req.query.month ? month.parse(String(req.query.month)) : undefined;
  res.json(spendingSummary(m));
});

r.get('/spending/products', (_req, res) => res.json(pricedProducts()));

// price history per product: Household plan and up (cloud); self-hosted servers have everything
r.get('/spending/prices/:productId', requireFeature('priceHistory'), (req, res) => res.json(priceHistory(num(req.params.productId))));

r.get('/spending/export.csv', (req, res) => {
  const m = req.query.month ? month.parse(String(req.query.month)) : undefined;
  res
    .type('text/csv; charset=utf-8')
    .setHeader('Content-Disposition', `attachment; filename="tohuus-spending${m ? '-' + m : ''}.csv"`)
    .send('﻿' + spendingCsv(m));
});

r.put('/spending/target', (req, res) => {
  const { target } = z.object({ target: z.number().min(0).max(100000).nullable() }).parse(req.body);
  setSpendingTarget(target);
  emit('imports');
  res.json({ target: spendingTarget() });
});

// ---------------------------------------------------------------- QR labels

const kind = z.enum(['product', 'location', 'care']);

function labelFor(k: QrKind, id: number) {
  if (k === 'product') {
    const p = getProduct(id);
    return p ? { title: p.name, sub: [p.brand, p.size].filter(Boolean).join(' · ') || null } : null;
  }
  if (k === 'location') {
    const l = db.prepare('SELECT name, hint FROM locations WHERE id = ?').get(id) as { name: string; hint: string | null } | undefined;
    return l ? { title: l.name, sub: l.hint } : null;
  }
  const c = getCareTask(id);
  if (!c || !canSeeTask(c)) return null;
  const every = c.interval_n && c.interval_unit ? intervalText(c.interval_n, c.interval_unit) : null;
  return { title: c.name, sub: every };
}

function intervalText(n: number, unit: string) {
  const one: Record<string, string> = { day: 'every day', week: 'every week', month: 'every month', year: 'every year' };
  const many: Record<string, string> = { day: 'every {n} days', week: 'every {n} weeks', month: 'every {n} months', year: 'every {n} years' };
  return n === 1 ? t(one[unit]) : t(many[unit], { n });
}

/** Get (or create) codes for a set of things – the label sheet prints these. */
r.post('/qr', (req, res) => {
  const b = z.object({ kind, ids: z.array(z.number().int()).max(200) }).parse(req.body);
  const out = [];
  for (const id of b.ids) {
    const label = labelFor(b.kind, id);
    if (!label) continue;
    const code = codeFor(b.kind, id, actorName(req));
    out.push({ kind: b.kind, ref_id: id, code, url: qrUrl(code), ...label });
  }
  res.json(out);
});

r.delete('/qr/:code', (req, res) => {
  res.json({ ok: revokeCode(String(req.params.code)) });
});

function resolved(code: string) {
  const row = resolveCode(code);
  if (!row) return null;
  if (row.kind === 'product') {
    const p = getProduct(row.ref_id);
    if (!p) return null;
    const v = productView(p);
    const locs = db.prepare('SELECT id, name, icon, hint FROM locations').all() as { id: number; name: string; icon: string; hint: string | null }[];
    const lmap = new Map(locs.map((l) => [l.id, l]));
    const places = [...new Set([...v.stock.filter((s) => s.qty > 0).map((s) => s.location_id), ...(v.default_location_id ? [v.default_location_id] : [])])]
      .map((id) => lmap.get(id))
      .filter(Boolean);
    const onList = Boolean(db.prepare('SELECT 1 FROM shopping_items WHERE product_id = ? AND checked_at IS NULL').get(p.id));
    return { kind: 'product' as const, code, product: { ...v, places, on_list: onList } };
  }
  if (row.kind === 'location') {
    const l = db.prepare('SELECT id, name, icon, hint FROM locations WHERE id = ?').get(row.ref_id) as any;
    if (!l) return null;
    const items = listProducts()
      .filter((p) => p.stock.some((s) => s.location_id === l.id && s.qty > 0) || (p.track_mode === 'none' && p.default_location_id === l.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        image_path: p.image_path,
        unit: p.unit,
        track_mode: p.track_mode,
        status: p.status,
        nextExpiry: p.nextExpiry,
        spot: p.spot,
        qty: p.stock.filter((s) => s.location_id === l.id).reduce((s, e) => s + e.qty, 0),
      }));
    return { kind: 'location' as const, code, location: l, items };
  }
  const c = getCareTask(row.ref_id);
  // a private task never gets a working label (labels hang where everyone can scan them)
  if (!c || !canSeeTask(c)) return null;
  return { kind: 'care' as const, code, task: { ...careView(c), log: careLog(c.id, 5) } };
}

r.get('/qr/:code', (req, res) => {
  const out = resolved(String(req.params.code));
  if (!out) {
    res.status(404).json({ error: t('This label is no longer valid.') });
    return;
  }
  res.json(out);
});

/** One-tap actions from a scanned label. */
r.post('/qr/:code/action', (req, res) => {
  const { action } = z.object({ action: z.enum(['take', 'opened', 'list', 'done']) }).parse(req.body);
  const code = String(req.params.code);
  const row = resolveCode(code);
  if (!row) {
    res.status(404).json({ error: t('This label is no longer valid.') });
    return;
  }
  const actor = actorName(req);
  let message = '';
  if (row.kind === 'product') {
    const p = getProduct(row.ref_id);
    if (!p) {
      res.status(404).json({ error: t('Product not found') });
      return;
    }
    if (action === 'take') {
      adjustStock({ productId: p.id, delta: -1, reason: 'consume', actor, ref: `qr:${code}` });
      message = t('{name}: one less', { name: p.name });
    } else if (action === 'opened') {
      // same logic as the fresh area: splits one unit off, skips the freezer, applies shelf life after opening
      try {
        markOpened(p.id, { actor });
        message = t('{name} marked as opened', { name: p.name });
      } catch (err) {
        if (!(err instanceof FreshError)) throw err;
        message = t('Nothing unopened in stock');
      }
    } else if (action === 'list') {
      addToShopping({ productId: p.id, text: p.name, source: 'qr', addedBy: actor });
      message = t('{name} is on the shopping list', { name: p.name });
    } else {
      res.status(400).json({ error: t('Not possible for this label') });
      return;
    }
  } else if (row.kind === 'care' && action === 'done') {
    const task = getCareTask(row.ref_id);
    if (!task || !canSeeTask(task)) {
      res.status(404).json({ error: t('This label is no longer valid.') });
      return;
    }
    const out = completeCareTask(row.ref_id, actor, { actorUserId: req.actor?.userId ?? null });
    message = t('Done – next time: {date}', { date: out.task.next_due ? fmtDay(out.task.next_due + 'T12:00:00') : '–' });
  } else {
    res.status(400).json({ error: t('Not possible for this label') });
    return;
  }
  res.json({ message, data: resolved(code) });
});
