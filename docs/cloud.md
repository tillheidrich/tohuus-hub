# ToHuus Cloud – operations

ToHuus Cloud is the same image as the self-hosted ToHuus Hub, started with `MULTI_TENANT=true`. It holds many
households; each one has its own encrypted SQLite database. This page is for whoever runs the cloud instance.
The binding product and API contract is [plan-2026-10-12.md](plan-2026-10-12.md); the code map is
[architecture.md](architecture.md).

## How it is built

```
DATA_DIR/
  accounts.db                     accounts, households, memberships, sessions, app tokens, billing, usage (encrypted)
  households/<uuid>/tohuus.db     one household (encrypted with its own key)
  households/<uuid>/images/       photos, AES-256-GCM per file
  households/<uuid>/imports/      receipt files, AES-256-GCM per file
  backups/<uuid>/                 nightly VACUUM INTO copies (encrypted like the database)
  backups/_accounts/              nightly copies of accounts.db
```

- **Household context.** Every request and background job runs inside one household (`AsyncLocalStorage`,
  `server/lib/tenancy.ts`). `db` from `server/db.ts` resolves to that household's connection from an LRU pool
  (`HOUSEHOLD_POOL_MAX`, default 64; idle handles close after `HOUSEHOLD_POOL_IDLE_MIN` minutes). Without a
  context every database access throws, and protected routes answer 401 – the system fails closed.
- **Which household?** `server/lib/cloud-auth.ts`, in this order: app token (`Authorization: Bearer sw_app_…`,
  household from `X-Household` or the one used last) → a household token in header, path, query or (without a
  session) body → a signed image URL → the cookie session's active household. Household tokens (guest links,
  displays, invites, HA/MCP tokens, list tokens, QR labels, kid tablets …) start with the household's routing
  prefix `h<10 chars>_`; the token itself is still checked (hashed) inside that household, so a forged prefix finds
  nothing.
- **Migrations** (`migrate(name, sql)` and the numbered core ones) are registered at start-up and applied to
  every household database when it is opened.
- **Module state** that holds household data is kept per household (`perHousehold`, `ScopedMap`, `ScopedSet`);
  background queues remember the household of each entry; server-sent events are per household.
- **Accounts**: e-mail + scrypt password, e-mail links. A membership maps an account to a `users.id` inside the
  household database, so every feature sees the same `Actor` as in self-host.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `MULTI_TENANT=true` | yes | cloud mode |
| `TOHUUS_MASTER_KEY` | yes | 32 random bytes, base64 (`openssl rand -base64 32`). Environment only – never on the data volume. Without it the server refuses to start. |
| `BASE_URL` | yes | public URL of the cloud (links, signed image URLs, passkey RP-ID later) |
| `DATA_DIR` | – | default `./data` (`/data` in the image) |
| `SMTP_*` | recommended | verification, sign-in and reset mails |
| `CLOUD_SIGNUP=false` | – | close signups (existing accounts keep working) |
| `CLOUD_NAME` | – | name in `/api/instance` (default "ToHuus Cloud") |
| `HOUSEHOLD_POOL_MAX`, `HOUSEHOLD_POOL_IDLE_MIN` | – | connection pool (64, 10) |
| `SSE_MAX_TOTAL` | – | live-update connections over all households (5000; 200 per household) |
| `LEGAL_PRIVACY_URL`, `LEGAL_TERMS_URL`, `LEGAL_IMPRINT_URL` | – | shown by the apps via `/api/instance` |
| `APPLE_BUNDLE_ID` | – | default `de.heidrichdigital.tohuus` |
| `APPLE_ENVIRONMENTS` | – | StoreKit environments accepted for everyone, default `Production` |
| `APPLE_SANDBOX_ACCOUNTS` | – | comma-separated e-mails of TestFlight testers: Sandbox purchases count only for households with one of these accounts |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, `BACKUP_S3_PREFIX` | – | off-site copy of every nightly backup (S3-compatible, e.g. Hetzner Object Storage `https://fsn1.your-objectstorage.com`) |
| `AI_*` | – | assistant, voice and receipt photos – [assistant.md](assistant.md); every OpenRouter request is pinned to Mistral (EU) |
| `OPERATOR_EMAILS` | – | comma-separated account e-mails that may open the operator page `/betrieb` |
| `AI_PRICE_PER_MTOK`, `AI_PRICES`, `AI_PRICE_CURRENCY` | – | prices for the AI cost estimate on `/betrieb` (`"in,out"` per million tokens, default `0.1,0.3`; JSON per model; label, default `USD`) |
| `OCR_DISABLED=1`, `TESSERACT_BIN` | – | switch server text recognition off / use another binary ([receipts.md](receipts.md)) |

