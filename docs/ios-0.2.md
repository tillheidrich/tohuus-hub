# iPhone, iPad and Apple Watch app 0.2 – what the app expects from the server

> **Superseded for names:** since build 3 the app uses the real endpoints listed in [ios-api-0.2.md](ios-api-0.2.md)
> (trips, `/api/list/*`, `/api/ai/settings`, `/api/imports/lines`, `DELETE /api/push/apns/:id`, notify prefs with `apns`,
> Hausinfo, Cookidoo confirm, offers, prices, modules). The sections below describe the original 0.2 assumptions and
> the parts that are still true (targets, watch, store-arrival hint, APNs payload).

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

## 0.3 parity – Einkauf & Vorrat

Native in the iPhone/iPad app since the 0.3 parity work (package A, 12 Oct 2026). All endpoints already existed for the web; the app calls them from `ios/ToHuus/Core/API/Endpoints+ShopPantry.swift`, models in `Core/Models/ShopPantry.swift`.

| Screen / place | What | Endpoints |
|---|---|---|
| Einkauf › row (swipe from the left, context menu) | „Ich hol’s“ / „Freigeben“; the row shows „Du holst es“ / „Mira holt’s“ | `POST /api/claims { kind: 'shopping', id, on, user_id? }` |
| Einkauf › row sheet (`ItemDetailSheet`) | name and quantity, note, substitute, photo, **Wer kümmert sich?** (member chips), **Wo kaufen?** (chips + free text), **Wer sieht es?** (Alle / Diskret / Nur ich, placeholder, „der Person zeigen, die einkauft“, share with), last bought, remove | `PATCH /api/list/items/:id { text?, qty?, note?, substitute? }` (only changed keys), `GET /api/shop/members`, `GET /api/me` (`actor.userId`, `home.ui.claims`), `PUT /api/shop/items/:id/buy-at`, `GET /api/buy-at/suggestions`, `PATCH /api/share/items/:id` |
| Einkauf › add row | eye button: next entry discreet / only for me (goes straight to the server, never into the offline queue); clipboard button | `POST /api/share/items { text, visibility }` |
| Einkauf › „Liste einfügen“ (`PasteListSheet`) | PasteButton (no clipboard prompt) or typed text → lines with product matches → choose → add to the current list | `POST /api/share/parse { text }`, `POST /api/shop/quick-add { items, list_id }` |
| Einkauf › „Liste teilen“ | system share sheet with the export text (private rows out, discreet ones as placeholder) | `GET /api/shopping/export.txt` |
| Einkauf › „Wird bald knapp“ section | estimates for counted products not on the list, + puts it on | `GET /api/fresh/forecast?within=7` |
| Einkauf › list menu › „Liste umbenennen oder entfernen“ (`ManageListSheet`) | name, (handover) note, remove | `PATCH /api/list/lists/:id`, `DELETE /api/list/lists/:id` |
| Einkauf › „Läden & Gänge“ (`ShopSettingsSheet`, `StoreOrderView`) | shops, add / delete / rename, aisle order by drag | `GET/POST /api/shop/stores`, `PATCH /api/shop/stores/:id { name?, order? }`, `DELETE /api/shop/stores/:id` |
| Vorrat › product › „Bearbeiten“ (`ProductEditSheet`) | name, brand, category, usual place, exact spot, counting (Stück / Füllstand / nicht zählen), minimum, unit, note, photo | `PATCH /api/products/:id` (changed keys only), `POST /api/products/:id/image`, `GET /api/categories`, `GET /api/locations` |
| Vorrat › product › „Wo und bis wann“ | batches with place, date, geöffnet / eingefroren; per batch: change date, opened, freeze / thaw, move to another place; „Etwas wegräumen – mit Datum und Ort“ | `GET /api/fresh/products/:id`, `PATCH /api/stock/:id { best_before?, location_id? }`, `POST /api/fresh/products/:id/open|freeze|thaw { entry_id, qty? }`, `POST /api/stock/adjust { delta, location_id, best_before }` |
| Vorrat › product › „Wo kaufen?“ | shops for the product | `PUT /api/products/:id/buy-at` |
| Vorrat › filter menu | group by place or category (this device, `pantry.group`), filter by category | `GET /api/categories` |
| Vorrat › „Schnell-Check“ (`QuickCheckView`, `CheckStackView`) | places with last check → one card per thing: Stimmt / Weniger / Leer / Weg (reason) | `GET /api/fresh/check`, `GET /api/fresh/check/:place`, `POST /api/fresh/check/:place { product_id, action, qty?, reason? }` |
| Vorrat › „Wo ist was?“ (`FindView`) | search with place path, hint and exact spot | `GET /api/find?q=` |
| Vorrat › „Reste wegstellen“ (`LeftoversSheet`) | name, portions, containers, fridge/freezer, own eat-by; label image to share; boxes in the fridge and freezer | `POST /api/labels/boxes`, `GET /api/labels/boxes`, `GET /api/labels/boxes/:code/label.png` |
| Vorrat › „Dosen-Etikett scannen“ (`LabelSheet`, `BoxDetail`) | QR from a box label (existing `CodeScannerView`): took one portion, all eaten, thawed, thrown away, undo, plan it; product and place labels too | `GET /api/labels/boxes/:code`, `POST …/action { action }`, `POST …/undo`, `POST …/plan { day, slot }`, `GET /api/qr/:code` |
| Product pictures (decision 1.0) | list rows (own row photo, else the product picture; left of the name, all densities and in the shop), „vermutlich fällig“ chips on the list, „Unsere Üblichen“, Heute › „Vermutlich fällig“ and „Das habt ihr noch“, pantry rows, product page – shown only when the server has a picture (`ProductThumb`) | `image_path` on `/api/shop/list` rows, `/api/products`, `/api/list/usuals`; `image` on `/api/rhythm` and `/api/today` (`rhythm`, `stillHave`) – signed `/img/…?h=&e=&s=` URLs for bearer clients |
| Vorrat › product › picture (tap the picture, or „Bearbeiten“ › „Bild ändern“) (`ProductImageSheet`) | own photo (camera on device, Fotos) or a picture from Open Food Facts (search, weak matches below score 0.4 hidden); saved at once, credit shown | `POST /api/products/:id/image` (multipart `image`, or `url` + `code`), `GET /api/lookup/search?q=` |
| Vorrat › „+“ / barcode (`NewProductSheet`) | new product by hand or from a scan: Open Food Facts picture from the scan, or pictures offered while typing the name, or an own photo; category, place, counting, how many at home | `GET /api/lookup/barcode/:code`, `GET /api/lookup/search`, `POST /api/products { name, brand, category_id, default_location_id, track_mode, code, image_url, initial_qty, initial_location_id }`, then `POST /api/products/:id/image` for an own photo |
| Heute › „Das habt ihr noch“ (`EatSoonCard`) | per row: Aufgebraucht (quick-check `empty` at the place of the first batch; things only „probably at home“ use used-up, which puts them on the list), Noch da (quick-check `ok`), Einplanen (today / tomorrow) | `GET /api/fresh/today` (place per product), `POST /api/fresh/check/:place`, `POST /api/stock/used-up`, `POST /api/plan { day, title }` |

