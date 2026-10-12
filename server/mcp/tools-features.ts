/** MCP tools: purchase rhythm, what ToHuus remembers, and the household context the built-in assistant uses. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { buildContext } from '../lib/assistant-context.js';
import { forget, isSensitive, MemoryError, remember } from '../lib/memory.js';
import { healthConsent } from '../lib/health-consent.js';
import { healthNoteHint } from '../lib/assistant-tools.js';
import { healthShareAllowed } from '../lib/people-signals.js';
import { rhythmList } from '../lib/rhythm.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const fail = (msg: string) => ({ ...text(`Error: ${msg}`), isError: true });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'purchase_rhythm',
    {
      title: 'Purchase rhythm',
      description:
        'How often the household buys each product, learned from receipts (by purchase date) and ticks on the shopping list – no stock needed. ' +
        'suggested=true means it is probably due now and not on the list. Only suggest; put it on the list only when the person agrees.',
      inputSchema: { due_only: z.boolean().default(false).describe('only what is due now'), limit: z.number().int().min(1).max(100).default(30) },
      annotations: RO,
    },
    async ({ due_only, limit }) => {
      const list = rhythmList().filter((r) => !r.muted && (!due_only || r.suggested));
      return text(
        list.slice(0, limit).map((r) => ({
          product_id: r.productId,
          name: r.name,
          every_days: r.everyDays,
          last_bought: r.lastBought,
          due_on: r.dueOn,
          confidence: r.confidence,
          origin: r.origin,
          suggested: r.suggested,
          on_list: r.onList,
        })),
      );
    },
  );

  s.registerTool(
    'remember',
    {
      title: 'Remember something about the household',
      description:
        'Stores a short fact, preference or routine the person asked ToHuus to remember ("we buy bread at the bakery", "Saturday is barbecue day"). ' +
        'Only when the person asks for it. Health details are stored as sensitive and are not shared with AI unless the household allows it.',
      inputSchema: {
        text: z.string().min(2).max(300),
        kind: z.enum(['fact', 'preference', 'routine']).default('fact'),
        person: z.string().max(20).optional().describe('person key from household_people when it is about one person'),
      },
      annotations: RW,
    },
    async (a) => {
      try {
        if (isSensitive(a.text) && !healthConsent()) return fail(healthNoteHint());
        const row = remember({ text: a.text, kind: a.kind, person: a.person ?? null, source: 'assistant', createdBy: actorName, confirmed: true });
        return text({ ok: true, id: row.id, sensitive: Boolean(row.sensitive) });
      } catch (e) {
        if (e instanceof MemoryError) return fail(e.message);
        throw e;
      }
    },
  );

  s.registerTool(
    'forget',
    {
      title: 'Forget something',
      description: 'Deletes something ToHuus remembers, by id (from household_context) or by its text.',
      inputSchema: { id: z.number().int().optional(), text: z.string().max(300).optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ id, text: q }) => {
      if (!id && !q) return fail('Pass id or text.');
      const removed = forget(id ?? q!);
      return removed.length ? text({ ok: true, forgotten: removed.map((r) => r.text) }) : fail('Nothing matching was found (or too many matches – use the id).');
    },
  );

  s.registerTool(
    'household_context',
    {
      title: 'Household context',
      description:
        'A short summary of the household right now: people with likes/dislikes, the open shopping list, what is probably due, the week plan, ' +
        'spending this month and what ToHuus remembers. Health data only when the household allowed sharing it.',
      inputSchema: {},
      annotations: RO,
    },
    async () => {
      const c = buildContext({ purpose: 'mcp', viewer: { name: actorName } });
      return text({ ...c.data, health_data_shared: healthShareAllowed() });
    },
  );
}
