/** Home care: maintenance cycles, spending, QR labels */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { db, setSetting } from '../db.js';
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
import { nextTasks } from '../lib/next-task.js';
import { LOAD_ANSWERS, loadCards, setLoadAnswer, taskFromCard } from '../lib/loadcards.js';
import { BLICK_AREAS, type BlickArea, blickOverview, setCompareOptIn } from '../lib/blick.js';
import { pointsWeek, setPointsSettings } from '../lib/points.js';
import { reviewAllowed, reviewSeason, yearReview } from '../lib/review.js';
import { markWeekSeen, setWeekReviewOn, weekReview } from '../lib/weekly.js';
import { answerOffer, answerProposal, cookSuggestions, offerTask, whoDoesWhat } from '../lib/habits.js';
import { BIN_KINDS, calsyncView, decideKinds, disconnectCalendar, ignoreKind, requestRescan, reviveKind, setCalendarAiConsent, setCalsyncSettings, suggestFromEvents, syncDates } from '../lib/calsync.js';
import { eventIcs } from '../lib/calendar.js';
import { outlookFor } from '../lib/task-outlook.js';
import { FreshError, markOpened } from '../lib/fresh.js';
import { requireFeature } from '../lib/limits.js';
import { addMind, addMindMany, deleteMind, keepMind, MindError, mindList, mindReview, nodMind, updateMind } from '../lib/mind.js';
import { checkinSave, checkinSkip, checkinView, setCheckinOn } from '../lib/checkin.js';
import { addCareFor, addCareForTask, careForHint, careForList, deleteCareFor, deleteCareForLog, dismissCareForHint, logCareFor, updateCareFor } from '../lib/carefor.js';
import { dismissCarrying } from '../lib/habits.js';
import { monthReview } from '../lib/weekly.js';
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
  effort_min: z.number().int().min(1).max(240).nullable().optional(),
  kids_ok: z.boolean().optional(),
});

const viewerOf = (req: Request) => req.actor?.userId ?? null;
/** who asks to take a "done" back (lib/care.ts mayUndo: own ticks always, others' only an admin) */
const undoWho = (req: Request) => ({ userId: viewerOf(req), admin: req.actor?.role === 'admin' && !req.actor?.houseGuest, actor: actorName(req) });
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
    // Heute › Demnächst: tomorrow, the weekend, bins by the evening they go out (lib/task-outlook.ts)
    ahead: outlookFor(tasks, localDay(0)),
  });
});

r.get('/care/due', (req, res) => res.json(dueCareTasks({ viewer: viewerOf(req) })));
/** done lately, with who did it – the work stays visible */
r.get('/care/recent', (req, res) => res.json(recentlyDone(viewerOf(req), Math.min(60, Math.max(1, Number(req.query.days) || 14)), undoWho(req))));

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
  res.json({ ...careView(row), log: careLog(row.id, 20, undoWho(req)), learned_every_days: learnedEveryDays(row.id) });
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

/** Take a "done" back – the newest one of the task; `log_id` pins it (toast, "Zuletzt erledigt", history). */
r.post('/care/:id/undo', (req, res) => {
  const b = z.object({ log_id: z.number().int().positive().nullable().optional() }).parse(req.body ?? {});
  if (!visibleTask(req, res, num(req.params.id))) return;
  try {
    res.json(undoCareTask(num(req.params.id), actorName(req), { logId: b.log_id ?? null, who: undoWho(req) }));
  } catch (e) {
    res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message });
  }
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
/**
 * "Jetzt": the next task and the order after it, decided by the server (lib/next-task.ts, docs/now.md).
 * for=me (default) · user:<id> (another member – never any private task) · kid:<id> (a child profile).
 * Permanent guests only for themselves and only what was handed to them; guest links never.
 */
