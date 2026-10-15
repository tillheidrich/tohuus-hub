# Für wen ich da bin, alleinerziehend, "Du machst das seit Wochen"

Decision of 15 Oct 2026. Till: "Die App muss erkennen, wenn jemand alleinerziehend ist, aber auch, wenn jemand zusätzlich einen Angehörigen pflegt – egal ob zu Hause, im Altenheim oder ob man an die Arzttermine denkt. Auch das muss Raum finden. Und zwar so, dass man diesen Leuten klarmacht, wie gut das ist."

Research with sources: `docs/research/2026-10-15-care-single-parents.md`.
- 86 % of the 5.7 million people needing care live at home (Destatis 2024).
- 64 % of carers are women, and 64 % care outside their own household (DIW 2025).
- 41 % of relatives who help from a distance say others don’t see how much they do (ZQP, Pflege auf Distanz, 2022). An often quoted 52 % (ZQP 2018) is only available second-hand, so we don’t use it.
- 80 % never claim the Entlastungsbetrag (VdK 2022).
- 1.62 million single parents, 84 % of them women (Destatis 2026).

## Für wen ich da bin (`server/lib/carefor.ts`)

- **A person I look after:** name, relation and where they live (with us, own flat, care home, other).
  - **Private by default:** it is health data under Art. 9 GDPR. Sharing it with the household is one tap, and the person's tasks follow that setting.
  - Only the member who added the person can change or remove them.
- **Their tasks:** for example a visit every Sunday, the GP appointment or picking up a prescription. These are normal tasks linked by `cared_for_id`, so reminders and due dates work as everywhere else.
- **"Heute da gewesen":** one tap with a kind (visit, call, appointment, errand, other) and an optional note.
- **Weekly and month review:** in the person's own part, "3 Mal für Oma Inge da gewesen – das ist Arbeit, und sie zählt." It never appears in the household part, and never on a share card with the name.
- **Help that's due:** the Pflegetelefon (030 20179131), the Entlastungsbetrag, respite and short-term care, and wege-zur-pflege.de.
  - These are links to official pages only. There are no amounts in the code, because the PNOG reform (cabinet 30 Sep 2026) will change them.
  - ToHuus doesn't advise; it points to where advice is.
- **Recognised gently:**
  - The hint "Kümmerst du dich um jemanden?" shows once and can be dismissed. It appears when the household form is "carer", or when the person's own tasks or thoughts mention it (Oma, Pflegeheim, Rezept, Pflegedienst …).
  - Nothing is created on its own, and nobody is asked for a care level or family status.
- **Never shared:** nothing goes to the assistant, MCP, Home Assistant, widgets or exports.
  - `listCareTasks({ outside: true })` and `findCareTask` leave the linked tasks out.
  - The only notification is the task reminder, and a private task reminds its owner alone.

## Single parents

- **Detected, never asked:** exactly one grown-up member plus at least one child profile (`homeSetup().single_parent`).
- The household part of the weekly and month review is called "Zu Hause" (not "Das habt ihr geschafft") and carries the note "Alles auf deinen Schultern – und schau, was du geschafft hast."
- There are no comparisons, because "Wer macht was" has nobody to compare with.

## "Du machst das seit Wochen" (`habits.ts carrying`)

- **When:** in a household of at least two members, when the last 6 times a task was done were all by the same person.
- **Only that person sees it,** on Aufgaben. It starts with a thank-you, then offers "Abgeben an …" (the existing offer feature).
- **One tap dismisses it for good.** It is never shown to the others and never phrased as a comparison. A tiresome task can feel lonelier than it is.

## API (members only, otherwise 403)

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/api/carefor` | – | `{ people: [{ id, name, relation, place, visibility, mine, owner, tasks: [CareView], recent: [{ id, user_id, by, mine, day, kind, note }], this_week }], help: [{ key, title, url }] }` |
| POST | `/api/carefor` | `{ name, relation?, place?: home\|own\|care_home\|other, visibility?: private\|household }` | `{ id }` |
| PATCH | `/api/carefor/:id` | the same fields plus `archived?` (owner only) | `{ ok }` |
| DELETE | `/api/carefor/:id` | – (owner only) | `{ ok }` |
| POST | `/api/carefor/:id/log` | `{ kind?, note?, day? }` | `{ ok, message }` |
| DELETE | `/api/carefor/log/:id` | – (own entries) | `{ ok }` |
| POST | `/api/carefor/:id/tasks` | `{ name, interval_n?, interval_unit?, next_due?, due_time? }` | the task |
| GET | `/api/carefor/hint` | – | `{ show, why?: form\|words }` |
| POST | `/api/carefor/hint/dismiss` | – | `{ ok }` |
| GET | `/api/habits` | – | adds `carrying: [{ task_id, name, times }]` (only the viewer's own) |
| POST | `/api/habits/carrying/:id/dismiss` | – | `{ ok }` |
| GET | `/api/me` | – | `home.single_parent`, `home.adults`, `home.kids` |
