# iOS native – Geld & Bons (wave 3, 14 Oct 2026)

What the native app now does in the money and receipts area, compared with the web pages `Money.tsx`, `Spending.tsx`,
`money/*`, `Imports.tsx`, `ImportReview.tsx`, `QualityReport.tsx`, `MailAddress.tsx` and `Retail.tsx` (inbox card).
The household recognition page (`Recognition.tsx`) is `Settings/Account/ReceiptRecognitionView.swift` and Bons/printers
(`Bons.tsx`) are `Settings/Integrations/PrintersView.swift` (`TicketSheet`) – built by those areas in the same wave;
this area links to them instead of keeping a second copy. Same endpoints as the web, no server changes. Works with ToHuus Cloud and self-hosted;
self-host-only parts (receipt inbox, network printers) hide themselves when the server says they are not available.

## Native now

| Web | iOS | Endpoints |
|---|---|---|
| Geld: month, total, budget bar, per week, by category/shop, price changes, hints, money lists, cheapest | `Features/Money/MoneyView.swift` (budget line now like the web: “x % of … · … left” / “… over the budget of …”, “So far this month”, history-limited note) | `GET /api/money/overview` |
| Geld: “Who is ahead” (flat shares) | `WgBalanceCard` (Shopping) is now shown on the Geld tab, household view only | `GET /api/wg/balance?month=` |
| Spending in detail, budgets, things left out, price history | `SpendView`, `SpendSheets` (unchanged) | `/api/spend/*` |
| “Where the money went” composition | Swift Charts stacked bar (goods / deposit), values as text, facts beside it | `GET /api/spend/stats` |
| Export | CSV and JSON for the period, “Everything (CSV)” – into the share sheet | `GET /api/spend/export?format=csv|json` |
| Receipt: split only some items | `SpendReceiptView`: “Split only some items” → tick lines → “Split the selection (n)” → money list | `POST /api/money/lists { from: { kind: 'entries', keys } }` |
| Import review: who paid, for whom (incl. care lists), just mine | `Features/Receipts/WhoPaidPanel.swift` on `ImportReviewView` | `GET /api/imports/:id`, `POST /api/imports/:id/split`, `POST /api/spend/receipts/:id/personal` |
| Import review: recognition card, grade badges, store fix, “Help improve recognition” | `RecognitionCard.swift` (`RecognitionCardView`, `GradeBadge`, `StorePickSheet`, `FixtureSheet` – share file / GitHub issue / e-mail after the person confirmed the preview) | `GET /api/quality/imports/:id`, `PATCH …/store`, `GET …/fixture?names=` |
| Receipt recognition page (`/import/quality`) | linked from Receipts and from the recognition card: `ReceiptRecognitionView` (Settings/Account) | `GET /api/quality/stats`, `/api/quality/rules` |
| Receipt address (cloud) | `MailAddressSection`: copy, share, forwarding how-to (Gmail, Outlook, iCloud), counters incl. discarded, admin “New address” with confirmation | `GET /api/mail/address`, `POST /api/mail/address/rotate` |
| Receipt inbox (self-hosted) | `InboxViews.swift`: `InboxStatusCard` (status, check now, forward address); admins open the settings (`MailInboxView`, Settings/Integrations) from its gear or from the “connect a mailbox” card | `GET /api/retail/inbox`, `POST /api/retail/inbox/check` |
| Imports: photo “Cupboard / freezer” | `StocktakeSheet` (camera or photos, optional place, hint when the server has no image model) | `POST /api/imports/upload mode=shelf location_id` |
| Imports: text mode | `TextImportSheet` | `POST /api/imports/upload text=` |
| Bons, printers & tickets | linked via `MoneyRoute.printers` → `PrintersView(api:)` (Settings/Integrations) | `/api/print/*` |

Entry points: Geld → “Receipts” → actions (cupboard, text), receipt address / inbox cards, “Receipt recognition”.
“Add receipt” sheet has the same two new actions and the inbox card. Each import review shows the recognition card.

Charts follow the dataviz rules of the web: one hue per series, values as text, anchored at zero, no ranking of people
(the WG card keeps the server's order and speaks in sentences; ToHuus never moves money).

## Debug launch args (DEBUG builds)

`-debugMoney recognition` (receipts → recognition), `-debugMoney printers`, plus the existing `detail`, `receipts`,
`review:<id>`, `receipt:<id>`, `list:<id>`, `newlist`, `settings`, `expense`, `mine`, `prices`, `price:<id>`.

## Strings

German in `ios/tools/strings_de_money2.json` (web wording where the web has the same text).

## Left on the web on purpose

- Nothing in this area. Bluetooth printing from the browser stays web-only (Web Bluetooth); see Settings/Integrations.
