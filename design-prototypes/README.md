# ToHuus Hub – Stilprototypen (Phase 2)

Drei gerenderte Stilrichtungen (A–C) und eine Mischung (D) für denselben Inhalt, alle im festen Grün-Schwarz. Unterschiedlich sind Komposition, Typografie und wie viel illustriert wird. Die App (`web/`, `server/`, `site/`) ist unverändert. Erst nach Tills Auswahl geht es weiter mit Phase 3 (Tokens + Pilot „Heute“/„Einkauf“).

Alles ist reines HTML/CSS/SVG plus etwas Vanilla-JS, ohne Build-Schritt. Zum Ansehen den Ordner über einen lokalen Server öffnen (z. B. `python3 -m http.server` im Ordner `design-prototypes/`, dann `index.html`). Über `file://` gehen die Seiten auch, nur die Website-Vorschau in Variante A braucht für das Dark-Theme im iframe einen Server.

## Was drin ist

| Ordner/Datei | Inhalt |
|---|---|
| `a-nordic-editorial/` | `heute.html`, `einkauf.html`, `hero.html`, `style.css` |
| `b-little-house/` | dieselben drei Seiten + `illustrations.js` (alle Zeichnungen als Code) |
| `c-dutch-detail/` | dieselben drei Seiten |
| `d-nordic-dutch/` | dieselben drei Seiten + `brand.js` (Umschalter für Fredirando und die Überschriften-Serif) |
| `shared/base.css` | Reset, fixe Markenpalette, Motion-Tokens, Reduced-Motion, Fokus |
| `shared/fonts.css` | `@font-face` für die lokalen WOFF2 |
| `shared/chrome.js` | Sidebar (ab 1024 px) und Tabbar mit der echten Navigation aus `web/src/App.tsx` |
| `shared/proto.js` | Mikrointeraktionen (WAAPI) und Theme-Umschalter |
| `shared/icons.js` | Pfaddaten der Phosphor-Icons, die die App schon nutzt (MIT) |
| `boards/` | HTML-Quellen der Präsentationsboards |
| `renders/` | alle Renders als WebP (Qualität 82) |
| `fonts/` | WOFF2 (latin + latin-ext) und je eine Lizenzdatei |
| `assets/` | zwei Rezeptfotos aus `server/assets/demo-recipes` mit `CREDITS.md` |

URL-Parameter für alle App-Seiten: `?theme=dark`, `?store=1` (Einkauf im „Im Laden“-Modus), `?motion=reduce`. Nur in D zusätzlich: `?brand=fredirando` und `?serif=bree`.

## Die Varianten

### A – Nordic Editorial
Ruhig und redaktionell. Statt Kartenstapeln gibt es Haarlinien und nummerierte Prioritäten („Heute zuerst“ 1–2–3) und pro Screen genau eine grüne Handlung. Die Einkaufsliste ist eine durchgehende Liste mit Gruppen-Überschriften, ohne Kästen. Illustriert wird kaum: eine feine Linien-Sonne zur Tageszeit und im Hero eine einlinige Skyline aus Wohnung, WG, Reihenhaus und Haus. Neben dem Hero zeigt ein Handy die echte „Heute“-Seite (iframe).
Schrift: Familjen Grotesk für alles Bedienbare, Bree Serif nur für H1, Abschnitts- und Rezepttitel. Icons: Phosphor Light.

### B – Little House
Illustrativ und warm, mit weichen Karten auf Papierkorn. Alle Zeichnungen sind eigene Vektorpfade. Die unperfekte Federlinie entsteht über einen SVG-Filter (`#hd-line`, Turbulenz + Displacement), die Gouache-Flächen über `#hd-wash` (verzerrte Kante + Pigmentkorn). Jede Farbe kommt aus Tokens, deshalb funktionieren die Zeichnungen auch dunkel („Abendlicht“). Es gibt vier Detailgrade:
1. Objekt-Vignetten (Joghurt, Milch, Korb, Tasche)
2. Ort-Kacheln, nur für die konfigurierten Orte: Küchenzeile, Kühlschrank, Regal im Flur, Badschrank
3. Tageszeit-Szene (Fenster am Nachmittag mit Pflanze, Tasse und schlafender Katze)
4. Wohnformen-Ensemble im Hero, als ansteigende Straße: freistehendes Haus mit Baum, drei Reihenhäuser mit Katze auf der Gartenmauer, Laterne, Altbau-WG mit drei Klingeln, Fahrrad und Lichterkette, Mehrfamilienhaus mit Balkonen und Vogel auf dem Dach