`ShopItem` decodes `share` (`ShareInfo`: visibility, mine, owner, revealed, share_with, reveal, placeholder). German strings for this area live in `ios/tools/strings_de_shop_pantry.json`; `tools/gen_strings.py` now merges every `strings_de_*.json` (re-run it after merging branches – `Localizable.xcstrings` is generated).

Debug launch arguments (debug builds): `-debugItemSheet YES`, `-debugShopSettings YES`, `-debugPaste YES` (with `-debugTab shopping`); `-debugProduct <id>`, `-debugProductEdit YES`, `-debugProductImage YES`, `-debugNewProduct YES` (`-debugNewProductName <text>`), `-debugCheck YES`, `-debugCheckStack YES`, `-debugFind YES -debugFindQuery <q>`, `-debugLeftovers YES`, `-debugLabel <code>` (with `-debugTab pantry`).

Still web-only in this area: printing label sheets (PDF), offers comparison per shop, kiosk/displays, WG personal rows (`owner`), the starter staples picker, waste insights per month, freezer/opening shelf-life settings per product.
## 0.3 parity – Kochen

Native in the app now (mirrors `web/src/pages/Week.tsx`, `Plan2.tsx`, `WhatToEat.tsx`, `Recipe.tsx`, `RecipeServings.tsx`, `RecipeVariant.tsx`, `people/Ratings.tsx`). Code: `ios/ToHuus/Features/Cooking/*`, endpoints in `Core/API/Endpoints+Cooking.swift`, models in `Core/Models/Cooking.swift`, strings in their own table `Resources/Cooking.xcstrings` (`LC()` / `LCF()` fall back to `Localizable`).

