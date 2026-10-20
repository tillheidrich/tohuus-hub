# „Jetzt“ – eine Sache nach der anderen (now)

*20 Oct 2026 · server `server/lib/next-task.ts` · web `web/src/focus/Now.tsx` · iOS `ios/ToHuus/Features/Focus/NowViews.swift`,
Live Activity `ios/Shared/TaskTimerActivity.swift` + `ios/ToHuusWidget/TaskTimerActivityWidget.swift` · help `eine-sache`*

Till has ADHD; ToHuus has to work without a good day. „Jetzt“ shows **one task at a time** – the next one only after
this one is done. Nobody sorts anything: the server decides the order, the same way every time. It builds on
„Eins nach dem anderen“ (`docs/focus.md`, `/fokus`), which keeps its own small-steps view.

No points, no streaks, no ranking, nothing counted. „Später“ is local and changes no data.

## The order (`lib/next-task.ts`)

Candidates are tasks that are **this person's or nobody's**: a task someone else does (`doer`, also in turn or as a
stand-in), keeps in mind (`assignee`) or promised („Mach ich“) stays theirs. Left out: archived, „when needed“, tasks
that may wait while someone is away (`waits`).

| Level | `level` | What |
|---|---|---|
| 0 | `overdue` | due before today |
| 1 | `today` | due today – by `due_time`, tasks without a time after the timed ones |
| 2 | `promised` | my „Mach ich“ for today or a passed day (task not due yet) |
| 3 | `mine` | coming up and mine: doer / my turn / I keep it in mind / my private task / promised by me for later |
| 4 | `open` | coming up and nobody has it |

„Coming up“ = state `soon` (within the task's own `lead_days`), never more than 7 days ahead (like Heute › Demnächst).
Within a level: `next_due`, then `due_time`, then `created_at`, then `id`. When everything is done the queue is empty
– a calm „Alles geschafft“, not tomorrow's things.

Privacy: a member asking for themselves sees their own private tasks; asking for another member (`for=user:<id>`) or a
child never returns any private task. Children (`k<id>`) get their own tasks (doer, also in turn) and **open household
tasks marked `kids_ok`** („Kinder dürfen das machen“) – never private tasks, never tasks for someone a member looks
after (`carefor.ts`). Permanent guests get only what was handed to them (`mineOnly`), guest links nothing.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/tasks/next?for=me\|user:<id>\|kid:<id>` | `{ for, person, timer_min, today, next, after, queue }` – `queue` (max 50) is the whole order so „Später“ works without asking again; `next` = `queue[0]`; `after` = how many after it. Card: `{ id, name, emoji, note, next_due, due_time, state, level, effort_min, doer, checklist, place, private }` |
| GET | `/api/kid/:token/tasks` | the kid tablet's queue: `{ view: 'now'\|'list', next, after, queue }` (no notes); also inside `GET /api/kid/:token` as `tasks` (empty during quiet time) |
| POST | `/api/kid/:token/tasks/:id/done` | only a task in the kid's queue (else 404) → `{ ok, log_id, …queue }`; actor = the kid's name, rate-limited |
| POST | `/api/kid/:token/tasks/:id/undo` | `{ log_id }` – only the kid's own tick of the last two minutes → `{ ok, …queue }` |
| PATCH | `/api/kids/:id` | `task_view: 'now' \| 'list'` (admins) |
| POST/PATCH | `/api/care…` | `effort_min` (1–240, null) „Dauert etwa“ – the timer starts with it; `kids_ok` (bool, never on private tasks) |
| GET/PUT | `/api/focus/prefs` | `oneThing` (bool) – „Nur eins“ on Heute, personal |

Migrations: `tasks-now` (`care_tasks.effort_min`, `care_tasks.kids_ok`), `kids-now` (`kid_profiles.task_view`, default `now`).
`effort_min` is separate from `duration_min` (the length of an appointment in the calendar).

## Clients

- **Heute › Aufgaben heute › „Nur eins“** (web `TasksToday.tsx` + `OneThingToday`, iOS `TasksTodayCard` + `OneThingTodayView`):
  a chip on the card switches it (saved in `focus.oneThing`, same on every device). The task area shows only the
  next task as a card: big **Fertig** (toast with undo for 10 s), **Später** (to the end of the queue for this
  visit only – module/static memory, nothing stored), **Los – n Min.** (timer), „+4 weitere“ leaves the mode.
  Shopping and the other Heute cards stay. A tip on the card (≥ 3 open tasks, dismissable per device) offers it.
- **Kinder-Tablet** (web `Kids.tsx` `KidNow`, iOS `KidModeView` + `KidNowPanel`): a tab „Zu tun“ – first when there is
  something to do. Big card (emoji, title, who), very big „Fertig“, below only „noch 3 danach“ (dots for children who
  can't read yet; tapping reads it aloud), timer only when the task has `effort_min`. After „Fertig“ a short
  „Super, geschafft!“, then the next; undo for 10 s; „Alles geschafft. Zeit zum Spielen.“ at the end. Parents switch
  to a list in the kid settings („Aufgaben auf dem Tablet“).
- **Timer**: counts down the task's `effort_min` (else the person's `timerMin`). The end is soft: a light haptic /
  vibration, a kind line, in the background on iOS a passive notification without sound. No alarm.
- **Live Activity (iOS)**: only while the timer runs – lock screen and Dynamic Island with emoji, title and countdown
  (`Text(timerInterval:)`, no updates needed). Ends on Fertig, „Timer stoppen“, leaving the card, or when the time is
  up (also swept on the next app start / Heute load). Lives in the existing widget extension (`ToHuusWidget`, same
  bundle as „Einkauf läuft“) – no new target, no new entitlement; `NSSupportsLiveActivities` was already set.
- **Abgeblendet**: an appointment of today whose time plus its length is over, and any day that is gone, is dimmed in
  Heute › Aufgaben heute and in the Aufgaben list (`isPast` in `web/src/pages/taskTime.ts`, `TaskTime.isPast` on iOS).
  Demnächst only ever lists future days.

## Tests

`test/now.test.ts`: the order (all five levels, time within today, ties), leaving out others' tasks, far dates and
„when needed“; rights (other members never see private tasks, also not via `for=user:`; children only own + `kids_ok`;
`kids_ok` refused on private tasks); done → next, undo → back; kid tablet done/undo and its limits; `task_view`
admin-only; `effort_min` validation; `oneThing` personal. `test/cloud-isolation.test.ts` covers `/api/tasks/next`.
