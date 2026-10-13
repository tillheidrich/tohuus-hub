/** MCP tools: Recipe import from open databases, other apps and AI (area: recipes2) */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { lookupMealDb, mealToRecipe, randomMealDb, searchMealDb } from '../lib/open-recipes.js';
import { bulkImport, exportRecipes, MAX_BULK, SCHEMA_EXAMPLE, waitForImages } from '../lib/recipes2.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });
const RO_OPEN = { readOnlyHint: true, openWorldHint: true };
const RW_OPEN = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

export function register(s: McpServer, _actorName: string) {
  s.registerTool(
    'recipes_import_bulk',
    {
      title: 'Import many recipes at once',
      description:
        'Save up to 1000 recipes in one call. Each item is a schema.org Recipe-like object: name, description, image (URL), recipeYield, totalTime/prepTime (ISO 8601 like PT30M, or minutes), recipeIngredient (array of lines), optional ingredients_structured [{section,name,amount,unit,note}] in the same order, recipeInstructions (strings or HowToStep/HowToSection), keywords/recipeCategory, nutrition, url. Extensions: image_base64 (the photo itself, base64, ≤ 8 MB – when only you can see it), source_type (e.g. "cookidoo", "ai"), external_id (e.g. Cookidoo "r12345"), thermomix (boolean), collections (array), instructions_available (false when the steps only exist in the source app). Re-importing the same (source_type, external_id) or url updates the original recipe and never touches the household version or ratings. Photos are downloaded on the server. Returns counts {created, updated, images, failed} and the recipe ids. Example item: ' +
        JSON.stringify(SCHEMA_EXAMPLE[0]),
      inputSchema: {
        recipes: z.array(z.record(z.string(), z.any())).min(1).max(MAX_BULK),
        wait_for_images: z.boolean().optional().describe('wait (up to 60 s) until the photos are downloaded'),
      },
      annotations: RW_OPEN,
    },
    async (a) => {
      try {
        const out = await bulkImport(a.recipes);
        if (a.wait_for_images) await waitForImages(60000);
        return text({ created: out.created, updated: out.updated, images: out.images, failed: out.failed, errors: out.errors.slice(0, 20), recipe_ids: out.ids });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  s.registerTool(
    'recipes_search_open',
    {
      title: 'Search open recipe database',
      description:
        'Search TheMealDB (free, open, English) by dish name, e.g. "lasagne", "curry", "pancakes". Leave the query empty for one random idea. Returns ids, titles, photos, category and cuisine. Import a hit with recipes_import_open – ingredients are then translated into the household language and converted to its units.',
      inputSchema: { query: z.string().max(80).optional().describe('dish name in English') },
      annotations: RO_OPEN,
    },
    async (a) => {
      try {
        const results = a.query?.trim() ? await searchMealDb(a.query) : await randomMealDb();
        return text({ source: 'TheMealDB', results: results.map((r) => ({ id: r.id, title: r.title, category: r.category, cuisine: r.area, ingredients: r.ingredients, image: r.image })) });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  s.registerTool(
    'recipes_import_open',
    {
      title: 'Import a recipe from the open database',
      description: 'Save a TheMealDB recipe (id from recipes_search_open) into the household collection. Ingredient lines are translated into the household language with the English original kept; steps stay in English. Importing again updates it.',
      inputSchema: { id: z.string().regex(/^\d{1,10}$/) },
      annotations: RW_OPEN,
    },
    async (a) => {
      try {
        const m = await lookupMealDb(a.id);
        if (!m) return fail('Recipe not found.');
        const out = await bulkImport([mealToRecipe(m)]);
        if (!out.ids.length) return fail(out.errors[0]?.error ?? 'Import failed.');
        return text({ recipe_id: out.ids[0], created: out.created === 1, title: m.strMeal });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  s.registerTool(
    'recipes_export',
    {
      title: 'Export recipes as JSON',
      description: 'The household recipes in the same JSON shape recipes_import_bulk accepts (round trip). Optionally only some recipe ids. Household variants and ratings are not part of it.',
      inputSchema: { recipe_ids: z.array(z.number().int().positive()).max(1000).optional() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (a) => text(exportRecipes(a.recipe_ids)),
  );
}
