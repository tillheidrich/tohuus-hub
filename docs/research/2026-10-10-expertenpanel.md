# Expertenpanel ToHuus Hub — simulierte Review (10.10.2026)

> **Art des Dokuments:** Simuliertes Panel aus acht Fachperspektiven plus Gegenstimme. Grundlage ist der Code-Stand in diesem Repo (README, `web/src/pages/*.tsx`, `server/lib/*.ts`, `server/routes/*.ts`, `server/mcp/server.ts`, DB-Schema in `server/db.ts`) und die laufende Demo-Instanz (`localhost:8099`, Marke „Fredirando", Sprache DE). Es wurde nichts am Code oder an den Daten geändert.
> Die „Experten" sind Rollen, keine echten Personen. Aussagen zu Verhalten von Nutzern beruhen auf gängigem Fachwissen, nicht auf eigenen Nutzertests. Wo das Panel etwas am Code festmacht, steht die Fundstelle dabei.

---

## 0. Was das Panel vorgefunden hat (Ist-Stand, kurz)

| Bereich | Stand im Code |
|---|---|
| **Heute** (`Today.tsx`) | Ein Bildschirm: läuft ab / leer / knapp, Einkaufsliste, Abendvorschlag, offene Importe, Gast-Bestellungen, „Zuletzt" (Bewegungen mit Akteur), Undo |
| **Bestand / Orte** (`Stock.tsx`, `Product.tsx`) | Orte mit Health-Meter, Zählmodi `count` / `level` (voll·halb·wenig·leer) / `none`, MHD je Charge, FEFO-Verbrauch, Umlagern, Verlauf, `opened_at` je Charge |
| **Einkaufsliste** (`Shopping.tsx`) | Live-Sync per SSE, Auto-Auffüllen bei „knapp", Abhaken → direkt in den Bestand, Teilen als Text, Herkunft (Rezept, Gast, Assistent, knapp) |
| **Importe** (`Imports.tsx`, `ImportReview.tsx`, `server/importers/rewe.ts`) | REWE Abholavis/Lieferavis/eBon mit Abgleich, Belege per QR-Link, Foto (Vision-Modell), Text, CSV; Review-Schritt; Preise werden geparst, aber nicht dauerhaft ausgewertet |
| **Kochen / Woche / Rezept** (`Cook.tsx`, `Week.tsx`, `Recipe.tsx`, `lib/plan.ts`, `lib/recipes.ts`) | Ranking nach Bestand, MHD, Favoriten, „lange nicht gekocht"; Swipe-Deck; Wochenplan mit Auto-Füllen, „Woche einkaufen", Verschieben; Cookidoo-Sync über HA-Kalender; Thermomix-Schritte |
| **Wo ist was** (`Find.tsx`, `lib/find.ts`) | Exakter Platz pro Artikel, Wegbeschreibung pro Raum, auch für nicht gezählte Dinge (Sicherungskasten, Thermometer) |
| **Gäste & Bar** (`Bar.tsx`, `Guest.tsx`, `routes/guest.ts`, `lib/orders.ts`) | Gastlinks mit Scopes `bar` / `stock` / `shopping`, Gültigkeit 1 Tag bis „für immer", QR-Code, Notiz (Notfallnummern), Widerruf; Bestellstatus neu → in Arbeit → serviert/abgelehnt; Bestand wird erst bei „serviert" abgebucht |
| **Vom Sofa bestellen** (`Order.tsx`) | Haushaltsmitglieder bestellen aus Bar-Menü **plus allem, was im Haus ist**, auch Freitext („Eine Decke bitte") |
| **Benachrichtigungen** (`lib/notify.ts`) | HA-Webhook, ntfy, beliebiger Webhook, E-Mail; Tages-Digest; pro Ereignis und Kanal schaltbar. **Kein Web-Push, kein Service Worker** (keine Offline-Fähigkeit) |
| **Integrationen** | HA-REST-Sensoren, `rest_command`, generiertes YAML-Paket; MCP-Server mit 23 Tools (`get_overview`, `search_stock`, `update_stock`, `mark_used_up`, `record_purchase`, `where_is`, `set_place`, `suggest_meals`, `plan_meal`, `fill_week`, `week_shopping`, …) |
| **Konten & Rollen** | Nur `admin` und `member`. Keine Kinder-/Eingeschränkt-Rolle, keine Zuständigkeiten, keine Aufgaben/Routinen |
| **Daten** | SQLite, JSON-Export (Admin), kein Import/Restore, keine eingebaute Backup-Routine |

**Was es bewusst nicht ist:** kein Aufgaben-/Chore-Manager, kein Familienkalender, kein Budget-Tool. Das ist für die Bewertung wichtig — mehrere Experten fordern genau das, die Gegenstimme hält dagegen (Abschnitt 10).

---

## 1. ADHS-Coach / Spezialistin für exekutive Funktionen

**Perspektive:** „Aus den Augen, aus dem Sinn" ist bei ADHS kein Spruch, sondern Mechanik. Ein System funktioniert nur, wenn es *ohne Tagesform* läuft: keine Pflege-Disziplin, wenig Entscheidungen, sichtbare Auslöser im Raum.

**Was gut ist**
- Die Grundidee „Bestand kommt über das rein, was ohnehin passiert" (Kassenbon, Abholavis, Barcode) ist das Beste, was man für ADHS-Haushalte tun kann. Das Datenpflege-Problem ist die Haupttodesursache solcher Apps — hier wird es an der Wurzel angegangen.
- **Heute**-Screen statt Navigation: ein Ort, eine Antwort auf „was ist jetzt dran?". Mit „Alles gut. Heute muss nichts nachgekauft werden" gibt es sogar ein Erfolgserlebnis statt einer endlosen Liste.
- Grobe Füllstände (voll/halb/wenig/leer) statt Gramm — das senkt die Einstiegshürde enorm.
- Abhaken auf der Einkaufsliste bucht direkt ein. Ein Schritt weniger = ein Abbruchpunkt weniger.
- Undo überall. Fehlerangst ist bei ADHS ein unterschätzter Abbruchgrund.
- „Wo ist was" entlastet das Arbeitsgedächtnis direkt.

**Was fehlt**
- **Externe Auslöser im Raum.** Die App lebt auf dem Handy, das Problem lebt am Kühlschrank. Es fehlt ein dauerhaft sichtbarer Bildschirm (Tablet/E-Ink am Kühlschrank) im „Kiosk-Modus" — das Gegenmittel zu „aus den Augen, aus dem Sinn".
- **Zeitgebundene Erinnerungen mit Kontext**, die nicht nur melden, sondern *eine* Handlung anbieten: „Mozzarella läuft morgen ab → [heute Abend Caprese planen] [einfrieren] [ist weg]". Die Benachrichtigungen existieren, aber ohne Aktionsknöpfe (außer im HA-Paket „Auf die Einkaufsliste").
- **Ein-Tap-Erfassung ohne Suche:** NFC-Tags/QR-Aufkleber am Vorratsregal („Nudeln alle" = Tag antippen). Jede Suche ist eine Entscheidung zu viel.
- **Tagesdigest mit maximal 3 Punkten**, priorisiert. Der Digest existiert, aber lange Listen werden ignoriert.
- **„Abend-Check" als Mini-Ritual** (30 Sekunden: Was ist morgen dran? Was taut auf?) — feste Uhrzeit, ein Screen, fertig.
- **Auftauen-Erinnerung:** Gefrorenes für morgen geplant → Erinnerung am Vorabend „aus dem TK nehmen". Klassischer ADHS-Fail.

**Was mich zum Abbrechen bringen würde**
- Wenn der Import-Review-Schritt bei jedem Einkauf 15 Entscheidungen verlangt. Er muss mit der Zeit *leiser* werden (gelernte Zuordnungen auto-bestätigen, nur Unsicheres zeigen).
- Benachrichtigungsflut. Ohne Bündelung und Ruhezeiten wird alles stummgeschaltet — und dann ist die App tot.
- Schuldgefühle durch rote Zahlen („3 abgelaufen") ohne Ausweg.

**Top 5 Forderungen**
1. Kühlschrank-/Wanddisplay-Modus (Kiosk, große Schrift, Auto-Refresh, kein Login-Timeout)
2. Aktionsknöpfe in jeder Benachrichtigung (einplanen / einfrieren / weg / auf Liste)
3. NFC-/QR-Regal-Tags für Ein-Tap-„alle"/„angebrochen"
4. Auftau-Erinnerung aus dem Wochenplan
5. Import-Review „lernt sich leise": sichere Zeilen automatisch übernehmen, nur Unklares zeigen

---

## 2. Paar- und Familientherapeutin (Mental Load, Konflikte um Haushalt)

**Perspektive:** Konflikte im Haushalt entstehen selten am Joghurt, sondern an Unsichtbarkeit: Eine Person *denkt* an alles (Planen, Merken, Nachkaufen), die andere *erledigt* auf Zuruf. Gute Werkzeuge machen Denkarbeit sichtbar, ohne Buchhaltung über den Partner zu führen.

**Was gut ist**
- Die geteilte Einkaufsliste mit Live-Sync verlagert das „Merken" aus einem Kopf in ein gemeinsames System. Das allein entschärft viele Streits („Ich hab dir doch gesagt…").
- Automatisches „knapp → auf die Liste" nimmt der denkenden Person genau die Arbeit ab, die sonst niemand sieht.
- Wochenplan mit „Woche einkaufen" bündelt die Planungsarbeit — einmal gemeinsam, statt täglich „Was essen wir?".
- „Vom Sofa bestellen" ist charmant, weil es Bitten spielerisch macht. Eine Bitte über die App fühlt sich weniger nach Vorwurf an.
- Bewegungen speichern einen Akteur (`movements.actor`). Die Datenbasis für Sichtbarkeit existiert also schon.

**Was fehlt / was ich kritisch sehe**
- **Zuständigkeit ohne Kontrolle.** Es fehlt ein leichtes „Ich übernehme das" (Einkauf, Kochen heute, Wochenplanung). Nicht als Aufgabenverwaltung, sondern als *Claim*: „Lea kocht Do", „Till kauft ein". Wer hat den Wochenplan gemacht? Wer hat die Liste abgearbeitet? Das sichtbar zu machen ist entlastend.
- **„Unsichtbare Arbeit" sichtbar machen — aber nicht als Rangliste.** Ein monatlicher, *gemeinsamer* Rückblick („Diesen Monat: 14 Einkäufe eingebucht, 22 Abende geplant, 9× gekocht — davon …") kann Gespräche öffnen. Eine Punkte-Rangliste zwischen Partnern würde ich dagegen ausdrücklich nicht bauen: Sie macht aus Kooperation Wettbewerb.
- **Die Bestellfunktion hat eine Schattenseite.** Wenn „vom Sofa bestellen" einseitig genutzt wird (eine Person bestellt, die andere bringt), zementiert das genau die Schieflage, die die App lösen will. Empfehlung: Beim Annehmen sieht man, *wer* annimmt; im Monatsrückblick taucht „wer hat wem was gebracht" neutral auf.
- **Notizen/Absprachen am Artikel** („Nicht anbrechen, ist für Samstag") — verhindert den Klassiker „Du hast den Kuchen für die Party gegessen".
- **Reservieren** von Bestand für einen geplanten Anlass oder ein Rezept.

**Was mich zum Abraten bringen würde**
- Jede Form von Scoreboard zwischen Erwachsenen, „Faulheits"-Statistik oder Benachrichtigungen wie „Till hat seit 5 Tagen nichts eingetragen". Das ist Überwachung, kein Mental-Load-Ausgleich.

**Top 5 Forderungen**
1. „Ich übernehme das" auf Wochenplan-Einträgen und Einkaufsliste (Name + Farbe, ein Tap)
2. Reservieren/„Finger weg"-Markierung an Bestand (mit Grund und Datum)
3. Gemeinsamer Monatsrückblick ohne Ranking (Gesprächsanlass, nicht Abrechnung)
4. Sichtbar, wer eine Bestellung angenommen/serviert hat
5. Wochen-Planungsritual: ein geführter 5-Minuten-Flow für Sonntag (Plan füllen → fehlende Zutaten → wer kauft)

---

## 3. UX-Researcher für mobile Familien-Apps

**Perspektive:** Haushalts-Apps sterben in Woche 1 (zu viel Setup) oder in Woche 3 (der Partner macht nicht mit). Ich schaue auf Onboarding, leere Zustände, den „Aha-Moment" und die Zweitnutzer-Adoption.

**Was gut ist**
- Leere Zustände sind durchdacht formuliert („Sobald etwas knapp wird oder das MHD naht, taucht es hier auf", „Was fehlt? z. B. Paketband"). Das ist besser als bei den meisten Wettbewerbern.
- Demo-Daten (`SEED_DEMO`) zeigen sofort, wie es gefüllt aussieht.
- Zwei Marken-Themes (sachlich „ToHuus" / verspielt „Fredirando") — Persönlichkeit ist ein Bindungsfaktor.
- PWA-Manifest vorhanden, damit installierbar.

**Was fehlt**
- **Kein Onboarding-Flow.** Nach dem ersten Login steht man vor einer leeren App mit 12 Bereichen. Es fehlt ein 3-Schritt-Start: (1) Orte bestätigen, (2) *ein* erster Import (Bon-Foto oder 10 Barcodes scannen), (3) Partner einladen. Erst danach ist der Aha-Moment erreichbar.
- **Partner-Einladung ist Admin-Formular-Arbeit** (Settings → Mitglieder → Name + Passwort ausdenken). Besser: Einladungslink/QR, der Partner wählt selbst sein Passwort. Zweitnutzer-Adoption entscheidet über die Lebensdauer — das ist der wichtigste Einzel-Hebel.
- **Kein Web-Push.** Benachrichtigungen setzen HA, ntfy oder SMTP voraus. Für Nicht-Bastler heißt das: keine Pushs, und damit auch keine Gastbestellungs-Meldung. Web-Push für installierte PWAs (iOS ab 16.4) wäre der normale Weg.
- **Kein Offline-Modus.** Im Supermarkt-Keller ohne Netz ist die Einkaufsliste weg. Ein Service Worker mit gecachter Liste und Offline-Abhaken (später synchronisieren) ist Pflicht für das wichtigste Feature.
- **Navigation:** Die Fülle (Heute, Orte, Bestand, Kochen, Woche, Finden, Importe, Scan, Bar, Bestellen, Einstellungen) ist für den Zweitnutzer zu viel. Rollen-abhängige Startansicht: Der Partner, der nur einkauft, sollte direkt auf der Liste landen.
- **Erfolgsmessung:** Ohne Telemetrie (bewusst so) braucht es lokale, nur für den Admin sichtbare Gesundheitsindikatoren („Letzter Import vor 12 Tagen — Bestand wahrscheinlich ungenau").

**Was mich zum Abbrechen bringen würde (als Nutzer)**
- Wenn der Bestand nach 2 Wochen nicht mehr stimmt und es keinen schnellen „Inventur-Modus" gibt, um einen Ort in 2 Minuten zu korrigieren. Dann verliert man das Vertrauen und hört auf.

**Top 5 Forderungen**
1. Onboarding in 3 Schritten mit erstem Import als Ziel
2. Einladungslink/QR für Haushaltsmitglieder (selbst gewähltes Passwort)
3. Web-Push für installierte PWA (ohne HA/ntfy)
4. Offline-Einkaufsliste (Service Worker, Sync-Queue)
5. Schnell-Inventur pro Ort („Kühlschrank durchgehen": Karte für Karte, wischen = stimmt / weniger / weg)

---

## 4. Hauswirtschafterin / Expertin für Lebensmittelverschwendung

**Perspektive:** Die meisten Lebensmittel werden in Privathaushalten verschwendet, und zwar überwiegend aus drei Gründen: falsch eingeschätzte Mengen, vergessene Reste, unklare Haltbarkeit nach dem Öffnen. FEFO (First Expired, First Out) muss im Alltag *passieren*, nicht nur in der Datenbank stehen.

**Was gut ist**
- FEFO-Verbrauch je Charge mit MHD — das ist korrekt gelöst und selten in Haushalts-Apps.
- `opened_at` pro Charge existiert bereits.
- Rezeptranking berücksichtigt Ablaufdaten. Das ist der eigentliche Hebel gegen Verschwendung: nicht warnen, sondern *einen Verwendungsweg anbieten*.
- „Woche füllen" aus dem Bestand und „Woche einkaufen" verhindert Doppelkäufe.
- Erkennung von Tiefkühlware aus Bon-Texten.

**Was fehlt**
- **Haltbarkeit nach dem Öffnen.** `opened_at` wird gespeichert, aber es gibt keine Regel „nach dem Öffnen x Tage" pro Produkt/Kategorie. Milch, Sahne, Pesto, Kokosmilch sind die Hauptverlierer im Kühlschrank.
- **Reste als eigene Objekte.** „Halbe Portion Chili, gekocht am Dienstag" ist kein Produkt aus dem Laden. Nach „gekocht" sollte gefragt werden: Reste? → Portionen, Ort (Kühlschrank/TK), automatisches Verbrauchsdatum (Kühlschrank 2–3 Tage, TK ~3 Monate). Reste gehören dann oben in „Heute" und ins Rezeptranking.
- **Einfrieren als Aktion.** „Läuft ab → einfrieren" muss ein Knopf sein, der den Artikel in den TK verschiebt, das Einfrierdatum setzt und das MHD auf eine TK-Frist umstellt.
- **MHD vs. Verbrauchsdatum.** Abgelaufenes MHD heißt nicht „wegwerfen". Die App zeigt „abgelaufen" rot. Besser: unterscheiden (MHD = „prüfen, riechen, schmecken", Verbrauchsdatum bei Hackfleisch/Fisch = wirklich weg). Kleines Feld, große Wirkung gegen unnötiges Wegwerfen.
- **Wegwerf-Protokoll.** „Weg (verdorben)" als eigener Grund statt nur „aufgebraucht". Erst dann lässt sich sehen, *was* regelmäßig verdirbt — und die Einkaufsmenge anpassen (z. B. „Ihr werft jeden zweiten Salatkopf weg").
- **Budget light.** Die Importe parsen Preise schon (`import_lines.price`). Daraus ließe sich ohne Mehraufwand ein Monatswert und „Wert der weggeworfenen Lebensmittel" ableiten. Kein Haushaltsbuch — nur diese zwei Zahlen.
- **Portionsplanung:** Rezepte für 4, Haushalt mit 2,5 Personen → Skalierung im Wochenplan.

**Was mich zum Abraten bringen würde**
- Wenn die App mit roten Warnungen zum Wegwerfen von MHD-Ware erzieht.

**Top 5 Forderungen**
1. Reste-Erfassung nach dem Kochen (Portionen, Ort, Frist) mit Vorrang in „Heute" und Rezeptranking
2. „Einfrieren"-Aktion mit TK-Frist und Auftau-Hinweis
3. Haltbarkeit nach dem Öffnen (pro Kategorie voreingestellt, pro Produkt überschreibbar)
4. Wegwerf-Grund und Monatsauswertung (Was verdirbt? Was hat es gekostet?)
5. MHD/Verbrauchsdatum unterscheiden, Formulierung „prüfen" statt „abgelaufen"

---

## 5. Home-Assistant- / Self-Hosting-Power-User

**Perspektive:** Ich lasse eine App nur dann auf meinem Server, wenn sie sich ins Ökosystem einfügt (HA, Backups, Reverse Proxy, Sprachassistent) und mir keine Wartung aufbürdet.

**Was gut ist**
- Docker, SQLite, ~60 MB RAM, keine Cloud, AGPL. Genau richtig.
- Das generierte HA-Paket (REST-Sensoren, `rest_command`, Automation mit actionable iOS-Push) ist vorbildlich — die meisten Apps lassen einen das YAML selbst schreiben.
- Cookidoo über den HA-Kalender anzuzapfen ist clever.
- MCP-Server mit 23 sinnvoll geschnittenen Tools — damit funktionieren Sprachassistenten auf LLM-Basis praktisch sofort.
- Webhook/ntfy/SMTP — offene Standards.
- SSE für Live-Updates statt Polling.

**Was fehlt**
- **Backups.** Es gibt einen JSON-Export, aber keinen Import/Restore, und der Export ist unvollständig (`meal_plan`, `movements`, `orders`, `users`, `imports` fehlen). Ich brauche: (a) nächtlichen SQLite-Snapshot (`VACUUM INTO`) in ein Volume mit Rotation, (b) vollständigen Export, (c) Restore. Ohne Restore ist ein Export kein Backup.
- **Sprachassistent ohne LLM:** HA Assist Intents („Ok Nabu, setz Milch auf die Einkaufsliste", „Wo ist das Pflaster?"). Der Weg geht über eine **HA-`todo`-Entität** für die Einkaufsliste — dann funktionieren Assist, Alexa/Google-Bridges und das HA-Dashboard automatisch. Ein REST-Sensor reicht dafür nicht; eine schlanke Custom Integration (HACS) oder ein CalDAV/`local_todo`-kompatibler Sync wären der Weg.
- **NFC-Tags:** `/api/ha/action` existiert schon. Es fehlt nur die Ergonomie: In der App einen Tag-Link pro Produkt/Aktion erzeugen („Tag schreiben: Kaffeebohnen alle"), der ohne Login über einen Token mit minimalem Scope funktioniert.
- **E-Ink-/Kiosk-Ansicht:** Eine statische, servergerenderte Seite (`/display?token=…`) mit Heute-Daten, die auch auf einem Kindle-Browser, einem TRMNL oder einem ESPHome-E-Paper läuft (PNG-Endpunkt mit festem Format 800×480 wäre ideal).
- **Mehr Ereignisse als Webhook/MQTT:** MQTT mit HA-Discovery würde Sensoren ohne YAML erzeugen. Nice-to-have, nicht Pflicht.
- **Healthcheck-Endpunkt** (`/healthz`) für Uptime Kuma/Docker.
- **OIDC/Forward-Auth** (Authelia, Authentik, Forgejo): Wer viele Dienste hat, will kein weiteres Passwort. Header-basierte Auth hinter dem Proxy ist günstig umzusetzen.
- **Prometheus-Metriken** — nur, wenn es nichts kostet.

**Was mich zum Abbrechen bringen würde**
- Datenverlust nach einem Update ohne Backup-Weg. Und Migrationen, die nicht dokumentiert sind.

**Top 5 Forderungen**
1. Automatische SQLite-Backups mit Rotation + vollständiger Export + Restore
2. Einkaufsliste als HA-`todo`-Entität (→ Assist, Sprachassistenten, Dashboards)
3. NFC-/QR-Aktionslinks mit Minimal-Scope-Token, erzeugbar in der App
4. Display-/E-Ink-Endpunkt (HTML + PNG, tokenbasiert, read-only)
5. `/healthz` und Forward-Auth/OIDC-Option

---

## 6. Privacy- & Security-Engineer

**Perspektive:** Haushaltsdaten sind intimer, als sie aussehen: Einkäufe verraten Gesundheit (Medikamente, Schwangerschaftstests), Religion (Ernährung), Anwesenheit (wer wann was isst) und Kinder. Gastlinks sind öffentliche Angriffsflächen.

**Was gut ist (ausdrücklich)**
- scrypt-Passwort-Hashes, Sessions und API-Tokens nur als SHA-256-Hash in der DB, httpOnly-Cookies.
- Rate-Limits auf Login (IP + Nutzer), Gastbestellungen und Gast-Einkaufsliste.
- CSRF-Schutz über Origin-Prüfung bei zustandsändernden Requests.
- SSRF-Schutz: Ausgehende Fetches auf Nutzer-URLs blockieren private Netze (`lib/net.ts`).
- Gastlinks sind sauber gescoped (`bar`, `stock`, `shopping`), zeigen im `stock`-Scope **nie Mengen**, haben Ablauf und Widerruf. Gast-SSE bekommt nur relevante Topics. Gast-Verbindungen sind gedeckelt (60).
- Keine Telemetrie. Token-Scopes `mcp`/`ha` sind gegeneinander abgegrenzt.

**Befunde (konkret, nach Schwere)**

| # | Befund | Fundstelle | Risiko | Empfehlung |
|---|---|---|---|---|
| S1 | **JSON-Export enthält Geheimnisse:** Tabelle `settings` mit `ha.token` (langlebiger HA-Token mit Vollzugriff aufs Smart Home) und `guest_links` mit Klartext-Tokens | `routes/core.ts` `/export.json` | Hoch, sobald die Exportdatei geteilt/synchronisiert wird | Geheimnisse beim Export maskieren oder separat (opt-in, Warnhinweis) |
| S2 | **Gastlink-Tokens im Klartext in der DB**, während Sessions/API-Tokens gehasht sind | `db.ts` `guest_links.token` | Mittel (DB-Leak → alle aktiven Gastlinks nutzbar) | Hash speichern; URL nur bei Erstellung anzeigen, QR jederzeit neu erzeugbar über „neu ausstellen" |
| S3 | **Gastlink-Bestellungen sind innerhalb eines Links für alle sichtbar:** `GET /api/guest/:token/orders` liefert die letzten 20 Bestellungen aller Gäste des Links (Namen, Positionen, Notizen); gefiltert wird nur im Client nach Namen | `routes/guest.ts`, `Guest.tsx` Zeile ~172 | Niedrig–mittel (Party: „wer trinkt wie viel", Notizen) | Pro Gerät ein Gast-Client-Token (Cookie) ausgeben; Bestellungen danach filtern |
| S4 | **Mitgliedernamen öffentlich abrufbar:** `GET /api/auth/users` liegt vor `requireAuth` | `routes/core.ts` Zeile ~78 | Niedrig (Nutzer-Enumeration, erleichtert gezieltes Raten) | Abschaltbar machen oder nur Farben/Initialen ohne Namen; Namen-Eingabe als Option |
| S5 | **Gastlinks „für immer"** (`days: 0`) möglich, ohne Hinweis | `routes/guest.ts` | Niedrig–mittel (ausgedruckter QR am Kühlschrank lebt ewig) | Für `bar` maximal Party-Dauer, „für immer" nur mit Warnung und nur für `stock`-Babysitterlinks; `last_seen_at` in der UI zeigen (wird bei jedem Aufruf gepflegt, aber in `Bar.tsx` nicht angezeigt) |
| S6 | **MCP-Token in der URL** (`/mcp/sw_…`) | README, `index.ts` | Mittel (URLs landen in Logs, Proxy-Logs, Screenshots) | Ist dokumentiert. Zusätzlich: „zuletzt benutzt" + IP-Herkunft anzeigen, Bearer als Standard empfehlen |
| S7 | **Bilder unter `/img` ohne Auth** | `index.ts` | Niedrig (Dateinamen enthalten Zufallsanteil) | Akzeptabel. Dokumentieren. Gilt aber auch für Fotos von Belegen? → Belegfotos nicht unter `/img` ablegen |
| S8 | **Kein Restore, kein Löschkonzept** | – | DSGVO-relevant, sobald Gäste/Babysitter Namen hinterlassen | Aufbewahrungsfrist für Bestellungen/Gastnamen (z. B. 30 Tage) und „Daten dieses Gastlinks löschen" |

**DSGVO-Einordnung (für Self-Hoster):** Ein reiner Familienbetrieb fällt unter die Haushaltsausnahme. Sobald die Instanz **gewerblich** genutzt wird (siehe Café-Persona) oder Fremde Namen eintragen, gelten Informationspflichten. Ein optionales Datenschutz-Snippet auf der Gastseite („Dein Name wird für X Tage gespeichert, um deine Bestellung zuzuordnen") kostet nichts.

**Was mich zum Abraten bringen würde**
- Ein Gastmodus, der den Haushalt nach außen öffnet (Party auf dem TV mit QR), ohne dass Gast-Tokens kurzlebig sind und ohne Kontrolle, was der Fernseher anzeigt.

**Top 5 Forderungen**
1. Export ohne Geheimnisse (S1) + vollständiger, verschlüsselbarer Backup-Export
2. Gast-Tokens hashen, `last_seen_at` anzeigen, „für immer" einschränken (S2, S5)
3. Gast-Client-Identität pro Gerät statt Namensfilter (S3)
4. Aufbewahrungsfristen für Bestellungen und Gastnamen (S8)
5. Party-Modus mit automatisch ablaufendem Token und getrenntem „Display-Token" (nur lesen)

---

## 7. Inhaber eines kleinen Cafés / Imbisses (leichte gewerbliche Nutzung)

**Perspektive:** Ich habe 20 Plätze, eine Siebträgermaschine, Kuchen aus der eigenen Küche und mache gelegentlich Catering. Kassensysteme sind teuer und überladen. Kann mir so etwas helfen?

**Was gut ist**
- Das Bestellsystem (Menü mit Optionen wie Hafermilch/Toppings, Notiz pro Position, Status neu → in Arbeit → serviert, Bestandsabbuchung bei „serviert") ist im Kern ein **Bestellbildschirm für eine kleine Theke**.
- QR-Link pro Tisch/Anlass ist mit Gastlinks bereits möglich.
- Wareneingang über Belegimport ist für einen Kleinbetrieb attraktiv (Metro/Selgros wären nötig, nicht REWE).
- Mindestbestand → Einkaufsliste ist genau, was ich für Milch, Bohnen, Becher brauche.

**Was fehlt (und ehrlich: was nicht kommen sollte)**
- **Rechtliche Grenze:** Sobald Geld fließt, brauche ich ein **TSE-zertifiziertes Kassensystem** (KassenSichV). ToHuus Hub darf keine Kasse werden — das wäre eine Haftungsfalle für den Entwickler und für mich. Ich würde es nur als *Bestell- und Lagerhilfe neben* der Kasse nutzen. Die Fredirando-Gags („Liefergebühr", „Mindestbestellwert") dürfen in einem Business-Kontext nicht wie echte Preisangaben wirken.
- **Küchenmonitor (KDS)** mit großen Kacheln, Zeitstempel „seit 4 min", Farbe nach Wartezeit, Tippen = nächster Status. Genau das, was auch eine Party braucht.
- **Tisch-/Platzbezug:** Gastlink = Tisch 4. Die Bestellung zeigt „Tisch 4" statt eines Fantasienamens.
- **Rezepturen mit Wareneinsatz:** Ein Cappuccino verbraucht 18 g Bohnen + 150 ml Milch. Die Abbuchung erfolgt heute 1:1 aufs Produkt „Cappuccino" (bzw. gar nicht bei `track_mode: none`). Für Party *und* Café wäre „Menüartikel → verbraucht Zutaten X, Y" der fehlende Baustein.
- **Tagesende-Bericht:** Was wurde wie oft bestellt? Was ging aus?
- **Mehrere Menüs/Karten** (Frühstück, Mittag, Event) — dasselbe wie das Party-Menü.
- **Allergenkennzeichnung** (14 Hauptallergene) am Menüartikel — gewerblich Pflicht, privat bei Kindergeburtstagen auch sehr hilfreich.

**Was mich zum Abbrechen bringen würde**
- Wenn ich Barcodes und Belege von Großhändlern nicht importieren kann und alles von Hand pflege.

**Top 5 Forderungen**
1. Küchenmonitor/Bestellboard (Vollbild, Wartezeit, Ein-Tap-Status)
2. Menüartikel mit Zutaten-Verbrauch (Stückliste)
3. Mehrere benannte Menüs (Karte pro Anlass)
4. Tisch/Platz an Gastlinks statt nur Gastname
5. Allergene am Menüartikel

> **Panel-Einordnung:** Das Café ist **nicht die Zielgruppe**. Die Persona ist trotzdem wertvoll, weil Küchenmonitor, Menüs, Stückliste und Allergene *genau* die Bausteine des Party-Modus sind. Bauen für die Party, nicht für das Café.

---

## 8. Großeltern / Babysitter — und ein 6-jähriges Kind

### 8a. Oma (72) / Babysitterin (17)

**Was gut ist**
- Der Babysitter-Link mit „Wo ist was" und Notiz (Notfallnummern, Schlafenszeit) ist die beste Einzelfunktion für mich. Ich muss nicht fünfmal anrufen, wo der Fiebersaft steht.
- Keine Mengen, keine Einkäufe sichtbar — ich fühle mich nicht, als würde ich in fremden Schränken wühlen.
- Kein Login, kein App-Store.

**Was fehlt**
- **Große Schrift und eine Seite**, die alles Wichtige zeigt: Notfallnummern oben (antippbar zum Anrufen), dann „Abendessen heute", „Schlafenszeit", „Was darf das Kind essen/nicht essen (Allergien)".
- **Fotos vom Ort** („So sieht der Schrank aus, das Pflaster ist links oben") — eine Wegbeschreibung reicht vielen nicht.
- **Was gibt's heute zu essen?** Den Wochenplan-Eintrag für heute samt „steht im Kühlschrank, 20 min bei 180 °C" auf dem Babysitter-Link anzeigen.
- **Ich will melden können:** „Saft ist alle" (Scope `shopping` gibt es — gut) und „Kind hat um 19:30 gegessen, schläft seit 20:15" (kleines Protokoll für die Eltern). Letzteres ist Scope-Creep-Gefahr; siehe Gegenstimme.

### 8b. Das Kind (6 Jahre) — übersetzt durch eine Kita-Pädagogin

**Was ein Kind will:** Bilder statt Wörter, selbst etwas tun dürfen, sofort sehen, dass es geklappt hat.

**Was gut ist**
- Produktfotos aus Open Food Facts und große Kacheln im Bestellmenü — ein Kind kann „Eis" erkennen, ohne zu lesen.
- „Vom Sofa bestellen" ist für Kinder ein *Spiel*. Das ist ein echter Adoptionstreiber in Familien.

**Was fehlt**
- **Kindermodus (eigene, eingeschränkte Ansicht):** nur Bilder, maximal 6–9 Kacheln aus einem von den Eltern freigegebenen Kinder-Menü (Apfel, Joghurt, Wasser, Eis *nur* nach Freigabe), kein Freitext, Status als Bild (Koch-Animation → „Kommt!"). Bestellungen mit Status „Eltern fragen" statt direkter Abbuchung.
- **Mengen-/Zeitregeln:** „Süßes nur 1× am Tag", „Eis erst nach dem Abendessen" — sonst wird das Feature zur Quengelmaschine. Hier steckt Konfliktpotenzial für die Eltern.
- **Aufgaben mit Sternen?** Das Kind möchte „Tisch decken ⭐" abhaken. Die Pädagogin ist skeptisch: Belohnungssysteme für Hausarbeit verschieben Motivation nach außen. Wenn, dann als *Mitmach-Liste* („Hilf mir: Tisch decken, Brot holen aus der Speisekammer") ohne Punktekonto. Die Gegenstimme lehnt es ab (Abschnitt 10).
- **Vorlesen:** Kachelnamen per Sprachausgabe (Web Speech API, kostet fast nichts).

**Top 5 Forderungen (8a + 8b zusammen)**
1. Babysitter-Seite mit Notfallnummern oben (tel:-Links), heutigem Essen, Allergien
2. Fotos von Orten/Fächern in „Wo ist was"
3. Kindermodus: Bildkacheln, freigegebenes Kinder-Menü, „Eltern fragen"-Status
4. Regeln pro Kinder-Menüartikel (z. B. 1× pro Tag / nur zu bestimmten Zeiten)
5. Vorlesefunktion für Kacheln

---

## 9. Gesamt-Synthese

### 9.1 Konsens-Top-15

Gewichtet nach: wie viele Experten es fordern, Nutzen für den Kernzweck („weniger Reibung zwischen den Erwachsenen, Haushalt ohne Tagesform"), und Aufwand im bestehenden Code. Aufwand: **S** = baut auf Vorhandenem auf, ein Arbeitsblock · **M** = neue Tabelle/Ansicht, zwei bis drei Blöcke · **L** = neues Teilsystem.

| # | Feature | Gefordert von | Aufwand | Warum |
|---|---|---|---|---|
| 1 | **Party-/Gastmodus** (Party starten, QR auf TV, Live-Bestellboard, Party-Menü, Auto-Ende) | Café, Kind, Security, UX, Therapeutin | M | Wunsch des Owners; bündelt Küchenmonitor, Menüs, kurzlebige Tokens. Details in 9.4 |
| 2 | **Backups: nächtlicher SQLite-Snapshot + vollständiger Export + Restore** | HA, Security, UX | S–M | Ohne Restore kein Vertrauen; Voraussetzung für alles andere |
| 3 | **Export ohne Geheimnisse; Gast-Tokens hashen; „zuletzt benutzt" anzeigen** | Security | S | Klarer Befund (S1/S2/S5), wenig Code |
| 4 | **Web-Push für die PWA** (ohne HA/ntfy) | UX, ADHS, Party, Oma | M | Ohne Push funktioniert weder Bestellung noch Erinnerung für Nicht-Bastler |
| 5 | **Aktionsknöpfe in Benachrichtigungen** (einplanen / einfrieren / weg / auf Liste) | ADHS, Hauswirtschaft | S (HA) / M (Web-Push) | Benachrichtigung → Handlung statt → Schuldgefühl |
| 6 | **Einladungslink für Haushaltsmitglieder** | UX, Therapeutin | S | Zweitnutzer-Adoption ist der größte Hebel für Langlebigkeit |
| 7 | **Kiosk-/Wanddisplay-Modus** (Tablet + E-Ink/PNG, tokenbasiert, read-only) | ADHS, HA, Party, Café | M | Sichtbarer Auslöser im Raum; derselbe Baustein wie das Party-Board |
| 8 | **Reste erfassen nach „gekocht"** (Portionen, Ort, Frist) | Hauswirtschaft, ADHS | M | Größter Hebel gegen Verschwendung; Kochlog existiert |
| 9 | **„Einfrieren"-Aktion + Haltbarkeit nach Öffnen** | Hauswirtschaft, ADHS | S–M | `opened_at` und Umlagern existieren schon |
| 10 | **Offline-Einkaufsliste** (Service Worker + Sync-Queue) | UX | M | Wichtigste Funktion darf im Supermarkt nicht ausfallen |
| 11 | **„Ich übernehme das"** auf Wochenplan und Einkaufsliste | Therapeutin, ADHS | S | Zuständigkeit sichtbar, ohne Aufgabenverwaltung |
| 12 | **Einkaufsliste als HA-`todo`-Entität** (→ Assist/Sprachassistenten) | HA, ADHS | M | Sprachbedienung ohne LLM; Dashboards kostenlos |
| 13 | **NFC/QR-Aktionslinks** pro Produkt („alle", „angebrochen") | ADHS, HA | S | Endpunkt existiert, nur Token-Scope + UI fehlen |
| 14 | **Kindermodus mit Bildkacheln und Freigabe** | Kind, Oma, Therapeutin | M | Adoptionstreiber in Familien; nutzt Party-Menü-Baustein |
| 15 | **Schnell-Inventur pro Ort** (Karten wischen) | UX, Hauswirtschaft, ADHS | S–M | Rettet den Bestand, wenn er „driftet" — sonst stirbt die App |

Knapp dahinter: Wegwerf-Grund + Monatsauswertung (inkl. Preise aus Importen), Babysitter-Seite mit Notfallnummern oben und heutigem Essen, Fotos von Orten, Allergene am Menüartikel, Reservieren von Bestand, Import-Review „lernt sich leise", Auftau-Erinnerung, OIDC/Forward-Auth, `/healthz`.

### 9.2 Konflikte zwischen den Experten

| Konflikt | Positionen | Empfehlung des Panels |
|---|---|---|
| **Sichtbarkeit vs. Überwachung** | Therapeutin will Arbeit sichtbar machen; dieselbe Therapeutin + Security warnen vor Scoreboards | Nur *gemeinsame* Rückblicke ohne Ranking, keine Personen-Statistik in Pushs. „Wer hat übernommen" ja, „wer war faul" nie |
| **Kinder-Sterne** | Kind will Sterne; Pädagogin skeptisch; Gegenstimme dagegen | Keine Punktekonten. Höchstens eine Mitmach-Liste im Kindermodus, und erst in Welle 3 |
| **Benachrichtigungen** | ADHS-Coach will externe Auslöser; derselbe Coach warnt vor Flut | Bündeln, Ruhezeiten, max. 3 Punkte im Digest, jede Meldung mit Aktion |
| **Café vs. Familie** | Café will Stückliste, Allergene, Tagesbericht, Tische | Bauen, *soweit es der Party dient* (Board, Menüs, Allergene). Keine Kasse, keine Preise, keine Tagesabschlüsse |
| **Offenheit des Gastmodus vs. Sicherheit** | Party/UX: QR am TV, kein Login; Security: kurzlebige Tokens, getrennte Display-Rechte | Party-Token läuft automatisch ab; Display-Token kann nur lesen; Bestellungen pro Gerät statt Namensfilter |
| **Babysitter-Protokoll** | Oma will melden können („schläft seit 20:15") | Gegenstimme: Das ist eine Babyphone-/Messenger-Funktion. Nur Notiz-Feld → Push an Eltern, kein Protokoll-System |
| **HA-tiefe Integration vs. Einfachheit** | Power-User: MQTT, HACS-Integration, Prometheus; UX: Nicht-Bastler brauchen Web-Push | Web-Push zuerst (breiter Nutzen), dann `todo`-Entität; MQTT/Prometheus vorerst nicht |
| **Budget** | Hauswirtschaft will Geldwerte; Gegenstimme: kein Haushaltsbuch | Nur zwei Zahlen aus vorhandenen Importpreisen (Monatseinkauf, Wert verdorbener Ware). Keine Kategorienbudgets |

### 9.3 Umsetzungsreihenfolge in drei Wellen

Gedacht in Arbeitsblöcken, nicht in Personentagen.

#### Welle 1 — hoher Nutzen, geringer Aufwand (Fundament + Party-MVP)

| Block | Inhalt |
|---|---|
| 1.1 | **Sicherheits-Hygiene:** Export ohne `ha.token` und Gast-Tokens (oder opt-in mit Warnung); Gast-Tokens hashen; `last_seen_at` (wird schon gepflegt) in `Bar.tsx` anzeigen; „für immer" nur mit Warnung; `/api/auth/users` abschaltbar |
| 1.2 | **Backups:** nächtliches `VACUUM INTO` in `/data/backups` mit Rotation (z. B. 7 Tage + 4 Wochen), vollständiger Export (alle Tabellen), Restore-Endpunkt (Admin, mit Bestätigung) |
| 1.3 | **Party-Modus MVP** (siehe 9.4, Stufe 1): Party-Objekt mit Start/Ende, Party-Menü als Auswahl aus Bar-Artikeln, kurzlebiger Gast-Token, Vollbild-Board `/party/:id/board` mit großem QR und Bestellkacheln, Auto-Ende |
| 1.4 | **Einladungslink** für Haushaltsmitglieder (einmalig, 48 h, Passwort wird selbst gewählt) |
| 1.5 | **„Ich übernehme das"** auf Wochenplan-Einträgen und Einkaufsliste (Spalte `claimed_by`, Farbe aus `users.color`) |
| 1.6 | **NFC/QR-Aktionslinks:** Token-Scope `action:<product>:<verb>`, Seite „Tag-Link erzeugen" am Produkt |
| 1.7 | **„Einfrieren"-Knopf** (Umlagern in TK + Einfrierdatum + TK-Frist) und Haltbarkeit-nach-Öffnen-Default pro Kategorie |

#### Welle 2 — mittlerer Aufwand, hoher Alltagsnutzen

| Block | Inhalt |
|---|---|
| 2.1 | **Web-Push** (VAPID, Service Worker), pro Mitglied und Ereignis; Aktionsknöpfe (einplanen / einfrieren / weg / auf Liste / Bestellung annehmen) |
| 2.2 | **Offline-Einkaufsliste** (gleicher Service Worker, IndexedDB-Queue) |
| 2.3 | **Kiosk/Display:** `/display?token=…` (HTML, Auto-Refresh, Nachtmodus) + `/display.png` (800×480, E-Ink-tauglich) |
| 2.4 | **Reste** nach „gekocht" (Portionen, Ort, Frist) inkl. Vorrang in „Heute" und Rezeptranking |
| 2.5 | **Party-Modus Stufe 2:** Stückliste für Menüartikel (Cocktail → Zutaten), Allergene, mehrere gespeicherte Party-Menüs, Bestellung pro Gerät statt Namensfilter, Party-Rückblick |
| 2.6 | **Schnell-Inventur** pro Ort; **Onboarding** in 3 Schritten |
| 2.7 | **Wegwerf-Grund** + Monatsrückblick (gemeinsam, ohne Ranking; inkl. Preise aus Importen) |

#### Welle 3 — größere Teilsysteme, erst wenn Welle 1–2 im Alltag tragen

| Block | Inhalt |
|---|---|
| 3.1 | **Kindermodus** (Bildkacheln, Kinder-Menü, Freigabe, Regeln, Vorlesen) — baut auf Party-Menü + Board auf |
| 3.2 | **HA-`todo`-Entität / HACS-Integration** (Assist, Sprachassistenten) |
| 3.3 | **Babysitter-Seite 2.0** (Notfallnummern als tel:-Links oben, heutiges Essen, Allergien, Ortsfotos) |
| 3.4 | **OIDC/Forward-Auth**, `/healthz` |
| 3.5 | Optional: Import-Review „lernt sich leise" (Auto-Übernahme sicherer Zeilen), Auftau-Erinnerung aus dem Wochenplan, Reservieren von Bestand |

### 9.4 Party-/Gastmodus — konkrete Designempfehlungen

**Ausgangslage im Code:** Gastlinks (`guest_links`) mit Scope `bar`, Bestellungen (`orders`, `order_lines`) mit Status `new → accepted → done/declined`, SSE-Live-Updates (auch für Gäste), QR-Code in `Bar.tsx`, Bestandsabbuchung bei `done` (nur `count`-Artikel), Rate-Limit 15 Bestellungen / 10 min pro Link, max. 60 Gast-SSE-Clients. **Was fehlt:** ein Anlass-Objekt, ein Party-spezifisches Menü, eine Anzeige für den Raum, ein definiertes Ende.

#### A. Datenmodell (minimal)

```
parties
  id, name ("Leas 35."), status ('planned'|'live'|'ended'),
  starts_at, ends_at (geplant), ended_at,
  auto_end_after_idle_min (Default 90),
  guest_link_id → guest_links (kurzlebig, scope ['bar'], an die Party gebunden),
  display_token_hash (nur Lesen fürs Board),
  menu_id → party_menus, settings JSON (Gastnamen Pflicht?, Mengenbegrenzung …)

party_menus            party_menu_items
  id, name               menu_id, product_id | free_item_name,
  ("Grillabend",          group ("Drinks", "Cocktails", "Kids"),
   "Kindergeburtstag")    sort, max_per_guest, options JSON,
                          components JSON [{product_id, qty}]   ← Stückliste (Stufe 2)
                          allergens JSON                         ← (Stufe 2)

orders: + party_id, + client_id (Gerät), + accepted_by (user_id)
```

Bestehende Gastlinks bleiben für Babysitter/Dauerlinks. Party-Links sind ein *Sonderfall*, der automatisch entsteht und automatisch stirbt.

#### B. Ablauf für den Gastgeber (3 Taps)

1. **Bar → „Party starten"**: Name, Menüvorlage wählen (oder „aus dem, was da ist" vorschlagen: alle `orderable`-Artikel mit Bestand > 0), geplantes Ende (Default: heute 23:59 + Idle-Ende 90 min).
2. App zeigt **zwei Dinge**: „Auf dem Fernseher öffnen" (Board-URL + kurzer Koppel-Code, z. B. 4 Ziffern, damit man auf dem TV-Browser keine lange URL tippen muss) und „QR teilen".
3. Laufende Party erscheint als **Banner auf „Heute"** mit Zähler offener Bestellungen und „Party beenden".

#### C. Das Board (TV / Tablet / Küchendisplay)

- **Zwei Layouts**, umschaltbar per Taste/Tipp:
  - **Gäste-Ansicht (TV im Wohnzimmer):** großer QR-Code (≥ 30 % der Fläche, Fernlesbarkeit), Party-Name, „Scan & bestellen", rotierende Menü-Highlights mit Fotos, Lauftext „Gerade bestellt: 2× Aperol Spritz für Jana" (Gastname abschaltbar → Privatsphäre).
  - **Küchen-Ansicht (Tablet an der Theke):** Kanban mit drei Spalten *Neu · In Arbeit · Fertig zum Abholen*, Kacheln mit großer Schrift, Wartezeit „seit 4 min" mit Farbumschlag (grün < 5 min, gelb < 10, rot ≥ 10), Tippen = nächster Status, Wischen = ablehnen mit Kurzgrund („ist alle").
- **Display-Token** ist read-only für die Gäste-Ansicht. Die Küchen-Ansicht braucht Schreibrechte → nur mit Mitglieds-Session *oder* einem eigenen, an die Party gebundenen Kitchen-Token, das mit der Party endet.
- **Technik:** bestehender SSE-Bus, eigenes Topic `party`; Wake-Lock-API, damit das Tablet nicht einschläft; Ton/Vibration bei neuer Bestellung (abschaltbar); funktioniert ohne Installation in jedem Browser (Fire-TV-Silk, Smart-TV-Browser, Chromecast via Tab-Casting).
- **E-Ink-Variante** nicht für die Party (zu träge), aber das Board-Layout als PNG ist in Welle 2 ohnehin für das Display gebaut.

#### D. Gastseite (Handy nach QR-Scan)

- Kein Login, Name einmal (oder optional „anonym" + Emoji-Avatar). Name und **Client-ID im Cookie** → „Meine Bestellungen" serverseitig gefiltert (behebt S3).
- Party-Menü in Gruppen mit Fotos, Optionen (bestehend), **„nur noch wenige"** (bestehend) und **„alle"** live per SSE ausgegraut.
- **Statusanzeige** großformatig: „Angekommen → Wird gemacht → Abholbereit an der Theke" — bei Party ist „Abholen" realistischer als „wir bringen's".
- **Begrenzungen** pro Gast und Artikel (`max_per_guest`) statt nur des globalen Rate-Limits; für Kindergeburtstage wichtig („max. 2 Eis").
- **Allergene/vegan** als Filter (Stufe 2).
- Fredirando-Gags (Liefergebühr „ein Lächeln") bleiben als Theme, aber nie als echte Preisangabe.

#### E. Bestand & Stückliste

- **Stufe 1:** Abbuchung wie heute bei „serviert/abgeholt", plus **weiche Reservierung**: Offene Bestellungen ziehen den verfügbaren Bestand im Menü ab, damit nicht drei Gäste die letzte Flasche bestellen.
- **Stufe 2:** Menüartikel mit `components` (z. B. Aperol Spritz = 60 ml Aperol (`level`-Artikel → eine Stufe pro x Bestellungen), 90 ml Prosecco, Soda). Für `level`-Artikel: nach N Bestellungen Hinweis „Aperol prüfen?" statt exakter Rechnung — passt zur Philosophie „grob, wo grob reicht".
- **Getränkevorrat-Warnung während der Party:** „Bier: noch 4" an die Gastgeber (Push), nicht an die Gäste.

#### F. Auto-Ende & Aufräumen

- Ende tritt ein bei: geplantem Ende **oder** Idle-Zeit ohne Bestellung (Default 90 min) **oder** manuell. 15 min vorher: Push an Gastgeber „Party läuft noch — verlängern?".
- Bei Ende: Gast- und Display-Token werden ungültig, Board zeigt „Danke fürs Kommen!", offene Bestellungen werden zur Entscheidung angezeigt (servieren/verwerfen).
- **Party-Rückblick:** Was wurde wie oft bestellt, was ging aus, was ist übrig → „Auf die Einkaufsliste für nächstes Mal" und „Menü als Vorlage speichern".
- **Datensparsamkeit:** Gastnamen nach X Tagen (Default 30) aus Bestellungen entfernen, Statistik bleibt anonym.

#### G. Was der Party-Modus ausdrücklich **nicht** wird

Keine Preise, keine Bezahlung, keine Kasse, keine Gästekonten, keine Gästeliste/RSVP, keine Musik-/Spielefunktionen. Das ist ein Bestell- und Bestandswerkzeug für den Gastgeber.

#### H. Wiederverwendung

Board + Menüs + Client-ID sind dieselben Bausteine für den **Kindermodus** (Kinder-Menü = Party-Menü mit Freigabe-Regeln, Board = Elternansicht) und das **Wanddisplay**. Darum steht der Party-Modus in Welle 1/2 und der Kindermodus in Welle 3.

---

## 10. Gegenstimme (Devil's Advocate): Was NICHT gebaut werden sollte

Die App hat bereits zwölf Bereiche, 23 MCP-Tools, Belegparser, Rezeptimport, Wochenplan, Cookidoo-Sync, Gastbar und HA-Paket — für **einen** Haushalt mit einem Entwickler. Das größte Risiko ist nicht ein fehlendes Feature, sondern dass nichts davon im Alltag *verlässlich* funktioniert.

**Nicht bauen:**
1. **Aufgaben/Chores mit Punkten oder Sternen.** Das ist ein eigenes Produktfeld (OurHome, Tody, Sweepy), mit eigener Psychologie und eigenem Streitpotenzial. Ein halbes Chore-System ist schlechter als keins. „Ich übernehme das" an bestehenden Objekten reicht.
2. **Haushaltsbuch / Budgetkategorien.** Zwei Zahlen aus vorhandenen Importpreisen, mehr nicht.
3. **Kassen- oder Café-Funktionen.** Keine Preise, keine Bons, keine Tagesabschlüsse. KassenSichV/TSE ist eine Haftungsfalle.
4. **Familienkalender, Chat, Babysitter-Protokoll.** Dafür gibt es Kalender und Messenger. Ein Notizfeld mit Push reicht.
5. **Weitere Händlerparser ohne Fixtures.** Jeder Parser ist Wartungslast. Nur mit Testdateien aus der Community.
6. **MQTT, Prometheus, Multi-Haushalt/Mandanten.** Erst wenn jemand konkret fragt. Multi-Tenant würde das gesamte Sicherheitsmodell ändern.
7. **Eigene Sprachassistenz.** HA-`todo` und MCP decken das ab. Nichts Eigenes.
8. **Kindermodus vor dem Party-Modus.** Ohne stabiles Menü-/Board-Fundament wird der Kindermodus ein Sonderweg.

**Die eine Gegenfrage an jede neue Idee:** *Senkt das die Pflegelast oder erhöht es sie?* Alles, was neue Eingaben verlangt (Aufgaben anlegen, Budgets pflegen, Protokolle schreiben), verstößt gegen den Gründungsgedanken „Bestand kommt über das rein, was ohnehin passiert". Alles, was vorhandene Daten besser *nutzt* (Reste, Einfrieren, Board, Push mit Aktion, Backups), passt.

**Und:** Vor Welle 2 einmal zwei Wochen nur benutzen, nichts bauen. Notieren, wo es wirklich hakt. Das Panel ist simuliert — der eigene Haushalt ist es nicht.

---

## Anhang: Fundstellen der Sicherheitsbefunde

- S1: `server/routes/core.ts` — `r.get('/export.json', …)` exportiert `settings` und `guest_links` vollständig; `settings.ha.token` ist laut `GET /api/settings` dort gespeichert.
- S2: `server/db.ts` — `guest_links.token TEXT NOT NULL UNIQUE` (Klartext), vgl. `sessions.token_hash`, `api_tokens.token_hash`.
- S3: `server/routes/guest.ts` — `guest.get('/:token/orders', …)` → `listOrders('guest_link_id = ?', …)`; Filter nach Name nur in `web/src/pages/Guest.tsx` (`mine = … o.guest_name === name`).
- S4: `server/routes/core.ts` — `r.get('/auth/users', …)` vor `r.use(requireAuth)`.
- S5: `server/routes/guest.ts` — `days: 0` ⇒ `expires_at = NULL`; `guest_links.last_seen_at` wird in `server/lib/auth.ts` gepflegt, aber in der Oberfläche nicht angezeigt.
- S6: `server/index.ts` — `app.all('/mcp/:secret', handleMcp)`.
- S7: `server/index.ts` — `app.use('/img', express.static(…))` ohne Auth.
