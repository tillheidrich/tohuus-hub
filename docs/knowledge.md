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

## Import und Export (18 Oct 2026, `server/lib/knowledge-io.ts`)

Fully without AI. Two steps, stateless: the app sends the file (or pasted text) to the preview, the person picks,
then the same file again with the picked rows.

| | |
|---|---|
| `POST /api/knowledge/import/preview` | multipart `file` **or** `{ text, format?, filename? }`, plus `target` (`household`\|`me`), `onDuplicate` (`update`\|`skip`) → `{ items, counts, skipped, truncated, room, needsHealthConsent }`. Nothing is written. |
| `POST /api/knowledge/import` | the same + `pick` (indexes, JSON array; multipart: as a string) + `consent` → `{ created, updated, skipped, failed, undo }`. One undo token for everything (`assistant_undo` kind `knowledge_import`: new rows go, changed rows get their old value back). |
| `GET /api/knowledge/export?format=md\|csv\|json&ids=1,2&q=` | a download (`Content-Disposition: attachment`, `no-store`), only what this person sees. |

**Reading** (`parseImport`):
- **Markdown**: headings = subject (the deepest one; „Notizen“, „Weiteres“, „Notes“, „Haushaltswissen“ … hold loose
  lines), list points and short lines `Key: Value` (also Obsidian `Key:: Value`, `Key = Value`, tab) = one card,
  other text = a note line (with the heading in front, cut to 300 characters at sentence ends), an indented line under
  a point = its note. Front matter (YAML/TOML) dropped, code blocks skipped, tables read like CSV, setext headings.
  Obsidian/Notion: `[[Link|Alias]]` and `[text](url)` become text, embeds/images go, `#tags` lose the `#`, Notion page
  ids in headings go, `_(nur für mich)_` / `_(auch für Gäste)_` (our export) set the visibility. A time („um 10:30“)
  is no key.
- **Text**: every line stands for itself; `Mika:` alone is a heading until the next empty line; the reader without AI
  (`parseStatement`) finds cards in sentences („Rollo Erdgeschoss 120 x 160“).
- **CSV**: delimiter detected (`;` `,` tab `|`), RFC 4180 quotes, headers in German or English (Thema/Gegenstand/
  Person/Ort, Eintrag/Eigenschaft/Name, Wert/Inhalt, Text, Notiz, Sichtbarkeit, Gäste …), without a header by position
  (3+ columns: subject, property, value, note), our formula guard `'=` taken off again.
- **JSON**: our export (`{ format: 'tohuus-knowledge', version: 1, entries }`), `{ entries }` or a plain list
  (strings or objects). History is not imported (it belongs to the people who changed it).

**Upload rules** (SECURITY.md): ≤ 512 KB, ≤ 5000 lines, ≤ 200 entries per import (the rest is cut, `truncated`);
extension `.md/.markdown/.txt/.csv/.tsv/.json`, MIME `text/*`, JSON, CSV or `octet-stream`; the **bytes** decide:
PDF, ZIP/Office, PNG/JPEG/GIF/WebP, gzip, RTF, executables, SQLite, OLE and NUL bytes → 415. UTF-8 (BOM ok), UTF-16
(BOM), else Windows-1252 (Excel). Raw HTML never comes through: comments, `script/style/iframe/object` and all tags
are dropped, entities become plain characters (the apps render text only). Control characters go.

**Preview rules**: duplicates are the same subject + property (or the same line), whoever sees it – the one with the
same visibility first – against what this person sees (never someone else's private cards) and inside the file
(`twice`). Same value → `skip unchanged`; different → `update` (the card keeps its place and visibility, the old value
goes into the history) or `skip exists` with `onDuplicate: skip`. Codes/passwords → `blocked secret`; no room left
(300 rows) → `blocked limit`. Health-related lines are always **private** (never shared by an import); without the
household's consent the apply answers 409 `health_consent` (the apps show their consent sheet and repeat with
`consent: true`); the assistant and MCP leave them out instead.