`ADMIN_NAME`/`ADMIN_PASSWORD`, `SEED_DEMO`, `MCP_PATH_SECRET`, `OIDC_*` and `DB_ENCRYPTION_KEY` are self-host only
and ignored in the cloud.

## Keys

- `TOHUUS_MASTER_KEY` → HKDF-SHA256 → `accounts` (SQLCipher key of accounts.db) and `dek-wrap` (wraps the
  household keys).
- Each household has a random 256-bit data key (DEK), stored in `accounts.db` wrapped with AES-256-GCM (the
  household uuid is bound in as additional data). From the DEK: `db` (SQLCipher key), `files` (images/receipt
  files), `img-sign` (signed image URLs).
- Keep the master key in the deployment's secret store **and** offline (password manager, printed in a safe).
  Losing it makes every household unreadable, backups included.
- Rotating the master key is not automated yet: it means re-wrapping every `wrapped_dek` and re-keying
  `accounts.db` (`PRAGMA rekey`) in one maintenance window.

## Backups and restore

- Nightly from 03:00 (`TZ`): `accounts.db` and every household that changed since its last backup are copied with
  `VACUUM INTO` (stays encrypted). Retention 7 daily + 4 weekly per household. With `BACKUP_S3_*` each new file is
  uploaded to `<prefix>/<uuid>/<file>` and `<prefix>/_accounts/<file>`.
- Images and receipt files are not inside the database copies – back up the volume (or replicate
  `DATA_DIR/households/*/images|imports`) as well. They are encrypted files; the same keys apply.
- **Restore drill** (do it monthly): `DATA_DIR=/data TOHUUS_MASTER_KEY=… node dist/restore-check.mjs`
  opens the newest accounts backup and a random household backup with the keys and runs `PRAGMA integrity_check`
  (exit code 0 = fine). Pass a household uuid (and a file) to check a specific one. In development:
  `npm run restore-check`.
- **Restoring one household**: stop the instance (or make sure the household is not open), move
  `households/<uuid>/tohuus.db` (and `-wal`, `-shm`) aside, copy the backup file to `households/<uuid>/tohuus.db`,
  start again. The household key is unchanged, so the backup opens as it is.
- **Restoring accounts.db**: same procedure with `DATA_DIR/accounts.db`. Households created after that backup lose
  their directory entry (and with it their key) – restore accounts.db only together with a fresh copy of all
  wrapped keys, or replay the newer rows by hand.
- Restore from an uploaded file (the self-host *Settings › Backups* screen) is off in the cloud.

## Adding a household

Normally through the apps: `POST /api/cloud/signup` (new account + household, 14-day trial at Plus level) or
`POST /api/cloud/households` (another household for a signed-in account). The database is created on first open
with the form-based defaults (name, language, region, household form). There is no admin back office yet; for a
manual household use the same endpoint with a session.

## Deleting

- `DELETE /api/cloud/households/:id` (an admin of that household *according to the household database* – the
  `memberships` mirror in accounts.db is never trusted for this –, body `{ confirm: "<household name>", password }`):
  crypto-shredding first (the wrapped key is set to NULL in the same transaction that removes memberships and
  detaches sessions/tokens), then the folder and its local backups are removed.
