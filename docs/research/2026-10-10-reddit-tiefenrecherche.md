# ToHuus Hub: Reddit-Tiefenrecherche

Stand: 10.10.2026 · Folgeauftrag zu [`2026-10-10-wettbewerb-und-nutzerbedarf.md`](2026-10-10-wettbewerb-und-nutzerbedarf.md) (dort Abschnitt 0 und 5.5: Reddit war aus der Cloud nicht erreichbar).

## 0. Methode und Grenzen

- **Werkzeug:** Skill `reddit-recherche`, OpenCLI über die eingeloggte Chrome-Sitzung des Recherchekontos auf Tills Mac. Nur lesend (`search`, `read`), keine Profile durchsucht, keine Schreibaktion.
- **Umfang:** 26 Suchen in r/selfhosted, r/homeassistant, r/grocy, r/ADHD, r/Parenting, r/de, r/Finanzen, r/mealprep sowie subredditübergreifend; 22 Threads vollständig gelesen (Top-Kommentare bis Tiefe 2).
- **Grenzen:**
  - Nach rund 20 Abrufen in kurzer Folge hat Reddit das Konto für einige Minuten gedrosselt („Failed to fetch"). Danach mit Pausen von 6–7 s weitergearbeitet. Mehr Threads wären möglich, aber nicht ohne Risiko für das Konto.
  - **r/de und r/Finanzen liefern zum Thema fast nichts.** r/de-Treffer sind Nachrichten und Wutposts (Lebensmittelmotten, Supermarkt-Ärger), keine App-Erfahrungen. Die Suche nach „Bring" in r/de ergibt nur Rauschen. Deutschsprachige Nutzerstimmen zu Bring!/Haushalts-Apps müssten in r/selbsthosten, r/FragReddit oder in Foren gesucht werden. Das ist hier offen geblieben.
  - r/mealprep ist klein und rezeptlastig; zu Inventar-Apps kamen nur drei schwache Treffer.
  - Reddit ist **qualitatives Marktsignal, keine Statistik.** Upvotes messen Zustimmung in einer Blase (r/selfhosted ist technikaffin, männlich geprägt, englischsprachig). Nichts hier wirft einen bestehenden Beschluss um, alles sind Hypothesen.

## 1. Kernbefunde

### 1.1 Grocy scheitert am Pflegeaufwand, und die Leute sagen es offen
- Das bestbewertete Grocy-Setup in r/homeassistant (Tablet + Barcode-Scanner, 656 Punkte, 2025) bekommt als Top-Antworten „Neat but also insane" (377) und „Just showed this to my wife. She said: ‚Don't you dare!'" (367). Die Bewunderung gilt der Bastelei, nicht dem Alltag. [Thread](https://www.reddit.com/r/homeassistant/comments/1kvwcu5/)
- „Grocy is great, but overkill … there's no way in hell that I'm going to have the discipline to record my consumption." Der Autor baut stattdessen ein Bild-Dashboard „tippen, was fehlt". [Thread](https://www.reddit.com/r/homeassistant/comments/1bs9f2u/) (45 Punkte, 2024)
- Ein Familienvater (4 Personen, zweite Truhe im Keller) dokumentiert zehn Stolpersteine bei der Ersteinrichtung; der Grocy-Maintainer antwortet in vier Teilen mit Begriffserklärungen. Gut gemeint, zeigt aber das Problem: Man muss das Modell erst lernen. [Thread](https://www.reddit.com/r/grocy/comments/1m4687f/) (2025)
- „Starting over … life got in the way, and I stopped maintaining it." Lösung des Maintainers: `DELETE FROM stock;` per SQLite-Browser. Ein anderer fragt sofort: „nur für den Kühlschrank?" [Thread](https://www.reddit.com/r/grocy/comments/1d156ib/) (2024)
- Neue Mitbewerber begründen sich explizit damit: ThePantry (r/selfhosted, 2026) „frustrated with how long it was taking to get the initial data into the system"; ein Kommentar: „Grocy (way, way too complicated for day to day tracking)". [Thread](https://www.reddit.com/r/selfhosted/comments/1rme1z4/)

### 1.2 Wer durchhält, trackt nur, was ausgeht
- Die ehrlichste Erfahrung kommt aus einem Streit-Thread: Ein Skeptiker (6 Punkte) schreibt, Inventar-Apps seien Zeitverschwendung, „If you can't manage things as is you certainly won't remember to log every use". Die Antwort: erst gescheitert, dann neu angefangen, nur noch das, was am häufigsten ausgeht (Klopapier, Küchenrolle, Staubsaugerbeutel, Batterien), per Knopf und NFC-Tag. [Thread](https://www.reddit.com/r/homeassistant/comments/1l5tnvg/) (2025)
- Derselbe Thread: „getting my wife on board to participate is another story."
- Mehrere Nutzer schlagen unabhängig dasselbe vor: **NFC/QR dort, wo das Ding lebt; scannen setzt es auf die Liste.** [Thread](https://www.reddit.com/r/homeassistant/comments/1bs9f2u/)

### 1.3 Die Einkaufsliste entscheidet über die Partner-Akzeptanz
- In r/ADHD ist das Muster „Liste in der Reihenfolge des Ladens" die mit Abstand häufigste Strategie („For me it was putting things in the order they are in the store", 56; „i only wish they'd let me re-order the list … in the spatial order", Wut, wenn der Laden umräumt). [Thread](https://www.reddit.com/r/ADHD/comments/1p5ygaf/) (siehe aber Astroturfing-Hinweis in Abschnitt 4)
- AnyList wird in r/ADHD ohne erkennbares Eigeninteresse genannt: geteilte Liste mit Partner, „pretty friction-less", eigene Listen pro Laden. [Thread](https://www.reddit.com/r/ADHD/comments/1tbnziz/) (2026)
- Ein Self-Hoster bekommt in r/selfhosted auf die Frage nach einer Rezept-App für die Frau das Gegenteil von Grocy empfohlen: einfach zu installieren, für den Partner einfach zu benutzen, mit HA verbunden. Mealie gewinnt dort, Tandoor wird wegen kaputter Updates kritisiert. [Thread](https://www.reddit.com/r/selfhosted/comments/1oxycb6/) (2025)
- WAF-Thread: „Always have the simple option as a fallback if something breaks", SSO, „make sure it's working 99% of the time", und ein guter Einwand: „this is just user experience but this sub needs to gender it". [Thread](https://www.reddit.com/r/selfhosted/comments/1b44vgc/) (2024)

### 1.4 ADHS: Sichtbarkeit und „ohne Scham" schlagen Vollständigkeit
- „Today's ADHD tax: Food waste" (532 Punkte): Curry über Nacht im Wok vergessen. Top-Kommentar: „I put food in the refrigerator and then either forget about it or don't feel like getting it out" (260). Helfer: Vakuumierer mit Datum und Namen auf dem Beutel. [Thread](https://www.reddit.com/r/ADHD/comments/17ehp7x/) (2023)
- „The fridge tax is real": Was nach hinten oder in die Schubladen wandert, existiert nicht mehr. Strategien: Bald-Ablaufendes an **einen festen Platz** legen, nichts in Schubladen, Kühlschrank nicht zu voll, Fotos von Kühlschrank/Vorrat vor dem Einkauf, eine Tabelle mit nur drei Spalten (Ding, Ablauf, Ort im Kühlschrank). [Thread](https://www.reddit.com/r/ADHD/comments/1spuqb7/) (2026; Astroturfing-Hinweis in Abschnitt 4)
- „Went to the store for milk, came home with $60 of random stuff, forgot the milk" (464). Titel genügt als Signal. [Thread](https://www.reddit.com/r/ADHD/comments/1qubj7k/) (2026, nur Titel/Anriss gelesen)

### 1.5 Mental Load: Es geht um Unsichtbarkeit, nicht um Minuten
- „Husband doesn't get the mental load" (375 Punkte, 224 Kommentare): Die Debatte kippt zwischen „er arbeitet 60 Stunden" und „wer plant Essen, wer weiß, was fehlt". Die Autorin: „being appreciated … versus it just getting done … like a little fairy comes in". Und: Hilfe einkaufen ist selbst Mental Load, „hiring the person, tasking them and managing them is also a set of tasks". [Thread](https://www.reddit.com/r/Parenting/comments/1etpskr/) (2024)
- Gegenbeispiel mit 466 Punkten: Paar teilt nach Stärken, „He does all food. I do all money/logistics." [Thread](https://www.reddit.com/r/Parenting/comments/1jrqn3s/) (2025)
- 4-Wochen-Essensplan als „life hack" (184): Paar setzt sich zusammen hin, plant vier Wochen, geteilte Liste in iOS-Erinnerungen, Reste gezielt in ein zweites Gericht verwandeln, „freezer meal night" als feste Kategorie. [Thread](https://www.reddit.com/r/Parenting/comments/1tgcmat/) (2026)

### 1.6 Kinder und Teenager auf der Familienliste
- Teenagerin will die Kreditkarte, um selbst einzukaufen; alle Teenager sind schon auf der Einkaufs-App des Partners. Mit Abstand stärkster Kommentar (1.487 Punkte): Gibt es etwas, das sie **nicht auf eine geteilte Liste schreiben möchte**? (Hygieneartikel, Medikamente, Essstörung als Sorge.) [Thread](https://www.reddit.com/r/Parenting/comments/1es9csu/) (2024)

### 1.7 Gäste-Bestellungen zu Hause: Nachfrage seit Jahren, keine Lösung
- „Cocktail Bar / Inventory / Ordering?" (2021): Tablet mit Karte für Gäste, Inventar der Flaschen, Warnung bei knappen Zutaten, Deckel pro Gast. Antworten: „sweet idea, I'd love to see this get made", Verweis auf Grocy. [Thread](https://www.reddit.com/r/selfhosted/comments/nxnyks/)
- „I want to take orders for my garden kitchen" (2024): Bar Assistant + Mealie laufen schon, gesucht wird eine Karte für Grill/Pizzaofen mit Anpassungen pro Bestellung, „rather than trying to write it all down". TastyIgniter sei „overkill". Vorschläge: MQTT, Bon-Drucker. [Thread](https://www.reddit.com/r/selfhosted/comments/1dlr4h7/)

### 1.8 Vertrauen in kleine Projekte und in KI-gebaute Apps
- „What happened to KitchenOwl?" (141 Punkte, 2026): GitHub-Repo, Konto und Website waren plötzlich weg. Nutzer: „we've been using kitchen owl for grocery runs … Hopefully this isn't signaling the need for me to change tools". Ein PR-Autor: „the wife has been complaining for months" über einen iOS-Login-Fehler. [Thread](https://www.reddit.com/r/selfhosted/comments/1sd2lw9/)
- CookTrace v1.4.0 (218 Punkte, Oktober 2026), ein AGPL-, SQLite-, Single-Container-Projekt wie ToHuus: Top-Kommentar „God it's so easy to tell an interface designed by Claude" (120), dazu „vibe coded slop", „there's never any mention of the main competition", ein Moderations-Bot fragt nach dem KI-Einsatz. [Thread](https://www.reddit.com/r/selfhosted/comments/1wwl9qm/)
- Grocy-Maintainer-Konflikt (482 Punkte, 544 Kommentare, 2024): „Ever been turned off on an app because of the developer's behavior?" [Thread](https://www.reddit.com/r/selfhosted/comments/1gplrtk/) (nur Titel und Anriss gelesen)

### 1.9 Haushaltsbuch: Konsequenz ist das Problem, nicht die Funktion
- r/Finanzen, „Haushaltsbuch-App mit Gemeinschaftskonto": „man muss halt echt konsequent sein, um alles einzutragen. Realistisch betrachtet wird man jeden Monat ein paar Buchungen vergessen." Zweites Problem: Ausgaben vom Gemeinschaftskonto gehören nur anteilig einem selbst. [Thread](https://www.reddit.com/r/Finanzen/comments/171z0q7/) (2023)

## 2. Abgleich mit bestehenden ToHuus-Funktionen

| ToHuus-Funktion | Reddit sagt | Urteil |
|---|---|---|
| Bon-/Abholavis-Import, „Einkäufe tippt keiner ab" | Pflegeaufwand ist der Hauptgrund, Grocy aufzugeben (1.1); Haushaltsbuch scheitert an Konsequenz (1.9) | **bestätigt**, stärkstes Signal |
| Halb voll / ungezählte Dinge | „cooking is much more than products", Zwiebeln und Kartoffeln lassen sich nicht sinnvoll zählen (ThePantry-Thread) | **bestätigt** |
| Schnell-Abgleich pro Ort | Grocy-Nutzer setzen den Bestand per SQL zurück und fragen nach „nur Kühlschrank" (1.1) | **bestätigt**; Lücke: echter „Neustart" eines Orts, siehe Idee 4 |
| Verbrauchsprognose | Skeptiker: Verbrauch bucht niemand dauerhaft (1.2) | **bestätigt** die Richtung; muss als Schätzung sichtbar bleiben |
| Laden-Modus, Gang-Reihenfolge, offline | Liste in Ladenreihenfolge ist die häufigste ADHS-Strategie (1.3) | **bestätigt** |
| „Ich hol's", Live-Liste, Push | AnyList/Trello in Echtzeit mit Partner (1.3) | **bestätigt** |
| Schnell-Eingabe, HA-To-do-Sync (Assist/Siri) | Alexa-/Google-Liste und Todoist über Assist als Alltagslösungen (1.2) | **bestätigt** |
| „Zuerst essen", Angebrochen, Reste, Einfrieren | „fester Platz für Bald-Ablaufendes", Reste gezielt weiterverwenden, Beutel mit Datum (1.4, 1.5) | **bestätigt**; Lücke: physisches Gegenstück, siehe Idee 2 |
| Monatliche Weggeworfen-Karte | ADHS-Threads sind voller Scham („embarrassing", „feel like absolutely shit") | **bestätigt**, aber nur in sanfter Form; Zahlen nie anklagend formulieren |
| QR-Etiketten | NFC/QR am Lagerplatz ist die wiederkehrende Bastellösung (1.2) | **bestätigt**; Ausbau siehe Ideen 2 und 6 |
| Party-Modus, Gäste-Bar, Bestellen vom Sofa | Zwei unabhängige Anfragen in r/selfhosted (2021, 2024), keine passende Lösung gefunden (1.7) | **bestätigt**, echte Lücke im Markt; die Nachfrage ist klein, aber sehr spezifisch |
| Haus & Pflege (Zyklen) | Kaum direkte Reddit-Belege in dieser Stichprobe | **weder bestätigt noch widerlegt** |
| Haushaltsbuch aus Bons | Konsequenz-Problem gelöst; Gemeinschaftskonto-Split fehlt (1.9) | **teilweise bestätigt** |
| Wochenplan nach Vorrat | 4-Wochen-Plan und „Anchor Meals" sind beliebter als täglich neu planen (1.5, 1.4) | **teilweise widersprochen**: Viele wollen weniger Abwechslung, nicht klügere Vorschläge. Rotation fehlt, siehe Idee 9 |
| Backups, Export, Self-hosting | KitchenOwl-Schreck, Tandoor-/Immich-Updates zerstören Instanzen (1.3, 1.8) | **bestätigt**; Vertrauen braucht zusätzlich sichtbare Projektpflege, siehe Idee 7 |
| Kinder-Rollen (geplant) | Teenager-Thread: Privatsphäre auf der Familienliste (1.6) | **erweitert** die Anforderung, siehe Idee 5 |
| „Mit viel Hilfe von Claude gebaut" (Website, README) | r/selfhosted reagiert gereizt auf KI-gebaute Apps, besonders ohne Vergleich zur Konkurrenz (1.8) | **Risiko** für den Launch, kein Widerspruch zur Ehrlichkeit; siehe Idee 7 |

## 3. Neue Ideen, priorisiert

Aufwand in Arbeitsblöcken (S = eine Agenten-Session, M = 2–3, L = 4+).

| Rang | Idee | Was genau | Beleg | Aufwand |
|---|---|---|---|---|
| 1 | **Messenger-Liste einfügen** | In die Schnell-Eingabe eine ganze WhatsApp-/SMS-Liste einfügen (eine Zeile pro Artikel, Aufzählungszeichen, Mengen), daraus werden Einträge mit Produktzuordnung. Dazu PWA-Share-Target: „Teilen → ToHuus" aus dem Messenger. | Häufigstes Alltagsszenario in r/ADHD (Partner schickt Liste per Nachricht); auch wenn der Ausgangspost verdächtig ist, bestätigen die Kommentare das Muster unabhängig (1.3) | S |
| 2 | **Einfrier- und Reste-Etikett** | Beim Einfrieren oder bei „Reste" ein kleines Etikett drucken (Name, Datum, QR). Scannen bucht „gegessen" oder „weg". Optional ein Etikett „Zuerst essen" für eine echte Kiste im Kühlschrank, das die virtuelle Zone öffnet. | Beutel mit Datum und Name (17ehp7x), „fester Platz für Bald-Ablaufendes" (1spuqb7), Brother-QL-Etikettendruck in r/grocy | S (baut auf QR-Etiketten auf) |
| 3 | **Startmodus „Nur was ausgeht"** | Beim Onboarding wählen: Voller Vorrat oder nur Verbrauchsgüter (Klopapier, Küchenrolle, Kaffee, Batterien, Filter). Mindestbestände vorbelegt, Lebensmittel optional später. | Einziger Erfahrungsbericht von jemandem, der nach einem Scheitern dabeigeblieben ist (1.2) | S |
| 4 | **Ort neu aufnehmen, ohne Scham** | Pro Ort: „alles als unbestätigt markieren" bzw. „Bestand auf null, Produkte behalten", danach direkt in den Schnell-Abgleich. Text ohne Vorwurf („Willkommen zurück"). | Grocy-Neustart per SQL, Nachfrage nach „nur Kühlschrank" (1.1); ADHS-Scham (1.4) | S |
| 5 | **Diskrete Einträge** | Ein Listeneintrag kann „nur für mich" bzw. „nur für Erwachsene/Admins" sichtbar sein; im Laden-Modus erscheint er bei der Person, die ihn mitnimmt. Wichtig mit kommenden Kinder-/Teenager-Rollen. | 1.487 Punkte für genau diesen Gedanken (1.6) | S–M |
| 6 | **„Ist alle"-Bildtafel und QR ohne Login** | Kiosk-/Tablet-Ansicht mit großen Bildern: tippen, was leer ist, landet auf der Liste. QR am Regal funktioniert auch ohne Anmeldung für Haushaltsmitglieder (Gerät gekoppelt), damit Kinder und Gäste mitmachen können. | Bild-Dashboard und NFC-am-Lagerplatz als wiederkehrende Bastellösung (1.2) | M |
| 7 | **Launch-Hygiene für r/selfhosted** | Kein Code, aber vor jeder Ankündigung: Vergleichstabelle mit Grocy, KitchenOwl, Mealie, Tandoor im README; offener Absatz „wie KI beim Bau eingesetzt wurde und wie getestet wird"; Repo-Spiegel auf Codeberg; Screenshots, die nicht nach Standard-KI-Oberfläche aussehen. | CookTrace-Reaktion (1.8), KitchenOwl-Schreck (1.8) | S |
| 8 | **Mehrwochen-Rotation im Wochenplan** | „Diese 4 Wochen wiederholen" bzw. Lieblingsgerichte als feste Kategorie („Freitag Pizza", „Reste-Abend", „Gefrier-Abend"). Vorrat-Vorschläge füllen nur noch die Lücken. | 4-Wochen-Plan (184 Punkte), Anchor Meals (1.4, 1.5); bestätigt Idee #25 aus der Wettbewerbsanalyse | S |
| 9 | **Küchen-Bon drucken (Party)** | Optional: neue Party-Bestellung druckt auf einem ESC/POS-Bondrucker in der Küche bzw. am Grill. | Grillküchen-Thread nennt den Bondrucker ausdrücklich (1.7) | M, niedrige Priorität |
| 10 | **Gemeinschaftskonto-Anteil im Haushaltsbuch** | Pro Laden oder Bon: „gemeinsam" mit Anteil (50/50, 70/30). Monatsansicht zeigt den eigenen Anteil. | r/Finanzen (1.9) | S, niedrige Priorität |

Bewusst **nicht** übernommen:
- **Punkte oder „Wer hat mehr gemacht"-Statistik** als Antwort auf Mental Load. Die Threads drehen sich um Wertschätzung und Unsichtbarkeit. Eine Rangliste würde den Streit eher anheizen. Höchstens eine neutrale Wochenübersicht „was im Haus passiert ist", ohne Personenvergleich. Das ist eine Hypothese, kein Beschluss.
- **Kamera-/Waagen-Hardware in der Küche als Standard.** Die Reaktionen auf das Grocy-Tablet-Setup („Don't you dare!") sprechen dagegen.

## 4. Quellenbewertung (jeder Thread einzeln)

Bewertung: **E** = Erfahrungsbericht, **M** = Meinung, **P** = Produktvorstellung. Astroturfing-Check bei jedem Eintrag.

| Thread | Sub, Datum, Punkte/Kommentare | Art | Belegqualität und Einordnung |
|---|---|---|---|
| [My Grocy setup with tablet and barcode scanner](https://www.reddit.com/r/homeassistant/comments/1kvwcu5/) | r/homeassistant, 2025, 656/169 | E | Hohe Reichweite, aber die Aussagekraft liegt in den Reaktionen (Partner-Ablehnung als Witz). Kein Werbeaccount erkennbar. Frage „still using it after 2 years?" blieb in den gelesenen Antworten offen. |
| [HA shopping list, click to add](https://www.reddit.com/r/homeassistant/comments/1bs9f2u/) | r/homeassistant, 2024, 45/46 | E | Ehrlicher Eigenbericht, kein Produkt dahinter. Kleine Stichprobe. Gut. |
| [Inventory on food or household consumables?](https://www.reddit.com/r/homeassistant/comments/1l5tnvg/) | r/homeassistant, 2025, 8/26 | E + M | Wenig Punkte, aber der beste Langzeitbericht (gescheitert, neu angefangen, schmaler Umfang). Skeptiker-Kommentar ist Meinung ohne Beleg, aber als Gegenstimme wichtig. |
| [Grocy: initial thoughts after setup](https://www.reddit.com/r/grocy/comments/1m4687f/) | r/grocy, 2025, 5/19 | E | Detaillierter Erstbericht einer Familie; Antworten vom Maintainer selbst (Interessenvertreter, aber sachlich). Kleine Reichweite. |
| [Grocy: Starting over](https://www.reddit.com/r/grocy/comments/1d156ib/) | r/grocy, 2024, 5/5 | E | Einzelfall, aber typisch. Kein Interesse erkennbar. |
| [ThePantry](https://www.reddit.com/r/selfhosted/comments/1rme1z4/) | r/selfhosted, 03/2026, 30/39 | P | **Selbstvorstellung eines Entwicklers** („in about a week using about $5 in credits on OpenRouter"). Produktaussagen sind Eigenwerbung. Verwertbar sind nur die Kommentare (Zählbarkeit, Ablaufdatum, Mealie-Anbindung). |
| [What happened to KitchenOwl?](https://www.reddit.com/r/selfhosted/comments/1sd2lw9/) | r/selfhosted, 04/2026, 141/124 | E | Belegbares Ereignis mit Links (Release-Statement v0.7.8). Ursache laut Kommentaren ein GitHub-Problem, nicht final geklärt. Signal: Nutzer reagieren nervös auf Ein-Personen-Projekte. |
| [CookTrace v1.4.0](https://www.reddit.com/r/selfhosted/comments/1wwl9qm/) | r/selfhosted, 10/2026, 218/79 | P | **Eigenwerbung** einer App-Familie („TraceApps"), laut Kommentaren KI-gebaut. Die Kritik ist Meinung, aber hoch bewertet (120) und aktuell. Ein Kommentar empfiehlt Norish, worauf sich der Norish-Entwickler bedankt: **möglicher Eigenwerbe-Kontext**, nicht übernehmen. |
| [What recipe service do you use?](https://www.reddit.com/r/selfhosted/comments/1oxycb6/) | r/selfhosted, 2025, 55/32 | M + E | Mehrere unabhängige Erfahrungen (Mealie einfach, Tandoor-Updates brechen). Tandoor-Entwickler meldet sich offen als solcher (transparent, kein Astroturfing). |
| [How to improve the „Wife Approval Factor"?](https://www.reddit.com/r/selfhosted/comments/1b44vgc/) | r/selfhosted, 2024, 32/72 | M | Allgemeine UX-Ratschläge, nicht themenspezifisch. Brauchbar als Prinzipien (Fallback, SSO, Stabilität). |
| [Cocktail Bar / Inventory / Ordering?](https://www.reddit.com/r/selfhosted/comments/nxnyks/) | r/selfhosted, 2021, 11/13 | Wunsch | Alt und klein, aber sehr konkret. Kein Produktbezug. |
| [Garden kitchen orders](https://www.reddit.com/r/selfhosted/comments/1dlr4h7/) | r/selfhosted, 2024, 21/7 | Wunsch | Konkret, unabhängig vom ersten. Zusammen zwei Belege für eine Nische, nicht für einen Massenmarkt. |
| [Inventory system for food](https://www.reddit.com/r/selfhosted/comments/a8ebmj/) | r/selfhosted, 2018, 20/38 | Wunsch | Veraltet (Grocy-Installationshinweise von 2018). Nur als Beleg, dass „mit der Frau teilen" seit Jahren die Anforderung ist. |
| [Today's ADHD tax: Food waste](https://www.reddit.com/r/ADHD/comments/17ehp7x/) | r/ADHD, 2023, 532/194 | E | Viele unabhängige Kurzberichte. Hohe Glaubwürdigkeit für das Muster „aus dem Blick, aus dem Sinn". |
| [The fridge tax is real](https://www.reddit.com/r/ADHD/comments/1spuqb7/) | r/ADHD, 04/2026, 18/13 | E? | **Astroturfing-Verdacht:** Autor schreibt „I've been messing around with building a little system for this", die eigenen Antworten klingen generiert („genuinely underrated … exactly the right level of complexity"), ein weiterer Kommentar ebenso. Vermutlich Marktforschung eines App-Bauers. Die übrigen Kommentare (Schubladen, fester Platz, Fotos) sind unabhängig und verwertbar. |
| [ADHD + grocery shopping: one tiny thing](https://www.reddit.com/r/ADHD/comments/1p5ygaf/) | r/ADHD, 11/2025, 148/124 | P (verdeckt) | **Klassischer Verkaufstrichter:** zweimal fast gleichzeitig gepostet (zweiter Post 1p5yghv), „Happy to explain exactly how I convert the list if anyone wants the method". Der Post selbst ist **nicht** als Beleg zu werten. Die Kommentare dagegen (Ladenreihenfolge, Papierliste, Trello mit Partner) sind unabhängig und decken sich mit anderen Threads. |
| [Three small things that have helped me](https://www.reddit.com/r/ADHD/comments/1tbnziz/) | r/ADHD, 05/2026, 14/14 | E | AnyList-Empfehlung ohne Link oder Werbeton; ein Kommentar verlinkt 1Password auffällig (Affiliate-Muster möglich, für uns irrelevant). |
| [Went to the store for milk …](https://www.reddit.com/r/ADHD/comments/1qubj7k/) | r/ADHD, 02/2026, 464/39 | E | Nur Titel und Anriss gelesen. Anekdote mit hoher Zustimmung. |
| [Husband doesn't get the mental load](https://www.reddit.com/r/Parenting/comments/1etpskr/) | r/Parenting, 2024, 375/224 | E + M | Einseitige Schilderung, Kommentare widersprechen sich offen. Wertvoll als Beleg, dass „Mental Load" Planung und Wissen meint, nicht Arbeitszeit. |
| [Husband started picking up mental load](https://www.reddit.com/r/Parenting/comments/1jrqn3s/) | r/Parenting, 2025, 466/41 | E | Positiver Einzelfall; Aufteilung nach Stärken. Kein Produktbezug. |
| [A life hack: 4-week meal plan](https://www.reddit.com/r/Parenting/comments/1tgcmat/) | r/Parenting, 05/2026, 184/71 | E | Glaubwürdiger Alltagsbericht, nutzt iOS-Erinnerungen. Kein Werbeinteresse. |
| [Teenager wants my credit card](https://www.reddit.com/r/Parenting/comments/1es9csu/) | r/Parenting, 2024, 443/563 | E | Thema ist Erziehung, der Bezug zu uns ist ein einzelner, sehr stark bewerteter Kommentar. Übertragung auf Apps ist meine Ableitung. |
| [Haushaltsbuch-App mit Gemeinschaftskonto](https://www.reddit.com/r/Finanzen/comments/171z0q7/) | r/Finanzen, 2023, 13/22 | E | Eine Mitentwicklerin einer genannten App bedankt sich offen (transparent). Brauchbar für das Konsequenz-Problem; älter. |
| r/Finanzen „Haushaltsbuch App gesucht" (mehrere, 2021–2025) | r/Finanzen | Wunsch | Nur Titel ausgewertet. Fast alle wollen Bankanbindung; für ToHuus nur am Rande relevant (Bons statt Konto). |
| r/de-Suchen (Einkaufsliste, Bring, Lebensmittel wegwerfen, Lebensmittelverschwendung) | r/de, 2019–2026 | – | **Ergeben nichts Verwertbares.** Nachrichten, Politik, ein Motten-Wutpost. Ausdrücklich als Leerstelle festgehalten. |
| r/mealprep „Using freezer inventory" u. a. | r/mealprep, 2026 | E/P | Klein (4 Punkte). Ein Treffer ist eine Produktankündigung („Smart Recipe Builder, under development", 0 Punkte): **Eigenwerbung**, nicht gewertet. |
| [Grocy-Entwickler-Verhalten](https://www.reddit.com/r/selfhosted/comments/1gplrtk/) | r/selfhosted, 2024, 482/544 | M | Nur Titel und Anriss. Einseitige Darstellung eines Konflikts; als Signal für „Ton im Issue-Tracker zählt" genügt es, als Urteil über Grocy nicht. |

**Auffällige Muster:** Eigenwerbung tritt in r/selfhosted offen auf (Projektvorstellungen, okay), in r/ADHD verdeckt (Problem-Post mit späterem Methoden-Angebot, Doppelpost, generiert klingende Antworten). Zahlen zu Ersparnis oder Wirkung kamen in keinem gelesenen Thread mit Beleg vor.

## 5. Offene Fragen

- Deutschsprachige Erfahrungen mit Bring!, Grocy und KitchenOwl: in r/selbsthosten, r/de_EDV, r/FragReddit oder in Foren (computerbase, heise) nachholen.
- Wie viele Grocy-Nutzer bleiben länger als drei Monate? Reddit liefert dazu nur Einzelfälle.
- Party-Modus: Gibt es Nachfrage über Self-Hoster hinaus (Familienfeiern, Vereinsheime)? Eventuell in r/Parenting/r/hosting suchen.
- Kinder und Teenager in Haushalts-Apps: gezielte Suche in r/Parenting nach „family app privacy teen" und „chore app" (der Abruf ist in diesem Lauf an der Drosselung gescheitert).

## 6. Verwendete Suchen

r/selfhosted: „pantry inventory app", „grocy wife", „kitchenowl", „mealie grocy", „wife acceptance factor grocy", „bar menu guests order" · r/homeassistant: „grocy" (top), „pantry inventory" · r/grocy: „too much work", „family" · r/ADHD: „grocery list app", „food waste fridge", „shared grocery list app partner" · r/Parenting: „mental load grocery list", „shared shopping list app", „chore app kids" (gedrosselt) · r/de: „Einkaufsliste App", „Lebensmittel wegwerfen", „Bring", „Lebensmittelverschwendung" · r/Finanzen: „Lebensmittel Haushaltsbuch App" · r/mealprep: „freezer inventory" · übergreifend: drei Suchen, an der Drosselung gescheitert.
