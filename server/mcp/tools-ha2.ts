/** MCP tools: Home Assistant two-way logic (sync status, sync now, who is home) and the voice command guide */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { everyoneAway, ha2Overview, presence, syncNow } from '../lib/ha2.js';
import { voiceItems, voiceLinks, voiceSettings } from '../lib/ha2-voice.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };

function status() {
  const o = ha2Overview();
  return {
    transport: o.transport ?? 'not connected',
    integration: o.integration,
    topics: o.topics.map((tp) => ({
      topic: tp.topic,
      mode: tp.mode,
      entities: tp.entities.map((e) => ({ entity: e.entity_id, last_sync: e.status.at, error: e.status.error, linked_items: e.status.linked, conflicts_last_run: e.status.conflicts })),
    })),
    presence: o.settings.presence.enabled ? o.presence.map((p) => ({ person: p.name, member: p.user_name, home: p.home, since: p.since })) : 'off',
    notifications_via_ha: Object.entries(o.settings.notify).map(([uid, svc]) => ({ member: o.users.find((u) => String(u.id) === uid)?.name ?? uid, service: svc })),
    pending_operations: o.pending_ops,
    suggestions: o.proposals.map((p) => ({ topic: p.topic, suggested: p.mode, entities: p.entities, why: p.reason })),
  };
}

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'get_home_assistant_sync',
    {
      title: 'Home Assistant sync status',
      description:
        'How ToHuus Hub works together with Home Assistant per topic: shopping list ⇄ HA to-do lists, meal plan ⇄ HA calendars, due care tasks → an HA to-do list. Shows the mode per topic (two_way, from_ha = Home Assistant is the source, to_ha = ToHuus Hub is the source, off), the last sync, errors, presence (who is home) and the suggestions based on what Home Assistant already has.',
      inputSchema: {},
      annotations: RO,
    },
    async () => text(status()),
  );

  s.registerTool(
    'sync_home_assistant_now',
    {
      title: 'Sync with Home Assistant now',
      description: 'Runs the Home Assistant sync right away (shopping list, meal plan, care tasks – whatever is switched on) instead of waiting for the next automatic run. Returns the status afterwards.',
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async () => {
      const r = await syncNow();
      return text({ result: r, status: status() });
    },
  );

  s.registerTool(
    'who_is_home',
    {
      title: 'Who is home (Home Assistant)',
      description: 'Who is at home right now according to Home Assistant\'s people (person entities), mapped to household members, and whether everyone is away. Empty when presence is switched off in Settings › Connections & devices › Home Assistant.',
      inputSchema: {},
      annotations: RO,
    },
    async () => text({ people: presence().map((p) => ({ person: p.name, member: p.user_name, home: p.home, state: p.state, since: p.since })), everyone_away: everyoneAway() }),
  );

  s.registerTool(
    'list_voice_commands',
    {
      title: 'Voice commands for the babysitter page',
      description:
        'The voice commands shown to babysitters and house-sitters on the "Where is what?" guest page: devices and scenes they may control by voice (lights, blinds, heating, music, scenes – never locks, alarms, cameras or garage doors), with example phrases for the chosen assistant, and on which guest links the section is switched on.',
      inputSchema: {},
      annotations: RO,
    },
    async () => text({ assistant: voiceSettings().assistant, items: voiceItems().map((v) => ({ name: v.name, area: v.area, kind: v.domain, phrases: v.phrases })), guest_links_with_voice: voiceLinks().length }),
  );
}
