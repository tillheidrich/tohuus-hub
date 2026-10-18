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

### Discounts, deposit, pack sizes, and when the total does not add up (18.10.2026)

Case: Lidl Plus receipt, iPhone Build 17, "Read photos on this iPhone" on. Apple Intelligence tidied the Vision lines and dropped the light blue "Lidl Plus Rabatt -0,70" and "Pfand 0,25 EM", and read "Bioland Eier OKT 6St" as "6 x Bioland Eier OKT": 11,74 instead of 11,29. Fixture photo `test/fixtures/lidl-plus-rabatt-pfand.jpg`, tests in `test/lidl-receipts.test.ts`.

- **iPhone** (`DeviceOCR.receiptLines`): two Vision passes, the photo and an "ink" image (darkest colour channel, contrast stretched, so light blue/red/grey print turns dark), merged by position; no language correction, small text allowed. The Apple Intelligence reading is sent only as `alt` next to the plain lines (`POST /api/imports/lines { …, alt }`); the server takes it only when the plain lines do not add up and it does (`pickDeviceReading`, `meta.tidiedOnDevice`). The prompt now keeps discount and deposit rows and never reads a pack size as a quantity.
- **Parser** (`importers/generic.ts`): discount rows (negative, Rabatt/Lidl Plus/Coupon/Preisvorteil) go onto their item (price net, the discount in the note); deposit rows (Pfand, Leergut, EM/EW) are deposit lines (money, not stock, not in the price history). Pack sizes at the end of a name ("6St", "10er", "500g", "1,5l") stay in the name (the product's size), "1,19 x 2" and a leading "2 x" are quantities – a leading count only when the line total splits into whole cents and it is not the pack size in the name. Names lose "Stk." without a number and Lidl's "OKT".
- **Filling the gap**: when the total does not add up, `savingsHint` reads "Mit Lidl Plus 0,70 EUR gespart" (also "Sie haben … gespart", "Ersparnis"). Missing discount (hint minus discounts already read) and/or a remainder that looks like deposit (1–12 × 0,25 / 0,15 / 0,08) are filled in: the discount on the whole purchase (`meta.receiptDiscount`), the deposit as a line "Pfand" with the note "Auf dem Foto nicht gelesen – ergänzt …". `meta.sumAssumed`, `meta.assumed` say so; repairs (slashed zeros, repeated blocks) and the model are still tried first, the filled-in reading is the last resort. Otherwise `meta.fixSuggestion` names the probable gap.
- **Review** (`GET /api/quality/imports/:id`): the sum check follows the lines as they are now (generic parser, model and OCR readings), with `difference`, `fix_suggestion`, `assumed`, `new_lines` (unmatched lines with a clean name are shown as **"neu"**, not "nicht erkannt" – they become new products on booking), `ai` (`available`, `left` today, `per_day`, `paused`), `ai_undo`, `has_source`. When the total does not add up the review shows **"Rabatt oder Pfand ergänzen"** (amount prefilled with the gap; `POST /api/imports/:id/adjust { kind: 'discount'|'deposit', amount, line_id? }` – a discount onto that item or the whole purchase, a deposit as a deposit line) and **"Nochmal mit KI lesen"**. iOS: also from the capture card ("Rabatt oder Pfand ergänzen" next to "Erst die Zeilen prüfen").

### AI for every receipt source (18.10.2026)

- **Automatic second look** (`aiSecondLook`, once per receipt): when the parser's reading does not add up (or only with a filled-in row) and the household/person uses AI, the model reads the source once – photos as images (as before), a **PDF first as its text, then its rendered pages** (`pdfPageImages`, poppler, ≤ 4 pages) when the text reading does not add up, a digital receipt (link), the mail inbox and pasted text as text. Taken only when it adds up (`meta.aiAuto`, `meta.aiInput`). Device-read photos ("Fotos auf diesem iPhone lesen" on) never go to the model automatically.
- **"Nochmal mit KI lesen"**: `POST /api/imports/:id/reread-ai` (multipart `files`: photos or a PDF; none → what is stored with the receipt; only text → only the text goes out; a device reading without the photo → 422 `photo.missing`, the app asks for the photo or uses the one it still has in memory) → `{ proposal, input, current }`, stored as `meta.aiProposal`. `…/reread-ai/apply` replaces the lines (own corrections – product, place, unit, who it is for – carried over where the same item shows up; household rules applied again), `…/reread-ai/undo` brings back the earlier lines (`meta.beforeAi`). Only while the receipt is checked (409 otherwise). The apps say once what goes to the AI: "Dafür geht das Foto dieses Bons an die KI (Mistral, Frankreich, über OpenRouter). Nur dieses eine Mal."
- **Credits**: every model call goes through `runVision` – counted against today's "receipts with AI" (`consume('receiptAi')`), tokens and cost booked (`ai_usage_daily`, the household's monthly cost cap). Used up → 429 `quota.receiptAi`, cost cap → 429 `quota.ai_paused`, read-only → no AI; the automatic look then simply does not run. A PDF whose text reading does not add up costs two reads (text, then pages). The review shows how many are left today when it gets tight (≤ 5). Tests: `test/receipt-ai-credits.test.ts` (cloud mode).
- **Originals**: receipt photos are now kept with the import while it is checked (`imports.source_file`, comma-separated, JPEG ≤ 2400 px, encrypted, counted against the storage quota); they are removed when the receipt is booked or discarded. PDFs stay as the document; everything goes when the receipt is deleted (`removeSourceFiles`). Links now keep the fetched text (`raw_text`).

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
