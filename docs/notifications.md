# Notifications

ToHuus Hub tells the household when something needs attention. There are two layers, both under
*Settings › Notifications (Einstellungen › Benachrichtigungen)*:

1. **For me** (every member, since 12 Oct 2026): which events reach *me* on *my* channels – iPhone push (APNs), browser
   push (Web Push) and an e-mail summary – plus quiet hours, "only when I'm at home" and what the lock screen may show.
   Calm defaults: only what is addressed to you is on.
2. **For the whole household** (admins): the shared channels – Home Assistant, ntfy, webhooks, Telegram, Gotify,
   Matrix and the household e-mail address – routed per event in a matrix.

## Per person (`server/lib/notify-prefs.ts`)

| Event | Default | Meaning |
|---|---|---|
| `trip.addon` | on | somebody added something to my shopping trip ("Bringst du noch Butter mit?") |
| `trip.started` | off | somebody started shopping ("Sam kauft gerade bei Lidl ein") – never to the shopper, never for private trips |
| `rhythm.due` | off | something is due again (once a day, morning) |
| `stock.expiring` | off | "Das habt ihr noch" runs out soon |
| `import.review` | off | a receipt was recognised and waits for a look |
| `plan.reminder` | off | Sunday evening: next week is still empty (only when the week plan is used) |
| `order.new` | on | a „Bring mir was“ wish |
| `guest.order` | off | an order from guests or a party (`order.new` with `kind` guest/party) |
| `budget.warning` | off | budget hint |
| `stock.low` | off | something is running low |
| `stock.empty` | off | something is used up |
| `shopping.added` | off | something was put on the list |
| `order.status` | on | news on my own „Bring mir was“ wish |
| `kids.wish` | on | a wish from the children (kid mode) |
| `plan.vote` | on | a vote on what to eat |
| `plan.rotation` | off | the week plan was filled from the rotation |
| `care.due` | off | a care task is due |
| `party.ending` | off | the party is ending |

Channels per event: `apns` (iPhone), `push` (browser), `digest` (one e-mail a day at the household's digest hour, to the
member's confirmed address – their own in self-host, their account's in the cloud). Events of an area the household
switched off ("Was nutzen wir?", `modules.ts`) disappear from the list and are not sent.

- **Quiet hours** (default 22:00–07:00, can be off): no phone or browser messages; urgent ones still come; the summary
  waits anyway.
- **Only at home** per event: skipped while the person is reported away. Presence comes from
  `POST /api/notify/presence { home: boolean, source: 'app'|'ha' }` (the iPhone app, Home Assistant later); older than
  12 hours counts as unknown, and unknown means "send".
