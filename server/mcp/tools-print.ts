/** MCP tools: Digital receipts/tickets and thermal/receipt printers */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { rateLimited } from '../lib/auth.js';
import { SEND_CHANNELS, availableChannels, findPrinter, listPrinters, printTicket, sendTicket } from '../lib/print.js';
import { userByName } from '../lib/shop.js';
import { TICKET_TYPES } from '../lib/tickets.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });

const TYPE_HELP =
  'shopping = shopping list grouped by aisle (optional store_id), order = ticket for a „Bring mir was“ wish from home or a guest (id = order id), ' +
  'care = home-care task with a "scan when done" QR (id = care task id), wish = kid wish (id = wish id), recipe = recipe card with the household variant (id = recipe id), ' +
  'week = week meal plan (optional day = start date YYYY-MM-DD), note = free fridge note (text, optional title), test = printer test page.';

const specShape = {
  type: z.enum(TICKET_TYPES).describe(TYPE_HELP),
  id: z.number().int().positive().optional().describe('id of the order / care task / wish / recipe'),
  store_id: z.number().int().positive().optional().describe('shopping list: sort by this store’s walking order'),
  text: z.string().max(1200).optional().describe('note: the text to print'),
  title: z.string().max(40).optional().describe('note: optional heading (default "Fridge note")'),
  day: z
    .string()
    .regex(/^\d{4}-\d\d-\d\d$/)
    .optional()
    .describe('week: first day, default today'),
};

const NEEDS_ID = new Set(['order', 'care', 'wish', 'recipe']);

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'print_ticket',
    {
      title: 'Print a ticket on the receipt printer',
      description:
        'Prints a receipt-style ticket ("Bon") on one of the household’s thermal receipt printers (ESC/POS over the network). ' +
        'Use it for "print the shopping list", "print a fridge note saying …", "print the kitchen ticket for order 12". ' +
        'Uses the default printer unless `printer` names another one. No prices – these are household tickets, not cash receipts.',
      inputSchema: { ...specShape, printer: z.string().max(40).optional().describe('printer name; omit for the default printer') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ printer, ...spec }) => {
      if (!listPrinters().length) return text({ error: 'No printer is set up yet (Settings › Connections & devices › Printers).' });
      if (NEEDS_ID.has(spec.type) && !spec.id) return text({ error: `Ticket type "${spec.type}" needs an id.` });
      if (rateLimited(`mcp-print:${actorName}`, 30, 60 * 60_000)) return text({ error: 'Too many prints in the last hour – try again later.' });
      const p = findPrinter(printer ?? null);
      if (!p) return text({ error: `No printer called "${printer}".`, printers: listPrinters().map((x) => x.name) });
      try {
        return text(await printTicket({ ...spec, from: actorName }, { printer: p, actor: actorName }));
      } catch (e) {
        return text({ error: (e as Error).message });
      }
    },
  );

  s.registerTool(
    'send_ticket',
    {
      title: 'Send a ticket as a digital receipt',
      description:
        'Renders a receipt-style ticket as an image and sends it to the household’s own channels: telegram (photo to linked chats), matrix (image to the family room), ' +
        'gotify (text version) or email (image inline, to the household notification address or a member’s own address). ' +
        'It cannot send to arbitrary recipients. Optionally limit it to one member (their Telegram chat / their e-mail).',
      inputSchema: {
        ...specShape,
        channel: z.enum(SEND_CHANNELS).describe('telegram, matrix, gotify or email'),
        member: z.string().max(40).optional().describe('only this household member; omit for the household channel'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ channel, member, ...spec }) => {
      const ready = availableChannels();
      if (!ready[channel]) return text({ error: `${channel} is not set up.`, available: Object.entries(ready).filter(([, v]) => v).map(([k]) => k) });
      if (NEEDS_ID.has(spec.type) && !spec.id) return text({ error: `Ticket type "${spec.type}" needs an id.` });
      if (rateLimited(`mcp-sendticket:${actorName}`, 20, 60 * 60_000)) return text({ error: 'Too many tickets sent in the last hour – try again later.' });
      let memberId: number | null = null;
      if (member) {
        const u = userByName(member);
        if (!u) return text({ error: `No household member called "${member}".` });
        memberId = u.id;
      }
      try {
        return text(await sendTicket({ ...spec, from: actorName }, channel, { memberId, actor: actorName }));
      } catch (e) {
        return text({ error: (e as Error).message });
      }
    },
  );
}
