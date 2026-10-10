/** MCP tools: Keeping stock fresh: quick check, freeze/opened, leftovers, forecasts */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { getProduct, matchProduct } from '../lib/catalog.js';
import {
  FreshError,
  WASTE_REASONS,
  addLeftovers,
  applyCheck,
  checkItems,
  checkLocations,
  eatFirst,
  eatLeftover,
  freeze,
  markOpened,
  thaw,
} from '../lib/fresh.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Product by id, exact name (leftovers included) or fuzzy match. */
function resolveProduct(ref: string | number) {
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return getProduct(Number(ref)) ?? null;
  const exact = db.prepare('SELECT id FROM products WHERE archived = 0 AND lower(name) = lower(?) ORDER BY id DESC LIMIT 1').get(String(ref).trim()) as { id: number } | undefined;
  if (exact) return getProduct(exact.id) ?? null;
  const leftover = db
    .prepare(`SELECT id FROM products WHERE archived = 0 AND kind = 'leftover' AND lower(name) LIKE lower(?) ESCAPE '\\' ORDER BY id DESC LIMIT 1`)
    .get(`%${likeEsc(String(ref).trim())}%`) as { id: number } | undefined;
  if (leftover) return getProduct(leftover.id) ?? null;
  const m = matchProduct(String(ref));
  return m && m.score >= 0.6 ? getProduct(m.productId) ?? null : null;
}

function resolveLocation(ref: string | number) {
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return (db.prepare('SELECT id, name FROM locations WHERE id = ?').get(Number(ref)) as { id: number; name: string } | undefined) ?? null;
  return (db.prepare(`SELECT id, name FROM locations WHERE lower(name) LIKE lower(?) ESCAPE '\\' ORDER BY length(name) LIMIT 1`).get(`%${likeEsc(String(ref).trim())}%`) as { id: number; name: string } | undefined) ?? null;
}

/** Location that holds the product (the given one, else the first with stock). */
function locationOf(productId: number, ref?: string | number) {
  if (ref !== undefined && ref !== '') return resolveLocation(ref);
  const row = db.prepare('SELECT l.id, l.name FROM stock s JOIN locations l ON l.id = s.location_id WHERE s.product_id = ? AND s.qty > 0 ORDER BY s.best_before IS NULL, s.best_before LIMIT 1').get(productId) as
    | { id: number; name: string }
    | undefined;
  return row ?? null;
}

const productRef = z.union([z.string(), z.number()]).describe('Product id or name, e.g. "milk"');

