# iOS: notifications, connections and data (native)

Status 14 Oct 2026. The web's Settings tabs **Notifications**, **Home Assistant**, **Displays**, **Printers & tickets**,
the integration parts of **Access & AI** and **Data & backups** now exist natively in the iPhone/iPad app. Everything
uses the same endpoints as the web app – no server changes were needed. Code:
`ios/ToHuus/Features/Settings/Integrations/` plus `ios/ToHuus/Features/Settings/NotificationSettingsView.swift`;
German strings: `ios/tools/strings_de_integrations.json`.

## Where it lives in the app

| Mehr › … | Screen | Web counterpart |
|---|---|---|
| Notifications | `NotificationSettingsView` | Settings › Notifications › “For me” (NotifyMine.tsx) |
| Notifications › For the whole household | `HouseholdNotifyView` | Settings.tsx `Notify` (shared channels, matrix, test, log) |
| Notifications › Telegram, Gotify & Matrix | `ChannelsView` (+ `TelegramPairSheet`) | Channels.tsx |
| Connections | `IntegrationsHubView` | – (one hub instead of four web tabs) |
| Connections › Home Assistant | `HomeAssistantView` (+ `HaTopicSection`, `HaIntegrationSetup`) | Ha2.tsx, HaIntegration.tsx |
| … › Home Assistant › Voice commands | `HaVoiceView` | Ha2.tsx `VoiceCard` |
| … › Home Assistant › Address & token | `HaAdvancedView` | Settings.tsx `HaConnection` (URL/token), ShopSettings.tsx `HaTodoCard` |
| Connections › Cookidoo | `CookidooView` | CookidooStatus.tsx + `HaConnection` (calendar, Save & sync) |
| Connections › Displays | `DisplaysView` (+ edit sheet, one-time link sheet with QR) | Displays.tsx |
| Connections › Printers & tickets | `PrintersView`, `PrinterEditSheet`, `TicketSheet` | Bons.tsx `PrintSettings`, `BonSheet` |
| Connections › Receipts by e-mail | `MailInboxView` | MailAddress.tsx (cloud) / Retail.tsx `InboxSettingsCard` (own server) |
| Data & backups | `DataSettingsView` (+ `MoveOutSection`, `MoveInSection`, `StartOverSection`) | Settings.tsx `Data`, MoveSettings.tsx, Tour.tsx `StartOver`, Billing.tsx “Your data” |
| Data & backups › Backups | `BackupsView` (+ restore sheet, restart wait) | DataSettings.tsx `Backups`, `Offsite` |

Permanent guests never see Connections or Data (the web shows them only “My account”). Members see the screens read-only
where the web does; only admins change household-wide things (`app.isAdmin`, from `GET /api/me`).

## What decides what is shown (cloud vs. own server)

