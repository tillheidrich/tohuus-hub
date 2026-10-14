# Web ↔ iOS parity (updated 14 Oct 2026, evening)

**Decision 14 Oct 2026:** the iPhone app makes no compromises against the web app. Every web function exists natively,
on ToHuus Cloud and on a self-hosted server. A new web feature is not done until the iOS screen exists (CLAUDE.md).
Structure on both: `docs/design/ux-benchmark-2026-10-14.md`.

## Status

Every page and settings tab of the web app now has a native screen. The notes per area list screens, endpoints and
debug launch arguments:

| Area | Notes |
|---|---|
| Account, security, household basics, appearance, region, modules, AI | `docs/ios-native-account.md` |
| People, kids and kid mode, permanent guests, sign-in rules | `docs/ios-native-people.md` |
| Places & categories, product extras, QR labels, favourites, stock | `docs/ios-native-places.md` |
| Notifications, channels, displays, Home Assistant, Cookidoo, printers, mail inbox, data & backups | `docs/ios-native-integrations.md` |
| Shopping (WG balance, lunchbox, care list, list import, offers, shop mode, start mode) | `docs/ios-native-shopping.md` |
| Cooking (editor, cook mode, week board, printing, meal boxes, recipe tools, Cookidoo) | `docs/ios-native-cooking.md` |
| Money & receipts (recognition, who paid, inbox, cupboard photos, charts, exports) | `docs/ios-native-money.md` |
| Bring mir was, guests & party (menu editor, order board, kitchen board, recap) | `docs/ios-native-treats.md` |
| Own server, several servers, Heute, first-run setup, tour, help, scanned labels | `docs/ios-native-start.md` |
| Aufgaben, Wer hat was im Blick, Erinnerungen & Kalender | `docs/tasks.md`, `docs/ios-0.2.md` |
| Global search | `docs/search.md` |

`WebPageView` is left only for single sign-on linking (the provider's own sign-in page) and the old
"Web settings" screen, which is no longer linked.

## Web only on purpose

- The party **TV board** and its pairing page: they run on a TV or tablet browser without an account. The app shows the pairing code, QR and link, opens the board in a Safari view (AirPlay works).
- The **guest page** behind a guest link (`/g/…`) and public invite pages: for people without the app.
- The operator **back office** (`/betrieb`).
- Turning on **web push** in a browser (a browser permission; the app lists and removes those browsers) and Web Bluetooth printing.
- Downloading the server **error log** (`/diag/errors`) and the **"What's new"** list.
- Creating a **passkey on a self-hosted server**: Apple only allows the app to create passkeys for the domains in its entitlements (ToHuus Cloud). On an own server the app signs in through the browser instead; listing and removing passkeys works.

## Still to check on a device

Nothing here was built in Xcode (no Xcode in the agent container; every file passes `swiftc -parse`). Risky spots are
listed at the end of each `docs/ios-native-*.md`. Run `cd ios && xcodegen generate` first (new usage text for writing
calendar entries in `project.yml`).
