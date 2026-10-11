/** MCP tools: Profile pictures, child profiles, permanent guests, recipe ratings */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { favourites, findPersonKey, listPeople, personProfile, ratePerson, recipeRatings } from '../lib/people.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const fail = (msg: string) => ({ ...text(`Error: ${msg}`), isError: true });

function recipeId(recipe: string | number): number | null {
  if (typeof recipe === 'number') return db.prepare('SELECT id FROM recipes WHERE id = ?').get(recipe) ? recipe : null;
  const r =
    (db.prepare('SELECT id FROM recipes WHERE lower(title) = lower(?)').get(recipe.trim()) as { id: number } | undefined) ??
    (db.prepare(`SELECT id FROM recipes WHERE title LIKE ? ORDER BY length(title) LIMIT 1`).get(`%${recipe.trim()}%`) as { id: number } | undefined);
  return r?.id ?? null;
}

const LABEL: Record<number, string> = { 1: 'not for them', 2: 'not for them', 3: 'okay', 4: 'loved it', 5: 'loved it' };

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'household_people',
    {
      title: 'People in the household',
      description:
        'Everybody in the household: members, permanent guests (with what they can see) and children (no login). ' +
        'Includes likes, dislikes and allergies per person – respect allergies when suggesting meals.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      text(
        listPeople().map((p) => ({
          key: p.key,
          name: p.name,
          kind: p.kind,
          ...(p.birth_year ? { birth_year: p.birth_year } : {}),
          ...(p.guest ? { guest_access: p.guest.level, guest_access_until_utc: p.guest.override?.until ?? null } : {}),
          likes: p.prefs?.likes ?? [],
          dislikes: p.prefs?.dislikes ?? [],
          allergies: p.prefs?.allergies ?? [],
        })),
      ),
  );

  s.registerTool(
    'rate_recipe',
    {
      title: 'Rate a recipe for a person',
      description:
        'Store how much one person liked a dish: 1 = not for them, 3 = okay, 5 = loved it (2 and 4 are allowed too). ' +
        'Works for children as well ("Mila loved the pancakes"). Ratings gently steer meal suggestions. ' +
        'Pass rating null to remove the rating.',
      inputSchema: {
        recipe: z.union([z.string(), z.number()]).describe('recipe title or id'),
        person: z.string().describe('name of the person (e.g. "Mila") or a key from household_people'),
        rating: z.number().int().min(1).max(5).nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ recipe, person, rating }) => {
      const id = recipeId(recipe);
      if (!id) return fail(`No recipe matches "${recipe}".`);
      const key = findPersonKey(person);
      if (!key) return fail(`Nobody called "${person}" in this household. Use household_people.`);
      try {
        ratePerson(id, key, rating, actorName, 'mcp');
        const r = recipeRatings(id);
        return text({ ok: true, recipe_id: id, ratings: r.people.filter((p) => p.value).map((p) => ({ name: p.name, rating: p.value, meaning: LABEL[p.value!] })), average: r.avg });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  s.registerTool(
    'favourite_recipes',
    {
      title: 'Favourite recipes – family or one person',
      description:
        'Without a person: the family all-time favourites (rated well by the household) and the classics cooked most often. ' +
        'With a person: what they like, what they do not like and what was cooked for them most often.',
      inputSchema: { person: z.string().optional().describe('name or key; leave out for the whole family') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ person }) => {
      if (person) {
        const key = findPersonKey(person);
        if (!key) return fail(`Nobody called "${person}" in this household. Use household_people.`);
        const p = personProfile(key);
        const slim = (xs: { recipe_id: number; title: string }[]) => xs.map((x) => ({ id: x.recipe_id, title: x.title }));
        return text({
          person: p.person.name,
          likes: slim(p.likes),
          okay: slim(p.okay),
          does_not_like: slim(p.dislikes),
          cooked_for_them_most: p.most_cooked.map((m) => ({ id: m.recipe_id, title: m.title, times: m.meals })),
          allergies: p.person.prefs?.allergies ?? [],
        });
      }
      const f = favourites();
      return text({
        family_favourites: f.family.map((x) => ({ id: x.recipe_id, title: x.title, average: x.avg, ratings: x.n, cooked: x.cooked })),
        classics: f.classics.map((x) => ({ id: x.recipe_id, title: x.title, cooked: x.cooked })),
        per_person: f.people.filter((p) => p.top.length).map((p) => ({ name: p.name, top: p.top.map((x) => x.title) })),
      });
    },
  );
}
