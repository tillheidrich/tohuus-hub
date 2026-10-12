# The assistant

The floating button on every tab (microphone and text). ToHuus' assistant is the household's shopping and household helper, cook planner and money helper: short answers, writes only when asked, every write can be undone. It is never a doctor or a nutrition coach and never says "allergen-free".

Code: [`server/lib/assistant.ts`](../server/lib/assistant.ts) (conversation, model loop, built-in reader), [`assistant-tools.ts`](../server/lib/assistant-tools.ts) (tools and undo), [`assistant-parse.ts`](../server/lib/assistant-parse.ts) (reading without a model), [`assistant-context.ts`](../server/lib/assistant-context.ts) (what the model is told), [`ai.ts`](../server/lib/ai.ts) (the model client), routes in [`server/routes/assistant.ts`](../server/routes/assistant.ts).

## Two modes

| | With a model | Without a model |
|---|---|---|
| When | `AI_API_KEY` (or the older `VISION_*`) is set | self-hosted without a key, the monthly allowance is used up, or the model is not reachable |
| `mode` in the answer | `ai` | `basic` |
| What works | free conversation, tool calling over everything below | the common sentences, also several in one ("Milch ist alle und 2 Paprika", "Klopapier ist alle und Spüli fast leer", "Wir brauchen Eier, Butter und was für Sonntag" → Eier and Butter on the list, then "Was braucht ihr für Sonntag?"): lists ("Milch, 2 Paprika und Brot", "Setz Butter auf die Liste", "add milk to the list"), "Milch ist alle", "Haben wir noch Eier?", "Hab bei Aldi Milch, Eier und Brot für 12,40 gekauft", "Was ist fällig?", "Was steht auf der Liste?", "Was kochen wir?", "Was haben wir ausgegeben?", "Merk dir …", "Vergiss …" |

If the model fails mid-way, writes it already made stay (they are in `actions`, with undo); otherwise the built-in reader answers instead of an error.

## Endpoints

All need a signed-in member (cookie or app token). Errors: `{ error }` (AI errors add `code`: `not_configured`, `timeout`, `rate_limited`, `auth`, `bad_request`, `upstream`, `bad_response`).

### `POST /api/assistant/chat`

```jsonc
// request
{ "message": "Milch ist alle, und wir brauchen was für Sonntag", "conversationId": null }
// response
{
  "conversationId": "5f0c…",               // new conversation when none was given
  "reply": "Milch steht auf der Liste. Für Sonntag: …",
  "actions": [
    { "kind": "stock_used_up", "summary": "Milch ist alle und steht auf der Liste", "undo": "9a1f…(32 hex)" }
  ],
  "mode": "ai",                             // ai | basic
  "usage": { "prompt": 1830, "completion": 64, "total": 1894 },   // only with a model
  "remaining": null                         // assistant messages left this month (null = unlimited)
}
```

Action kinds: `list_add`, `list_remove`, `list_check`, `stock_used_up`, `plan_meal`, `recipe_to_list`, `log_purchase`, `remember`, `forget`.

### `POST /api/assistant/transcribe`

Multipart, field `audio` (max 12 MB): m4a/mp4 (iPhone), mp3, wav, aac, ogg, flac, webm (browsers). → `{ text }`. Uses the audio model (Voxtral) as an `input_audio` part of a chat completion, pinned to Mistral on OpenRouter. 503 when no audio model is set up, 415 for other formats.

### `POST /api/assistant/voice`

Multipart `audio` plus optional `conversationId` → `{ text, conversationId, reply, actions, mode, usage?, remaining? }` (transcribe + chat in one call). An empty transcript answers "Ich hab nichts verstanden" without calling the chat.

### `POST /api/assistant/undo/:token`

Also `POST /api/assistant/undo` with body `{ "undo": "<token>" }`. → `{ ok: true, summary, already? }`. Tokens live 24 hours and only work for the person whose message caused the action (404 otherwise).

### Conversations, status, consent

