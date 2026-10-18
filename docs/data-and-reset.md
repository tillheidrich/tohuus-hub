# Data, backups, demo and reset

Everything ToHuus Hub knows is in one SQLite file in `DATA_DIR` (`/data` in Docker), next to the folders `images/`, `imports/` and `backups/`. Databases created before the rename are called `stockwerk.db` and keep that name; new ones are `tohuus.db`.

All actions on this page are for admins and live under *Settings › Data & backups (Einstellungen › Daten & Sicherung)*, unless noted.

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

## Demo data

There are three ways to get the demo household (products, places, recipes with photos, a shopping list, a guest link, a kid profile):

1. On the first start, the admin picks "Explore with demo data first" instead of "Start empty".
2. *Settings › Data & backups › Demo data › Load demo data (Demo-Daten laden)* while the household is still empty.
3. `SEED_DEMO=true` in the environment. It only seeds once, and only when there are no products yet.

The demo follows the household language. Every row it inserts is recorded in the `demo_rows` table (`captureDemo()` in [`server/lib/demo.ts`](../server/lib/demo.ts)), with a fingerprint of stable columns so a reused row id is not mistaken for demo content.

**Remove demo data (Demo-Daten entfernen)** deletes exactly those rows. Demo products and recipes you have used since (stock changed, cooked or planned) stay by default, with their history, because they are probably yours now. Tick *Also remove demo things you have used* to remove them too. Members, places, settings and everything you added yourself stay.

## Start over

*Start over … (Neu anfangen …)* clears chosen areas. A `manual` backup is made first, so you can go back.

| Area | Clears |
|---|---|
| Stock | products, stock, history, receipt aliases and learned receipt rules, barcodes, quick-check confirmations, leftover and freezer boxes, order menu items, product QR labels |
| Recipes | recipes, ingredients, cooking log, ratings, house versions, swap rules, week plan, day marks, plan templates, food votes, "who cooks" claims |
| Shopping | shopping list and its discreet entries, store ticks, orders (incl. the unused tables of the former party mode), kid wishes, "I'll get it" claims |
| Receipts | imports, import lines, manual expenses, spending tags and exclusions |
| Everything | all of the above plus care tasks, trips, order menu groups, notifications, print history, QR labels (except place labels) and every other household table |
| *Places & categories too* (option) | places, categories and place photos, replaced by the default set. Only together with stock; printed place labels stop working. |

Always kept: members and their logins, passkeys and sessions, people preferences (likes, allergies), settings, integrations and Home Assistant sync state, access and share tokens, guest links, displays and printers, kid profiles and devices, stores and aisles, budgets, and places unless you pick them.

The split is computed from the live schema, not from a fixed list. In [`server/lib/tour.ts`](../server/lib/tour.ts) each table is either kept (identity, logins, settings, integrations, caches), assigned to an area explicitly, or inferred: a table that cascades from `products` belongs to stock, one that cascades from `recipes` to recipes, and so on; then by name prefix (`plan_`, `shop_`, `spend_`, `stock_` …); unknown identity-like names are kept; the rest falls under "everything". A table added by a future module is therefore always covered. *Settings › Data & backups* shows the overview of tables and row counts per area (`GET /api/tour/data`).

With "everything", the demo kid profile and the demo guest link go too.

## Tour

A guided tour walks a member through the main screens. It starts by itself once for new members and can be restarted under *Settings › Take the tour (Tour starten)* or *Help (Hilfe)*. Its state is stored per member. An admin can also start it for the household.

## Other data tools

- **Import without asking (Import ohne Rückfrage)**: book receipts straight in when every line was recognised with confidence.
- **Purchase history CSV** (for example a REWE data export): builds the product catalogue and receipt aliases from items you bought at least three times.
- **Hide names on the sign-in screen**, **invites** and member management: *Settings › Members*.
