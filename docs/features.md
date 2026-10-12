# Feature reference

Everything ToHuus Hub does, grouped by area, with where to find it in the app. Paths use the English UI; the German UI name follows in parentheses. "More" is the sheet behind the last tab on a phone; on a wide screen the same groups are in the sidebar.

Admins see every settings tab. Members see most of them read-only. Permanent guests only see *Settings › My account* and the pages their level opens (see [guests-and-permissions.md](guests-and-permissions.md)).

## Navigation at a glance

| Group | Pages |
|---|---|
| Tab bar | Today (Heute), Treats (Verwöhnen), Shopping (Einkauf), More (Mehr) |
| Around the house (Rund ums Haus) | Stock (Bestand), Where's what? (Wo ist was?), Quick stock check (Schnell-Abgleich), Home & care (Haus & Pflege), Trip / away (Urlaub / unterwegs) |
| Kitchen & shopping (Küche & Einkauf) | Shopping (Einkauf), Cook (Kochen), Favourites (Lieblinge), Imports (Importe), Spending (Ausgaben) |
| Treats & guests (Verwöhnen & Gäste) | Treats (Verwöhnen), Guests & party (Gäste & Party) |
| Manage (Verwaltung) | QR labels (QR-Etiketten), Settings (Einstellungen), Help (Hilfe) |

Settings tabs: Household (Haushalt), My account (Mein Konto), Members (Mitglieder), Places & categories (Orte & Kategorien), Notifications (Benachrichtigungen), Access & AI (Zugänge & KI), Home Assistant, Displays, Printers & tickets (Drucker & Bons), Recipes (Rezepte), Data & backups (Daten & Sicherung).

## Today

- **Overview**: things that need attention (low, empty, expiring), the places in the house with a health meter, what is planned for today, a cooking idea, recent changes. *Today (Heute)*
- **Eat me first** and leftover boxes that should go soon. *Today › Eat me first (Heute › Zuerst essen)*
- **Getting started checklist** for new households, until dismissed. *Today*
- **Due care tasks** and **kid wishes** waiting for a parent. *Today*
- **Trip banner** while a trip is running. *Today*
- **Add** button: add stock, scan a barcode, put leftovers away. *Today › + (Hinzufügen)*

## Shopping

- **Live list** shared by all members, with live updates over server-sent events. Ticking an item can book it into stock; un-ticking takes exactly that booking back, and a receipt for the same product within 3 days does not book it a second time. *Shopping (Einkauf)*
- **Every row says where it came from** (`origin`): who added it and when, "merkt sich: alle ~9 Tage", "aus Rezept Lasagne", "vom Assistenten", "über Home Assistant".
- **Clear checked** hides ticked rows from every list but keeps them as purchase signals for the rhythm (nothing is deleted).
- **Low stock onto the list automatically** is off by default since October 2026 (suggestions instead of automation). Households that already kept their stock up to date keep it on; anyone can switch it under *Settings › Notifications*.
- **Quick add** in plain language ("2 l milk, bread, 6 eggs"). The paste button takes a whole copied list.
- **Store mode**: grouped by aisle, the walking order is learned per store, a basket, then "done shopping" books everything in. Works offline and replays when back online. *Shopping › In the store (Einkauf › Im Laden)*
- **"I'll get it"** claims so two people don't buy the same thing.
- **Discreet and private items**: before adding, open *Who sees it? (Wer sieht es?)* and pick *Discreet (Diskret)* (others see a placeholder like "Drugstore item") or *Only me (Nur ich)* (others see nothing; you can share it with chosen members). Tap an item to change it later. The real name never reaches Home Assistant, Telegram, displays, tickets, guest links or MCP.
- **Print or send the list** as a ticket. *Shopping › ticket button*
- **Home Assistant to-do sync** (simple one-list sync). *Settings › Access & AI (Zugänge & KI)*. The two-way sync with any HA to-do list is under *Settings › Home Assistant*.

