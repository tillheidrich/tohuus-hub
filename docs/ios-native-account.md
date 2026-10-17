# iOS native: account, security, household basics, AI settings

Status 14 Oct 2026. Everything the web's Settings tabs offer for account, security, household basics, appearance,
region, modules and AI/access now exists natively in the iPhone/iPad app (no `WebPageView`), for ToHuus Cloud and
self-hosted servers. Code: `ios/ToHuus/Features/Settings/Account/`, strings: `ios/tools/strings_de_account.json`.

## Screens

| Screen | File | Web source | Endpoints |
|---|---|---|---|
| Mein Konto & Sicherheit | `MyAccountView.swift`, `AccountSheets.swift` | `AuthSettings.tsx` MyAccount | `GET /api/auth/me`, `PATCH /api/cloud/me` (cloud name) or `PATCH /api/users/:id { name }` (self-hosted), `POST/DELETE /api/auth/me/email`, `POST /api/auth/me/password`, `POST /api/auth/me/totp/{setup,enable,disable}`, `PUT/DELETE /api/auth/me/pin`, `DELETE /api/auth/me/sso`, `PATCH/DELETE /api/auth/passkeys/:id` |
| Passkey anlegen | `PasskeyRegistration.swift` | `AuthSettings.tsx` Passkeys | `POST /api/auth/passkeys/options { password? , code? }`, `POST /api/auth/passkeys { response, name }` |
| Angemeldete Geräte | `SignedInDevicesView.swift` | `AuthSettings.tsx` Devices | `GET/DELETE /api/auth/app/devices[/:id]`, `GET/DELETE /api/auth/sessions[/:id]`, `POST /api/auth/sessions/others` |
| Anmeldewege (admins, self-hosted) | linked from Mein Konto to `Features/Household/People/SignInAdminView.swift` (people area) | `AuthSettings.tsx` SignInAdmin | `/api/auth/policy`, `/api/auth/sso`, `/api/auth/members` |
| Haushalt (name, language) | `HouseholdBasicsView.swift` | `Settings.tsx` Household | `GET/PATCH /api/settings { household, language }` |
| Darstellung | `HouseholdBasicsView.swift` (`AppearanceSettingsView`) | `AppearanceSettings.tsx` | `GET /api/appearance`, `PATCH /api/appearance/household { theme, userChoice }`, `PATCH /api/appearance/me { theme \| null }` |
| Region | `RegionModulesViews.swift` (`RegionSettingsView`) | `RegionSettings.tsx` | `GET/PATCH /api/region`, `POST /api/region/stores` |
| Was nutzt ihr? | `RegionModulesViews.swift` (`ModulesView`) | `Modules.tsx` | `GET/PUT /api/modules` |
| Mit oder ohne KI (extended) | `../AISettingsView.swift` | `AiSettings.tsx` AiSwitchesCard, `Memory.tsx` AssistantPrivacyCard, `Settings.tsx` Access (status line) | `GET/PATCH /api/ai/settings`, `GET/PATCH /api/assistant/settings { healthShare }`, `GET /api/settings` (features) |
| Mit Claude oder ChatGPT verbinden | `AssistantAccessViews.swift` (`ConnectAssistantView`) | `AiSettings.tsx` ConnectAssistantCard | `GET/DELETE /api/oauth/connections[/:id]` |
| Zugangsschlüssel (admins) | `AssistantAccessViews.swift` (`AccessTokensView`) | `Settings.tsx` Access | `GET/POST /api/tokens`, `DELETE /api/tokens/:id` |
| Bon-Erkennung | `ReceiptRecognitionView.swift` (also opened from Imports, Money and the recognition card) | `Recognition.tsx` | `GET /api/quality/stats`, `GET /api/quality/rules`, `PATCH/DELETE /api/quality/rules/:id` |

## Cloud vs. self-hosted

- **Name**: cloud renames the account and every membership (`AppModel.rename`), self-hosted patches the member row.
- **E-mail**: self-hosted members add/change/remove it (confirmation mail, needs SMTP); in the cloud it is the account
  address and shown read-only (the web has no change either).
- **Password**: both via `POST /api/auth/me/password`; minimum from `/api/instance` (`passwordMin`, cloud 10, self-host 8).
- **Two-step sign-in, PIN, SSO, Anmeldewege**: self-hosted only (the cloud routes answer `notInCloud`), exactly as the web.
- **Passkeys**: list, rename, remove everywhere. *Creating* one needs the server's relying party (host of `BASE_URL`)
  in the app's associated domains (`webcredentials:cloud.tohuus.heidrich-digital.de` in `ios/project.yml`,
  `PasskeyHosts.associated`). So the app creates passkeys for ToHuus Cloud only; on a self-hosted server it says so
  plainly and links to the account page in Safari, where the passkey is made (for browser sign-ins; the app's
  passkey sign-in is cloud-only for the same reason). Cloud confirms first: the account password, or, for accounts without one, the
  6-digit code from the mail (`{ code }`, new on 14 Oct 2026).
- **Billing**: unchanged, `SettingsView` › Plan & storage + `PaywallView` (cloud only; self-hosted shows "Own server").

## Left out on purpose

- "This is a shared family device" (PUT /api/auth/device): marks a *browser* (device cookie) for the PIN switch; the
  app has no such cookie. The PIN itself is set natively.
- Linking SSO opens the provider in the in-app web view (`/api/auth/oidc/start?link=1`, signed in with the one-time
  web link) – it is the provider's own sign-in page, not a settings page.
- The Home Assistant YAML fallback package for a new `ha` access key (the HA area covers Home Assistant).

## Server change

`POST /api/auth/passkeys/options` (cloud) accepts `{ code }` – the code from the confirmation mail – so password-less
accounts can add a passkey in the app. Test: `test/cloud-passkeys.test.ts` ("an account without a password confirms
a new passkey in the app with the code from the mail").
