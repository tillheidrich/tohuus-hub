import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config, smtpEnabled, visionEnabled } from '../config.js';
import { appearanceFor } from '../lib/appearance.js';
import { homeSetup } from '../lib/places.js';
import { r as placesRoutes } from './places.js';
import { brand, chooseBrand, db, defaultBrand, getSetting, lang, setSetting } from '../db.js';
import { LANG_CODES } from '../languages.js';
import { regionInfo } from '../lib/region.js';
import {
  SESSION_COOKIE,
  createApiToken,
  destroySession,
  hashPassword,
  NAME_MAX,
  PASSWORD_MIN,
  requireAdmin,
  sha256,
  requireAuth,
  resolveActor,
} from '../lib/auth.js';
import { addClient, emit } from '../lib/bus.js';
import {
  addToShopping,
  adjustStock,
  createProduct,
  getProduct,
  learnAlias,
  listProducts,
  markUsedUp,
  moveStock,
  matchProduct,
  productView,
} from '../lib/catalog.js';
import { enqueueEnrich, enrichOne } from '../lib/enrich.js';
import { deleteImage, fetchImage, saveImage } from '../lib/images.js';
import { DEFAULT_NOTIFY, notify, notifySettings } from '../lib/notify.js';
import { lookupBarcode, searchProducts } from '../lib/off.js';
import { overview } from '../lib/overview.js';
import { guestSafeOverview } from '../lib/people-policy.js';
import { haSettings } from '../lib/plan.js';
import { findThings } from '../lib/find.js';
import { buildExport, showNamesOnLogin } from '../lib/data.js';
import { t } from '../i18n.js';
import { setDateKind } from '../lib/retail.js';
import { applyShareView, notPrivate, realProductId } from '../lib/share-core.js';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 8, fields: 20 } });
export const r = Router();

const actorName = (req: any) => req.actor?.name ?? 'unbekannt';
const id = (v: unknown) => Number(v);

// ---------------------------------------------------------------- auth

// password sign-in (with optional two-step code) lives in routes/auth.ts with the other sign-in methods