- `app.isCloud` (session mode, same as the web's `instance.mode === 'cloud'`):
  - cloud: export via `GET /api/cloud/export`, “Bring a household from your own server” (`/api/cloud/import`), the
    cloud backup note; no backups screen (the server answers 404 for `/api/backups` and `/api/restore` there).
  - own server: export via `GET /api/export.json`, “Move to ToHuus Cloud” (`/api/move/info`, `/api/move/file`),
    Backups (admins).
- Receipts by e-mail: the receipt address shows when `GET /api/mail/address` says `available` (cloud with a receipt
  domain); the IMAP mailbox when `GET /api/retail/inbox` does not say `available: false` (own server). Neither → a plain
  “not available” state.
- Telegram/Gotify/Matrix, displays, printers and Home Assistant are shown in both modes, like the web.

## Endpoints used

- Personal notifications: `GET/PUT /api/notify/prefs` (events × apns/push/digest, homeOnly, quiet, preview, mailOff),
  `GET/PUT /api/shop/trips/privacy`, `GET /api/push/devices`, `DELETE /api/push/devices/:id`, `POST /api/push/apns/test`.
  Older servers without `/api/notify/prefs` fall back to the household matrix (as before).
- Household routing: `GET/PATCH /api/settings` › `notify`, `POST /api/settings/test-notification`, `GET /api/notifications`.
- Channels: `GET /api/channels`, `PUT /api/channels/telegram|gotify|matrix`, `POST /api/channels/telegram/pair`,
  `PATCH/DELETE /api/channels/telegram/chats/:id`, `POST /api/channels/:name/test`, `GET /api/shop/members`.
- Home Assistant: `GET /api/ha2`, `PATCH /api/ha2/settings`, `POST /api/ha2/detect|sync|apply-proposals`,
  `GET /api/ha2/tags`, `PATCH/DELETE /api/ha2/tags/:id`, `GET /api/ha2/voice` and its writes, `POST /api/ha/pair/start`,
  `GET /api/ha/pair/status`, `GET/PUT /api/shop/ha-todo`, `POST /api/shop/ha-todo/sync`,
  `GET /api/cook2/cookidoo/status`, `POST /api/plan/cookidoo-sync`.
- Displays: `GET/POST /api/displays`, `PATCH/DELETE /api/displays/:id`, `POST /api/displays/:id/rotate`.
- Printers & tickets: `GET /api/print/info`, `GET /api/print/printers`, `POST/PATCH/DELETE /api/print/printers[/:id]`,
  `POST /api/print/printers/:id/test`, `PUT /api/print/settings`, `GET /api/print/ticket.png`, `POST /api/print/print`,
  `POST /api/print/send`.
- Mail: `GET /api/mail/address`, `POST /api/mail/address/rotate`, `GET/PUT /api/retail/inbox`, `POST /api/retail/inbox/check`.
- Data: `GET /api/export.json` / `GET /api/cloud/export`, `POST /api/imports/catalog-csv` (multipart),
  `PATCH /api/settings {importAutoApply}`, `GET /api/move/info`, `GET /api/move/file?secrets=0|1`,
  `GET/POST /api/cloud/import` (multipart + password), `GET /api/tour/data`, `POST /api/tour/reset`.
- Backups: `GET/POST /api/backups`, `GET /api/backups/:name/download`, `DELETE /api/backups/:name`,
  `POST /api/backups/:name/restore {confirm:true}`, `POST /api/restore` (multipart), `PUT /api/backups/webdav`,
  `POST /api/backups/webdav/test`, then `GET /health` until the server is back.

## Implementation notes

- Settings and channel answers are read **without** the snake-case key conversion (`APIClient.ixRaw`): event keys such
  as `auth.new_device`, Gotify priorities and Home Assistant entity ids (`person.mika_b`) are dictionary keys there.
- Writes with free-form bodies go through `APIClient.ixRawSend` / `ixUpload`, which are `@MainActor` and serialise the
  `[String: Any]` body before the network call (nothing non-Sendable crosses actors).
- Files (export, move file, backups, ticket images) are downloaded with a long timeout into the temporary folder and
  handed to the share sheet (“Save to Files”, AirDrop …). Imports use `.fileImporter` (security-scoped URLs).
- Masked secrets (`••••`) are sent back unchanged where the server keeps the stored value (Telegram/Gotify/Matrix tokens,
  HA token, WebDAV password); the IMAP password is only sent when typed.
- “Start over” needs the confirmation word (`DELETE`/`LÖSCHEN`) when everything or the places go, like the web; the
  server makes a backup first. Restoring a backup shows a full-screen wait that polls `/health`.
- `TicketSheet(api:spec:)` can be opened from other screens (shopping list, week plan …) with a `TicketSpec`.

## Left in the web on purpose

- Turning on browser push for the web app (it is a browser permission); the app lists and removes those browsers.
- The server error log download for operators (`/diag/errors`) – the app has its own error log (Mehr › Error log).
- Access tokens / MCP / the HA YAML package fallback (Settings › Access & AI): AI settings area. HA itself is connected
  by code from the app.
- Bluetooth printing from the browser (Web Bluetooth, not available on iPhone in the web either).
