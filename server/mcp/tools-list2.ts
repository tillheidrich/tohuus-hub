/** MCP tools: several lists, "Unsere Üblichen", the double-purchase check, trips going on, offers (list2). */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { LIST_KINDS, createList, guard, listLists, usuals } from '../lib/lists.js';
import { activeOffers } from '../lib/offers.js';
import { activeTrips } from '../lib/trips.js';
import { emit } from '../lib/bus.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'list_lists',
    {
      title: 'Shopping lists',
      description: 'All lists of the household (the main list plus e.g. "Baumarkt", "Drogerie", "Geschenke", "für Oma") with how many items are open. list_id 0 = main list.',
      inputSchema: {},
      annotations: RO,
    },
    async () => text(listLists().map((l) => ({ list_id: l.id, name: l.name, kind: l.kind, note: l.note, open: l.open }))),
  );

  s.registerTool(
    'create_list',
    {
      title: 'Create a list',
      description: 'Creates another list next to the main one (store: a shop like the hardware store; gifts; care: for someone you look after; other).',
      inputSchema: { name: z.string().min(1).max(60), kind: z.enum(LIST_KINDS).default('other'), note: z.string().max(200).nullable().optional() },
      annotations: RW,
    },
    async ({ name, kind, note }) => {
      const l = createList({ name, kind, note: note ?? null });
      emit('shopping');
      return text({ created: { list_id: l.id, name: l.name, kind: l.kind } });
    },
  );

  s.registerTool(
    'usual_items',
    {
      title: 'Our usuals',
      description: 'What this household buys most often ("Unsere Üblichen"), most frequent first – good for "the usual weekly shop". Suggest; add only after the person agrees.',
      inputSchema: { limit: z.number().int().min(1).max(60).default(25) },
      annotations: RO,
    },
    async ({ limit }) => text(usuals(limit).map((u) => ({ name: u.name, times_bought: u.count }))),
  );

  s.registerTool(
    'check_before_adding',
    {
      title: 'Is it already there?',
      description: 'Before putting something on the list: is it already on a list, was it bought in the last days, is there some at home? Returns short hints; an empty list means nothing speaks against adding it.',
      inputSchema: { item: z.string().min(1).max(120), list_id: z.number().int().min(0).default(0) },
      annotations: RO,
    },
    async ({ item, list_id }) => text({ item, hints: guard({ text: item, listId: list_id }).map((h) => ({ kind: h.kind, text: h.text })) }),
  );

  s.registerTool(
    'shopping_trips',
    {
      title: 'Who is shopping right now',
      description: 'Shopping trips going on now (someone ticking things in a shop): who, which shop, what is already in the basket. Private trips and discreet items are never shown.',
      inputSchema: {},
      annotations: RO,
    },
    async () =>
      text(activeTrips(null).map((tr) => ({ who: tr.user.name, shop: tr.store?.name ?? null, since: tr.startedAt, in_basket: tr.basket.map((b) => b.text), asked_to_bring: tr.addOns.map((a) => ({ item: a.text, from: a.from, done: a.done })) }))),
  );

  s.registerTool(
    'current_offers',
    {
      title: 'Offers the household saved',
      description: 'Offers from flyers or price tags the household photographed or pasted (never from offer feeds), matched with the list and what is due.',
      inputSchema: {},
      annotations: RO,
    },
    async () => text(activeOffers().map((o) => ({ name: o.name, price: o.price, regular_price: o.regularPrice, size: o.size, shop: o.shop, valid_to: o.validTo, on_list: o.onList, due: o.due, hints: o.hints }))),
  );
}
