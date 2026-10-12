# Gut zu wissen – facts and sources

Short, sourced facts around ToHuus' topics, shown under *Mehr › Gut zu wissen* (web) and available to the iPhone app.
Data: `server/data/facts.json` (German and English text, what ToHuus does about it, sources). API: `GET /api/facts?lang=de|en` (public, no household data) → `{ version, retrieved, help, facts: [{ id, topic, title, text, tohuus, sources: [{ title, publisher, url, retrieved, note? }] }] }`.

Rules: every number has a **primary source** (federal agencies and ministries, the statistics office, the consumer advice centres, the law itself, the research institute that published the study) with link and retrieval date; no secondary press, no numbers from marketing. Model values are called model values (WSI). Where two primary sources count differently (EU reporting vs. GfK diary study) both are named with their method. `test/facts.test.ts` checks: 10–15 facts, every source https on a primary domain with a date, the same numbers in German and English.

When updating: re-check every number against the source, change `retrieved`, keep `id`s stable (the apps may refer to them).

## Facts

### Der größte Teil fällt zu Hause an (`food-waste-households`, topic `food-waste`)

2020 fielen in Deutschland rund 11 Millionen Tonnen Lebensmittelabfälle an. Rund 59 Prozent davon, 6,5 Millionen Tonnen, kamen aus privaten Haushalten – knapp 78 kg pro Kopf. Schalen und Knochen sind mitgezählt.

*ToHuus:* ToHuus merkt sich, was ihr gekauft habt, und zeigt auf „Heute“, was bald weg sollte – ohne dass ihr einen Vorrat pflegen müsst.

