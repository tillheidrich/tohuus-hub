/** Weekly meal plan: manual entries, auto-fill from suggestions, Cookidoo "Meine Woche" via Home Assistant. */
import { db, getSetting } from '../db.js';
import { emit } from './bus.js';
import { addToShopping, localDay, matchIngredient } from './catalog.js';
import { fetchImage, saveImage } from './images.js';
import { safeFetch } from './net.js';
import { getRecipe, ingredientCore, listRecipes, parseRecipeJsonLd, saveRecipe, suggest } from './recipes.js';
import { norm, nameScore } from './text.js';
import { t } from '../i18n.js';
import { activeIngredients, effectiveIngredients, variantContext } from './variants.js';

export interface PlanEntry {
  id: number;
  day: string;
  slot: string;
  recipe_id: number | null;
  title: string;
  note: string | null;
  source: string;
  cooked: number;
}

export function weekDays(from: string, n = 7) {
  const d = new Date(from + 'T12:00:00Z');
  return Array.from({ length: n }, (_, i) => new Date(d.getTime() + i * 86400000).toISOString().slice(0, 10));
}

export function getPlan(from: string, to: string) {
  return db
    .prepare(
      `SELECT m.*, r.image_path, r.thermomix, r.time_min FROM meal_plan m LEFT JOIN recipes r ON r.id = m.recipe_id
       WHERE day >= ? AND day <= ? ORDER BY day, slot`,
    )
    .all(from, to) as (PlanEntry & { image_path: string | null; thermomix: number; time_min: number | null })[];
}

