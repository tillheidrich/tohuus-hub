# Wish lists / Merkliste (13 Oct 2026)

Einkauf › Wünsche (web `/einkauf/wuensche`, iPhone: Einkauf › menu › „Wünsche & Merkliste“). A household collects what someone wishes for („Wünsche von Mika“, „Weihnachten Mama“) or what it wants to remember („Merkliste Kekse“). Code: `server/lib/wishes.ts` (logic), `server/lib/wish-policy.ts` (tables, privacy), `server/routes/wishes.ts`, `server/lib/assistant-wishes.ts`, `server/mcp/tools-wish.ts`, `web/src/pages/Wishes.tsx`, `ios/ToHuus/Features/Wishes/`.

## Privacy

- A list has an owner, someone it is **for** (`for_user_id` = household member, or `for_name` free text like „Mama“) and a visibility: `household`, `private` (only the owner), `people` (owner + `share_with`).
- **The person a list is for never sees reservations, „gekauft“, who did it or „wer könnte das schenken“** – every read path returns `status: 'open'`, `status_by: null`, `giver: null`, `reserved/bought: null`, `on_shopping_list: false` for them, `can_reserve: false`, and setting a status answers 404. Their edits never touch the giver.
- Lists a person may not see are 404 everywhere (list, items, search, share, status, photo).
- Permanent guests: closed out of `/api/wishes/*` (path word `wishes` is in the guest policy's NEVER list); guest links, kid tablets, displays, HA never see wishes.
- Tokens without a person (MCP): household lists only, never states (`tokenRead`).
- Export (`buildExport`): only the viewer's visible lists/items/links, reservation fields blanked where hidden.
- No notifications for wishes or reservations (a push could reach the wished-for person's devices). SSE topic `wishes` carries no content.
- „Auf die Einkaufsliste“: for a list that is for someone or not household-visible, the row goes on the main list as a **private** shopping row shared with the people who see the wish list, never with the person it is for; a chosen private shopping list masks it anyway.

## API (all JSON, member session or app token)

| Method & path | Body / query | Answer |
|---|---|---|
| `GET /api/wishes/lists` | `?archived=1` | `[WishList]` |
| `POST /api/wishes/lists` | `{ name, note?, for_user_id?, for_name?, visibility?, share_with? }` | `WishList` |
| `GET /api/wishes/lists/:id` | `?sort=manual\|priority\|price\|newest\|title&archived=1` | `{ list: WishList, items: [Wish] }` |
| `PATCH /api/wishes/lists/:id` | any of the above + `archived` (privacy fields: owner only, 403) | `WishList` |
| `DELETE /api/wishes/lists/:id` | | `{ ok }` (owner only) |
| `POST /api/wishes/lists/:id/items` | `{ title, note?, price?, priority? (1\|2\|3), giver_user_id?, giver_name?, links?: [{ label?, url, price? }] }` | `Wish` |
| `GET /api/wishes/items/:id` | | `Wish` |
| `PATCH /api/wishes/items/:id` | item fields, `links` (with `id` to keep a link), `archived`, `list_id` (move) | `Wish` |
| `DELETE /api/wishes/items/:id` | | `{ ok }` |
| `POST /api/wishes/items/:id/status` | `{ status: open\|reserved\|bought, by_user_id?, by_name? }` | `Wish` (409 when someone else reserved it) |
| `POST /api/wishes/items/:id/photo` | multipart `image` (storage quota counted, encrypted) | `Wish` |
| `DELETE /api/wishes/items/:id/photo` | | `Wish` |
| `POST /api/wishes/items/:id/to-list` | `{ list_id?, private? }` | `{ shopping_item_id, private }` |
| `POST /api/wishes/lists/:id/share` | `{ item_ids?, prices? (default true), skip_taken? }` | `{ subject, text, mailto, count }` – plain text with links and prices, never who reserved |
| `GET /api/wishes/search` | `?q=` (≥ 2 chars) | `[Wish & { list_name }]` |
| `POST /api/wishes/preview` | `{ url }` | `{ title, site, price }` (422 when unreachable, 429 over budget) |

`WishList`: `{ id, name, note, owner_id, owner, for_user_id, for_name, visibility, share_with, archived, mine, for_me, can_reserve, count, reserved, bought, photos[≤3], updated_at }`.
`Wish`: `{ id, list_id, title, note, photo_path, price, price_from_links, priority, links: [{ id, label, url, price, title, site, image_path, preview: pending|ok|failed }], giver, status, status_by: { user_id, name, mine }, status_at, on_shopping_list, archived, created_by, created_at, updated_at }`. `price` falls back to the lowest link price (`price_from_links`, shown as „ab …“); `photo_path` falls back to a link's preview picture.

## Link previews (SSRF)

Saving a link starts a background fetch (`refreshPreview`): only http/https, no credentials in the URL, ports 80/443, public addresses only (checked at connect time – `lib/net.ts safeFetch`), max 3 redirects, 1.5 MB HTML / 5 MB picture, 8 s, no cookies; title (`og:title`/`<title>`), site name, price (`product:price:amount` …) and picture (re-encoded to WebP, encrypted, counted in the storage quota). At most 60 previews per household and hour. Tests never go online (`VITEST`).

## Assistant and MCP

- Topic `wishes` („Merkliste“, „Wunsch“, „Geschenk“, „merk dir … Artikel/Link“): tools `wish_add` (title, url, note, price, list – default the person's own private „Merkliste“, created on first use; undo) and `wish_lists` (visible lists, titles/prices/notes only – never reservations or givers). Only for a person with an account; the model is told to write only when asked. „Merk dir …“ with a link or article is not taken as a household fact by the built-in reader.
- MCP `wish_lists` (read-only): household lists only, no states.
