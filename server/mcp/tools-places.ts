/** MCP tools (area: home): the household's places as a tree with climate, household form and home preset. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { CLIMATES, FORMS, PRESETS, PlaceError, createPlace, homeSnapshot, setHomeSetup, updatePlace } from '../lib/places.js';
import { norm } from '../lib/text.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const err = (msg: string) => ({ ...text({ error: msg }), isError: true });

/** A place by id or (part of its) name. */
function findPlace(ref: string | number): number | null {
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return (db.prepare('SELECT id FROM locations WHERE id = ?').pluck().get(Number(ref)) as number | undefined) ?? null;
  const rows = db.prepare(`SELECT id, name FROM locations WHERE kind != 'unassigned'`).all() as { id: number; name: string }[];
  const n = norm(String(ref));
  return (rows.find((r) => norm(r.name) === n) ?? rows.find((r) => norm(r.name).includes(n)))?.id ?? null;
}

const run = (fn: () => unknown) => {
  try {
    return text(fn());
  } catch (e) {
    if (e instanceof PlaceError) return err(e.message);
    throw e;
  }
};

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'get_home_setup',
    {
      title: 'Home setup',
      description:
        'Who lives here (household form: single, couple, family, shared flat), how they live (preset: flat, terraced, house, shared, other – may be unset) and all places as a tree ' +
        'with their climate (ambient = room temperature, chilled, frozen). Use it before suggesting to freeze something or naming a fridge: only places listed here exist.',
      inputSchema: {},
      annotations: RO,
    },
    async () => text(homeSnapshot()),
  );

  s.registerTool(
    'set_household_form',
    {
      title: 'Set household form',
      description: 'Store who lives in the household (single, couple, family, shared) and optionally how they live. Only changes defaults and wording in the app, never data.',
      inputSchema: { form: z.enum(FORMS).optional(), preset: z.enum(PRESETS).nullable().optional() },
      annotations: RW,
    },
    async ({ form, preset }) => run(() => setHomeSetup({ form, preset })),
  );

  s.registerTool(
    'add_place',
    {
      title: 'Add a place',
      description:
        'Add a place where things are kept – a room, a shelf, a device (e.g. "Keller", then "Gefriertruhe" inside it). Give the climate for fridges (chilled) and freezers (frozen); without it, it is detected from the name.',
      inputSchema: {
        name: z.string().min(1).max(60),
        inside: z.union([z.string(), z.number()]).optional().describe('parent place (name or id)'),
        climate: z.enum(CLIMATES).optional(),
      },
      annotations: RW,
    },
    async ({ name, inside, climate }) =>
      run(() => {
        const parent = inside !== undefined ? findPlace(inside) : null;
        if (inside !== undefined && !parent) throw new PlaceError(`There is no place "${inside}"`, 404);
        return { id: createPlace({ name, parent_id: parent, climate: climate ?? null }) };
      }),
  );

  s.registerTool(
    'update_place',
    {
      title: 'Change a place',
      description: 'Rename a place, move it inside another one (or to the top with inside=null), set its climate, or archive it (hidden from pickers; stored things stay visible).',
      inputSchema: {
        place: z.union([z.string(), z.number()]),
        name: z.string().min(1).max(60).optional(),
        inside: z.union([z.string(), z.number()]).nullable().optional(),
        climate: z.enum(CLIMATES).optional(),
        archived: z.boolean().optional(),
      },
      annotations: RW,
    },
    async ({ place, name, inside, climate, archived }) =>
      run(() => {
        const id = findPlace(place);
        if (!id) throw new PlaceError(`There is no place "${place}"`, 404);
        let parent: number | null | undefined;
        if (inside === null) parent = null;
        else if (inside !== undefined) {
          parent = findPlace(inside);
          if (!parent) throw new PlaceError(`There is no place "${inside}"`, 404);
        }
        return updatePlace(id, { name, parent_id: parent, climate, archived });
      }),
  );
}