- `GET /api/assistant/conversations` → own conversations `[{ id, title, created_at, updated_at, messages }]`; `GET /api/assistant/conversations/:id` → `{ id, messages: [{ id, role, content, actions, mode, created_at }] }`; `DELETE` one or all (`DELETE /api/assistant/conversations`). Conversations are private to the person and deleted 30 days after the last message.
- `GET /api/assistant/status` → `{ ai, voice, receiptsAi, healthShare, healthConsent, language }` – what the UI can offer.
- `GET /api/assistant/settings` → `{ healthShare, healthConsent }`; `PATCH` (admins) `{ healthShare: boolean }`. Also in `GET/PATCH /api/settings` as `ai.healthShare`.

### Switching AI off (`ai.enabled`, `ai.mine`, children, MCP)

Four switches, enforced centrally in `server/lib/ai.ts` (`chat()`, `transcribe()`) and `server/lib/vision.ts` (`runVision()`) via `server/lib/ai-policy.ts`. While one of them applies, **no request at all** goes to a model; a call fails with `AiError` code `ai.disabled` (HTTP 403, `{ error, code: 'ai.disabled' }`), and `aiEnabled()` / `visionAvailable()` answer `false`, so every feature takes its path without a model (assistant basic mode, OCR for receipts, the simple recipe text reader).

| Switch | Where | Who changes it | Default |
|---|---|---|---|
| Household `ai.enabled` | setting | admins | on (only meaningful when a model is configured) |
| Person `ai.mine` | `user_prefs` of that member | only that member; never shown to others | on |
| Child | `kid_profiles.ai_off` | parents (admins and members, not permanent guests) via `PUT /api/kids/:id/ai { enabled }` | on |
| MCP for the household's own assistants `mcp.enabled` | setting | admins | on; independent from the built-in AI (no model is called for MCP); off ⇒ `/mcp` answers 403 |

The person is taken from the request (`requireAuth` runs the rest of the request inside `runAsAiActor`), the child from the paired kid tablet (`/api/kid/:token/*`). A kid tablet can never change its switch: there is no route for it, `GET /api/kid/:token` only returns `ai: { enabled, locked: true }` for the locked display "von deinen Eltern ausgeschaltet".

- `GET /api/ai/settings` → `{ configured: { text, vision, audio }, household, mcp, mine, effective, reason: null|'no_model'|'household'|'person'|'parents', admin, kids?: [{ id, name, ai }] }` (`kids` for adult members only).
- `PATCH /api/ai/settings` `{ household?, mcp? }` (admins, else 403) and/or `{ mine? }` (the caller, for themselves) → the state as above.
- `GET /api/assistant/status` additionally returns `aiState` (same object without `admin`/`kids`); `ai`, `voice` and `receiptsAi` are the effective values for the caller.
- `GET /api/instance` → `features.ai: { configured, household, mcp }`; `features.assistant/voice/receiptsAi` are `configured && household`.

Basic mode while AI is off answers sentences it does not understand with "KI ist aus – ich verstehe einfache Sätze wie „Milch ist alle und 2 Paprika“".

### Health data: one-time consent (`consent`)

Allergies and health notes are special categories of personal data (Art. 9 GDPR). The **first** one a household stores
needs an explicit confirmation; after that nobody is asked again (the consent is per household, not per person).

- Endpoints that can store health data accept an optional `consent: true` in the body: `PUT /api/people/me/prefs`,
  `PUT /api/people/person/:key/prefs`, `POST /api/people/children`, `PATCH /api/people/children/:id`
  (each when `allergies` is non-empty) and `POST /api/memory` (when the text is classified sensitive).
- Without consent on record and without `consent: true` the server answers **HTTP 409**
  `{ "error": "Allergien sind Gesundheitsdaten. …", "code": "health_consent" }` and stores nothing (a child is not
  created either). The client then shows the confirmation sheet and repeats the same request with `consent: true`.
- Sheet text (German, binding): „Allergien sind Gesundheitsdaten. ToHuus speichert sie verschlüsselt in eurem Haushalt
  und nutzt sie nur für Warnhinweise bei Rezepten. An den Assistenten gehen sie nur, wenn ihr das in den Einstellungen
  erlaubt.“ Buttons „Nicht jetzt“ / „Speichern“.
