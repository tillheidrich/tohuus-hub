// Ratgeber cards for the apps (14 Oct 2026): reads the published German posts of the website (site/src/posts/*.mjs)
// and writes server/data/ratgeber.json – served by GET /api/ratgeber, shown as cards in web and iOS.
// Run after adding or changing a post: `node scripts/ratgeber-cards.mjs` (test/ratgeber.test.ts checks it's current).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, 'site/src/posts');
const out = path.join(root, 'server/data/ratgeber.json');

const teaser = (s) => {
  const t = String(s).replace(/<[^>]+>/g, '').trim();
  if (t.length <= 140) return t;
  const cut = t.slice(0, 140);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,.;:]$/, '') + ' …';
};

/** docs/ratgeber-cards.json: hand-picked area and short teaser per slug (written with the posts) */
const picked = (() => {
  try {
    return new Map(JSON.parse(fs.readFileSync(path.join(root, 'docs/ratgeber-cards.json'), 'utf8')).map((c) => [c.slug, c]));
  } catch {
    return new Map();
  }
})();

export async function ratgeberCards() {
  const posts = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs')).sort()) {
    const area = f.replace(/^[a-z]-/, '').replace(/\.mjs$/, '');
    const list = (await import(pathToFileURL(path.join(dir, f)).href)).default;
    for (const p of list) {
      if (p.status !== 'published' || (p.lang && p.lang !== 'de')) continue;
      const c = picked.get(p.slug);
      posts.push({ slug: p.slug, title: p.title, teaser: c?.teaser ?? teaser(p.desc ?? p.answer ?? ''), area: c?.area ?? p.area ?? area, date: p.date });
    }
  }
  posts.sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  return { version: 1, posts };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = await ratgeberCards();
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
  console.log(`${data.posts.length} posts → ${path.relative(root, out)}`);
}
