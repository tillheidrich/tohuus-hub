# Changelog

## 0.3.0 – 2026-10-12

- **Connect with a code**: the config flow asks *ToHuus Cloud* (`https://cloud.tohuus.heidrich-digital.de`) or *Own server*; the code from ToHuus (*Settings › Home Assistant › Connect Home Assistant*, 10 minutes, single use) is exchanged for a "Home Assistant" access at `POST /api/ha/pair/claim`. Tokens still work (*Token instead of code*). Re-authentication and reconfigure accept a code too.
- **New sensors**: *Due to buy* (purchase rhythm suggestions), *Spent this month* and *Spent this week* (monetary, budget as attributes). Only created when the server sends them.
- **Who leads** per topic as select entities (shopping list, meal plan, care: both / Home Assistant / ToHuus / off), `POST /api/ha/v1/bridge/leader`.
- **Notifications to notify services**: choose services and kinds in the options; ToHuus notifications arriving over the live stream are passed on (with a tap-to-open link for the companion app).
- Diagnostics redact addresses, household name and notify service names as well.
- Translations: German, English, Swedish. Brand images rendered from the app icon.
- CI split into `hassfest.yml`, `hacs.yml` and `tests.yml`; tests pinned via `requirements_test.txt`.

## 0.2.0 – 2026-10-11

- **Two-way bridge** ("What does Home Assistant already do for you?"): reports to-do lists, calendars, people, notify services and voice-exposed devices to ToHuus Hub, sends snapshots of the lists and calendars ToHuus Hub watches, and runs the operations it gets back (to-do add / update / remove, calendar create / delete, notify) with acknowledgements. Shopping list ⇄ Bring! / shopping list / Todoist, meal plan ⇄ Mealie / local calendars, due care tasks → a to-do list, notifications through the companion app per member. Needs ToHuus Hub with `/api/ha/v1/bridge/sync` (October 2026); older servers are detected and left alone.
- **NFC tags**: `tag_scanned` is forwarded to ToHuus Hub, which runs the quick action mapped to the tag; the result is fired as `tohuus_hub_tag`.
- New option *Two-way sync with ToHuus Hub* (on by default).
- Diagnostics show the bridge state.

## 0.1.0 – 2026-10-10

- First release: shopping list as to-do, meal plan and care calendars, sensors, buttons, display images, notification events, actions, Cookidoo week push, live updates.
