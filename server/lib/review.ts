/**
 * Rückblick – "Euer Jahr to Huus" (14 Oct 2026, docs/review.md): the household's year in a few cards, like a
 * year-in-review – built, but **not active**: off unless the server allows it (self-hosted `YEAR_REVIEW=on`,
 * ToHuus Cloud the back office switch, runtime setting `year_review`). Without that the route answers
 * `{ allowed: false }` and the apps show nothing.
 *
 * - "Wir" instead of people: no names, no shares, no ranking, no "best shopper". Only what happened.
 * - Private rows never count (private list items, private tasks, personal money entries and receipts).
 * - People in gentle mode (focus.ts) get no money card.
 * - Guests and guest links never see it.
 * - Season: from 1 December to 15 January the apps offer it on "Heute"; the page itself works the whole year
 *   (for the year so far) once the server allows it.
 */
import { db } from '../db.js';
import { locale, t } from '../i18n.js';
import { canSeeTask, listCareTasks } from './care.js';
import { focusPrefs } from './focus.js';
import { fmtMoney } from './money.js';
import { runtimeSetting } from './runtime-settings.js';
import { notPrivate } from './share-core.js';
import { loadEntries, today } from './spend2.js';

/** Does this server allow the year in review at all? Off by default. */
export function reviewAllowed() {
  const rt = runtimeSetting('year_review');
  if (rt === 'on' || rt === 'off') return rt === 'on';
  return (process.env.YEAR_REVIEW ?? '').trim().toLowerCase() === 'on';
}

/** The year the apps offer on "Heute": December → this year, 1–15 January → last year, else none. */
export function reviewSeason(day = today()): number | null {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  if (m === 12) return y;
  if (m === 1 && d <= 15) return y - 1;
  return null;
}

export type ReviewArea = 'shop' | 'cook' | 'tasks' | 'pantry' | 'money';
export interface ReviewCard {
  key: string;
  area: ReviewArea;
  /** the big number or word */
  value: string;
  title: string;
  text: string | null;
  list: string[];
}

export const fmtN = (n: number) => n.toLocaleString(locale());

function top(rows: { name: string; n: number }[], k = 3) {
  return rows.filter((r) => r.name?.trim()).slice(0, k).map((r) => r.name.trim());
}

export function shopCards(from: string, to: string): ReviewCard[] {
  const range = [`${from} 00:00:00`, `${to} 23:59:59`];
  const added = (db.prepare(`SELECT COUNT(*) n FROM shopping_items WHERE created_at BETWEEN ? AND ? AND ${notPrivate('id')}`).get(...range) as { n: number }).n;
  const bought = (db.prepare(`SELECT COUNT(*) n FROM shopping_items WHERE checked_at BETWEEN ? AND ? AND ${notPrivate('id')}`).get(...range) as { n: number }).n;
  const most = db
    .prepare(
      `SELECT COALESCE(p.name, s.text) AS name, COUNT(*) AS n FROM shopping_items s LEFT JOIN products p ON p.id = s.product_id
       WHERE s.checked_at BETWEEN ? AND ? AND ${notPrivate('s.id')} GROUP BY lower(COALESCE(p.name, s.text)) ORDER BY n DESC, name LIMIT 3`,
    )
    .all(...range) as { name: string; n: number }[];
  const days = db
    .prepare(`SELECT CAST(strftime('%w', checked_at) AS INTEGER) AS dow, COUNT(*) AS n FROM shopping_items WHERE checked_at BETWEEN ? AND ? AND ${notPrivate('id')} GROUP BY dow ORDER BY n DESC LIMIT 1`)
    .get(...range) as { dow: number; n: number } | undefined;
  const cards: ReviewCard[] = [];
  if (bought > 0)
    cards.push({ key: 'shop_bought', area: 'shop', value: fmtN(bought), title: t('things bought and ticked off'), text: most.length ? t('Most often:') : null, list: top(most) });
  if (added > 0) cards.push({ key: 'shop_noticed', area: 'shop', value: fmtN(added), title: t('times someone put something on the list'), text: t('So nobody had to keep it in their head.'), list: [] });
  if (days && days.n >= 10) {
    // 2026-10-11 was a Sunday – dow 0
    const name = new Date(Date.UTC(2026, 9, 11 + days.dow, 12)).toLocaleDateString(locale(), { weekday: 'long', timeZone: 'UTC' });
    cards.push({ key: 'shop_day', area: 'shop', value: name, title: t('was your shopping day'), text: null, list: [] });
  }
  return cards;
}

export function cookCards(from: string, to: string): ReviewCard[] {
  const planned = (db.prepare(`SELECT COUNT(*) n FROM meal_plan WHERE day BETWEEN ? AND ?`).get(from, to) as { n: number }).n;
  const dishes = db
    .prepare(`SELECT title AS name, COUNT(*) AS n FROM meal_plan WHERE day BETWEEN ? AND ? GROUP BY lower(title) HAVING n >= 2 ORDER BY n DESC, title LIMIT 3`)
    .all(from, to) as { name: string; n: number }[];
  let fresh = 0;
  try {
    fresh = (db.prepare(`SELECT COUNT(*) n FROM recipes WHERE created_at BETWEEN ? AND ?`).get(`${from} 00:00:00`, `${to} 23:59:59`) as { n: number }).n;
  } catch {
    /* older schema */
  }
  const cards: ReviewCard[] = [];
  if (planned > 0) cards.push({ key: 'cook_planned', area: 'cook', value: fmtN(planned), title: t('meals planned'), text: dishes.length ? t('On the table most often:') : null, list: top(dishes) });
  if (fresh > 0) cards.push({ key: 'cook_new', area: 'cook', value: fmtN(fresh), title: fresh === 1 ? t('new recipe') : t('new recipes'), text: t('Saved once, there for everyone.'), list: [] });
  return cards;
}

