# NFC tags

*14 Oct 2026 · iOS `ios/ToHuus/Features/Pantry/NFCLabels.swift` · web `web/src/pages/Labels.tsx` · server `server/lib/cloud-passkeys.ts` (AASA)*

An NFC tag holds exactly what a ToHuus QR label holds: the link `<server>/q/<code>` with a random code (`POST /api/qr`,
`qr_codes`). Nothing about the household is on the tag; only signed-in household members can use the link.

- **Write** – iPhone: QR labels › pick one › *NFC-Tag* (Core NFC, NDEF URI record; locked tags are refused).
  Web: Chrome on Android shows *NFC-Tag* next to each label in the preview (Web NFC). Safari has no Web NFC.
- **Read in the app** – iPhone: Vorrat › *NFC-Tag lesen* opens the same quick actions as a scanned QR label
  (took one, opened, on the list, where is it, task done).
- **Read from the lock screen** – iPhones read NDEF tags in the background. On ToHuus Cloud the link is a universal
  link (`applinks:` associated domain, `/q/*` in `/.well-known/apple-app-site-association`) and opens the app at the
  label; on a self-hosted server it opens the web app.

Entitlement `com.apple.developer.nfc.readersession.formats: [TAG]`, purpose string `NFCReaderUsageDescription`.
Till: enable *NFC Tag Reading* and *Associated Domains* for `de.heidrichdigital.tohuus` in the developer account.
