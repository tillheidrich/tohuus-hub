# ToHuus UX benchmark and information architecture (14 Oct 2026)

Owner: UX/UI research. Audience: everyone building the web app and the native iOS app.
Goal: ToHuus at least on the level of the best household apps, and easier to find your way in, although it does far more.

**Sources** (all static reverse engineering, no screenshots, no runtime tests):
- Uploaded analyses (14 Oct): `00_Uebersicht.md`, `Lilara.md`, `Meal-planner.md`, `pon.md`, `That-Shopping-List.md`. **There is no `Tiimo.md` in the upload.** Tiimo patterns below come only from the overview and are marked *(overview only)*.
- Outline: "Wettbewerb 14.10.2026: FamilyManager, FairShare, Lilara – und Konzept ‚Zu tun‘ für ToHuus" (id 6f2c9718…).
- Outline "Shop-Design (Claude Design, Stand 01.10.2026)" is the **PMPNZNG/TGA merch shop**, not ToHuus. Only three general points carry over: a fixed main action at the bottom on phones, motion off under "reduce motion", no dashes in running text.
- `docs/design/2026-10-11-dutch-detail-system.md` (incl. the 12 Oct addendum on five tabs), `docs/tasks.md`, `docs/ios-parity-2026-10-13.md`, `docs/guests-and-permissions.md`.
- Code: `web/src/nav.tsx`, `web/src/App.tsx`, `web/src/pages/*`, `ios/ToHuus/App/MainTabView.swift`, `Features/Household/HouseholdLinks.swift`, `Features/Settings/SettingsView.swift`, `Features/Today/TodayView.swift`, `Features/Shopping/ShoppingView.swift`.

Effort scale: **S** ≤ 1 day, **M** 2–5 days, **L** > 1 week (per platform unless noted). **P1** = biggest difference, do first.

---

## 0. What is wrong today (short diagnosis)

1. **Aufgaben is buried.** The new strategic area (tasks, mental load, 14 Oct) sits in Mehr › Rund ums Zuhause, 3 taps away on iPhone (Heute › avatar › Aufgaben). Lilara, FamilyManager and Tiimo put their core object in a tab.
2. **Mehr is only reachable from Heute on iPhone.** `MainTabView` has no Mehr tab; the avatar sits only in `TodayView`. From Einkauf you need two taps to even see Mehr.
3. **Settings has 12 horizontal tabs** on the web (`Settings.tsx`: plan, home, account, members, places, notify, access, ha, displays, print, recipes, data) that scroll sideways on phones. On iOS the rest hides behind "Weitere Einstellungen in der Web-App". Both bury things 3–4 taps deep.
4. **Things live in the wrong place.** Receipts (`/import`) and spending (`/ausgaben`) are in Mehr though they *are* Geld. Favourites (`/lieblinge`) are in Mehr though they *are* Kochen. Wishes are in Mehr and in Einkauf.
5. **No global search.** The sidebar search "Wo finde ich …?" only finds products and places (`/wo`). Recipes, tasks, settings and functions cannot be searched.
6. **"+" is receipt/stock-centric.** The web `AddSheet` offers 7 tiles (receipt, photo, text, barcode, digital receipt, product, leftovers) but not "task" or "list item". On iOS the add request just jumps to Einkauf.
7. **Overflow menus are long.** The iOS Einkauf "…" menu has 10 entries (receipt, paper list, usuals, recently done, offers, wishes, paste, share, shops & aisles …). pon and That Shopping List keep the list screen to one input and very few actions.
8. **Words drift.** Route `/bestand`, label "Vorrat"; "Pflege & Fristen" vs "Aufgaben"; "Wahrscheinlich fällig" (iOS) vs "Fällig" (web); "Bring mir was" vs route `bestellen`.

---

## 1. Competitor patterns

Evidence refs point into the analyses (string keys, FAQ ids, file names).

### pon (learning shopping list, iOS-native, free)
Good:
1. **Learn instead of configure.** No setup ("Du musst nichts vorab anlegen", FAQ `nichts-einrichten`); order per store learned from ticking (FAQ `wie-lernt-sortierung`); rhythm hints "Psst, %1$@ ist heute dran! Normalerweise alle %2$@." (`INSIGHT_DUE_NOW_*`).
2. **Add with memory.** Bottom search bar = input, "+" opens tabs Alle/Häufig/Letzte Einkäufe/Zuletzt/Vorrat/Vorschläge (`PRODUCT_SEARCH_TAG_*`), multi-select "Hinzufügen (n)", dictation turned into chips and reviewed before adding (`DICTATION_*`, `REVIEW_STAGING_HINT`).
3. **Checked stays visible, then "Aufräumen".** Struck-through rows plus a blue clean-up pill, shake as alternative (FAQ `abhaken`). Tap and right swipe both check; full left swipe = **edit**, not delete (FAQ `menge-aendern`).
4. **Plan vs. shop mode.** Planning groups by store; in the store the current store jumps up (FAQ `wo-kaufen`); without location it asks "Einkauf bei %@ starten?" (`TRIP_PROMPT_*`).
5. **"X kauft gerade ein"** as card, push, widget and Live Activity with remaining time (`LIVE_ACTIVITY_USER_IS_SHOPPING*`). This is the moment others add "one more thing" without a chat.
6. **Apple entry points everywhere.** Parameterised App Intents (`AddItemsIntent` with quantity/list/store, `ShowListIntent` reads the list aloud), Control Center controls, Action Button, Home Screen quick actions, Spotlight action (`03_appintents.txt`, `UIApplicationShortcutItems`). Permissions asked in context, each with Ask/Consequence/Denied copy (`PERMISSION_LOCATION_*`).

Avoid: feature sprawl that needs a "Minimal" mode and 540 lines of FAQ (Marktplan, stats builder, badges, loyalty cards); streak badges ("Blitzeinkäufer"); pushes to *all* members (`SHELFLIFE_REMINDER_FOOTER`); members that can't be removed (`INVITE_REMOVE_MEMBERS`); missionary warnings ("Beliebig" discouraged).

