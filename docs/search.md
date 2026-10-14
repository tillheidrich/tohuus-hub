# Global search

Since 14 Oct 2026 (UX benchmark 2.4, `docs/design/ux-benchmark-2026-10-14.md`). One search for every function, setting and thing in the household – web (`web/src/search/GlobalSearch.tsx`, ⌘K / Ctrl+K / "/", sidebar, Heute, Mehr) and iPhone (`ios/ToHuus/Features/Search/GlobalSearchView.swift`, magnifier at the top right of every tab, Mehr).

## API

`GET /api/search?q=<text>` (signed in; at least 2 characters) →

```json
{ "q": "milch", "groups": {
  "products": [{ "id": 4, "name": "Hafermilch", "brand": null, "image_path": null, "in_stock": true }],
  "list":     [{ "id": 12, "text": "Milch", "qty": 2, "list_id": 0, "list": "Einkaufsliste" }],
  "recipes":  [{ "id": 3, "title": "Pfannkuchen", "image_path": null, "with": "milch" }],
  "tasks":    [{ "id": 7, "name": "Bad putzen", "next_due": "2026-10-18", "state": "ok", "private": false }],
  "house":    [{ "id": 2, "title": "WLAN", "type": "tip" }],
  "people":   [{ "key": "u2", "name": "Sam", "kind": "member" }]
} }
```

Empty groups are left out; at most 8 hits per group, best first. `with` on a recipe means the query matched an ingredient, not the title.

## Privacy

Each group is read like its own area: private list rows (`share_items`) and other people's private lists never, private tasks only for their owner, Hausinfo cards only as their visibility allows (never codes), permanent guests only the groups their level may read (`guestMay`), guest links 403. Covered by `test/tasks.test.ts` and `test/cloud-isolation.test.ts`.

## Functions and settings

Not on the server: each client keeps a registry of its screens with the words people search for ("Passwort", "Etiketten drucken", "Dunkelmodus"), filtered by guest level and switched-off areas. When nothing fits, the last rows offer "„…“ auf die Liste" and "Neue Aufgabe „…“".
