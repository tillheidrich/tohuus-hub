# Navigation: Bereiche, Leiste unten, „Mehr“

Stand 18.10.2026. Gilt für iPhone/iPad (`ios/ToHuus/App/MainTabView.swift`, `NavBarSettings.swift`) und Web
(`web/src/nav.tsx`, `web/src/navbar.tsx`, `web/src/App.tsx`).

## Standard

Heute · Einkauf · Kochen · Aufgaben · Vorrat in der Leiste unten (iPhone, Handy-Web). Höchstens fünf Plätze (Apple HIG:
drei bis fünf Tabs; ein sechster bringt den System-„Mehr“-Tab). Geld rückt nach, wenn Kochen oder Vorrat abgeschaltet
ist, sonst ist Geld die erste Zeile in „Mehr“. iPad-Seitenleiste und Desktop-Seitennavigation zeigen alle Bereiche.
Abgeschaltete Bereiche („Was nutzt ihr?“) und für Gäste gesperrte Bereiche erscheinen nirgends.

## „Deine Leiste“ (pro Person)

- **Heute** bleibt fest an Platz 1. Dazu bis zu **vier** Bereiche, in eigener Reihenfolge: Einkauf, Kochen, Aufgaben,
  Vorrat, Geld, Wissen (Haushaltswissen), **Bring mir was**, **Wünsche**, **Hausinfo**. Der Assistent
  bleibt der runde Knopf unten rechts und ist kein Bereich.
- Die zusätzlichen Bereiche (seit 18.10.2026) sind eigenständige Seiten, die man oft direkt braucht, die aber sonst in
  „Mehr“ (Wissen, Bring mir was) oder hinter einer Tür stecken (Wünsche oben in Einkauf, Hausinfo oben in
  Aufgaben). Wer Bring mir was jeden Abend nutzt oder WLAN-Code und Müllplan ständig braucht, holt sie nach unten.
  Nicht wählbar sind Seiten, die nur Werkzeug oder Einstellung sind (Personen, Urlaub, Wo ist was?, Etiketten …); eine
  unbekannte gespeicherte Id wird still verworfen.
- Bring mir was folgt dem Modul `treats` („Was nutzt ihr?“). Bring mir was fehlt auf dem iPhone außerdem im
  Ein-Personen-Haushalt (wie seine Zeile in „Mehr“).
- Auf **Heute** gibt es dazu die Karte „Bring mir was“ (Schlüssel `orders` in `GET/PUT /api/list/today-order`): offene
  Wünsche an dich und deine eigenen offenen Wünsche. Sie erscheint nur, solange etwas offen ist, und lässt sich dann wie
  jede andere Karte unter „Karten anordnen“ verschieben (Web `Today.tsx` OrdersCard, iOS `TodayCardKey.orders`).
- Alles, was nicht in der Leiste ist, steht oben in **„Mehr“** – nur die Hauptbereiche Einkauf, Kochen, Aufgaben, Vorrat,
  Geld. Die zusätzlichen Bereiche erscheinen dort nicht doppelt, sie behalten ihre Zeile oder Tür. Ist ein zusätzlicher
  Bereich in der Leiste, leuchtet er auf seinen Seiten (Web: `tabFor(path, own)`), sonst der Bereich, zu dem er gehört. Auf dem iPad und im Desktop-Web zeigt die Seitenleiste dann genau die eigene Leiste, die übrigen Bereiche
  folgen direkt darunter.
- Ist ein gewählter Bereich abgeschaltet, fällt er einfach weg (die Leiste wird kürzer, kein leerer Tab).
- **Wo einstellen:** Einstellungen › „Deine Leiste“ (iOS: Abschnitt Einstellungen in „Mehr“; Web: Mehr › Einstellungen ›
  „Deine Leiste“ = `/leiste`, außerdem als Karte unter Einstellungen › Mein Konto). Abkürzungen: **lange auf die Leiste
  drücken** (iPhone und Handy-Web; Desktop: Rechtsklick auf die Bereiche in der Seitenleiste) und **„Leiste anpassen“**
  in „Mehr“ (iOS: unter den Bereichen oben, Web: am Ende der Liste).
- Editor: Systemlook wie „Bearbeiten“ in iOS – Griff zum Ziehen, rotes Minus nimmt raus, grünes Plus holt rein, „Wie am
  Anfang“ setzt zurück. Web: Ziehen (Maus sofort, Finger nach langem Drücken, `dnd.ts`) plus Pfeil-Knöpfe als
  Alternative.
- Gäste (dauerhafte Gäste) haben keine eigene Leiste, sie bekommen immer den Standard.

## Speicherung

- Server: `user_prefs` Schlüssel `nav` (keine Migration nötig), `server/lib/nav-prefs.ts`.
  `GET /api/nav`, `PUT /api/nav { tabs: string[] | null }` (null = Standard), `GET /api/me` → `nav: { tabs, areas, slots }`.
  Unbekannte Ids werden still verworfen (ältere/neuere Apps), doppelte entfernt, höchstens vier.
- Ids überall gleich: `shopping, cooking, tasks, stock, money, knowledge, orders, wishes, houseinfo`
  (= `AppArea.rawValue` auf iOS). Pfade im Web: `/bestellen`, `/einkauf/wuensche`, `/hausinfo`.
- Offline: die Wahl wirkt sofort auf dem Gerät (iOS `UserDefaults` `nav.tabs`, Web `localStorage` `tohuus.nav`) und wird
  mit einem „pending“-Merker beim nächsten `/api/me` an den Server geschickt.
- Tests: `test/nav-prefs.test.ts` (Speicherung, API, pro Person), `test/nav-bar-web.test.ts` (Leiste, Seitenleiste, Mehr).

## Warum so (Recherche 18.10.2026)

Apples `TabViewCustomization` (iOS 18, `.sidebarAdaptable`) bearbeitet man über die Seitenleiste – die gibt es nur auf
dem iPad/Mac, auf dem iPhone bleibt die normale Leiste ohne Bearbeiten. Speichern läuft dort per `@AppStorage`, also pro
Gerät. Der alte UIKit-„Mehr › Bearbeiten“-Tab braucht einen sechsten Tab, was die HIG vermeiden will. Deshalb eigener
Editor nach dem Muster von Todoist (Browse fest, drei bis fünf Tabs, Ziehen zum Sortieren, „Standard wiederherstellen“),
gespeichert pro Person auf dem Server, damit iPhone und Web gleich aussehen.
