# ToHuus Cloud – operations

> 18.10.2026: Der Party-Modus wurde auf Tills Entscheidung entfernt (siehe [party-modus.md](party-modus.md)). Gäste wünschen sich jetzt über den Gäste-Link aus „Bring mir was“ etwas; alles landet in einer Liste.

ToHuus Cloud is the same image as the self-hosted ToHuus Hub, started with `MULTI_TENANT=true`. It holds many
households; each one has its own encrypted SQLite database. This page is for whoever runs the cloud instance.
The binding product and API contract is [plan-2026-10-12.md](plan-2026-10-12.md); the code map is
[architecture.md](architecture.md).

## How it is built

```
DATA_DIR/
  accounts.db                     accounts, account passkeys, households, memberships, sessions, app tokens, billing, usage (encrypted)
  households/<uuid>/tohuus.db     one household (encrypted with its own key)
  households/<uuid>/images/       photos, AES-256-GCM per file
  households/<uuid>/imports/      receipt files, AES-256-GCM per file
  backups/<uuid>/                 nightly VACUUM INTO copies (encrypted like the database)
  backups/<uuid>/.files-manifest.json   what of images/ and imports/ is on S3 (path, size, mtime)
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
- **Accounts**: e-mail + scrypt password, e-mail links, passkeys (per account, [below](#passkeys-for-accounts)). A membership maps an account to a `users.id` inside the
  household database, so every feature sees the same `Actor` as in self-host.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `MULTI_TENANT=true` | yes | cloud mode |
| `TOHUUS_MASTER_KEY` | yes | 32 random bytes, base64 (`openssl rand -base64 32`). Environment only – never on the data volume. Without it the server refuses to start. |
| `BASE_URL` | yes | public URL of the cloud (links, signed image URLs; its host is the passkey RP-ID, its origin the expected passkey origin – changing the host makes existing passkeys useless) |
| `DATA_DIR` | – | default `./data` (`/data` in the image) |
| `SMTP_*` | recommended | verification, sign-in and reset mails |
| `SITE_URL` | – | the public website (default `https://tohuus.heidrich-digital.de`); help links and `/api/instance` `siteUrl` – docs/domain.md |
| `MAIL_INBOUND_DOMAIN` | – | receipt addresses `bons-…@<domain>` (Plus; feature off when unset) – docs/mail-inbox.md |
| `MAIL_SMTP_PORT` | – | port of the inbound SMTP listener inside the container (e.g. `2525`, Coolify maps 25 to it) |
| `MAIL_TLS_CERT_FILE`, `MAIL_TLS_KEY_FILE` | – | certificate for STARTTLS on the SMTP listener |
| `MAIL_INBOUND_SECRET` | – | ≥ 16 characters; enables the webhook `POST /api/mail/inbound` |
| `CLOUD_SIGNUP` | – | `open` \| `invite` \| `closed` (default **`open`** since the final release of 15 Oct 2026, before `invite` – see [Beta gate](#beta-gate); old `true`/`false` = open/closed). Overridden by the back office setting `signup.mode` |
| `SUPPORT_EMAIL` | – | address shown to ask for an access code (default `tohuus@tillheidrich.de`; back office setting `support.email` wins) |
| `CLOUD_NAME` | – | name in `/api/instance` (default "ToHuus Cloud") |
| `HOUSEHOLD_POOL_MAX`, `HOUSEHOLD_POOL_IDLE_MIN` | – | connection pool (64, 10) |
| `SSE_MAX_TOTAL` | – | live-update connections over all households (5000; 200 per household) |
| `LEGAL_PRIVACY_URL`, `LEGAL_TERMS_URL`, `LEGAL_IMPRINT_URL` | – | shown by the apps via `/api/instance` |
| `MIN_IOS_BUILD` | – | builds of the iPhone app below this number show only "Bitte aktualisiere ToHuus" (`/api/instance` → `minIosBuild`); set it after an API change older builds can't follow. `/api/instance` also carries `betaGift` (`'haushalt'\|'plus'\|null`, runtime setting `beta.gift`), so the app hides "14 Tage, dann Free" during the beta |
| `BETA_ALLOWLIST` | – | Comma-separated addresses that may sign up without an access code, in addition to the allowlist in the back office (e.g. the App Review account on a fresh cloud) |
| `BETA_GIFT` | – | `haushalt` or `plus`: every cloud household gets at least this plan during the beta. Fallback for the back-office setting `beta.gift` (the back office wins when set) |
| `BETA_GIFT_EXCEPT` | – | Comma-separated household ids left out of the beta gift (they keep their own trial/plan). For the App Review household, so the reviewer sees the plans with StoreKit prices and can buy in the sandbox – see `docs/ios-app-review.md` |
| `APPLE_BUNDLE_ID` | – | default `de.heidrichdigital.tohuus` |
| `APPLE_APP_IDS` | – | comma-separated `<TeamID>.<bundle id>` for `webcredentials` in `/.well-known/apple-app-site-association`, default `FVS7WVTQ67.de.heidrichdigital.tohuus` |
| `APPLE_ENVIRONMENTS` | – | StoreKit environments accepted for everyone, default `Production` |
| `APPLE_SANDBOX_ACCOUNTS` | – | comma-separated e-mails of TestFlight testers: Sandbox purchases count only for households with one of these accounts |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`, `BACKUP_S3_PREFIX` | – | off-site copy of every nightly backup and of all images and receipt files (S3-compatible, e.g. Hetzner Object Storage `https://fsn1.your-objectstorage.com`; a MinIO in a private network works too – these requests bypass the private-address block) |
| `BACKUP_FILES_MAX_FILES`, `BACKUP_FILES_MAX_MB` | – | file sync budget per night over all households (20 000 files, 4096 MB); the rest follows the next night |
| `BACKUP_FILES_MAX_FILES_PER_HOUSEHOLD`, `BACKUP_FILES_MAX_MB_PER_HOUSEHOLD` | – | per household and night (2 000 files, 1024 MB), so one big household cannot hold up the others |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`, `APNS_TOPIC`, `APNS_ENV` | – | iPhone push – [notifications.md](notifications.md#iphone-push-apns-serverlibapnsts) |
| `AI_*` | – | assistant, voice and receipt photos – [assistant.md](assistant.md); every OpenRouter request is pinned to Mistral (EU). Key, base URL, models and fallbacks can be overridden at runtime in the back office ([Runtime settings](#runtime-settings)) |
| `ADMIN_HOST` | – | own host for the back office, see "Back office on its own host" |
| `OPERATOR_EMAILS` | – | comma-separated account e-mails that may open the operator page `/betrieb` |
| `AI_PRICE_PER_MTOK`, `AI_PRICES`, `AI_PRICE_CURRENCY` | – | prices for the AI cost estimate on `/betrieb` and the cost cap: `AI_PRICES` JSON per model › `AI_PRICE_PER_MTOK` `"in,out"` for every model (only when set) › the table in `server/lib/ai-prices.ts` (OpenRouter list prices of 18.10.2026, e.g. Mistral Small 2603 `0.15,0.60`) › `0.15,0.60`; label, default `USD` |
| `AI_HOUSEHOLD_COST_CAP`, `AI_HOUSEHOLD_COST_CAP_HAUSHALT`, `AI_HOUSEHOLD_COST_CAP_TRIAL`, `BILLING_COMMISSION`, `TRIAL_AFTER` | `2.5`, `1.5`, `1`, `0.15`, `readonly` | AI cost per household and month before AI pauses, for Plus (and Plus for good), Haushalt and the trial (price currency, `0` = off; docs/pricing.md 18.10.2026 (2)); Apple's share for the net revenue estimate on `/betrieb › Umsatz`; what follows the trial without a plan (`readonly` or `free`). Back office › Einstellungen overrides all three (`ai.household_cost_cap`, `ai.household_cost_cap.haushalt`, `ai.household_cost_cap.trial`, `billing.commission`, `trial.after`) |
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
  uploaded to `<prefix>/<uuid>/<file>` and `<prefix>/_accounts/<file>`. Older copies are only rotated locally – set
  a lifecycle rule on the bucket for the `.db` objects (e.g. 60 days).
- **Images and receipt files** are not inside the database copies. With `BACKUP_S3_*` they are synced right after
  the database copies (`server/lib/offsite-files.ts`): every file under `households/<uuid>/images/` and `imports/`
  goes to `<prefix>/<uuid>/files/images/<name>` / `…/files/imports/<name>` **byte for byte as it is on disk** –
  AES-256-GCM with the household key, never decrypted on the way. Incremental: `backups/<uuid>/.files-manifest.json`
  remembers path, size and mtime of what was uploaded; only new or changed files go up, files deleted in the
  household are deleted on S3 on the next run (`DeleteObject`). A lost manifest only means one full re-upload
  (PUT is idempotent). Bounded per night (`BACKUP_FILES_MAX_*`, see Environment): what does not fit stays
  `pending` and the next night starts with the household where the budget ran out. A failed upload is retried the
  next night. Do not put a lifecycle expiry on `*/files/*` – those objects are the current state, not history.
- Result of the last file sync (counts only: households, uploaded, deleted, bytes, pending, errors) is in
  `backups/.last-file-sync` and on `/betrieb`.
- Without S3, back up the volume (or replicate `DATA_DIR/households/*/images|imports`) yourself. The files are
  encrypted; the same keys apply.
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
- **Restoring images and receipt files** of one household from S3 (e.g. after losing the volume, together with
  its database copy):

  ```
  DATA_DIR=/data BACKUP_S3_ENDPOINT=… BACKUP_S3_BUCKET=… BACKUP_S3_ACCESS_KEY=… BACKUP_S3_SECRET_KEY=… \
    [BACKUP_S3_REGION=… BACKUP_S3_PREFIX=…] node dist/restore-files.mjs <householdUuid> [--dry-run] [--overwrite] [--to <folder>]
  ```

  (development: `npm run restore-files -- <uuid> …`). It lists `<prefix>/<uuid>/files/`, downloads into
  `households/<uuid>/images|imports/` and keeps files that already exist unless `--overwrite`. Only keys of the
  form `images/<name>` / `imports/<name>` are written (anything else is skipped and reported). No master key is
  needed – the files stay encrypted and open with the household key from accounts.db as before. The household's
  manifest is updated, so the next night does not upload them again. `--to <folder>` restores somewhere else to
  look first (the manifest is not touched then); `--dry-run` only counts. Exit code 0 = done.
- Restore from an uploaded file (the self-host *Settings › Backups* screen) is off in the cloud.

## Adding a household

Normally through the apps: `POST /api/cloud/signup` (new account + household, 14-day trial at Plus level; beta gate
below) or `POST /api/cloud/households` (another household for a signed-in account – not gated, the account exists
already). The database is created on first open with the form-based defaults (name, language, region, household
form, the shops named at sign-up).

## Deleting

- `DELETE /api/cloud/households/:id` (an admin of that household *according to the household database* – the
  `memberships` mirror in accounts.db is never trusted for this –, body `{ confirm: "<household name>", password }`):
  crypto-shredding first (the wrapped key is set to NULL in the same transaction that removes memberships and
  detaches sessions/tokens), then the folder and its local backups are removed.
- `DELETE /api/cloud/account` (body `{ password }`, or `{ appleIdentityToken, appleNonce, appleAuthorizationCode? }` / `{ code }` – see [Sign in with Apple](#sign-in-with-apple)): households the account has to itself – or where only permanent
  guests would remain – are shredded; in shared households the person leaves, and if they were the last admin the
  longest-standing *member* becomes admin (never a guest, never an expired membership). The account's passkeys
  and WebAuthn user handle are deleted with it. Required by App Store guideline 5.1.1(v).
- Accounts without a password (e-mail links only) confirm both with a fresh sign-in link: the first call sends it
  (`400`, `needEmailConfirm: true`), and within 15 minutes after opening it the call goes through.
- What a shred removes, and what is left:
  - accounts.db and every household database run with `PRAGMA secure_delete = ON`; after the shred the WAL is
    checkpointed, so the wrapped key does not linger in freed pages.
  - The household id goes into `DATA_DIR/shred-log.jsonl` (ids and times, no keys). When accounts.db is opened –
    also after restoring an older copy that still has the key – every logged household is shredded again.
  - The wrapped key is scrubbed from the local accounts backups (`backups/_accounts/*.db`).
  - With `BACKUP_S3_*` the household's S3 objects – database copies and `files/` – are listed and deleted right
    away. If the nightly file sync was uploading for that household at the same moment, it deletes the prefix once
    more when it notices the household folder is gone.
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
| IMAP receipt inbox | per-household mailbox polling; `GET /api/retail/inbox` answers `available: false` and the apps hide the cards (`PUT` and `/check` are 404). The cloud has receipt addresses per household instead (docs/mail-inbox.md) |
| restore from file, WebDAV backup settings | replaced by the cloud backups |
| `ADMIN_PASSWORD`, demo seeding at start, `MCP_PATH_SECRET`, OIDC | instance-wide, no household |
| household-level sign-in methods: PIN switch, TOTP, household passkeys, password per member | accounts sign in instead (account passkeys exist, see below) |

Kept: guest links, displays, kid tablets, party board, web push, iPhone push (APNs), the CalDAV bridge (app passwords carry the household prefix), MCP with household tokens, the HACS integration,
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

**Features are checked by the server** (`server/lib/limits.ts` › `requireFeature` / `assertFeature`, test
`test/cloud-plans.test.ts`). Without the plan the answer is HTTP 402
`{ error, code: 'plan', feature, plan: 'haushalt' | 'plus' }` (the iPhone app shows the message like a quota, the web
app as a toast). Self-hosted servers have everything; the trial and the beta gift count like Plus.

| Feature (`limits.features`) | From | Checked at |
|---|---|---|
| `priceHistory` | Haushalt | `GET /api/spending/prices/:productId`, MCP `price_history` |
| `mirrorLists` | Haushalt | `POST /api/caldav/passwords` (new Apple Reminders / Nextcloud mirrors; existing ones keep working) |
| `fullHistory` | Haushalt | `historyDays()` (rhythm, money, "Das habt ihr noch") |
| `weekPlanFromPantry` | Plus | `POST /api/plan/autofill`, HA `fill_week`, MCP `fill_week` |
| `monthlyAnalysis` | Plus | assistant `money_compare` |
| `plusRecipes` | Plus | ToHuus-Rezepte with `tier = 'plus'`: `GET /api/cloud-recipes/:id`, `POST …/save` |
| receipt address | Plus | `GET /api/mail/address`, inbound mails (`docs/mail-inbox.md`) |
| `connectedHouseholds` | Haushalt | new "Mitversorgen" lists (`kind: 'care'`, create or change to care); existing ones keep working |
| `substituteFromStock`, `importQuota` | – | only plan text and limits so far; no separate endpoint exists yet |

**Lifetime (optional)**: the non-consumable `de.heidrichdigital.tohuus.plus.lifetime` (`LIFETIME_PRODUCT` in
`plans.ts`) gives Plus without expiry. The paywall shows it only when the product exists in App Store Connect, so it
can be added later or never. A subscription transaction never replaces it; only its own refund (`REFUND` / `REVOKE`)
ends it. `GET /api/billing/status` says `lifetime: true`; when an old subscription still renews, the paywall asks to
cancel it.

**Codes for beta testers**: Apple offer codes, created in App Store Connect (subscription › Offer Codes; for the
lifetime product: In-App Purchase › Offer Codes). Testers redeem them in the iPhone app under Abo › "Code einlösen"
(Apple's sheet, also while the beta gift is on). The redeemed purchase arrives as a normal signed transaction
(`OFFER_REDEEMED` / `SUBSCRIBED`), so nothing else is needed on the server. Our own `GIFT-…` codes stay web only.

## Passwords

New cloud account passwords need 10 characters (signup, reset, change, invite with a new account); self-hosted members 8. `/api/instance` → `auth.passwordMin` tells the apps which applies.

## Passkeys for accounts

Code: `server/lib/cloud-passkeys.ts` (store, challenges), routes in `server/routes/cloud.ts`; the WebAuthn ceremony
helpers are shared with the self-host member passkeys (`server/lib/auth-passkeys.ts`, `@simplewebauthn/server`).

- **Per account, not per household**: `account_passkeys (id, account_id → accounts ON DELETE CASCADE, public_key,
  counter, transports, device_type, backed_up, name, created_at, last_used_at)` and `account_webauthn (account_id,
  handle)` in `accounts.db` (created on first use). One passkey signs in to the account and with it to every
  household of the account. Household databases never hold cloud passkeys.
- **RP-ID** = host of `BASE_URL`, **origin** = `BASE_URL`. Discoverable credentials (resident key required), user
  verification required, attestation `none`. Challenges are single use, 5 minutes, in process memory (a restart only
  means "try again").
- **Register** (signed in, cookie session or app token): `POST /api/auth/passkeys/options { password }` – a fresh
  password check as for deleting a household (`confirmAccount`: wrong/missing → `400 { needPassword: true }`;
  accounts without a password confirm with a fresh e-mail link → `400 { needEmailConfirm: true }`; the iPhone app has
  no browser session and sends `{ code }` instead, the 6-digit code from that mail) → WebAuthn
  creation options (`rp.id`, `user.name` = account e-mail, `excludeCredentials`). Then
  `POST /api/auth/passkeys { response, name? }` → `{ id }` (`409` if that credential is already saved).
- **List / rename / delete**: `GET /api/auth/passkeys` → `[{ id, name, device_type, backed_up, created_at,
  last_used_at }]`; `PATCH /api/auth/passkeys/:id { name }` and `DELETE /api/auth/passkeys/:id` → `{ ok }` (`false`
  for an id of another account). `GET /api/auth/me` (settings screen) carries the account's passkeys,
  `policy.passkeys: true`, `has_password` (the account's) and `confirm: 'password' | 'email'`.
- **Sign in** (usernameless): `POST /api/auth/passkey/options` → the request options JSON, challenge key in the
  cookie `sw_wa` (path `/api/auth/passkey`, 5 minutes); `POST /api/auth/passkey/verify { response }` → cookie
  session (`method: 'passkey'`, first household) and `{ ok: true }`. **App**: `POST /api/auth/passkey/options
  { client: 'ios' }` → `{ options, key }`; `POST /api/auth/passkey/verify { response, key, device, household? }` →
  `{ token: 'sw_app_…', account, user, households, household }` (as `POST /api/auth/app`).
- **Checks**: the credential must exist and belong to an existing account; signature, challenge, origin, RP-ID,
  user verification and the signature counter (no going back) are verified; a `userHandle` that is not the
  account's own is refused (`401`).
- **Rate limits** (like password sign-in): options 30 per 5 minutes per IP; verify 10 per 5 minutes per IP and 8 per
  5 minutes per account (`429`).
- **Apple**: `GET /.well-known/apple-app-site-association` (cloud only, JSON, no redirect, cached 1 hour) →
  `{ "webcredentials": { "apps": ["FVS7WVTQ67.de.heidrichdigital.tohuus"] } }` (`APPLE_APP_IDS`). The app needs the
  associated domain `webcredentials:<cloud host>` – [ios-api-0.2.md](ios-api-0.2.md#passkeys-cloud-new-server-ready).
- `/api/instance` → `auth.passkey: true` and `/api/auth/options` → `methods.passkeys: true` in the cloud. The web app
  uses the same screens as self-host (sign-in button and autofill on the e-mail field, *Einstellungen › Mein Konto
  › Passkeys*; adding one asks for the password first).
- A password reset or change does not remove passkeys (they are a separate credential); deleting the account does.
  Test: `test/cloud-passkeys.test.ts` (software authenticator, P-256).

## Sign in with Apple

Code: `server/lib/cloud-apple.ts` (token checks, account links), `server/routes/cloud-apple.ts` (routes). Cloud only.
Test: `test/cloud-apple.test.ts` (a local RSA key and a fake JWKS – no network).

- **Token checks**: the identity token (JWT, RS256) is verified against Apple's keys (`https://appleid.apple.com/auth/keys`,
  cached 24 h, fetched again at most once a minute when a token names an unknown key): issuer
  `https://appleid.apple.com`, audience = `APPLE_BUNDLE_ID` (app, default `de.heidrichdigital.tohuus`) or
  `APPLE_SERVICES_ID` (web, default `de.heidrichdigital.tohuus.web`; `off` or empty hides the web button), expiry (30 s
  tolerance), and the nonce: the client generates a raw nonce, puts SHA-256 (hex) of it into the Apple request and sends
  the raw value to us; each nonce and each token works once (process memory). Since 13 Oct 2026 every
  sign-in needs one (app and web); a token without a nonce is refused.
- **Accounts**: `account_apple (sub PRIMARY KEY, account_id UNIQUE → accounts ON DELETE CASCADE, email, private_relay,
  created_at, last_used_at)` in `accounts.db` (created on first use). A known `sub` signs in to its account. Otherwise a
  verified Apple e-mail that equals a **verified** account's address links the two (once; another Apple ID cannot take a
  linked account over – 409). An address that belongs to an unconfirmed account, or an unverified Apple address that
  matches an account, is refused with 409 ("sign in with password or e-mail link first"). Everybody else gets a new
  account (no password, `verified_at` set when Apple says the address is verified – private relay addresses are fine)
  and a household with the 14-day trial, like `POST /api/cloud/signup`. No e-mail in the token and no account → 400.
- **App**: `POST /api/auth/apple { identityToken, authorizationCode?, nonce, name?, device, client: 'ios', householdName?,
  form?, lang?, region?, household? }` → `{ token, created, account, user, households, household }` (as `POST
  /api/auth/app`; `created: true` = new household, the app asks about sample data). `name` = the given name Apple hands
  the app on the very first sign-in only.
- **Web** (no Apple JS SDK): the button links to `GET /api/auth/apple/start?next=/path` → cookie `sw_apple`
  (`state.nonce.next`, 10 minutes, path `/api/auth/apple`, `SameSite=None; Secure` on https because Apple posts back
  cross-site) and a redirect to `https://appleid.apple.com/auth/authorize?client_id=<Services ID>&redirect_uri=<BASE_URL>/api/auth/apple/callback&response_type=code%20id_token&response_mode=form_post&scope=name%20email&state=…&nonce=<sha256>`.
  `POST /api/auth/apple/callback` (form_post: `state`, `id_token`, `code`, `user` on the first time) is exempt from the
  same-origin check – it is bound to the state cookie instead – and answers `303` to `/willkommen` (new household),
  `next` or `/?apple=expired|failed|exists|closed|busy|cancelled` (the sign-in page shows the reason). Session method
  `apple` (counts as a fresh confirmation for 15 minutes, like an e-mail link).
- `/api/instance` → `auth.apple: true` when the Services ID is set. Rate limits: 20 per 5 minutes per IP, 10 per Apple ID,
  new accounts share the signup limit (5 per hour per IP).
- **Apple setup**: App ID `de.heidrichdigital.tohuus` with the "Sign in with Apple" capability; a Services ID
  `de.heidrichdigital.tohuus.web` with "Sign in with Apple" configured for the domain of `BASE_URL` and the return URL
  `<BASE_URL>/api/auth/apple/callback`, grouped with the App ID as primary.
- **Deleting the account** removes the link. Apple accounts without a password confirm with a fresh Sign in with Apple in
  the app (`DELETE /api/cloud/account { appleIdentityToken, appleNonce, appleAuthorizationCode? }`, the token's `sub` must be the
  account's). The fresh `appleAuthorizationCode` is exchanged for a refresh token first, so the revocation also works
  when the exchange at sign-in failed or the Sign in with Apple key was set later.
  Accounts without password and without Apple confirm in the app with the code from the mail: the first call sends it
  (`400 needEmailConfirm`), the second carries `{ code }` (password accounts always need the password).
- **Token revocation (5.1.1(v))**: with `APPLE_SIWA_KEY_ID` and `APPLE_SIWA_KEY_P8` (the .p8 as PEM, `\n` allowed) and `APPLE_TEAM_ID` (default FVS7WVTQ67) set, every sign-in exchanges Apple's authorization code once for a refresh token (`POST https://appleid.apple.com/auth/token`, client_secret = ES256 JWT for the bundle id or the Services ID), kept in `account_apple.refresh_token`; deleting the account revokes it (`POST …/auth/revoke`) before the link is dropped. Without the key nothing is exchanged and deletion only drops the link (logged once). A failed exchange never fails the sign-in.

## Sample data (cloud and self-host)

A new household is asked once (web `/willkommen`, the app right after sign-up): "Möchtest du Beispieldaten, um ToHuus
kennenzulernen?" → `POST /api/tour/start { choice: 'demo'|'empty' }` (as before; the cloud no longer skips the question).
There is no banner: `GET /api/tour/demo/marks` → `{ products: [id], recipes: [id], shopping: [id] }` (ids only) lets the
apps tag sample rows with a small "Beispiel". `GET /api/tour` → `demo.since` (oldest sample row) and `demo.nudge` (admins,
sample rows for 3 days or more, not dismissed) – Today offers removing them once; "Erst mal behalten" =
`POST /api/tour/demo/nudge` (admins). Removing (`POST /api/tour/demo/remove`, Settings and Today) deletes only marked rows;
rows the household used since stay unless `include_used`. Test: `test/demo-flow.test.ts`, isolation in
`test/cloud-isolation.test.ts`.

Settings › Data & reset (`/api/data/wipe`, docs/data-and-reset.md) clears areas or everything with a 7-day restore. The
snapshot lives in the household's own encrypted database, the extra full backup before "everything" in
`backups/<uuid>/`; deleting and restoring work in the read-only state. Test: `test/data-wipe-cloud.test.ts`.

## E-mail language

Account mails – address confirmation, sign-in link, password reset, account deleted, "new assistant connected" (OAuth) – are built and sent inside `inAccountLang(account.lang, …)` (`server/lib/account-mail.ts`, `withLang()` in `server/i18n.ts`), so subject, title, text, button, footer and the `<html lang>` all use **the account's language** (`accounts.lang`, stored at signup from `lang`; accounts created through an invitation get the household's language). Without a stored language the household's (or the instance's) language is used. Invitation mails go out in the inviting household's language (the invitee has no account yet). The footer says "ToHuus Cloud" in the cloud and "euer Haushalt, selbst gehostet" self-hosted. Layout (`server/lib/mail.ts`): green header with the house of the app icon and the title, ticket card, then a footer with the app icon, one line about ToHuus, the reason for the mail and links – notification settings (`BASE_URL/einstellungen?tab=notify`) and help (`SITE_URL/hilfe/`), in the cloud also privacy and imprint; the plain-text part lists the same links. The brand fonts are `@font-face` from `SITE_URL/assets/fonts` (our own site, no font CDN); clients that block remote fonts fall back to Georgia/Arial. Test: a `lang: 'de'` signup gets no English template text (`test/cloud-isolation.test.ts`).

## Sign-in link and code (other device)

`POST /api/auth/link { email }` (always `{ ok: true, sent: true }`) mails the account – in its language – a **link**
(signs in the browser that opens it, 15 minutes, single use) and a **6-digit code** (shown as `123 456`) for the
device where the person asked for the mail: the laptop's browser while the mail is read on the phone, or the iPhone
app. `server/lib/cloud-codes.ts`, table `auth_codes` in accounts.db (hash only, bound to account and link).

`POST /api/auth/link/code { email, code, device?, household? }` (cloud only):

- without `device` → cookie session for this browser, `{ status: 'signed_in' }`;
- with `device` (the iPhone app) → an app token, same answer as `POST /api/auth/app`:
  `{ token, account, user, households, household }`;
- `400` "That code doesn’t match …" (also for unknown addresses), `410` when the code is used, expired or burnt,
  `403` when `household` is not a membership, `429` rate limits (20 per IP, 10 per address in 15 minutes).

Rules: 10 minutes, single use, 5 wrong tries burn every open code of the account (the link keeps working). Using the
code also uses up the link of the same mail; opening a link burns the account's open codes. Like the link, the
code confirms the address (`verified_at`). Sessions from a code have the method `link-code`, which counts as a fresh
e-mail confirmation for deleting an account or household. Self-host keeps its own direction (the asking device shows
a 4-digit code that is typed where the link is opened – `server/lib/auth-links.ts`).

## App web link

`POST /api/auth/app/web-link` (only with an app token, `Authorization: Bearer sw_app_…`, body `{ next?: "/path" }`) →
`{ url, expiresIn: 60 }`. Opening `url` once (60 s, single use) signs that browser – the app's `WKWebView` – in with a
cookie session for the same member and household and redirects to `next` (a relative path, default `/`). Works in
both modes. The links live in process memory (sign-in material, not household data).

## Subscriptions: renewal date, "Abo verwalten", reminder

- `GET /api/billing/status` also returns `plans: { free, haushalt, plus }` (each with the fields of `limits`: `historyDays`, `assistantPerMonth`, `assistantThrottleOnly`, `receiptAiPerDay`, `importAiPerDay`, `storageBytes`, `features`) so the paywall can say what each plan includes; `null` self-hosted.
- `GET /api/billing/status` also returns `renewsAt` (the next charge from the App Store renewal info – `signedRenewalInfo.renewalDate` – or the end of the paid period; `null` when auto-renew is off), `expiresAt` (paid until), `autoRenew` (true/false/null), `period` (`monthly`/`yearly`), `manageUrl` and `reminder` (the caller's own choice). `source` can now also be `operator` (granted on `/betrieb`).
- **"Abo verwalten"**: `manageUrl` is `https://apps.apple.com/account/subscriptions` (Apple's subscription management) whenever the plan comes from the App Store. The web app links to it; the iPhone app should call `AppStore.showManageSubscriptions(in:)` and fall back to that URL.
- **Reminder**: App Store Server Notifications v2 store the renewal date and auto-renew state per household (`billing_renewals` in `accounts.db`, `server/lib/renewals.ts`). An hourly job e-mails the household's admins **3 days before a yearly renewal**, once per renewal date, in each account's language, with the "Abo verwalten" link – unless the household switched e-mail off for the event `billing.renewal` (notification settings) or the admin switched it off for themselves: `PATCH /api/billing/reminder { enabled }` (`user_prefs billing.reminder`, default on). Monthly plans get no reminder. Test: `test/cloud-billing.test.ts` with fake signed notifications.

## Moving a self-hosted household in

**On the own server** (*Einstellungen › Daten › Umzug in die ToHuus Cloud*, admins): `GET /api/move/file?secrets=0|1` downloads `tohuus-umzug-<date>.zip` (`server/lib/move.ts`, ZIP via `server/lib/zip.ts`):

| Entry | Content |
|---|---|
| `manifest.json` | `{ format: 'tohuus-move', version: 1, createdAt, app, includeSecrets, counts, parts }` |
| `export.json` | the household export of `data.ts` (`buildExport({ viewer: <admin> })`): no sessions, no tokens, no credential columns, no OAuth tables, no `*_secrets` tables, no other member's conversations, personal settings or "nur für mich" memory |
| `images/<name>` | every stored image, decrypted |
| `imports/<name>` | receipt files the imports point to |
| `parts/<key>.json` | extra parts registered with `registerMovePart()`. Parts marked `sensitive` (Hausinfo codes) only when the admin ticks "Codes aus der Hausinfo mitnehmen" (`secrets=1`); `GET /api/move/info` lists the parts |

**In the cloud** (*Einstellungen › Daten › Haushalt vom eigenen Server übernehmen*, shown to admins of an empty household): `POST /api/cloud/import` (multipart `file` + `password`) → `202 { state: 'running' }`; `GET /api/cloud/import` → `{ state: 'idle'|'running'|'done'|'failed', progress, empty?, summary?: { tables, rows, images, files, people: { mapped, created }, parts, skippedTables, foreignKeyIssues }, error?, code? }`.

- Admins only, with a **fresh password check** (as for deleting a household). Max. `MOVE_MAX_MB` (default 300) upload, 3× that unpacked, 50 000 entries.
- Only into a **new, empty household** (no products, recipes, imports, list rows, no second member) – `409 move.not_empty` otherwise. Photos and files must fit the plan's storage quota (`413 move.quota`).
- The work runs after the answer, inside that household's context, into its encrypted database; images and receipt files are stored encrypted with the household key.
- **People** are mapped by e-mail, then by name; the importing admin stands in for the first admin of the old household if nobody matched. Everyone else becomes a person without a sign-in (`password_hash '!'`) – invite them under *Mitglieder*. All `user_id`-like columns and `u<id>` person keys are rewritten.
- Never imported: users rows as such, sessions, tokens, invites, guest links, kid tablet pairings, push subscriptions, assistant conversations, OAuth, the old server's settings (HA, Telegram, IMAP, backups, printers, sign-in policy) and the household name, language, region and AI/MCP switches (the cloud household keeps its own; the consent for health data must be given again).
- Test: `test/move.test.ts` (a real self-hosted household in a child process → cloud import, isolation from another household).

## Back office on its own host (`ADMIN_HOST`)

With `ADMIN_HOST=betrieb.tohuus.heidrich-digital.de` (the host must also be a domain of the Coolify app and have a DNS record) the back office moves to its own host:

- **App host**: `/betrieb` redirects there, every `/api/operator/*` and `/api/admin-auth/*` answers 404 – also for operators.
- **Admin host**: serves only `web/admin.html` (no app shell, no service worker), `/api/admin-auth/*` and `/api/operator/*`. Every other API path, `/mcp`, `/img`, `/oauth`, CalDAV and `.well-known` answer 404. `X-Robots-Tag: noindex`.
- **Sign-in** (`server/lib/admin-auth.ts`, `server/routes/admin-auth.ts`): e-mail + password of an account in `OPERATOR_EMAILS`, then a 6-digit authenticator code (TOTP, replay-protected). The very first time the operator proves the mailbox with a code by mail and sets up the authenticator (QR code). The TOTP secret is stored AES-256-GCM-encrypted in `accounts.db` (`operator_totp`, key derived from the master key). Tickets between the steps live 5 minutes and burn after 5 wrong codes; logins are rate limited per IP and per address.
- **Session**: own cookie `tohuus_admin` (host-only, HttpOnly, Secure, SameSite=Strict), only its SHA-256 stored (`admin_sessions`), 30 minutes idle, 12 hours at most. The app's session or app tokens never open the back office; no extra password unlock inside.
- **Audit**: every sign-in, failure, set-up, logout and change in `operator_audit` (with IP for sign-in events).
- **Lost authenticator**: set `ADMIN_RESET_TOTP=<operator e-mail>`, restart, sign in again (password + mail code + new set-up), then remove the variable.
- Without `ADMIN_HOST` (self-host, tests) `/betrieb` stays inside the app with the password unlock as before.

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
| Weekly question (list2 pulse): answers per week of households that switched sharing on | `pulse_agg` in `accounts.db` | no | no |
| Error rate (requests and 5xx answers per hour, last 24 h) | in memory since the last start, status class only (no path, no person, no household) | no | no |
| Backups: last nightly run, last restore check (+ result), S3 on/off | `backups/.last-nightly`, `backups/.last-restore-check` (written by `dist/restore-check.mjs`) | no | no |
| Last file sync to S3: households, files uploaded / deleted, bytes, pending for the next night, errors (`backups.lastFileSync`) | `backups/.last-file-sync` | no | no |
| Server: process memory, container memory limit, disk free, load, uptime | the OS | no | no |

Cost = prompt tokens × input price + completion tokens × output price, per million tokens (`server/lib/ai-prices.ts`: `AI_PRICES` › `AI_PRICE_PER_MTOK` › built-in table › `0.15,0.60`), currency label `AI_PRICE_CURRENCY` (default `USD`). It is an estimate, not the invoice.

**Umsatz** (`GET /api/operator/revenue`, `server/lib/revenue.ts`, 18.10.2026): active subscriptions, MRR net (estimate: gross ÷ 1.19 × (1 − `billing.commission`), yearly ÷ 12), cohorts per sign-up week (trial started/ended, paid by day 35 via `households.first_paid_at`), App Store notifications per week (new, renewed, auto-renew off, expired, refunds, billing issues), first purchases per plan and period (Production only), AI cost per plan class (`ai_cost_by_plan`: trial, haushalt, plus, lifetime, gift, none – no household), households over 800 / at 1,500 messages / at their plan's cost cap, and counters for paywall views by reason, purchases and review requests (`POST /api/billing/event`, stat_events_daily). Counts of households below 3 are null. No ids, names or addresses.

Never shown: household names, people, lists, receipts, conversations, e-mail addresses (the audit names accounts by id).

**Actions** (each one goes into `operator_audit (at, operator, action, target, detail)` in `accounts.db`, `GET /api/operator/audit`):

- `POST /api/operator/households/:id/trial { days }` – extend (or restart) the trial, e.g. for TestFlight testers. Refused (409) while an App Store subscription is active.
- `POST /api/operator/households/:id/plan { plan: 'free'|'haushalt'|'plus', until?: 'YYYY-MM-DD'|null, note? }` – grant a plan (`plan_source = 'operator'`), e.g. the App Review demo account. Refused while an App Store subscription is active.
- `POST /api/operator/password-reset { email }` – sends the normal reset link (in the account's language).
- `DELETE /api/operator/households/:id { confirm: <id> }` – crypto-shreds the household like a deletion by its admin.
- `GET /api/operator/status`, `GET /api/operator/overview`.

## Operator back office

`/betrieb` grew into the back office (same access rules as above: `OPERATOR_EMAILS`, 404 for everybody else, fresh
password valid 10 minutes, every change in `operator_audit`). Sections: **Übersicht** (the overview above),
**Statistik**, **Beta-Zugang**, **Rezepte**, **Einstellungen**, **Haushalte** (lookup by id, trial/plan/delete,
password reset, largest households by id – never names), **Protokoll** (paged audit log). Routes:
`server/routes/operator-admin.ts` (mounted inside `routes/operator.ts`), page `web/src/pages/Operator.tsx` +
`web/src/pages/operator/*`. The section is kept in the URL hash (`#statistik`, `#beta`, `#rezepte`, …).

| Method | Path | Body / query → answer |
|---|---|---|
| GET | `/api/operator/settings` | `{ settings: { <key>: { value, source: 'settings'\|'env'\|'default', secret, updatedAt } }, ai: { configured, baseUrl, openrouter, apiKey: '…abcd', models, fallbacks, cloudOn }, signupMode, supportEmail }` |
| PUT | `/api/operator/settings` | `{ <key>: string \| null }` (null/'' = back to the environment) → `{ ok, changed: [keys], settings, ai, signupMode }`; 400 for unknown keys or bad values |
| POST | `/api/operator/settings/ai-test` | `{ kind?: 'text'\|'vision'\|'visionHard'\|'audio' }` → `{ ok: true, model, ms }` or `{ ok: false, code, error }` – one 3-token request, no household data |
| GET | `/api/operator/beta` | `{ mode, supportEmail, codes: [{ id, code, note, max_uses, uses, expires_at, revoked_at, created_at }], allowlist: [{ email, note, created_at }] }` |
| POST | `/api/operator/beta/codes` | `{ count?: 1–50, note?, maxUses?, expiresAt?: 'YYYY-MM-DD', code?: fixed text }` → `{ codes }` (409 if a fixed code exists) |
| DELETE | `/api/operator/beta/codes/:id` | revoke |
| POST / DELETE | `/api/operator/beta/allowlist` | `{ emails: 'a@x, b@y' \| [..], note? }` → `{ added }` / `{ email }` (the log stores counts, not addresses) |
| GET | `/api/operator/stats?days=56` | see [Usage statistics](#usage-statistics) |
| POST | `/api/operator/stats/snapshot` | compute tonight's snapshot now → the snapshot |
| GET | `/api/operator/households/:id` | `{ id, plan, planSource, planExpiresAt, trialEndsAt, createdDay, lastActiveDay, storageBytes, members: { admin: n, member: n, guest: n } }` – no names |
| GET | `/api/operator/audit?limit=&before=` | paged, newest first |
| … | `/api/operator/recipes…` | see [ToHuus-Rezepte](#tohuus-rezepte) |

## Runtime settings

`server/lib/runtime-settings.ts`, table `runtime_settings (key, value, updated_at, updated_by)` in `accounts.db`.
Each value is encrypted on its own with AES-256-GCM, key `HKDF(TOHUUS_MASTER_KEY, "runtime-settings")`, the key name
as additional data (so a copy of accounts.db does not show the AI key, and a value cannot be moved to another name).
A stored value **overrides the environment**; removing it falls back to the environment.

| Key | Meaning |
|---|---|
| `AI_API_KEY` | write-only: the API only ever returns `…` + last 4 characters; the audit log stores only that |
| `AI_BASE_URL` | https (or localhost) |
| `AI_MODEL_TEXT`, `AI_MODEL_VISION`, `AI_MODEL_VISION_HARD`, `AI_MODEL_AUDIO` | model per kind |
| `AI_MODEL_FALLBACKS` | comma-separated, `-` = none |
| `ai.cloud` | `on` \| `off` – AI for the whole cloud. Off: `aiOffReason()` returns `cloud` before any household switch, no request leaves the server (`ai.disabled`, 403), `/api/instance` → `features.assistant/voice/receiptsAi: false`, `features.ai.cloud: false` |
| `signup.mode` | `open` \| `invite` \| `closed` |
| `support.email` | address in the beta message |

`server/lib/ai.ts` reads the AI keys through `aiRuntime.overrides` (registered by runtime-settings.ts, cached in
process, cache dropped on every change) – `aiConfig()`/`fallbackModels()` see them at once; an explicit `env` object
passed by tests/tools is not touched. Test: `test/cloud-admin.test.ts`.

## Accounts in the back office

Back office › **Konten** (`server/routes/operator-accounts.ts`, `web/src/pages/operator/Accounts.tsx`). For keeping the service safe – e.g. taking someone out of the beta – with account data only.

- `GET /api/operator/accounts?q=&filter=all|blocked|unconfirmed&offset=&limit=` → `{ total, accounts }`: e-mail, name, language, created / confirmed / last login / last seen (sessions and app tokens), number of app devices, sign-in ways (password, Apple, passkeys), households with name, role and plan. Never anything from inside a household.
- `POST /api/operator/accounts/:id/block { reason (3–300), notify = true }` – **pause**: every session and app token is removed at once, and `createCloudSession` / `createAppToken` refuse the account (HTTP 403, `code: 'account.blocked'`, "Dieses Konto ist pausiert … schreib an <support>"), so password, e-mail code or link, passkey and Sign in with Apple all stop. The person gets a mail with the reason in their language. Households and their data stay; others in a shared household keep using it.
- `POST /api/operator/accounts/:id/unblock { notify }`, `POST /api/operator/accounts/:id/signout` (sessions and app tokens removed, no pause).
- `DELETE /api/operator/accounts/:id { confirm: <e-mail> }` – the same `removeAccount()` as "Konto löschen" in Settings: households where nobody else is left are crypto-shredded, in shared ones the person leaves (an heir becomes admin), passkeys and Apple link go, confirmation mail.
- Every action is in the audit log with the account **id** (never the address).
- **Apple and GDPR**: App Store Review Guideline 5.1.1(v) asks that people can delete their account in the app – that stays. Pausing for abuse is covered by the terms ("aus wichtigem Grund"); the privacy policy names the account administration (Art. 6 (1) f GDPR). A paused person can still ask by e-mail for deletion or an export.
- Not affected by a pause: MCP/OAuth connections and Home Assistant tokens of a household belong to the household, not to the account – revoke them in that household if needed.

## Gifts: beta plan and plan codes

`server/lib/gifts.ts`, back office › **Geschenke**. Nothing is bought and nothing is charged in either way.

- **Beta gift** – runtime setting `beta.gift` = `haushalt` | `plus` (unset = off). While it is set, `planOf()` gives every cloud household at least that plan (a running trial counts like Plus). `GET /api/billing/status` then says `source: 'beta'`, `gift: { kind: 'beta', plan, until: null, forever: false }`; the web billing card and the iPhone paywall show "Während der Beta geschenkt" instead of prices. Switching it off falls back to what each household has on its own (trial, code, App Store, Free) – nothing is deleted.
- **Plan codes** (`GIFT-XXXX-XXXX`) – the operator creates them (`POST /api/operator/gifts/codes { plan, days | null = for good, count, maxUses (default 1), note, expiresAt }`, list `GET /api/operator/gifts`, revoke `DELETE /api/operator/gifts/codes/:id`; every change audited). An **admin** of a household redeems one on the **web**: Settings › Abo › "Code einlösen" → `POST /api/billing/redeem { code }` → `{ plan, until, status }`. Errors: `gift.invalid` 404, `gift.used_up` 410, `gift.already` 409 (once per household), `gift.apple` 409 (a running App Store subscription is never overwritten – cancel it there first). A redeemed code sets the household's plan with `plan_source = 'code'`; a longer or better gift the household already has is kept, the days are added to its end.
- **Why not in the iPhone app**: App Store Review Guideline 3.1.1 does not allow unlocking features with own codes or license keys inside an iOS app. The app therefore has no code field; it shows the plan the household has (3.1.3(b), multiplatform services). Apple's own offer codes for the subscriptions stay available in the paywall ("Code einlösen" there is Apple's sheet).
- Tables in accounts.db: `plan_codes`, `plan_code_redemptions (code_id, household_id, at)`.

## Beta gate

`server/lib/beta.ts`. Since the final release (15 Oct 2026) sign-up is **open** by default; the gate stays for when an
operator wants it again (`invite` or `closed` in /betrieb › Einstellungen or `CLOUD_SIGNUP`).

- **Modes**: `open` (default) · `invite` · `closed`. `GET /api/instance` → `signup: mode !== 'closed'`, `signupMode`,
  `support` (address to ask for a code).
- **Gated** (only when a NEW account is created): `POST /api/cloud/signup` (web and app, body `betaCode`), Sign in with
  Apple in the app (`POST /api/auth/apple`, body `betaCode`) and on the web (`GET /api/auth/apple/start?code=…`, the
  code travels in the state cookie; refusal → `303 /signup?apple=invite|code`).
- **Not gated**: signing in to an existing account (the App Review demo account keeps working), **joining a household
  by invitation (always, even when closed)**, e-mail links and codes (they never create accounts), another household
  for an existing account.
- **Let in**: an e-mail address on the allowlist (`beta_allowlist`) or in `OPERATOR_EMAILS`, or a valid code (`beta_codes`: optional max uses,
  expiry date, note; revocable). Codes look like `TOHU-7KQM-X3PA`, case and spaces do not matter, a use is counted
  atomically only when the account is really created (an existing address → 409, code not used). Nothing records
  which account used which code.
- **Refusal**: `403 { error: "ToHuus ist gerade im kleinen Test. Du brauchst einen Zugangscode – frag gern per Mail
  nach.", code: 'signup.invite' | 'signup.code_invalid' | 'signup.closed', contact, mailto }`.
- `POST /api/cloud/signup/check { email?, betaCode? }` → `{ ok, mode }` or the same 403 (does not use the code; 30 per
  15 minutes per IP).
- Web: code field on `/signup` (when `signupMode` is `invite`) with the sentence and a mailto link; the Apple button
  carries the code. iOS: code section in *Konto erstellen*, the sentence + mail link on the start screen.
- Tests: `test/cloud-beta.test.ts` (every path), `test/cloud-admin.test.ts` (administration). The test setup
  (`test/setup-env.ts`) sets `CLOUD_SIGNUP=open` unless a test sets it.

## Usage statistics

`server/lib/stats.ts`. GDPR-friendly by construction: **no personal data, no tracking IDs, no cookies, no third
parties**.

- **Feature events** – counted on the server when an API action succeeds (2xx), matched by method and route pattern:
  `list.add`, `list.check`, `list.trip`, `list.create`, `receipt.upload`, `receipt.applied`, `recipe.import`,
  `recipe.add`, `recipe.cooked`, `recipe.catalog_save`, `plan.add`, `assistant.message`, `wish.add`, `money.entry`,
  `share`. Stored as `stat_events_daily (day, event, platform, n)` – platform `web` (cookie session), `ios` / `watch`
  (the apps send `X-ToHuus-Client`), `other` (HA, MCP, guest links). Buffered, written every 30 s. Other packages add
  routes with `addStatRoute(method, pattern, event)` or count directly with `countEvent()`.
- **Funnel, weekly active, retention** – each household keeps in **its own encrypted database** (setting
  `stats.milestones`) the day of its first list item, of its first receipt and the ISO weeks with an action (max. 60).
  A nightly job (after 02:00 UTC, `stat_snapshots (day, data)`) reads them inside each household's context and stores
  **counts only**: created (12 weeks) → first list item → first receipt → active in week 2 → still active in week 4
  (with how many were old enough), households active per week (12 weeks), cohorts by sign-up week (size, active in
  week 1…8). Plans and AI cost per week come from `households` and `ai_usage_daily`.
- **Minimum cell size 3**: every number 1–2 is returned as `null` and shown as "< 3".
- Retention of the tables: raw daily counters 400 days, snapshots 120 days.
- `GET /api/operator/stats?days=56` → `{ days, minCell, weeks, events: [{ event, total, perWeek: [{ week, n }], byPlatform }], snapshot, plans, ai: { currency, perWeek } }`.
- Privacy notice: paragraph "Nutzungsstatistik ohne Personenbezug" in `site/src/legal.mjs` (legal basis Art. 6 (1) f).
- Test: `test/cloud-admin.test.ts` (no uuid, name, address or IP in the stats tables or answers).

## ToHuus-Rezepte

`server/lib/cloud-recipes.ts` – a curated catalogue for all cloud households (not per household). Sources and rules:
wiki "Rezept-Pool mit KI-Rezepten und KI-Bildern" and "Recherche: Rezept-Pool – Recht, Quellen, Daten" (12.10.2026):
own recipes written from facts, no copied texts, no third-party photos, AI only as drafts, a human reads before
anything is published, AI pictures carry "KI-Bild".

- **Storage**: `DATA_DIR/catalog/recipes.db` (SQLCipher, key `HKDF(master, "catalog-db")`), photos once per content
  hash in `DATA_DIR/catalog/images/<hash>.webp` (AES-256-GCM, `HKDF(master, "catalog-files")`). Not part of the
  household backups – back up `catalog/` with the volume (S3 sync of the catalogue: TODO).
- **Fields**: title, description, the recipe as the normalised import shape, tags, image + `image_kind`
  (`none` = styled placeholder with the dish name, `photo`, `ai`), `origin` (`own`, `package`, `ai_draft`),
  `ai_assisted`, `review_state` (`draft` → `reviewed` → `cooked`), `license`, `source_authors`, computed `allergens`
  (14 EU allergens from the ingredient text), `warnings` for the reviewer (poultry/mince without "durchgegart", honey,
  raw eggs, missing servings/time), `state` (`draft`, `scheduled`, `published`, `unpublished`), `publish_at`,
  `published_at`.
- **Starting set**: 30 simple everyday German recipes written for ToHuus (`server/data/catalog-seed.ts`), seeded once
  as **drafts** (AI-assisted). Nothing is visible to households until the operator reads, marks and schedules them.
- **Publish the whole starting set at once** (owner's decision 13 Oct 2026): `CLOUD_RECIPES_PUBLISH_ALL=1` publishes, at
  every start, all server-seeded recipes (`created_by` `seed`, `seed-plus`, `seed-devices`, `seed-baking`) that are not
  still a draft or scheduled and marks them `reviewed` (audit `catalog.publish-all`). Uploads, AI drafts and recipes the
  operator unpublished are never touched, so the variable can stay set.
- **Plus set** (13 Oct 2026): 20 autumn and winter recipes (`server/data/catalog-seed-plus.ts`: one pot, one tray,
  cooking once for two days, leftovers), seeded once as drafts with `tier = 'plus'`. Each has an AI picture made in
  the founder's Canva account; `image_ref` holds its Canva link, the back office shows "Bild in Canva öffnen" next to
  "Foto hinzufügen" and stores the upload as `image_kind: 'ai'` ("KI-Bild" badge). `tier` can be switched per
  recipe (`PATCH …/:id { tier: 'all' | 'plus' }`).
- **Kitchen machines** (13 Oct 2026): 12 more Plus drafts for Thermomix, Monsieur Cuisine and Cookit
  (`server/data/catalog-seed-devices.ts`), each step with its settings (`tm` on the step, `tohuus.devices`), a review
  note to check the settings on a real machine, and a Canva AI picture like the Plus set.
- **Plus recipes for households**: the list shows them to everyone with `plus: true` and `locked` when the household
  has no Plus (`plusRecipes` feature, trial and beta gift count); `GET /api/cloud-recipes/:id` and `…/save` answer
  402 `{ code: 'plan', feature: 'plusRecipes' }` for a locked one. Web and iPhone show a "Plus" badge and "Gehört zu
  Plus" (opens the plans).
- **Scheduler**: every 10 minutes publishes `scheduled` recipes whose `publish_at` has passed.
- **Households** (`server/routes/cloud-recipes.ts`, signed-in members; guests not):
  - `GET /api/cloud-recipes` → `{ newThisWeek: [card], recent: [card], saved: { "<catalogId>": <recipeId> } }`;
    card = `{ id, title, description, image, imageKind, tags, servings, timeMin, allergens, aiAssisted, reviewState,
    license, sourceAuthors, publishedAt }` (newThisWeek = published in the last 7 days).
  - `GET /api/cloud-recipes/:id` → card + `ingredients`, `steps`, `nutrition`, `thermomix`, `savedId` (404 unless
    published).
  - `POST /api/cloud-recipes/:id/save` → `{ id, created }` – a copy in the household's recipes (`source_type:
    'tohuus'`, `ext_id: 'catalog-<id>'`, photo copied into the household's encrypted images, a note "Aus den
    ToHuus-Rezepten – mit KI geschrieben, von uns geprüft"); saving again returns the existing copy. Unpublishing
    never removes a household's copy.
  - `GET /api/cloud-recipes/img/<hash>.webp` – public for published recipes, operators only for drafts.
- **Back office**:
  `GET /api/operator/recipes` (`{ counts, recipes }`), `GET /api/operator/recipes/:id`,
  `POST /api/operator/recipes/upload` (multipart `file` = recipe package zip/json ([recipe-package.md](recipe-package.md)),
  fields `aiAssisted`, `imageKind`, `license`, `sourceAuthors` → drafts), `PATCH /api/operator/recipes/:id`
  (`reviewState`, `publishAt: 'YYYY-MM-DD[ HH:MM]' | null`, `tags`, `aiAssisted`, `imageKind`; planning needs
  reviewed), `POST …/:id/photo` (multipart `file`, `kind`), `POST …/:id/publish` (reviewed only),
  `POST …/:id/unpublish`, `DELETE …/:id` (not while published), `POST /api/operator/recipes/schedule`
  (`{ perWeek: 1–7 (3 = Mon/Wed/Fri 06:00 UTC), ids?, start? }` → `{ plan }` for reviewed drafts after the last
  planned date), `POST /api/operator/recipes/ai-drafts` (`{ dishes: [≤5 names] }` → Mistral via `ai.ts`, drafts with
  `origin: 'ai_draft'` – never published automatically), `POST /api/operator/recipes/preview-zip` (multipart `file` =
  the PNG/JPG export of the Canva preview-card design as ZIP; the number before the extension of each file is the page,
  page n goes to the recipe with `image_page = n + start - 1` (field `start`, default 1, for a ZIP of part of the
  design such as the baking cards 33–38); kind `photo` when the recipe has an `image_credit`, else `ai` →
  `{ updated, recipes: [{ page, id, title }], skipped }`).
- Preview cards: the seeded Plus and kitchen-machine recipes carry `image_page` (1–38: 20 Plus, 12 kitchen-machine, 6 baking recipes) and
  `image_credit` (a real Pexels photo is in the card: "Name / Pexels"). Cards and detail return `imageCredit` (only
  once an image is set), shown as "Foto: …" on web and iPhone.
- Web: "Neu diese Woche" strip in *Kochen › Was kochen wir?* (cloud only, falls back to "Neu von ToHuus" with the latest
  six), detail sheet with origin line, allergens, ingredients, steps; iOS: the same strip in Kochen.
- Test: `test/cloud-admin.test.ts`.

## Shops without favourites

`server/lib/stores.ts`. No preset favours REWE or any chain.

- New households start with **no shops** (the old first-start rows REWE + Aldi are removed once while untouched – no
  walking order, trip or saved place; `stores.neutral`). The sample data carries no supermarket own brands any more
  (older sample rows are still recognised for removal).
- Sign-up asks **"Wo kauft ihr meistens ein?"**: `GET /api/cloud/store-choices?region=DE` → `{ stores: [alphabetical],
  market: 'Wochenmarkt' }`; `stores: string[]` on `POST /api/cloud/signup` and `POST /api/auth/apple`. Web sign-up and
  the iOS sign-up show chips + "Sonstige" (own entries); the web setup flow asks once if sign-up did not
  (`GET /api/shop/stores/choices` → `{ stores, market, chosen, own }`, `PUT /api/shop/stores/choice { stores }`).
- Every list of shops (`GET /api/shop/stores`, store mode, "Wo kaufen?", the receipt shop picker) is ordered by the
  household's own use over 180 days (store-mode trips, receipts, manual expenses), then alphabetically.
- Receipt formats (REWE eBons and notices, other chains) stay supported – that is reading, not preferring.
- Test: `test/stores-neutral.test.ts`, sign-up in `test/cloud-beta.test.ts`.

## Known gaps (TODO)

- Master key rotation is manual (see Keys).
- `DATA_DIR/catalog/` (ToHuus-Rezepte) is not yet in the nightly backup / S3 sync – back up the volume.
