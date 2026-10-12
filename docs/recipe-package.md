# The ToHuus recipe package ("ToHuus-Rezeptpaket")

An open format for many recipes at once – to move a collection in, back it up, hand it to another household or
another app, or let any AI chat build it from cookbook pages, screenshots and notes. It is plain
[schema.org `Recipe`](https://schema.org/Recipe) JSON plus a few extensions, so other apps can read most of it
without knowing ToHuus.

Help article for people: <https://tohuus.heidrich-digital.de/hilfe/rezeptpaket.html> (slug `rezeptpaket`,
[help-slugs.md](help-slugs.md)). The general import shape and the other formats are in
[recipes-import.md](recipes-import.md).

## Two forms

1. **ZIP** (recommended, with photos)

   ```
   tohuus-rezeptpaket.zip
   ├── rezepte.json
   └── bilder/
       ├── linsencurry.jpg
       └── ruehrkuchen.webp
   ```

   `rezepte.json` sits at the root of the zip or inside one folder (a zipped folder works). `recipes.json` is accepted
   as well. Each recipe's `image` is a **relative path** inside the package (`"bilder/linsencurry.jpg"`) or a
   `https://` link.

2. **JSON only** – the same document as a `.json` file (or pasted). Relative photo paths are ignored there; photo
   links are downloaded in the background like every other import.

## Document

```json
{
  "format": "tohuus-rezeptpaket",
  "version": 1,
  "exported": "2026-10-12T18:00:00.000Z",
  "recipes": [ /* Recipe objects */ ]
}
```

A bare array of recipes (or a single recipe object) is accepted too; the wrapper is what ToHuus writes.

## Recipe