### That Shopping List (list + recipes, Cordova)
Good:
1. **Search field = input, focus stays.** First row is the parsed new entry with detected category, then up to 8 ranked suggestions (exact 1000 / prefix 800 / contains 600 + usage priority, `getCatalogItems()`); after adding the field stays focused for series entry (`options.focus`).
2. **History with sliding priority** (+1 per day used, slowly decays; `addFavourite()`), shown as "Verlauf" sorted by priority.
3. **"Zuletzt abgehakt" area** under the list (max 30) with ⊕ to bring back and "alle wieder hinzufügen" (`pickedItems`, `#picked-menu`).
4. **Duplicate dialog** "Schon auf der Liste, ersetzen durch …" with summed quantities (`fixDuplicateSheet`).
5. **Three hit zones per row**: left = select, middle = edit sheet, right = check. Multi-select bar for move/share/copy/delete.
6. **Shopping mode keeps the screen awake**, optional lock against stray taps (`keepAwake()`, `lock_screen_feature`).

Avoid: ads and tracking SDKs taking the thumb zone; review gating (5 stars → store); the item **name as key** (no two "Wäsche"); full-access invite links without roles.

### Lilara (shared meal planner)
Good:
1. **Profiles are not accounts.** Kids and partners exist as coloured profiles; an invite can claim a profile (`createJoinLink(profileId)` → `profileClaimed`).
2. **Open responsibility counted kindly.** "{{count}} Mahlzeiten brauchen noch eine Person am Herd." (`meal_assign_cook_nudge`); "Needs attention" for today and tomorrow on Home and in the widget (`NeedsAttentionCard`).
3. **Fairness in plain words.** "Diese Woche teilen sich {{count}} Personen das Kochen." / "{{name}} ist {{assigned}} von {{total}} Mahlzeiten zugewiesen." (`CookingBalanceCard`).
4. **Household type drives copy and defaults** (solo/couple/family/other with own hints and default names, `onboarding_step_household_type_*`).
5. **Post-onboarding checklist** "Keep planning" with 7 steps and a hide confirmation (`keep_planning_item_*`); push soft-ask with a reason before the iOS dialog (`notifications_soft_ask_*`).
6. **Empty states say what will appear** ("Add meals for a few days and Lilara will show your weekly progress, cooking balance and meal variety.").

Avoid: hard monthly caps on core use (14 planned days/month); editing only online; two concepts (profiles vs. members) that need their own help pages; session replay tracking.

### Meal planner (YouMealPlan)
Good:
1. **Reminders relative to the plan**: "am Vortag", "am Kochtag", offset (`reminder_day_before`, `reminder_cooks_on`, `recipe_alarm_offset`). For ToHuus: "Hähnchen auftauen" the evening before.
2. **Honest three-state sync banner**: offline → syncing → synced (`offline_banner_offline|syncing|synced`).
3. **Permission priming screen** with the "won't ring" warning state (`reminders_activation_page`, `reminders_wont_ring_permission`).
4. **Week intro card** with progress on top of the plan, day cards with small badges (`_buildWeekIntroCard`, `day_alarm_badge_`).
5. **Cook mode keeps the screen awake** (`cook_mode`, `wakelock_plus`); "Zuletzt gekauft" to re-add (`recent_list`).
6. **Every empty state = title + subtitle + one CTA + illustration** (`_buildEmptyContent`, mascots).

Avoid: lifestyle sprawl (calories, water, weight, fasting); paywall on basic order (`shopping_categories_paywall_feature`); its own reminder engine that rings twice next to Apple Reminders; placeholder permission text ("your usage description here").

### Tiimo *(overview only, no detail file supplied)*
Good:
1. **Time types**: with time, all-day, part of day (morning/afternoon/evening), "sometime this week", no date. Chores rarely have a clock time.
2. **Review instead of an overdue list**: first acknowledge what was done, then "Was möchtest du verschieben?" with "Auf morgen (n)" and undo.
3. **Starter areas** (Cleaning, Home, Money, Admin) as templates.
4. **Stats can be hidden** ("Pass auf dich auf 💚"), no pressure.
5. **Apple schemas for Siri** (`reminders.CreateReminderIntent`, `calendar.CreateEventIntent`), widget, watch, Live Activity.

Avoid: chat as the main surface (Co-Planner); online-only; weak German translation (ToHuus can win on copy).

### FamilyManager (German family planner, wiki)
Good:
1. **Rooms with recurring cleaning tasks**, sub-tasks, "Doppeltippen zum Erledigen".
2. **Daily progress ring on "Heute"** and a customisable dashboard.
3. **Short weekly check-in** ("Fünf Minuten, gemeinsam. Wer ist da, was steht an, wer macht was.").
4. **Two-way Apple Reminders/Calendar sync** with clear error texts; calendar sharing level "nur belegt".

Avoid: credits, media minutes, XP leaderboard, family streak, parent approval of kids' tasks; calendar, kid logbook, document safe, password vault (everything ToHuus says no to).

### FairShare (couples, Fair Play, wiki)
Good:
1. **Invisible work made visible with numbers**: noticing and planning vs. doing ("Bei der unsichtbaren Arbeit … trage ich %lld %").
2. **Estimate first, then compare** ("Wie viel der gemeinsamen Last trägst du, was denkst du?"), estimate stays private.
3. **Brain dump**: speak or type, the app sorts it into cards.
4. **"Danke sagen"** as the only social gesture.

Avoid: everything is manual upkeep (assign cards, do check-ins); built for couples and told around conflict.

### Where ToHuus already leads
Shared live list with claims ("Ich hol's"), store mode with aisles and offline, receipts that fill stock and money, "Wer hat was im Blick" computed from real data without extra upkeep (`Blick.tsx`), two-way CalDAV for lists and tasks, privacy inside the household, guest levels and links, Hausinfo, Urlaub/Übergabe, kid tablet, Home Assistant, MCP. **The task is not more features. It is order, speed and tone.**

---

## 2. Information architecture (iOS and web, same structure)

### 2.1 Tab bar: 5 tabs + assistant

**Recommendation (decision for Till):**

