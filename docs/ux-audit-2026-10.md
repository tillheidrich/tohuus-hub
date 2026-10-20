# UX-Audit Oktober 2026: Informationsarchitektur, Parität, Plan

Stand 20.10.2026 (Commit `6d77da3`, Build 21). Nur Analyse, kein Code geändert. Auftrag von Till: „Stell generell die
ganze UI und UX der App nochmal in Frage und optimiere sie – so dass alles logisch und gut zu finden ist und den User
nicht überfordert.“ Ergänzung: Web und Self-Host müssen funktional gleichwertig zur iOS-App sein.

Leitplanke für alles unten: Till hat ADHS. Die App muss **ohne Tagesform** funktionieren. Das heißt konkret: jede
Funktion hat **genau einen Namen und einen Hauptort**, der erste Bildschirm jeder Seite zeigt das Wichtigste, nichts
Wichtiges liegt unter dem dritten Bildschirm, und eine Seite bietet nicht mehr als eine Hauptaktion an.

## Methode und Belege

- **Web:** `dist/` vom 20.10. (12:53) lokal gestartet, Cloud-Modus (`MULTI_TENANT=true`, Haushalt „Familie Berg“ mit
  Beispieldaten und `scripts/audit-shared.mjs › seed`) auf Port 8744 und Self-Host (`MULTI_TENANT=false`, Admin aus
  dem Startlog) auf Port 8745. Durchgeklickt mit Playwright (Chrome) in **390×844** (Touch, 2x) und **1280×800**.
  Server danach gestoppt.
- **Screenshots** (Tills Mac): `/tmp/ux-audit/shots/<route>--phone.png` bzw. `--desk.png`, ganze Seite als
  `*.full.png`; zusammengesetzte Langseiten in `/tmp/ux-audit/tiles/*.png`; Self-Host in `/tmp/ux-audit/shots-self/`.
  Seitenhöhen (in Bildschirmhöhen) in `/tmp/ux-audit/shots/texts.json`.
- **iOS:** kein Build (Plattenplatz); Analyse aus dem SwiftUI-Code (`ios/ToHuus/App/MainTabView.swift`,
  `Features/Settings/SettingsView.swift`, `Features/Household/HouseholdLinks.swift`, `Features/Today/TodayView.swift`,
  `Features/Home/HomeView.swift`, `Features/Search/GlobalSearchView.swift`, `Features/Help/AppTourView.swift`,
  `Features/Start/FirstRunView.swift`) und `Localizable.xcstrings`.
- Bestehende Doku gelesen: `docs/navigation.md`, `docs/now.md`, `docs/focus.md`, `docs/search.md`,
  `docs/ios-parity-2026-10-13.md`, `docs/ui-audit.md`, `CLAUDE.md`.
- Skills: ui-ux-design-pro (Hick/Miller/Progressive Disclosure als Prüfmaßstab), webapp-testing, till-stimme
  (Textvorschläge im App-Ton: du-Form, ruhig, ohne Werbesprache).

## Kurzfassung

**Top-10-Befunde**

1. **P0 · Web-Handy: „Mehr“ ist nur über den Avatar auf *Heute* erreichbar.** Auf Einkauf, Kochen, Aufgaben, Vorrat
   gibt es weder Avatar noch Lupe (iOS hat beides auf jedem Tab, `RootChrome.swift`). Wer in Einkauf ist und Geld,
   Leute oder Einstellungen sucht, muss erst zurück auf Heute und dort einen unbeschrifteten Kreis antippen.
2. **P0 · Heute ist zu voll und widerspricht sich.** Versprochen sind „höchstens fünf ruhige Karten“
   (`Today.tsx:41`), tatsächlich stehen bis zu **17 Blöcke** untereinander (der Slot „tasks“ allein bündelt neun
   Karten, `Today.tsx:151–160`). Handy: 3,5 Bildschirmhöhen. Darin zwei komplette Eingabeformulare („Was habt ihr
   heute gelöst?“, „Im Kopf“ mit Datum und Sichtbarkeit) und am Ende „Für heute ist alles Wichtige erledigt“, obwohl
   darüber 4 Sachen auf der Liste und 3 ablaufende Lebensmittel stehen.
3. **P0 · „Mein Konto“ ist 7,8 Bildschirme lang, der Haushalts-Tab 6.** Darin liegen die ADHS-Schalter („Sanfter
   Modus“, „Nur eins“, Aufgaben-Höchstzahl, Timer) auf Bildschirm 3, Kalender, Passkeys, Familien-Tablet-PIN und
   Teilen-Anleitung gemischt. Die Einstellungs-Reiter (12 Stück) scrollen seitlich aus dem Bild.
4. **P1 · Ein Ding, drei Namen.** Wissen / Was ToHuus sich merkt / Haushaltswissen / Gedächtnis; Vorrat / Bestand /
   „Produkte im Haus“; Leute / Mitglieder / People; Jetzt / Nur eins / Eins nach dem anderen / Ruhe & Fokus / Fokus;
   „Haushalt“ ist zugleich Gruppe und Einstellungs-Zeile; „Fällig“ heißt auf Heute „Kaufrhythmus“, in Aufgaben
   „Termin“; „Bons“ sind Kassenbons *und* Drucker-Zettel.
5. **P1 · Aufgaben-Seite versteckt fünf eigene Werkzeuge ganz unten.** Wer hat was im Blick, Denkarbeit-Check,
   Für wen ich da bin, Im Kopf, Wochenrückblick folgen nach ~35 Vorschlägen und Ratgeber-Artikeln (5,7 Bildschirme).
6. **P1 · Hausinfo und Urlaub hängen als Tür an *Aufgaben*, Wünsche als Geschenk-Symbol an *Einkauf*.** Logisch
   gehören WLAN-Code und Müllplan nicht zu Aufgaben; das Geschenk-Symbol hat keinen Text und sitzt neben „Aa“.
7. **P1 · Parität: Mehr ist auf iOS und Web unterschiedlich gebaut** (iOS ~35 Zeilen in 8 Abschnitten inkl.
   Rechtliches und Konto löschen, Web ~22 Zeilen in 5 Gruppen), Begriffe weichen ab („Mitteilungen“ vs.
   „Benachrichtigungen“, „Plan & Speicher“ vs. „Abo & Speicher“, „Mit oder ohne KI“ vs. „Zugänge & KI“,
   „Haushaltseinstellungen“ vs. „Haushalt“), und die Such-Register der beiden Clients enthalten verschiedene Funktionen.
8. **P1 · Ersteinrichtung ist auf iOS und Web verschieden** (iOS 8 Schritte: wer, was nutzt ihr, kochen, Läden,
   Liste, Rundgang, einladen, fertig; Web 6 Schritte: Zuhause, wo, Orte, Plätze, einladen, Vorrat). Die Tour (6
   Seiten) erklärt die Leiste, aber **nicht, wo „Mehr“ ist**, und nennt nur vier der fünf Standard-Tabs.
9. **P1 · Self-Host startet auf Englisch**, obwohl der Browser `de-DE` meldet (`/api/instance` → `lang: "en"`),
   und Englisch zeigt andere Bereichsnamen („Treats“, „Cook“ vs. iOS „Cooking“).
10. **P2 · Wiederholungen und Doppel-Einstiege:** „Deine Leiste“ dreimal in Mehr/Konto (Zeile, Knopf am Ende,
    Karte in Mein Konto) plus Langdruck; „Darstellung“ und „Passwort ändern“ in *Haushalt* und *Mein Konto*;
    dasselbe Rezept bis zu viermal auf der Kochen-Startseite; das Hand-Symbol steht für „Bring mir was“ (Leiste,
    Mehr) und für „Ich hol’s“ (jede Einkaufszeile).

**Ziel-Architektur in 10 Zeilen**

1. Leiste unten (Standard, max. 5): **Heute · Einkauf · Kochen · Aufgaben · Zuhause**; „Deine Leiste“ bleibt.
2. **Zuhause** (statt Vorrat) bündelt: Vorrat, Wo ist was?, Hausinfo, Wissen. Ein Bereich für „was bei uns ist und
   was man darüber wissen muss“.
