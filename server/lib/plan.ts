/** Weekly meal plan: manual entries, auto-fill from suggestions, Cookidoo "Meine Woche" via Home Assistant. */
import { db, getSetting } from '../db.js';
import { emit } from './bus.js';
import { addToShopping, localDay, matchIngredient } from './catalog.js';
import { fetchImage, saveImage } from './images.js';
import { safeFetch } from './net.js';
import { getRecipe, ingredientCore, listRecipes, parseRecipeJsonLd, saveRecipe, suggest } from './recipes.js';
import { norm, nameScore } from './text.js';
import { t } from '../i18n.js';

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
  for (const e of entries) {
    const r = getRecipe(e.recipe_id!);
    if (!r) continue;
    for (const i of r.ingredients) {
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

/**
 * Reads the Cookidoo week plan from the Home Assistant Cookidoo integration (calendar entity) and mirrors it
 * into the meal plan. Recipes are matched by title; unknown ones are imported from their public Cookidoo
 * page (title, picture, ingredients) when the event links to it, otherwise created as a stub.
 */
export async function syncCookidoo(): Promise<{ events: number; added: number; imported: number; error?: string }> {
  const s = haSettings();
  if (!s.url || !s.token || !s.cookidooCalendar) return { events: 0, added: 0, imported: 0, error: t('Home Assistant not connected') };
  const start = localDay(-1);
  const end = localDay(14);
  const r = await fetch(`${s.url.replace(/\/$/, '')}/api/calendars/${encodeURIComponent(s.cookidooCalendar)}?start=${start}T00:00:00&end=${end}T23:59:59`, {
    headers: { Authorization: `Bearer ${s.token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return { events: 0, added: 0, imported: 0, error: t('Home Assistant responded with {status}', { status: r.status }) };
  const events = (await r.json()) as { summary: string; start: { date?: string; dateTime?: string }; description?: string | null; uid?: string | null }[];
  let added = 0;
  let imported = 0;
  const recipes = listRecipes();
  for (const ev of events) {
    const day = (ev.start.date ?? ev.start.dateTime ?? '').slice(0, 10);
    if (!day || !ev.summary) continue;
    const ext = `cookidoo:${ev.uid ?? `${day}:${norm(ev.summary)}`}`;
    if (db.prepare('SELECT 1 FROM meal_plan WHERE external_id = ?').get(ext)) continue;
    let recipeId = recipes.find((x) => nameScore(ev.summary, x.title) >= 0.85)?.id ?? null;
    if (!recipeId) {
      const url = `${ev.description ?? ''}`.match(/https:\/\/cookidoo\.[a-z.]+\/recipes\/recipe\/[\w-]+\/r\d+/)?.[0];
      if (url) {
        try {
          const page = await safeFetch(url, { maxBytes: 4 * 1024 * 1024, headers: { 'Accept-Language': 'de-DE' } });
          const rec = parseRecipeJsonLd(page.buf.toString('utf8'), url);
          if (rec) {
            recipeId = saveRecipe({ ...rec, image_path: null });
            const img = rec.image_path ? await fetchImage(rec.image_path) : null;
            if (img) db.prepare('UPDATE recipes SET image_path = ? WHERE id = ?').run(await saveImage(img, `r${recipeId}`), recipeId);
            imported++;
          }
        } catch {
          /* fall through to stub */
        }
      }
      recipeId ??= saveRecipe({ title: ev.summary, source_type: 'cookidoo', thermomix: true, source_url: url ?? null, notes: t('Taken from the Cookidoo week plan – add ingredients via link import.') });
    }
    addPlan({ day, recipe_id: recipeId, title: ev.summary, source: 'cookidoo', external_id: ext });
    added++;
  }
  return { events: events.length, added, imported };
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