| Screen | What | Endpoints |
|---|---|---|
| Kochen › Woche (`WeekPlanSection`) | 7 days with day marks, who cooks (avatar), cooked ✓, drag to another day, week back/forward; „Woche füllen“ (Plus: `limits.features.weekPlanFromPantry` false → paywall, 402 → paywall), „Für die Woche einkaufen“ | `GET /api/plan`, `GET /api/plan2/week`, `GET /api/claims?kind=plan`, `PATCH /api/plan/:id {day|cooked}`, `POST /api/plan/autofill`, `POST /api/plan/shopping` |
| „Was gibt’s am …?“ (`PlanPickerSheet`) | zu Hause / auswärts / nicht da, Mittag/Abend, „Für wie viele?“, Suche oder Freitext („Pizza“), passende Vorschläge, „Alle abstimmen lassen“ | `PUT /api/plan2/days/:day {kind}`, `POST /api/plan2/entries`, `GET /api/recipes/suggest` |
| Essen antippen (`MealSheet`) | Wer kocht, Portionen nur dieses Mal, gekocht, auf morgen, „Wir gehen essen“ (alles einen Tag nach hinten, mit Rückgängig), anderer Tag, entfernen (Rückgängig) | `POST /api/claims`, `GET /api/shop/members`, `PATCH /api/plan2/entries/:id/servings`, `POST /api/plan/shift`, `DELETE /api/plan/:id` |
| Vorlagen & Rotation (`RotationSheet`) | Woche speichern/ersetzen, Vorlage für diese Woche, Buchstaben A–F, nächste Woche, Wiederholsperre, automatisch füllen, aus der Rotation füllen | `/api/plan2/templates*`, `/api/plan2/rotation*` |
| Wer will was? (`VotesSheet`, `StartVoteSheet`, `VoteDetailView`) | Abstimmungen anlegen (geheim / zusammen), Karten Nein/Ja/Super, Kacheln reihum, Ergebnis in den Plan | `/api/plan2/votes*`, `/api/plan2/vote-ideas`, `/api/plan2/members` |
| Kochen › Was essen wir? (`WhatToEatSection`) | Geplantes heute, „Entscheidet ihr für uns“ / „Was anderes“, Filter (Thermomix, ohne, ≤ 20/40 min, vegetarisch, nichts kaufen; per Gerät gemerkt), Reste zuerst („Essen wir“), geht sofort, nur eins fehlt (→ Liste, „X stattdessen“ → nur heute / immer bei diesem Rezept / überall), schnell | `GET /api/cook2/what-to-eat`, `POST /api/cook2/what-to-eat/pick`, `POST /api/cook2/missing-to-list`, `POST /api/fresh/leftovers/:id/eat`, `POST /api/cook2/recipes/:id/variant/change`, `POST /api/cook2/swap-rules` |
| Rezept (`RecipeDetailView`) | Portionen −/+ skaliert die Mengen (Port von `web/src/scale.ts`), aus dem Plan geöffnet mit dessen Portionen + „für den Plan übernehmen“, Favorit, „Wer mag’s?“ pro Person, „So machen wir das“ / Original, Hausregel „hier nicht“, fehlende → Liste (skaliert), planen mit Portionen | `GET /api/recipes/:id`, `/match`, `GET /api/cook2/recipes/:id/variant`, `GET/PUT /api/people/recipes/:id/ratings`, `PATCH /api/recipes/:id/favorite`, `POST /api/recipes/:id/shopping {servings}`, `GET /api/plan2/entries/:id` |
| „Guten Appetit!“ (`CookedSheet`) | eine Bewertung pro Person am Tisch, „Habt ihr etwas anders gemacht?“, was verbraucht wurde (Mengen nach Portionen), Reste (Portionen, Kühlschrank/Gefrierfach → Dosen ohne Etikett) | `POST /api/people/recipes/:id/meal`, `POST /api/recipes/:id/cooked {rating, consume_qty, plan_entry_id}`, `POST /api/labels/boxes {labelled:false}` |
| Bearbeiten (`RecipeEditSheet`) | wie im Web (Zeilen, „(Grundzutat)“, Thermomix-Einstellungen in eckigen Klammern), löschen | `PUT /api/recipes/:id`, `DELETE /api/recipes/:id` |
| Rezepte | „mit: Hähnchen, Paprika“ sucht über Zutaten, darunter „So kochen wir“ (Hausregeln an/aus/löschen/neu) | `GET /api/recipes/search?with=`, `/api/cook2/swap-rules*` |
| Rezepte entdecken (`OpenRecipeBrowser`, `OpenRecipePreviewSheet`) | offene Rezeptdatenbank (TheMealDB über den Server) als Bildkacheln, Themen-Chips (Hähnchen, Pasta …, englische Suchwörter) oder eigene Suche; Vorschau mit Foto, Zutaten (übersetzt, Original darunter), Schritte; „In unsere Rezepte“ speichert mit einem Tipp und öffnet das Rezept. Erreichbar über die Karte unter der Rezeptliste und „Rezept hinzufügen“ | `GET /api/recipes/open/search?q=`, `GET /api/recipes/open/themealdb/:id`, `POST /api/recipes/open/import {id}` |
| Rezeptpaket (`RecipePackageView`, `ImportPreviewSheet`) | Datei aus „Dateien“ (ToHuus-Paket-ZIP, JSON, Mealie/Paprika/Tandoor/Nextcloud/KitchenOwl, CSV) → Vorschau mit Fotos, Doppelte starten abgewählt, Auswahl → Übernahme mit Fortschritt; Prompt für die eigene KI kopieren; Export als ZIP über das Teilen-Menü | `POST /api/recipes/import/detect` (multipart `file`), `POST /api/recipes/import/commit {session, include?}`, `GET /api/recipes/import/jobs/:id`, `GET /api/recipes/package/template`, `GET /api/recipes/package.zip` |
| Rezeptfoto | eigenes Foto auf der Rezeptseite hinzufügen/ändern (max. 1600 px, JPEG); Fotos stehen in Liste, Kopf, Plan, Was essen wir? und Heute | `POST /api/recipes/:id/image` (multipart `image`) |
| Assistent | Chip „Öffnen“ bei `recipe_save_adapted` öffnet das gespeicherte Rezept | assistant action field `recipe_id` (new, server/lib/assistant-tools.ts) |