## Purchase rhythm

ToHuus merkt sich, was fehlt – without anyone keeping stock. From receipts (by the purchase date on the receipt, also while they still wait in review) and ticks on the list (also cleared ones), it learns how often each product is bought: mean interval, spread, confidence (≥3 purchases low, ≥5 medium, ≥8 high). Holiday gaps are left out.

- **Due now** shows as a suggestion with its origin ("alle ~5 Tage · zuletzt Mittwoch") on *Today* and in the assistant. *Yes* puts it on the list (row origin "merkt sich: alle ~5 Tage"), *Not now* keeps it quiet for half a rhythm; dismissed twice, it stays quiet until it is bought again. Nothing goes on the list by itself.
- Stock only counts where somebody keeps it up to date (a consumption booked in the last 30 days): then a well-stocked product is not suggested.
- Discreet and private products never appear.
- API: `GET /api/rhythm`, `POST /api/rhythm/:productId/accept`, `POST /api/rhythm/:productId/dismiss`. MCP: `purchase_rhythm`. Code: `server/lib/rhythm.ts`.

## Today aggregate

`GET /api/today` gives the *Today (Heute)* screen everything in one call: greeting, what is due by rhythm, the list with recent changes and their origin, "Das habt ihr noch" (eat soon, leftovers, bought recently), what to cook today (plan first, else from what is at home), money this week and month, notices. Shape: [api-today.md](api-today.md).

## Assistant

The floating button on every tab: type or speak ("Milch ist alle, und wir brauchen was für Sonntag"). With an AI key it talks and uses tools (list, stock, rhythm, cook ideas, week plan, money, remember/forget, log a purchase); without one it still understands the common short sentences. Every write is reported with an undo. Conversations are private per person and deleted after 30 days. *ToHuus merkt sich* household facts on request (`GET/DELETE /api/memory`). Details: [assistant.md](assistant.md).

