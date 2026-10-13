# Übergabe 13.10.2026: ToHuus nach Welle 3

Für Till. Alles liegt auf dem Branch `claude/tohuus-status-btntbq`, Draft-PR
https://github.com/tillheidrich/tohuus-hub/pull/1 (24 Commits über `main`). **Nichts davon ist deployed** und die
iOS-App wurde hier **nicht kompiliert** (kein Xcode in dieser Umgebung). Die Reihenfolge unten ist die, in der du es
abarbeiten solltest.

---

## 1. Kurz: Sind wir ready?

| Bereich | Stand | Bereit? |
|---|---|---|
| Server und Web-App | ca. 963 Tests grün (ein bekannter Wackel-Test, siehe 7.), Typecheck grün | **Ja, nach dem Deploy** |
| Cloud (cloud.tohuus…) | läuft noch auf dem Stand vom **12.10. abends**. Daher kommen die Fehler beim Bon, das fehlende „unauthorized“ bei Apple und die fehlenden Funktionen im Haushalt Fredirando | **Nein, bis zum Deploy (Schritt 2)** |
| iPhone-, iPad- und Watch-App | Code fertig, aber nicht gebaut. Neue Dateien und ein neues Ziel für UI-Tests | **Erst nach einem grünen Xcode-Build (Schritt 3)** |
| App Store (nicht TestFlight) | Abos in App Store Connect fehlen noch, Rechtstexte sind Entwürfe | **Nein, siehe 5.** |
| TestFlight-Beta | Mit Deploy und Build 6: ja. Abos sind während der Beta über `beta.gift` geschenkt | **Ja, nach Schritt 2 und 3** |
| Website | Neue Screenshots, „Bring mir was“, Wünsche, Grundlage für den Blog, Sitemap und llms.txt | **Ja, geht beim Merge automatisch live** |

**Fazit:** Für eine TestFlight-Beta mit Freunden sind wir nach Deploy und Build 6 bereit. Für den öffentlichen App
Store fehlen noch die Punkte in Abschnitt 5 (Apple-Konten und Rechtliches), am Code liegt es nicht mehr.

---

## 2. Deploy der Cloud (Coolify)

So läuft es: Ein Push auf `main` baut über GitHub Actions (`docker.yml`) das Image
`ghcr.io/tillheidrich/tohuus-hub:latest`. Coolify zieht es beim Redeploy. Die Website geht über `pages.yml` von allein
live (nur wenn sich `site/**` ändert).

1. **PR #1 prüfen und mergen** (Squash oder Merge, beides geht). Danach in GitHub › Actions warten, bis „CI“ und
   „Docker“ grün sind.
2. **Vorher ein Backup ziehen**: In Coolify beim Dienst `tohuus-cloud` das Volume `/data` sichern (Snapshot oder
   `tar`). Drei Migrationen laufen beim Start automatisch: `handover-1` (Urlaubsübergabe), `house-guide-media`
   (Fotos und Videos in der Hausinfo) und `budgets-year-mine` (baut die Tabelle `spend_budgets` neu auf). Dazu kommen in
   `accounts.db` die Spalten `blocked_at`/`blocked_reason` sowie die Tabellen für Geschenkcodes und das Fehlerprotokoll.
3. **Umgebungsvariablen in Coolify prüfen**:
   - `OPERATOR_EMAILS=mail@tillheidrich.de` (oder deine Login-Adresse). Ohne diesen Eintrag liefert `/betrieb` nur 404.
   - `CLOUD_SIGNUP` **nicht setzen**. Dann gilt `invite`, das Beta-Tor ist zu. Neue Leute kommen nur mit Code oder
     über die Allowlist rein (`/betrieb › Beta-Zugang`). Deine Adresse in `OPERATOR_EMAILS` kommt immer rein.
   - **Sign in with Apple-Key** (Pflicht für den App Store, Regel 5.1.1(v)): Apple Developer › Keys › + ›
     „Sign in with Apple“ aktivieren (Primary App ID `de.heidrichdigital.tohuus`), .p8 laden. Dann
     `APPLE_SIWA_KEY_ID=<Key ID>`, `APPLE_SIWA_KEY_P8=<Inhalt der .p8, Zeilenumbrüche als \n>`, `APPLE_TEAM_ID=FVS7WVTQ67`.
     Damit widerruft ToHuus beim Löschen eines Kontos die Apple-Anmeldung. Ohne den Key läuft alles, nur der
     Widerruf fehlt.
   - Sobald du den APNs-Key hast: `APNS_KEY_ID`, `APNS_KEY_P8`, `APNS_ENV=production` (TestFlight nutzt Produktion).
