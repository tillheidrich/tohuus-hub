# ToHuus Hub – Designsystem „Dutch Detail" (Welle 6, 11.10.2026)

Till hat sich für Variante C aus `design-prototypes/` entschieden. Dieses Dokument beschreibt, wie sie in der App umgesetzt ist (Briefing v3, Phase 3 und 5). Es löst `2026-10-11-ikea-direction.md` und `2026-10-11-nordic-direction.md` ab; beide bleiben als Historie liegen.

Kurz gesagt: Grün und Schwarz auf warmem Papier, grafisch und etwas mutiger. Flächen statt Schatten, Konturen von 1,5 bis 2 px, Bögen, Kreise, ein Ticket mit Stanzkerben, ein Kassenbon mit Zackenrand. Es gibt nur eine Marke. Fredirando ist entfallen, die Familieninstanz sieht genauso aus wie jede andere.

## 1. Dateien

| Was | Wo |
|---|---|
| Tokens, Basis, Shell, alle Komponenten | `web/src/styles.css` (eine Token-Schicht, keine Override-Blöcke mehr) |
| Illustrationen, Bildmarke, Vogel, Wohnformen | `web/src/art.tsx` (`BrandMark`, `Bird`, `HomeTile`, `HomeTiles`, `HomeArt`, `EmptyArt`) |
| Shell (Sidebar, schwebende Leiste, Plus- und Mehr-Sheet) | `web/src/App.tsx` |
| Heute | `web/src/pages/Today.tsx` |
| Einkauf | `web/src/pages/Shopping.tsx`, Formmarker in `web/src/shop/sections.tsx` (`SectionShape`) |
| Segment mit gleitendem Indikator | `Seg` in `web/src/ui.tsx` |
| Login | `web/src/pages/Login.tsx` |
| Kiosk und E-Ink | `server/lib/kiosk.ts` (CSS-Tokens und Schriften) |
| App-Icons | `docs/design/build-icons.mjs` → `web/public/icon*`, `favicon-32.png`, `apple-touch-icon*`, `tohuus-logo*.svg`, `site/assets/favicon*` |
| HA-Markenbilder | `ha-integration/scripts/render_brand.mjs` |
| Kontrastprüfung | `node docs/design/check-contrast.mjs` (liest die echten Werte aus `styles.css`, Exit-Code 1 bei Verstoß) |
| Schriftlizenzen | `web/public/fonts/OFL-*.txt` und `README.txt`, dazu dieselben Dateien in `server/assets/fonts/` |

## 2. Farbe

