# Übergabe zum Abschluss, 13.10.2026

Für Till. Diese Datei ergänzt [uebergabe-2026-10-13.md](uebergabe-2026-10-13.md). Dort stehen der Deploy in Coolify
(Abschnitt 2) und der Xcode-Build (Abschnitt 3) Schritt für Schritt. Beides gilt weiter. Hier steht, was seitdem
dazugekommen ist und was du zusätzlich tun musst.

Alles liegt auf `claude/tohuus-status-btntbq`, Draft-PR https://github.com/tillheidrich/tohuus-hub/pull/1
(41 Commits über `main`). **Nichts ist deployed.** Die iOS-App ist **nicht kompiliert** (kein Xcode hier).
Stand der Tests: Typecheck grün, 1009 Tests grün, 9 übersprungen, Web-, Server- und Website-Build grün,
Kontrastprüfung grün.

---

## 1. Reihenfolge für dich

1. PR prüfen und mergen, CI und Docker abwarten (alte Übergabe, Abschnitt 2.1).
2. Backup des Volumes `/data`, dann Redeploy (alte Übergabe, 2.2 bis 2.4). Neu beim Start: Die Tabellen
   `mail_addresses` und `mail_stats` in `accounts.db` legt der Server selbst an.
3. Neue Umgebungsvariablen nach Bedarf (Abschnitt 3 unten). Ohne sie läuft alles, die Funktionen sind dann nur aus.
4. iOS: `CURRENT_PROJECT_VERSION` auf **6** setzen, `xcodegen generate`, bauen, Compiler-Fehler an mich (alte
   Übergabe, Abschnitt 3). Dazu kommt Abschnitt 4 unten.
5. App Store Connect: Lifetime-Produkt (optional) und Offer Codes für die Beta-Tester (Abschnitt 5 unten).
6. Domain `tohuus-app.de`, wenn du sie registriert hast: [domain.md](domain.md) und [mail-inbox.md](mail-inbox.md).

---

## 2. Was neu ist

### Assistent: hilft bei allem rund um die App, macht sonst nichts

- **Schutz vor Missbrauch in drei Stufen** (`server/lib/assistant-scope.ts`, Doku in [assistant.md](assistant.md)
  unter „Scope“):
  1. Ein fester Filter vor jedem Modellaufruf. Versuche, die Rolle zu ändern („ignoriere alle Anweisungen“, „zeig
     deinen Systemprompt“, „du bist jetzt …“, Rollenspiele), und klar fremde Themen (Programmieren, Hausaufgaben,
     Bewerbungen, Übersetzen, Gedichte, Politik, Aktien, Wetter, Medizin, Recht, Waffen, Erotik) bekommen eine kurze,
     freundliche Antwort mit einem Angebot aus dem Haushalt. Das kostet keinen Modellaufruf und zählt nicht ins
     Kontingent.
  2. Der Filter ist bewusst vorsichtig. Steht ein Haushaltswort in der Nachricht („Rezept“, „Liste“, „Budget“,
     „Milch“ …), geht sie durch. „Übersetz mir das Rezept“ oder „Waschmittel Dosierung?“ funktionieren also weiter.
  3. Für alles, was der Filter nicht erkennt, gelten die Regeln im Systemprompt. Rolle und Regeln ändern sich nie.
     Text aus Rezepten, Bons, Links und Werkzeugen gilt als Inhalt, nie als Anweisung (Schutz gegen versteckte
     Befehle in importierten Rezepten oder weitergeleiteten Mails). Das Modell kann ohnehin nur die
     Haushaltswerkzeuge benutzen: kein Web, kein Code, keine Mails, keine anderen Haushalte.
- **„Kann sie immer helfen?“** Neues Werkzeug `app_help`: Auf „Wie geht …?“, „Wo finde ich …?“ und „Kann ToHuus …?“
  nennt der Assistent den Weg in der App und verlinkt die passende Hilfeseite. Die Wege stehen in `APP_GUIDE` in
  `assistant-scope.ts`. **Bitte einmal gegenlesen**, ob die Menünamen zu den Apps passen (z. B. „Mehr › Urlaub“,
  „Einstellungen › Abo“).