| # | Tab | SF Symbol / Phosphor | Holds | Badge |
|---|---|---|---|---|
| 1 | **Heute** | `sun.max` / House | today's priorities from all areas | – |
| 2 | **Einkauf** | `cart` / Basket | list(s), store mode, wishes, usuals | open items |
| 3 | **Kochen** | `fork.knife` / ChefHat | ideas, week plan, recipes, favourites, votes | – |
| 4 | **Zuhause** *(new)* | `house` / HouseLine | **Aufgaben · Vorrat** (segment), doors to Wo ist was, Hausinfo, Urlaub | due tasks + "bald verbrauchen" |
| 5 | **Geld** | `eurosign.circle` / Coins | overview, **Bons** (receipts & imports), spending detail, budgets, money lists | receipts waiting for a look |
| + | **Assistent** | round sparkle button, bottom right above the tab bar (exists, `AssistantButton`) | ask, say, type; microphone inside dictates | – |

**Mehr** is the avatar at the top right of **every** root screen (Apple pattern: App Store, Music, Fitness), not only on Heute. iPad/desktop sidebar: the five areas, then "Mehr" groups.

Why this cut:
- Aufgaben and Vorrat are both "things at home that need attention" (Pflege & Fristen already links tasks to products). One tab "Zuhause" with a segment keeps both one tap away and frees a slot without dropping Geld, one of the three product pillars (CLAUDE.md).
- Receipts move into Geld: they are where the money numbers come from. Favourites move into Kochen. Wishes stay only in Einkauf.
- Switched-off areas ("Was nutzt ihr?") still remove their tab or segment: stock off → Zuhause shows only Aufgaben; cook off → no Kochen tab; money off → no Geld tab, Bons go to Mehr. Einkauf, Heute and Zuhause (Aufgaben) are always there.

Alternatives considered:
- **B: Heute · Einkauf · Vorrat · Kochen · Aufgaben**, Geld into Mehr. Simpler mapping, but hides a pillar and receipts get no home. Not recommended.
- **C: four areas + "Mehr" as a tab** (classic iOS). Costs a tab for rarely used things. Not recommended while the avatar pattern works on every root screen.

Zuhause screen layout: large title "Zuhause", segment **Aufgaben | Vorrat** (remembers the last choice), above the content one row of three small "door" chips: **Wo ist was? · Hausinfo · Urlaub**. So every Zuhause function is ≤ 2 taps.

### 2.2 Complete function map

Every web route and every settings tab, mapped. "(new)" = native screen still to build (today a `WebPageView` or missing). Depth = taps from any root screen.

**Heute**

| Web function | Place | Native screen | Depth |
|---|---|---|---|
| Heute cards: Fällig (rhythm), Aufgaben heute + ring, Liste, Das habt ihr noch, Heute kochen?, Geld, Pulse question, notices, demo nudge (`/`) | Heute | `TodayView` (+ `TasksTodayCard`) | 0 |
| Arrange cards | Heute › "Karten anordnen" | `TodayView` edit mode (new) | 1 |
| Party / Urlaub / Kinderwunsch banners | Heute top | `TodayView` banners (new) | 0 |
| Getting-started checklist (`ChecklistCard`) | Heute top until hidden | `StartChecklistCard` (new) | 0 |

**Einkauf**

| Web function | Place | Native screen | Depth |
|---|---|---|---|
| Shopping list, add, claims, share text in, quick add (`/einkauf`) | Einkauf | `ShoppingView` | 0 |
| Store mode, aisle order, another store, checkout | Einkauf › segment "Im Laden" | `ShoppingView` store mode, `StoreOrderView` | 1 |
| Several lists, list settings, private/discreet items, start mode "nur was ausgeht", staples | Einkauf › list title menu | `ShoppingView` list picker, `ListSettingsView` (new) | 1–2 |
| Suggestions, usuals, recently done | Einkauf › add field (focused) | `AddPanel` in `ShoppingView` (new layout) | 1 |
| Paste list, photo of paper list, dictation | Einkauf › add field buttons | `ShoppingView` | 1 |
| Offers per shop | Einkauf › "…" | `OffersView` | 2 |
| Wishes & Merkliste (`/einkauf/wuensche`, `/:id`) | Einkauf › gift icon in nav bar | `WishesView`, `WishListDetailView` | 1–2 |
| Shops & aisles | Einkauf › "…" | `StoreOrderView` | 2 |
| WG balance / personal rows, lunchbox regulars | Einkauf › list menu (form-dependent) | `ListSettingsView` (new) | 2 |
| Import from Bring!/AnyList/CSV | Einkauf › "…" › Importieren | `ListImportView` (new) | 2 |
| Bon of a trip (`Bons.tsx` ticket) | Einkauf › Erledigt › Teilen | share sheet | 2 |

**Kochen**

| Web function | Place | Native screen | Depth |
|---|---|---|---|
| Ideas "Was kochen wir?", swipe deck, Thermomix filter (`/kochen` ideas) | Kochen › Ideen | `CookingView` | 0 |
| Week plan, rotation templates, days away, servings, Cookidoo sync (`Week.tsx`, `Plan2.tsx`) | Kochen › Woche | `CookingView` week (+ `PlanTemplatesView` new) | 1 |
| Family food vote (`/abstimmung/:id`) | Kochen › Woche › Abstimmung | `VoteDetailView` | 2 |
| Recipes, search incl. "mit: …" (`/kochen` recipes) | Kochen › Rezepte | `CookingView` recipes | 1 |
| Favourites (`/lieblinge`, today in Mehr) | Kochen › Rezepte › filter "Lieblinge" | `CookingView` filter (new, replaces WebPageView) | 1 |
| Recipe detail, servings, house version, swap rules (`/rezepte/:id`) | Kochen › recipe | `RecipeDetailView` | 1–2 |
| Cook mode (`CookMode.tsx`) | recipe › "Kochen" | `CookModeView` (new on iPhone; iPad `KitchenModeView`) | 2 |
| Recipe import: link, photo, text, blank, Cookidoo, recipe package, open DB, file (`RecipeImports.tsx`, `RecipePackage.tsx`, `CookidooSheet.tsx`) | Kochen › "+" | `RecipeAddSheet` (new, merges), `RecipePackageView`, `CookidooConfirmView` | 1 |
| Recipe photos status, import centre settings (Settings › recipes) | Mehr › Einstellungen › Rezepte | `RecipeSettingsView` (new) | 2 |

**Zuhause**

