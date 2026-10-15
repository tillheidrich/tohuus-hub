# Zuhause-Modell: Orte, Klima, Haushaltsform

Stand: 11.10.2026 (Welle 6, Phase 4 „Von Haus zu Zuhause“). Grundlage: Briefing v3 Abschnitt 4 und 10, Audit `docs/design/2026-10-11-v3-audit.md` Abschnitt 4–5.

Kurz: Ein Haushalt hat genau die Orte, die er selbst anlegt. Kein Ort ist Pflicht, keiner wird erfunden. Ob etwas gekühlt oder gefroren ist, entscheidet das **Klima** eines Ortes, nicht sein Name. Die **Haushaltsform** (allein, zu zweit, Familie, WG) ändert nur Darstellung, Vorschläge und Wörter, nie Rechte.

## 1. Datenmodell

Tabelle `locations` (bestehend) bekommt mit der Named Migration **`places-1`** vier Spalten, nur `ALTER TABLE ADD COLUMN`, kein Umbau:

| Spalte | Bedeutung |
|---|---|
| `parent_id` | optionaler übergeordneter Ort (Keller › Gefriertruhe). FK mit `ON DELETE SET NULL`; beim Löschen über die API rücken Unterorte eine Ebene hoch (zum Großeltern-Ort). Zyklen werden abgewiesen und beim Start aufgelöst. |
| `climate` | `ambient` (Raumtemperatur), `chilled` (gekühlt), `frozen` (gefroren). `NULL` = noch nicht bestimmt → wird wie früher am Namen erkannt. |
| `archived` | 1 = aus allen Auswahlen verschwunden; was dort liegt, bleibt sichtbar (Liste, Bestand, Suche). |
| `owner_user_id` | optional: der Ort gehört einer Person („Fach von Jonas“ in der WG). Nur Anzeige, keine Sichtbarkeitsgrenze. |

`sort` gab es schon; die Reihenfolge ist jetzt in der UI änderbar (Pfeile, Ziehen am Desktop, `PUT /api/locations/order`).

`kind` bleibt das Vorlage-Merkmal: die sieben Basis-Keys (`fridge`, `freezer`, `pantry`, `shelf`, `kitchen`, `bathroom`, `utility`), dazu neu `cellar`, `chest-freezer`, `room`, `cupboard`, `rack`, `drawer`, `box`, `compartment`, `balcony`, `device`, und der Systemort `unassigned`. Für die Logik zählt `kind` nicht mehr, nur noch für Kategorien-Vorgaben und Startsets (Basis-Keys).

Warum `places-1` und nicht `home-1` wie im Audit: Der Name `home-1` gehört seit Welle 3 den Pflege-Tabellen (`server/lib/care.ts`). Ein zweiter `home-1` würde auf jeder bestehenden Instanz still übersprungen.

### Systemort „Noch keinem Ort zugewiesen“

`kind = 'unassigned'`, Klima `ambient`, Sortierung ganz hinten. Er wird **bei Bedarf** angelegt (`unassignedId()` in `server/lib/places.ts`), nie beim Start. Er ist versteckt, solange nichts darin liegt, nicht umbenennbar, nicht archivierbar, kein Elternort, nicht illustriert. Sein Name folgt der Haushaltssprache.

`firstLocationId()` (catalog.ts) liefert jetzt diesen Ort statt „erster Ort nach Sortierung“ oder eines erfundenen „Vorratsschranks“. Ein archivierter Standardort eines Produkts gilt beim Einbuchen ebenfalls als „kein Ort“.

### Einstellungen

| Key | Werte | Bedeutung |
|---|---|---|
| `household.form` | `single` · `couple` · `family` · `shared` · nicht gesetzt | Haushaltsform. Nicht gesetzt verhält sich wie `family` (= Verhalten vor Welle 6). |
| `home.preset` | `flat` · `terraced` · `house` · `shared` · `other` · `null` | „Wie wohnt ihr?“. Steuert nur Vorschläge und die Illustration. |
| `places.last` | `{ chilled: id, frozen: id }` | zuletzt benutzter Kühl- bzw. Gefrierort (Standard bei mehreren). |