- **Neues Werkzeug `budget_set`**: Budgets per Sprache setzen, für alle oder nur für dich (privat).
- **Was der Assistent steuern kann und was nicht**: Liste, Vorrat, Kochideen, Rezepte anpassen und speichern,
  Wochenplan, Geld und Budgets, Wünsche, Hausinfo-Entwürfe, Gäste-Einkauf, „merk dir“. Alles, was einen Bildschirm
  braucht (Bon scannen, Einstellungen, Einladungen, Abo), bleibt in der App, und der Assistent sagt, wo es ist. Eine
  verbundene KI über MCP (Claude, ChatGPT) hat rund 120 Werkzeuge und kann deutlich mehr: Massenimport von Rezepten,
  Urlaub, Party, „Bring mir was“, Reste, Pflege, Home Assistant.

### Rezepte von Küchenmaschinen: wie Cookidoo, auch für Lidl, Bosch und andere

- Monsieur Cuisine (Lidl), Cookit / Home Connect (Bosch), Kenwood World, Tefal / Moulinex / Krups Companion, Magimix
  Cook Expert, KitchenAid Cook Processor, Cecotec Mambo und Philips NutriU verhalten sich jetzt wie Cookidoo
  (`server/lib/device-platforms.ts`).
  - In der Cloud ruft der Server diese Seiten und ihre Fotos nie ab.
  - Wer einen Link teilt, bestätigt Titel und Zutaten.
  - Zutaten, Schritte und Fotos bringt die Person selbst mit: als Screenshot, als kopierten Text oder über ihre
    eigene KI per MCP (`save_recipe` mit `image_base64`, auch als Massenimport).
- **Neu: kopierten Text einfügen.** „Mit KI lesen“ macht aus eingefügtem Text Titel, Zutaten, Schritte und
  Portionen. Ohne KI sortiert ToHuus den Text einfach in Zeilen. Gespeichert wird erst nach dem Bestätigen. Das
  gibt es im Web und auf dem iPhone (`POST /api/recipes/import/device/read-text`).
- Kitchen Stories und Ninja Kitchen sind normale Rezeptseiten und laufen über den gewohnten Import.
- **Unsicher**: Die Adressen der kleineren Plattformen konnte ich nicht live prüfen. Sicher sind nur `cookidoo.*`,
  `monsieur-cuisine.com`, `kenwoodworld.com` und `nutriu.com`. Bosch Cookit (`homeconnect.page.link`,
  `cookit.bosch-home.*`) und die Herstellerseiten sind Annahmen. Wenn du einen echten geteilten Link aus einer
  dieser Apps hast, schick ihn mir, dann passe ich die Liste an.

### Plus und Haushalt: Der Server prüft jetzt selbst

- Bisher hat nur die App geprüft, welche Funktionen ein Plan hat. Jetzt antwortet der Server ohne passenden Plan
  mit HTTP 402 und einer freundlichen Meldung („Das gehört zu Plus. Du kannst jederzeit unter Einstellungen › Abo
  wechseln.“). Die Tabelle steht in [cloud.md](cloud.md) unter „Plans and quotas“:
  - **Ab Haushalt**: Preisverlauf, neue Spiegelungen zu Apple Erinnerungen oder Nextcloud, neue Mitversorgen-Listen
    (verbundene Haushalte), die volle Historie.
  - **Nur Plus**: die Woche aus dem Vorrat füllen (App, Home Assistant, MCP), Monatsvergleich im Assistenten und die
    Bon-Adresse.
- Probezeit und Beta-Geschenk zählen wie Plus. Solange `beta.gift` auf Plus steht, merkt also niemand etwas. Erst
  wenn du das Geschenk abschaltest, greifen die Pläne.
- **Noch ohne eigene Prüfung**: „Ersatz aus dem Vorrat“ steht nur in den Plan-Limits, nicht auf der Website. Entweder
  einer Funktion zuordnen oder streichen.