Schrift: Familjen Grotesk + Bree Serif. Icons: Phosphor Regular.

### C – Dutch Detail
Grafisch mutiger. Der grüne Kopfblock trägt Kreisflächen und eine Datumskachel in Bogenform, auf der ein kleiner Vogel sitzt. Die Prioritäten stehen auf einem „Ticket“ mit Stanzkerben und Abrisslinie. Das Rezeptfoto ist als Bogenfenster beschnitten, dazu ein Stempel „Alles da“. „Erledigt“ sieht aus wie ein Kassenbon mit Zackenrand. Kategorien werden mit geometrischen Formen markiert (Kreis, Halbkreis, Quadrat, Dreieck), daneben steht immer der Name. Die Navigation ist eine schwarze, schwebende Leiste, auf dem Desktop eine schwarze Sidebar. „Im Laden“ ist ein Segment-Schalter mit gleitendem Indikator. Im Hero stehen vier flache Hauskacheln versetzt nebeneinander, die Katze sitzt auf dem Reihenhausdach.
Schrift: Hedvig Letters Sans nur für Marke und Begrüßung („Moin, Till!“), Hedvig Letters Serif für redaktionelle Titel, Familjen Grotesk für UI und Fließtext. Hedvig gibt es nur in einem Schnitt (400), deshalb taugt sie nicht als UI-Schrift. Familjen hat 400–700 und bleibt auch in langen Listen gut lesbar.

### D – Nordic Dutch (Mischung aus A und C)
Entstanden aus Tills Frage, wie eine Mischung aus Dutch Detail und Nordic Editorial aussähe. Die Basis ist A: Haarlinien statt Kartenstapel, nummerierte Prioritäten, genau eine grüne Handlung pro Screen, viel Luft, helle Tabbar mit Plus als Kontur, helle Sidebar, Familjen Grotesk für alles Bedienbare. Aus C kommen nur vier Signaturen:
1. **Bogenform**: die Datumskachel als Bogen mit dem kleinen Vogel (hier als Kontur, nicht auf grüner Fläche) und das bogenförmig beschnittene Rezeptfoto mit dem Stempel „Alles da“
2. **Ticket** mit Stanzkerben und Abrisslinie für „Heute zuerst“
3. **Kassenbon** mit Zackenrand für „Erledigt“, darunter die Zeile „Abgehakte Produkte sind schon im Bestand.“
4. **Versetzte Hauskacheln** im Website-Hero (Wohnung, WG, Reihenhaus, Haus), nur in Palettenfarben

Weggelassen, weil es C laut macht: der grüne Kopfblock, die schwarze schwebende Navigationsleiste, die schwarze Sidebar, die Formmarker statt Icons, der Segment-Schalter und der Gelbton außerhalb der Palette.

**Überschriften-Serif:** Beide Kandidaten sind gerendert, Hedvig Letters Serif (`d-nordic-dutch-heute-mobile.webp`) und Bree Serif (`d-nordic-dutch-heute-mobile-bree.webp`). Ich empfehle Hedvig Letters Serif. Sie ist feiner und ruhiger als Bree und konkurriert nicht mit der fetten Grotesk der Bedienelemente; so bleibt die Überschrift leise und die Handlung deutlich. Ihre leicht kalligrafische, skandinavische Form passt zu Bogen, Ticket und Stempel. Mit Bree kippen genau diese Details ins Niedliche. Der Preis: Hedvig hat nur einen Schnitt (400) und braucht mindestens rund 20 px. Darum steht sie nur in H1, Abschnitts- und Rezepttiteln, Datum und Hero. Wer es freundlicher will, schaltet mit `?serif=bree` um.

