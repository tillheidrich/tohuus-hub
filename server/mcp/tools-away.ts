import { t } from '../i18n.js';
/** MCP tools: away mode (trip / vacation) – status, start/stop, packing list, welcome-home list. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import type { TripRow } from '../lib/away-state.js';
import {
  PACK_TEMPLATES,
  addPackItem,
  applyTemplate,
  awaySummary,
  bookOut,
  checklist,
  createTrip,
  currentTrip,
  getTrip,
  packItems,
  stopTrip,
  tripView,
  updatePackItem,
  useUpList,
  welcomeList,
  welcomeToShopping,
} from '../lib/away.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const err = (msg: string) => ({ ...text({ error: msg }), isError: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The trip a tool means: the given id, or the current / next one. */
function tripFor(id?: number | null) {
  if (id) return getTrip(id) ?? null;
  return currentTrip()?.trip ?? null;
}

function compactTrip(id: number) {
  const tr = getTrip(id)!;
  const v = tripView(tr);
  // a hospital stay is health data: the assistant and MCP clients see only "away" (docs/away.md)
  const health = v.kind === 'hospital';
  return {
    id: v.id,
    name: health ? t('Away') : v.name,
    place: health ? null : v.place,
    from: v.start_day,
    to: v.end_day,
    phase: v.phase,
    travellers: v.travellers,
    staying_home: v.home,
    notifications_quiet: v.quiet,
    auto_suggestions_paused: v.pause_auto,
    holiday_kitchen: v.kitchen,
    use_up_days_before: v.use_up_days,
  };
}

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'get_trip_status',
    {
      title: 'Away mode: current trip',
      description:
        'The household\'s current or next trip (away / vacation mode): phase (planned, before = "use it up" days, during, after = welcome home), dates, who travels and who stays home, what would go off before the return, the short before-we-leave checklist and the welcome-home shopping suggestions.',
      inputSchema: {},
      annotations: RO,
    },
    async () => {
      const sum = awaySummary();
      if (!sum.trip) return text({ trip: null, suggestion: sum.suggestion, hint: 'No trip planned. Use start_trip to plan one.' });
      const tr = getTrip(sum.trip.id)!;
      return text({
        trip: compactTrip(tr.id),
        use_up_before_leaving: sum.phase === 'before' || sum.phase === 'planned' ? useUpList(tr).map((x) => ({ name: x.name, use_by: x.use_by, can_freeze: x.can_freeze })) : undefined,
        checklist: sum.phase === 'before' && tr.kind !== 'hospital' ? checklist(tr, undefined, true).map((c) => ({ item: c.text, detail: c.detail ?? undefined, done: c.done })) : undefined,
        welcome_home: sum.trip.welcome_ready ? welcomeList(tr).map((w) => ({ name: w.name, reason: w.reason, on_shopping_list: w.on_list })) : undefined,
        suggestion: sum.suggestion ?? undefined,
      });
    },
  );

  s.registerTool(
    'start_trip',
    {
      title: 'Start or plan a trip (away mode)',
      description:
        'Plans a trip or starts away mode now. Without "from" it starts today. While the trip runs, routine notifications (low stock, digest …) stay quiet, automatic shopping suggestions pause if nobody stays home, and the week plan leaves those evenings empty. In the days before, suggestions prefer what would otherwise go off. People not listed as travellers stay home; add others staying home (e.g. grandparents) in staying_home.',
      inputSchema: {
        name: z.string().max(80).optional().describe('e.g. "Summer at the sea"'),
        place: z.string().max(80).optional().describe('Where to'),
        from: day.optional().describe('First day away (YYYY-MM-DD); default today'),
        to: day.describe('Last day away (YYYY-MM-DD) – the day you come back'),
        travellers: z.array(z.string()).optional().describe('Names of who travels; default: all household members'),
        staying_home: z.array(z.string()).optional().describe('Others who stay at home, e.g. "Oma Inge"'),
        holiday_kitchen: z.boolean().optional().describe('Cooking at the holiday flat with its own meal plan and shopping list'),
      },
      annotations: RW,
    },
    async (a) => {
      try {
        const id = createTrip(
          { name: a.name, place: a.place ?? null, start_day: a.from, end_day: a.to, travellers: a.travellers, home: a.staying_home, kitchen: a.holiday_kitchen },
          actorName,
        );
        return text({ ok: true, trip: compactTrip(id) });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  s.registerTool(
    'stop_trip',
    {
      title: 'End the trip (we\'re back)',
      description: 'Ends the current trip today ("we\'re back early" or "we\'re home"); a trip that has not started yet is cancelled. Notifications return to normal; the welcome-home list stays available for a few days.',
      inputSchema: { trip_id: z.number().int().positive().optional() },
      annotations: RW,
    },
    async ({ trip_id }) => {
      const tr = tripFor(trip_id);
      if (!tr) return err('No trip found.');
      const v = stopTrip(tr.id);
      return text({ ok: true, trip: { id: v.id, name: v.kind === 'hospital' ? t('Away') : v.name, status: v.status, phase: v.phase, to: v.end_day } });
    },
  );

  s.registerTool(
    'trip_packing_list',
    {
      title: 'Trip packing list',
      description: `Shows or changes the packing list of the current trip. Actions: "view"; "add" (items as text, or from stock with product_id); "template" to add a ready-made list (${PACK_TEMPLATES.map((x) => x.key).join(', ')}); "packed" to tick items by id; "book_out" to take packed things from stock (snacks, sunscreen …) out of the stock count.`,
      inputSchema: {
        action: z.enum(['view', 'add', 'template', 'packed', 'book_out']).default('view'),
        trip_id: z.number().int().positive().optional(),
        items: z.array(z.string().max(100)).optional().describe('For "add": things to pack'),
        product_id: z.number().int().positive().optional().describe('For "add": a product from stock to take along'),
        qty: z.number().positive().optional(),
        template: z.string().optional().describe('For "template": basics, kids, beach, ski, city or baby'),
        item_ids: z.array(z.number().int().positive()).optional().describe('For "packed"'),
      },
      annotations: RW,
    },
    async (a) => {
      const tr = tripFor(a.trip_id);
      if (!tr) return err('No trip found. Plan one with start_trip first.');
      // a hospital stay is health data (what's packed says a lot): only in the app itself
      if (tr.kind === 'hospital') return err('This trip’s packing list is only in the ToHuus app.');
      try {
        if (a.action === 'add') {
          for (const x of a.items ?? []) addPackItem(tr.id, { text: x });
          if (a.product_id) addPackItem(tr.id, { product_id: a.product_id, qty: a.qty ?? 1 });
        } else if (a.action === 'template') {
          if (!a.template) return err('template is missing');
          applyTemplate(tr.id, a.template);
        } else if (a.action === 'packed') {
          for (const i of a.item_ids ?? []) updatePackItem(i, { done: true });
        } else if (a.action === 'book_out') {
          const r = bookOut(tr.id, actorName);
          return text({ ok: true, booked_out: r.booked, items: packItems(tr.id) });
        }
      } catch (e) {
        return err((e as Error).message);
      }
      return text({
        trip: tr.kind === 'hospital' ? t('Away') : tr.name,
        items: packItems(tr.id).map((i) => ({ id: i.id, text: i.text, packed: i.done, from_stock: i.product_id ? { product_id: i.product_id, qty: i.qty, booked_out: i.out_qty } : undefined })),
      });
    },
  );

  s.registerTool(
    'welcome_home_list',
    {
      title: 'Welcome-home shopping list',
      description:
        'What to buy on the way home after a trip: the household\'s usual fresh things plus whatever expired while away (nothing that is still good at home). With add_to_shopping_list=true the open suggestions go onto the normal shopping list.',
      inputSchema: { trip_id: z.number().int().positive().optional(), add_to_shopping_list: z.boolean().optional() },
      annotations: RW,
    },
    async ({ trip_id, add_to_shopping_list }) => {
      const tr = tripFor(trip_id) ?? lastTrip();
      if (!tr) return err('No trip found.');
      if (add_to_shopping_list) return text({ ok: true, ...welcomeToShopping(tr, null, actorName) });
      return text({ trip: tr.kind === 'hospital' ? t('Away') : tr.name, items: welcomeList(tr).map((w) => ({ name: w.name, reason: w.reason, on_shopping_list: w.on_list })) });
    },
  );
}

/** The most recent trip, also after the welcome-home days (for "what should we buy, we just got back"). */
function lastTrip() {
  return (db.prepare(`SELECT * FROM away_trips WHERE status != 'cancelled' AND start_day <= date('now') ORDER BY end_day DESC, id DESC LIMIT 1`).get() as TripRow | undefined) ?? null;
}
