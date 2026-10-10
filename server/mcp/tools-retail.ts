/** MCP tools: More retailers, e-mail inbox for receipts, use-by vs best-before, waste value */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { wasteMonth } from '../lib/fresh.js';
import { checkInbox, inboxStatus, publicConfig } from '../lib/retail-inbox.js';
import { wasteValue } from '../lib/retail.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'check_receipt_inbox',
    {
      title: 'Check the receipt inbox',
      description:
        'Checks the household e-mail inbox for new digital receipts (PDF eBons, pickup notices, receipt mails) and imports them for review. Returns the result in plain language plus the ids of imports waiting for review. Mails are never deleted.',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async () => {
      const cfg = publicConfig();
      if (!cfg.configured) return text({ configured: false, message: 'The receipt inbox is not set up (Settings › Access & AI › Receipt inbox).', last: inboxStatus() });
      try {
        const st = await checkInbox({ force: true });
        return text({ configured: true, enabled: cfg.enabled, ...st, review_hint: st.imports.length ? 'Open the imports in the app or apply them with the import tools.' : undefined });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  s.registerTool(
    'waste_summary',
    {
      title: 'What was thrown away this month',
      description:
        'Household summary of food logged as thrown away in a month: items, reasons, a tip, and the estimated value in EUR from the latest known receipt prices. A shared household view – never attribute waste to a person.',
      inputSchema: { month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('YYYY-MM, default: current month') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ month }) => {
      try {
        const w = wasteMonth(month);
        const v = wasteValue(w.month);
        return text({
          month: w.month,
          count: w.count,
          items: w.items.map((x) => ({ name: x.name, qty: x.qty, times: x.times, reasons: x.reasons })),
          by_reason: w.by_reason,
          tip: w.tip,
          estimated_value_eur: v.value,
          items_without_known_price: v.unpriced,
          previous_month: w.previous,
        });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );
}