4. **Redeploy** in Coolify (Image neu ziehen) und die Logs ansehen, bis `listening` erscheint und keine
   `migration … failed` auftaucht.
5. **Nach dem Deploy im Backoffice** (`https://cloud.tohuus.heidrich-digital.de/betrieb`, Passwort erneut eingeben):
   - Reiter **Geschenke** › Beta-Geschenk auf **Plus** stellen. Damit haben während der Beta alle Haushalte Plus,
     ohne Preise in der App. Später schaltest du es aus und vergibst Codes (z. B. „für immer“), die man **im Web**
     unter Abo einlöst. Die iPhone-App zeigt bewusst kein Codefeld (App-Store-Regel 3.1.1).
   - Reiter **Beta-Zugang**: Codes für Tester anlegen oder Adressen auf die Allowlist setzen.
6. **Kurztest** (5 Minuten):
   - Abmelden, mit Apple anmelden: Es darf kein „unauthorized“ mehr kommen.
   - Einen Bon als Foto einreichen: Es darf kein Fehler mehr kommen. Kommt doch einer, sieht die Meldung jetzt
     freundlich aus und hat einen Code, den du unter **Fehler** im Backoffice findest.
   - Im Web durch alle Bereiche klicken: Es darf kein weißer Bildschirm mehr kommen. Einmal hart neu laden (der
     Service Worker v5 räumt alte Caches auf).
   - Haushalt Fredirando: Alle Bereiche sind sichtbar. Falls nicht, einmal ab- und wieder anmelden.

**Zurückrollen:** In Coolify das vorherige Image-Tag (`sha-…` aus GitHub Actions) eintragen und das Volume-Backup
zurückspielen. Die neuen Migrationen sind für den alten Server unschädlich, bis auf `spend_budgets`: Dort lehnt
der alte Server Jahresbudgets ab, die Wochen- und Monatsbudgets des Haushalts bleiben aber erhalten.

---

## 3. iPhone-, iPad- und Watch-App bauen (Xcode)

> In dieser Umgebung gibt es kein Xcode. Der Swift-Code ist durchgesehen, aber **nicht kompiliert**. Rechne mit ein
> paar kleinen Compiler-Fehlern und gib sie mir dann einfach.

1. `git checkout main && git pull` (nach dem Merge), dann `cd ios && xcodegen generate`.
2. In `ios/project.yml` `CURRENT_PROJECT_VERSION` von **5 auf 6** setzen (`MARKETING_VERSION` bleibt `1.0.0`) und
   noch einmal `xcodegen generate` ausführen.
3. `ToHuus.xcodeproj` öffnen. **Neue Dateien**, die jetzt im Projekt sein müssen (XcodeGen nimmt sie automatisch mit):
   - `Design/Appearance.swift` (Hell/Dunkel), `Design/Motion.swift` (Animationen, Reduce Motion)
   - `Core/API/ErrorLog.swift` (auch im Watch-Ziel), `Features/Settings/ErrorLogView.swift`
   - `Features/Settings/HouseGuideMedia.swift` (Fotos und Videos in der Hausinfo)
   - `Core/Store/LiveTripActivity.swift`, `Shared/ShoppingTripActivity.swift`, `ToHuusWidget/TripActivityWidget.swift`
     (Live Activity „Einkauf läuft“)
   - `ToHuusWatch/WatchTreatsView.swift` („Bring mir was“ auf der Uhr)
   - Testziele: `ToHuusTests/PaywallStoreKitTests.swift`, neues Ziel **`ToHuusUITests`**
     (`AccessibilityAuditTests.swift`)
4. **Signing**: Das Widget-Ziel braucht für die Live Activity keine neue Capability, aber in der Info.plist der App
   steht jetzt `NSSupportsLiveActivities = YES`. Das Ziel `ToHuusUITests` braucht dein Team im Signing-Tab.
5. **Bauen** auf dem Simulator (iPhone 16, iPad, Apple Watch). Danach `Cmd+U` für die Tests, inklusive des
   Barrierefreiheits-Audits.
6. **Kurz prüfen**:
   - Einstellungen › Erscheinungsbild (Gerät/Hell/Dunkel). Im Kochmodus ist die Sonne jetzt ein Menü.
   - Einkauf starten: Auf dem Sperrbildschirm erscheint die Live Activity.
   - Widgets: Homescreen klein und mittel, Sperrbildschirm rund, rechteckig und als Zeile.
   - Mehr › Urlaub, Pflege und Übergabe (für Gäste): Diese Bereiche öffnen sich noch als Webseite in der App.
   - Geld › Nur meins › „Budget nur für dich“ mit Jahresbudget.
   - Uhr: In der Liste gibt es oben „Bring mir was“.
