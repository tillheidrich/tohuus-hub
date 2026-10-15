# iOS native: Bring mir was, Gäste & Party, Karte

Status 14 Oct 2026. Everything the web does under `/bestellen`, `/bestellen/karte` and `/bar` is native in the iOS app now,
except the TV board, which stays a web page on purpose (see below). Code: `ios/ToHuus/Features/Treats/`.
German strings: `ios/tools/strings_de_treats2.json`.

## Screens

| Web | iOS | File |
|---|---|---|
| `/bestellen` "Bring mir was" (Order.tsx, mode "me") | `TreatsView`: tiles, options, basket, "who brings it", inbox with "I'll bring it" / "Can't right now" + reason, own wishes, private thanks. Now also: **Edit menu** in the toolbar (not for permanent guests), live refresh on `orders` change events | `TreatsView.swift` |
| `/bar` "Gäste & Party" (Bar.tsx + Party.tsx `PartyCard`) | `GuestsPartyView(store:)`: party card on top, then tabs **Board / Guest links / Menu** | `GuestsPartyView.swift` |
| Board (Bar.tsx `Orders`, Order.tsx guest/party filters) | All orders with origin, "asked X", who is on it, lines with options and notes, note. Filter All / At home / Guests / Party. Buttons Decline, On it / I'll bring it, Served / Brought it; swipe right = on it, swipe left = served, long press = menu incl. **receipt printer** (self-hosted servers with a printer, `POST /api/print/print {type:"order"}`) | `GuestsPartyView.swift` (`BoardOrderRow`) |
| Guest links (Bar.tsx `Links`) | Presets Babysitter / Visitors / Grandparents, scopes, places, note, validity, QR + share + copy, "no expiry" badge, last used / never used, new link (rotate), revoke (swipe or long press) | `GuestLinksView.swift` (`GuestLinkRow`, `GuestLinkForm`, `GuestLinkShareSheet`) – also reachable on its own |
| Bar menu switches (Bar.tsx `Menu`) | Every product with an on/off switch (`PATCH /api/products/:id {orderable, order_group}`), search, link to the full editor | `GuestsPartyView.swift` |
| Party start (StartSheet) | Templates "Like last time" (long press removes one), name, ends in 3/5/8/12 h, end early when quiet, guest names on TV, party menu | `PartyViews.swift` (`StartPartySheet`) |
| Party menu (MenuEditor in Party.tsx) | Bar items by switch, anything in stock by search, max per guest (no limit, 1, 2, 3, 5), quick picks All bar items / Only what's there / None | `PartyViews.swift` (`PartyMenuEditor`, `PartyMenuSheet`) |
| Live party (LiveParty) | Open count, kitchen board, show on TV, guest QR, party menu, guest names on TV, 1 hour longer, end party (confirm) → recap opens | `GuestsPartyView.swift` |
| Kitchen board (`/party/board/:token` kitchen view for members) | `PartyKitchenBoard`: full screen, New → In progress → Ready (columns on iPad, segmented on iPhone), tap = next step, long press = decline, cards warm up after 5/10 min, screen stays on, haptic + optional sound on new orders | `PartyViews.swift` |
| Show on TV (TvSheet) | Pairing address + 4-digit code, new code, board QR, **open the board here** (Safari view, for AirPlay screen mirroring), share / copy board link | `PartyViews.swift` (`PartyTVSheet`) |
| Guest QR (GuestQrSheet) | QR, share, copy | `PartyViews.swift` (`LinkQRSheet`) |
| Recap (RecapSheet) | Totals, open orders hint, what was ordered (bars), ran out / running low → shopping list, save the menu as template | `PartyViews.swift` (`PartyRecapSheet`) |
| `/bestellen/karte` menu editor (Menu.tsx) | `MenuEditorView(store:)`: groups (new, rename, move up/down, remove with move-to / take-off), items with picture, source, badges; **Sort** = drag to reorder within a group; swipe = hide/show or off the menu; long press = who sees it. Add from stock (suggestions + search, into a group), menu-only item, templates (then offers the stock picker like the web) | `MenuEditorView.swift` |
| Item sheet (ItemSheet + OptionsEditor) | Picture (camera / Photos / Open Food Facts via `ProductImageSheet`), name, description, group, who sees it, from stock: amount, open in stock, when it runs out; menu-only: up to 3 ingredients with amount per serving, "take it from a stock product instead"; choices (name, choices, preselect by tap, pick one/several, required, presets Size/Milk/Sugar, max 6), ask for a note + question, unit, off the menu | `MenuEditorView.swift` (`MenuItemSheet`) |

## Stays web on purpose

- **The TV board** (`/party/board/:token`, guest view with QR, ticker and "ready at the counter") and the **TV pairing page** (`/party`).
  They run on a TV or tablet browser without an account. The app shows the pairing code, shares the board link and opens
  the board in a Safari view, so it can be mirrored to an Apple TV / AirPlay TV (Control Center › Screen Mirroring).
- **The guest page** (`/g/:token`): guests have no account. The app has no universal links for `/g/`, so a guest who has
  the app installed still gets the web page in Safari, which is what we want.

## Live updates

Same mechanism as the web: server-sent events on `/api/events` (`ServerStore.startEvents`). The board, the kitchen board,
"Bring mir was" and the menu editor reload when `store.revision("orders")` (or `products`) changes. As a calm fallback
the board polls every 30 s and the kitchen board every 15 s while open. New orders give a warning haptic and, if the bell
in the toolbar is on (`party.board.sound`, shared by board and kitchen board), a short system sound.

## Endpoints used (no server changes)

`GET /api/orders`, `PATCH /api/orders/:id`, `GET /api/bar/*`, `GET/POST/DELETE /api/guest-links…`,
`GET /api/party/current`, `GET /api/parties`, `POST /api/parties`, `PATCH /api/parties/:id`, `PUT /api/parties/:id/menu`,
`POST /api/parties/:id/extend|end|pair-code|shopping`, `GET /api/parties/:id/recap`, `GET/POST/DELETE /api/party-templates`,
`GET /api/products`, `PATCH /api/products/:id`, `POST /api/products/:id/image`, `GET /api/menu`, `GET /api/menu/suggestions`,
`GET /api/menu/templates`, `POST /api/menu/templates/:key`, `POST/PATCH/DELETE /api/menu/groups…`, `PUT /api/menu/groups/order`,
`PUT /api/menu/groups/:id/items`, `POST/PATCH/DELETE /api/menu/items…`, `GET /api/print/info`, `POST /api/print/print`.
`DELETE /api/menu/groups/:id` gets `move_to` / `remove_items` in the JSON body (the server reads query or body).

## Permissions

Permanent guests (`app.isGuest`) can look at the menu and the board but get no edit, party start or link creation
(the web hides the same; the server enforces it). Areas switched off in "Was nutzt ihr?" hide the entries in Mehr
(`MoreAccess`, `/bestellen` = treats, `/bar` = guests).

## Debug launch args

`-debugParty start | links | barmenu | tv | qr | menu | kitchen` on the Gäste & Party screen (tv/qr/menu/kitchen only
while a party is live).
