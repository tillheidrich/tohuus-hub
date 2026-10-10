# Home Assistant

ToHuus Hub talks to Home Assistant in three ways. Use the first; the others exist for special cases.

| Way | What | When |
|---|---|---|
| **Integration** (HACS) | Native entities, actions, events, live updates | Always, if you can install from HACS |
| YAML package | REST sensors, `rest_command`, webhook push automation | No HACS, or you want the actionable iOS push from the package |
| Outbound (ToHuus Hub → HA) | Cookidoo week plan from an HA calendar; optional sync with an HA to-do list; notification webhook | Cookidoo only exists in HA; the to-do sync and webhook are superseded by the integration |

The integration lives in its own repository: **[tillheidrich/tohuus-hub-ha](https://github.com/tillheidrich/tohuus-hub-ha)** (source in this repo under [`ha-integration/`](../ha-integration/), MIT licence for HACS friendliness).

## Set up the integration

1. Home Assistant › HACS › ⋮ › *Custom repositories* › `https://github.com/tillheidrich/tohuus-hub-ha`, type *Integration*. Download **ToHuus Hub**, restart Home Assistant.
2. ToHuus Hub › *Settings › Access & AI › New access* › **Home Assistant** › *Generate*. Copy the token (`sw_…`, shown once).
3. Home Assistant › *Settings › Devices & services › Add integration › ToHuus Hub*: address (as Home Assistant reaches it, e.g. `http://192.168.1.20:8080`) and token.

A "Home Assistant" token can only call `/api/ha/*` and `/api/events` – nothing else in the API, no MCP.

**Options** (*Configure*): features on/off (to-do, calendars, display images, buttons, event entity – sensors are always on), live updates on/off, display image colours (`color` / `gray` / `bw`) and size. Switching a feature off removes its entities.

**Re-authentication:** if the token is revoked, Home Assistant asks for a new one. *Reconfigure* changes the address.

## Entities

One device "ToHuus Hub" per ToHuus Hub instance (model = household name). Entity ids are fixed English ids so dashboards work in every language; a second ToHuus Hub gets `_2`. Names are translated (English, German, Swedish).

| Entity | State | Attributes |
|---|---|---|
| `todo.tohuus_hub_shopping_list` | open items | – (to-do items: summary, status, description = "2× · note") |
| `calendar.tohuus_hub_meal_plan` | on while today has a planned meal | next meal: `recipe_id`, `slot`, `image_url` |
| `calendar.tohuus_hub_care_tasks` | on on the next due day | – |
| `sensor.tohuus_hub_tonight` | title of tonight's planned meal, else today's best suggestion | `source` (`plan`/`idea`), `recipe_id`, `slot`, `cooked`, `url`, `image_url`, `reasons`, `tomorrow`; entity picture = recipe photo |
| `sensor.tohuus_hub_products_low` | count | `items` [{id, name, status, qty, qty_text, unit, best_before, image_url}] |
| `sensor.tohuus_hub_products_empty` | count | `items` |
| `sensor.tohuus_hub_expiring_soon` | count (best before soon or past) | `items` |
| `sensor.tohuus_hub_eat_first` | count | `items` [{name, kind (`product`/`leftover`), use_by, days_left, qty, unit, opened}], `leftovers` |
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
| GET | `/api/ha/v1/state` | everything above in one call: `counts`, `low`, `empty`, `expiring`, `shopping`, `todo`, `orders`, `care` {due, next}, `eat_first`, `tonight`, `tomorrow`, `next_meal`, `party`, `kid_wishes`, `displays` |
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

Cookidoo has no public API. The official HA *Cookidoo* integration exposes "My week" as a calendar; ToHuus Hub reads it every three hours (*Settings › Access & AI › Cookidoo*: HA address, long-lived HA token, calendar entity, default `calendar.cookidoo_speiseplan`). This direction (ToHuus Hub → HA) is separate from the integration.

## Publishing (maintainers)

- `ha-integration/` is the root of the `tillheidrich/tohuus-hub-ha` repository (custom_components, hacs.json, README, info.md, LICENSE, dashboards, tests, CI). Copy it as is; tag releases `v0.1.0` … matching `manifest.json`.
- CI: hassfest, HACS action (brands check ignored until the brands PR is merged), `scripts/validate.py`, pytest (`pytest-homeassistant-custom-component`).
- Brand images: `ha-integration/brands/` + instructions for the `home-assistant/brands` PR; regenerate with `node ha-integration/scripts/render_brand.mjs`.
- HACS default list: after a release and the brands PR, open a PR to `hacs/default` adding `tillheidrich/tohuus-hub-ha` under `integration`.
- `iot_class` is `local_push`: updates arrive over server-sent events, with a 60 s poll as safety net.
