# ToHuus API for the iPhone, iPad and Watch app 0.2 (after the merge of 12 Oct 2026)

One page for the iOS engineer: every endpoint and field the app should use on `main` after merging `b-core`, `b-list`,
`b-recipes` and `b-ha-site`. Details live in the linked area docs; this page wins where the app's own
[`ios-0.2.md`](ios-0.2.md) (on the `b-ios` branch) assumed other names – see **Names the app assumed** at the end.

All JSON. Errors `{ error, code? }`. Auth: `Authorization: Bearer sw_app_…` (app token, `POST /api/auth/app`), cloud
household with `X-Household: <uuid>`. 404 on any optional endpoint = feature not on that server (self-hosted older
versions): hide it.

## Instance, account, plan

| Endpoint | Notes |
|---|---|
| `GET /api/instance` | `features: { assistant, voice, receiptsAi, billingApple, ai: { configured, household, mcp }, ocr }` – `ocr` = text recognition on the server ([receipts.md](receipts.md)) |
| `POST /api/auth/app`, `GET/DELETE /api/auth/app/devices[/:id]` | unchanged ([plan](plan-2026-10-12.md)) |
| **new** `POST /api/auth/link { email }` → `POST /api/auth/link/code { email, code, device, household? }` | cloud only. Sign-in without a password: the mail carries a link and a 6-digit code (`123 456`; spaces are ignored). With `device` the answer is an app token, same shape as `POST /api/auth/app`: `{ token, account, user, households, household }`. `400` wrong code (also for an unknown address), `410` used / expired (10 minutes) / 5 wrong tries – ask for a new mail, `403` `household` is not a membership, `429` rate limit. Use `textContentType = .oneTimeCode`. Self-hosted servers answer 404 here – [cloud.md](cloud.md#sign-in-link-and-code-other-device) |
| `GET /api/billing/status` | new: `renewsAt` (next charge, from the App Store renewal info; `null` = will not renew), `expiresAt`, `autoRenew`, `period` (`monthly`/`yearly`), `manageUrl` (`https://apps.apple.com/account/subscriptions`), `reminder` (personal), `source` (`apple`/`operator`/`none`) – [cloud.md](cloud.md#subscriptions-renewal-date-abo-verwalten-reminder) |
| `PATCH /api/billing/reminder { enabled }` | e-mail 3 days before a yearly renewal (personal) |
| "Abo verwalten" | `AppStore.showManageSubscriptions(in:)`, fallback `manageUrl` |
| `POST /api/cloud/import`, `GET /api/cloud/import` | moving a self-hosted household into the cloud – web only for now ([cloud.md](cloud.md#moving-a-self-hosted-household-in)) |

## AI switches and kid lock ([assistant.md](assistant.md#switching-ai-off-aienabled-aimine-children-mcp))

| Endpoint | Notes |
|---|---|
| `GET /api/assistant/status` | `ai, voice, receiptsAi` are the **effective** values for this person; plus `aiState: { configured: { text, vision, audio }, household, mcp, mine, effective, reason: null\|'no_model'\|'household'\|'person'\|'parents' }` and the flat copies `household`, `personal` (= `mine`), `locked` (always `false` for members), `reason` |
| `GET /api/ai/settings` | as `aiState` + `admin`, `kids: [{ id, name, ai }]` (adults only) |
| `PATCH /api/ai/settings` | `{ mine }` (anyone, for themselves); `{ household, mcp }` (admins, else 403) |
| `PUT /api/kids/:id/ai { enabled }` | parents switch AI for a child; a kid tablet can never change it (`GET /api/kid/:token` → `ai: { enabled, locked: true }`) |
| errors | any AI path answers **403 `{ code: 'ai.disabled' }`** while a switch is off; the assistant chat answers `mode: 'basic'` instead |

Children have no sign-in: there is no "kid" actor on a member session. With AI off for the person: no recordings to the server (use on-device dictation), receipts via device OCR (below) or server OCR.

## Assistant ([assistant.md](assistant.md))

- `POST /api/assistant/chat { message, conversationId?, context?: 'shopping'|'stock'|'cook'|'money'|'house'|'guests' }` → `{ conversationId, reply, actions, mode: 'ai'|'basic', remaining? }`.
- `POST /api/assistant/voice` (multipart `audio`), `POST /api/assistant/transcribe`, `POST /api/assistant/undo/:token`.
- `POST /api/assistant/photo` (multipart `files` ≤ 4, fridge/cupboard) → `{ suggestions: [{ name, qty, best_before, confidence, product_id }], estimate }`; `POST /api/assistant/stock-apply { items }`.
- `GET/POST/DELETE /api/memory` – rows carry `onlyMe`; `POST { text, onlyMe: true }` = "nur für mich".

## Receipts and text recognition ([receipts.md](receipts.md))

| Endpoint | Notes |
|---|---|
| `POST /api/imports/lines { lines: string[], source: 'ocr-device', mode?: 'auto'\|'receipt'\|'list', confidence? }` | **text recognised on the iPhone (Apple Vision)**. Receipt → `{ kind: 'receipt', id, via: 'ocr-device', sumMatches, confidence }` (an import in review). List → `{ kind: 'list', items: [{ name, qty, confidence }] }` (suggestions only). One string per line, top to bottom; keep two or more spaces between name and price if you can |
| `POST /api/imports/upload` (multipart `files`, `mode=auto\|receipt\|shelf`) | photos are read with server OCR + parsers first, the model only when the sum check fails; each result has `{ id, via: 'ocr'\|'ai', confidence, sumMatches }` or `{ error, code? }` |
| `POST /api/imports/list-photo` (multipart `image`) | paper list / whiteboard → `{ items, lines, confidence, source: 'ocr' }` (501 `ocr.unavailable` without Tesseract) |
| `GET /api/imports/:id` | lines carry notes like "Pfand für: …", "Unscharf gelesen – bitte prüfen"; `meta.source`, `meta.ocrConfidence` |

## Shopping list ([shopping-list.md](shopping-list.md))

| Endpoint | Notes |
|---|---|
| `GET /api/shop/list?list=<id>` | the view of a list (`0` = main, default; `all`); plus `listId`, `lists`, `estimate` |
| `GET /api/list/lists`, `POST /api/list/lists { name, kind?, note? }`, `PATCH/DELETE /api/list/lists/:id`, `POST /api/list/items/:id/move { list_id }` | several lists; kinds `main\|store\|gifts\|care\|other` |
| `PATCH /api/list/items/:id { text?, qty?, note?, substitute?: 'exact'\|'ok'\|'ask', product_id? }` | row details |
| `POST /api/list/items/:id/photo` (multipart **`image`**), `DELETE …/photo` | row photo → `{ photo_path }` |
| `GET /api/list/usuals`, `GET /api/list/guard?text=&product_id=`, `GET /api/list/estimate?list=` | usuals, double-purchase check, expected total |
| `POST /api/list/finish { store_id?, to_stock }` | "Einkauf fertig" – also ends the person's trip |
| `GET /api/list/recent`, `POST /api/list/items/:id/restore`, `GET /api/list/status` | trust: recently done, undo, sync line |
| `POST /api/list/items/:id/place { neighbor_id?, after?, section?, list_id? }` | drag & drop (also `POST /api/shop/items/:id/section`) |
| `GET/PUT /api/list/prefs` | density, font scale |
| Offline queue `POST /api/shop/sync` | ops for additions may carry `list_id` |

### Shopping together (trips)

| Endpoint | Notes |
|---|---|
| `GET /api/shop/trips` | `[{ id, user: { id, name, color }, store, startedAt, lastAt, mine, basket: [{ id, text, qty }], addOns: [{ id, text, from, done }] }]` – trips **start by themselves** from ticks in a shop; private trips only for their owner |
| `POST /api/shop/trips/:id/add { text }` | "Bringst du noch … mit?" → `{ id, created, for }`; the shopper gets a `trip.addon` notification |
| `GET/PUT /api/shop/trips/privacy { private }` | "Mein Einkauf bleibt privat" |
| SSE | topic `shopping` (trips change with ticks) |

### Offers and prices

`POST /api/offers/scan` (multipart `image` / `{ url }` / `{ text }`) → `{ via: 'ocr'|'ai'|'pdf'|'text', offers }`; `GET /api/offers`; `POST /api/offers/:id/add`; `DELETE /api/offers/:id`; `GET /api/prices/cheapest`, `GET /api/prices/product/:id`.

## Notifications ([notifications.md](notifications.md))

| Endpoint | Notes |
|---|---|
| `POST /api/push/apns { token, environment: 'production'\|'sandbox', device? }` | register after permission; `GET /api/push/apns` own devices; **`DELETE /api/push/apns/:id`** (id or the token itself) on sign-out |
| `GET /api/notify/prefs` | `{ events: [{ key, label, apns, push, digest, homeOnly }], quiet: { from, to } \| null, preview, channels, presence }` – personal. **`apns`** is the iPhone channel, `push` the browser |
| `PUT /api/notify/prefs { events?: { [key]: { apns?, push?, digest? } }, quiet?, homeOnly?, preview? }` | also accepted: `PATCH` in the app's shape (alias, below) |
| `POST /api/notify/presence { home, source: 'app' }` | "nur wenn ich zu Hause bin" |
| `POST /api/push/action { action, data }` | buttons: `shop-add` (`product_id`), `addon-accept` / `addon-decline` (`request_id`), `order-*`, `kid-*`, `care-done` |

APNs payload:

```json
{ "aps": { "alert": { "title": "Mira: Bringst du noch Hafermilch mit?", "body": "Steht jetzt auf deiner Liste." }, "sound": "default",
           "thread-id": "trip.addon", "category": "TOHUUS_ADDON" },
  "event": "trip.addon", "path": "/einkauf", "url": "tohuus://shopping", "data": { "request_id": "12", "trip_id": "3" } }
```

Categories: `TOHUUS_ADDON` (`trip.addon`, buttons "Mach ich" → `addon-accept`, "Geht nicht" → `addon-decline`: the row stays on the list, only the claim goes), `TOHUUS_DUE` (`rhythm.due`, `data.product_id` when exactly one product is due → `shop-add`). `url`: `tohuus://shopping|today|pantry|cooking|money|more`. Event keys per person: `trip.addon`, `trip.started`, `rhythm.due`, `stock.expiring`, `import.review`, `plan.reminder`, `order.new`, `guest.order`, `budget.warning`.

## Hausinfo ([house-guide.md](house-guide.md))

`GET /api/house-guide` → `{ cards, codes (masked, has_value), ha_voice, areas, can_edit }`; cards/codes CRUD for admins; **`POST /api/house-guide/codes/:id/reveal`** → `{ id, value, wifi: { ssid, security, hidden, qr } | null }` (logged); templates; per-link selection; guest page `GET /api/guest/:token/house`. Codes never come through any other endpoint, MCP, AI, push or export (export only with `?codes=1`).

## Recipes ([recipes-import.md](recipes-import.md), [recipe-package.md](recipe-package.md))

- `POST /api/recipes/import/url { url, text? }` – social links with the share-sheet caption; Cookidoo in the cloud answers **409 `{ code: 'cookidoo_confirm', draft }`** → `POST /api/recipes/import/cookidoo/draft`, `…/cookidoo/read` (multipart screenshot of the ingredient list), `POST /api/recipes/import/cookidoo`.
- `POST /api/recipes/import/social { url, text? }`, `POST /api/recipes/import/photo` (multipart `files` ≤ 6, appliance displays too), `POST /api/recipes/import/text { text }`.
- Recipe package: `POST /api/recipes/import/detect`, `…/commit`, `GET …/jobs/:id`, `GET /api/recipes/package.zip`, `GET /api/recipes/package/template`.

## Other

- `GET /api/facts?lang=de|en` (public) → `{ version, retrieved, help, facts: [{ id, topic, title, text, tohuus, sources: [{ title, publisher, url, retrieved, note? }] }] }`.
- Help links `https://tohuus.heidrich-digital.de/hilfe/<slug>.html`, slugs in [help-slugs.md](help-slugs.md) (31 slugs).
- `GET /api/modules` – "Was nutzen wir?" (hide tabs/events of switched-off modules).
- CalDAV passwords for Reminders: `GET/POST/DELETE /api/caldav/passwords` (iOS settings: server, user, password).
- MCP for the household's own assistants: `<base>/mcp` with OAuth – nothing for the app to do ([mcp.md](mcp.md)).
- Watch token: `POST /api/auth/app` still needs a cookie session in the cloud; the watch keeps using the iPhone's token.

## Names the app assumed → what is real

| The app (b-ios) assumed | Real on `main` | Server alias? |
|---|---|---|
| `POST /api/imports/text { lines, source: 'ocr-device', kind }` | `POST /api/imports/lines { lines, source, mode }` | **yes** – `/api/imports/text` accepts `lines` or `text` and `kind`; answers like `/imports/lines` plus `results: [import]` |
| `GET /api/shop/live` → `{ shoppers, requests }` | `GET /api/shop/trips` (shoppers = trips, requests = `addOns`) | no – switch to `/shop/trips` |
| `POST /api/shop/live/start`, `…/stop` | trips start by themselves from ticks; stop = `POST /api/list/finish` | no |
| `POST /api/shop/live/requests { text }` | `POST /api/shop/trips/:id/add { text }` (pick the trip from `/shop/trips`) | no |
| `POST /api/shop/live/requests/:id { answer }` | `POST /api/push/action { action: 'addon-accept'\|'addon-decline', data: { request_id } }` (`request_id` = the list row id) | no – same action works from the app |
| `GET/POST /api/shop/lists` | `GET/POST /api/list/lists` (`id 0` = main list, also `kind`, `note`) | **yes** – `/api/shop/lists` maps to it |
| `PATCH /api/shopping/:id { note, substitute: any\|ask\|none, substitute_note }` | `PATCH /api/list/items/:id { note, substitute: 'ok'\|'ask'\|'exact' }` (any→`ok`, none→`exact`; the note is the note) | no |
| `POST /api/shopping/:id/photo` (field `photo`) | `POST /api/list/items/:id/photo` (field **`image`**) | no |
| `PATCH /api/assistant/personal { ai }` | `PATCH /api/ai/settings { mine }` | **yes** – answers with the AI state |
| status fields `household`, `personal`, `locked`, `reason` | `aiState.{household, mine, reason}` | **yes** – flat copies in `/api/assistant/status` |
| `GET /api/notify/prefs` items `{ event, push }`, `quietHours` | items `{ key, label, apns, push, digest, homeOnly }`, `quiet` | read the real shape (`key`, `apns`) |
| `PATCH /api/notify/prefs { events: { key: bool }, quietHours: { enabled, from, to } }` | `PUT /api/notify/prefs { events: { key: { apns, push, digest } }, quiet }` | **yes** – the PATCH shape is accepted (bool sets `apns` and `push`) |
| `DELETE /api/push/apns { token }` | `DELETE /api/push/apns/:id` (id or token in the path) | no |
| `/api/push/action` `addon-accept` / `addon-decline` with `request_id` | exactly that | real |
| APNs `category` `TOHUUS_ADDON` / `TOHUUS_DUE`, `url`, `data.request_id` | exactly that (`data` values are strings) | real |
| SSE topic `live` | topic `shopping` | no |
