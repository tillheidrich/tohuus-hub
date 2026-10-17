/**
 * Sterne (14 Oct 2026, docs/points.md): optional points for households that want them – off by default, twice.
 *
 * 1. The instance must allow it: self-hosted `POINTS=on`, ToHuus Cloud the back office switch (runtime setting
 *    `points`). Without that nothing exists: no route data, no UI.
 * 2. An admin of the household switches it on and picks the areas (Aufgaben, Einkauf, Kochen, Geld).
 *
 * A star is a contribution ToHuus sees anyway ("Wer hat was im Blick", blick.ts): a done household task, an item put
 * on the list or ticked off, a meal planned, a receipt brought in. Counted per week from Monday.
 * Shown: "eure Woche zusammen" and my own stars. Other members' stars only when everyone agreed to compare (the same
 * opt-in as Blick). Children (kid profiles) see their own stars. No ranking, no streaks, nothing to lose; people in
 * gentle mode (focus.ts) don't see stars at all. Private tasks and personal receipts never count.
 */
import { db, getSetting, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { BLICK_AREAS, type BlickArea, compareOptIn, countsSince } from './blick.js';
import { emit } from './bus.js';
import { localDay } from './catalog.js';
import { focusPrefs } from './focus.js';
import { region } from './region.js';
import { runtimeSetting } from './runtime-settings.js';

const KEY = 'points';

/** Does this server allow stars at all? */
export function pointsAllowed() {
  const rt = runtimeSetting('points');
  if (rt === 'on' || rt === 'off') return rt === 'on';
  return (process.env.POINTS ?? '').trim().toLowerCase() === 'on';
}

export interface PointsSettings {
  on: boolean;
  areas: BlickArea[];
}

export function pointsSettings(): PointsSettings {
  const v = getSetting<Partial<PointsSettings> | null>(KEY, null);
  const areas = (v?.areas ?? []).filter((a): a is BlickArea => BLICK_AREAS.includes(a as BlickArea));
  return { on: pointsAllowed() && Boolean(v?.on) && areas.length > 0, areas };
}

export function setPointsSettings(v: PointsSettings) {
  if (!pointsAllowed()) throw Object.assign(new Error(t('Stars are not available on this server.')), { status: 403 });
  setSetting(KEY, { on: v.on, areas: v.areas.filter((a) => BLICK_AREAS.includes(a)) });
  emit('care');
  return pointsSettings();
}

function members() {
  return db.prepare(`SELECT id, name FROM users WHERE COALESCE(kind, 'member') != 'guest' ORDER BY name COLLATE NOCASE`).all() as { id: number; name: string }[];
}
function kids() {
  try {
    return db.prepare('SELECT id, name FROM kid_profiles ORDER BY name COLLATE NOCASE').all() as { id: number; name: string }[];
  } catch {
    return [];
  }
}

/** days since the start of the week (region: Monday or Sunday) */
function daysIntoWeek(today = localDay(0)) {
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  return (dow - region().weekStart + 7) % 7;
}

/** This week's stars for one viewer (a member) – or null when stars are off (or the viewer is in gentle mode). */
export function pointsWeek(viewer: number | null) {
  const s = pointsSettings();
  const base = { allowed: pointsAllowed(), on: s.on, areas: s.areas };
  if (!s.on) return { ...base, week: null };
  if (viewer != null && focusPrefs(viewer).gentle) return { ...base, hidden: true, week: null };
  const c = countsSince(`-${daysIntoWeek()} days`);
  const people = members();
  const me = viewer != null ? (people.find((p) => p.id === viewer)?.name ?? null) : null;
  const compare = people.length >= 2 && people.every((p) => compareOptIn(p.id));
  const names = new Set([...people.map((p) => p.name), ...kids().map((k) => k.name)]);
  const starsOf = (name: string) => s.areas.reduce((n, a) => n + (c[a].get(name) ?? 0), 0);
  const total = [...names].reduce((n, name) => n + starsOf(name), 0);
  return {
    ...base,
    week: {
      total,
      mine: me ? starsOf(me) : null,
      by_area: s.areas.map((a) => ({ area: a, total: [...c[a].entries()].filter(([n]) => names.has(n)).reduce((x, [, n]) => x + n, 0), mine: me ? (c[a].get(me) ?? 0) : null })),
      // alphabetical, never sorted by stars; members only when everyone agreed, children always
      people: compare ? people.map((p) => ({ name: p.name, stars: starsOf(p.name) })) : null,
      kids: kids().map((k) => ({ name: k.name, stars: starsOf(k.name) })).filter((k) => k.stars > 0),
    },
  };
}
