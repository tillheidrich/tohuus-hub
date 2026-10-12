# Hausinfo (house guide)

A small manual for the home – for babysitters, guests, house sitters and everyone who lives there: voice commands
("Alexa, Licht im Wohnzimmer an"), routines ("Alexa, gute Nacht" → what it does), tips (heating, blinds, bins,
washing machine, TV/streaming), emergencies (fuse box, main water tap), important numbers, and **codes** (front door
PIN, alarm, garage door, guest Wi-Fi with a join QR). It works without Home Assistant; households with Home Assistant
also get the generated voice list from `server/lib/ha2-voice.ts`.

Code: `server/lib/house-guide.ts`, `server/routes/house-guide.ts`, MCP `server/mcp/tools-house.ts`, web
`web/src/pages/HouseGuide.tsx` (Mehr › Hausinfo, the guest/sitter tab and the A4 sheet). Tests:
`test/house-guide.test.ts`, `test/cloud-isolation.test.ts`. Help article: `hausinfo`, `hausinfo-codes`,
`babysitter` ([help-slugs.md](help-slugs.md)).

## Content

| Thing | Fields |
|---|---|
| **Card** | `type`: `voice` (a command – `body` is what you say), `routine` (`body` = what you say, `detail` = what happens), `tip` (`body` = how it works), `contact` (`body` = number). `topic`: `light`, `heating`, `blinds`, `bins`, `laundry`, `tv`, `kitchen`, `kids`, `emergency`, `numbers`, `wifi`, `other`. `area` (free text: room or area, optional), `title`, `detail`, `assistant` (`alexa`, `google`, `siri`, `assist`). Template cards that still need filling in are `draft` (admins only) and carry a `hint`. |
| **Code** | `kind`: `door`, `alarm`, `garage`, `wifi`, `safe`, `other`. `label`, `area`, `note` (not secret), the value (secret), for Wi-Fi `wifi: { ssid, security: WPA|WEP|nopass, hidden }`. |
| **Voice list** (Home Assistant) | what ha2-voice.ts already offers the babysitter page (HA entities exposed to the assistant or added by hand, with the safety filter that keeps out locks, alarms, cameras, garage doors …), grouped by area, scenes/scripts marked as routines. |

Grouping in the app: by room/area or by kind. **No housing assumptions**: areas are free text, templates never
mention cellars, stairs or chest freezers – everything is optional.

Templates (`GET /api/house-guide/templates`, `POST /api/house-guide/templates/:key`): `alexa`, `google`, `apple`,
`ha` (typical commands and two routines to fill in), `tips` (heating, blinds, bins, washing machine, TV, fuse box,
main water tap, emergency number for the region, police, poison control, "us", neighbours). Applying twice adds
nothing twice.

## Who sees what

Every card and every code has its own visibility:

| Audience | Meaning |
|---|---|
| `members` | everyone who lives here (admins always see everything) |
| `guest_level` | permanent guests from this level up (`order` < `stock` < `recipes` < `family`), or `null` |
| `sitters` | every babysitter / house-sitter link (guest links with the "Wo ist was?" scope `stock`) that has no own selection |
| `links` | specific guest links, each with an optional end (`until`) |

Defaults: cards → members, all permanent guests, all sitter links. Codes → members only (shared on purpose).
A guest link can get its own selection (`PUT /api/house-guide/links/:id`), it then shows exactly that – the trip page
offers "Hausinfo für diesen Link" for the house-sitter link.

Permanent guests may `GET /api/house-guide` and reveal codes shared with them on every level except `paused`
(`server/lib/people-policy.ts`); editing is for admins.

## Codes are secrets

- Values live in their own table `house_secrets`, AES-256-GCM with a key derived from the household key
  (cloud always, self-host with `DB_ENCRYPTION_KEY`; without a key they are stored encoded, the database itself is
  then plain anyway). `house_codes` holds no value.
