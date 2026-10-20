# Navigation: Bereiche, Leiste unten, „Mehr“

Stand 20.10.2026 (UX-Audit Paket A, `docs/ux-audit-2026-10.md` Abschnitt 5.1/5.2, Befunde P0-1, P1-6, P1-7). Gilt für
iPhone/iPad (`ios/ToHuus/App/MainTabView.swift`, `Features/Settings/MoreMenu.swift`, `Features/Home/HomeView.swift`,
`NavBarSettings.swift`) und Web (`web/src/nav.tsx`, `web/src/pages/More.tsx`, `web/src/home/HomeSwitch.tsx`,
`web/src/navbar.tsx`, `web/src/App.tsx`), in der Cloud und auf dem eigenen Server gleich.

## Standard

**Heute · Einkauf · Kochen · Aufgaben · Zuhause** in der Leiste unten (iPhone, Handy-Web). Höchstens fünf Plätze
(Apple HIG: drei bis fünf Tabs; ein sechster bringt den System-„Mehr“-Tab). Geld rückt nach, wenn Kochen oder der Vorrat
abgeschaltet ist, sonst steht Geld in Mehr › Alltag. iPad-Seitenleiste und Desktop-Seitennavigation zeigen alle
Bereiche, darunter die Gruppen von Mehr mit ihren Titeln. Abgeschaltete Bereiche („Was nutzt ihr?“) und für Gäste
gesperrte Bereiche erscheinen nirgends.

## Kopfzeile: Lupe und Avatar auf jeder Bereichsseite

- iPhone: `rootChrome()` (`Design/RootChrome.swift`) auf jedem Root-Screen, unverändert.
- Web-Handy: `RootChrome` in `App.tsx` über jeder Seite, deren Pfad eine Funktion im Register ist
  (`shared/functions.json › web`, z. B. `/einkauf`, `/kochen`, `/aufgaben`, `/bestand`, `/geld`, `/wissen`,
  `/hausinfo`, `/bestellen`, `/einkauf/wuensche`, `/kopf`, `/urlaub` …) und `/mehr/alle`. Heute hat Lupe und Avatar im
  eigenen Kopf, Mehr und die Einstellungen ihre eigene Suche. Desktop (≥ 960 px): ausgeblendet, die Seitenleiste hat
  Suche (⌘K) und Avatar.
- Der Avatar öffnet **Mehr**, die Lupe die globale Suche. Damit ist von jedem Tab aus alles in höchstens zwei Tipps da.

## Zuhause (Id `stock`)

- Tab-Name **Zuhause** / EN **Home**, Symbol Haus (Web `House`, iOS `house`; Heute hat im Web jetzt die Sonne wie auf
  dem iPhone). Id `stock`, Route `/bestand` (Alias `/zuhause`), gespeicherte Leisten bleiben gültig, keine Migration.
- Oben drei **beschriftete Türen** als große Kacheln (Symbol + Wort): **Hausinfo · Haushaltswissen · Wo ist was?** – die
  Gruppe `zuhause` des Registers, gefiltert nach Rolle, Gast-Stufe und „Was nutzt ihr?“. Bei drei Türen steht Hausinfo
  hoch links, die anderen beiden rechts übereinander; bei zwei nebeneinander, bei einer als ganze Zeile. Darunter der
  Vorrat mit eigener kleiner Überschrift „Vorrat“ (Web `page-subhead`, iOS Abschnitt in `PantryView`).
- iPhone: die Türen öffnen Sheets (Hausinfo, Haushaltswissen, Wo ist was? → Produkt), Web: Seiten. Simulator:
  `-debugTab stock -debugHomeDoor house|knowledge|find`.
- **Aufgaben hat keine Türen mehr.** Hausinfo ist in Zuhause, Urlaub & Übergabe in Mehr › Alltag.
- Haushaltswissen und Hausinfo bleiben als eigene Einträge in „Deine Leiste“ wählbar.
- Aktiver Tab (Web `tabFor`): `/hausinfo`, `/wissen`, `/wo`, `/abgleich`, `/scan` leuchten Zuhause an, außer der Bereich
  steht selbst in der eigenen Leiste.

## Einkauf: Tür „Wünsche“

Statt des Geschenk-Symbols ohne Text steht über der Liste eine beschriftete Tür **„Wünsche“** (Web `WishDoor` unter dem
Kopf, iPhone `DoorChip` oben rechts neben dem Sync-Hinweis; nicht im Laden-Modus, nicht für Gäste). Der Eintrag im
„…“-Menü der iPhone-Liste ist weg.

## Mehr

Eine Liste, auf iPhone und Web gleich, gebaut aus `shared/functions.json › more` (Web `moreMenu()` in
`web/src/search/functions.ts` → `nav.tsx moreGroups`, iPhone `MoreMenu.groups` in `MoreMenu.swift`):