async function guard<T>(fn: () => T) {
  try {
    return text(fn());
  } catch (e) {
    if (e instanceof FreshError) return fail(e.message);
    throw e;
  }
}

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'mark_opened',
    {
      title: 'Mark as opened',
      description:
        'Record that a pack was opened (milk, cream, juice, pesto …). One unit is split off and gets a shorter "use by" from the shelf life after opening; expiry warnings then use the earlier of best-before and that date.',
      inputSchema: { product: productRef },
      annotations: RW,
    },
    async ({ product }) => {
      const p = resolveProduct(product);
      if (!p) return fail(`No product found for "${product}". Use search_stock first.`);
      return guard(() => ({ product: p.name, ...markOpened(p.id, { actor: actorName }) }));
    },
  );

  s.registerTool(
    'freeze_item',
    {
      title: 'Freeze or thaw',
      description:
        'Move an item into the freezer (sets a new best-before, default 3 months or the product\'s own freezer time) – or, with thaw=true, take it out again: it goes back to where it came from (or the fridge) with an eat-by of 1–2 days.',
      inputSchema: {
        product: productRef,
        qty: z.number().positive().optional().describe('How many units; default: everything outside the freezer (freeze) or 1 (thaw)'),
        thaw: z.boolean().optional().describe('true = take out of the freezer instead'),
      },
      annotations: RW,
    },
    async ({ product, qty, thaw: doThaw }) => {
      const p = resolveProduct(product);
      if (!p) return fail(`No product found for "${product}". Use search_stock first.`);
      return guard(() => ({ product: p.name, ...(doThaw ? thaw(p.id, { qty, actor: actorName }) : freeze(p.id, { qty, actor: actorName })) }));
    },
  );

  s.registerTool(
    'add_leftovers',
    {
      title: 'Add leftovers',
      description:
        'Store leftovers after cooking: portions and where (fridge: eat within 3 days, freezer: 3 months). Named after the recipe if given. Leftovers show up first under "Eat me first" and as tonight\'s first idea. Use eaten=true to mark existing leftovers as eaten instead.',
      inputSchema: {
        recipe: z.union([z.string(), z.number()]).optional().describe('Recipe id or title the leftovers come from'),
        name: z.string().optional().describe('Name if there is no recipe, e.g. "Chili"'),
        portions: z.number().positive().max(50).optional().describe('Number of portions (default 1; when eaten=true default: all)'),
        where: z.enum(['fridge', 'freezer']).optional(),
        eaten: z.boolean().optional().describe('true = these leftovers were eaten'),
      },
      annotations: RW,
    },
    async ({ recipe, name, portions, where, eaten }) => {
      if (eaten) {
        const p = resolveProduct(name ?? String(recipe ?? ''));
        if (!p || (p as any).kind !== 'leftover') return fail('No such leftovers found. Call eat_first to see the list.');
        return guard(() => ({ leftovers: p.name, ...eatLeftover(p.id, portions, actorName) }));
      }
      let recipeId: number | null = null;
      if (recipe !== undefined) {
        const row = (typeof recipe === 'number' || /^\d+$/.test(String(recipe))
          ? db.prepare('SELECT id FROM recipes WHERE id = ?').get(Number(recipe))
          : db.prepare(`SELECT id FROM recipes WHERE lower(title) LIKE lower(?) ESCAPE '\\' ORDER BY length(title) LIMIT 1`).get(`%${likeEsc(String(recipe))}%`)) as { id: number } | undefined;
        if (!row && !name) return fail(`Recipe "${recipe}" not found – pass a name instead.`);
        recipeId = row?.id ?? null;
      }
      return guard(() => addLeftovers({ recipeId, name: name ?? null, portions: portions ?? 1, where: where ?? 'fridge', actor: actorName }));
    },
  );

  s.registerTool(
    'eat_first',
    {
      title: 'Eat me first',
      description: 'Leftovers and things that should be used soon (best-before or opened shelf life running out), soonest first. Good for "what should we eat today?".',
      inputSchema: { limit: z.number().int().min(1).max(50).optional() },
      annotations: RO,
    },
    async ({ limit }) =>
      text(
        eatFirst({ limit: limit ?? 15 }).map((x) => ({
          id: x.id,
          name: x.name,
          kind: x.kind,
          amount: `${x.qty} ${x.unit}`,
          use_by: x.use_by,
          days_left: x.days_left,
          opened: x.opened || undefined,
        })),
      ),
  );

  s.registerTool(
    'quick_check_location',
    {
      title: 'Quick check: what needs confirming',
      description:
        'Stock drifts when usage is not booked. Without location: every place with how many items it holds and days since the last check. With location: its items, least recently confirmed first – ask the user item by item and record answers with confirm_stock.',
      inputSchema: { location: z.union([z.string(), z.number()]).optional().describe('Location id or name, e.g. "Freezer"') },
      annotations: RO,
    },
    async ({ location }) => {
      if (location === undefined || location === '') return text(checkLocations().filter((l) => l.items > 0));
      const l = resolveLocation(location);
      if (!l) return fail(`Location "${location}" not found.`);
      const out = checkItems(l.id);
      return text({
        location: out.location.name,
        items: out.items.map((i) => ({ product_id: i.product_id, name: i.name, amount: `${i.qty} ${i.unit}`, use_by: i.use_by, days_since_confirmed: i.days_since_seen })),
      });
    },
  );

  s.registerTool(
    'confirm_stock',
    {
      title: 'Confirm stock',
      description:
        'Record the result of checking one item at one place: correct (as listed), less (give the real qty), empty (used up) or gone (thrown away – add waste_reason). Updates stock and the "last confirmed" date.',
      inputSchema: {
        product: productRef,
        location: z.union([z.string(), z.number()]).optional().describe('Where it was checked; default: where it is stored'),
        status: z.enum(['correct', 'less', 'empty', 'gone']),
        qty: z.number().min(0).optional().describe('For "less": the real amount now. For "gone": how much was thrown away (default: all)'),
        waste_reason: z.enum(WASTE_REASONS).optional().describe('For "gone": expired, spoiled, disliked or other'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ product, location, status, qty, waste_reason }) => {
      const p = resolveProduct(product);
      if (!p) return fail(`No product found for "${product}". Use search_stock first.`);
      const l = locationOf(p.id, location);
      if (!l) return fail(`No location found – pass one.`);
      if (status === 'less' && qty === undefined) return fail('For "less" pass the real qty.');
      const action = ({ correct: 'ok', less: 'set', empty: 'empty', gone: 'gone' } as const)[status];
      return guard(() => {
        applyCheck({ productId: p.id, locationId: l.id, action, qty: qty ?? null, reason: waste_reason ?? null, actor: actorName });
        const left = (db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock WHERE product_id = ? AND location_id = ?').get(p.id, l.id) as { q: number }).q;
        return { ok: true, product: p.name, location: l.name, now_here: left };
      });
    },
  );
}
