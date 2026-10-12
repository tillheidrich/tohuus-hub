/**
 * MCP tool for Hausinfo (house-guide.ts): how things in the home work – voice commands, routines, tips, emergency
 * spots, important numbers. Codes (door PIN, alarm, Wi-Fi password …) are never available here: the search sees
 * member-visible, finished cards only and every text is scrubbed of code values.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { guideOverviewForAi, searchGuide } from '../lib/house-guide.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'house_info',
    {
      title: 'Hausinfo (how things work at home)',
      description:
        'How things work in this home: voice commands (Alexa, Google, Siri, Home Assistant), routines, tips (heating, blinds, bins, washing machine, TV), ' +
        'where the fuse box or main water tap is, important numbers. Without a query: an overview by area. Never contains codes or passwords.',
      inputSchema: { query: z.string().max(200).optional().describe('e.g. "Licht im Flur", "Heizung", "Sicherungskasten"') },
      annotations: RO,
    },
    async ({ query }) => text(query?.trim() ? searchGuide(query, 8) : guideOverviewForAi()),
  );
}