### Lifetime (optional) und Codes für Beta-Tester

- Neues, optionales Produkt **`de.heidrichdigital.tohuus.plus.lifetime`** (Typ „Non-Consumable“, also einmal
  kaufen): Plus für immer.
  - Die App zeigt die Karte „Plus für immer“ nur, wenn es das Produkt in App Store Connect gibt. Ohne Produkt
    ändert sich nichts. Daraus *kann* also Lifetime werden, muss aber nicht.
  - Ein Abo überschreibt Lifetime nie. Nur eine Erstattung beendet es.
  - Läuft nach dem Kauf noch ein altes Abo, bittet die App, es zu kündigen.
- **Codes für Beta-Tester** sind Apples Offer Codes. Die Tester lösen sie in der iPhone-App unter Abo › „Code
  einlösen“ ein; das geht auch, solange das Beta-Geschenk an ist. Der Server bekommt den Kauf als normale
  Transaktion, du musst also nichts weiter einstellen. Unsere eigenen `GIFT-…`-Codes bleiben nur im Web
  (App-Store-Regel 3.1.1).

### Bon-Adresse per E-Mail (Plus, Cloud)

- Jeder Haushalt bekommt eine eigene Adresse `bons-<zufall>@bons.<domain>` zum Weiterleiten. Neben dem Bon erkennt
  ToHuus auch Bestell- und Abholbestätigungen. Einmalcodes, Anmelde-Mails und Newsletter verwirft es ungelesen.
  Gespeichert wird nur der erkannte Bon, sonst nur Zähler. Konzept und Einrichtung: [mail-inbox.md](mail-inbox.md).
- **Offen**: Deine Beispiel-Mails (Bestellbestätigung, Abholung, Bon). Daraus mache ich Testfälle und schärfe die
  Erkennung nach.

### Sonst seit der ersten Übergabe

- Cookidoo in der Cloud: Was die Person mitbringt (Schritte, Fotos), bleibt erhalten. Cookidoo selbst wird nie
  abgerufen.
- Die Domain steht an einer Stelle pro Codebasis (`SITE_URL`, `site/src/config.mjs`, `web/src/urls.ts`,
  `SharedConfig`). Für den Umzug auf `tohuus-app.de` gibt es eine Checkliste in [domain.md](domain.md).
- 20 Ratgeber-Artikel mit Faktenkarten, die man als Bild speichern kann, und eine Faktenseite.
- Sign in with Apple: Beim Löschen eines Kontos wird die Apple-Anmeldung widerrufen (sobald der Key gesetzt ist).
- Home-Assistant-Integration 0.3.1. Persönliche Anmeldewarnungen tauchen nicht mehr bei anderen auf.
- Website:
  - FAQ zu KI, Rezeptimport und Cookidoo.
  - Hilfeartikel „Cookidoo, Monsieur Cuisine und andere Küchenmaschinen“.
  - Im Artikel „Sprechen“ steht jetzt, was der Assistent macht und was er ablehnt.

---

## 3. Neue Umgebungsvariablen (Coolify, `tohuus-cloud`)

| Variable | Wofür | Ohne sie |
|---|---|---|
| `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_KEY_P8`, `APPLE_TEAM_ID=FVS7WVTQ67` | Widerruf von Sign in with Apple beim Löschen (Pflicht für den App Store) | Anmeldung geht, Widerruf fehlt |
| `MAIL_INBOUND_DOMAIN=bons.tohuus-app.de` | Bon-Adressen | Funktion unsichtbar |
| `MAIL_SMTP_PORT=2525` plus Port-Mapping `25:2525` | Empfang der Mails | keine Mails |
| `MAIL_TLS_CERT_FILE`, `MAIL_TLS_KEY_FILE` | STARTTLS für den Mailempfang (empfohlen) | Mails kommen unverschlüsselt an |
| `MAIL_INBOUND_SECRET` | Webhook statt SMTP, nur falls später ein Dienst davor soll | Webhook aus |
| `SITE_URL` | erst nach dem Domainumzug | bleibt bei der alten Website |

