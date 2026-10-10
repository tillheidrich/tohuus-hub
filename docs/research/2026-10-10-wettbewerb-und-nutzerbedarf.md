# ToHuus Hub: Wettbewerb und Nutzerbedarf

**Stand:** 10.10.2026 · **Art:** Web-Recherche (keine Code-Änderungen) · **Für:** Produktentscheidungen, Roadmap, Handover an weitere Agenten

> **Kurzfassung.** Woran Haushalts-Apps scheitern, ist gut belegt: Die Datenpflege kostet mehr, als die App zurückgibt. Danach kommt fehlende Akzeptanz beim Partner und schlechte Bedienbarkeit unterwegs (Supermarkt, Kind auf dem Arm). ToHuus Hub liegt beim Kernprinzip (Bestand kommt über Bons, Bestellungen und Fotos statt Tipparbeit) vor jedem untersuchten Wettbewerber. Die größten Lücken sind (1) **Datendrift**: Bestand stimmt nach drei Wochen nicht mehr, und es gibt keinen schnellen Abgleich-Modus. (2) **Einkauf im Laden**: Gangsortierung, offline, Schnell-Eingabe, Widgets/Sprache. (3) Die **Nicht-Lebensmittel-Seite des Haushalts**: Wartungszyklen, Garantien, Hausapotheke, Inventar für die Versicherung. Grocy und Homebox decken sie jeweils halb ab, keiner verbindet sie mit Bons. (4) **Leichte Aufgaben/Rotation** für Familie und Kinder.

---

## 0. Methode und Grenzen

- Quellen: Produktseiten, App-Store-Listings, Fachpresse (DE/EN), Lemmy-/Fediverse-Threads aus r/selfhosted-nahen Communities, Home-Assistant-Community, Erfahrungsberichte.
- **Grenzen:** Reddit und die GitHub-Issue-Listen (sortiert nach Upvotes) waren aus dieser Umgebung nicht abrufbar (robots.txt bzw. Proxy-Sperre). Ersatzweise habe ich Lemmy-Spiegel derselben Diskussionen genutzt, dazu Erfahrungsberichte von Galaxus, XDA und Linuxlinks. Für eine Reddit-Tiefenauswertung eignet sich der Skill `reddit-recherche` auf Tills Mac als Folgeauftrag.
- **Quellenbewertung:** Jede Quelle ist in Abschnitt 4 einzeln bewertet. Marketing-Quellen und unbelegte Zahlen sind dort ausdrücklich markiert.

---

## 1. Wettbewerber: Analyse im Einzelnen

Legende Geschäftsmodell: OSS = Open Source, self-hosted.

### 1.1 Self-hosted / Open Source