r.post('/auth/logout', (req, res) => {
  const t = req.cookies?.[SESSION_COOKIE];
  if (t) destroySession(t);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

r.get('/auth/users', (_req, res) => {
  // names for the login picker (household-internal app; no emails exposed) – households can hide them
  if (!showNamesOnLogin()) return void res.json([]);
  res.json(db.prepare('SELECT name, color FROM users ORDER BY id').all());
});

r.get('/me', (req, res) => {
  const actor = resolveActor(req);
  if (!actor) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  res.json({
    actor,
    household: getSetting('household.name', t('Our home')),
    brand: brand(),
    language: lang(),
    region: regionInfo(),
    features: { vision: visionEnabled(), email: smtpEnabled() },
    appearance: appearanceFor(actor.kind === 'user' ? actor.userId : null),
    // household form and home preset (area: home) – the UI adapts its defaults and wording to it
    home: homeSetup(),
    version: process.env.npm_package_version ?? '0.1.0',
  });
});

r.use(requireAuth);

r.get('/events', (req, res) => addClient(res));

// ---------------------------------------------------------------- overview

r.get('/overview', (req, res) => res.json(guestSafeOverview(req.actor, overview())));

// ---------------------------------------------------------------- where is what

r.get('/find', (req, res) => res.json(findThings(String(req.query.q ?? ''))));

// ---------------------------------------------------------------- locations & categories

// /locations, /home/setup: routes/places.ts (area: home: tree, climate, archive, order) – mounted here so the
// locations API stays part of the core router
r.use(placesRoutes);

r.get('/categories', (_req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY sort, id').all()));
r.post('/categories', requireAdmin, (req, res) => {
  const b = z
    .object({ name: z.string().min(1), icon: z.string().default('tag'), default_location_id: z.number().nullable().optional(), track_mode: z.enum(['count', 'level', 'none']).default('count') })
    .parse(req.body);
  const info = db.prepare('INSERT INTO categories (name, icon, default_location_id, track_mode, sort) VALUES (?, ?, ?, ?, 99)').run(b.name, b.icon, b.default_location_id ?? null, b.track_mode);
  res.json({ id: Number(info.lastInsertRowid) });
});
r.patch('/categories/:id', requireAdmin, (req, res) => {
  const b = z
    .object({ name: z.string().optional(), icon: z.string().optional(), default_location_id: z.number().nullable().optional(), track_mode: z.enum(['count', 'level', 'none']).optional() })
    .parse(req.body);
  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(id(req.params.id)) as any;
  if (!c) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  db.prepare('UPDATE categories SET name=?, icon=?, default_location_id=?, track_mode=? WHERE id=?').run(
    b.name ?? c.name, b.icon ?? c.icon, b.default_location_id === undefined ? c.default_location_id : b.default_location_id, b.track_mode ?? c.track_mode, c.id,
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------- products

r.get('/products', (req, res) => res.json(listProducts({ includeArchived: req.query.archived === '1' })));

r.get('/products/:id', (req, res) => {
  const p = getProduct(id(req.params.id));
  if (!p) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const history = db.prepare('SELECT * FROM movements WHERE product_id = ? ORDER BY id DESC LIMIT 30').all(p.id);
  const aliases = db.prepare('SELECT alias, source, hits FROM product_aliases WHERE product_id = ? ORDER BY hits DESC').all(p.id);
  // average consumption per week over the last 90 days
  const used = db
    .prepare(`SELECT -SUM(delta) u FROM movements WHERE product_id = ? AND delta < 0 AND reason IN ('consume','order','cook','manual') AND created_at > datetime('now','-90 days')`)
    .get(p.id) as { u: number | null };
  res.json({ ...productView(p), history, aliases, perWeek: used.u ? Math.round((used.u / 13) * 10) / 10 : null });
});

const productSchema = z.object({
  name: z.string().min(1),
  brand: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  category_id: z.number().nullable().optional(),
  unit: z.string().optional(),
  track_mode: z.enum(['count', 'level', 'none']).optional(),
  default_location_id: z.number().nullable().optional(),
  min_qty: z.number().min(0).optional(),
  target_qty: z.number().min(0).optional(),
  shelf_days: z.number().nullable().optional(),
  is_staple: z.boolean().optional(),
  orderable: z.boolean().optional(),
  order_group: z.string().nullable().optional(),
  order_options: z.array(z.object({ group: z.string(), choices: z.array(z.string()), multi: z.boolean().default(false), required: z.boolean().optional(), default: z.array(z.string()).optional() })).optional(),
  notes: z.string().nullable().optional(),
  spot: z.string().max(120).nullable().optional(),
  archived: z.boolean().optional(),
  code: z.string().nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  initial_qty: z.number().optional(),
  initial_location_id: z.number().nullable().optional(),
  best_before: z.string().nullable().optional(),
  /** best-before (default) or use-by; null = automatic by name (retail) */
  date_kind: z.enum(['best_before', 'use_by']).nullable().optional(),
});

r.post('/products', async (req, res) => {
  const b = productSchema.parse(req.body);
  const pid = createProduct({
    name: b.name,
    brand: b.brand,
    size: b.size,
    categoryId: b.category_id ?? null,
    unit: b.unit,
    trackMode: b.track_mode,
    locationId: b.default_location_id ?? null,
    minQty: b.min_qty,
    isStaple: b.is_staple,
    orderable: b.orderable,
    orderGroup: b.order_group,
    orderOptions: b.order_options,
    notes: b.notes,
    spot: b.spot,
    offCode: b.code ?? null,
    shelfDays: b.shelf_days ?? null,
  });
  if (b.date_kind !== undefined) setDateKind(pid, b.date_kind);
  if (b.image_url) {
    const buf = await fetchImage(b.image_url);
    if (buf) {
      const img = await saveImage(buf, `p${pid}`);
      const credit = /openfoodfacts|openproductsfacts/.test(b.image_url) ? `Open Food Facts · ${b.code ?? ''} · CC BY-SA` : null;
      db.prepare(`UPDATE products SET image_path = ?, image_source = ?, image_credit = ? WHERE id = ?`).run(img, credit ? 'off' : 'url', credit, pid);
    }
  } else enqueueEnrich(pid);
  if (b.initial_qty && b.initial_qty > 0)
    adjustStock({ productId: pid, locationId: b.initial_location_id ?? null, delta: b.initial_qty, bestBefore: b.best_before ?? null, reason: 'inventory', actor: actorName(req) });
  emit('products', 'stock');
  res.json({ id: pid });
});

r.patch('/products/:id', (req, res) => {
  const p = getProduct(id(req.params.id));
  if (!p) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const b = productSchema.partial().parse(req.body);
  const next = {
    name: b.name ?? p.name,
    brand: b.brand === undefined ? p.brand : b.brand,
    size: b.size === undefined ? p.size : b.size,
    category_id: b.category_id === undefined ? p.category_id : b.category_id,
    unit: b.unit ?? p.unit,
    track_mode: b.track_mode ?? p.track_mode,
    default_location_id: b.default_location_id === undefined ? p.default_location_id : b.default_location_id,
    min_qty: b.min_qty ?? p.min_qty,
    target_qty: b.target_qty ?? p.target_qty,
    shelf_days: b.shelf_days === undefined ? p.shelf_days : b.shelf_days,
    is_staple: b.is_staple === undefined ? p.is_staple : b.is_staple ? 1 : 0,
    orderable: b.orderable === undefined ? p.orderable : b.orderable ? 1 : 0,
    order_group: b.order_group === undefined ? p.order_group : b.order_group,
    order_options: b.order_options === undefined ? p.order_options : JSON.stringify(b.order_options),
    notes: b.notes === undefined ? p.notes : b.notes,
    spot: b.spot === undefined ? p.spot : b.spot?.trim() || null,
    archived: b.archived === undefined ? p.archived : b.archived ? 1 : 0,
  };
  db.prepare(
    `UPDATE products SET name=@name, brand=@brand, size=@size, category_id=@category_id, unit=@unit, track_mode=@track_mode,
     default_location_id=@default_location_id, min_qty=@min_qty, target_qty=@target_qty, shelf_days=@shelf_days, is_staple=@is_staple,
     orderable=@orderable, order_group=@order_group, order_options=@order_options, notes=@notes, spot=@spot, archived=@archived,
     updated_at=datetime('now') WHERE id=${p.id}`,
  ).run(next);
  if (b.code) db.prepare('INSERT OR REPLACE INTO product_codes (code, product_id) VALUES (?, ?)').run(b.code, p.id);
  if (b.date_kind !== undefined) setDateKind(p.id, b.date_kind);
  emit('products', 'stock');
  res.json({ ok: true });
});

r.delete('/products/:id', requireAdmin, (req, res) => {
  const p = getProduct(id(req.params.id));
  if (p) {
    deleteImage(p.image_path);
    db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
  }
  emit('products', 'stock', 'shopping');
  res.json({ ok: true });
});

r.post('/products/:id/image', upload.single('image'), async (req, res) => {
  const p = getProduct(id(req.params.id));
  if (!p) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  let buf: Buffer | null = req.file?.buffer ?? null;
  let credit: string | null = null;
  let source = 'upload';
  if (!buf && req.body?.url) {
    buf = await fetchImage(String(req.body.url));
    source = /openfoodfacts|openproductsfacts/.test(String(req.body.url)) ? 'off' : 'url';
    if (source === 'off') credit = `Open Food Facts · ${req.body.code ?? ''} · CC BY-SA`;
  }
  if (!buf) {
    res.status(400).json({ error: t('No image received') });
    return;
  }
  const img = await saveImage(buf, `p${p.id}`);
  deleteImage(p.image_path);
  db.prepare(`UPDATE products SET image_path = ?, image_source = ?, image_credit = ?, updated_at = datetime('now') WHERE id = ?`).run(img, source, credit, p.id);
  if (req.body?.code) db.prepare('INSERT OR IGNORE INTO product_codes (code, product_id) VALUES (?, ?)').run(String(req.body.code), p.id);
  emit('products');
  res.json({ image_path: img });
});

r.post('/products/:id/enrich', async (req, res) => {
  const ok = await enrichOne(id(req.params.id), true);
  res.json({ ok });
});

r.post('/products/:id/alias', (req, res) => {
  const { alias } = z.object({ alias: z.string().min(2) }).parse(req.body);
  learnAlias(alias, id(req.params.id), 'manual');
  res.json({ ok: true });
});

r.post('/products/merge', requireAdmin, (req, res) => {
  const { keep, remove } = z.object({ keep: z.number(), remove: z.number() }).parse(req.body);
  if (keep === remove || !getProduct(keep) || !getProduct(remove)) {
    res.status(400).json({ error: t('Invalid products') });
    return;
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE stock SET product_id = ? WHERE product_id = ?').run(keep, remove);
    db.prepare('UPDATE movements SET product_id = ? WHERE product_id = ?').run(keep, remove);
    db.prepare('UPDATE OR IGNORE product_aliases SET product_id = ? WHERE product_id = ?').run(keep, remove);
    db.prepare('UPDATE OR IGNORE product_codes SET product_id = ? WHERE product_id = ?').run(keep, remove);
    db.prepare('UPDATE recipe_ingredients SET product_id = ? WHERE product_id = ?').run(keep, remove);
    db.prepare('UPDATE shopping_items SET product_id = ? WHERE product_id = ?').run(keep, remove);
    db.prepare('DELETE FROM products WHERE id = ?').run(remove);
  });
  tx();
  emit('products', 'stock');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- stock

r.post('/stock/adjust', (req, res) => {
  const b = z
    .object({
      product_id: z.number(),
      location_id: z.number().nullable().optional(),
      delta: z.number().optional(),
      set: z.number().min(0).optional(),
      best_before: z.string().nullable().optional(),
      reason: z.string().default('manual'),
    })
    .parse(req.body);
  const out = adjustStock({
    productId: b.product_id,
    locationId: b.location_id ?? null,
    delta: b.delta,
    set: b.set,
    bestBefore: b.best_before ?? null,
    reason: b.reason,
    actor: actorName(req),
  });
  res.json(out);
});

r.post('/stock/used-up', (req, res) => {
  const { product_id } = z.object({ product_id: z.number() }).parse(req.body);
  if (!getProduct(product_id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true, shopping: markUsedUp(product_id, actorName(req)) });
});

r.patch('/stock/:id', (req, res) => {
  const b = z.object({ best_before: z.string().nullable().optional(), opened_at: z.string().nullable().optional(), location_id: z.number().optional() }).parse(req.body);
  const s = db.prepare('SELECT * FROM stock WHERE id = ?').get(id(req.params.id)) as any;
  if (!s) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  db.prepare(`UPDATE stock SET best_before = ?, opened_at = ?, location_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
    b.best_before === undefined ? s.best_before : b.best_before,
    b.opened_at === undefined ? s.opened_at : b.opened_at,
    b.location_id ?? s.location_id,
    s.id,
  );
  emit('stock');
  res.json({ ok: true });
});

r.post('/stock/move', (req, res) => {
  const b = z.object({ product_id: z.number(), from: z.number(), to: z.number(), qty: z.number().positive() }).parse(req.body);
  res.json({ moved: moveStock(b.product_id, b.from, b.to, b.qty, actorName(req)) });
});

// ---------------------------------------------------------------- lookup (barcode / search)

r.get('/lookup/barcode/:code', async (req, res) => {
  const code = String(req.params.code);
  const local = matchProduct('', { code });
  if (local) {
    res.json({ local: productView(getProduct(local.productId)!) });
    return;
  }
  res.json({ remote: await lookupBarcode(code) });
});

r.get('/lookup/search', async (req, res) => {
  const q = String(req.query.q ?? '');
  const brand = req.query.brand ? String(req.query.brand) : null;
  res.json(await searchProducts(q, brand, 10));
});

r.get('/lookup/match', (req, res) => {
  const m = matchProduct(String(req.query.q ?? ''));
  res.json(m ? { ...m, product: productView(getProduct(m.productId)!) } : null);
});

// ---------------------------------------------------------------- shopping list

r.get('/shopping', (req, res) => {
  const items = db
    .prepare(
      `SELECT s.*, p.name AS product_name, p.brand, p.image_path, p.category_id, p.unit,
         (SELECT COALESCE(SUM(qty),0) FROM stock st WHERE st.product_id = s.product_id) AS in_stock
       FROM shopping_items s LEFT JOIN products p ON p.id = s.product_id
       WHERE s.checked_at IS NULL OR s.checked_at > datetime('now', '-1 day')
       ORDER BY s.checked_at IS NOT NULL, s.created_at DESC`,
    )
    .all() as { id: number; text: string; product_id: number | null; note: string | null }[];
  // discreet / private entries (area: share): real names only for their owner
  res.json(applyShareView(items, { userId: req.actor?.userId ?? null }));
});

r.post('/shopping', (req, res) => {
  const b = z.object({ text: z.string().min(1), product_id: z.number().nullable().optional(), qty: z.number().nullable().optional(), note: z.string().nullable().optional() }).parse(req.body);
  let productId = b.product_id ?? null;
  if (!productId) {
    const m = matchProduct(b.text);
    if (m && m.score >= 0.8) productId = m.productId;
  }
  const out = addToShopping({ productId, text: b.text, qty: b.qty, note: b.note, source: 'manual', addedBy: actorName(req) });
  if (out.created)
    void notify({ event: 'shopping.added', title: t('Shopping list: {text}', { text: b.text }), message: t('{actor} added “{text}” to the list.', { actor: actorName(req), text: b.text }), path: '/einkauf' });
  res.json(out);
});

r.patch('/shopping/:id', (req, res) => {
  const b = z.object({ checked: z.boolean().optional(), text: z.string().optional(), qty: z.number().nullable().optional(), note: z.string().nullable().optional(), to_stock: z.boolean().optional() }).parse(req.body);
  const it = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(id(req.params.id)) as any;
  if (!it) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const wasOpen = it.checked_at == null;
  if (b.checked !== undefined)
    db.prepare(`UPDATE shopping_items SET checked_at = ${b.checked ? "datetime('now')" : 'NULL'}, checked_by = ? WHERE id = ?`).run(b.checked ? actorName(req) : null, it.id);
  if (b.text !== undefined || b.qty !== undefined || b.note !== undefined)
    db.prepare('UPDATE shopping_items SET text = ?, qty = ?, note = ? WHERE id = ?').run(b.text ?? it.text, b.qty === undefined ? it.qty : b.qty, b.note === undefined ? it.note : b.note, it.id);
  const pid = realProductId(it);
  if (b.checked && wasOpen && b.to_stock && pid) {
    adjustStock({ productId: pid, delta: it.qty ?? 1, reason: 'purchase', actor: actorName(req) });
  }
  emit('shopping');
  res.json({ ok: true });
});

r.delete('/shopping/:id', (req, res) => {
  db.prepare('DELETE FROM shopping_items WHERE id = ?').run(id(req.params.id));
  emit('shopping');
  res.json({ ok: true });
});

r.post('/shopping/clear-checked', (_req, res) => {
  db.prepare('DELETE FROM shopping_items WHERE checked_at IS NOT NULL').run();
  emit('shopping');
  res.json({ ok: true });
});

r.get('/shopping/export.txt', (_req, res) => {
  // shared with others (WhatsApp …): private entries stay out, discreet ones keep their placeholder
  const items = db.prepare(`SELECT text, qty FROM shopping_items WHERE checked_at IS NULL AND ${notPrivate()} ORDER BY created_at`).all() as { text: string; qty: number | null }[];
  res.type('text/plain').send(items.map((i) => `- ${i.qty && i.qty !== 1 ? i.qty + '× ' : ''}${i.text}`).join('\n'));
});

// ---------------------------------------------------------------- notifications

r.get('/notifications', (_req, res) => {
  res.json(db.prepare('SELECT id, event, title, body, channels, read_at, created_at FROM notifications ORDER BY id DESC LIMIT 60').all());
});
r.post('/notifications/read', (_req, res) => {
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE read_at IS NULL`).run();
  emit('notifications');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- settings / admin

r.get('/settings', (req, res) => {
  res.json({
    household: getSetting('household.name', t('Our home')),
    brand: brand(),
    brandDefault: defaultBrand(),
    language: lang(),
    ha: { ...haSettings(), token: haSettings().token ? '••••' : '' },
    notify: notifySettings(),
    importAutoApply: getSetting('import.autoApply', false),
    baseUrl: config.baseUrl,
    features: { vision: visionEnabled(), email: smtpEnabled(), visionModel: config.vision.model || null },
    // the path secret grants MCP access – only admins get to see it
    mcpPath: config.mcpPathSecret && req.actor?.role === 'admin' ? `${config.baseUrl}/mcp/${config.mcpPathSecret}` : null,
  });
});

r.patch('/settings', requireAdmin, (req, res) => {
  const b = z
    .object({
      household: z.string().optional(),
      brand: z.enum(['tohuus', 'fredirando']).optional(),
      language: z.enum(LANG_CODES).optional(),
      importAutoApply: z.boolean().optional(),
      ha: z.object({ url: z.string().url().or(z.literal('')).optional(), token: z.string().max(400).optional(), cookidooCalendar: z.string().max(120).optional() }).optional(),
      notify: z
        .object({
          haWebhookUrl: z.string().optional(),
          webhookUrl: z.string().optional(),
          ntfyUrl: z.string().optional(),
          emailTo: z.string().optional(),
          digestHour: z.number().int().min(-1).max(23).optional(),
          expiryWarnDays: z.number().int().min(0).max(30).optional(),
          autoShoppingList: z.boolean().optional(),
          events: z.record(z.string(), z.object({ ha: z.boolean(), webhook: z.boolean(), ntfy: z.boolean(), email: z.boolean(), push: z.boolean().optional(), telegram: z.boolean().optional(), gotify: z.boolean().optional(), matrix: z.boolean().optional() })).optional(),
        })
        .optional(),
    })
    .parse(req.body);
  if (b.household) setSetting('household.name', b.household);
  // the explicit choice in Settings wins over BRAND (choosing the default removes the override)
  if (b.brand) chooseBrand(b.brand);
  if (b.language) setSetting('language', b.language);
  if (b.ha) setSetting('ha', { ...haSettings(), ...Object.fromEntries(Object.entries(b.ha).filter(([k, v]) => !(k === 'token' && v === '••••'))) });
  if (b.importAutoApply !== undefined) setSetting('import.autoApply', b.importAutoApply);
  if (b.notify) {
    const cur = notifySettings();
    setSetting('notify', { ...cur, ...b.notify, events: { ...cur.events, ...(b.notify.events ?? {}) } });
  }
  emit('settings');
  res.json({ ok: true });
});

r.post('/settings/test-notification', requireAdmin, async (_req, res) => {
  const out = await notify({ event: 'test', title: t('Test from ToHuus Hub'), message: t('If you can read this, notifications are working.'), path: '/' });
  res.json(out);
});

r.get('/settings/defaults', (_req, res) => res.json(DEFAULT_NOTIFY));

r.get('/users', requireAdmin, (_req, res) => res.json(db.prepare('SELECT id, name, color, role, email, created_at FROM users ORDER BY id').all()));
r.post('/users', requireAdmin, (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(NAME_MAX), password: z.string().min(PASSWORD_MIN).max(200), role: z.enum(['admin', 'member']).default('member'), color: z.string().max(20).default('#2f5bea') }).parse(req.body);
  if (db.prepare('SELECT 1 FROM users WHERE lower(name) = lower(?)').get(b.name)) {
    res.status(409).json({ error: t('Someone with this name already exists.') });
    return;
  }
  const info = db.prepare('INSERT INTO users (name, password_hash, role, color) VALUES (?, ?, ?, ?)').run(b.name, hashPassword(b.password), b.role, b.color);
  res.json({ id: Number(info.lastInsertRowid) });
});
r.patch('/users/:id', (req, res) => {
  const target = id(req.params.id);
  if (req.actor?.role !== 'admin' && req.actor?.userId !== target) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const b = z.object({ password: z.string().min(PASSWORD_MIN).max(200).optional(), color: z.string().max(20).optional(), name: z.string().trim().min(1).max(NAME_MAX).optional() }).parse(req.body);
  if (b.name && db.prepare('SELECT 1 FROM users WHERE lower(name) = lower(?) AND id != ?').get(b.name, target)) {
    res.status(409).json({ error: t('Someone with this name already exists.') });
    return;
  }
  if (b.password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), target);
    // sign out everywhere else
    const current = req.cookies?.[SESSION_COOKIE];
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(target, current ? sha256(current) : '');
  }
  if (b.color) db.prepare('UPDATE users SET color = ? WHERE id = ?').run(b.color, target);
  if (b.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(b.name, target);
  res.json({ ok: true });
});
r.delete('/users/:id', requireAdmin, (req, res) => {
  if (req.actor?.userId === id(req.params.id)) {
    res.status(400).json({ error: t('You cannot delete yourself.') });
    return;
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id(req.params.id));
  res.json({ ok: true });
});

r.get('/tokens', requireAdmin, (_req, res) => res.json(db.prepare('SELECT id, name, prefix, scope, created_at, last_used_at FROM api_tokens ORDER BY id DESC').all()));
r.post('/tokens', requireAdmin, (req, res) => {
  const b = z.object({ name: z.string().min(1), scope: z.enum(['full', 'ha', 'mcp']).default('full') }).parse(req.body);
  res.json(createApiToken(b.name, b.scope));
});
r.delete('/tokens/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(id(req.params.id));
  res.json({ ok: true });
});

r.get('/export.json', requireAdmin, (_req, res) => {
  // every household table, never credentials (see server/lib/data.ts)
  const out = buildExport();
  res.setHeader('Content-Disposition', `attachment; filename="tohuus-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(out);
});

// POST /demo/reset moved to routes/tour.ts (scoped reset with automatic backup; the old path is an alias there)
