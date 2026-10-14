# Web ↔ iOS parity, 13 Oct 2026 (updated 14 Oct)

**14 Oct:** Mehr in the app now has the web's groups, entries and order (`MoreSections`, docs/ios-0.2.md "14 Oct
2026"). Every page of the web's Mehr is reachable in the app – natively or as the web page signed in. Native since
14 Oct: Pflege & Fristen, the complete Hausinfo, Urlaub / unterwegs with all tabs, Übergabe (trip and guests).
Still a web page in the app: Lieblinge, Gäste & Party, Displays, Home Assistant, QR-Etiketten, Daten.

What the web app can do that the iPhone app (1.0 build 5 + the changes on `claude/tohuus-status-btntbq`) cannot yet.
The app has one web view (`ios/ToHuus/Features/Settings/WebSettingsView.swift`, Mehr › "Weitere Einstellungen in
der Web-App") that signs in with a one-time link and opens `/einstellungen` – every web settings tab is reachable
there; other pages are not linked from the app.

| Web feature | Web | iOS | What is missing |
|---|---|---|---|
| Home & care tasks ("Pflege") | `/pflege` | **native since 14 Oct** (CareView) | choosing a product to use up (a set product shows and can be removed), labels and ticket via the web page |
| Trip / away mode | `/urlaub` | **native since 14 Oct** (AwayView) | – |
| Holiday handover | trip › Übergabe, `/uebergabe` | **native since 14 Oct** (HandoverView, HandoverGuestView) | – (the page behind a guest link is for people without the app) |
| Places & categories editing | Settings › places | web view | create, rename, reorder, delete; categories; household form |
| Notification routing | Settings › notify | partial | channels (push/e-mail/summary), lock-screen text, "only at home"; household matrix via web view |
| Shopping-list extras | `shop/forms.tsx`, `bridges.tsx` | partial | WG balance/personal rows, lunchbox regulars, care fridge check, CalDAV, import from Bring!/AnyList/CSV, start mode, offers per shop |
| Recipe import | Kochen › add | partial | blank new recipe, bulk recipe photos |
| Week plan | `Week.tsx`, `Plan2.tsx` | covered | meal-box picks, print, Cookidoo sync |
| Favourites, cook mode | `/lieblinge`, `CookMode.tsx` | web page in the app (Mehr › Lieblinge) / partial | native favourites page; step-by-step cook mode on iPhone (kitchen mode exists) |
| Receipts | `/import…` | partial | recognition rules page, forwarding address, per-line payer, cupboard photo mode |
| Spending / budgets | `/ausgaben` | covered | composition chart |
| Money lists | `money/lists.tsx` | covered | picking single receipt lines |
| Product detail extras | `Product.tsx` | partial | "on the order menu" toggle, shelf-life settings, labels |
| QR labels | `/etiketten` | web page in the app (Mehr › QR-Etiketten) | native label sheets (scanning works) |
| Bring mir was | `/bestellen`, `/bestellen/karte` | partial | menu editor, guest/party modes |
| Guests & party | `/bar` | web page in the app (Mehr › Gäste & Party) | native order board, bar menu tab, party host flow |
| People admin | Settings › members | partial | children, permanent guests with level, kind switch, login links, roles/removal, sign-in policy (web view) |
| Hausinfo | `/hausinfo` | **covered since 14 Oct** | – (templates, reveal log, A4 sheet, per-link selection, guest levels and single links, HA voice list, search, by room/kind) |
| Wishes, quick check, "Wo ist was?", memory, help, billing | | covered | |
| AI settings | Settings › access | partial | OAuth connections, tokens, recognition status (web view) |
| Account & security | Settings › account | partial | e-mail/password, passkeys, TOTP, sessions, household name/language/appearance/region, modules (web view) |
| Data | Settings › data | web view | full export, CSV import, move in/out, start over |
| Today extras | `Today.tsx` | partial | card order, pulse question, care/away/party banners, getting started, full first-run setup |

Probably web-only on purpose: back office, Home Assistant, printers, displays/kiosk, Telegram/Matrix, IMAP, Cookidoo
sync, kid tablet mode, party TV board, public guest/invite pages, share landing (the app has a share extension), move
in/out, `/scan` (native scanner).

## Order to close the gaps

1. ~~Care tasks~~ · 2. ~~Trip / away mode~~ · 3. ~~Holiday handover~~ · 4. ~~Packing and holiday kitchen~~ (all 14 Oct) · 5. Places & categories ·
6. Notification routing · 7. Party host and order board · 8. Treats menu editor · 9. People admin · 10. Shopping-list
household forms. Then: native data export, recognition rules + forwarding address, blank recipe, favourites,
~~Hausinfo templates/log/print~~ (14 Oct), account security.

iPad: the app is universal (`TARGETED_DEVICE_FAMILY: "1,2"`, sidebar via `NavigationSplitView` in `MainTabView`).

## Bridge since 13 Oct (branch `claude/tohuus-status-btntbq`)

`WebPageView` (`ios/ToHuus/Features/Settings/WebSettingsView.swift`) opens any web page signed in. Mehr in the app
now has *Urlaub / unterwegs* (`/urlaub`, with the handover tab), *Pflege & Fristen* (`/pflege`, when the area is
switched on) and, for permanent guests, *Übergabe* (`/uebergabe`). Native screens for these stay the next step
(order above).
