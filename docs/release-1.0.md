# Release 1.0 – final instead of beta (15 Oct 2026)

Till, 15 Oct 2026: "Können wir den Betatest direkt beenden und weg von TestFlight? Bau alles so um, dass die App final
ist und wir dann Codes an interessierte Leute geben, damit sie Monats-, Jahres- oder Lifetime-Lizenzen kostenfrei
bekommen."

## Decision

**Yes, the beta ends.** ToHuus goes into the App Store as 1.0. Interested people get **free licences as codes**, not
TestFlight places. Condition: build 10 is built in Xcode once and checked on a real iPhone before it goes to review. The
Linux checks (parse, API contract, decode harness, strings) can't replace that.

## What changed in the code

- **Sign-up is open** (`CLOUD_SIGNUP` unset = `open`, before `invite`). The access-code gate stays as a tool: `invite` or
  `closed` in /betrieb › Einstellungen.
- **Licence codes** in /betrieb › Geschenke › "Neue Geschenk-Codes":
  - Duration: **Ein Monat** (31 days), **Ein Jahr** (366 days), **Für immer** (lifetime), or a number of days.
  - Plan: Haushalt or Plus.
  - Defaults: Plus, one year, one household per code, up to 50 codes at once, "Alle kopieren".
  - An admin of the household redeems the code on the web (Einstellungen › Abo › Code einlösen). It then applies on
    every device, the iPhone included.
  - The iPhone app has **no code field**: Apple 3.1.1 forbids unlocking with own codes. The app shows the household's
    plan (3.1.3(b) multiplatform). Apple's own offer codes for subscriptions can be added in App Store Connect later if
    wanted.
- **"Geschenk für alle Haushalte"** (formerly "Geschenk während der Beta") stays as an operator switch. For the launch:
  **switch it off**.
- **No beta texts any more** (web, iOS, website). The update screen in the app opens the App Store, not TestFlight.
- **Website:** "Im App Store laden" instead of "TestFlight-Platz anfragen". A sentence says that people can get a free
  month, year or lifetime licence as a code.
- **"Was ist neu"** stays: it shows briefly after updates (not only during the beta).
- **iOS:** `CURRENT_PROJECT_VERSION` 10, `MARKETING_VERSION` 1.0.0.

## Steps for Till (in this order)

1. **Coolify app `tohuus-cloud`:**
   - Remove `CLOUD_SIGNUP` or set it to `open`.
   - Remove `BETA_GIFT` if it is set.
   - Deploy `main`.
2. **/betrieb:**
   - Einstellungen › Anmeldung: "open" (or reset to the default).
   - Geschenke: switch off "Geschenk für alle Haushalte".
   - Create codes for the people from the test, e.g. Plus for good, one per household.
3. **iOS:**
   - Build and test: `cd ios && xcodegen generate`, archive Release `generic/platform=iOS`, test on an iPhone (start,
     sign-in, Heute, Einkauf, purchase in the sandbox).
   - Upload: export `app-store-connect`.
   - App Store Connect:
     - Version 1.0 with build 10.
     - Texts from `docs/app-store-texte.md`.
     - App Review notes and demo account from `docs/ios-app-review.md`.
     - Submit for review.
     - Release manually after approval.
4. **TestFlight:** The group "Intern" stays for internal tests of future builds. Testers move to the App Store version
   and get a code.
5. **Testers:** Write to the two testers: "Die App ist jetzt im App Store. Hier ist dein Code für Plus für immer –
   einlösen unter Einstellungen › Abo im Browser."