3. **Mehr** ist auf jedem Root-Screen oben rechts (Avatar) erreichbar, auf iOS *und* Web, plus Lupe.
4. Mehr hat genau vier Gruppen: **Alltag** (Geld, Bring mir was, Wünsche, Urlaub & Übergabe) · **Familie & Gäste**
   (Leute, Gäste, Für wen ich da bin) · **Kopf & Fairness** (Im Kopf, Wer hat was im Blick, Denkarbeit-Check,
   Wochenrückblick) · **Einstellungen & Hilfe** (eine Zeile „Einstellungen“, eine Zeile „Hilfe“).
5. Einstellungen: 6 Seiten statt 12 Reiter: Ich · Haushalt · Bereiche & Orte · Mitteilungen & Kalender ·
   Verbindungen & Geräte · Daten, Abo & Konto. Jede Seite höchstens 2 Bildschirme, Unterseiten statt Riesenkarten.
6. „Ruhe & Fokus“ wird eine eigene, oberste Einstellungs-Zeile unter „Ich“ (Sanfter Modus, Nur eins, Höchstzahl, Timer).
7. Heute: Kopf + höchstens **4 Karten** in fester Reihenfolge (Jetzt dran · Liste · Bald verbrauchen · Heute kochen),
   je max. 3 Zeilen; alles andere (Check-in, Im Kopf, Geld, Wochenfrage, Fakten) wandert in die Bereiche oder als
   *eine* rotierende Hinweis-Zeile ganz unten. „Alles erledigt“ nur, wenn wirklich nichts mehr da ist.
8. Ein Glossar, ein Wort pro Ding, DE und EN, gilt für Leiste, Mehr, Suche, Hilfe, Tour, Assistent (Abschnitt 6).
9. Ein gemeinsames Funktions-Register (JSON im Repo) speist Mehr, Suche und Hilfe auf iOS und Web gleich.
10. Eine Ersteinrichtung (5 Schritte) und eine Tour (5 Karten) auf beiden Plattformen, Self-Host übernimmt die
    Browsersprache.

**Pakete (je iOS + Web gleichzeitig):** A Navigation & Mehr · B Heute entschlacken · C Einstellungen neu ordnen ·
D Begriffe & Register · E Bereichsseiten aufräumen (Aufgaben, Einkauf, Kochen, Zuhause) + Onboarding/Tour. Details in
Abschnitt 7.

## 1. Informationsarchitektur heute

### 1.1 Bereiche und ihre Einstiege

Tippzahl = Taps vom jeweils *anderen* Tab aus (Handy, Standardleiste, kein „Deine Leiste“). „+S“ = danach scrollen,
Zahl = Bildschirmhöhen.

| Bereich / Funktion | Web-Route | iOS-Screen | Hauptort heute | Weitere Einstiege | Taps Web | Taps iOS |
|---|---|---|---|---|---|---|
| Heute | `/` | `TodayView` | Tab 1 | – | 1 | 1 |
| Einkauf | `/einkauf` | `ShoppingView` | Tab 2 | Heute › Liste, Plus-Knopf | 1 | 1 |
| Kochen | `/kochen` | `CookingView` | Tab 3 | Heute › Heute kochen? | 1 | 1 |
| Aufgaben | `/aufgaben` | `TasksAreaView` | Tab 4 | Heute › Aufgaben heute | 1 | 1 |
| Vorrat | `/bestand` | `StockAreaView` | Tab 5 | Heute › Das habt ihr noch | 1 | 1 |
| Geld | `/geld` | `MoneyView` (Sheet) | Mehr, 1. Zeile | Heute › Geld-Karte | 3 (Heute, Avatar, Zeile) | 2 (Avatar, Zeile) |
| Wünsche | `/einkauf/wuensche` | `WishesView` | Geschenk-Symbol oben in Einkauf (ohne Text) | Suche (nur iOS) | 2 | 2 |
| Hausinfo | `/hausinfo` | `HouseGuideView` | Tür-Chip oben in **Aufgaben** | Suche | 2 | 2 |
| Urlaub / unterwegs, Übergabe | `/urlaub` | `AwayView` | Tür-Chip oben in **Aufgaben**; Karte im Einstellungs-Tab Haushalt | Suche (nur iOS) | 2 | 2 |
| Wo ist was? | `/wo` | `FindView` | Tür-Chip oben in Vorrat | Suche (nein) | 2 | 2 |
| Wissen („Was ToHuus sich merkt“) | `/wissen` | `KnowledgeView` | Mehr › Haushalt | Leiste wählbar | 3 | 2 |
| Bring mir was | `/bestellen` | `TreatsView` | Mehr › Haushalt | Heute-Karte (nur wenn offen), Leiste wählbar | 3 | 2 |
| Gäste (Links, Party) | `/bar` | `GuestLinksView` | Mehr › Haushalt | – | 3 | 2 |
| Leute / Mitglieder | `/einstellungen?tab=members` | `HouseholdView` | Mehr › Haushalt („Leute“) | Einstellungs-Reiter „Mitglieder“ | 3 | 2 |
| Eins nach dem anderen | `/fokus` | `FocusView` | Knopf oben in Aufgaben | Heute › Aufgaben heute › Link | 2 | 2 |
| Nur eins | (Modus auf Heute) | `OneThingTodayView` | Chip auf Heute › Aufgaben heute (nur ≥ 3 offene) | Mein Konto › Ruhe & Fokus (+S 3) | 1–4 | 1–3 |
| Im Kopf | `/kopf` | `MindViews` | Heute-Karte mit Formular | Aufgaben ganz unten (+S 5) | 1 | 1 |
| Wer hat was im Blick | `/aufgaben` (Abschnitt) | `WhoDoesWhatViews` | Aufgaben Mitte (+S 2) | – | 1+S | 1+S |
| Denkarbeit-Check | `/denkarbeit` | `LoadCardsView` | Aufgaben Mitte (+S 2) | Suche | 2+S | 2+S |
| Für wen ich da bin | `/fuer-wen` | `CareForViews` | Aufgaben ganz unten (+S 5) | Heute-Hinweis | 2+S | 2+S |
| Wochenrückblick | `/woche` | `WeekReviewViews` | Aufgaben ganz unten (+S 5) | Heute-Teaser (So/Mo) | 2+S | 2+S |
| Bons & Importe | `/import` | `ImportsListView` | Heute › Fällig (leer), Einkauf › „Bon“, Geld › Einkäufe | Suche | 2–3 | 2–3 |
| QR-Etiketten | `/etiketten` | `LabelsView` | Mehr › Geräte; Knopf „Etiketten“ oben in **Aufgaben** | Suche | 2 | 2 |
| Deine Leiste | `/leiste` | `NavBarSettingsView` | Langdruck auf Leiste | Mehr › Deine Leiste, Mehr › „Leiste anpassen“, Mein Konto-Karte | 1 (Langdruck) / 3 | 1 / 2 |
| Einstellungen | `/einstellungen?tab=…` | Zeilen in Mehr (Sheet) | Mehr › Einstellungen (9 Zeilen) | Desktop-Seitenleiste | 3 | 2 |
| Ruhe & Fokus (Sanfter Modus) | `?tab=account` | `MyAccountView`? / Suche → account | Mein Konto, Bildschirm 3 | Suche „adhs“ | 4+S | 3+S |
| Was nutzt ihr? (Bereiche an/aus) | `?tab=home` | Haushaltseinstellungen | Haushalt-Tab, Bildschirm 3 | – | 4+S | 3+S |
| Kalender & Erinnerungen | `?tab=account` (3 Karten) + Aufgaben unten | `CalDavView` | Mein Konto (Web) / Mehr › Geräte (iOS) | Aufgaben-Fuß | 4+S | 2 |
| Tour starten | Kopf der Einstellungen | Mehr › Hilfe | – | – | 4 | 3 |
| Küchenmodus | **im Web kein Gegenstück unter diesem Namen** (nächstes: Kochmodus je Rezept, Displays) | `KitchenModeView` | iOS: Symbol (Pfanne) in der Kochen-Toolbar, iPad-Seitenleiste | Deep-Link `kitchen` | – | 2 |

### 1.2 Einstiege im Überblick

- **Leiste unten** (Handy): Heute, Einkauf, Kochen, Aufgaben, Vorrat; Geld weicht (`nav.tsx:barTabs`,
  `MainTabView.swift:defaultBarAreas`). Kein „Mehr“-Tab: Mehr hängt am Avatar.
- **Avatar oben rechts**: iOS auf jedem Root-Screen (`RootChrome.swift`), Web-Handy **nur auf Heute**
  (`Today.tsx:108`), Web-Desktop unten in der Seitenleiste (`App.tsx:318`).