export function taskCards(from: string, to: string): ReviewCard[] {
  // household tasks only – private ones never count, tasks for someone a member looks after never (these cards are shared)
  const shared = new Map(listCareTasks({ outside: true }).filter((x) => canSeeTask(x)).map((x) => [x.id, x.name]));
  const rows = db.prepare(`SELECT task_id FROM care_log WHERE done_on BETWEEN ? AND ?`).all(from, to) as { task_id: number }[];
  const counts = new Map<string, number>();
  let done = 0;
  for (const r of rows) {
    const name = shared.get(r.task_id);
    if (!name) continue;
    done++;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (!done) return [];
  const most = [...counts].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return [{ key: 'tasks_done', area: 'tasks', value: fmtN(done), title: t('household tasks done'), text: t('Done most often:'), list: top(most) }];
}

/** `before`: the period to compare thrown-away food with (default: the same days a year earlier); only "fewer" is said */
export function pantryCards(from: string, to: string, before?: { from: string; to: string; text: string }): ReviewCard[] {
  const count = (reasons: string, a: string, b: string) =>
    (db.prepare(`SELECT COUNT(*) n FROM movements WHERE reason IN (${reasons}) AND created_at BETWEEN ? AND ?`).get(`${a} 00:00:00`, `${b} 23:59:59`) as { n: number }).n;
  const used = count(`'consume'`, from, to);
  if (!used) return [];
  const thrown = count(`'waste','expired'`, from, to);
  const y = Number(from.slice(0, 4));
  // last year up to the same day, so a running year is compared fairly
  const lastThrown = before ? count(`'waste','expired'`, before.from, before.to) : count(`'waste','expired'`, `${y - 1}${from.slice(4)}`, `${y - 1}${to.slice(4)}`);
  const less = lastThrown - thrown;
  return [
    {
      key: 'pantry_used',
      area: 'pantry',
      value: fmtN(used),
      title: t('things used up from the pantry'),
      text: less > 0 ? t(before?.text ?? '{n} fewer thrown away than the year before.', { n: fmtN(less) }) : null,
      list: [],
    },
  ];
}

function moneyCards(from: string, to: string): ReviewCard[] {
  // the household view: personal entries and receipts are never part of it
  const entries = loadEntries({ from, to }).filter((e) => !e.excluded);
  if (!entries.length) return [];
  const total = Math.round(entries.reduce((s, e) => s + e.price, 0) * 100) / 100;
  const receipts = new Set(entries.filter((e) => e.receipt_id).map((e) => e.receipt_id));
  const byMonth = new Map<string, number>();
  for (const e of entries) byMonth.set(e.day.slice(0, 7), (byMonth.get(e.day.slice(0, 7)) ?? 0) + e.price);
  const cards: ReviewCard[] = [
    {
      key: 'money_total',
      area: 'money',
      value: fmtMoney(total),
      title: t('for food and the household'),
      text: receipts.size ? (receipts.size === 1 ? t('From 1 receipt – nobody had to type it.') : t('From {n} receipts – nobody had to type them.', { n: fmtN(receipts.size) })) : null,
      list: [],
    },
  ];
  if (byMonth.size >= 3) {
    const [month, amount] = [...byMonth].sort((a, b) => b[1] - a[1])[0];
    const name = new Date(`${month}-15T12:00:00Z`).toLocaleDateString(locale(), { month: 'long', timeZone: 'UTC' });
    cards.push({ key: 'money_month', area: 'money', value: name, title: t('was your most expensive month'), text: fmtMoney(Math.round(amount * 100) / 100), list: [] });
  }
  return cards;
}

/** The year for one viewer – or `{ allowed: false }` when the server does not offer it. */
export function yearReview(viewer: number | null, year?: number) {
  const allowed = reviewAllowed();
  const season = reviewSeason();
  if (!allowed) return { allowed: false as const, season: null, year: null, enough: false, title: null, intro: null, outro: null, cards: [] as ReviewCard[] };
  const now = Number(today().slice(0, 4));
  const y = year && year >= 2000 && year <= now ? year : (season ?? now);
  const from = `${y}-01-01`;
  const to = y === now ? today() : `${y}-12-31`;
  const gentle = viewer != null && focusPrefs(viewer).gentle;
  const cards = [...shopCards(from, to), ...cookCards(from, to), ...taskCards(from, to), ...pantryCards(from, to), ...(gentle ? [] : moneyCards(from, to))];
  return {
    allowed: true as const,
    season,
    year: y,
    // a few cards at least, else "come back later"
    enough: cards.length >= 3,
    title: t('Your year at home {year}', { year: y }),
    intro: t('What you did together – no ranking, just what happened.'),
    outro: t('Thanks for keeping each other in mind.'),
    cards,
  };
}
