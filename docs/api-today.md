# `GET /api/today` – the "Heute" screen in one call

Contract for the web app and the iPhone app (plan 12 Oct 2026). One request, everything the first tab needs; the server answers in well under 50 ms on a typical household (measured on the demo household in `test/today.test.ts`, median around 15–25 ms). Code: [`server/lib/today.ts`](../server/lib/today.ts).

Authentication: session cookie or `Authorization: Bearer sw_app_…`. Permanent guests of level *family* get the same shape with `money: null` and no notices. Response header `Cache-Control: no-store`. Strings are already in the household language (English or German). Dates are `YYYY-MM-DD` in the household time zone, times are SQLite UTC timestamps `YYYY-MM-DD HH:MM:SS`.

```jsonc
{
  "date": "2026-10-12",
  "greeting": "Guten Morgen, Till",           // by hour; without a name for API tokens
  "household": { "name": "Fredirando" },

  // due now from the purchase rhythm (receipts + list ticks, no stock needed), most urgent first, max 5
  "rhythm": [
    {
      "productId": 12,
      "name": "Milch",
      "image": "p12.webp",                      // under /img/, or null
      "everyDays": 5,                           // rounded mean interval
      "lastBought": "2026-10-07",
      "dueOn": "2026-10-12",
      "dueInDays": 0,                           // negative = overdue
      "confidence": "medium",                   // low (≥3 purchases) | medium (≥5) | high (≥8)
      "origin": "receipts",                     // receipts | ticks | both
      "label": "alle ~5 Tage · zuletzt Mittwoch"
    }
  ],

  "list": {
    "open": 7,                                  // open items the viewer may see (private items of others excluded)
    "recent": [                                 // last changes, max 5
      {
        "id": 301,
        "text": "Paprika",
        "qty": 2,                               // or null
        "checked": false,
        "origin": "vom Assistenten, für Till",  // always set, see "origin" below
        "at": "2026-10-12 06:14:03"             // checked_at for ticked rows, else created_at
      }
    ]
  },

  // "Das habt ihr noch": eat-soon stock and leftovers first, then what was bought within its rhythm; max 5
  "stillHave": [
    {
      "productId": 40,
      "name": "Joghurt",
      "image": null,
      "kind": "expiring",                       // expiring | leftover | probably
      "useBy": "2026-10-13",                    // null for kind "probably"
      "daysLeft": 1,                            // null for kind "probably"
      "label": "noch 1 Tag"                    // "bald essen", "heute", "Datum überschritten", "gekauft am Dienstag"
    }
  ],

  // what to cook today: the plan first, else the best idea from what is at home (allergy-safe, server-side); or null
  "cookToday": {
    "kind": "ready",                            // planned | ready | almost
    "recipeId": 3,                              // null for a free plan entry
    "planId": 17,                               // only for kind "planned"
    "slot": "abend",                            // only for kind "planned"
    "title": "Spaghetti Bolognese",
    "image": "r3.webp",
    "timeMin": 30,
    "missing": [{ "text": "Parmesan", "productId": 21 }],   // at most 2; empty for ready
    "probablyHave": ["Hackfleisch"],            // counted as at home because of the purchase rhythm
    "usesExpiring": ["Tomaten"],                // not for kind "planned"
    "why": ["alles da", "Lieblingsessen"]       // neutral reasons, never names or health details
  },

  "money": {
    "currency": "EUR",
    "week": 42.1,                               // this week (region's first weekday) incl. manual expenses
    "month": 187.5,
    "budget": { "amount": 400, "spent": 187.5, "left": 212.5, "state": "ok" }   // monthly overall budget or null; state ok | near | over
  },

  "notices": [
    { "kind": "imports", "text": "2 Bons warten auf einen kurzen Blick", "path": "/import" },
    { "kind": "budget", "text": "Noch 38,20 € im Budget für diesen Monat", "path": "/geld" }
  ]
}
```

## Origin strings

Every list row (`/api/shopping`, `/api/shop/list`, `list.recent` here) carries `origin`, one short line:

| Source | Example (de) |
|---|---|
| a person | `Lea · heute 14:05`, `Lea · Di 09:12`, `Lea · 3. Okt.` |
| Home Assistant, Telegram, share, guest link | `heute 14:05 · über Home Assistant`, `Lea · heute 14:05 · aus einer anderen App geteilt` |
| accepted rhythm suggestion | `merkt sich: alle ~9 Tage` |
| the in-app assistant | `vom Assistenten, für Till` |
| a recipe (assistant, recipe page) | `aus Rezept Lasagne` / `aus einem Rezept` |
| week plan, Cookidoo | `für den Wochenplan` |
| low stock (only when "automatic list" is on) | `im Vorrat knapp` |
| used up | `aufgebraucht · Lea, heute 08:00` |

## Related endpoints

- `GET /api/rhythm` (`?all=1` includes muted ones), `POST /api/rhythm/:productId/accept`, `POST /api/rhythm/:productId/dismiss` – see [features.md](features.md#purchase-rhythm).
- `GET /api/cook/ideas?limit=6&thermomix=1|0` → `{ ready: CookIdea[], almost: CookIdea[], probablyAtHome: string[] }` (CookIdea = the `cookToday` object without `kind`).
- `GET /api/money/overview?month=YYYY-MM` – see [features.md](features.md#money).
- Assistant: [assistant.md](assistant.md).
