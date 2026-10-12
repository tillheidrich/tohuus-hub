# iPhone, iPad and Apple Watch app 0.2 – what the app expects from the server

Version 0.2.0 (build 2) of the native app (`ios/`). This page lists every endpoint the app calls that was **not** on
`main` when it was built, with the exact shape it sends and the shapes it accepts. All of them are optional: when the
server answers 404 the app hides the feature (or falls back as described) – nothing breaks on older servers.

Server branches that are expected to provide them: `b-list` (push, live shopping, lists, row details), `b-core`
(device OCR text import, AI switch), `b-recipes` (facts). If an implementation deviates, change it here and in
`ios/ToHuus/Core/API/Endpoints.swift`.

## Targets and identifiers

| Target | Bundle id | Notes |
|---|---|---|
| iPhone + iPad app | `de.heidrichdigital.tohuus` | `TARGETED_DEVICE_FAMILY = 1,2`, iPad all orientations, no `UIRequiresFullScreen` (Split View, Stage Manager) |
| Share extension | `de.heidrichdigital.tohuus.share` | unchanged |
| Home-screen widget | `de.heidrichdigital.tohuus.widget` | unchanged |
| Watch app | `de.heidrichdigital.tohuus.watchkitapp` | watchOS 10+, `WKCompanionAppBundleIdentifier = de.heidrichdigital.tohuus` |
| Watch complications | `de.heidrichdigital.tohuus.watchkitapp.watchwidgets` | the Equilo naming that passed; `.complication` was already taken at Apple for Equilo |

App Group `group.de.heidrichdigital.tohuus` on all five. Entitlement `aps-environment` on the iPhone app.

## Push (APNs)

- `POST /api/push/apns` `{ token: "<hex>", environment: "sandbox"|"production", device: "ToHuus iOS · iPad", bundle: "de.heidrichdigital.tohuus" }`
  – sent after every launch and sign-in once the person allowed notifications (Mehr › Mitteilungen; never asked at
  launch). Debug builds say `sandbox`, TestFlight/App Store builds `production`. 404 → the screen says the server
  can't send iPhone notifications yet.
- `DELETE /api/push/apns` `{ token }` – on sign-out.
- Payload the app understands:

```json
{ "aps": { "alert": { "title": "Mira", "body": "Bringst du noch Hafermilch mit?" }, "category": "TOHUUS_ADDON", "thread-id": "shopping" },
  "event": "shopping.addon", "data": { "request_id": "12" }, "url": "tohuus://shopping" }
```

| `aps.category` | Buttons | Runs |
|---|---|---|
| `TOHUUS_ADDON` | „Mach ich“ / „Geht nicht“ | `POST /api/push/action { action: "addon-accept" | "addon-decline", data }` |
| `TOHUUS_DUE` | „Auf die Liste“ | `POST /api/push/action { action: "shop-add", data: { product_id } }` (exists) |
| `TOHUUS_ARRIVAL` | „Liste öffnen“ | local only (store-arrival hint) |

`addon-accept` / `addon-decline` are new action names for `NOTIFY_ACTIONS` (key `request_id`). A plain tap opens
`url` (`tohuus://shopping|today|pantry|cooking|money|more|kitchen`); `data.store_id` opens shop mode for that shop.
Buttons work from a background launch too (the app builds a client from the stored session) and on the watch.

### Notification settings

- `GET /api/notify/prefs` → `{ events: [{ event, label?, push, locked? }], quietHours: { enabled, from: "22:00", to: "07:00" } }`
  (an object `{ "stock.low": { push: true } }` is accepted as well). Personal: only the member's own devices.
- `PATCH /api/notify/prefs` `{ events: { "<event>": true|false } }` and `{ quietHours: { enabled, from, to } }`.
- Fallback without it: the household matrix from `GET /api/settings` (`notify.events.*.push`), changed by admins with
  `PATCH /api/settings { notify: { events: { key: {…full row…} } } }`; quiet hours are hidden then.
- Event keys the app has titles for: `shopping.addon`, `shopping.live`, `shopping.added`, `rhythm.due`, `stock.*`,
  `import.review`, `order.*`, `digest.daily`, `care.due`, `party.ending`, `kids.wish`, `auth.new_device`,
  `budget.warning`, `plan.vote`, `plan.rotation`. The server may send `label` to override.

## Live shopping together, several lists, row details

All tolerant: the fields may come inside `GET /api/shop/list` or from `GET /api/shop/live`.