**Fredirando:** Fredirando nutzt dasselbe System, jetzt in Grün statt Orange. Geblieben sind Name, Bildmarke (abgerundetes Haus mit Lieferstrichen, nun auf ToHuus-Grün) und die kleingeschriebene, fette Wortmarke in Familjen Grotesk (`?brand=fredirando`, Renders `d-nordic-dutch-heute-*-fredirando*.webp`).

## Schriften und Lizenzen

Alle Schriften stehen unter der SIL Open Font License 1.1. Bezogen wurden sie über die npm-Pakete von Fontsource. Im Ordner `fonts/` liegen nur die Subsets latin und latin-ext als WOFF2 (zusammen rund 220 KB), es gibt kein Google-Fonts-CDN. Die Lizenztexte stehen in `fonts/LICENSE-*.txt`.

| Schrift | Schnitte | Copyright |
|---|---|---|
| Familjen Grotesk | 400, 500, 600, 700 | 2021 The Familjen Grotesk Project Authors |
| Bree Serif | 400 | 2011 TypeTogether (Reserved Font Names „Bree“, „Bree Serif“) |
| Hedvig Letters Sans | 400 | 2023 The Hedvig Letters Project Authors |
| Hedvig Letters Serif | 400 | 2023 The Hedvig Letters Project Authors |

Getestet mit echtem Text, darunter Umlaute und ß, auf den Boards in der Zeile „Einkaufsliste · Gemeinsam abstimmen · Noch 3 Tage haltbar · Tiefkühlschrank“.

## Tokens

Die Markenpalette ist in allen Varianten gleich (`shared/base.css`):

| Token | Hell | Verwendung |
|---|---|---|
| `--canvas` | `#F7F5EF` | Hintergrund |
| `--surface` | `#FFFDF9` | Karten, Formulare |
| `--ink` | `#181D1A` | Text, Konturen |
| `--ink-2` | `#545C56` | Sekundärtext (6,3 : 1 auf canvas) |
| `--primary` | `#176B50` | Handlungen, aktive Zustände |
| `--primary-dark` | `#104E3C` | Hover, grüne Flächen |
| `--primary-soft` | `#E4EEE6` | aktive Navigation, ruhige Flächen |
| `--sage` / `--sand` | `#A5BAA9` / `#EDE4D5` | Material, Illustration |
| `--clay` | `#C56B4B` | nur Illustrationsakzent und gedrücktes Herz |
| `--warning` | `#9A6400` | „Noch 1 Tag haltbar“ (4,6 : 1), immer mit Text und Icon |
| `--line` | `#DEDCD3` | Trennlinien |

Dark-Themes, eins pro Variante: A „Nordische Nacht“ (`#131614`), B „Abendlicht“, warm (`#17140F`), C „Grünschwarz“ (`#0F1513`). Grün als Text wird dort heller (`#74CDA2`–`#7DCBA6`). Die Buttonfläche ist `#277C5B`, damit Weiß darauf 4,7 : 1 erreicht.

Je Variante verschieden:

| | A | B | C |
|---|---|---|---|
| Radius S/M/L | 6/10/14 | 8/12/18 | 4/6/10 (+ Bögen, Kreise) |
| Tiefe | Haarlinien | weiche, getönte Schatten | Konturen 1,5–2 px, Flächen |
| Icon-Gewicht | Light | Regular | Regular |

Typostufen (alle Varianten): 16 px Fließtext, 14 px Sekundärdaten, 17 px Zeilentitel (im Laden 18), Screen-H1 28 px (Desktop 30–34), Marketing-H1 40 px mobil / 54 px Desktop, Zeilenhöhe 1,5. Pro Screen gibt es höchstens vier Stufen. Fett sind nur Handlungen, Labels und Status.

## Motion

Alles läuft mit CSS und WAAPI aus `shared/proto.js`, ohne Bibliothek. Animiert werden nur `transform` und `opacity`. Easing: `cubic-bezier(.2,.7,.2,1)`.

