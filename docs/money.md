# Geld: own entries, personal view, money lists (wave 2, q-money)

ToHuus is not a finance planner. Geld stays about food and household spending; this adds what households asked for:
entries for non-food too, a personal view, single receipt lines for one person, and splitting an occasion.

Server: `server/lib/spend2.ts` (entries, views, categories), `server/lib/spend-files.ts` (photos/PDFs, reading),
`server/lib/money-lists.ts` + `server/routes/money-lists.ts` (Geldlisten), `server/lib/hhforms.ts` (WG balance, `settle()`).
Web: `web/src/money/entry.tsx`, `web/src/money/lists.tsx`, `web/src/pages/Money.tsx`, `web/src/pages/Spending.tsx`.
iOS: `Features/Money/*`, `Core/API/Endpoints+Money.swift`, `Core/Models/Money.swift`.

## Privacy model

| What | Field | Who sees it |
| --- | --- | --- |
| Personal expense | `spend_expenses.private_for` (+ `user_id` = who entered it) | that person and who entered it – only in their „Nur meins“ |
| Personal receipt | `imports.private_for`, `imports.private_by` | that person and who marked it; hidden in `/imports`, `/imports/:id` (404 incl. apply/delete/raw/split), `/spend/receipts/:id`, prices, rhythm, WG balance, Heute/HA review counts, exports, assistant, MCP |
| Line for one person | `import_lines.for_user_id`, expense `items[].for_user_id` | the household (part of a shared receipt); counts in that person's „Nur meins“ and in splits |
| Money list | `money_lists.visibility` `household`/`private` + `share_with` | household lists: every member; private: owner + `share_with`. Permanent guests never |

Household-wide reads without a viewer (`loadEntries()` with no options, `spendLines()` without `viewer`) never include personal entries – the safe default for the assistant, MCP, Home Assistant and Heute.
Household setting `money.assignedOut` (default off): lines for one person are left out of the household totals.

## Views

`view=mine` on `GET /api/money/overview`, `/api/spend/stats`, `/api/spend/entries`, `/api/spend/export` → only the viewer's personal entries plus lines/items assigned to them (an expense with items for them shows as one entry with `part: true` and just their items' sum). No budgets, hints or price changes in that view. Anything else = household view. Responses carry `view: 'household' | 'mine'`.

## Entry fields (Entry in `/spend/entries`, `/spend/receipts/:id`)

New on every entry: `for_user_id`, `for_name` (line for one person), `personal: { for_user_id, for_name, by_user_id } | null`, `paid_by`, `attachment: { type } | null`, `items: [{ name, qty, price, for_user_id }] | null`, `part`.
`GET /api/spend/receipts/:id` also returns `paid_by`, `paid_by_name`, `actor`, `personal`.

## Endpoints

- `GET /api/spend/meta` → adds `money_categories` (the household's categories for own entries), `members: [{ id, name }]` (no permanent guests), `me`, `assigned_out`.
- `PUT /api/spend/categories { categories: string[] }` → `{ money_categories }`. Defaults: Lebensmittel, Haushalt, Drogerie, Getränke, Kinder, Geschenke, Tiere, Sonstiges.
- `POST /api/spend/categories/rename { from, to }` → renames in expenses, line overrides, budgets, "not counted" rules.
- `GET/PUT /api/spend/settings { assigned_out: boolean }`.
- `POST /api/spend/files` multipart `file` (photo JPEG/PNG/WebP/HEIC or PDF, ≤ 15 MB, sniffed by content; upload quota) + optional `read=1` → `{ token, type, bytes, draft: { day, amount, store, items: [{ name, qty, price }], via: 'ocr'|'ai'|'pdf'|null, note } | null }`. Reading uses the receipt path (OCR + parsers, model only when the household allows AI). Unlinked files are removed after a day.
- `POST /api/spend/expenses` / `PATCH /api/spend/expenses/:id` – new optional fields: `private_for: userId|null`, `paid_by: userId|null`, `items: [{ name, qty?, price, for_user_id? }]|null`, `attachment: token|null` (null removes the file). Not visible → 400 "Ausgabe nicht gefunden".
- `GET /api/spend/expenses/:id` → `{ id, day, amount, store, category, note, private_for, personal, paid_by, paid_by_name, attachment, items: [{…, for_name}], tags }` (404 when not visible).
- `GET /api/spend/expenses/:id/attachment` → the file, decrypted, `Cache-Control: private, no-store`.
- `POST /api/spend/receipts/:id/personal { for_user_id: number|null }` – a receipt belongs to one person or to the household again.
- Lines for a person and who paid a receipt: unchanged `POST /api/imports/:id/split { paid_by?, lines?: [{ id, for_user_id?, for_list_id? }] }`.
- `GET /api/wg/balance` now also counts own expenses with `paid_by` (items for one person are theirs).
- CSV export: new columns Für wen · Persönlich · Bezahlt von · Anhang · Posten.

## Geldlisten

- `GET /api/money/lists` → `[{ id, title, mode, visibility, mine, total, people, per_person, open_transfers, settled, updated_at }]`
- `GET /api/money/sources` → `{ lists: [{ id (0 = main list), name, items }], trips: [{ id, user, store, started_at, until }], receipts: [{ id, store, total, day }] }`
- `POST /api/money/lists { title?, note?, mode?: 'equal'|'items', visibility?: 'household'|'private', share_with?: userId[], people?: [{ user_id?, name? }], count?: N, from?: Source, items?: [{ name, amount, qty? }] }` → the list.
  People: `people`, or `count` (Person 1 … N, split by N without names), or by default all members.
  `Source`: `{ kind: 'shopping', list_id, which?: 'open'|'checked'|'all' }` (amounts = last price from household receipts, 0 when unknown) · `{ kind: 'trip', trip_id }` (what that person ticked; payer = them) · `{ kind: 'entries', keys: ['l:12','e:3'] }` · `{ kind: 'receipt', import_id }`. Payers and line owners carry over; lines for one person → mode `items`.
- `GET /api/money/lists/:id` → `{ id, title, note, mode, visibility, share_with, owner, mine, source, settled_at, people: [{ id, user_id, name }], items: [{ id, name, amount, qty, paid_by, for_person, source }], payments: [{ id, from, to, amount }], split: { total, unpaid, per_person, people: [{ id, name, user_id, paid, share, balance }], transfers: [{ from, from_name, to, to_name, amount }], settled }, share_text }`
- `PATCH /api/money/lists/:id { title?, note?, mode?, visibility?, share_with?, settled? }` – visibility/share_with only by the owner (403). `settled: true` books every open transfer as done, `false` clears them.
- `DELETE /api/money/lists/:id`
- `PUT /api/money/lists/:id/people { people: [{ id?, user_id?, name? }] }` (ids kept; removed people lose their costs' payer/owner)
- `POST /api/money/lists/:id/items { name, amount, qty?, paid_by?, for_person? }` · `PATCH …/items/:itemId` · `DELETE …/items/:itemId` · `POST …/items/import { from: Source }` · `POST …/items/bulk { ids: number[]|'all', paid_by?, for_person? }`
- `POST /api/money/lists/:id/payments { from, to, amount }` ("erledigt") · `DELETE …/payments/:paymentId`
All money-list answers are the full list (same shape as GET). Not visible → 404. Person ids are list people, not users.

Split: mode `equal` shares every cost equally; mode `items` gives a cost with `for_person` to that person, the rest equally. The balance counts only costs with a payer (`unpaid` = the rest); payments move it; `transfers` = `hhforms.settle()` (fewest sentences).
