# ToHuus Hub – guide for Claude Code

ToHuus is the shopping and household assistant of a home: it remembers what is missing (Einkauf), what to cook from what is there (Kochen) and where the money for food and household goes (Geld), and which household tasks are due and who keeps what in mind (Aufgaben, decision 14 Oct 2026 – for one person, a shared flat or a family; see `docs/tasks.md`). Tasks with a time are appointments and go into the person's own calendar app (CalDAV, subscription link, single entry) – ToHuus has no calendar view of its own. It is **not** a family calendar, chat, points system, nutrition/health log or tracking tool: no streaks, rankings or rewards. Strategy source: Outline wiki, collection "ToHuus Hub / Fredirando" (newest handover pages first).

Status of 13 Oct 2026 and the open work: [docs/status-2026-10-13.md](docs/status-2026-10-13.md); latest handover: [docs/uebergabe-2026-10-14-nacht.md](docs/uebergabe-2026-10-14-nacht.md) (before: docs/uebergabe-2026-10-13-abend.md).

## Repo map

| Path | What |
|---|---|
| `server/` | Node 22 / Express 5, TypeScript. `server/routes/*` HTTP, `server/lib/*` logic, `server/locales/de-*.ts` German strings |
| `web/` | React 19 web app (PWA). Pages in `web/src/pages`, list UI in `web/src/shop`, money in `web/src/money`, German strings in `web/src/locales/de/*.ts` |
| `ios/` | Native SwiftUI app (iPhone, iPad, Apple Watch, widget, share extension). XcodeGen `ios/project.yml`; German strings: `ios/tools/strings_de*.json` → `python3 ios/tools/gen_strings.py` generates `Localizable.xcstrings` |
| `site/` | Marketing website + help pages, built by `site/src/build.mjs`, deployed by GitHub Pages (`.github/workflows/pages.yml`) |
| `ha-integration/` | Home Assistant (HACS) integration |
| `test/` | vitest suites (≈940 tests) |
| `docs/` | Architecture and API docs – read the one for your area before coding |
| `scripts/` | `ui-audit.mjs` (web layout audit), `restore-check.ts`, `restore-files.ts`, assistant eval |

## Commands

```bash
npm ci
npm run typecheck        # tsc
npx vitest run           # full test suite
npm run build            # web (vite) + server bundle → dist/
npm run dev              # local server with watch
```

iOS: `cd ios && xcodegen generate && open ToHuus.xcodeproj` (team FVS7WVTQ67, bundle `de.heidrichdigital.tohuus`, automatic signing). Debug launch args (`-debugServer`, `-debugToken`, `-debugHousehold`, `-debugTab …`) are listed in `docs/ios-0.2.md`.

## Two modes, one codebase

- **ToHuus Cloud** (`MULTI_TENANT=true`): many households, one encrypted SQLite file per household (`DATA_DIR/households/<uuid>/tohuus.db`), accounts in encrypted `accounts.db`, envelope encryption with `TOHUUS_MASTER_KEY`. Live at https://cloud.tohuus.heidrich-digital.de (Coolify app `tohuus-cloud`). Back office for operators at `/betrieb`. Sign-up is gated by the beta gate (`CLOUD_SIGNUP=invite` by default; codes/allowlist in `/betrieb`). See `docs/cloud.md`.
- **Self-hosted** (`MULTI_TENANT=false`): one household, web app/PWA, Home Assistant, MCP. Since 14 Oct 2026 the App Store app connects to a self-hosted server too ("Eigener Server" on the start screen; replaces the cloud-only decision of 12 Oct): every feature works on both, purchases exist only in the cloud.
- **Web ↔ iOS parity** (decision 14 Oct 2026): every web function exists natively in the iOS app, no compromises and no web views for features. A new web feature is not done until the iOS screen exists (and the other way round). Structure and UX benchmark: `docs/design/ux-benchmark-2026-10-14.md`.

## Rules that are easy to break

- No module-level DB calls (use `onDbReady`); per-household caches via `ScopedMap`/`perHousehold` (`server/lib/tenancy.ts`); files only via `server/lib/images.ts`; every new GET returning household data must be covered by `test/cloud-isolation.test.ts`.
- AI only through `server/lib/ai.ts` (OpenRouter pinned to Mistral/EU, fallback models, runtime settings from the back office) and counted with `plans.consume(...)`. The household AI switch, kid lock and health-data consent (`ai.health_share`) must be respected.
- Privacy inside the household: sessions, assistant conversations, personal settings, private lists, private wish lists, reservations on wishes (hidden from the person the wish is for) and personal money entries are never visible to other members, guests, the assistant, MCP, HA, notifications, exports or widgets. Hausinfo codes never leave via AI/MCP/HA/logs/exports.
- Stores are neutral: no chain is preferred by default; order follows the household's own use.
- German copy: du-Form, plain, warm, short, no marketing speak. Countable things are "Sache/Sachen", never "Ding/Dinge" (Till, 14 Oct 2026). The assistant button is a round assistant icon (sparkle, label "Assistent" for screen readers) since 14 Oct 2026 – no longer "Sprechen"; the microphone inside the assistant still dictates. The treat feature is called **"Bring mir was"** (routes/keys still say order/bar/treats). Never use real names of the founder's family in code, UI, fixtures or screenshots – examples use Mira, Mika, Sam, Ben, Familie Berg.
- Visual design: "Dutch Detail" (`docs/design/2026-10-11-dutch-detail-system.md`), white tab bar, tap targets ≥ 44 px, respects reduced motion, contrast checked by `node docs/design/check-contrast.mjs`.
- Every API change goes into `docs/` and a line under "Unreleased" in `CHANGELOG.md`.

## Releasing

- Server: push to `main` on GitHub → deploy the Coolify app `tohuus-cloud` (and the self-host demo if wanted).
- iOS: bump `CURRENT_PROJECT_VERSION` in `ios/project.yml`, archive Release for `generic/platform=iOS` with `-allowProvisioningUpdates`, export with method `app-store-connect` / destination `upload`. App Store Connect app id 6822059656, TestFlight group "Intern". In-app purchases are created in App Store Connect by Till, not by an agent.