Health data (allergies, children's birth years) goes to an AI – the built-in assistant or an MCP client – only when an admin allows it: *Settings › Access & AI* (`ai.healthShare`, default off). Without it, unsuitable dishes are still filtered on the server, without saying why.

## Sharing into the app

- **Share target** (Android, desktop): install the web app, then share text, links, photos or PDFs from any app. A landing page asks where it should go: shopping list, recipe import or receipt import. WhatsApp and Signal message prefixes are stripped. *Share (Teilen)*, opened from the share menu.
- **iPhone and iPad**: iOS does not offer the share menu to web apps. Create a personal key and a Shortcut that posts text to `/api/share/text`. The key can only add to the shopping list. *Settings › My account › Share into ToHuus Hub from other apps (Einstellungen › Mein Konto › Aus anderen Apps an ToHuus Hub teilen)*
- **Telegram**: send text to the household bot and it lands on the list; photos and PDFs become imports. See [notifications.md](notifications.md).

## Stock

- **Stock list** with search, filters by place and status, +/- in the list, best-before per batch, consumption in first-expiry-first-out order, move between places, history and weekly use. *Stock (Bestand)*
- **Tracking modes per product**: counted, fill level (full, half, low, empty) or not counted.
- **Only what runs out**: the household tracks only products marked "runs out regularly". Pick the staples once; switch to tracking everything at any time without losing data. *Settings › Household › What should be tracked? (Einstellungen › Haushalt › Was soll verfolgt werden?)*. Per product: the "runs out" row on the product page.
- **Opened, frozen, thawed** with their own shelf life; **best-before versus use-by** per product. *Stock › a product*
- **Quick check** of one place: one tap per item for right, less, empty, gone. *Quick stock check (Schnell-Abgleich)*
- **Waste card**: what was thrown away this month and its estimated value. *Stock*
- **Barcodes** via the phone camera; name and photo from Open Food Facts. *Today › + › Scan*
- **Places and categories** of your home, with optional photos of places for kids and sitters. *Settings › Places & categories (Einstellungen › Orte & Kategorien)*

## Where is what

- An exact spot per item ("left shelf, top compartment") and a short direction per room. *Stock › a product*
- Search across stock and things you never count (thermometer, fuse box, toolbox). *Where's what? (Wo ist was?)*
- Share it read-only with a babysitter: see [Guests](#treats-guests-and-party).

## Leftovers and freezer labels

- **Put away** leftovers or portions in two taps: name, date, eat-by and who made it are filled in. Each box gets a short code. *Today › Put away (Einräumen)*, the week plan entry, a recipe after cooking, or a product page.
- **Labels** with a QR code: A4 sticker sheets (3×8, 3×7, 2×7, with "skip the first n stickers"), a thermal label printer, or a PNG to share. Places are fridge or freezer compartment (Gefrierfach). *QR labels › Leftovers & frozen (QR-Etiketten › Reste & Eingefrorenes)*
- **Scan a box** with the phone camera: eat, thaw, throw away, plan for a day, undo. Every action books the matching stock change.
- **From the freezer, soon** on the cooking screen. *Cook (Kochen)*
- **QR labels for shelves, products and care tasks** open a one-tap action. The code is only a random id; only signed-in members can use it. *QR labels (QR-Etiketten)*

## Cooking

- **What do we eat today?**: planned today, ready now (with the house version), one thing missing (one tap to the list, or "take X instead"), leftovers first, quick dishes, filters (Thermomix, time, vegetarian, nothing to buy), and a button that picks for you. *Cook › What do we eat today? (Kochen › Was essen wir heute?)*
- **Browse ideas** as a swipe deck. *Cook › Browse ideas (Kochen › Ideen durchblättern)*
- **Recipe collection** with search and favourites. *Cook › Recipe collection (Kochen › Rezeptsammlung)*
- **Search by ingredients**: type "mit: Hähnchen, Paprika" (or "with: chicken") in the recipe search – recipes using all of them first, then the most matches; plurals and a few everyday synonyms (Hähnchen/Hühnchen/Huhn, Hack/Hackfleisch …) count. Works on the recipe text only, nothing needs to be in stock. `GET /api/recipes/search?with=Hähnchen,Paprika` → `[{ id, matched: string[], missing: string[] }]`.
- **Recipe → shopping list keeps the line**: each row gets the ingredient line as note – "für Curry: 2 Hähnchenbrustfilets". A second recipe that needs the same thing adds its line ("… · für Wraps: 300 g Hähnchenbrustfilets"); amounts are merged only when that is safe (all pieces of the same thing → the row's count, all weights → "zusammen 800 g", all volumes, or the same kitchen unit → "zusammen 3 Dosen"); "2 Stück + 300 g" stays as two lines. A row somebody typed keeps their note and count. Same rules for the recipe page, cook ideas, the week plan and the assistant (`server/lib/recipe-list.ts`). `POST /api/recipes/:id/shopping` takes `{ servings?, only?: string[] }` and answers `{ added, missing, ids }`; the lines are kept in the row's `origin_detail.lines`.
- **Cook mode**: *Start cooking (Kochen starten)* on the recipe page – one step at a time in large type, the screen stays on, appliance settings as chips. The household's note from the house version ("So machen wir das") is the first thing shown.
- **Recipe page**: ingredients matched against stock, missing ones to the list, appliance steps (Thermomix or any other device) with device, time, temperature, speed and mode, cooking log, "used up" after cooking, leftovers after cooking, print a recipe card. *Cook › a recipe*
- **Servings**: change the servings on the recipe page – with − / + or by typing the number directly; when opened from a plan entry, the entry keeps its own number and the week's shopping and the stock booking scale with it.
- **House version** ("our way"): change ingredients for your household without touching the original; "different today" for one-off changes. Swap rules apply to all recipes (or to some recipes or tags). *Recipe page*, and *Cook › How we cook (Kochen › So kochen wir)*
- **Ratings** per person (1 to 5) on the recipe page, and one tap per person at the table after cooking ("How was it?"). Parents rate for the children. **Likes, dislikes and allergies** per person under *Settings › Members › Our household*. Suggestions use them gently; a dish with an allergen gets a warning and is never auto-planned.
- **Favourites** for the family or one person. *Favourites (Lieblinge)*
- **Add a recipe** from a link, photos, text or blank. *Cook › + Recipe (Kochen › + Rezept)*
- **Bulk import and export**, other apps, TheMealDB, AI template: *Settings › Recipes (Einstellungen › Rezepte)*. See [recipes-import.md](recipes-import.md).

## Week plan

- **Plan** a recipe or a free entry for lunch or dinner, move entries, fill empty evenings from stock, put all missing ingredients of the week on the list, print the week as a ticket. Cooking a planned dish ticks it off. *Cook › Meal plan (Kochen › Wochenplan)*
- **Who cooks?**: claim an entry.
- **Day marks**: *Away (vacation)* and *Eating out (Auswärts)*. Autofill and rotation skip marked days.
- **Rotation**: save a week as a template ("Autumn A"), rotate through 1 to 6 templates. Applying never overwrites a filled slot, a marked day or a past day, and swaps a dish you had within the last days for a fitting suggestion. *Cook › Meal plan › Rotation (Kochen › Wochenplan › Rotation)*
- **Family votes**: pick candidates, everyone says no, yes or super. Secret mode: everyone on their own phone, results hidden until all have voted. Together mode: one phone goes round (kids without a login vote here). The winner goes into the plan. *Cook › Who wants what? (Kochen › Wer will was essen?)*, or *Can't decide? Let everyone vote* on a plan day.
- **Cookidoo week**: with the Home Assistant Cookidoo integration, planned Thermomix dishes arrive in the plan by themselves. See [home-assistant.md](home-assistant.md#cookidoo).

## Imports and receipts

- **Import** a PDF, a photo, a QR/link to a digital receipt, or pasted text. Everything waits in a review: substitutions, refused items, new products, target place. *Imports (Importe)*
- **Import without asking**: book receipts straight in when every line was recognised with confidence. *Settings › Data & backups (Einstellungen › Daten & Sicherung)*
- **Receipt inbox** (IMAP), polled every 10 minutes. *Settings › Access & AI › Receipts by e-mail (Bons per E-Mail)*
- **Purchase history CSV** (for example a REWE data export) builds the product catalogue and receipt aliases. *Settings › Data & backups*
- **Learning from corrections**: correct a product, quantity, unit or store in the review and a rule is saved for that store. *Imports › Receipt recognition (Importe › Bon-Erkennung)* shows how many lines were recognised without correction and lists the learned rules, which can be deleted.
- **Help improve recognition (Erkennung verbessern helfen)**: in an import, build an anonymised copy of the receipt to download, or open a prefilled issue or e-mail. Nothing is sent automatically.
- Supported stores and formats: [receipts.md](receipts.md).

## Spending

- **Money overview** for the *Geld* tab: `GET /api/money/overview?month=YYYY-MM` → total, budget, by category, shop and week, compared with last month (also "up to the same day"), price changes against the 90 days before (with the price per kg or litre where the pack size or a weighed line allows it), and calm saving hints from the household's own data only (cheaper at another shop in the last 3 months, thrown away more than once this month, bought every few days – two at once saves trips, budget forecast). No offers from outside, no affiliate links. Code: `server/lib/money.ts`.
- Charts per week, month, year and all time; by category and store; top items; price history per product and "got more expensive" hints. *Spending (Ausgaben)*
- **Budgets** per month or week, overall or per category, with a calm forecast and an optional warning notification. *Spending › Budgets*
- **Manual expenses** (farmers' market, bakery cash), **tags**, **leave out** a line, receipt, product, category or store. CSV export.

## Home care

- Recurring tasks (water filter, smoke detectors, descaling, tyres, passport) from templates, linked to stock (filter cartridges go on the list), "I'll take care of it", done with one tap, undo, a ticket for the printer. No points, no ranking. *Home & care (Haus & Pflege)*

## Trips

*Trip / away (Urlaub / unterwegs)*, also linked from *Settings › Household*.

- **Plan a trip**: name, where, dates, who travels, who stays.
- **Before**: *Use up first (Zuerst aufbrauchen)* with recipes for it, a short generated checklist (*Before you leave / Vor der Abfahrt*), a *Packing list (Packliste)* with reusable templates; items from stock are booked out and back.
- **During**: notifications stay quiet, automatic shopping suggestions pause, the home week plan skips days nobody is home, an optional *Holiday kitchen (Ferienküche)* with its own meals and shopping list.
- **House-sitter link (Haushüten)**: like the babysitter link, plus notes on plants, post and bin days. It ends the day after you are back.
- **After**: a *Welcome-home list (Willkommen-Liste)* with the usual fresh things and a check of what expired while away; *What came back? (Was ist zurückgekommen?)* for packed stock items.
- With Home Assistant: "everyone away for more than 24 hours" suggests a trip (it never starts one by itself).

## Treats, guests and party

Treats (DE „Verwöhnen“) is about doing each other a good turn. One page, three modes: *For me* (everyday, the default for couples, families and flat shares), *Guests* and *Party*. A household that lives alone only sees Guests and Party.

- **Ask for a little something**: someone stuck with bedtime, a sick partner, someone working late asks for "vanilla ice cream, please" or "tea with honey" from the sofa or from bed. Big tiles: something sweet, something to drink, something to nibble, from the fridge (only from real stock in a place of kind fridge), everything that's here, or a free wish. A note ("How would you like it?") and an optional "Who brings it?" (one person or whoever can). *Treats › For me (Verwöhnen › Für mich)*
- **One-tap answers**: the others get a push (or Telegram message) with "I'll bring it" / "Can't right now"; declining can carry a short reason ("In a few minutes", "It's all gone", "I'm not home", "My hands are full"). Chosen person: only their phone rings. The asker sees warm status lines: "Coming right up – Lea is bringing it", "Brought by Lea", "Not right now – in a few minutes". *Treats › For me › For you (Für dich)*
- **A private thanks**: once it's there, the asker can say thanks; it reaches only the bringer. No points, no ranking, no list of who brought what.
- **Order menu editor**: groups, items from stock (marked "out" when empty) and menu-only items (tap water, cappuccino) with up to three ingredients from stock that are booked out per serving; templates and suggestions. *Treats › Edit menu (Verwöhnen › Karte bearbeiten)*, or *Settings › Household › Treats & guests (Verwöhnen & Gäste)*
- **Board**: everything that comes in from home, guests and the party – accept, in progress, brought/served, can't right now; stock is booked out when served. *Guests & party (Gäste & Party)*
- **Guest links**: a link or QR code that works without an account. Presets for visitors, the babysitter and grandparents. Each link opens one or more of: asking for something from the menu, read-only "where is what" for chosen places with a note, adding to the shopping list. Optional expiry, revoke any time. *Treats › Guests (Verwöhnen › Gäste)*
- **Babysitter link**: a guest link with "where is what", a note (emergency numbers, bedtime) and, if switched on, a voice command guide (see [home-assistant.md](home-assistant.md#voice-commands-on-the-babysitter-page)).
- **Party mode**: start in two taps, a party menu with per-guest limits, a TV board with a join QR and a kitchen view (new, in progress, ready), soft reservation of the last bottle, automatic end, a recap that puts what ran out on the list, templates. *Treats › Party (Verwöhnen › Party)*
- **Kitchen tickets**: new orders can print on a kitchen printer automatically; a wish from home prints as a "Please bring" slip with who it is for. *Settings › Printers & tickets*

## Family and people

- **Our household (Unser Haushalt)**: members, children and permanent guests in one list. Tap a person for picture, likes, dislikes, allergies and (for guests) what they can see. *Settings › Members (Einstellungen › Mitglieder)*
- **Profile pictures**: a photo, one of eight drawn animals, or colour and initials. Own picture: *Settings › My account*.
- **Invite** members by link; they choose their own password. Admins can hand a person a one-time login link.
- **Permanent guests (Feste Gäste)** with levels and temporary overrides: [guests-and-permissions.md](guests-and-permissions.md).
- **Kid mode**: kid profiles with an animal, a paired kid tablet with big pictures of what a child may wish for, whitelists, daily limits, quiet hours, read-aloud, "where is …?" with place photos. Every wish waits for a parent; approved wishes go to the order board. No points, no stars. *Settings › Members › Kids (Einstellungen › Mitglieder › Kinder)*

## Displays and printers

- **Kitchen and wall displays**: read-only link per display with layout, widgets and night hours; works on old tablets; a PNG for e-ink frames and Home Assistant image entities. Shows only what its widgets list. *Settings › Displays*
- **Printers and tickets ("Bons")**: ESC/POS printers over the network; tickets for the shopping list, kitchen orders, care tasks, kid wishes, recipe cards, the week plan and fridge notes; send a ticket as a picture to Telegram or Matrix, as text to Gotify, or by e-mail; automations with quiet hours. *Settings › Printers & tickets (Einstellungen › Drucker & Bons)*

## Notifications

- Web Push per device, Telegram, Gotify, Matrix, ntfy, e-mail, a Home Assistant webhook, any webhook, a daily digest; a matrix per event. *Settings › Notifications (Einstellungen › Benachrichtigungen)*. Details: [notifications.md](notifications.md).

## Home Assistant

- Integration token: *Settings › Access & AI › New access › Home Assistant*.
- Two-way topics (shopping list, meal plan, care tasks, presence, notifications, NFC tags) and the voice command guide: *Settings › Home Assistant*.
- Cookidoo without the integration: *Settings › Access & AI*, Home Assistant address and token.
- Reference: [home-assistant.md](home-assistant.md).

## AI assistants (MCP)

- Create an access: *Settings › Access & AI › New access › AI assistant (Zugänge & KI › Neuer Zugang › KI-Assistent)*. Tool list: [mcp.md](mcp.md).

## Appearance, language and region

- **Household look**: light, dark or like the device, and whether members may choose their own. *Settings › Household › Appearance (Einstellungen › Haushalt › Darstellung)*. Personal choice: *Settings › My account › Appearance*.
- **Brand**: ToHuus Hub or Fredirando. `BRAND` in the environment sets the default; an admin's explicit choice in *Settings › Household › Brand (Marke)* wins over it (stored as `brand.choice`; choosing the default again removes it).
- **Language**: English, Deutsch. *Settings › Household › Language (Sprache)*
- **Region**: currency, number and date format, units shown in recipes, first day of the week, Open Food Facts country, store presets. *Settings › Household › Region*

## Sign-in and account

- Password, two-step code, e-mail link, passkeys, single sign-on, PIN switch on a shared device, signed-in devices, new-device alerts. Own methods: *Settings › My account (Mein Konto)*. Policy and SSO: *Settings › Members › Ways to sign in (Anmeldewege)*. Details: [auth.md](auth.md).

## Data, demo and tour

- **Backups**, restore, WebDAV off-site copy, JSON export: *Settings › Data & backups (Einstellungen › Daten & Sicherung)*.
- **Demo data**: load or remove, and **Start over (Neu anfangen)** for chosen areas: same tab.
- **Tour**: *Settings › Take the tour (Tour starten)* or *Help (Hilfe)*.
- **What's new** after an update, and short how-tos: *Help (Hilfe)*.
- Details: [data-and-reset.md](data-and-reset.md).
