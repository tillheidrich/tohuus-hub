# Shopping list 2 – trust, filling itself, shopping together, bridges

Built on 12 Oct 2026 from the market research pages "Wünsche und Beschwerden" and "Strategie-Fortschreibung" (Outline
wiki, ToHuus Hub). Order of importance: **a list you can trust → a list that fills itself → bridges → household
forms**. This page is the API reference for the iPhone app and for agents; notifications have their own page
([notifications.md](notifications.md)).

Code: `server/lib/list2.ts` (trust), `lists.ts` (lists, usuals, guard, estimate), `trips.ts` (shopping together),
`notify-prefs.ts` + `apns.ts` (per-person notifications, iPhone push), `caldav.ts` (Reminders bridge),
`list-import.ts` (imports, purchase history), `modules.ts` ("Was nutzen wir?"), `hhforms.ts` (WG, Mitversorgen,
lunchbox, package size), `prices.ts` + `offers.ts` (prices, offers), `pulse.ts` (F&F question), `list-jobs.ts`
(scheduler jobs), `list-schema.ts` (migrations). Routes: `server/routes/list2.ts` (all need a member, app or API token
unless noted). Web: `web/src/shop/*` (`trust.tsx`, `fill.tsx`, `together.tsx`, `bridges.tsx`, `forms.tsx`,
`offers.tsx`, `ItemEditor.tsx`), `web/src/dnd.ts`, `web/src/pages/NotifyMine.tsx`, `Modules.tsx`, `web/src/pulse.tsx`.
Tests: `test/list2*.test.ts`, `test/cloud-isolation.test.ts` (list2 parts).

All bodies are JSON unless marked multipart. Errors: `{ error }` with 4xx.

## A – a list you can trust

**Ticked rows stay** where they were, struck through, until somebody says **"Einkauf fertig"**. In
`GET /api/shop/list` the ticked rows are in `basket` (store mode) and `done` (list mode) as before – every row carries
its `section`, so apps draw it in place. Rows ticked more than a day ago drop out by themselves (they stay purchase
signals for the rhythm).

| Endpoint | Body / query | Answer |
|---|---|---|
| `POST /api/list/finish` | `{ store_id?, to_stock = true }` | `{ cleared, basket, booked }` – ticked rows leave the list, a basket is booked into stock, the person's shopping trip ends |
| `GET /api/list/recent?days=7` | | `[{ id, text, qty, note, product_id, checked_at, checked_by, cleared_at }]` – "Zuletzt erledigt" (no private/discreet rows) |
| `POST /api/list/items/:id/restore` | | `{ id, restored: 'unticked' \| 'copied' \| 'open' }` – ticked < 30 min ago: the tick is taken back (incl. its stock booking); older: a new open row (the purchase stays) |
| `GET /api/list/status` | | `{ serverTime, open, ticked, lastChange }` – cheap, for "zuletzt abgeglichen vor 3 s" |
| `PATCH /api/list/items/:id` | `{ text?, qty?, note?, substitute?, product_id? }` | `{ ok }` – the name stays what was typed; `substitute` = `'exact'` ("genau dieses") \| `'ok'` ("Ersatz ok") \| `'ask'` ("vorher fragen") \| `null` |
| `POST /api/list/items/:id/photo` | multipart `image` | `{ photo_path }` (`/img/l<id>-….webp`, signed for token clients) |
| `DELETE /api/list/items/:id/photo` | | `{ ok }` |
| `GET /api/list/prefs` / `PUT /api/list/prefs` | `{ density?: 'compact'\|'normal'\|'large', fontScale?: 0.9–1.4 }` | the person's prefs; also in `GET /api/me` as `listPrefs` |

New fields on every list row (`/api/shop/list` sections, basket, done):

```jsonc
{
  "substitute": "ask",                 // or "exact" | "ok" | null
  "photo_path": "/img/l12-ab12cd.webp", // or null
  "last_bought": { "name": "JA! H-MILCH 1,5%", "size": "1 l", "image_path": "/img/p3-….webp", "shop": "Lidl", "day": "2026-10-09", "price": 1.19 }, // from receipts, or null
  "list_id": 3,                        // null = main list
  "owner": { "id": 4, "name": "Mika" }, // WG: a personal row, else null
  "size_hint": "Spinat 3× weggeworfen – lieber 250 g?", // or null
  "price_hint": "am günstigsten bei Aldi: 1,99 €",    // or "bei Lidl zuletzt 1,19 €" or null
  "sort_key": 12.5                     // manual order (drag & drop), or null
}
```