- Lists only carry `has_value` and a mask (`••••`). The value comes from one explicit call
  (`POST …/codes/:id/reveal`), shown for a minute in the app, never cached on a device. Each reveal is logged (who,
  when, via member/guest/link – never the value); admins see the log (`GET /api/house-guide/log`, per code
  `GET /api/house-guide/codes/:id/views`, "Zuletzt gezeigt" on the card). Reveals are rate-limited.
- Never to the assistant, AI, MCP (`house_info` tool and the assistant tool see finished member-visible cards
  only; every text is scrubbed of code values), Home Assistant sensors, displays, notifications or logs.
- A card whose text contains a stored code is refused (HTTP 400) – codes belong in the safe.
- Export: `house_secrets` is skipped by the JSON export (`data.ts` skips tables ending in `secrets`). An admin can
  tick "with codes": `GET /api/export.json?codes=1` (self-host) or `GET /api/cloud/export?codes=1` adds
  `house_codes: [{ id, kind, label, area, note, value, wifi }]`.
- The printable sheet shows "bitte fragen" instead of codes unless an admin ticks "Codes mitdrucken" (each code is
  then revealed and logged).

## Guest and sitter page

`GET /api/guest/:token` → `house_guide: true` when something is shared with this link; the page then has a
**Hausinfo** tab: cards by room or kind, masked codes with tap-to-show, the voice list, a print view
("Für den Babysitter", A4). After the first visit the guide is kept on the device (cards only) and stays readable
offline. `GET /api/guest/:token/stock?q=…` ("Wo ist was?") also answers with matching cards in `house`.

## API

All JSON, `Cache-Control: no-store`. Errors `{ error }`.

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/api/house-guide` | members, admins, permanent guests | `{ cards: Card[], codes: Code[] (masked), ha_voice: { assistant, assistant_name, items, groups } \| null, areas: string[], can_edit, assistant }` – filtered for the viewer; admins also get `hint`, `draft`, `template`, `visibility`, `last_views` |
| `POST` | `/api/house-guide/cards` | admin | `{ type?, topic?, area?, title, body?, detail?, assistant?, visibility? }` → Card |
| `PATCH` / `DELETE` | `/api/house-guide/cards/:id` | admin | same fields / delete |
| `POST` | `/api/house-guide/codes` | admin | `{ kind?, label, area?, value?, wifi?, note?, visibility? }` → Code (masked) |
| `PATCH` / `DELETE` | `/api/house-guide/codes/:id` | admin | `value` omitted = unchanged, `null`/`""` = cleared |
| `POST` | `/api/house-guide/codes/:id/reveal` | whoever may see it | `{ id, value, wifi: { ssid, security, hidden, qr } \| null }` (`qr` = `WIFI:T:WPA;S:…;P:…;;`) – logged |
| `GET` | `/api/house-guide/codes/:id/views` | admin | `[{ viewer, via, at }]` |
| `GET` | `/api/house-guide/log` | admin | `[{ code_id, label, viewer, via, at }]` |
| `PUT` | `/api/house-guide/order` | admin | `{ cards?: id[], codes?: id[] }` |
| `GET` | `/api/house-guide/templates` | admin | `[{ key, name, description, assistant, cards }]` |
| `POST` | `/api/house-guide/templates/:key` | admin | `{ pick?: index[] }` → `{ added }` |
| `GET` / `PUT` / `DELETE` | `/api/house-guide/links/:id` | admin | one guest link's selection `{ link, cards: [{ id, title, area, topic, type, shown }], codes: [{ id, label, kind, area, shown, until }] }`; PUT `{ cards: id[], codes: [{ id, until? }] }`; DELETE = back to default |
| `GET` | `/api/guest/:token/house` | guest link | `{ cards, codes (masked), ha_voice, areas }` |
| `POST` | `/api/guest/:token/house/codes/:id/reveal` | guest link | as above, logged as `via: link` |

`Card`: `{ id, type, topic, area, title, body, detail, assistant, sort }`. `Code`: `{ id, kind, label, area, note,
sort, has_value, masked, wifi }`. `Visibility`: `{ members, guest_level, sitters, links: [{ id, until?, name? }] }`.

MCP: `house_info` `{ query? }` (read-only; overview by area without a query). Assistant: tool `house_info`.