Debug launch args (debug builds): `-debugTab cooking -debugCook wte|week|recipes|recipe:<id>|with:<terms>|open|open:<query>|import`, `-debugCookWeek <offset>`.

Still web-only: label printing for leftovers (the phone saves the boxes unlabelled), Cookidoo sync button, the favourites page and person profiles, step-by-step cook mode on the iPhone (the iPad kitchen mode has its own), meal-box picks in the plan picker, printing the week.
## 0.3 parity – Geld, Bons, Haushalt, Bring mir was & Hausinfo (package C)

New native screens (debug launch args open them directly in simulator builds):

| Screen | File | Endpoints | Debug |
| --- | --- | --- | --- |
| Bons (receipts list: status, shop, total, date, thumbnail; eBon link/QR) | Features/Imports/ImportsListView.swift | `GET /api/imports`, `POST /api/imports/url`, `POST /api/imports/:id/discard` | `-debugTab money -debugMoney receipts` |
| Bon prüfen (fix a line, link to product / new product, leave a line out, target place, apply) | Features/Imports/ImportReviewView.swift | `GET /api/imports/:id`, `PATCH /api/imports/:id/lines/:lineId`, `POST /api/imports/:id/apply`, `POST /api/imports/:id/rematch` | `-debugMoney review:<id>` |
| Geld im Detail (periods 12 weeks/months/years/all, drill-down to entries and receipts, budgets + notify, own expenses, leave out / count again, CSV via share sheet) | Features/Money/SpendView.swift, SpendSheets.swift | `/api/spend/stats`, `/api/spend/meta`, `/api/spend/entries`, `/api/spend/receipts/:id`, `/api/spend/budgets`, `/api/spend/expenses`, `/api/spend/exclusions`, `/api/spend/export?format=csv` | `-debugMoney detail` |
| Wo war's günstiger / price history (chart, per-shop prices with the cheapest marked, product picture) | MoneyView "Wo war's günstiger" → PriceHistoryView; "Alle Preise" → PricePickerView | `GET /api/prices/cheapest`, `GET /api/prices/product/:id`, `GET /api/spending/prices/:id`, `GET /api/spending/products` | `-debugMoney prices`, `-debugMoney price:<productId>` |
| Leute & Vorlieben (avatars, likes/dislikes/allergies with the Art. 9 consent step) | Features/Household/HouseholdView.swift | `GET /api/people`, `PUT /api/people/{me\|person/:key}/prefs`, `…/face` | `-debugSettings YES -debugMore people` |
| Jemanden einladen (create, share sheet + QR, list, renew, revoke) | Features/Household/InvitesView.swift | `GET/POST /api/invites`, `GET /api/invites/options`, `POST /api/invites/:id/resend`, `DELETE /api/invites/:id` | `-debugMore invites` |
| Was ToHuus sich merkt (list, add, forget, only for me) | Features/Household/MemoryView.swift | `GET/POST /api/memory`, `DELETE /api/memory/:id` | `-debugMore memory` |
| Bring mir was (tiles, options, "who brings it", wish with note, inbox "Für dich" with I'll bring it / can't right now + reason / brought it, own wishes with private thanks; refreshes every 20 s) | Features/Treats/TreatsView.swift | `GET /api/bar/menu`, `/api/bar/helpers`, `/api/bar/my-orders`, `/api/bar/requests`, `POST /api/bar/orders`, `PATCH /api/orders/:id`, `POST /api/bar/orders/:id/thanks` | `-debugMore treats` |
| Gäste-Links (babysitter/visitors/grandparents presets, scopes, places, days, note; share sheet + QR shown once; new link; revoke) | Features/Treats/GuestLinksView.swift | `GET/POST /api/guest-links`, `POST /api/guest-links/:id/rotate`, `DELETE /api/guest-links/:id` | `-debugMore guestlinks`, `guestlink-new` |
| Hausinfo bearbeiten (admins: new/edit/delete cards and codes, who sees it: everyone at home / sitter links; code values are never loaded – empty field keeps them) | Features/Settings/HouseGuideView.swift, HouseGuideEdit.swift | `POST/PATCH/DELETE /api/house-guide/cards[/:id]`, `…/codes[/:id]` | `-debugMore house`, `housecard-new`, `housecard-edit`, `housecode-new` |

