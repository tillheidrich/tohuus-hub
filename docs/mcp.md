# MCP server (AI assistants)

ToHuus Hub has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server, so Claude, ChatGPT and other MCP clients can read and change the household on your behalf. A typical use: send a photo of a receipt, a freezer drawer or a recipe card to your assistant and say "put this into ToHuus Hub".

## Connect with sign-in (OAuth 2.1) – recommended

*Settings › Access & AI › Mit Claude oder ChatGPT verbinden* shows the MCP address: **`https://your-host/mcp`** (ToHuus Cloud: the cloud address + `/mcp`).

1. Claude: *Settings › Connectors › Add custom connector*, paste the address. ChatGPT: *Settings › Connectors › Create* (developer mode), authentication OAuth.
2. The client registers itself, opens the ToHuus sign-in, then the consent screen: which household (cloud, if you belong to several), **read** or **read and change**, and optionally **Allergien und Kinderdaten** (off by default).
3. Done. The connection is listed under the same card (client name, scopes, last used) and can be ended there. A mail tells the person that a new assistant was connected.

Implementation follows the MCP authorization spec (2025-06-18): `server/lib/oauth.ts`, `server/routes/oauth.ts`.

| Endpoint | |
|---|---|
| `GET /.well-known/oauth-protected-resource` (also `/mcp` suffix) | RFC 9728: `{ resource: <base>/mcp, authorization_servers: [<base>], scopes_supported, bearer_methods_supported: ['header'] }` |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: authorize, token and registration endpoints; `code_challenge_methods_supported: ['S256']`, `token_endpoint_auth_methods_supported: ['none']`, `grant_types_supported: ['authorization_code','refresh_token']` |
| `POST /oauth/register` | RFC 7591 dynamic registration, public clients only. `redirect_uris`: https, http only on loopback, or an app scheme; 20 per hour and IP |
| `GET /oauth/authorize` | needs `response_type=code`, `client_id`, exact `redirect_uri`, `code_challenge` + `code_challenge_method=S256` (plain is refused), optional `scope`, `state`, `resource` (must be `<base>/mcp`). Not signed in → `/?next=…` (the web app comes back after sign-in). Unknown client or redirect → an error page, never a redirect |
| `POST /oauth/authorize` | the consent form (same origin only): `household`, `access=read|write`, `health=1`, `decision=allow|deny` → `302 redirect_uri?code=…&state=…&iss=<base>` |
| `POST /oauth/token` | form or JSON. `authorization_code` (+ `code_verifier`, `redirect_uri`, `client_id`) or `refresh_token` (+ `client_id`, optional narrower `scope`) → `{ access_token, token_type: 'Bearer', expires_in: 3600, refresh_token, scope }` |
| `GET /api/oauth/connections` | own connections `{ connections: [{ id, client, scopes, created_at, last_used_at }], mcpUrl, mcp }` – never other members' |
| `DELETE /api/oauth/connections/:id` | end an own connection |

