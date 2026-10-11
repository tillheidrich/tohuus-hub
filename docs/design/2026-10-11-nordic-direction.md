# Nordic direction: design rationale (2026-10-11)

Till's brief: ToHuus Hub (app and marketing site) should feel like a well-made Dutch or Scandinavian consumer app. Light and dark mode for everyone, the app has to feel at home on an iPhone, and the brand needs a stronger icon.

This document says what we looked at, what we take from it, what we deliberately leave out, and which tokens are now in the code. It is written so that another person or agent can continue the design without asking.

## What we looked at

We studied the visual language of these brands and products. None of them is copied: no colours, no logos, no illustration styles, no typefaces. They are reference points for attitude.

| Reference | What stands out | Source |
| --- | --- | --- |
| Picnic (NL, groceries) | A friendly, characterful illustration system built around the "milkman" idea: one playful world for icons, spots, vehicles and the app. Friendly, never shouty. | [BUCK: Picnic branding illustrations](https://creativepool.com/buck/projects/picnic-branding-illustrations-for-picnic) |
| Tibber (NO, energy) | Lowercase wordmark, a single small mark, lots of air, photos of real family life with small unexpected details. "Smart and dynamic but warm and approachable." | [Red Dot: Tibber brand identity](https://www.red-dot.org/project/tibber-49426), [Behance: Tibber branding](https://www.behance.com/gallery/43743181/Tibber-Branding) |
| Too Good To Go (DK) | Rebrand aimed at community and all generations; personality defined as "friendly, honest, humble and authentic". | [markt-kom: new look and positioning](https://www.markt-kom.com/en/?p=194260) |
| Mollie (NL, payments) | Two simple geometric shapes as the identity, a clear hierarchy of text, colour and graphic elements, lots of white space. | [Build in Amsterdam: Mollie](https://buildinamsterdam.com/case/mollie) |
| Vipps MobilePay (NO/DK) | One strong brand colour per product, rounded shapes, very plain and direct language. | [Vipps MobilePay design guidelines](https://developer.vippsmobilepay.com/docs/knowledge-base/design-guidelines/) |
| Oda (NO, groceries), bunq (NL), Kry/Livi (SE), Matsmart/Motatos (SE), HEMA (NL), Muji-adjacent Nordic retail, early Spotify | Looked at their apps and stores directly. Common traits: warm off-white instead of pure white, one confident colour, big friendly type for the few things that matter, quiet small type for the rest, generous spacing, rounded but not bubbly shapes. Kry/Livi show how calm a "serious" app can feel. HEMA shows that humour lives in the copy, not in decoration. | Own observation of their public apps and websites (no single source to cite, so we make no claims about their internal systems) |

## What we take

1. **Warm paper, not white.** The background is an oat tone (`--paper #f5f2eb`), cards are a warm white (`#fffdf8`). Pure white only where something must be printed or scanned (QR codes, labels, receipts).
2. **One brand colour with a meaning.** Deep spruce (`--brand #1e5e4b`) is for "do this": primary buttons, the + button, the active tab, focus rings. The status colours (empty, low, expiring, info) stay separate and are only used for status.
3. **A small warm signature.** "Lingon" (`--lingon #d2553c`), the red of a Falun-painted cottage door. It appears in the icon (the door), in illustrations and as the scanner laser, never as a second button colour.
4. **Friendly display type, quiet UI type.** Bricolage Grotesque (variable, with optical sizes) for headings: a little quirky, Nordic-poster feel. Geist for everything else: neutral, very legible at 13 px. Geist Mono for amounts and counts.
5. **Round, pill-shaped controls.** Buttons, search, segmented controls and chips are pills. Cards use 18 px corners, sheets 28 px. Icons in tiles sit on a soft brand tint.
6. **Depth through tone in dark mode.** Light mode uses very diffuse shadows tinted with the ink colour. Dark mode ("polar night", `#0f1513`) uses surface steps and hairlines instead; shadows are nearly invisible there anyway.
7. **Plain words.** No exclamation marks, no "smart", no "seamless". German with natural "du".

## What we deliberately leave out

- Mascots and character illustration (Picnic). It is charming for a delivery brand, but for a household tool used by tired parents it adds noise. Our illustration motif is geometric: the cottage, shelves, a round sun or door.
- Rainbow or multi-colour brand systems (bunq). One colour keeps the app calm.
- Big photo-led layouts (Tibber). We do not have photography and a self-hosted app should not depend on stock imagery.
- Serif display type. Tempting for "warm", but the app is a tool; serifs at small sizes in dark mode read poorly.
- Glass everywhere. Only the tab bar uses blur (it is fixed and small); everything else is solid.

## Icon

A Nordic cottage reduced to three shapes: an A-frame roof stroke, a rounded cabin and an arched door in lingon red. It reads at 16 px, works in one colour, and is clearly a home without being the generic "house" glyph.

- `web/public/icon.svg`: favicon, switches with the browser's light/dark setting.
- `icon-light.svg`, `icon-dark.svg`, `tohuus-logo.svg`, `tohuus-logo-dark.svg`, PNGs 32/192/512/1024, maskable 192/512 (mark at 84 % inside the safe zone), `apple-touch-icon.png` (full-bleed, iOS rounds it).
- Fredirando (family instance, `BRAND=fredirando`) uses the same cottage in its orange with three "speed lines" and a dark door: same family, own personality. Files `fredirando*.svg/png`, served instead of the ToHuus files by `server/index.ts` (`BRAND_FILES`).
- All files are generated from one geometry: `node docs/design/build-icons.mjs`.

## Tokens (web/src/styles.css)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#f5f2eb` | `#0f1513` | page background, sheets |
| `--surface` | `#fffdf8` | `#161e1b` | cards, lists, inputs |
| `--surface-2` | `#eeeae1` | `#1e2824` | sunken areas, segmented controls |
| `--surface-3` | `#e4dfd4` | `#28332e` | skeleton shimmer, deeper wells |
| `--ink` | `#1a2321` (14.4:1 on paper) | `#edefea` (16:1) | text |
| `--ink-2` | `#44504c` (7.5:1) | `#b9c3be` (10:1) | secondary text |
| `--ink-3` | `#5e6965` (5:1) | `#8a9590` (6:1) | muted text, still AA |
| `--line` / `--line-strong` | `#e5e0d6` / `#d2ccbf` | `#232d29` / `#33403a` | hairlines, input borders |
| `--brand` / `--brand-ink` | `#1e5e4b` / `#ffffff` (7.6:1) | `#6fd1a8` / `#0d1a15` (9.7:1) | primary action |
| `--brand-soft` | `#dcebe4` | `#173329` | icon wells, toast action |
| `--lingon` | `#d2553c` | `#ef7a62` | signature accent, illustration only |
| `--accent` / `--accent-ink` / `--accent-soft` | `#1e7458` / `#155c44` / `#ddefe5` | `#5cc79a` / `#8be0bb` / `#153027` | "in stock / all good" |
| `--on-accent` | `#ffffff` | `#0d1a15` | text on accent fills |
| `--empty` / `-soft` | `#b8372a` / `#f9e3de` | `#f28473` / `#3a1d19` | empty, expired, errors |
| `--low` / `-soft` | `#946000` / `#f8edd3` | `#e8b04a` / `#33290f` | running low |
| `--exp` / `-soft` | `#ad4614` / `#fbe6d9` | `#f29a63` / `#3a2316` | expiring soon |
| `--info` / `-soft` | `#2d57b0` / `#e3eaf8` | `#8ea9f2` / `#1b2440` | information |
| `--tint-1…6`, `--tint-ink` | oat, sage, fjord, clay, heather, mist | darker versions | placeholder thumbs, tiles |
| `--hero` | `#17332b` | `#142621` | behind photo cards without photo |
| `--scrim` | ink at 42 % | near-black at 62 % | behind sheets |
| `--r-xs/-sm/-r/-lg/-pill` | 8 / 12 / 18 / 26 / 999 px | | radii |
| `--shadow-sm/-shadow/-shadow-lg` | ink-tinted, diffuse | dark, mostly invisible | elevation |
| `--ease`, `--ease-out`, `--dur-fast/-dur/-dur-slow` | `cubic-bezier(.16,1,.3,1)`, 140/240/380 ms | | motion (transform/opacity only) |
| `--tap` | 44 px | | minimum touch target |

Fredirando overrides paper, surfaces, ink and brand (`#c9480e` light with white text 4.75:1, `#ff7a3d` dark with dark text 7.3:1) under `:root[data-brand='fredirando']`.

All contrast values were checked with the WCAG 2.x formula; every text token passes AA (4.5:1) on `--paper` and `--surface`.

## Type

- Display: Bricolage Grotesque Variable (self-hosted via `@fontsource-variable`, OFL). Kept from before: it already gave the app its character, and its optical-size axis makes big headings tighter and small headings sturdier (`font-variation-settings: 'opsz'`).
- UI: Geist Variable (OFL), 15 px base, 16 px in inputs so iOS never zooms.
- Numbers: Geist Mono, tabular.
- No Google CDN; the marketing site ships its own woff2 files in `site/assets/fonts`.

## Iconography

Phosphor, `regular` weight in lists and buttons, `fill` for the active tab and the current row in "More", `duotone` only for large empty-state art. Icons sit in 36 to 40 px rounded wells (`--brand-soft` for actions, `--surface-2` for navigation). No emojis.

## Light, dark and who decides

- Settings › Household › Appearance: Light, Dark or "Like the device" for everyone (admins). Default: Light.
- Toggle "Let everyone choose for themselves". When on, each member picks their own in Settings › My account (stored per user on the server in `user_prefs`, key `theme`).
- No flash on load: `web/public/theme-boot.js` runs before the first paint. It uses the last choice this device saw (`localStorage sw.theme`), otherwise the household default that the server writes into `<html data-theme-default>`. `web/src/theme.ts` keeps it current after `/api/me` arrives and follows the OS for "Like the device".
- `<meta name="theme-color">` follows `--paper`, the web manifest uses the household theme.
- API: `GET /api/appearance`, `PATCH /api/appearance/household` (admin), `PATCH /api/appearance/me`; `/api/me` includes `appearance`.

## Mobile-native rules

- Tab bar: glass, safe-area padding left/right/bottom, 50 px tall tabs, round + button with a paper ring.
- "More": a grouped list (like iOS Settings) instead of big tiles, so everything fits without scrolling far.
- Sheets: never taller than the visible area (`100dvh` minus the status bar, and above the keyboard via `visualViewport`), internal scroll, sticky header with a round close button, `overscroll-behavior: contain`, slide up from the bottom edge.
- Touch targets at least 44 px on touch devices (`@media (pointer: coarse)`), inputs 16 px, no horizontal page scroll (`overflow-x: clip` on the page).
- Motion uses transform and opacity only; `prefers-reduced-motion` turns it off.