export function addPlan(input: { day: string; recipe_id?: number | null; title?: string; slot?: string; note?: string | null; source?: string; external_id?: string | null }) {
  let title = input.title?.trim() ?? '';
  if (input.recipe_id) {
    const r = db.prepare('SELECT title FROM recipes WHERE id = ?').get(input.recipe_id) as { title: string } | undefined;
    if (!r) throw new Error(t('Recipe not found'));
    title ||= r.title;
  }
  if (!title) throw new Error(t('Title is missing'));
  const info = db
    .prepare('INSERT INTO meal_plan (day, slot, recipe_id, title, note, source, external_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(input.day, input.slot ?? 'abend', input.recipe_id ?? null, title, input.note ?? null, input.source ?? 'manual', input.external_id ?? null);
  emit('recipes');
  return Number(info.lastInsertRowid);
}

/** Fill empty evenings with the best suggestions, without repeating a recipe within the week. */
export function autofill(from: string, days = 7) {
  const range = weekDays(from, days);
  const existing = getPlan(range[0], range[range.length - 1]);
  const used = new Set(existing.map((e) => e.recipe_id).filter(Boolean));
  const taken = new Set(existing.filter((e) => e.slot === 'abend').map((e) => e.day));
  const pool = suggest({ limit: 50 }).filter((s) => !used.has(s.recipe.id));
  let added = 0;
  for (const day of range) {
    if (taken.has(day) || day < localDay(0)) continue;
    const next = pool.shift();
    if (!next) break;
    addPlan({ day, recipe_id: next.recipe.id, source: 'suggest', note: next.reasons.slice(0, 2).join(' · ') });
    added++;
  }
  return { added };
}

/** Put everything the planned recipes need but the house doesn't have on the shopping list. */
export function planShopping(from: string, to: string, actor: string) {
  const entries = getPlan(from, to).filter((e) => e.recipe_id && !e.cooked);
  const products = db.prepare('SELECT p.id, p.name, p.track_mode, p.is_staple, (SELECT COALESCE(SUM(qty),0) FROM stock s WHERE s.product_id = p.id) AS total FROM products p').all() as any[];
  const byId = new Map(products.map((p) => [p.id, p]));
  const need = new Map<string, { text: string; productId: number | null; recipes: Set<string> }>();
  const ctx = variantContext();
  for (const e of entries) {
    const r = getRecipe(e.recipe_id!);
    if (!r) continue;
    // the house version counts: "Reis statt Kartoffeln" puts rice on the list
    for (const i of activeIngredients(effectiveIngredients(r, r.ingredients, ctx))) {
      if (i.pantry || i.optional) continue;
      const core = ingredientCore(i.text);
      const m = i.product_id ? { productId: i.product_id, score: 1 } : matchIngredient(core);
      const p = m && m.score >= 0.72 ? byId.get(m.productId) : null;
      if (p && (p.is_staple || p.track_mode === 'none' || p.total > 0)) continue;
      const key = p ? `p${p.id}` : norm(core);
      if (!need.has(key)) need.set(key, { text: p ? p.name : core, productId: p?.id ?? null, recipes: new Set() });
      need.get(key)!.recipes.add(r.title);
    }
  }
  let added = 0;
  for (const n of need.values()) {
    const out = addToShopping({ productId: n.productId, text: n.text, note: `Wochenplan: ${[...n.recipes].join(', ')}`, source: 'recipe', addedBy: actor });
    if (out.created) added++;
  }
  return { added, needed: need.size };
}

// ------------------------------------------------------------ Cookidoo via Home Assistant

export interface HaSettings {
  url: string;
  token: string;
  cookidooCalendar: string;
}

export function haSettings(): HaSettings {
  return { url: '', token: '', cookidooCalendar: 'calendar.cookidoo_speiseplan', ...getSetting<Partial<HaSettings>>('ha', {}) };
}

export interface CookidooEvent {
  /** YYYY-MM-DD (or an ISO date-time; only the date is used) */
  date?: string | null;
  start?: { date?: string; dateTime?: string } | string | null;
  summary: string;
  description?: string | null;
}

export interface CookidooResult {
  events: number;
  added: number;
  updated: number;
  removed: number;
  imported: number;
  error?: string;
}

/** "Total Time: 4200.0" (seconds, as the HA Cookidoo calendar writes it) → 70 minutes. */
export function cookidooMinutes(description: string | null | undefined): number | null {
  const m = String(description ?? '').match(/(?:total\s*time|gesamtzeit|total\s*tid)\s*:?\s*([\d.,]+)/i);
  if (!m) return null;
  const sec = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.max(1, Math.round(sec / 60));
}

const cookidooDay = (ev: CookidooEvent) => {
  const st = ev.start;
  const raw = ev.date ?? (typeof st === 'string' ? st : st?.date ?? st?.dateTime) ?? '';
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
};

/** Stable id per planned dish: date + normalised title (the HA calendar has no stable uid for Cookidoo). */
export const cookidooExternalId = (day: string, summary: string) => `cookidoo:${day}:${norm(summary)}`;

/**
 * Mirrors Cookidoo calendar events into the meal plan – shared by the pull (HA token in ToHuus) and the push
 * (the HACS integration posts to /api/ha/v1/cookidoo). Idempotent:
 * - recipes are matched by title, otherwise imported from the public Cookidoo page (if the event links to it)
 *   or created as a stub with the cooking time from "Total Time: 4200.0";
 * - an entry that is already there is updated (title, time of a stub recipe);
 * - future, uncooked Cookidoo entries in the covered range that are no longer in Cookidoo are removed.
 */
export async function importCookidooEvents(input: CookidooEvent[], range: { start?: string | null; end?: string | null } = {}): Promise<CookidooResult> {
  const today = localDay(0);
  const seen = new Set<string>();
  const events: { day: string; summary: string; description: string | null; ext: string }[] = [];
  for (const ev of input) {
    const day = cookidooDay(ev);
    const summary = String(ev.summary ?? '').replace(/\s+/g, ' ').trim();
    if (!day || !summary) continue;
    const ext = cookidooExternalId(day, summary);
    if (seen.has(ext)) continue;
    seen.add(ext);
    events.push({ day, summary, description: ev.description ?? null, ext });
  }
  let added = 0;
  let updated = 0;
  let imported = 0;
  const recipes = listRecipes();
  for (const ev of events) {
    const minutes = cookidooMinutes(ev.description);
    // also catch entries written by older versions (uid-based ids) or by hand for the same day + dish
    const existing = (db.prepare('SELECT * FROM meal_plan WHERE external_id = ?').get(ev.ext) ??
      db
        .prepare("SELECT * FROM meal_plan WHERE source = 'cookidoo' AND day = ?")
        .all(ev.day)
        .find((e: any) => norm(e.title) === norm(ev.summary))) as (PlanEntry & { external_id: string | null }) | undefined;
    if (existing) {
      let changed = false;
      if (existing.title !== ev.summary || existing.external_id !== ev.ext) {
        db.prepare('UPDATE meal_plan SET title = ?, external_id = ? WHERE id = ?').run(ev.summary, ev.ext, existing.id);
        changed = true;
      }
      if (existing.recipe_id && minutes) {
        const rec = db.prepare('SELECT time_min, source_type FROM recipes WHERE id = ?').get(existing.recipe_id) as { time_min: number | null; source_type: string } | undefined;
        if (rec && rec.source_type === 'cookidoo' && rec.time_min !== minutes) {
          db.prepare("UPDATE recipes SET time_min = ?, updated_at = datetime('now') WHERE id = ?").run(minutes, existing.recipe_id);
          changed = true;
        }
      }
      if (changed) updated++;
      continue;
    }
    let recipe = recipes.find((x) => nameScore(ev.summary, x.title) >= 0.85) ?? null;
    let recipeId: number | null = recipe?.id ?? null;
    if (!recipeId) {
      const url = `${ev.description ?? ''}`.match(/https:\/\/cookidoo\.[a-z.]+\/recipes\/recipe\/[\w-]+\/r\d+/)?.[0];
      if (url) {
        try {
          const page = await safeFetch(url, { maxBytes: 4 * 1024 * 1024, headers: { 'Accept-Language': 'de-DE' } });
          const rec = parseRecipeJsonLd(page.buf.toString('utf8'), url);
          if (rec) {
            recipeId = saveRecipe({ ...rec, image_path: null, time_min: rec.time_min ?? minutes });
            const img = rec.image_path ? await fetchImage(rec.image_path) : null;
            if (img) db.prepare('UPDATE recipes SET image_path = ? WHERE id = ?').run(await saveImage(img, `r${recipeId}`), recipeId);
            imported++;
          }
        } catch {
          /* fall through to stub */
        }
      }
      recipeId ??= saveRecipe({
        title: ev.summary,
        source_type: 'cookidoo',
        thermomix: true,
        time_min: minutes,
        source_url: url ?? null,
        notes: t('Taken from the Cookidoo week plan – add ingredients via link import.'),
      });
      recipes.push({ id: recipeId, title: ev.summary } as any);
    } else if (minutes && recipe && recipe.source_type === 'cookidoo' && !recipe.time_min) {
      db.prepare('UPDATE recipes SET time_min = ? WHERE id = ?').run(minutes, recipeId);
    }
    addPlan({ day: ev.day, recipe_id: recipeId, title: ev.summary, source: 'cookidoo', external_id: ev.ext });
    added++;
  }
  // stale: future Cookidoo entries in the covered range that Cookidoo no longer has
  const days = events.map((e) => e.day).sort();
  const from = [range.start, today].filter((d): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d))).sort().pop()!;
  const to = range.end && /^\d{4}-\d{2}-\d{2}$/.test(range.end) ? range.end : days.length ? days[days.length - 1] : null;
  let removed = 0;
  if (to && to >= from) {
    const stale = (db.prepare("SELECT id, external_id FROM meal_plan WHERE source = 'cookidoo' AND cooked = 0 AND day >= ? AND day <= ?").all(from, to) as { id: number; external_id: string | null }[]).filter(
      (e) => !e.external_id || !seen.has(e.external_id),
    );
    const delStmt = db.prepare('DELETE FROM meal_plan WHERE id = ?');
    db.transaction(() => stale.forEach((e) => delStmt.run(e.id)))();
    removed = stale.length;
  }
  if (added || updated || removed) emit('recipes');
  return { events: events.length, added, updated, removed, imported };
}

