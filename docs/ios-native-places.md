# iOS native: places & categories, product extras, QR labels, favourites, stock

Status 14 Oct 2026. These screens used to open the web page (WebPageView) or were missing in the app. Everything
uses the same endpoints as the web app, so it works with ToHuus Cloud and with a self-hosted server alike.
Files live in `ios/ToHuus/Features/Pantry/`, German strings in `ios/tools/strings_de_places.json`.

## Places & categories – `PlacesSettingsView(api:)`

Web: `web/src/pages/PlacesSettings.tsx` (PlacesSettings, CategorySettings, HouseholdFormCard).

- Tree of places (indent by depth, icon, climate, owner, directions, number of things stored).
- Admins: drag to reorder (siblings only, like the web), "Edit" button, context menu "Move up / Move down",
  VoiceOver actions, swipe to archive (undo toast), add a place (name, inside, climate or "detect from the name").
- Place sheet (`PlaceEditSheet`): name, icon grid (web `PLACE_ICONS`, mapped in `PlaceIcon.symbol`), climate,
  inside (never itself or its own children), owner (shared flats / when one is set), directions, archive, delete
  (only when empty; confirmation says the places inside move one level up).
- Archived places: disclosure list with "Bring back".
- Categories (`CategoryEditSheet`): place for new products and how to count; admins can also rename and add
  categories (POST/PATCH `/api/categories`, which the server already offers).
- Who lives here / how do you live (`HouseholdFormSections`, reusable in a household settings screen).
- Members see everything read-only; the server enforces `requireAdmin`.

Endpoints: `GET /api/locations?all=1`, `POST /api/locations`, `PATCH|DELETE /api/locations/:id`,
`PUT /api/locations/order`, `GET|PUT /api/home/setup`, `GET|POST /api/categories`, `PATCH /api/categories/:id`,
`GET /api/shop/members`.

Not native: the illustrated "as a home" view (HomeArt) – the list is the full view on the phone.

## QR labels – `LabelsView(api:kind:preselect:)`

Web: `web/src/pages/Labels.tsx` (`/etiketten`) and `BoxLabels` in `Leftovers.tsx`.

- Kinds: products, places, care tasks, leftovers & frozen (title "Leftovers" when there is no frozen place).
- Search, select all, size small (3 × 8 per A4) or large (2 × 4). `POST /api/qr { kind, ids }` returns code and link
  per label; the sheet is drawn on the device (`QRSheetRenderer`: Core Image QR + `UIGraphicsPDFRenderer`, 8 mm
  margins, dashed cut lines, same measures as the web print CSS). Preview in PDFKit, AirPrint
  (`UIPrintInteractionController`, actual size) or share the PDF.
- Boxes: pick containers (default: wanted but not printed yet), sticker sheet layout from `GET /api/labels/meta`,
  "already used" stickers, server preview `GET /api/labels/sheet.png`, `GET /api/labels/sheet.pdf` to print or share
  (marks them printed), label images (`/api/labels/boxes/:code/label.png`) to share, thermal printer
  (`POST /api/labels/print`) when one is set up, "Put something away" (LeftoversSheet).
- Single label: `LabelsView(api:, kind: .care, preselect: task.id)` (task detail) and the QR button on the product
  page (`kind: .product, preselect: product.id`).

## Favourites – `FavouritesView(store:)`

Web: `/lieblinge`, `web/src/people/Ratings.tsx` (Favourites, PersonProfileSheet).
`GET /api/people/favourites`: faces row, "Family all-time favourites" (or "All-time favourites" when the household
form isn't family), "Cooked most often", "{name} loves". Tiles open the recipe natively. Tap a face:
`GET /api/people/person/:key` – allergies, likes, dislikes, tabs likes / not for them / most cooked.

## Product page extras

Web: `Product.tsx`, `FreshParts.tsx` (FreshPanel), `Share.tsx` (RunsOutRow), `Leftovers.tsx` (PutAwayButton).

- Badges: size, status, "always stocked", "on the order menu" (opens the menu editor, still the web page
  `/bestellen/karte?item=`).
- "Keep it fresh" card (`FreshActionsCard`): eaten (leftovers), opened, freeze / thaw with quantity, thrown away
  with quantity and reason, run-out estimate, last checked, shelf life sheet (days after opening, days in the freezer,
  `PATCH /api/fresh/products/:id`), recipe link for leftovers.
- "Runs out regularly" toggle (`POST /api/share/staples/:id`).
- "Freeze & label" / "Label": portion into labelled boxes (`POST /api/labels/boxes` with `product_id`), print or
  share the sheet right away.
- Details: barcode(s), how it appears on receipts, movement reasons in words; "Used up"/"On the list" hidden for
  leftovers.
- Edit sheet: size, date on the pack (automatic / best before / use by with `GET /api/retail/date-kind`), always
  stocked, on the order menu + bar section, find image again (`POST /api/products/:id/enrich`), delete (admins).
- New product: "More details" (size, exact spot, keep at least, unit, best-before, date kind, always stocked, order
  menu, note) – the rest of the web's new-product form.

## Stock and "Where is what?"

- Pantry: status filters like the web (everything, needs attention, use soon, low, out, in stock; "needs attention"
  uses the web rule), uncounted things only in "Where is what?", multi-word search incl. size, best-before in the row,
  swipe / long press / VoiceOver actions for +1 / −1 (fill level up/down), "Add “…”" from an empty search, leftover &
  freezer boxes on top, monthly waste card, image credit, menu entries for QR labels and places & categories.
- Where is what?: without a search the things are grouped room by room (exact spot first), with the hint text and the
  "n things with an exact spot" count.

## Debug

No new launch arguments; existing ones (`-debugProduct <id>`, `-debugProductEdit YES`, …) still work.
