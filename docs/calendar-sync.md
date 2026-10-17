# Kalender lesen: bins from your calendar, tasks into your calendar

*15 Oct 2026 · server `server/lib/calsync.ts` · web `web/src/pages/CalendarSync.tsx` · iOS `ios/ToHuus/Features/Household/CalendarSyncViews.swift`*

Many households already have a calendar: the shared iCloud calendar with the bin collection, or a family calendar. ToHuus can read it, but it does not become a family calendar and has no calendar view. It only takes out what is household work.

## On the iPhone (Aufgaben › Euren Kalender lesen)

1. **Permission.** The app asks for full calendar access (`NSCalendarsFullAccessUsageDescription`) only on this screen, after a tap. Everything else works without it. The "In den Kalender" button keeps using Apple's editor, which needs no permission.
2. **Pick calendars.** Only the ticked calendars are read, from today as many weeks ahead as the household set (2–26, default 26 – since 17 Oct 2026; before it was a fixed 120 days). Why 26: weekly to four-weekly bins need about 12 weeks for a rhythm, but Sperrmüll comes once or twice a year and the Christmas tree only in January. The server drops days beyond the window, whatever a phone sends. Changing the weeks asks for a new read.
3. **Bins without AI.** The server's rules (`BIN_KINDS`, returned as `patterns` by `GET /api/calsync`) are matched on the phone. Kinds: Restmüll, Bio, Papier, Gelbe Tonne/Sack, Sperrmüll, Grünschnitt, Weihnachtsbaum. The phone sends only `{ kind, day }`. No titles are sent and no other events. Office days, doctor's appointments and everything else stay on the phone.
4. **Both ways (optional).** Pick a calendar under "Aufgaben eintragen in":
   - Household tasks with a date are written into it. Private tasks are never written, and neither are the bin tasks, because those are already in that calendar.
   - Moving an entry there moves the task (date, time, duration).
   - Deleting an entry there means ToHuus does not write that task again.
   - When a task is done for good or has no date any more, ToHuus removes its own entry.
   - The mapping (task ↔ entry) lives only on the phone (`CalendarSyncPrefs`, per household).
5. **When it runs.** When the app becomes active, at most once an hour, with "Jetzt neu lesen", and on the next app start after "Jetzt neu lesen" in the browser or a change of the weeks (`rescan_requested`).

Two phones can read the same calendar (two partners): each sends its own `source` (a random id). The server stores each collection day once per kind.

## Tasks from bins

- A newly found kind is only **proposed** (`state: 'new'`). The screen shows it in a ticked list with the next date, the rhythm ("alle 2 Wochen") and the number of dates; "Übernehmen" makes tasks of the ticked ones and switches the others off (`POST /api/calsync/kinds { on, off }`).
- **Switched off** (`state: 'ignored'`, `POST /api/calsync/kinds/:kind/ignore`): its task is deleted, not hidden, and a later read does not bring it back. "Wieder einschalten" (`…/revive`) makes a new task.
- **Kalender trennen** (`POST /api/calsync/disconnect`): every task from the calendar is deleted, all dates and choices are forgotten. Phones set up before that moment (`disconnected_at` > their `connectedAt`) stop reading and take their own written entries out. Connecting again starts with the ticked list.
- Each kind taken over becomes **one** household task ("Gelbe Tonne raus", category `house`, `ext_kind = 'yellow'`).
- Its date is the next collection, **the evening before** by default, or on the morning (`PUT /api/calsync/settings { offset }`).
- **Done** moves it to the next collection date, not by an interval. An open one from yesterday stays until done.
- Rotation, "Mach ich", reminders, Apple Reminders/CalDAV and the subscription feed work as for every task.
- **Archiving or deleting** the task by hand also counts as switched off, until "Wieder einschalten" (`POST /api/calsync/kinds/:kind/revive`).
- Stored per household: `calsync_dates(kind, day, source)`, without titles. Dates older than 60 days are removed. `calsync_kinds(kind, task_id)` is also stored.

