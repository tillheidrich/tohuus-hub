# Changelog

## 0.2.0 – 2026-10-11

- **Two-way bridge** ("What does Home Assistant already do for you?"): reports to-do lists, calendars, people, notify services and voice-exposed devices to ToHuus Hub, sends snapshots of the lists and calendars ToHuus Hub watches, and runs the operations it gets back (to-do add / update / remove, calendar create / delete, notify) with acknowledgements. Shopping list ⇄ Bring! / shopping list / Todoist, meal plan ⇄ Mealie / local calendars, due care tasks → a to-do list, notifications through the companion app per member. Needs ToHuus Hub with `/api/ha/v1/bridge/sync` (October 2026); older servers are detected and left alone.
- **NFC tags**: `tag_scanned` is forwarded to ToHuus Hub, which runs the quick action mapped to the tag; the result is fired as `tohuus_hub_tag`.
- New option *Two-way sync with ToHuus Hub* (on by default).
- Diagnostics show the bridge state.

## 0.1.0 – 2026-10-10

- First release: shopping list as to-do, meal plan and care calendars, sensors, buttons, display images, notification events, actions, Cookidoo week push, live updates.