- **Lupe**: iOS jeder Root-Screen; Web-Handy nur Heute und Mehr; Desktop Seitenleiste + ⌘K.
- **Türen** (Chips über dem Seitenkopf): Aufgaben → Hausinfo, Urlaub; Vorrat → Wo ist was? (`home/HomeSwitch.tsx`,
  `HomeView.swift`). Einkauf → Wünsche als Symbol (`Shopping.tsx:434`).
- **Mehr** (Web `pages/More.tsx` + `nav.tsx:moreGroups`; iOS `SettingsView` + `MoreSections`).
- **Heute-Karten** verlinken in Einkauf, Kochen, Vorrat, Geld, Bring mir was, Im Kopf, Fokus.
- **Einstellungen**: Web eine Seite mit 12 Reitern; iOS einzelne Zeilen direkt in Mehr.
- **Suche**: Web `search/GlobalSearch.tsx:34` (Register mit 21 Einträgen + Mehr-Zeilen), iOS
  `GlobalSearchView.swift:188` (Register mit ~34 Einträgen). Inhalte vom Server (`/api/search`).
- **Assistent** (runder Knopf unten rechts) als Querweg für alles Gesprochene.

### 1.3 Doppelte Wege (gleiche Funktion, mehrere Orte, teils anders benannt)

| Funktion | Orte |
|---|---|
| Deine Leiste | Langdruck · Mehr › Einstellungen › „Deine Leiste“ · Mehr-Fuß „Leiste anpassen“ · Mein Konto-Karte |
| Darstellung (Hell/Dunkel) | Einstellungen › Haushalt *und* Einstellungen › Mein Konto |
| Passwort ändern | Einstellungen › Haushalt („Mein Passwort ändern“) *und* Mein Konto › Passwort |
| Kalender | Mein Konto (3 Karten: „Euren Kalender lesen“, „ToHuus in Apple Erinnerungen“, „Kalender-Abo“) *und* Aufgaben-Fuß *und* (iOS) Mehr › Geräte |
| Im Kopf | Heute-Karte (mit Formular) *und* `/kopf` *und* Aufgaben-Fuß |
| Bon/Import | Heute › Fällig · Einkauf › „Bon“ · Geld › Einkäufe · Plus-Knopf |
| Mein Konto | Mehr-Kopf „Mein Konto“ (Knopf) *und* Mehr › Einstellungen › „Mein Konto“ (Zeile) |
| Abmelden | Mehr-Fuß *und* Kopf der Einstellungs-Seite (Web) |
| Hilfe | Mehr › Hilfe (3 Zeilen) *und* Einstellungs-Kopf *und* „So geht’s“ am Fuß jeder Seite |
| Gerichte | Kochen: „Daraus könnt ihr heute kochen“, „Geht sofort“, „Schnell“, „Ideen durchblättern“ zeigen dasselbe Rezept bis zu 4× |

### 1.4 Versteckte Funktionen

- Mehr auf Web-Handy außerhalb von Heute (siehe P0-1).
- Wünsche: nur ein Geschenk-Symbol ohne Text in Einkauf, nicht in Mehr, nicht im Web-Such-Register.
- Fünf Kopf-/Fairness-Werkzeuge am Ende der Aufgaben-Seite (P1-3).
- Ruhe & Fokus / Sanfter Modus / Nur eins: Bildschirm 3 von „Mein Konto“.
- Was nutzt ihr?: Bildschirm 3 des Haushalt-Reiters.
- Einstellungs-Reiter 6–12 (Mitteilungen … Daten) außerhalb des sichtbaren Bereichs der Reiterleiste (Handy).
- Küchenmodus: iOS nur als Pfannen-Symbol in der Kochen-Toolbar (dort stehen mit Lupe und Avatar **fünf** Symbole: Plus-Menü, Herz, Pfanne, Lupe, Avatar; „Rezept-Werkzeuge“ und „Rezepte entdecken“ stecken im Plus-Menü, `CookingView.swift:126–143`). Im Web gibt es keinen Küchenmodus unter diesem Namen (Kochmodus je Rezept und „Displays“ sind etwas anderes) – Parität klären.
- „Beim Abhaken einräumen“ (Schalter mitten auf der Einkaufsliste) ist eine Einstellung im Inhalt.
- Vorrat-Kopf: zwei Symbol-Knöpfe ohne Text (Klemmbrett = Abgleich?, Regler = Filter/Ansicht?).

### 1.5 Menüpunkte hinter „…“ und Symbolen ohne Text

- Einkaufszeile: „…“ öffnet den Artikel-Editor; daneben das Hand-Symbol „Ich hol’s“ (Text auf dem Handy ausgeblendet).
- Einkauf-Kopf: „Aa“ (Listen-Ansicht), Geschenk (Wünsche) – beide ohne Text.
- Vorrat-Kopf: zwei Symbole ohne Text.
- Heute-Kopf: Plus, Lupe, Avatar ohne Text (Avatar = Mehr ist nicht erkennbar).

### 1.6 Uneinheitliche Begriffe (DE und EN)

| Ding | Varianten heute (Ort) |
|---|---|
| Vorrat | „Vorrat“ (Tab), „Bestand“ (Route `/bestand`, Einkauf: „landen direkt im Bestand“, Einstellungen: „Alles im Bestand wird verfolgt“), „51 Produkte im Haus“ (Kopf), EN „Pantry“, Id `stock` |
| Wissen | „Wissen“ (Leiste), „Was ToHuus sich merkt“ (Mehr, Seitentitel), „Euer Haushaltsgedächtnis“ (Eyebrow), „Haushaltswissen“ (Doku, Tour, Gut zu wissen), Routen `/wissen` und `/merkt-sich`, EN „Knowledge“ / „What ToHuus remembers“ |
| Leute | „Leute“ (Mehr), „Mitglieder“ (Einstellungs-Reiter), „Wer wohnt hier?“ (Haushalt-Reiter), EN „People“ / „Members“ |
| Fokus | „Jetzt“ (Doku, Live Activity), „Nur eins“ (Chip, Schalter), „Eins nach dem anderen“ (`/fokus`), „Ruhe & Fokus“ (Konto-Abschnitt), „Sanfter Modus“, Suche „One thing at a time“ |
| Fällig | Heute › „Fällig“ = Kaufrhythmus (was wieder gekauft werden müsste); Aufgaben › „fällig“ = Termin einer Aufgabe |
| Bons | Kassenbons (Import) *und* Drucker-Zettel („Drucker & Bons“) |
| Haushalt | Mehr-Gruppe „Haushalt“ *und* Zeile „Haushalt“ (= Haushaltseinstellungen) *und* Einkaufs-Kategorie „Haushalt“; iOS „Haushaltseinstellungen“ |
| Mitteilungen | iOS „Mitteilungen“, Web „Benachrichtigungen“ |
| KI | Web „Zugänge & KI“, iOS „Mit oder ohne KI“ |
| Abo | Web „Abo & Speicher“, iOS „Plan & Speicher“ |
| Was nutzt ihr? | Web-Karte „Was nutzt ihr?“, iOS-Erstlauf „use“, iOS-Mehr-Zeile „Was soll verfolgt werden?“ (das ist aber Vorrat-Tracking!) |
| Hausinfo | Bereich „Hausinfo“; Modul-Schalter „Hausinfo – Pflege-Aufgaben und was man übers Zuhause wissen muss“ (vermischt mit Pflege, Modul-Id `homeinfo`, Route `/pflege`) |
| Wünsche | „Wünsche“ (Leiste, Seite), „Wünsche & Merkliste“ (Suche, Symbol-Titel), Listentyp „Merkliste“ |
| Bring mir was | DE „Bring mir was“; EN „Treats“; Routen `/bestellen`, `/bar` (das ist aber „Gäste“), Modul `treats`/`guests` |
| Kochen | EN „Cook“ (Web) vs. „Cooking“ (iOS) |
| Assistent | „Assistent“ (Knopf) vs. ältere „Sprechen“-Reste in `docs/ui-audit.md` und Heute-Karte „Einfach sprechen“ |

## 2. Parität iOS / Web / Self-Host

Legende: ✓ gleich · ≈ vorhanden, aber anders benannt oder anders erreichbar · ✗ fehlt · – gewollt nicht.

