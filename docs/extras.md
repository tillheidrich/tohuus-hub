# Extras im Wocheneinkauf

*14 Oct 2026 · server `server/lib/extras.ts` · web `web/src/shop/extras.tsx` · iOS `ios/ToHuus/Features/Shopping/ExtrasViews.swift`*

A weekly allowance for treats and little luxuries – sweets, snacks, ice cream, drinks, or whatever the household marks.
The list shows how much of it is used. It never blocks anything and it is never red: the household decides.

## What counts as extra

1. The row was marked by hand (`shopping_items.extra` 1/0),
2. else the product was marked before (`products.is_extra`, set together with the row – remembered),
3. else a rule of thumb: category *Snacks & Süßes* or *Eis*, or names like Schokolade, Chips, Gummibärchen, Kekse,
   Eis, Cola, Limo, Bier, Wein, Sekt … (not: Weinessig, Backschokolade, Hefe).

## How much is used

- **Money** (`mode: money`, euros per week): receipts of this week (lines of extra products) + ticked rows without a
  receipt yet + rows still on the list, priced by what was paid last time (`lists.estimate`).
- **Count** (`mode: count`, things per week): ticked rows of this week + rows still on the list (quantity counts).

The week follows the household's region (`weekStart`). Private rows and lists the viewer may not see are left out.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/list/extras` | `{ on, mode, weekly, from, to, used, planned, left, over, unpriced, items: [{ id, text, qty, done }] }` – not for guest links |
| PUT | `/api/list/extras/settings` | admins: `{ mode: 'money' \| 'count', weekly }` or `{ off: true }` |
| POST | `/api/list/items/:id/extra` | `{ extra: true \| false \| null }` – null = back to automatic |

`GET /api/shopping` and `GET /api/shop/list` rows carry `extra: boolean`.
