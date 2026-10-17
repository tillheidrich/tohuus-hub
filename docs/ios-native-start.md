# iOS native: start, own server, Heute, first run, help (14 Oct 2026)

Decision 14 Oct 2026: the App Store app works with **ToHuus Cloud and a self-hosted ToHuus server**. The cloud stays
the main path on the start screen; "Eigener Server" is a quiet second path. Self-host has everything unlocked (no
paywall, no Sign in with Apple, no account deletion – accounts there are members of the household, managed by its
admins).

## Start screen (`ios/ToHuus/Features/Start/`)

| File | What |
|---|---|
| `StartView.swift` | brand, notice, **saved connections** ("Auf diesem iPhone", one tap back in, long press to remove), cloud (Apple, create account, sign in), "Eigener Server" + "QR-Code scannen", legal. `StartView(adding: true)` is the same screen as a sheet to add another server/account while signed in. |
| `OwnServerView.swift` | address → `ServerCheck` (GET `/api/instance`, falls back to `/api/auth/options` to recognise servers that are too old) → sign in: name or e-mail + password with the two-step code (`401 { needCode }` from `POST /api/auth/app`), **Im Browser anmelden**, **QR-Code scannen**, **Code eingeben**. Also `ConnectLinkSheet` ("Mit … verbinden?") and the `.connectLinkSheet()` modifier for `tohuus://connect` links. |
| `ConnectKit.swift` | `ServerCheck` (helpful errors: no https outside the home network, typo/DNS, unreachable, certificate, offline, not ToHuus, too old), `ConnectLink`, `ConnectInbox`, `PKCE`, `BrowserSignIn` (ASWebAuthenticationSession, callback scheme `tohuus`), `SavedConnection` + `ConnectionVault` (several servers/accounts; tokens in the Keychain, never the active one), `AppModel.signInOwnServer / claimPairCode / signInInBrowser / connect / openSaved / rememberCurrentConnection`. |
| `ConnectionsView.swift` | Mehr › "Server & Haushalte": active household (+ the other households of this account), other connections on this iPhone (switch, swipe to remove), add another, `PairCodeView` (QR code to connect another iPhone/iPad). |
| `FirstRunView.swift` | first-run setup (see below) and `.firstRunSetup(store:)`. |

Ways in for an own server:

1. **Password**: `POST /api/auth/app { name|email, password, device, code? }`. A `401` with `needCode: true` shows the
   code field (authenticator code or recovery code).
2. **Browser**: `GET /api/auth/app/pair/start?challenge=<PKCE>` in ASWebAuthenticationSession (shares Safari's
   sign-in and saved passkeys). Signed out, the server redirects to the web sign-in (`/?next=…`, web `App.tsx` follows
   it after signing in) – passkey, e-mail link, SSO, whatever the household allows. Then `302 tohuus://connect?…` →
   `POST /api/auth/app/pair/claim { code, device, verifier }`.
3. **QR code / code**: web app Settings › My account › "iPhone-App verbinden" (`web/src/pages/AppConnect.tsx`,
   `POST /api/auth/app/pair`). The camera opens `tohuus://connect?server=…&code=…` (→ `ConnectInbox` → sheet), or the
   app scans it on the start screen, or the 8-character code is typed in.

Native passkeys (ASAuthorization) only work for hosts in the app's associated domains, i.e. ToHuus Cloud. On an own
server the passkey is used through the browser sign-in instead.

Several servers: signing in while signed in (`finishSignIn`) keeps the previous session in `ConnectionVault`;
`openSaved` swaps sessions via `restore()`. Signing out removes only the active one; the others stay on the start
screen.

Cloud-only places checked for self-host: billing/paywall (`purchasesAvailable` false → "Everything is included"),
Settings shows the host instead of "ToHuus Cloud" and hides rename/delete account (cloud), legal links fall back to the
ToHuus site, Cloud recipe catalogue is cloud only, `minIosBuild` only comes from the cloud. After an own-server
sign-in the app loads that server's `/api/instance` (features, legal links).

## Heute (`ios/ToHuus/Features/Today/`)

`TodayView.swift` + `TodayExtras.swift`, web `pages/Today.tsx`:

- date line, greeting + Platt, household, **+** (adds to the list), avatar → Mehr
- notices with their target (`path` from `/api/today`): imports open the receipt list, money/shopping/pantry/cooking
  switch the area
- sample-data nudge, **getting-started checklist** (admins, `GET /api/onboarding` → `showChecklist`, hide with
  `POST /api/onboarding/checklist/dismiss`; items open the setup, invitations, pantry, notifications, cooking)
- cards in the person's own order (`GET/PUT /api/list/today-order`, "Karten anordnen" = native reorder sheet with
  undo): Fällig (empty → the three ways in: receipt, photo of the list, speak/type), Aufgaben, Liste, Das habt ihr
  noch, Heute kochen? (planned vs idea, time, probably at home, recipe opens), Geld (month, left/over budget), the
  weekly question (`GET/POST /api/pulse`)
- guests see only what their level allows (`MoreAccess.guestAllows`), switched-off areas disappear

Server fix: `TODAY_CARDS` accepts `tasks` (the web sent it and got 400).

## First run (`FirstRunView.swift`)

Web `pages/Onboarding.tsx`: Wer gehört dazu? (form + name, `PUT /api/onboarding/home`) → Was nutzt ihr?
(`GET/PUT /api/modules`) → Wo kauft ihr meistens ein? (only when not asked at sign-up,
`GET /api/shop/stores/choices`, `PUT /api/shop/stores/choice`) → Wo ist eure Liste heute? (paste / photo / fresh) →
30 Sekunden: was fehlt? (`POST /api/shop/quick-add`) → Wer kauft sonst ein? (`POST /api/invites`, QR + share sheet;
not for one-person households) → Bon teilen + notifications (soft ask). Progress: `PATCH /api/onboarding { step }`,
closing `{ closed, skipped }`. Opens once per launch for an admin of a new household (`wizardDue`), after the
sample-data question, the tour and the AI question. Help › "Einrichtung noch mal starten" and the checklist open it too.

Server fix: the checklist item "phone" now also counts the iPhone app with notifications (`apns_devices`).

## Help, tour, samples, labels

- `Features/Help/HelpCenterView.swift`: tour, setup again, the web's in-app how-tos adapted to the iPhone (searchable),
  the website articles, feedback mail.
- `Features/Help/AppTourView.swift`: pages for "adding takes seconds" and "stock is optional"; money/cook pages only
  when those areas are on.
- `Features/Samples/SampleViews.swift`: "Load sample data" in Mehr when the household is still empty.
- `Features/Help/LabelQuickActionView.swift`: web `QuickAction.tsx` – a scanned label: product (took one, opened,
  add to list, where it is kept), place (what is in there), care task (done); boxes go to `BoxDetail`.

## Debug launch arguments

`-debugStartOwnServer YES [-debugOwnServer tohuus.local]` opens "Eigener Server"; `-debugFirstRun YES` opens the
first-run setup.
