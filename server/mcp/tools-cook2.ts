/** MCP tools: What do we eat today, household recipe variants & substitutions, Cookidoo push from HA */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { pickMeal, whatToEat } from '../lib/cook2.js';
import { getRecipe } from '../lib/recipes.js';
import { localDay } from '../lib/catalog.js';
import { nameScore } from '../lib/text.js';
import { addRule, activeIngredients, effectiveIngredients, getVariant, resolveLine, setVariant, type VariantChange } from '../lib/variants.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

/** Recipe by id, exact title or best fuzzy title match. */
function resolveRecipe(ref: string | number): { id: number; title: string } | null {
  const rows = db.prepare('SELECT id, title FROM recipes').all() as { id: number; title: string }[];
  if (typeof ref === 'number' || /^#?\d+$/.test(String(ref).trim())) return rows.find((r) => r.id === Number(String(ref).replace('#', ''))) ?? null;
  const q = String(ref).trim().toLowerCase();
  const exact = rows.find((r) => r.title.toLowerCase() === q);
  if (exact) return exact;
  const best = rows.map((r) => ({ r, s: nameScore(String(ref), r.title) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s >= 0.6 ? best.r : null;
}

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'what_to_eat',
    {
      title: 'What do we eat today?',
      description:
        "A decisive answer from what's in the house: today's planned meal, dishes that work right now (household variants and swap rules applied), dishes where exactly one thing is missing (with in-stock alternatives), leftovers to eat first and quick dishes (≤ 20 min). Set pick=true to also get one weighted-random pick.",
      inputSchema: {
        thermomix: z.boolean().nullable().optional().describe('true = only Thermomix recipes, false = only without'),
        max_minutes: z.number().int().min(5).max(600).nullable().optional(),
        vegetarian: z.boolean().optional(),
        no_shopping: z.boolean().optional().describe('only what works without buying anything'),
        pick: z.boolean().optional(),
      },
      annotations: RO,
    },
    async (a) => {
      const w = whatToEat({ thermomix: a.thermomix ?? null, maxTime: a.max_minutes ?? null, vegetarian: a.vegetarian, noShopping: a.no_shopping });
      const slim = (x: any) => ({ recipe_id: x.recipe_id, title: x.title, time_min: x.time_min, thermomix: x.thermomix, why: x.why, missing: x.missing?.map((m: any) => ({ text: m.text, alternatives: m.alternatives.map((alt: any) => alt.name) })), our_way: x.swaps });
      const out: Record<string, unknown> = {
        today: w.today,
        recipes_in_collection: w.recipes,
        planned_today: w.planned.map((p) => ({ title: p.title, recipe_id: p.recipe_id, slot: p.slot, cooked: p.cooked, ready: p.ready, why: p.why })),
        ready_now: w.ready.map(slim),
        one_thing_missing: w.one_missing.map(slim),
        leftovers_first: w.leftovers.map((l) => ({ product_id: l.product_id, name: l.name, why: l.why })),
        quick: w.quick.map(slim),
      };
      if (a.pick) {
        const p = pickMeal(w);
        out.pick = p ? { bucket: p.bucket, ...(p.item.kind === 'recipe' ? slim(p.item) : { leftover: p.item.name, product_id: p.item.product_id, why: p.item.why }) } : null;
      }
      if (w.empty) out.hint = 'No recipes yet: save favourites with save_recipe, or connect the Cookidoo week via Home Assistant.';
      return text(out);
    },
  );

  s.registerTool(
    'set_recipe_variant',
    {
      title: 'Set our version of a recipe',
      description:
        'Store how this household actually cooks a recipe ("So machen wir das") without touching the original: swaps (potatoes → rice, optional amount), removals (no coriander), additions, a note, own servings/time. Matching, cooking and shopping lists use this version. mode="merge" adds to the existing changes, "replace" sets them anew. today_only=true applies the changes just for today.',
      inputSchema: {
        recipe: z.union([z.string(), z.number()]).describe('recipe id or title'),
        swaps: z.array(z.object({ ingredient: z.string().describe('original ingredient, e.g. "Kartoffeln"'), to: z.string(), amount: z.string().nullable().optional() })).max(20).optional(),
        remove: z.array(z.string()).max(20).optional().describe('ingredients to leave out'),
        add: z.array(z.string()).max(20).optional().describe('extra lines, e.g. "1 Handvoll Spinat"'),
        note: z.string().max(500).nullable().optional(),
        servings: z.number().int().min(1).max(50).nullable().optional(),
        time_min: z.number().int().min(1).max(1440).nullable().optional(),
        mode: z.enum(['merge', 'replace']).default('merge'),
        today_only: z.boolean().optional(),
      },
      annotations: RW,
    },
    async (a) => {
      const r = resolveRecipe(a.recipe);
      if (!r) return fail('Recipe not found.');
      const rec = getRecipe(r.id)!;
      const day = a.today_only ? localDay(0) : null;
      // match the given ingredient name to the recipe's own line so the change sticks
      const unknown: string[] = [];
      const ref = (name: string) => {
        let line = resolveLine(r.id, name);
        if (line === name && !rec.ingredients.some((i: any) => i.text === name)) {
          const best = rec.ingredients.map((i: any) => ({ text: i.text as string, s: nameScore(name, i.text) })).sort((x: any, y: any) => y.s - x.s)[0];
          if (best && best.s >= 0.5) line = best.text;
          else unknown.push(name);
        }
        return line;
      };
      const fresh: VariantChange[] = [
        ...(a.swaps ?? []).map((x) => ({ kind: 'swap' as const, ingredient: ref(x.ingredient), to: x.to, amount: x.amount ?? null, day })),
        ...(a.remove ?? []).map((x) => ({ kind: 'remove' as const, ingredient: ref(x), day })),
        ...(a.add ?? []).map((x) => ({ kind: 'add' as const, text: x, day })),
      ];
      const prev = a.mode === 'merge' ? getVariant(r.id)?.changes ?? [] : [];
      const kept = prev.filter((p) => !fresh.some((f) => f.ingredient && p.ingredient && f.ingredient === p.ingredient && (f.day ?? null) === (p.day ?? null)));
      const v = setVariant(r.id, { changes: [...kept, ...fresh], note: a.note, servings: a.servings, time_min: a.time_min }, actorName);
      const eff = activeIngredients(effectiveIngredients(rec, rec.ingredients));
      return text({ ok: true, recipe: r.title, variant: v, ingredients_our_way: eff.map((i) => i.text), unmatched_ingredients: unknown.length ? unknown : undefined });
    },
  );

  s.registerTool(
    'add_swap_rule',
    {
      title: 'Add a household swap rule',
      description:
        'A substitution that applies to ALL recipes, including imported Cookidoo ones: "we always use rice instead of potatoes", "oat milk instead of milk". Optionally only for some recipes or tags. Matching, suggestions and shopping lists use it.',
      inputSchema: {
        from: z.string().min(1).max(80).describe('ingredient as it appears in recipes, e.g. "Milch"'),
        to: z.string().min(1).max(80),
        amount: z.string().max(60).nullable().optional(),
        recipes: z.array(z.union([z.string(), z.number()])).max(50).optional().describe('only these recipes (ids or titles)'),
        tags: z.array(z.string()).max(20).optional().describe('only recipes with one of these tags'),
      },
      annotations: RW,
    },
    async (a) => {
      const ids: number[] = [];
      for (const x of a.recipes ?? []) {
        const r = resolveRecipe(x);
        if (!r) return fail(`Recipe not found: ${x}`);
        ids.push(r.id);
      }
      return text({ ok: true, rule: addRule({ from_text: a.from, to_text: a.to, amount: a.amount ?? null, recipe_ids: ids.length ? ids : null, tags: a.tags?.length ? a.tags : null }, actorName) });
    },
  );
}
