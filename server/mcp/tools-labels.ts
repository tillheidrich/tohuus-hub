/** MCP tools: Freezer and leftover labels with QR codes */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { BOX_TYPES, LabelError, boxAction, boxesSummary, listBoxes, planBox, printBoxes, saveBoxes, undoBox } from '../lib/labels.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

async function guard<T>(fn: () => T | Promise<T>) {
  try {
    return text(await fn());
  } catch (e) {
    if (e instanceof LabelError) return fail(e.message);
    throw e;
  }
}

/** A box by its code, or the active box whose name matches best (oldest first). */
function findCode(ref: string): string | null {
  const s = ref.trim();
  const code = s.replace(/\s+/g, '').toUpperCase();
  if (/^[2-9A-HJ-KM-NP-Z]{8}$/.test(code) && db.prepare('SELECT 1 FROM label_boxes WHERE code = ?').get(code)) return code;
  const row = db
    .prepare(`SELECT code FROM label_boxes WHERE status = 'active' AND lower(name) LIKE lower(?) ESCAPE '\\' ORDER BY eat_by IS NULL, eat_by, id LIMIT 1`)
    .get(`%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as { code: string } | undefined;
  return row?.code ?? null;
}

const slim = (b: ReturnType<typeof listBoxes>[number]) => ({
  code: b.code,
  name: b.name,
  place: b.place,
  location: b.location,
  portions_left: b.left,
  made_on: b.made_on,
  eat_by: b.eat_by,
  days_left: b.days_left,
  state: b.state,
  made_by: b.made_by,
  url: b.url,
});

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'list_leftovers_and_frozen',
    {
      title: 'List leftovers and frozen portions',
      description:
        'Containers of leftovers and frozen portions that were put away (each has a short code and usually a QR label). ' +
        'Sorted by eat-by date, so what has to go first comes first. Also says what has to be taken out of the freezer for a planned meal.',
      inputSchema: { place: z.enum(['fridge', 'freezer']).optional().describe('Only the fridge or only the freezer compartment') },
      annotations: RO,
    },
    async ({ place }) =>
      guard(() => {
        const sum = boxesSummary();
        return {
          counts: sum.counts,
          boxes: listBoxes({ status: 'active', place: place ?? null }).map(slim),
          take_out_of_freezer: sum.thaw.map((x) => ({ day: x.day, meal: x.title, code: x.box.code })),
        };
      }),
  );

  s.registerTool(
    'save_leftovers',
    {
      title: 'Put leftovers away / freeze portions',
      description:
        'Records leftovers or portions put in the fridge or freezer compartment, books them into stock and creates a container code for a label. ' +
        'Give either a free-text name, a recipe id or a product id (for freezing something from stock). Eat-by is set automatically by type and place ' +
        '(cooked leftovers 3 days in the fridge, ~3 months frozen, cooked rice 1 day …) unless given.',
      inputSchema: {
        name: z.string().max(120).optional().describe('What it is, e.g. "Bolognese"'),
        recipe_id: z.number().int().optional(),
        product_id: z.number().int().optional().describe('A product from stock that gets portioned or frozen'),
        portions: z.number().positive().max(50).describe('Number of portions'),
        containers: z.number().int().min(1).max(12).optional().describe('Split the portions over this many boxes (default 1)'),
        place: z.enum(['fridge', 'freezer']).default('fridge'),
        type: z.enum(BOX_TYPES).optional().describe('Kind of food – decides the default eat-by'),
        eat_by: z.string().regex(/^\d{4}-\d\d-\d\d$/).optional(),
        print: z.boolean().optional().describe('Print the labels on the default receipt printer right away'),
      },
      annotations: RW,
    },
    async (a) =>
      guard(async () => {
        const boxes = saveBoxes(
          { name: a.name, recipe_id: a.recipe_id, product_id: a.product_id, portions: a.portions, boxes: a.containers, place: a.place, type: a.type, eat_by: a.eat_by, labelled: true },
          actorName,
        );
        let printed: unknown = null;
        if (a.print) printed = await printBoxes(boxes.map((b) => b.code), { actor: actorName }).catch((e: Error) => ({ ok: false, error: e.message }));
        return { saved: boxes.map(slim), printed };
      }),
  );

  s.registerTool(
    'mark_leftovers',
    {
      title: 'Mark a leftover container as eaten, thawed or thrown away',
      description:
        'Updates a container by its code (e.g. "K7PM3QXA") or name: "take" = one portion (or `portions`) taken, "eaten" = all gone, ' +
        '"thawed" = moved from the freezer compartment to the fridge with a short eat-by, "tossed" = thrown away. Stock is booked accordingly.',
      inputSchema: {
        container: z.string().describe('Container code or name'),
        action: z.enum(['take', 'eaten', 'thawed', 'tossed']),
        portions: z.number().positive().max(50).optional(),
      },
      annotations: RW,
    },
    async ({ container, action, portions }) =>
      guard(() => {
        const code = findCode(container);
        if (!code) throw new LabelError(`No container found for "${container}".`, 404);
        const r = boxAction(code, action, { portions, actor: actorName });
        return { message: r.message, container: slim(r.box) };
      }),
  );

  s.registerTool(
    'undo_leftovers_change',
    {
      title: 'Undo the last change to a leftover container',
      description: 'Reverts the last eaten/took/thawed/tossed on a container, including the stock booking.',
      inputSchema: { container: z.string().describe('Container code or name') },
      annotations: RW,
    },
    async ({ container }) =>
      guard(() => {
        const code = findCode(container) ?? container.replace(/\s+/g, '').toUpperCase();
        return slim(undoBox(code, actorName));
      }),
  );

  s.registerTool(
    'plan_leftovers',
    {
      title: 'Plan a meal from leftovers or the freezer',
      description: 'Adds "use the frozen bolognese" to the week plan for a day. Today shows a reminder to take it out of the freezer in time.',
      inputSchema: {
        container: z.string().describe('Container code or name'),
        day: z.string().regex(/^\d{4}-\d\d-\d\d$/),
        slot: z.enum(['mittag', 'abend']).default('abend').describe('mittag = lunch, abend = dinner'),
      },
      annotations: RW,
    },
    async ({ container, day, slot }) =>
      guard(() => {
        const code = findCode(container);
        if (!code) throw new LabelError(`No container found for "${container}".`, 404);
        return planBox(code, day, slot);
      }),
  );
}
