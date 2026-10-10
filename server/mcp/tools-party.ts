/** MCP tools: Party mode, live order board, kiosk display */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listProducts } from '../lib/catalog.js';
import { setOrderStatus } from '../lib/orders.js';
import { defaultMenu, endParty, liveParty, openPartyOrders, partyView, startParty } from '../lib/party.js';
import { norm } from '../lib/text.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

function hostView() {
  const p = liveParty();
  if (!p) return { running: false };
  const v = partyView(p);
  return {
    running: true,
    id: v.id,
    name: v.name,
    started_at: v.started_at,
    ends_at_utc: v.ends_at,
    auto_end_at_utc: v.auto_end_at,
    auto_end_reason: v.auto_end_reason,
    guest_url: v.guest_url,
    board_url: v.board_url,
    tv_pairing: v.pair_code ? { open: v.pair_url, code: v.pair_code } : null,
    menu: v.menu.map((m) => ({ product_id: m.product_id, name: m.name, max_per_guest: m.max_per_guest, left: m.left })),
    orders_total: v.orders_total,
    open_orders: openPartyOrders(p.id).map((o) => ({
      id: o.id,
      guest: o.guest_name,
      status: o.status,
      since_utc: o.created_at,
      items: o.lines.map((l: any) => `${l.qty}× ${l.name}${l.options?.length ? ` (${l.options.join(', ')})` : ''}${l.note ? ` – "${l.note}"` : ''}`),
      note: o.note,
    })),
  };
}

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'start_party',
    {
      title: 'Start party',
      description:
        'Starts party mode: a short-lived guest link (QR) bound to the party, a party menu, a TV board and an automatic end. ' +
        'Without products the menu is every bar item. Returns the guest link, the board link and a 4-digit code for pairing a TV at <base>/party.',
      inputSchema: {
        name: z.string().max(60).optional().describe('e.g. "Lea\'s 35th", "Barbecue"'),
        hours: z.number().min(0.5).max(48).optional().describe('Planned duration, default 5'),
        idle_minutes: z.number().int().min(0).max(600).optional().describe('End automatically after this many minutes without orders, default 90; 0 = off'),
        products: z.array(z.union([z.number().int(), z.string()])).optional().describe('Party menu: product ids or names. Default: all bar items.'),
        max_per_guest: z.number().int().min(1).max(99).optional().describe('Optional limit per guest and item, e.g. 2 ice creams'),
        show_names: z.boolean().optional().describe('Show guest names on the TV board (default false)'),
      },
      annotations: RW,
    },
    async ({ name, hours, idle_minutes, products, max_per_guest, show_names }) => {
      let items = defaultMenu();
      const unknown: string[] = [];
      if (products?.length) {
        const all = listProducts();
        items = [];
        for (const ref of products) {
          const p = typeof ref === 'number' ? all.find((x) => x.id === ref) : all.find((x) => norm(x.name) === norm(ref)) ?? all.find((x) => norm(x.name).includes(norm(ref)));
          if (p) items.push({ product_id: p.id, max_per_guest: null });
          else unknown.push(String(ref));
        }
      }
      if (max_per_guest) items = items.map((i) => ({ ...i, max_per_guest }));
      try {
        startParty({ name: name ?? 'Party', hours: hours ?? 5, idle_min: idle_minutes, items, show_names }, actorName);
      } catch (e) {
        return text({ error: (e as Error).message, current: hostView() });
      }
      return text({ ...hostView(), ...(unknown.length ? { not_found: unknown } : {}) });
    },
  );

  s.registerTool(
    'end_party',
    { title: 'End party', description: 'Ends the running party now. The guest link stops working; open orders stay in the app.', inputSchema: {}, annotations: RW },
    async () => {
      const p = liveParty();
      if (!p) return text({ running: false, note: 'No party is running.' });
      endParty(p.id, 'manual');
      return text({ ended: p.name, open_orders_left: openPartyOrders(p.id).length });
    },
  );

  s.registerTool(
    'party_status',
    { title: 'Party status', description: 'Is a party running? Name, end time, links, menu with what is left, and all open orders (new / in progress).', inputSchema: {}, annotations: RO },
    async () => text(hostView()),
  );

  s.registerTool(
    'set_order_status',
    {
      title: 'Set order status',
      description: 'Moves an order (party or sofa) along: accepted = being made, done = served/ready (books counted items out of stock), declined.',
      inputSchema: { order_id: z.number().int(), status: z.enum(['new', 'accepted', 'done', 'declined']) },
      annotations: RW,
    },
    async ({ order_id, status }) => {
      const o = setOrderStatus(order_id, status);
      return text(o ? { ok: true, order_id, status } : { error: 'Order not found' });
    },
  );
}
