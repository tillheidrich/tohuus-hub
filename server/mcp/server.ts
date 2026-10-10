import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { actorFromBearer, safeEqual } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { findThings } from '../lib/find.js';
import {
  addToShopping,
  adjustStock,
  createProduct,
  fmtQty,
  getProduct,
  listProducts,
  markUsedUp,
  matchProduct,
  productView,
} from '../lib/catalog.js';
import { enqueueEnrich } from '../lib/enrich.js';
import { fetchImage, saveImage } from '../lib/images.js';
import { applyImport, createImport, linesToImport } from '../lib/imports.js';
import { overview } from '../lib/overview.js';
import { getRecipe, listRecipes, logCooked, saveRecipe, suggest } from '../lib/recipes.js';
import { addPlan, autofill, getPlan, planShopping, shiftPlan, weekDays } from '../lib/plan.js';
import { localDay } from '../lib/catalog.js';
import { register as register_data } from './tools-data.js';
import { register as register_party } from './tools-party.js';
import { register as register_fresh } from './tools-fresh.js';
import { register as register_shop } from './tools-shop.js';
import { register as register_home } from './tools-home.js';
import { register as register_kiosk } from './tools-kiosk.js';
import { register as register_kids } from './tools-kids.js';
import { register as register_onboard } from './tools-onboard.js';
import { register as register_retail } from './tools-retail.js';
import { register as register_ha } from './tools-ha.js';
import { register as register_channels } from './tools-channels.js';
import { register as register_intl } from './tools-intl.js';
import { register as register_cook2 } from './tools-cook2.js';
import { register as register_auth } from './tools-auth.js';
import { register as register_spend2 } from './tools-spend2.js';
import { register as register_print } from './tools-print.js';
import { norm } from '../lib/text.js';

const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

function findProduct(ref: string | number) {
  if (typeof ref === 'number') return getProduct(ref) ?? null;
  const m = matchProduct(String(ref));
  return m && m.score >= 0.6 ? getProduct(m.productId)! : null;
}

function candidates(q: string) {
  const n = norm(q);
  return listProducts()
    .filter((p) => norm(`${p.brand ?? ''} ${p.name}`).includes(n.split(' ')[0] ?? ''))
    .slice(0, 8)
    .map((p) => ({ id: p.id, name: p.name, brand: p.brand }));
}

function compact(p: ReturnType<typeof listProducts>[number]) {
  const locs = db.prepare('SELECT id, name FROM locations').all() as { id: number; name: string }[];
  const lname = new Map(locs.map((l) => [l.id, l.name]));
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    size: p.size,
    amount: p.track_mode === 'none' ? 'not tracked' : fmtQty(p, p.total),
    status: p.status,
    min_qty: p.min_qty || undefined,
    best_before: p.nextExpiry ?? undefined,
    where: p.stock.filter((s) => s.qty > 0).map((s) => `${lname.get(s.location_id)}: ${fmtQty(p, s.qty)}${s.best_before ? ` (best before ${s.best_before})` : ''}`),
    spot: p.spot ?? undefined,
  };
}