- **Mails from ToHuus** (`mailOff`, default false): one switch per person for every optional mail – the e-mail
  summary and the renewal reminder (`renewals.ts`). Sign-in links, password resets and security notices always come.
  Every optional mail carries a signed link `GET /api/mail/unsubscribe/<token>` (`server/lib/mail-unsub.ts`, HMAC with
  a key derived from the master key in the cloud, a random secret in the settings when self-hosted) plus the headers
  `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 2369 / RFC 8058). GET only shows a
  page with one button (mail scanners open links); `POST` sets `mailOff: true`. Web: Settings › Notifications; iPhone:
  Mehr › Mitteilungen › Per Mail.
- **Lock screen**: `preview: 'full'` (the text) or `'generic'` ("ToHuus – Neues in ToHuus"), for iPhone and browser.

API (every member, about themselves):

| Endpoint | Body | Answer |
|---|---|---|
| `GET /api/notify/prefs` | | `{ events: [{ key, label, apns, push, digest, homeOnly }], quiet: { from, to } \| null, preview, mailOff, channels: { apns: { configured, devices }, push: { devices }, digest: { email } }, presence }` |
| `PUT /api/notify/prefs` | `{ events?: { [key]: { apns?, push?, digest? } }, quiet?: { from, to } \| null, homeOnly?: string[], preview?, mailOff?: boolean }` | `{ ok }` |
| `GET /api/mail/unsubscribe/:token` | (no sign-in, signed token) | HTML page with one button |
| `POST /api/mail/unsubscribe/:token` | form or `List-Unsubscribe=One-Click` | HTML page; `mailOff` is now true |
| `POST /api/notify/presence` | `{ home, source? }` | `{ home, source }` |

Since 13 Oct 2026 every event that reaches people is in this table, so each member decides for themselves; the
household matrix below only routes the shared channels (Home Assistant, ntfy, webhooks, chat, household e-mail) for
them. Not personal: sign-in warnings (`auth.new_device`, always to the person concerned), the household's daily
e-mail digest and tests.

## iPhone push (APNs, `server/lib/apns.ts`)

The app registers its device token after the person allowed notifications:

| Endpoint | Body | Answer |
|---|---|---|
| `POST /api/push/apns` | `{ token: hex (64–200), environment: 'production' \| 'sandbox', device?: string }` | `{ id, env, device, created_at, configured }` – re-registering the same token moves it to this member |
| `GET /api/push/apns` | | own devices `[{ id, env, device, created_at, last_ok_at, fails, tokenEnd }]` (never the token) |
| `DELETE /api/push/apns/:id` | | `{ ok }` (id or the token itself) |
| `POST /api/push/apns/test` | | `{ sent }` |

Payload: `{ aps: { alert, sound, thread-id: <event>, category? }, event, path, url: 'tohuus://shopping|today|pantry|cooking|money|more', data? }`. Categories with buttons: `TOHUUS_ADDON` for `trip.addon` (`data.request_id` = the list row; `POST /api/push/action` `addon-accept` / `addon-decline` – decline keeps the row on the list and only drops the claim), `TOHUUS_DUE` for `rhythm.due` (`data.product_id` when one product is due; `shop-add`). `data` carries ids only, as strings. The app side: [ios-api-0.2.md](ios-api-0.2.md).

Server configuration (environment only; the key is never written to the data volume):

| Variable | Meaning |
|---|---|
| `APNS_KEY_ID` | key id of the `.p8` key (App Store Connect › Users and Access › Keys) |
| `APNS_TEAM_ID` | developer team id |
| `APNS_KEY_P8` | content of the `.p8` file (PEM; `\n` escapes are fine) |
| `APNS_TOPIC` | the app's bundle id (default `APPLE_BUNDLE_ID` or `de.heidrichdigital.tohuus`) |
| `APNS_ENV` | `production`, `sandbox` or unset = what each device reported (TestFlight/App Store = production, Xcode debug builds = sandbox) |
| `APNS_HOST` | tests only: another endpoint (`http://localhost:…` speaks HTTP/2 without TLS) |

### iPhone push on a self-hosted server

APNs only accepts a provider token signed with a key of the developer team that publishes the app (team
`FVS7WVTQ67`, topic `de.heidrichdigital.tohuus`). That key stays with ToHuus Cloud, so a self-hosted server cannot
send push to the App Store app. What happens today:

- Without `APNS_*` the server answers `channels.apns.configured: false` in `GET /api/notify/prefs` and in the answer
  of `POST /api/push/apns`; the app still registers its device token, nothing is sent, and the iPhone app's
  notification settings show "not set up on this server". Everything else in the app works.
- Self-hosters who want notifications on the phone use Web Push (the web app added to the home screen, iOS 16.4+),
  ntfy, Telegram, Gotify, Matrix, e-mail or the Home Assistant companion app.
- `APNS_*` on a self-hosted server only makes sense for someone who builds and signs the iOS app with their own
  team and bundle id (`APNS_TOPIC` = that bundle id).

Open decision: a push relay run by ToHuus Cloud (self-hosted server → authenticated relay → APNs) would close the gap;
it is not built.

Delivery: HTTP/2 to `api.push.apple.com` / `api.sandbox.push.apple.com`, provider token ES256 (`kid`, `iss`, `iat`)
renewed every 50 minutes (and once more on `ExpiredProviderToken`), `apns-push-type: alert`, priority 10 only for
urgent messages, expiry 6 hours, `apns-collapse-id` from the de-duplication key. Tokens answered with 410,
`BadDeviceToken`, `Unregistered` or `DeviceTokenNotForTopic` are removed; ten failures in a row too.

Payload – nothing beyond what the person allowed, no ids of other people, no secrets:

```json
{ "aps": { "alert": { "title": "Mira: Bringst du Butter mit?", "body": "Steht jetzt auf deiner Liste." }, "sound": "default", "thread-id": "trip.addon" },
  "event": "trip.addon", "path": "/einkauf" }
```

With the generic lock screen: `"alert": { "title": "ToHuus", "body": "Neues in ToHuus" }`. The app opens `path`.
Tested against a fake HTTP/2 server that verifies the JWT signature (`test/list2-live.test.ts`).

## For the whole household (admins)

Each event can go to any number of shared channels; the matrix decides which. For the personal events above, the
"Push" column shows "pro Person".

## Channels

| Channel | Direction | Setup |
|---|---|---|
| **Web Push** | out, with action buttons | Install the app on the phone (home screen), then *Settings › Notifications › Push on this device*. Every member can add several devices. Keys are generated by the server. |
| **Telegram** | two-way | Create a bot with @BotFather, paste the token. Each member (or a family group) links their chat with a one-time link. Works behind NAT with long polling; webhook mode when `BASE_URL` is HTTPS. |
| **Gotify** | out | Server URL and an app token; priority per event. |
| **Matrix** | out | Homeserver, access token, room id. |
| **ntfy** | out | A topic URL. |
| **E-mail** | out | Needs `SMTP_*`. Recipient address in settings. |
| **Home Assistant webhook** | out | A webhook URL from an HA automation. With the HACS integration, every notification is also fired as `tohuus_hub_event` on the HA event bus. |
| **Any webhook** | out | n8n, Node-RED and the like receive JSON. |
| **Home Assistant companion app** | out, per member | Optional, under *Settings › Home Assistant*: send a member's notifications through their HA companion app instead of Web Push. |

## Events

| Event | When |
|---|---|
| `stock.low`, `stock.empty` | an item runs low or out (it also goes on the shopping list, unless switched off) |
| `stock.expiring` | best-before or use-by is near or passed (warning days are configurable) |
| `import.review` | an import waits for review |
| `order.new`, `order.status` | a new order from the sofa, a guest or a party; its status changed |
| `shopping.added` | something was added to the list |
| `digest.daily` | the daily overview at a chosen hour: use soon, running low, the list, a cooking idea |
| `care.due` | a home care task is due |
| `party.ending` | a party ends in 15 minutes (extend it in the app), and when it has ended |
| `kids.wish` | a child made a wish |
| `auth.new_device` | a new sign-in, only to the member concerned |
| `budget.warning` | a spending budget is likely to be exceeded |
| `plan.vote` | a family food vote started or finished |
| `plan.rotation` | the plan rotation filled upcoming weeks |
| `trip.started`, `trip.addon`, `rhythm.due`, `plan.reminder` | shopping trips, "Bringst du noch … mit?", due again, week plan reminder (list2; phones and browsers per person) |

Push and Telegram messages carry buttons where it makes sense ("Add to list", "Accept"); they run the same actions as in the app, as the member who tapped them.

During a trip, notifications stay quiet (see *Trip / away*). Repeated warnings for the same thing are de-duplicated.

## Telegram commands

Plain text in a private chat goes on the shopping list (the same natural-language parser as quick add). Photos and PDFs become imports waiting for review. Commands (German names): `/liste` (shopping list), `/heute` (today), `/wo` (where is …), `/kochen` (what to cook), `/kaufen` (add to the list), `/hilfe` (help). Unknown chats get a polite "not linked".

If you run your own [Telegram Bot API server](https://github.com/tdlib/telegram-bot-api), point `TELEGRAM_API_URL` at it.

## Privacy

Discreet items show only their placeholder, private items not at all, on every channel. Permanent guests only get messages addressed to them. Bot tokens, app tokens and passwords are stored in settings fields that the JSON export drops.

Code: [`server/lib/notify.ts`](../server/lib/notify.ts), [`server/lib/notify-prefs.ts`](../server/lib/notify-prefs.ts), [`server/lib/apns.ts`](../server/lib/apns.ts), [`web/src/pages/NotifyMine.tsx`](../web/src/pages/NotifyMine.tsx), [`server/lib/webpush.ts`](../server/lib/webpush.ts), [`server/lib/channels.ts`](../server/lib/channels.ts), [`server/lib/telegram.ts`](../server/lib/telegram.ts).