`GET /api/me` liefert `home: { form, form_chosen, preset, ui: { claims, votes, invite_nudge, kids, guests, personal_places } }`.

## 2. Migration bestehender Installationen (z. B. Familieninstanz)

1. Beim ersten Start mit dem neuen Code legt `preMigrationBackup()` automatisch eine Kopie an (`backups/tohuus-<datum>-<zeit>-manual.db`).
2. `places-1` fügt die Spalten hinzu. Ids, Namen, Bestand, Gastlinks, Pflegeaufgaben, Bestätigungen bleiben unverändert.
3. `normalizeLocations()` füllt jedes `climate IS NULL` mit derselben Heuristik wie vorher:
   - gefroren: `kind = 'freezer'`, Icon `snowflake`, Name passt auf `/(freez|gefrier|tiefk|\btk\b)/i` oder ist ein Basisname des Gefrierorts (inkl. „Gefrierschrank“, „Frys“)
   - gekühlt: `kind = 'fridge'`, Name passt auf `/(fridge|kühlschrank)/i` oder ist ein Basisname des Kühlschranks („Kylskåp“)
   - sonst Raumtemperatur
4. Ergebnis (im Test mit einer echten Datenbank vom Stand `4f72f5b` belegt): `freezerLocationId()` und `fridgeLocationId()` liefern **dieselben Ids** wie vorher, die Menge der Gefrierorte ist identisch. „Truhe“ ohne Gefrierwort bleibt Raumtemperatur (war nie ein Gefrierort) und kann danach in Einstellungen › Orte auf „Gefroren“ gestellt werden.
5. Die Normalisierung läuft bei **jedem Start** (idempotent). Ein Restore wird vor dem Öffnen der Datenbank angewendet, also normalisiert auch der Neustart nach einem Restore.
6. Neue Installationen bekommen **keine** Orte mehr beim ersten Start (`ensureBaseData({ places: false })` in `server/index.ts`). Bestehende Haushalte sind davon nicht betroffen. Nur die Demo (`SEED_DEMO`, „Mit Demo-Daten erkunden“) legt die sieben neutralen Basisorte an. „Neu anfangen“ mit „Orte zurücksetzen“ legt keine Orte mehr an, nur die Kategorien.

Für die Familieninstanz heißt das konkret: nichts tun außer aktualisieren. Danach optional in Einstellungen › Orte: Haushaltsform „Familie“ wählen (ändert nichts, ist schon Standard), Keller-Gefrierschrank unter „Keller“ hängen, Klima prüfen.

### Restore-Falle

Ein JSON-Export von vor `places-1` bringt Orte ohne `climate`. Deshalb gilt: `NULL` heißt „erkennen“, **nie** `DEFAULT 'ambient'`. Test: `test/places-restore.test.ts`.

## 3. Wie Funktionen das Klima nutzen

Zentral in `server/lib/places.ts`:

- `climateOf(row)` – gespeichertes Klima oder Erkennung
- `frozenIds()` – alle gefrorenen Orte (auch archivierte, Bestand dort bleibt gefroren)
- `placesWithClimate(c)` / `hasClimate(c)` – auswählbare Orte (nicht archiviert, nicht Systemort)
- `defaultPlace(c, bevorzugt?)` – explizit gewählt › zuletzt benutzt › Basisort (gleiche Id wie früher) › erster
- `rememberPlace(id)` – merkt den zuletzt benutzten Kühl-/Gefrierort

