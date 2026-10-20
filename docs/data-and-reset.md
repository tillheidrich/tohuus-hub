# Data, backups, demo and reset

Everything ToHuus Hub knows is in one SQLite file in `DATA_DIR` (`/data` in Docker), next to the folders `images/`, `imports/` and `backups/`. Databases created before the rename are called `stockwerk.db` and keep that name; new ones are `tohuus.db`.

All actions on this page live under *Settings › Data & backups (Einstellungen › Daten & Sicherung)* and are for admins, unless noted.

## Export

*Download export* gives a JSON file with every household table (`GET /api/export.json`). It leaves out:

- whole tables for sessions, API tokens, invites, push subscriptions, the Open Food Facts cache and any table whose name ends in `token(s)` or `secret(s)`;
- every settings field whose name contains `token`, `passw`, `secret`, `api_key`, `webhook` or `ntfy`.

So the export is safe to keep on a laptop, but it does not contain everything needed to rebuild integrations (bot tokens, WebDAV password and so on).

Recipes can also be exported on their own, in the import format: see [recipes-import.md](recipes-import.md#export).

## Backups

| Kind | When | Kept |
|---|---|---|
| `nightly` | once a day after 03:00 in `TZ` | 14 daily plus 8 weekly |
| `manual` | *Back up now (Jetzt sichern)*, the `backup_now` MCP tool, before a reset, before migrations | the last 10 |
| `pre-restore` | right before a restore is staged | the last 5 |

Files are named `tohuus-YYYY-MM-DD-HHMMSS-<kind>.db` and are complete SQLite copies made with `VACUUM INTO`. They contain everything, including hashed passwords and integration secrets, so treat them like the server itself. You can download and delete them in the list.

**Off-site copy (WebDAV, e.g. Nextcloud):** enter a folder URL, user and app password, and test the connection. After each backup the file is uploaded as one file per weekday (`tohuus-backup-mon.db`, `tohuus-backup-tue.db` …), so the remote folder always holds the last seven nights without any cleanup. Create the folder first.

### Automatic backup before migrations

When the server starts and finds a schema migration that has not run yet on an existing household, it first copies the database into `backups/` as a `manual` backup, then runs the migrations. If a new version goes wrong, that file is the state right before the update. The copy is made once per start, before the first pending migration (see `preMigrationBackup()` in [`server/db.ts`](../server/db.ts)).

## Restore

*Restore (Wiederherstellen)* accepts either:

- a **database backup** (`.db`, up to 1 GB): it is checked to be a ToHuus Hub database, or
- a **JSON export** (up to 200 MB): a new database is built from a copy of the current one (so sessions, access tokens and secrets stay) with all household tables replaced by the export's rows. Members keep their password if they exist by name. Current admins missing from the export are kept so somebody can still sign in.

Either way the app makes a `pre-restore` backup, stages the file as `restore-pending.db` and restarts. On the next start, before the database is opened, the staged file replaces the live one; the replaced database is kept in `backups/replaced/`. If the restart does not happen, the staged restore can be cancelled. In Docker the restart is handled by `restart: unless-stopped`; without a process supervisor, start the server again by hand.

Backups in the list can be restored directly.

## Data & reset (Daten & Zurücksetzen)

*Settings › Data & backups › Data & reset* (web: Settings › Data, card "Daten & Zurücksetzen", `web/src/pages/DataWipe.tsx`;
iPhone: `DataWipeView.swift`, also linked directly under Settings). Server: [`server/lib/wipe.ts`](../server/lib/wipe.ts),
routes in [`server/routes/wipe.ts`](../server/routes/wipe.ts). Same in ToHuus Cloud and self-hosted.

### Who

- **Admins**: remove the sample data, clear one or more areas, delete everything.
- **Every member**: delete their own private entries (tasks "only for me", private household knowledge, "Im Kopf",
  private wish lists) – and restore them; nobody else can restore those.
- **Never**: API/MCP tokens, the assistant, permanent guests, guest links, kid devices. The routes only accept a person
  signed in as themselves (`wipeWho()`); `/data/*` is closed for permanent guests at every level (people-policy).
  Deleting whole areas is deliberately not an assistant or MCP tool (a test checks the sources).
- The read-only state of the cloud (trial over, no plan) allows deleting and restoring (`READONLY_ALLOW` in
  `server/lib/plans.ts`: `/data/wipe`, `/data/wipe/:id/restore|final`, `/tour/reset`, `/tour/demo/remove`, `/demo/reset`).

### Areas

| Area | Clears | Stays / options |
|---|---|---|
| Shopping (Einkauf) | shopping lists and entries, store ticks, shopping trips, share items, HA to-do links, purchase rhythm (`rhythm_state`), "shopping" claims, the *where to buy* (`products.buy_at`) of products | products stay |
| Stock (Vorrat) | products, stock, movements, aliases, barcodes, quick-check confirmations, leftover boxes, order-menu items, quality rules, offers, product QR labels | places and categories stay unless *Keep places and categories* is off (then the default categories come back, no places are invented) |
| Money (Geld) | imports and import lines incl. their stored photos/PDFs, expenses incl. attachments, spending tags/exclusions, budgets, money lists (splits) with people and payments | needs the confirmation word |
| Cooking (Kochen) | recipes (with photos), ingredients, variants, ratings, swap rules, week plan, cooking log, plan templates, votes, "who cooks" claims | *Keep recipes*: only plan, history, votes go |
| Tasks (Aufgaben) | tasks, their log, task QR labels | other members' private tasks stay |
| Household knowledge | `ai_memory` (incl. photos) | other members' private entries stay |
| Wishes & Bring me something | wish lists, wishes, links, orders and order lines, kid wishes, the former party tables | other members' private wish lists stay |
| House info (Hausinfo) | cards, codes, code views, secrets, media, per-item visibility | guest-link selection (`house_links`) stays |
| Everything | all areas plus every other household table (notifications, trips/handover, assistant chats, CalDAV objects, print jobs …), the sample kid profile and the sample guest link | members and logins, plan, settings, integrations and tokens, connected assistants (`oauth_*`), guest links, displays, printers, kid profiles, stores, "Im Kopf", other members' private entries; places unless chosen. Needs the confirmation word; a full database backup is made first (self-host `backups/`, cloud `backups/<household>/`) |

The table → area map builds on the dynamic classification of `server/lib/tour.ts` (so a table added later is always
covered) with a few corrections (`AREA_TABLE`, `AREA_PREFIX` in wipe.ts). Rows the database removes by itself
(`ON DELETE CASCADE`, also in kept tables) are part of the snapshot; links it empties (`SET NULL`) are recorded and put
back on restore. Home Assistant sync bookkeeping (`ha2_*`) is written by triggers and never snapshotted.

The overview shows a counter per area (`GET /api/data/wipe` → `areas`: rows the wipe would remove).

### Safety net

1. *Download an export first* is offered on the page and in every confirmation (cloud: `/api/cloud/export`).
2. "Everything" and "Money" need the word **LÖSCHEN** / **DELETE** (household language or English).
3. Before deleting, exactly the rows that go are copied into `data_wipes.snapshot` (gzip JSON) inside the household's
   own database – in the cloud that database is encrypted with the household key, so the snapshot is too and never
   crosses households.
4. Right after, the apps show **Undo** for 10 seconds; the entry stays restorable for **7 days** under
   "Deleted lately" (`POST /api/data/wipe/:id/restore`). Ids taken in the meantime get new ones, links follow.
5. Stored files (receipt photos/PDFs, pictures – encrypted at rest) stay on disk for those 7 days and count towards
   the storage quota; the list shows how much. *Delete for good* (`/final`) frees them at once. After 7 days a job
   (every 6 h across households, and on every visit of the page) drops snapshot and files – files only if no row
   references them any more. At most 10 restorable snapshots; older ones become final early.
6. `data_wipes` keeps the audit entry for good: who, when, which area, rows per table – never content. It is not part
   of the export, the move file or a reset.
7. The other admins get a personal notification (push/app, event `auth.new_device`, never household channels).

API: `GET /api/data/wipe` → `{ admin, restoreDays, confirmWord, areas, demo, mine, history }`;
`POST /api/data/wipe { target: 'areas'|'everything'|'demo'|'mine', areas?, keepPlaces?, keepRecipes?, includeUsed?, confirm? }`
→ `{ ok, wipe: { id, total, counts, bytes, expiresAt, … } }`.

### Sample data

There are three ways to get the demo household (products, places, recipes with photos, a shopping list, a guest link,
a kid profile):

1. On the first start, the admin picks "Explore with demo data first" instead of "Start empty".
2. *Data & reset › Load sample data* while the household is still empty.
3. `SEED_DEMO=true` in the environment. It only seeds once, and only when there are no products yet.

The demo follows the household language. Every row it inserts is recorded in the `demo_rows` table (`captureDemo()` in
[`server/lib/demo.ts`](../server/lib/demo.ts)), with a fingerprint of stable columns so a reused row id is not mistaken
for demo content.

As long as sample data exists, admins see a small line on Today and a card at the top of Data & reset; after three
days Today offers removing it once more prominently. **Remove sample data** deletes exactly the marked rows (also
through the old `POST /api/tour/demo/remove`, which now returns `wipe.id` for the undo). Demo products and recipes you
have used since stay by default, with their history; *Also remove sample things you have used* takes them too.
Members, places, settings and everything you added yourself stay. Undo restores the rows together with their marks.

### Start over (older apps)

`POST /api/tour/reset { scopes: ['stock'|'recipes'|'shopping'|'receipts'|'everything'], places, confirm }` (and the alias
`POST /api/demo/reset`) still work for older app versions: backup first (in the cloud into the household's own backup
folder), then the scopes of `resetPlan()`. They get the same 7-day snapshot and audit entry (`kind: 'reset'`) and are
only accepted from a signed-in person, not from tokens.

### Self-host: starting from scratch

There is no separate command-line reset. Everything above works the same on your own server. To begin with a
completely new instance (members and settings too): stop the container, move `tohuus.db` (or `stockwerk.db`) and the
`images/` and `imports/` folders out of `DATA_DIR`, start again – the first start creates a fresh admin.
`SEED_DEMO=true` loads the sample household into it.

## Tour

A guided tour walks a member through the main screens. It starts by itself once for new members and can be restarted under *Settings › Take the tour (Tour starten)* or *Help (Hilfe)*. Its state is stored per member. An admin can also start it for the household.

## Other data tools

- **Import without asking (Import ohne Rückfrage)**: book receipts straight in when every line was recognised with confidence.
- **Purchase history CSV** (for example a REWE data export): builds the product catalogue and receipt aliases from items you bought at least three times.
- **Hide names on the sign-in screen**, **invites** and member management: *Settings › Members*.