**Input fidelity**: `quick-add`, `/shop/sync` add ops and `POST /api/shopping` keep the typed text as `text` and only
link `product_id` in the background. `matchProduct` tries an exact product name (also brand + name) before learned
aliases and fuzzy matching.

**Expired session in the store**: the web app keeps the last store view on the device (`sw.shop.cache`) and shows it
when `/api/me` answers 401 while in store mode; ticks are queued and sent after the next sign-in. The iPhone app's
operation queue does the same with `/api/shop/sync` (401 → keep the queue, ask for sign-in only when syncing).

`/api/shop/list` also answers `serverTime`.

## B – the list fills itself

| Endpoint | Body / query | Answer |
|---|---|---|
| `GET /api/shop/list?list=<id>` | `list` = `0` (main, default), a list id, or `all` | the view of that list; plus `listId`, `lists`, `estimate`. On the main list, lists of kind `care` appear as own sections `list:<id>` after the aisles |
| `GET /api/list/lists` | | `[{ id, name, kind: 'main'\|'store'\|'gifts'\|'care'\|'other', note, open, visibility, owner_id, owner, share_with, mine }]` (id 0 = main list; only the lists the viewer may see) |
| `POST /api/list/lists` | `{ name, kind?, note?, visibility?, share_with? }` | the list |
| `PATCH /api/list/lists/:id` | `{ name?, kind?, note?, visibility?, share_with? }` | the list (`note` = handover note for care lists); `visibility`/`share_with`: anyone may make a household list private (and owns it then), afterwards only the owner (403 otherwise) |
| `DELETE /api/list/lists/:id` | | `{ ok }` – open rows move to the main list (rows of a private list stay private) |

### Private lists (13 Oct 2026)

`visibility`: `household` (default, everyone), `private` (only the owner), `people` (owner + `share_with`, member ids; guests are dropped). A private list and everything on it does not exist for anyone else: 404 for the list, its rows (`/api/shopping/:id`, `/api/shop/items/:id/*`, `/api/list/items/:id/*` – `privateRowGuard`), adding to it, `?list=<id>` in the store view and the estimate. Rows are stored like private share items (`server/lib/list-privacy.ts`): `shopping_items` keeps only a placeholder, the real text/product/note live in `share_items` with `from_list` = the list; two SQLite triggers mask every row inserted into or moved onto a private list, whatever the path. So Heute, live shopping, rhythm, notifications, the assistant, MCP, Home Assistant, CalDAV, Watch/widget payloads (they read `/api/shop/list` / `/api/today`) and exports (`share_items`/`shopping_lists` filtered per person) never show them. Per-row privacy (`/api/share/items/:id`) is refused for these rows – change the list instead; the item's `share.list = true` tells the apps.

| `POST /api/list/items/:id/move` | `{ list_id }` | `{ ok }` |
| add with a list | `list_id` in `POST /api/shopping`, `POST /api/shop/quick-add` (`{ items, list_id }`) and sync op `add` (`list_id`) | a row counts as "already there" only on the same list |
| `GET /api/list/usuals?limit=60` | | `[{ productId, name, image_path, count, lastDay, onList }]` – "Unsere Üblichen", most frequent first |
| `GET /api/list/guard?text=&product_id=` | | `{ hints: [{ kind: 'on_list'\|'bought'\|'stock'\|'waste', text, itemId?, day?, qty? }] }` – e.g. "steht schon drauf (Mira, gestern 14:05)", "laut Bon vorgestern gekauft", "im Vorrat 2". Never blocks; the web app asks only for `bought`/`stock` |
| `GET /api/list/estimate?list=` | | `{ total, priced, unpriced, unpricedNames, since }` – latest receipt price × qty (120 days), unpriced rows counted, never guessed |

