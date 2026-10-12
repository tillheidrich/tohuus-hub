# UI layout audit (`scripts/ui-audit.mjs`)

A Playwright sweep over the web app that finds text running out of its box, labels lying on icons and things
sticking out of the screen. It visits every route of `web/src/App.tsx`, every "Mehr" entry, every settings tab
and the main sheets (Plus, Sprechen, item editor, new product, recipe import, plan entry, plan meal), at
390×844, 768×1024 and 1280×800 in light and dark, plus once at 390 with a 20 px browser text size (the
Dynamic Type equivalent – the app sizes all type in `rem`). Every view gets a screenshot (`*.png` as seen,
`*.full.png` the whole page without the floating bars). **Look at the screenshots** – the checks catch the
common faults, not everything (a scrim that is too light, a heading that wraps badly).

## Run it

Playwright is not a dependency of the repo. Install it in a scratch folder and point `NODE_PATH` at it:

```sh
mkdir -p /tmp/pw && (cd /tmp/pw && npm init -y >/dev/null && npm i playwright)
npm run build
# cloud mode with a fresh household + demo data (the script signs up by itself when the server allows it)
MULTI_TENANT=true TOHUUS_MASTER_KEY=$(openssl rand -base64 32) BASE_URL=http://localhost:8711 \
  DATA_DIR=$(mktemp -d) PORT=8711 node dist/server.mjs &
NODE_PATH=/tmp/pw/node_modules node scripts/ui-audit.mjs http://localhost:8711 --out /tmp/ui-audit
```

Self-hosted: pass the admin from the first-start log, `--email Admin --password …`. Chromium is taken from
`/opt/pw-browsers` when it exists, otherwise from `PW_CHROMIUM` or Playwright's own download.

Options: `--only /einkauf,sheet:add` (prefix match), `--viewports 390x844`, `--themes light`, `--no-large`,
`--large-only`, `--no-dialogs`, `--strict` (exit 1 on any finding, e.g. for CI). Output: `report.md`,
`report.json` and the screenshots in `--out`.

Before the sweep it closes the setup, skips the tour, loads the demo household (`POST /api/tour/demo`),
types a short list into Bons (so the receipt review has a page) and sets the appearance to "wie das Gerät",
so the dark run follows the browser's colour scheme.

## What it reports

| kind | meaning |
|---|---|
| `overflow` | an element with its own text is wider inside than outside while overflow is visible – the text runs out |
| `sticks-out` | a child box reaches past its parent (a button wider than its card, a badge past its column) |
| `clipped` | text cut by `overflow: hidden` without „…" – also when `text-overflow: ellipsis` sits on a flex/grid box, where it never works |
| `offscreen` | something reaches past the left/right screen edge (not inside a scroll row, not cut by a clipping parent), or the page scrolls sideways |
| `icon-overlap` | text drawn on an icon inside the same button/row, or a count badge covering more than a corner of its icon |
| `wrap-under` | a button label that continues underneath its icon |
| `covered` | at the end of the page a control is still under the floating "Sprechen" button or the tab bar |
| `not-reached` | a sheet could not be opened (selector changed, or the demo has nothing to open – e.g. no planned meal) |

Ignore an element on purpose with `data-audit-ignore`. Rows that scroll sideways (`overflow-x: auto`) are
expected to reach past the screen and are not reported.

## Rules the fixes follow (keep them when adding UI)

- Type in `rem` (or the `--fs-*` tokens). `html` is `font-size: 100%`, so the browser/OS text size applies;
  the in-app text size (`listPrefs.fontScale`) multiplies on top.
- Flex/grid children that hold text get `min-width: 0` (`.grow`, `.row > b/span`); icons `flex-shrink: 0`.
- Long German words: `hyphens: auto` (from `lang="de"`, only words of 10+ letters) and `overflow-wrap:
  break-word` are global. Use `overflow-wrap: anywhere` only in fixed narrow columns (it also shrinks the
  min-content width, so a whole flex item may collapse). Headless Chromium on Linux has no hyphenation
  dictionary – screenshots show hard breaks where phones show a hyphen.
- One-line text with „…" needs a *block* box (`display: block`, `white-space: nowrap`, `overflow: hidden`,
  `text-overflow: ellipsis`); on `display: flex` the ellipsis never shows. Otherwise let it wrap.
- `.btn` and `.badge` wrap a long label inside (min-height, no fixed height). Use `.chips` for a row that
  scrolls; it fades at the screen edge on phones.
