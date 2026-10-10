/** MCP tools: Spending analytics: charts, periods, budgets, include/exclude, manual expenses */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { addExclusion, addExpense, removeExclusionFor, setBudget, spendStats, budgetStatus, listBudgets, type ExclusionScope } from '../lib/spend2.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const err = (msg: string) => ({ ...text({ error: msg }), isError: true });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const day = z.string().regex(/^\d{4}-\d\d-\d\d$/);

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'spending_stats',
    {
      title: 'Spending statistics for a period',
      description:
        'Household spending from applied receipts plus manual expenses, for a week, month, year, all time or a custom range, in the household currency (`currency`). Returns the counted total, goods vs deposit, discounts saved, amounts marked "not counted" (summed separately with reasons), totals by category and by store (with average basket), top items, bars over time, the comparison with the previous period and the same period last year, and budget progress with a forecast to the end of the period. Weeks start on the region\'s first weekday.',
      inputSchema: {
        period: z.enum(['week', 'month', 'year', 'all', 'custom']).describe('week | month | year | all | custom (custom needs from and to)'),
        date: day.optional().describe('Any day inside the wanted week/month/year (YYYY-MM-DD), default today'),
        from: day.optional().describe('Start day for period=custom'),
        to: day.optional().describe('End day for period=custom (inclusive)'),
        tag: z.string().optional().describe('Only entries with this tag, e.g. "Party"'),
      },
      annotations: RO,
    },
    async ({ period, date, from, to, tag }) => {
      try {
        if ((from || to) && period !== 'custom') period = 'custom';
        const st = spendStats({ period, date, from, to, tag });
        const timeline = st.timeline.filter((b) => b.total || b.excluded);
        return text({ ...st, timeline, top: st.top.slice(0, 8), by_category: st.by_category.slice(0, 15), by_store: st.by_store.slice(0, 10) });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  s.registerTool(
    'set_budget',
    {
      title: 'Set or remove a spending budget',
      description:
        'Optional budget per month or week – overall (no category) or for one category, e.g. "Snacks & Süßes" 40 per month. amount null removes it. The household gets a gentle notification at 80 % and 100 % (event budget.warning) unless notify is false. Returns all budgets with current progress.',
      inputSchema: {
        amount: z.number().positive().nullable().describe('Amount in the household currency, or null to remove'),
        category: z.string().optional().describe('Category name; leave out for an overall budget'),
        period: z.enum(['month', 'week']).optional().describe('Default month'),
        notify: z.boolean().optional().describe('Send a note at 80 % / 100 % (default true)'),
      },
      annotations: RW,
    },
    async ({ amount, category, period, notify }) => {
      try {
        setBudget({ amount, category: category ?? null, period: period ?? 'month', notify });
        return text({ budgets: listBudgets(), status: budgetStatus() });
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  s.registerTool(
    'exclude_from_stats',
    {
      title: 'Exclude from (or include again in) spending statistics',
      description:
        'Mark something as "not counted" in the spending statistics, with a reason (e.g. bought for the business, a gift, party shopping). scope: line (receipt line id), receipt (import id), product (product id or name), category (name), store (name), expense (manual expense id). Excluded amounts stay visible, greyed and summed separately. Set include=true to count it again. Products and stock are not changed.',
      inputSchema: {
        scope: z.enum(['line', 'receipt', 'product', 'category', 'store', 'expense']),
        ref: z.union([z.string(), z.number()]).describe('Id for line/receipt/expense, id or name for product, name for category/store'),
        reason: z.string().optional().describe('Short reason, e.g. "Business"'),
        include: z.boolean().optional().describe('true = count it again'),
      },
      annotations: RW,
    },
    async ({ scope, ref, reason, include }) => {
      try {
        let r: string | number = ref;
        if (scope === 'product' && typeof ref === 'string' && !/^\d+$/.test(ref)) {
          const p = db.prepare('SELECT id FROM products WHERE lower(name) = lower(?) OR lower(name) LIKE lower(?) ORDER BY length(name) LIMIT 1').get(ref, `%${ref}%`) as { id: number } | undefined;
          if (!p) return err(`Product "${ref}" not found`);
          r = p.id;
        }
        if (include) {
          removeExclusionFor(scope as ExclusionScope, r);
          return text({ ok: true, counted_again: { scope, ref: r } });
        }
        return text(addExclusion(scope as ExclusionScope, r, reason ?? null, actorName));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );

  s.registerTool(
    'add_expense',
    {
      title: 'Add a manual expense',
      description: 'Record an expense without a receipt (farmers\' market, bakery paid cash, a fair) so it shows up in the spending statistics. Amount in the household currency.',
      inputSchema: {
        amount: z.number().positive(),
        day: day.optional().describe('YYYY-MM-DD, default today'),
        store: z.string().optional().describe('Where, e.g. "Wochenmarkt"'),
        category: z.string().optional(),
        note: z.string().optional(),
        tags: z.array(z.string()).optional().describe('e.g. ["Urlaub"]'),
      },
      annotations: RW,
    },
    async (input) => {
      try {
        return text(addExpense(input, actorName));
      } catch (e) {
        return err((e as Error).message);
      }
    },
  );
}