7. **Archivieren**: Product › Archive › Distribute › App Store Connect › Upload. In TestFlight landet der Build
   automatisch in der Gruppe „Intern“.
8. **App Privacy** in App Store Connect ergänzen: **Diagnostics › Other Diagnostic Data**, *mit* der Identität
   verknüpft (das Fehlerprotokoll speichert die Haushalts-ID, damit sich ein gemeldeter Code finden lässt), *nicht* für Tracking, Zweck *App Functionality*. Grund ist das neue Fehlerprotokoll, das 5xx- und
   Lesefehler ohne Inhalte an den Server schickt.

---

## 4. Was seit dem Stand von heute Morgen dazugekommen ist

**Deine Rückmeldungen**
- **Bon und Fotos**: Der Fehler „Referenz 219017d1“ kam vom alten Server in der Cloud und ist mit dem Deploy behoben.
  Fehlermeldungen sind jetzt freundlich und nennen einen Code zum Nachschlagen.
- **KI**: „Ja“, „Nein“, „Danke“ und „Speichere das Rezept“ landen nie mehr auf der Liste. Ein „Ja“ nach einem Rezept
  führt das Angebot aus. Pro Antwort gibt es höchstens 45 s, sonst sagt der Assistent, dass er gerade beschäftigt ist.
- **Kochmodus-Sonne und Hell/Dunkel** in der App.
- **Weißer Bildschirm im Web**: behoben (Chunk-Reload, Fehlerkarte statt leerer Seite, Service Worker v5).
- **Apple-Login „unauthorized“**: Das kam vom alten Server und ist mit dem Deploy weg.
- **Abos in der Beta geschenkt** und danach Codes (z. B. Lifetime). Siehe Schritt 2.5.

**Neue Funktionen**
- **Hausinfo mit Fotos und kurzen Videos** (Web, iPhone, Sitter-Links). Die Grenze von **100 MB pro Datei** steht
  vor dem Hochladen da. Das iPhone verkleinert Videos auf 720p, damit sie fast immer darunter bleiben.
- **Urlaubsübergabe** (Tiere, Pflanzen, Post …): Punkte mit Rhythmus und Tageszeiten, Fotos und Videos, nur für
  ausgewählte Gäste, Abhaken optional. Übergaben lassen sich als Vorlage speichern und von einer früheren Reise
  übernehmen. Doku: `docs/handover.md`.
- **Backoffice `/betrieb`**: Konten (pausieren mit Grund und Mail, überall abmelden, endgültig entfernen; Apple
  5.1.1(v) und DSGVO), Geschenke, Fehlerprotokoll mit CSV/JSON-Download.
- **Fehlerprotokoll**: Server-500er mit Code, dazu Berichte aus Web, iPhone und Watch. Auf dem iPhone unter
  Einstellungen › Fehlerprotokoll, als Datei teilbar. Doku: `docs/error-log.md`.
- **Budgets pro Woche, Monat oder Jahr**, gemeinsam für den Haushalt **oder nur für dich** (in „Nur meins“; nur du
  siehst sie, Hinweise kommen nur auf deine Geräte).
- **iOS**: Live Activity „Einkauf läuft“, mehr Widget-Größen, Animationen (respektieren Reduce Motion), Dynamic Type
  und VoiceOver, StoreKit-Konfiguration.
- **Watch**: „Bring mir was“ mit „Bring ich“ und „Gebracht“.
- **Website**: eigene Abschnitte für „Bring mir was“ und Wünsche, Screenshots im iPhone-Rahmen ohne Anschnitt, die
  Grundlage für den Blog (Ratgeber), Sitemap, robots.txt und llms.txt. Themenplan in `docs/blog.md`, noch kein
  Beitrag geschrieben.

**Abgleich mit deinen Notizen von gestern Abend:** Alles ist umgesetzt. Dazu gehören „Bring mir was“ statt
„Verwöhnen“, Finanzen auch für Non-Food mit Rechnungen und manuellen Einträgen, Posten pro Person (Fritz-Cola → Till),
Kosten teilen in der WG und Geldlisten („durch vier teilen“), Wunschlisten mit Fotos, mehreren Links, Preisen und „wer
könnte das schenken“ als Nachrichtenvorlage, private Listen, der Gästemodus, Animationen, Barrierefreiheit sowie die
Website zum Schluss. Offen ist nur, die Blogbeiträge zu **schreiben** (vorbereitet, aber noch nichts geschrieben).

---

## 5. Offen für dich (Konten, Recht)

