/**
 * MCP tool for wish lists (13 Oct 2026), read-only. An MCP connection has no person behind it, so it sees household
 * lists only and never reservations, "bought", who reserved or "wer könnte das schenken" (wish-policy.ts) – the
 * person a list is for might be the one asking.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wishList, wishLists } from '../lib/wishes.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'wish_lists',
    {
      title: 'Wish lists',
      description: 'Wish lists the whole household shares ("Wünsche von Mika", "Merkliste Kekse") with their wishes, links and prices. Private lists and reservations are never shown.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const v = { userId: null, name: actorName, tokenRead: true };
      return text(
        wishLists(v).map((l) => ({
          name: l.name,
          for: l.for_name,
          wishes: wishList(l.id, v).items.map((i) => ({ title: i.title, note: i.note, price: i.price, priority: i.priority, links: i.links.map((k) => ({ label: k.label ?? k.site, url: k.url, price: k.price })) })),
        })),
      );
    },
  );
}
