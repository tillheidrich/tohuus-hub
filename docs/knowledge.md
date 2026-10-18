# Haushaltswissen – „Was ToHuus sich merkt“ (18 Oct 2026)

Handover page for agents. Source of the idea: Outline wiki, ToHuus Hub / Fredirando › „Idee nach dem Start: Alles
reinschicken, ToHuus sortiert (Abgleich Fetchy, 18.10.2026)“ – read its Nachträge 02:10–02:13 and Till's Leitsatz:
ToHuus is **no replacement** for calendar or notes apps, but household knowledge may live here, and ToHuus brings
things together. Test question for every extension: „Bringt das den Haushalt zusammen, oder baut es eine App nach,
die es schon gibt?“ No free notebook, no folders, no links/ideas/podcasts.

## What it is

A card = **subject · property: value** (+ optional note and photo), e.g. „Mika · Schuhgröße: 28“, „Wohnzimmer · Rollo:
120 × 160“, „Strom · Zählernummer: 1ESY1160“. The subject is something the household already has:

| subject_ref | kind | table |
|---|---|---|
| `u3` | person (member) | users |
| `k2` | person (child) | kid_profiles |
| `l5` | place / room („Wo ist was?“) | locations |
| `p7` | product | products |
| none | free subject („Rollo Erdgeschoss“) | – |

Linked subjects follow renames (the name is read from the table). Older plain lines from „Was ToHuus sich merkt“
(„Wir kaufen Brot beim Bäcker“) stay plain lines and are edited/deleted the same way; „Mira hat Schuhgröße 28“
sentences are cards too (the value is parsed).

## Data model – no second table

`ai_memory` (server/lib/memory.ts) with the migrations `memory-1`, `memory-private-1`, `memory-key-1` and
**`knowledge-1`** (new columns): `subject`, `subject_ref`, `property`, `value`, `note`, `photo`, `origin`
(app | web | assistant | telegram | share | mcp), `guests` (0/1), `author_id` (users.id), `updated_at`, `updated_by`,
`shared_at`. Existing: `text` (for structured cards built as „Subject · Property: Value“ – this is what the assistant
context and old clients see), `fact_key` (`fold(subject)|fold(property)`), `history` (JSON, newest last, max 10:
`{ text, value, until, at, by }`, `at` = UTC with milliseconds), `private_to`, `sensitive`, `source`, `created_by`.

Core helpers in memory.ts: `setEntryValue` (new value, old one into history), `visibleHistory`, `entryText`,
`stamp`; `remember()` / `updateFactValue()` keep working and replace values in place (no second row).
`restoreMemory` restores every column (undo).

## Rules (server/lib/knowledge.ts)

- **Household entries**: every member reads and changes them. **Private** (`private_to`): only the author; for
  everyone else 404 (list, get, history, patch, delete, restore – IDOR tests in `test/knowledge.test.ts`).
- **Share** (private → household): only the author. The history stays, but other members only see changes after
  `shared_at` (simplest safe variant: no extra question, nothing private leaks; the author still sees everything).
- **Make private** (household → private): the author, or an admin – then it becomes private **for the author**, not
  for the admin (same as Aufgaben in routes/home.ts). Rows from before 18 Oct have no `author_id`: the author is the
  member whose name is in `created_by`.
- **Health** (`isSensitive`, word list in memory.ts, now also catches „Kinderärztin“, „Zahnarzt…“, „Hebamme“ …): the
  household consents once (409 `health_consent`, existing sheet), the entry is private unless the person chose
  „Ganzer Haushalt“ explicitly, sharing one asks again (409 `health_share` → repeat with `consent: true`), never
  for guests, never to the AI without `ai.health_share` (assistant context filter).
- **Guests** (permanent guests, all levels; people-policy ORDER `read /knowledge`): only household entries with
  `guests = 1` and not sensitive; no history, no subjects; every write 403. Babysitter links (`/api/guest/:token`)
  do not show knowledge yet.
- **Codes/passwords** (PIN, Passwort, Türcode …) are refused (400 `secret`) – they belong in Hausinfo › Codes.
- Max 300 rows per household (shared with the old memory lines).

## API (server/routes/knowledge.ts)

| | |
|---|---|
| `GET /api/knowledge?q=&ref=&subject=&property=` | `{ entries, groups, subjects }` – groups by subject (people, places, products, free, „other“) |
| `GET /api/knowledge/:id`, `GET /api/knowledge/:id/history` | one card; history newest first, each with `i` (position) |
| `POST /api/knowledge` | `{ subject?, subjectRef?, property?, value?, text?, note?, visibility?: household\|me, guests?, consent?, origin? }` – same subject+property (same visibility) → new value instead of a second card (`updated: true`, `before`) |
| `POST /api/knowledge/say` | `{ text, visibility?, consent? }` → `saved` \| `answer` (question) \| `confirm` (delete / share / private – the app asks, then calls PATCH/DELETE) \| `form` (not understood → prefilled form) |
| `PATCH /api/knowledge/:id` | value, subject/subjectRef, property, text (plain lines), note, visibility, guests, consent |
| `DELETE /api/knowledge/:id` | `{ ok, undo }` |
| `POST /api/knowledge/:id/history/:i/restore`, `DELETE /api/knowledge/:id/history/:i` | earlier value back / remove one |
| `POST /api/knowledge/:id/photo` (multipart `image`), `DELETE …/photo` | photo (images.ts, prefix `m<id>`) |