Everything from the bulk shape in [recipes-import.md › Recipe shape](recipes-import.md#recipe-shape) works
(`name`, `description`, `recipeYield`, `totalTime`/`prepTime`/`cookTime`, `recipeIngredient`,
`ingredients_structured`, `recipeInstructions` with `HowToStep`/`HowToSection`, `keywords`, `recipeCategory`,
`recipeCuisine`, `nutrition`, `url`, `source_type`, `external_id`, `thermomix`, `collections`,
`instructions_available`, `notes`, `favorite`). Package-specific:

| Field | Type | Meaning |
|---|---|---|
| `image` | string | `bilder/<file>` inside the zip (jpg, png, webp, gif, avif/heic) or an `https://` link. |
| `source_type` | string | Default `package` when missing. |
| `tohuus` | object | Optional. `{ "devices": ["Thermomix", "Backofen"] }` – the appliances the recipe uses. |
| `recipeInstructions[].tohuus` | object | Optional, per `HowToStep`: appliance settings of that step (below). |

### Appliance steps (`tohuus` on a HowToStep)

For Thermomix and any other device (oven, air fryer, stand mixer, microwave, multicooker …). Every field is optional
and free text, written as the source writes it.

| Field | Example | Meaning |
|---|---|---|
| `device` | `"Thermomix"`, `"Backofen"`, `"Airfryer"` | which appliance |
| `time` | `"20 Min."`, `"10 Sek."` | duration |
| `temperature` | `"100 °C"`, `"Varoma"` | temperature |
| `speed` | `"1"`, `"Stufe 4"` | speed / level |
| `mode` | `"Linkslauf"`, `"Umluft"`, `"Teigmodus"` | mode / programme |

ToHuus stores this on the step as `tm: { device, time, temp, speed, mode }` (older data has `time`, `temp`,
`speed` only; an older `tm` block on a step is still read). The recipe is marked *Thermomix* only when a device is a
Thermomix (or, without any devices named, when the steps read like one) – "Stufe 2" on a stand mixer does not count.

### Example

```json
{
  "format": "tohuus-rezeptpaket",
  "version": 1,
  "recipes": [
    {
      "@type": "Recipe",
      "name": "Linsencurry",
      "description": "Schnelles Curry für die Woche.",
      "image": "bilder/linsencurry.jpg",
      "recipeYield": "4 Portionen",
      "totalTime": "PT35M",
      "recipeIngredient": ["200 g rote Linsen", "1 Dose Kokosmilch (400 ml)", "1 Zwiebel", "2 TL Currypulver", "100 g Bergkäse, gerieben"],
      "ingredients_structured": [
        { "section": null, "name": "rote Linsen", "amount": 200, "unit": "g", "note": null },
        { "section": null, "name": "Kokosmilch", "amount": 1, "unit": "Dose", "note": "400 ml" },
        { "section": null, "name": "Zwiebel", "amount": 1, "unit": null, "note": null },
        { "section": null, "name": "Currypulver", "amount": 2, "unit": "TL", "note": null },
        { "section": "Zum Überbacken", "name": "Bergkäse", "amount": 100, "unit": "g", "note": "gerieben" }
      ],
      "recipeInstructions": [
        { "@type": "HowToStep", "text": "Zwiebel halbieren und zerkleinern.", "tohuus": { "device": "Thermomix", "time": "5 Sek.", "speed": "5" } },
        { "@type": "HowToStep", "text": "Linsen, Kokosmilch und Curry zugeben und garen.", "tohuus": { "device": "Thermomix", "time": "20 Min.", "temperature": "100 °C", "speed": "1", "mode": "Linkslauf" } },
        { "@type": "HowToStep", "text": "In eine Auflaufform geben, mit Käse bestreuen und überbacken.", "tohuus": { "device": "Backofen", "time": "10 Min.", "temperature": "200 °C", "mode": "Umluft" } }
      ],
      "keywords": "vegetarisch, schnell",
      "recipeCategory": "Hauptgericht",
      "source_type": "package",
      "external_id": null,
      "tohuus": { "devices": ["Thermomix", "Backofen"] }
    }
  ]
}
```

## JSON Schema

Informative (the importer is more tolerant than this – see recipes-import.md).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://tohuus.heidrich-digital.de/schema/rezeptpaket-1.json",
  "title": "ToHuus-Rezeptpaket",
  "type": "object",
  "required": ["format", "version", "recipes"],
  "properties": {
    "format": { "const": "tohuus-rezeptpaket" },
    "version": { "const": 1 },
    "exported": { "type": "string", "format": "date-time" },
    "recipes": { "type": "array", "maxItems": 1000, "items": { "$ref": "#/$defs/recipe" } }
  },
  "$defs": {
    "text": { "type": ["string", "null"] },
    "recipe": {
      "type": "object",
      "required": ["name"],
      "properties": {
        "@type": { "const": "Recipe" },
        "name": { "type": "string", "maxLength": 200 },
        "description": { "$ref": "#/$defs/text" },
        "image": { "type": ["string", "null"], "description": "bilder/<file> inside the zip, or https://…" },
        "recipeYield": { "type": ["string", "number", "null"] },
        "totalTime": { "$ref": "#/$defs/text" },
        "prepTime": { "$ref": "#/$defs/text" },
        "cookTime": { "$ref": "#/$defs/text" },
        "recipeIngredient": { "type": "array", "maxItems": 150, "items": { "type": "string" } },
        "ingredients_structured": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "section": { "$ref": "#/$defs/text" },
              "name": { "type": "string" },
              "amount": { "type": ["number", "null"] },
              "unit": { "$ref": "#/$defs/text" },
              "note": { "$ref": "#/$defs/text" },
              "original": { "$ref": "#/$defs/text" }
            }
          }
        },
        "recipeInstructions": {
          "type": "array",
          "maxItems": 120,
          "items": { "oneOf": [{ "type": "string" }, { "$ref": "#/$defs/step" }, { "$ref": "#/$defs/section" }] }
        },
        "keywords": { "type": ["string", "array", "null"] },
        "recipeCategory": { "type": ["string", "array", "null"] },
        "recipeCuisine": { "type": ["string", "array", "null"] },
        "url": { "type": ["string", "null"] },
        "source_type": { "type": ["string", "null"], "pattern": "^[a-z0-9_-]{1,24}$" },
        "external_id": { "$ref": "#/$defs/text" },
        "thermomix": { "type": "boolean" },
        "instructions_available": { "type": "boolean" },
        "collections": { "type": "array", "maxItems": 8, "items": { "type": "string" } },
        "notes": { "$ref": "#/$defs/text" },
        "favorite": { "type": "boolean" },
        "tohuus": {
          "type": "object",
          "properties": { "devices": { "type": "array", "items": { "type": "string" } } }
        }
      }
    },
    "step": {
      "type": "object",
      "required": ["text"],
      "properties": {
        "@type": { "const": "HowToStep" },
        "text": { "type": "string", "maxLength": 3000 },
        "tohuus": {
          "type": "object",
          "properties": {
            "device": { "type": "string", "maxLength": 80 },
            "time": { "type": "string", "maxLength": 60 },
            "temperature": { "type": "string", "maxLength": 60 },
            "speed": { "type": "string", "maxLength": 60 },
            "mode": { "type": "string", "maxLength": 60 }
          }
        }
      }
    },
    "section": {
      "type": "object",
      "required": ["itemListElement"],
      "properties": {
        "@type": { "const": "HowToSection" },
        "name": { "type": "string" },
        "itemListElement": { "type": "array", "items": { "$ref": "#/$defs/step" } }
      }
    }
  }
}
```

## Limits and safety

| Limit | Value |
|---|---|
| upload | 100 MB (zip or JSON) |
| recipes per package | 1000 (more are cut off with a note) |
| `rezepte.json` | 20 MB |
| one photo | 15 MB (larger ones are left out with a note) |
| all photos together | 300 MB |
| zip | at most 20 000 entries and 400 MB unpacked (checked from the directory before anything is inflated; every entry is inflated with a hard output cap) |

Photo paths must be plain relative paths inside the package – absolute paths, `..`, backslashes, drive letters,
`data:` and other schemes are refused (the recipe comes in without the photo and the preview says why). Only real
image bytes are taken; they are re-encoded as WebP (≤ 1600 px) and stored through `server/lib/images.ts`
(encrypted per household, counted against the storage quota – a package whose photos clearly do not fit is refused
with HTTP 413 `storage.full` before the preview). Recipes stay in the household's own database; nothing is shared.

## Duplicates and re-import

The preview marks every recipe as **new**, **update** or **already here?**:

- *update* – the same recipe came in before (same `source_type` + `external_id`, the same link, or for sources
  without ids – including `package` – the same title). Importing updates the original; the household's own version,
  ratings, favourite, notes and a hand-picked photo stay.
- *already here?* (`similar_id`) – a recipe with the same name exists but this one would be created anew (e.g. a
  different source). These start **unticked**; tick them to have both.

Exporting and importing the package again is a no-op update (round trip, tested in `test/recipe-package.test.ts`).
Own recipes get `external_id: "tohuus-<id>"` in the export.

## API

| Method | Path | What |
|---|---|---|
| `POST` | `/api/recipes/import/detect` | multipart `file` (zip/JSON/any other supported app format) or JSON `{ text }` → preview `{ session, format: "package", format_label, count, updates, recipes: [PreviewItem], errors, warnings }` |
| `POST` | `/api/recipes/import/commit` | `{ session, include?: number[] }` → `{ job, total }` |
| `GET` | `/api/recipes/import/jobs/:id` | progress `{ total, done, finished, created, updated, images, failed, errors, images_pending }` |
| `GET` | `/api/recipes/package.zip` | the package; `?ids=1,2,3` for some recipes, `?images=0` without photos. Headers `X-Recipes`, `X-Images`. |
| `GET` | `/api/recipes/package/template` | `{ format, version, prompts: { de, en }, example, limits, help }` – the prompt for the household's own AI |

`PreviewItem`: `{ index, title, image, ingredients, steps, instructions_available, source_type, translated,
existing_id, similar_id, has_photo, devices }`. Importing needs a member or admin (or a full-access token); guests
and guest links cannot import.

## Prompt for your own AI

`GET /api/recipes/package/template` → `prompts.de` starts with **"Erstelle mir ein ToHuus-Rezeptpaket aus …"**. The
person finishes the line ("… aus diesen Fotos"), attaches cookbook pages, screenshots (including photos of a
Thermomix or other appliance display) or notes, and uploads what comes back. Chats that can create files are asked
for the zip with `bilder/`; others answer with the JSON only. The prompt asks for the `tohuus` step block for every
appliance, to keep the recipe's language and to invent nothing.
