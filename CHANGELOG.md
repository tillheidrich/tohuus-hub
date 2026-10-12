# Changelog

ToHuus Hub is developed in waves: each wave adds a set of feature areas, then gets a review pass. Dates are when the wave landed on `main`. The package version is still `0.1.0`; the Home Assistant integration has its own changelog in [ha-integration/CHANGELOG.md](ha-integration/CHANGELOG.md).

## Unreleased

### Added

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

### Changed

- **Photos need authentication**: `/img/…` answers only signed-in members, app/API tokens and short-lived signed URLs. Guest links, displays, kid tablets, Home Assistant, MCP and the apps get signed URLs automatically.
- The SQLite driver is now `better-sqlite3-multiple-ciphers` (installed as `better-sqlite3`, drop-in).
- **Health data stays at home unless allowed**: allergies, children's birth years and sensitive memory go to an AI (MCP or the assistant) only with the new consent `ai.healthShare` (default off). MCP `household_people` drops them without it; suggestion reasons in MCP answers never name a person ("für mindestens eine Person ungeeignet").
- **Automatic list entries for low stock are off by default** for new households and households that don't keep stock up to date; households that maintained stock keep their setting (migration `trust-2-autolist`).
- **Every list row says where it came from** (`origin` in `/api/shopping` and `/api/shop/list`).
- The browser may use the microphone for the assistant (`Permissions-Policy: microphone=(self)`).

- **Swedish removed as UI language; region Sweden stays.** The app, notifications and demo data are English or German. The region Sweden (SEK, Swedish receipts from ICA, Coop, Willys and others, Swedish product names from Open Food Facts, Swedish stores in store mode) is unchanged. A household that ran in Swedish switches to English on update (migration `lang-sv-removed-1`), and its base places and categories that still carry their Swedish default names get their English names back; renamed places, products and recipes stay as they are.

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