- Stored once as the setting `health.consent` = `{ at: "<UTC datetime>", by: "<name> (#<userId>)" }`. Read it from
  `GET /api/assistant/settings` or `GET /api/assistant/status` → `healthConsent: { at, by } | null`; prefs responses
  carry `healthConsent: boolean`. A client may ask up front when `healthConsent` is null instead of waiting for the 409.
- The assistant and MCP `remember` tools never store a sensitive note before the consent; they answer with a hint to
  add it under People › Allergies.
- Separate from this, `ai.healthShare` (Settings › Assistant, admins, default off, applies to everyone in the
  household) decides whether allergies, children's birth years and sensitive memory rows go to the model at all.
  Without it they are never part of the model context, MCP `household_context` or tool results.

## Tools

Run in-process on the library functions (never over HTTP). Results going back to the model pass the same privacy filter as MCP.

| Tool | What it does | Undo |
|---|---|---|
| `list_show` | open list with origins (no private items) | – |
| `list_add` | items with qty/note; origin "vom Assistenten, für …" | removes the new rows |
| `list_remove` | takes rows off the list | puts them back |
| `list_check` | ticks off (optionally into stock) | un-ticks (and takes the booking back) |
| `stock_find` | "Haben wir noch …?" – stock where it is kept up to date, the rhythm, the last purchase ("laut Bon am Dienstag gekauft") | – |
| `stock_used_up` | sets to zero and puts it on the list | stock back, row removed |
| `rhythm_due` | what is probably due | – |
| `cook_ideas` | ready now / 1–2 missing, allergy-safe without saying why | – |
| `plan_meal` | into the week plan (`YYYY-MM-DD`, heute, morgen, weekday) | removes the entry |
| `recipe_to_list` | missing ingredients onto the list, origin "aus Rezept X" | removes the new rows |
| `money_summary` | month, shop, category, budget, price changes, hints | – |
| `log_purchase` | a told purchase: receipt in review (dated, counts for the rhythm at once, no prices) plus a manual expense with the total; ticks matching list rows | removes receipt, expense, ticks |
| `remember` / `forget` | what ToHuus remembers | forget / restore |

## Help per screen (`context`)

The apps send which screen the assistant was opened from: `POST /api/assistant/chat` and `/voice` take
`context: 'shopping' | 'stock' | 'cook' | 'money' | 'house' | 'guests'` (optional). The screen adds its topics, a
short instruction to the system prompt and its own tools (`server/lib/assistant-areas.ts`); without `context`
nothing changes. Only with AI on – the built-in reader answers as before. Everything is a suggestion first; every
write comes back in `actions` with an undo token. Art. 9 filter, quotas and the guest rules apply as for every
message (guests never reach `/assistant`).

| Screen | What it helps with | Tools |
|---|---|---|
| `shopping` | merge duplicates and sort by category (after a yes), "Was brauche ich für Lasagne?", substitutes | `list_tidy` (`apply`), `recipe_get`, `check_at_home`, `list_add` |
| `stock` | "Was muss bald weg?", a photo of the fridge or a cupboard | `use_soon`, `stock_find`; photo: see below |
| `cook` | week plan from what is there, adapt a recipe (vegetarian, for 6, no oven) as a **new** recipe, substitutes, leftovers | `cook_ideas`, `plan_meal`, `recipe_get`, `recipe_save_adapted`, `use_soon` |
| `money` | monthly review in plain words, saving hints from own receipts, "Warum war der Oktober teurer?" | `money_summary`, `money_compare` |
| `house` | "Wir haben Alexa und Hue im Wohnzimmer" → Hausinfo cards as **drafts** (admins); never codes | `house_info`, `house_draft_cards` |
| `guests` | shopping for a party, amounts per guest count (as an estimate) | `check_at_home`, `list_add`, `known_prices` |

Undo kinds added: `unmerge`, `delete_recipe`, `delete_house_cards`, `stock_add`.

Photo of the fridge/cupboard (stock screen, needs a vision model, counted as `receiptAi` like shelf photos):