export function buildMcpServer(actorName: string) {
  const s = new McpServer(
    { name: 'tohuus', version: '0.1.0' },
    {
      instructions:
        "ToHuus Hub is a family's household inventory (pantry, freezer, cellar, household supplies), plus shopping list, recipes and cooking history. " +
        "Answer in the user's language. Product, location and recipe names are stored in the household's language - use them as they are. " +
        'YOU read photos (receipt, freezer, recipe card) yourself and pass the recognised data in structured form: ' +
        'purchases/receipts → record_purchase (by default queued for review in the app), recipes → save_recipe. ' +
        'If a product name is unclear, use search_stock before changing stock.',
    },
  );

  s.registerTool(
    'get_overview',
    { title: 'Overview', description: 'What is running low, empty or expiring soon, what is on the shopping list, what could be cooked today.', inputSchema: {}, annotations: RO },
    async () => {
      const o = overview();
      return text({
        counts: o.counts,
        needs_attention: o.attention.map((a) => ({ id: a.id, name: a.name, status: a.status, amount: fmtQty(a as any, a.total), best_before: a.nextExpiry })),
        shopping_list: o.shopping.map((x: any) => x.text),
        imports_to_review: o.imports,
        open_guest_orders: o.orders,
        cooking_ideas: o.tonight.map((t) => ({ id: t.id, title: t.title, reasons: t.reasons })),
        locations: o.locations.map((l: any) => ({ id: l.id, name: l.name, products: l.products, low: l.low })),
      });
    },
  );

  s.registerTool(
    'search_stock',
    {
      title: 'Search stock',
      description: 'Searches products in stock. Without query: everything (optionally filtered by location or status). Returns amount, location and best-before date.',
      inputSchema: {
        query: z.string().optional().describe('Free text, e.g. "ice cream", "parcel tape", "pasta"'),
        location: z.string().optional().describe('Location, e.g. "Freezer", "Cellar"'),
        status: z.enum(['low', 'empty', 'expiring', 'expired', 'ok', 'in_stock']).optional(),
      },
      annotations: RO,
    },
    async ({ query, location, status }) => {
      let list = listProducts().filter((p) => p.track_mode !== 'none' || p.orderable);
      if (query) {
        const q = norm(query);
        const cats = new Map((db.prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]).map((c) => [c.id, c.name]));
        const re = new RegExp(`(^| )${q.replace(/[.*+?^${}()|[\]\\]/g, '')}`);
        const scored = list.map((p) => ({ p, hit: re.test(norm(`${p.brand ?? ''} ${p.name} ${p.size ?? ''} ${cats.get(p.category_id ?? 0) ?? ''}`)) }));
        const direct = scored.filter((x) => x.hit).map((x) => x.p);
        if (direct.length) list = direct;
        else {
          const m = matchProduct(query);
          list = m ? list.filter((p) => p.id === m.productId) : [];
        }
      }
      if (location) {
        const l = db.prepare(`SELECT id FROM locations WHERE lower(name) LIKE lower(?) ESCAPE '\\'`).get(`%${likeEsc(location)}%`) as { id: number } | undefined;
        if (l) list = list.filter((p) => p.stock.some((s) => s.location_id === l.id && s.qty > 0) || p.default_location_id === l.id);
      }
      if (status) list = list.filter((p) => (status === 'in_stock' ? p.total > 0 : p.status === status));
      return text(list.slice(0, 80).map(compact));
    },
  );

  s.registerTool(
    'update_stock',
    {
      title: 'Update stock',
      description:
        'Changes the stock of a product: delta (+2 / -1) or set (absolute amount). For fill-level products (fruit/veg) set 0–3 = empty/low/half/full.',
      inputSchema: {
        product: z.union([z.string(), z.number()]).describe('Product name or ID'),
        delta: z.number().optional(),
        set: z.number().optional(),
        location: z.string().optional(),
        best_before: z.string().optional().describe('YYYY-MM-DD, only when adding'),
      },
      annotations: RW,
    },
    async ({ product, delta, set, location, best_before }) => {
      const p = findProduct(product);
      if (!p) return text({ error: 'Product not found unambiguously', candidates: candidates(String(product)), hint: 'Use create_product if it is new.' });
      const loc = location ? (db.prepare(`SELECT id FROM locations WHERE lower(name) LIKE lower(?) ESCAPE '\\'`).get(`%${likeEsc(location)}%`) as { id: number } | undefined)?.id : undefined;
      const out = adjustStock({ productId: p.id, locationId: loc ?? null, delta, set, bestBefore: best_before ?? null, reason: 'assistant', actor: actorName });
      return text({ product: p.name, now: fmtQty(p, out.total), status: out.status });
    },
  );

  s.registerTool(
    'mark_used_up',
    { title: 'Used up', description: 'Sets a product to 0 and puts it on the shopping list.', inputSchema: { product: z.union([z.string(), z.number()]) }, annotations: RW },
    async ({ product }) => {
      const p = findProduct(product);
      if (!p) return text({ error: 'not found', candidates: candidates(String(product)) });
      markUsedUp(p.id, actorName);
      return text({ ok: true, product: p.name, on_shopping_list: true });
    },
  );

  s.registerTool(
    'create_product',
    {
      title: 'Create product',
      description: 'Creates a new product (optionally with starting amount, location, minimum amount, barcode, image URL). Otherwise an image is looked up automatically via Open Food Facts.',
      inputSchema: {
        name: z.string(),
        brand: z.string().optional(),
        size: z.string().optional(),
        location: z.string().optional(),
        qty: z.number().optional(),
        min_qty: z.number().optional().describe('below this amount it counts as low → shopping list'),
        barcode: z.string().optional(),
        image_url: z.string().url().optional(),
        best_before: z.string().optional(),
      },
      annotations: RW,
    },
    async (a) => {
      const existing = matchProduct(a.name, { code: a.barcode, brand: a.brand });
      const ex = existing && existing.score >= 0.9 ? listProducts().find((p) => p.id === existing.productId) : undefined;
      if (ex) return text({ exists: true, product: compact(ex) });
      const loc = a.location ? (db.prepare(`SELECT id FROM locations WHERE lower(name) LIKE lower(?) ESCAPE '\\'`).get(`%${likeEsc(a.location)}%`) as { id: number } | undefined)?.id : undefined;
      const id = createProduct({ name: a.name, brand: a.brand, size: a.size, locationId: loc ?? null, minQty: a.min_qty, offCode: a.barcode });
      if (a.image_url) {
        const buf = await fetchImage(a.image_url);
        if (buf) db.prepare('UPDATE products SET image_path = ?, image_source = ? WHERE id = ?').run(await saveImage(buf, `p${id}`), 'url', id);
      } else enqueueEnrich(id);
      if (a.qty) adjustStock({ productId: id, locationId: loc ?? null, delta: a.qty, bestBefore: a.best_before ?? null, reason: 'assistant', actor: actorName });
      return text({ created: true, id });
    },
  );

  s.registerTool(
    'record_purchase',
    {
      title: 'Record purchase / receipt',
      description:
        'Records bought or found items (e.g. from a receipt photo you have read, or from a photo of the freezer). ' +
        'Default: ends up as an import for review in the app (substitutes etc. can be corrected there). apply=true books it immediately.',
      inputSchema: {
        title: z.string().describe('e.g. "Aldi shopping 10 Oct" or "Freezer stocktake"'),
        shop: z.string().optional(),
        kind: z.enum(['receipt', 'shelf']).default('receipt'),
        location: z.string().optional().describe('Target location for all items (e.g. for a stocktake)'),
        items: z.array(z.object({ name: z.string(), brand: z.string().optional(), qty: z.number().default(1), price: z.number().optional(), deposit: z.boolean().optional(), best_before: z.string().optional() })).min(1),
        apply: z.boolean().default(false),
      },
      annotations: RW,
    },
    async (a) => {
      const loc = a.location ? (db.prepare(`SELECT id FROM locations WHERE lower(name) LIKE lower(?) ESCAPE '\\'`).get(`%${likeEsc(a.location)}%`) as { id: number } | undefined)?.id : undefined;
      const imp = linesToImport(a.kind === 'shelf' ? 'shelf' : 'mcp', a.title, a.items, { shop: a.shop ?? null });
      if (loc) imp.lines.forEach((l) => ((l as any).locationId = loc));
      const out = createImport(imp, { actor: actorName });
      if (out.duplicate || out.merged) return text({ import_id: out.id, note: out.merged ? 'Matched with an open order.' : 'This receipt has already been imported.' });
      const lines = db.prepare(`SELECT name, qty, action, product_id, confidence FROM import_lines WHERE import_id = ?`).all(out.id) as any[];
      if (a.apply) {
        const st = db.prepare('SELECT status FROM imports WHERE id = ?').get(out.id) as { status: string };
        const res = st.status === 'review' ? applyImport(out.id, actorName) : { applied: 0 };
        return text({ import_id: out.id, booked: true, ...res });
      }
      return text({
        import_id: out.id,
        status: 'awaiting review in the app',
        review_url: `${config.baseUrl}/import/${out.id}`,
        recognized: lines.filter((l) => l.action === 'add').length,
        new_products: lines.filter((l) => l.action === 'new').map((l) => l.name),
      });
    },
  );

  s.registerTool(
    'get_shopping_list',
    { title: 'Shopping list', description: 'Open items on the shopping list.', inputSchema: {}, annotations: RO },
    async () => text(db.prepare(`SELECT id, text, qty, note, added_by FROM shopping_items WHERE checked_at IS NULL ORDER BY created_at`).all()),
  );

  s.registerTool(
    'add_to_shopping_list',
    { title: 'Add to shopping list', description: 'Adds one or more items to the shopping list.', inputSchema: { items: z.array(z.string()).min(1) }, annotations: RW },
    async ({ items }) => {
      const out = items.map((t) => {
        const m = matchProduct(t);
        return { text: t, ...addToShopping({ productId: m && m.score >= 0.8 ? m.productId : null, text: t, source: 'assistant', addedBy: actorName }) };
      });
      return text(out);
    },
  );

  s.registerTool(
    'check_shopping_item',
    {
      title: 'Check off',
      description: 'Checks off an item on the shopping list. to_stock=true also books it into stock.',
      inputSchema: { item: z.union([z.string(), z.number()]), to_stock: z.boolean().default(false) },
      annotations: RW,
    },
    async ({ item, to_stock }) => {
      const row = (typeof item === 'number'
        ? db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(item)
        : db.prepare(`SELECT * FROM shopping_items WHERE checked_at IS NULL AND lower(text) LIKE lower(?) ESCAPE '\\' LIMIT 1`).get(`%${likeEsc(item)}%`)) as any;
      if (!row) return text({ error: 'not on the list' });
      if (row.checked_at) return text({ ok: true, already_checked: row.text });
      db.prepare(`UPDATE shopping_items SET checked_at = datetime('now'), checked_by = ? WHERE id = ?`).run(actorName, row.id);
      if (to_stock && row.product_id) adjustStock({ productId: row.product_id, delta: row.qty ?? 1, reason: 'purchase', actor: actorName });
      emit('shopping');
      return text({ ok: true, checked: row.text });
    },
  );

  s.registerTool(
    'suggest_meals',
    {
      title: 'What shall we cook?',
      description: 'Suggests recipes – based on what is in the house, what expires soon, favourites and how long ago they were cooked.',
      inputSchema: { thermomix: z.boolean().optional(), max_missing: z.number().optional().describe('at most this many missing ingredients'), limit: z.number().default(5) },
      annotations: RO,
    },
    async ({ thermomix, max_missing, limit }) =>
      text(
        suggest({ thermomix: thermomix ?? null, maxMissing: max_missing, limit }).map((x) => ({
          id: x.recipe.id,
          title: x.recipe.title,
          thermomix: x.recipe.thermomix,
          time_min: x.recipe.time_min,
          have: `${x.have}/${x.need}`,
          missing: x.missing,
          why: x.reasons,
        })),
      ),
  );

  s.registerTool(
    'list_recipes',
    { title: 'Recipes', description: 'Lists recipes (optional search, Thermomix only, favourites only).', inputSchema: { query: z.string().optional(), thermomix: z.boolean().optional(), favorites: z.boolean().optional() }, annotations: RO },
    async ({ query, thermomix, favorites }) => {
      let list = listRecipes();
      if (query) list = list.filter((r) => norm(`${r.title} ${r.tags.join(' ')}`).includes(norm(query)));
      if (thermomix !== undefined) list = list.filter((r) => r.thermomix === thermomix);
      if (favorites) list = list.filter((r) => r.favorite);
      return text(list.map((r) => ({ id: r.id, title: r.title, thermomix: r.thermomix, favorite: r.favorite, last_cooked: r.last_cooked, times_cooked: r.cook_count, tags: r.tags })));
    },
  );

  s.registerTool(
    'get_recipe',
    { title: 'Read recipe', description: 'Full recipe with ingredients, steps (incl. Thermomix settings) and cooking history.', inputSchema: { recipe: z.union([z.string(), z.number()]) }, annotations: RO },
    async ({ recipe }) => {
      let id = Number(recipe);
      if (!id) {
        const r = listRecipes().find((x) => norm(x.title).includes(norm(String(recipe))));
        id = r?.id ?? 0;
      }
      const r = id ? getRecipe(id) : null;
      return text(r ?? { error: 'not found' });
    },
  );

  s.registerTool(
    'save_recipe',
    {
      title: 'Save recipe',
      description:
        'Saves a recipe (e.g. from a photo of a HelloFresh card you have read). Thermomix steps with tm {time, temp, speed}. pantry=true for basic ingredients (salt, oil …).',
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        servings: z.number().optional(),
        time_min: z.number().optional(),
        thermomix: z.boolean().default(false),
        source_type: z.enum(['own', 'hellofresh', 'cookidoo', 'url', 'photo', 'family']).default('photo'),
        source_url: z.string().optional(),
        tags: z.array(z.string()).default([]),
        favorite: z.boolean().default(false),
        ingredients: z.array(z.object({ text: z.string(), qty: z.number().optional(), unit: z.string().optional(), pantry: z.boolean().optional(), optional: z.boolean().optional() })),
        steps: z.array(z.object({ text: z.string(), tm: z.object({ time: z.string().optional(), temp: z.string().optional(), speed: z.string().optional() }).optional() })),
        image_url: z.string().url().optional(),
      },
      annotations: RW,
    },
    async (a) => {
      const id = saveRecipe(a as any);
      if (a.image_url) {
        const buf = await fetchImage(a.image_url);
        if (buf) db.prepare('UPDATE recipes SET image_path = ? WHERE id = ?').run(await saveImage(buf, `r${id}`), id);
      }
      return text({ id, url: `${config.baseUrl}/rezepte/${id}` });
    },
  );

  s.registerTool(
    'log_cooked',
    {
      title: 'Cooked',
      description: 'Records that a recipe was cooked (for the cooking history). Optionally deducts used-up products.',
      inputSchema: { recipe: z.union([z.string(), z.number()]), rating: z.number().min(1).max(5).optional(), used_up: z.array(z.string()).optional() },
      annotations: RW,
    },
    async ({ recipe, rating, used_up }) => {
      let id = Number(recipe);
      if (!id) id = listRecipes().find((x) => norm(x.title).includes(norm(String(recipe))))?.id ?? 0;
      if (!id) return text({ error: 'Recipe not found' });
      logCooked(id, actorName, rating ?? null);
      const used: string[] = [];
      for (const u of used_up ?? []) {
        const p = findProduct(u);
        if (p) {
          adjustStock({ productId: p.id, delta: -1, reason: 'cook', actor: actorName });
          used.push(p.name);
        }
      }
      return text({ ok: true, consumed: used });
    },
  );

  s.registerTool(
    'get_meal_plan',
    { title: 'Meal plan', description: 'Planned meals for the next days (incl. the Cookidoo week plan, if connected).', inputSchema: { days: z.number().min(1).max(28).default(7) }, annotations: RO },
    async ({ days }) => {
      const d = weekDays(localDay(0), days);
      return text(getPlan(d[0], d[d.length - 1]).map((e) => ({ id: e.id, day: e.day, slot: e.slot, title: e.title, recipe_id: e.recipe_id, source: e.source, cooked: Boolean(e.cooked) })));
    },
  );

  s.registerTool(
    'plan_meal',
    {
      title: 'Plan a meal',
      description: 'Plans a recipe (or a free title like "Order pizza") for a day. slot: "mittag" = lunch, "abend" = dinner.',
      inputSchema: { day: z.string().describe('YYYY-MM-DD'), recipe: z.union([z.string(), z.number()]).optional(), title: z.string().optional(), slot: z.enum(['mittag', 'abend']).default('abend') },
      annotations: RW,
    },
    async ({ day, recipe, title, slot }) => {
      let rid: number | null = null;
      if (typeof recipe === 'number') rid = recipe;
      else if (recipe) rid = listRecipes().find((x) => norm(x.title).includes(norm(recipe)))?.id ?? null;
      if (recipe && !rid && !title) return text({ error: 'Recipe not found', hint: 'use list_recipes or set title' });
      return text({ id: addPlan({ day, recipe_id: rid, title, slot }) });
    },
  );

  s.registerTool(
    'move_meal',
    {
      title: 'Move meal',
      description: 'Moves a planned meal to another day (id from get_meal_plan) or – with shift_rest_from – the whole remaining plan from that day by N days, e.g. when eating out spontaneously. With remove=true the entry is deleted.',
      inputSchema: { id: z.number().optional(), day: z.string().optional().describe('Target day YYYY-MM-DD'), shift_rest_from: z.string().optional().describe('YYYY-MM-DD: move everything open from here on'), by: z.number().int().min(-7).max(7).default(1), remove: z.boolean().default(false) },
      annotations: RW,
    },
    async ({ id, day, shift_rest_from, by, remove }) => {
      if (shift_rest_from) return text(shiftPlan(shift_rest_from, by));
      if (!id) return text({ error: 'provide id or shift_rest_from' });
      if (remove) {
        db.prepare('DELETE FROM meal_plan WHERE id = ?').run(id);
        emit('recipes');
        return text({ ok: true });
      }
      if (!day || !/^\d{4}-\d\d-\d\d$/.test(day)) return text({ error: 'provide day as YYYY-MM-DD' });
      const r = db.prepare('UPDATE meal_plan SET day = ? WHERE id = ?').run(day, id);
      emit('recipes');
      return text({ ok: r.changes > 0 });
    },
  );

  s.registerTool(
    'fill_week',
    { title: 'Fill the week', description: 'Fills free evenings of the next 7 days with suitable recipes from what is in stock.', inputSchema: {}, annotations: RW },
    async () => text(autofill(localDay(0), 7)),
  );

  s.registerTool(
    'week_shopping',
    { title: 'Shopping for the week', description: 'Puts all missing ingredients of the meals planned for the next 7 days on the shopping list.', inputSchema: {}, annotations: RW },
    async () => {
      const d = weekDays(localDay(0), 7);
      return text(planShopping(d[0], d[d.length - 1], actorName));
    },
  );

  s.registerTool(
    'where_is',
    {
      title: 'Where is what?',
      description: 'Finds where something is kept in the house: location (cellar, bathroom …) and exact spot ("shelf on the left, top compartment"). Also works for things that are not counted (thermometer, tools, spare keys).',
      inputSchema: { q: z.string().describe('What to look for') },
      annotations: RO,
    },
    async ({ q }) => {
      const hits = findThings(q).slice(0, 10);
      return text(hits.length ? hits.map((h) => ({ id: h.id, name: h.name, where: h.places.map((p) => p.name).join(', '), spot: h.spot, location_hint: h.places[0]?.hint ?? null, in_stock: h.in_stock })) : { found: false, hint: 'Not recorded – add it with set_place.' });
    },
  );

  s.registerTool(
    'set_place',
    {
      title: 'Remember spot',
      description: 'Remembers where something is kept. Creates the item if it does not exist yet (then untracked, e.g. "thermometer").',
      inputSchema: { product: z.union([z.string(), z.number()]), location: z.string().optional().describe('Name of the location, e.g. Bathroom'), spot: z.string().max(120).optional().describe('Exact spot, e.g. "mirror cabinet, middle shelf"') },
      annotations: RW,
    },
    async ({ product, location, spot }) => {
      let p = findProduct(product);
      const loc = location ? (db.prepare('SELECT id, name FROM locations').all() as { id: number; name: string }[]).find((l) => norm(l.name).includes(norm(location)) || norm(location).includes(norm(l.name))) : undefined;
      if (location && !loc) return text({ error: `There is no location "${location}"`, hint: 'list_locations' });
      if (!p) {
        if (typeof product === 'number') return text({ error: 'Product not found' });
        const id = createProduct({ name: product, trackMode: 'none', locationId: loc?.id ?? null, spot: spot ?? null });
        return text({ created: true, id });
      }
      db.prepare('UPDATE products SET spot = COALESCE(?, spot), default_location_id = COALESCE(?, default_location_id), updated_at = datetime(\'now\') WHERE id = ?').run(spot ?? null, loc?.id ?? null, p.id);
      emit('products');
      return text({ ok: true, id: p.id });
    },
  );

  s.registerTool(
    'list_locations',
    { title: 'Locations', description: 'Storage locations in the house with number of products.', inputSchema: {}, annotations: RO },
    async () => text(overview().locations.map((l: any) => ({ id: l.id, name: l.name, products: l.products, low: l.low, expiring: l.expiring }))),
  );

  s.registerTool(
    'product_details',
    { title: 'Product details', description: 'Details of a product incl. history of recent changes.', inputSchema: { product: z.union([z.string(), z.number()]) }, annotations: RO },
    async ({ product }) => {
      const p = findProduct(product);
      if (!p) return text({ error: 'not found', candidates: candidates(String(product)) });
      const hist = db.prepare('SELECT delta, reason, actor, created_at FROM movements WHERE product_id = ? ORDER BY id DESC LIMIT 15').all(p.id);
      const v = productView(p);
      return text({ ...compact(v as any), history: hist });
    },
  );

  register_data(s, actorName);
  register_party(s, actorName);
  register_fresh(s, actorName);
  register_shop(s, actorName);
  register_home(s, actorName);
  register_kiosk(s, actorName);
  register_kids(s, actorName);
  register_onboard(s, actorName);
  register_retail(s, actorName);
  register_ha(s, actorName);
  register_channels(s, actorName);
  register_intl(s, actorName);
  register_cook2(s, actorName);
  register_auth(s, actorName);
  register_spend2(s, actorName);
  register_print(s, actorName);
  return s;
}

/** Express handler: stateless Streamable HTTP. Auth via Bearer token or secret path segment. */
export async function handleMcp(req: Request, res: Response) {
  let actorName: string | null = null;
  const secret = req.params.secret as string | undefined;
  if (secret) {
    if (config.mcpPathSecret && safeEqual(secret, config.mcpPathSecret)) actorName = 'Assistant';
    else {
      // tokens in URLs end up in logs — only MCP-scoped tokens are accepted here
      const a = actorFromBearer(secret);
      if (a && a.scope === 'mcp') actorName = `${a.name}`;
    }
  } else {
    const auth = req.headers.authorization;
    const a = auth?.startsWith('Bearer ') ? actorFromBearer(auth.slice(7).trim()) : null;
    if (a && (a.scope === 'full' || a.scope === 'mcp')) actorName = a.name;
  }
  if (!actorName) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
    return;
  }
  const server = buildMcpServer(actorName);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