**One item in several shops**: "Wo kaufen?" (`buy_at`, several stores) was already there; a tick counts everywhere.
**"Ich bin bei Lidl"** in list mode = `GET /api/shop/list?store=<id>` (sorted by that store, rows for other stores in
`elsewhere`). Ticks may carry `store_id` (`POST /api/shop/items/:id/check` and sync op `check`) so a trip knows its
store.

## C – shopping together, live

No mode to switch on: **two or more ticks by the same person within 5 minutes** are a shopping trip; it ends after
20 quiet minutes, with "Einkauf fertig" or the store checkout. Ticks from every path count (list, store view, sync
queue, Home Assistant, CalDAV).

| Endpoint | Body | Answer |
|---|---|---|
| `GET /api/shop/trips` | | `[{ id, user: { id, name, color }, store: { id, name } \| null, startedAt, lastAt, mine, basket: [{ id, text, qty }], addOns: [{ id, text, from, done }] }]` – private trips only for their owner |
| `POST /api/shop/trips/:id/add` | `{ text }` | `{ id, created, for }` – "Bringst du noch Butter mit?": row with `source: 'trip'`, claimed for the shopper, notification `trip.addon` to them |
| `GET/PUT /api/shop/trips/privacy` | `{ private }` | "Mein Einkauf bleibt privat" (per person): nobody sees the trip, nobody is told |
| `GET /api/shop/stores` | | stores now also carry `lat`, `lon`, `radius_m` (null unless a person typed them in) |
| `PATCH /api/shop/stores/:id` | `{ lat?, lon?, radius_m? (30–2000) }` | `lat`/`lon` belong together; `null` clears |

**Splitting**: rows another person with an active trip has claimed ("Ich hol's") or already put in their basket do
not show in the viewer's aisles; the web app groups them as "Holt Sam". Notification `trip.started` goes to everyone
else who switched it on (default off).

**iPhone store-arrival hint** (iOS engineer): optional, opt-in on the phone. Use `GET /api/shop/stores` coordinates
(only those a person entered) with region monitoring on the device; nothing about places is sent to the server.

## D – notifications per person

See [notifications.md](notifications.md): `GET/PUT /api/notify/prefs`, `POST /api/notify/presence`,
`POST/GET/DELETE /api/push/apns`, `POST /api/push/apns/test`.

## E – bridges

### CalDAV (Apple Reminders, Nextcloud Tasks, DAVx⁵, Thunderbird)

ToHuus is the CalDAV server. Each list is a reminder list (VTODO); ticking, adding, renaming and deleting go both ways.

| Endpoint | Body | Answer |
|---|---|---|
| `POST /api/caldav/passwords` | `{ label }` | `{ id, username, password, url, server }` – the password is shown once (stored as a hash) |
| `GET /api/caldav/passwords` | | `[{ id, label, created_at, last_used_at }]` |
| `DELETE /api/caldav/passwords/:id` | | `{ ok }` |

DAV (outside `/api`, HTTP Basic with the app password; the user name is not checked):

- `/.well-known/caldav` → 301 `/caldav/`; `PROPFIND /` → 301 `/caldav/`
- `PROPFIND /caldav/`, `/caldav/p/` – principal, `calendar-home-set` `/caldav/c/`
- `PROPFIND /caldav/c/` Depth 1 – one calendar per list: `/caldav/c/0/` (main list), `/caldav/c/<id>/`;
  `supported-calendar-component-set` VTODO, `cs:getctag`, privileges, `supported-report-set`
- `PROPFIND /caldav/c/<list>/` Depth 1 – objects with `getetag`
- `REPORT` `calendar-query` (all VTODOs) and `calendar-multiget` (by href); `sync-collection` answers 403 (clients
  fall back to ctag + etags)
- `GET` / `PUT` (`If-Match`, `If-None-Match: *`) / `DELETE /caldav/c/<list>/<name>.ics`
- VTODO mapping: `SUMMARY` = "2 Milch" (quantity prefix) ↔ `qty` + `text`, `DESCRIPTION` ↔ note, `STATUS:COMPLETED` ↔
  tick; private rows never appear, discreet rows only with their placeholder. Client UIDs/file names are kept
  (`caldav_objects`).

**iPhone setup** (also shown in Settings › Mein Konto):

