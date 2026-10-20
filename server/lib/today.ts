/**
 * GET /api/today – everything the "Heute" screen (web and iPhone) needs in one call. Shape: docs/api-today.md.
 * Target: < 50 ms on a typical household; the purchase rhythm is computed once and shared by all cards.
 */
import { config } from '../config.js';
import { db, getSetting, lang } from '../db.js';
import { localeOf } from '../languages.js';
import { t } from '../i18n.js';
import { recipeImageSql } from './recipe-images.js';
import { cookToday, probablyAtHome } from './cookideas.js';
import { eatFirst } from './fresh.js';
import { moneyGlance, fmtMoney } from './money.js';
import { boughtText, rhythmList, type RhythmItem } from './rhythm.js';
import { applyShareView, notPrivate } from './share-core.js';
import { fmtWhen, originOf } from './shopping-trust.js';
import { today as todayDay } from './spend2.js';
import { awayToday } from './away-state.js';
import { listCareTasks } from './care.js';
import { contextNow, pickSaying, plattHello } from './platt.js';
import { wishTodayHints } from './wishes.js';
import { focusPrefs } from './focus.js';
import { nextTasks, type NowCard } from './next-task.js';
import { outlookFor } from './task-outlook.js';
import { requestsFor } from './orders.js';
import { demoStatus } from './tour.js';
import { trialSummary } from './trial-end.js';
import { currentHousehold } from './tenancy.js';
import { weekReview } from './weekly.js';
import { pulseState } from './pulse.js';
import { checklist, getUserPref, onboardState } from './onboard.js';
import { checkinView } from './checkin.js';
import { modules } from './modules.js';
import { LEVEL_AREAS, type EffectiveLevel } from './people-policy.js';
import { nowMax, pickContext, selectCards, type TodayCardKey, type TodayContext } from './today-select.js';

export interface TodayViewer {
  userId?: number | null;
  name?: string | null;
  /** admins see the household hints (sample data, trial, getting started) */
  admin?: boolean;
  /** permanent guest: their effective level (people-policy.ts); null for family members */
  guestLevel?: EffectiveLevel | null;
  /** a guest link (no account) */
  link?: boolean;
}

const WEEKDAY = (d: string, locale: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' });

/** Plattdeutsch on the Heute screen: German households only, unless switched off (`today.platt` = '0'). */
const plattOn = () => lang() === 'de' && String(getSetting('today.platt', '1')) !== '0';

function greeting(name: string | null | undefined) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: config.timezone }).format(new Date())) % 24;
  const base = plattOn() ? plattHello(hour) : hour < 5 ? t('Good evening') : hour < 11 ? t('Good morning') : hour < 17 ? t('Hello') : t('Good evening');
  return name ? t('{greeting}, {name}', { greeting: base, name }) : base;
}

function platt(viewer?: TodayViewer | null) {
  if (!plattOn()) return null;
  const s = pickSaying(contextNow(), String(viewer?.userId ?? ''));
  return s ? { id: s.id, text: s.text, meaning: s.meaning, note: s.note } : null;
}

function rhythmCard(r: RhythmItem, locale: string) {
  return {
    productId: r.productId,
    name: r.name,
    image: r.image,
    everyDays: Math.round(r.everyDays),
    lastBought: r.lastBought,
    dueOn: r.dueOn,
    dueInDays: r.dueInDays,
    confidence: r.confidence,
    origin: r.origin,
    label: r.label,
  };
}

/** Tasks this person sees that are due today or overdue. */
function dueNow(viewer: number | null) {
  try {
    return listCareTasks({ viewer }).filter((x) => x.state === 'today' || x.state === 'overdue').length;
  } catch {
    return 0;
  }
}