- `DELETE /api/cloud/account` (body `{ password }`): households the account has to itself – or where only permanent
  guests would remain – are shredded; in shared households the person leaves, and if they were the last admin the
  longest-standing *member* becomes admin (never a guest, never an expired membership). Required by App Store
  guideline 5.1.1(v).
- Accounts without a password (e-mail links only) confirm both with a fresh sign-in link: the first call sends it
  (`400`, `needEmailConfirm: true`), and within 15 minutes after opening it the call goes through.
- What a shred removes, and what is left:
  - accounts.db and every household database run with `PRAGMA secure_delete = ON`; after the shred the WAL is
    checkpointed, so the wrapped key does not linger in freed pages.
  - The household id goes into `DATA_DIR/shred-log.jsonl` (ids and times, no keys). When accounts.db is opened –
    also after restoring an older copy that still has the key – every logged household is shredded again.
  - The wrapped key is scrubbed from the local accounts backups (`backups/_accounts/*.db`).
  - With `BACKUP_S3_*` the household's S3 objects are listed and deleted right away.
  - **Remaining retention:** copies of accounts.db already uploaded to S3 (`_accounts/…`) still carry the wrapped
    key until they expire – without the household's own backups they unlock nothing, but set a lifecycle rule
    (e.g. 60 days) and keep bucket versioning off or short. Copies of the volume made outside ToHuus (snapshots)
    are out of its reach.

## What is off in the cloud

| Feature | Why |
|---|---|
| Home Assistant REST fallback, HA to-do REST sync, Cookidoo pull | reach into the household's network; the HACS integration (polling + SSE) and MCP keep working |
| any outbound request to private/internal addresses | a global dispatcher blocks them at connect time (HA, webhooks, Matrix, Gotify …) |
| network printers (ESC/POS over TCP) | LAN only |
| Telegram long polling | one poller per household does not scale; webhook routing is not built yet |
| IMAP receipt inbox | per-household mailbox polling |
| restore from file, WebDAV backup settings | replaced by the cloud backups |
| `ADMIN_PASSWORD`, demo seeding at start, `MCP_PATH_SECRET`, OIDC | instance-wide, no household |
| household-level sign-in methods: PIN switch, TOTP, household passkeys, password per member | accounts sign in instead |

Kept: guest links, displays, kid tablets, party board, web push, MCP with household tokens, the HACS integration,
exports (`GET /api/cloud/export`, household admins only, needs a confirmed e-mail).

## Plans and quotas

`server/lib/plans.ts` (exact limits there and in the plan doc): Free 250 MB / 60 days history / 20 assistant
messages a month, Haushalt 2 GB / full history / 100, Plus 5 GB / 1 500 (throttled, not blocked), trial = Plus.
AI reads per day: receipts 15 / 40 / 60 (`quota.receiptAi`), recipe and product imports 10 / 40 / 100
(`quota.importAi`, HTTP 429); text sent to a model is capped at 50 kB.
Storage counts the household's files on every write/delete plus the database size (measured on every check); it is
recounted nightly. Over quota, uploads and JSON writes above 64 kB get HTTP 413 with `key: "storage.full"`; small
everyday writes still work and nothing is deleted. Apple purchases arrive through
`POST /api/billing/apple/transaction` (from the app) and `POST /api/billing/apple/notifications` (App Store Server
Notifications v2 – set this URL in App Store Connect). Both verify the JWS chain to the embedded Apple Root CA G3.

## Passwords

New cloud account passwords need 10 characters (signup, reset, change, invite with a new account); self-hosted members 8. `/api/instance` → `auth.passwordMin` tells the apps which applies.

## E-mail language

Account mails – address confirmation, sign-in link, password reset, account deleted, "new assistant connected" (OAuth) – are built and sent inside `inAccountLang(account.lang, …)` (`server/lib/account-mail.ts`, `withLang()` in `server/i18n.ts`), so subject, title, text, button, footer and the `<html lang>` all use **the account's language** (`accounts.lang`, stored at signup from `lang`; accounts created through an invitation get the household's language). Without a stored language the household's (or the instance's) language is used. Invitation mails go out in the inviting household's language (the invitee has no account yet). The footer says "ToHuus Cloud" in the cloud and "euer Haushalt, selbst gehostet" self-hosted. Test: a `lang: 'de'` signup gets no English template text (`test/cloud-isolation.test.ts`).

