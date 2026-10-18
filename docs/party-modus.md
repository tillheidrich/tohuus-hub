# Party-Modus: eigener Schalter, zum Start aus (18.10.2026)

## Entscheidung

Till, 18.10.2026, nach Build 16: „Brauchen wir den Modus überhaupt?“ Für den Start nicht.

Der Party-Modus (Gäste bestellen per QR-Code, Küchen-Anzeige, TV-Anzeige mit Kopplungscode, Party-Karte,
Rückblick) ist Nische. Er passt nicht zum Kernsatz: „Ein Ort für den Haushalt: was fehlt, was ansteht, was zu tun
ist, was es kostet und was ihr übers Zuhause wisst.“ Er wird **nicht gelöscht**, sondern bekommt im Modul-Schalter
„Was nutzt ihr?“ einen eigenen Eintrag `party`, Standard **aus**.

Bleibt unverändert an: „Bring mir was“ (`treats`) und Gäste-Zugänge/Gäste-Links mit Bestellungen (`guests`).

## Was „aus“ bedeutet

| Ort | aus | an |
|---|---|---|
| Gäste-Seite (Web `/bar`, iOS `GuestsPartyView`) | Titel „Gäste“, keine Party-Karte, kein Filter „Party“ | „Gäste & Party“ mit Party-Karte |
| Bring mir was (Web `/bestellen`) | kein Reiter „Party“ | Reiter „Party“ |
| Mehr / Suche (Web `nav.tsx` `moreGroups`, iOS `HouseholdLinks`, `GlobalSearchView`) | Eintrag heißt „Gäste“ | „Gäste & Party“ |
| Benachrichtigungen (`modules.ts` `moduleOfEvent`) | `party.ending` und Party-Bestellungen (`kind: 'party'`) still | wie bisher |
| Onboarding „Was nutzt ihr?“ | Party wird gar nicht angeboten | – |
| Einstellungen › Haushalt › Was nutzt ihr? | Schalter „Party-Modus“ | – |

Heute-Karten: Party-Bestellungen standen dort schon nicht (`data.ts` filtert `party_id`), ein Party-Banner ist nicht
eingebunden. Die Server-Routen (`/api/parties`, `/api/party-board`) bleiben erreichbar, Daten bleiben erhalten; ein
laufender Link auf dem Fernseher funktioniert weiter.

## Migration

Keine SQL-Migration, sondern beim Lesen (`server/lib/modules.ts` `modules()`):

- Hat der Haushalt `party` schon gespeichert (an oder aus), gilt das.
- Sonst: `party` ist **an**, wenn es schon eine Party (laufend oder vorbei) oder eine gespeicherte Party-Karte
  (`party_templates`) gibt (`partyInUse()`), sonst **aus**.
- Sobald ein Admin irgendein Modul umschaltet, schreibt `setModules` den aktuellen Stand fest – auch `party`.

Tests: `test/modules-party.test.ts`.

## Web-Party: kleine Korrekturen trotzdem (gleicher Tag)

- **QR-Code verdeckt:** Auf dem Handy/hochkant (eine Spalte, QR oben) schwebte die Leiste Gäste/Küche/Glocke/Vollbild
  über dem QR-Code. Dort steht sie jetzt im Fluss über der Anzeige (`styles.css`, `.board-controls` unter
  `max-aspect-ratio: 4/3`). Im Querformat bleibt sie schwebend, der Titel rechts hält Abstand.
- **„Abholen an der Theke“ war fest:** Jede Party ist anders. Der Hinweis unter „Scannen & bestellen“ ist jetzt pro
  Party einstellbar (Spalte `parties.pickup_hint`, Migration `party-2`, `PATCH /api/parties/:id { pickup_hint }`,
  max. 80 Zeichen, leer = Standard). Standard neutral: „Wir sagen Bescheid, wenn es fertig ist“ / „We’ll let you know
  when it’s ready“. Eingabe in der laufenden Party (Web `Party.tsx` `PickupHintField`, iOS `GuestsPartyView`
  `PickupHintField`).

## Offen

- Hilfe-Texte (`HelpCenterView`, `Help.tsx`, Tour) nennen den Party-Modus noch ohne Hinweis auf den Schalter –
  Content-Bereich.
- Weitere „Theke“-Texte auf der Gästeseite der Party („Fertig an der Theke“) sind noch fest.
