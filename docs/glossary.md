# Glossar: ein Wort pro Ding (Paket D, 20.10.2026)

Aus dem UX-Audit (`docs/ux-audit-2026-10.md`, Abschnitt 6, Befund P1-4). Gilt für Leiste, Mehr, Seitentitel, Suche,
Hilfe (`site/src/help.mjs`), Tour, Mitteilungen, Mails, Assistent-Antworten, MCP-Beschreibungen, Widgets und Siri, in
Web, iPhone, Cloud und eigenem Server. Routen, Ids und Modul-Schlüssel bleiben (Aliase), nur die sichtbaren Wörter
ändern sich. `test/glossary.test.ts` hält die alten Wörter draußen.

## Tabelle

| Ding | Deutsch | Englisch | nicht mehr | Id / Route |
|---|---|---|---|---|
| Startseite | Heute | Today | – | `today` / `/` |
| Einkaufsliste, Laden-Modus | Einkauf (Seite), Liste (Karte), Im Laden (Modus) | Shopping, List, In the store | – | `shopping` / `/einkauf` |
| Rezepte, Wochenplan | Kochen | Cooking | Cook | `cooking` / `/kochen` |
| Wiederkehrendes zu Hause | Aufgaben | Tasks | Pflege (als Bereich) | `tasks` / `/aufgaben` |
| Tab „was bei uns ist“ (Vorrat + Türen) | Zuhause | Home | – | `stock` / `/bestand`, Alias `/zuhause` (Paket A: Vorrat + Türen Hausinfo, Haushaltswissen, Wo ist was?) |
| Lebensmittel und Sachen im Haus | Vorrat | Pantry | Bestand, Produkte im Haus | – |
| Was wieder gekauft werden müsste (Kaufrhythmus) | Bald wieder nötig | Needed again soon | Fällig (für Käufe) | Heute-Karte `rhythm` |
| Aufgabe ist dran | fällig | due | – | – |
| Codes, Müllplan, Geräte | Hausinfo | House info | Pflege & Hausinfo | `houseinfo` / `/hausinfo` |
| Größen, Maße, Nummern | Haushaltswissen (in der Leiste kurz: Wissen) | Household knowledge (bar: Knowledge) | Was ToHuus sich merkt, Haushaltsgedächtnis, Gedächtnis | `knowledge` / `/wissen` |
| Wo liegt was | Wo ist was? | Where’s what? | – | `/wo` |
| Gedanken, die Arbeit machen | Im Kopf | On my mind | – | `/kopf` |
| Geld, geteilte Kosten | Geld · Ausgaben · Abrechnung | Money · Spending · Split | Geldliste | `money` / `/geld` |
| Kassenbon, eBon | Bon | Receipt | – | `/import` |
| Gedruckter Zettel vom Drucker | Zettel | Ticket | Bon (für Drucker) | – |
| Wunsch ans Haus | Bring mir was | Bring me something | Treats | `orders` / `/bestellen` |
| Gäste-Links, Party | Gäste | Guests | – | `/bar` |
| Geschenk- und Merklisten | Wünsche | Wishes | – | `wishes` / `/einkauf/wuensche` |
| Menschen im Haushalt | Leute | People | Mitglieder (als Bereich) | `/einstellungen/haushalt/leute` |
| Eine Aufgabe nach der anderen | Nur eins (Modus, Seite, Live Activity, Hilfe) | Just one | Jetzt, Eins nach dem anderen, Eine Sache nach der anderen | `/fokus` |
| Aufgaben-Tab auf dem Kinder-Tablet | Zu tun | To do | – | – |
| Schonender Ton | Sanfter Modus | Gentle mode | – | – |
| Einstellungen dazu | Ruhe & Fokus | Calm & focus | – | `/einstellungen/ich#fokus` |
| Bereiche an/aus | Was nutzt ihr? | What do you use? | Was soll verfolgt werden? (für Bereiche) | `/einstellungen/bereiche/module` |
| Was im Vorrat gezählt wird | Vorrat: was verfolgen? | Pantry: what to track? | Was soll verfolgt werden? | `/einstellungen/bereiche/vorrat` |
| Benachrichtigungen | Mitteilungen | Notifications | Benachrichtigungen | `/einstellungen/mitteilungen` |
| KI-Schalter | KI | AI | Zugänge & KI, Mit oder ohne KI | `/einstellungen/verbindungen/ki` |
| Zugänge für Claude, ChatGPT, HA | KI-Assistenten & Zugänge | AI assistants & access | Zugänge & KI | `/einstellungen/verbindungen/assistent` |
| Bezahlplan | Abo · Abo & Speicher | Plan · Plan & storage | Plan & Speicher | `/einstellungen/daten/abo` |
| Runder Knopf | Assistent | Assistant | Sprechen (als Name) | – |
| Untere Leiste | Deine Leiste | Your bar | – | `/leiste` |
| Avatar-Menü | Mehr | More | – | `/mehr` |
| Zählbares | Sache, Sachen | item, items | Ding, Dinge | – |

## Regeln

- **Ein Ding, ein Wort.** Wer ein neues Wort braucht, trägt es hier ein, bevor es in Code kommt.
- **Einstellungs-Pfade** immer vollständig nach `web/src/settings/registry.ts`: „Einstellungen › Seite › Zeile“
  (z. B. „Einstellungen › Verbindungen & Geräte › KI“, EN „Settings › Connections & devices › AI“). Gilt für
  Server-Texte, Mails, Pushes, MCP-Beschreibungen und Hilfe. Pfade fremder Apps (Claude, Nextcloud, Gmail, iPhone)
  bleiben, wie die Apps sie nennen.
