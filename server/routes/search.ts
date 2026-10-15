/**
 * Global search (14 Oct 2026, docs/search.md, UX benchmark 2.4): one query, grouped results across Vorrat, the list,
 * recipes, tasks, Hausinfo cards and people. The functions/settings registry is static and lives in the clients.
 *
 * Privacy is the same as in each area: private list rows and private lists of others never show, private tasks only
 * to their owner, Hausinfo cards only as their visibility allows (never codes), permanent guests only see the groups
 * their level may read (`guestMay`), guest links get nothing.
 */
import { Router, type Request } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { listCareTasks } from '../lib/care.js';
import { listCards, viewerOf } from '../lib/house-guide.js';
import { listLists } from '../lib/lists.js';
import { guestMay } from '../lib/people-policy.js';
import { directory } from '../lib/people.js';
import { listProducts } from '../lib/catalog.js';
import { notPrivate } from '../lib/share-core.js';
import { nameScore, norm } from '../lib/text.js';

export const r = Router();
r.use(requireAuth);

const LIMIT = 8;

/** may this person read the area behind this API path? (members always; guests by level) */
function may(req: Request, path: string) {
  const g = req.actor?.houseGuest;
  return !g || guestMay(g.level, 'GET', path);
}

function score(n: string, ...fields: (string | null | undefined)[]) {
  const hay = norm(fields.filter(Boolean).join(' '));
  if (!hay) return 0;
  if (hay.startsWith(n)) return 1.2;
  if (hay.includes(n)) return 1;
  return nameScore(n, fields.filter(Boolean).join(' '));
}

function top<T>(rows: (T & { score: number })[]) {
  return rows
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT)
    .map(({ score: _s, ...rest }) => rest);
}

r.get('/search', (req, res) => {
  if (req.actor?.kind === 'guest') return void res.status(403).json({ error: 'not for guest links' });
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  const n = norm(q);
  if (n.length < 2) return void res.json({ q, groups: {} });
  const uid = req.actor?.userId ?? null;
  const groups: Record<string, unknown[]> = {};

  if (may(req, '/api/find')) {
    groups.products = top(
      listProducts().map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        image_path: p.image_path,
        in_stock: p.track_mode === 'none' ? null : p.total > 0,
        score: score(n, p.name, p.brand),
      })),
    );
  }

  if (may(req, '/api/shopping')) {
    // only lists this person may see; private rows (share_items) never
    const lists = new Map(listLists({ userId: uid }).map((l) => [l.id, l.name]));
    const rows = db
      .prepare(`SELECT id, text, qty, list_id FROM shopping_items WHERE checked_at IS NULL AND cleared_at IS NULL AND ${notPrivate('id')}`)
      .all() as { id: number; text: string; qty: number | null; list_id: number | null }[];
    groups.list = top(
      rows
        .filter((x) => lists.has(x.list_id ?? 0))
        .map((x) => ({ id: x.id, text: x.text, qty: x.qty, list_id: x.list_id ?? 0, list: lists.get(x.list_id ?? 0), score: score(n, x.text) })),
    );
  }

  if (may(req, '/api/recipes')) {
    const ings = new Map<number, string>();
    for (const i of db.prepare('SELECT recipe_id, text FROM recipe_ingredients').all() as { recipe_id: number; text: string }[])
      ings.set(i.recipe_id, `${ings.get(i.recipe_id) ?? ''} ${i.text}`);
    const recipes = db.prepare('SELECT id, title, image_path FROM recipes').all() as { id: number; title: string; image_path: string | null }[];
    groups.recipes = top(
      recipes.map((x) => {
        const byTitle = score(n, x.title);
        const byIng = norm(ings.get(x.id) ?? '').includes(n) ? 0.8 : 0;
        return { id: x.id, title: x.title, image_path: x.image_path, with: byTitle < 0.6 && byIng ? q : null, score: Math.max(byTitle, byIng) };
      }),
    );
  }

  if (may(req, '/api/care')) {
    groups.tasks = top(
      listCareTasks({ viewer: uid }).map((x) => ({
        id: x.id,
        name: x.name,
        next_due: x.next_due,
        state: x.state,
        private: x.visibility === 'private',
        score: score(n, x.name, x.note, x.place),
      })),
    );
  }

  if (may(req, '/api/house-guide')) {
    groups.house = top(
      listCards(viewerOf(req.actor)).map((c: any) => ({ id: c.id, title: c.title, type: c.type ?? null, score: score(n, c.title, c.body) })),
    );
  }

  if (may(req, '/api/people/directory')) {
    groups.people = top(directory().map((p) => ({ key: p.key, name: p.name, kind: p.kind, score: score(n, p.name) })));
  }

  for (const k of Object.keys(groups)) if (!groups[k].length) delete groups[k];
  res.json({ q, groups });
});
