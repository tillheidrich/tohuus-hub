# Dashboards

| File | Cards | Notes |
|---|---|---|
| `tohuus-core.yaml` | built-in only (tile, heading, markdown, to-do list, calendar, picture-entity, glance) | Two views: **Kitchen** (phone/desktop, sections) and **Wall** (landscape tablet, panel). |
| `tohuus-mushroom.yaml` | [Mushroom](https://github.com/piitaya/lovelace-mushroom) via HACS | Same content, denser, with one-tap actions (sofa order, check receipts, backup). |

Paste a file into *Settings › Dashboards › (your dashboard) › ⋮ › Edit dashboard › ⋮ › Raw configuration editor*.

All entity ids are the integration defaults (`sensor.tohuus_hub_…`), the same in every language. If you set up a second ToHuus Hub, its ids end in `_2`.

Notes
- The **Wall** view shows `image.tohuus_hub_display_1` – the first kitchen display from ToHuus Hub › Settings › Displays. Remove that card if you have none, or change the number.
- The recipe photo is the `entity_picture` of `sensor.tohuus_hub_tonight`, so a plain `picture-entity` card shows it. Your browser must be able to reach ToHuus Hub's address for the photo to load.