| Gruppe | Zeilen (Reihenfolge) |
|---|---|
| **Alltag** | Wunschlisten & Geschenke · Geld · Bring mir was · Urlaub & Übergabe · Bons & Importe (Gäste: Übergabe) |
| **Zuhause** (nur wenn der Tab Zuhause nicht in der Leiste ist) | Hausinfo · Haushaltswissen · Wo ist was? |
| **Familie & Gäste** | Leute · Gäste · Für wen ich da bin |
| **Kopf & Fairness** | Im Kopf · Nur eins · Wer hat was im Blick · Denkarbeit-Check · Wochenrückblick |
| **Einstellungen & Hilfe** | Einstellungen · Hilfe · So funktioniert ToHuus · Gut zu wissen · Alle Funktionen |

Regeln (beide Plattformen identisch, `test/functions-registry.test.ts` und `test/nav-bar-web.test.ts` prüfen das):

- Höchstens **fünf** Zeilen je Gruppe (`more.max`); „Alle Funktionen“ (`/mehr/alle`, iOS `AllFunctionsView`) zeigt
  alles aus dem Register, was die Person nutzen darf – dort stehen Lieblinge, Du schenkst, Ausgaben im Detail,
  Jemanden einladen, Küchenmodus (iPad) usw.
- Eine Zeile erscheint nur, wenn die Rolle sie sieht (`roles`), die Gast-Stufe sie erlaubt (Web `guestAllows`, iOS
  `MoreAccess`) und ihr Bereich eingeschaltet ist. Wünsche, Geld, Leute, Kopf-Werkzeuge sehen Gäste nie.
- Was schon in der Leiste steht, erscheint nicht doppelt (z. B. Geld oder Wünsche in „Deine Leiste“). Im Desktop-Web und
  auf dem iPad gilt die Seitenleiste als Leiste.
- Bring mir was fehlt im Ein-Personen-Haushalt (Web `home.form === 'single'`, iOS `singleHousehold`).
- Hauptbereiche, die eine eigene Leiste weglässt, stehen ganz oben („Weitere Bereiche“); Geld hat dafür seine Zeile in
  Alltag.
- Einstellungen sind **eine** Zeile (sechs Seiten dahinter, `docs/settings.md`). Kein „Leiste anpassen“ mehr in Mehr:
  Deine Leiste steht unter Einstellungen › Ich und per langem Druck auf die Leiste.
- Nur iPhone: unter den Gruppen Rechtliches, Version, Feedback und das Fehlerprotokoll (App-Store-Pflicht), Beispieldaten,
  Abmelden. Web: Abmelden.

## „Deine Leiste“ (pro Person)

- **Heute** bleibt fest an Platz 1. Dazu bis zu **vier** Bereiche, in eigener Reihenfolge: Einkauf, Kochen, Aufgaben,
  Zuhause, Geld, Wissen (Haushaltswissen), **Bring mir was**, **Wünsche**, **Hausinfo**. Der Assistent bleibt der
  runde Knopf unten rechts und ist kein Bereich. Nicht wählbar sind Werkzeuge und Einstellungen; eine unbekannte
  gespeicherte Id wird still verworfen.
- Bring mir was folgt dem Modul `treats` und fehlt im Ein-Personen-Haushalt.
- Ist ein gewählter Bereich abgeschaltet, fällt er weg (die Leiste wird kürzer, kein leerer Tab).
- **Wo einstellen:** Einstellungen › Ich › Deine Leiste (`/leiste`) und **lange auf die Leiste drücken** (iPhone und
  Handy-Web; Desktop: Rechtsklick auf die Bereiche in der Seitenleiste).
- Editor: Griff zum Ziehen, rotes Minus nimmt raus, grünes Plus holt rein, „Wie am Anfang“ setzt zurück.
- Gäste (dauerhafte Gäste) haben keine eigene Leiste, sie bekommen immer den Standard.

## Speicherung

- Server: `user_prefs` Schlüssel `nav`, `server/lib/nav-prefs.ts`. `GET /api/nav`, `PUT /api/nav { tabs: string[] | null }`
  (null = Standard), `GET /api/me` → `nav: { tabs, areas, slots }`. Unbekannte Ids werden still verworfen, doppelte
  entfernt, höchstens vier.
- Ids überall gleich: `shopping, cooking, tasks, stock, money, knowledge, orders, wishes, houseinfo`
  (= `AppArea.rawValue` auf iOS). Im Register heißt `orders` `treats` (`areaFunction`, `MoreMenu.functionId`).
- Offline: die Wahl wirkt sofort auf dem Gerät (iOS `UserDefaults` `nav.tabs`, Web `localStorage` `tohuus.nav`) und geht
  beim nächsten `/api/me` an den Server.

## Warum so