| Funktion | iOS (Cloud + eigener Server) | Web Cloud | Web Self-Host | Unterschied |
|---|---|---|---|---|
| Leiste, Deine Leiste | ✓ | ✓ | ✓ | – |
| Mehr von jedem Tab | ✓ Avatar + Lupe auf jedem Root-Screen | ✗ nur auf Heute (Handy) | ✗ wie Cloud | **P0-1** |
| Mehr-Aufbau | 8 Abschnitte, ~35 Zeilen inkl. Rechtliches, Version, Konto löschen | 5 Gruppen, ~22 Zeilen | wie Cloud ohne Abo | P1-7 |
| Einstellungen | Einzelzeilen in Mehr | 1 Seite, 12 Reiter | 11 Reiter | P0-3 |
| Server & Haushalte wechseln | ✓ Mehr › Einstellungen | ≈ Haushaltswechsel woanders (`home/`), kein Server-Wechsel | ≈ | gewollt teils (Browser = eine Adresse) |
| Hinweis im Laden (Ort) | ✓ | ✗ | ✗ | gewollt (Geofence nur nativ) – in Doku als „nur iPhone“ markieren |
| Listenansicht (Schrift, Zeilen) | ✓ „So sieht die Liste aus“ in Mehr | ≈ „Aa“ in Einkauf + „Lesbarkeit“ in Mein Konto | ≈ | P1, Begriff + Ort |
| Ruhe & Fokus | ≈ über Konto / Suche | ≈ Mein Konto Bildschirm 3 | ≈ | P0-3 |
| Kalender & Erinnerungen | ✓ Mehr › Geräte | ≈ Mein Konto (3 Karten) + Aufgaben-Fuß | ≈ | P1 |
| Küchenmodus (iPad an der Arbeitsfläche) | ✓ | ✗ unter diesem Namen | ✗ | P1-10: Web-Gegenstück bauen (Vollbild-Ansicht Woche + Rezept + Liste, Wake-Lock) oder bewusst „nur iPad“ dokumentieren |
| Wünsche-Einstieg | Tür in Einkauf + Suche | Symbol in Einkauf, nicht in Suche | wie Cloud | P1-6 |
| Such-Register | ~34 Einträge (u. a. Wünsche, Urlaub, Lieblinge, Bons, Server, Geräte) | 21 Einträge (u. a. Im Kopf, Wochenrückblick, Für wen ich da bin) | wie Cloud | P1-8: ein gemeinsames Register |
| Ersteinrichtung | 8 Schritte (`FirstRunView.Step`) | 6 Schritte (`onboarding-state.ts STEPS`) | 6 + Admin-Passwort aus dem Log | P1-9 |
| Tour | 6 Seiten | 7 Seiten (+ „Das war die Tour“) | wie Cloud | P2 |
| Heute-Karten | Checkliste „Erste Schritte“ (`TodayChecklistCard`), FactCard bei „ruhig“ | DemoNudge, Notices; Checkin/CareFor in der Kartenliste | wie Cloud | P2 (Reihenfolge, Sichtbarkeit angleichen) |
| Fehlerprotokoll | ✓ Mehr › Hilfe | – Download `/diag/errors` | – | gewollt |
| Abo & Speicher | ✓ (nur Cloud: Preis) | ✓ | – (Self-Host: „alles inklusive“) | Self-Host sollte die Zeile mit „Eigener Server – alles inklusive“ zeigen wie iOS, statt sie wegzulassen (P2) |
| Rechtliches, Version, Feedback | ✓ in Mehr | ≈ Website / Fuß | ≈ | P2: gleiche Zeile „Über ToHuus“ |
| Konto löschen | ✓ Mehr-Fuß | ≈ Mein Konto / Daten | ≈ | P2 |
| Sprache beim ersten Start | Gerätesprache | Cloud: Wahl bei Anmeldung | **Englisch**, obwohl Browser `de-DE` | **P1-11** |
| Home Assistant, MCP | ✓ „Verbindungen“ (ein Hub) | ✓ drei Zeilen (HA, Displays, Drucker) | ✓ | P1 Begriff/Gruppierung |
| Übergabe für Gäste | ✓ | ✓ | ✓ | `docs/handover.md` sagt noch „iPhone hat keinen Urlaubsbereich“ – veraltet (AwayView existiert) |
| Passkey anlegen auf eigenem Server | ≈ über Browser | ✓ | ✓ | gewollt (Apple-Entitlements) |

Zusätzliche Beobachtung zu EN: Die englische Oberfläche ist vollständig, aber sie benennt anders als die deutsche
Positionierung („Treats“ statt „Bring mir was“, „Pantry“, „Cook“). Für den Self-Host-Standard Englisch ist das das
Erste, was Nutzer sehen (`/tmp/ux-audit/shots-self/heute--phone.png`, `/tmp/ux-audit/tiles/mehr-self.png`).

## 3. Befunde nach Schwere

P0 = Nutzer findet eine Kernfunktion nicht oder bricht ab. P1 = findet sie nur mit Umweg, Suche oder Glück; deutliche
Überforderung. P2 = Reibung, Uneinheitlichkeit. Screenshots relativ zu `/tmp/ux-audit/` auf Tills Mac.

### P0

**P0-1 · Web-Handy: kein Weg zu „Mehr“ außer über Heute**
- Ort: `web/src/pages/Today.tsx:108` (einziger Avatar-Knopf), `web/src/App.tsx:318` (Avatar nur in der
  Desktop-Seitenleiste); Seitenköpfe von `Shopping.tsx:425`, `Stock.tsx`, `Cook.tsx`, `Care.tsx` ohne Avatar/Lupe.
- Belege: `shots/einkauf--phone.png`, `shots/aufgaben--phone.png`, `shots/bestand--phone.png` (kein Avatar, keine
  Lupe), dagegen `shots/heute--phone.png`.
- Folge: Geld (Standard nicht in der Leiste), Leute, Gäste, Bring mir was, Wissen, Einstellungen, Hilfe sind von 4 der
  5 Tabs aus unsichtbar. iOS macht es richtig (`ios/ToHuus/Design/RootChrome.swift`).
- Fix: gemeinsame Kopfzeilen-Komponente `RootHead` für jede Bereichsseite im Web (Titel links; rechts Lupe + Avatar,
  44 px), wie `rootChrome()` auf iOS. Avatar bekommt beim ersten Mal eine Beschriftung „Mehr“ (siehe Tour P1-9).

**P0-2 · Heute überfordert und widerspricht sich**
- Ort: `web/src/pages/Today.tsx:140–171` (der Slot `tasks` bündelt `TodayOfferAsks`, `WeekReviewTeaser`,
  `TasksTodayCard`, `TasksAheadCard`, `CheckinCard`, `CareForHint`, `MindTodayCard`, `StarsCard`, `ReviewTeaser`),
  `ios/ToHuus/Features/Today/TodayView.swift:150–190, 251–275` (gleich, plus Checkliste und FactCard).
- Belege: `tiles/heute.png` (3,5 Bildschirme): Beispieldaten-Hinweis → „Fällig“ leer mit drei großen Import-Knöpfen →
  „Was habt ihr heute gelöst?“ mit Eingabefeld → „Im Kopf“ mit Eingabe, Datum, „Für alle/Nur für mich“ → Liste →
  Das habt ihr noch → Heute kochen? → Geld → Karten anordnen → **„Für heute ist alles Wichtige erledigt“** →
  Gut-zu-wissen-Artikel „Serie“ → So geht’s.
- Folge: Der erste Bildschirm zeigt nichts, was heute zu tun ist (nur ein leeres „Fällig“ und ein Formular). Die
  Ruhe-Karte lügt, wenn darüber offene Dinge stehen. Zwei Formulare auf der Startseite sind Arbeit, kein Überblick.
- Fix: Heute nach Abschnitt 5.3 neu: max. 4 Karten, keine Formulare (Im Kopf, Check-in → je eine Zeile „Was im Kopf?“
  die ein Sheet öffnet, und nur abends), „Fällig“ (Kaufrhythmus) verschwindet, wenn leer, die Import-Wege gehen in den
  Plus-Knopf; Ruhe-Karte nur, wenn Aufgaben **und** Liste **und** Bald-verbrauchen leer sind. Server-Seite
  (`/api/today` `calm`) entsprechend schärfen.

**P0-3 · Einstellungen: zu lang, Reiter verschwinden, ADHS-Schalter tief vergraben**
- Ort: `web/src/pages/Settings.tsx:95–156` (12 Reiter; `account` mit 11 Karten, `home` mit 10 Karten);
  iOS `SettingsView.swift:55–83` (11 Einstellungs-Zeilen ohne Gruppierung zwischen Haushalt, Konto und Gerät).
