# Changelog

ToHuus Hub is developed in waves: each wave adds a set of feature areas, then gets a review pass. Dates are when the wave landed on `main`. The package version is still `0.1.0`; the Home Assistant integration has its own changelog in [ha-integration/CHANGELOG.md](ha-integration/CHANGELOG.md).

## Unreleased

### Added

- **Subscriptions you can trust**: "Abo verwalten" (Apple's subscription management, `manageUrl`), the next renewal date and auto-renew state from the App Store renewal info in `/api/billing/status`, an e-mail 3 days before a yearly renewal to the admins (once, in their language, respecting the household's notification setting and a personal switch `PATCH /api/billing/reminder`).
- **Move a self-hosted household into ToHuus Cloud**: self-host Settings › Daten › "Umzug in die ToHuus Cloud" builds a ZIP (export + photos + receipt files; never sessions, tokens, secrets; Hausinfo codes only when ticked via `registerMovePart`), the cloud imports it into a new, empty household (`POST /api/cloud/import`, fresh password, size and quota limits, background job, people mapped by e-mail/name). docs/cloud.md.
- **Operator page `/betrieb`** (cloud only, `OPERATOR_EMAILS` + fresh password): households total/active, sign-ups per week, plans, storage (top households by id only), AI usage and estimated cost per day/month, error rate, backups and restore check, memory and disk; actions (extend trial, grant plan, password reset link, delete household) in an audit log. No household content, nothing per person. Exactly what is counted: docs/cloud.md.
- **E-mail language**: account mails (confirm address, sign-in link, reset, account deleted – new –, new assistant connection) are entirely in the account's language; German translations for every cloud account string (a German signup mail no longer mixes English subject and text with a German button and footer).
- **Privacy inside a household**: sessions, app devices, push devices, assistant conversations, personal AI settings and MCP connections are visible only to their person (admins included); "Nur für mich" for memory rows (`onlyMe`); the admin export leaves out other members' conversations, personal settings and private memory. docs/guests-and-permissions.md.
- **MCP with OAuth 2.1** (MCP authorization spec): protected-resource and authorization-server metadata, dynamic client registration, sign-in + household choice + consent (read / read and change / optional allergies and children's details), PKCE S256 only, 1-hour access tokens, rotating refresh tokens with reuse detection, `WWW-Authenticate` on 401. Works in the cloud (tokens routed to the household) and self-hosted; connections listed and revocable in Settings › Access & AI ("Mit Claude oder ChatGPT verbinden"); `/mcp/<token>` stays for Home Assistant and older clients. See docs/mcp.md.
- **Text recognition without AI** (`server/lib/ocr.ts`, Tesseract in the Docker image): receipt photos are read by OCR + the deterministic parsers first; the model only when the sum check fails (and AI is on and within quota). Device-recognised lines (`POST /api/imports/lines`, `source: 'ocr-device'`), paper-list photos (`POST /api/imports/list-photo`), raw OCR (`POST /api/imports/ocr`). `ocrImage(buffer) → { lines, confidence }` as a stable API. Honest confidence and "bitte prüfen" notes in the review.
- **EDEKA receipts of independent merchants**: shop EDEKA (never the merchant in the header), date/time from the till footer, the deposit linked to the drink above it, tax codes glued to the price (`0,25*B`).
- **AI on/off everywhere**: household switch `ai.enabled` (admins), per person `ai.mine`, per child (parents; the kid tablet shows it locked), and a separate switch for MCP access of the household's own assistants. Enforced centrally before any model request (`ai.disabled`, HTTP 403); without AI everything else works. `GET/PATCH /api/ai/settings`, `PUT /api/kids/:id/ai`, `aiState` in `/api/assistant/status`, `features.ai` in `/api/instance`; Settings › Access & AI.
- **Shopping list 2** ([docs/shopping-list.md](docs/shopping-list.md), market research of 12 Oct 2026):
  - *A list you can trust*: ticked rows stay struck through in place until "Einkauf fertig" (`POST /api/list/finish`), 5-second undo also in the store, "Zuletzt erledigt" with restore, visible sync state ("Abgeglichen vor 3 s", offline badge, `GET /api/list/status`), typed names stay (exact product match first, name editable), note, photo and substitute rule ("genau dieses" / "Ersatz ok" / "vorher fragen") per row, the product last bought according to receipts, density and text size per person, the store view keeps working when the session runs out.
  - *The list fills itself*: several lists (Baumarkt, Drogerie, Geschenke, "für Oma"), "Unsere Üblichen", double-purchase guard ("steht schon drauf (Mira, gestern)", "laut Bon vorgestern gekauft", "im Vorrat 2"), expected total from receipt prices (unpriced rows counted, never guessed), "Ich bin bei Lidl" in list mode.
  - *Shopping together, live*: ticks make a trip – others see "Sam kauft gerade bei Lidl ein" and the basket, can add "Bringst du noch Butter mit?" to it, two shoppers split by claims, "Mein Einkauf bleibt privat"; store coordinates (typed in) for the iPhone arrival hint.
  - *Notifications per person*: event × iPhone / browser / e-mail summary, quiet hours, "only at home" hook, lock-screen preview; **iPhone push** (APNs over HTTP/2 with a `.p8` key: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`, `APNS_TOPIC`, `APNS_ENV`; `POST /api/push/apns`). Calm defaults.
  - *Bridges*: CalDAV server for Apple Reminders / Nextcloud Tasks (app passwords, one reminder list per list), imports from Bring!, AnyList, Google Keep, any shared text or CSV (`POST /api/list/import`), purchase-history CSV now keeps date, shop and price so the rhythm works from day one.
  - *"Was nutzen wir?"*: switch Vorrat, Kochen, Geld, Verwöhnen, Hausinfo, Gäste/Party and Home Assistant off (navigation, Heute, notifications; data stays), in onboarding and settings.
  - *Household forms*: WG (personal rows, who paid, balance as sentences), Mitversorgen (care list as own store section, handover note, fridge check, spending for them), lunchbox regulars with holiday pause, package-size hint from the waste history.
  - *Drag & drop*: list rows within and between aisles and lists, week-plan meals to another day incl. next weeks, Heute card order per person – with menu alternatives and undo.
  - *Prices and offers from own data*: "Wo ist es am günstigsten" (per shop, base price per kg/l), price hint on rows, flyer photo / image-PDF link / pasted text → offers matched with list and rhythm.
  - *F&F weekly question* (opt-in, household-local; anonymous count for the operator only when shared, `OPERATOR_TOKEN`).
- **ToHuus-Rezeptpaket** ([docs/recipe-package.md](docs/recipe-package.md)): an open format for many recipes at once – a zip with `rezepte.json` (schema.org `Recipe`) and `bilder/`, or the JSON alone; appliance steps (Thermomix and any other device: time, temperature, speed, mode) in a `tohuus` block per step. *Kochen › Rezepte › Rezeptpaket hochladen* with preview, "already here?" duplicates preselected off, selection, warnings for missing or unsafe photo paths; zip-bomb and size limits; photos through images.ts and the storage quota. Export in the same format (`GET /api/recipes/package.zip`, round trip tested), a copyable prompt for your own AI (`GET /api/recipes/package/template`, "Erstelle mir ein ToHuus-Rezeptpaket aus …"). Other apps' exports use the same upload.
- **Recipes from Instagram, TikTok, Pinterest and YouTube**: share or paste the link – only public data (oEmbed, og metadata, a public recipe card) plus the caption that came along; a caption with a recipe is read by the model (`importAi`), a video without recipe text becomes title + link + public still image. **Photos** now also read handwritten notes, screenshots and appliance displays (Thermomix, oven …) into steps with device and mode. **Cookidoo in the cloud**: nothing is fetched or copied – title, link and the ingredient list you confirm (pasted or read from your own screenshot), "Zum Kochen in Cookidoo öffnen". See docs/recipes-import.md › AI and social imports.
- **Assistant help on every screen** (with AI on): the app sends the screen (`context`), the assistant gets that area's tools – merge/sort the list, "Was brauche ich für Lasagne?", "Was muss bald weg?", a photo of the fridge → stock suggestions with estimated dates (confirmed, one undo), week plan from what is there, adapt a recipe as a new one, "Warum war der Oktober teurer?", Hausinfo drafts from "Wir haben Alexa und Hue im Wohnzimmer" (never codes), party shopping. A small "Sprechen" entry with examples under each screen. Eval cases per screen.
- **So funktioniert ToHuus** and **Gut zu wissen** (*Mehr*): how the app remembers, where rows come from, with and without AI, what others see, privacy; 13 short facts with primary sources and retrieval dates (food waste, best-before vs use-by, shopping list, mental load, stockpiling, unit prices, food prices) and what ToHuus does about each – data in `server/data/facts.json`, `GET /api/facts` ([docs/facts.md](docs/facts.md)). The first-start tour follows the new frame (list with origin, optional stock, money, Sprechen, Mehr). "So geht's" links under each screen point to the website help articles ([docs/help-slugs.md](docs/help-slugs.md)).
- **Hausinfo** (*Mehr › Hausinfo*, [docs/house-guide.md](docs/house-guide.md)): voice commands, routines ("Alexa, gute Nacht" → what it does), tips, emergency spots and important numbers as cards, grouped by room or kind, with templates for Alexa, Google Home, Apple Home, Home Assistant and typical tips; the HA voice list merged in. **Codes** (door PIN, alarm, garage, guest Wi-Fi with join QR) in their own encrypted table, masked, tap to show, every view logged for admins, never to assistant/AI/MCP/HA/displays/notifications/logs, out of the export unless ticked (`?codes=1`). Visibility per card and code (members, guest levels, all sitter links, specific links with an end). Guest/sitter links get a Hausinfo tab (offline once opened, printable A4 "Für den Babysitter"), "Wo ist was?" finds cards too; trip page links to the sitter's selection. MCP and assistant tool `house_info` (cards only). Also fixes a print rule that blanked every printout except receipts.
- **Cooking details**: recipe → list keeps the ingredient line as note ("für Curry: 2 Hähnchenbrustfilets") and merges amounts only when the units are safe (recipe page, cook ideas, week plan, assistant); cook mode with the house note as first line; recipe search by ingredients ("mit: Hähnchen, Paprika", `GET /api/recipes/search?with=`) without stock keeping; servings can be typed directly.
- Home Assistant pairing by code: *Connect Home Assistant* shows a short code (10 min, single use); the integration exchanges it at `POST /api/ha/pair/claim` for its own "Home Assistant" access, routed to the household in ToHuus Cloud. `/api/ha/v1/state` gains `due`, `money` and `sync`; `POST /api/ha/v1/bridge/leader` sets who leads per topic.

- **ToHuus Cloud** (`MULTI_TENANT=true`, [docs/cloud.md](docs/cloud.md)): many households in one instance, one SQLCipher-encrypted database per household (`households/<uuid>/tohuus.db`), envelope encryption (master key from the environment, per-household data key wrapped in `accounts.db`, crypto-shredding on delete), a household context per request and job, per-household caches, live updates and scheduler runs, an accounts directory with sessions, memberships and app tokens, signup with a 14-day Plus trial, invitations that create memberships, account and household deletion, export, nightly encrypted backups with 7 daily + 4 weekly copies and optional S3 upload, a restore drill (`dist/restore-check.mjs`). Network features that reach into a home (HA REST, printers, IMAP, Telegram polling, Cookidoo, restore from file) are off in the cloud, and outbound requests cannot reach private addresses.
- **Plans and quotas** (`server/lib/plans.ts`): Free / Haushalt / Plus / trial / self-hosted entitlements, `consume()` for assistant messages, uploads and receipt reads, a storage quota per household (Free 250 MB, Haushalt 2 GB, Plus 5 GB; self-hosted unlimited or `STORAGE_QUOTA_MB`) enforced on every upload with HTTP 413, `GET /api/billing/status`, Apple StoreKit 2 transactions and App Store Server Notifications v2 verified against the Apple Root CA G3.
- **`GET /api/instance`** and **app tokens** (`POST /api/auth/app`, `GET/DELETE /api/auth/app/devices`) for the iPhone app, in both modes: a device token acts exactly as its member.
- **Encryption for self-hosted installs**: `DB_ENCRYPTION_KEY` encrypts the database, photos and backups; an existing plain database is converted once on start (verified per table, the plain original kept next to it until the admin deletes it).
- **Purchase rhythm without stock**: ToHuus merkt sich, how often each product is bought – from receipts (by the date printed on them, also while still in review) and list ticks – and suggests what is probably due, with its origin. Accept puts it on the list, dismissing twice keeps it quiet until it is bought again. Discreet and private products never appear. `GET /api/rhythm`, `POST /api/rhythm/:id/accept|dismiss`, MCP `purchase_rhythm`.
- **Assistant** (`/api/assistant/chat`, `/transcribe`, `/voice`, `/undo/:token`): shopping and household helper, cook planner, money helper with server-side tools (list, "haben wir noch …?", used up, rhythm, cook ideas, week plan, recipe to list, money, remember/forget, log a told purchase). Every write comes with undo. Works without an AI key for the common sentences ("Milch, 2 Paprika und Brot", "Milch ist alle", "Hab bei Aldi … für 12,40 gekauft"). Conversations private per person, kept 30 days. See [docs/assistant.md](docs/assistant.md).
- **What ToHuus remembers** (`ai_memory`): facts, preferences and routines on request, sensitive ones flagged and kept from the model without consent. `GET/POST/DELETE /api/memory`, MCP `remember`, `forget`, `household_context`.
- **Today in one call** (`GET /api/today`, [docs/api-today.md](docs/api-today.md)), **money overview** (`GET /api/money/overview`: by category, shop and week, vs. last month, price changes with price per kg/l, saving hints from own data only) and **cook ideas** (`GET /api/cook/ideas`: ready now or 1–2 missing, counting what the rhythm says is probably at home, allergy-safe on the server).
- **One AI client** (`server/lib/ai.ts`): OpenRouter by default, pinned to Mistral (EU, no fallbacks, no data collection); `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL_TEXT`, `AI_MODEL_VISION`, `AI_MODEL_VISION_HARD`, `AI_MODEL_AUDIO`; the older `VISION_*` keep working. Receipt photos that don't add up get a second try with the stronger model; receipt text goes out without card, loyalty and TSE data. A startup check warns when the vision model cannot read images.
- MCP: 114 tools in total.
- **App web link** `POST /api/auth/app/web-link`: a one-time, 60-second link that signs the iPhone app's web view in with a cookie session for the same member and household.
- **Household form "carer"** ("ich versorge noch jemanden mit") in signup, onboarding and settings.
- **Compression without a proxy**: the build writes `.br`/`.gz` next to the web files (`scripts/precompress.mjs`) and the server sends them by `Accept-Encoding`; JSON and text API answers above 1 kB are gzipped. ETags stay.
- Assistant quota: HTTP 402 `{ code: 'quota.assistant', remaining: 0 }` when the month's messages are used up (simple list sentences keep working without a model); AI receipt reads count per day (`quota.receiptAi`, HTTP 429). Undo also as `POST /api/assistant/undo` `{ undo }`.

- **Geld** (`/geld`): month switcher, total vs budget, by category and shop, weekly trend, price changes and hints from `/api/money/overview` (falls back to `/api/spend/stats`).
- **Assistant** button (microphone + text) on every tab with a chat sheet, voice via MediaRecorder → `/api/assistant/voice`, receipts for every change with "Rückgängig", suggestion chips and a calm note when the month's messages are used up. Hidden when the server has no assistant.
- **Web app wired to the real endpoints**: Heute, Einkauf (origin lines and the rhythm strip), Kochen (`ready` / `almost` / `probablyAtHome`), Geld (budget object, price per kg/l, hints) and Abo & Speicher read the shapes in `docs/api-today.md` and `docs/assistant.md`. The assistant button shows on every server (basic mode without an AI key; the microphone only with an audio model), a 402 `quota.assistant` gives a calm note while list sentences keep working, `throttled` a tiny hint, 429 `quota.receiptAi` a friendly message on receipt uploads. Recording prefers `audio/mp4`, then ogg/opus, webm last. New page *Was ToHuus sich merkt* (`/merkt-sich`, under Mehr) and the card *Assistent & Datenschutz* (`ai.healthShare`, off by default) in Settings › Access & AI. Cloud invitations ask for e-mail and password, cloud sign-in asks for the e-mail; a new cloud household skips the demo choice. Undo on a tick uses the normal un-tick, which also takes back the stock booking.
- **ToHuus Cloud in the web app**: `/signup` (only when `/api/instance` reports cloud with sign-up), Settings › "Abo & Speicher" with plan, trial, storage and assistant usage, data export and account deletion. Hidden on self-hosted servers.

### Changed

- **Photos need authentication**: `/img/…` answers only signed-in members, app/API tokens and short-lived signed URLs. Guest links, displays, kid tablets, Home Assistant, MCP and the apps get signed URLs automatically.
- The SQLite driver is now `better-sqlite3-multiple-ciphers` (installed as `better-sqlite3`, drop-in).
- **Health data stays at home unless allowed**: allergies, children's birth years and sensitive memory go to an AI (MCP or the assistant) only with the new consent `ai.healthShare` (default off). MCP `household_people` drops them without it; suggestion reasons in MCP answers never name a person ("für mindestens eine Person ungeeignet").
- **Automatic list entries for low stock are off by default** for new households and households that don't keep stock up to date; households that maintained stock keep their setting (migration `trust-2-autolist`).
- **Every list row says where it came from** (`origin` in `/api/shopping` and `/api/shop/list`).
- The browser may use the microphone for the assistant (`Permissions-Policy: microphone=(self)`).
- **Web app: speed.** Every page except the shell and "Heute" is its own chunk (`React.lazy`), React / React Router / TanStack Query are long-lived vendor chunks, place icons and kid-mode drawings left the first load, the German dictionary is a separate chunk preloaded for German browsers (`dict-preload.js`; the CSP allows no inline scripts). Initial JS 580 kB → 134 kB gzip (English) / 237 kB with the German dictionary. Fonts: latin + latin-ext woff2 only, `font-display: swap`, Familjen Grotesk preloaded. Queries stay fresh for 2 minutes (SSE invalidates changes), tabs prefetch their page and first query on hover / touchstart. The service worker (v4) precaches every hashed file from `asset-manifest.json`, so lazy pages work offline, and prunes files of older builds. "Heute" gets its content from one request (`/api/today`); opening the app on Heute makes 7 API calls instead of 14 (two of them deferred); without that endpoint it falls back to `/overview`, `/shopping` and `/spend/stats`.
- **Web app: five tabs** Heute · Einkauf · Vorrat · Kochen · Geld (plan 2026-10-12). The bottom tab bar is white with a green active tab, the desktop sidebar is light with the five tabs and a "Mehr" section; everything else lives on `/mehr` (avatar on Heute). All existing routes still work.
- **Heute** rebuilt from `/api/today`: at most five calm cards (Fällig with "merkt sich" rhythm and "Auf die Liste" / "Haben wir noch", Liste with origin of the last changes, Das habt ihr noch, Heute kochen?, Geld) and an empty state with the three ways in (Bon teilen, Foto vom Zettel, Einfach sagen).
- **Einkauf**: every row shows its origin (`origin`, older servers `source` + `added_by`), a "Vorschläge" strip from `/api/rhythm` with accept / dismiss, an undo toast for ticks. The optimistic tick now updates the right cache entry.
- **Kochen** is one screen with "Was kochen wir?" (cook ideas from `/api/cook/ideas`, the what-to-eat panel, swipe deck), "Woche" and "Rezepte".
- **Onboarding**: "Wer gehört dazu?" (incl. "ich versorge noch jemanden mit") → "Wo ist eure Liste heute?" → 30-second walkthrough "da · fehlt · egal" → "Wer kauft sonst ein?" → "Bon teilen". The older place / stock steps stay reachable via `/willkommen?step=places|spots|stock`.

- **Swedish removed as UI language; region Sweden stays.** The app, notifications and demo data are English or German. The region Sweden (SEK, Swedish receipts from ICA, Coop, Willys and others, Swedish product names from Open Food Facts, Swedish stores in store mode) is unchanged. A household that ran in Swedish switches to English on update (migration `lang-sv-removed-1`), and its base places and categories that still carry their Swedish default names get their English names back; renamed places, products and recipes stay as they are.

### Security (review 12 Oct 2026)

- Household deletion and the cloud export are decided by the household's own `users` row (role, kind, guest level); the `memberships` mirror in accounts.db is kept in sync on every role or kind change. Export is for admins only.
- Account deletion never hands a household to a permanent guest or an expired membership; with nobody else to run it, the household is shredded. Deleting the account or a household needs the password (or a fresh e-mail link for password-less accounts).
- Sign-in, signup, e-mail link, reset and invite rate limits are global; a household prefix in the query or body no longer opens a fresh bucket, and sign-in routes never take a household from the request.
- Crypto-shredding: `secure_delete` on all databases, a shred log applied when accounts.db is opened (also after a restore), the wrapped key scrubbed from local accounts backups, S3 copies of the household deleted.
- AI recipe/product imports count against a daily allowance (Free 10, Haushalt 40, Plus 100); model input capped at 50 kB.
- StoreKit: Production only by default, Sandbox for tester accounts (`APPLE_SANDBOX_ACCOUNTS`); a late, older transaction never shortens a later expiry; the iPhone app refuses purchases without a household.
- Smaller: capped web links, invite checked before an account is created (and `CLOUD_SIGNUP` respected), no internals in 500 answers in production (reference id in the log), a 40-megapixel limit for every image decode, API gzip off the event loop, large JSON writes count against storage, an atomic self-host encryption swap with recovery of a missing database.

### Fixed

- "Clear checked" no longer deletes ticked items: they are hidden and stay purchase signals (`cleared_at`).
- Un-ticking an item now takes back the stock its tick booked (app, store mode, offline replay, MCP, Home Assistant).
- A receipt applied within 3 days of a tick that booked the same product no longer books it twice.

## Wave 5 (2026-10-11)

### Added

- **Sharing into the app** (area `share`): web share target for Android and desktop, an iPhone Shortcut with a personal key that can only add to the shopping list, a landing page that sends shared text, links, photos and PDFs to the list, a recipe import or a receipt import. WhatsApp and Signal message prefixes are stripped.
- **Discreet and private shopping items**: "discreet" shows others a neutral placeholder, "only me" hides the item from everyone else. The real name never reaches Home Assistant, Telegram, displays, tickets, guest links, digests or MCP.
- **Start mode "only what runs out"**: track only the staples that regularly run out, switch to everything any time.
- **Leftover and freezer labels** (area `labels`): put a box away in two taps, short code and QR label (A4 sticker sheets, thermal label printers, PNG), scan to eat, thaw, throw away, plan or undo; every action books stock.
- **Trips** (area `away`): use up before leaving, packing list with stock items booked out and back, checklist, quiet notifications and paused shopping suggestions, holiday kitchen, house-sitter link, welcome-home list, check of what expired, Home Assistant presence suggestion.
- **Week plan 2** (area `plan2`): plan templates and a rotation of up to six weeks, family food votes (secret or together mode, kids vote without a login), day marks (away, eating out), servings per plan entry that scale shopping and stock booking.
- **Recipe import and export** (area `recipes2`): bulk JSON endpoint, files from Mealie, Tandoor, Paprika, Nextcloud Cookbook, KitchenOwl, Grocy, TheMealDB, HTML and CSV with a preview, an AI prompt template for any chat, TheMealDB search with ingredient lines translated to the household language and units, JSON export in the import format, idempotent re-import, a background photo queue.
- **Receipt recognition** (area `quality`): rules learned from corrections in the review (per store, visible and deletable), store recognition by VAT id, a recognition report per import and statistics, "Help improve recognition" with anonymised receipt fixtures that are never sent automatically. The generic German parser learned many more line structures (quantity lines before the item, discounts naming another item, voids, returns, the Lidl digital deposit receipt).
- **People** (area `people`): one list of members, children and permanent guests; profile pictures (photo, drawn animal or initials); likes, dislikes and allergies that steer suggestions; per-person recipe ratings and family favourites; permanent guests with four levels (order, stock, recipes, family) and temporary overrides, enforced on the server; login links an admin can hand out.
- **Tour, demo data and reset** (area `tour`): a guided tour, "start empty" or "explore with demo data" on first start, demo rows recorded precisely and removable, "start over" for chosen areas with an automatic backup first and a schema-driven split of tables.
- **Home Assistant two-way** (area `ha2`): per topic, Home Assistant or ToHuus Hub is the source, or both: shopping list with HA to-do lists, meal plan with HA calendars, due care tasks to a to-do list, presence, notifications through the companion app, NFC tags as quick actions. A voice command guide for the babysitter page with a hard safety filter. Requires the HA integration 0.2.0 or the REST fallback.
- **Order menu editor** (area `menu`): groups, items from stock and menu-only items with ingredients booked per serving, templates and suggestions.
- **Nordic redesign** (area `design`): warm paper tones, one brand colour, light and dark mode, a household default with optional personal choice, new cottage icon for both brands. Rationale in [docs/design/2026-10-11-nordic-direction.md](docs/design/2026-10-11-nordic-direction.md).
- **Automatic backup before migrations**: before the first pending schema migration on an existing household, the database is copied into the backups folder.
- Demo recipes now have photos (Unsplash, credited in `server/assets/demo-recipes/CREDITS.md`); the website shows real app screenshots per language in light and dark.
- MCP: 106 tools in total.

### Changed

- Brand: `BRAND` in the environment is the default look; an admin's explicit choice in *Settings › Household › Brand* wins over it (new key `brand.choice`; choosing the default again removes it). The old `brand` key is ignored, because onboarding used to store it without anyone choosing. Onboarding only stores a look that was actually changed.
- Recipe photos: links are kept on the recipe and shown right away until the local copy is downloaded; URL import, Cookidoo week sync and MCP use the same photo queue as file imports. Downloads look like a browser (User-Agent, Accept, Referer of the recipe page), wait up to 25 s, retry with backoff and log one line per host and reason. Cookidoo photos are fetched as 876×720 instead of 4000+ px originals (less memory on small servers).

### Fixed

- Imported recipe photos that never arrived: *Settings › Recipes* shows loaded / waiting / failed with the reason, **Load missing photos** retries them all, and **Load photos through this browser** fetches them in the browser when the server is blocked (`POST /api/recipes/import/images/retry`, `GET /api/recipes/import/images/missing`, `POST /api/recipes/import/images/:id`).
- Security review: guest-policy bypass through upper-case paths, SSRF through IPv6 addresses, guest gating in Telegram, a denial of service on the share endpoint, TOTP, CSV injection, the CSRF check. Regression tests in `test/security-wave5.test.ts`.
- The MCP path secret is shown to admins only; guests can no longer print care tickets; plan templates no longer copy vote notes and box notes.
- White screen after filling the week.

## Wave 4 (2026-10-10)

### Added

- **What do we eat today?** (area `cook2`): planned today, ready now, one thing missing with "take X instead", leftovers first, quick dishes, filters, and a weighted random pick.
- **House versions of recipes**: per-recipe changes that never touch the original, and house-wide swap rules; suggestions, cooking and shopping use the house version.
- **Cookidoo push from Home Assistant**: the HA integration sends the Cookidoo week; no HA token needed in ToHuus Hub.
- **Spending analytics** (area `spend2`): week, month, year and all-time charts, budgets with forecast and warnings, manual expenses, tags, exclusions, export.
- **Sign-in** (area `auth`): one-time e-mail links bound to the asking browser, passkeys, single sign-on with OpenID Connect, TOTP, PIN switch on shared devices, device list, new-sign-in alerts, `AUTH_BREAK_GLASS`. See [docs/auth.md](docs/auth.md).
- **Tickets and thermal printers** (area `print`): receipt-style tickets for shopping lists, kitchen orders, care tasks, kid wishes, recipe cards and the week plan, printed over ESC/POS or sent to Telegram, Matrix, Gotify or e-mail, with automations.

## Wave 3 (2026-10-10)

### Added

- **Home Assistant integration** for HACS (area `ha`, integration 0.1.0): shopping list as a to-do list, meal plan and care calendars, sensors, buttons, display images, events, actions, live updates, two dashboards. See [docs/home-assistant.md](docs/home-assistant.md).
- **More channels** (area `channels`): Telegram (two-way), Gotify, Matrix.
- **Regions** (area `intl`): currency, number and date format, units shown in recipes, first day of the week; UK, US and Swedish receipt parsers.
- Swedish UI. Light app icons.

## Wave 2 (2026-10-10)

### Added

- **Kitchen and wall displays** (area `kiosk`): token links with three layouts and night dimming that run on old tablets, a PNG for e-ink frames and Home Assistant.
- **Kid mode** (area `kids`): kid profiles with drawn animals, paired tablets, picture wishes with parent approval, whitelists, daily limits, quiet hours, read-aloud, "where is" with place photos.
- **Onboarding** (area `onboard`): a three-step setup for new households, starter sets per room, a getting-started checklist, grouped navigation, "what's new", a help page.
- **Retail** (area `retail`): IMAP receipt inbox, a generic German receipt parser (Lidl, Aldi, Edeka, Netto, Kaufland, Penny, dm, Rossmann and more), best-before versus use-by, estimated value of wasted food.
- README comparison table; fonts for e-ink rendering in the Docker image.

## Wave 1 (2026-10-10)

### Added

- **Party mode** (area `party`): start in two taps, party menu with limits, TV board with guest and kitchen views and a pairing code, per-device guest orders, soft reservation, automatic end, recap to the shopping list, templates.
- **Data** (area `data`): export without secrets, hashed guest tokens, nightly backups with rotation, restore, WebDAV off-site copy, member invites, optional hidden login names.
- **Keeping stock fresh** (area `fresh`): quick check per place, opened, frozen and thawed with shelf life, leftovers after cooking, "eat me first" on Today, consumption forecast, waste insights.
- **Store mode** (area `shop`): learned aisle order, offline use with a replay queue, "I'll take care of it" claims, natural-language quick add, Web Push, Home Assistant to-do sync.
- **Home care and spending** (area `home`): care tasks from templates, spending from receipts with price history, printable QR labels with quick actions.
- The structure for feature areas: named migrations, one router per area, MCP tool modules, locale fragments; research reports in `docs/research/`.

## Before the waves (2026-10-10)

- First working version (then called Stockwerk): stock with places and fill levels, shopping list, REWE order notices and eBons, photo imports, recipes, guest bar, MCP server, Docker.
- Security hardening and review fixes.
- Fredirando home-delivery theme and brand switch.
- Week plan with shopping for the week; Cookidoo week through Home Assistant.
- "Where is what" with exact spots and the babysitter link; moving the week plan.
- English-first UI and server strings, German as a bundled translation.
- Renamed to ToHuus Hub; existing `stockwerk.db` files are picked up automatically.
- Website (English and German) on GitHub Pages, CI, Docker image workflow.
- Order from the sofa; light design by default.
