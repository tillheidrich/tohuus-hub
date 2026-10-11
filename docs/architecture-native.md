# Architekturkonzept: ToHuus Hub nativ (Server-Modus und iCloud-Standalone)

Stand: 11.10.2026 · Status: Konzept, nichts davon ist gebaut · Zielgruppe: Till und jeder KI-Agent, der hier weiterarbeitet

> Anforderung (Till): „Die App muss optimiert sein, damit sie mit Hilfe eines Servers läuft oder halt standalone per iPhone und anderen iCloud-Usern."

Dieses Dokument baut auf dem früheren Konzept im Outline-Wiki auf (native SwiftUI-App, die sich wie die Home-Assistant-App mit einer selbst gehosteten Instanz verbindet: Adresse/QR, Passkeys, APNs über ein Relay, Widgets, App Intents, Share-Extension, Offline; dazu eine reine iCloud-Variante über CloudKit-Shares ohne Server, also ohne öffentliche Gast-/Babysitter-Links, ohne HA/Telegram/MCP/Mail-Postfach, nur Apple, Daten bei Apple). Es beschreibt **nicht** die iOS-App selbst, sondern was das Repo dafür braucht, wie Daten und Logik geteilt werden und in welcher Reihenfolge gebaut wird.

Bezugsdateien im Repo: [architecture.md](architecture.md), [features.md](features.md), [data-and-reset.md](data-and-reset.md), [guests-and-permissions.md](guests-and-permissions.md), `server/db.ts`, `server/lib/*.ts`, `server/lib/ha2-engine.ts`, `server/lib/data.ts`, `server/lib/backup.ts`, `server/lib/bus.ts`, `server/lib/shop.ts` (`shop_ops`), `web/src/api.ts`.

---

## Kurzfassung der Entscheidungen

| Frage | Entscheidung |
|---|---|
| Betriebsarten | (a) Server wie heute, (b) native App am Server, (c) iCloud-Haushalt ohne Server. Reihenfolge: **(b) vor (c)**. |
| Geteilte Logik | **Reines TypeScript-Paket `packages/core`** (ohne Node, ohne SQLite), auf dem Server direkt, in der iOS-App über **JavaScriptCore**. Kein Swift-Nachbau, kein Rust. |
| Identität | Jede synchronisierte Zeile bekommt eine **`uid` (UUIDv7, Text)**. Integer-IDs bleiben intern auf dem Server; über die Leitung und in CloudKit zählen nur `uid`s. |
| Änderungsverfolgung | Trigger schreiben in ein globales **`sync_log`** (Muster `ha2_touch`), Zeitstempel als **Hybrid Logical Clock**, Löschungen als Tombstones. |
| Konflikte | **Feldweises Last-Writer-Wins** (Muster `mergeFields` in `ha2-engine.ts`), **außer Bestand**: Mengen laufen als unveränderliche Buchungen (`movements`), nie als LWW-Zahl. |
| Sync-API für (b) | Neuer Delta-Endpunkt `/api/sync/v1/*` (Pull ab Sequenznummer, Push als idempotente Ops, Muster `shop_ops`). REST+SSE bleibt für berechnete Ansichten und als „Anstupser". |
| CloudKit für (c) | Eigene Zonen im privaten DB des Owners, **zonenweite CKShares**, Sync über **CKSyncEngine** auf lokaler SQLite (GRDB). Gaststufen = welche Zonen geteilt sind. |
| Umzug c ↔ a | Über das **bestehende Export-JSON**, erweitert zu **Version 3** (mit `uid`s, Tabellenklassen „portabel"/„instanzgebunden"). |
| US-Anbieter | (c) bedeutet Daten bei Apple. Wird als bewusster Kompromiss für den Einstieg angeboten, klar gekennzeichnet, mit Ein-Klick-Umzug auf (a). |

