# Help article slugs (app ↔ website)

The app links small "So geht's" hints to help articles on the website:

```
https://tohuus.heidrich-digital.de/hilfe/<slug>.html
```

This file is the contract between the app (branch `b-recipes` and later) and the website (`site/`, branch `b-ha-site`).
The website builds one page per slug below; the app only links slugs listed here. Add new slugs at the end of the
table, never rename one (old app versions keep linking it). German is the page language; titles are suggestions.

The web app keeps the same list in `web/src/help.ts` (`HELP_SLUGS`) – a test checks that both lists match.

| Slug | Title (DE) | What the article explains | Linked from (app) |
|---|---|---|---|
| `erste-schritte` | Erste Schritte | Wer gehört dazu, die fünf Bereiche, was ToHuus von allein mitbekommt | Tour, "So funktioniert ToHuus" |
| `so-funktioniert-tohuus` | So funktioniert ToHuus | How it remembers (receipts, ticks, rhythm), where every row comes from, suggestions instead of automation | Mehr › So funktioniert ToHuus |
| `einkaufsliste` | Die Einkaufsliste | One shared list, shop mode, origin of each row, undo | Einkauf |
| `merkt-sich` | Was ToHuus sich merkt | Purchase rhythm, "Das habt ihr noch", dismissing suggestions, no stock keeping needed | Heute, Einkauf |
| `kassenbons` | Kassenbons einlesen | REWE eBon, PDF, photo, paper receipts, what is read and what is left out | Geld, Imports |
| `vorrat` | Vorrat (optional) | Stock is optional, photo of fridge/cupboard, best-before estimates | Vorrat |
| `kochen` | Kochen mit dem, was da ist | Cook ideas, week plan, house note, cook mode, servings | Kochen |
| `rezepte-importieren` | Rezepte übernehmen | Link, photo, screenshot, social media share, other apps | Kochen › Rezepte |
| `rezeptpaket` | Das ToHuus-Rezeptpaket | ZIP/JSON format, prompt for your own AI, export and round trip | Kochen › Rezepte › Rezeptpaket |
| `cookidoo` | Cookidoo-Rezepte | Link + ingredient list only, cooking happens in Cookidoo | Kochen › Rezepte |
| `geld` | Geld: Lebensmittel und Haushalt | Month overview, per shop/category, price changes, budget | Geld |
| `sprechen` | Sprechen | The assistant, voice, what it can do per screen, confirm and undo | every "Sprechen" button |
| `ki-an-oder-aus` | Mit oder ohne KI | What works without AI, what AI adds, which model, what is sent, quotas | Mehr › So funktioniert ToHuus, settings |
| `hausinfo` | Hausinfo für Gäste und Babysitter | Cards for voice commands, routines, tips, emergency; templates | Mehr › Hausinfo |
| `hausinfo-codes` | Codes sicher teilen | Codes are secrets: who sees them, expiry, access log, never to AI | Hausinfo › Codes |
| `babysitter` | Babysitter-Link | Sitter link, printable sheet, offline reading | Hausinfo, Unterwegs |
| `gaeste` | Gäste und Rechte | Guest levels, guest links, what guests see | Mehr › Gäste |
| `haushalt-teilen` | Haushalt teilen | Members, invites, two households | Mehr › Leute |
| `wer-sieht-was` | Wer sieht was? | What other members see, private and discreet items, per-person things | "So funktioniert ToHuus" |
| `daten-export` | Deine Daten mitnehmen | Export, recipe package, deleting the household | Mehr › Daten |
| `home-assistant` | Home Assistant | Integration, voice list, sitter instructions | Mehr › Home Assistant |
| `gut-zu-wissen` | Gut zu wissen | The facts section and its sources | Mehr › Gut zu wissen |
