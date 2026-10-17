# "Was habt ihr heute gelöst?", "Fertig für heute", Monatsrückblick

Decision of 15 Oct 2026. Till's example: "Lea hat angerufen: Du gehst heute nochmal mit Frieda raus. Gleichzeitig hat sie schon den Geschirrspüler ausgeräumt, was ich sonst immer mache. Das haben wir ohne die App gelöst … die App kann auch mal fragen: Was habt ihr heute gelöst? So wird sie schlauer – und deckt auf, dass die Zusammenarbeit manchmal besser läuft, als man denkt." He also wrote: "Die App muss durchgehend Positivität versprühen. Sie darf nie dazu führen, dass sich jemand schlechter fühlt. Bildschirmzeit ist schlecht."

Research: `docs/research/2026-10-15-screen-time-wellbeing.md`.
- Streaks harm, especially when people blame themselves (Silverman & Barasch 2023).
- Notifications bundled 3 times a day help, and switching them off entirely does not (Fitz 2019).
- A concrete plan quiets open loops (Masicampo & Baumeister 2011).
- A visible "done for today" state is a calm-technology pattern.
- We do not claim "reduziert Stress" (UWG, HWG).

## The evening question (`server/lib/checkin.ts`)

- **When:** on Heute from 17:00 household time, at most every other evening, and only until it is answered or skipped. There is no push and no streak.
- **Answering:**
  - Chips show the household's most frequent tasks; text is free for anything else.
  - Each item gets a person ("Ich" or a member).
  - A task is ticked off for that person, at most once a day. This is how ToHuus learns who does what (`care_log.actor_user_id`).
  - Anything else becomes "nebenbei erledigt" (`mind.ts`). When someone else did it, `done_by` is set and the entry is for the household, so that person sees "Sam hat eingetragen: Mira hat den Geschirrspüler ausgeräumt" and gets a "Danke".
- **The reply is always positive:**
  - "Heute habt ihr zusammen 6 Sachen gelöst. Schön."
  - "Heute eine Sache gelöst – das zählt."
  - "Ein ruhiger Tag – auch das darf sein."
  - It never says who did less.
- **Switch:** each person can turn it off (`checkin.on`).

## "Fertig für heute"

`/api/today` carries `calm: true` when nothing is due or overdue for the person and nothing is waiting for a look. Heute then ends with "Für heute ist alles Wichtige erledigt. Leg das Handy ruhig weg." There is no feed and nothing to keep scrolling.

## Monatsrückblick

`GET /api/month-review?month=YYYY-MM-DD` takes any day of the month (default: last month). It has the same shape as the weekly review (`docs/week-review.md`), plus `period` and `note`. It is never offered on Heute by itself. The page `/woche` switches between "Woche" and "Monat", and so does the iOS view.

## API (members only, otherwise 403)

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/api/checkin` | – | `{ on, ask, question, chips: [{ task_id, name, done_today }], members: [{ id, name, color, me }], solved_today }` |
| POST | `/api/checkin` | `{ items: [{ task_id? \| text?, who? }] }` | `{ saved, solved_today, message }` |
| POST | `/api/checkin/skip` | – | `{ ok }` |
| PUT | `/api/checkin/settings` | `{ on }` | `{ on }` |
| POST | `/api/mind` | adds `done_by?` (a member, only for `done`) | the entry, now with `done_by`, `about_me` |
| GET | `/api/month-review` | `?month=` | like `/api/week-review` |
| GET | `/api/today` | – | adds `calm` |
| PUT | `/api/share/settings` | `{ footer }` (admin) | `{ footer }` |
| GET | `/api/me` | – | adds `site_url`, `share_footer` |