- `POST /api/assistant/photo` multipart `files` (≤ 4) → `{ suggestions: [{ name, qty, best_before, confidence, product_id }], estimate: true }` – `best_before` is read from the package or estimated (`days_left`), nothing is saved.
- `POST /api/assistant/stock-apply` `{ items: [{ name, qty, best_before?, product_id? }] }` → `{ added, actions: [{ kind: 'stock_add', summary, undo }] }`.

Eval: the per-screen cases are in `scripts/assistant-eval-cases.mjs` (field `context`) and run offline in
`test/assistant-eval.test.ts`, which also checks that a Hausinfo code never appears in anything sent to the model.

## What the model is told

`buildContext({ purpose, viewer })`: household name, date, who is talking; people with likes and dislikes; the open list without private items; what is due by rhythm; the week plan; money this week/month and the budget; what ToHuus remembers (without sensitive rows). Allergies, children's birth years and sensitive memory only with the household's consent `ai.health_share` (default off). Per-person reasons are always neutral ("für mindestens eine Person ungeeignet", "ein Liebling bei euch").

The system prompt is German (du-Form) or English, by household language.

## What ToHuus remembers

A row can be personal: `POST /api/memory { text, onlyMe: true }` ("Nur für mich") – then only its author sees it, in the app, in their own assistant and in their own MCP connection; other members, the admin export and plain MCP tokens never do. Rows carry `onlyMe: boolean`.

Table `ai_memory`: `scope` household|person, `person` (key like `u2`/`k1`), `kind` fact|preference|routine, `text`, `source` user|assistant|derived, `sensitive` (word-list classifier: health, diet for medical reasons, pregnancy, medication, religion, politics, sexuality, origin, union), `created_by`, `confirmed_at`. Max 300 rows.

- `GET /api/memory` → all rows (including sensitive ones – it is the household's own data), `POST /api/memory` `{ text, kind?, person?, consent? }` (409 `health_consent` for the first sensitive note, see above), `DELETE /api/memory/:id`.
- MCP: `remember`, `forget`, `household_context`.

Outward the app says "ToHuus merkt sich …"; the word "Gedächtnis" stays internal.

## Limits

Before every model call `consumeAssistant()` ([`limits.ts`](../server/lib/limits.ts) → `plans.consume('assistant')`) counts one message per household: Free 20, Haushalt 100, Plus/trial 1 500 a month; self-hosted unlimited. A voice message counts once (transcription and answer together), `/transcribe` alone counts once.

- **Used up**: what the built-in reader understands (lists, "Milch ist alle", a told purchase …) still works and answers with `mode: "basic"` – no model call. Anything else answers **HTTP 402** `{ "error": "…", "code": "quota.assistant", "remaining": 0 }`.
- **Plus fair use** over 1 500: still answered by the model, but shorter; the answer carries `"throttled": true`.
- AI receipt reads (photos, receipt text) count against `receiptAiPerDay` (`consume('receiptAi')`); over it, HTTP 429 `{ error, code: "quota.receiptAi", remaining: 0 }`. Receipts themselves stay unlimited (PDF parsers need no AI).

Recordings are never stored: they stay in memory for the transcription and are dropped (no storage quota involved).

## Configuration

| Variable | Default |
|---|---|
| `AI_API_KEY` | – (no key: assistant in basic mode) |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` |
| `AI_MODEL_TEXT` | `mistralai/mistral-small-2603` |
| `AI_MODEL_VISION` | `mistralai/mistral-small-2603` |
| `AI_MODEL_VISION_HARD` | `mistralai/mistral-large-4-0` (second try for receipts that don't add up) |
| `AI_MODEL_AUDIO` | `mistralai/voxtral-small-24b-2507` |
| `VISION_BASE_URL`, `VISION_API_KEY`, `VISION_MODEL` | older installs; used when no `AI_*` is set (then no audio model unless `AI_MODEL_AUDIO`) |

Every request to OpenRouter carries `provider: { order: ["mistral"], allow_fallbacks: false, data_collection: "deny" }`. Timeouts 60 s (vision 120 s, audio 90 s), two retries with backoff for 429/5xx/timeouts. At start the server checks on OpenRouter's `/models` that the vision model accepts images and logs a warning if not.