r.get('/tasks/next', (req, res) => {
  const me = req.actor?.userId ?? null;
  if (req.actor?.role === 'guest' || req.actor?.kind === 'guest' || !me) return void res.status(403).json({ error: t('Only household members can do this') });
  const f = String(req.query.for ?? 'me');
  const guest = Boolean(req.actor?.houseGuest);
  const m = /^(user|kid):(\d+)$/.exec(f);
  if (f !== 'me' && !m) return void res.status(400).json({ error: 'for' });
  if (m && guest) return void res.status(403).json({ error: t('Not available for guests') });
  const timer = focusPrefs(memberOf(req)).timerMin;
  if (!m || (m[1] === 'user' && Number(m[2]) === me)) return void res.json({ for: 'me', person: null, timer_min: timer, ...nextTasks({ kind: 'user', userId: me, self: true }, undefined, { mineOnly: guest }) });
  const id = Number(m[2]);
  const person = (m[1] === 'user' ? db.prepare(`SELECT id, name, color FROM users WHERE id = ?`) : db.prepare('SELECT id, name, color FROM kid_profiles WHERE id = ?')).get(id) as
    | { id: number; name: string; color: string }
    | undefined;
  if (!person) return void res.status(404).json({ error: t('Person not found.') });
  const who = m[1] === 'user' ? ({ kind: 'user', userId: id, self: false } as const) : ({ kind: 'kid', kidId: id } as const);
  res.json({ for: m[1], person: { key: `${m[1] === 'user' ? 'u' : 'k'}${id}`, name: person.name, color: person.color }, timer_min: timer, ...nextTasks(who) });
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
      oneThing: z.boolean().optional(),
      todayMoney: z.boolean().optional(),
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

// ---------------------------------------------------------------- Wer macht was (lib/habits.ts, docs/who-does-what.md)

const membersOnly = (req: any, res: any) => {
  if (req.actor?.role === 'guest' || req.actor?.houseGuest || !memberOf(req)) {
    res.status(403).json({ error: t('Only household members can do this') });
    return null;
  }
  return memberOf(req)!;
};
r.get('/habits', (req, res) => {
  const me = membersOnly(req, res);
  if (me) res.json(whoDoesWhat(me));
});
/** "So eintragen?" – the learned person becomes the doer, or never ask again */
r.post('/habits/proposals/:id', (req, res) => {
  if (!membersOnly(req, res)) return;
  res.json(answerProposal(num(req.params.id), z.object({ accept: z.boolean() }).parse(req.body).accept));
});
/** Week plan: who probably cooks the open meals (weekday habit, else who cooked lately) – a suggestion only */
r.get('/habits/cook', (req, res) => {
  if (!membersOnly(req, res)) return;
  const q = z.object({ from: z.string().regex(/^\d{4}-\d\d-\d\d$/), to: z.string().regex(/^\d{4}-\d\d-\d\d$/) }).parse(req.query);
  res.json(cookSuggestions(q.from, q.to));
});
/** "Abgeben an …": { to_user_id } asks that member; null withdraws the question */
r.post('/care/:id/offer', async (req, res) => {
  const me = membersOnly(req, res);
  if (!me) return;
  const row = visibleTask(req, res, num(req.params.id));
  if (!row) return;
  res.json(await offerTask(row.id, me, z.object({ to_user_id: z.number().int().positive().nullable() }).parse(req.body).to_user_id));
});
r.post('/care/:id/offer/answer', async (req, res) => {
  const me = membersOnly(req, res);
  if (!me) return;
  res.json(await answerOffer(num(req.params.id), me, z.object({ accept: z.boolean() }).parse(req.body).accept));
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
  const b = z.object({ offset: z.enum(['evening', 'morning']).optional(), weeks: z.number().int().min(2).max(26).optional() }).parse(req.body ?? {});
  res.json({ settings: setCalsyncSettings(b) });
});
r.post('/calsync/kinds/:kind/revive', (req, res) => {
  if (noCalGuest(req, res)) return;
  reviveKind(z.enum(BIN_KINDS.map((k) => k.key) as [string, ...string[]]).parse(req.params.kind));
  res.json(calsyncView(memberOf(req)));
});
/** Switch a found kind off: its task is deleted and a later read does not bring it back (revive turns it on again). */
r.post('/calsync/kinds/:kind/ignore', (req, res) => {
  if (noCalGuest(req, res)) return;
  ignoreKind(z.enum(BIN_KINDS.map((k) => k.key) as [string, ...string[]]).parse(req.params.kind));
  res.json(calsyncView(memberOf(req)));
});
/** The ticked list after a read: `on` are taken over as tasks, `off` are switched off. */
r.post('/calsync/kinds', (req, res) => {
  if (noCalGuest(req, res)) return;
  const kind = z.enum(BIN_KINDS.map((k) => k.key) as [string, ...string[]]);
  const b = z.object({ on: z.array(kind).max(20).default([]), off: z.array(kind).max(20).default([]) }).parse(req.body ?? {});
  decideKinds(b.on, b.off);
  res.json(calsyncView(memberOf(req)));
});
/** "Jetzt neu lesen" from the browser: the iPhone reads again the next time the app opens. */
r.post('/calsync/rescan', (req, res) => {
  if (noCalGuest(req, res)) return;
  requestRescan();
  res.json(calsyncView(memberOf(req)));
});
/** "Kalender trennen": all tasks from the calendar, all dates and choices go; phones stop reading. */
r.post('/calsync/disconnect', (req, res) => {
  if (noCalGuest(req, res)) return;
  const r2 = disconnectCalendar();
  res.json({ ...calsyncView(memberOf(req)), removed: r2.removed });
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

// ---------------------------------------------------------------- Im Kopf (lib/mind.ts, docs/mind.md) – members only

const mindBody = z.object({
  done_by: z.number().int().positive().nullable().optional(),
  due_on: z.string().regex(/^\d{4}-\d\d-\d\d$/).nullable().optional(),
  /** brain dump: one thought per line */
  many: z.boolean().optional(),
  // a brain dump holds up to 20 lines (each cut to 200 in mind.ts)
  text: z.string().max(4400).optional(),
  kind: z.enum(['open', 'done']).optional(),
  visibility: z.enum(['private', 'household']).optional(),
  hide_from: z.array(z.number().int().positive()).max(20).optional(),
});
/** members only: guests, house guests and guest links never see anybody's head */
const mindRun = (fn: (me: number, req: Request) => unknown) => (req: Request, res: Response) => {
  const me = req.actor?.role === 'guest' ? null : memberOf(req);
  if (!me) return void res.status(403).json({ error: t('Only household members can do this') });
  try {
    res.json(fn(me, req));
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (e instanceof MindError || (status && status >= 400 && status < 500)) return void res.status(status ?? 400).json({ error: (e as Error).message });
    throw e;
  }
};
const mindId = (req: Request) => Number(req.params.id) || 0;
r.get('/mind', mindRun((me) => mindList(me)));
r.post(
  '/mind',
  mindRun((me, req) => {
    const b = mindBody.parse(req.body);
    return b.many ? { items: addMindMany(me, b) } : addMind(me, b);
  }),
);
r.get('/mind/review', mindRun((me) => mindReview(me)));
r.post('/mind/:id/keep', mindRun((me, req) => keepMind(me, mindId(req))));
r.patch('/mind/:id', mindRun((me, req) => updateMind(me, mindId(req), mindBody.parse(req.body))));
r.delete('/mind/:id', mindRun((me, req) => deleteMind(me, mindId(req))));
r.post('/mind/:id/nod', mindRun((me, req) => nodMind(me, mindId(req))));
/** "Wird eine Aufgabe": a thought becomes a task (private stays private) and leaves the head */
r.post(
  '/mind/:id/task',
  mindRun((me, req) => {
    const item = mindList(me).mine.open.find((x) => x.id === mindId(req));
    if (!item) throw new MindError(t('Not found'), 404);
    // hidden from someone ("Geschenk für Mira") → the task stays private, or Mira would see it under Aufgaben
    const hidden = item.visibility === 'private' || item.hide_from.length > 0;
    const task = createCareTask({ name: item.text.slice(0, 120), category: 'house', visibility: hidden ? 'private' : 'household' } as Parameters<typeof createCareTask>[0], me);
    deleteMind(me, item.id);
    return task;
  }),
);

// ---------------------------------------------------------------- "Was habt ihr heute gelöst?" (lib/checkin.ts, docs/checkin.md)

r.get('/checkin', mindRun((me) => checkinView(me)));
r.post(
  '/checkin',
  mindRun((me, req) =>
    checkinSave(
      me,
      z
        .object({ items: z.array(z.object({ task_id: z.number().int().positive().nullable().optional(), text: z.string().max(200).nullable().optional(), who: z.number().int().positive().nullable().optional() })).max(20) })
        .parse(req.body).items,
    ),
  ),
);
r.post('/checkin/skip', mindRun((me) => checkinSkip(me)));
r.put('/checkin/settings', mindRun((me, req) => setCheckinOn(me, z.object({ on: z.boolean() }).parse(req.body).on)));

// ---------------------------------------------------------------- Für wen ich da bin (lib/carefor.ts, docs/carefor.md)

const careForBody = z.object({
  name: z.string().max(60).optional(),
  relation: z.string().max(40).nullable().optional(),
  place: z.enum(['home', 'own', 'care_home', 'other']).optional(),
  visibility: z.enum(['private', 'household']).optional(),
  archived: z.boolean().optional(),
});
r.get('/carefor', mindRun((me) => careForList(me)));
r.get('/carefor/hint', mindRun((me) => careForHint(me)));
r.post('/carefor/hint/dismiss', mindRun((me) => dismissCareForHint(me)));
r.post('/carefor', mindRun((me, req) => addCareFor(me, careForBody.parse(req.body))));
r.patch('/carefor/:id', mindRun((me, req) => updateCareFor(me, mindId(req), careForBody.parse(req.body))));
r.delete('/carefor/:id', mindRun((me, req) => deleteCareFor(me, mindId(req))));
r.post(
  '/carefor/:id/log',
  mindRun((me, req) =>
    logCareFor(me, mindId(req), z.object({ kind: z.enum(['visit', 'call', 'appointment', 'errand', 'other']).optional(), note: z.string().max(200).nullable().optional(), day: z.string().nullable().optional() }).parse(req.body)),
  ),
);
r.delete('/carefor/log/:id', mindRun((me, req) => deleteCareForLog(me, mindId(req))));
r.post(
  '/carefor/:id/tasks',
  mindRun((me, req) =>
    addCareForTask(
      me,
      mindId(req),
      z
        .object({
          name: z.string().max(120),
          interval_n: z.number().int().min(1).max(365).nullable().optional(),
          interval_unit: z.enum(['day', 'week', 'month', 'year']).nullable().optional(),
          next_due: z.string().regex(/^\d{4}-\d\d-\d\d$/).nullable().optional(),
          due_time: z.string().regex(/^\d\d:\d\d$/).nullable().optional(),
        })
        .parse(req.body),
    ),
  ),
);

// ---------------------------------------------------------------- "Du machst das seit Wochen" (lib/habits.ts carrying)
r.post('/habits/carrying/:id/dismiss', mindRun((me, req) => dismissCarrying(me, mindId(req))));

// ---------------------------------------------------------------- sharing (docs/sharing.md): the footer is the household's choice
r.put('/share/settings', (req, res) => {
  if (req.actor?.role !== 'admin') return void res.status(403).json({ error: t('Only admins can change this') });
  const b = z.object({ footer: z.boolean() }).parse(req.body);
  setSetting('share.footer', b.footer);
  res.json({ footer: b.footer });
});

// ---------------------------------------------------------------- tasks handed to a person – also a permanent guest (docs/guests-and-permissions.md)

/** The tasks this person does (as doer, or standing in while someone is away) – for guests the only view of Aufgaben. */
function myTasks(me: number) {
  return listCareTasks({ viewer: me })
    .filter((x) => !x.archived && x.doer?.key === `u${me}` && canSeeTask(x, me))
    .map((x) => ({
      id: x.id,
      name: x.name,
      note: x.note,
      next_due: x.next_due,
      due_time: x.due_time,
      state: x.state,
      days: x.days,
      checklist: x.checklist,
      place: x.place,
      stand_in: x.stand_in,
    }));
}
r.get('/guest-tasks', (req, res) => {
  const me = req.actor?.userId;
  if (!me) return void res.status(403).json({ error: t('Only household members can do this') });
  res.json({ tasks: myTasks(me) });
});
r.post('/guest-tasks/:id/done', (req, res) => {
  const me = req.actor?.userId;
  const id = Number(req.params.id);
  if (!me || !myTasks(me).some((x) => x.id === id)) return void res.status(404).json({ error: t('Task not found') });
  completeCareTask(id, req.actor!.name, { actorUserId: me });
  res.json({ ok: true, message: t('Done – thank you!') });
});

/** YYYY-MM-DD that is a real day (2026-13-40 passes a regex but breaks the date maths) */
const realDay = z
  .string()
  .regex(/^\d{4}-\d\d-\d\d$/)
  .refine((d) => !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d);

// ---------------------------------------------------------------- Monatsrückblick (lib/weekly.ts)
r.get('/month-review', (req, res) => {
  if (req.actor?.role === 'guest' || req.actor?.houseGuest) return void res.status(403).json({ error: t('Not available for guests') });
  const m = realDay.optional().safeParse(req.query.month || undefined);
  res.json(monthReview(memberOf(req), m.success ? m.data : undefined));
});

// ---------------------------------------------------------------- Wochenrückblick (lib/weekly.ts, docs/week-review.md)

r.get('/week-review', (req, res) => {
  if (req.actor?.role === 'guest' || req.actor?.houseGuest) return void res.status(403).json({ error: t('Not available for guests') });
  const w = realDay.optional().safeParse(req.query.week || undefined);
  res.json(weekReview(memberOf(req), w.success ? w.data : undefined));
});
r.put('/week-review/settings', (req, res) => {
  const me = memberOf(req);
  if (!me) return void res.status(403).json({ error: t('Only household members can do this') });
  res.json(setWeekReviewOn(me, z.object({ on: z.boolean() }).parse(req.body).on));
});
r.post('/week-review/seen', (req, res) => {
  const me = memberOf(req);
  if (!me) return void res.status(403).json({ error: t('Only household members can do this') });
  res.json(markWeekSeen(me, z.object({ from: z.string().regex(/^\d{4}-\d\d-\d\d$/) }).parse(req.body).from));
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
