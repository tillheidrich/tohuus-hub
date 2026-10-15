# iOS: shopping (Einkauf) – native parity with the web list

Status 14 Oct 2026. Everything of `web/src/pages/Shopping.tsx` and `web/src/shop/*` that belongs to the list now exists
natively in `ios/ToHuus/Features/Shopping/`. Same endpoints as the web, so it works with ToHuus Cloud and self-hosted
servers alike; older servers answer 404 for the newer parts and the app simply leaves those parts out.

## What the list does now

| Web | iOS | Endpoint |
|---|---|---|
| Fast add with product suggestions while typing | Up to six products under the field (exact > starts with > word starts with > contains, often bought first, "2 milk" keeps the 2), stock or "already on the list" per match; the field stays focused for the next one | `GET /api/products`, `GET /api/list/usuals` |
| Double-purchase guard | asks for "bought" / "in stock"; "already on the list" and "rather 250 g?" show as a short line | `GET /api/list/guard` |
| One-tap tick with undo | tap or a full swipe right ticks; undo bar for 4 s (also after removing a row); "put away" wording when the tick goes into stock | `POST /api/shop/sync` |
| "Beim Abhaken einräumen" | switch in the ⋯ menu and next to "Done shopping" (this device, default on) | `to_stock` on check / `POST /api/list/finish` |
| Full swipe left | opens the row details instead of deleting (pon pattern); remove is the second action | – |
| Suggestions (rhythm) | rows with + and "not now" (×), rhythm line under the name | `GET /api/rhythm`, `POST /api/rhythm/:id/accept|dismiss` |
| Origin of each row | origin line (already there), plus "for Mika", "at Edeka, dm" and in the shop "last time: …" | `origin`, `owner`, `buy_at`, `last_bought` |
| "Ich bin bei …" | chip row under the field: sorts the list by that shop without the shop view | `GET /api/shop/list?store=` |
| Shop view | shop chips to switch, "Other store" (creates and enters it), "Change the aisle order"; the screen stays on while in the shop | `POST /api/shop/stores`, `PATCH /api/shop/stores/:id` |
| Shopping together | others' trips show their basket and what was asked for; my own trip shows "Only you see this trip" toggle; rows another shopper took on wait in "Mira holt das" | `GET /api/shop/trips`, `PUT /api/shop/trips/privacy` |
| Who gets what | section at the end of the list when someone said "I'll get it" | – |
| Several lists | list menu in the title; "Another list" sheet with presets (DIY store, Drugstore, Presents, For Grandma), "I shop this for someone else" (care list) and who sees it | `POST /api/list/lists` |
| Care list | handover note on top and "Fridge check before the visit" (there / missing → onto that list, spent this month) | `GET /api/care/:id/check`, `POST /api/care/:id/missing`, `GET /api/care/:id/spent` |
| Lunchbox | suggestion on its weekday on the main list, with "Holidays until …" | `GET /api/list/lunchbox`, `POST /api/list/lunchbox/add`, `PUT /api/list/lunchbox` |
| Offers | strip of current offers on the main list; offers screen grouped per shop, flyer photo, link to a picture/PDF or pasted text | `GET /api/offers`, `POST /api/offers/scan` (`image` / `url` / `text`) |
| Import from another app | Bring!, AnyList, Notes, WhatsApp text (paste) or a Google Keep / CSV / JSON file, preview first | `POST /api/list/import` (`dry_run`) |
| Row details | plus aisle chips, up/down inside the aisle, list picker, "For whom?" (flat shares) | `POST /api/list/items/:id/place`, `POST /api/list/items/:id/owner` |
| Expected total | tap shows which items have no price yet | `estimate` in the list |
| How the list looks | from the ⋯ menu as well | `PUT /api/list/prefs` |

Guests (`houseGuest`) see no list menu, offers, wishes, lunchbox or claim swipe, like on the web.

## Outside the list (views in this folder, linked by the coordinator)

- `StartModeView(api:isAdmin:)` – Settings › Household: "What should be tracked?" (everything / only what runs out) and
  the staples picker. `GET/PUT /api/share/start-mode`, `GET/PUT /api/share/staples`.
- `LunchboxSettingsLink(api:)` → `LunchboxSettingsView` – Settings › Household, families only.
- `WgBalanceCard(api:month:)` – Geld, flat shares only: who paid what and who gives whom how much. `GET /api/wg/balance`.

## Not native on purpose

- Printing the list on a receipt printer (web "Ticket"/`BonButton`) – self-host printers, a separate area.
- The desktop drag & drop between lists – the row details have a list picker, and the context menu moves rows.
- Shopping trip history – it lives in Geld › money lists ("A shopping trip"), which is already native.

## Strings

German: `ios/tools/strings_de_shopping2.json` (web wording where the web has the same text).