- **Scopes:** `mcp:read` (only tools marked `readOnlyHint`, everything else is not offered), `mcp:write` (all tools), `mcp:health` (allergies, children's birth years and sensitive memory – and only while the household has *Assistent & Datenschutz* switched on; without the scope the health switch counts as off for that connection).
- **Lifetimes:** code 2 minutes and single use (a second use revokes the connection), access token 1 hour, refresh token 60 days and **rotated on every use**; presenting an already rotated refresh token revokes the connection.
- **Who may connect:** adults with a sign-in (admins, members). Permanent guests and children cannot (children never have a sign-in).
- **401 from `/mcp`** carries `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource"` (plus `error="invalid_token"` when a token was sent).
- **Cloud:** codes and tokens carry the household's routing prefix (`sw_h…_…`); a token request or MCP call is routed to that household and checked in its own encrypted database. Registered clients live in `accounts.db`. Self-host: everything in the household database.
- **MCP switch:** *Settings › Access & AI › Eure eigenen Assistenten (MCP)* (`mcp.enabled`, admins). Off ⇒ `/mcp` answers 403 for OAuth connections and old tokens alike, and no new connection can be authorised. Independent from the built-in AI switch.

## Connect with a token in the URL (Home Assistant, older clients)

1. *Settings › Access & AI › New access › AI assistant (Einstellungen › Zugänge & KI › Neuer Zugang › KI-Assistent)*.
2. Copy the MCP address, `https://your-host/mcp/sw_…`. The token is part of the URL, so treat it like a password. Revoke it under the same settings tab if it leaks.
3. Use it as the connector URL with authentication none.

Alternatives: `POST /mcp` with `Authorization: Bearer <token>` (an `mcp` or `full` token), or a fixed path `/mcp/<MCP_PATH_SECRET>` from the environment.

An "AI assistant" token can only reach `/mcp`, nothing else in the API. The transport is stateless Streamable HTTP. Changes made by the assistant show the token's name (OAuth: "Claude (Mira)") in the history.

## Behaviour worth knowing

- **Purchases go to review by default.** `record_purchase` creates an import that waits for a person to check it. The assistant can pass `apply: true` to book it immediately.
- **Recipes are saved directly.**
- **Privacy**: discreet and private shopping items are never returned by name; the assistant sees the neutral placeholder or nothing.
- **Health data (Art. 9 GDPR)**: allergies, children's birth years and memory rows flagged sensitive are only returned when an admin allowed sharing health data with AI (*Settings › Access & AI*, `ai.healthShare`, default off). Every tool answer passes the same filter as the built-in assistant (`redactForAssistant()` in `server/lib/people-signals.ts`): suggestion reasons never name a person ("für mindestens eine Person ungeeignet", "ein Liebling bei euch"). Regression test: `test/security-ai-art9.test.ts`.
- **Suggestions, not automation**: `purchase_rhythm` only says what is probably due; put things on the list when the person agrees.
- **Region first**: `region_info` tells the assistant the currency and receipt conventions before it records a purchase.
- Read-only tools are marked with `readOnlyHint`, so clients can run them without asking.

## Tools

114+ tools (the exact list: `tools/list`), grouped by area. Source: `server/mcp/server.ts` (core) and `server/mcp/tools-<area>.ts`.

### Core (23)

| Tool | What it does |
|---|---|
| `get_overview` | What is low, empty or expiring, the shopping list, what could be cooked today |
| `search_stock` | Search stock |
| `update_stock` | Change a quantity or fill level |
| `mark_used_up` | Set a product to 0 and put it on the list |
| `create_product` | Create a product |
| `record_purchase` | Record a purchase or receipt (goes to review) |
| `get_shopping_list` | Open items on the list |
| `add_to_shopping_list` | Add items |
| `check_shopping_item` | Tick an item off |
| `suggest_meals` | What shall we cook? |
| `list_recipes` | List recipes (search, Thermomix, favourites) |
| `get_recipe` | Full recipe with steps and cooking history |
| `save_recipe` | Save a recipe |
| `log_cooked` | Log that a recipe was cooked |
| `get_meal_plan` | Planned meals for the next days, incl. the Cookidoo week |
| `plan_meal` | Plan a meal |
| `move_meal` | Move a planned meal |
| `fill_week` | Fill free evenings from stock |
| `week_shopping` | Put the week's missing ingredients on the list |
| `where_is` | Where is something? |
| `set_place` | Remember where something is |
| `list_locations` | Places with product counts |
| `product_details` | A product with recent history |

### Lists, usuals, trips and offers (6)

`list_lists`, `create_list`, `usual_items`, `check_before_adding` (on a list / bought recently / at home), `shopping_trips` (who is shopping now; private trips never), `current_offers` (offers the household saved). All read-only except `create_list`, so a read-only OAuth connection gets five of them.

### Keeping stock fresh (6)

`mark_opened`, `freeze_item`, `add_leftovers`, `eat_first`, `quick_check_location`, `confirm_stock`

### Leftovers and freezer boxes (5)

`list_leftovers_and_frozen`, `save_leftovers`, `mark_leftovers` (eaten, thawed, thrown away), `undo_leftovers_change`, `plan_leftovers`

### Shopping (3) and sharing (6)

`quick_add`, `claim_item` ("I'll get it"), `shopping_by_aisle`; `share_text_to_list`, `add_discreet_item`, `make_item_discreet`, `discreet_items_overview` (counts and placeholders only), `start_mode` ("only what runs out"), `mark_runs_out`

### Cooking (3), recipes import (4), people (3)

`what_to_eat`, `set_recipe_variant`, `add_swap_rule`; `recipes_import_bulk`, `recipes_search_open` (TheMealDB), `recipes_import_open`, `recipes_export`; `household_people`, `rate_recipe`, `favourite_recipes`

### Week plan 2 (10)

`list_food_votes`, `start_food_vote`, `cast_food_vote`, `finish_food_vote`, `plan_rotation`, `save_plan_template`, `set_plan_rotation`, `apply_plan_rotation`, `mark_plan_day` (away, eating out), `set_plan_servings`

### Treats and order menu (5)

(The party tools `start_party`, `end_party`, `party_status` were removed with the party mode on 18 Oct 2026.)

`set_order_status`; `menu_list`, `menu_add_item`, `menu_update_item`, `menu_set_availability`

### Kids (2)

`kid_wishes`, `answer_kid_wish`

### Trips (5)

`get_trip_status`, `start_trip`, `stop_trip`, `trip_packing_list`, `welcome_home_list`

### Home care and spending (5 + 4)

`list_care_tasks`, `complete_care_task`, `add_care_task`, `spending_summary`, `price_history`; `spending_stats`, `set_budget`, `exclude_from_stats`, `add_expense`

### Receipts (2 + 4)

`check_receipt_inbox`, `waste_summary`; `list_receipt_rules`, `delete_receipt_rule`, `receipt_recognition_stats`, `receipt_recognition_report`

### Home Assistant (4)

`get_home_assistant_sync`, `sync_home_assistant_now`, `who_is_home`, `list_voice_commands`

### Purchase rhythm and what ToHuus remembers (4)

| Tool | What it does |
|---|---|
| `purchase_rhythm` | How often each product is bought (receipts by purchase date + list ticks, no stock needed), what is due now (read-only) |
| `remember` | Remember a household fact, preference or routine the person asked for |
| `forget` | Forget something ToHuus remembers (by id or text) |
| `household_context` | The household right now: people (likes/dislikes; health data only with consent), open list, due by rhythm, week plan, money this month, what ToHuus remembers (read-only) |

### Haushaltswissen and tasks (9) – 18 Oct 2026

`server/mcp/tools-knowledge.ts`, logic in `server/lib/knowledge.ts` / `knowledge-io.ts` (docs/knowledge.md).

| Tool | |
|---|---|
| `knowledge_search` | Cards "subject · property: value" and note lines, by words; each with who sees it and its earlier values (read-only) |
| `knowledge_get` | One card by id with its visible history (read-only) |
| `knowledge_export` | The knowledge as file text: `md`, `csv` or `json` (read-only) |
| `knowledge_set` | New card or new value (old one into the history); `only_me` for a member connection |
| `knowledge_import` | A pasted note/list (Markdown, text, CSV, our JSON) → cards and note lines, duplicates updated |
| `knowledge_visibility` | Share a private card / make a household card private (member connection only; health cards are shared only in the app) |
| `knowledge_delete` | Delete one card (`destructiveHint`) |
| `tasks_coming_up` | Heute › Demnächst: bins by the evening they go out, tomorrow, lead times (read-only) |
| `undo_task_done` | Take back the newest "done" of a task (app rules: own ticks, others only an admin member) |
| `add_task` | New task the way the assistant makes it (`assistant-tasks.ts addTask`): household chore (`area: house`, default) or care & deadline; `date` + `time` (+ `minutes`, `place`) = appointment in the calendar; without date/time the name is read like the assistant does („Zahnarzt Dienstag um 10“); rhythm `every` + `unit`, `as_needed`, `doer`, `take_turns`, `steps`; nothing given = due today. `only_me` only for a member connection. Write tool – not offered to `mcp:read` / read-only households |

**Who is asking:** an OAuth connection acts as its member – it sees household cards plus that member's own private
ones, never anyone else's. An API token acts for the household: household cards only; `only_me`, sharing and
health-related cards are refused (409 `health_person`, no person to keep them private for), and `undo_task_done`
needs a member. Health-related cards are filtered like all MCP answers (`hidden_health_entries` counts them) unless
the household shares health data with AI **and** the connection has `mcp:health`. `remember` now stores `origin: mcp`.

**Read-only:** an `mcp:read` connection and a cloud household without a plan (`planOf() === 'readonly'`, Build 15)
get only `knowledge_search`, `knowledge_get`, `knowledge_export`, `tasks_coming_up` (plus the other read tools);
the write tools are not even listed. Tests: `test/knowledge-io.test.ts` › "MCP" (tools/list and tools/call over HTTP
with an API token, an OAuth read+write member and an OAuth read-only member).

### Places (4)

`get_home_setup`, `set_household_form`, `add_place`, `update_place` (`server/mcp/tools-places.ts`).

### Household and system (9)

`region_info`, `send_household_message`, `display_status`, `print_ticket`, `send_ticket`, `backup_now`, `household_members`, `getting_started_status`, `data_overview`

Per module (before 18 Oct): core 23, fresh 6, labels 5, shop 3, share 6, cook2 3, recipes2 4, people 3, plan2 10, party 4, menu 4, kids 2, away 5, home 5, spend2 4, retail 2, quality 4, ha2 4, intl 1, channels 1, kiosk 1, print 2, data 2, onboard 1, tour 1, places 4, features 4. Total 114, plus knowledge 9 (18 Oct).

To count them yourself:

```bash
grep -c "registerTool(" server/mcp/*.ts
```

## Nachtrag 18 Oct 2026

- `add_task` (above): appointments and household tasks over MCP, same logic as the assistant. Tests:
  `test/knowledge-io.test.ts` › „add_task over MCP“ (API token, OAuth member, mcp:read, read-only build).
