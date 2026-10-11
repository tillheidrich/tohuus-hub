/** MCP tools: Share target, discreet entries, start mode */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { matchProduct } from '../lib/catalog.js';
import { userByName } from '../lib/shop.js';
import { addHidden, setMode, setPrivacy, setRunsOut, shareTextToList, staplesPicker, startModeInfo } from '../lib/share.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const members = () => (db.prepare('SELECT name FROM users ORDER BY id').all() as { name: string }[]).map((x) => x.name);

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'share_text_to_list',
    {
      title: 'Put shared text on the shopping list',
      description:
        'Takes text as it was shared from another app – a WhatsApp message, a forwarded chat excerpt with timestamps, a bulleted or checkbox list, ' +
        'a note – cleans it up (chat prefixes, bullets, emoji, headings, links) and adds every item to the shopping list. ' +
        'Links are only reported back (a recipe link should be imported with the recipe import tool).',
      inputSchema: {
        text: z.string().min(1).max(10000).describe('the shared text, as is'),
        url: z.string().max(2000).optional().describe('a shared link, if any'),
      },
      annotations: RW,
    },
    async ({ text: input, url }) => {
      const r = shareTextToList({ text: input, url: url ?? null }, { name: actorName }, 'assistant');
      return text({ added: r.added, already_on_list: r.already, links: r.urls, message: r.message });
    },
  );

  s.registerTool(
    'add_discreet_item',
    {
      title: 'Add a discreet or private shopping item',
      description:
        'Adds an item for one household member without showing its name to everyone. ' +
        '"private": only that member (and the members listed in also_visible_to) see it at all. ' +
        '"discreet": everyone sees a neutral placeholder such as "Drugstore item"; with reveal_to_shopper=true whoever is shopping is shown the real name. ' +
        'The real name is never returned by any tool, Home Assistant, Telegram, displays or printed tickets – only the member sees it in the app.',
      inputSchema: {
        text: z.string().min(1).max(500).describe('the item(s), e.g. "Kondome" or "birthday present for Lea"'),
        member: z.string().describe('the household member it belongs to'),
        visibility: z.enum(['private', 'discreet']).default('discreet'),
        reveal_to_shopper: z.boolean().optional().describe('discreet only: show the real name to whoever is shopping'),
        placeholder: z.string().max(60).optional().describe('what everyone else sees instead (default: a neutral word by aisle)'),
        also_visible_to: z.array(z.string()).max(10).optional().describe('private only: other members who may see it'),
      },
      annotations: RW,
    },
    async ({ text: input, member, visibility, reveal_to_shopper, placeholder, also_visible_to }) => {
      const u = userByName(member);
      if (!u) return text({ error: `No household member called "${member}".`, members: members() });
      const share = (also_visible_to ?? []).map((n) => userByName(n)?.id).filter((x): x is number => Boolean(x));
      try {
        const added = addHidden({ text: input, owner: { userId: u.id, name: u.name }, visibility, reveal: reveal_to_shopper, placeholder, share_with: share });
        // only the placeholders go back – the assistant may be shared by the whole household
        return text({ ok: true, added: added.map((a) => ({ id: a.id, shown_to_others_as: visibility === 'private' ? null : a.placeholder })), owner: u.name, visibility });
      } catch (e) {
        return text({ error: (e as Error).message });
      }
    },
  );

  s.registerTool(
    'make_item_discreet',
    {
      title: 'Hide an item on the shopping list',
      description:
        'Turns a visible shopping item into a discreet or private one for a member (by item id from the shopping list). ' +
        'Items that are already discreet or private can only be changed by their owner in the app; making them visible again is not possible here.',
      inputSchema: {
        item_id: z.number().int(),
        member: z.string().describe('the member who will own it'),
        visibility: z.enum(['private', 'discreet']).default('discreet'),
        reveal_to_shopper: z.boolean().optional(),
        placeholder: z.string().max(60).optional(),
      },
      annotations: RW,
    },
    async ({ item_id, member, visibility, reveal_to_shopper, placeholder }) => {
      const u = userByName(member);
      if (!u) return text({ error: `No household member called "${member}".`, members: members() });
      if (db.prepare('SELECT 1 FROM share_items WHERE item_id = ?').get(item_id)) return text({ error: 'This item is already discreet or private – its owner can change it in the app.' });
      try {
        setPrivacy(item_id, { visibility, reveal: reveal_to_shopper, placeholder }, { userId: u.id, name: u.name });
        const row = db.prepare('SELECT text FROM shopping_items WHERE id = ?').get(item_id) as { text: string } | undefined;
        return text({ ok: true, owner: u.name, visibility, shown_to_others_as: visibility === 'private' ? null : row?.text });
      } catch (e) {
        return text({ error: (e as Error).message });
      }
    },
  );

  s.registerTool(
    'discreet_items_overview',
    {
      title: 'Discreet and private items',
      description: 'How many discreet/private items are open per member, with the placeholders others see. Never returns real names.',
      inputSchema: {},
      annotations: RO,
    },
    async () => {
      const rows = db
        .prepare(
          `SELECT x.visibility, u.name AS owner, s.text AS placeholder, s.qty FROM share_items x
           JOIN shopping_items s ON s.id = x.item_id LEFT JOIN users u ON u.id = x.owner_id
           WHERE s.checked_at IS NULL ORDER BY u.name, s.created_at`,
        )
        .all() as { visibility: string; owner: string | null; placeholder: string; qty: number | null }[];
      return text({
        private: rows.filter((r) => r.visibility === 'private').reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.owner ?? '?']: (acc[r.owner ?? '?'] ?? 0) + 1 }), {}),
        discreet: rows.filter((r) => r.visibility === 'discreet').map((r) => ({ owner: r.owner, shown_as: r.placeholder, qty: r.qty })),
      });
    },
  );

  s.registerTool(
    'start_mode',
    {
      title: 'Start mode: only what runs out',
      description:
        'Reads or sets how much the household tracks. "staples": only products marked as regularly running out are tracked – no warnings, ' +
        'no counting for anything else (data is kept). "full": everything is tracked. Without mode, it only reports the current state and the picker.',
      inputSchema: { mode: z.enum(['full', 'staples']).optional() },
      annotations: RW,
    },
    async ({ mode }) => {
      if (mode) return text(setMode(mode));
      const p = staplesPicker();
      return text({
        ...startModeInfo(),
        marked: [...p.groups.flatMap((g) => g.items.filter((i) => i.on).map((i) => i.name)), ...p.own.map((o) => o.name)],
        suggested_from_receipts: p.suggestions.map((x) => ({ id: x.id, name: x.name, bought_on_days: x.times })),
      });
    },
  );

  s.registerTool(
    'mark_runs_out',
    {
      title: 'Mark a product as "runs out regularly"',
      description: 'Marks (or unmarks) a product as one the household regularly runs out of. In the start mode "only what runs out" only these are tracked.',
      inputSchema: { product: z.union([z.number(), z.string()]).describe('product id or name'), on: z.boolean().default(true) },
      annotations: RW,
    },
    async ({ product, on }) => {
      const m = typeof product === 'number' ? null : matchProduct(product);
      const id = typeof product === 'number' ? product : m && m.score >= 0.6 ? m.productId : null;
      if (!id) return text({ error: `No product found for "${product}".` });
      try {
        setRunsOut(id, on);
        const p = db.prepare('SELECT name FROM products WHERE id = ?').get(id) as { name: string };
        return text({ ok: true, product: p.name, runs_out: on });
      } catch (e) {
        return text({ error: (e as Error).message });
      }
    },
  );
}
