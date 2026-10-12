# Receipts and imports

Stock and spending come in through what a household already gets: order notices, digital receipts, receipt e-mails and photos. Every import waits in a review before anything is booked, unless *Import without asking* is on and every line was recognised with confidence.

Where: *Imports (Importe)* for uploads and the review, *Imports › Receipt recognition (Importe › Bon-Erkennung)* for statistics and learned rules, *Settings › Access & AI › Receipts by e-mail* for the inbox.

## Three ways in – whatever the household's digital level

| Level | How | What happens |
|---|---|---|
| Full grocery delivery | REWE pickup/delivery notice and eBon (PDF, e-mail inbox, share sheet) | parsed exactly, reconciled with the order, review or automatic booking |
| Any receipt on paper or screen | photo, screenshot or PDF of any receipt (Aldi, Lidl, bakery …) | read by the vision model through `server/lib/ai.ts` – on OpenRouter pinned to Mistral in the EU with no data collection; receipt *text* (PDFs, mails, digital receipts) goes out with card, loyalty, TSE and address data removed (`redact.ts`); a receipt whose lines don't add up to its total gets a second try with `AI_MODEL_VISION_HARD`. Photos are scaled down and sent as they are (blurring regions of a photo would need OCR first) |
| Just saying it | the assistant: "Hab bei Aldi Milch, Eier und Brot für 12,40 gekauft" (typed or spoken; works without a model too) | a receipt in review dated with the purchase day (it counts for the purchase rhythm at once), a manual expense with the total for the money overview, matching list rows ticked off. The receipt lines carry no prices, so applying it later never counts money twice. Undo removes all of it |

Receipts count for the purchase rhythm by the date printed on them (`imports.meta.date`), not by when someone approved them, and already while they wait in review.

## Supported documents

| Source | Status |
|---|---|
| REWE pickup / delivery notice (*Abholavis*, *Lieferavis*, PDF) | ✅ substitutions, unavailable items, reduced quantities, weighed goods, deposits |
| REWE eBon (PDF) | ✅ quantities, weights, deposits and returns; matched to the order by order number, or by market and day, so whatever you handed back at pickup does not end up in stock |
| Digital receipts behind a QR link | ✅ PDF or HTML behind the link |
| Receipts by e-mail (IMAP inbox) | ✅ forward eBons and order mails to a mailbox; PDF attachments and HTML or text receipts become imports. Mails are never deleted. |
| Any receipt, shelf or recipe photo | ✅ with a vision model (`AI_*`, or the older `VISION_*`), or through your MCP assistant |
| Purchase history CSV (e.g. the REWE data export) | ✅ builds the product catalogue and receipt aliases (*Settings › Data & backups*) |
| Lidl, Aldi Süd/Nord, Edeka, Netto, Kaufland, Penny, Norma, Globus, tegut, dm, Rossmann, Müller, Budni (PDF or text) | 🧪 generic German parser, tested with synthetic fixtures |
| Tesco, Sainsbury's, Asda, Morrisons, Waitrose, M&S, Co-op, Aldi UK, Lidl GB, Boots, Superdrug | 🧪 UK parser: £ amounts, Clubcard and Nectar prices, multibuy and meal-deal savings, `kg @ £/kg`, carrier bags as fees |
| Walmart, Target, Costco, Kroger, Trader Joe's, Whole Foods, Safeway, Aldi US, CVS, Walgreens | 🧪 US parser: UPCs and tax flags stripped, sales tax added on top, coupons, BOGO and `0.50-` savings, `lb @ $/lb`, bottle deposits (CRV, BTL DEP) |
| ICA, Coop, Willys, Hemköp, Lidl SE, City Gross, Apotek Hjärtat | 🧪 Swedish parser: `1 234,56 kr`, the ICA column layout, Stammis, medlemspris, Willys Plus and "2 för" discounts, pant and pantretur, `kg x kr/kg` |

✅ supported, 🧪 parser tested with synthetic fixtures only. Real receipts are welcome as anonymised issues (see below).

Receipts are recognised by store and currency signs first, so a Tesco receipt from a holiday still reads correctly in a German household.

What the generic German parser understands line by line (tax codes, quantity lines before or after the item, weighed goods, deposits and empties, item and whole-purchase discounts, voids, returns) is written up in [research/2026-10-11-bons.md](research/2026-10-11-bons.md). Only REWE, EDEKA (QR or e-mail) and Kaufland (share as PDF) reliably give a household a PDF; for the others, a photo, pasted text or the e-mail inbox are the realistic paths.

## The review

Each import shows its lines with the matched product, quantity, unit, price and target place. Substitutions and refused items from order notices are flagged; deposits are never booked into stock; returns are skipped by default. New products are created on apply. Receipt abbreviations are remembered per product.

A recognition card per import grades each line: recognised, from a rule you taught, corrected, new or not recognised.

## Learning from corrections

When you correct a line (product, quantity, unit, price, or "ignore this line") or the store, ToHuus Hub saves a rule for that receipt text and store. Next time the same line is filled in by the rule. A corrected store is recognised from then on by its VAT id or its first header line. There is no built-in list of chain VAT ids on purpose: they differ by company and region and change.

*Imports › Receipt recognition* shows how many lines on recent receipts were recognised without a correction, per store, and lists the learned rules. Delete a rule there if it was wrong. MCP: `list_receipt_rules`, `delete_receipt_rule`, `receipt_recognition_stats`, `receipt_recognition_report`.

## Help improve recognition

In an import, *Help improve recognition (Erkennung verbessern helfen)* builds an anonymised copy of the receipt for the project's test fixtures. It keeps what a parser needs (store chain, item lines with prices, quantity, weight, deposit and discount lines, totals, the tax table) and removes or blurs:

- store address, phone numbers, branch, till and operator numbers, the store's VAT or tax number;
- payment card numbers, terminal, trace and authorisation ids, IBANs;
- loyalty programmes (PAYBACK, DeutschlandCard, Lidl Plus, Kaufland Card, REWE Bonus and others): card numbers, points, balances;
- names (cashier, customer, greetings), e-mail addresses, links with personal tokens;
- TSE data (transaction number, signature counter, serial numbers, signature, start and stop time);
- dates move to the 1st of their month, times are rounded down to the full hour; long digit runs outside item lines are always masked.

You see the result and what was removed, then decide: download it, open a prefilled GitHub issue, or open a prefilled e-mail (to `RECEIPT_FEEDBACK_MAIL` if set). Nothing is sent automatically. For photos there is no receipt text, so the copy is rebuilt from the recognised lines.

The code is in [`server/lib/redact.ts`](../server/lib/redact.ts) (pure function) and [`server/lib/quality.ts`](../server/lib/quality.ts).

## Adding a parser

Parsers live in [`server/importers/`](../server/importers/): `rewe.ts`, `generic.ts` (German tills) and `intl.ts` (UK, US, Sweden). Fixtures are in `test/fixtures/`, the synthetic receipt fixtures in `test/fixtures/receipts/`. Every synthetic fixture must add up to its printed total after parsing; `test/quality.test.ts` checks that. Real receipts used during development belong in the git-ignored `test/fixtures/private/`.