| Web function | Place | Native screen | Depth |
|---|---|---|---|
| Aufgaben: all/household/care & deadlines/mine, due, later, add in one tap, recently done (`/aufgaben`, `/pflege`) | Zuhause › Aufgaben | `CareView` → rename `TasksView` | 0–1 |
| Task detail, rhythm, rotation, checklist, appointment, "In den Kalender" | Zuhause › task | `TaskDetailView`, `AddToCalendarView` | 1–2 |
| Wer hat was im Blick (`Blick.tsx`) | Zuhause › Aufgaben › "Im Blick" | `BlickSection` | 1 |
| Vorrat list, filters, group by place/category (`/bestand`) | Zuhause › Vorrat | `PantryView` | 0–1 |
| Product detail, history, labels, order-menu toggle (`/bestand/:id`) | Zuhause › Vorrat › product | `ProductDetailView` | 2 |
| Quick check (`/abgleich`, `/abgleich/:id`) | Zuhause › Vorrat › "Abgleich" button | `QuickCheckView` / `CheckStackView` | 2 |
| Leftovers & freezer boxes (`Leftovers.tsx`) | Zuhause › Vorrat › "Boxen" filter; "+" › Reste | `BoxesView` (new) | 1–2 |
| Barcode scan (`/scan`) | "+" › Scannen; Vorrat nav bar | native scanner | 1 |
| QR label action (`/q/:code`) | deep link after scanning | `QuickActionView` (new) | – |
| Wo ist was? (`/wo`) | Zuhause › door chip; also global search | `FindView` | 1 |
| Hausinfo (`/hausinfo`) | Zuhause › door chip | `HouseGuideView` | 1 |
| Urlaub / unterwegs incl. packing, holiday kitchen, Übergabe (`/urlaub`) | Zuhause › door chip | `AwayView`, `HandoverView` | 1–2 |
| Übergabe for permanent guests (`/uebergabe`) | guest Heute card + Mehr | `HandoverGuestView` | 1 |

**Geld**

| Web function | Place | Native screen | Depth |
|---|---|---|---|
| Month overview, budget, by category, by shop, weekly trend, prices (`/geld`) | Geld › Übersicht | `MoneyView` | 0 |
| Spending in detail, drill-down, receipts per line (`/ausgaben`) | Geld › "Im Detail" | `SpendView`, `SpendDrillView`, `SpendReceiptView` | 1–2 |
| Budgets, money lists, personal expenses | Geld › "…" | `BudgetsEditView`, `MoneyListView`, `ExpenseEditView` | 1–2 |
| Receipts & imports, review, quality (`/import`, `/import/:id`, `/import/quality`) | Geld › segment **Bons** | `ImportsListView`, `ImportReviewView`, `RecognitionView` (new) | 1–2 |
| Receipt e-mail address, inbox settings (`MailAddress.tsx`, `Retail.tsx`) | Geld › Bons › "Bons per Mail" | `ReceiptMailView` (new) | 2 |
| CSV purchase history import (Settings › data) | Geld › Bons › "…" › Kaufhistorie | `PurchaseHistoryImportView` (new) | 2 |
| WG balance | Geld › Übersicht card (form = shared flat) | `MoneyView` card (new) | 0 |

**Mehr** (avatar, every root screen; grouping in 2.3)

| Web function | Place | Native screen | Depth |
|---|---|---|---|
| My account: name, picture, e-mail, password, passkeys, 2FA, sessions, devices (Settings › account, `AuthSettings.tsx`) | Mehr › profile row | `AccountView` (new, merges SettingsView parts) | 1–2 |
| People, members, roles, removal, kid profiles, permanent guests (Settings › members, `KidsSettings.tsx`) | Mehr › Personen | `HouseholdView`, `PersonDetailView` | 1–2 |
| Invite someone (`Invites.tsx`) | Mehr › Personen › "Einladen" | `InvitesView` | 2 |
| Guests & party, order board, guest links, party mode (`/bar`, `Party.tsx`) | Mehr › Gäste & Party | `GuestsPartyView` (new), `GuestLinksView` | 1–2 |
| Bring mir was, menu editor (`/bestellen`, `/bestellen/karte`) | Mehr › Bring mir was | `TreatsView`, `MenuEditorView` (new) | 1–2 |
| What ToHuus remembers (`/merkt-sich`) | Mehr › Assistent & KI | `MemoryView` | 2 |
| Household: name, language, region, appearance, "Was nutzt ihr?", lunchbox, pulse, away entry, menu settings (Settings › home) | Mehr › Haushalt | `HouseholdSettingsView` (new) | 1–2 |
| Places & categories, household form (Settings › places) | Mehr › Orte & Kategorien | `PlacesSettingsView` (new) | 1 |
| Notifications: mine (matrix, quiet hours, lock screen), household routing, channels (Settings › notify, `NotifyMine.tsx`, `Channels.tsx`) | Mehr › Benachrichtigungen | `NotificationSettingsView` (+ household part new) | 1–2 |
| Store arrival hint | Mehr › Benachrichtigungen › Im Laden | `StoreArrivalView` | 2 |
| AI switches, assistant privacy, connected assistants/MCP tokens, OAuth (Settings › access, `AiSettings.tsx`) | Mehr › Assistent & KI | `AISettingsView` (+ `ConnectionsView` new) | 1–2 |
| Reminders & Calendar (CalDAV, calendar feed) (Settings › account, `CalendarFeedCard`) | Mehr › Erinnerungen & Kalender | `CalDavView` | 1 |
| List look (text size, density) | Mehr › Darstellung | `ListDisplaySettingsView` + `AppearancePicker` | 1 |
| Home Assistant (Settings › ha, `Ha2.tsx`, `HaIntegration.tsx`) | Mehr › Geräte › Home Assistant | `HomeAssistantView` (new; web page until then) | 2 |
| Displays & e-ink (Settings › displays) | Mehr › Geräte › Bildschirme | `WebPageView` (web-only on purpose is fine) | 2 |
| Printers & tickets (Settings › print, `Bons.tsx`) | Mehr › Geräte › Drucker & Bons | `WebPageView` | 2 |
| QR labels (`/etiketten`) | Mehr › Geräte › QR-Etiketten | `LabelsView` (new: share PDF) | 2 |
| Kid tablet pairing | Mehr › Personen › Kinder › Tablet koppeln | `KidTabletView` (new) | 2 |
| Plan & storage, billing (Settings › plan, `Billing.tsx`) | Mehr › Abo & Speicher | `SettingsView` plan section → `PlanView` | 1 |
| Data: backups, export, move in/out, sample data, start over, error log (Settings › data, `MoveSettings.tsx`, `Samples.tsx`, `Tour.tsx`) | Mehr › Daten & Sicherung | `DataSettingsView` (new), `ErrorLogView` | 1–2 |
| Help, How ToHuus works, Good to know, tour (`/hilfe`, `/so-funktioniert-tohuus`, `/gut-zu-wissen`) | Mehr › Hilfe | `HelpListView`, `HowItWorksView`, `FactsView`, `AppTourView` | 1–2 |
| Legal, version, feedback, sign out, delete account | Mehr › bottom | `SettingsView` | 1 |

