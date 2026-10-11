# Architecture

A guide for developers and coding agents who want to change ToHuus Hub. It describes the code as it is; the history is in [CHANGELOG.md](../CHANGELOG.md).

ToHuus Hub is one Node.js process with one SQLite database. The server renders nothing except a few small pages for displays and serves a React single-page app. There is no message queue, no Redis and no separate worker; background jobs run on timers in the same process.

## Folders

```
server/
  index.ts           Express app: security headers, CSRF check, routers, static web app, brand files
  config.ts          environment variables (the only place that reads most of them)
  db.ts              opens the database, numbered core migrations, migrate() for named ones, settings, brand(), lang()
  i18n.ts            t() for server strings; dictionaries in server/locales/
  languages.ts       the list of UI languages (shared with the web app)
  seed.ts            base places and categories, the demo household
  routes/<area>.ts   one Express router per area, all mounted under /api
  lib/<area>.ts      logic per area, including its tables (named migrations)
  mcp/server.ts      MCP endpoint and the core tools
  mcp/tools-<area>.ts  MCP tools per area
  importers/         receipt parsers: rewe.ts, generic.ts (German tills), intl.ts (UK, US, SE)
  locales/           de-<area>.ts, sv-<area>.ts
  assets/            demo recipe photos (see CREDITS.md)
web/
  public/            icons, manifest, service worker (sw.js), theme-boot.js, zxing WASM
  src/App.tsx        routing, the shell (sidebar, tab bar, "More"), guest-level filtering
  src/api.ts         fetch helpers, useApi() on TanStack Query, the server-sent-events client
  src/pages/         screens and settings cards
  src/people/, src/shop/   larger areas with several components
  src/locales/de/, src/locales/sv/   web dictionaries per area
  src/styles.css     design tokens and all styles (see docs/design/)
  src/changelog.ts   the in-app "What's new"
ha-integration/      the Home Assistant custom integration (Python, MIT), published as tillheidrich/tohuus-hub-ha
site/                the marketing website (EN/DE), deployed to GitHub Pages
test/                vitest suites per area, fixtures in test/fixtures/
docs/                this documentation, research notes, design notes
```

## Areas

Most features are an "area" with the same shape: `server/routes/<area>.ts`, `server/lib/<area>.ts`, `server/mcp/tools-<area>.ts`, `server/locales/{de,sv}-<area>.ts`, `web/src/locales/{de,sv}/<area>.ts`, pages under `web/src/pages/`, and `test/<area>.test.ts`. Current areas: core (stock, products, places, shopping, settings), imports, recipes, guest, data, party, fresh, shop, home (care, spending, QR), kiosk, kids, onboard, retail, ha, channels, intl, cook2, auth, spend2, print, share, labels, away, plan2, recipes2, quality, people, tour, ha2, menu, design.

Two areas have no MCP tools on purpose: `auth` and `ha` (their modules exist but register nothing).

Modules import each other directly. Where a cycle would appear, a small dependency-free part is split out (`share-core.ts`, `away-state.ts`, `people-policy.ts`, `people-signals.ts`, `fresh-shelf.ts`), and the comment at the top of each file says who may import it.

## Request flow

1. `restore-boot.ts` runs first and applies a staged restore before the database is opened.
2. Every response gets security headers: a strict Content Security Policy, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, a narrow `Permissions-Policy`.
3. **CSRF**: on `/api`, a write (anything but GET, HEAD, OPTIONS) authenticated by cookie must come from `BASE_URL`'s origin (`Origin` or `Sec-Fetch-Site: same-origin`). Requests with a Bearer token or `x-api-key`, and guest-link routes, skip this check because they cannot ride on a cookie.
4. `/mcp` and `/mcp/:secret` go to the MCP handler.
5. Public routers come first: the share endpoint for the iPhone Shortcut, guest links (`/api/guest`), the party board, displays, kid tablets (`/api/kid`), invites, the Telegram webhook, sign-in.
6. Then all area routers under `/api`. Each route calls `requireAuth` or `requireAdmin` from `server/lib/auth.ts`.
7. Anything else under `/api` is a 404. Other paths get the web app's `index.html` with the household language and theme written into the `<html>` tag, or the Fredirando variant.
8. Errors: zod validation errors become 400 with the issues, upload size errors 413, everything else 500 with a message.