1. **App Store Connect**: Abo-Gruppe „ToHuus“ mit `de.heidrichdigital.tohuus.haushalt.monthly|yearly` und
   `…plus.monthly|yearly`. Server Notifications v2 auf
   `https://cloud.tohuus.heidrich-digital.de/api/billing/apple/notifications` stellen.
2. **Sign in with Apple im Web**: Services ID `de.heidrichdigital.tohuus.web`, Domain
   `cloud.tohuus.heidrich-digital.de`, Return-URL `…/api/auth/apple/callback`.
3. **APNs-Key** (.p8) anlegen und in Coolify eintragen (siehe 2.3).
4. **Rechtstexte** (Datenschutz, Nutzungsbedingungen) prüfen lassen. Sie sind als Entwurf markiert. Der Absatz zum
   Sperren und Entfernen von Konten ist neu.
5. **Länge der Testphase entscheiden**: Heute sind es 14 Tage auf Plus-Niveau (`server/lib/plans.ts`). Mein Rat:
   14 Tage behalten. Der Kern von ToHuus („merkt sich, wann ihr was kauft“) braucht zwei bis drei Wochen mit Bons, bis
   die ersten Vorschläge kommen; nach 7 Tagen hat man davon fast noch nichts gesehen. Während der Beta spielt es keine
   Rolle, weil alle über `beta.gift` Plus haben. Wenn du trotzdem 7 Tage willst, ist das eine kleine Änderung (Server
   plus Einführungsangebot in App Store Connect, dort gibt es 1 Woche, 2 Wochen oder 1 Monat).
6. **App Review Notes** stehen in `docs/app-review.md`. Für den Review-Zugang einen Beta-Code oder die Adresse des
   Testkontos auf die Allowlist setzen.

---

## 6. Admin-Oberfläche für dich als Entwickler

Ja, die gibt es: `https://cloud.tohuus.heidrich-digital.de/betrieb`. Sie ist nur für Adressen in `OPERATOR_EMAILS`
zugänglich, alle anderen sehen eine 404. Du musst dein Passwort frisch eingeben, danach ist sie 10 Minuten offen, und
alles landet im Audit-Log. Die Reiter:

- **Statistik**: Haushalte, aktive Haushalte, Speicher, Fehlerquote, KI-Kosten
- **Beta-Zugang**: Codes und Allowlist
- **Konten**: Übersicht, pausieren, abmelden, entfernen
- **Geschenke**: Beta-Plan und Codes
- **Fehler**: Protokoll mit Suche nach Code und Download
- **Rezepte**: offene Rezeptdatenbank
- **Einstellungen**: Laufzeit-Schalter

Inhalte der Haushalte (Listen, Bons) sieht man dort bewusst nicht.

---

## 7. Hinweise für die Weiterarbeit

- **Lücken zwischen iOS und Web**: `docs/ios-parity-2026-10-13.md`. Urlaub, Pflege und Übergabe laufen in der App
  noch als angemeldete Webseite. Die Reihenfolge für native Screens steht dort (Top 10).
- **Wackel-Tests**: `test/cloud-apple*` und `test/list2-live.test.ts` („two ticks within minutes make a trip“)
  schlagen unter Volllast gelegentlich fehl und laufen einzeln grün. Das liegt am Timing und ist kein Fehler.
- **Website-Screenshots neu machen**: `scripts/site-shots.mjs` (Anleitung im Dateikopf), danach
  `node site/src/build.mjs`.
- **Blog**: Beiträge in `site/src/blog.mjs` eintragen, Vorgehen und Themenliste in `docs/blog.md`. Danach die
  Sitemap einmal in der Google Search Console und in den Bing Webmaster Tools anmelden.

### Apple Watch: Ideen für danach

Schon da: Liste mit Abhaken (offline, über das iPhone), Sprechen, Sortierung nach Laden, Komplikation,
Mitteilungsknöpfe und neu „Bring mir was“. Sinnvoll wären als Nächstes:

1. **„Wahrscheinlich fällig“** mit einem Tipp auf die Liste setzen (die Daten liefert schon `/api/today`).
2. **Kochmodus-Timer** am Handgelenk, wenn auf dem iPhone ein Rezept-Timer läuft.
3. **Urlaubsübergabe für Sitter**: die Punkte von heute abhaken (Füttern, Gießen).
4. **Smart Stack Widget** (watchOS 10+) mit „Einkauf läuft“ statt nur der Komplikation.
5. **Budget-Blick**: Monat ausgegeben gegen Budget, gern auch das eigene.

### iPad

Die App ist schon universell (iPhone und iPad, `NavigationSplitView` mit Seitenleiste). Eine eigene iPad-App braucht es
nicht. Beim Xcode-Build bitte einmal im iPad-Simulator quer und hoch durchklicken.
