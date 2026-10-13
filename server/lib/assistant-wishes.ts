/**
 * Assistant tools for wish lists (13 Oct 2026): "merk dir die Kekse aus dem Artikel", "was wünscht sich Mika?".
 *
 * Consent and privacy rules:
 *  - only for a person with an account (never guests, kid tablets, tokens) – `ctx.userId` is required;
 *  - wish_add writes only when the person asked for it in this message (tool description + system hint), into a list
 *    the person may see (default: their own private "Merkliste"); every add has an undo;
 *  - wish_lists returns what the person may see – never reservations, "bought", who reserved or "wer könnte das
 *    schenken": the model never gets those, so it cannot tell the person a wish is for;
 *  - links are fetched by the server (SSRF-safe, in the background), never by the model.
 */
import { db } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import type { ToolDef } from './ai.js';
import { addWish, listByName, wishList, wishLists } from './wishes.js';

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

export const WISH_TOOL_DEFS: ToolDef[] = [
  fn(
    'wish_add',
    'Note a wish or something to remember for later on a wish list (Merkliste) – only when the person asks for it now. Default list: their own Merkliste.',
    { title: { type: 'string' }, url: { type: 'string', description: 'link from the message, if any' }, note: { type: 'string' }, price: { type: 'number' }, list: { type: 'string', description: 'list name, e.g. "Wünsche von Mika"' } },
    ['title'],
  ),
  fn('wish_lists', 'Wish lists the person may see, with their wishes (no reservations).', { list: { type: 'string' } }),
];

export const WISH_TOOLS = ['wish_add', 'wish_lists'];

type Rec = (kind: string, summary: string, undo: unknown) => void;

export function runWishTool(ctx: { actor: string; userId: number | null }, name: string, a: any, record: Rec): unknown {
  if (name !== 'wish_add' && name !== 'wish_lists') return undefined;
  if (!ctx.userId) return { error: 'Only a signed-in member can use wish lists.' };
  const v = { userId: ctx.userId, name: ctx.actor };
  if (name === 'wish_lists') {
    const lists = typeof a.list === 'string' && a.list.trim() ? [wishLists(v).find((l) => l.id === listByNameOrNull(a.list, v))].filter(Boolean) : wishLists(v);
    return lists.slice(0, 8).map((l) => {
      const { items } = wishList(l!.id, v);
      return { list: l!.name, for: l!.for_name, wishes: items.slice(0, 25).map((i) => ({ title: i.title, price: i.price, note: i.note, links: i.links.length })) };
    });
  }
  const title = String(a.title ?? '').trim();
  if (!title) return { error: 'title missing' };
  const listId = listByName(typeof a.list === 'string' ? a.list : null, v);
  let url: string | null = null;
  if (typeof a.url === 'string' && /^https?:\/\//i.test(a.url.trim())) url = a.url.trim();
  try {
    const w = addWish(
      listId,
      { title, note: typeof a.note === 'string' ? a.note : null, price: typeof a.price === 'number' ? a.price : null, links: url ? [{ url }] : undefined },
      v,
    );
    const listName = wishLists(v).find((l) => l.id === listId)?.name ?? '';
    record('wish_add', t('“{title}” noted on {list}', { title, list: listName }), { kind: 'wish_delete', id: w.id });
    return { added: title, list: listName, link: Boolean(url) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function listByNameOrNull(name: string, v: { userId: number; name: string }) {
  const q = name.trim().toLowerCase();
  return wishLists(v).find((l) => l.name.toLowerCase().includes(q) || (l.for_name ?? '').toLowerCase() === q)?.id ?? null;
}

/** Undo of wish_add (called from assistant-tools.ts runUndo). */
export function undoWish(u: { kind?: string; id?: number }): boolean {
  if (u?.kind !== 'wish_delete' || !u.id) return false;
  db.prepare('DELETE FROM wish_items WHERE id = ?').run(u.id);
  emit('wishes');
  return true;
}