### Who is asking (actors)

`requireAuth` resolves the actor once per request:

| Actor | How | Notes |
|---|---|---|
| member or admin | session cookie | random token, stored as SHA-256; sessions on a shared device are bound to that device |
| permanent guest | session cookie, `users.kind = 'guest'` | checked against `guestMay()` on every request, see [guests-and-permissions.md](guests-and-permissions.md) |
| API token | `Authorization: Bearer sw_…` or `x-api-key` | scope `full` (acts as admin), `mcp` (only `/mcp`), `ha` (only `/api/ha/*` and `/api/events`) |
| guest link | token in the URL path | scopes `bar`, `stock`, `shopping`; stored as a hash |
| kid tablet, display, party board | device or display token | each with its own small router and read-only data |

## Database and migrations

`better-sqlite3` with WAL, foreign keys on and a 5 second busy timeout. All queries are synchronous, which keeps transactions simple (`db.transaction(() => …)()`).

There are two kinds of migrations:

- **Core migrations** in `server/db.ts`: a numbered, append-only array, tracked in `_migrations`.
- **Named migrations** for areas: `migrate('labels-2', sql)` at module load, tracked by name in `_migrations_named`. A name runs exactly once. Never edit SQL that has shipped; add `labels-3`.

Before the first pending named migration on an existing household, `preMigrationBackup()` copies the database into `backups/` with `VACUUM INTO`. Each migration runs in a transaction.

Settings are JSON values in the `settings` table (`getSetting`, `setSetting`). Any settings field whose name contains `token`, `passw` or `secret` (and a few more words) is dropped from the JSON export, so put credentials in fields named that way.

Images are stored as WebP in `DATA_DIR/images` and served under `/img/` with long cache headers.

## Live updates (bus)

`server/lib/bus.ts` is a small server-sent-events hub. After a write, code calls `emit('shopping', 'stock')` with one or more topics (`stock`, `products`, `shopping`, `recipes`, `imports`, `orders`, `notifications`, `settings`, `care`, `away`, `tour`).

- Browsers keep one `EventSource` on `/api/events`. On a `change` event, `web/src/api.ts` invalidates the TanStack Query keys mapped to those topics, and the screens refetch.
- Guest-link clients only receive stock, product, order and shopping topics.
- The Home Assistant integration listens on the same stream (with its `ha` token) and refreshes within a second.
- In-process listeners (`onEmit`) let modules react to changes, for example the Home Assistant to-do sync.
- Limits: 200 clients, of which at most 60 guests.

## Background jobs (scheduler)

Everything runs in the server process on timers:

| Job | When | Where |
|---|---|---|
| expiry warnings, due care tasks, budget warnings, plan rotation, daily digest | every 15 minutes (the digest only at its hour) | `lib/scheduler.ts` |
| nightly backup and WebDAV copy | checked every 15 minutes, runs once after 03:00 | `lib/backup.ts` |
| Cookidoo pull (only with HA address and token) | every 3 hours | `lib/plan.ts` |
| product photos from Open Food Facts | after start, then every 6 hours | `lib/enrich.ts` |
| receipt inbox (IMAP) | every 10 minutes | `lib/retail-inbox.ts` |
| party end, guest-level overrides | own timers | `lib/party.ts`, `lib/people.ts` |
| Telegram long polling | continuous, when configured | `lib/telegram.ts` |
| recipe photo downloads | small throttled queue, resumed on start | `lib/recipes2.ts` |

Times use `TZ`. Notifications go through `notify()` in `lib/notify.ts`, which routes each event to the channels switched on for it, respects quiet hours during a trip, and de-duplicates repeats.

## Internationalisation

The English text is the key everywhere: `t('Shopping list')`, with placeholders `t('{n} items', { n })`.

- Server strings (notifications, e-mails, API errors): `server/i18n.ts`, dictionaries `server/locales/de-<area>.ts` and `sv-<area>.ts`, merged per language. The language is the household setting.
- Web strings: `web/src/i18n.ts`, dictionaries `web/src/locales/de/<area>.ts` and `sv/<area>.ts`, registered in each folder's `index.ts`.
- A missing translation falls back to English.
- To add a language: add it to `server/languages.ts`, add dictionary files on both sides and register them. `test/languages.test.ts` checks the setup.
- The region (currency, units, number format, receipts) is separate from the language: `server/lib/region.ts`, `web/src/region.ts`.

