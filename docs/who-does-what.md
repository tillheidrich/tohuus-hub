# Wer macht was: how visible household work should be

*Decided 15 Oct 2026 · server `server/lib/habits.ts`, `care.ts` (`usualDoer`, offers) · web `web/src/pages/WhoDoesWhat.tsx`, `shop/claims.tsx` · iOS `Features/Household/WhoDoesWhatViews.swift`, `Cooking/WeekPlanView.swift`*

Till's question was how much of the household ToHuus should make visible, and who does what. Till: *"Seit drei Wochen kocht Till, also wird er das wieder machen – und da Lea vieles andere macht, ist das gerecht."*

## What other apps do, and what we take from them

| App | Approach | Our take |
|---|---|---|
| OurHome, Sweepy, FamilyManager | Points, rankings, rewards, streaks | No. Couples report fights, and reviewers call these apps "overly complicated" (docs/research/2026-10-10-wettbewerb-und-nutzerbedarf.md). |
| FairShare, Fair Play (cards) | Make the invisible visible: who notices, plans and does what. Fair Play hands over **whole areas** ("cards") | Yes, but **learned** instead of typed by hand. Fairness is about areas, not counts. |
| Tody, Donetick | Rotation, per-person effort | Rotation we have. Effort numbers only if everyone wants them. |
| Reddit, r/Parenting (docs/research/2026-10-10-reddit-tiefenrecherche.md) | "He does all food, I do all money/logistics" is a happy split. The fight is about *invisibility* | Show who carries what, by area. Do not count minutes. |

## Decision

1. **Learn quietly, say it plainly.** If one person did a household task at least 3 of the last 6 times (and 70 % of them), it says "meistens Sam".
   - Cooking: who cooked in the last 3 weeks, and per weekday ("montags meistens Sam").
   - Areas (the big shop, receipts, planning meals) come from the same data as "Wer hat was im Blick".
2. **Use it, but don't decide for people.**
   - An open dinner in the week plan shows the likely cook faded, with a dashed outline. Only a tap enters them.
   - Reminders for a task without a doer say "Sam macht das meistens."
3. **Make it explicit if you want.** "Sam macht „Müll raus“ meistens. So eintragen?" turns the habit into the task's doer with one tap. "Offen lassen" means ToHuus never asks again.
4. **Help change it.** "Abgeben an …" asks another member, who gets the question on Heute and in Aufgaben.
   - Yes: from now on they do it. If the task takes turns, they take the giver's place in the turn.
   - No: it stays where it was, and the giver hears back kindly.
5. **How visible.**
   - **Always (members):** "Wer macht was" in Aufgaben lists per person the areas and tasks they usually carry. Names only, alphabetical, no numbers.
   - **The open ones:** "Das macht noch niemand regelmäßig: …"
   - **A judgement on the balance only when everyone agreed to compare** (the Blick opt-in). It is weighed by **what each person carries**, not by how often: cooking every day counts as one area. The texts are "Gerade ziemlich gut verteilt" or "Gerade liegt vieles bei Mira. Mag jemand etwas übernehmen?"
   - **Never:** rankings, points (unless the optional Sterne are switched on, docs/points.md), streaks, "best" anything, counts per person for others without opt-in, private tasks. Guests, guest links and widgets see nothing of this.
6. **Gentle mode** changes nothing here, because there are no numbers and no red.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/habits` | `{ people: [{ user_id, name, color, me, does: [{ kind: 'area'\|'task', key, label, task_id? }] }], open, proposals: [{ task_id, name, user_id, user_name }], cook_lately, compare, balance: { state: 'even'\|'leans', name? } \| null }` |
| POST | `/api/habits/proposals/:id` | `{ accept }` – accept sets `doer_key`; false never asks again |
| GET | `/api/habits/cook?from&to` | `{ lately, suggestions: [{ entry_id, day, user_id, name, color, why: 'weekday'\|'lately' }] }` – open meals only, nothing is stored |
| POST | `/api/care/:id/offer` | `{ to_user_id \| null }` – ask (or withdraw); not for private tasks |
| POST | `/api/care/:id/offer/answer` | `{ accept }` – only the person asked |

Tasks carry `usual: { user_id, name, color } | null` and `offer: { to, by } | null`. Members only: guests get 403. `/api/habits` and `/api/habits/cook` are in the cloud isolation test. Tests are in `test/tasks.test.ts` ("Wer macht was").
