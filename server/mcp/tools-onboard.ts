/** MCP tools: Onboarding, help, what's new, polish */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { gettingStarted } from '../lib/onboard.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };

const HINTS: Record<string, string> = {
  home: 'Name the household, pick the language, who lives here (household form) and the places they want to manage – none are required (Settings › Household, Settings › Places).',
  invite: 'Invite the people who live here with a personal link (Settings › Members › Invite).',
  stock: 'Get first stock in: upload a REWE PDF or receipt photo, scan barcodes, or add the typical staples per room.',
  phone: 'Add the app to the phone home screen and turn on push notifications (Settings › Notifications).',
  recipe: 'Save a first recipe from a link, a photo or via this assistant (save_recipe).',
};

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'getting_started_status',
    {
      title: 'Getting started status',
      description:
        'What is already set up in this household and what is still missing (household name, members/invites, first stock, phone with push, first recipe), plus counts. Use it to help a new household get going, one next step at a time.',
      inputSchema: {},
      annotations: RO,
    },
    async () => {
      const g = gettingStarted(null);
      const missing = g.checklist.items.filter((i) => !i.done).map((i) => ({ step: i.key, how: HINTS[i.key] }));
      return text({
        household: g.household,
        new_household: g.newHousehold,
        setup_wizard: g.state.closed ? (g.state.skipped ? 'skipped' : 'finished') : g.state.started ? `in progress (step: ${g.state.step})` : 'not started',
        done: `${g.checklist.done} of ${g.checklist.total}`,
        done_steps: g.checklist.items.filter((i) => i.done).map((i) => i.key),
        missing,
        next_step: missing[0] ?? null,
        home: g.home,
        rooms: g.rooms.map((r) => r.name),
        counts: g.counts,
      });
    },
  );
}