- Belege: `tiles/einstellungen_tab_account.png` (7,8 Bildschirme), `tiles/einstellungen_tab_home.png` (6,0),
  `shots/einstellungen_tab_notify--phone.full.png` (6,3), `shots/einstellungen_tab_access--phone.full.png` (4,8).
  Reiterleiste: ab „Orte & Kategorien“ abgeschnitten (`shots/einstellungen_tab_home--phone.png`).
- Folge: „Sanfter Modus“ und „Nur eins“ – genau die Schalter für Tage ohne Kraft – liegen auf Bildschirm 3 von
  „Mein Konto“ zwischen Avatar-Tieren und Kalender-Abo. „Was nutzt ihr?“ (Bereiche ausschalten, das wirksamste Mittel
  gegen Überforderung) liegt auf Bildschirm 3 im Haushalt-Reiter.
- Fix: Struktur nach Abschnitt 5.4 (6 Seiten, Unterseiten statt Karten-Stapel, keine seitlich scrollenden Reiter auf
  dem Handy, sondern eine Liste wie iOS). „Ruhe & Fokus“ und „Was nutzt ihr?“ jeweils als eigene Zeile ganz oben.

### P1

**P1-4 · Begriffe: ein Ding, mehrere Namen** – Tabelle 1.6. Fix: Glossar Abschnitt 6, durchziehen in Web-Locales,
`Localizable.xcstrings`, Server-Locales (Assistent, Mitteilungen), Hilfe (`site/`), Tour. Routen-Aliase behalten.

**P1-5 · Aufgaben-Seite: 5,7 Bildschirme, Werkzeuge am Ende**
- Ort: `web/src/pages/Care.tsx` (Kopf 379–504; Vorschläge, Ratgeber, Fußlinks), iOS `CareView.swift`.
- Beleg: `tiles/aufgaben.png`: Türen, Titel, drei Knöpfe („Eins nach dem anderen“, „Etiketten“, „Neu“), Erklärtext,
  Eingabe, Filter (Alle/Haushalt/Pflege & Fristen/Für mich), leerer Zustand, „Aus dem Ratgeber“ (Artikel), „Wer hat was
  im Blick“, „Denkarbeit-Check“, „Mit einem Tipp hinzufügen“ (~35 Vorschläge), Kalender, Für wen ich da bin, Im Kopf,
  Wochenrückblick.
- Fix: Aufgaben zeigt nur Aufgaben (Eingabe, Filter, Liste, „Zuletzt erledigt“). Vorschläge nur im leeren Zustand und
  dort max. 6 + „Mehr Vorschläge“ (Sheet). Ratgeber-Artikel raus (Hilfe). Die fünf Kopf-/Fairness-Werkzeuge in die
  Mehr-Gruppe „Kopf & Fairness“. „Etiketten“-Knopf raus (Mehr › Verbindungen & Geräte).

**P1-6 · Türen am falschen Ort, Wünsche nur als Symbol**
- Ort: `web/src/home/HomeSwitch.tsx:30–55`, `ios/ToHuus/Features/Home/HomeView.swift:37–39`; `Shopping.tsx:434`.
- Beleg: `tiles/aufgaben.png` (Hausinfo, Urlaub über Aufgaben), `tiles/einkauf.png` (Geschenk neben „Aa“).
- Fix: Hausinfo zu „Zuhause“ (Abschnitt 5.1), Urlaub & Übergabe nach Mehr › Alltag, Wünsche nach Mehr › Alltag und
  als beschriftete Zeile unter den Listen-Chips in Einkauf („Wünsche & Geschenke“), nicht als Symbol.

**P1-7 · Mehr auf iOS und Web verschieden** – Ort `web/src/nav.tsx:186–260` vs.
`ios/ToHuus/Features/Settings/SettingsView.swift` + `Household/HouseholdLinks.swift`. Beleg: `tiles/mehr.png` vs.
Code. Fix: eine gemeinsame Definition (Register, P1-8) für Gruppen, Reihenfolge und Namen; beide Clients rendern daraus.

**P1-8 · Zwei verschiedene Such-Register** – `web/src/search/GlobalSearch.tsx:34–57` vs.
`ios/ToHuus/Features/Search/GlobalSearchView.swift:188–226`. Web findet „Wünsche“, „Urlaub“, „Bons“, „Lieblinge“ nicht
als Funktion; iOS findet „Im Kopf“, „Wochenrückblick“, „Für wen ich da bin“, „Deine Leiste“ nicht. Fix:
`shared/functions.json` (id, Gruppe, DE/EN-Label, Suchwörter, Web-Route, iOS-Ziel, Modul, Gast-Pfad), Test, der prüft,
dass jede Web-Route und jedes iOS-Ziel einen Eintrag hat.

**P1-9 · Ersteinrichtung und Tour verschieden, Mehr wird nicht erklärt** – `FirstRunView.swift:14` (8 Schritte) vs.
`web/src/onboarding-state.ts:9` (6); Tour `AppTourView.swift:28–47` / `web/src/pages/Tour.tsx:83–132`. Die Tour sagt
„Heute, Einkauf, Kochen und Aufgaben sitzen unten“ (Vorrat fehlt) und erwähnt den Avatar nicht. Fix Abschnitt 5.6.

**P1-10 · Küchenmodus nur auf iOS; Kochen-Kopf überladen** – `CookingView.swift:126–143` (fünf Symbole in der
Toolbar), Web ohne Küchenmodus. Fix: iOS-Toolbar auf Plus + (Lupe, Avatar) reduzieren, „Lieblinge“ und „Küchenmodus“
als beschriftete Chips unter dem Segment; Web: Küchenmodus als Vollbild-Ansicht mit Wake-Lock nachbauen (oder als
„nur iPad“ dokumentieren – Tills Entscheidung, Parität sagt: nachbauen).

**P1-11 · Self-Host startet auf Englisch** – `/api/instance` liefert `lang: "en"`, Browser `de-DE` wird ignoriert.
Beleg `shots-self/heute--phone.png`. Fix: erste Sprache des Self-Host-Haushalts aus `Accept-Language` beim ersten
Admin-Login bzw. Wahl im ersten Einrichtungsschritt; Server-Default bleibt konfigurierbar (`LANG`/Instanz-Einstellung).

**P1-12 · Kochen zeigt dasselbe Rezept mehrfach** – `web/src/pages/Cook.tsx`, `WhatToEat.tsx`, iOS
`WhatToEatView.swift`. Beleg `tiles/kochen.png`: „Gnocchi-Pfanne“ in „Daraus könnt ihr heute kochen“, „Geht sofort“,
„Schnell“ und im Durchblätter-Stapel. Fix: eine Vorschlagsliste mit Filter-Chips (Geht sofort · ≤ 20 Min. · Thermomix)
und *einem* „Entscheidet ihr für uns“-Knopf; Durchblättern als eigener Einstieg „Ideen durchblättern“, nicht darunter.

**P1-13 · Symbole ohne Text an Stellen, die man selten nutzt** – Einkauf „Aa“, Geschenk; Vorrat-Kopf zwei Symbole;
Heute-Kopf Avatar. Beleg `shots/einkauf--phone.png`, `tiles/bestand.png`. Fix: seltene Aktionen bekommen Text
(Chip oder Zeile), Symbole ohne Text nur für Plus und Lupe.

**P1-14 · Gleiches Symbol, verschiedene Bedeutung** – `HandHeart`: Bring mir was (`nav.tsx:94`), „Ich hol’s“ in jeder
Einkaufszeile (`Shopping.tsx:937`), „Wer kocht?“ (`shop/claims.tsx:66`). Fix: Bring mir was behält die Hand, „Ich
hol’s“ wird ein Avatar-Plus bzw. Text-Chip „Ich hol’s“ (auch auf dem Handy mit Text, sonst 44-px-Ziel ohne Bedeutung).

**P1-15 · Vorrat: 6,6 Bildschirme, zwei Filterreihen, Begriff „Bestand“** – Beleg `tiles/bestand.png`. Fix: Kopf
„Vorrat“ ohne Zählung, *eine* Filterreihe (Orte), Status als Sortierung („Bald verbrauchen zuerst“ standardmäßig),
Orte eingeklappt ab dem dritten, „Bestand“ im Text durch „Vorrat“ ersetzen.

