/** MCP tools: the order menu (what the family and guests can ask for in „Bring mir was“). */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listProducts } from '../lib/catalog.js';
import { AVAILABILITY, addItem, createGroup, findItemByName, menuView, optionSchema, setAvailability, updateItem } from '../lib/menu.js';
import { norm } from '../lib/text.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const compactItem = (i: ReturnType<typeof menuView>['groups'][number]['items'][number]) => ({
  id: i.id,
  name: i.name,
  source: i.source === 'stock' ? 'from stock' : 'menu-only',
  availability: i.availability,
  state: i.state,
  hint: i.hint,
  description: i.description,
  unit: i.unit,
  options: i.options.map((o) => `${o.group}: ${o.choices.join(' / ')}${o.multi ? ' (several)' : ''}${o.required ? ' (required)' : ''}${o.default.length ? ` [default ${o.default.join(', ')}]` : ''}`),
  ask_note: i.ask_note ? i.note_hint || true : false,
  ingredients: i.ingredients.map((x: any) => `${x.amount} ${x.unit} ${x.name}`),
});

function resolveItem(item: string | number) {
  if (typeof item === 'number' || /^\d+$/.test(String(item))) {
    const id = Number(item);
    return menuView().groups.flatMap((g) => g.items).find((i) => i.id === id) ?? null;
  }
  return findItemByName(String(item));
}

function resolveGroup(name: string | undefined) {
  if (!name) return undefined;
  const n = norm(name);
  const gs = menuView().groups;
  return (gs.find((g) => norm(g.name) === n) ?? gs.find((g) => norm(g.name).includes(n)))?.id;
}

function resolveProduct(q: string | number) {
  const all = listProducts().filter((p) => p.track_mode !== 'none');
  if (typeof q === 'number' || /^\d+$/.test(String(q))) return all.find((p) => p.id === Number(q)) ?? null;
  const n = norm(String(q));
  return all.find((p) => norm(p.name) === n) ?? all.find((p) => norm(`${p.brand ?? ''} ${p.name}`).includes(n)) ?? null;
}