**Outside the app shell** (public or device-bound, web only by design): guest link page `/g/:token`, invite `/einladung/:token` (iOS: universal link → `InviteAcceptView` new), auth landings `/anmelden/:kind`, party TV `/party`, kid tablet `/kids/:token`, share landing `/teilen` (iOS: share extension `ToHuusShare`), onboarding `/willkommen` (iOS: `StartView` + `OnboardingFlow` new), operator back office `/betrieb`.

### 2.3 Mehr and Settings: one list, two taps

Merge the web Settings tabs and the Mehr groups into **one Mehr screen** in the iOS Settings style. Each row opens its screen directly. No horizontal tabs, no "more settings in the web app" catch-all.

```
Mehr
 [Avatar  Mira Berg · Familie Berg            ›]   → Mein Konto
 [ Suche: "Einstellung oder Funktion finden" ]
 HAUSHALT
   Personen                     (members, kids, guests, invite)
   Gäste & Party                (order board, guest links, party)
   Bring mir was                (hidden when single household / module off)
 EINSTELLUNGEN
   Haushalt                     (name, language, region, look, Was nutzt ihr?)
   Orte & Kategorien
   Benachrichtigungen
   Erinnerungen & Kalender
   Assistent & KI               (AI on/off, privacy, Was ToHuus sich merkt, connections)
   Darstellung
   Abo & Speicher               (cloud only)
   Daten & Sicherung
 GERÄTE
   Home Assistant · Bildschirme · Drucker & Bons · QR-Etiketten
 HILFE
   Hilfe · So funktioniert ToHuus · Gut zu wissen · Tour · Feedback
 Rechtliches · Version · Abmelden · Konto löschen
```

Rules: max 4 groups plus the footer; max ~16 rows; rows for switched-off modules and guest-denied paths disappear (existing `moreGroups` filters). Rare admin-only rows (Bildschirme, Drucker) show only for admins.

### 2.4 Global search

One search for everything, same on web and iOS.

- **Where:** iOS: magnifier in the nav bar of every root screen (and pull-down on Heute) opens a full-screen search. Web: the sidebar field (today "Wo finde ich …?") and `/` or `⌘K` anywhere; on mobile web a magnifier in the page head.
- **What it finds**, grouped, best hit first: **Funktionen & Einstellungen** (static registry from `nav.tsx` + settings sections, with synonyms: "Passwort", "Etiketten drucken", "Gastlink", "Dunkelmodus"), **Vorrat** (product + place + status), **Liste** (open items, "steht auf der Liste"), **Rezepte** (title, "mit: …" ingredients), **Aufgaben**, **Wünsche** (own lists only), **Hausinfo** cards (never codes), **Personen**.
- **Actions in results**: "Milch auf die Liste", "Aufgabe ‚Bad putzen‘ anlegen", "Bon teilen" as the last row ("Nichts gefunden? ‚Bad putzen‘ als Aufgabe anlegen").
- **Privacy**: private tasks, private lists, personal money and reservations only for their owner; guests get only what their level allows. A new `GET /api/search` must be in `test/cloud-isolation.test.ts`, documented in `docs/`, and get a CHANGELOG line.
- **iOS system search**: index products, recipes and tasks as App Entities (`IndexedEntity`) so Spotlight and Siri find them (pon uses a Spotlight action).

### 2.5 Quick add

- **One "+" per root screen, context first.** Einkauf: focus the add field. Zuhause: Aufgabe (segment Aufgaben) or Produkt/Reste (segment Vorrat). Kochen: Rezept hinzufügen. Geld: Bon teilen. Heute: the universal sheet.
- **Universal "Hinzufügen" sheet** (replaces the receipt-centric `AddSheet`): one text field on top ("Was ist los? z. B. Milch ist alle, Bad putzen am Samstag"), below it 4 big rows: **Auf die Liste · Aufgabe · Bon teilen · Scannen**, then a "Mehr" disclosure with Foto, Text, Produkt anlegen, Reste wegpacken, Digitaler Bon. Typed or dictated text is parsed into **chips** with a destination (list / task / stock) the user confirms before saving (pon `REVIEW_STAGING_HINT`, TSL speech preview, FairShare brain dump). With AI on, the assistant does the parsing; without AI the existing `QuickAddParser` covers list items.
- **Outside the app**: Home Screen quick actions (Auf die Liste, Aufgabe, Bon teilen, Scannen), Control Center controls, Action Button, Share extension (exists), Siri (2.7/3.10).

### 2.6 Guests and kids: a reduced app

Guest levels come from `server/lib/people-policy.ts` (`order` ⊂ `stock` ⊂ `recipes`, `family` = denylist). The UI shows **only what the level opens**, with no greyed-out rows.

| Who | Tabs | Mehr shows |
|---|---|---|
| Guest `order` | Einkauf · Bring mir was (as tab) | Mein Konto, Hilfe, Hausinfo, Übergabe if chosen |
| Guest `stock` | Heute · Einkauf · Zuhause (Vorrat + Wo ist was only, no Aufgaben segment) | same + Bring mir was |
| Guest `recipes` | + Kochen | same |
| Guest `family` | Heute · Einkauf · Kochen · Zuhause (Vorrat only; server denies `/aufgaben`, `/urlaub`) | no Geld, no Bons, no admin rows |
| Member (not admin) | all five | no admin-only rows (Bildschirme, Drucker, Daten restore, Abo) |
| Kid | no login. Paired tablet shows the kid mode (`/kids/:token`, picture tiles, wishes a parent approves). Kid profiles appear as doers/rotation in Aufgaben and as eaters in votes. | – |

