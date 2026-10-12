# Home Assistant

ToHuus Hub talks to Home Assistant in three ways. Use the first; the others exist for special cases.

| Way | What | When |
|---|---|---|
| **Integration** (HACS) | Native entities, actions, events, live updates | Always, if you can install from HACS |
| YAML package | REST sensors, `rest_command`, webhook push automation | No HACS, or you want the actionable iOS push from the package |
| Outbound (ToHuus Hub → HA) | Cookidoo week plan pulled with an HA token (alternative to the integration's push); two-way topics (shopping list, meal plan, care, presence, notifications) via HA's REST API; notification webhook | Only without the integration; the integration does all of this by itself |

The integration lives in its own repository: **[tillheidrich/tohuus-hub-ha](https://github.com/tillheidrich/tohuus-hub-ha)** (source in this repo under [`ha-integration/`](../ha-integration/), MIT licence for HACS friendliness).

## Set up the integration

1. Home Assistant › HACS › ⋮ › *Custom repositories* › `https://github.com/tillheidrich/tohuus-hub-ha`, type *Integration*. Download **ToHuus Hub**, restart Home Assistant.
2. ToHuus › *Settings › Home Assistant* (or *Access & AI › Home Assistant*) › **Connect Home Assistant**. ToHuus shows a short code (`ABCD-EFGH`, valid 10 minutes, single use).
3. Home Assistant › *Settings › Devices & services › Add integration › ToHuus Hub* › choose **ToHuus Cloud** (`https://cloud.tohuus.heidrich-digital.de`) or **Own server** (address as Home Assistant reaches it, e.g. `http://192.168.1.20:8080`) and enter the code.

Home Assistant only connects *out* (HTTPS + server-sent events). Nothing in the home needs to be reachable from the internet, and the cloud never calls into Home Assistant.

The manual way still works: *Own server › Token instead of code*, with a token from *Settings › Access & AI › New access › Home Assistant* (`sw_…`, shown once).

A "Home Assistant" token can only call `/api/ha/*` and `/api/events` – nothing else in the API, no MCP. It is listed (and revocable) under *Access & AI*, named "Home Assistant · <name of the HA installation>".

### Pairing API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/ha/pair/start` | household admin (cookie session or app token) | → `{code: "ABCD-EFGH", expires_at, expires_in: 600}`; an older unused code of the household stops working. Rate limit 20/hour/household. |
| GET | `/api/ha/pair/status` | household admin | → `{state: "none" \| "pending" \| "claimed", expires_at?, device?, claimed_at?}` (claimed is kept 15 minutes, for the "connected" tick) |
| DELETE | `/api/ha/pair` | household admin | cancel the waiting code |
| POST | `/api/ha/pair/claim` | **public** | `{code, name?}` → `{token, api, instance_id, household, base_url, mode: "cloud" \| "selfhost"}`. Code is case-insensitive, dashes/spaces ignored, alphabet without 0/O/1/I/L. 404 `{code: "invalid_code"}`, 410 `{code: "gone"}` (household deleted), 429 `{code: "too_many_attempts"}` (10 per 10 min per address, 300 per 10 min overall). |

Codes live in memory (hashed, one per household); in ToHuus Cloud the code also routes to its household, the token is created there and carries the household's routing prefix. The iPhone app can show the same code (call `start`, poll `status`).

**Options** (*Configure*): notify services + kinds (0.3: ToHuus notifications from the live stream are passed to `notify.*` services – don't combine with per-member routing in *Settings › Home Assistant*, or they arrive twice), features on/off (to-do, calendars, display images, buttons, event entity – sensors are always on), live updates on/off, display image colours (`color` / `gray` / `bw`) and size, Cookidoo week on/off and its calendar entity. Switching a feature off removes its entities.

**Re-authentication:** if the token is revoked, Home Assistant asks for a new one. *Reconfigure* changes the address.

## Entities

One device "ToHuus Hub" per ToHuus Hub instance (model = household name). Entity ids are fixed English ids so dashboards work in every language; a second ToHuus Hub gets `_2`. Names are translated (English, German, Swedish).

| Entity | State | Attributes |
|---|---|---|
| `sensor.tohuus_hub_due` (0.3) | rhythm suggestions due now | `items` [{name, every_days, last_bought, due_on, label}] |
| `sensor.tohuus_hub_spending_month` / `_spending_week` (0.3) | money spent (monetary, unit = household currency) | `week`, `month`, `budget`, `budget_left`, `budget_state` (month sensor) |
| `select.tohuus_hub_leader_shopping` / `_meals` / `_care` (0.3, bridge on) | who leads: `both` / `home_assistant` / `tohuus` / `off` (the modes the topic offers) | `entities` (HA lists/calendars taking part) |
| `todo.tohuus_hub_shopping_list` | open items | – (to-do items: summary, status, description = "2× · note") |
| `calendar.tohuus_hub_meal_plan` | on while today has a planned meal | next meal: `recipe_id`, `slot`, `image_url` |
| `calendar.tohuus_hub_care_tasks` | on on the next due day | – |
| `sensor.tohuus_hub_tonight` | title of tonight's planned meal, else today's best suggestion | `source` (`plan`/`idea`), `recipe_id`, `slot`, `cooked`, `url`, `image_url`, `reasons`, `tomorrow`; entity picture = recipe photo |
| `sensor.tohuus_hub_products_low` | count | `items` [{id, name, status, qty, qty_text, unit, best_before, image_url}] |
| `sensor.tohuus_hub_products_empty` | count | `items` |
| `sensor.tohuus_hub_expiring_soon` | count (best before soon or past) | `items` |
| `sensor.tohuus_hub_eat_first` | count | `items` [{name, kind (`product`/`leftover`), use_by, days_left, qty, unit, opened}], `leftovers` |
| `sensor.tohuus_hub_frozen_portions` | portions | `items` [{code, name, place, portions, eat_by, days_left, state, url}] (freezer only), `fridge_portions`, `thaw` [{day, slot, meal, code, name}] – planned meals to take out of the freezer |
| `sensor.tohuus_hub_shopping_list` | open items | `items` (names) |
| `sensor.tohuus_hub_open_orders` | new + accepted orders | `orders`, `new` |
| `sensor.tohuus_hub_care_due` | tasks overdue, today or soon | `tasks` [{id, name, state, next_due, days, location, assignee}], `overdue` |
| `sensor.tohuus_hub_next_care_task` | timestamp (local midnight of the due day) | `task`, `task_id` |
| `sensor.tohuus_hub_party` | `off` / `live` | `name`, `started_at`, `ends_at`, `open_orders`, `new_orders`, `orders_total`, `guest_url` |
| `sensor.tohuus_hub_kid_wishes` | pending wishes | `wishes` [{id, kid, name, qty, created_at, image_url}] |
| `sensor.tohuus_hub_receipts_to_review` | imports waiting for review | – |
| `binary_sensor.tohuus_hub_party_running` | party live | `name`, `ends_at` |
| `binary_sensor.tohuus_hub_something_expired` | at least one product past its date | `items` |
| `button.tohuus_hub_check_receipt_inbox` | – | polls the receipt mailbox now (error if not set up) |
| `button.tohuus_hub_fill_week` | – | fills empty evenings of the next 7 days with suggestions |
| `button.tohuus_hub_backup_now` | – | manual backup (+ WebDAV copy if configured) |
| `image.tohuus_hub_display_<id>` | – | each kitchen display (*Settings › Displays*) as PNG, re-rendered when data changes |
| `event.tohuus_hub_notification` | last notification | `event_type` (`order_new`, `stock_low` …), `title`, `message`, `url`, `data` |

List attributes are excluded from the recorder so the database stays small.

### Shopping list semantics

The to-do entity works directly against ToHuus Hub (no copy in HA):

- **Add**: the text is parsed like the quick add – "2 milk, bread" becomes two items, known products are matched, an existing open item isn't duplicated.
- **Tick off / untick**: same as in the app; ticked items stay visible as *completed* for a day.
- **Rename / description**: the description shows quantity and note (`2× · organic`); editing `3× · …` sets the quantity.
- **Reorder**: drag and drop is stored per item (`ha_todo_pos`); items you never moved stay on top, newest first, like in the app.
- **Delete**: removes the item in ToHuus Hub.

The older *Settings › Access & AI › Shopping list in Home Assistant* sync (ToHuus Hub copying the list into an HA `todo` entity such as the built-in shopping list) is not needed with the integration – leave it off, otherwise the list exists twice.

## What Home Assistant already does – two-way per topic

*Settings › Home Assistant* answers "what does Home Assistant already do for you?". With the integration (0.2.0+) or an HA address + long-lived token (*Settings › Access & AI › Cookidoo*), ToHuus Hub reads what HA has (to-do lists with platform, calendars, people, `notify` services, voice-exposed devices), proposes a mode per topic, and *Take over the suggestions* applies them. Nothing has to be done twice: whatever runs in HA stays there and is mirrored.

| Topic | HA side | Modes | Notes |
|---|---|---|---|
| Shopping list | to-do lists (`shopping_list`, Bring!, Todoist, Local To-do, Cookidoo), several possible | `two_way` (default proposal), `from_ha` (HA leads), `to_ha` (ToHuus leads), `off` | quantities as `2 Milk` ⇄ qty, ticks both ways, dedupe by normalised name; private entries (`share_items`, area share) never leave ToHuus and a linked one that turns private is removed in HA; discreet entries only travel as their neutral placeholder and a rename from HA never overwrites it |
| Meal plan | calendars (Mealie, Local Calendar, family calendar) | `from_ha` (default), `to_ha`, `two_way` | events we write carry `[tohuus:meal:<id>]` → recognised, never re-imported; the Cookidoo calendar is excluded (own import); moving/removing exported events needs the integration (HA has no REST delete) |
| Care tasks | one to-do list | `to_ha` | due tasks (overdue/today) appear; ticking one off completes it (next date calculated), the item is then removed |
| Who is home | `person.*` → members (mapping editable) | on/off | `presence()`, `isHome(userId)`, `everyoneAway()` and `onPresence(fn)` in `server/lib/ha2.ts` for other modules: feeds away mode's presence (`setPresence` in `away.ts`, only a suggestion), and the "who takes care of it?" picker on the shopping list marks members who are out (they can pick it up on the way) |
| Notifications | `notify.mobile_app_*` | per member | members with an HA app service get notifications there and no Web Push (`setPersonalRouter` hook in `notify.ts`) |
| NFC tags | `tag_scanned` (integration only) | on/off | unknown tags are listed; map a tag to a QR label + action (`take`, `list`, `opened`, `done`); result fired as `tohuus_hub_tag` |
| Voice commands | exposed entities (Assist / Alexa / Google) | – | babysitter page, see below |

ToHuus Hub's own entities (`todo.tohuus_hub_*`, `calendar.tohuus_hub_*`) are never sync targets. The older *Shopping list in Home Assistant* sync (`shop.haTodo`) is switched off and its links are taken over when the shopping topic is saved.

### Sync engine

`server/lib/ha2-engine.ts` is pure and generic (tests in `test/ha2.test.ts`); `server/lib/ha2.ts` holds the topic adapters (shopping, meals, care), the outbox and both transports.

- **Links** (`ha2_links`): local id (row id + creation time, so reused ids never inherit a link) ⇄ HA uid, plus the fields at the last sync (`base`). Three-way merge per field: changed only on one side → copied to the other.
- **Conflicts** (both sides changed a field): `from_ha` → HA wins, `to_ha` → ToHuus wins, `two_way` → last writer wins. Local change times come from SQLite triggers (`ha2_touch`), the remote time is the entity's `last_updated`.
- **Deletions**: tombstones. Deleted here → removed in HA and not re-imported while HA still shows it; edited in HA after the deletion → comes back. Deleted in HA → deleted here (shopping: only open items), unless edited here afterwards.
- **Creation direction** by mode; done items are never created on the other side; unlinked items with the same key are linked instead of duplicated.
- **Outbox** (`ha2_outbox`): operations for HA (`todo` add/update/remove, `calendar` create/delete, `notify`), acknowledged with the new uid; un-acknowledged ops are re-sent after 3 minutes (not notifications).
- **Transports**: *integration* (preferred, when it synced within 15 min) – `POST /api/ha/v1/bridge/sync` with `{version, capabilities?, todo: {entity: {items, last_updated}}, calendar: {…}, persons, acks}` → `{config: {todo, calendar: [{entity_id, start, end}], persons, tags, want_capabilities}, ops: [{id, topic, op}]}`; a local change sends the server-sent event `bridge` so the integration syncs within ~2 s. *rest* – ToHuus calls `todo.get_items` / `add_item` / … and `/api/calendars/<entity>` itself every 3 minutes and after local changes.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ha2` | overview: settings, transport, capabilities, proposals, status per topic/entity, presence |
| PATCH | `/api/ha2/settings` | `{shopping|meals|care: {mode, entities}, presence: {enabled, map}, notify: {userId: service}, tags: {enabled}, transport}` (admin) |
| POST | `/api/ha2/apply-proposals`, `/api/ha2/detect`, `/api/ha2/sync` | take over suggestions / look again / sync now |
| GET | `/api/ha2/presence` | who is home, everyone away |
| GET/PUT/POST/PATCH/DELETE | `/api/ha2/voice`, `/api/ha2/voice/settings` (`{assistant, sitter_default}`), `/api/ha2/voice/entities`, `/api/ha2/voice/import-exposed`, `/api/ha2/voice/items[/:id]`, `/api/ha2/voice/links/:id` (`{on}`) | voice command guide (writes: admin) |
| GET/PATCH/DELETE | `/api/ha2/tags[/:id]` | seen tags, mapping to a QR label + action |
| GET | `/api/ha/v1/bridge/config` | what the integration should watch |
| POST | `/api/ha/v1/bridge/sync`, `/api/ha/v1/bridge/tag` | integration bridge (HA token) |

All `/api/ha2*` routes are closed to permanent guests (presence and notification routing are household matters) and to the Home Assistant token.

MCP: `get_home_assistant_sync`, `sync_home_assistant_now`, `who_is_home`, `list_voice_commands`.

### Voice commands on the babysitter page

*Settings › Home Assistant › Voice commands for the babysitter page*: choose the assistant (Alexa, Google, Siri, HA Assist), take over everything exposed to it ("Take over what Alexa can reach"), pick from HA, or add entries by hand (works without HA). Example phrases are generated per kind and language ("Alexa, schalte Wohnzimmer Licht ein"); own phrases per entry override them; entries can be hidden. The section is on for every babysitter and house-sitter link ("Where is what?" links, including the away-mode house-sitter link) unless switched off for that link; the default itself can be switched off (`sitter_default`), then it is per link only. Other links (bar/party) never show it by default. The guest page shows it below the search (`GET /api/guest/:token/voice`, public, token-checked).

Safety: only `light`, `switch`, `cover`, `climate`, `fan`, `media_player`, `scene` and `script` (scripts only when picked explicitly, never by "take over"); never `lock`, `alarm_control_panel`, `camera`, `person`, `device_tracker` and the like, no covers of class garage/gate/door, and nothing whose name sounds like a lock, alarm, camera, gate or garage – also for hand-made entries and on every read.

## Actions

All accept `config_entry_id` (only needed with more than one ToHuus Hub) and return ToHuus Hub's response when called with *response* (`return_response: true` / "Response variable" in scripts).

| Action | Fields | Effect |
|---|---|---|
| `tohuus_hub.add_to_shopping_list` | `text` **or** `product`, `quantity` | Adds to the list (text parsed, products matched by name or number) |
| `tohuus_hub.consume` | `product`, `quantity` = 1 | Takes stock, oldest first |
| `tohuus_hub.mark_used_up` | `product` | Stock to zero, onto the shopping list |
| `tohuus_hub.add_stock` | `product`, `quantity` = 1, `best_before` | Books a purchase |
| `tohuus_hub.plan_meal` | `recipe` **or** `title`, `date` = today, `slot` = `dinner` | Adds to the week plan |
| `tohuus_hub.order` | `product` + `quantity`, or `items` [{product, qty, options}], `note`, `name` | Creates an order (sofa / party), goes through the normal order flow incl. push |
| `tohuus_hub.approve_kid_wish` | `wish_id`, `approve` = true | Approves (→ order) or declines a wish |
| `tohuus_hub.complete_care_task` | `task` (name or number) | Marks done, next date calculated |

`product` accepts a name (matched like receipts, confidence ≥ 0.6) or a number (`12`, `"#12"`). Unknown products raise a validation error ("Product not found").

Examples:

```yaml
# Voice / Assist: "Hey Nabu, we're out of coffee"
intent_script:
  CoffeeOut:
    action:
      - action: tohuus_hub.mark_used_up
        data: { product: Coffee beans }
    speech:
      text: Coffee beans are on the list.

# NFC tag on the fridge: one beer taken
automation:
  - alias: Beer taken
    triggers:
      - trigger: tag
        tag_id: fridge-beer
    actions:
      - action: tohuus_hub.consume
        data: { product: Pils, quantity: 1 }

# Friday 16:00: pizza night if nothing is planned
  - alias: Pizza Friday
    triggers:
      - trigger: time
        at: "16:00:00"
    conditions:
      - condition: time
        weekday: [fri]
      - condition: state
        entity_id: calendar.tohuus_hub_meal_plan
        state: "off"
    actions:
      - action: tohuus_hub.plan_meal
        data: { title: Pizza }
```

## Events

Every notification ToHuus Hub creates (regardless of which channels are switched on) is fired on the HA bus:

```yaml
event_type: tohuus_hub_event
data:
  event: stock.low            # dotted name as in ToHuus Hub
  type: stock_low             # underscored (same as the event entity's event_type)
  title: Coffee beans running low
  message: Only 1 pack left.
  url: http://tohuus.local:8080/bestand/12
  data: { product_id: 12 }    # event-specific
  config_entry_id: 01J…
```

| `event` | When | `data` |
|---|---|---|
| `stock.low` / `stock.empty` | a watched product drops below its minimum / runs out | `product_id` … |
| `stock.expiring` | daily check, best before within the warning days | |
| `import.review` | a receipt/import waits for review | |
| `order.new` / `order.status` | new order / status change (sofa, guests, party, approved kid wish) | `order_id`, `guest`, `items` |
| `shopping.added` | someone added to the list in the app | |
| `digest.daily` | daily summary | |
| `care.due` | a care task becomes due | |
| `party.ending` | party ends in 15 minutes | |
| `kids.wish` | a kid asked for something | |
| `test` | *Settings › Notifications › Test* | |

## Dashboards

[`ha-integration/dashboards/`](../ha-integration/dashboards/):

- `tohuus-core.yaml` – built-in cards only. **Kitchen** (sections): tonight's meal with photo and a "fill the week" tile, eat first, the shopping list as to-do card, running low / run out with names, care due and next care task, a list-week calendar, party, open orders; kid wishes and "something expired" appear only when relevant; a maintenance card with the buttons. **Wall** (panel, landscape tablet): clock and date, tonight, eat first, the full shopping list, the kitchen display image, a glance row and the week's meals.
- `tohuus-mushroom.yaml` – the same with [Mushroom](https://github.com/piitaya/lovelace-mushroom) template and chips cards (install Mushroom via HACS first).

Paste into *Dashboard › ⋮ › Edit dashboard › ⋮ › Raw configuration editor*.

## Integration API (v1)

The integration uses a small, versioned API that other tools can use too. Authentication: `Authorization: Bearer <token>` (scope "Home Assistant" or full). Stable within `v1`; fields may be added, not removed.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ha/v1/info` | `api`, `instance_id` (stable per installation), `household`, `base_url`, `language`, `scope`, `features` |
| GET | `/api/ha/v1/state` | everything above in one call: `counts`, `low`, `empty`, `expiring`, `shopping`, `todo`, `orders`, `care` {due, next}, `eat_first`, `tonight`, `tomorrow`, `next_meal`, `party`, `kid_wishes`, `displays`; since integration 0.3: `due` [{product_id, name, every_days, last_bought, due_on, origin, label}] (purchase rhythm suggestions, sensitive products never), `money` {currency, week, month, budget} and `sync` {shopping\|meals\|care: {mode, modes, entities}} |
| POST | `/api/ha/v1/bridge/leader` | `{topic: shopping\|meals\|care, mode}` – who leads per topic (`two_way` both, `from_ha` Home Assistant, `to_ha` ToHuus, `off`); HA token or admin |
| GET | `/api/ha/v1/events` | server-sent events: `hello`, `change` ({topics}), `tohuus` (notification) |
| GET | `/api/ha/v1/todo` | `{items: [{uid, summary, status, description, product_id, qty, …}]}` |
| POST | `/api/ha/v1/todo` | `{summary, description?}` → `{items: [{uid, summary, created}]}` |
| PATCH | `/api/ha/v1/todo/:uid` | `{summary?, status?: needs_action \| completed, description?}` |
| DELETE | `/api/ha/v1/todo/:uid` | – |
| POST | `/api/ha/v1/todo/delete` | `{uids: []}` |
| POST | `/api/ha/v1/todo/:uid/move` | `{previous_uid: string \| null}` (null = top) |
| GET | `/api/ha/v1/calendar/meals?start=&end=` | `{events: [{uid, date, slot, summary, description, recipe_id, image_url, url, cooked}]}` |
| GET | `/api/ha/v1/calendar/care?start=&end=` | `{events: [{uid, task_id, date, summary, description, state, overdue}]}` – recurrences projected, max. ~13 months |
| GET | `/api/ha/v1/display/:id/image.png?w=&h=&mode=` | display PNG (`mode` color \| gray \| bw) |
| POST | `/api/ha/v1/services/<name>` | `add_to_shopping_list`, `consume`, `add_stock`, `mark_used_up`, `plan_meal`, `order`, `approve_kid_wish`, `complete_care_task`, `fill_week`, `check_receipt_inbox`, `backup_now` |

`/api/events` (the app's own change stream) also accepts "Home Assistant" tokens.

## YAML package (fallback)

Creating a "Home Assistant" access also shows a YAML package (*Without the integration: YAML package*). Save it as `config/packages/tohuus.yaml` (with `homeassistant: packages: !include_dir_named packages` in `configuration.yaml`) and restart. It contains REST sensors from `GET /api/ha/summary`, `rest_command.tohuus_action` (`POST /api/ha/action` with `add_shopping`, `consume`, `used_up`, `restock`) and an automation turning ToHuus Hub webhooks into a phone push with an "Add to shopping list" button. For the push, put the webhook URL into *Settings › Notifications › Home Assistant*.

These endpoints stay; they are independent of the integration.

## Cookidoo

Cookidoo has no public API. The official HA *Cookidoo* integration exposes "My week" as a calendar entity (default `calendar.cookidoo_speiseplan`, events like "Köttbullar mit Pilzsauce" with the description `Total Time: 4200.0` = seconds). Two ways get it into the ToHuus Hub meal plan:

1. **Integration push (recommended).** The ToHuus Hub integration reads the calendar with `calendar.get_events` for the next 14 days and posts the events to `POST /api/ha/v1/cookidoo` – right after start, every 3 hours and whenever the calendar entity changes (unchanged data is not re-sent). No HA token in ToHuus Hub needed. Options: *Send the Cookidoo week to ToHuus Hub* (on by default) and *Cookidoo calendar* (empty = `calendar.cookidoo_speiseplan` as soon as it exists).
2. **Pull with an HA token (alternative).** *Settings › Access & AI › Cookidoo*: HA address, long-lived HA token, calendar entity. ToHuus Hub asks Home Assistant every three hours.

Both run the same import:

- each event becomes a meal plan entry with source `cookidoo`, keyed by date + title (`cookidoo:<date>:<normalised title>`) – sending the same week twice changes nothing;
- the recipe is matched by title; otherwise it is imported from the Cookidoo link in the description (if any) or created as a stub recipe (Thermomix, time from `Total Time`, e.g. `1800.0` → 30 min);
- a changed time updates the stub; a dish that disappeared from Cookidoo is removed from the plan (only future, uncooked Cookidoo entries in the sent range).

```http
POST /api/ha/v1/cookidoo
Authorization: Bearer sw_…            # "Home Assistant" access
{"entity_id": "calendar.cookidoo_speiseplan", "start": "2026-10-10", "end": "2026-10-23",
 "events": [{"date": "2026-10-12", "summary": "Köttbullar mit Pilzsauce", "description": "Total Time: 4200.0"}]}
→ {"events": 1, "added": 1, "updated": 0, "removed": 0, "imported": 0}
```

`date` may also be given as HA's `start` (`"2026-10-12"` or `{"date": …}` / `{"dateTime": …}`).

## Publishing (maintainers)

- `ha-integration/` is the root of the `tillheidrich/tohuus-hub-ha` repository (custom_components, hacs.json, README, info.md, LICENSE, dashboards, tests, CI). Copy it as is; tag releases `v0.1.0` … matching `manifest.json`.
- CI: hassfest, HACS action (brands check ignored until the brands PR is merged), `scripts/validate.py`, pytest (`pytest-homeassistant-custom-component`).
- Brand images: `ha-integration/brands/` + instructions for the `home-assistant/brands` PR; regenerate with `node ha-integration/scripts/render_brand.mjs`.
- HACS default list: after a release and the brands PR, open a PR to `hacs/default` adding `tillheidrich/tohuus-hub-ha` under `integration`.
- `iot_class` is `local_push`: updates arrive over server-sent events, with a 60 s poll as safety net.
