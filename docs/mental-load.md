# Denkarbeit-Check (mental load cards)

*14 Oct 2026 · server `server/lib/loadcards.ts` · web `web/src/pages/LoadCards.tsx` (`/denkarbeit`) · iOS `ios/ToHuus/Features/Household/LoadCardsView.swift`*

A deck of 33 cards for the invisible part of running a home – noticing, planning, remembering – in seven areas
(Einkauf, Kochen, Geld, Zuhause, Termine & Fristen, Kinder, Miteinander). Own wording, not taken from any other product.

- Each member answers privately per card: *Mache meistens ich* · *Teilen wir* · *Macht meistens jemand anders* ·
  *Betrifft uns nicht* (tap again to clear).
- Each card says how ToHuus can take that thing off someone's head and links there (Vorrat, Liste, Aufgaben, Hausinfo …).
- "Mache meistens ich" cards can become a task "when needed" that the person keeps in mind.
- Personal summary: how many things I mostly carry, share, or someone else does – plus what ToHuus can take over.
- Household view only when every member switched on *compare* (the same opt-in as "Wer hat was im Blick"): who said
  what per card (names alphabetical) and two gentle hints – *everyone thinks someone else does it* and *two or more
  say "mostly me"*. No scores, no ranking, no percentages per person.
- Never visible to guests, guest links, the assistant, MCP, Home Assistant, exports or widgets.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/blick/cards` | `{ areas, cards: [{ key, area, text, help: { text, path } \| null, mine, household: { who: { me, shared, other, na }, nobody, both } \| null }], summary, compare, me_compare, members }` |
| PUT | `/api/blick/cards/:key` | `{ answer: 'me' \| 'shared' \| 'other' \| 'na' \| null }` → the deck |
| POST | `/api/blick/cards/:key/task` | → `{ id }` – a household task "when needed", assigned to me |

Table `load_answers (user_id, card_key, answer, updated_at)`.