Plus: a slim banner at the top for guests ("Du bist Gast bei Familie Berg · bis Sonntag"), the assistant button hidden for guests (as today), and Heute for guests shows only their cards (list, Übergabe tasks).

---

## 3. Prioritised changes per screen

Format: **What** – why (who does it) – effort. P1 first.

### Navigation shell (web + iOS)
- **P1** New tab set Heute · Einkauf · Kochen · Zuhause · Geld (2.1); Zuhause with segment Aufgaben | Vorrat and the three door chips. – Core objects in tabs (Lilara 5 tabs, FamilyManager "Aufgaben" tab). – **M** web, **M** iOS.
- **P1** Avatar → Mehr in the nav bar of every root screen; iPad sidebar keeps "Mehr". – Apple pattern; fixes the 2-tap detour. – **S**.
- **P1** Global search (2.4). – None of the competitors searches across areas; with ToHuus' breadth this is the biggest wayfinding win. – **L** (server + both clients).
- **P1** Context-first "+" and universal add sheet with chip review (2.5). – pon, TSL, FairShare brain dump. – **M**.
- **P2** Honest sync state in one place (nav bar dot + sheet "Offline · wird gesendet · alles da"). – Meal planner `offline_banner_*`. – **S**.
- **P2** Desktop sidebar: five areas, then Mehr as collapsible groups instead of ~20 flat links. – **S**.

### Heute
- **P1** "Braucht noch jemanden" line: tasks due today/tomorrow without anyone keeping them in mind and list items nobody claimed, counted kindly ("2 Aufgaben hat noch niemand im Blick"). Data exists (`loose_tasks` in `/api/blick`, claims). – Lilara `meal_assign_cook_nudge`, `NeedsAttentionCard`. – **S**.
- **P1** Live card "Sam ist gerade bei Edeka. Fehlt noch was?" on top while a trip runs, with "Noch was drauf" (opens add field). – pon live card + push. – **S** (trip events exist).
- **P1** Card order on iOS like web (Fällig · Aufgaben · Liste · Das habt ihr noch · Kochen · Geld) incl. "Karten anordnen", and the same title "Fällig" on both platforms. – Parity, fewer words. – **S**.
- **P2** Sunday/Monday "Woche im Rückblick" card: done first (by area, names alphabetical), then "Was schieben wir?" with "Auf nächste Woche (n)" and undo. Replaces red overdue lists. – Tiimo review, Lilara digest, Meal planner week intro, FamilyManager check-in. – **M**.
- **P2** Getting-started checklist card on iOS (exists on web as `ChecklistCard`). – Lilara "Keep planning". – **S**.
- **P3** Settings switch for the Platt line (open item in the 14 Oct handover). – **S**.

### Einkauf
- **P1** Add field = search with memory: on focus show chips **Häufig · Zuletzt · Fällig**, first row is the parsed new entry ("2 Milch" → Milch, Menge 2, Kühlregal), focus stays after adding, newly added row flashes once. Move "Unsere Üblichen" and "Zuletzt erledigt" out of the "…" menu into this panel. – TSL `getCatalogItems`, `options.focus`; pon `PRODUCT_SEARCH_TAG_*`. – **M**.
- **P1** Gestures: tap or swipe right = abhaken; swipe left (full) = **Bearbeiten**, delete only inside edit or as a second swipe action; leading swipe "Ich hol's". – pon FAQ `menge-aendern`. – **S**.
- **P1** Erledigt-Bon keeps the last 30 with "Zurückholen" per row and "Aufräumen" button; never silently gone. – pon clean-up pill, TSL `pickedItems`. – **S**.
- **P1** Cut the "…" menu to max 5: Teilen, Läden & Gänge, Angebote, Liste importieren, Listen-Einstellungen. Bon hinzufügen goes to Geld/"+", Wünsche is a nav-bar icon, paste/photo/dictation sit at the add field. – pon/TSL keep the list screen calm. – **S**.
- **P2** Duplicate hint "Milch steht schon drauf (1). Auf 2 erhöhen?" – TSL `fixDuplicateSheet`. – **S**.
- **P2** Store mode: screen stays on, optional lock button; first tick without store mode asks "Einkauf bei Edeka starten? Dann sortiert ToHuus nach Gängen." – TSL `keepAwake`, pon `TRIP_PROMPT_*`. – **S/M**.
- **P2** Overbuy hint when adding: "Könnte noch da sein: 2 Packungen im Vorrat." – pon pantry "Könnte noch da sein". – **S**.
- **P3** "Nur Wischen" option against accidental ticks while scrolling. – pon `GLOBAL_APP_SETTINGS_CHECKMODE_INFO`. – **S**.

### Zuhause › Vorrat
- **P1** Status chips on top: **Bald verbrauchen · Knapp · Alle · Boxen · Alles**, each with the Dutch Detail shape marker; tab badge = bald verbrauchen. – pon pantry sections "Bald aufbrauchen / Geht zur Neige / Vorrätig". – **S**.
- **P2** Quick fill correction (empty / ¼ / ½ / ¾ / full) on the row's long-press instead of a form. – pon fill ring. – **M**.
- **P2** "Abgleich" as a button in the Vorrat nav bar (today in Mehr). – **S**.

### Zuhause › Aufgaben
- **P1** Add with memory: one field that searches templates and own history (sliding priority), "Add in one tap" chips for the household form, focus stays. – TSL history priority, Tiimo starter areas. – **M**.
- **P1** Time types in the editor: **Uhrzeit · Tageszeit (morgens/mittags/abends) · diese Woche · ohne Datum · bei Bedarf**, rhythm "fest / ab dem letzten Mal / bei Bedarf" in plain words ("Alle 2 Wochen ab dem letzten Mal"). – Tiimo time types; wiki concept. – **M**.
- **P1** Filter row: **Fällig · Meine · Haushalt · Pflege & Fristen · Noch niemand** (the last one from `loose_tasks`). – Lilara unassigned count. – **S**.
- **P1** "Zuletzt erledigt" with who did it and a small "Danke" tap (sends a quiet notice to the doer, no counter). – pon/TSL keep done visible; FairShare "Danke sagen". – **S/M**.
- **P2** Learned rhythm hint on the row: "Ihr wischt etwa alle 9 Tage" (`learned_every_days` exists). – pon `AUTO_ABO_ITEM_DESC_INTERVAL`. – **S**.
- **P2** Group by room (from places) as an option. – FamilyManager rooms. – **S**.
- **P2** Prep reminders relative to a date: "am Vorabend", "am Tag" (Gelber Sack, Fleisch auftauen), delivered as an Apple reminder when CalDAV is on, not twice. – Meal planner `reminder_day_before`. – **M**.
- **P3** Putzmodus: big rows, screen on, one routine ticked through. – TSL shopping mode transferred. – **M**.
- Never: points, credits, streaks, parent approval (FamilyManager, wiki decision).

