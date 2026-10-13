# App Review: notes, App Privacy, age rating, in-app purchases

What Till enters in App Store Connect for ToHuus (app id 6822059656, bundle `de.heidrichdigital.tohuus`). Written
13 Oct 2026 for build 1.0.0 (6). Review notes are in English (Apple reviews in English); the store texts themselves
are German and English.

## 1. Review notes (App Review Information › Notes)

> ToHuus is a shopping and household assistant for families, couples and flatshares: a shared shopping list that
> learns from receipts how often a household buys things, meal ideas from what is at home, and where the money for
> food goes. It works with ToHuus Cloud (servers in Germany) only.
>
> **Sign-in for review:** use the demo account below (e-mail and password) or "Sign in with Apple". New sign-ups are
> limited to invited testers during the beta; the demo account is already let in. If you create a new account, enter
> the access code below when asked.
>
> - Demo account: `appreview@tillheidrich.de` / password in the "Sign-in information" fields
> - Access code for a new account: (see "Sign-in information" › notes)
>
> The demo household has sample data (marked "Beispiel"): a shopping list, things at home, recipes, receipts and
> spending, so every area can be tried without real purchases.
>
> **Things worth knowing**
> - Subscriptions (Haushalt, Plus) are sold only through the App Store (StoreKit 2, guideline 3.1.1). During the
>   beta every household gets Plus as a gift; the paywall then says so and shows no prices. Restore purchases,
>   manage subscription and redeem an offer code are on the paywall. No other way to pay is mentioned in the app.
> - Account deletion: Settings › Delete account (5.1.1(v)); it deletes the account and, for the last admin, the
>   household with its data. Sign in with Apple tokens are revoked on deletion (needs `APPLE_SIWA_KEY_*` set in the cloud).
> - AI: the assistant ("Sprechen") and receipt photo reading use Mistral (EU) through OpenRouter when the household
>   switches AI on. Everything else works without AI; each person and each child can be switched off. Apple
>   Intelligence (iOS 26+) is optional, off by default, and runs on the device only.
> - Location: only for the optional "Hint in the shop" (geofence around the household's own shops); the location
>   stays on the device.
> - Microphone and speech recognition: only for dictating to the assistant.
> - Health-related data: allergies are stored only if the household enters them; they reach a language model only
>   after an explicit consent.
> - Guest links and the babysitter link open in Safari for people without the app.
>
> Contact during review: tohuus@tillheidrich.de

Before submitting: create the review account in the cloud (`scripts/seed-screenshots.mjs` fills a household with
sample data), put its address on the beta allowlist in `/betrieb › Beta-Zugang`, and create one access code with a
note "App Review".

## 2. App Privacy (App Store Connect › App Privacy)

Tracking: **No**. Data linked to the user, all for **App Functionality** only, none used for tracking:

| Category | Type | Why |
|---|---|---|
| Contact Info | Email Address, Name | account, sign-in mails, invitations |
| Identifiers | User ID | account and household ids |
| User Content | Photos or Videos | receipts, product and recipe photos, house info media |
| User Content | Other User Content | lists, recipes, notes, wishes, house info |
| User Content | Audio Data | voice messages to the assistant (not stored after transcription; declare it because it is sent) |
| Purchases | Purchase History | App Store transactions of the household's subscription |
| Financial Info | Other Financial Info | spending from receipts and manual entries |
| Health & Fitness | Health | allergies, only when entered and consented |
| Diagnostics | Other Diagnostic Data | error log (server errors, unreadable answers, no content), stored with the household id |

Not collected: location (stays on the device), contacts, browsing history, search history, advertising data, crash
data from third parties (no SDKs). The privacy manifest `ios/ToHuus/Resources/PrivacyInfo.xcprivacy` declares the
same types.

Privacy policy URL: https://tohuus.heidrich-digital.de/de/datenschutz.html (German) and
https://tohuus.heidrich-digital.de/privacy.html (English).

## 3. Age rating

All questions "None", except **User-Generated Content**: none shared publicly (households only see their own data;
guest links are shared by the household itself). No unrestricted web access (help pages and the household's own web
app only). Result: **4+**.

## 4. In-app purchases (subscription group "ToHuus")

Created by Till in App Store Connect (never by an agent). Prices are the launch prices from the website.

| Product id | Name (de / en) | Duration | Price (DE) |
|---|---|---|---|
| `de.heidrichdigital.tohuus.haushalt.monthly` | Haushalt / Household | 1 month | 3,99 € |
| `de.heidrichdigital.tohuus.haushalt.yearly` | Haushalt (Jahr) / Household (year) | 1 year | 34,99 € |
| `de.heidrichdigital.tohuus.plus.monthly` | Plus | 1 month | 5,99 € |
| `de.heidrichdigital.tohuus.plus.yearly` | Plus (Jahr) / Plus (year) | 1 year | 59,99 € |

Group ranking: Plus above Haushalt (upgrades take effect at once). Introductory offer: free trial of 2 weeks on the
Plus products (matches the server's 14-day trial; decide before launch, see the handover). Description (de):
"Ein Abo für den ganzen Haushalt. Mitglieder und Gäste zahlen nichts." (en: "One subscription for the whole
household. Members and guests never pay.")

App Store Server Notifications v2 (production and sandbox):
`https://cloud.tohuus.heidrich-digital.de/api/billing/apple/notifications`.

A screenshot of the paywall is required per product: run the `PaywallStoreKitTests` UI test with the StoreKit
configuration `ios/StoreKit/ToHuus.storekit`.