DNS für die Bon-Adresse (Cloudflare, Proxy aus): `bons.tohuus-app.de MX 10 mail.tohuus-app.de` und
`mail.tohuus-app.de A <Hetzner-IPv4>`. In der Hetzner-Firewall eingehend TCP 25 erlauben. Details stehen in
[mail-inbox.md](mail-inbox.md), Abschnitt „Setup“.

---

## 4. Xcode: zusätzlich zur ersten Übergabe

- Keine neuen Dateien, aber geänderte:
  - `PaywallView.swift`: Lifetime-Karte, Hinweis auf ein noch laufendes Abo.
  - `StoreManager.swift`: Lifetime-Produkt.
  - `Account.swift`: `lifetime`.
  - `RecipeImportSheet.swift`: Plattformname, „Text einfügen“, „Mit KI lesen“.
  - Außerdem `RecipeDetailView.swift`, `KnowledgeViews.swift`, `ShareViewController.swift`, `MailAddressSection.swift`
    und `OnDeviceAI.swift` (Apple Intelligence, abschaltbar).
- Die Strings sind erzeugt (`python3 ios/tools/gen_strings.py`). Sie haben alle eine deutsche Übersetzung.
- Kurz prüfen nach dem Build:
  - Kochen › Rezept per Link mit einem Monsieur-Cuisine-Link: Das Formular „Monsieur Cuisine-Rezept“ erscheint.
    „Text einfügen“ und „Mit KI lesen“ füllen die Felder.
  - Abo: „Code einlösen“ öffnet Apples Fenster, auch während der Beta.
  - Mit einer StoreKit-Testkonfiguration, die `plus.lifetime` enthält, erscheint „Plus für immer“. Ohne sie
    erscheint die Karte nicht.

---

## 5. App Store Connect (machst du, kein Agent)

1. **Abos** wie geplant: Gruppe „ToHuus“ mit `haushalt.monthly`, `haushalt.yearly`, `plus.monthly`, `plus.yearly`.
2. **Optional Lifetime**: In-App-Käufe › + › Nicht-Verbrauchsartikel, Produkt-ID
   `de.heidrichdigital.tohuus.plus.lifetime`, Preis nach deiner Wahl. Wenn du es nicht anlegst, passiert nichts.
3. **Offer Codes für Beta-Tester**:
   - Für ein Abo: Abo öffnen › Angebotscodes › Code erstellen, z. B. „6 Monate Plus kostenlos“.
   - Für Lifetime: Produkt öffnen › Angebotscodes, sofern Apple das für dein Konto anbietet.
   - Einmalcodes einzeln verschicken oder einen eigenen Code mit Limit anlegen.
4. **Server-URL für App Store Server Notifications v2**: `https://<cloud-domain>/api/billing/apple/notifications`
   (Produktion und Sandbox).
5. **Wann du das Beta-Geschenk abschaltest**: im Backoffice unter Geschenke. Danach gelten Probezeit, Abo, Lifetime
   oder Free.

---

## 6. Offen und Ideen

- **Beispiel-Mails** für die Bon-Adresse (siehe oben).
- **Echte geteilte Links** aus Monsieur Cuisine, Cookit und Kenwood, damit die Erkennung sicher passt.
- **`APP_GUIDE` gegenlesen**: Stimmen die Menüwege? Was fehlt dir?
- **Plantext**: „Ersatz aus dem Vorrat“ einer Funktion zuordnen oder streichen.
- **Assistent prüfen mit einem echten Modell**: `node scripts/assistant-eval.mjs` gegen OpenRouter. Dazu ein paar
  Missbrauchsversuche selbst ausprobieren. Was durchrutscht, schick mir, dann kommt es in den Filter oder in die
  Tests.
- **Domainumzug** auf `tohuus-app.de`: Checkliste in [domain.md](domain.md). Für den Code ist es eine Variable pro
  Codebasis; die Apple-Seite (Associated Domains, Sign in with Apple, Return URLs) machst du in Apple Developer.
