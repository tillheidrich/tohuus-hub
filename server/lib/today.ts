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
import { rhythmList, type RhythmItem } from './rhythm.js';
import { applyShareView, notPrivate } from './share-core.js';
import { fmtWhen, originOf } from './shopping-trust.js';
import { today as todayDay } from './spend2.js';

export interface TodayViewer {
  userId?: number | null;
  name?: string | null;
}

const WEEKDAY = (d: string, locale: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' });

function greeting(name: string | null | undefined) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: config.timezone }).format(new Date()));
  const base = hour < 5 ? t('Good evening') : hour < 11 ? t('Good morning') : hour < 17 ? t('Hello') : t('Good evening');
  return name ? t('{greeting}, {name}', { greeting: base, name }) : base;
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
    label: t('every ~{n} days · last {day}', { n: Math.max(1, Math.round(r.everyDays)), day: WEEKDAY(r.lastBought, locale) }),
  };
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
      image: e.image_path,
      kind: e.kind === 'leftover' ? 'leftover' : 'expiring',
      useBy: e.use_by,
      daysLeft: e.days_left,
      label: e.days_left == null ? t('eat soon') : e.days_left < 0 ? t('past its date') : e.days_left === 0 ? t('today') : e.days_left === 1 ? t('1 day left') : t('{n} days left', { n: e.days_left }),
    });
  }
  for (const r of rhythm.filter((x) => likely.has(x.productId)).sort((a, b) => b.lastBought.localeCompare(a.lastBought))) {
    if (still.length >= 5) break;
    if (still.some((s) => s.productId === r.productId)) continue;
    still.push({ productId: r.productId, name: r.name, image: r.image, kind: 'probably', useBy: null, daysLeft: null, label: t('bought {day}', { day: WEEKDAY(r.lastBought, locale) }) });
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
  const review = (db.prepare(`SELECT COUNT(*) n FROM imports WHERE status = 'review'`).get() as { n: number }).n;
  if (review) notices.push({ kind: 'imports', text: review === 1 ? t('1 receipt is waiting for a quick look') : t('{n} receipts are waiting for a quick look', { n: review }), path: '/import' });
  if (money.budget && money.budget.state !== 'ok')
    notices.push({
      kind: 'budget',
      text: money.budget.state === 'over' ? t('Budget for this month is used up') : t('{left} left in this month’s budget', { left: fmtMoney(money.budget.left) }),
      path: '/geld',
    });

  return {
    date: day,
    greeting: greeting(viewer?.name),
    household: { name: getSetting('household.name', t('Our home')) },
    rhythm: rhythm.filter((r) => r.suggested).slice(0, 5).map((r) => rhythmCard(r, locale)),
    list: { open, recent },
    stillHave: still.slice(0, 5),
    cookToday: cook,
    money,
    notices,
  };
}
