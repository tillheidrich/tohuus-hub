/** MCP tools: Home care: maintenance cycles, spending, QR labels */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { matchProduct } from '../lib/catalog.js';
import { CARE_TEMPLATES, completeCareTask, createCareTask, findCareTask, listCareTasks } from '../lib/care.js';
import { currentMonth, priceHistory, spendingSummary } from '../lib/spending.js';
import { entitlement } from '../lib/plans.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const err = (msg: string) => ({ ...text({ error: msg }), isError: true });

function compactTask(x: ReturnType<typeof listCareTasks>[number]) {
  return {
    id: x.id,
    name: x.name,
    every: x.interval_n && x.interval_unit ? `${x.interval_n} ${x.interval_unit}${x.interval_n > 1 ? 's' : ''}` : 'fixed date',
    next_due: x.next_due,
    status: x.state,
    days_left: x.days,
    last_done: x.last_done,
    taken_on_by: x.assignee?.name,
    uses_product: x.product ? `${x.product.name} (${x.product.stock ?? 0} in stock)` : undefined,
    location: x.location?.name,
    note: x.note ?? undefined,
  };
}

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'list_care_tasks',
    {
      title: 'List home care tasks',
      description:
        'Recurring household maintenance and deadlines (water filter, smoke detector test, descaling, tyres, passport expiry, contract renewals …) with next due date and status (overdue, today, soon, ok). Use due_only for "what is due?".',
      inputSchema: { due_only: z.boolean().optional().describe('Only tasks that are overdue, due today or due soon') },
      annotations: RO,
    },
    async ({ due_only }) => {
      const list = listCareTasks({ outside: true }).filter((x) => !due_only || ['overdue', 'today', 'soon'].includes(x.state));
      return text({ tasks: list.map(compactTask), templates_available: CARE_TEMPLATES.map((t) => t.key) });
    },
  );

  s.registerTool(
    'complete_care_task',
    {
      title: 'Mark a home care task as done',
      description:
        'Records that a care task was done (e.g. "I changed the water filter"). Moves the next due date by the interval; if the task uses up a product (filter cartridge) one is taken from stock and it goes on the shopping list when none is left. For fixed-date tasks (passport) pass the new date as next_due.',
      inputSchema: {
        task: z.union([z.number(), z.string()]).describe('Task id or name, e.g. "water filter"'),
        done_on: z.string().regex(/^\d{4}-\d\d-\d\d$/).optional().describe('YYYY-MM-DD, default today'),
        next_due: z.string().regex(/^\d{4}-\d\d-\d\d$/).optional().describe('Override the next due date (YYYY-MM-DD)'),
        note: z.string().max(500).optional(),
      },
      annotations: RW,
    },
    async ({ task, done_on, next_due, note }) => {
      const row = findCareTask(task);
      if (!row) return err(`No care task matches "${task}". Use list_care_tasks.`);
      const out = completeCareTask(row.id, actorName, { doneOn: done_on, nextDue: next_due, note });
      return text({ done: out.task.name, next_due: out.task.next_due, consumed_from_stock: out.consumed || undefined, put_on_shopping_list: out.on_shopping_list || undefined });
    },
  );

  s.registerTool(
    'add_care_task',
    {
      title: 'Add a home care task',
      description:
        `Adds a recurring task or a deadline. Either a template key (${CARE_TEMPLATES.map((t) => t.key).join(', ')}) or name + interval, or name + due_date for one-off deadlines (passport expiry, contract end). Optionally link a product that is used up each time.`,
      inputSchema: {
        name: z.string().max(120).optional(),
        template: z.string().optional(),
        every: z.number().int().min(1).max(1000).optional().describe('Interval number, e.g. 4'),
        unit: z.enum(['day', 'week', 'month', 'year']).optional().describe('Interval unit'),
        due_date: z.string().regex(/^\d{4}-\d\d-\d\d$/).optional().describe('Next due date / deadline (YYYY-MM-DD)'),
        last_done: z.string().regex(/^\d{4}-\d\d-\d\d$/).optional(),
        product: z.string().optional().describe('Product used up each time, e.g. "Brita Maxtra"'),
        location: z.string().optional(),
        remind_days_before: z.number().int().min(0).max(365).optional(),
        note: z.string().max(500).optional(),
      },
      annotations: RW,
    },
    async (a) => {
      let productId: number | null | undefined;
      if (a.product) {
        const m = matchProduct(a.product);
        productId = m && m.score >= 0.6 ? m.productId : undefined;
      }
      const loc = a.location ? (db.prepare('SELECT id FROM locations WHERE lower(name) LIKE lower(?)').get(`%${a.location.replace(/[%_]/g, '')}%`) as { id: number } | undefined) : undefined;
      try {
        const task = createCareTask({
          name: a.name,
          template: a.template ?? null,
          interval_n: a.every !== undefined ? a.every : a.template ? undefined : a.unit ? 1 : null,
          interval_unit: a.unit !== undefined ? a.unit : a.template ? undefined : null,
          next_due: a.due_date ?? null,
          last_done: a.last_done ?? null,
          product_id: productId,
          location_id: loc?.id ?? null,
          lead_days: a.remind_days_before ?? null,
          note: a.note ?? undefined,
        });
        return text({ created: compactTask(task), product_not_found: a.product && !productId ? a.product : undefined });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  s.registerTool(
    'spending_summary',
    {
      title: 'Spending summary',
      description: 'Grocery spending for one month from applied receipts and orders, in the household currency (see `currency`, set by the region): total, deposit, by store, by category, top items and price-change hints. No bank data – only what was imported.',
      inputSchema: { month: z.string().regex(/^\d{4}-\d\d$/).optional().describe('YYYY-MM, default current month') },
      annotations: RO,
    },
    async ({ month }) => {
      const sm = spendingSummary(month ?? currentMonth());
      return text({ ...sm, months: sm.months.slice(0, 6) });
    },
  );

  s.registerTool(
    'price_history',
    {
      title: 'Price history of a product',
      description: 'Unit prices paid for a product over time (from receipts), with the change compared to about three months ago.',
      inputSchema: { product: z.union([z.number(), z.string()]).describe('Product id or name') },
      annotations: RO,
    },
    async ({ product }) => {
      let id: number | null = typeof product === 'number' ? product : null;
      if (id === null) {
        const m = matchProduct(String(product));
        id = m && m.score >= 0.6 ? m.productId : null;
      }
      if (!id) return err(`No product matches "${product}".`);
      if (!entitlement('priceHistory')) return err('Price history is part of the Household plan or Plus.');
      const h = priceHistory(id);
      if (!h.product) return err('Product not found.');
      return text(h);
    },
  );
}