### P2

- **P2-1** „Deine Leiste“ dreimal in Mehr/Konto: Mehr-Fuß-Knopf und Konto-Karte streichen, Zeile in Einstellungen ›
  Ich und Langdruck behalten. (`More.tsx:95–100`, `Settings.tsx:133`, `HouseholdLinks.swift:33`.)
- **P2-2** „Darstellung“ und „Passwort ändern“ doppelt (Haushalt- und Konto-Reiter): Darstellung nur unter Ich
  (Haushalts-Vorgabe als Unterpunkt „Für alle festlegen“, nur Admins), Passwort nur unter Ich › Anmeldung.
- **P2-3** „Beim Abhaken einräumen“-Schalter auf der Einkaufsliste → Einstellungen › Bereiche › Einkauf; auf der Liste
  höchstens ein Hinweis beim ersten Abhaken.
- **P2-4** Geld: „Im Detail“ zweimal auf einer Seite (`tiles/geld.png`); „Neue Geldliste“ unter „Aufteilen“ → „Neue
  Teilen-Liste“ bzw. Glossar „Abrechnung“.
- **P2-5** „So geht’s“ am Fuß jeder Seite + Gut-zu-wissen-Artikel auf Heute und Wissen: Artikel nur in Hilfe und
  leeren Zuständen.
- **P2-6** Desktop-Seitenleiste zeigt unter „Mehr“ ~20 flache Zeilen ohne Gruppentitel (`App.tsx:303–310`): Gruppen
  wie Mehr, Einstellungen als eine Zeile.
- **P2-7** iOS-Mehr: „Plan & Speicher“ steht nach Hilfe und Beispieldaten; Rechtliches/Version/Feedback in eine Zeile
  „Über ToHuus“.
- **P2-8** Self-Host: Zeile „Abo & Speicher“ fehlt im Web, iOS zeigt „Eigener Server – alles inklusive“. Angleichen.
- **P2-9** `docs/handover.md` („iPhone app has no trip area yet“) und `docs/ui-audit.md` („Sprechen“) veraltet.
- **P2-10** Beispieldaten-Hinweis belegt auf Heute eine ganze Karte (Handy: 1/6 des ersten Bildschirms): als
  schmale Zeile unter dem Gruß.

## 4. Was gut ist und bleibt

- Ruhige Gestaltung („Dutch Detail“), große Tippziele, klare Leiste mit fünf Plätzen, Badges nur für Einkauf/Vorrat.
- „Deine Leiste“ pro Person auf dem Server – richtig, bleibt.
- iOS-`rootChrome()` (Lupe + Avatar auf jedem Root-Screen) ist das Vorbild fürs Web.
- Leere Zustände mit einer Handlung (z. B. „Noch keine Aufgaben“) und „Nur eins“ als Konzept sind genau richtig für
  Tage ohne Kraft; sie müssen nur gefunden werden.
- Server-Reihenfolge für „Jetzt/Nur eins“ (niemand sortiert selbst) – bleibt.

## 5. Ziel-Architektur

### 5.1 Leiste unten (Standard, Handy)

**Heute · Einkauf · Kochen · Aufgaben · Zuhause** (fünf, kein Mehr-Tab; Mehr bleibt am Avatar, jetzt überall).

- **Zuhause** ersetzt das Etikett „Vorrat“ (Id bleibt `stock`, Route `/bestand` bleibt, `/zuhause` als Alias).
  Öffnet wie heute die Vorrat-Liste; darüber *beschriftete* Türen: **Hausinfo · Wissen · Wo ist was?**. Damit liegt
  alles, was „bei uns ist und was man darüber wissen muss“, an einem Ort (WLAN-Code, Zählernummer, Schuhgröße, wo die
  Batterien liegen). Aufgaben verliert die Türen Hausinfo und Urlaub.
- **Einwand (ehrlich):** Am 18.10. wurde der gemeinsame Tab „Zuhause“ (Aufgaben + Vorrat hinter einem Schalter)
  aufgelöst. Das hier ist etwas anderes: kein Schalter zwischen zwei Hauptlisten, sondern Vorrat als Inhalt plus Türen
  zu Nachschlage-Seiten. Wenn Till das Wort „Vorrat“ behalten will, bleibt das Etikett und nur die Türen wandern –
  der Gewinn (Hausinfo nicht mehr unter Aufgaben) bleibt.
- Geld bleibt außerhalb der Standardleiste (Mehr › Alltag, erste Zeile), per „Deine Leiste“ holbar.
- „Deine Leiste“ wählbar wie heute: shopping, cooking, tasks, stock(=Zuhause), money, knowledge, orders, wishes,
  houseinfo. **Wünsche** bleibt wählbar; die Einbindung (Id `wishes`, Route `/einkauf/wuensche`) ändert sich nicht –
  der Neubau des Wunschlisten-Bereichs muss nur die Route und `AppArea.wishes` behalten.
- Kopf jeder Bereichsseite, iOS **und** Web: Titel links, rechts **Lupe** und **Avatar** (= Mehr). Einziges weiteres
  Symbol: Plus, wenn die Seite etwas anlegt. Alles andere als beschrifteter Chip unter dem Titel.

### 5.2 Mehr (gleich auf iOS, Web-Handy, Web-Desktop-Seitenleiste)

Kopf: Avatar, Name, Haushalt · Suchfeld „Einstellung oder Funktion finden“. Danach höchstens vier Gruppen, je max. 5
Zeilen (Miller), Bereiche, die in der eigenen Leiste stehen, erscheinen hier nicht doppelt.

| Gruppe | Zeilen (in dieser Reihenfolge) |
|---|---|
| **Alltag** | Geld · Bring mir was · Wünsche · Urlaub & Übergabe · Bons & Importe |
| **Familie & Gäste** | Leute · Gäste · Für wen ich da bin |
| **Kopf & Fairness** | Im Kopf · Wer hat was im Blick · Denkarbeit-Check · Wochenrückblick |
| **Einstellungen & Hilfe** | Einstellungen · Hilfe & Tour · Über ToHuus |
| Fuß | Abmelden |

- Bereiche, die ausgeschaltet sind („Was nutzt ihr?“), erscheinen nicht. Gäste sehen nur Alltag (soweit erlaubt),
  Hausinfo, Wo ist was?, Übergabe, Einstellungen › Ich.
- Desktop-Seitenleiste: Leiste oben, darunter dieselben Gruppen mit Titeln (eingeklappt bis auf „Alltag“).
- iOS: Mehr bleibt Sheet, aber **ohne** die 11 Einstellungs-Zeilen (die wandern hinter „Einstellungen“).

### 5.3 Heute

Ziel: auf dem Handy passt das Wichtige in **einen Bildschirm**, das Ganze in höchstens zwei.

Reihenfolge (fest; „Karten anordnen“ bleibt für die vier Karten):

1. **Kopf:** Datum, Gruß (Platt-Spruch eingeklappt auf eine Zeile), Plus · Lupe · Avatar. Darunter höchstens **eine**
   Hinweis-Zeile (Bon wartet, jemand wünscht sich was, Beispieldaten); weitere als „+2 Hinweise“.
2. **Jetzt dran** (Aufgaben heute + Überfälliges): max. 3 Zeilen + „n weitere“. Mit „Nur eins“ eine einzige Aufgabe
   (wie heute). Fällig gewordene *Käufe* gehören nicht hierher.
3. **Liste:** Zahl + max. 3 zuletzt dazugekommene; darunter eine Zeile „Bald wieder nötig: Milch, Eier“
   (bisherige Karte „Fällig“ = Kaufrhythmus, nur wenn es etwas gibt).
4. **Bald verbrauchen:** max. 3, sonst weg.
5. **Heute kochen?:** ein Vorschlag, ein Knopf.
6. **Ein Kontext-Platz** (max. 1, nach Priorität): Bring mir was offen → Wochenfrage (So/Mo) → Wochenrückblick (Mo) →
   „Was habt ihr heute gelöst?“ (abends, als eine Zeile, die ein Sheet öffnet) → Erste Schritte (bis erledigt).
7. **Ruhe-Zustand** nur, wenn 2–4 leer sind: „Für heute ist alles erledigt.“ – sonst nichts.

Raus von Heute: Formular „Im Kopf“ (→ Kontext-Platz/Mehr), Geld-Karte (opt-in über „Karten anordnen“), Sterne,
Ausblick „Demnächst“ (→ Aufgaben), Gut-zu-wissen-Artikel, „So geht’s“. Höchstens **5 Karten** + Kopf, immer.

