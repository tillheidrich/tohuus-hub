# Receipts and imports

Stock and spending come in through what a household already gets: order notices, digital receipts, receipt e-mails and photos. Every import waits in a review before anything is booked, unless *Import without asking* is on and every line was recognised with confidence.

Where: *Imports (Importe)* for uploads and the review, *Imports › Receipt recognition (Importe › Bon-Erkennung)* for statistics and learned rules, *Settings › Access & AI › Receipts by e-mail* for the inbox.

## Three ways in – whatever the household's digital level

| Level | How | What happens |
|---|---|---|
| Full grocery delivery | REWE pickup/delivery notice and eBon (PDF, e-mail inbox, share sheet) | parsed exactly, reconciled with the order, review or automatic booking |
| Any receipt on paper or screen | photo, screenshot or PDF of any receipt (Aldi, Lidl, bakery …) | photos: **text recognition on the server first** (Tesseract, no AI, see below) and the same parsers as for PDFs; only when the lines do not add up to the printed total – and AI is on and within quota – read by the vision model through `server/lib/ai.ts` – on OpenRouter pinned to Mistral in the EU with no data collection; receipt *text* (PDFs, mails, digital receipts) goes out with card, loyalty, TSE and address data removed (`redact.ts`); a receipt whose lines don't add up to its total gets a second try with `AI_MODEL_VISION_HARD`. Photos are scaled down and sent as they are (blurring regions of a photo would need OCR first) |
| Just saying it | the assistant: "Hab bei Aldi Milch, Eier und Brot für 12,40 gekauft" (typed or spoken; works without a model too) | a receipt in review dated with the purchase day (it counts for the purchase rhythm at once), a manual expense with the total for the money overview, matching list rows ticked off. The receipt lines carry no prices, so applying it later never counts money twice. Undo removes all of it |

Receipts count for the purchase rhythm by the date printed on them (`imports.meta.date`), not by when someone approved them, and already while they wait in review.

## Supported documents

| Source | Status |
|---|---|
| REWE pickup / delivery notice (*Abholavis*, *Lieferavis*, PDF) | ✅ substitutions, unavailable items, reduced quantities, weighed goods, deposits |
| REWE eBon (PDF) | ✅ quantities, weights, deposits and returns; matched to the order by order number, or by market and day, so whatever you handed back at pickup does not end up in stock |
| Digital receipts behind a QR link | ✅ PDF or HTML behind the link |
| Receipts by e-mail (IMAP inbox) | ✅ forward eBons and order mails to a mailbox; PDF attachments and HTML or text receipts become imports. Mails are never deleted. |
| Any receipt photo | ✅ text recognition on the server (Tesseract) + parsers; the vision model only as a second reader |
| Shelf or recipe photo | ✅ with a vision model (`AI_*`, or the older `VISION_*`), or through your MCP assistant |
| Purchase history CSV (e.g. the REWE data export) | ✅ builds the product catalogue and receipt aliases (*Settings › Data & backups*) |
| EDEKA of an independent merchant (merchant name in the header, "Edeka Markt" on the card slip, till footer `Datum Uhrzeit Filiale Pos Bed Bon`) | ✅ tested with an anonymised real receipt (`test/fixtures/receipts/edeka-kaufmann.txt`): shop EDEKA, date and time from the footer, deposit linked to the drink above it, tax code glued to the price (`0,25*B`) |
| Lidl, Aldi Süd/Nord, Edeka, Netto, Kaufland, Penny, Norma, Globus, tegut, dm, Rossmann, Müller, Budni (PDF or text) | 🧪 generic German parser, tested with synthetic fixtures |
| Tesco, Sainsbury's, Asda, Morrisons, Waitrose, M&S, Co-op, Aldi UK, Lidl GB, Boots, Superdrug | 🧪 UK parser: £ amounts, Clubcard and Nectar prices, multibuy and meal-deal savings, `kg @ £/kg`, carrier bags as fees |
| Walmart, Target, Costco, Kroger, Trader Joe's, Whole Foods, Safeway, Aldi US, CVS, Walgreens | 🧪 US parser: UPCs and tax flags stripped, sales tax added on top, coupons, BOGO and `0.50-` savings, `lb @ $/lb`, bottle deposits (CRV, BTL DEP) |
| ICA, Coop, Willys, Hemköp, Lidl SE, City Gross, Apotek Hjärtat | 🧪 Swedish parser: `1 234,56 kr`, the ICA column layout, Stammis, medlemspris, Willys Plus and "2 för" discounts, pant and pantretur, `kg x kr/kg` |

