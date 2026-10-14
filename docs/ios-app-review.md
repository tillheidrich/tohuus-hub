# iOS app: App Store Review checklist

Audit of the iPhone/iPad app (with Apple Watch app, widgets, share extension) against the App Store Review Guidelines
and the App Store Connect requirements, 14 Oct 2026, build 1.0.0 (9). Status: **ok** (nothing to do), **fixed** (changed
in this pass), **Till** (to do in App Store Connect, the Apple Developer account or the cloud back office).
App Privacy answers, age rating and product ids stay in [app-review.md](app-review.md); store texts in
[app-store-texte.md](app-store-texte.md).

## Checklist

| Guideline | Topic | Status | Where / what |
|---|---|---|---|
| 1.2 | User-generated content | ok | Nothing is published to strangers: households only see their own data. Shared links (guest links, babysitter link, wish list share, party board, money list text) go to people the household picks. ToHuus-Rezepte are written by the operator. No report/block feature needed. |
| 1.3, 5.1.4 | Kids | ok | Kid profiles and kid mode are a feature of a household app for adults; not in the Kids category (primary Food & Drink, secondary Lifestyle). No ads, no analytics or third-party SDKs at all. In the cloud a child's AI starts off; allergies and children's details go to a model only with the household's Art. 9 consent. |
| 2.1 | Completeness, sign-in for review | Till | Demo account and review notes below. During the beta gate (`CLOUD_SIGNUP=invite`) the reviewer needs the demo account or an access code – both go into App Review Information. |
| 2.1, 3.1.1 | In-app purchases testable | fixed + Till | During the beta every household gets Plus as a gift, so the paywall shows no prices – a reviewer could not find or buy the subscriptions. New `BETA_GIFT_EXCEPT` (household ids, `server/lib/gifts.ts`, test in `test/cloud-gifts.test.ts`) leaves the review household out of the gift. Till: put the review household's id there. |
| 2.2 | Beta testing | **Till – risk** | The public App Store build says "ToHuus is in a small test right now. You need an access code" (`BetaNote`, `StartView.swift`) and "Free during the beta" on the paywall. Apple rejects apps that present themselves as betas on the store (2.2: betas belong in TestFlight). See "Likely rejections" below. |
| 2.3 | Accurate metadata | Till | Screenshots must show the current tabs (Heute · Einkauf · Kochen · Zuhause · Geld) and the round assistant button (no "Sprechen"). Description must not promise features that need Plus without saying so. The old review notes said "ToHuus Cloud only" – replaced below (own server works since 14 Oct). |
| 2.5.1 | Public APIs only | ok | No private selectors, `NSClassFromString`, `dlopen` or private URL schemes (checked with grep). Only Apple frameworks, no SPM packages. |
| 2.5.2 | No downloaded code | ok | The app runs no downloaded code. The only web view (`WebPageView`, `WebSettingsView.swift`) is used for linking single sign-on in Mein Konto on an own server – the provider's sign-in page. The "Web settings" sheet in `SettingsView` is no longer reachable. |
| 2.5.4 | Background modes | ok | No `UIBackgroundModes`. The shop hint uses region monitoring (works without a background mode); Live Activity is updated locally (`pushType: nil`). |
| 3.1.1 | Digital content only via IAP | ok | StoreKit 2 (`Core/Billing/StoreManager.swift`, `Features/Paywall/PaywallView.swift`). No external payment link or "buy on the website" text in the app (strings checked). Plan codes from the operator are redeemed **on the web only**; `POST /api/billing/redeem` answers 403 to the app's user agent (`ToHuusApp`). The only "Redeem code" button is Apple's offer-code sheet. |
| 3.1.2 | Subscription terms | fixed | Paywall: price and period from StoreKit, what each plan includes, auto-renew text, restore, manage subscription, offer codes, links to Apple's standard EULA, our terms and privacy. New: an introductory offer (e.g. the planned 2-week Plus trial) is shown with its length and the price after it, only to people who can still get it (`IntroOfferLine` in `PaywallView.swift`). |
| 3.1.3(b) | Multiplatform | ok | A plan bought or gifted elsewhere (web plan code) is shown in the app; the same plans are sold in the app via IAP. |
| 3.1.x | Own server | ok | `purchasesAvailable` is cloud-only (`AppModel.swift`); on an own server the paywall shows "Für diesen Haushalt ist alles inklusive." and Mehr shows no plans. |
| 4.2 | Minimum functionality | ok | Native app; no web views for features (parity rule). |
| 4.8 | Sign in with Apple | ok | Cloud offers Sign in with Apple, e-mail + password, e-mail code and passkeys – no third-party social login. An own server may offer the admin's own SSO (e.g. Authentik) in the browser: that is the household's own account system (4.8 exception for the company's own accounts / a client for an existing account). |
| 5.1.1(i) | Privacy policy | ok | Start screen, Mehr › Rechtliches, paywall, AI consent. URLs in [app-review.md](app-review.md). |
| 5.1.1(ii), (iv) | Permissions, purpose strings | fixed | Purpose strings in `ios/project.yml` (en) and `ios/ToHuus/Resources/InfoPlist.xcstrings` (de): camera, microphone, speech recognition, location when in use / always (shop hint, optional), calendars write-only, **new:** local network (own server at home, `http://192.168…` triggers the prompt) and **new in the Info.plist:** photo library add (the share sheet's "Save Image" on leftover/meal-box cards and printer previews terminates the app without it; the German text was already in the catalog). Photos are picked with `PhotosPicker` (no permission). No contacts, NFC, Face ID, HealthKit, tracking. Watch: only `TextFieldLink` dictation, its microphone string is harmless. |
| 5.1.1(v) | Account deletion | ok | Mehr › Konto löschen (cloud), two taps, confirmed with password, a fresh Sign in with Apple, or the code from a mail → `DELETE /api/cloud/account` (`Features/Settings/AccountDeletion.swift`, `server/routes/cloud.ts`). Households only this person belongs to are crypto-shredded; from shared ones the person leaves. Mentions cancelling an App Store subscription. Sign in with Apple tokens are revoked when `APPLE_SIWA_KEY_ID`/`APPLE_SIWA_KEY_P8` are set (**Till: check in Coolify**). Own server: accounts are made and removed by the household's admin (person screen in the people area › Entfernen, `PersonAdminView.swift`, `DELETE /api/users/:id`); the operator of ToHuus holds no data there. Deleting a single cloud household without deleting the account (`DELETE /api/cloud/households/:id`) exists on the server but has no button in web or app – not required by 5.1.1(v). |
| 5.1.2(i) | Sharing with third-party AI | fixed | Cloud: no model request with a person's data before that person agrees (`aiOffReason` → `consent`, `server/lib/ai-policy.ts`). Fixed: the consent now names **everyone who receives the data** – `consent.processor` is "Mistral AI (Frankreich), vermittelt über OpenRouter (USA)" (before: only "Mistral AI (EU)"; `aiProcessorLabel`, test in `test/cloud-isolation.test.ts`) – and the iPhone text says **what** is sent: free sentences and voice messages, photos, plus the household data the answer needs (list, stock, recipes); allergies and children's details only with the separate household consent. The one-time sheet is now asked **per person and household** (was once per device, so a second account on the same iPhone was never asked), and the assistant shows "Für freie Fragen braucht ToHuus dein Okay für KI. – Lesen und entscheiden" until the person decides (`AIConsentPrompt`, `AISettingsView.swift`, `AssistantSheet.swift`). Withdraw any time: Mehr › Mit oder ohne KI. Own server: the admin picks their own model and key; no consent is asked by the server (their data, their provider). Apple Intelligence (on device) is opt-in. |
| 5.1.1, privacy manifest | `PrivacyInfo.xcprivacy` | ok | One file in all five targets (app, share, widget, watch, watch widgets). Tracking false, no tracking domains. Required-reason APIs: only UserDefaults (CA92.1, 1C8F.1); grep found no file timestamp, boot time, disk space or keyboard APIs. Collected types match App Privacy in [app-review.md](app-review.md). |
| 5.1.5 | Location | ok | Only for the optional shop hint, region monitoring of shops the person saved; stays on the device. |
| 5.6 | Developer code of conduct | ok | No dark patterns: Free stays usable, trial ends without charge, cancellation explained, no fake urgency. |
| – | Export compliance | ok | `ITSAppUsesNonExemptEncryption = false` in the app and the watch app (HTTPS and CryptoKit SHA-256 for the Sign in with Apple nonce only – exempt). |
| – | Entitlements | ok + Till | App Group `group.de.heidrichdigital.tohuus` in all five targets (also used as keychain group). `aps-environment` development → production on export. Sign in with Apple, Associated Domains (`webcredentials:cloud.tohuus.heidrich-digital.de`), Push and App Groups must be enabled for the App IDs (Till, developer account). |
| – | In-app purchase products | Till | Four subscriptions plus the optional non-consumable `de.heidrichdigital.tohuus.plus.lifetime` (only shown when it exists). Attach the subscriptions to the first submission with a review screenshot each. |

## Likely rejections and what to do

1. **2.2 Beta on the store.** The public build shows the access-code gate and "Free during the beta". Options, best
   first: (a) open sign-up for the App Store release (`/betrieb` › Einstellungen › `signup.mode` = `open`) and switch
   off the beta gift, keep the beta in TestFlight until then; (b) submit with the gate but explain in the review notes
   that new households are limited for capacity and the app is complete (some reviewers accept this, others don't).
2. **2.1 IAP not found.** With the beta gift on, a reviewer sees no prices. Put the review household into
   `BETA_GIFT_EXCEPT` and keep its trial running (back office › Haushalte › trial) or let it run out so the plans can be
   bought in the sandbox.
3. **5.1.2(i) AI consent.** Leave the demo account **without** AI consent, so the reviewer sees the consent sheet after
   sign-in.
4. **5.1.1(v) Sign in with Apple revocation.** Without `APPLE_SIWA_KEY_*` the token is not revoked on deletion –
   Apple asks for revocation. Set the key before submitting.

## What Till enters / sets before submitting

- **Cloud back office (`/betrieb`)**: create the demo account `appreview@tillheidrich.de` with a password (sign up with
  the address on the allowlist, `Beta-Zugang`), fill it with `node scripts/seed-screenshots.mjs` (sample data,
  second member Mira). Do **not** agree to AI with it. Create one access code with the note "App Review" (for a
  reviewer who signs up with their own Apple ID).
- **Coolify app `tohuus-cloud`**: `BETA_GIFT_EXCEPT=<review household id>` (id from `/betrieb` › Haushalte),
  `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_KEY_P8`, `APPLE_TEAM_ID` set; App Store Server Notifications v2 URL as in
  [app-review.md](app-review.md).
- **App Store Connect › App Review Information**: sign-in required = yes, user name and password of the demo account,
  the notes below, contact Till.
- **App Store Connect › subscriptions**: the four products (and the optional lifetime product), review screenshot of
  the paywall each, localised names; decide the 2-week intro offer (the paywall shows it automatically).
- **App Privacy**: as in [app-review.md](app-review.md) §2. **Age rating**: §3 there; in the 2025 questionnaire answer
  "Parental controls: yes" (parents switch AI and areas off for kid profiles), user-generated content: no public sharing,
  unrestricted web access: no.
- **Category**: Food & Drink, secondary Lifestyle – not Kids.
- **Developer account**: capabilities for `de.heidrichdigital.tohuus` (Sign in with Apple, Push, App Groups, Associated
  Domains), `.share`, `.widget`, `.watchkitapp`, `.watchkitapp.watchwidgets` (App Groups).

## Review notes (App Review Information › Notes)

### English (paste this)

> ToHuus is a shopping and household assistant for families, couples and flatshares: a shared shopping list that
> learns from receipts, meal ideas from what is at home, household tasks, and where the money for food goes.
> It works with ToHuus Cloud (servers in Germany, the default) or with a server the household runs itself.
>
> **Sign-in:** tap "Anmelden" / "Sign in" and use the demo account from the sign-in fields (e-mail and password). New
> households are limited during the launch phase: to create a new account (e-mail or Sign in with Apple), tap "Konto
> erstellen" / "Create account" and enter the access code: ________. The demo household has sample data (marked
> "Beispiel").
>
> **AI and your data (5.1.2(i)):** after signing in, the app asks once whether AI may be used and names who receives
> the data (Mistral AI in France, routed through OpenRouter in the US) and what is sent. Without consent everything
> works without AI. The consent is per person; it can be withdrawn under Mehr (avatar, top right) › Mit oder ohne KI.
> The assistant (round sparkle button) offers the consent again until you decide. Allergies and children's details are
> shared only with a separate household consent.
>
> **Subscriptions:** sold only through the App Store (StoreKit 2). Mehr › Pläne ansehen shows the plans with prices,
> restore purchases, manage subscription, offer codes, terms and privacy. Nothing else in the app sells anything.
>
> **Account deletion (5.1.1(v)):** Mehr › Konto löschen (at the end of the list). Confirm with the password.
>
> **Permissions:** camera (barcodes, receipts), microphone and speech recognition (dictating to the assistant),
> location only for the optional "Hinweis im Laden" (geofence around the household's own shops, stays on the device),
> calendar write-only (adding an appointment), local network only when someone connects to their own server at home.
>
> **Own server (optional):** the start screen also offers "Eigener Server" for households that run ToHuus themselves
> (open source). Purchases exist only in ToHuus Cloud. Reviewing with the demo account covers every feature.
>
> Contact during review: tohuus@tillheidrich.de

### Deutsch (für die eigene Ablage; Apple prüft auf Englisch)

> ToHuus ist ein Einkaufs- und Haushaltsassistent für Familien, Paare und WGs: eine gemeinsame Einkaufsliste, die
> aus Bons lernt, Essensideen aus dem, was da ist, Aufgaben im Haushalt und wohin das Geld fürs Essen geht.
> Die App läuft mit der ToHuus Cloud (Server in Deutschland, Standard) oder mit einem eigenen Server des Haushalts.
>
> **Anmelden:** „Anmelden“ tippen und das Testkonto aus den Anmeldefeldern nehmen (E-Mail und Passwort). Neue
> Haushalte sind zum Start begrenzt: Für ein neues Konto (E-Mail oder „Mit Apple anmelden“) „Konto erstellen“ tippen
> und den Zugangscode eingeben: ________. Der Testhaushalt hat Beispieldaten (markiert mit „Beispiel“).
>
> **KI und deine Daten (5.1.2(i)):** Nach dem Anmelden fragt die App einmal, ob KI genutzt werden darf, und nennt,
> wer die Daten bekommt (Mistral AI in Frankreich, vermittelt über OpenRouter in den USA) und was geschickt wird.
> Ohne Zustimmung funktioniert alles ohne KI. Die Zustimmung gilt pro Person und lässt sich unter Mehr (Bild oben
> rechts) › Mit oder ohne KI zurückziehen. Der Assistent (runder Funkel-Knopf) bietet sie an, bis du entschieden hast.
> Allergien und Angaben zu Kindern nur mit einer eigenen Zustimmung des Haushalts.
>
> **Abos:** nur über den App Store (StoreKit 2). Mehr › Pläne ansehen zeigt die Pläne mit Preisen, Käufe
> wiederherstellen, Abo verwalten, Angebotscodes, Nutzungsbedingungen und Datenschutz. Sonst verkauft die App nichts.
>
> **Konto löschen (5.1.1(v)):** Mehr › Konto löschen (am Ende der Liste), mit dem Passwort bestätigen.
>
> **Berechtigungen:** Kamera (Barcodes, Bons), Mikrofon und Spracherkennung (Diktieren an den Assistenten), Standort
> nur für den optionalen „Hinweis im Laden“ (bleibt auf dem Gerät), Kalender nur schreiben (Termin eintragen),
> lokales Netzwerk nur beim eigenen Server zu Hause.
>
> **Eigener Server (optional):** Der Startbildschirm bietet auch „Eigener Server“ für Haushalte, die ToHuus selbst
> betreiben (Open Source). Käufe gibt es nur in der ToHuus Cloud. Mit dem Testkonto lässt sich alles prüfen.
>
> Kontakt während der Prüfung: tohuus@tillheidrich.de

If the review household is in `BETA_GIFT_EXCEPT` and its trial is running, add: "The demo household is in its free
trial; after it, the plans can be bought with a sandbox account." If sign-up is opened for the release, drop the
access-code sentence.
