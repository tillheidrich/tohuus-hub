# Sterne (optional points)

*14 Oct 2026 · server `server/lib/points.ts` · web `web/src/pages/Stars.tsx` · iOS `ios/ToHuus/Features/Today/StarsViews.swift`*

Some households like a little game. ToHuus allows it – off by default, twice:

1. **The server allows it.** Self-hosted: `POINTS=on` in the environment. ToHuus Cloud: back office › Settings ›
   "Sterne für Haushalte" (runtime setting `points`, overrides the env). Off = no stars anywhere, no UI.
2. **A household admin switches it on** (Mehr › Haushalt › Sterne) and picks the areas: Aufgaben, Einkauf, Kochen, Geld.

## What counts

A star is a contribution ToHuus sees anyway – the same data as "Wer hat was im Blick" (`blick.ts countsSince`):
a done household task, an item put on the list or ticked off, a meal planned, a receipt brought in. Private tasks and
personal receipts never count. The week starts on the region's first weekday.

## What is shown

- "Sterne diese Woche": **the week together** and **my own stars**, per area.
- Other members' stars only when everyone agreed to compare (the Blick opt-in) – alphabetical, never sorted by stars.
- Children (kid profiles) with stars this week are listed by name.
- No ranking, no streaks, nothing to lose. People in **gentle mode** (`focus.ts`) see no stars at all.
- Guests and guest links: nothing.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/points` | `{ allowed, on, areas, hidden?, week: { total, mine, by_area: [{ area, total, mine }], people: [{ name, stars }] \| null, kids } \| null }` |
| PUT | `/api/points/settings` | admins: `{ on, areas: ('tasks'\|'shop'\|'cook'\|'money')[] }` – 403 when the server doesn't allow stars |
