# Aufgaben (tasks)

Since 14 Oct 2026. ToHuus keeps the household's recurring and one-off tasks next to the care & deadline tasks it already had ("Pflege"): chores ("Bad putzen", "Müll rausbringen"), deadlines (TÜV, smoke detector) and personal reminders ("nur für mich"). It works the same for one person, a shared flat or a family. It is **not** a family calendar, chat or points system: no streaks, no leaderboards, no rewards.

Storage is the existing `care_tasks` / `care_log` tables (`server/lib/care.ts`, migrations `tasks-1`, `tasks-2`).

## Model

| Field | Meaning |
|---|---|
| `category` | `house` (household chore) or `care` (care & deadlines) |
| `visibility` | `household` or `private` – a private task belongs to `owner_user_id` |
| `interval_n` / `interval_unit` / `weekdays` | rhythm; `anchor` `done` counts from the day it was done, `due` keeps the calendar rhythm ("every Monday") |
| `as_needed` | no date, never due ("Altglas wegbringen") |
| `checklist` | sub-items `[{ text, done }]`, reset when the task is done |
| `doer_key` | who does it: `u<id>` member or `k<id>` child profile |
| `assignee` | who keeps it in mind (existing column) |
| `rotation` | keys taking turns – "done" passes the task to the next one, undo gives it back |
| `due_time` / `duration_min` / `place` | Termin: with a time (HH:MM, household time) the task is an appointment of `duration_min` minutes (default 60) at `place` – a classic calendar entry (migration `termine-1`) |

A one-off task without a rhythm is archived when it is done. `learned_every_days` on the detail is the median gap between the last done days.

## API