### Kochen
- **P1** Week: "Wer kocht?" avatar per day and one kind line "2 Abende brauchen noch jemanden am Herd". – Lilara cook assignment. – **M** (check model; `meal_plan.added_by` is not the cook).
- **P1** "Fehlendes für die Woche auf die Liste" with a preview (range, which meals, what is already at home) that keeps manual items; hint when the plan changed after. – Lilara `generateShoppingList`, `shopping_stale_*`. – **M**.
- **P2** Lieblinge as a filter in Rezepte (remove from Mehr, replace the WebPageView). – **S**.
- **P2** Native step-by-step cook mode on iPhone, screen stays on. – Meal planner `cook_mode`. – **M**.
- **P2** One "Rezept hinzufügen" sheet: Link · Foto · Text · Leer · Cookidoo · Paket, with a thumbs-down "Stimmt was nicht?" after AI import. – Meal planner magic recipe + feedback bar. – **S/M**.

### Geld
- **P1** Segment **Übersicht | Bons** so receipts live where the numbers come from; "Bon prüfen" notices link here. – Strong mental model; Mehr gets shorter. – **S**.
- **P2** WG card "Wer schuldet wem" when the household form is shared flat. – Uses existing WG balance rows. – **M**.
- **P2** Empty month explains what appears: "Teil einen Bon, dann siehst du hier, wofür das Geld weggeht." – Lilara empty insights. – **S**.

### Mehr and Settings
- **P1** One Mehr list (2.3) replacing the 12-tab Settings page on the web and the "Weitere Einstellungen in der Web-App" row on iOS. Every row opens its own screen (native or `WebPageView` per row until native). – iOS Settings pattern; nothing deeper than 2 taps. – **M** web, **M** iOS.
- **P1** Search field on top of Mehr filtering rows and settings by synonyms (part of 2.4). – **S** once the registry exists.
- **P2** Native screens for the remaining web pages, in this order: Orte & Kategorien, Benachrichtigungen (household), Personen admin, Gäste & Party, Bring mir was menu, Daten. – Parity doc order. – **L** total.

### Onboarding / first run
- **P1** Keep the flow at ≤ 5 visible steps: Wer gehört dazu? (incl. **WG** and "Ich kümmere mich auch um jemanden", exists) → Was nutzt ihr? → Wo ist eure Liste heute? → 30-second "da · fehlt · egal" → Wer kauft sonst ein?. Shops and "Bon teilen" move to the checklist. Everything skippable. – pon "nichts einrichten", Lilara stepper with skips. – **S**.
- **P1** Permissions only at the moment of use, each with a short pre-screen and a "geht auch ohne" state: Mitteilungen at the first reminder/claim, Standort at store mode, Kamera at scan, Mikrofon at dictation, Erinnerungen at CalDAV. – pon Ask/Consequence/Denied, Meal planner priming. – **M**.
- **P1** Getting-started checklist (5 items: Liste füllen, jemanden einladen, erste Aufgabe, ersten Bon teilen, Widget hinzufügen), hideable with confirmation. – Lilara "Keep planning". – **S**.
- **P2** People without the app: add Sam as a person with colour, invite later to "claim" that person. – Lilara profiles + claim. – **M** (check `PeopleSection`).
- **P2** Household form changes copy and templates, never the feature set. – Lilara household type. – **S**.

### Empty states
- **P1** Rule for all: Dutch Detail art + Serif title + one sentence that says what will appear + **one** action (design system already demands one action). Audit all pages with the UI audit script. – Meal planner, Lilara. – **S** per page.
- Examples in section 4.

### Widgets, Live Activities, Watch
- **P1** Widget "Heute" (small/medium): open list count, next 3 tasks due, interactive tick for a task (App Intent button). Logged-out state "Melde dich in ToHuus an". – Lilara Today widget + `LoggedOutWidget`; Meal planner interactive `AddWaterIntent`. – **M**.
- **P1** Live Activity "Sam kauft bei Edeka ein, noch etwa 10 Min" for the others, started by push (today `TripActivityWidget` exists). – pon. – **M/L**.
- **P2** Control Center controls and Action Button: Auf die Liste, Diktieren, Scannen. – pon `CONTROL_*`. – **S/M**.
- **P2** Watch: list + "Heute zu tun", complication with open count. – pon, Tiimo. – **M**.
- **P3** Lock Screen widget (circular: open items). – **S**.

### Siri and Shortcuts
- **P1** Add intents next to `AddToListIntent`: **Was steht heute an?** (reads due tasks and list count), **Aufgabe hinzufügen** (title, date), **Aufgabe erledigt**, **Lies die Einkaufsliste vor**; give `AddToListIntent` quantity and list parameters. German phrases: "Was steht heute in ToHuus an?", "Setz Milch auf die ToHuus-Liste". – Lilara `GetTodaysMealsIntent`, pon `ShowListIntent`/`AddItemsIntent`, Tiimo Apple schemas. – **M**.
- **P2** App Entities for products, recipes, tasks (Spotlight, Shortcuts parameters). – **M**.
- **P2** Home Screen quick actions (2.5). – pon, TSL. – **S**.

### P1 summary (do these first)
1. New tab set with **Zuhause** (Aufgaben | Vorrat) and Bons in Geld.
2. Mehr from every root screen + one flat Mehr list replacing the Settings tabs.
3. Global search across functions, settings, products, list, recipes, tasks.
4. Context-first "+" and universal add sheet with chip review.
5. Einkauf: add field with memory, edit-not-delete swipe, Erledigt with "Zurückholen", "…" menu ≤ 5.
6. Heute: "Braucht noch jemanden", live "kauft gerade ein" card, same cards on iOS.
7. Aufgaben: add with memory, time types, filter "Noch niemand", "Zuletzt erledigt" + Danke.
8. Vorrat status chips. Kochen: "Wer kocht?" and week → list with preview.
9. Onboarding ≤ 5 steps, permissions in context, checklist.
10. Widget "Heute" with interactive tick, Live Activity for others, Siri "Was steht heute an?".

