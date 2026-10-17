# App Review: notes, App Privacy, age rating, in-app purchases

What Till enters in App Store Connect for ToHuus (app id 6822059656, bundle `de.heidrichdigital.tohuus`). Written
13 Oct 2026 for build 1.0.0 (6). Review notes are in English (Apple reviews in English); the store texts themselves
are German and English.

## 1. Review notes (App Review Information › Notes)

Moved to [ios-app-review.md](ios-app-review.md) (14 Oct 2026, with the full guideline checklist): the app now also
works with an own server, the assistant button is the round sparkle (no "Sprechen"), the AI consent names Mistral and
OpenRouter, and the review household must be left out of the beta gift (`BETA_GIFT_EXCEPT`) so the plans can be bought.

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

AI: content sent to the language model (Mistral through OpenRouter) is processed on our behalf for App Functionality
and not used for training – it is covered by the types above, not "shared with third parties for their own use".

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