Entry points: Geld → "Im Detail", "Bons", "Wo war's günstiger" rows and "Alle Preise"; Bon erfassen → "Bons prüfen";
Mehr › Haushalt → Leute & Vorlieben, Jemanden einladen, Was ToHuus sich merkt, Bring mir was, Gäste-Links (`HouseholdLinks`);
Mehr › Hausinfo → Links für Babysitter und Gäste (admins).

Design: `Design/EmptyArt.swift` draws the web's empty-state illustrations (list, shelf, book, receipt, box, done,
calendar, suitcase, bag) and the BrandMark as SwiftUI paths in the Dutch Detail colours; `EmptyStateView` shows the
drawing (explicit `art:` or derived from the SF Symbol name) plus an optional action button – the old
`EmptyStateView(systemImage:title:message:)` API still works. `Design/Avatar.swift` (`AvatarView`, `PersonAvatar`):
initials, animal drawing or photo on the person's colour, like web people/Avatar.tsx.

Still web-only: guest and party board (`/bar`, kitchen view), the menu editor ("Was Gäste sich wünschen können"),
per-link Hausinfo selection (`/api/house-guide/links/:id`), Hausinfo templates and access log, children and permanent
guests (add), receipt e-mail forwarding setup.
## 0.3 parity – account, onboarding, subscriptions, App Store (1.0, package D)

The App Store app was **ToHuus Cloud only** until 14 Oct 2026; since then it also connects to a self-hosted server ("Eigener Server", see CLAUDE.md).
Debug builds keep `-debugServer <url> -debugToken <t> -debugHousehold <uuid>`; `-debugServer` alone points the start
screen at another cloud (development).

**New / changed screens**

| Screen | File | Endpoints |
|---|---|---|
| Start: brand mark, "ToHuus merkt sich, was zu Hause fehlt.", Sign in with Apple, "Konto erstellen", "Anmelden", privacy + terms | `Features/Start/StartView.swift` | `GET /api/instance` |
| Sign in: e-mail + password, "Mit Code aus einer E-Mail anmelden", "Mit Passkey anmelden" | same | `POST /api/auth/app`, `POST /api/auth/passkey/options { client: 'ios' }` → `…/verify { key, device, response }` |
| Code by e-mail | same (`EmailCodeView`) | `POST /api/auth/link { email }`, `POST /api/auth/link/code { email, code, device }` |
| Create account (with "Mit Apple registrieren") | same (`SignUpView`) | `POST /api/cloud/signup`, `POST /api/auth/apple` |
| "Möchtest du Beispieldaten …?" (sheet after a new household; also when `GET /api/tour` → `start.due` for an admin) | `Features/Samples/SampleViews.swift` | `POST /api/tour/start { choice }` |
| "Beispiel" tag on list, pantry and recipe rows | `SampleTag` in ShoppingView, PantryView (`ProductRow`), CookingView | `GET /api/tour/demo/marks` |
| Heute: "Bereit für deine eigenen Sachen?" (once, after 3 days) | `SampleNudgeCard` in TodayView | `GET /api/tour` → `demo.nudge`, `POST /api/tour/demo/remove`, `POST /api/tour/demo/nudge` |
| Mehr › Beispieldaten entfernen (admins, while there are sample rows) | `SampleDataSettingsSection` | `POST /api/tour/demo/remove { include_used: false }` |
| Mehr › Konto löschen (2 taps) – password, or Sign in with Apple, or the mail code | `Features/Settings/AccountDeletion.swift` | `DELETE /api/cloud/account { password }` / `{ appleIdentityToken, appleNonce }` / `{ code }` |
| Plans (per household): trial days left, what each plan includes, prices from StoreKit, "Preise gerade nicht verfügbar" when StoreKit has no products, restore, "Abo verwalten" (`manageSubscriptionsSheet`), redeem code, Apple EULA + our terms + privacy | `Features/Paywall/PaywallView.swift` | `GET /api/billing/status` (`plans`, `limits`, `trialEndsAt`, `renewsAt`, `expiresAt`, `manageUrl`), `POST /api/billing/apple/transaction` |

