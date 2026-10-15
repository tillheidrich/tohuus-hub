# Unterwegs: trips and absences

Server: `server/lib/away.ts` (features) and `server/lib/away-state.ts` (the small questions other modules ask). Web: `web/src/pages/Away.tsx` (`/urlaub`). iOS: `ios/ToHuus/Features/Away/AwayView.swift`.

A trip has dates, travellers and (optionally) people staying at home. There are two kinds, and since 15 Oct 2026 they behave differently.

## Everyone is away (holiday)

Every member is among the travellers, and nobody is listed as staying home (`everyone_away: true`).

- **Before:**
  - "Zuerst aufbrauchen": recipes for what would go off.
  - Fresh things stay off the list.
  - A checklist covering fridge, bins, plants, post and the tasks that fall due.
  - Packing.
- **During:**
  - Routine notifications stay quiet, if switched on.
  - Automatic list suggestions pause.
  - The week plan leaves the evenings empty.
  - Holiday kitchen and the house-sitter link.
  - Home Assistant shows `away`.
- **After:**
  - The welcome-home list.
  - What expired while you were away.
  - Booking stock back in.

## Only some are away (decision 15 Oct 2026)

Examples are a business trip, a course, or a few days at a friend's. Web: "Nur ich bin weg" on `/urlaub`. iOS: the + menu.

- The house runs on. The fridge, use-up list, paused suggestions, holiday kitchen, house sitter and welcome-home list are hidden or off, and the week plan and shopping list carry on.
- **Notifications:** routine messages stay quiet only on the devices of the people away. Everyone at home still gets them (`quietUsers()` → `exceptUserIds` in `notify.ts`).
- **Taking turns:** a turn skips whoever is away on the next due day (`nextInTurn(rotation, current, day)`). Their turn comes the time after.
- **Tasks:** a task whose doer, keeper or usual person is away shows "Sam ist bis Fr. weg", and the due reminder asks whether someone at home can do it (`careView().away`).
- **Cook suggestion:** nobody is suggested for a day they are away.
- **Checklist:** only the tasks of the people away that fall due during the absence ("hand it over first"), plus things from stock to take along.
- **Home Assistant:** the house stays `home`, so one person's trip never turns the heating down. `people_away` lists the names.
- **More than one trip at a time:** different people may be away at the same time on different trips. One person can't be on two trips at once (409). When the trips together cover everyone, the week plan treats those days as "nobody home".

## "Nich to Huus"

Low German for "not at home". While a person is away themselves:
- the web sidebar says "Nich to Huus" instead of "ToHuus";
- Heute (web and iOS) says "Nich to Huus · zurück am …" instead of the date.

The others see "Unterwegs: Sam (bis Fr.)" under the greeting. Only names and dates are shown. A trip's name and place stay on the trip.

## API additions (15 Oct 2026)

| Where | Field |
|---|---|
| `GET /api/me` | `away_until`: the person's own last day away, or `null` |
| `GET /api/today` | `away: { me: { until } \| null, others: [{ name, until }] }` |
| `GET /api/care`, `/api/care/:id` | each task: `away: { name, until } \| null` |
| `GET /api/away`, `/api/away/summary` | `summary.people: [{ key, name, until }]`. For partial trips, `use_up`, `welcome` and `expired` are empty. |
| `GET /api/away/trips/:id` | for partial trips, `use_up`, `recipes`, `welcome` and `expired` are empty, and `checklist` is the personal one |
| HA `GET /api/ha/v1/away` | `people_away: [{ name, until }]`; `state` counts household-wide trips only |
| `POST`/`PATCH /api/away/trips` | overlap is checked per traveller, not per household |