## App web link

`POST /api/auth/app/web-link` (only with an app token, `Authorization: Bearer sw_app_…`, body `{ next?: "/path" }`) →
`{ url, expiresIn: 60 }`. Opening `url` once (60 s, single use) signs that browser – the app's `WKWebView` – in with a
cookie session for the same member and household and redirects to `next` (a relative path, default `/`). Works in
both modes. The links live in process memory (sign-in material, not household data).

## Operator page (`/betrieb`)

Cloud only. Who: accounts whose e-mail address is listed in `OPERATOR_EMAILS` (comma-separated); everyone else gets a plain 404 on every `/api/operator/*` route. Then a **fresh password check** (`POST /api/operator/unlock { password }`, valid 10 minutes for that session or app token, 5 tries per 15 minutes). Code: `server/lib/operator.ts`, `server/routes/operator.ts`, page `web/src/pages/Operator.tsx`.

**What is counted – exactly this, nothing else:**

| Figure | Source | Per household? | Per person? |
|---|---|---|---|
| Households total, active in 7 / 30 days, deleted so far | `households` (`last_active_at`, `deleted_at`) | count only | no |
| Accounts total, new accounts and households per week (12 weeks) | `accounts.created_at`, `households.created_at` | count only | no |
| Plans (effective: free / trial / haushalt / plus) and paid plans by source (apple / operator) | `households` | count only | no |
| Storage total and the 10 largest households | `households.storage_bytes` | **id and bytes only** – no name | no |
| AI requests, tokens and estimated cost per day and month | new table `ai_usage_daily (day, model, requests, prompt_tokens, completion_tokens)` in `accounts.db`, written by `aiUsageHook` in `ai.ts` | no | no |
| Error rate (requests and 5xx answers per hour, last 24 h) | in memory since the last start, status class only (no path, no person, no household) | no | no |
| Backups: last nightly run, last restore check (+ result), S3 on/off | `backups/.last-nightly`, `backups/.last-restore-check` (written by `dist/restore-check.mjs`) | no | no |
| Server: process memory, container memory limit, disk free, load, uptime | the OS | no | no |

Cost = prompt tokens × input price + completion tokens × output price, per million tokens: `AI_PRICES` (JSON `{ "<model>": [in, out] }`) or `AI_PRICE_PER_MTOK` (`"in,out"`, default `0.1,0.3`), currency label `AI_PRICE_CURRENCY` (default `USD`). It is an estimate, not the invoice.

Never shown: household names, people, lists, receipts, conversations, e-mail addresses (the audit names accounts by id).

**Actions** (each one goes into `operator_audit (at, operator, action, target, detail)` in `accounts.db`, `GET /api/operator/audit`):

- `POST /api/operator/households/:id/trial { days }` – extend (or restart) the trial, e.g. for TestFlight testers. Refused (409) while an App Store subscription is active.
- `POST /api/operator/households/:id/plan { plan: 'free'|'haushalt'|'plus', until?: 'YYYY-MM-DD'|null, note? }` – grant a plan (`plan_source = 'operator'`), e.g. the App Review demo account. Refused while an App Store subscription is active.
- `POST /api/operator/password-reset { email }` – sends the normal reset link (in the account's language).
- `DELETE /api/operator/households/:id { confirm: <id> }` – crypto-shreds the household like a deletion by its admin.
- `GET /api/operator/status`, `GET /api/operator/overview`.

## Known gaps (TODO)

- Passkeys for cloud accounts (one RP-ID = the cloud host) are not wired yet; the endpoints answer 404.
- The magic link signs in the browser that opens it (no cross-device code confirmation as in self-host).
- Images are not part of the nightly database copies; no S3 copy of images yet.
- No admin back office (support lookups, manual plan changes) – use accounts.db with the master key.
- Master key rotation is manual (see Keys).
