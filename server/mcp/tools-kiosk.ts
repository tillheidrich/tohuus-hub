/** MCP tools: Kitchen/wall display and e-ink image */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { displayStatus } from '../lib/kiosk.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] });

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'display_status',
    {
      title: 'Kitchen and wall displays',
      description:
        'Lists the household\'s read-only displays (kitchen tablet, hallway screen, e-ink frame): name, layout, widgets, night dimming and when each was last seen (page, image or JSON). Display links are secret and never returned; create or revoke them in Settings › Connections & devices › Displays & family tablet.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const list = displayStatus();
      return text({ displays: list, count: list.length, manage: 'Settings › Connections & devices › Displays & family tablet in the app' });
    },
  );
}