| App | Kern | Herausragende Ideen | Modell / Preis | Typische Kritik |
|---|---|---|---|---|
| **Grocy** | „ERP für den Kühlschrank": Bestand, MHD, Mindestbestand, Rezepte, Speiseplan, **Chores, Batterien, Geräte (Handbücher), Tasks**, Custom Fields, REST-API, PWA ([grocy.info](https://grocy.info/)) | „Due Score" (Rezepte nach ablaufenden Zutaten), Feature-Flags zum Ausblenden ganzer Module, Batterie-Ladezyklen, Ladenreihenfolge über Produktgruppen | OSS (MIT), kostenlos; HA-Integration nur über HACS ([custom-components/grocy](https://github.com/custom-components/grocy)) | Datenpflege frisst den Nutzen: „The effort involved simply outweighs the benefits", Einheiten-Umrechnungen, Zwiebeln nicht zählbar, ein Rezept anzulegen dauerte ~2 h, Einkaufsliste synchronisiert nicht wie Bring! ([Galaxus](https://www.galaxus.de/en/page/how-i-want-to-digitise-the-contents-of-my-fridge-and-fail-to-do-so-39565)); „the real effort lies in setup and maintenance of data", „People looking for a simple grocery list will find it overwhelming" ([Linuxlinks](https://www.linuxlinks.com/grocy-erp-beyond-fridge/)); im Laden „way too fiddly" ([Lemmy-Thread](https://lemmy.ndlug.org/post/619307)) |
| **KitchenOwl** | Echtzeit-Einkaufsliste, Rezepte, Speiseplan, **Ausgaben/Haushaltsbilanz** ([GitHub](https://github.com/TomBursch/kitchenowl)) | Native Apps (iOS/Android/F-Droid), teilweise offline, Bring!-ähnliche Kachel-Liste, Ausgaben-Splitting | OSS (AGPL-3.0), „public alpha" | Rezeptimport unzuverlässig, v. a. bei deutschen Rezepten mit ungenauen Mengen; der Nutzer bereute den Wechsel weg von Bring! ([Lemmy](https://scribe.disroot.org/post/34640)); Speiseplan einfach, Export begrenzt ([Cooklang-Vergleich, Interessenkonflikt](https://cooklang.org/blog/42-tandoor-vs-mealie-vs-kitchenowl/)) |
| **Mealie** | Rezepte (bester Scraper), Speiseplan, Einkaufslisten mit Labels, **Households** (Pläne/Listen getrennt, Rezepte geteilt), OIDC, OpenAPI ([mealie.io](https://mealie.io/)) | Cook-Mode Schritt für Schritt, offizielle HA-Integration (Kalender + Todo-Entitäten) | OSS, kostenlos | Einkaufsliste „clunky", Nutzer weichen auf Kanban-Karten aus ([Lemmy](https://lemmy.ndlug.org/post/619307)); kein echter Vorrat; HA-Integration nur lesend ([Cooklang-HA-Recherche](https://cooklang.org/cli/commands/home_assistant_integration_research/)) |
| **Tandoor Recipes** | Rezepte, Speiseplan (Kalender-Export), Einkauf mit **Supermarkt-Sortierung**, Nährwerte, **Kosten pro Rezept**, Rechte, Share-Links, KI-Import ([tandoor.dev](https://tandoor.dev/)) | Kosten/Nährwerte aus Zutaten berechnet, 90 Tage Export-Garantie beim Hosting | OSS; gehostet 0 / 1,99 / 3,49 / 4,99 €/Monat | „maybe a bit too complex", Liste im Laden schwer bedienbar ([Lemmy](https://lemmy.ndlug.org/post/619307)); PostgreSQL, Ressourcenhunger |
| **Homebox** | Inventar für Besitz (nicht Verbrauch): Orte, Tags, Custom Fields, **Garantie- und Dokumentenverwaltung**, Kauf- und Wartungsdaten, Bilder ([GitHub](https://github.com/sysadminsmedia/homebox)) | QR-Labels drucken und scannen, Garantie-Ablauf-Benachrichtigung ([selfhosting.sh](https://selfhosting.sh/best/home-inventory/)); < 50 MB RAM | OSS (Fork-Fortführung), ~7k Sterne | keine Verbrauchsgüter, wenig Reports; Erfassung bleibt Handarbeit |
| **Donetick** | Wiederkehrende Aufgaben mit **automatischer Rotation**, Punkte, Unteraufgaben ([Elfhosted](https://store.elfhosted.com/product/donetick/)) | Rotation „next person each cycle" | OSS (AGPL-3), keine Premium-Stufe | (keine belastbare Kritik gefunden) |
| **TaskMate (HA)** | Kinder-Aufgaben und Belohnungen im HA-Dashboard ([HA Community](https://community.home-assistant.io/t/taskmate-family-chore-rewards-integration-now-in-hacs-default/1023281)) | **Routine-Modus** (Morgen/Abend), **Pre-Reader-Modus mit Icons**, Eltern-Freigabe, Wetter-abhängige Aufgaben, Smart-Plug-Belohnung | OSS, HACS | kleine Nutzerbasis (3 Likes); viel Gamification |
| **Homechart** | „Mission Control" für Familien: Budget, Kalender, Rezepte, Vorrat, Aufgaben, Belohnungen, Wiki ([AlternativeTo](https://alternativeto.net/software/homechart/about)) | alles in einem, self-hosted möglich | proprietär/freemium, 80 $ einmalig oder 4 $/Monat | „complex" ([Lemmy](https://scribe.disroot.org/post/34640)); zu viel Umfang auf einmal |
| **HA Built-ins** | Shopping List (einfach), **Todo-Entitäten** (Bring!, Mealie nativ), Kalender | Sprachassistent (Assist) kann Todo-Listen befüllen | kostenlos | keine Rezeptverknüpfung, kein Vorrat ([Cooklang-HA-Recherche](https://cooklang.org/cli/commands/home_assistant_integration_research/)) |

### 1.2 Kommerziell, Einkauf und Rezepte

| App | Kern | Herausragende Ideen | Modell / Preis | Typische Kritik |
|---|---|---|---|---|
| **Bring!** | geteilte Einkaufsliste mit Kacheln, Rezepte, Kundenkarten | Kachel-UI, im Laden mit einer Hand bedienbar, Kundenkarten-Archiv ([iphone-ticker 2018](https://www.iphone-ticker.de/einkaufslisten-app-bring-verwaltet-jetzt-kundenkarten-134250/)), Wear/Watch | frei mit Werbung und gesponserten Produkten; Premium 13,99 €/Jahr, das „Inspiration"/„Angebote" trotzdem nicht abschaltet ([Mobiflip 2020](https://www.mobiflip.de/?p=401895)) | Prospekte und Werbung nicht abschaltbar; Cloud-Pflicht. **Trotzdem Maßstab für Bedienbarkeit**: Mehrere Self-Hoster kehrten zu Bring! zurück |
| **AnyList** | Liste, Rezepte, Speiseplan | Ladenkategorien sortierbar, **Preise im Laden mit laufender Summe**, ortsbasierte Erinnerung, Siri/Alexa, Speiseplan-Vorlagen, Rezept-Queue, Live-Activity-Timer ([App Store AU](https://apps.apple.com/au/app/anylist-grocery-shopping-list/id522167641)) | Complete ~15 $/Jahr einzeln, ~23 $ Haushalt (AU) | keine Gesamtsicherung, eigenes Autocomplete fehlt |
| **Paprika** | Rezepte, Planer, Listen, „Pantry" | Einmalkauf, vorrätige Artikel auf der Liste abgehakt statt gelöscht ([Fortune](https://fortune.com/article/best-meal-planning-apps)) | Kauf pro Plattform | Rezepte „stranded inside Paprika", schwache Mehrnutzer-Unterstützung ([Reluctant Gourmet](https://reluctantgourmet.com/paprika-recipe-manager-review/)) |
| **Plan to Eat** | Rezeptimport, Planer, Listen **je Laden** | Liste nach Läden aufteilen | ~5,95 $/Monat bzw. 49–55 $/Jahr ([Fortune](https://fortune.com/article/best-meal-planning-apps)) | doppelte Zutaten erscheinen getrennt, Import einzeln |
| **Samsung Food (ex Whisk)** | Rezepte, 7-Tage-Planer, Listen, Pantry (Food+) | KI-Cook-Mode, Health Score, Umrechnung metrisch | Food+ 6,99 $/Monat bzw. 59,99 $/Jahr | „sleazy" Diät-Werbung, Abo lohnt kaum ([Android Authority](https://www.androidauthority.com/samsung-food-3517054/)) |
| **Mealime** | Wochenplan mit 2–6 Gerichten erzeugt Liste | „Plan bauen → Liste fertig", ~100 Zutaten ausschließbar | Pro 2,99–5,99 $/Monat | Tausch-Vorschläge wiederholen sich, Zeitangaben zu optimistisch ([iPhoneLife](https://iphonelife.com/content/mealime-pro-review-perfect-recipe-app-busy-professionals)) |
| **KptnCook** | 3 Rezepte/Tag, Liste | kuratierte Tagesauswahl statt Suche | freemium; Miele-Beteiligung ([LZ](https://www.lebensmittelzeitung.net/handel/nachrichten/Minderheitsbeteiligung-Kptn-Cook-bekommt-finanziellen-Schub-von-Miele-136945)) | (kaum belastbare Kritik gefunden) |
| **Cookidoo** | Thermomix-Rezepte, geführtes Kochen, Wochenplan, Liste | Gerätesteuerung | 60 €/Jahr seit 07/2024 (+25 %, davor +33 % in 2021) ([iphone-ticker](https://www.iphone-ticker.de/thermomix-app-preis-fuer-cookidoo-abo-steigt-25-prozent-237796/)) | Preisanstiege, seit 2021 kaum neue Funktionen, **keine öffentliche API** (ToHuus nutzt die HA-Kalender-Brücke) |

### 1.3 Kommerziell, Vorrat (Pantry)

| App | Kern | Modell | Bemerkung |
|---|---|---|---|
| **NoWaste** | Vorrat mit MHD, Listen, Barcode | freemium (App Store) | Listing nicht abrufbar; Konzept: rein manuelle Erfassung |
| **Pantry Check** | Vorrat mit Menge/Einheit/Kategorie | 3,99 $/Monat, 12,99 $/Jahr, 17,99 $ lifetime ([App Store](https://apps.apple.com/us/app/id6670480023)) | sehr simpel, 161 Bewertungen, keine Familienfunktion erkennbar |
| **Sortly** | Inventar (eher B2B), QR-Labels | Free + 4 bezahlte Stufen, Limits je Plan ([Sortly Help](https://help.sortly.com/hc/en-us/articles/360035774271)) | Haushaltsnutzung möglich, Preise intransparent |

Gemeinsamer Nenner: **Alle Vorrats-Apps setzen auf manuelle Erfassung plus Barcode.** Keine liest Bestellungen oder Bons ein. Genau daran scheitern die Nutzer (siehe 2.1).

### 1.4 Familien-Organisation und Aufgaben

| App | Kern | Herausragende Ideen | Modell | Typische Kritik |
|---|---|---|---|---|
| **Cozi** | Familienkalender, Listen, Rezepte | „Was ist heute los?" für alle | Gold ~30–60 $/Jahr (Nutzerangaben) | Abstürze, Termine am falschen Tag, **Kind löscht Termine ohne Wiederherstellung**, Wunsch nach Admin-Rechten ([JustUseApp](https://justuseapp.com/en/app/407108860/cozi-family-organizer/reviews)) |
| **FamilyWall** | Kalender, Listen, Essensplan, Ortung, Chat | großzügiger Gratis-Tarif | Premium | Ortung ungenau, Abo-Zuordnung, Datenschutz-Bedenken ([Kimola, Stichprobe von 6 Bewertungen!](https://kimola.com/reports/essential-familywall-app-feedback-analysis-report-google-play-en-us-140607)) |
| **OurHome** | Aufgaben, Punkte, Belohnungen, Liste | rotierende Aufgaben, mehrere Admins, Kinder-Motivation | kostenlos | Bugs (Reihenfolge reset, Erinnerungen weg), „overly complicated", Support unerreichbar ([JustUseApp](https://justuseapp.com/en/app/879717020/ourhome-chores-and-rewards/reviews)) |
| **Flatastic** | WG: Putzplan, Liste, Finanzen | Putzplan-Historie, Notizen an Aufgaben | Premium „weniger als ein Kaffee/Monat" ([Flatastic](https://flatastic-app.com/en/premium)) | Kernfunktionen hinter Premium |
| **Tody** | Putzen nach Bedarf statt fester Termine | **„Verschmutzungs-Indikator"**: Aufgabe wird schrittweise „fälliger" statt binär überfällig | frei, Premium (Sync!) ab ~10 $/Jahr ([Marlvel](https://marlvel.ai/apps/tody)) | Mehrnutzer-Sync nur Premium |
| **Todoist (Familie)** | geteilte Projekte | Erinnerungen für andere setzen | freemium | Todoist selbst räumt das Akzeptanzproblem ein: „one half of the relationship is more… enthusiastic" ([Todoist](https://www.todoist.com/inspiration/how-to-trick-your-partner-into-using-todoist)) |

### 1.5 Lebensmittelrettung

- **Too Good To Go:** **keine öffentliche API**, nur inoffizielle Clients ([Beispiel](https://piefed.jeena.net/c/linuxphones/p/321121/too-good-to-go-api-client-python)). Eine Anbindung verletzt wahrscheinlich die AGB und ist wartungsanfällig. **Nicht integrieren.**
- **Foodsharing.de / Fairteiler:** gemeinnützig, kein offizieller Integrationsweg gefunden. Sinnvoll wäre nur eine *Teilen-Funktion* („Überschuss → Text/Foto für Nachbarn/Foodsharing-Gruppe") ohne API.

---

## 2. Schmerzpunkte und Wünsche der Nutzer

### 2.1 Aufwand der Dateneingabe ist Todesursache Nr. 1 (stark belegt)
- Galaxus-Selbstversuch mit Grocy, nach einer Woche abgebrochen: „The effort involved simply outweighs the benefits". Eine „broad database of carefully created products is the backbone", Rezept-Anlage dauerte ~2 h, Zwiebeln lassen sich nicht sinnvoll zählen ([Galaxus](https://www.galaxus.de/en/page/how-i-want-to-digitise-the-contents-of-my-fridge-and-fail-to-do-so-39565)).
- Linuxlinks: „demands ongoing discipline: creating products, assigning barcodes, recording purchases" ([Linuxlinks](https://www.linuxlinks.com/grocy-erp-beyond-fridge/)).
- XDA-Titel: „Grocy seemed like a great self-hosted tool, until I used it for a week" (Artikel nicht abrufbar, nur der Titel belegt).
- **Für ToHuus:** Das Kernversprechen (Bons/Avis/Foto, grobe Füllstände, Ungezähltes) trifft genau diesen Punkt. Offen ist der *zweite* Ausfallmodus: **Datendrift.** Auch bei automatischem Zugang wird der *Verbrauch* selten gebucht. Nach Wochen stimmt der Bestand nicht mehr, und das Vertrauen ist weg. Die Gegenmittel (Schnell-Abgleich, Verbrauchsprognose, „Zuletzt bestätigt"-Alter) gibt es bei keinem Wettbewerber.

### 2.2 Akzeptanz beim Partner und in der Familie (gut belegt)
- Mehrere Self-Hoster kehrten wegen Bedienbarkeit für den Partner zu Bring! zurück, „should have stayed with Bring!" ([Lemmy](https://scribe.disroot.org/post/34640)). Die Anforderung lautet: im Laden mit Kind auf dem Arm bedienbar.
- Geteilte Liste verteilt mentale Last: Der Partner trägt selbst ein, statt anzurufen ([NerdWallet](https://www.nerdwallet.com/finance/learn/how-a-grocery-list-app-helped-my-marriage), *Erfahrungsbericht mit Therapeuten-Zitat, kein Beleg für Wirksamkeit*).
- Folgerung: **Zwei Bedienebenen.** Der „Power-User" pflegt, alle anderen brauchen nur Liste, „Wo ist was?" und „Ist noch X da?". Gäste- und Babysitter-Links von ToHuus zeigen, dass das Prinzip schon angelegt ist.

### 2.3 Mental Load
- Der Begriff ist gesellschaftlich etabliert. Viele Zahlen in Presseartikeln stammen aber aus Marken-Umfragen (z. B. „86 %" bei [Stylist](https://stylist.co.uk/life/household-chores-invisible-load/863474), P&G-Kampagne ([shots.net](https://shots.net/news/view/p-g-aims-to-help-unpack-the-mental-load))). **Unbelegte bzw. interessengeleitete Zahlen, nicht zitieren.**
- Produktfolgerung ohne Zahlenakrobatik: Das System muss *erinnern statt erinnert werden*. Push bei Ablauf, bei Leerstand, bei fälligen Zyklen. Und es muss *sichtbar machen, wer was getan hat*, ohne Punktesystem-Zwang.

### 2.4 ADHS
- „if you can't see it, it doesn't exist", Lösung: Verderbliches *sichtbar* lagern ([Apartment Therapy](https://www.apartmenttherapy.com/adhd-fridge-organization-method-37433539)). Kein klinischer Beleg, aber konsistent mit den Berichten.
- Der Substack-Essay zu „object permanence" ist humorvoll und anekdotisch, der Begriff ohne klinische Quelle ([Substack](https://writebrainmedia.substack.com/p/the-fridge-of-the-future-vs-adhd)). **Als Hype markiert.**
- Folgerung: Das „Today"-Prinzip (eine Seite, was jetzt zählt) ist richtig. Es fehlen eine **„Iss mich zuerst"-Zone** (virtuelles Fach für Angebrochenes/Reste), **Reste mit Kochdatum** und **sanfte Eskalation** statt Benachrichtigungsflut. Und: Keine Strafe für Lücken. Eine App, die nach zwei Wochen Pause rot leuchtet, wird gelöscht.

### 2.5 Lebensmittelverschwendung
- Deutschland 2023: knapp 11 Mio. t Lebensmittelabfälle entlang der Kette, **~58 % in privaten Haushalten** (UBA-Bericht an die EU 2025; Methodik nicht mit Thünen-2015 vergleichbar) ([UBA](https://www.umweltbundesamt.de/daten/private-haushalte-konsum/wohnen/abfaelle-privater-haushalte)). Daraus ergeben sich rechnerisch ~6,4 Mio. t. Pro-Kopf-Zahlen kursieren, sind dort aber nicht ausgewiesen.
- Folgerung: Ablauf-Warnung allein reicht nicht. Wirkung entsteht durch **„koch das heute"** (gibt es schon), **Reste-Tracking** und **Lernen aus Wegwerfen** (Grund erfassen → weniger kaufen).

### 2.6 Budget
- KitchenOwl (Ausgaben), Tandoor (Rezeptkosten) und AnyList (laufende Summe im Laden) zeigen Nachfrage. ToHuus speichert bereits Preise aus REWE-Bons (`price` in `server/db.ts`), wertet sie aber nicht aus. **Ausgaben pro Monat/Kategorie aus Bons, ohne Tippen**, kann sonst niemand.

### 2.7 Kinder, Aufgaben, Rotation
- Gefragt sind Rotation (Donetick), Routinen und Icons für Kinder, die noch nicht lesen (TaskMate), Eltern-Freigabe, Admin-Schutz gegen versehentliches Löschen (Cozi-Kritik).
- Warnung: OurHome und Homechart werden als „overly complicated" kritisiert. Aufgaben in ToHuus also **schlank**: zyklisch, Rotation optional, kein RPG.

### 2.8 Nicht-Lebensmittel: Dokumente, Garantie, Wartung, Medikamente, Batterien, Filter, Versicherung, Umzug
- **Garantie/Dokumente:** Homebox hat Garantie plus Ablauf-Benachrichtigung, Grocy hat Geräte mit Handbüchern. Keiner zieht das aus Bons. ToHuus liest Bons bereits und könnte bei Non-Food-Positionen (Elektro, Drogerie) eine **Garantie-Akte** anbieten.
- **Wartungszyklen:** Grocy „Batteries" (Ladezyklen) und „Chores", Snipe-IT Wartung. Typische Zyklen im Haushalt sind Wasserfilter, Rauchmelder-Test, Entkalken, Dunstabzugsfilter, Heizungswartung, Reifenwechsel. In HA-Haushalten liegen dafür oft Sensoren vor (Kaffeemaschine, Spülmaschine).
- **Hausapotheke:** eigene Apps mit Barcode, Pflicht-Ablaufdatum, Erinnerung 30/14 Tage vorher, Zuordnung zu Familienmitgliedern ([Ärztezeitung 2014](https://www.aerztezeitung.de/Wirtschaft/Mehr-Ordnung-in-der-Hausapotheke-239499.html); OSS-Beispiel [HomeMedKit, F-Droid](https://cloudflare.f-droid.org/bo/packages/ru.application.homemedkit)). Auch Auto-Verbandkasten und Feuerlöscher-Prüfung gehören dazu. **ToHuus kann das mit MHD pro Charge und Orten fast schon.** Es fehlen Vorlagen und Fristen ohne Mengenlogik.
- **Inventar für die Versicherung:** Hausrat-Inventarlisten mit Fotos werden für den Schadensfall empfohlen (Versicherer-Apps wie AXA ([cash-online](https://www.cash-online.de/a/hausratversicherung-app-180627)), Desktop-Tools ([PC-Welt](https://www.pcwelt.de/article/1144344/hausrat-inventar-master.html))). Ein **PDF-Export „Hausrat-Inventar"** aus Orten, Fotos und Bon-Preisen ist naheliegend.
- **Umzug:** Homebox und Sortly haben QR-Kisten-Logik. In ToHuus ergäbe das „Ort = Umzugskarton" mit QR, die „Wo ist was?"-Suche funktioniert dann sofort.

### 2.9 Gäste und Feiern
- ToHuus' Gäste-Bar ist **einzigartig**, kein Wettbewerber hat Vergleichbares. Naheliegende Erweiterung: **Party-Planer** (Gästezahl → Mengen, Allergien der Gäste, Einkauf, danach Bestand).

### 2.10 Einkauf im Laden (Bedienbarkeit)
- Belegt: Grocy, Tandoor und Mealie verlieren gegen Bring!, OurGroceries und AnyList *beim Einkaufen*. Gefragt sind Gang-/Ladensortierung (AnyList, Tandoor, Plan to Eat), offline, große Trefferflächen, Widgets, Sprache (Siri/Alexa bei AnyList; bei HA: Assist + Todo-Entität).

---

## 3. Feature-Ideen (priorisiert)

**Aufwand** in Arbeitsblöcken: **S** = ein Block (eine fokussierte Agenten-Session), **M** = 2–3 Blöcke, **L** = 4+ Blöcke bzw. mehrere Sessions mit eigenem Konzeptschritt.
**Fit** gegen die ToHuus-Prinzipien: wenig Eingabe · funktioniert am müden Dienstag · Privatsphäre/self-hosted · familienfreundlich · ADHS-freundlich (✓✓ = trägt das Prinzip, ✓ = passt, ~ = neutral/Risiko).
**Wettbewerb:** wer es hat.

### Top 10 „Must-have next"

| # | Feature | Was | Warum (Beleg) | Aufwand | Fit | Wettbewerb |
|---|---|---|---|---|---|---|
| **1** | **Schnell-Abgleich („60-Sekunden-Inventur") pro Ort** | Ein Ort, Karten-Stapel: pro Artikel „stimmt / weniger / leer / weg" per Wisch. Jeder Artikel trägt „zuletzt bestätigt vor X Tagen", Today schlägt den ältesten Ort vor. Der bestehende Foto-Stocktake wird zum Einstieg. | Datendrift ist die zweite Todesursache nach dem Eingabeaufwand (2.1). Ohne Drift-Gegenmittel nützt automatischer Zugang wenig. | M | ✓✓ wenig Eingabe, ✓✓ ADHS (kurz, abschließbar) | **niemand** (Grocy nur Einzelbuchung) |
| **2** | **Einkaufsmodus für den Laden** | Liste nach Ladengängen/Kategorien sortiert (Reihenfolge je Laden lernbar aus Abhakreihenfolge), große Trefferflächen, Bildschirm bleibt an, **offline** mit späterem Sync (PWA-Service-Worker), „Im Laden"-Ansicht ohne Bestandsdetails. | Self-Hoster kehren genau hier zu Bring! zurück (2.2, 2.10). | M | ✓✓ Familie/Partner, ✓ Dienstag | Bring!, AnyList, Tandoor, Plan to Eat; Grocy halb |
| **3** | **Schnell-Eingabe in natürlicher Sprache + Sprache** | Ein Feld: „2 Milch, Butter, Klopapier" wird geparst und Produkten zugeordnet (lokal, ohne LLM; optional LLM). Dazu **HA-Todo-Entität** für die Einkaufsliste, damit Assist/Siri-Kurzbefehl/Alexa-über-HA „setz Milch auf die Liste" können. | Siri/Alexa sind bei AnyList ein Hauptargument. HA-Nutzer erwarten Todo-Entitäten (Bring! und Mealie haben sie nativ). | M | ✓✓ wenig Eingabe, ✓✓ Partner | AnyList, Bring!, Mealie (HA) |
| **4** | **Verbrauchsprognose und „bald leer"** | Aus Bons/Bestellungen lernen, wie schnell etwas verbraucht wird (Kaufintervalle). Bestand wird geschätzt heruntergerechnet und als „vermutlich bald leer" angezeigt. Die Prognose ist klar als Schätzung gekennzeichnet und mit einem Tipp korrigierbar. | Beseitigt Verbrauchsbuchung als Pflicht (2.1). Daten liegen bereits vor (Bons inkl. Historie und DSGVO-CSV-Import). | M | ✓✓ wenig Eingabe | **niemand** |
| **5** | **Fristen und Zyklen für Nicht-Lebensmittel** | Ein schlankes Objekt „Zyklus": Wasserfilter alle 2 Monate, Rauchmelder testen jährlich, Entkalken, Heizungswartung, Reifen, Batterien. Erledigt mit einem Tipp, nächste Fälligkeit automatisch, optional an HA-Sensor gekoppelt (z. B. Spülmaschinen-Zyklen). Vorlagen-Paket zum Ankreuzen. | Grocy hat Batterien/Chores, Snipe-IT Wartung, aber keiner kombiniert es mit Orten und „Wo ist was?" (2.8). Ein „Haus-Gedächtnis" senkt die mentale Last. | M | ✓✓ ADHS (erinnert statt erinnert werden), ✓ Familie | Grocy (Batteries/Chores), Homebox teilw., Snipe-IT |
| **6** | **Haushaltsbuch aus Bons** | Ausgaben pro Monat, Laden und Kategorie aus den bereits importierten Bons, Pfand separat, Preisentwicklung pro Produkt („Butter +18 % seit März"), CSV-Export. Kein Tippen, keine Bankanbindung. | Preise liegen schon in der DB. Budget wird bei KitchenOwl, Tandoor und AnyList nachgefragt (2.6). Eindeutiges Alleinstellungsmerkmal. | M | ✓✓ wenig Eingabe, ✓✓ Privatsphäre (lokal) | KitchenOwl (manuell), Tandoor (Rezeptkosten), AnyList (Summe) |
| **7** | **Reste und „Iss mich zuerst"** | Nach dem Kochen ein Tipp: „Reste: 2 Portionen, Kühlschrank". Bekommt automatisch eine 3-Tage-Frist, erscheint ganz oben in Today und im Wochenplan als „Reste-Abend"-Vorschlag. Dazu ein virtuelles Fach „Angebrochen". | Sichtbarkeit ist der ADHS-Hebel (2.4). Haushalte verursachen ~58 % der Lebensmittelabfälle (2.5). | S | ✓✓ ADHS, ✓✓ Dienstag | kaum (Grocy über Produkte; Samsung Food nein) |
| **8** | **Weitere Bon-/Händler-Importer** | Edeka (QR → PDF, 24 h abrufbar), Lidl Plus, Kaufland, dm, Rossmann (App-only, Export prüfen), Aldi. Dazu ein generischer „E-Mail-Postfach-Import" (IMAP-Ordner „ToHuus"), über den PDF-Bons automatisch eingehen. | Edeka-eBon per QR/PDF ([heidelberg24](https://www.heidelberg24.de/verbraucher/edeka-aenderung-aktuell-kunden-kassenzettel-bon-ebon-digital-bonpflicht-einzelhandel-deutschland-zr-90855653.html)), Rossmann app-only seit 05/2025 ([iphone-ticker](https://www.iphone-ticker.de/rossmann-fuehrt-digitale-kassenbons-in-der-app-ein-256105)). Mit nur REWE sind die meisten Haushalte ausgeschlossen. | M je Händler (S für E-Mail-Eingang) | ✓✓ wenig Eingabe | **niemand** |
| **9** | **Rollen, Kinder- und „Einfach"-Ansicht** | Rollen: Admin / Mitglied / Kind / Gast. Eine **„Einfach"-Oberfläche** nur mit Liste, „Wo ist was?", „Ist noch da?" und „Bestellen vom Sofa". Löschschutz bzw. Papierkorb mit Wiederherstellen. Icons für Kinder, die noch nicht lesen. | Cozi: Kind löscht Termine ohne Wiederherstellung. TaskMate: Pre-Reader-Modus. Partner-Akzeptanz (2.2). | M | ✓✓ Familie, ✓ ADHS | Cozi (Kritik), OurHome (Admins), TaskMate |
| **10** | **Backup/Restore mit einem Klick + Update-Sicherheit** | Automatische nächtliche SQLite-Sicherung (Rotation, optional WebDAV/S3/Nextcloud), Wiederherstellen in der Oberfläche, Export vor jedem Update. | Self-Hoster verlieren sonst bei einem Fehler alles. Datenvertrauen ist Voraussetzung für Partner-Akzeptanz. Paprika wird für „stranded"-Daten kritisiert. JSON-Export gibt es, Auto-Backup nicht. | S | ✓✓ Privatsphäre, ✓ Dienstag | Tandoor (gehostet: 90 Tage Export), Grocy manuell |

### Weitere Ideen (11–36)

| # | Feature | Was / Warum | Aufwand | Fit | Wettbewerb |
|---|---|---|---|---|---|
| 11 | **Garantie- und Belege-Akte** | Non-Food-Positionen aus Bons (Elektro, Werkzeug) als „Besitz" mit Kaufdatum, Preis, Bon-PDF, Garantie-Ende (2 J. gesetzlich vorbelegt), Erinnerung vor Ablauf; Handbuch-Link/PDF anhängen. | M | ✓✓ wenig Eingabe | Homebox (manuell), Grocy Geräte |
| 12 | **Hausapotheke-Vorlage** | Ort „Hausapotheke" mit PZN-Barcode (Lookup optional), Ablauf je Packung, Erinnerung 30/14 Tage, Zuordnung zu Person, „Notfall-Ansicht" im Babysitter-Link (Fiebermittel, Dosierung als Notiz). Auto-Verbandkasten gleich mit. | S–M | ✓✓ Familie | Spezial-Apps, HomeMedKit (OSS) |
| 13 | **Hausrat-Inventar-PDF für die Versicherung** | Export pro Raum: Fotos, Kaufpreis (aus Bon), Datum, Seriennr. Ein Knopf, kein Pflegeaufwand jenseits dessen, was schon da ist. | S | ✓ Privatsphäre | Homebox teilw., Versicherer-Apps |
| 14 | **Wiederkehrende Aufgaben mit Rotation (schlank)** | Aufgabe, Intervall, optional Rotation zwischen Personen, „erledigt" per Tipp/NFC/HA-Button. **Tody-Prinzip**: wird allmählich fällig statt hart überfällig, keine roten Strafzahlen. | M | ✓✓ ADHS, ✓ Familie | Donetick, Tody, OurHome, Flatastic, Grocy |
| 15 | **Kinder-Routinen (Morgen/Abend)** | Schrittfolgen mit Icons auf Tablet/HA-Dashboard, optional Sterne. Bewusst *ohne* Punktewirtschaft im Kern. | M | ✓ Familie | TaskMate, OurHome |
| 16 | **Wand-/Küchen-Display-Modus** | Kiosk-Ansicht (Tablet, E-Ink, HA-Panel): heute Essen, Liste, Abläufe, Aufgaben, Wetter optional. Ohne Login, nur Lesen plus Abhaken. Passt auch zum Kita-Display-Know-how. | S–M | ✓✓ ADHS (Sichtbarkeit), ✓ Familie | Cozi/Skylight-Geräte (proprietär), HA-Dashboards |
| 17 | **Ladensplit und Mehrere Läden** | Artikel bevorzugtem Laden zuordnen (REWE vs. dm vs. Markt). Liste wird geteilt, Bons lernen die Zuordnung automatisch. | S | ✓ Dienstag | Plan to Eat, AnyList |
| 18 | **Ortsbasierte Erinnerung über HA** | „Du bist beim dm: 3 Sachen auf der Liste" über HA-Zonen + bestehendes Webhook-Paket. Kein eigenes GPS-Tracking. | S | ✓ Privatsphäre (über HA) | AnyList (eigene Ortung) |
| 19 | **Wegwerf-Grund und Lernschleife** | Beim „weg" ein Tipp: abgelaufen / zu viel gekauft / mag keiner. Daraus Hinweise („Spinat 3× weggeworfen, kleiner kaufen?") und Mindestbestand anpassen. | S | ✓ wenig Eingabe | niemand |
| 20 | **Gefrierschrank-Logik** | Einfrierdatum statt MHD, Empfehlungs-Haltbarkeit pro Kategorie, „Eiszeit"-Warnung, Portionen. | S | ✓✓ ADHS | Grocy (gefroren-Status) |
| 21 | **Allergien und Ernährungsprofile pro Person** | Personen- und Gastprofile (vegetarisch, Nuss, laktosefrei). Filtert Rezeptvorschläge und Gäste-Bar, warnt im Wochenplan. | M | ✓ Familie | Mealime, Samsung Food |
| 22 | **Party-/Besuchsplaner** | Gästezahl + Anlass → Mengenvorschlag (Getränke/Snacks), Einkaufsliste, Gäste-Bar vorbefüllt, Nachbereitung „was ist übrig". | M | ✓ Familie | niemand |
| 23 | **Umzugsmodus / Kisten mit QR** | Ort-Typ „Kiste" mit QR-Etikett (druckbar). „Wo ist der Akkuschrauber?" funktioniert während des Umzugs. Allgemein: QR-Etiketten für jeden Ort. | S–M | ✓ | Homebox, Sortly |
| 24 | **Kalender-Feeds (ICS) für Wochenplan, Fristen, Abläufe** | Abonnierbar in Apple/Google/Nextcloud-Kalender. Sehr wenig Aufwand, große Reichweite in der Familie (Partner sieht es im eigenen Kalender). | S | ✓✓ Partner | Tandoor, Mealie (HA-Kalender) |
| 25 | **Speiseplan-Vorlagen und Rotation** | „Woche wie letzte Woche", Lieblingswochen, feste Tage („Freitag Pizza"). | S | ✓✓ Dienstag | AnyList (Templates), Paprika (Menüs) |
| 26 | **Rezept-Skalierung, Kochmodus mit Timer** | Portionen skalieren, Schritt-für-Schritt-Vollbild, Timer (bei Thermomix-Schritten schon Zeit/Temp vorhanden). | S–M | ✓ | Mealie, Samsung Food, AnyList, Paprika |
| 27 | **Native Wrapper / Widgets** | Homescreen-Widget „Liste" und „Heute", Share-Sheet-Ziel („Rezept-URL teilen → ToHuus"). PWA-Share-Target zuerst (S), native Hülle später (L). | S → L | ✓✓ wenig Eingabe | KitchenOwl, Bring!, AnyList |
| 28 | **OIDC/SSO-Login** | Für Self-Hoster mit Authentik/Authelia/Forgejo. | S | ✓ Privatsphäre | Mealie, Tandoor |
| 29 | **Mehrere Haushalte / Oma-Modus** | Zweiter Haushalt (Ferienhaus, Großeltern), geteilte Listen zwischen Haushalten („bring bei Oma vorbei"). | L | ~ | Mealie (Households), KitchenOwl |
| 30 | **Überschuss teilen** | „Zu viel da": Artikel markieren → Text/Foto für Nachbarn, WhatsApp, Foodsharing-Gruppe. **Keine** TGTG-/Foodsharing-API (es gibt keine offizielle). | S | ✓ | niemand |
| 31 | **Haustiere** | Futter als Vorrat (gibt es schon), dazu Zyklen (Entwurmung, Impfung, Flohschutz) über #5 und ein Notfall-Blatt für Tiersitter (Babysitter-Link-Prinzip). | S (auf #5) | ✓ Familie | kaum |
| 32 | **Produkt-Katalog-Pflege mit einem Tipp** | Doppelte Produkte zusammenführen, Bon-Aliase verwalten, Bild aus Foto. Grundlage gegen „Datenbank-Rückgrat"-Problem (Galaxus). | M | ✓ | Grocy (manuell) |
| 33 | **Nährwerte/Nutri-Score (optional)** | Aus Open Food Facts schon verfügbar, nur anzeigen, nie bewerten oder belehren. | S | ~ | Tandoor, Samsung Food |
| 34 | **Dokumente-Brücke zu Paperless-ngx** | Bon-/Garantie-PDFs automatisch an Paperless schicken bzw. von dort Tags lesen. Für Power-User, die Paperless ohnehin betreiben. | M | ✓ Privatsphäre | niemand |
| 35 | **MCP-Erweiterungen** | Tools für Zyklen, Garantien, Haushaltsbuch, Abgleich („Was sollte ich heute prüfen?"), wöchentlicher Assistenten-Rückblick. | S je Paket | ✓✓ wenig Eingabe | niemand (Alleinstellung) |
| 36 | **Onboarding „erste 10 Minuten"** | Statt leerer App: REWE-DSGVO-CSV oder 3 Bons hochladen → Katalog steht. Raum-Vorlagen, Zyklus-Vorlagen ankreuzen. | S | ✓✓ Dienstag | niemand in dieser Form |

### Bewusst *nicht* empfohlen
- **Familienkalender/Chat/Ortung** (Cozi, FamilyWall): Feld ist besetzt, Ortung ist ein Datenschutz-Risiko, ein Kalender-Abo (#24) reicht.
- **Vollwertige Finanz-/Bank-Anbindung** (Homechart): erhöht Komplexität und Angriffsfläche. Das Haushaltsbuch aus Bons (#6) deckt 80 % des Nutzens im Lebensmittelbereich.
- **Gamification mit Punkten im Kern** (OurHome): führt zu „overly complicated". Höchstens optional für Kinder (#15).
- **Too-Good-To-Go-Integration:** keine offizielle API, AGB-Risiko.
- **Preisvergleich zwischen Händlern via Scraping:** rechtlich und wartungstechnisch fragil.

---

## 4. Quellenbewertung (jede Quelle einzeln)

| Quelle | Bewertung |
|---|---|
| [Galaxus: Kühlschrank digitalisieren, Grocy](https://www.galaxus.de/en/page/how-i-want-to-digitise-the-contents-of-my-fridge-and-fail-to-do-so-39565) | **Stark.** Ehrlicher Selbstversuch einer Redakteurin, konkrete Reibungspunkte. Einzelfall, aber deckungsgleich mit anderen Berichten. Galaxus ist Händler, hat hier kein erkennbares Verkaufsinteresse. |
| [Linuxlinks: Grocy](https://www.linuxlinks.com/grocy-erp-beyond-fridge/) | **Gut.** Fachlich, ausgewogen. |
| [Yahoo/How-To: Grocy Android](https://tech.yahoo.com/apps/articles/tried-open-source-android-app-100710498.html) | **Schwach-mittel.** Positiver Kurzbericht, keine Langzeit-Erfahrung. |
| XDA „Grocy … until I used it for a week" | Nur Titel belegt (Abruf gesperrt). Nicht inhaltlich verwendet. |
| [Lemmy-Threads (ndlug, disroot)](https://lemmy.ndlug.org/post/619307) | **Stark für Nutzerverhalten.** Echte Self-Hoster mit Partner-Kontext, keine Verkaufsabsicht. Kleine Stichprobe. |
| [Cooklang: Tandoor vs Mealie vs KitchenOwl](https://cooklang.org/blog/42-tandoor-vs-mealie-vs-kitchenowl/) | **Interessenkonflikt** (Wettbewerber, schließt mit Eigenwerbung). Für Feature-Fakten brauchbar, Wertungen mit Vorsicht. |
| [Cooklang: HA-Integration-Recherche](https://cooklang.org/cli/commands/home_assistant_integration_research/) | **Mittel.** Sachliche Lückenanalyse, gleicher Interessenkonflikt (will Lücke selbst füllen). |
| GitHub-READMEs ([Homebox](https://github.com/sysadminsmedia/homebox), [KitchenOwl](https://github.com/TomBursch/kitchenowl)), [grocy.info](https://grocy.info/), [mealie.io](https://mealie.io/), [tandoor.dev](https://tandoor.dev/) | **Primärquellen** für Funktionen. Selbstdarstellung, nicht für Qualität. |
| [selfhosting.sh: Home-Inventory](https://selfhosting.sh/best/home-inventory/) | **Mittel.** Vergleichsportal mit Hosting-Affiliate-Nähe möglich. Feature-Tabelle plausibel. |
| [Elfhosted: Donetick](https://store.elfhosted.com/product/donetick/) | **Verkaufsseite eines Hosters**, Feature-Angaben ok, keine Nutzerbewertung. |
| [HA Community: TaskMate](https://community.home-assistant.io/t/taskmate-family-chore-rewards-integration-now-in-hacs-default/1023281) | **Primär (Entwickler).** Ideenquelle, Reichweite gering (3 Likes). |
| [AlternativeTo: Homechart](https://alternativeto.net/software/homechart/about) | **Mittel.** Faktenseite, kaum Nutzerstimmen. |
| [Mobiflip: Bring! Premium (2020)](https://www.mobiflip.de/?p=401895), [iphone-ticker: Bring! Kundenkarten (2018)](https://www.iphone-ticker.de/einkaufslisten-app-bring-verwaltet-jetzt-kundenkarten-134250/) | **Gut, aber alt.** Preis/Umfang kann sich geändert haben. |
| [JustUseApp: Cozi](https://justuseapp.com/en/app/407108860/cozi-family-organizer/reviews), [OurHome](https://justuseapp.com/en/app/879717020/ourhome-chores-and-rewards/reviews) | **Mittel.** Aggregiert echte Store-Bewertungen, Zusammenfassungen teils maschinell. Preisangaben dort sind Nutzer-Durchschnitte, **nicht offiziell**. |
| [Kimola: „Cozi App Review"/FamilyWall](https://kimola.com/reports/essential-familywall-app-feedback-analysis-report-google-play-en-us-140607) | **Schwach.** Seite falsch betitelt, Prozentwerte aus 6 Bewertungen, NPS „70" ohne Herleitung. **Unbelegte Zahl, Verkaufstrichter für Analyse-Tool.** Nur Einzelzitate genutzt. |
| heynori.com (FamilyWall-Alternativen) | Abruf fehlgeschlagen. Ohnehin **Hersteller-Blog** (Nori), Vergleich als Verkaufstrichter. Nicht genutzt. |
| [Fortune: Meal-Planning-Apps](https://fortune.com/article/best-meal-planning-apps) | **Mittel.** Affiliate-geprägter Ratgeber, widersprüchliche Preisangaben im selben Artikel. Für grobe Einordnung. |
| FoodiePrep-Blog (Suchtreffer) | **KI-Anbieter-Blog**, Verkaufstrichter. Nicht genutzt. |
| [Reluctant Gourmet: Paprika](https://reluctantgourmet.com/paprika-recipe-manager-review/) | **Mittel.** Preise von 2013, Kommentare wertvoller als Artikel. |
| [App Store: AnyList](https://apps.apple.com/au/app/anylist-grocery-shopping-list/id522167641), [Pantry Check](https://apps.apple.com/us/app/id6670480023) | **Primär** für Funktionen/Preise (AU-Preise). Bewertungen selektiv. |
| [Android Authority: Samsung Food](https://www.androidauthority.com/samsung-food-3517054/) | **Gut.** Unabhängiger Test, klare Kritik. |
| [iPhoneLife: Mealime](https://iphonelife.com/content/mealime-pro-review-perfect-recipe-app-busy-professionals) | **Mittel, alt** (Bezug 2016). |
| [iphone-ticker: Cookidoo-Preis](https://www.iphone-ticker.de/thermomix-app-preis-fuer-cookidoo-abo-steigt-25-prozent-237796/) | **Gut** für Preis/Datum. Leserkommentare unverifiziert. |
| [Flatastic Premium](https://flatastic-app.com/en/premium) | **Herstellerseite**, kein konkreter Preis („weniger als ein Kaffee"): Marketing-Formulierung. |
| [Marlvel: Tody](https://marlvel.ai/apps/tody) | **Schwach.** KI-generiertes App-Analyse-Portal, Teile hinter Login. Nur grobe Fakten genutzt. |
| [Todoist: Partner austricksen](https://www.todoist.com/inspiration/how-to-trick-your-partner-into-using-todoist) | **Hersteller-Content mit Augenzwinkern.** Wertvoll nur, weil der Hersteller das Akzeptanzproblem selbst einräumt. |
| [NerdWallet: Grocery-App und Ehe](https://www.nerdwallet.com/finance/learn/how-a-grocery-list-app-helped-my-marriage) | **Erfahrungsbericht** plus Experten-Zitate (Savings.com ist selbst kommerziell). Kein Wirksamkeitsbeleg. |
| [Stylist „86 %"](https://stylist.co.uk/life/household-chores-invisible-load/863474), [P&G Mental Load](https://shots.net/news/view/p-g-aims-to-help-unpack-the-mental-load) | **Marken-Umfragen/Kampagnen. Unbelegte Zahl, nicht zitieren.** |
| [Apartment Therapy: ADHS-Kühlschrank](https://www.apartmenttherapy.com/adhd-fridge-organization-method-37433539) | **Anekdote**, aber praxisnah und konsistent. |
| [Substack: ADHS-Kühlschrank der Zukunft](https://writebrainmedia.substack.com/p/the-fridge-of-the-future-vs-adhd) | **Hype/Anekdote.** „Eliminate food waste for the rest of humanity" ist Übertreibung, der Fachbegriff ohne Quelle. |
| [UBA: Abfälle privater Haushalte](https://www.umweltbundesamt.de/daten/private-haushalte-konsum/wohnen/abfaelle-privater-haushalte) | **Stark (amtlich).** Methodikwechsel beachten. |
| [Ärztezeitung: Hausapotheke-App (2014)](https://www.aerztezeitung.de/Wirtschaft/Mehr-Ordnung-in-der-Hausapotheke-239499.html) | **Gut, alt.** App vom Pharmahersteller MSD (Eigeninteresse), Funktionsmuster aber übertragbar. |
| [heidelberg24: Edeka eBon (2021)](https://www.heidelberg24.de/verbraucher/edeka-aenderung-aktuell-kunden-kassenzettel-bon-ebon-digital-bonpflicht-einzelhandel-deutschland-zr-90855653.html), [iphone-ticker: Rossmann (2025)](https://www.iphone-ticker.de/rossmann-fuehrt-digitale-kassenbons-in-der-app-ein-256105) | **Gut** für Fakten. Edeka-Stand regional (Nord), aktuellen Stand vor Parser-Bau prüfen. |
| [Sortly Help](https://help.sortly.com/hc/en-us/articles/360035774271) | **Herstellerseite**, Preise nicht ausgewiesen (Intransparenz als Befund). |
| [LZ: KptnCook/Miele](https://www.lebensmittelzeitung.net/handel/nachrichten/Minderheitsbeteiligung-Kptn-Cook-bekommt-finanziellen-Schub-von-Miele-136945) | **Gut** (Fachpresse). Nur Geschäftsmodell-Kontext. |
| [TGTG-Client (inoffiziell)](https://piefed.jeena.net/c/linuxphones/p/321121/too-good-to-go-api-client-python) | Beleg dafür, dass es nur inoffizielle Wege gibt. |

---

## 5. Strategische Einordnung

1. **Positionierung:** ToHuus ist das einzige Projekt, das *Zugang ohne Tippen* (Bons, Avis, Foto, MCP) ernsthaft löst. Die nächste Grenze ist *Verbrauch ohne Tippen* (#1 Abgleich, #4 Prognose, #7 Reste). Wer beides hat, besiegt die Todesursache des ganzen Genres.
2. **Bring! ist der eigentliche Gegner**, nicht Grocy. Self-Hoster verlassen Bring! wegen Werbung/Cloud und kehren wegen Bedienbarkeit zurück. #2 und #3 entscheiden, ob der Partner bleibt.
3. **Der Hausstand ist mehr als Essen.** Mit #5, #11, #12 und #13 wird ToHuus zum „Haus-Gedächtnis", ohne Grocy-Komplexität, weil alles auf Orten und „Wo ist was?" aufsetzt, die schon existieren.
4. **Vorsicht vor Funktionsfülle.** Homechart, OurHome und Grocy werden für Überladung kritisiert. Grocys Feature-Flags sind die richtige Antwort: Module abschaltbar, Standard schlank.
5. **Folgeauftrag:** Reddit-Tiefenauswertung (r/selfhosted, r/homeassistant, r/Grocy, r/ADHD, r/de) per `reddit-recherche`-Skill auf dem Mac, GitHub-Issues der Wettbewerber nach Upvotes (Zugriff aus dieser Umgebung gesperrt).
