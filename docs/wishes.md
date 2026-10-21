# Wish lists / Merkliste (13 Oct 2026, wish-list app features 20 Oct 2026)

Mehr › Alltag › „Wunschlisten & Geschenke“ (first row), the labelled door „Wünsche“ on top of Einkauf (web
`/einkauf/wuensche`), „Deine Leiste“ (`wishes`), the global search („Wunsch“, „Geschenk“, „Geburtstag“) and
hints on Heute. A household collects what someone wishes for („Linas Geburtstag“, „Weihnachtswünsche“) or what it
wants to remember („Merkliste Kekse“). Gap analysis against the wish-list apps: [wishes-gap.md](wishes-gap.md).

Code: `server/lib/wishes.ts` (logic), `server/lib/wish-policy.ts` (tables, privacy), `server/lib/wish-icons.ts`
(placeholder symbol), `server/lib/wish-jobs.ts` (reminders), `server/routes/wishes.ts` (API + public guest link),
`server/lib/assistant-wishes.ts`, `server/mcp/tools-wish.ts`, web `web/src/pages/Wishes.tsx`, `wish-ui.tsx`,
`WishGuest.tsx` (`/w/:token`), iOS `ios/ToHuus/Features/Wishes/WishesView.swift`, share extension
`ios/ToHuusShare/ShareViewController.swift` („Als Wunsch speichern“). Works the same in the cloud and self-hosted.

## Lists

- `occasion` (`birthday|christmas|wedding|baby|easter|other`) and `event_date` (YYYY-MM-DD, optional); the views add
  `days_until` (household time zone).
- Owner, someone it is **for** (`for_user_id` or `for_name`), a visibility (`household`, `private`, `people` +
  `share_with`) and **co-editors** (`editors`, household members): they always see the list, find it under
  „Ich bearbeite mit“ (`role: 'editor'`), add wishes and share the guest link. Only the owner changes visibility, for
  whom, editors and the surprise switch (403).
- `surprise` („Reservierungen bleiben eine Überraschung“): reservations are hidden from the owner and the co-editors
  as well. Default in the apps: on for a list for yourself, off for someone else (a child's list – parents see who
  gets what). The server default is off.