### 5.4 Einstellungen (eine Liste, Unterseiten; gleich auf iOS und Web)

| Seite | Inhalt | kommt von |
|---|---|---|
| **Ich** | Name & Bild · **Ruhe & Fokus** (Sanfter Modus, Nur eins, Aufgaben pro Tag, Timer, abends fragen) · Deine Leiste · Darstellung & Lesbarkeit (Hell/Dunkel, Schrift, Liste) · Geschmack & Allergien · Anmeldung (Passwort, Passkeys, E-Mail, angemeldete Geräte) | Mein Konto (11 Karten), iOS „So sieht die Liste aus“, „Mein Passwort ändern“ aus Haushalt |
| **Haushalt** | Name, Sprache, Region · Wer wohnt hier? · **Was nutzt ihr?** · Wie kocht ihr? · Extras im Wocheneinkauf · Brotdose · Wochenfrage | Haushalt-Reiter (10 Karten) |
| **Bereiche & Orte** | Orte & Kategorien · Vorrat: was verfolgen · Einkauf: beim Abhaken einräumen, Läden · Rezepte & Importe · Bring mir was: Karte | Orte-Reiter, Rezepte-Reiter, Teile von Haushalt |
| **Mitteilungen & Kalender** | Mitteilungen · Hinweis im Laden (nur iPhone) · Kalender lesen · Erinnerungen & Kalender (CalDAV) · Kalender-Abo | Benachrichtigungen-Reiter, 3 Kalender-Karten aus Mein Konto |
| **Verbindungen & Geräte** | KI & Zugänge · Home Assistant · Displays & Familien-Tablet (PIN) · Drucker · QR-Etiketten · Teilen aus anderen Apps · iPhone-App verbinden | Zugänge & KI, HA, Displays, Drucker, Teile von Mein Konto |
| **Daten, Abo & Konto** | Abo & Speicher (Self-Host: „Eigener Server – alles inklusive“) · Daten & Sicherung · Zurücksetzen · Server & Haushalte (iOS) · Konto löschen | Abo, Daten, iOS-Zeilen |

Regeln: Jede Seite ≤ 2 Bildschirme; was länger wird, bekommt eine Unterseite. Keine Reiterleiste auf dem Handy.
Admin-Dinge stehen am Ende ihrer Seite mit kleiner Überschrift „Nur für Admins“, statt dazwischen.
Alte Links `/einstellungen?tab=…` bleiben als Weiterleitung (Mapping-Tabelle in `nav.tsx`).

### 5.5 Leere Zustände (eine Regel für alle Bereiche)

Ein Satz, was hier hinkommt · **eine** Hauptaktion · höchstens drei Vorschläge als Chips · kein Artikel, keine Studie.
Beispiele (App-Ton, du-Form): Aufgaben „Noch keine Aufgaben. Tipp eine ein oder nimm einen Vorschlag.“ · Zuhause
„Noch nichts im Vorrat. Fang mit dem Kühlschrank an.“ · Wissen „Schreib’s einmal auf, dann muss keiner mehr fragen.“ ·
Geld „Teil einen Bon, dann siehst du hier, was Essen und Haushalt kosten.“

### 5.6 Erster Start und Tour (gleich auf iOS und Web, Self-Host inklusive)

Ersteinrichtung, **5 Schritte**, jeder überspringbar:
1. Wer wohnt hier? (Allein / Zu zweit / Familie / WG) + Name des Haushalts + **Sprache** (Self-Host: aus dem Browser
   vorbelegt).
2. Was nutzt ihr? (Bereiche an/aus, mit Vorschau der Leiste).
3. Die erste Liste (tippen, Foto vom Zettel, Bon teilen).
4. Wer macht mit? (einladen – später geht auch).
5. Fertig → Heute.
Orte, Plätze, Kochstil, Läden wandern in „Erste Schritte“ (Kontext-Platz auf Heute, je ein Tipp, bis erledigt).

Tour, **5 Karten**, mit Zeiger auf das echte Element:
1. „Unten sind deine Bereiche. Lange drücken, um sie zu tauschen.“
2. „Oben rechts: Lupe findet alles, dein Bild öffnet Mehr.“
3. „Plus oder Assistent: einfach sagen, was fehlt.“
4. „Kein guter Tag? Nur eins zeigt dir eine Aufgabe nach der anderen.“ (öffnet Ich › Ruhe & Fokus)
5. „Zu viel? Schalt ab, was ihr nicht braucht.“ (öffnet Haushalt › Was nutzt ihr?)
Danach Bereichs-Tipps beim ersten Besuch eines Bereichs (eine Zeile, wegklickbar), nicht als lange Tour.

## 6. Glossar: ein Wort pro Ding

Gilt für Leiste, Mehr, Seitentitel, Suche, Hilfe (`site/`), Tour, Mitteilungen, Assistent-Antworten, Widgets,
Siri/Kurzbefehle. Routen und Ids bleiben (Aliase), nur sichtbare Wörter ändern sich.

| Ding | DE (einzig) | EN (einzig) | nicht mehr | Id / Route |
|---|---|---|---|---|
| Startseite | Heute | Today | – | `today` / `/` |
| Einkaufsliste, Laden-Modus | Einkauf (Seite), Liste (Karte), Im Laden (Modus) | Shopping, List, In the store | – | `shopping` / `/einkauf` |
| Rezepte, Wochenplan | Kochen | Cooking | Cook | `cooking` / `/kochen` |
| Wiederkehrendes zu Hause | Aufgaben | Tasks | Pflege (als Bereich) | `tasks` / `/aufgaben` |
| Bereich „was bei uns ist“ | Zuhause | Home | – | `stock` / `/bestand`, Alias `/zuhause` |
| Lebensmittel & Sachen im Haus | Vorrat | Pantry | Bestand, Produkte im Haus | – |
| Was wieder gekauft werden müsste | Bald wieder nötig | Needed again soon | Fällig (für Käufe) | – |
| Aufgabe ist dran | fällig | due | – | – |
| Codes, Müllplan, Geräte | Hausinfo | House info | Pflege & Hausinfo | `houseinfo` / `/hausinfo` |
| Größen, Maße, Nummern | Wissen | Knowledge | Was ToHuus sich merkt, Haushaltsgedächtnis, Haushaltswissen | `knowledge` / `/wissen` |
| Wo liegt was | Wo ist was? | Where’s what? | – | `/wo` |
| Gedanken, die Arbeit machen | Im Kopf | On my mind | – | `/kopf` |
| Ausgaben, Teilen | Geld · Ausgaben · Abrechnung (geteilte Liste) | Money · Spending · Split | Geldliste, Aufteilen | `money` / `/geld` |
| Kassenbon, eBon | Bon | Receipt | – | `/import` |
| Gedruckter Zettel | Ausdruck | Printout | Bon (für Drucker), Ticket | – |
| Wunsch ans Haus | Bring mir was | Bring me something | Treats, Bestellen | `orders` / `/bestellen` |
| Gäste-Links, Party | Gäste | Guests | Bar | `/bar` |
| Geschenk- & Merklisten | Wünsche | Wishes | Wünsche & Merkliste (als Titel) | `wishes` / `/einkauf/wuensche` |
| Menschen im Haushalt | Leute | People | Mitglieder, Members | `?tab=members` → Familie & Gäste › Leute |
| Eine Aufgabe nach der anderen | **Nur eins** (Modus und Seite) | **Just one** | Jetzt, Eins nach dem anderen, Fokus | `/fokus` |
| Schonender Ton | Sanfter Modus | Gentle mode | – | – |
| Einstellungen dazu | Ruhe & Fokus | Calm & focus | – | – |
| Bereiche an/aus | Was nutzt ihr? | What do you use? | Was soll verfolgt werden? (für Bereiche) | – |
| Was im Vorrat gezählt wird | Was verfolgen? | What to track? | – | – |
| Benachrichtigungen | Mitteilungen | Notifications | Benachrichtigungen | – |
| KI-Schalter | KI | AI | Zugänge & KI, Mit oder ohne KI | – |
| Bezahlplan | Abo | Plan | Plan & Speicher | – |
| Runder Knopf | Assistent | Assistant | Sprechen | – |
| Untere Leiste | Deine Leiste | Your bar | – | `/leiste` |
| Avatar-Menü | Mehr | More | – | `/mehr` |
| Countable things | Sache/Sachen | item/items | Ding/Dinge | – |