- **Rolle vs. Bereich:** „Mitglied“ bleibt als Rolle (Admin · Mitglied · Gast) und in Sätzen wie „nur für angemeldete
  Mitglieder“. Der Bereich und die Liste der Personen heißen „Leute“.
- **Mikrofon:** Im Assistenten heißt der Mikrofon-Knopf weiter „Sprechen“ (Diktat). Der runde Knopf selbst ist der
  Assistent, nie „Sprechen“.
- **Bondrucker** bleibt als Gerätename. Was er druckt, heißt „Zettel“ (Pflege-Zettel, Wunsch-Zettel). „Bon“ ist nur der
  Kassenbon, auch der digitale (eBon).
- **„fällig“** nur für Aufgaben und Termine. Der Kaufrhythmus sagt „bald wieder nötig“.
- **„ToHuus merkt sich …“** bleibt als Satz (Positionierung), nur nicht als Name eines Bereichs. Die Hilfe-Seite
  `merkt-sich` heißt jetzt „Der Kaufrhythmus“.
- Ton: du-Form, ruhig, kurz, keine Werbesprache, keine Gedankenstrich-Ketten (till-stimme, Stufe 3; humanizer nur als
  Prüfliste).

## Entscheidungen in Paket D (wo das Audit offen war)

- „Nur eins“ für Modus und Seite (Till). Die Seite `/fokus` heißt „Nur eins“; „Nur eins reicht.“ im sanften Modus.
- „Haushaltswissen“ als Name, „Wissen“ nur in der Leiste (Till). Die alte Eyebrow „Euer Haushaltsgedächtnis“ heißt
  „Euer Haushaltswissen“.
- Geteilte Kosten: „Abrechnung“ / EN „Split“ (Audit), Knöpfe „Neue Abrechnung“ / „New split“.
- Drucker: „Zettel“ / EN weiter „ticket“ (Till: Zettel statt Ausdruck). Der Einstellungs-Titel heißt nur „Drucker“.
- Self-Host-Sprache: Browser zuerst, sonst Deutsch (siehe unten).
- „Merkt sich“ (Abo-Übersicht, Verlauf in Tagen) heißt jetzt „Verlauf“.
- Die Heute-Kachel „Einfach sprechen“ heißt „Einfach sagen“ / „Just say it“.
- Die Hilfe-Seite „Mit oder ohne KI“ heißt „KI an oder aus“ / „AI on or off“ (Slug bleibt `ki-an-oder-aus`).

## Funktions-Register (`shared/functions.json`)

Eine Liste aller Funktionen außerhalb der Einstellungen (die stehen in `web/src/settings/registry.ts`). Felder:

| Feld | Bedeutung |
|---|---|
| `id` | eindeutig, stabil |
| `group` | `bereiche` (Leiste) · `zuhause` (Türen im Tab Zuhause) · `alltag` · `familie` (Familie & Gäste) · `kopf` (Kopf & Fairness) · `hilfe` (Einstellungen & Hilfe) – die Gruppen von Mehr nach UX-Audit 5.2 |
| `title`, `words` | Deutsch und Englisch; die Suche findet beide Sprachen, Umlaute egal |
| `web` | Web-Route (muss in `App.tsx` stehen) oder `null` |
| `ios` | `tab:<area>`, `settings` oder ein Fall von `SearchRegistry.Target` in `GlobalSearchView.swift` |
| `help` | Slug einer deutschen Hilfe-Seite oder `null` |
| `platforms`, `roles`, `module` | wer es wo sieht; abgeschaltete Bereiche („Was nutzt ihr?“) blenden aus |

- Web: `web/src/search/functions.ts` (`functionsFor`, `matchFunctions`), genutzt von `GlobalSearch.tsx`.
- iPhone: `ios/project.yml` kopiert die Datei ins App-Bundle; `FunctionRegister` in `GlobalSearchView.swift` liest sie
  und filtert mit denselben Regeln.
- Nur auf einer Plattform (bewusst): `kitchen` (Küchenmodus, iPad; Web entscheidet Paket E).
- Mehr (Paket A) liest `more` aus derselben Datei: Gruppen, Zeilen, höchstens fünf je Gruppe (`docs/navigation.md`). Optional `more` an einer Funktion = längerer Zeilentitel in Mehr (Wünsche: „Wunschlisten & Geschenke“).
- `test/functions-registry.test.ts`: jede Route existiert, jedes iOS-Ziel ist bekannt, jeder Hilfe-Slug existiert,
  Web und iPhone liefern dieselben Ids.

## Sprache beim ersten Start (eigener Server)

Solange niemand eine Sprache gewählt hat (kein `LANGUAGE` in der Umgebung, keine Einstellung im Haushalt), antworten
`/api/instance` (`lang`, neu `langChosen`) und `/api/auth/options` (`language`) in der Browsersprache
(`Accept-Language`), sonst Deutsch. Der erste Admin, der die App öffnet (`GET /api/me` mit Browsersprache), legt die
Haushaltssprache fest; danach gilt sie für alle, Mails und Pushes eingeschlossen. Das Web nimmt ohne gespeicherte
Wahl die erste passende Sprache aus `navigator.languages`, sonst Deutsch. Code: `server/lib/instance-lang.ts`,
`server/languages.ts › pickLang`, `web/src/i18n.ts › browserLang`. Test: `test/instance-lang.test.ts`. Die Cloud ist
nicht betroffen.