| Funktion | Verhalten |
|---|---|
| Einfrieren (`fresh.freeze`) | Nur in einen gefrorenen Ort; optional `locationId`. Ohne Gefrierort klare 400-Meldung. |
| Auftauen | zurück an den Herkunftsort, sonst zum Kühlort, sonst Standardort, sonst „Noch keinem Ort zugewiesen“. |
| Reste (`addLeftovers`, Etiketten `saveBoxes`) | `location_id` wählbar (WG mit zwei Kühlschränken). Gekühlt ohne Kühlort → „Noch keinem Ort zugewiesen“ statt Fehler. Gefroren ohne Gefrierort → klare Meldung. |
| Reste-Sheet (Web) | Segment nur mit vorhandenen Klimazonen („Gekühlt“ / „Gefroren“), bei mehreren Orten einer Zone eine Auswahl „Welcher?“ (Standard: zuletzt benutzt). |
| Etiketten-Druck | druckt den echten Ortsnamen („Gefriertruhe“), sonst „Gekühlt“/„Gefroren“. `labelsMeta()` liefert `places.chilled/frozen`, `fridge_id`, `freezer_id`. |
| Produktseite | „Einfrieren & beschriften“ nur mit Gefrierort; Einfrieren-Knopf wie bisher nur bei `has_freezer`. |
| Urlaub (`away`) | `can_freeze` nur mit Gefrierort; Checkliste sagt dann nur „Aufbrauchen, was sonst schlecht wird“. |
| „Nur was ausgeht“ (`share`) | Gruppe „Gefrierfach“ nur mit Gefrierort; ohne Kühlort heißt die Kühl-Gruppe „Milch, Käse & Co.“. |
| Was essen wir? (`cook2`) | „im Kühlschrank“ nur, wenn die Reste wirklich gekühlt liegen. |
| Home Assistant | `/api/ha/v1/state` → `boxes.has_freezer`. Die Integration legt den Sensor „Eingefrorene Portionen“ nur an, wenn das Flag nicht `false` ist (ältere Server senden es nicht → Sensor bleibt). Wer später einen Gefrierort anlegt, lädt die Integration einmal neu. |
| Kiosk | unverändert datengetrieben (zeigt nur vorhandene Boxen). |
| Startsets | Kühl-/Gefrier-Startset auch für Orte, die nur über das Klima passen (z. B. „Truhe“). |
| Wo ist was? (`find`) | zeigt den Pfad („Keller › Gefriertruhe“). |
| Übersicht, Schnell-Check, Gast-/Kinder-Ortslisten | ohne archivierte Orte (außer es liegt noch etwas dort) und ohne leeren Systemort. |

## 4. Onboarding

`/willkommen`, Schritte (`server/lib/onboard.ts` `STEPS`):

1. **home** – Name, Sprache, „Wer wohnt hier?“ (Haushaltsform, optional). Kein Marken-/Look-Wähler mehr.
2. **where** – „Wie wohnt ihr?“: Wohnung · Reihenhaus · Haus · WG oder geteiltes Zuhause · Anders · Überspringen.
3. **places** – „Welche Orte möchtet ihr verwalten?“: Vorschläge je Wohnform (`GET /api/onboarding/place-templates?preset=`), alle **aus**, freie Eingabe, leere Auswahl erlaubt.
4. **spots** – optional „Wo werden eure Dinge aufbewahrt?“: Unterorte je Raum (Regal, Schrank, Schublade, Kiste, Kühlschrank, Gefrierfach, Gefriertruhe; in der WG zusätzlich „Mein Fach“), eigene mit Klima. Darunter „Du kannst jederzeit etwas hinzufügen oder ändern.“
5. **invite** – entfällt bei „Allein“; Text je Haushaltsform.
6. **stock** – wie bisher.

Zurück-Navigation ist echt: jeder Schritt zeigt den gespeicherten Stand (gewählte Orte als an, Unterorte entfernbar). Abgewählte, leere Orte werden gelöscht; Orte mit Bestand bleiben (Hinweis).

## 5. Haushaltsform in der App