Eine Schicht, hell als Basis, dunkel („Grünschwarz") über `:root[data-theme='dark']`. Alle Komponenten nutzen nur Variablen. Die alten Namen (`--paper`, `--brand`, `--accent`, `--exp`, `--lingon`, `--birch` …) sind **Aliase** auf die neuen Tokens im selben `:root`-Block. So laufen Bereichs-CSS und Inline-Styles anderer Agenten weiter, ohne dass eine zweite Palette existiert. Neue Regeln verwenden die neuen Namen.

| Token | Hell | Dunkel | Verwendung |
|---|---|---|---|
| `--canvas` | `#f7f5ef` | `#0f1513` | Seitenhintergrund (= theme-color, Manifest) |
| `--surface` | `#fffdf9` | `#17201c` | Karten, Felder, Ticket, Bon |
| `--surface-2` / `-3` | `#efebe2` / `#e5dfd3` | `#1e2924` / `#26332d` | Mulden, Skeleton |
| `--ink` | `#181d1a` | `#eef0ea` | Text, Konturen |
| `--ink-2` | `#545c56` | `#b3bdb6` | Sekundärtext |
| `--ink-3` | `#626a64` | `#939e97` | Platzhalter, leise Zusätze |
| `--line` | `#dedcd3` | `#28332e` | Trennlinien (nicht für Bedienelemente) |
| `--line-strong` | `#7e7d74` | `#6e7a73` | Ränder von Bedienelementen (≥ 3:1) |
| `--primary` | `#176b50` | `#277c5b` | Handlungen, aktive Zustände (Fläche) |
| `--primary-dark` | `#104e3c` | `#20684c` | Hover, grüne Flächen |
| `--primary-soft` | `#e4eee6` | `#1c3229` | ruhige Grünflächen, Stempel |
| `--primary-text` | `#176b50` | `#74cda2` | Grün als **Text** (Links, „steht auf der Liste") |
| `--on-primary` | `#fffdf9` | `#f7f5ef` | Text auf Grün |
| `--sage` / `--sage-soft` | `#a5baa9` / `#cfdcd1` | `#50665a` / `#273a30` | Material, Kacheln |
| `--sand` | `#ede4d5` | `#2e2a22` | warme Flächen, Icon-Mulden |
| `--clay` | `#c56b4b` | `#e08a68` | nur Illustration und gedrücktes Herz, **nie** CTA |
| `--mustard` | `#e8b865` | `#d9a94f` | kleiner Akzent: Tür, Vogel, Sonne, Badges in der Sidebar |
| `--warning` (+`-soft`) | `#926000` | `#e4b05a` | „bald verbrauchen" |
| `--low` (+`-soft`) | `#a04b2b` | `#e89a78` | „wird knapp" |
| `--empty` (+`-soft`) | `#9e2f24` | `#f08a7a` | „alle", „nicht mehr essen" |
| `--info` (+`-soft`) | `#2f5e7a` | `#8fb6d4` | Hinweise |
| `--block` / `--block-disc` | `#104e3c` / `#2c7a5f` | `#134a3a` / `#1f6a50` | grüner Kopfblock mit Kreis |
| `--rail` / `--on-rail` / `--rail-2` | `#181d1a` / `#f7f5ef` / `#b9c0ba` | `#e9ece5` / `#131916` / `#3d4741` | schwebende Leiste, Sidebar (im Dunkeln hell, wie im Prototyp) |
| `--tint-1…6`, `--tint-ink` | Palettenflächen | dunkle Pendants | Platzhalter-Thumbs, Türen, Kacheln |

Gegenüber dem Briefing ist `warning` leicht abgedunkelt (`#9A6400` → `#926000`). Erst damit erreicht der Text auf `warning-soft` 4,5:1. `line-strong` und alle Dark-Werte sind ergänzt. Der Check deckt 36 Paare pro Theme ab, alle bestehen AA.

Regel: Status steht nie nur in Farbe. Jede Statusanzeige hat Text **und** einen Formmarker: Halbkreis = bald verbrauchen, gefülltes Quadrat = alle, Dreieck = knapp, Kreis = ok. Er sitzt in `.badge::before`, `.sdot` und den Ticket-Markern `.mk`.

## 3. Typografie

| Rolle | Schrift | Wo |
|---|---|---|
| UI, Fließtext, Zahlen | **Familjen Grotesk** variabel (400–700), `--font` | alles Bedienbare, Listen, Buttons |
| Marke, Begrüßung | **Hedvig Letters Sans** 400, `--brand-font` | Wortmarke „ToHuus", „Guten Abend, Till!" |
| Redaktionelle Titel | **Hedvig Letters Serif** 400 (24pt), `--display` | H1, H2, Rezepttitel, Datum, Empty-State-Titel, große Zahlen |
| Code | System-Monospace, `--mono` | nur Tokens, URLs, Code-Vorschauen |

- Pakete exakt gepinnt (`--save-exact`): `@fontsource-variable/familjen-grotesk@5.3.0`, `@fontsource/hedvig-letters-sans@5.3.0` und `@fontsource/hedvig-letters-serif@5.3.0` (5.3.1 war zu frisch). Geist, Geist Mono und Bricolage sind deinstalliert.
- `font-synthesis: none` gilt global, damit Hedvig und Serif nie ein Fake-Bold bekommen. Hedvig nur ab etwa 20 px einsetzen.
- Tabellenziffern (`tabular-nums`) sind global gesetzt. Für Mengen braucht es daher keine Mono-Schrift mehr.
- Skala (Tokens `--fs-*`): 16 Fließtext, 14 sekundär, 17 Zeilentitel (im Laden 18), 20 kleine Titel, 22 H2, 28 H1 (Desktop 32), Begrüßung 30/34, Login-Hero 50. Zeilenhöhe 1,5, Schritte im Rezept 1,6. Pro Screen höchstens vier Stufen. Fett nur für Handlungen, Labels und Status.
- `.eyebrow` (13 px, Versalien, +0,08 em), optional `.label-sq` mit dem kleinen schwarzen Quadrat davor („■ HEUTE ZUERST").
- Kiosk-Seite: dieselben Schriften aus dem Vite-Build. E-Ink-PNG und HA-Wortmarke: Pango kann kein WOFF2 lesen (auch Geist fiel vorher still auf Systemschrift zurück). Deshalb liegen unveränderte TTF-Konvertierungen der latin-Subsets in `server/assets/fonts/` (OFL, keine Reserved Font Names).

## 4. Raum, Radius, Tiefe

- Abstände im 4-px-Raster (`--sp-1` bis `--sp-10`). Seitenrand mobil 16 px plus Safe Area, Desktop 32/40 px.
- Radien bewusst klein: `--r-xs` 4 (Badges, Checkbox), `--r-sm` 6 (Buttons, Felder, Chips), `--r` 10 (Karten, Ticket, Listen), `--r-lg` 14 (Sheets, Leiste). Pillen nur noch für Avatare und Punkte. Die Signatur sind **Bögen** (`999px 999px 6px 6px`): Rezeptfotos, Thumbs groß, Türen, Datumskachel, Scanner.
- Tiefe: flach mit Konturen (`--stroke` 1,5 px, `--stroke-2` 2 px). Schatten nur für Schwebendes (`--shadow-float`: Leiste, Toasts, Checkout-Leiste; `--shadow-lg`: Sheets). Keine Verläufe auf CTAs. Erlaubte Verläufe: Foto-Scrims, Masken (Ticket-Kerben, Zackenrand), Halbkreis-Marker.

## 5. Komponenten

| Baustein | Klasse | Kurz |
|---|---|---|
| Button | `.btn` | Kontur 1,5 px Tinte, transparent. `.primary` grün, `.ghost` ohne Kontur, `.danger` rot konturiert, `.sm` / `.lg` / `.block`. Pfeil-Schwanz: `<span class="tail">` |
| Icon-Button | `.icon-btn` | 40/44 px, Kontur `line-strong`, `.plain` ohne |
| Feld | `.input` | 48 px, 1,5 px `line-strong`, Fokus: Tinte plus 3-px-Ring in `primary-soft`. Hauptfeld im Einkauf: `.add-field` mit 2 px Tinte |
| Chip | `.chip` | eckig (6 px), `.on` = Tinte gefüllt |
| Segment | `Seg` / `.seg` | Kontur Tinte. Ein Tinten-Indikator (`.seg-ind`) gleitet unter die aktive Option. Ohne Messung fällt es auf eine Füllung zurück |
| Toggle | `.toggle` | eckiger Lichtschalter 44×26 |
| Checkbox | `.check` | 26 px, 2 px Tinte. `.on`: grün, Haken wächst |
| Badge | `.badge.<status>` | 22 px, 4 px Radius, Formmarker davor |
| Liste | `.list` / `.li` | Fläche plus Haarlinien, Zeilentitel 17/500 |
| Gruppenkopf | `.group-h` | Formmarker plus Name plus Anzahl, darunter 1,5 px Tinte |
| Ticket | `.ticket` | Kontur Tinte, Stanzkerben per Maske auf Höhe der Abrisslinie `.tear`, ein Nächster-Schritt-Button `.next` |
| Kassenbon | `.receipt` | Zackenrand oben und unten, Titel in Serif, gestrichelte Trennlinien. Für „Erledigt" und „Im Korb" |
| Stempel | `.stamp` | gedrehter Kreis mit gestricheltem Innenring („Alles da"). Nur bei echter Datenlage |
| Bogenfoto | `.arch`, `.rcard .img`, `.recipe-hero` | Foto im Bogen |
| Tür | `.door` | Bogen-Kachel für Orte (nur Desktop auf Heute) |
| Sheet | `.sheet` | Papier, Kopf mit 1,5 px Tinte, mobil von unten, Desktop zentriert |
| Toast | `.toast` | Tinte, Undo-Knopf konturiert |
| Leere Zustände | `Empty` (`.empty-state`) | Zeichnung `art` oder Bogen-Icon, Titel in Serif, genau eine Aktion |
| Laden | `.skel` | ruhiges Pulsieren statt Shimmer-Verlauf |

### Shell
- Mobil: eine **schwarze, schwebende Leiste** (12 px Abstand, Safe Area) mit Heute, Bestellen, grünem Plus, Einkauf und Mehr. Der aktive Tab bekommt einen grünen Punkt, Zähler sitzen als helle Kreise auf der Leiste. Unten bleiben mindestens 40 px Luft, damit nichts verschluckt wird.
- Desktop ab 960 px: **schwarze Sidebar** (im Dunkeln hell) mit Bildmarke und Hedvig-Wortmarke, Suche „Wo finde ich …?", gruppierter Navigation (Gruppentitel in Versalien), Senf-Badges, grünem „Hinzufügen" und Person plus Haushalt im Fuß.
- Inhalte blenden beim Routenwechsel einmal ein (`.page-fade`, 200 ms, nur Opacity). Das gestaffelte Einblenden mit 550 ms ist entfallen.

### Heute
1. Grüner Kopfblock (`.day-block`) mit Kreis und Senf-Halbkreis, Begrüßung in Hedvig Sans, darunter eine Zusammenfassung aus echten Zahlen. Die Datumskachel ist ein Bogen mit Vogel, der beim ersten Anzeigen einmal landet.
2. **Ticket „Heute zuerst"** statt der vier KPI-Kacheln. Höchstens vier Zeilen, aus echten Daten priorisiert: abgelaufen und bald verbrauchen (mit „Eins verbraucht"), alle oder knapp (mit „Auf die Liste" oder „steht auf der Liste"), Einkaufsliste mit Claims („Lea holt 2 · 1 hat noch niemand"). Dazu „Alle n" und **genau ein** nächster Schritt: Einkaufsliste öffnen, Bestand ansehen, typische Vorräte anlegen oder Was kochen wir?.
3. Rezeptvorschlag: Foto im Bogen. Der Stempel „Alles da" erscheint nur, wenn `missing.length === 0`. „Es fehlt nur X" erscheint nur bei genau einer fehlenden Zutat, sonst steht dort „have/need zu Hause". Zwei Alternativen als Zeilen.
4. Danach, leiser: Suche (mobil), Party-, Urlaubs- und Kinderwunsch-Banner, Bestellungen und Importe, Boxen, Start-Hinweis, Pflege, „Für heute eingeplant", „Eure Orte" als Türen (nur Desktop), „Zuletzt".
5. Desktop: zwei Spalten (Block, Ticket und Rest links, Rezept rechts sticky). `WhatToEatHero` und `FreshToday` sind von Heute entfernt, weil sie Ticket und Rezept doppelten. Auf `/kochen` bleiben sie verfügbar.

### Einkauf
- Kopf: Serif-H1, Zähler als Tintenkreis, Segment „Liste | Im Laden". Hinzufügen-Feld mit 2 px Tinte plus grünes Quadrat. „Beim Abhaken einräumen" ist eine schlichte Zeile mit Toggle.
- Gruppen mit Formmarkern (Kreis, Bogen, Halbkreis, Raute, Quadrat, Dreieck …) plus Name. Die Zeilen liegen ohne Kasten direkt auf dem Papier.
- Claims: Avatar mit Tintenkontur, sonst eine leise Taste „Ich hol's". Desktop ab 1100 px: Seitenpanel „Wer holt was" mit Kacheln.
- „Erledigt" ist ein Kassenbon, darunter steht „Abgehakte Produkte sind schon im Bestand.", solange Einräumen an ist. Teilen und Bon sitzen leise unter der Liste.
- Im Laden: größere Zeilen (72 px, 18 px), Hinweis „Nach Gängen sortiert · klappt auch ohne Netz", Korb als Bon, Checkout-Leiste mit Tintenkontur.

## 6. Bewegung

Nur `transform` und `opacity`, Easing `--ease-out` = `cubic-bezier(.2,.7,.2,1)`, keine Bibliothek.

| Interaktion | Umsetzung | Dauer |
|---|---|---|
| Einkauf abgehakt | Haken wächst sofort (Scale 0,4 → 1), Zeile wird `primary-soft` und wandert nach 170 ms in den Bon | 160 ms + 170 ms |
| Artikel hinzufügen | `.row-in`: 6 px Versatz plus Opacity, nur für **neue** Zeilen (`useSeen`) | 210 ms |
| Kategorie und Segment | Indikator gleitet (`.seg-ind`) | 200 ms |
| Navigation | `.page-fade`, nur Opacity | 200 ms |
| Button gedrückt | `scale(0.98)` | 110 ms |
| Herz (Rezept) | `.heart-on` / `.fav.on`: einmal auf 1,22 und Ton | 220 ms |
| Stempel | einmal „aufgedrückt" | 360 ms |
| Vogel auf dem Datum | landet einmal | 620 ms |
| Leere Liste | Zeichnung setzt sich einmal zusammen | ≤ 600 ms |
| Einkauf fertig (Checkout) | volle Tasche, einmal, nur nach echtem Abschluss | 560 ms |
| Sheets | mobil von unten, Desktop leichtes Pop | 320 / 200 ms |

`prefers-reduced-motion: reduce`: Alle Animationen und Übergänge laufen in 0,01 ms. Das Abhaken wechselt sofort ohne Verzögerung, die Tasche entfällt. Die Zustände bleiben trotzdem sichtbar (Farbe, Haken, Bon). Es gibt keine Dauerschleifen außer dem Scanner-Laser und dem Skeleton-Puls während des Ladens.

## 7. Illustrationen

- Sprache: flache geometrische Formen (Bogen, Kreis, Halbkreis, Quadrat), nur Palettenfarben über CSS-Klassen (`.f-p`, `.f-pd`, `.f-ps`, `.f-s`, `.f-g`, `.f-m`, `.f-c`, `.f-k`, `.f-w`), gelegentlich eine Tintenkontur (`.s-k15`, `.s-k2`, `.s-k3`). Dadurch funktionieren alle Zeichnungen auch dunkel.
- Detailgrade: (1) Bildmarke und Vogel, (2) Empty-State-Szenen (Liste, Regal mit Pflanze, Buch, Bon, Box, Haus mit Haken, Kalender, Koffer, Tasche), (3) Wohnform-Kacheln, (4) Ensemble aus vier Wohnformen (`HomeTiles`, versetzt).
- **Zuhause, nicht Haus:** Das feste zweistöckige `HouseArt` ist gelöscht. `HomeArt({ preset })` zeigt das gewählte Preset (Wohnung, WG, Reihenhaus, Haus). Ohne Preset zeigt es eine Pflanze auf einem Regal. Es werden keine Räume oder Geräte erfunden. `EmptyArt name="fridge"` zeigt eine neutrale Vorratsbox.
- Figuren sparsam: die Katze sitzt nur auf dem Reihenhaus, der Vogel nur auf dem Datum. Echte Fotos bei Rezepten haben Vorrang.
- Alles ist `aria-hidden`. Das Ensemble hat einen beschreibenden `aria-label`.

## 8. App-Icon

Eine grüne Kachel (`#176b50`), darin das ToHuus-Haus in Papierfarbe mit Bogentür in Senf und eine Viertelscheibe in `--block-disc` unten rechts, wie im Kopfblock. Dunkel: grünschwarze Kachel mit mintgrünem Haus. Maskable mit 80 % Skalierung. Neu erzeugen mit `node docs/design/build-icons.mjs`, HA-Bilder mit `node ha-integration/scripts/render_brand.mjs` (Wortmarke in Hedvig Letters Sans).

## 9. Do / Don't

**Do**
- Neue Regeln mit den neuen Tokens schreiben (`--canvas`, `--primary`, `--primary-text`, `--warning` …), Status immer als Text plus Form.
- Eine grüne Handlung pro Bereich, alles andere konturiert oder ghost.
- Serif nur für Titel ab 20 px, alles Bedienbare in Familjen.
- Bögen und Kreise als Signatur nutzen, Radien sonst klein halten.
- Leere, ladende und fehlerhafte Zustände mit `Empty` und `Skeleton` bauen, mit genau einer Aktion.
- Bereichs-CSS am Ende von `styles.css` unter `/* ---------- <bereich> ---------- */` anhängen, nur mit Tokens.

**Don't**
- Keine neue Override-Schicht über bestehende Regeln legen, sondern die Regel selbst ändern.
- Keine Pillen-Buttons, keine Verläufe auf Flächen oder CTAs, keine weichen Kartenschatten.
- `--clay` und `--mustard` nie als Handlungsfarbe verwenden.
- Kein `font-weight` über 700, kein Fake-Bold auf Hedvig.
- Keine KPI-Kachelreihen, keine erfundenen Zahlen, keine Stempel oder „Es fehlt nur …" ohne Daten.
- Kein Kühlschrank, Keller oder Einfamilienhaus als Default-Illustration.
- Keine Animation während der Dateneingabe, keine Dauerschleifen, nichts, was die Bedienung verzögert.

## 10. Prüfung (Stand dieses Commits)

- Screenshots aller Hauptrouten (Heute, Einkauf, Bestand, Produkt, Kochen, Rezept, Wo ist was, Abgleich, Pflege, Urlaub, Ausgaben, Importe, Erkennung, Lieblinge, Bestellen, Bar, Etiketten, Einstellungen, Hilfe, Teilen, Scan) bei 375, 390, 430, 768, 1280 und 1440 px, hell und dunkel. Kein horizontaler Overflow (per Playwright gemessen: `scrollWidth - innerWidth`). Dazu Login hell und dunkel mobil und Desktop, Kiosk 1280 und 768, E-Ink-PNG.
- `node docs/design/check-contrast.mjs`: alle Paare AA.
- `npx tsc -p . --noEmit` und `npx vitest run` grün. `test/brand.test.ts` und `test/print.test.ts` sind auf „eine Marke" umgestellt.

## 11. Offen

- Tablet (768–959 px) nutzt noch das Mobil-Layout mit der schwebenden Leiste. Heute wäre dort zweispaltig möglich.
- Gast-Seite (`/g/…`), Party-Board und Kinder-Modus haben nur die Token-Umstellung bekommen. Der Kinder-Modus behält bewusst seine eigene, kindgerechte Palette.
- `OrderMenu` in `Guest.tsx` trägt noch den toten Parameter `fredi` (immer `false`). Das gehört zur Logik des Fixes-Agenten und kann dort entfernt werden. Ebenso `fredi()` in `server/lib/tickets.ts` (ist immer `false`).
- Marketing-Website (Phase 6): Die Favicons sind schon neu, Hero und Paletten in `site/` noch nicht.

## 12. Nachtrag 12.10.2026: fünf Tabs (Plan `docs/plan-2026-10-12.md`)

- **Tab-Leiste mobil ist weiß** (Tills Vorgabe): volle Breite unten, `--surface`, Haarlinie oben plus weicher Schatten, Icons in `--ink-2`, aktiver Tab grün (`--primary-text`, gefülltes Icon in einer `--primary-soft`-Pille, Label fett). Dunkel: dieselbe Leiste auf der dunklen Fläche. Zähler sitzen als Tintenkreise am Icon. Die schwarze schwebende Leiste und das grüne Plus darin sind entfallen.
- **Tabs:** Heute · Einkauf · Vorrat · Kochen · Geld. Alles andere unter `/mehr` (Avatar im Heute-Kopf, Desktop: Abschnitt „Mehr“ in der Sidebar). „+“ sitzt als Icon-Button im Heute-Kopf und als „Hinzufügen“ in der Sidebar.
- **Sidebar Desktop** ist jetzt hell (`--surface`, Haarlinie rechts), aktiver Eintrag grün gefüllt.
- **Assistent:** schwebende Taste rechts über der Tab-Leiste, Tinte mit grünem Mikrofon und „Sprechen“, `--r-lg`, `--shadow-float`.
- **Heute:** kein grüner Kopfblock und kein Ticket mehr, sondern höchstens fünf ruhige Karten (`.hcard`: Fläche, 1 px Linie, Formmarker vor dem Titel), ab 1100 px zweispaltig (`columns: 2`).
- **Geld:** Balken in einer Farbe (`--primary`), Werte als Text in Tinte daneben, Wochenverlauf als 2-px-Linie mit Hover/Fokus und einer Tabelle für Screenreader.
- Tap-Ziele: `.icon-btn` ist jetzt 44 × 44 px.