export function todayAggregate(viewer?: TodayViewer | null) {
  const day = todayDay();
  const locale = localeOf(lang());
  const rhythm = rhythmList();
  const likely = probablyAtHome(rhythm);

  // list: open count and the last changes, each with its origin
  const open = (db.prepare(`SELECT COUNT(*) n FROM shopping_items WHERE checked_at IS NULL AND ${notPrivate()}`).get() as { n: number }).n;
  const recentRows = db
    .prepare(
      `SELECT id, text, product_id, note, qty, source, added_by, created_at, checked_at, checked_by, origin_detail FROM shopping_items
       WHERE cleared_at IS NULL AND (checked_at IS NULL OR checked_at > datetime('now', '-1 day'))
       ORDER BY COALESCE(checked_at, created_at) DESC LIMIT 12`,
    )
    .all() as { id: number; text: string; product_id: number | null; note: string | null; qty: number | null; source: string; added_by: string | null; created_at: string; checked_at: string | null; checked_by: string | null; origin_detail: string | null }[];
  const recent = applyShareView(recentRows, { userId: viewer?.userId ?? null })
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      text: r.text,
      qty: r.qty,
      checked: Boolean(r.checked_at),
      origin: r.checked_at ? t('ticked · {name}, {when}', { name: r.checked_by ?? '–', when: fmtWhen(r.checked_at) }) : originOf(r),
      at: r.checked_at ?? r.created_at,
    }));

  // "Das habt ihr noch": what should be eaten soon, then what was bought within its usual rhythm
  const still: { productId: number; name: string; image: string | null; kind: 'expiring' | 'leftover' | 'probably'; useBy: string | null; daysLeft: number | null; label: string }[] = [];
  for (const e of eatFirst({ limit: 5 })) {
    still.push({
      productId: e.id,
      name: e.name,
      // a leftover box without its own photo shows the dish it came from
      image: e.image_path ?? (e.recipe_id ? ((db.prepare(`SELECT ${recipeImageSql('r')} AS img FROM recipes r WHERE r.id = ?`).get(e.recipe_id) as { img: string | null } | undefined)?.img ?? null) : null),
      kind: e.kind === 'leftover' ? 'leftover' : 'expiring',
      useBy: e.use_by,
      daysLeft: e.days_left,
      label: e.days_left == null ? t('eat soon') : e.days_left < 0 ? t('past its date') : e.days_left === 0 ? t('today') : e.days_left === 1 ? t('1 day left') : t('{n} days left', { n: e.days_left }),
    });
  }
  for (const r of rhythm.filter((x) => likely.has(x.productId)).sort((a, b) => b.lastBought.localeCompare(a.lastBought))) {
    if (still.length >= 5) break;
    if (still.some((s) => s.productId === r.productId)) continue;
    still.push({ productId: r.productId, name: r.name, image: r.image, kind: 'probably', useBy: null, daysLeft: null, label: boughtText(r.lastBought, day) });
  }

  // cook today: the plan first, else an idea from what is at home
  const planned = db
    .prepare(`SELECT m.id, m.title, m.recipe_id, m.slot, m.cooked, ${recipeImageSql('r')} AS image_path, r.time_min FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.day = ? AND m.cooked = 0 ORDER BY m.slot = 'abend' DESC LIMIT 1`)
    .get(day) as { id: number; title: string; recipe_id: number | null; slot: string; image_path: string | null; time_min: number | null } | undefined;
  let cook: Record<string, unknown> | null = null;
  if (planned)
    cook = { kind: 'planned', planId: planned.id, recipeId: planned.recipe_id, title: planned.title, image: planned.image_path, timeMin: planned.time_min, slot: planned.slot, missing: [], probablyHave: [], why: [t('planned for today')] };
  else {
    const idea = cookToday(likely);
    if (idea) cook = { ...idea };
  }

  let money: ReturnType<typeof moneyGlance>;
  try {
    money = moneyGlance();
  } catch {
    money = { currency: 'EUR', week: 0, month: 0, budget: null };
  }

  const notices: { kind: string; text: string; path: string }[] = [];
  const review = (db.prepare(`SELECT COUNT(*) n FROM imports WHERE status = 'review' AND private_for IS NULL`).get() as { n: number }).n;
  if (review) notices.push({ kind: 'imports', text: review === 1 ? t('1 receipt is waiting for a quick look') : t('{n} receipts are waiting for a quick look', { n: review }), path: '/import' });
  if (money.budget && money.budget.state !== 'ok')
    notices.push({
      kind: 'budget',
      text: money.budget.state === 'over' ? t('Budget for this month is used up') : t('{left} left in this month’s budget', { left: fmtMoney(money.budget.left) }),
      path: '/geld',
    });

  // wish lists: an occasion coming up (only what this person may see – never the free count for a surprise list's owner)
  try {
    notices.push(...wishTodayHints(viewer?.userId ?? null));
  } catch {
    /* wishes are optional on Heute */
  }

  return {
    date: day,
    greeting: greeting(viewer?.name),
    platt: platt(viewer),
    away: awayToday(viewer?.userId ?? null),
    // "Für heute ist alles Wichtige erledigt" – nothing due or overdue, nothing waiting for a look: put the phone away
    calm: notices.length === 0 && dueNow(viewer?.userId ?? null) === 0,
    household: { name: getSetting('household.name', t('Our home')) },
    rhythm: rhythm.filter((r) => r.suggested).slice(0, 5).map((r) => rhythmCard(r, locale)),
    list: { open, recent },
    stillHave: still.slice(0, 5),
    cookToday: cook,
    money,
    notices,
  };
}