Offene Wortwahl (Till entscheidet): „Nur eins“ statt „Eins nach dem anderen“ für beides – oder umgekehrt. Wichtig ist
nur: **ein** Name für Modus, Seite, Live Activity und Hilfe.

## 7. Umsetzungspakete

Jedes Paket deckt **iOS und Web gleichzeitig** ab (Parität, CLAUDE.md) und gilt für Cloud und Self-Host. Reihenfolge:
**D zuerst** (Wörter + Register sind die Grundlage), dann **A**, danach **B, C, E parallel**.

### D · Begriffe und gemeinsames Funktions-Register
- Glossar (Abschnitt 6) in alle Texte: `web/src/locales/de/*.ts` (+ EN-Keys, wo die Wörter englisch anders heißen),
  `ios/tools/strings_de*.json` → `gen_strings.py` / `Localizable.xcstrings`, `server/locales/de-*.ts`
  (Mitteilungen, Assistent), `site/` Hilfe-Seiten, `docs/ratgeber-cards.json` falls betroffen.
- Neu: `shared/functions.json` (oder `server/lib/functions-registry.ts` + Export für iOS): id, Gruppe, Label DE/EN,
  Suchwörter, Web-Route, iOS-Ziel, Modul, Gast-Pfad. Web `search/GlobalSearch.tsx:34` und iOS
  `GlobalSearchView.swift:188` lesen daraus; Mehr (Paket A) auch.
- Test: jede Route in `App.tsx` und jedes `GlobalSearchView.Target` hat einen Registereintrag; keine verbotenen Wörter
  aus der „nicht mehr“-Spalte in den Locales (einfacher Wortlisten-Test).
- Abhängigkeiten: keine. Konflikt: Wunschlisten-Agent ändert Texte unter `wishes` – Wünsche-Wörter erst nach dessen
  Abschluss anfassen.

### A · Navigation, Kopfzeile, Mehr
- Web: `RootHead`-Komponente (Lupe + Avatar) in `pages/Shopping.tsx`, `Stock.tsx`, `Cook.tsx`, `Care.tsx`,
  `Money.tsx`, `Knowledge.tsx`, `HouseGuide.tsx`, `Order.tsx`; `nav.tsx` (`TABS` Label Zuhause, `moreGroups` neu nach
  5.2, `tabFor` für Hausinfo/Wissen/Wo → Zuhause), `pages/More.tsx`, `App.tsx` (Seitenleiste mit Gruppen),
  `home/HomeSwitch.tsx` (Türen: Zuhause = Hausinfo · Wissen · Wo ist was?; Aufgaben ohne Türen), `navbar.tsx`
  (Doppel-Einstiege P2-1), Routen-Alias `/zuhause`.
- iOS: `App/MainTabView.swift` (`AppArea.stock` Titel „Zuhause“, Icon), `Design/RootChrome.swift` (unverändert, auf
  alle Bereichs-Roots prüfen), `Features/Settings/SettingsView.swift` + `Household/HouseholdLinks.swift` (Mehr nach 5.2,
  Einstellungen als eine Zeile), `Features/Home/HomeView.swift` (Türen), `App/NavBarSettings.swift`.
- Wünsche: nur Einbindung (Mehr › Alltag, Leiste-Id `wishes`, Einkauf-Chip mit Text statt Symbol in
  `Shopping.tsx:434` / `ShoppingView.swift`) – **keine** Dateien unter `pages/Wishes.tsx` / `Features/Wishes/`.
- Server: `server/lib/nav-prefs.ts` unverändert (Ids bleiben). Tests: `test/nav-bar-web.test.ts`,
  `test/nav-prefs.test.ts` erweitern (Avatar/Lupe auf jeder Bereichsseite, Mehr-Gruppen, Alias).
- Doku: `docs/navigation.md` neu schreiben.
- Abhängigkeit: D (Labels, Register).

### B · Heute und erster Start
- Heute nach 5.3: Web `pages/Today.tsx`, `pages/TasksToday.tsx`, `focus/Now.tsx`, Check-in/Mind-Karten als Zeile;
  iOS `Features/Today/TodayView.swift`, `TodayExtras.swift` (`TodayCardKey`: rhythm wird Teil von list; neue Keys
  `now`, `context`), `TasksTodayCard.swift`, `MindViews.swift`, `CheckinViews.swift`.
- Server: `server/lib/today.ts` (`calm` nur wenn Aufgaben, Liste, Bald-verbrauchen leer; ein `context`-Feld mit der
  einen Kontext-Karte nach Priorität), `GET/PUT /api/list/today-order` Keys migrieren (alte Keys still verwerfen).
  Tests: `test/today.test.ts`.
- Erster Start nach 5.6: Web `pages/Onboarding.tsx`, `onboarding-state.ts`, `pages/Tour.tsx`; iOS
  `Features/Start/FirstRunView.swift`, `Features/Help/AppTourView.swift`. Self-Host-Sprache: `server/` Instanz/erster
  Admin (`Accept-Language`), Tests `test/onboard.test.ts`, `test/tour.test.ts`.
- Abhängigkeit: D; A für die Tour-Karte „Oben rechts“ (Avatar überall).

### C · Einstellungen neu ordnen
- Web: `pages/Settings.tsx` in sechs Seiten (`/einstellungen/ich`, `/haushalt`, `/bereiche`, `/mitteilungen`,
  `/verbindungen`, `/daten`) mit Unterseiten; bestehende Karten-Komponenten wiederverwenden (`AuthSettings.tsx`,
  `AppearanceSettings.tsx`, `Modules.tsx`, `CalendarSync.tsx`, `Displays.tsx`, `DataSettings.tsx`, `DataWipe.tsx`,
  `Billing.tsx`, `AiSettings.tsx`, `PlacesSettings.tsx` …). Weiterleitung `?tab=` → neue Pfade.
- iOS: `Features/Settings/SettingsView.swift` (Liste der 6 Seiten), `Settings/Account/*`, `NotificationSettingsView`,
  `CalDavView`, `AISettingsView`, `Integrations/*`; „Ruhe & Fokus“ als eigener Screen.
- Doppelte Darstellung/Passwort entfernen (P2-2), Self-Host-Abo-Zeile (P2-8).
- Tests: Weiterleitungen, Gast sieht nur „Ich“; `docs/ui-audit.md` Routenliste in `scripts/audit-shared.mjs` anpassen.
- Abhängigkeit: D; A (Mehr zeigt nur noch „Einstellungen“).

### E · Bereichsseiten aufräumen
- Aufgaben (P1-5): Web `pages/Care.tsx`, iOS `Features/Household/CareView.swift` – Vorschläge nur im leeren Zustand,
  Ratgeber raus, Werkzeuge nach Mehr › Kopf & Fairness, Etiketten-Knopf raus.
- Kochen (P1-10, P1-12): Web `pages/Cook.tsx`, `WhatToEat.tsx`, `Decide.tsx`; iOS `Cooking/CookingView.swift`,
  `WhatToEatView.swift`, `IdeasDeck.swift`; Web-Küchenmodus (neue Seite, Wake-Lock) nach Tills Entscheidung.
- Zuhause/Vorrat (P1-15): Web `pages/Stock.tsx`, iOS `Pantry/PantryView.swift`.
- Einkauf (P1-13, P1-14, P2-3): Web `pages/Shopping.tsx`, `shop/claims.tsx`; iOS `Shopping/ShoppingView.swift`.
- Geld (P2-4): Web `pages/Money.tsx`, iOS `Money/MoneyView.swift`.
- Leere Zustände nach 5.5 in allen genannten Seiten.
- Abhängigkeit: D; A (Kopfzeile). Nicht anfassen: Wunschlisten-Seiten.

## 8. Offene Entscheidungen für Till

1. Tab-Etikett **„Zuhause“** (Vorrat + Hausinfo + Wissen + Wo ist was?) oder „Vorrat“ behalten und nur die Türen
   verschieben?
2. Ein Name für den Ein-Aufgaben-Modus: **„Nur eins“** oder „Eins nach dem anderen“?
3. Küchenmodus im Web nachbauen (Parität) oder bewusst „nur iPad“?
4. Geld-Karte auf Heute standardmäßig aus (Vorschlag) oder an?
5. Self-Host: Standardsprache Deutsch oder aus dem Browser?