Sign in with Apple: `SignInWithAppleButton` (black on light, white on dark), scopes name + e-mail, nonce = random 32 bytes
(base64url), SHA-256 hex in the request, raw value to `POST /api/auth/apple`. Re-authentication for deleting the account
uses `ASAuthorizationController` (`Features/Start/AuthKit.swift`, also the passkey assertion). Cancelling is silent.

**project.yml**: `MARKETING_VERSION 1.0.0`, `CURRENT_PROJECT_VERSION 5`; app entitlements
`com.apple.developer.applesignin: [Default]` and `com.apple.developer.associated-domains:
[webcredentials:cloud.tohuus.heidrich-digital.de]` – **both capabilities must be enabled for the App ID in the developer
account before the next signed build**. `ITSAppUsesNonExemptEncryption` stays `false`. Camera text without the server QR
code. StoreKit configuration `ios/StoreKit/ToHuus.storekit` (the four products, German storefront) is set in the
scheme's run action.

**Privacy manifest** (`ToHuus/Resources/PrivacyInfo.xcprivacy`, in every target): no tracking; collected (linked, app
functionality only): e-mail, name, user id, other user content, photos, audio (assistant), purchase history, other
financial info (receipts). Required-reason APIs: UserDefaults only (CA92.1, 1C8F.1); no file timestamps, boot time,
disk space or keyboard APIs (checked).

**Notifications** are asked only in context (Mehr › Mitteilungen, and when switching on the shop hint) – never at launch.

Debug launch args: `-debugSampleQuestion YES`, `-debugSignedOut YES` with `-debugStartSignUp YES` / `-debugStartSignIn YES` /
`-debugStartCode YES`, `-debugPaywall YES`, `-debugSettings YES`.

## 0.3 parity – beta gate, shops, ToHuus-Rezepte (1.0, package q-admin)

- **Sign-up** (`StartView.swift` › `SignUpView`): when `/api/instance` → `signupMode == "invite"`, a section *Zugangscode*
  (sent as `betaCode` with `POST /api/cloud/signup`) and the sentence "ToHuus ist gerade im kleinen Test …" with a mail
  link to `instance.support` (`BetaNote`); the start screen shows the same note. *Wo kauft ihr meistens ein?*: chips
  from `GET /api/cloud/store-choices?region=<device region>` (alphabetical + market), own entries, sent as `stores`.
  The Apple button on the sign-up screen sends `betaCode` and `stores` with `POST /api/auth/apple`.
- **Kochen › Was kochen wir?** (`CatalogNewSection.swift`, cloud only): "Neu diese Woche" from `GET /api/cloud-recipes`
  (fallback "Neu von ToHuus"), placeholder with the dish name when there is no photo, "KI-Bild" badge for AI pictures,
  "Mit KI geschrieben, von uns geprüft"; *Speichern* → `POST /api/cloud-recipes/:id/save` and opens the saved recipe.
- **Statistics**: every request carries `X-ToHuus-Client: ios|watch` (APIClient) – the only thing the cloud's usage
  statistics learn about the device. Endpoints: `Endpoints+CloudRecipes.swift`, `Endpoints+Account.swift`
  (`storeChoices`); models `CloudRecipes.swift`, `Signup.swift`. Strings: `ios/tools/strings_de_admin.json`.
## 0.3 parity – Geld wave 2 (q-money)

Server and fields: [docs/money.md](money.md). New files: `Core/API/Endpoints+Money.swift`, `Core/Models/Money.swift`, `Features/Money/ExpenseEditView.swift`, `Features/Money/MoneyListViews.swift`.

- **Geld tab**: „Haushalt / Nur meins“ (segmented, stored in `SharedConfig` `money.view`, shared with „Im Detail“, which passes `view=mine` to stats, drill-down and CSV export); „Ausgabe eintragen“; card „Aufteilen“ with the money lists; „Kategorien & Aufteilen“.
- **Own entry** (`ExpenseEditView`, also from „Im Detail“): document camera / photo / PDF → `POST /api/spend/files` with `read=1` (fills amount, date, shop, lines when empty), category chips from `money_categories`, „Für wen?“ (household / just me / a member = personal), „Wer hat bezahlt?“, single items with a person each, attachment view/remove.
- **Receipt in „Im Detail“**: who paid, a person per line (`POST /api/imports/:id/split`), „Dieser Bon gehört nur mir“ (`POST /api/spend/receipts/:id/personal`), „Bon aufteilen“ → money list from the receipt.
- **Money lists**: list (`MoneyListView`): equal / by person, amounts editable, payer and owner per cost, „Alles bezahlt von …“, people add/remove (swipe), Ausgleich with „Erledigt“/undo, „Alles ist ausgeglichen“, share text (ShareLink, copy, mail), visibility for the owner, delete. New list (`NewMoneyListView`): from typing, a shopping list, a trip or a receipt; with names or just a number; private + chosen people.
- Entry rows show badges: personal, for a person, your part, paperclip.
- Debug: `-debugMoney list:<id> | newlist | expense | mine | settings | receipt:<id>`.
- Still web-only: selecting single receipt lines for a money list (iOS splits the whole receipt), per-line person in the import review screen (iOS: in the receipt under „Im Detail“).
## 0.3 parity – Wünsche & private Listen (package q-wish, 13 Oct 2026)

