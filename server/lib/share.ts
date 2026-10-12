/**
 * Share area: things shared into the app (PWA share target, iPhone shortcut), discreet/private shopping items
 * and the start mode "only what runs out". Privacy primitives live in share-core.ts (importable everywhere).
 */
import { hasClimate } from './places.js';
import { db, lang } from '../db.js';
import { t } from '../i18n.js';
import { randomToken, sha256 } from './auth.js';
import { categoryIdByKey, type CategoryKey } from './basedata.js';
import { emit } from './bus.js';
import { adjustStock, createProduct, getProduct } from './catalog.js';
import { STARTER } from './onboard.js';
import { type Section, parseQuickAdd, previewQuickAdd, quickAdd, sectionOf } from './shop.js';
import { norm } from './text.js';
import { type ShareRow, type StockMode, type Visibility, isTrackedProduct, setStockMode, shareRow, stockMode } from './share-core.js';
import { ScopedMap } from './tenancy.js';

export * from './share-core.js';

const err = (status: number, message: string) => Object.assign(new Error(message), { status });

// ------------------------------------------------------------------ shared text

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
/** WhatsApp/Signal export prefixes: "[11.10.26, 14:03:12] Mira: …", "11.10.26, 14:03 - Mira: …", "10/11/26, 2:03 PM - Mira: …" */
const CHAT_PREFIX = /^\s*\[?\d{1,4}[./-]\d{1,2}[./-]\d{1,4},?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?\]?\s*(?:[-–]\s*)?[^:\n]{1,40}:\s+/;
const MEDIA = /^<?\s*(medien ausgeschlossen|media omitted|bild weggelassen|image omitted|diese nachricht wurde gelöscht|this message was deleted|meddelandet raderades|media utelämnad)\s*>?$/i;
const CHECKBOX = /^\s*(?:[-*•·–]\s*)?(?:\[\s?[xX✓]?\s?\]|[☐☑☒✅✔✓□■▢◻])\s*/;
const NUMBERING = /^\s*\d{1,2}[.)]\s+/;

