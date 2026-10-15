# Wochenrückblick

Decision of 15 Oct 2026 (Till: "Wochenrückblicke pro Person und Familie – immer nur positiv: das habt ihr, das hast du geschafft").

Server: `server/lib/weekly.ts` (the cards come from `server/lib/review.ts`). Web: `web/src/pages/WeekReview.tsx` (page `/woche`, card on Heute, link on Aufgaben). iOS: `ios/ToHuus/Features/Today/WeekReviewViews.swift` (card on Heute, link on Aufgaben).

## What it shows

Two parts for one week (the region's first weekday to its last):

- **"Das habt ihr geschafft"**: the household's week, without names. The cards are things bought, things put on the list, meals planned, new recipes, household tasks done and things used up from the pantry. When a person lives alone, this part is called "Zu Hause".
- **"Das hast du geschafft"**: only for the person themselves, and nobody else ever sees it. It shows their tasks (their own private tasks included), the things they bought, the meals they took on ("Ich koch"), the things they put on the list and the receipts they brought in.

## Positive only

- No comparison between people, no shares and no ranking.
- No money.
- The only comparison is with the week before: "{n} weniger weggeworfen als in der Woche davor". It shows only when fewer things were thrown away.
- A card appears only when there is something to show, so nothing is ever zero.
- A quiet week gets "Eine ruhige Woche – auch das darf sein."
- Private things count only in the person's own part. Private list items, private tasks and personal money never count in the household part.

## When it shows

- On "Heute", in the first three days of a new week, for last week. It stays until the person taps "Gesehen" or opens it.
- The page `/woche` (and on iOS, the link on Aufgaben) shows any past week.
- Each person has a switch, "Auf „Heute“ zeigen" (`week.review` in user_prefs, on by default). Turning it off only hides the Heute card.
- Guests, house guests and guest links never see it, and get 403.

## API

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/api/week-review` | `?week=YYYY-MM-DD` (any day of the week, default last week) | `{ from, to, on, show, title, household: { title, cards }, mine: { title, cards } \| null, quiet }` |
| PUT | `/api/week-review/settings` | `{ on: boolean }` | `{ on }` |
| POST | `/api/week-review/seen` | `{ from: 'YYYY-MM-DD' }` | `{ ok: true }` |

A card has the same shape as in the year in review (`docs/review.md`): `{ key, area, value, title, text, list }`. The household keys are `shop_bought`, `shop_noticed`, `cook_planned`, `cook_new`, `tasks_done` and `pantry_used`. The personal keys are `my_tasks`, `my_shop`, `my_cook`, `my_noticed` and `my_receipts`.

`show` is true only when all of these hold:
- the switch is on;
- no `week` was asked for;
- it is within the first three days of the new week;
- the person has not marked the week as seen;
- there is at least one card.