const option = optionSchema.describe('A choice group, e.g. {group:"Milk", choices:["Cow’s milk","Oat milk"], multi:false, required:true, default:["Cow’s milk"]}');

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'menu_list',
    {
      title: 'List the order menu',
      description:
        'The household order menu (drinks, hot drinks, snacks, ice cream …) by group: each item with its source (from stock or menu-only), availability (available / hidden / family = only for family), current state (ok, few, out, maybe = an ingredient is low) and options.',
      inputSchema: {},
      annotations: RO,
    },
    async () => {
      const v = menuView();
      return text({ groups: v.groups.map((g) => ({ id: g.id, name: g.name, items: g.items.map(compactItem) })) });
    },
  );

  s.registerTool(
    'menu_add_item',
    {
      title: 'Add an item to the order menu',
      description:
        'Put something on the order menu. Either from stock (stock_product: name or id of a tracked product – it is marked out when stock runs out and serving books it out) or menu-only (name, e.g. "Cappuccino", "Tap water"). Menu-only items can list up to 3 ingredients from stock with a per-serving amount in that product’s unit (e.g. milk 0.15).',
      inputSchema: {
        name: z.string().max(80).optional().describe('Name of a menu-only item'),
        stock_product: z.union([z.string(), z.number()]).optional().describe('Name or id of a stock product to put on the menu instead'),
        group: z.string().max(40).optional().describe('Menu group, e.g. "Drinks" (created if missing; default: first group)'),
        description: z.string().max(200).optional(),
        unit: z.string().max(20).optional(),
        options: z.array(option).max(6).optional(),
        ask_note: z.boolean().optional().describe('Ask the person ordering for a note'),
        note_hint: z.string().max(80).optional().describe('e.g. "Which flavour?"'),
        availability: z.enum(AVAILABILITY).optional(),
        ingredients: z
          .array(z.object({ product: z.union([z.string(), z.number()]), amount: z.number().min(0) }))
          .max(3)
          .optional(),
      },
      annotations: RW,
    },
    async (a) => {
      try {
        const ingredients = a.ingredients?.map((i) => {
          const p = resolveProduct(i.product);
          if (!p) throw new Error(`No tracked stock product matches "${i.product}"`);
          return { product_id: p.id, amount: i.amount };
        });
        let id: number;
        // a group that doesn't exist yet is created
        const groupId = a.group ? (resolveGroup(a.group) ?? createGroup(a.group)) : undefined;
        if (a.stock_product !== undefined) {
          const p = resolveProduct(a.stock_product);
          if (!p) return text({ error: `No tracked stock product matches "${a.stock_product}"` });
          id = addItem({ source: 'stock', product_id: p.id, group_id: groupId, description: a.description, options: a.options, ask_note: a.ask_note, note_hint: a.note_hint, availability: a.availability, ingredients });
        } else {
          if (!a.name) return text({ error: 'Give either name (menu-only) or stock_product.' });
          id = addItem({ source: 'menu', name: a.name, group_id: groupId, description: a.description, unit: a.unit, options: a.options, ask_note: a.ask_note, note_hint: a.note_hint, availability: a.availability, ingredients });
        }
        const item = resolveItem(id);
        return text({ ok: true, item: item ? compactItem(item) : { id } });
      } catch (e) {
        return text({ error: (e as Error).message });
      }
    },
  );

  s.registerTool(
    'menu_update_item',
    {
      title: 'Change an order menu item',
      description: 'Change name, description, group, unit, options, note prompt, availability, what happens when it is out (mark or hide) or the ingredients from stock of a menu item. Only the given fields change.',
      inputSchema: {
        item: z.union([z.string(), z.number()]).describe('Menu item name or id'),
        name: z.string().max(80).optional(),
        description: z.string().max(200).nullable().optional(),
        group: z.string().max(40).optional(),
        unit: z.string().max(20).optional(),
        options: z.array(option).max(6).optional(),
        ask_note: z.boolean().optional(),
        note_hint: z.string().max(80).nullable().optional(),
        availability: z.enum(AVAILABILITY).optional(),
        when_out: z.enum(['mark', 'hide']).optional(),
        ingredients: z
          .array(z.object({ product: z.union([z.string(), z.number()]), amount: z.number().min(0) }))
          .max(3)
          .optional()
          .describe('Replaces the ingredient list; [] removes all'),
      },
      annotations: RW,
    },
    async (a) => {
      const it = resolveItem(a.item);
      if (!it) return text({ error: `No menu item matches "${a.item}"` });
      try {
        const ingredients = a.ingredients?.map((i) => {
          const p = resolveProduct(i.product);
          if (!p) throw new Error(`No tracked stock product matches "${i.product}"`);
          return { product_id: p.id, amount: i.amount };
        });
        const group_id = resolveGroup(a.group);
        if (a.group && !group_id) return text({ error: `No menu group matches "${a.group}"` });
        const id = updateItem(it.id, {
          name: a.name,
          description: a.description,
          group_id,
          unit: a.unit,
          options: a.options,
          ask_note: a.ask_note,
          note_hint: a.note_hint,
          availability: a.availability,
          when_out: a.when_out,
          ingredients,
        });
        const item = resolveItem(id);
        return text({ ok: true, item: item ? compactItem(item) : { id } });
      } catch (e) {
        return text({ error: (e as Error).message });
      }
    },
  );

  s.registerTool(
    'menu_set_availability',
    {
      title: 'Show or hide an order menu item',
      description: 'available = everyone can order it; hidden = nobody sees it; family = only household members, not guests.',
      inputSchema: {
        item: z.union([z.string(), z.number()]).describe('Menu item name or id'),
        availability: z.enum(AVAILABILITY),
      },
      annotations: RW,
    },
    async ({ item, availability }) => {
      const it = resolveItem(item);
      if (!it) return text({ error: `No menu item matches "${item}"` });
      setAvailability(it.id, availability);
      return text({ ok: true, item: it.name, availability });
    },
  );
}
