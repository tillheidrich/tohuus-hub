# Rückblick – "Euer Jahr to Huus"

*14 Oct 2026 · server `server/lib/review.ts` · web `web/src/pages/Review.tsx` (`/rueckblick`) · iOS `ios/ToHuus/Features/Today/ReviewViews.swift`*

The household's year in a few cards, in the spirit of a year-in-review. **Built, but not active**: it stays off until
the server allows it.

- Self-hosted: `YEAR_REVIEW=on` in the environment.
- ToHuus Cloud: back office › Settings › "Rückblick" (runtime setting `year_review`, overrides the env).

Off means `GET /api/review` answers `{ allowed: false, cards: [] }`, and neither app shows anything.

## When it shows

- **Heute** shows a small card from **1 December to 15 January**. In December it covers this year; in the first half of January it covers last year (`reviewSeason`).
- The page `/rueckblick` (iPhone: from the Heute card) works all year once the server allows it. Outside the season it shows the year so far, and the year can be switched.
- If there are fewer than three cards, the page says "Noch nicht viel zum Zurückschauen" instead.

## What it shows

The household as "wir". There are no names, no shares per person, no ranking and no "best shopper". It only shows what happened:

| Card | From |
|---|---|
| Sachen eingekauft und abgehakt + the three most frequent | ticked list rows (`shopping_items.checked_at`) |
| Mal hat jemand was auf die Liste gesetzt | list rows added |
| … war euer Einkaufstag | weekday with the most ticks (from 10 ticks on) |
| Essen geplant + "Am häufigsten auf dem Tisch" | `meal_plan` (dishes planned at least twice) |
| neue Rezepte | recipes saved that year |
| Aufgaben im Haushalt erledigt + the three most frequent | `care_log` of household tasks |
| Sachen aus dem Vorrat aufgebraucht (+ "N weniger weggeworfen als im Jahr davor") | `movements` consume / waste+expired, compared up to the same day of last year |
| … für Essen und Haushalt, from N receipts | household view of the spending entries |
| … war euer teuerster Monat | from 3 months of data on |

## Privacy

- Private list rows (`notPrivate`), private tasks (`canSeeTask`), personal receipts and personal expenses (household view of `loadEntries`) never count.
- People in **gentle mode** (`focus.ts`) see no money cards.
- Guests and guest links get 403. The route is covered by `test/cloud-isolation.test.ts` (the sweep runs with `YEAR_REVIEW=on`).
- No AI is involved. The texts come from the server, in the household language.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/review?year=YYYY` | `{ allowed, season, year, enough, title, intro, outro, cards: [{ key, area: 'shop'\|'cook'\|'tasks'\|'pantry'\|'money', value, title, text, list }] }`. Without `year`: the season year, else this year. |
| GET | `/api/review?peek=1` | `{ allowed, season }`, cheap enough for Heute |

## Ideas for later (not built)

- Share a card as an image without amounts or names, only if the person wants to.
- Announce it by e-mail, with an easy way to unsubscribe.
- Free plan: a short version.
