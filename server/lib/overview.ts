import { db, getSetting } from '../db.js';
import { listProducts } from './catalog.js';
import { suggest } from './recipes.js';

export function overview() {
  const products = listProducts();
  const locations = db.prepare('SELECT * FROM locations ORDER BY sort, id').all() as any[];
  const tracked = products.filter((p) => p.track_mode !== 'none');
  const watched = (p: (typeof products)[number]) => p.min_qty > 0 || p.track_mode === 'level';
  const attention = tracked
    .filter((p) => (['low', 'empty'].includes(p.status) && watched(p)) || ['expiring', 'expired'].includes(p.status))
    .map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      image_path: p.image_path,
      status: p.status,
      total: p.total,
      unit: p.unit,
      track_mode: p.track_mode,
      min_qty: p.min_qty,
      nextExpiry: p.nextExpiry,
      location_id: p.stock.find((s) => s.qty > 0)?.location_id ?? p.default_location_id,
    }))
    .sort((a, b) => rank(a.status) - rank(b.status) || (a.nextExpiry ?? '9').localeCompare(b.nextExpiry ?? '9'));

  const locs = locations.map((l) => {
    const here = tracked.filter((p) => p.stock.some((s) => s.location_id === l.id && s.qty > 0));
    const lowHere = tracked.filter(
      (p) => (p.stock.some((s) => s.location_id === l.id) || p.default_location_id === l.id) && ['low', 'empty'].includes(p.status) && watched(p),
    );
    const qty = here.reduce((s, p) => s + p.stock.filter((x) => x.location_id === l.id).reduce((a, x) => a + x.qty, 0), 0);
    return {
      ...l,
      products: here.length,
      units: qty,
      low: lowHere.length,
      expiring: here.filter((p) => ['expiring', 'expired'].includes(p.status)).length,
      preview: here
        .filter((p) => p.image_path)
        .slice(0, 4)
        .map((p) => ({ id: p.id, name: p.name, image_path: p.image_path })),
    };
  });

  const shopping = db
    .prepare(`SELECT s.id, s.text, s.source, p.image_path FROM shopping_items s LEFT JOIN products p ON p.id = s.product_id WHERE s.checked_at IS NULL ORDER BY s.created_at DESC`)
    .all() as any[];
  const imports = db.prepare(`SELECT id, kind, title, created_at, (SELECT COUNT(*) FROM import_lines l WHERE l.import_id = i.id) AS lines FROM imports i WHERE status = 'review' ORDER BY id DESC`).all();
  const orders = db.prepare(`SELECT o.*, (SELECT json_group_array(json_object('name', name, 'qty', qty, 'options', json(options))) FROM order_lines WHERE order_id = o.id) AS lines FROM orders o WHERE status IN ('new','accepted') ORDER BY id DESC`).all() as any[];
  const activity = db
    .prepare(`SELECT m.*, p.name, p.unit, p.track_mode FROM movements m JOIN products p ON p.id = m.product_id ORDER BY m.id DESC LIMIT 8`)
    .all();
  const tonight = suggest({ limit: 3 });

  return {
    household: getSetting('household.name', 'Unser Zuhause'),
    counts: {
      products: tracked.length,
      inStock: tracked.filter((p) => p.total > 0).length,
      low: tracked.filter((p) => p.status === 'low' && watched(p)).length,
      empty: tracked.filter((p) => p.status === 'empty' && watched(p)).length,
      expiring: tracked.filter((p) => p.status === 'expiring').length,
      expired: tracked.filter((p) => p.status === 'expired').length,
      shopping: shopping.length,
      imports: imports.length,
      orders: orders.length,
    },
    attention,
    locations: locs,
    shopping: shopping.slice(0, 6),
    imports,
    orders: orders.map((o) => ({ ...o, lines: JSON.parse(o.lines) })),
    activity,
    tonight: tonight.map((s) => ({
      id: s.recipe.id,
      title: s.recipe.title,
      image_path: s.recipe.image_path,
      thermomix: s.recipe.thermomix,
      time_min: s.recipe.time_min,
      have: s.have,
      need: s.need,
      missing: s.missing,
      reasons: s.reasons,
    })),
  };
}

function rank(s: string) {
  return { expired: 0, empty: 1, expiring: 2, low: 3 }[s] ?? 9;
}