Every write answers `undo` – a token for the existing `POST /api/assistant/undo/:token` (assistant_undo, 24 h,
only for the same person). `GET/POST/DELETE /api/memory` stays for old clients.

## Reader without AI (`say`, `parseStatement`)

„Mika Schuhgröße 28“, „Mikas Schuhgröße ist 29“, „Rollo Wohnzimmer 120 x 160“ (Wohnzimmer is a room → subject),
„Rollo Erdgeschoss 120 x 160“ (free subject, property „Maß“ from the value), „Zählernummer Strom 1ESY1160“, „Rollo ist
125 breit“, „Kinderärztin Dr. Berg 04181 12345“ (property „Telefon“, private), „Mira hat jetzt 29“ (the one numeric
fact about Mira). Questions („Welche Schuhgröße hat Sam?“) → answer cards; „Lösch Sams Schuhgröße“, „Mach … für
alle sichtbar“, „… nur für mich“ → confirm; „Korrigier: Rollo Bad ist 65 breit“ → changes the one matching card.
Property words: `PROPS` in knowledge.ts.

## Assistant

- Screen context **`knowledge`** (server/lib/assistant-areas.ts CONTEXTS + hint, web/src/assistant/areas.ts for
  `/wissen` and `/merkt-sich`, iOS `.assistantScreen("knowledge")`), topic `knowledge` in assistant-context.ts.
- Tool **`knowledge_change`** (defined in knowledge.ts, registered in assistant-tools.ts): `set` changes at once (with
  undo); `delete`, `share`, `private` only after a yes in a later message (first call returns `needs_yes`, same
  pattern as receipt_change, pending per household). Health entries are never shared via the assistant.
- `remember` / `forget` and the built-in reader („Mika hat jetzt 29“, „Welche Schuhgröße hat …?“) keep working on
  the same rows. Prompt size: the tool only comes with the topic/screen (test/assistant-eval keeps < 5500).

## Apps (same on web and iPhone)

- Web: `/wissen` (old address `/merkt-sich`), pages/Knowledge.tsx (+ knowledge.css): „Schreib es ToHuus“ field,
  groups as cards, search (> 4 cards), editor sheet (value, subject, property, note, photo, „Ganzer Haushalt / Nur
  ich“, „Gäste sehen es auch“, history with „Zurückholen“ and remove, delete with undo), empty state with examples.
  `KnowledgeFor` in the person sheet (people/People.tsx) and the place sheet (PlacesSettings.tsx); Hausinfo links to
  it. Mehr › Haushalt first row, icon Brain.
- iPhone: Features/Household/KnowledgeView.swift (KnowledgeView, KnowledgeEditor, KnowledgeConfirmSheet,
  KnowledgeSection), API in Core/API/Endpoints+Knowledge.swift. Mehr › Haushalt first row (SF Symbol `brain`), person
  screen (PersonAdminView), place sheet (PlaceEditSheet), Hausinfo, global search.
- Module switch `knowledge` in „Was nutzt ihr?“ (server/lib/modules.ts, default on; web Modules.tsx, iOS
  ModulesView + FirstRunView). Off hides the area; data and the assistant's memory stay.

## Copy

German, du, short, Fetchy-like but our own: „Schreib es ToHuus.“ „ToHuus sortiert. Oder frag einfach.“ „Damit dich
nicht alle fragen müssen.“ Inside the app the area may say „Euer Haushaltsgedächtnis“ (Till, 18 Oct: „Gedächtnis darf
nach außen“). No labels (ADHS, personality types). Examples use Mira, Mika, Sam – never real family names.

## Open

- Telegram/Matrix and the share extension do not write cards yet (Nachtrag 02:10: free text there should go through
  the same reader with a „Merken?“ question, `origin: telegram|share`).
- Babysitter links (`/api/guest/:token/house`) could show cards marked for guests next to Hausinfo.
- Shopping/wish list suggesting the right size from a person's cards (Wiki: „Nutzen im Alltag“).
- The admin JSON export filters private rows but exports the full history of a shared entry (incl. values from before
  it was shared).
- A deleted card keeps its photo file (needed for undo); no cleanup job yet.
- MCP `remember` does not set `origin: 'mcp'` yet.