- Overview groups (clients): Meine Listen (own, for me/nobody), Ich bearbeite mit, Für andere (own, for someone
  else), Zum Schenken (others' lists I may reserve on).

## Privacy (who sees reservations)

`statusHidden(list, user)` in wish-policy.ts: hidden for tokens without a person, for the person the list is for, and –
with `surprise` – for the owner and co-editors. For them **every** read path returns `status: 'open'`, `status_by: null`,
`giver: null`, `reserved/bought/open: null`, `on_shopping_list: false`, `can_reserve: false`; setting a status answers
404. That covers the API, search (`/api/wishes/search`, `/api/search`), „Du schenkst“, the export (`buildExport`
blanks status, giver, claim and shopping link; `wish_share_links` never leave; `wish_reminders` only the viewer's own),
MCP (household lists only, no states), Heute hints and notifications (re-checked at send time).

- Lists a person may not see are 404 everywhere. Permanent guests are closed out of `/api/wishes/*` (guest policy);
  kid tablets, displays and HA never see wishes.
- „Auf die Einkaufsliste“: for a list that is for someone, a surprise or not household-visible, the row goes on the
  main list **privately**, shared only with people for whom the reservations are not hidden.
- Shared text/Markdown/CSV never says who reserved; it names no household member except the owner („von Mira“) – a
  `for_name` that is a member's name is left out. CSV cells starting with `= + - @` get a leading `'`.
- The server never fetches a link someone typed in (no SSRF surface, decision 20 Oct 2026): `POST /api/wishes/preview`
  and the background preview fetch are gone. Clients send `title`/`site` with a link: the iPhone reads them with
  LinkPresentation (and uses the page picture as the wish photo), the web derives a title from the address.

## Guest link (no account)

`POST /api/wishes/lists/:id/link` (owner/co-editors) makes `…/w/<token>`; a new one revokes the old,
`DELETE …/link` stops it. Only `sha256(token)` is stored (`wish_share_links`); the token is an HMAC of a household
secret (`wish.link_secret`) so the owner can see the URL again (`list.link.url`, only for owner/co-editors). In the
cloud the token carries the household routing prefix.

Public API (`/api/guest/wishlist/:token`, rate-limited per address and link):

| Method & path | Body | Answer |
|---|---|---|
| `GET /:token` | header `X-Wish-Claim` (optional) | `{ list: { name, note, for_name, owner, occasion, event_date, days_until }, blind, count, open, items: [{ id, title, note, photo_path (signed), icon, price, price_from_links, quantity, priority, links, taken, mine }], language, region }` |
| `POST /:token/items/:id/reserve` | `{ name, claim }` | snapshot (409 when taken) |
| `POST /:token/items/:id/release` | `{ claim }` | snapshot (404 unless the same claim) |

Guests see `taken`, never who. The claim is a random id kept in the guest's browser (`sha256` stored in
`wish_items.status_claim`). Members who may see reservations see „Reserviert – Oma (Gast)“ (`status_by.guest`). A
signed-in member for whom reservations are hidden gets `blind: true` (nothing taken, no reserving) also on their own link.

## Gifts („Du schenkst“) and reminders

- `GET /api/wishes/giving` → `{ todo: [GiftItem], bought: [GiftItem], count, sum, todo_sum, bought_sum }` – only the
  viewer's own reservations (lists that became a surprise for them are left out). `GiftItem` = `Wish` + `list`
  (`id, name, for_name, occasion, event_date, days_until`) + `suggest_remind_on` (10 days before the date).
  Separate from the household shopping list on purpose.
- `PUT /api/wishes/items/:id/reminder` `{ remind_on: 'YYYY-MM-DD' | null }` – for a wish you reserved, or a wish on a
  list you run (buy it yourself). Each `Wish` carries `reminder` (`{ remind_on, sent }`) of the viewer only. Releasing
  a wish deletes the reserver's reminder.
- Scheduler (`wish-jobs.ts`, per household): `wish.reminder` on its day from 9 o'clock, once, skipped when bought,
  released or no longer visible; `wish.occasion` once per occasion and person 7 days before the date, when something
  reserved there is not bought („Linas Geburtstag in 7 Tagen · 2 Geschenke noch nicht besorgt“). Both are personal
  events (notify-prefs.ts, on by default, switchable per person) sent `personalOnly` – never HA, webhook, ntfy, mail or
  chat channels; the lock-screen preview setting applies. Push text: „Geschenk für Lina besorgen“.
- Heute (`today.ts` notices, per viewer): „Sams Geburtstag in 12 Tagen · 2 Wünsche noch frei“ for lists in the next 14
  days where the viewer may reserve, „1 Geschenk noch besorgen · …“ for own open reservations.

## AI: a photo becomes a wish

`POST /api/wishes/ai/photo` (multipart `image`) → `{ title, note, price, icon }`. Vision path like receipts
(`runVision('wish')`): only when a model is set up (`/api/me` `features.vision`, otherwise 501 `ai.unavailable` and the
button is hidden – self-host without AI), AI switches and consent respected (`assertAiAllowed`), counts as an AI import
(`consumeImportAi`). The photo is not stored by this call.

## API (all JSON, member session or app token)

| Method & path | Body / query | Answer |
|---|---|---|
| `GET /api/wishes/lists` | `?archived=1` | `[WishList]` |
| `POST /api/wishes/lists` | `{ name, note?, for_user_id?, for_name?, visibility?, share_with?, editors?, surprise?, occasion?, event_date? }` | `WishList` |
| `GET /api/wishes/lists/:id` | `?sort=manual\|priority\|price\|newest\|title&archived=1` | `{ list: WishList, items: [Wish] }` |
| `PATCH /api/wishes/lists/:id` | any of the above + `archived` (privacy fields: owner only, 403) | `WishList` |
| `DELETE /api/wishes/lists/:id` | | `{ ok }` (owner; a list without owner: an admin – 403 otherwise) |
| `POST /api/wishes/lists/:id/order` | `{ ids: [id] }` (drag to sort) | `{ ok }` |
| `POST`/`DELETE /api/wishes/lists/:id/link` | | `WishList` with/without `link` |
| `POST /api/wishes/lists/:id/items` | `{ title, note?, price?, quantity? (1–99), priority? (1\|2\|3), giver_user_id?, giver_name?, links?: [{ label?, url, price?, title?, site? }] }` | `Wish` |
| `GET /api/wishes/items/:id` | | `Wish` |
| `PATCH /api/wishes/items/:id` | item fields, `links` (with `id` to keep a link), `archived`, `list_id` (move) | `Wish` |
| `DELETE /api/wishes/items/:id` | | `{ ok }` (`can_delete`, 403 otherwise; the same answer whether it was reserved) |
| `POST /api/wishes/items/:id/status` | `{ status: open\|reserved\|bought, by_user_id?, by_name? }` | `Wish` (409 when someone else, also a guest, reserved it) |
| `PUT /api/wishes/items/:id/reminder` | `{ remind_on }` | `Wish` |
| `POST /api/wishes/items/:id/photo` | multipart `image` (storage quota counted, encrypted) | `Wish` |
| `DELETE /api/wishes/items/:id/photo` | | `Wish` |
| `POST /api/wishes/items/:id/to-list` | `{ list_id?, private? }` | `{ shopping_item_id, private }` |
| `POST /api/wishes/lists/:id/share` | `{ item_ids?, prices? (default true), skip_taken?, format?: text\|markdown\|csv, with_link? }` | `{ subject, text, mailto, count, format, link }` |
| `GET /api/wishes/search` | `?q=` (≥ 2 chars) | `[Wish & { list_name }]` |
| `GET /api/wishes/giving` | | see above |
| `POST /api/wishes/ai/photo` | multipart `image` | `{ title, note, price, icon }` |

`WishList`: `{ id, name, note, owner_id, owner, for_user_id, for_name, occasion, event_date, days_until, visibility,
share_with, editors, surprise, archived, mine, role, for_me, can_reserve, can_edit, can_delete, count, reserved, bought, open, people, link,
photos[≤3], icons[≤3], updated_at }`.
`Wish`: `{ id, list_id, title, note, photo_path, icon, price, price_from_links, quantity, priority, links: [{ id, label,
url, price, title, site, image_path, preview }], giver, status, status_by: { user_id, name, mine, guest }, status_at,
reminder, on_shopping_list, can_delete, archived, created_by, created_at, updated_at }`. `icon` is a symbol key (`bricks`, `teddy`,
`book`, `bike`, `music`, … `gift`) the clients draw (web Phosphor, iOS SF Symbols).

Tables (migration `wish-2`): `wish_lists` + `occasion, event_date, surprise, editors`; `wish_items` + `quantity,
status_claim, status_link_id`; `wish_share_links (list_id, token_hash, nonce, created_by_id, revoked, last_seen_at)`;
`wish_reminders (item_id, user_id, remind_on, sent_at)`. Demo data: „Sams Geburtstag“ in 12 days with three wishes,
marked as demo (removed with „Beispieldaten entfernen“).

## Deleting („Wünsche per Swipe löschen“, 21 Oct 2026)

- **Who:** a wish – the owner, the co-editors, on a household list without an owner the admins, and whoever added that
  wish themselves (`Wish.can_delete`); a whole list – the owner, on a list without an owner an admin
  (`WishList.can_delete`). `WishList.can_edit` = may delete every wish there. Permanent guests and children never reach
  wishes; the server checks every delete (test/wishes-delete.test.ts).
- **Clients:** iPhone – swipe left on a wish → „Löschen“ (red), on a list in the overview → „Löschen“ / „Archivieren“
  (archived view: „Wiederherstellen“); swipe right on a free wish → „Reservieren“, on my own reservation → „Gekauft“;
  „Du schenkst“: right „Gekauft“ / „Doch nicht gekauft“, left „Freigeben“. Web – the same as a trash / archive button in
  the row (desktop on hover, touch always), „Freigeben“ in „Du schenkst“. All with „Rückgängig“ in the toast; the request
  goes out only when the toast is gone or the screen is left (iOS `PendingRemovals`, web `deferred-removal.ts`), so the
  server deletes at once (no soft delete). A list with wishes or shared (guest link, co-editors) asks first instead.
- **Surprise:** the answer never tells whether a wish was reserved. The person who reserved (or bought) it gets a
  personal note `wish.removed` („Ein Wunsch, den du besorgen wolltest, wurde von der Liste genommen“, body: wish · list;
  for a deleted list „Eine Wunschliste, aus der du etwas schenken wolltest, wurde gelöscht“) – never who deleted it,
  never to the deleter, never when they delete it themselves. Guests via link get nothing (no account).
- **Reminders** of a deleted wish (or of every wish of a deleted list) are removed with it.

## Share into ToHuus (iPhone)

The share extension offers „Als Wunsch speichern“ for a link, a photo or a text: pick the list, the title comes from
LinkPresentation (or the address), the shared photo or the page picture becomes the wish photo.

## Assistant and MCP

- Topic `wishes` („Merkliste“, „Wunsch“, „Geschenk“, „merk dir … Artikel/Link“): tools `wish_add` (title, url, note,
  price, list – default the person's own private „Merkliste“, created on first use; undo) and `wish_lists` (visible
  lists, titles/prices/notes only – never reservations or givers). Only for a person with an account.
- MCP `wish_lists` (read-only): household lists only, no states.
