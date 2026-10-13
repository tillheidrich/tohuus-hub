# Error log ("Fehlerprotokoll")

Errors from the server and from the apps in one place, so a screenshot with "Code 219017d1" can be looked up, and
so failures nobody reports are seen at all.

Code: `server/lib/errorlog.ts`, `server/routes/diag.ts`, web `web/src/diag.ts` + `web/src/pages/operator/Errors.tsx`,
iOS/Watch `ios/ToHuus/Core/API/ErrorLog.swift` + `ios/ToHuus/Features/Settings/ErrorLogView.swift`.
Tests: `test/errorlog.test.ts`, `test/cloud-admin.test.ts` › error log.

## What goes in

| Source | What |
|---|---|
| `server` | every HTTP 500 with its reference code (the one in "Das hat leider nicht geklappt … nenn uns den Code …"), method + path, error name, stack |
| `web` | the crash card (render errors, chunks), uncaught errors, unhandled promise rejections (not API 4xx) |
| `ios` / `watch` | server errors (5xx) the app got, answers the app could not decode (type + decoding error) |

Apps report with `POST /api/diag/errors { source, errors: [{ message, stack?, kind?, route?, status?, appVersion?, platform? }] }`
(signed in or not, at most 20 per call, 60 calls per 10 minutes per address).

## Privacy

No request bodies, no list, receipt, recipe or message content. Messages and stacks are cut (500 / 4 000 characters)
and scrubbed of e-mail addresses, tokens, long hex/base64 runs and long numbers; paths lose their query string, ids
become `:id`, guest tokens `:token`. The household is kept as its id only (cloud, when the reporter is signed in).
The same error at the same place within an hour is one row with a count. Kept **30 days**. Stored in accounts.db
(cloud, encrypted) or the household database (self-hosted).

App Store "App Privacy": *Diagnostics › Crash data / Other diagnostic data* – used for app functionality, linked to
the household id when signed in, not used for tracking.

## Where to read it

- **ToHuus Cloud**: back office `/betrieb` › **Fehler** – search by code, text or path, filter by source and period,
  download **CSV** or **JSON** (30 days). API `GET /api/operator/errors?source=&q=&days=&format=csv|json`.
- **Self-hosted**: Settings › Daten › Fehlerprotokoll (admins), `GET /api/diag/errors` with the same parameters.
- **iPhone**: Einstellungen › Fehlerprotokoll – the last 200 entries on this device, "Fehlerprotokoll teilen" (text
  file via the share sheet, e.g. mail to the developer), "Noch mal senden", "Leeren".
- The server log still has every 500 as `[error <ref>]`.
