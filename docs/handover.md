# Holiday handover ("Urlaubsübergabe")

What the people who look after the home while we are away should do – feed the cat morning and evening, water the
plants on Monday and Thursday, empty the mailbox when needed – with instructions, photos and short videos. Part of a
trip (Mehr › Urlaub / unterwegs › a trip › tab **Übergabe**).

Code: `server/lib/handover.ts`, `server/routes/handover.ts`, web `web/src/pages/Handover.tsx` (trip tab, guest-link
tab, `/uebergabe` for permanent guests). Tests: `test/handover.test.ts`.

**Product frame**: this is a note on a handover for a guest, not a task system with responsibilities. Ticking is
optional and only for the guest; there are no points, reminders or assignments for household members.

## Items

| Field | |
|---|---|
| `kind` | `pet`, `plants`, `post`, `bins`, `home`, `other` (icon only) |
| `title`, `instructions` | what and how (instructions up to 2 000 characters, line breaks kept) |
| `rhythm` | `daily`, `days` (+ `weekdays`, 1 = Monday … 7 = Sunday), `once` (+ `day`), `asneeded` (shown, nothing to tick) |
| `slots` | `morning`, `noon`, `evening` – none = once that day |
| media | up to 6 photos / videos per item, same storage and limits as Hausinfo media (100 MB per file, the iPhone app shrinks videos first) |

## Who sees it

Only who is chosen per trip (`PUT /api/away/trips/:id/handover/access { links: [{ id, until }], guests: [userId] }`):

- the trip's own **house-sitter link** – always (it is made for this);
- other **guest links**, each with an optional end;
- **permanent guests** (people with a guest level) – in their app under Mehr › Übergabe (`/uebergabe`).

Members of the household always see and edit it. The guest policy keeps guests away from `/api/away/*`; guests use
`GET /api/handover/mine` / `POST /api/handover/done`, links `GET /api/guest/:token/handover` /
`POST /api/guest/:token/handover/done`. A handover is shown while the trip is active; the link page opens it first.

## Ticking and the overview

The guest sees "Heute" (the trip's first or last day outside the trip) with one row per item and time of day and can
tick it (`{ itemId, day, slot, done }`, only days of the trip, rate-limited on links). The household sees every day of
the trip with "x von y" and who ticked (`GET /api/away/trips/:id/handover` → `{ items, access, days }`).

## Reuse

- **Als Vorlage speichern** (`POST /api/away/trips/:id/handover/template { name }`): items and copies of their files.
- **Übernehmen …** (`GET …/handover/sources`, `POST …/handover/apply { templateId } | { tripId }`): adds the items of a
  template or an earlier trip, with copies of the photos/videos (deleting one trip never empties another). A `once`
  item becomes "when needed" in a template (its date belongs to the old trip).
- Deleting a trip deletes its handover files; deleting a template deletes its copies.

## API

Members (all under `/api/away`, `requireAuth`): `GET/POST /trips/:id/handover…`, `PATCH/DELETE /handover/items/:id`,
`POST/DELETE /handover/items/:id/media[/:mediaId]`, `PUT /trips/:id/handover/access`, `GET /handover/templates`,
`POST /trips/:id/handover/template`, `DELETE /handover/templates/:id`, `GET /trips/:id/handover/sources`,
`POST /trips/:id/handover/apply`. Tables: `away_handover`, `away_handover_media`, `away_handover_access`,
`away_handover_done`, `away_handover_templates`.

## Not yet

- The iPhone app has no trip area yet (web only); a sitter opens the link in the browser anyway.