1. In ToHuus: Einstellungen › Mein Konto › „Die Liste in der Erinnerungen-App" › Passwort erstellen.
2. iPhone: Einstellungen › Apps › Erinnerungen › Erinnerungen-Accounts › Account hinzufügen › Andere ›
   CalDAV-Account hinzufügen.
3. Server: the host shown (e.g. `cloud.tohuus.de`), Benutzername and Passwort from step 1. iOS finds `/caldav/` via
   `/.well-known/caldav`.
4. Open Reminders – the ToHuus lists appear under the new account.

Nextcloud Tasks / DAVx⁵: the full address `https://<host>/caldav/`. Verified with the `tsdav` client (discovery,
fetch, create, update, multiget, ctag, delete) and raw requests in `test/list2-bridges.test.ts`.

In ToHuus Cloud the password carries the household routing prefix; a password only opens its own household.

### One-off import from another list app

`POST /api/list/import` – JSON `{ text, list_id?, include_checked?, dry_run? }` or multipart `file` (+ the same fields).
Answer: `{ format, added, already, skippedChecked }`, with `dry_run`: `{ format, items: [{ name, qty, note, checked }], skippedChecked }`.

Formats: **Google Keep** Takeout JSON (`listContent: [{ text, isChecked }]`, one note or an array), **Bring!** JSON
(`purchase: [{ name, specification }]` – Bring! has no file export; its shared text works as text), **CSV** with a
name column (`name`/`item`/`artikel`/`produkt`/`title`, optional `quantity`/`menge`, `note`/`notes`, `checked`/`erledigt`),
and **any shared text** (AnyList, Apple Notes, WhatsApp: bullets `•`, `-`, `☐`, `[ ]`, `[x]`, "Käse (Gouda)" → note).

### Purchase history CSV with date and price

`POST /api/imports/catalog-csv` (multipart `file`, `min_count`, optional `shop`) now keeps **date, shop and price**:
with a date column (`Datum`, `Kaufdatum`, `Bon_Datum`, `date` …) every row becomes a receipt line on its day
(`imports.kind = 'history-csv'`, status applied, no stock booking), grouped per day and shop (`Markt`, `Filiale`,
`shop` …), price from `Preis`/`Betrag`/`Summe` or `Einzelpreis × Menge`. A day+shop that already has a receipt with
about the same total is skipped; the same file twice adds nothing. Answer adds
`history: { receipts, lines, skippedDuplicates, undated }`. The purchase rhythm, "last bought", prices per shop and
spending work from day one.

## F – "Was nutzen wir?"

`GET /api/modules` → `{ stock, cook, money, treats, homeinfo, guests, ha }` (all `true` for existing households);
`PUT /api/modules` (admin) with any of them. Also in `GET /api/me` as `modules`. The shopping list is always on.
Switched off: hidden in the tab bar, "Mehr" and "Heute" (`/api/today` returns `stillHave: []`, `cookToday: null`,
`money: null` for those), notifications of that area are skipped (`modules.ts moduleOfEvent`), and its events leave
the personal notification matrix. Data stays. Shown in onboarding right after "Wer gehört dazu?" and in Settings ›
Haushalt.

## G – household forms

| Endpoint | Body | Answer |
|---|---|---|
| `POST /api/list/items/:id/owner` | `{ owner_user_id \| null }` | WG: personal row ("für Mika") or shared |
| `POST /api/imports/:id/split` | `{ paid_by?, lines?: [{ id, for_user_id?, for_list_id? }] }` | who paid; a line for one person (WG) or for a care list (Mitversorgen) |
| `GET /api/wg/balance?month=YYYY-MM` | | `{ month, people: [{ userId, name, paid, share, balance }], shared, withoutPayer, settle: [{ from, to, amount }] }` – sentences, never payments; care lines are left out |
| `GET /api/care/:listId/check` | | `{ list: { id, name, note }, items: [{ text, times, onList }] }` – fridge check before a visit |
| `POST /api/care/:listId/missing` | `{ names: [...] }` | `{ added }` – "fehlt" onto that list |
| `GET /api/care/:listId/spent?month=` | | `{ month, total, lines }` |
| `GET /api/list/lunchbox` | | `{ enabled, items, weekday (0=Sun), pausedUntil, lastWeek, due: { items, week } \| null }` |
| `PUT /api/list/lunchbox` | `{ enabled?, items?, weekday?, pausedUntil? }` | holiday pause = `pausedUntil` |
| `POST /api/list/lunchbox/add` | | `{ added }` – once per week |

