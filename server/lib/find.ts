/** "Wo ist was?" – where things live, for the household and for a babysitter's guest link. */
import { db } from '../db.js';
import { listProducts } from './catalog.js';
import { norm, nameScore } from './text.js';

export interface FoundThing {
  id: number;
  name: string;
  brand: string | null;
  image_path: string | null;
  spot: string | null;
  notes: string | null;
  in_stock: boolean | null;
  places: { id: number; name: string; icon: string; hint: string | null }[];
}

/**
 * Every product with the place(s) it is in right now — or, when it's out, where it normally lives.
 * `locationIds` limits the result (guest links); empty = all locations.
 */
export function findThings(q = '', locationIds: number[] = []) {
  const locs = new Map((db.prepare('SELECT id, name, icon, hint FROM locations').all() as any[]).map((l) => [l.id, l]));
  const allowed = (id: number | null | undefined) => id != null && locs.has(id) && (locationIds.length === 0 || locationIds.includes(id));
  const n = norm(q);
  const out: (FoundThing & { score: number })[] = [];
  for (const p of listProducts()) {
    const here = [...new Set(p.stock.filter((s) => s.qty > 0).map((s) => s.location_id))];
    const ids = (here.length ? here : [p.default_location_id]).filter(allowed) as number[];
    if (!ids.length) continue;
    let score = 1;
    if (n) {
      const hay = norm(`${p.name} ${p.brand ?? ''} ${p.spot ?? ''}`);
      score = hay.includes(n) ? 1 : nameScore(n, `${p.brand ?? ''} ${p.name}`);
      if (score < 0.5) continue;
    }
    out.push({
      id: p.id,
      name: p.name,
      brand: p.brand,
      image_path: p.image_path,
      spot: p.spot,
      notes: p.notes,
      in_stock: p.track_mode === 'none' ? null : p.total > 0,
      places: ids.map((i) => locs.get(i)),
      score,
    });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'de'));
  return out.slice(0, n ? 40 : 1000).map(({ score: _s, ...rest }) => rest);
}