- `GET /api/shop/list` may carry `lists: [{ id, name, open }]`, `list: { id, name }`, `shoppers: [{ userId, name, store,
  storeId, since, me }]`, `requests: [{ id, text, by, to, status: open|accepted|declined, at }]`,
  `estimate: { total, known, count, currency }`; rows may carry `substitute: any|ask|none`, `substituteNote`, `photo`,
  `price` (per unit, for the expected total when there is no `estimate`). Query `list=<id>` selects a list.
- `GET /api/shop/live` → `{ shoppers, requests }` (only asked when the list doesn't carry them; 404 → no live UI).
- `POST /api/shop/live/start { store_id? }` when someone enters shop mode, `POST /api/shop/live/stop` on leaving or
  "Fertig".
- `POST /api/shop/live/requests { text }` – a wish for the current trip (404 → the wish goes on the list instead).
- `POST /api/shop/live/requests/:id { answer: "accept"|"decline" }`.
- `GET /api/shop/lists` → `[{ id, name, open }]`, `POST /api/shop/lists { name }`.
- Offline ops for additions carry `list_id` (ignored by servers with one list).
- `PATCH /api/shopping/:id { note, substitute, substitute_note }` (servers without substitute keep the note).
- `POST /api/shopping/:id/photo` (multipart `photo`, JPEG) → 404 = "can't keep photos yet".
- Drag & drop between aisles uses the existing `POST /api/shop/items/:id/section { section }`; the week plan uses the
  existing `PATCH /api/plan/:id { day }`.
- SSE topic `live` (besides `shopping`) makes the app reload the live state.

## Receipts and paper lists read on the device

- `POST /api/imports/text { lines: ["LIDL", "Milch 1,5%  1,29", …], source: "ocr-device", kind: "receipt"|"list" }` →
  `{ results: [ImportResult] }` or one import `{ id, title, … }`. Apple Vision reads the photo on the iPhone; only the
  text is sent. Used always when the household has no receipt AI, optionally with AI. 404 → the photos are uploaded
  as before (`/api/imports/upload`).
- Paper shopping lists don't need the server: the recognised lines are picked by the person and go on the list like
  typed text.

## AI switch and kid lock

- `GET /api/assistant/status` – besides `ai, voice, receiptsAi` the app reads, when present: `household` (household
  switch), `personal` (this member's switch), `locked` (a child – shown locked), `reason`; `ai` may also be an object
  `{ enabled, household, personal, locked, reason }`. `GET /api/me` → `actor.kind` `kid`/`child` or `role: child`
  counts as a child.
- `PATCH /api/assistant/personal { ai: boolean }` – the personal switch (404 → kept on the device).
- `POST /api/assistant/chat` may carry `mode: "basic"` when AI is off for this member (servers that don't know the field
  decide by their own switches).
- With AI off the app sends no recordings to the server (on-device dictation only) and reads receipt photos itself.

## Other

- `GET /api/facts` → `[{ id, title, text, source | { name, url }, sourceUrl, topic }]` or `{ facts: [...] }` (Mehr › Gut zu
  wissen; 404 → "not on your server yet").
- Help links: `https://tohuus.heidrich-digital.de/hilfe/<slug>.html` with slugs from `docs/help-slugs.md`.
- `POST /api/auth/app { device: "ToHuus watchOS · Apple Watch", household }` with the iPhone's app token – a separate,
  revocable token for the watch. Self-hosted servers allow it; the cloud currently requires a cookie session (401), so
  the watch gets the iPhone's token. Allowing an app token to mint one sibling token for the same account would make
  the watch show up separately under "Signed-in apps".

## Watch

- The iPhone sends the list (queued changes applied) as WatchConnectivity application context; the watch ticks with
  undo, adds by voice (assistant when it reaches the server, otherwise the built-in reader), sorts by shop
  (`GET /api/shop/list?store=`) when it has its own network.
- The session reaches the watch only over WatchConnectivity (encrypted, paired watch only) and is stored in the
  watch keychain. Ops the watch can't send itself go to the iPhone queue (op ids keep double delivery harmless) and
  are acknowledged back.
- Complication/Smart Stack: open count and "wohl fällig" (first due rhythm item from `/api/today`).

## Store-arrival hint

Opt-in under Mehr › Hinweis im Laden, off by default. Shops are saved on the device (position + name, optional ToHuus
shop id), region monitoring (max. 20), local notification only when something is open. No location is sent to the
server or anywhere else. "Wenn in Benutzung" first, "Immer" asked right after – only when the person switched the
hint on.
