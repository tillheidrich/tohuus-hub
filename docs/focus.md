# Für Köpfe, in denen viel los ist (focus)

*14 Oct 2026 · server `server/lib/focus.ts` · web `web/src/focus/Focus.tsx` · iOS `ios/ToHuus/Features/Focus/FocusViews.swift`*

Help for ADHD, autistic and simply overloaded households – and for everyone who wants less on their plate at once.
No tracking, no streaks, no statistics, no points.

## Pieces

- **Kleine Schritte** – any task can be split into small steps (its sub-items, `care_tasks.checklist`). "In kleine
  Schritte teilen" proposes steps: AI when the household and the person allow AI (counted like one assistant
  message), otherwise – or when anything fails – built-in steps for common chores (bathroom, kitchen, laundry,
  vacuuming, bed linen, fridge, bins, tidying, shopping, windows) and a generic five-step fallback. Nothing is saved
  until the client saves the checklist; proposed steps are merged, duplicates skipped.
- **Eins nach dem anderen** (web `/fokus`, iOS Aufgaben › Eins nach dem anderen) – one task at a time in the same
  order as „Nur eins“ (since 20 Oct 2026: `GET /api/tasks/next`, the server's „Jetzt“ queue, `docs/now.md` – the client
  sorts nothing), on the same card (web `NowCard`, iOS `NowCardView`, `numbered`). Shows the next unticked step big
  („Schritt 2 von 4“, else the note), the timer (starts with the task's `effort_min`, else the personal default) and
  three buttons: *Geschafft* (ticks the step, the last step completes the task), *Später* (to the end for this app
  session only – shared with „Nur eins“, nothing stored), *Zu groß? Kleiner machen* (adds proposed steps).
  „Focus on this“ (`?task=<id>`) puts that task first; a task outside the queue is loaded with `GET /api/care/:id`.
- **Sichtbarer Timer** – 5/10/15/25 minutes ("Einfach anfangen"), a ring, a gentle signal at the end (sound and
  vibration on the web, a local notification on iOS when the app is in the background). Not stored anywhere.
- **Sanfter Modus** (personal) – no red for due things, no "x days overdue" ("wäre dran"), no attention counter on the
  Zuhause tab, Heute shows at most N tasks, task reminders bundled into one message a day at a chosen hour.
- **Neu anfangen** – overdue tasks I keep in mind / do / own privately and those nobody took on move to a fresh start,
  two per day from today (oldest first). Nothing is marked done, nothing is logged as missed.

## Privacy

The settings are a personal `user_prefs` row (`focus`) – never shown to other members, guests, the assistant, MCP,
Home Assistant, exports or widgets. Guests and guest links can't use the focus routes.

## API

| Method | Path | |
|---|---|---|
| GET/PUT | `/api/focus/prefs` | `{ gentle, todayMax (1–10 \| null), bundleHour (0–23 \| null), timerMin (1–60), oneThing }` – `oneThing`: „Nur eins“ on Heute ([now.md](now.md)) |
| POST | `/api/care/:id/steps/suggest` | `{ steps: string[], source: 'ai' \| 'builtin' }` – saves nothing |
| POST | `/api/focus/steps` | `{ name, note? }` → same, for a task that doesn't exist yet |
| POST | `/api/care/fresh-start` | `{ per_day?: 1–5 }` → `{ moved, until, tasks: [{ id, next_due }] }` |

Bundled reminders: `sendCareBundles()` (scheduler) sends one `care.due` message per person and day at `bundleHour`
(personal channels only); the one-by-one `care.due` reminders leave these people out.