// ------------------------------------------------------------------ Paket B: the selection (docs/today.md)

/** Levels that belong on "Jetzt dran": due, overdue, or promised for today. Coming-up tasks wait for Aufgaben. */
const NOW_LEVELS = new Set(['overdue', 'today', 'promised']);

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** Monday to Wednesday (and Sunday for households whose week starts on Sunday): the week review may show. */
const earlyWeek = (day: string) => [0, 1, 2, 3].includes(new Date(day + 'T12:00:00Z').getUTCDay());

/** The one context place: every candidate that applies, the selection keeps the most important (today-select.ts). */
function contextCandidates(viewer: TodayViewer, base: { date: string; notices: { kind: string; text: string; path: string }[] }, mods: ReturnType<typeof modules>): TodayContext[] {
  const uid = viewer.userId ?? null;
  if (!uid || viewer.guestLevel || viewer.link) return [];
  const out: TodayContext[] = [];
  const day = base.date;
  // a wish list's occasion (gifts to get, wishes still free) – the notices already carry it, worded per viewer
  const wish = base.notices.find((n) => n.kind === 'gifts' || n.kind === 'wishes');
  if (wish) out.push({ kind: 'occasion', text: wish.text, path: wish.path });
  // "Bring mir was": someone is waiting for me
  if (mods.treats) {
    const waiting = safe(() => requestsFor(uid).filter((o: { status: string }) => o.status === 'new'), [] as { status: string; guest_name?: string | null; for_user_id?: number | null }[]);
    if (waiting.length) {
      const o = waiting[0] as { guest_name?: string | null; for_user_id?: number | null };
      const who = o.guest_name || t('Someone');
      out.push({
        kind: 'orders',
        text: waiting.length > 1 ? t('{n} wishes are waiting for you', { n: waiting.length }) : o.for_user_id ? t('{name} asks you', { name: who }) : t('{name} would love something', { name: who }),
        path: '/bestellen',
      });
    }
  }
  // "Übernimmst du …?": someone asked me to take a task over (habits.ts offerTask), answered under Aufgaben
  const asked = safe(
    () =>
      db
        .prepare(
          `SELECT c.name AS task, u.name AS who, (SELECT COUNT(*) FROM care_tasks WHERE offered_to = ? AND archived = 0) AS n
             FROM care_tasks c LEFT JOIN users u ON u.id = c.offered_by
            WHERE c.offered_to = ? AND c.archived = 0 ORDER BY c.id DESC LIMIT 1`,
        )
        .get(uid, uid) as { task: string; who: string | null; n: number } | undefined,
    undefined,
  );
  if (asked)
    out.push({
      kind: 'handover',
      text: asked.n > 1 ? t('Will you take over {n} tasks?', { n: asked.n }) : t('Will you take over “{task}”?', { task: asked.task }),
      detail: asked.n > 1 || !asked.who ? null : t('{name} asks you', { name: asked.who }),
      path: '/aufgaben',
    });
  // the bins go out tonight (collection tomorrow)
  const bins = safe(() => {
    const tasks = listCareTasks({ viewer: uid });
    const tonight = outlookFor(tasks, day).find((a) => a.evening && a.when === 'tonight');
    return tonight ? tasks.find((x) => x.id === tonight.id) ?? null : null;
  }, null);
  if (bins) out.push({ kind: 'bins', text: t('Tonight: put out {name}', { name: bins.name }), detail: t('Collection is tomorrow'), path: '/aufgaben' });
  const imports = base.notices.find((n) => n.kind === 'imports');
  if (imports) out.push({ kind: 'imports', text: imports.text, path: imports.path });
  const budget = base.notices.find((n) => n.kind === 'budget');
  if (budget && mods.money) out.push({ kind: 'budget', text: budget.text, path: budget.path });
  if (viewer.admin) {
    const demo = safe(() => demoStatus(), null);
    if (demo && demo.rows > 0) out.push({ kind: 'demo', text: t('You are looking at sample data.'), detail: t('Remove it once you add your own things.'), path: '/einstellungen/daten/zuruecksetzen#demo' });
    if (config.multiTenant) {
      const h = currentHousehold();
      const trial = h ? safe(() => trialSummary(h.id, uid), null) : null;
      if (trial?.state === 'running' && trial.daysLeft != null && trial.daysLeft <= 7)
        out.push({ kind: 'trial', text: trial.daysLeft <= 1 ? t('Your trial ends tomorrow') : t('Your trial ends in {n} days', { n: trial.daysLeft }), path: '/einstellungen/daten/abo' });
      else if (trial?.state === 'ended') out.push({ kind: 'trial', text: t('Your trial has ended'), path: '/einstellungen/daten/abo' });
    }
  }
  if (earlyWeek(day)) {
    const w = safe(() => weekReview(uid), null);
    if (w?.show) out.push({ kind: 'week', text: w.title, path: '/woche' });
  }
  const pulse = safe(() => pulseState(), null);
  if (pulse?.question) out.push({ kind: 'pulse', text: t('One question for the week'), path: null });
  if (viewer.admin) {
    const s = onboardState();
    const list = safe(() => checklist(uid), null);
    if (list && s.started && !s.checklistDismissed && list.done < list.total)
      out.push({ kind: 'start', text: t('Getting started: {done} of {total} done', { done: list.done, total: list.total }), path: '/willkommen' });
  }
  return out;
}

