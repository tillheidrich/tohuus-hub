# Functional direction, inspired by IKEA ("Birch & Spruce", 2026-10-11)

Till's feedback after the Nordic pass: "Die Marketingseite sah schöner aus, als das Haus noch da war – dreh alles vom Design her mehr in Richtung IKEA – bitte auch bei der App selbst."

This document supersedes the token values of `2026-10-11-nordic-direction.md` (that file still explains the icon geometry, the appearance settings and the mobile-native rules, which all stay). It says what we took from IKEA's design language, what we deliberately left out, and which tokens are in the code now. It is written so another person or agent can continue without asking.

## What we looked at

| Topic | What we found | Source |
| --- | --- | --- |
| Typography | IKEA used a Futura-based "IKEA Sans" for about 50 years, switched to Verdana in 2009 (Ikea Sans lacked Asian scripts) and moved to Noto Sans in 2019 for global language coverage. The logo is a customised Futura-like wordmark. Noto Sans is OFL licensed. | [It's Nice That: Ikea swaps its typeface to Noto](https://www.itsnicethat.com/news/ikea-changes-typeface-to-noto-monotype-google-graphic-design-210819), [Made Good Designs: IKEA font](https://madegooddesigns.com/ikea-font/), [SitePoint: the Verdana "font fiasco"](https://www.sitepoint.com/ikea-and-the-font-fiasco/) |
| Democratic Design | Five dimensions: form, function, quality, sustainability, low price, "for the many people". | [IKEA Museum: Democratic Design](https://ikeamuseum.com/en/explore/the-story-of-ikea/democratic-design/), [IKEA: Democratic design](https://www.ikea.com/ph/en/this-is-ikea/about-us/democratic-design-how-ikea-designs-for-everyone-pub5991eac0/) |
| Assembly instructions | Wordless black line drawings, grey only to highlight; each drawing shows the product at that stage instead of an exploded view; steps ordered for an "early success"; a picture of the finished product and a parts/tool list first; after a 1999 review, fewer focal points per drawing and smaller steps. | [Justin Zhuang: Wordless Instructions](https://justinzhuang.com/posts/wordless-instructions/), [Cadasio: designing assembly instructions without words](https://www.cadasio.com/post/designing-assembly-instructions-without-words) |
| Retail and catalogue (own observation) | Products photographed on plain light backgrounds, big bold sans headlines, generous white space, prices on flat tags, numbered info-graphics, pill buttons on the website. | Own observation of ikea.com and printed catalogues; no claims about internal guidelines. |

## What we take

1. **Function first, one clear hierarchy.** Bold headings, quiet body, one primary action per view. Flat surfaces with crisp 1 px lines; shadows only for things that really float (sheets, toasts, the phone frame on the site).
2. **One strong primary plus a warm wood neutral.** Spruce (`--brand #0b6148`) is the only action colour. Birch (`--birch #ead9bb`, `--birch-soft #f4ead8`) is the friendly neutral for wells, tags and illustration fills. Lingon red stays as the small signature (the front door).
3. **Bold clear sans, self-hosted, OFL.** We keep **Geist** (already bundled via `@fontsource-variable/geist`, OFL) and drop the quirky Bricolage display face: Geist at 750 to 800 weight gives the bold, neutral neo-grotesque feel of IKEA's Noto without adding a dependency or looking like IKEA's own font. Geist Mono stays for amounts.
4. **Price tags for counts and status.** `.badge` is now a tag: pointed left edge with a punched hole. Status tags (empty, expiring, low) are solid fills with `--on-status` text, everything else birch. The site uses the same tag for the hero facts and the two notes.
5. **Assembly-manual drawings.** One ink stroke weight, flat token fills, a numbered callout, a green arrow where it explains the step. Used for the site hero house, the house in the app (Today header, onboarding, tour start) and the main empty states.
6. **Plain-background product imagery.** On the site every phone sits on a plain birch plate, like a product shot.
7. **Instructional numbering.** Site chapters carry step numbers in ink squares, install steps are numbered boxes, the hero has a "parts list" whose numbers match the callouts in the drawing.

## What we leave out (no IKEA trade dress)

- No blue and yellow brand pair, no yellow price tags, no IKEA logo shapes or wordmark proportions.
- No Swedish product-name gimmick, no IKEA font files (Noto Sans IKEA is not used; Geist is ours).
- No copied illustrations or pictograms: the house and empty-state drawings are drawn from scratch in our own geometry.
- No wordless UI: we only borrow the drawing style, the app still explains in plain words.

## The house (site hero and app)

- Site: `site/src/house.mjs` (successor of the removed `build_house.py` / `house.svg.tpl`) generates a terraced gable house in cross-section. `node site/src/build.mjs` inlines it into the hero (colours from CSS classes, so light and dark follow the page theme) and writes standalone `site/assets/img/house-light.svg` and `house-dark.svg`.
- Inclusive by design: no cellar, no stairs, no chest freezer. Rooms: kitchen (fridge, wall cupboard, counter with a pot), hallway (lingon front door, coat hook, chest of drawers), bathroom (mirror cabinet, basin), living room (sofa, shelf, TV), attic shelf with labelled boxes; neighbours are only hinted.
- Numbered callouts 1 to 4 match the parts list under the drawing ("What ToHuus Hub knows about your home"). Hovering or focusing a list item highlights its number (site.js). Callouts pop in once, steam drifts; both are off with reduced motion.
- App: `web/src/art.tsx` exports `HouseArt` (small version of the same house) and `EmptyArt` (`list`, `shelf`, `book`, `receipt`, `fridge`, `done`, `calendar`, `suitcase`). `Empty` in `ui.tsx` takes `art="…"`; without it the old icon well is shown.

## Tokens (web/src/styles.css, mirrored in site/assets/site.css)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#f6f3ed` | `#111413` | page, sheets |
| `--surface` | `#ffffff` | `#191d1b` | cards, lists, inputs |
| `--surface-2` / `-3` | `#efe9de` / `#e4dccd` | `#212624` / `#2b312e` | wells, segmented controls |
| `--ink` | `#121715` (16.4:1 on paper) | `#f3f1ec` (16.4:1) | text |
| `--ink-2` | `#3c4542` (8.9:1) | `#c0c6c2` (10.7:1) | secondary text |
| `--ink-3` | `#5a6360` (5.6:1, 5.1:1 on surface-2) | `#8f9894` (6.3:1) | muted text |
| `--line` | `#ddd6c9` | `#2a302d` | hairlines |
| `--line-strong` | `#8f8676` (3.6:1 on white) | `#6a746f` (3.5:1) | input, chip and control borders (3:1 UI rule) |
| `--brand` / `--brand-ink` | `#0b6148` / `#ffffff` (7.5:1) | `#5fd0a0` / `#0b1a14` (9.4:1) | the one action colour |
| `--brand-soft` | `#d9ece3` | `#17342a` | glass in drawings, soft wells |
| `--lingon` | `#d4482f` | `#f07a62` | signature: door, illustration only |
| `--birch` / `--birch-soft` / `--birch-ink` | `#ead9bb` / `#f4ead8` / `#6e5230` (5.2:1 on birch) | `#3d3427` / `#2a251d` / `#e6d2ae` | wood neutral: tags, wells, drawing fills |
| `--empty`, `--low`, `--exp` | unchanged | unchanged | status; as solid tags with `--on-status` (white 5.3 to 5.8:1 light, `#111413` 7.3 to 9.5:1 dark) |
| `--shadow-sm` / `--shadow` | none / hairline | none | flat by default |
| `--shadow-lg` | ink-tinted, diffuse | dark | sheets, toasts only |
| `--r-xs/-sm/-r/-lg/-pill` | 6 / 10 / 14 / 20 / 999 px | | squarer than before; pills only for buttons, search, filter chips |
| `--font`, `--display` | Geist Variable | | one family; headings 750 to 800, tracking -0.035em |

Fredirando keeps its orange (`#c9480e` light with white text 4.75:1, `#ff7a3d` dark) as the one primary; its birch is warmed towards apricot (`#f1d9bd`). Overrides live under `:root[data-brand='fredirando']`.

Component overrides (headings, buttons, tags, glance tiles, tab bar, sheets, drawings) are in the block `/* ---------- ikea … */` at the end of `web/src/styles.css`; the earlier Nordic blocks are left untouched underneath.

## Icons

`node docs/design/build-icons.mjs` now draws the same cottage geometry on a **flat** field, no gradient or glow: ToHuus light = spruce tile, birch-white house, lingon door; dark = charcoal tile, mint house. Fredirando light = orange tile, white house, dark door, speed lines; dark = near-black tile, orange house. File names unchanged. `node ha-integration/scripts/render_brand.mjs` regenerates the Home Assistant brand images (wordmark now Geist 800 in spruce).

## Before and after

- App: same layouts, but headings are heavier, cards are flat white on birch-white with 1 px lines, status counts read as price tags, Today's glance tiles are tinted by status, the + button is a flat disc, the house sits in the Today header, and empty states explain themselves with a small drawing.
- Site: the phone-centred hero is replaced by the drawn house with its parts list and two tag notes; the Today screenshot moved into the "Everyday" chapter next to the shopping list; nav is a plain bar; chapters are numbered; phones sit on plain plates.