| Screen | File | Endpoints | Debug |
|---|---|---|---|
| Wünsche (lists, search, archive, new list with „für wen“ and „wer sieht das“) | Features/Wishes/WishesView.swift `WishesView`, `WishListEditSheet` | `GET/POST /api/wishes/lists`, `GET /api/wishes/search` | `-debugTab shopping -debugWishes YES` |
| One list (quick add, sort, reserve/bought/release, auf die Einkaufsliste, share selection) | `WishListDetailView`, `WishToListSheet`, `WishShareSheet` | `GET/PATCH/DELETE /api/wishes/lists/:id`, `POST …/items`, `POST /api/wishes/items/:id/status`, `…/to-list`, `POST /api/wishes/lists/:id/share` | – |
| Wish (photo from camera/Fotos, several links with price and server preview, price, priority, note, „wer könnte das schenken“) | `WishEditSheet` | `PATCH/DELETE /api/wishes/items/:id`, `POST/DELETE …/photo`, `POST /api/wishes/preview` | – |
| Private shopping lists („Wer sieht das?“ in Liste bearbeiten, lock/people icon in the list menu) | Features/Shopping/ListTools.swift `ManageListSheet`, Features/Wishes/VisibilityPicker.swift | `PATCH /api/list/lists/:id { visibility, share_with }`, `GET /api/list/lists` (+ `visibility, owner, share_with, mine`) | – |

Entry: Einkauf › menu (top right) › „Wünsche & Merkliste“. The app follows `can_reserve` / `for_me` from the server; the person a list is for never gets reservation data. API: [wishes.md](wishes.md). Strings: `ios/tools/strings_de_wish.json`.

## 14 Oct 2026 – Mehr like the web, Hausinfo complete, Pflege native

**Mehr** (`Features/Household/HouseholdLinks.swift` › `MoreSections`) has the web's four groups in the web's order
(`web/src/nav.tsx` `moreGroups`): *Rund ums Zuhause* (Wo ist was?, Hausinfo, Wünsche & Merkliste, Schneller Abgleich,
Pflege & Fristen, Urlaub / unterwegs, Übergabe for guests), *Bons & Rezepte* (Bons & Importe, Lieblinge, Ausgaben im
Detail), *Bring mir was & Gäste* (Bring mir was, Gäste & Party, Gäste-Links), *Haushalt & Einstellungen* (Leute,
Jemanden einladen, Was ToHuus sich merkt, Displays, Home Assistant, QR-Etiketten, Daten & Sicherung). The same filters
as the web: `MoreAccess.guestAllows` (port of `web/src/people/access.ts`, needs `GET /api/me` actor.houseGuest.level)
and `MoreAccess.moduleAllows` ("Was nutzt ihr?"). Hausinfo is no longer hidden when the `homeinfo` area is off – the
web never hid it (only `/pflege` belongs to that area). Entries without a native screen open the web page signed in
(`WebPageView`): Urlaub, Übergabe, Lieblinge, Gäste & Party, Displays, Home Assistant, QR-Etiketten, Daten.

| Screen | File | Endpoints | Debug |
| --- | --- | --- | --- |
| Pflege & Fristen (due / later, done with undo, fixed-date tasks ask for the new date, one-tap templates by group, detail with history and "Ich kümmere mich", new / edit / delete; labels open the web page) | Features/Household/CareView.swift | `GET/POST /api/care`, `GET/PATCH/DELETE /api/care/:id`, `POST /api/care/:id/{done,undo,claim}` | `-debugMore care`, `care-new` |
| Hausinfo (codes on top, cards by room or by kind, search, drafts "noch ausfüllen" for admins with their hint, phone numbers as links, Home Assistant voice list, "zuletzt gezeigt" per code, print sheet "Für den Babysitter" with "Codes mitdrucken") | Features/Settings/HouseGuideView.swift, HouseGuideAdmin.swift | `GET /api/house-guide`, `POST …/codes/:id/reveal` | `-debugMore house` |
| Hausinfo admin: templates, who looked at codes, what each babysitter link shows, who sees a card/code (everyone, permanent guests from a level, all sitter links, single links – codes with an end date) | Features/Settings/HouseGuideAdmin.swift, HouseGuideEdit.swift (`HGVisibilityEditor`) | `GET/POST /api/house-guide/templates[/:key]`, `GET /api/house-guide/log`, `GET/PUT/DELETE /api/house-guide/links/:id` | `-debugMore house-templates`, `house-log` |