| Interaktion | Umsetzung | Dauer |
|---|---|---|
| Einkauf abgehakt | Haken wächst (Scale 0,4 → 1,12 → 1), Zeile wird grün hinterlegt und gleitet per FLIP nach „Erledigt“ | 160 ms + 200 ms |
| Artikel hinzufügen | neue Zeile mit 6 px Versatz und Opacity, Kategorie wird grob erraten | 210 ms |
| Rezept-Herz | Scale 1 → 1,22 → 1, Icon wechselt auf gefüllt | 220 ms |
| Button gedrückt | `:active` Scale 0,98 | 110 ms |
| „Im Laden“ (C) | Segment-Indikator gleitet, Liste blendet über | 200 ms / 180 ms |
| Reduced Motion | keine Transforms; Zustände wechseln sofort, nur 120 ms Überblendung | – |

Die Motion-Frames auf den Boards (`*-motion-*.webp`) sind angehaltene Animationen aus der echten Seite (`Animation.currentTime`), keine nachgebauten Grafiken.

## Barrierefreiheit (Stand Prototyp)

- Ein automatischer Kontrastcheck (Playwright, jedes Textelement gegen seinen tatsächlichen Hintergrund, hell und dunkel, 390 und 1280 px) findet keine AA-Verstöße. Er meldet nur einen Fehlalarm: den Segment-Schalter in C, dessen Hintergrund ein Pseudo-Element ist (dort Canvas auf Ink, über 15 : 1).
- Touch-Ziele sind mindestens 44 px, die Checkboxen haben eine 44-px-Trefferfläche. Die Tabbar hält Safe-Area-Abstand.
- Status steht nie nur in Farbe: „Noch 1 Tag haltbar“ hat Text und Uhr-Icon, „steht auf der Liste“ hat Text und Haken. In C kommen Formmarker hinzu.
- Fokus-Ring 2 px in Grün. Checkboxen sind `role="checkbox"` mit `aria-checked`, Illustrationen sind `aria-hidden`, die Hero-Szenen haben eine Beschreibung.

## Bewusst nicht aus den KI-Mockups übernommen

- Keine festen Orte wie „Keller“, „Speisekammer“, „Gefrierschrank“ und keine Gruppe „Tiefkühl“. Der Beispielhaushalt ist eine Wohnung mit Küchenzeile, Kühlschrank, Regal im Flur und Badschrank.
- Keine erfundenen Sternebewertungen wie „★★★★★ (128)“, keine Rezept-Tags wie „Familie/gesund“, keine Zähler, hinter denen keine Daten stehen.
- Keine erfundenen Features oder Wege: „App herunterladen“, App-Store-Buttons, „Preise“, „Kostenlos starten“, „Für Familien“ gibt es nicht. Die CTAs sind die echten: Installieren, Code ansehen (GitHub), Demo ansehen.
- Keine vier gleich lauten KPI-Kacheln. Es gibt einen priorisierten Block mit einem nächsten Schritt.
- Kein grüner Verlauf auf CTAs, keine riesigen Pillen-Buttons, keine Emojis, kein Konfetti.
- Keine handgeschriebenen Randnotizen („Mehr Zeit für das, was zählt“) und keine nachgezeichnete orange Katze im Stil der Mockups. Die Katze in B und C ist eine eigene, sehr kleine Figur.
- Kein Einfamilienhaus als Default. In jeder Variante stehen im Hero vier Wohnformen gleichwertig nebeneinander.
- Navigation wie in der App: Heute, Bestellen, Plus, Einkauf, Mehr. Die Sidebar-Gruppen stammen aus `App.tsx`.

## Offene Punkte für Phase 3

- Copy-Vorschlag: „Rund ums Haus“ → „Rund ums Zuhause“, „Haus & Pflege“ → „Zuhause & Pflege“. In den Prototypen ist er schon umgesetzt, in der App noch nicht.
- Die Mengen pro Ort („23 Produkte“) und „Zuletzt“-Einträge sind Beispieldaten. In der App kommen sie aus der API.
- „Demo ansehen“ zeigt auf einen Anker. Ob es eine öffentliche Demo-Instanz geben soll oder der Link zur Tour-Sektion führt, ist offen.
- Boards: `board-compare.webp` vergleicht A, C und D nebeneinander. Der frühere Vergleich A–B–C liegt als `board-compare-abc.webp` daneben.
- Fredirando im echten Code: Die Orange-Tokens in `web/src/styles.css` (`[data-brand='fredirando']`) und die Logo-Dateien in `web/public/fredirando*` müssen in Phase 3 auf Grün umgestellt werden.
