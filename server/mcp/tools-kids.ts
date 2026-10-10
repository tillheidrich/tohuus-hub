/** MCP tools: Kid mode: picture ordering with parent approval */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answerWish, listWishes } from '../lib/kids.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'kid_wishes',
    {
      title: 'Kid wishes waiting for a parent',
      description:
        'Lists wishes that kids made on their kid tablet ("I would like an apple") and that still wait for a parent. ' +
        'Each has an id, the kid, the item and when it was made (UTC). Answer them with answer_kid_wish.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      text(
        listWishes('pending').map((w) => ({ id: w.id, kid: w.kid_name, item: w.name, qty: w.qty, since_utc: w.created_at })),
      ),
  );

  s.registerTool(
    'answer_kid_wish',
    {
      title: 'Answer a kid wish',
      description:
        'Approve or decline a kid wish. Approving turns it into a normal order on the order board (someone brings it); ' +
        'declining shows the kid a friendly "maybe later". A wish that was already answered stays as it is.',
      inputSchema: {
        wish_id: z.number().int().describe('id from kid_wishes'),
        answer: z.enum(['approve', 'decline']),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ wish_id, answer }) => {
      try {
        return text(answerWish(wish_id, answer, actorName));
      } catch (e) {
        return { ...text(`Error: ${(e as Error).message}`), isError: true };
      }
    },
  );
}