/**
 * Pull: reads the Cookidoo week plan from the Home Assistant Cookidoo integration (calendar entity) with a
 * long-lived HA token stored in ToHuus Hub. The push from the HACS integration needs no token here.
 */
export async function syncCookidoo(): Promise<CookidooResult> {
  const s = haSettings();
  if (!s.url || !s.token || !s.cookidooCalendar) return { events: 0, added: 0, updated: 0, removed: 0, imported: 0, error: t('Home Assistant not connected') };
  const start = localDay(-1);
  const end = localDay(14);
  const r = await fetch(`${s.url.replace(/\/$/, '')}/api/calendars/${encodeURIComponent(s.cookidooCalendar)}?start=${start}T00:00:00&end=${end}T23:59:59`, {
    headers: { Authorization: `Bearer ${s.token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return { events: 0, added: 0, updated: 0, removed: 0, imported: 0, error: t('Home Assistant responded with {status}', { status: r.status }) };
  const events = (await r.json()) as { summary: string; start: { date?: string; dateTime?: string }; description?: string | null }[];
  return importCookidooEvents(events, { start: localDay(0), end });
}

/** Push every open entry from `from` onwards by `by` days – "we eat out tonight, everything moves". */
export function shiftPlan(from: string, by = 1, slot?: string) {
  const rows = db
    .prepare(`SELECT id, day FROM meal_plan WHERE day >= ? AND cooked = 0 ${slot ? 'AND slot = ?' : ''}`)
    .all(...(slot ? [from, slot] : [from])) as { id: number; day: string }[];
  const upd = db.prepare('UPDATE meal_plan SET day = ? WHERE id = ?');
  db.transaction(() => rows.forEach((r) => upd.run(weekDays(r.day, by + 1)[by], r.id)))();
  emit('recipes');
  return { moved: rows.length };
}
