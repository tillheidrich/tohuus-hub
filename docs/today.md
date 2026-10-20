# Heute (Paket B, 20.10.2026)

UX-Audit `docs/ux-audit-2026-10.md` Befund P0-2, Abschnitt 5.3. Gilt für Web (`web/src/pages/Today.tsx`) und iPhone
(`ios/ToHuus/Features/Today/TodayView.swift`), Cloud und eigener Server gleich. **Der Server wählt aus, die Clients
zeichnen nur** (`server/lib/today.ts › todayView`, Regeln in `server/lib/today-select.ts`).

## Was Heute zeigt

Kopf (Datum, Gruß, Plus, Lupe, Avatar) und höchstens **fünf** Karten, feste Reihenfolge:

| Karte | Key | Inhalt | sichtbar, wenn |
|---|---|---|---|
| Jetzt dran | `now` | meine Aufgaben aus `lib/next-task.ts` (überfällig, heute, „Mach ich“), höchstens „Heute höchstens“ (Einstellungen › Ich › Ruhe & Fokus, Standard 3, sanfter Modus 2), „n weitere“; mit „Nur eins“ die Ein-Aufgaben-Karte (Schalter „Nur eins“ rechts neben dem Titel, bei großer Schrift darunter) | es etwas gibt |
| Liste | `list` | Zahl, drei zuletzt dazugekommene, darunter „Bald wieder nötig“ als Chips (Tipp = auf die Liste) | etwas auf der Liste oder bald wieder nötig |
| Bald verbrauchen | `still` | höchstens drei: abgelaufen, läuft ab, Reste | es etwas gibt |
| Heute kochen | `cook` | geplant oder eine Idee | es etwas gibt (zählt nicht gegen die Ruhe) |
| Geld | `money` | Woche, Monat, Budget | **nur** wenn die Person es einschaltet (`focus.todayMoney`, Ruhe & Fokus) |
| Ein Hinweis | `context` | genau einer, immer zuletzt | es einen gibt |

- Mehr als fünf: Geld weicht dem Hinweis. „Karten anordnen“ verschiebt die ersten Karten (`today.order`, alte Keys
  `tasks → now`, `rhythm → list`, der Rest fällt weg); der Hinweis bleibt unten.
- **Ruhe-Karte** („Für heute ist alles Wichtige erledigt“) nur, wenn Jetzt dran, Liste, Bald verbrauchen und Hinweis
  leer sind. Kein Artikel darunter. Gäste bekommen sie nie.
- **Keine Formulare auf Heute.** Unter den Karten zwei kleine Einstiege: „Was habt ihr heute gelöst?“ (nur abends,
  wenn `lib/checkin.ts` fragen würde, öffnet ein Sheet) und „Was im Kopf?“ (öffnet Im Kopf).

## Der Hinweis (Priorität, `CONTEXT_PRIORITY`)

`occasion` (Wunschliste: Anlass naht) · `orders` (Bring mir was: jemand wartet auf mich) · `handover` („Übernimmst
du …?“: eine offene Übergabe-Anfrage an mich, `habits.ts offerTask`; Antwort unter Aufgaben) · `bins` (Tonne heute Abend
raus, Abfuhr morgen, `lib/task-outlook.ts`) · `imports` (Bon zu prüfen) · `budget` · `demo` (Beispieldaten, nur
Admins) · `trial` (Cloud, Testzeit ≤ 7 Tage oder vorbei, nur Admins) · `week` (Wochenrückblick Mo–Mi) · `pulse`
(Wochenfrage) · `start` (Erste Schritte, nur Admins). Web und iPhone zeigen `pulse`, `start` und `demo` mit ihren
eigenen kleinen Karten, alles andere als eine Zeile mit Ziel (`path`).

## Rechte

Dauerhafte Gäste: keine Geld-Karte, kein Hinweis, keine Ruhe-Karte, Jetzt dran nur mit übergebenen Aufgaben (abhaken
über `/api/guest-tasks`), Bald verbrauchen ab Stufe „stock“, Kochen ab „recipes“, „paused“ sieht nichts.
Gast-Links: keine Aufgaben, keine Hinweise. Private Aufgaben anderer erscheinen nie. Ausgeschaltete Bereiche („Was
nutzt ihr?“) verschwinden.

## API

`GET /api/today` liefert die bisherigen Felder (ältere Apps) und neu `cards`, `now { items, more, oneThing, gentle,
max, guest }`, `soonAgain`, `useSoon`, `context { kind, text, path, detail }`, `entries { checkin, mind }`,
`moneyOnToday`. `PUT /api/focus/prefs { todayMoney }`. Tests: `test/today-select.test.ts`, `test/today.test.ts`.

## Ersteinrichtung und Tour (gleich auf beiden Plattformen)

- Ersteinrichtung, 5 Schritte (`web/src/pages/Onboarding.tsx`, `ios/…/Start/FirstRunView.swift`): Wer gehört dazu? ·
  Was nutzt ihr? · Eure erste Liste (Einfügen, Foto, oder „Neu anfangen“ mit dem 30-Sekunden-Durchgang) · Wer kauft
  sonst ein? (nicht allein) · Alles bereit (Bon, Mitteilungen). Server-Schritte: `home · where · places · invite · stock`.
- Tour, 5 Karten (`web/src/pages/Tour.tsx`, `ios/…/Help/AppTourView.swift`, Version 4): Leiste & Zuhause · Lupe &
  Mehr · Plus & Assistent (KI freiwillig; auf dem iPhone mit den KI-Schaltern) · Nur eins · Was nutzt ihr?
- Simulator: `-debugNoTour` gilt jetzt auch ohne Wert und schlägt `-debugTour` (vorher nahm die Argument-Domäne das
  nächste Flag als Wert, die Tour kam trotzdem).
- Erster Start (eigener Server): Der Bildschirm „Möchtest du Beispieldaten …?“ hat eine Sprachwahl (vorbelegt mit
  der Sprache der Oberfläche). `POST /api/tour/start { choice, language }` setzt die Haushaltssprache vor dem Anlegen
  der Beispieldaten; das iPhone schickt seine App-Sprache mit. Test: `test/instance-lang.test.ts`.