---

## 4. Microcopy

### Rules
1. **Du-Form, always.** Plural "ihr" when it is about the household ("Ihr kauft Milch etwa alle 6 Tage").
2. **Plain and short.** Buttons are verbs (Auf die Liste, Abhaken, Teilen). Titles are nouns (Vorrat, Aufgaben). One idea per sentence, ≤ 12 words if possible.
3. **Warm, never pushy.** No exclamation chains, no "Super!", no streaks, no guilt. Open work is counted kindly, never blamed.
4. **No marketing speak** (no "smart", "revolutionär", "ganz einfach"), no anglicisms where German works (Liste, not Shopping-List). Product names stay (Home Assistant, Thermomix).
5. **No dash cascades.** No "–" to chain thoughts; write two sentences. Dashes only for ranges in tables.
6. **Say what happens next.** Every toast with a reversible action gets "Rückgängig". Errors say what to do.
7. **One word per thing** (glossary below). The UI never shows route names.
8. **Names in examples:** Mira, Mika, Sam, Ben, Familie Berg. Never real family names.
9. **Numbers only when real.** No made-up percentages, no "Es fehlt nur …" without data (design system rule).
10. **Guests and kids:** the same tone, even simpler; kids get pictures, no text needed.

### Glossary (use exactly these)
| Use | Not |
|---|---|
| Einkauf, die Liste | Einkaufszettel, Shopping-Liste |
| Vorrat | Bestand, Inventar |
| Aufgaben (filter: Pflege & Fristen) | To-dos, Pflege als eigener Bereich |
| im Blick haben / erledigen | zuständig sein, verantwortlich |
| Bon | Kassenzettel, Beleg (except legal) |
| Bring mir was | Bestellen, Verwöhnen |
| Assistent | Sprechen, KI-Chat |
| Fällig | Wahrscheinlich fällig, überfällig (use "seit 3 Tagen fällig") |
| Abhaken | Erledigen (for list items) |

### Examples (German, as shipped)

| Situation | Text |
|---|---|
| Nobody keeps it in mind | „2 Aufgaben hat noch niemand im Blick.“ Button: „Ich mach's“ |
| Shared load (Lilara tone) | „Diese Woche hatten Mira und Sam die Liste im Blick.“ |
| Someone is shopping | „Sam ist gerade bei Edeka. Fehlt noch was?“ Button: „Noch was drauf“ |
| Rhythm hint | „Milch ist wohl wieder dran. Ihr kauft sie etwa alle 6 Tage.“ Buttons: „Auf die Liste“ · „Haben wir noch“ |
| Learned task rhythm | „Ihr wischt etwa alle 9 Tage.“ |
| Duplicate | „Milch steht schon drauf. Auf 2 erhöhen?“ |
| Overbuy | „Könnte noch da sein: 2 Packungen im Vorrat.“ |
| Done toast | „Abgehakt.“ Button: „Rückgängig“ |
| Clean up | „Aufräumen“ (button) · after: „Liste ist leer. Gut gemacht.“ only after a real trip |
| Weekly review | „Das habt ihr diese Woche geschafft.“ then „Was schieben wir auf nächste Woche?“ |
| Thanks | „Danke an Ben“ (button) · Ben sees: „Mira sagt danke fürs Bad.“ |
| Empty list | Title „Die Liste ist leer“ · „Alle im Haushalt können etwas draufsetzen. Es erscheint sofort bei allen.“ · „Etwas hinzufügen“ |
| Empty tasks | Title „Noch keine Aufgaben“ · „Fang mit dem an, was bei euch immer wieder anfällt.“ · „Vorschläge ansehen“ |
| Empty money | Title „Noch keine Bons“ · „Teil einen Bon, dann siehst du hier, wofür das Geld weggeht.“ · „Bon teilen“ |
| Empty search | „Nichts gefunden zu ‚Wischmop‘.“ · „‚Wischmop‘ auf die Liste“ · „Als Aufgabe anlegen“ |
| Permission ask (location) | „Im Laden sortiert ToHuus die Liste nach Gängen und erinnert dich beim Vorbeigehen. Dafür braucht es deinen Standort.“ · „Erlauben“ · „Ohne weiter“ |
| Permission denied | „Ohne Standort geht alles weiter. Nur die Erinnerung am Laden fehlt.“ · „In den Einstellungen ändern“ |
| Offline | „Kein Netz. Deine Änderungen warten und gehen raus, sobald du wieder online bist.“ |
| Synced | „Alles ist auf dem neuesten Stand.“ |
| Error | „Das hat nicht geklappt. Versuch es gleich noch mal.“ |
| Guest banner | „Du bist Gast bei Familie Berg. Bis Sonntag.“ |
| Siri answer | „Heute stehen 3 Aufgaben an und 5 Sachen auf der Liste.“ |
| Widget logged out | „Melde dich in ToHuus an, dann siehst du hier, was heute ansteht.“ |

### Watch out in current copy
- Web "Fällig" vs iOS "Wahrscheinlich fällig": align to „Fällig“ with the explanation as subtitle.
- iOS Einkauf card "things are missing" („Sachen fehlen“) vs web "things on the list": pick „auf der Liste“.
- AddSheet hints chain clauses with dashes („… – ToHuus remembers what you bought.“): split into two sentences in German.
- English source keys sometimes carry dashes that the German translation copies; review `web/src/locales/de/*.ts` and `ios/tools/strings_de*.json` for „ – “ in running text.

---

## 5. Open decisions for Till
1. Tab set A (Heute · Einkauf · Kochen · Zuhause · Geld) vs B (… Vorrat · Aufgaben, Geld in Mehr). Recommendation: **A**.
2. Name of tab 4: „Zuhause“ (recommended) or „Haushalt“.
3. Does the "Danke" tap send a notification or only show on the doer's Heute? Recommendation: only on Heute, no push.
4. Global search endpoint: one server endpoint (`/api/search`) or client-side over cached data plus a small server part. Recommendation: server endpoint, so privacy filtering stays in one place.
