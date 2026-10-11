/** MCP tools: Shopping: store mode, offline, claims, quick add, web push, HA todo */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { claim, findStore, quickAdd, storeView, userByName } from '../lib/shop.js';
import { norm } from '../lib/text.js';
import { notPrivate } from '../lib/share-core.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'quick_add',
    {
      title: 'Quick add to the shopping list',
      description:
        'Adds items written in natural language, e.g. "2 Milch, Paketband und 3 Dosen Tomaten" or "milk, 2 cans of tomatoes and bin bags". ' +
        'Quantities and units are parsed, items are matched to known products, and existing open items are not duplicated.',
      inputSchema: { text: z.string().min(1).max(2000).describe('one or more items, separated by commas, "and"/"und" or new lines') },
      annotations: RW,
    },
    async ({ text: input }) => {
      const added = quickAdd(input, actorName, 'assistant');
      return text({ added: added.filter((a) => a.created).map((a) => a.text), already_on_list: added.filter((a) => !a.created).map((a) => a.text) });
    },
  );

  s.registerTool(
    'claim_item',
    {
      title: 'Take care of it',
      description:
        'Marks that a household member takes care of a shopping item ("Till gets it") or a planned meal ("Lea cooks"). No points, just so nobody does it twice. ' +
        'Use release=true to remove the claim.',
      inputSchema: {
        kind: z.enum(['shopping', 'plan']).default('shopping'),
        item: z.union([z.number(), z.string()]).describe('id, or the item text / meal title (meals: the next planned one with that title)'),
        member: z.string().describe('name of the household member'),
        release: z.boolean().optional(),
      },
      annotations: RW,
    },
    async ({ kind, item, member, release }) => {
      const u = userByName(member);
      if (!u && !release) return text({ error: `No household member called "${member}".`, members: (db.prepare('SELECT name FROM users').all() as { name: string }[]).map((x) => x.name) });
      let id: number | null = typeof item === 'number' || /^\d+$/.test(String(item)) ? Number(item) : null;
      if (id === null) {
        const n = norm(String(item));
        if (kind === 'shopping') {
          const rows = db.prepare(`SELECT id, text FROM shopping_items WHERE checked_at IS NULL AND ${notPrivate()}`).all() as { id: number; text: string }[];
          id = (rows.find((r) => norm(r.text) === n) ?? rows.find((r) => norm(r.text).includes(n) || n.includes(norm(r.text))))?.id ?? null;
        } else {
          const rows = db.prepare(`SELECT id, title FROM meal_plan WHERE day >= date('now', '-1 day') ORDER BY day`).all() as { id: number; title: string }[];
          id = (rows.find((r) => norm(r.title) === n) ?? rows.find((r) => norm(r.title).includes(n)))?.id ?? null;
        }
      }
      if (id === null) return text({ error: `Nothing open matches "${item}".` });
      try {
        claim(kind, id, u?.id ?? null, !release);
        return text({ ok: true, kind, id, member: release ? null : u!.name });
      } catch (e) {
        return text({ error: (e as Error).message });
      }
    },
  );

  s.registerTool(
    'shopping_by_aisle',
    {
      title: 'Shopping list by aisle',
      description: "Open shopping items grouped by store section, in the walking order learned for a store (e.g. 'REWE', 'Aldi'). Also shows who takes care of what and where an item should be bought (buy_at, set by people). With a store, items marked for other stores come last in the section 'elsewhere'.",
      inputSchema: { store: z.string().optional().describe('store name; default order when omitted') },
      annotations: RO,
    },
    async ({ store }) => {
      const st = findStore(store ?? null);
      const v = storeView(st?.id ?? null);
      return text({
        store: v.store?.name ?? null,
        stores: v.stores.map((x) => x.name),
        sections: v.sections.map((g) => ({
          section: g.key,
          items: g.items.map((i) => ({ id: i.id, text: i.text, qty: i.qty ?? undefined, note: i.note ?? undefined, taken_care_of_by: i.claim?.name, buy_at: i.buy_at.length ? i.buy_at : undefined })),
        })),
        in_basket: v.basket.map((i) => i.text),
      });
    },
  );
}
