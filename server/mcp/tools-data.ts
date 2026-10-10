/** MCP tools: Data, backups, members & security */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { backupNow } from '../lib/backup.js';
import { householdMembers } from '../lib/data.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] });

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'backup_now',
    {
      title: 'Back up now',
      description:
        'Take a consistent snapshot of the whole household database right now (stored on the server next to the nightly backups, and copied off-site if WebDAV is set up). Use before bigger changes, e.g. a large import or clean-up.',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async () => {
      const r = await backupNow('manual');
      console.log(`[backup] manual backup via MCP (${actorName}): ${r.name}`);
      return text({
        ok: true,
        backup: r.name,
        size_bytes: r.size,
        created_at: r.created_at,
        offsite: r.offsite ? (r.offsite.ok ? `copied as ${r.offsite.remote}` : `failed: ${r.offsite.error}`) : 'not configured',
      });
    },
  );

  s.registerTool(
    'household_members',
    {
      title: 'Household members',
      description: 'Who lives in this household: names and roles (admin or member). No e-mail addresses or other personal data.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => text(householdMembers()),
  );
}