Package-size hint: products thrown away ≥ 3 times in 90 days get `size_hint` on list rows and a `waste` guard hint
("Spinat 3× weggeworfen – lieber 250 g?").

Mitversorgen uses a list of kind `care` (own section in the store, handover note, substitute rule per row). Linking to
another ToHuus Cloud household through multi-household membership is **not built yet** – the care list is the bridge.

## H – drag & drop

| Endpoint | Body | Answer |
|---|---|---|
| `POST /api/list/items/:id/place` | `{ neighbor_id?, after?, section?, list_id? }` | row before/after another (sets `sort_key`), into another aisle (remembered for that product, like the aisle chips) or onto another list |
| `PATCH /api/plan/:id` | `{ day }` | (existing) a meal to another day |
| `GET/PUT /api/list/today-order` | `{ order: ['rhythm','list','still','cook','money','notices','pulse'] }` | the person's order of the "Heute" cards |

Web: `web/src/dnd.ts` (pointer events, long-press 350 ms on touch, lift, auto-scroll, Escape, reduced motion);
every drag has a menu alternative (aisle/list chips, up/down, day chips, "Gleicher Tag nächste Woche") and an undo
toast. Checked with Playwright (simulated mouse drag of a row into another aisle and of a meal onto another day).

## I – prices from own receipts, offers

| Endpoint | Body | Answer |
|---|---|---|
| `GET /api/prices/cheapest?limit=12` | | `[{ productId, name, saving, shops: [{ shop, price, day, base: { value, unit: 'kg'\|'l'\|'Stück' } \| null }] }]` – products bought at ≥ 2 shops |
| `GET /api/prices/product/:id` | | `[{ shop, price, day, base }]` cheapest first |
| `POST /api/offers/scan` | multipart `image` (flyer photo), or `{ url }` (link to an **image or PDF** – web pages are not read), or `{ text }` | `{ via: 'ocr'\|'ai'\|'pdf'\|'text', offers: Offer[] }` |
| `GET /api/offers` | | `Offer[]` still valid (expired ones are deleted) |
| `POST /api/offers/:id/add` | | `{ itemId, created }` – on the list with note "Im Angebot: Lidl 9,99 € bis 18.10." and the store in `buy_at` |
| `DELETE /api/offers/:id` | | `{ ok }` |

`Offer` = `{ id, name, price, regularPrice, size, shop, validFrom, validTo, productId, hints: string[], onList, due, added }`,
hints like "Kaffee Crema ist im Angebot und bei euch in 3 Tagen fällig", "sonst 5,99 € bei REWE", "bis 18.10.".

Reading order: OCR on the server (`ocrImage(buf, { psm: 11 })` from `server/lib/ocr.ts`, Tesseract, no AI), then the vision model
(`runVision('offer')`, counted as an import), else 422 with a hint to paste the text. Nothing from offer feeds or
scraping.

## J – friends & family measurement

Opt-in, household-local. `GET /api/pulse` → `{ enabled, share, question: { week, options: ['0','1-2','3-5','more'] } \| null, history }`
(question only on Sunday and Monday, once per ISO week); `POST /api/pulse { answer }`; `PUT /api/pulse/settings`
(admin) `{ enabled?, share? }` – both off by default. With `share` on (cloud only) the answer is added to an anonymous
count `pulse_agg(week, answer, n)` in accounts.db – no household id. Operator view: on the operator page `/betrieb`
(`OPERATOR_EMAILS` + a fresh password, [cloud.md](cloud.md#operator-page-betrieb)): `GET /api/operator/pulse` and
`pulse` in `GET /api/operator/overview` → `[{ week, counts: { '0', '1-2', '3-5', 'more' }, total }]`.

## Background jobs (list-jobs.ts)

At the household's digest hour: personal e-mail summaries. Once a day after 08:00: `rhythm.due` ("Wieder fällig: …").
Sunday after 17:00, when the week plan was used in the last four weeks and next week is empty: `plan.reminder`.
