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

A one-off task without a rhythm is archived when it is done. `learned_every_days` on the detail is the median gap between the last done days.

## API

- `GET /api/care` → `{ tasks, templates, units, me }` – private tasks only for their owner.
- `GET /api/care/due`, `GET /api/care/:id` (404 for someone else's private task), `GET /api/care/recent?days=14`.
- `POST /api/care` / `PATCH /api/care/:id` accept `category`, `visibility`, `anchor`, `as_needed`, `checklist`, `doer_key`, `rotation`. A household task made private belongs to whoever made it private.
- `POST /api/care/:id/done`, `POST /api/care/:id/undo` as before.
- `GET /api/blick?days=28` – "Wer hat was im Blick" (below). `PUT /api/blick/compare { on }` – my own yes/no to comparing shares.

Templates: twelve chores in group `chores` (category `house`).

## Wer hat was im Blick

`server/lib/blick.ts`. Per area – Einkauf (put on the list or ticked off), Kochen (planned a meal, `meal_plan.added_by`), Geld (brought in a receipt/bill, `imports.actor`), Aufgaben (done household tasks) – the members who were involved in the last 28 days, **alphabetical, no numbers**. Every member sees their own number (`mine`). Shares in percent appear only when **every** member switched on "Anteile vergleichen" (`user_prefs` key `blick.compare`). `loose_tasks` lists household tasks nobody keeps in mind or does. Guests get 403.

Never counted: private list items, personal receipts (`private_for`), private tasks, non-members ("Home Assistant", "ToHuus Hub", tokens).

## Privacy

A private task is never visible to other members, guests, the assistant (tools and context), MCP, Home Assistant, notifications to others, displays, labels/QR, tickets or other members' exports. Reminders for a private task go only to its owner (`toUserId`, `personalOnly`). Covered by `test/tasks.test.ts` and `test/cloud-isolation.test.ts`.

## Apple Reminders and Calendar (CalDAV)

`server/lib/caldav.ts`, same app password as the shopping lists (`/api/caldav/passwords`):

- `/caldav/c/t/` "ToHuus · Aufgaben" – household tasks as VTODO. Ticking off completes the task (once per day), a new reminder becomes a household task, deleting archives it.
- `/caldav/c/tm/` "ToHuus · Nur für mich" – the signed-in member's private tasks.
- `/caldav/c/tc/` "ToHuus · Fällig" – read-only calendar (all-day VEVENTs on the due day); writes get 403.

## Assistant

`server/lib/assistant-tasks.ts`, topic `tasks`, screen context `tasks`: `tasks_list`, `task_add`, `task_done`, `task_assign`, `tasks_overview` (who did and keeps what in mind; numbers per person only when everyone agreed to compare). Every write is undoable. Private tasks never reach the model.

## Clients

- Web: `/aufgaben` (`web/src/pages/Care.tsx`, filter Alle / Haushalt / Pflege & Fristen / Meine), Heute card `TasksToday.tsx`, `Blick.tsx`. `/pflege` redirects to `/aufgaben?f=care`.
- iOS: `CareView.swift`, `TasksTodayCard.swift`, `BlickSection.swift`, `CalDavView.swift`.