- Recherche 18.10.2026 zu „Deine Leiste“: Apples `TabViewCustomization` gibt es nur in der iPad-Seitenleiste, der alte
  UIKit-„Mehr › Bearbeiten“-Tab braucht einen sechsten Tab. Deshalb eigener Editor, gespeichert pro Person.
- UX-Audit 20.10.2026: Mehr war im Handy-Web nur von Heute aus erreichbar, Hausinfo hing an Aufgaben, Wünsche waren ein
  Geschenk-Symbol ohne Text, und Mehr war auf iPhone und Web verschieden gebaut. Jetzt gilt: jede Funktion hat einen
  Namen (`docs/glossary.md`) und einen Hauptort, und beide Clients lesen Mehr aus derselben Datei.

## Bereichsseiten (Paket E, 20.10.2026)

Gilt für Einkauf, Kochen, Aufgaben, Zuhause und Geld, auf iPhone und Web, Cloud und eigener Server gleich.

- **Kopfzeile:** Titel, *eine* sichtbare Hauptaktion (Plus, Neu, Rezept, Produkt, Ausgabe; im Einkauf das Eingabefeld
  und der Schalter Liste/Im Laden), alles Seltene in **einem beschrifteten Menü „Werkzeuge“** (Web
  `web/src/area/AreaTools.tsx` als Sheet, iPhone `AreaToolsMenu` in `Design/AreaTools.swift`). Kein „…“ ohne Text.
- **Leere Zustände:** Symbol, ein Satz, ein Knopf (Web `AreaEmpty`, iPhone `EmptyStateView` ohne `message`).
- **Aufgaben:** zuerst „Jetzt dran“ (überfällig, heute), „Demnächst“, „Später“ (fünf, dann „Alle n zeigen“),
  „Zuletzt erledigt“ (drei). Darunter die Kacheln **Kopf & Fairness**: Wer hat was im Blick (`/aufgaben/blick`,
  iPhone `BlickView`), Denkarbeit-Check, Für wen ich da bin, Im Kopf, Wochenrückblick, Ideen & Vorlagen
  (`/aufgaben/ideen`, iPhone `TaskIdeasView`: die Vorschläge und Ratgeber-Artikel). „Nur eins“ bleibt oben.
  Werkzeuge: fällige teilen, Kalender, Etiketten. **Ein** Einstieg „Nur eins“ oben (Untertitel „3 Aufgaben, eine nach
  der anderen“, öffnet `/fokus`); „Was schaffst du heute?“ (Wisch-Stapel) ist seit 20.10.2026 darin aufgegangen.
- **Kochen:** Woche · Was kochen wir? · Rezepte (in dieser Reihenfolge). Start: „Woche“, wenn die laufende Woche
  (heute und die sechs Tage danach) mindestens einen Eintrag hat, sonst „Was kochen wir?“; eine von Hand gewählte
  Ansicht bleibt für die Sitzung (Web `area/cookStart.ts`, iPhone `CookStart`, Test `test/cook-start.test.ts`). Was kochen wir? zeigt jedes
  Rezept nur einmal (kein Streifen „Daraus könnt ihr heute kochen“, kein Abschnitt „Schnell“ – das ist ein Filter);
  „Ideen durchblättern“ ist ein eigener Einstieg (Sheet). Werkzeuge: Küchenmodus, Lieblinge, Rezept-Werkzeuge.
- **Küchenmodus im Web** (`/kochen/kueche`, `pages/KitchenMode.tsx`): Woche groß, Rezept Schritt für Schritt mit
  großer Schrift und Timern aus dem Schritt-Text (`area/durations.ts` = `CookTimers.durations` auf dem iPhone),
  Liste zum Abhaken; „Bildschirm bleibt an“ über die Screen Wake Lock API (pro Gerät gemerkt, an), „Vollbild“ auf
  Knopfdruck. Die Timer gibt es auch im Kochmodus eines Rezepts.
- **Zuhause:** Werkzeuge = Abgleich, Strichcode scannen, (iPhone: Reste einräumen, Box-Etikett scannen,) Gruppierung,
  Etiketten, Orte & Kategorien. Ab dem dritten Ort sind die Orte eingeklappt (Web), Status als Auswahl statt
  zweiter Chip-Reihe.
- **Einkauf:** Werkzeuge = So sieht die Liste aus, Beim Abhaken einräumen (Schalter, nicht mehr auf der Liste),
  Angebot, Neue Liste (iPhone zusätzlich Bon, Zettel-Foto, Übliche, Einfügen, Teilen, Läden).
  „Ich hol’s“ ist ein Wort, kein Hand-Symbol: die Hand bedeutet nur „Bring mir was“ (Befund P1-14).
- **Geld:** „+ Ausgabe“ sichtbar; Werkzeuge = Im Detail, Bons, Bon teilen, Neue Abrechnung, Kategorien & Teilen.

