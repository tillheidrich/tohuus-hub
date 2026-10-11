/** MCP tools: Guided tour, demo-data start and data reset (read-only on purpose – resets only happen in the app). */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listBackups } from '../lib/backup.js';
import { dataOverview } from '../lib/tour.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] });

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'data_overview',
    {
      title: 'Household data overview',
      description:
        'Read-only overview of what is stored in this household: row counts per area (stock & products, recipes & plan, shopping & orders, receipts & spending, other household data, places), which tables are always kept (members, logins, settings, integrations), whether demo data is still present and the latest backup. ' +
        'There is deliberately no tool to delete data – removing demo data or starting over is done by an admin in the app under Settings › Data & backups, with an automatic backup first.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const o = dataOverview();
      const last = listBackups()[0] ?? null;
      return text({
        areas: Object.fromEntries(Object.entries(o.scopes).map(([k, v]) => [k, { rows: v.rows, tables: v.tables.length }])),
        counts: o.counts,
        always_kept: o.kept,
        demo_data: o.demo.rows
          ? { present: true, demo_products: o.demo.products, demo_recipes: o.demo.recipes, used_since: o.demo.used, how_to_remove: 'Settings › Data & backups › Remove demo data (admin)' }
          : { present: false },
        last_backup: last ? { name: last.name, kind: last.kind, day: last.day } : null,
      });
    },
  );
}
