# Recipe import and export

ToHuus Hub takes recipes from wherever a family keeps them. All bulk paths end in the same function (`bulkImport()` in [`server/lib/recipes2.ts`](../server/lib/recipes2.ts)), so a recipe looks the same no matter how it came in, and an export can be imported again without changes.

Importing is for members, admins and full-access tokens. Permanent guests at level `recipes` or `family` may import as well, but they only see the *Cook* screen, not *Settings › Recipes*. Guest links can never import.

## Ways in

| Source | Where | Notes |
|---|---|---|
| A ToHuus recipe package (zip with `rezepte.json` + `bilder/`, or the JSON) | *Cook › Recipes › Upload recipe package (Kochen › Rezepte › Rezeptpaket hochladen)* | The open bulk format with photos and appliance steps – see [recipe-package.md](recipe-package.md). Also the export (`GET /api/recipes/package.zip`). |
| A link to a recipe page | *Cook › + Recipe › Link (Kochen › + Rezept › Link)* | Reads the schema.org `Recipe` data most recipe sites publish (JSON-LD, including `@graph`, `HowToSection`, ISO durations). Pages without it are read by the vision model, if one is configured. Sites that block the request get a clear message. |
| A post on Instagram, TikTok, Pinterest or YouTube | *Share › Save as recipe*, or paste the link in *Cook › + Recipe › Link* | Only what is public without a login: the caption that is shared along, oEmbed/og metadata, a public schema.org card (Pinterest). A caption with a recipe is read by the model (counted as `importAi`); without AI it is split by hand. A video without recipe text becomes a stub with title, link and the public still image. See [AI and social imports](#ai-and-social-imports). |
| Photos (up to 6, e.g. front and back of a HelloFresh card) | *Cook › + Recipe › Photo* | Needs a vision model (`VISION_*`). Without one, send the photo to your AI assistant over MCP. |
| Text | *Cook › + Recipe › Text* | Needs a vision model, which also reads text. |
| Blank | *Cook › + Recipe › Blank* | Type it in. |
| A file from another app | *Settings › Recipes › Import from another app (Einstellungen › Rezepte › Aus einer anderen App importieren)* | Format is detected; see the table below. Files up to 100 MB. You get a preview and pick which recipes to import. |
| A JSON file | *Settings › Recipes › Import file (Datei importieren)* | Our own export or any schema.org JSON. |
| Any AI chat | *Settings › Recipes › Import with any AI (Mit jeder KI importieren)* | Copy a ready-made prompt, give the chat a photo, a cookbook page or text, paste the answer back. See [AI template](#ai-template). |
| TheMealDB | *Settings › Recipes › Find recipes in an open database (Rezepte in einer offenen Datenbank finden)* | Free public database in English. Search with English words. |
| Cookidoo week plan | Home Assistant | Through the Home Assistant Cookidoo integration. See [home-assistant.md](home-assistant.md#cookidoo). |
| Share menu | *Share (Teilen) › Save as recipe* | A shared link or text. |
| MCP | `save_recipe`, `recipes_import_bulk`, `recipes_search_open`, `recipes_import_open` | See [mcp.md](mcp.md). |
| HTTP API | `POST /api/recipes/import/bulk` | See [Bulk JSON](#bulk-json). |

### Formats from other apps

| App | What to upload |
|---|---|
| ToHuus Hub | `recipes.json` from *Export recipes* |
| Mealie | a recipe JSON, the zip export, or a `database.json` backup |
| Tandoor | the export zip (a zip of zips with `recipe.json`) |
| Paprika | `.paprikarecipes` (a zip of gzipped JSON) |
| Nextcloud Cookbook | a zip of the recipe folders (`recipe.json` + `full.jpg`) |
| KitchenOwl | the export JSON |
| Grocy | recipes, recipe positions and products as returned by the Grocy API |
| TheMealDB | its JSON |
| Any web page | saved HTML with JSON-LD |
| CSV | one row per recipe; columns are matched by name in English, German or Swedish: `name`/`title`, `description`, `ingredients`, `instructions`/`steps`, `servings`/`yield`, `time`, `prep time`, `cook time`, `url`, `image`, `tags`/`category`, `id`, `thermomix` |

Photos inside a file (Paprika, Nextcloud, Tandoor, Mealie zip) are stored right away. Photo links (from every path: files, bulk, AI paste, TheMealDB, link import, the Cookidoo week sync, MCP) are kept on the recipe as `image_url` and downloaded in the background through the same network-safe fetch as everything else, scaled to at most 1600 px on the long side. Until the local copy exists, the app shows the photo from its link (the API's `image_path` falls back to it; `image_local` says which one it is). Cookidoo photos are fetched as the 876×720 variant Cookidoo itself uses instead of the 4000 px original. Downloads send a browser User-Agent, `Accept: image/*` and the recipe page as Referer, wait up to 25 s, retry timeouts, 429 and 5xx with backoff, and log one line per host and reason (`[images] download failed: …`). A failed photo never fails the recipe; it is retried on the next start, at most three times.

*Settings › Recipes › Recipe photos (Rezeptfotos)* shows loaded / waiting / failed with the reasons. **Load missing photos (Fehlende Fotos nachladen)** gives every missing photo three fresh tries (`POST /api/recipes/import/images/retry`). If the server cannot reach the photo host at all, **Load photos through this browser (Fotos über diesen Browser laden)** loads them in the logged-in browser (as `<img crossorigin>` plus canvas, so the page's `connect-src 'self'` stays; needs the host to allow CORS, which Cookidoo's CDN does) and uploads them (`GET /api/recipes/import/images/missing`, `POST /api/recipes/import/images/:id`, only fills missing photos). Status: `GET /api/recipes/import/images`.

### Open recipe database (TheMealDB)

Ingredient lines are translated into the household language with a small built-in dictionary and converted to the region's units (cups, oz and lb become g and ml in metric regions; spoons become EL/TL or msk/tsk). The English line stays visible as "original". Steps stay in English; nothing is sent to a translation service.

### Cookidoo

Cookidoo has no public API. With the Home Assistant *Cookidoo* integration, its "My Week" shows up as a calendar, and ToHuus Hub turns the planned dishes into plan entries. A dish is matched to an existing recipe by name. Otherwise ToHuus Hub reads the public Cookidoo page the calendar entry links to (title, photo, ingredients), or creates a stub with the title and cooking time that you can complete later with a link import. Cookidoo recipes imported through the bulk paths without steps are marked `instructions_available: false`: the steps stay on Cookidoo, and the recipe page links there.

## AI and social imports

All model calls go through `server/lib/vision.ts` → `server/lib/ai.ts` (central AI switch, Mistral pin) and count
against the plan's `importAi` allowance (HTTP 429 `quota.importAi` when used up). Code: `server/lib/recipe-ai-import.ts`.

| Path | Model? | What happens |
|---|---|---|
| Link to a recipe site (`POST /api/recipes/import/url` `{ url }`) | only as fallback | schema.org JSON-LD first; pages without it are read by the text model. Answer `{ id, ai }`. |
| Social link (`POST /api/recipes/import/url` `{ url, text? }` or `POST /api/recipes/import/social` `{ url, text? }`) | only for a caption with a recipe | `text` = what the share sheet brought along. Public data only: YouTube/TikTok oEmbed, og:title/og:description/og:image, a public JSON-LD recipe. Login walls are detected and ignored; no comments, feeds or anything behind a login. Answer `{ id, platform, incomplete, ai, existed }` – `incomplete: true` = title, link and still image only; `existed: true` = this post was saved before (tracking parameters removed). |
| Photos (`POST /api/recipes/import/photo`, multipart `files` ≤ 6) | yes | cookbook page, handwritten note, screenshot, photo of a Thermomix or other appliance display → ingredients, steps and appliance steps (`tm: { device, time, temp, speed, mode }`). |
| Cookidoo in ToHuus Cloud | never contacts Cookidoo | `POST /api/recipes/import/url` answers **409** `{ code: "cookidoo_confirm", draft }`. The app shows the draft (`POST /api/recipes/import/cookidoo/draft` `{ url, text? }` → `{ url, external_id, title, ingredients: [] }`, the title from the shared text), the person pastes the ingredients or lets ToHuus read their own screenshot (`POST /api/recipes/import/cookidoo/read`, multipart `files` ≤ 4 → `{ title, ingredients, servings }`, needs AI, nothing saved), then saves (`POST /api/recipes/import/cookidoo` `{ url, title, ingredients[], servings?, time_min? }` → `{ id, created }`). Stored: title, link, ingredients, `instructions_available: false`, no steps, no photo. The recipe page offers "Zum Kochen in Cookidoo öffnen" and suggests an own photo of the dish. Every other import path drops Cookidoo steps and photos in the cloud as well. Self-hosted servers keep the public-page import described above. |

## Re-importing

Importing the same recipes again updates them instead of creating duplicates. A recipe is matched by `source_type` plus `external_id`, then by its link. Sources that usually bring no id of their own (Mealie, Tandoor, Paprika, Nextcloud, KitchenOwl, Grocy, CSV, plain JSON, AI) are matched by title; the preview says "update" for those.

An update replaces the original recipe only (title, ingredients, steps, times and so on). These stay as they are: the household's own version and swap rules, ratings and the cooking log, the favourite flag, notes, and a photo you picked by hand.

## Bulk JSON

`POST /api/recipes/import/bulk` with a session cookie or `Authorization: Bearer <full-access token>`. The body is an array of recipes, or an object with `recipes`, `items`, `data` or `@graph` holding the array, or a single recipe. At most 1000 recipes per request. The import runs synchronously and answers:

```json
{ "created": 2, "updated": 1, "images": 3, "failed": 0, "errors": [], "ids": [41, 42, 17] }
```

Each `errors` entry has `index`, `title` and `error`.

### Recipe shape

A schema.org `Recipe` with a few extensions. Only `name` is required, plus at least ingredients, steps or a `url`.

| Field | Type | Meaning |
|---|---|---|
| `name` (or `title`) | string | Title, up to 200 characters. |
| `description` | string | Short text. |
| `image` | URL, ImageObject or array | Photo to download. |
| `recipeYield` | string, number or array | "4 servings", "Serves 4", 4. |
| `totalTime`, `prepTime`, `cookTime` | ISO 8601 duration or minutes | `PT1H15M`. Total wins; otherwise prep + cook. |
| `recipeIngredient` | string[] | One line per ingredient as written. Up to 150. |
| `ingredients_structured` | object[] | Optional. Same order as `recipeIngredient`: `section`, `name`, `amount` (number), `unit`, `note`, `original`. Without `recipeIngredient`, lines are built from these. |
| `recipeInstructions` | string, string[], HowToStep[] or HowToSection[] | Steps. Sections become step headings. Up to 120 steps. |
| `keywords`, `recipeCategory`, `recipeCuisine`, `tags` | string or string[] | Tags. |
| `collections` | string[] | Collections (up to 8), also used as tags. |
| `nutrition` | NutritionInformation | Kept as is. |
| `url` | URL | Source link. |
| `source_type` | string | Where it came from, e.g. `url`, `cookidoo`, `mealie`, `ai`, `json`. Detected when missing. |
| `external_id` | string | The source's own id, for re-imports. |
| `thermomix` | boolean | Detected from Cookidoo links and steps like "Stufe 2" or "Varoma" when missing. |
| `instructions_available` | boolean | `false` when steps live elsewhere (Cookidoo). |
| `notes` | string | Household notes. |
| `favorite` | boolean | Mark as favourite. |

### Example

```json
[
  {
    "@type": "Recipe",
    "name": "Creamy tomato pasta",
    "description": "Quick weekday pasta.",
    "recipeYield": "4 servings",
    "totalTime": "PT25M",
    "recipeIngredient": ["400 g pasta", "1 can chopped tomatoes (400 g)", "100 ml cream", "1 onion", "1 garlic clove", "salt, pepper"],
    "ingredients_structured": [
      { "section": null, "name": "pasta", "amount": 400, "unit": "g", "note": null },
      { "section": null, "name": "chopped tomatoes", "amount": 1, "unit": "can", "note": "400 g" },
      { "section": null, "name": "cream", "amount": 100, "unit": "ml", "note": null },
      { "section": null, "name": "onion", "amount": 1, "unit": null, "note": null },
      { "section": null, "name": "garlic clove", "amount": 1, "unit": null, "note": null },
      { "section": null, "name": "salt, pepper", "amount": null, "unit": null, "note": null }
    ],
    "recipeInstructions": [
      { "@type": "HowToStep", "text": "Cook the pasta." },
      { "@type": "HowToStep", "text": "Fry onion and garlic, add tomatoes and cream, simmer 10 minutes." },
      { "@type": "HowToStep", "text": "Mix with the pasta and season." }
    ],
    "keywords": "pasta, vegetarian, quick",
    "recipeCategory": "Main course",
    "source_type": "ai",
    "external_id": null,
    "thermomix": false
  }
]
```

```bash
curl -X POST https://your-host/api/recipes/import/bulk \
  -H "Authorization: Bearer sw_…" -H "Content-Type: application/json" \
  --data @recipes.json
```

## AI template

*Import with any AI* shows a prompt in the household language (English or German) that contains the example above. It asks the chat to answer with only a JSON array in that shape, keep the recipe's language, invent nothing, split ingredients into amount, unit, name and note, use `HowToSection` for recipes with parts, keep Thermomix settings in the step text, and set `source_type: "ai"`.

Paste the whole answer back. Code fences and chatter around the JSON are stripped. You get the same preview as for a file.

The prompt and the example are also available as JSON at `GET /api/recipes/import/ai-template`.

## Export

*Settings › Recipes › Export recipes (Rezepte exportieren)* downloads all recipes as one JSON file in the shape above (`GET /api/recipes/export.json`, optional `?ids=1,2,3`; MCP: `recipes_export`). Recipes without an outside source get `external_id: "tohuus-<id>"`, so importing the file into the same or another ToHuus Hub updates instead of duplicating. The household's own versions and ratings are not part of the export.
