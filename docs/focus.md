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
- **Eins nach dem anderen** (web `/fokus`, iOS Aufgaben › Eins nach dem anderen) – one task at a time: overdue and
  today, the ones I keep in mind / do / own privately and the ones nobody took on first. Shows the next unticked step,
  a visible timer and three buttons: *Geschafft* (ticks the step, the last step completes the task), *Später*
  (next one, local only), *Zu groß? Kleiner machen* (adds proposed steps).
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
| GET/PUT | `/api/focus/prefs` | `{ gentle, todayMax (1–10 \| null), bundleHour (0–23 \| null), timerMin (1–60) }` |
| POST | `/api/care/:id/steps/suggest` | `{ steps: string[], source: 'ai' \| 'builtin' }` – saves nothing |
| POST | `/api/focus/steps` | `{ name, note? }` → same, for a task that doesn't exist yet |
| POST | `/api/care/fresh-start` | `{ per_day?: 1–5 }` → `{ moved, until, tasks: [{ id, next_due }] }` |

Bundled reminders: `sendCareBundles()` (scheduler) sends one `care.due` message per person and day at `bundleHour`
(personal channels only); the one-by-one `care.due` reminders leave these people out.
