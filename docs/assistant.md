# The assistant

The floating button on every tab (microphone and text). ToHuus' assistant is the household's shopping and household helper, cook planner and money helper: short answers, writes only when asked, every write can be undone. It is never a doctor or a nutrition coach and never says "allergen-free".

Code: [`server/lib/assistant.ts`](../server/lib/assistant.ts) (conversation, model loop, built-in reader), [`assistant-tools.ts`](../server/lib/assistant-tools.ts) (tools and undo), [`assistant-parse.ts`](../server/lib/assistant-parse.ts) (reading without a model), [`assistant-context.ts`](../server/lib/assistant-context.ts) (what the model is told), [`ai.ts`](../server/lib/ai.ts) (the model client), routes in [`server/routes/assistant.ts`](../server/routes/assistant.ts).

## Two modes

| | With a model | Without a model |
|---|---|---|
| When | `AI_API_KEY` (or the older `VISION_*`) is set | self-hosted without a key, the monthly allowance is used up, or the model is not reachable |
| `mode` in the answer | `ai` | `basic` |
| What works | free conversation, tool calling over everything below | the common sentences: lists ("Milch, 2 Paprika und Brot", "Setz Butter auf die Liste", "add milk to the list"), "Milch ist alle", "Haben wir noch Eier?", "Hab bei Aldi Milch, Eier und Brot für 12,40 gekauft", "Was ist fällig?", "Was steht auf der Liste?", "Was kochen wir?", "Was haben wir ausgegeben?", "Merk dir …", "Vergiss …" |

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

→ `{ ok: true, summary, already? }`. Tokens live 24 hours and only work for the person whose message caused the action (404 otherwise).

### Conversations, status, consent

- `GET /api/assistant/conversations` → own conversations `[{ id, title, created_at, updated_at, messages }]`; `GET /api/assistant/conversations/:id` → `{ id, messages: [{ id, role, content, actions, mode, created_at }] }`; `DELETE` one or all (`DELETE /api/assistant/conversations`). Conversations are private to the person and deleted 30 days after the last message.
- `GET /api/assistant/status` → `{ ai, voice, receiptsAi, healthShare, language }` – what the UI can offer.
- `GET /api/assistant/settings` → `{ healthShare }`; `PATCH` (admins) `{ healthShare: boolean }`. Also in `GET/PATCH /api/settings` as `ai.healthShare`.

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

## What the model is told

`buildContext({ purpose, viewer })`: household name, date, who is talking; people with likes and dislikes; the open list without private items; what is due by rhythm; the week plan; money this week/month and the budget; what ToHuus remembers (without sensitive rows). Allergies, children's birth years and sensitive memory only with the household's consent `ai.health_share` (default off). Per-person reasons are always neutral ("für mindestens eine Person ungeeignet", "ein Liebling bei euch").

The system prompt is German (du-Form) or English, by household language.

## What ToHuus remembers

Table `ai_memory`: `scope` household|person, `person` (key like `u2`/`k1`), `kind` fact|preference|routine, `text`, `source` user|assistant|derived, `sensitive` (word-list classifier: health, diet for medical reasons, pregnancy, medication, religion, politics, sexuality, origin, union), `created_by`, `confirmed_at`. Max 300 rows.

- `GET /api/memory` → all rows (including sensitive ones – it is the household's own data), `POST /api/memory` `{ text, kind?, person? }`, `DELETE /api/memory/:id`.
- MCP: `remember`, `forget`, `household_context`.

Outward the app says "ToHuus merkt sich …"; the word "Gedächtnis" stays internal.

## Limits

Before every model call `consumeAssistant()` ([`limits.ts`](../server/lib/limits.ts)) counts one message. Today it always allows; after the cloud branch it becomes `plans.consume('assistant')` (Free 20, Haushalt 100, Plus 1 500 fair use per month). When the allowance is used up, the answer comes from the built-in reader with a short note.

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