- `GET /api/care` → `{ tasks, templates, units, me }` – private tasks only for their owner.
- `GET /api/care/due`, `GET /api/care/:id` (404 for someone else's private task), `GET /api/care/recent?days=14`.
- `POST /api/care` / `PATCH /api/care/:id` accept `category`, `visibility`, `anchor`, `as_needed`, `checklist`, `doer_key`, `rotation`. A household task made private belongs to whoever made it private.
- `POST /api/care/:id/done`, `POST /api/care/:id/undo` as before. `due_time`, `duration_min`, `place` on POST/PATCH; a time needs a date (without a date it is dropped).
- `GET /api/care/:id/ics` – the task as one calendar entry to download ("In den Kalender"); 400 without a date.
- `GET /api/calendar/feeds`, `POST /api/calendar/feeds { label, with_private }` → `{ id, url, webcal }` (shown once), `DELETE /api/calendar/feeds/:id` – read-only calendar subscriptions per member.
- `GET /api/blick?days=28` – "Wer hat was im Blick" (below). `PUT /api/blick/compare { on }` – my own yes/no to comparing shares.

Templates: twelve chores in group `chores` (category `house`).

## Wer hat was im Blick

`server/lib/blick.ts`. Per area – Einkauf (put on the list or ticked off), Kochen (planned a meal, `meal_plan.added_by`), Geld (brought in a receipt/bill, `imports.actor`), Aufgaben (done household tasks) – the members who were involved in the last 28 days, **alphabetical, no numbers**. Every member sees their own number (`mine`). Shares in percent appear only when **every** member switched on "Anteile vergleichen" (`user_prefs` key `blick.compare`). `loose_tasks` lists household tasks nobody keeps in mind or does. Guests get 403 (guest links and permanent guests at every level, `family` included).

Never counted: private list items, personal receipts (`private_for`), private tasks, non-members ("Home Assistant", "ToHuus Hub", tokens).

## Privacy

A private task is never visible to other members, guests, the assistant (tools and context), MCP, Home Assistant, notifications to others, displays, labels/QR, tickets or other members' exports. Reminders for a private task go only to its owner (`toUserId`, `personalOnly`). Covered by `test/tasks.test.ts` and `test/cloud-isolation.test.ts`.

## Apple Reminders and Calendar (CalDAV)

`server/lib/caldav.ts` and `server/lib/calendar.ts`, same app password as the shopping lists (`/api/caldav/passwords`):

- `/caldav/c/t/` "ToHuus · Aufgaben" – household tasks as VTODO (with a time: `DUE` in UTC). Ticking off completes the task (once per day), a new reminder becomes a household task, deleting archives it.
- `/caldav/c/tm/` "ToHuus · Nur für mich" – the signed-in member's private tasks.
- `/caldav/c/tc/` "ToHuus · Kalender" – the household's tasks with a date as VEVENT, two-way. With a time a timed event (UTC), otherwise all-day. Moving or renaming an event changes the task; a new event becomes a task (category `house`, anchor `due`, a simple `RRULE` FREQ/INTERVAL becomes its rhythm); deleting archives it. A recurring task is one event on its next date, ToHuus keeps the rhythm.
- `/caldav/c/tcm/` "ToHuus · Mein Kalender" – the same for the member's private tasks.

Incoming times (UTC, `TZID` or floating) are read as household time (`TZ`, default Europe/Berlin).

## Wer macht was

ToHuus learns who usually does a task ("meistens Sam") and who cooked lately. It offers to write a habit down, lets members hand a task over, and shows who carries what, with names only and no numbers. See [who-does-what.md](who-does-what.md).

## Reading an existing calendar

The iPhone can read the household's own calendar (bin collection → one task per bin) and write household tasks into an existing calendar, both ways. See [calendar-sync.md](calendar-sync.md).

## Calendar subscription (webcal)

For calendars without CalDAV (Google Calendar, Outlook): `GET /kalender-abo/<secret>.ics`, read-only, `REFRESH-INTERVAL` one hour. Holds the household's tasks with a date, the member's own private ones only when `with_private` was chosen. Secrets carry the household routing prefix (cloud) and are stored as a hash; an unknown or revoked link answers 404. App passwords and feed links stop working while their member is a permanent guest (CalDAV 401, feed 404) and work again when they are a member again.

## Assistant

`server/lib/assistant-tasks.ts`, topic `tasks`, screen context `tasks`: `tasks_list`, `task_add` (with `time`, `minutes`, `place` for an appointment), `task_done`, `task_assign`, `tasks_overview` (who did and keeps what in mind; numbers per person only when everyone agreed to compare). Every write is undoable. Private tasks never reach the model.

## Clients

- Web: `/aufgaben` (`web/src/pages/Care.tsx`, filter Alle / Haushalt / Pflege & Fristen / Meine), Heute card `TasksToday.tsx`, `Blick.tsx`. `/pflege` redirects to `/aufgaben?f=care`.
- iOS: `CareView.swift`, `TasksTodayCard.swift`, `BlickSection.swift`, `CalDavView.swift` (password + subscription), `AddToCalendar.swift` (Apple's event editor, prefilled; iOS 17 needs no calendar permission for it).
- Web: "In den Kalender" downloads `/api/care/:id/ics`; `CalendarFeedCard` (shop/bridges.tsx) on Aufgaben and Settings › My account.

## Heute › Demnächst (17 Oct 2026)

Heute shows what is due today or overdue; the card *Demnächst* looks ahead so nothing surprises the household
(`server/lib/task-outlook.ts`, `GET /api/care` › `ahead`, web `TasksAheadCard` in `TasksToday.tsx`, iOS `TasksAheadCard`
in `TasksTodayCard.swift`):

- tasks due tomorrow; on Friday and Saturday the next two days (Saturday sees Monday's collection),
- tasks whose own lead time (`lead_days`) has started, never more than 7 days ahead,
- bins (calendar kind `ext_kind`, template `bins`, or a title like "Restmüll"/"Tonne") by the **evening they go out**:
  calendar bins with "am Vorabend" already carry that evening as their date, everything else goes out the evening
  before its due day. Labels: "heute Abend rausstellen · Abfuhr Montag", "morgen Abend rausstellen".
- From 17:00 (household time zone) a bin going out tonight has `now: true`: first in the list, in the primary colour,
  never red. Only tonight's items get a *Erledigt* button.
- Gentle mode: at most two, no "n more". Tasks that may wait (away) and "when needed" tasks are left out.

## "Mach ich" (14 Oct 2026)

A promise with a day: *Heute*, *Morgen*, *Am Wochenende* (Saturday; today when it's already the weekend) or a date.
The household sees "Sam macht's morgen"; the person keeps the task in mind (assignee, if nobody did yet). Once the day
is over and it isn't done, the label says kindly "Sam hatte es für Mo., 13. Okt. vor" – no red, no reminder storm.
Done clears the promise; only the person who promised can take it back.
`POST /api/care/:id/promise` `{ when: 'today' | 'tomorrow' | 'weekend' | 'YYYY-MM-DD' | null }`; tasks carry
`promise: { user_id, name, color, day, passed } | null`.

