/** MCP tools: More notification channels: Telegram (two-way), Gotify, Matrix */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { rateLimited } from '../lib/auth.js';
import { configuredChannels, sendHouseholdMessage } from '../lib/channels.js';
import { userByName } from '../lib/shop.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'send_household_message',
    {
      title: 'Send a message to the household',
      description:
        'Sends a short text to the household\'s own configured channels (Telegram chats linked in ToHuus Hub, Gotify, Matrix room) – e.g. "Dinner is at 7" or a reminder. ' +
        'It cannot message anyone else: there are no recipient addresses, only the channels set up under Settings › Notifications. ' +
        'Optionally limit it to one member (their linked Telegram chat only) or to certain channels. Returns which channels delivered it.',
      inputSchema: {
        text: z.string().min(1).max(2000).describe('the message, plain text'),
        member: z.string().max(40).optional().describe('only this household member (Telegram private chat); omit for everyone'),
        channels: z.array(z.enum(['telegram', 'gotify', 'matrix'])).optional().describe('limit to these channels; omit for all configured ones'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ text: body, member, channels }) => {
      const available = configuredChannels();
      if (!available.length) return text({ error: 'No household channel is set up (Settings › Notifications › Channels).', configured: [] });
      if (rateLimited(`mcp-hhmsg:${actorName}`, 20, 60 * 60_000)) return text({ error: 'Too many messages in the last hour – try again later.' });
      let memberId: number | undefined;
      if (member) {
        const u = userByName(member);
        if (!u) return text({ error: `No household member called "${member}".` });
        memberId = u.id;
      }
      try {
        return text(await sendHouseholdMessage({ text: body, from: actorName, channels, memberId }));
      } catch (e) {
        return text({ error: (e as Error).message, configured: available });
      }
    },
  );
}