| | allein | zu zweit | Familie | WG |
|---|---|---|---|---|
| „Wer holt’s?“ / „Wer kocht?“ / „Ich kümmere mich“ | aus | an | an | an |
| Abstimmungen | aus (laufende bleiben sichtbar) | an | an | an |
| Checkliste „einladen“, Einladeschritt | aus | „Partner einladen“ | „Familie einladen“ | „Mitbewohner einladen“ |
| Kinderbereich (Einstellungen › Mitglieder) | per Link einblendbar | per Link einblendbar | an | per Link einblendbar |
| Persönliche Orte („gehört …“) | – | – | – | Auswahl im Ort |
| Wort für die Mitglieder | Haushalt | Haushalt | Familie | WG |
| Tour-Texte | ohne „wer holt’s“, ohne Kinder | ohne Kinder | wie bisher | ohne Kinder |

Server: nichts wird nach Form verboten. Ausgaben pro Person in der WG gibt es seit Oktober 2026: „Wer hat bezahlt“ je Bon und Ausgabe (`paid_by`), Posten für eine Person (`for_user_id`), „Nur meins“ und die Monatsbilanz mit den wenigsten Überweisungen (`hhforms.ts`, docs/money.md).

## 6. API und MCP

- `GET /api/locations` (Auswahl/Listen), `GET /api/locations?all=1` (Einstellungen): Baumreihenfolge mit `depth`, `path`, `climate`, `archived`, `system`, `children`, `owner_name`, `product_count`.
- `POST /api/locations` `{ name?, key?, kind?, icon?, climate?, parent_id?, hint?, owner_user_id? }` (Vorlagen-Key bringt Icon/Klima)
- `PATCH /api/locations/:id` `{ name?, icon?, kind?, sort?, hint?, parent_id?, climate? (null = neu erkennen), archived?, owner_user_id? }`
- `DELETE /api/locations/:id` (409 solange etwas dort liegt)
- `PUT /api/locations/order` `{ ids }`
- `GET /api/locations/templates?preset=&spots=1`
- `GET/PUT /api/home/setup` `{ form?, preset? }`
- Onboarding: `PUT /api/onboarding/home|where|places|spots`, `GET /api/onboarding/place-templates`
- MCP: `get_home_setup`, `set_household_form`, `add_place`, `update_place`; `list_locations` liefert Klima und Pfad; die Server-Instruktion sagt „never assume a fridge or freezer“.

## 7. Tests

- `test/places-migration.test.ts` – echte alte Datenbank (`test/fixtures/places/old.db`, erzeugt mit dem Repo-Stand `4f72f5b` über einen temporären `git worktree`): Zeilenzahlen, Klima, gleiche Kühl-/Gefrier-Ids, Backup, Gastlinks, Pflegeaufgaben, Legacy-„Keller“.
- `test/places-restore.test.ts` – JSON-Export von vor der Migration, Neustart, Einfrieren funktioniert.
- `test/places.test.ts` – die drei Abnahme-Haushalte:
  - **A Einraumwohnung ohne Gefrierfach**: komplettes Onboarding mit leerer Auswahl; Bestand landet in „Noch keinem Ort zugewiesen“; nirgends Einfrieren (Etiketten, Produkt, Urlaub, Startgruppen, HA); Reste ohne Kühlschrank ohne Fehler.
  - **B WG**: Gemeinsame Küche › zwei Kühlschränke und eigene Fächer, Besitzer, Reste in den gewählten Kühlschrank, Reihenfolge, Archiv, Löschen eines Elternorts.
  - **C Reihenhaus**: Keller › Truhe (Klima gefroren, kein Gefrierwort) und Regal; Einfrieren in die Truhe, Auftauen zurück in den Kühlschrank; Vorlagen für die Wohnung enthalten keine Gefriertruhe.

## 8. Offene Punkte

- Die illustrierte „Als Zuhause“-Ansicht in Einstellungen › Orte nutzt `HomeArt` und eine einfache Raumliste; die eigentliche Illustration liefert der Design-Agent (gleiche Daten: `GET /api/locations` mit `depth`/`parent_id`).
- Ziehen zum Umsortieren nur am Desktop (HTML5 Drag & Drop) und nur innerhalb derselben Ebene; mobil die Pfeile. Umhängen in einen anderen Elternort über „Liegt in“.