Ein ehrlicher Einwand vorab, dann gilt die Entscheidung: **Modus (c) widerspricht Tills Linie, US-Dienste zu meiden, und ist technisch der teuerste Teil** (Sync ohne Autorität, Rollen ohne Server). Er lohnt sich trotzdem, weil er die größte Hürde der App entfernt („ich will keinen Server betreiben") und Paare/Familien im Apple-Alltag sofort abholt. Deshalb: erst (b), dann (c), und (c) immer mit offenem Ausgang nach (a).

---

## 1. Ziel und die drei Betriebsarten

### 1.1 Ziel

Ein Haushalt soll ToHuus Hub nutzen können

- mit eigenem Server (heute: ein Docker-Container, eine SQLite-Datei, Web-App/PWA),
- mit einer nativen iPhone-App an genau diesem Server (bessere Offline-Fähigkeit, Widgets, Siri/Kurzbefehle, Teilen-Menü, echte Push),
- oder ganz ohne Server: Daten in iCloud, geteilt mit anderen iCloud-Nutzern (Partnerin, Kinder mit Apple-Account, Dauergäste).

Die Domänenlogik (Bestand, Haltbarkeit, „Was essen wir heute", Wochenplan, Hausversionen, Belegerkennung) darf es **nur einmal** geben.

### 1.2 Die drei Modi

```
(a) Server (heute)            (b) Native App + Server           (c) iCloud-Haushalt
┌──────────────┐              ┌──────────────┐                   ┌──────────────┐   ┌──────────────┐
│ Browser/PWA  │              │ iOS-App      │                   │ iOS-App Till │   │ iOS-App Lea  │
│ REST + SSE   │              │ SQLite-Cache │                   │ SQLite lokal │   │ SQLite lokal │
└──────┬───────┘              │ Outbox, Core │                   │ Core (JSC)   │   │ Core (JSC)   │
       │                      └──────┬───────┘                   └──────┬───────┘   └──────┬───────┘
┌──────▼───────────────────┐  ┌──────▼───────────────────┐       ┌──────▼──────────────────▼───────┐
│ Node + SQLite            │  │ derselbe Server          │       │ CloudKit                        │
│ Logik, Scheduler, MCP,   │  │ + /api/sync/v1           │       │ privates DB des Owners,         │
│ HA, Telegram, Mail, Push │  │ + Push-Relay (APNs)      │       │ Zonen + CKShare                 │
└──────────────────────────┘  └──────────────────────────┘       └─────────────────────────────────┘
Wahrheit: Server              Wahrheit: Server                   Wahrheit: verteilt (jedes Gerät),
                              Gerät: Cache + Offline-Outbox      CloudKit nur Transport + Speicher
```

**(a) Self-hosted Server.** Unverändert. Bleibt der volle Funktionsumfang und die Referenz.

**(b) Native App am Server.** Der Server bleibt die Wahrheit und rechnet. Die App hält einen lokalen Spiegel der Kerntabellen, schreibt offline in eine Outbox und gleicht über den Delta-Endpunkt ab. Berechnete Ansichten (Übersicht, Vorschläge) holt sie online per REST; offline rechnet sie dieselben Ansichten mit `packages/core` aus dem lokalen Spiegel. Web-App und native App laufen parallel am selben Server.

**(c) iCloud-Haushalt.** Kein Server. Jedes Gerät hat eine vollständige lokale SQLite-Datenbank und die Core-Logik. CloudKit transportiert Änderungen zwischen den Geräten: privates DB des Owners mit eigenen Zonen, andere iCloud-Nutzer kommen über CKShare dazu. Alles, was einen dauerhaft erreichbaren Rechner braucht (Bots, Postfach, öffentliche Links, Zeitpläne), fällt weg oder wird durch Apple-Mechanismen ersetzt (Abschnitt 4).

### 1.3 Umzug zwischen den Modi

Der Umzug läuft immer über **eine Datei**: das bestehende Export-JSON (`buildExport()` in `server/lib/data.ts`, Format `tohuus-export`), angehoben auf Version 3.

| Weg | Ablauf | Was verloren geht / neu gemacht wird |
|---|---|---|
| **c → a** (iCloud → eigener Server) | App: *Daten › Auf eigenen Server umziehen* → Export v3 → Upload an die neue Instanz über *Wiederherstellen aus Export* (`stageJsonRestore`) oder direkt per Sync-API → App schaltet auf Modus (b) und verbindet sich mit dem Server. Die alte CloudKit-Zone wird **eingefroren** (Flag `household.frozen_at` in einem Settings-Record, alle Geräte wechseln auf nur lesen) und nach Bestätigung gelöscht. | Teilnehmer bekommen Server-Konten über Einladungslinks (Passwörter gibt es in (c) nicht). Weil die `uid`s erhalten bleiben, entstehen auf den umgezogenen Geräten keine Duplikate. |
| **a → c** (Server → iCloud) | Web: Export v3 herunterladen (oder App im Modus (b): *In iCloud-Haushalt umwandeln*) → App legt Zone(n) an und importiert. | Instanzgebundene Tabellen (HA-Links, Telegram-Chats, Gast-Links, Displays, Druckaufträge, Postfach, Push-Abos) werden nicht übernommen; der Import zeigt eine Liste, was wegfällt. |
| **b ↔ a** | Kein Umzug: dieselben Daten, nur ein anderer Client. | – |

Regel gegen „Split Brain": Nach einem Umzug ist die Quelle **nur lesbar**, bis der Nutzer sie löscht. Zwei aktive Wahrheiten für einen Haushalt gibt es nie.

---

## 2. Domänenkern: was ist reine Logik, was ist Server

### 2.1 Bestandsaufnahme

Analyse der Importe in `server/lib/*.ts` und `server/importers/*.ts` (Stand heute):

**Schon heute rein** (keine Importe von `db`, `config`, Node oder Express):

| Modul | Inhalt |
|---|---|
| `ha2-engine.ts` | Drei-Wege-Merge, Tombstones, Dedupe, Origin-Marker: Vorlage für den App-Sync |
| `shopparse.ts` | Schnelleingabe „2 l Milch, Brot", Gangreihenfolge lernen |
| `scale.ts` | Portionen skalieren (**doppelt vorhanden** als `web/src/scale.ts`, 163 Zeilen: der erste Beweis, dass ein gemeinsames Paket fehlt) |
| `text.ts` | `norm()`, Fuzzy-Matching für Bonzeilen |
| `redact.ts` | Anonymisierte Belege |
| `recipe-jsonld.ts`, `recipe-translate.ts`, `recipe-images.ts` | schema.org-Rezepte, Übersetzung von Mengen/Einheiten |
| `qr.ts`, `ha2-safety.ts`, `restore-paths.ts` | klein, rein |
| `kids-rules.ts` | nur `zod` |
| `importers/generic.ts`, `intl.ts`, `rewe.ts`, `types.ts` | Bon-Parser (hängen nur an `text.ts`) |
| `server/languages.ts` | Sprachliste |

**Fachlogik, aber mit Datenbank/Konfiguration verwoben** (muss geteilt werden in „Abfrage" auf dem Server und „Berechnung" im Core):

| Modul | reiner Kern, der heraus soll | woran er heute hängt |
|---|---|---|
| `catalog.ts` | `productStatus()` (Status, `nextExpiry`), `fmtQty`, `levelLabels`, `matchProduct`/`guessCategory`-Scoring | `notifySettings()`, `config.timezone` (`localDay`), `t()`, `isTrackedProduct` aus `share-core.ts` |
| `fresh-shelf.ts` | `entryExpiry`, `openDaysFor`, `thawDaysFor`, `dateKindOf`, Standard-Haltbarkeiten | `config`, `db` (Kategorien) |
| `fresh.ts` | „Zuerst essen", Schnell-Abgleich-Logik | `db`, `bus`, `notify` |
| `variants.ts` | `termMatches`, `swapText`, `ruleApplies`, `effectiveIngredients`, `changeLabels` | `db` für Laden/Speichern |
| `recipes.ts` | `suggest()`-Bewertung, `ingredientCore`, `isPantryText` | `listProducts()`, `db`, `t()`, `peopleSignals()`, `useUpWindow()` |
| `cook2.ts` | „Was essen wir heute" (Filter, Alternativen, Reste zuerst) | `db`, mehrere Module |
| `plan.ts`, `plan2.ts` | Auto-Füllen, Rotation, Wochen-Einkauf, Abstimmungen | `db`, `bus`, `notify`, `net` (Cookidoo) |
| `people-signals.ts`, `people-policy.ts` | Vorlieben/Allergien-Gewichtung, Gaststufen-Regeln (`guestMay`, effektive Stufe aus der Uhr) | `db` |
| `away-state.ts` | Urlaubsfenster, „vor der Reise aufbrauchen" | `config`, `db` |
| `spending.ts`, `spend2.ts` | Aggregationen, Budgets, Prognose | `db`, `region`, `notify` |
| `region.ts`, `region-categories.ts`, `region-hints.ts` | Währung, Einheiten, Wochenstart, erwartete Bons | `config`, `db`, `bus` |
| `retail.ts`, `imports.ts`, `quality.ts` | Bonzeile → Produkt, Lernregeln | `db`, Prozesse, Dateisystem |
| `server/i18n.ts` + `server/locales/*` | Wörterbücher (reine Daten), `t()` | `lang()` aus `db.ts` |

**Nur Server** (bleibt in `server/`, kommt nie in den Core):

| Bereich | Module | Grund |
|---|---|---|
| Mail | `notify.ts` (nodemailer), `retail-inbox.ts` (IMAP), `auth-links.ts` | braucht dauerhaft laufenden Prozess, SMTP/IMAP-Zugang |
| Telegram, Matrix, Gotify, ntfy, Webhooks | `telegram.ts`, `channels*.ts` | Bot braucht erreichbaren Server bzw. Dauerverbindung |
| Home Assistant | `ha-api.ts`, `ha2.ts`, `ha2-voice.ts`, `hatodo.ts` | HA ist im LAN; der Abgleich (`ha2-engine`) ist rein, die Anbindung nicht |
| MCP | `server/mcp/*` (106 Tools) | KI-Clients brauchen einen HTTP-Endpunkt |
| Scheduler | `scheduler.ts`, Timer in `party.ts`, `people.ts`, `backup.ts`, `enrich.ts` | Zeitgesteuert, im Prozess |
| Öffentliche Links | `guest`, `party`, `kiosk`, `kids`-Geräte, Babysitter-/Haussitter-Links, `share`-Endpunkt fürs iPhone-Kurzbefehl | brauchen eine öffentliche URL ohne Konto |
| Anmeldung | `auth*.ts` (Passwort, TOTP, Passkeys mit RP-ID = Server-Host, OIDC, PIN) | serverseitige Sitzungen |
| Web Push | `webpush.ts` | VAPID-Schlüssel am Server |
| Bilder, Druck, Netz | `images.ts`/`labels.ts`/`kiosk.ts`/`tickets.ts` (sharp), `escpos.ts` (node:net), `net.ts` (SSRF-Schutz, undici) | Node-Bibliotheken; in der App durch Apple-Frameworks ersetzt |
| Backup/Restore | `backup.ts`, `restore-boot.ts` | Dateisystem, `VACUUM INTO` |

### 2.2 Optionen, Logik zwischen TypeScript-Server und Swift-App zu teilen

| Option | Für | Gegen |
|---|---|---|
| **A. Alles in Swift neu** | schnellste App, idiomatisch, keine Brücke | zwei Implementierungen derselben Regeln, die auseinanderlaufen (siehe `scale.ts` heute schon doppelt); 455 Tests müssten nachgebaut werden; Bon-Parser und Wörterbücher ändern sich laufend |
| **B. TS-Core über JavaScriptCore** | eine Quelle, dieselben Tests, dieselben Wörterbücher; JavaScriptCore ist Teil von iOS (keine Fremdabhängigkeit); Agenten arbeiten im bestehenden TS-Code weiter | Brücke (JSON rein, JSON raus), kein JIT in Apps (Interpreter, für diese Datenmengen ausreichend), Debugging über zwei Welten |
| **C. Rust-Core mit Bindings** (uniffi für Swift, napi für Node) | schnell, typsicher auf beiden Seiten | kompletter Neubau der Logik, neue Toolchain, Server-Code müsste umziehen; für einen Ein-Personen-Haushaltsapp-Betrieb zu schwer |
| **D. TS-Domäne als reines Paket `packages/core`** | Voraussetzung für B, sofort nützlich für Server und Web (doppelter Code verschwindet), testbar ohne Datenbank | allein noch keine Lösung für Swift |

**Empfehlung: D jetzt, B für iOS.** Begründung:

1. D lohnt sich auch ohne iOS-App: `web/src/scale.ts` und `server/lib/scale.ts` werden eins, die Tests werden schneller und schärfer (keine Datenbank nötig), und die Grenze „rein vs. Seiteneffekt", die `architecture.md` schon mit `share-core.ts`, `people-policy.ts` usw. andeutet, wird zur Regel.
2. B nutzt genau dieses Paket: `esbuild --platform=neutral` erzeugt eine einzelne JS-Datei, die in der App mitgeliefert und in einem `JSContext` geladen wird. App-Store-Regel: ausgeführter Code muss im App-Paket stecken, darf nicht nachgeladen werden (Guideline 2.5.2). Das ist erfüllt.
3. Was in Swift bleibt, ist nur Plattform: UI, Persistenz (GRDB/SQLite), CloudKit, Netzwerk, Kamera, Benachrichtigungen. Keine Fachregel wird in Swift doppelt geschrieben. Ausnahme, falls Messungen es erzwingen: winzige, stabile Hotpaths (z. B. `norm()` beim Tippen) dürfen in Swift gespiegelt werden, aber nur mit **gemeinsamen Testvektoren** (Abschnitt 7).

### 2.3 Zuschnitt des Core

```
packages/core/
  package.json            name "@tohuus/core", "type": "module", keine dependencies außer zod
  src/
    index.ts              öffentliche API (nur reine Funktionen und Typen)
    clock.ts              Ctx: { now: string, tz: string, t: Translator, region: RegionInfo }
    text.ts               ← server/lib/text.ts
    shopparse.ts          ← server/lib/shopparse.ts
    scale.ts              ← server/lib/scale.ts + web/src/scale.ts (zusammengeführt)
    fresh.ts              ← entryExpiry, openDaysFor, thawDaysFor, dateKindOf, Standardtabellen
    status.ts             ← productStatus (ohne notifySettings/config: warnDays, today aus Ctx)
    variants.ts           ← termMatches, swapText, ruleApplies, effectiveIngredients, changeLabels
    suggest.ts            ← Bewertung aus recipes.suggest() und cook2 (Eingabe: Snapshot)
    plan.ts               ← Rotation, Auto-Füllen, Wochen-Einkauf (Eingabe: Snapshot)
    people.ts             ← Gaststufen-Regeln, Signale (Vorlieben/Allergien)
    receipts/             ← server/importers/* (generic, intl, rewe, types)
    recipes/              ← recipe-jsonld, recipe-translate
    redact.ts, qr.ts
    sync/engine.ts        ← ha2-engine.ts (verallgemeinert, siehe 3.4)
    sync/hlc.ts           neu: Hybrid Logical Clock
    i18n/                 ← Wörterbücher server/locales/* und web/src/locales/* als Daten, createT(lang)
    region.ts             ← reine Regionstabellen
  test/                   Vitest, plus vectors/*.json (gemeinsame Testvektoren für TS und Swift)
```

Arbeitsprinzip für die Berechnungsfunktionen: **Snapshot rein, Ergebnis raus.** Beispiel `suggest`:

```ts
// packages/core/src/suggest.ts
export function suggest(s: KitchenSnapshot, ctx: Ctx, opts: SuggestOpts): Suggestion[]
// KitchenSnapshot = { products, stock, recipes, ingredients, variants, swapRules, people, away, cookLog }
```

Der Server baut den Snapshot mit seinen SQL-Abfragen (`server/lib/recipes.ts` wird dünn), die App aus ihrer lokalen SQLite. `t()` und Zeit kommen über `Ctx`, nie über Globals; dadurch ist jede Funktion deterministisch testbar.

### 2.4 Refactoring-Pfad im Repo (Reihenfolge)

1. **Gerüst.** `packages/core` als npm-Workspace (Root-`package.json` bekommt `"workspaces": ["packages/*"]`), `tsconfig` für `packages/core` mit `"types": []` (keine Node-Typen: Node-Importe fallen beim Typecheck auf).
2. **Reinheitstest** `test/core-purity.test.ts`: (a) `esbuild packages/core/src/index.ts --bundle --platform=neutral` muss ohne externe Pakete bauen; (b) kein Quelltext unter `packages/core` darf `node:`, `better-sqlite3`, `express`, `sharp`, `../db`, `../config`, `server/` importieren. Dieser Test ist die eigentliche Architekturgrenze.
3. **Welle 1: umziehen, was schon rein ist.** `text`, `shopparse`, `scale` (beide Fassungen zusammenführen, `web/src/scale.ts` importiert danach aus dem Core), `redact`, `recipe-jsonld`, `recipe-translate`, `qr`, `importers/*`, `ha2-engine`, `kids-rules`, `languages`. Die alten Dateien unter `server/lib/` bleiben als **Re-Export-Stubs** (`export * from '@tohuus/core/text'`), damit keine Route und kein MCP-Tool angefasst werden muss. Bestehende Tests (`rewe.test.ts`, `intl.test.ts`, `shop.test.ts`, `ha2.test.ts` usw.) müssen unverändert grün bleiben.
4. **Welle 2: Kontext statt Globals.** `Ctx` einführen; `localDay()` (nutzt `config.timezone`), `notifySettings().expiryWarnDays`, `t()` aus `server/i18n.ts` werden Parameter. Zuerst `productStatus` + `fresh-shelf` (die ganze Haltbarkeitslogik), dann `variants` (die reinen Hälften), dann `isTrackedProduct` aus `share-core.ts`.
5. **Welle 3: Snapshots.** `suggest` (aus `recipes.ts`), „Was essen wir heute" (`cook2.ts`), Rotation/Auto-Füllen (`plan2.ts`/`plan.ts`), Signale (`people-signals.ts`), Urlaubsfenster (`away-state.ts`), Ausgaben-Aggregation (`spending.ts`). Je Modul: SQL bleibt im Server, die Rechnung wandert, ein Core-Test mit Snapshot-Fixture kommt dazu.
6. **Welle 4: i18n.** Wörterbücher aus `server/locales/*` und `web/src/locales/*` nach `packages/core/src/i18n/` (Daten), `createT(lang, area?)` im Core; `server/i18n.ts` wird ein dünner Adapter mit `lang()`. `test/languages.test.ts` zeigt danach auf den Core.
7. **Nicht anfassen:** Routen, MCP-Tools, Scheduler, Auth. Sie rufen weiter `server/lib/*`, das intern den Core nutzt.

---

## 3. Daten und Synchronisation

### 3.1 Local-first-Modell

| | Modus (b) | Modus (c) |
|---|---|---|
| Wahrheit | Server | jedes Gerät gleichberechtigt, CloudKit = Transport + gemeinsamer Speicher |
| Lokale DB | SQLite-Spiegel der portablen Tabellen + Outbox | volle SQLite pro Gerät + Sync-Status (CKSyncEngine-State) |
| Schreiben | sofort lokal, Op in Outbox, Push an Server; Server antwortet mit dem maßgeblichen Stand | sofort lokal, Record-Änderung an CKSyncEngine |
| Ableitungen (Status, Vorschläge) | online: Server-REST; offline: Core lokal | immer Core lokal |

Die lokale App-Datenbank nutzt **dasselbe Schema wie der Server** (gleiche Tabellen- und Spaltennamen, plus `uid`). Vorteil: Export-JSON, Snapshots für den Core und Testfixtures sind auf allen Seiten identisch.

### 3.2 Identität: von Integer-IDs zu `uid`s

Heute: `INTEGER PRIMARY KEY` überall, Fremdschlüssel als Integer (`stock.product_id`, `recipe_ingredients.recipe_id` …), Personen teils über **Namen** (`people_prefs.person`, `recipe_ratings.person`, `movements.actor`, `shopping_items.added_by`, `checked_by`). Zwei Geräte, die offline je ein Produkt anlegen, würden beide `id = 42` vergeben.

Plan:

1. **Named Migration `sync-1`**: jede portable Tabelle bekommt `uid TEXT` + `CREATE UNIQUE INDEX <t>_uid ON <t>(uid)` (SQLite kann `UNIQUE` nicht per `ALTER TABLE ADD COLUMN`). Backfill in derselben Migration mit einem SQL-Ausdruck aus `randomblob(16)` (Format egal, Hauptsache eindeutig; neue Werte später als UUIDv7).
2. **Trigger statt Codeänderung**: `AFTER INSERT ... WHEN NEW.uid IS NULL BEGIN UPDATE <t> SET uid = <neu> WHERE rowid = NEW.rowid; END;` So bekommt jede Zeile eine `uid`, ohne dass die rund 140 INSERT-Stellen in `server/lib`, `server/routes` und `server/mcp` geändert werden müssen. Code, der eine `uid` von außen mitbringt (Sync, Import), setzt sie explizit.
3. **Integer-IDs bleiben auf dem Server** (Routen, MCP, Web-App ändern sich nicht). An der Sync-Grenze werden Fremdschlüssel übersetzt: `product_id: 42` ↔ `product_uid: "0192…"`. Diese Übersetzung lebt in einer Tabelle pro Typ, generiert aus einer Beschreibung (`packages/core/src/sync/schema.ts`: Tabelle, Felder, Referenzen, Konfliktstrategie).
4. **Personen über `users.uid`** statt Namen. Neue Spalten (`person_uid`, `actor_uid`, `added_by_uid`) neben den Namensspalten; Namen bleiben als Anzeige-Cache. Grund: in (c) heißen zwei Geräte-Nutzer vielleicht beide „Till", und Umbenennen darf keine Bewertungen verwaisen lassen.
5. **Abgeleitete Datensätze bekommen deterministische `uid`s**, z. B. ein Rotationseintrag `uid = hash(household, week, slot, template)`. Erzeugen zwei Geräte ihn parallel, ist es derselbe Datensatz statt eines Duplikats. Gilt für Rotation, automatisch nachgefüllte Einkaufsposten („niedrig → auf die Liste": `uid = hash('low', product_uid, Tag)`), Pflege-Fälligkeiten.

Tabellen mit natürlichem Schlüssel (`settings.key`, `product_codes.code`, `product_aliases(alias, product_id)`, `shop_sections.key`) bekommen keine Zufalls-`uid`, sondern `uid = Schlüssel` bzw. Hash des Schlüssels.

### 3.3 Änderungsverfolgung

- **`sync_log`** (neue Tabelle): `seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT, uid TEXT, op TEXT ('upsert'|'delete'), hlc TEXT, origin TEXT`. Gefüllt von Triggern auf allen portablen Tabellen, genau wie heute `ha2_touch` für `shopping_items` und `meal_plan`. Pro `(tbl, uid)` wird nur der letzte Eintrag gebraucht; ältere werden beim Kompaktieren entfernt.
- **`updated_at` / HLC**: Heute haben nur `products`, `stock`, `recipes`, `orders`, `plan_templates`, `people_prefs`, `recipe_ratings` ein `updated_at`, und das im Sekundenformat `datetime('now')`. Für Sync reicht Wanduhr nicht (Gerät mit falscher Uhr gewinnt immer). Daher **Hybrid Logical Clock** (`physisch-ms . zähler . knoten`), als Text sortierbar. Pro Zeile `hlc TEXT`, für feldweises LWW zusätzlich `field_hlc TEXT` (JSON: Feld → HLC), nur auf Tabellen, die feldweise gemergt werden.
- **Tombstones**: Löschen schreibt `op = 'delete'` ins `sync_log`; der Datensatz selbst ist weg. Tombstones werden nach einer Frist entfernt (Vorschlag 90 Tage; ein Gerät, das länger offline war, macht einen vollen Neuabgleich). Das Muster stammt aus `ha2-engine.ts` (`tombstoneAt`, `tombstoneTtlMs`).
- **Herkunft**: `origin` (Gerät/Client) verhindert Ping-Pong, wie die Origin-Marker in `ha2-engine.ts`.

### 3.4 Konfliktregeln

`ha2-engine.ts` wird zur allgemeinen Engine in `packages/core/src/sync/engine.ts`. Übernommen werden: Drei-Wege-Merge pro Feld (`mergeFields`), „Bearbeiten nach Löschen belebt wieder" (Last Writer Wins auf Ebene der Existenz), Dedupe über normalisierten Schlüssel, „privat verlässt das Gerät nicht". Neu: HLC statt Zeitstempel und Konfliktstrategie pro Tabelle.

| Daten | Strategie | Begründung |
|---|---|---|
| Einkaufsliste, Wochenplan, Orte, Kategorien, Produkte (Stammdaten), Rezepte, Pflegeaufgaben, Vorlieben | **feldweises LWW** (HLC) | wie heute im HA-Abgleich bewährt; zwei Leute ändern selten dasselbe Feld |
| **Bestandsmengen** (`stock.qty`) | **Buchungen statt Zahl**: jede Änderung ist ein `movements`-Datensatz mit eigener `uid` (`delta`, `reason`, `stock_uid`) und nie veränderlich. Menge = Basis + Summe der Deltas. | Till nimmt offline eine Milch, Lea auch: LWW würde eine Entnahme verschlucken. Buchungen addieren sich korrekt. Kompaktieren (Basis neu setzen) macht in (b) der Server, in (c) das Owner-Gerät. |
| Rezeptzutaten, Plan-Vorlagen-Einträge | Kindsätze mit `uid`, `sort` als Bruchzahl-Schlüssel | Umsortieren auf zwei Geräten erzeugt keine doppelten Positionen |
| Bewertungen (`recipe_ratings`) | Schlüssel `(recipe_uid, person_uid)`, LWW | eine Bewertung pro Person |
| Abstimmungen (`plan_vote_ballots`) | Schlüssel `(vote_uid, person_uid, candidate_uid)`, LWW | jede Person schreibt nur ihre eigenen Stimmen |
| Einstellungen (`settings`) | LWW pro Schlüssel, bei JSON-Objekten pro Unterfeld | entspricht `deepMerge` im Restore |
| Eindeutige Namen (`categories.name`, `users.name`, Barcodes) | Dedupe beim Merge: gleicher normalisierter Schlüssel → zusammenführen, Verweise umbiegen, Verlierer als Alias behalten | sonst scheitert der Unique-Index nach dem Sync |
| Bons/Importe | nur der anlegende Client schreibt Zeilen, andere nur `status` (LWW) | Importe werden von einer Person geprüft |

Konflikte werden gezählt und in einem kleinen Protokoll angezeigt („2 Änderungen von Lea haben deine überschrieben"), wie `conflicts` im heutigen `ReconcileResult`.

### 3.5 Sync-API für Modus (b)

Heute: über 30 REST-Router, die nach Bildschirmen geschnitten sind (z. B. Übersicht, Vorschläge), plus SSE (`/api/events`, Themen wie `stock`, `shopping`), worauf `web/src/api.ts` die passenden Query-Keys neu lädt. Offline gibt es nur für die Einkaufsliste: der Service Worker spielt `shop_ops` mit `op_id` idempotent nach (`server/lib/shop.ts`). Für eine native Offline-App reicht das nicht: die App müsste jeden Bildschirm einzeln cachen.

Neu, zusätzlich (die Web-App bleibt wie sie ist):

```
GET  /api/sync/v1/bootstrap            → { household_uid, schema_version, server_hlc, tables: [...], snapshot_seq }
                                          (vollständiger Export v3 der portablen Tabellen, gestreamt/paginiert)
GET  /api/sync/v1/changes?since=<seq>&limit=500
                                       → { changes: [{ seq, tbl, uid, op, hlc, row|null }], next, more }
POST /api/sync/v1/push                 body: { device, ops: [{ op_id, tbl, uid, kind: 'upsert'|'delete'|'movement',
                                                   patch, field_hlc, base_seq }] }
                                       → { results: [{ op_id, ok, error?, canonical? }], seq }
```

- **Idempotenz** über `op_id` (verallgemeinertes `shop_ops` → `sync_ops`), damit ein doppelt gesendeter Push nichts doppelt bucht.
- **Server bleibt Autorität**: Er wendet Ops über dieselbe Fachlogik an wie die Routen (`adjustStock`, `addToShopping` …), damit Nebenwirkungen (Benachrichtigungen, HA-Sync, „niedrig → Liste") weiter genau einmal passieren. Antwort `canonical` liefert den Stand nach der Anwendung.
- **Rechte**: Die Antwort von `changes` wird je Akteur gefiltert. Gäste bekommen nur Tabellen ihrer Stufe (`people-policy.ts`); diskrete/private Einkaufsposten werden genauso behandelt wie heute (`notPrivate()`, Platzhalter). Pushes werden gegen `guestMay()` geprüft.
- **SSE bleibt als Anstupser**: neues Thema `sync` mit `{ seq }`; die App zieht dann `changes`. Im Hintergrund übernimmt APNs (stille Push über das Relay) diese Rolle.
- **Neuer Token-Scope `app`**: Gerätetoken (Keychain), darf `/api/sync/*`, `/api/*` als der jeweilige Nutzer, nicht `/mcp`. Ausgegeben über ein Kopplungsverfahren (QR, siehe 5).
- **Berechnete Ansichten** (Übersicht, Vorschläge, Ausgaben) holt die App online weiter per REST; offline rechnet sie mit dem Core. Weil Server und App denselben Core nutzen, sind die Ergebnisse gleich.

Anmeldung in (b), ein Stolperstein: **native Passkeys brauchen „Associated Domains", die beim App-Build feststehen.** Eine selbst gehostete Instanz hat eine beliebige Domain, die nicht in der App eingetragen sein kann. Lösung wie bei der HA-App: Anmeldung läuft im Systembrowser über `ASWebAuthenticationSession` gegen die Instanz (dort funktionieren Passwort, Passkey, OIDC wie im Web), Rückgabe eines einmaligen Codes an die App, die ihn gegen einen Gerätetoken tauscht. Universal Links scheiden aus demselben Grund aus; die App nutzt ein eigenes URL-Schema (`tohuus://`) und QR-Codes.

### 3.6 CloudKit-Abbildung für Modus (c)

**Technik:** `CKSyncEngine` (ab iOS 17) auf einer eigenen lokalen SQLite (GRDB). Nicht SwiftData/`NSPersistentCloudKitContainer`, weil wir das Schema, die `uid`s, die Merge-Regeln und die Buchungslogik selbst bestimmen müssen und Sharing dort nur eingeschränkt steuerbar ist. Mindestversion damit iOS 17.

**Zonen** (im privaten DB des Owners), geschnitten nach Sichtbarkeit, weil CloudKit Rechte nur pro Share (Zone) und nur als „lesen" oder „lesen+schreiben" kennt:

| Zone | Inhalt (Record-Typen) | wer bekommt sie |
|---|---|---|
| `hh-<uid>-order` | ShoppingItem, Order, OrderLine, MenuGroup/MenuItem, Claim | alle Mitglieder, Gäste ab Stufe `order` |
| `hh-<uid>-house` | Location, Category, Product, ProductCode, StockEntry, Movement, LabelBox, LocationPhoto | Mitglieder, Gäste ab `stock` |
| `hh-<uid>-kitchen` | Recipe, RecipeIngredient, RecipeVariant, SwapRule, MealPlanEntry, PlanTemplate(+Item), DayMark, Vote(+Candidate, Ballot), Rating, CookLog | Mitglieder, Gäste ab `recipes` |
| `hh-<uid>-family` | Settings, Person (Profil, Vorlieben, Allergien), CareTask, CareLog, Trip/Away*, KidProfile, KidWish | Mitglieder (Gäste `family` nur lesend für Teile davon) |
| `hh-<uid>-money` | Import, ImportLine, Expense, Budget, SpendTag, QualityRule | nur Erwachsene/Admins |
| privates DB jedes Nutzers, Zone `me` | private Einkaufsposten („nur ich"), Klarnamen diskreter Posten, eigene Einstellungen | niemand |

- **Record-Name = `uid`.** Felder = Spalten. Verweise innerhalb einer Zone als `CKRecord.Reference` (mit `.deleteSelf` für Kindsätze wie Zutaten); **zonenübergreifend nur als `uid`-Text** (CloudKit-Referenzen dürfen die Zone nicht verlassen). Die lokale DB löst beides gleich auf.
- **Bilder** (Produkt-, Rezept-, Ortsfotos, Profilbilder) als `CKAsset`, vorher auf dem Gerät verkleinert (der Server speichert heute schon WebP; die App macht das Gleiche oder HEIC).
- **Sensible Felder in `encryptedValues`**: Allergien und Vorlieben (Gesundheitsdaten), Notizen, Namen diskreter Posten, Beträge, Babysitter-Notizen.
- **Diskrete/private Posten** werden in (c) sogar besser als heute: Der geteilte Record trägt nur den Platzhalter („Drogerieartikel"), der Klarname liegt im **privaten DB** des Erstellers und erreicht die Geräte der anderen gar nicht.

**CKShare-Rechte ↔ ToHuus-Rollen:**

| ToHuus | CloudKit |
|---|---|
| Owner/Admin, der den Haushalt angelegt hat | Owner aller Zonen (nur der Owner verwaltet die Teilnehmer der Shares) |
| Mitglied | Teilnehmer `readWrite` auf order, house, kitchen, family; `money` nach Wahl |
| weiterer Admin | wie Mitglied plus `money`; Admin-Rechte innerhalb der App sind **Absprache, keine Sicherheitsgrenze** (siehe 6) |
| Dauergast `order` | `readWrite` auf order |
| Dauergast `stock` | + `readWrite` auf house |
| Dauergast `recipes` | + `readWrite` auf kitchen |
| Dauergast `family` | + `readOnly` auf family |
| Babysitter (heute Link) | `readOnly` auf house, nur wenn er/sie einen Apple-Account hat; sonst gedruckte „Wo ist was"-Karte |
| zeitliche Übersteuerung („bis Sonntag volle Rechte", „pausiert") | wird zu Teilnehmer-Änderungen, die das Owner-Gerät zum Zeitpunkt vornimmt (Hintergrundaufgabe, sonst beim nächsten Öffnen); bis dahin blendet die App lokal aus. Ehrlich: Das Ende einer Freigabe ist in (c) nicht sekundengenau. |

**Grenzen, die beim Bau gegen die aktuelle Apple-Doku zu prüfen sind:**

- Speicher zählt beim **Owner**: Alles in geteilten Zonen belegt seinen iCloud-Speicher (kostenloses Kontingent ist klein, Fotos sind der Treiber, deshalb verkleinern).
- **Recordgröße** rund 1 MB ohne Assets; Rezeptschritte, Bon-Rohtext (`imports.raw_text`) und große JSON-Felder (`shop_stores.model`) müssen darunter bleiben oder als Asset ausgelagert werden.
- **Anfragen** sind gestückelt (Größenordnung einige Hundert Records pro Operation) und gedrosselt (`requestRateLimited` mit `retryAfter`); CKSyncEngine übernimmt das Stückeln, die erste Befüllung bei einem Umzug a → c muss es respektieren.
- **Push ist nicht garantiert**, stille Pushes werden von iOS gedrosselt.
- Bewegungsdaten wachsen: `movements` braucht in (c) Kompaktierung (z. B. Buchungen älter als 60 Tage zu einer Basisbuchung je Bestandseintrag zusammenfassen, durch das Owner-Gerät).

---

## 4. Funktionen je Modus

Legende: ✅ voll · ◐ eingeschränkt/ersetzt · ✖ unmöglich

| Funktion | (a) Server | (b) App + Server | (c) iCloud | Warum / Ersatz in (c) |
|---|---|---|---|---|
| Bestand, Orte, „Wo ist was" | ✅ | ✅ offline | ✅ | Core lokal |
| Einkaufsliste live, Ladenmodus | ✅ (PWA offline) | ✅ offline, Widget | ✅ | Sync über CloudKit, Sekunden statt sofort |
| Schnelleingabe, „Ich hol's" | ✅ | ✅ | ✅ | Core `shopparse` |
| Haltbarkeit, „Zuerst essen", Resteboxen | ✅ | ✅ | ✅ | Core |
| Was essen wir heute, Wochenplan, Hausversionen, Skalieren | ✅ | ✅ | ✅ | Core |
| Rotation (automatisch anwenden) | ✅ Scheduler | ✅ | ◐ | beim Öffnen / `BGAppRefreshTask`; deterministische `uid`s verhindern Doppelte |
| Familienabstimmung | ✅ | ✅ | ✅ | nur Teilnehmer mit Apple-Account; Kinder ohne Account am Familien-iPad („ein Telefon geht rum") |
| Bestellen vom Sofa mit Push an andere | ✅ Web Push | ✅ APNs | ◐ | CloudKit-Abo → stille Push → lokale Mitteilung; nicht garantiert zeitnah |
| Benachrichtigung Haltbarkeit, Pflege, Budget, Tagesübersicht | ✅ Scheduler + Kanäle | ✅ APNs (Relay) | ◐ | lokale Mitteilungen (`UNCalendarNotificationTrigger`) nach jedem Sync neu geplant; iOS begrenzt geplante lokale Mitteilungen pro App (64), also nach Dringlichkeit auswählen |
| Push an Android/Desktop | ✅ Web Push | ✅ (Web parallel) | ✖ | kein Server, keine Nicht-Apple-Geräte |
| Telegram, Matrix, Gotify, ntfy, Webhooks, E-Mail | ✅ | ✅ | ✖ | brauchen einen dauerhaft laufenden Absender |
| Bons: Foto | ✅ Vision-Modell | ✅ | ◐ | Apple Vision (Texterkennung auf dem Gerät) + Core-Parser |
| Bons: eBon/PDF/QR-Link | ✅ | ✅ + Share-Extension | ✅ | Share-Extension + Core-Parser, Abruf per URLSession |
| Bons: IMAP-Postfach | ✅ | ✅ | ✖ | braucht Dauerabruf; Ersatz: PDF aus Mail teilen |
| Ausgaben, Budgets, CSV | ✅ | ✅ | ✅ | Core; CSV über Teilen-Menü |
| Rezeptimport aus Link/Datei/anderen Apps | ✅ | ✅ | ✅ | auf dem Gerät; SSRF-Schutz aus `net.ts` ist am Gerät nicht nötig |
| Rezeptimport per Vision-Modell | ✅ | ✅ | ◐ | nur falls ein On-Device-/Apple-Modell genügt, sonst ✖ |
| Open Food Facts (Barcode) | ✅ | ✅ | ✅ | direkter Abruf vom Gerät |
| Öffentliche Gast-Bar, Party-Board mit Beitritts-QR | ✅ | ✅ | ✖ | Gäste ohne Konto brauchen eine öffentliche URL |
| Babysitter-/Haussitter-Link | ✅ | ✅ | ◐ | nur als `readOnly`-Teilnehmer mit Apple-Account, sonst gedruckte Karte |
| Dauergäste mit Stufen | ✅ | ✅ | ◐ | über Zonen-Shares, grob (siehe 3.6) |
| Kinder-Tablet ohne Login | ✅ | ✅ | ◐ | iPad im Kindermodus mit Elternkonto + geführter Zugriff; Wünsche landen trotzdem zur Freigabe |
| Wand-/Küchendisplay, E-Ink-PNG | ✅ | ✅ | ◐ / ✖ | iPad als Display ja; PNG für E-Ink-Rahmen braucht einen Server |
| Home Assistant (HACS, Zwei-Wege, Anwesenheit, NFC) | ✅ | ✅ | ✖ | HA erreicht CloudKit nicht. Teilersatz: App Intents/Kurzbefehle, die HA anstoßen kann |
| MCP (106 Tools für KI-Assistenten) | ✅ | ✅ | ✖ | kein Endpunkt. Teilersatz: App Intents, damit Siri/Apple Intelligence und Kurzbefehle Kernaktionen ausführen |
| Widgets, Siri/Kurzbefehle, Teilen-Menü | ◐ (iPhone nur Kurzbefehl mit Schlüssel) | ✅ | ✅ | WidgetKit, App Intents, Share-Extension |
| Bon-/Etikettendruck ESC/POS | ✅ | ✅ | ◐ | Netzwerkdrucker direkt per Network.framework (Berechtigung „lokales Netzwerk") |
| QR-Etiketten (A4, Labeldrucker, PNG) | ✅ | ✅ | ✅ | Rendering auf dem Gerät, AirPrint |
| Anmeldung: Passwort, TOTP, Passkey, OIDC, PIN | ✅ | ✅ (über Systembrowser) | – | in (c) ist die Apple-ID die Identität; App-Sperre per Face ID |
| Export JSON | ✅ | ✅ | ✅ | gleiches Format v3 |
| Nächtliche Backups, WebDAV | ✅ | ✅ (Server) | ◐ | automatischer JSON-Export nach iCloud Drive/Dateien; WebDAV vom Gerät möglich, aber nicht nächtlich garantiert |
| Demo-Daten, Tour, Neu anfangen | ✅ | ✅ | ✅ | Demo-Daten als JSON im App-Paket |

---

## 5. Haushaltsformen und Einladungen

| Form | Empfohlener Modus | Einladung in (a)/(b) | Einladung in (c) |
|---|---|---|---|
| **Single** | (c) ist ideal: keine Teilung nötig, nur iCloud-Sync zwischen eigenen Geräten. (a) für Bastler mit HA. | – | keine; nur eigene Geräte (gleiche Apple-ID) |
| **Paar** | (c), wenn beide iPhone haben. Hat einer Android → (a)/(b). | Einladungslink (bestehend: `createInvite`, 7 Tage, einmalig) als QR oder Nachricht; die App liest den QR, kennt dadurch Server-Adresse und Einladungstoken, Anmeldung danach im Systembrowser | `UICloudSharingController` bzw. `ShareLink` mit dem CKShare: Einladung per Nachrichten/Mail, Annahme öffnet die App (`userDidAcceptCloudKitShareWith`) |
| **Familie** | (c) mit Kindern im Kindermodus am Eltern-iPad; Jugendliche mit eigenem Apple-Account als Teilnehmer. (a), wenn HA/Displays/Telegram gewünscht. | wie Paar; Kinder ohne Login über Kinder-Tablet-Kopplung (bestehend) | Mitglieder wie Paar; Kinder mit Account als Teilnehmer `order`-Zone; Großeltern/Tante als Dauergast über Zonen-Freigabe |
| **WG** | (a)/(b): gemischte Plattformen sind die Regel, Privatheit wichtig, kein natürlicher „Owner" (wer auszieht und Owner ist, nimmt in (c) den Haushalt mit) | wie Paar; private Posten wie heute | möglich, aber mit Warnhinweis: Owner-Wechsel geht nur über Export/Import in eine neue Zone |

Kopplung einer App mit einem bestehenden Server (b): In der Web-App unter *Einstellungen › Mein Konto* „App verbinden" → QR mit `{ url, pairing_code }` (einmalig, wenige Minuten gültig, gehasht gespeichert wie andere Einmal-Links). Die App tauscht den Code gegen einen Gerätetoken mit Scope `app`. Alternativ Adresse eintippen → Anmeldung im Systembrowser.

Owner-Risiko in (c), offen benannt: **Löscht der Owner den Haushalt oder sein iCloud-Konto, verlieren alle Teilnehmer den Zugriff.** Gegenmittel: (1) jedes Teilnehmergerät hält eine vollständige lokale Kopie; (2) Funktion „Haushalt übernehmen" = Export aus der lokalen Kopie, Import in eine neue Zone des neuen Owners, Einladungen neu verschicken.

---

## 6. Sicherheit, Datenschutz, Backup, App Store

### 6.1 Sicherheitsmodell je Modus

| | (a)/(b) | (c) |
|---|---|---|
| Wo liegen Daten | eigener Server (z. B. Hetzner in Deutschland), Gerätecache | Apple-Rechenzentren, Gerätekopien |
| Wer setzt Rechte durch | Server (`requireAuth`, `guestMay`, Scopes), unabhängig vom Client | CloudKit nur pro Zone und nur lesen/schreiben. Alles Feinere (Admin vs. Mitglied innerhalb einer Zone) erzwingt nur die App. Ein Teilnehmer mit Schreibrecht und manipuliertem Client kann alles in dieser Zone ändern. Deshalb Zonen nach Sensibilität schneiden (3.6). |
| Verschlüsselung | TLS; Gerät: SQLite mit iOS-Dateischutz (`completeUntilFirstUserAuthentication`, damit Hintergrund-Sync geht), Token im Keychain | TLS; `encryptedValues`-Felder laut Apple Ende-zu-Ende; Record-Metadaten (Typ, Name/`uid`, Zeiten, Verweise) und je nach Einstellung Assets nicht. Mit **Erweitertem Datenschutz (Advanced Data Protection)** schützt Apple deutlich mehr Ende-zu-Ende, aber nur, wenn **jeder** Teilnehmer ihn aktiviert hat. Vor dem Bau gegen Apples aktuelle Sicherheitsdokumentation prüfen und in der App ehrlich anzeigen. |
| Push | Relay sieht nur Gerätetoken und Haushalts-ID, Inhalt leer („es gibt Neues") oder Ende-zu-Ende verschlüsselt; die App holt die Daten selbst | Apple (CloudKit-Abos) |
| Sicherheitsfixes | bestehend (`security-wave5.test.ts`) | neue Prüfliste: Import fremder JSON-Dateien (Größe, Schema), Share-Annahme, Teilnehmerrechte |

### 6.2 US-Anbieter: der Kompromiss, ausdrücklich

Till meidet US-SaaS, wo Self-Hosting möglich ist. Modus (c) legt Haushaltsdaten bei Apple, einem US-Konzern, der dem US CLOUD Act unterliegt, auch wenn Daten in EU-Rechenzentren liegen sollten. Auch (b) hängt an Apple: App-Vertrieb über den App Store, Push über APNs. Die Abwägung:

- **Dafür:** Für die Masse der iPhone-Haushalte ist iCloud schon der Ort, an dem Fotos, Kalender und Erinnerungen liegen. Ein Haushaltsplaner ohne Server ist der Einstieg, ohne den die App außerhalb der Self-Hosting-Szene kaum genutzt wird.
- **Dagegen:** Es widerspricht der Positionierung „EU-souverän"; Allergien, Ausgaben und Anwesenheitsmuster sind sensibel.
- **Umgang:** (c) heißt in der App ehrlich „Ohne Server (Daten in deiner iCloud bei Apple)". Sensible Felder grundsätzlich in `encryptedValues`. Ein Ein-Klick-Umzug nach (a) ist vom ersten Tag an da. Als souveräne Alternative ohne eigene Technik bleibt eine von Heidrich Digital betriebene Instanz in der EU denkbar (Modus (a) gehostet, Thema für die Geschäftsplanung, nicht für dieses Dokument). Im Push-Relay landen keine Inhalte.

### 6.3 Backup und Wiederherstellung

- **(a)/(b):** wie heute (`backup.ts`: nächtlich, manuell, vor Migrationen, WebDAV). Der App-Cache ist entbehrlich: neu koppeln, `bootstrap`, fertig.
- **(c):** **CloudKit ist kein Backup**, denn eine Löschung synchronisiert sich auf alle Geräte. Deshalb: (1) automatischer Export v3 in den App-Container in iCloud Drive oder in einen gewählten Ordner der Dateien-App (Rotation wie heute: täglich/wöchentlich); (2) manueller Export; (3) Tombstone-Frist erlaubt „Papierkorb" für kürzlich Gelöschtes; (4) Wiederherstellung = Import in eine neue Zone (nie in die laufende, damit sich der alte Stand nicht mit dem neuen mischt).

### 6.4 App Store und Geschäft (kurz, ohne Preise)

- Apple-Entwicklerkonto mit Jahresgebühr, App-Review, Datenschutzangaben („Nutrition Label") und Privacy Manifest.
- **Lizenz:** Das Repo steht unter AGPL-3.0. GPL-Lizenzen und die App-Store-Bedingungen gelten als schwer vereinbar (bekannter VLC-Fall). Wenn `packages/core` (AGPL) in die App kommt, braucht es eine Lösung, solange Till alleiniger Rechteinhaber ist: eine ausdrückliche **App-Store-Ausnahme** zur AGPL oder Doppellizenz für Core und App. Fremde Beiträge zum Core vorher nur mit Beitragsvereinbarung (CLA) oder ausdrücklicher Zustimmung zu dieser Ausnahme annehmen. Vor der ersten Veröffentlichung rechtlich prüfen lassen.
- **Bezahlmodelle** (z. B. Relay, gehostete Instanz, Extras in der App): digitale Leistungen, die in der App genutzt werden, fallen unter Apples In-App-Kauf-Regeln mit Provision; in der EU gibt es durch den DMA alternative Wege mit eigenen Bedingungen. Entscheidung gehört in die Geschäftsplanung, nicht hierher.
- **Push-Relay** ist ein Dienst, den jemand dauerhaft betreibt (Verfügbarkeit, Schlüssel für APNs, Auftragsverarbeitung nach DSGVO gegenüber den Haushalten). Self-Hoster ohne Relay bekommen nur Hintergrundabgleich ohne Push.

---

## 7. Stufenplan (Arbeitsblöcke, keine Aufwandsschätzung)

### Phase 0: vorbereitend im Repo, ohne iOS-App

Jeder Block ist für sich lieferbar, ändert kein Verhalten der Web-App und hat eigene Tests.

| Block | Inhalt | Fertig, wenn |
|---|---|---|
| **0.1 Entscheidung festhalten** | dieses Dokument + kurze ADR-Notiz in `docs/architecture.md` (Verweis) | Verweis drin |
| **0.2 `packages/core` + Reinheitstest** | Workspace, `tsconfig` ohne Node-Typen, `test/core-purity.test.ts` (neutraler esbuild-Bundle + Import-Verbote) | Test grün, CI baut Core separat |
| **0.3 Welle 1 umziehen** | `text`, `shopparse`, `scale` (+ `web/src/scale.ts` zusammenführen), `redact`, `recipe-jsonld`, `recipe-translate`, `qr`, `importers/*`, `ha2-engine`, `kids-rules`, `languages`; Stubs in `server/lib` | alle 455 bestehenden Tests unverändert grün, Web nutzt Core-`scale` |
| **0.4 Kontext + Welle 2** | `Ctx` (Zeit, Zeitzone, `t`, Region); `productStatus`, Haltbarkeit (`fresh-shelf`), reine Teile von `variants`, `isTrackedProduct` | Core-Tests ohne `DATA_DIR`, ohne Datenbank |
| **0.5 Welle 3: Snapshots** | `suggest`, „Was essen wir heute", Rotation/Auto-Füllen, Personensignale, Urlaubsfenster, Ausgaben | Snapshot-Fixtures unter `packages/core/test/`, Server-Ergebnis = Core-Ergebnis |
| **0.6 i18n in den Core** | Wörterbücher als Daten, `createT` | `languages.test.ts` auf Core umgestellt |
| **0.7 `uid`-Spalten** | Named Migration `sync-1`: `uid` + Unique-Index + Backfill + Insert-Trigger für alle portablen Tabellen; `*_uid`-Spalten für Personenbezüge; Liste der portablen Tabellen in `packages/core/src/sync/schema.ts` | Test: jede portable Tabelle hat nach Insert eine `uid`; Pre-Migration-Backup greift |
| **0.8 Export v3** | `EXPORT_VERSION = 3`; Manifest (`household_uid`, Tabellenklassen `portable`/`instance`, Schema-Hash); Import (`buildFromExport`) akzeptiert v2 und v3, erhält `uid`s; v2 bekommt beim Import frische `uid`s | Round-Trip-Test Export → Import → Export gleich (bis auf Zeitstempel); v2-Fixture importierbar |
| **0.9 Änderungsprotokoll + HLC** | `sync_log` per Trigger (Verallgemeinerung von `ha2_touch`), `hlc`/`field_hlc`, Tombstone-Frist, Kompaktierung | Test: Insert/Update/Delete erzeugen genau einen gültigen Eintrag je Zeile |
| **0.10 Bestand als Buchungen** | `movements.uid`, `stock_uid`; idempotentes Anwenden einer Buchung; Kompaktierung | Test: zwei „Offline-Geräte" entnehmen je 1, Ergebnis −2 |
| **0.11 Sync-Engine im Core** | `ha2-engine` → `sync/engine.ts` mit HLC und Strategie pro Tabelle; HA-Abgleich nutzt weiter dieselbe Engine | `ha2.test.ts` grün, neue Engine-Tests |
| **0.12 Sync-API v1** | `/api/sync/v1/bootstrap`, `changes`, `push`; `sync_ops` (Verallgemeinerung `shop_ops`); Scope `app`; Rechte-Filter nach `people-policy`; SSE-Thema `sync` | Konformitätstest mit einem Headless-TS-Client, der zwei Geräte offline simuliert und danach denselben Stand hat |
| **0.13 Kopplung** | QR „App verbinden", Pairing-Code → Gerätetoken; Anmelde-Rückweg für `ASWebAuthenticationSession` (`tohuus://`-Callback mit Einmalcode) | Test über HTTP, ohne App |
| **0.14 Gemeinsame Testvektoren** | `packages/core/test/vectors/*.json` (Eingabe → erwartetes Ergebnis) für Status, Skalieren, Schnelleingabe, Merge, Buchungen | TS-Tests lesen sie; später liest die Swift-Testsuite dieselben Dateien |

### iOS-Phasen (danach)

| Phase | Inhalt |
|---|---|
| **I1 Schale + (b) lesend** | SwiftUI-Grundgerüst, Kopplung per QR/Adresse, Anmeldung im Systembrowser, `bootstrap` + `changes` in GRDB, Heute/Einkauf/Bestand lesend, Core in JavaScriptCore eingebunden (Status, Skalieren) |
| **I2 (b) schreibend + offline** | Outbox, `push`, Ladenmodus offline, Schnelleingabe, Barcode (VisionKit), Rezepte, Wochenplan |
| **I3 Apple-Integration** | Widgets (Einkaufsliste, Heute), App Intents (auf die Liste setzen, was essen wir heute, Bestand buchen), Share-Extension (Text, Link, Bon-PDF, Foto) |
| **I4 Push** | Relay (EU, inhaltsfrei), APNs-Registrierung, stille Push → Delta-Abgleich, sichtbare Mitteilungen für Bestellungen/Pflege |
| **I5 (c) Einzelhaushalt** | CKSyncEngine, Zonen, `encryptedValues`, lokale Mitteilungen statt Scheduler, `BGAppRefreshTask`, automatischer Export nach iCloud Drive; noch ohne Teilen |
| **I6 (c) Teilen** | CKShare pro Zone, Einladung über Nachrichten/Mail, Rollen ↔ Zonen, private Zone für „nur ich", Owner-Risiko-Funktionen („Haushalt übernehmen") |
| **I7 Umzugsassistent** | c → a (Export v3 hochladen, Gerät auf (b) umstellen, Quelle einfrieren), a → c (Import mit Bericht, was wegfällt) |
| **I8 Veröffentlichung** | Lizenzfrage (AGPL-Ausnahme) geklärt, Datenschutzangaben, Review, TestFlight mit dem eigenen Haushalt (Fredirando) zuerst |

### Offene Punkte für den nächsten Agenten

1. Liste „portabel vs. instanzgebunden" für alle rund 90 Tabellen festlegen (Startpunkt: `exportTables()` in `server/lib/data.ts`; instanzgebunden u. a. `ha2_*`, `ha_todo_pos`, `shop_ha_links`, `channel_*`, `guest_links`, `displays`, `kid_devices`, `print_*`, `retail_mail`, `push_subscriptions`, `auth_*`, `demo_rows`).
2. CloudKit-Grenzen (Record-, Asset-, Anfragegrößen, Verhalten von `encryptedValues` und ADP bei geteilten Zonen) gegen aktuelle Apple-Dokumentation verifizieren und hier nachtragen.
3. Lizenzfrage AGPL ↔ App Store klären, bevor Code aus `packages/core` in ein App-Paket wandert.
4. Wer betreibt das Push-Relay, wo, mit welchem Vertrag; ohne Relay ist (b) ohne Push.
