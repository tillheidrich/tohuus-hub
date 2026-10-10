import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db.js';
import { actorFromBearer, safeEqual } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
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
    amount: p.track_mode === 'none' ? 'nicht gezählt' : fmtQty(p, p.total),
    status: p.status,
    min_qty: p.min_qty || undefined,
    best_before: p.nextExpiry ?? undefined,
    where: p.stock.filter((s) => s.qty > 0).map((s) => `${lname.get(s.location_id)}: ${fmtQty(p, s.qty)}${s.best_before ? ` (MHD ${s.best_before})` : ''}`),
  };
}

export function buildMcpServer(actorName: string) {
  const s = new McpServer(
    { name: 'stockwerk', version: '0.1.0' },
    {
      instructions:
        'Stockwerk ist der Haushaltsbestand einer Familie (Vorräte, Gefrierschrank, Keller, Haushaltswaren), dazu Einkaufsliste, Rezepte und Kochverlauf. ' +
        'Antworte auf Deutsch. Fotos (Kassenbon, Gefrierschrank, Rezeptkarte) liest DU selbst und übergibst die erkannten Daten strukturiert: ' +
        'Einkäufe/Bons → record_purchase (standardmäßig zur Prüfung in der App), Rezepte → save_recipe. ' +
        'Vor Änderungen am Bestand bei unklaren Produktnamen erst search_stock verwenden.',
    },
  );

  s.registerTool(
    'get_overview',
    { title: 'Überblick', description: 'Was ist knapp, leer oder läuft bald ab, was steht auf der Einkaufsliste, was könnte man heute kochen.', inputSchema: {}, annotations: RO },
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
      title: 'Bestand durchsuchen',
      description: 'Sucht Produkte im Bestand. Ohne query: alles (optional gefiltert nach Ort oder Status). Liefert Menge, Ort und MHD.',
      inputSchema: {
        query: z.string().optional().describe('Freitext, z. B. "Eis", "Paketband", "Nudeln"'),
        location: z.string().optional().describe('Ort, z. B. "Gefrierschrank", "Keller"'),
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
      title: 'Bestand ändern',
      description:
        'Ändert den Bestand eines Produkts: delta (+2 / -1) oder set (absolute Menge). Bei Füllstand-Produkten (Obst/Gemüse) set 0–3 = leer/knapp/halb/voll.',
      inputSchema: {
        product: z.union([z.string(), z.number()]).describe('Produktname oder ID'),
        delta: z.number().optional(),
        set: z.number().optional(),
        location: z.string().optional(),
        best_before: z.string().optional().describe('YYYY-MM-DD, nur beim Hinzufügen'),
      },
      annotations: RW,
    },
    async ({ product, delta, set, location, best_before }) => {
      const p = findProduct(product);
      if (!p) return text({ error: 'Produkt nicht eindeutig gefunden', candidates: candidates(String(product)), hint: 'create_product verwenden, falls neu.' });
      const loc = location ? (db.prepare(`SELECT id FROM locations WHERE lower(name) LIKE lower(?) ESCAPE '\\'`).get(`%${likeEsc(location)}%`) as { id: number } | undefined)?.id : undefined;
      const out = adjustStock({ productId: p.id, locationId: loc ?? null, delta, set, bestBefore: best_before ?? null, reason: 'assistant', actor: actorName });
      return text({ product: p.name, now: fmtQty(p, out.total), status: out.status });
    },
  );

  s.registerTool(
    'mark_used_up',
    { title: 'Aufgebraucht', description: 'Setzt ein Produkt auf 0 und schreibt es auf die Einkaufsliste.', inputSchema: { product: z.union([z.string(), z.number()]) }, annotations: RW },
    async ({ product }) => {
      const p = findProduct(product);
      if (!p) return text({ error: 'nicht gefunden', candidates: candidates(String(product)) });
      markUsedUp(p.id, actorName);
      return text({ ok: true, product: p.name, on_shopping_list: true });
    },
  );

  s.registerTool(
    'create_product',
    {
      title: 'Produkt anlegen',
      description: 'Legt ein neues Produkt an (optional mit Startmenge, Ort, Mindestmenge, Barcode, Bild-URL). Bild wird sonst automatisch über Open Food Facts gesucht.',
      inputSchema: {
        name: z.string(),
        brand: z.string().optional(),
        size: z.string().optional(),
        location: z.string().optional(),
        qty: z.number().optional(),
        min_qty: z.number().optional().describe('ab dieser Menge gilt es als knapp → Einkaufsliste'),
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
      title: 'Einkauf / Bon erfassen',
      description:
        'Erfasst gekaufte oder gefundene Artikel (z. B. von einem Bon-Foto, das du gelesen hast, oder aus einem Foto vom Gefrierschrank). ' +
        'Standard: landet als Import zur Prüfung in der App (Ersatzartikel etc. können dort korrigiert werden). apply=true bucht sofort.',
      inputSchema: {
        title: z.string().describe('z. B. "Aldi-Einkauf 10.10." oder "Inventur Gefrierschrank"'),
        shop: z.string().optional(),
        kind: z.enum(['receipt', 'shelf']).default('receipt'),
        location: z.string().optional().describe('Zielort für alle Artikel (z. B. bei Inventur)'),
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
      if (out.duplicate || out.merged) return text({ import_id: out.id, note: out.merged ? 'Mit einer offenen Bestellung abgeglichen.' : 'Dieser Beleg ist schon importiert.' });
      const lines = db.prepare(`SELECT name, qty, action, product_id, confidence FROM import_lines WHERE import_id = ?`).all(out.id) as any[];
      if (a.apply) {
        const st = db.prepare('SELECT status FROM imports WHERE id = ?').get(out.id) as { status: string };
        const res = st.status === 'review' ? applyImport(out.id, actorName) : { applied: 0 };
        return text({ import_id: out.id, booked: true, ...res });
      }
      return text({
        import_id: out.id,
        status: 'zur Prüfung in der App',
        review_url: `${config.baseUrl}/import/${out.id}`,
        recognized: lines.filter((l) => l.action === 'add').length,
        new_products: lines.filter((l) => l.action === 'new').map((l) => l.name),
      });
    },
  );

  s.registerTool(
    'get_shopping_list',
    { title: 'Einkaufsliste', description: 'Offene Einträge der Einkaufsliste.', inputSchema: {}, annotations: RO },
    async () => text(db.prepare(`SELECT id, text, qty, note, added_by FROM shopping_items WHERE checked_at IS NULL ORDER BY created_at`).all()),
  );

  s.registerTool(
    'add_to_shopping_list',
    { title: 'Auf die Einkaufsliste', description: 'Setzt einen oder mehrere Einträge auf die Einkaufsliste.', inputSchema: { items: z.array(z.string()).min(1) }, annotations: RW },
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
      title: 'Abhaken',
      description: 'Hakt einen Eintrag der Einkaufsliste ab. to_stock=true bucht ihn zusätzlich in den Bestand.',
      inputSchema: { item: z.union([z.string(), z.number()]), to_stock: z.boolean().default(false) },
      annotations: RW,
    },
    async ({ item, to_stock }) => {
      const row = (typeof item === 'number'
        ? db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(item)
        : db.prepare(`SELECT * FROM shopping_items WHERE checked_at IS NULL AND lower(text) LIKE lower(?) ESCAPE '\\' LIMIT 1`).get(`%${likeEsc(item)}%`)) as any;
      if (!row) return text({ error: 'nicht auf der Liste' });
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
      title: 'Was kochen wir?',
      description: 'Schlägt Rezepte vor – nach dem, was da ist, was bald abläuft, Favoriten und wie lange es her ist.',
      inputSchema: { thermomix: z.boolean().optional(), max_missing: z.number().optional().describe('höchstens so viele fehlende Zutaten'), limit: z.number().default(5) },
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
    { title: 'Rezepte', description: 'Listet Rezepte (optional Suche, nur Thermomix, nur Favoriten).', inputSchema: { query: z.string().optional(), thermomix: z.boolean().optional(), favorites: z.boolean().optional() }, annotations: RO },
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
    { title: 'Rezept lesen', description: 'Komplettes Rezept mit Zutaten, Schritten (inkl. Thermomix-Einstellungen) und Kochverlauf.', inputSchema: { recipe: z.union([z.string(), z.number()]) }, annotations: RO },
    async ({ recipe }) => {
      let id = Number(recipe);
      if (!id) {
        const r = listRecipes().find((x) => norm(x.title).includes(norm(String(recipe))));
        id = r?.id ?? 0;
      }
      const r = id ? getRecipe(id) : null;
      return text(r ?? { error: 'nicht gefunden' });
    },
  );

  s.registerTool(
    'save_recipe',
    {
      title: 'Rezept speichern',
      description:
        'Speichert ein Rezept (z. B. von einem Foto einer HelloFresh-Karte, das du gelesen hast). Thermomix-Schritte mit tm {time, temp, speed}. pantry=true für Basiszutaten (Salz, Öl …).',
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
      title: 'Gekocht',
      description: 'Trägt ein, dass ein Rezept gekocht wurde (für den Kochverlauf). Optional verbrauchte Produkte abziehen.',
      inputSchema: { recipe: z.union([z.string(), z.number()]), rating: z.number().min(1).max(5).optional(), used_up: z.array(z.string()).optional() },
      annotations: RW,
    },
    async ({ recipe, rating, used_up }) => {
      let id = Number(recipe);
      if (!id) id = listRecipes().find((x) => norm(x.title).includes(norm(String(recipe))))?.id ?? 0;
      if (!id) return text({ error: 'Rezept nicht gefunden' });
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
    'list_locations',
    { title: 'Orte', description: 'Lagerorte im Haus mit Anzahl Produkte.', inputSchema: {}, annotations: RO },
    async () => text(overview().locations.map((l: any) => ({ id: l.id, name: l.name, products: l.products, low: l.low, expiring: l.expiring }))),
  );

  s.registerTool(
    'product_details',
    { title: 'Produktdetails', description: 'Details zu einem Produkt inkl. Verlauf der letzten Änderungen.', inputSchema: { product: z.union([z.string(), z.number()]) }, annotations: RO },
    async ({ product }) => {
      const p = findProduct(product);
      if (!p) return text({ error: 'nicht gefunden', candidates: candidates(String(product)) });
      const hist = db.prepare('SELECT delta, reason, actor, created_at FROM movements WHERE product_id = ? ORDER BY id DESC LIMIT 15').all(p.id);
      const v = productView(p);
      return text({ ...compact(v as any), history: hist });
    },
  );

  return s;
}

/** Express handler: stateless Streamable HTTP. Auth via Bearer token or secret path segment. */
export async function handleMcp(req: Request, res: Response) {
  let actorName: string | null = null;
  const secret = req.params.secret as string | undefined;
  if (secret) {
    if (config.mcpPathSecret && safeEqual(secret, config.mcpPathSecret)) actorName = 'Assistent';
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