- Umweltbundesamt: [Essen für die Tonne: 11 Mio. Tonnen Lebensmittel](https://www.umweltbundesamt.de/themen/essen-fuer-die-tonne-11-mio-tonnen-lebensmittel), abgerufen 2026-10-12 – Zahlen für 2020, wie 2022 an die EU-Kommission gemeldet.

### Etwa 40 Prozent wären vermeidbar (`food-waste-avoidable`, topic `food-waste`)

Im Haushaltstagebuch der GfK für das Bundesernährungsministerium kamen 2020 rund 56 kg Lebensmittelabfall pro Person und Jahr zusammen. Etwa 40 Prozent davon galten als vermeidbar.

*ToHuus:* „Daraus könnt ihr heute kochen“ fängt bei dem an, was schon da ist – erst danach kommt, was fehlt.

- GfK SE im Auftrag des BMEL, veröffentlicht vom Umweltbundesamt: [Lebensmittelabfälle in deutschen Haushalten 2020 (GfK-Studie, Abschlussbericht)](https://www.umweltbundesamt.de/sites/default/files/medien/6232/dokumente/gfk-studie_2020.pdf), abgerufen 2026-10-12 – Tagebuchstudie mit rund 6 000 Haushalten; andere Methode als die EU-Meldung, daher kleinere Menge.

### Allein wirft man pro Kopf mehr weg (`food-waste-household-size`, topic `food-waste`)

Pro Person warfen Einpersonenhaushalte 2020 rund 79 kg weg, Zweipersonenhaushalte rund 59 kg und Haushalte mit drei und mehr Personen rund 44 kg.

*ToHuus:* ToHuus ist für Singles genauso gebaut wie für Familien: Portionen lassen sich direkt eintippen, und die Einkaufsliste rechnet mit.

- GfK SE im Auftrag des BMEL, veröffentlicht vom Umweltbundesamt: [Lebensmittelabfälle in deutschen Haushalten 2020 (GfK-Studie, Abschlussbericht)](https://www.umweltbundesamt.de/sites/default/files/medien/6232/dokumente/gfk-studie_2020.pdf), abgerufen 2026-10-12

### Obst, Gemüse und Brot vorneweg (`food-waste-fruit-veg-bread`, topic `food-waste`)

Frisches Obst und Gemüse machen rund ein Drittel der vermeidbaren Abfälle aus, Brot und Backwaren etwa 13 Prozent.

*ToHuus:* Die Kochideen bevorzugen Rezepte mit dem, was bald weg muss – und zeigen, was davon schon da ist.

- GfK SE im Auftrag des BMEL, veröffentlicht vom Umweltbundesamt: [Lebensmittelabfälle in deutschen Haushalten 2020 (GfK-Studie, Abschlussbericht)](https://www.umweltbundesamt.de/sites/default/files/medien/6232/dokumente/gfk-studie_2020.pdf), abgerufen 2026-10-12

### Falsche Menge gekauft (`food-waste-wrong-amount`, topic `shopping-list`)

Bei rund 13 Prozent der vermeidbaren Abfälle war zu viel oder eine zu große Packung gekauft worden (7 Prozent falsche Menge, 6 Prozent zu große Packung).

*ToHuus:* Aus dem Rezept kommt die Zeile mit auf die Liste („für Curry: 2 Hähnchenbrustfilets“), und Mengen werden nur zusammengezählt, wenn die Einheiten passen.

- Zu gut für die Tonne! (BMEL): [Zusammenfassung: Lebensmittelabfälle in privaten Haushalten 2020](https://www.zugutfuerdietonne.de/fileadmin/zgfdt/inhalt/Service/Studien/Zusammenfassung_GfK_2020_LMA_in_privaten_Haushalten.pdf), abgerufen 2026-10-12

### Rund 137 Euro im Jahr (`food-waste-cost`, topic `food-waste`)

Die vermeidbaren Lebensmittelabfälle eines durchschnittlichen Haushalts waren 2020 rund 137 Euro im Jahr wert.

*ToHuus:* Unter „Geld“ seht ihr, was Lebensmittel und Haushalt euch wirklich kosten – aus euren eigenen Kassenbons.

- Zu gut für die Tonne! (BMEL): [Zusammenfassung: Lebensmittelabfälle in privaten Haushalten 2020](https://www.zugutfuerdietonne.de/fileadmin/zgfdt/inhalt/Service/Studien/Zusammenfassung_GfK_2020_LMA_in_privaten_Haushalten.pdf), abgerufen 2026-10-12

### Mindestens haltbar ist nicht „sofort weg“ (`best-before-vs-use-by`, topic `dates`)

Nach dem Mindesthaltbarkeitsdatum („mindestens haltbar bis“) sind richtig gelagerte, ungeöffnete Lebensmittel oft noch gut – Aussehen, Geruch und Geschmack entscheiden. Nach dem Verbrauchsdatum („zu verbrauchen bis“), etwa bei Hackfleisch oder frischem Fisch, soll man sie nicht mehr essen.

*ToHuus:* ToHuus unterscheidet beide Daten: „mindestens haltbar“ ist ein Hinweis zum Prüfen, „zu verbrauchen bis“ eine echte Grenze.

- Verbraucherzentrale: [Mindesthaltbarkeitsdatum (MHD) ist nicht gleich Verbrauchsdatum](https://www.verbraucherzentrale.de/wissen/lebensmittel/auswaehlen-zubereiten-aufbewahren/mindesthaltbarkeitsdatum-mhd-ist-nicht-gleich-verbrauchsdatum-13452), abgerufen 2026-10-12

### Am Datum liegt es selten (`best-before-small-share`, topic `dates`)

Ein abgelaufenes Mindesthaltbarkeitsdatum war 2020 nur bei rund 5 Prozent der vermeidbaren Haushaltsabfälle der Hauptgrund. Viel häufiger war etwas verdorben (36 Prozent) oder es war zu viel gekocht (17 Prozent).

*ToHuus:* Reste lassen sich beim Kochen als Box festhalten – ToHuus erinnert daran, bevor sie hinten im Kühlschrank verschwinden.

- Zu gut für die Tonne! (BMEL): [Zusammenfassung: Lebensmittelabfälle in privaten Haushalten 2020](https://www.zugutfuerdietonne.de/fileadmin/zgfdt/inhalt/Service/Studien/Zusammenfassung_GfK_2020_LMA_in_privaten_Haushalten.pdf), abgerufen 2026-10-12

### Der Einkaufszettel hilft (`shopping-list-tip`, topic `shopping-list`)

Die Verbraucherzentrale nennt den Einkaufszettel als einen der einfachsten Wege, weniger Lebensmittel wegzuwerfen: kaufen, was gebraucht wird, statt was gerade im Angebot liegt.

*ToHuus:* Eine gemeinsame Liste für alle, jede Zeile mit Herkunft – und Vorschläge aus eurem Kaufrhythmus, die erst nach einem Ja draufkommen.

- Verbraucherzentrale: [Lebensmittel wertschätzen und vor der Tonne bewahren](https://www.verbraucherzentrale.de/wissen/lebensmittel/auswaehlen-zubereiten-aufbewahren/lebensmittel-wertschaetzen-und-vor-der-tonne-bewahren-59543), abgerufen 2026-10-12

### Wer denkt an alles? (`mental-load`, topic `mental-load`)

Nach einer Auswertung des WSI (Hans-Böckler-Stiftung, 2023) liegt die geschätzte Wahrscheinlichkeit, die Alltagsorganisation überwiegend zu übernehmen, bei erwerbstätigen Frauen bei 62 Prozent, bei Männern bei 20 Prozent; bei Frauen mit Kindern bei 74 Prozent. Es sind Modellwerte aus einer Befragung von rund 2 200 Erwerbspersonen, keine Auszählung.

*ToHuus:* Alle tragen zur selben Liste bei, ToHuus merkt sich den Rest. Niemand muss etwas pflegen oder „zuständig“ sein.

- Hans-Böckler-Stiftung / WSI: [Pressemitteilung: Alltagsorganisation bei Paaren und Familien (WSI Report Nr. 87)](https://www.boeckler.de/de/pressemitteilungen-2675-alltagsorganisation-bei-paaren-und-familien-51349.htm), abgerufen 2026-10-12 – Lott, Bünger: Mental Load – Frauen tragen die überwiegende Last, WSI Report 87, August 2023.

### Vorrat für zehn Tage (`stockpile-days`, topic `stockpiling`)

Das Bundesamt für Bevölkerungsschutz empfiehlt, sich möglichst zehn Tage selbst versorgen zu können – schon drei Tage helfen sehr. Beim Wasser rechnet es mit 2 Litern pro Person und Tag, davon 0,5 Liter zum Kochen.

*ToHuus:* Vorrat ist in ToHuus freiwillig. Wer einen hält, sieht, was bald ersetzt werden sollte – ohne Pflicht zum Pflegen.

- Bundesamt für Bevölkerungsschutz und Katastrophenhilfe (BBK): [Vorsorgen für Krisen und Katastrophen (Ratgeber)](https://www.bbk.bund.de/SharedDocs/Downloads/DE/Mediathek/Publikationen/Buergerinformationen/Ratgeber/ratgeber-notfallvorsorge.pdf?__blob=publicationFile), abgerufen 2026-10-12

### Der Grundpreis gilt pro Kilo oder Liter (`unit-price`, topic `unit-prices`)

Händler müssen bei verpackter Ware neben dem Gesamtpreis den Grundpreis angeben – seit der neuen Preisangabenverordnung je 1 Kilogramm oder 1 Liter. Nur bei loser Ware darf es auch je 100 Gramm oder 100 Milliliter sein.

*ToHuus:* Bei Preisänderungen rechnet ToHuus aus euren Bons den Preis pro Kilo oder Liter – so fallen kleinere Packungen zum alten Preis auf.

- Bundesministerium der Justiz – gesetze-im-internet.de: [Preisangabenverordnung (PAngV) § 4 Pflicht zur Angabe des Grundpreises](https://www.gesetze-im-internet.de/pangv_2022/__4.html), abgerufen 2026-10-12
- Bundesministerium der Justiz – gesetze-im-internet.de: [Preisangabenverordnung (PAngV) § 5 Mengeneinheit für die Angabe des Grundpreises](https://www.gesetze-im-internet.de/pangv_2022/__5.html), abgerufen 2026-10-12

### Lebensmittel wurden deutlich teurer (`food-prices`, topic `prices`)

Nahrungsmittel kosteten 2023 im Jahresdurchschnitt 12,4 Prozent mehr als 2022 – nachdem sie 2022 schon um 13,4 Prozent gestiegen waren. Die Inflationsrate insgesamt lag 2023 bei 5,9 Prozent.

*ToHuus:* ToHuus zeigt nicht den Durchschnitt, sondern eure eigenen Preisänderungen – bei den Dingen, die ihr wirklich kauft.

- Statistisches Bundesamt (Destatis): [Press release No. 020 of 16 January 2024: Inflation rate at +5.9% in 2023](https://www.destatis.de/EN/Press/2024/01/PE24_020_611.html), abgerufen 2026-10-12

## Checked but not used

- Share of household consumption spending on food (Destatis EVS 2023): the public page gives no total share in a form we could cite as one number – left out until Destatis publishes it.
- Impulse buying rates from surveys: no primary source with a robust number found; the Verbraucherzentrale's shopping-list advice is used instead, without a number.
- BBK web pages for stockpiling were not reachable (404/blocked); the BBK guide PDF is the source.