## MCP

`server/mcp/server.ts` builds a fresh, stateless MCP server per request (Streamable HTTP, JSON responses, POST only). The actor name from the token is used in history entries ("Claude added …"). Authentication:

- `/mcp/<token>` with an MCP-scoped token (only that scope is accepted in a URL, because URLs end up in logs), or `/mcp/<MCP_PATH_SECRET>`;
- `/mcp` with `Authorization: Bearer` and a `full` or `mcp` token.

Tools are registered with `s.registerTool(name, { title, description, inputSchema, annotations }, handler)`. Read-only tools carry `readOnlyHint`. There are 106 tools; the list is in [mcp.md](mcp.md). MCP tools must respect the same privacy rules as the UI: discreet and private items are never returned by name.

## Home Assistant

Three paths, described in [home-assistant.md](home-assistant.md): the HACS integration polls `/api/ha/v1/*` and listens to `/api/events`; the two-way bridge (`lib/ha2.ts`, `lib/ha2-engine.ts`) reconciles topics with a three-way merge and an acknowledged outbox; the REST fallback calls Home Assistant with an address and long-lived token. The sync engine is pure and tested on its own.

## Web app

React 19 with React Router and TanStack Query. One stylesheet with design tokens (`web/src/styles.css`), light and dark themes, two brands. `theme-boot.js` sets the theme before the first paint. The service worker caches the app shell and the shopping list for offline use, replays queued shopping changes, receives Web Push with action buttons, and holds shared files until the share page picks them up. Design rules and tokens: [design/2026-10-11-nordic-direction.md](design/2026-10-11-nordic-direction.md).

## Security model

- **One household per instance.** There is no tenant separation inside the database; run one instance per household.
- **Passwords**: scrypt. **Sessions, API tokens, guest links, display tokens, share keys, sign-in links**: random values stored as SHA-256 hashes; the plain value is shown once. A party's tokens are kept in plain text only while the party runs (the TV shows the join QR) and are cleared at the end.
- **Sign-in**: rate limits per IP and per name, optional TOTP, passkeys with user verification, OIDC with PKCE, state and nonce, e-mail links bound to the asking browser. See [auth.md](auth.md).
- **CSRF**: origin check on cookie-authenticated writes (see request flow). Cookies are httpOnly and SameSite=Lax.
- **Authorization**: `requireAuth`/`requireAdmin` per route; token scopes; the permanent-guest allowlist enforced centrally, with paths lower-cased before matching.
- **Outgoing requests** for user-supplied URLs (recipe links, receipt QR links, photos, WebDAV, webhooks) go through `lib/net.ts`: private and internal networks (IPv4 and IPv6) are blocked at connect time, so DNS rebinding does not help; redirects, size and time are limited.
- **Privacy by construction**: discreet and private shopping items keep only a placeholder in `shopping_items`, so every reader of that table (Home Assistant, Telegram, displays, tickets, MCP, guest links, digests) sees the placeholder at worst; private items are additionally filtered with `notPrivate()`. Displays show only what their widgets list. The sitter voice guide filters locks, alarms, cameras and similar devices.
- **Exports** drop sessions, tokens and secret fields. Backups are full copies and must be stored privately.
- **Anonymised receipts** (`lib/redact.ts`) remove addresses, card, loyalty and TSE data, names and links, and blur dates and times. They are only built on request and never sent automatically.
- **No telemetry.**

`test/security-wave5.test.ts` holds regression tests for the issues found in the last review (guest-policy case bypass, IPv6 SSRF, Telegram guest gating, share endpoint limits, TOTP, CSV injection, CSRF).

## Testing and CI

`npm test` runs vitest over `test/*.test.ts` (455 tests in 32 files as of October 2026). Tests that touch the database set `DATA_DIR` to a fresh temporary folder before importing the server modules. Receipt fixtures are synthetic; real receipts used during development stay in the git-ignored `test/fixtures/private/`. GitHub Actions runs tests and the build on every push and pull request, builds the Docker image for `main` (`ghcr.io/tillheidrich/tohuus-hub`), and deploys `site/` to GitHub Pages.