✅ supported, 🧪 parser tested with synthetic fixtures only. Real receipts are welcome as anonymised issues (see below).

Receipts are recognised by store and currency signs first, so a Tesco receipt from a holiday still reads correctly in a German household.

What the generic German parser understands line by line (tax codes, quantity lines before or after the item, weighed goods, deposits and empties, item and whole-purchase discounts, voids, returns) is written up in [research/2026-10-11-bons.md](research/2026-10-11-bons.md). Only REWE, EDEKA (QR or e-mail) and Kaufland (share as PDF) reliably give a household a PDF; for the others, a photo, pasted text or the e-mail inbox are the realistic paths.

## Text recognition (OCR) – photos without AI

`server/lib/ocr.ts` runs **Tesseract** (`tesseract-ocr`, `-deu`, `-eng`, installed in the Docker runtime stage) as a child process: off the Node event loop, one recognition at a time per server (queue of 8, then HTTP 503 `ocr.busy`), single-threaded (`OMP_THREAD_LIMIT=1`), 45 s timeout, output capped. Before that, sharp turns the photo upright (EXIF), greyscale, normalised, sharpened, short side ≥ 900 px, long side ≤ 3200 px, at most 50 MP input. Measured on a real 809×2337 px receipt: about **74 MB peak memory** and 3–5 s, so it fits next to Node in the 512–768 MB containers. Nothing leaves the server. `OCR_DISABLED=1` switches it off, `TESSERACT_BIN` points to another binary.

Stable API for other areas (the b-list agent uses it for flyer offers):

```ts
import { ocrAvailable, ocrImage } from '../lib/ocr.js';
const { lines, confidence, detail } = await ocrImage(buffer, { psm: 11 /* sparse text, flyers */ });
// lines: string[] top to bottom; confidence 0..1 (Tesseract's word confidence, weighted by length – not tuned);
// detail: [{ text, confidence, box: { x, y, w, h } }]; throws OcrError code unavailable|busy|timeout|failed|bad_image
```

Wide gaps between words are kept as runs of spaces, so the receipt parsers can tell name and price apart.

### How a receipt photo is read (`server/lib/receipt-read.ts`)

| Situation | What happens |
|---|---|
| AI off (household, person or child), not configured, or over the quota | OCR → parsers (REWE, generic German, UK/US/SE). No parse: every "name … price" line becomes a guessed line (kind `photo`, `meta.guessed`). |
| AI on | OCR → parsers first. If the lines add up to the printed total (`meta.sumMatches`), done – **no model call**. Only if the check fails or nothing was parsed, the vision model reads the photo (counted as an AI receipt read). If the model fails or the quota is used up, the OCR result goes into the review. |

The import carries `meta.source` (`ocr`, `ocr-device` or `ai`) and `meta.ocrConfidence`. Lines read with less than 0.75 confidence get the note "Unscharf gelesen – bitte prüfen"; every line stays correctable in the review as usual. `POST /api/imports/upload` answers per photo `{ id, via, confidence, sumMatches }`. Shelf photos (`mode=shelf`) still need the vision model.

### Endpoints

- `POST /api/imports/lines` – **text recognised on the device** (iPhone: Apple Vision `VNRecognizeTextRequest`, nothing but the text is sent): `{ lines: string[], source: 'ocr-device', mode?: 'auto'|'receipt'|'list', confidence?: 0..1 }`. A receipt (or `auto` and it parses as one) → `{ kind: 'receipt', id, via: 'ocr-device', sumMatches, confidence }` (an import in review). A list → `{ kind: 'list', items: [{ name, qty, confidence }], source }` – suggestions only, nothing is added to the shopping list. Send one string per recognised line, top to bottom; keep the gap between name and price as two or more spaces if you can.
- `POST /api/imports/list-photo` (multipart `image`) – photo of a paper list or whiteboard → `{ items: [{ name, qty, confidence }], lines, confidence, source: 'ocr' }`; suggestions only. 501 `ocr.unavailable` without Tesseract.
- `POST /api/imports/ocr` (multipart `image`, optional `psm` 4/6/11) → `{ lines, confidence, ms, lang }` – raw text recognition.
- `GET /api/instance` → `features.ocr: boolean`.

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