**Export**: Markdown (`# Haushaltswissen`, one `##` per subject sorted like the app, `- Property: Value`, note
indented, plain lines under „Notizen“, private/guest marks), CSV (UTF-8 with BOM, `;` in German and `,` in English,
cells starting with `= + - @` get a `'`), JSON (with the history this person may see – shared entries only from when
they were shared, see `view()`). Photos are not exported (`photo: true` in JSON). All three import again without
changes (round trip tested).

Apps: web `KnowledgeIO.tsx` (header buttons „Importieren“ / „Exportieren“ on `/wissen`; export: everything or what
the search shows), iPhone `KnowledgeIOSheets.swift` (menu „…“ in the toolbar; `fileImporter` for Files, paste field,
preview with ticks, consent alert; export via `ShareLink`, which also offers „In Dateien sichern“).

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

## Assistant and MCP – who can do what (18 Oct 2026)

| Function | Assistant without AI | Assistant with AI | MCP |
|---|---|---|---|
| Write down / correct a card | „Mika Schuhgröße 28“, „Merk dir …“, „Mika hat jetzt 29“ | `remember`, `knowledge_change set` (`only_me`) | `knowledge_set`, `remember` |
| Ask | „Welche Schuhgröße hat Mika?“ | `knowledge_find` + context | `knowledge_search`, `knowledge_get` |
| Earlier values | „Was war Mikas Mützengröße vorher?“, „Verlauf von …“ | `knowledge_find` (history) | `knowledge_get` (history) |
| Delete | „Vergiss …“ (with undo) | `knowledge_change delete` (after a yes) | `knowledge_delete` |
| Share / make private | „Mach … für alle sichtbar / nur für mich“ → „Ja“ | `knowledge_change share/private` (after a yes) | `knowledge_visibility` (member only) |
| Take over a note | „Nimm diese Notiz auf:“ + text (one undo) | `knowledge_import` | `knowledge_import` |
| Export | – (in the app) | – | `knowledge_export` |

Without AI the sentences are read in `assistant-parse.ts` (`note_import`, `knowledge_history`,
`knowledge_visibility`) and answered in `assistant.ts` without a model and without counting; a plain „Ja“ confirms
the reader's own open question (`lastPending`, 10 minutes). Tests: `test/knowledge-io.test.ts`, `test/assistant-new.test.ts`.

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
- Share extension for .md/.csv files on the iPhone (the share sheet's ToHuus entry) – „Öffnen in ToHuus“ works since 18 Oct (below).

## Nachtrag 18 Oct 2026: „Gut zu wissen“ and „Öffnen in ToHuus“

- **Fact card:** the knowledge screen shows one sourced fact of topic `knowledge` (server/data/facts.json, docs/facts.md
  `knowledge-keeping-track`, `knowledge-fixed-place`) at the end of the list – quiet, not while searching, not for
  guests. iPhone `FactCard(api:, topic: "knowledge", inList: true)` in KnowledgeView, web `<FactStrip topics={['knowledge']} />`
  in pages/Knowledge.tsx.
- **„Öffnen in ToHuus“ (iPhone):** ios/project.yml declares `CFBundleDocumentTypes` (Viewer, rank Alternate) for
  `public.plain-text`, `public.comma-separated-values-text`, `net.daringfireball.markdown`, `public.json`,
  `LSSupportsOpeningDocumentsInPlace: false` (iOS hands over a copy) and imports the Markdown type
  (`UTImportedTypeDeclarations`, .md/.markdown). `ToHuusApp.handle` → `openFile`: reads the copy (≤ 512 KB, the
  import limit), deletes the Inbox copy, and sets `AppModel.openedKnowledgeFile`; MainTabView opens
  `KnowledgeImportSheet(initialSource:)`, which goes straight to the preview. Not signed in → note „Melde dich zuerst
  bei ToHuus an …“ (also after a cold start that ends on the start screen); household guests → „Ins Haushaltswissen
  importieren kann nur, wer hier wohnt.“; after taking over, the result as a short note. Needs `xcodegen generate`
  (Info.plist is generated); the local Info.plist was updated by hand on 18 Oct.
