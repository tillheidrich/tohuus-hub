Fonts used by ToHuus Hub (web app, kiosk displays, e-ink renderer, Home Assistant brand images)

All three families are licensed under the SIL Open Font License 1.1 (no Reserved Font Names declared).
The WOFF2 files are bundled by Vite from the npm packages (pinned in package.json):
  - Familjen Grotesk (variable, wght 400-700)  @fontsource-variable/familjen-grotesk 5.3.0  - UI text
  - Hedvig Letters Sans 400                     @fontsource/hedvig-letters-sans 5.3.0       - brand / greeting
  - Hedvig Letters Serif 400 (24pt optical)     @fontsource/hedvig-letters-serif 5.3.0      - editorial titles
server/assets/fonts holds unmodified TTF conversions of the latin subsets for the server-side PNG renderer
(Pango cannot read WOFF2). Licence texts: OFL-*.txt in this folder and in server/assets/fonts.
