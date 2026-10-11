# MCP server (AI assistants)

ToHuus Hub has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server, so Claude, ChatGPT and other MCP clients can read and change the household on your behalf. A typical use: send a photo of a receipt, a freezer drawer or a recipe card to your assistant and say "put this into ToHuus Hub".

## Connect

1. *Settings › Access & AI › New access › AI assistant (Einstellungen › Zugänge & KI › Neuer Zugang › KI-Assistent)*.
2. Copy the MCP address, `https://your-host/mcp/sw_…`. The token is part of the URL, so treat it like a password. Revoke it under the same settings tab if it leaks.
3. Claude: *Settings › Connectors › Add custom connector*, authentication none. ChatGPT: *Settings › Connectors* in developer mode.

Alternatives: `POST /mcp` with `Authorization: Bearer <token>` (an `mcp` or `full` token), or a fixed path `/mcp/<MCP_PATH_SECRET>` from the environment.

An "AI assistant" token can only reach `/mcp`, nothing else in the API. The transport is stateless Streamable HTTP. Changes made by the assistant show the token's name in the history.

## Behaviour worth knowing

- **Purchases go to review by default.** `record_purchase` creates an import that waits for a person to check it. The assistant can pass `apply: true` to book it immediately.
- **Recipes are saved directly.**
- **Privacy**: discreet and private shopping items are never returned by name; the assistant sees the neutral placeholder or nothing.
- **Region first**: `region_info` tells the assistant the currency and receipt conventions before it records a purchase.
- Read-only tools are marked with `readOnlyHint`, so clients can run them without asking.

## Tools

106 tools, grouped by area. Source: `server/mcp/server.ts` (core) and `server/mcp/tools-<area>.ts`.

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

### Guests, party and order menu (8)

`start_party`, `end_party`, `party_status`, `set_order_status`; `menu_list`, `menu_add_item`, `menu_update_item`, `menu_set_availability`

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

### Household and system (9)

`region_info`, `send_household_message`, `display_status`, `print_ticket`, `send_ticket`, `backup_now`, `household_members`, `getting_started_status`, `data_overview`

Per module: core 23, fresh 6, labels 5, shop 3, share 6, cook2 3, recipes2 4, people 3, plan2 10, party 4, menu 4, kids 2, away 5, home 5, spend2 4, retail 2, quality 4, ha2 4, intl 1, channels 1, kiosk 1, print 2, data 2, onboard 1, tour 1. Total 106.

To count them yourself:

```bash
grep -c "registerTool(" server/mcp/*.ts
```