/**
 * GET /api/today, complete: the aggregate (older apps read its fields) plus the selection – `cards` (the order to
 * show, at most five), `now` (Jetzt dran), `context` (the one hint) and `entries` (small ways into Check-in and Im
 * Kopf). Web and iPhone render exactly this; neither decides itself what Heute shows.
 */
export function todayView(viewer: TodayViewer) {
  const raw = todayAggregate(viewer);
  const mods = modules();
  const uid = viewer.userId ?? null;
  const areas = viewer.guestLevel ? LEVEL_AREAS[viewer.guestLevel] : null;
  const may = (area: string) => !viewer.link && (!areas || areas.includes(area));
  const guest = Boolean(viewer.guestLevel || viewer.link);
  const prefs = focusPrefs(uid);

  // money and receipts never reach permanent guests; switched-off areas leave Heute (their data stays)
  const base = {
    ...raw,
    stillHave: mods.stock && may('stock') ? raw.stillHave : [],
    cookToday: mods.cook && may('recipes') ? raw.cookToday : null,
    money: mods.money && !guest ? raw.money : null,
    notices: guest ? [] : raw.notices.filter((n) => mods.money || n.kind !== 'budget'),
  };

  // Jetzt dran: the person's own queue (lib/next-task.ts), the same order as „Nur eins“ and /fokus
  let now: { items: NowCard[]; more: number; oneThing: boolean; gentle: boolean; max: number; guest: boolean } | null = null;
  if (uid && viewer.guestLevel !== 'paused' && !viewer.link) {
    const q = safe(() => nextTasks({ kind: 'user', userId: uid, self: true }, undefined, { mineOnly: Boolean(viewer.guestLevel) }).queue, [] as NowCard[]);
    const due = q.filter((c) => NOW_LEVELS.has(c.level));
    const max = nowMax(prefs.todayMax, prefs.gentle);
    if (due.length) now = { items: due.slice(0, max), more: Math.max(0, due.length - max), oneThing: prefs.oneThing && !guest, gentle: prefs.gentle, max, guest: Boolean(viewer.guestLevel) };
  }

  const useSoon = base.stillHave.filter((s) => s.kind === 'expiring' || s.kind === 'leftover').slice(0, 3);
  const listOn = may('shopping') && viewer.guestLevel !== 'paused';
  const soonAgain = listOn && !guest ? base.rhythm.slice(0, 3) : [];
  const context = guest ? null : pickContext(contextCandidates(viewer, base, mods));
  const moneyOn = !guest && Boolean(base.money) && prefs.todayMoney;
  const order = uid ? getUserPref<string[]>(uid, 'today.order', []) : [];
  const { cards, calm } = selectCards({
    now: Boolean(now),
    list: listOn && (base.list.open > 0 || soonAgain.length > 0),
    still: useSoon.length > 0,
    cook: Boolean(base.cookToday),
    money: moneyOn,
    context: Boolean(context),
    order,
    guest,
  });
  // check-in in the evening (only when it would ask), Im Kopf always for members: small ways in, never a form
  const checkin = !guest && uid ? safe(() => checkinView(uid).ask, false) : false;
  return {
    ...base,
    calm,
    cards: cards as TodayCardKey[],
    now,
    soonAgain,
    useSoon,
    context,
    entries: { checkin, mind: !guest && Boolean(uid) },
    moneyOnToday: moneyOn,
  };
}