The print sheet goes through AirPrint (`UIPrintInteractionController` with an HTML formatter); "Als PDF sichern"
comes from the print dialog. Code values for printing exist only in memory and in the print job, each one is revealed
and logged like a tap on "Zeigen".

German strings for these screens: `ios/tools/strings_de_parity.json` (taken from the web's `web/src/locales/de` where
the English key is the same).

### 14 Oct 2026 (later) – Urlaub / unterwegs and Übergabe native

| Screen | File | Endpoints | Debug |
| --- | --- | --- | --- |
| Urlaub / unterwegs: current or chosen trip with phase line, travellers / staying home, quiet and pause flags, edit, "Wir sind zurück" / cancel, delete; presence suggestion from Home Assistant (start / not now); other trips; new / edit trip (dates, who travels, extra names travel / stay, use-up days, three switches, holiday-flat shop) | Features/Away/AwayView.swift | `GET /api/away`, `GET/PATCH/DELETE /api/away/trips/:id`, `POST /api/away/trips`, `POST …/stop`, `POST /api/away/suggestion/{start,dismiss}` | `-debugMore away` |
| Trip tabs (chips like the web's segments): **Vorher** (use up first with freeze, recipes that use it up, generated checklist), **Packen** (lists, own lists save / delete, add text, from stock with picker and suggestions, qty, book out), **Küche** (meals per day, from recipes, ingredients from the meals, own list, share as text), **Haushüten** (notes, link create / new / end, share, "Hausinfo für diesen Link"), **Übergabe** (HandoverView), **Zurück** (welcome-home list → shopping list, expired: toss / still good, book back) | Features/Away/AwayView.swift | `POST /api/away/trips/:id/{checklist,freeze,pack,pack/template,templates,book-out,book-back,meals,kitchen-list,kitchen-list/generate,sitter-link,expired,welcome,welcome-done}`, `PATCH/DELETE /api/away/items/:id`, `DELETE /api/away/{meals,templates}/:id`, `DELETE …/sitter-link`, `GET …/kitchen-list.txt` | |

## 14 Oct 2026 (later) – Aufgaben, Wer hat was im Blick, Erinnerungen & Kalender

| What | Where | API |
|---|---|---|
| Aufgaben (filter Alle / Haushalt / Pflege & Fristen / Meine; area, rhythm, "bei Bedarf", only for me, take turns, who does it, sub-items; recently done; nobody-keeps-it-in-mind hint) | Features/Household/CareView.swift | `GET/POST /api/care`, `GET /api/care/recent`, see docs/tasks.md |
| Aufgaben heute (ring) on Heute | Features/Today/TasksTodayCard.swift | `GET /api/care`, `POST /api/care/:id/done` |
| Wer hat was im Blick (names per area, own number, "Anteile vergleichen") | Features/Household/BlickSection.swift | `GET /api/blick`, `PUT /api/blick/compare` |
| Erinnerungen & Kalender (CalDAV app password) | Features/Settings/CalDavView.swift | `GET/POST/DELETE /api/caldav/passwords` |
| Assistant: sparkles icon, screen context per area | MainTabView, AssistantSheet | `POST /api/assistant/chat { context }` |
| Termine: time, length and place in the task form, "In den Kalender" in the detail (EKEventEditViewController), time on Heute | Features/Household/CareView.swift, AddToCalendar.swift, Today/TasksTodayCard.swift | `POST/PATCH /api/care { due_time, duration_min, place }` |
| Kalender-Abo for Google / Outlook | Features/Settings/CalDavView.swift | `GET/POST/DELETE /api/calendar/feeds` |

## 14 Oct 2026 (night) – no compromises: everything native, own server, new structure

Tabs Heute · Einkauf · Kochen · Zuhause · Geld (`App/MainTabView.swift`, `Features/Home/HomeView.swift`), search and the avatar for Mehr at the top right of every tab (`Design/RootChrome.swift`, `Features/Search/GlobalSearchView.swift`), Mehr as one list (`Features/Settings/SettingsView.swift`, `Features/Household/HouseholdLinks.swift`). Own server on the start screen (`Features/Start/OwnServerView.swift`, `ConnectKit.swift`). The areas are described in `docs/ios-native-*.md`; the overview is `docs/ios-parity-2026-10-13.md`.