export function extractUrls(text: string): string[] {
  return [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')))];
}

/**
 * Turn whatever was shared (a WhatsApp message, a forwarded chat excerpt, a note, a bulleted list) into plain
 * list lines: chat timestamps and names, check boxes, bullets, numbering, links, media markers, emoji and
 * headings ("Shopping list:") are removed. Comma/“and” lists stay on one line – the quick-add parser splits them.
 */
export function cleanSharedText(text: string): string {
  const lines: string[] = [];
  for (let line of text.replace(/\r\n?/g, '\n').replace(/[‎‏‪-‮]/g, '').split('\n')) {
    line = line.replace(CHAT_PREFIX, '').replace(URL_RE, ' ');
    line = line.replace(CHECKBOX, '').replace(NUMBERING, '').replace(/^\s*[-*•·–]+\s*/, '');
    line = line.replace(/\p{Extended_Pictographic}|️/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!line || MEDIA.test(line)) continue;
    // headings like "Einkaufsliste:" or "Can you bring:" carry no item
    if (/[:：]$/.test(line)) continue;
    lines.push(line);
  }
  return lines.join('\n');
}

const RECIPE_HINT =
  /rezept|recipe|recept|chefkoch|cookidoo|hellofresh|kitchenstories|lecker\.de|essen-und-trinken|eatsmarter|springlane|einfachbacken|gaumenfreundin|allrecipes|bbcgoodfood|seriouseats|bonappetit|epicurious|food52|budgetbytes|jamieoliver|marleyspoon|ica\.se|koket\.se|arla\.se|mytaste|tasteline|nyt.*cooking|cooking\.nytimes|thermomix|kochbar|kuechengoetter|zuckerjagdwurst|smittenkitchen|delish|tasty\.co/i;
const RECEIPT_HINT = /e-?bon|kassenbon|receipt|kvitto|beleg|anybill|bonbox|rechnung|invoice/i;

export function looksLikeRecipeUrl(url: string) {
  try {
    const u = new URL(url);
    return RECIPE_HINT.test(u.hostname + u.pathname);
  } catch {
    return false;
  }
}
export function looksLikeReceiptUrl(url: string) {
  try {
    const u = new URL(url);
    return RECEIPT_HINT.test(u.hostname + u.pathname + u.search);
  } catch {
    return false;
  }
}

/** Everything the landing page needs to offer the right one-tap action. */
export function classifyShare(input: { title?: string | null; text?: string | null; url?: string | null }) {
  const raw = [input.text ?? '', input.url ?? ''].join('\n');
  const urls = extractUrls(raw).slice(0, 5).map((url) => ({ url, recipe: looksLikeRecipeUrl(url), receipt: looksLikeReceiptUrl(url) }));
  const text = cleanSharedText(input.text ?? '');
  // a page shared from the browser usually repeats its title as text – that's not a shopping list
  const titleOnly = Boolean(input.title && text && norm(text) === norm(input.title) && urls.length);
  const items = titleOnly ? [] : previewQuickAdd(text);
  return { text: titleOnly ? '' : text, urls, items };
}

// ------------------------------------------------------------------ discreet / private items

/** Neutral stand-in shown to everyone else. Drugstore things get "Drugstore item" so they still land in the right aisle. */
export function defaultPlaceholder(section: Section) {
  if (section === 'drugstore') return t('Drugstore item');
  if (section === 'household') return t('Household item');
  return t('Personal item');
}

/** Typical discreet drugstore things the general keyword guess doesn't know – they belong in the drugstore aisle. */
const DISCREET_DRUGSTORE =
  /kondom|condom|tampon|binden\b|slipeinlage|menstruation|gleitgel|\blube\b|glidmedel|schwangerschaftstest|pregnancy test|graviditetstest|ovulation|inkontinenz|incontinence|hämorr|haemorrh|hemorr|verhütung|contracept|preventivmedel|bindor|trosskydd|mensskydd|sanitary|period pants|menstruationstasse|menstrual cup/i;

export function discreetSection(text: string, productId: number | null): Section {
  if (DISCREET_DRUGSTORE.test(text)) return 'drugstore';
  return sectionOf({ product_id: productId, text });
}

/** Remember the aisle of a placeholder text so the store view sorts it where the real thing is. */
function rememberSection(placeholder: string, section: Section) {
  if (section === 'other') return;
  db.prepare('INSERT INTO shop_sections (key, section) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run(`t:${norm(placeholder)}`, section);
}

export interface PrivacyInput {
  visibility: Visibility;
  share_with?: number[];
  reveal?: boolean;
  placeholder?: string | null;
}

const validMembers = (ids: number[] | undefined, ownerId: number) =>
  [...new Set((ids ?? []).filter((id) => id !== ownerId && db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)))].slice(0, 20);

const cleanPlaceholder = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

/**
 * Add one or more items discreetly or privately (never through the normal add, so the real name is never
 * stored in the shared list, never sent to Home Assistant and never announced). No de-duplication against
 * visible items – that would reveal or hide someone else's entry.
 */
export function addHidden(input: { text: string; owner: { userId: number; name: string }; source?: string } & PrivacyInput) {
  if (input.visibility === 'all') throw err(400, 'visibility');
  const lines = previewQuickAdd(input.text);
  if (!lines.length) throw err(400, t('Nothing to add'));
  const shareWith = JSON.stringify(input.visibility === 'private' ? validMembers(input.share_with, input.owner.userId) : []);
  const out: { id: number; text: string; placeholder: string }[] = [];
  db.transaction(() => {
    for (const l of lines) {
      const productId = l.confident && l.product ? l.product.id : null;
      const realText = productId ? l.product!.name : l.name;
      const note = l.amount ?? (l.unit && l.qty ? l.unit : null);
      const section = discreetSection(realText, productId);
      const placeholder = cleanPlaceholder(input.placeholder) || defaultPlaceholder(section);
      const id = Number(
        db
          .prepare('INSERT INTO shopping_items (product_id, text, qty, note, source, added_by) VALUES (NULL, ?, ?, NULL, ?, ?)')
          .run(placeholder, l.qty ?? null, input.source ?? 'manual', input.owner.name).lastInsertRowid,
      );
      db.prepare(
        'INSERT INTO share_items (item_id, owner_id, visibility, share_with, reveal, real_text, real_product_id, real_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, input.owner.userId, input.visibility, shareWith, input.visibility === 'discreet' && input.reveal ? 1 : 0, realText, productId, note);
      rememberSection(placeholder, section);
      out.push({ id, text: realText, placeholder });
    }
  })();
  emit('shopping');
  return out;
}

/**
 * Change who sees an item. Visible items can be made discreet/private by any member (they become the owner);
 * a discreet/private item can only be changed by its owner.
 */
export function setPrivacy(itemId: number, input: PrivacyInput, viewer: { userId: number; name: string }) {
  const it = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(itemId) as
    | { id: number; text: string; product_id: number | null; note: string | null }
    | undefined;
  if (!it) throw err(404, t('Item not found'));
  const s = shareRow(itemId);
  if (s && s.owner_id !== null && s.owner_id !== viewer.userId) throw err(403, t('Only the person who added it can change this.'));
  const ownerId = s?.owner_id ?? viewer.userId;
  db.transaction(() => {
    if (input.visibility === 'all') {
      if (!s) return;
      db.prepare('UPDATE shopping_items SET text = ?, product_id = ?, note = ? WHERE id = ?').run(s.real_text, s.real_product_id, s.real_note, itemId);
      db.prepare('DELETE FROM share_items WHERE item_id = ?').run(itemId);
      return;
    }
    const shareWith = JSON.stringify(input.visibility === 'private' ? validMembers(input.share_with ?? (s ? JSON.parse(s.share_with) : []), ownerId) : []);
    const reveal = input.visibility === 'discreet' && (input.reveal ?? Boolean(s?.reveal)) ? 1 : 0;
    const real = s ? { text: s.real_text, product_id: s.real_product_id } : { text: it.text, product_id: it.product_id };
    const section = discreetSection(real.text, real.product_id);
    const placeholder = cleanPlaceholder(input.placeholder) || (s ? it.text : defaultPlaceholder(section));
    if (!s) {
      db.prepare(
        'INSERT INTO share_items (item_id, owner_id, visibility, share_with, reveal, real_text, real_product_id, real_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(itemId, ownerId, input.visibility, shareWith, reveal, it.text, it.product_id, it.note);
    } else {
      db.prepare('UPDATE share_items SET owner_id = ?, visibility = ?, share_with = ?, reveal = ? WHERE item_id = ?').run(ownerId, input.visibility, shareWith, reveal, itemId);
    }
    db.prepare('UPDATE shopping_items SET text = ?, product_id = NULL, note = NULL WHERE id = ?').run(placeholder, itemId);
    rememberSection(placeholder, section);
  })();
  emit('shopping');
  return { ok: true };
}

/** The viewer's own discreet/private items (open ones). */
export function myHidden(userId: number) {
  return db
    .prepare(
      `SELECT s.id, s.text AS placeholder, s.qty, x.visibility, x.real_text AS text, x.reveal, x.share_with
       FROM share_items x JOIN shopping_items s ON s.id = x.item_id
       WHERE x.owner_id = ? AND s.checked_at IS NULL ORDER BY s.created_at DESC`,
    )
    .all(userId) as { id: number; placeholder: string; qty: number | null; visibility: string; text: string; reveal: number; share_with: string }[];
}

export type { ShareRow };

// ------------------------------------------------------------------ personal share tokens (iPhone shortcut)

export function createShareToken(userId: number, name: string) {
  const token = `swl_${randomToken(24)}`;
  const id = Number(
    db.prepare('INSERT INTO share_tokens (user_id, name, token_hash, prefix) VALUES (?, ?, ?, ?)').run(userId, name.trim().slice(0, 60) || 'iPhone', sha256(token), token.slice(0, 8)).lastInsertRowid,
  );
  return { id, token };
}

export function listShareTokens(userId: number) {
  return db.prepare('SELECT id, name, prefix, created_at, last_used_at FROM share_tokens WHERE user_id = ? ORDER BY id DESC').all(userId) as {
    id: number;
    name: string;
    prefix: string;
    created_at: string;
    last_used_at: string | null;
  }[];
}

export function revokeShareToken(userId: number, id: number) {
  return db.prepare('DELETE FROM share_tokens WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

/** A personal token only ever adds to the shopping list (scope-limited); returns its member. */
export function userFromShareToken(token: string | undefined | null) {
  if (!token || !token.startsWith('swl_')) return null;
  const row = db
    .prepare('SELECT k.id, k.user_id, u.name FROM share_tokens k JOIN users u ON u.id = k.user_id WHERE k.token_hash = ?')
    .get(sha256(token)) as { id: number; user_id: number; name: string } | undefined;
  if (!row) return null;
  db.prepare(`UPDATE share_tokens SET last_used_at = datetime('now') WHERE id = ?`).run(row.id);
  return { tokenId: row.id, userId: row.user_id, name: row.name };
}

/**
 * Text shared from another app (iPhone shortcut, MCP): cleaned, parsed and put on the list.
 * Links are not fetched here – the answer points to the app, where a recipe link can be imported.
 */
export function shareTextToList(input: { text?: string | null; url?: string | null; title?: string | null; visibility?: Visibility }, user: { userId?: number | null; name: string }, source = 'share') {
  const c = classifyShare(input);
  const lines = parseQuickAdd(c.text);
  let added: { text: string; created: boolean }[] = [];
  if (lines.length) {
    if (input.visibility && input.visibility !== 'all' && user.userId)
      added = addHidden({ text: c.text, owner: { userId: user.userId, name: user.name }, visibility: input.visibility, source }).map((a) => ({ text: a.text, created: true }));
    else added = quickAdd(c.text, user.name, source);
  }
  const fresh = added.filter((a) => a.created).map((a) => a.text);
  const already = added.filter((a) => !a.created).map((a) => a.text);
  const parts: string[] = [];
  if (fresh.length) parts.push(fresh.length === 1 ? t('Added: {list}', { list: fresh[0] }) : t('{n} added: {list}', { n: fresh.length, list: fresh.join(', ') }));
  if (already.length) parts.push(t('Already on the list: {list}', { list: already.join(', ') }));
  const recipe = c.urls.find((u) => u.recipe) ?? null;
  if (!added.length && c.urls.length) parts.push(recipe ? t('That looks like a recipe – open ToHuus Hub to import it.') : t('Only a link – open ToHuus Hub to decide what to do with it.'));
  if (!parts.length) parts.push(t('I didn’t find anything to add.'));
  const link = c.urls[0] ? `/teilen?url=${encodeURIComponent(c.urls[0].url)}` : null;
  return { ok: added.length > 0, added: fresh, already, urls: c.urls, open: link, message: parts.join(' · ') };
}

// ------------------------------------------------------------------ in-memory share inbox (server fallback for files)

interface InboxEntry {
  userId: number;
  at: number;
  title: string;
  text: string;
  url: string;
  files: { name: string; type: string; buf: Buffer }[];
}
const inbox = new ScopedMap<string, InboxEntry>();
const INBOX_TTL = 30 * 60_000;

function sweepInbox() {
  const now = Date.now();
  for (const [k, v] of inbox) if (now - v.at > INBOX_TTL) inbox.delete(k);
}

export function putInbox(e: Omit<InboxEntry, 'at'>) {
  sweepInbox();
  // a household doesn't share dozens of things at once – keep memory bounded
  while (inbox.size >= 50) inbox.delete(inbox.keys().next().value!);
  const id = randomToken(12);
  inbox.set(id, { ...e, at: Date.now() });
  return id;
}

export function getInbox(id: string, userId: number) {
  sweepInbox();
  const e = inbox.get(id);
  return e && e.userId === userId ? e : null;
}

export const dropInbox = (id: string, userId: number) => {
  const e = inbox.get(id);
  if (e && e.userId === userId) inbox.delete(id);
};

// ------------------------------------------------------------------ start mode "only what runs out"

const GROUPS: { key: string; label: () => string; cats: string[] }[] = [
  { key: 'cupboard', label: () => t('Kitchen cupboard'), cats: ['pantry', 'snacks'] },
  { key: 'fridge', label: () => t('Fridge'), cats: ['chilled'] },
  { key: 'fresh', label: () => t('Bread, fruit & veg'), cats: ['produce', 'bakery'] },
  { key: 'freezer', label: () => t('Freezer compartment'), cats: ['frozen', 'icecream'] },
  { key: 'drinks', label: () => t('Drinks'), cats: ['drinks', 'bar'] },
  { key: 'bathroom', label: () => t('Bathroom'), cats: ['toiletries'] },
  { key: 'household', label: () => t('Cleaning & household'), cats: ['household'] },
];

interface Staple {
  key: string;
  en: string;
  de: string;
  cat: string;
  on?: boolean;
}

function staples(): Staple[] {
  const seen = new Set<string>();
  const out: Staple[] = [];
  for (const list of Object.values(STARTER) as Staple[][]) {
    for (const i of list) {
      if (seen.has(i.key)) continue;
      seen.add(i.key);
      out.push(i);
    }
  }
  return out;
}

const stapleName = (i: Staple) => (i as unknown as Record<string, string | undefined>)[lang()] ?? i.en;
const productByName = (name: string) =>
  db.prepare('SELECT id, runs_out FROM products WHERE lower(name) = lower(?) AND archived = 0 ORDER BY id LIMIT 1').get(name) as { id: number; runs_out: number } | undefined;

/** Products bought on at least two different days that aren't marked yet – "add what runs out". */
export function runsOutSuggestions(limit = 24) {
  return db
    .prepare(
      `SELECT p.id, p.name, p.brand, p.image_path, COUNT(DISTINCT date(m.created_at)) AS times
       FROM movements m JOIN products p ON p.id = m.product_id
       WHERE m.delta > 0 AND m.reason IN ('import', 'purchase') AND p.archived = 0 AND p.runs_out = 0 AND p.track_mode != 'none'
       GROUP BY p.id HAVING times >= 2
       ORDER BY times DESC, MAX(m.created_at) DESC LIMIT ?`,
    )
    .all(limit) as { id: number; name: string; brand: string | null; image_path: string | null; times: number }[];
}

/** One-screen picker: typical staples (neutral, by kind of thing), the household's own marked products, receipt suggestions. */
export function staplesPicker() {
  const marked = db.prepare('SELECT id, name, brand, image_path FROM products WHERE runs_out = 1 AND archived = 0 ORDER BY name COLLATE NOCASE').all() as {
    id: number;
    name: string;
    brand: string | null;
    image_path: string | null;
  }[];
  const anyMarked = marked.length > 0;
  const used = new Set<number>();
  // groups follow the places the household really has: no freezer group without a frozen place (area: home)
  const freezer = hasClimate('frozen');
  const fridge = hasClimate('chilled');
  const groups = GROUPS.filter((g) => g.key !== 'freezer' || freezer).map((g) => ({
    key: g.key,
    label: g.key === 'fridge' && !fridge ? t('Milk, cheese & co.') : g.label(),
    items: staples()
      .filter((s) => g.cats.includes(s.cat))
      .map((s) => {
        const name = stapleName(s);
        const p = productByName(name);
        if (p) used.add(p.id);
        return { key: s.key, name, product_id: p?.id ?? null, on: anyMarked ? Boolean(p?.runs_out) : Boolean(s.on) };
      }),
  })).filter((g) => g.items.length);
  const own = marked.filter((m) => !used.has(m.id));
  return { mode: stockMode(), groups, own, suggestions: runsOutSuggestions(), count: marked.length };
}

/**
 * Save the picker: the given staples and products are "runs out regularly", everything else is not.
 * New staples are created as fill-level products and assumed full – people tap "low" when it runs low.
 */
export function saveStaples(input: { keys: string[]; product_ids: number[] }, actor?: string) {
  const want = new Set<number>();
  let created = 0;
  db.transaction(() => {
    const keys = new Set(input.keys);
    for (const s of staples()) {
      if (!keys.has(s.key)) continue;
      const name = stapleName(s);
      let id = productByName(name)?.id;
      if (!id) {
        id = createProduct({ name, categoryId: categoryIdByKey(s.cat as CategoryKey), trackMode: 'level' });
        created++;
        adjustStock({ productId: id, set: 3, reason: 'inventory', actor, silent: true });
      }
      want.add(id);
    }
    for (const id of input.product_ids) if (getProduct(id)) want.add(id);
    const ids = JSON.stringify([...want]);
    db.prepare(`UPDATE products SET runs_out = 0 WHERE runs_out = 1 AND id NOT IN (SELECT value FROM json_each(?))`).run(ids);
    db.prepare(`UPDATE products SET runs_out = 1 WHERE id IN (SELECT value FROM json_each(?))`).run(ids);
  })();
  emit('products', 'stock');
  return { count: want.size, created };
}

export function setRunsOut(productId: number, on: boolean) {
  if (!getProduct(productId)) throw err(404, t('Product not found'));
  db.prepare('UPDATE products SET runs_out = ? WHERE id = ?').run(on ? 1 : 0, productId);
  emit('products', 'stock');
  return { ok: true };
}

export function setMode(mode: StockMode) {
  setStockMode(mode);
  emit('products', 'stock', 'settings');
  return startModeInfo();
}

export function startModeInfo() {
  const counts = db.prepare('SELECT SUM(runs_out = 1) AS staples, COUNT(*) AS products FROM products WHERE archived = 0').get() as { staples: number | null; products: number };
  return { mode: stockMode(), staples: counts.staples ?? 0, products: counts.products };
}

export { isTrackedProduct };