## Abgleich mit KI (own consent per person)

"KI darf Kalendereinträge mit Aufgaben abgleichen" is a **separate** permission per person (`PUT /api/calsync/ai { consent }`, user pref `calsync.ai` with the date). The text names the recipients (Mistral via OpenRouter, USA). Apple requires this kind of disclosure before personal data goes to a third-party AI (guideline 5.1.2(i)).

With consent, "Vorschläge holen" works like this:
- The phone sends title, day and time of the next 30 days of the picked calendars to `POST /api/calsync/suggest`.
- The server drops anything the bin rules recognise, sends at most 40 entries to the model, and returns `{ suggestions: [{ title, day, time, name }] }`.
- Nothing is stored. The person takes over suggestions one by one, and each becomes a normal task.

Without consent the route answers 403 and nothing reaches the model. The household AI switch, the person's AI switch, the kid lock, the general AI consent (cloud) and the monthly allowance (`consumeAssistant`) apply as everywhere.

## Web

There is no browser access to iCloud calendars. Settings › Konto and Aufgaben show the card "Euren Kalender lesen" with:
- the last read time,
- the next collection per kind,
- "Wieder einschalten",
- evening or morning,
- the person's AI consent.

Tasks from the calendar say "aus dem Kalender". The card also shows "Wir lesen die nächsten N Wochen", the window of the last read, the ticked list, a switch per kind, the weeks, "Jetzt neu lesen" (asks the iPhone) and "Kalender trennen".

## The way back: tasks into a calendar

Explained in Aufgaben ("So kommen eure Aufgaben in euren Kalender", web `TasksToCalendarHelp`, iOS `TasksToCalendarHelpView`):
- Apple Calendar: CalDAV "Erinnerungen & Kalender" (`lib/caldav.ts`), both ways.
- Google, Outlook and others: the subscription link `/kalender-abo/<secret>.ics` (webcal, read-only, about hourly; `lib/calendar.ts`, tested in `test/tasks.test.ts`).
- An existing calendar via the iPhone ("In beide Richtungen" above).
- One task: "In den Kalender" (`GET /api/care/:id/ics`).

## API

| Method | Path | |
|---|---|---|
| GET | `/api/calsync` | `{ settings: { offset, weeks }, last_sync, horizon_days, horizon_weeks, window: { from, to }, rescan_requested, disconnected_at, kinds: [{ key, name, patterns, next, dates, upcoming, rhythm_days, task_id, state, off }], ai: { consent, consent_at, available, off_reason } }` – members only |
| POST | `/api/calsync/dates` | `{ source, from, to, dates: [{ kind, day }] }`, which replaces this source's dates in the window (cut at the household's weeks), updates tasks of kinds that are on → `{ ok, stored, created: [], proposed }` |
| PUT | `/api/calsync/settings` | `{ offset?: 'evening' \| 'morning', weeks?: 2–26 }` |
| POST | `/api/calsync/kinds` | `{ on: [kind], off: [kind] }` – the ticked list |
| POST | `/api/calsync/kinds/:kind/ignore` | switch off: task deleted, not made again |
| POST | `/api/calsync/kinds/:kind/revive` | on again (new task, or back from the archive) |
| POST | `/api/calsync/rescan` | ask the phone(s) to read again |
| POST | `/api/calsync/disconnect` | remove all tasks from the calendar, dates and choices → `{ …view, removed }` |
| PUT | `/api/calsync/ai` | `{ consent: boolean }`, for the signed-in person |
| POST | `/api/calsync/suggest` | `{ events: [{ title, day, time? }] }` → `{ suggestions }`. 403 without consent or with AI off |

Guests and guest links get 403. Tasks carry `ext_kind`. Tests: `test/calsync.test.ts`.

## Later (not built)

- Self-hosted and web without an iPhone: the server reads an iCloud calendar over CalDAV with an app-specific password, stored encrypted. That is second choice, because a password would sit on the server.
- Learn more kinds from the household (e.g. "Schadstoffmobil") when someone renames a task.
