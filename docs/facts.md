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

## Research for the Ratgeber (14 Oct 2026)

Sources gathered for the Ratgeber posts in `site/src/posts/e-aufgaben.mjs`, grouped by the ToHuus function they
support. Eight of them are also in `server/data/facts.json` (the app's "Gut zu wissen" cards, up to 25 facts, checked by
`test/facts.test.ts`): `gender-care-gap-2022`, `cognitive-labor`, `adhd-everyday`, `plans-goals`, `eggs-shelf-life`,
`opened-no-period`, `sweets-spending`, `guest-wifi`. Move another one over only after re-checking it against the source. Same format as above, all
retrieved 2026-10-14. "Checked via" says how the number was confirmed: *page* = the source page itself was read,
*search* = the figure came from search results quoting the source (the page could not be opened from the build
environment). Strength: **solid** (official statistics or a large representative sample), **moderate** (one
peer-reviewed study, smaller or non-German sample), **weak** (indirect, lab setting or mixed evidence).

### Mental load & „Wer hat was im Blick“ / Denkarbeit-Check

#### Denkarbeit hat vier Teile (`cognitive-labor-four-parts`, topic `mental-load`)

Daminger beschreibt kognitive Hausarbeit als vier Schritte: Bedarf erkennen, Möglichkeiten suchen, entscheiden, im Blick behalten. In ihren 35 Paaren machten Frauen insgesamt mehr davon, vor allem Erkennen und Im-Blick-Behalten; beim Entscheiden waren beide etwa gleich beteiligt. Die Arbeit ist anstrengend und für beide Seiten oft unsichtbar, deshalb häufig Streitquelle.

*ToHuus:* Der Denkarbeit-Check macht genau diese Dinge Karte für Karte sichtbar; „Ich hab’s im Blick“ trennt Drandenken vom Machen.

- Allison Daminger, American Sociological Review 84 (4), 609–633: [The Cognitive Dimension of Household Labor](https://doi.org/10.1177/0003122419859007), abgerufen 2026-10-14 – qualitative Studie, 70 Interviews mit 35 Paaren (USA, eher gut gebildet). Strength: moderate (qualitativ, keine Repräsentativität). Checked via search (abstract).

#### Allein verantwortlich (`invisible-labor-mothers`, topic `mental-load`)

In einer Befragung von 393 Müttern in den USA fühlten sich fast neun von zehn allein verantwortlich für die Organisation der Familientermine, obwohl 65 Prozent berufstätig waren. Sich allein für das Wohl der Kinder verantwortlich zu fühlen, hing mit geringerer Lebens- und Partnerschaftszufriedenheit zusammen.

*ToHuus:* Der Denkarbeit-Check zeigt nur, wenn alle zustimmen, wer was trägt; Hinweise statt Punkte.

- Ciciolla, Luthar, Sex Roles 2019: [Invisible Household Labor and Ramifications for Adjustment: Mothers as Captains of Households](https://asu.elsevierpure.com/en/publications/invisible-household-labor-and-ramifications-for-adjustment-mother/), abgerufen 2026-10-14 – eher gut situierte Stichprobe; bei der Terminorganisation war die Varianz zu klein, um einen Zusammenhang mit Belastung statistisch zu prüfen. Strength: moderate. Checked via search (abstract, ASU press release).

#### Neun Stunden mehr unbezahlte Arbeit (`gender-care-gap-2022`, topic `mental-load`)

2022 leisteten Frauen ab 18 knapp 29,5 Stunden unbezahlte Arbeit pro Woche, Männer knapp 20,5. Gender Care Gap: 43,4 Prozent (2012/2013: 52,4 Prozent). Fast die Hälfte der unbezahlten Arbeit von Frauen ist klassische Hausarbeit (Kochen, Putzen, Wäsche), knapp 13 Stunden pro Woche.

*ToHuus:* Aufgaben mit Rhythmus, Abwechseln und „Wer hat was im Blick“ machen die Verteilung sichtbar, ohne Strichliste.

- Statistisches Bundesamt (Destatis): [Zeitverwendungserhebung 2022, Ergebnisse](https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Einkommen-Konsum-Lebensbedingungen/Zeitverwendung/Ergebnisse/_inhalt.html), abgerufen 2026-10-14 – revidiert am 6. Juni 2025 (Zensus 2022); die Erstveröffentlichung 2024 nannte 43,8 Prozent. Rund 10 000 Haushalte, 20 000 Personen. Strength: solid. Checked via page. Die Seite nennt für Männer bei der Hausarbeit nur „etwa die Hälfte“, keine genaue Zahl.

#### Planungsarbeit (WSI) – already listed above as `mental-load`

Re-checked 2026-10-14: 62 Prozent (Frauen) / 20 Prozent (Männer), 74 Prozent bei Frauen mit Kindern, 57 Prozent bei Frauen in Vollzeit; Befragung November 2022, 2 255 Personen. Modellwerte.

#### Teilen der Hausarbeit ist vielen wichtig (`chores-marriage`, topic `tasks`)

56 Prozent der verheirateten Erwachsenen in den USA nannten 2016 das Teilen der Hausarbeit „sehr wichtig“ für eine gute Ehe, mehr als Kinder (43 Prozent) oder ausreichendes Einkommen (42 Prozent).

*ToHuus:* Aufgaben mit „Wer macht es“, „Abwechselnd“ und „Ich hab’s im Blick“, ohne Punkte.

- Pew Research Center: [Sharing chores a key to good marriage, say majority of married adults](https://www.pewresearch.org/short-reads/2016/11/30/sharing-chores-a-key-to-good-marriage-say-majority-of-married-adults/), abgerufen 2026-10-14 – USA, Religious Landscape Study. Strength: moderate for Germany (US data). Checked via search.

### Aufgaben & Erinnerungen

#### Ein Plan beruhigt den Kopf (`plan-making-offload`, topic `tasks`)

In Experimenten drängten sich unerledigte Ziele deutlich weniger in die Gedanken und störten andere Aufgaben weniger, sobald die Teilnehmenden einen konkreten Plan dafür aufgeschrieben hatten.

*ToHuus:* Ein Satz an den Assistenten oder ein Tipp, und die Sache ist als Aufgabe mit Datum festgehalten.

- Masicampo, Baumeister, Journal of Personality and Social Psychology 101 (4), 667–683: [Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals](https://doi.org/10.1037/a0024192), abgerufen 2026-10-14 – Laborstudien mit Studierenden. Strength: weak to moderate (lab, Baumeister-Labor; nicht unabhängig repliziert, soweit geprüft). Checked via search.

#### Wenn-dann-Pläne (`implementation-intentions`, topic `tasks`)

Eine Meta-Analyse über 94 Tests fand für konkrete Wenn-dann-Pläne („wenn X, dann mache ich Y“) einen mittleren bis großen Effekt auf das Erreichen von Zielen (d ≈ 0,65).

*ToHuus:* Aufgaben mit festem Wochentag oder Uhrzeit und Erinnerung zur gewählten Stunde.

- Gollwitzer, Sheeran, Advances in Experimental Social Psychology 38, 69–119: [Implementation intentions and goal achievement: a meta-analysis of effects and processes](https://doi.org/10.1016/S0065-2601(06)38002-1), abgerufen 2026-10-14 – vor allem Studien ohne ADHS; Effektgröße vermutlich durch Publikationsbias etwas überschätzt. Strength: moderate. Checked via search.

#### Erinnerungen auslagern (`cognitive-offloading`, topic `tasks`)

Kognitives Auslagern heißt, Gedächtnisarbeit an die Umwelt abzugeben, etwa eine Erinnerung im Handy statt im Kopf. Menschen tun das, wenn sie es für effizienter halten; Langzeitfolgen sind wenig erforscht.

*ToHuus:* Aufgaben in Apple Erinnerungen und Kalender (CalDAV, beide Richtungen), gebündelte Erinnerungen im sanften Modus.

- Risko, Gilbert, Trends in Cognitive Sciences 20 (9), 676–688: [Cognitive Offloading](https://doi.org/10.1016/j.tics.2016.07.002), abgerufen 2026-10-14 – Übersichtsarbeit, keine Wirksamkeitsstudie. Strength: weak as evidence for an app (describes the mechanism). Checked via search.

### Kopf voll / ADHS

#### ADHS bei Erwachsenen (`adhd-adults-prevalence`, topic `focus`)

In einer repräsentativen Befragung von 1 655 Erwachsenen (18–64) in Deutschland zeigten 4,7 Prozent aktuelle ADHS-Anzeichen.

*ToHuus:* Kleine Schritte, Eins nach dem anderen, Timer, sanfter Modus, Neu anfangen – für alle, ohne Begründung.

- de Zwaan u. a., European Archives of Psychiatry and Clinical Neuroscience 262, 79–86 (2012): [The estimated prevalence and correlates of adult ADHD in a German community sample](https://link.springer.com/doi/10.1007/s00406-011-0211-9), abgerufen 2026-10-14 – Screening-Fragebögen (Selbsteinschätzung), keine klinische Diagnose; andere Studien liegen bei etwa 3 Prozent (Fayyad 2007, nicht selbst geprüft). Strength: moderate. Checked via search.

#### Mehr Diagnosen bei Erwachsenen (`adhd-adults-diagnoses`, topic `focus`)

Neue ADHS-Diagnosen bei gesetzlich versicherten Erwachsenen stiegen von rund 8,6 (2015) auf 25,7 pro 10 000 (2024), plus 199 Prozent; der Abstand zwischen Männern und Frauen schrumpfte, bei 18- bis 24-Jährigen ist er fast verschwunden.

*ToHuus:* wie oben.

- Zentralinstitut für die kassenärztliche Versorgung, Deutsches Ärzteblatt 2025: [Inzidenz von AD(H)S-Spektrum-Störungen bei Erwachsenen](https://www.aerzteblatt.de/archiv/inzidenz-von-adhs-spektrum-stoerungen-bei-erwachsenen), abgerufen 2026-10-14 – Abrechnungsdaten aus 17 KVen; 2024 vorläufig; neuer Diagnoseschlüssel 2019 und Pandemie als Teil der Erklärung. Strength: solid for diagnoses (not prevalence). Checked via search (several reports agree; the article itself returned 503).

#### Was im Alltag hilft (`adhd-everyday-strategies`, topic `focus`)

Erwachsene mit ADHS haben vor allem Probleme, Alltag oder Arbeit zu organisieren, sich länger zu konzentrieren und Termine einzuhalten. Genannte Hilfen: Routinen, den Tag planen, Erinnerungslisten, Erinnerungshilfen an wichtigen Stellen (Haustür, Kühlschrank), Aufgaben in kleinere Schritte teilen.

*ToHuus:* „In kleine Schritte teilen“, Eins nach dem anderen, Erinnerungen gebündelt zu einer gewählten Stunde.

- IQWiG, gesundheitsinformation.de: [ADHS bei Erwachsenen](https://www.gesundheitsinformation.de/adhs-bei-erwachsenen.html), abgerufen 2026-10-14 – Stand 4. Mai 2022, Aktualisierung für 2026 geplant. Strength: solid as official health information (advice, not an effect study). Checked via page.

#### Organisationstraining in der Therapie (`adhd-cbt-organisation`, topic `focus`)

In einer randomisierten Studie mit 86 medikamentös behandelten Erwachsenen mit ADHS hatte eine Verhaltenstherapie mit Modulen zu Kalender, Aufgabenliste und dem Zerlegen von Aufgaben in Schritte danach weniger Symptome als die Vergleichsgruppe (Entspannung); die Wirkung hielt 6 bis 12 Monate.

*ToHuus:* nutzt dieselben Bausteine (Liste, Schritte), ist aber keine Therapie und behauptet keine Wirkung.

- Safren u. a., JAMA 304 (8), 875–880 (2010): [CBT vs relaxation with educational support for medication-treated adults with ADHD](https://doi.org/10.1001/jama.2010.1192), abgerufen 2026-10-14 – Therapie mit Fachleuten, 12 Sitzungen; sagt nichts über Apps. Strength: moderate (one RCT). Checked via search.

### Haltbarkeit, Vorrat & Lebensmittelverschwendung

#### Eier: 28 Tage, bis zu sechs Wochen kühl (`eggs-shelf-life`, topic `dates`)

Rohe Eier haben ein vorgeschriebenes MHD von 28 Tagen nach dem Legen. Im Kühlschrank bei höchstens 7 °C halten sie bis zu sechs Wochen; nach dem MHD nur noch durcherhitzt essen. Nicht in die Kühlschranktür.

*ToHuus:* schätzt für frisch gekaufte Eier etwa drei Wochen ab Kauf (`fresh-shelf.ts`) und zeigt das als „geschätzt“, bis das Datum vom Karton eingetragen ist.

- Verbraucherzentrale: [Eier: Alles zu Lagerung und Haltbarkeit](https://www.verbraucherzentrale.de/wissen/lebensmittel/auswaehlen-zubereiten-aufbewahren/eier-haltbarkeit-und-lagerung-58925), abgerufen 2026-10-14. Strength: solid. Checked via page. (Die oft genannte Kühlpflicht im Handel ab Tag 18 steht dort nicht; nicht verwendet.)

#### Nach dem Öffnen fehlt oft die Angabe (`opened-no-period`, topic `dates`)

In zwei Marktchecks (2018 und 2023, zusammen 230 Produkte) stand bei 107 Produkten kein Zeitraum, wie lange sie nach dem Öffnen halten; oft nur „alsbald“ oder „gekühlt“. Rat: im Kühlschrank lagern, Öffnungsdatum notieren, vor dem Essen prüfen.

*ToHuus:* „Angebrochen“ hält das Öffnungsdatum fest und rechnet mit üblichen Tagen nach dem Öffnen, pro Produkt änderbar.

- Verbraucherzentrale: [Lebensmittel nach dem Öffnen „gekühlt lagern“: Angaben oft zu vage](https://www.verbraucherzentrale.de/wissen/lebensmittel/lebensmittel-nach-dem-oeffnen-gekuehlt-lagern-angaben-oft-zu-vage-109122), abgerufen 2026-10-14 – Stand 30. Juli 2025; Marktchecks der VZ Mecklenburg-Vorpommern. Strength: solid (small market check, but primary). Checked via page.

#### Konfitüre (`jam-shelf-life`, topic `dates`)

Gekaufte Konfitüre hält ungeöffnet bis zu zwei Jahre, nach dem Öffnen meist mehrere Monate im Kühlschrank; mit sauberem Löffel entnehmen. Fruchtaufstriche (weniger Zucker) und kalt gerührte Konfitüre halten kürzer.

*ToHuus:* Marmelade: etwa 42 Tage nach dem Öffnen als vorsichtige Schätzung.

- Verbraucherzentrale NRW: [Konfitüre und Marmelade: Haltbarkeit und Lagerung](https://www.verbraucherzentrale.nrw/wissen/lebensmittel/konfituere-und-marmelade-haltbarkeit-und-lagerung-58932) und Verbraucherzentrale: [Tipps zur Haltbarkeit und Lagerung von Lebensmitteln](https://www.verbraucherzentrale.de/tipps-zur-haltbarkeit-und-lagerung-von-lebensmitteln-59515), abgerufen 2026-10-14. Strength: solid. Checked via page.

#### Schimmel, Reste, Verbrauchsdatum (`bfr-storage`, topic `dates`)

Nach dem Verbrauchsdatum nicht mehr essen, Krankheitserreger verderben Lebensmittel selten sichtbar. Verschimmelte Wurst nicht essen; Ausnahme luftgetrocknete Salami und Schinken am Stück (Stelle großzügig entfernen, bei Scheiben nicht). Warme Speisen in wenigen Stunden unter 7 °C abkühlen und verschlossen kühlen.

*ToHuus:* „zu verbrauchen bis“ ist eine echte Grenze; Reste erscheinen unter „Zuerst essen“, am besten innerhalb von 3 Tagen.

- Bundesinstitut für Risikobewertung: [Essen nachhaltig und sicher genießen – so geht’s](https://www.bfr.bund.de/cm/343/essen-nachhaltig-und-sicher-geniessen-so-gehts.pdf), abgerufen 2026-10-14 – Flyer, letzte Änderung der PDF Januar 2020. Strength: solid. Checked via page (PDF text).

#### Lebensmittelabfälle 2022/2023 (`food-waste-2022`, topic `food-waste`)

2023 fielen in Deutschland 10,9 Millionen Tonnen Lebensmittelabfälle an, rund 58 Prozent in privaten Haushalten. Pro Kopf in Haushalten (2022): etwa 74,5 kg, Schalen und Kaffeesatz mitgezählt; über alle Bereiche 129 kg pro Kopf.

*ToHuus:* wie `food-waste-households` oben. Newer than the 2020 figures in `facts.json`; worth updating there.

- Umweltbundesamt: [Lebensmittelabfälle](https://umweltbundesamt.de/themen/abfall-ressourcen/abfallwirtschaft/abfallvermeidung/lebensmittelabfaelle), abgerufen 2026-10-14 – Stand 27. Oktober 2025; Meldung an die EU-Kommission. Strength: solid. Checked via page.

### Extras / Spontankäufe

#### Was Haushalte für Essen, Süßes und Getränke ausgeben (`food-spending-2023`, topic `prices`)

2023 gaben private Haushalte im Schnitt rund 335 Euro im Monat für Nahrungsmittel aus, 8 Prozent davon für Zucker und Süßwaren. Für Getränke rund 75 Euro, 45 Prozent davon (knapp 35 Euro) für alkoholische. Ohne Restaurant und Café.

*ToHuus:* Extras im Wocheneinkauf zeigt, wie viel von eurem eigenen Wochenbudget für Extras verplant ist, aus euren Bons.

- Statistisches Bundesamt (Destatis): [Pressemitteilung Nr. 204 vom 16. Juni 2026: Gut ein Fünftel der Nahrungsmittelausgaben entfallen auf Fleisch und Fisch](https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/06/PD26_204_639.html), abgerufen 2026-10-14 – EVS 2023, 9 965 Haushalte mit 14-Tage-Haushaltsbuch. Strength: solid. Checked via page.

#### Mentale Budgets lenken Käufe (`mental-budgeting`, topic `prices`)

Menschen setzen sich im Kopf Budgets für Kategorien und verfolgen ihre Ausgaben dagegen; ist der Topf schon gut gefüllt, kaufen sie in dieser Kategorie weniger, besonders bei typischen Käufen.

*ToHuus:* ein festes Wochenbudget für Extras, als Betrag oder Anzahl; nichts wird gesperrt.

- Heath, Soll, Journal of Consumer Research 23 (1), 40–52 (1996): [Mental Budgeting and Consumer Decisions](https://doi.org/10.1086/209465), abgerufen 2026-10-14 – drei Studien, USA, hypothetische und Labor-Entscheidungen. Strength: weak to moderate for real households. Checked via search (abstract).

#### Einkaufsfallen (`shopping-traps`, topic `shopping-list`)

Die Verbraucherzentrale rät gegen Impulskäufe: mit Einkaufsliste und Plan einkaufen, nicht hungrig, Grundpreise vergleichen. An der Kasse dominieren laut einer Marktprüfung der VZ Hamburg (82 Kassenbereiche) Süßigkeiten, Alkohol und Tabak.

*ToHuus:* die Liste als Plan, Extras sichtbar markiert.

- Verbraucherzentrale: [Einkaufsfallen im Supermarkt – diese Tricks sollen zum Kauf verführen](https://www.verbraucherzentrale.de/wissen/lebensmittel/einkaufsfallen-im-supermarkt-diese-tricks-sollen-zum-kauf-verfuehren-48915), abgerufen 2026-10-14 – Ratgeber, keine Zahl zu Impulskäufen. The Hamburg check was only seen in press coverage (zdfheute); not used in posts. Strength: advice, no effect size. Checked via search.

### Hausinfo für Babysitter und Gäste

#### Gäste-WLAN und Zugangsdaten (`guest-wifi`, topic `house-info`)

Das BSI empfiehlt ein eigenes Gäste-WLAN, das Besuch vom eigenen Netz trennt; Passwort aus mindestens 20 zusammenhanglosen Zeichen, mindestens WPA2 (besser WPA3). Zugangsdaten nirgends aushängen, nur auf Nachfrage weitergeben, etwa per QR-Code vom Router.

*ToHuus:* Gäste-WLAN als Code im Tresor, verdeckt bis „Zeigen“, mit QR-Code; Codes getrennt von den Karten, Freigabe pro Link und auf Zeit.

- Bundesamt für Sicherheit in der Informationstechnik (BSI): [Schritt für Schritt zum Gäste-WLAN](https://www.bsi.bund.de/DE/Themen/Verbraucherinnen-und-Verbraucher/Informationen-und-Empfehlungen/Cyber-Sicherheitsempfehlungen/Router-WLAN-VPN/Schritt-fuer-Schritt-zum-Gaeste-WLAN/Schritt-fuer-Schritt-zum-Gaeste-WLAN_node.html), abgerufen 2026-10-14. Strength: solid (official recommendation). Checked via search (BSI pages quoted in results).

### Kassenbons / Geld

See `food-spending-2023` above (household spending on food, sweets and drinks) and the existing `food-prices`, `unit-price` and `food-waste-cost` facts.

### Haushaltswissen (18 Oct 2026)

#### Im Blick behalten ist Arbeit (`knowledge-keeping-track`, topic `knowledge`)

In einer Studie mit 35 Paaren gehörte das Im-Blick-Behalten zu den vier Schritten der Denkarbeit im Haushalt. Es lag öfter bei den Frauen und blieb für die anderen meist unsichtbar.

*ToHuus:* Im Haushaltswissen steht, was sonst eine Person im Kopf behält: Größen, Maße, Zählerstände. Gefragt wird dann ToHuus, nicht sie.

- Allison Daminger, American Sociological Review 84 (4), 609–633: [The Cognitive Dimension of Household Labor](https://doi.org/10.1177/0003122419859007), abgerufen 2026-10-18 – qualitative Studie, 70 Interviews mit 35 Paaren in den USA, nicht repräsentativ. Same source as `cognitive-labor-four-parts`. Strength: moderate. Checked via search (abstract).

#### Ein fester Ort beruhigt den Kopf (`knowledge-fixed-place`, topic `knowledge`)

In Laborversuchen drängten sich offene Aufgaben weniger in die Gedanken, sobald es einen konkreten Plan dafür gab.

*ToHuus:* „Steht in ToHuus“ ist so ein fester Ort: Wo die Schuhgröße oder das Rollo-Maß steht, muss es sich niemand mehr merken.

- Masicampo, Baumeister, Journal of Personality and Social Psychology 101 (4), 667–683: [Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals](https://doi.org/10.1037/a0024192), abgerufen 2026-10-18 – Laborstudien mit Studierenden; über den Alltag zu Hause sagen sie nur indirekt etwas. Same source as `plan-making-offload`. The transfer from „plan“ to „written down in a fixed place“ is our reading, not a finding of the study. Strength: weak to moderate. Checked via search.

### Checked but not used (14 Oct 2026)

- **Shared lists reduce duplicate purchases:** no primary source with a number found. The closest is the GfK figure above (13 Prozent of avoidable waste from buying too much or too large packs, `food-waste-wrong-amount`), which is about amounts, not duplicates. Claims like "shared lists save X Euro" stay out.
- **Impulse-buying share of grocery spending:** still no robust primary German source (see above).
- **Egg cooling from day 18 in shops:** only in municipal leaflets (Aurich 2008, Würzburg), not on Verbraucherzentrale or BMLEH pages; not used.
- **Concrete days after opening for milk, cheese, cold cuts:** neither Verbraucherzentrale nor BfR give day counts; the posts state ToHuus' own estimates as estimates, not as official values.
- **Belegausgabepflicht (§ 146a Abs. 2 AO, since 2020):** gesetze-im-internet.de returned 503; not used.
- **BSI on writing passwords down:** only secondary reports (34 Prozent write passwords down, BSI survey via bundesregierung.de); not used.
- **Fayyad 2007 (3,1 Prozent adult ADHD in Germany, 18–44):** only seen in secondary sources; mentioned as context in `adhd-adults-prevalence`, not cited in posts.

## Checked but not used

- Share of household consumption spending on food (Destatis EVS 2023): the public page gives no total share in a form we could cite as one number – left out until Destatis publishes it.
- Impulse buying rates from surveys: no primary source with a robust number found; the Verbraucherzentrale's shopping-list advice is used instead, without a number.
- BBK web pages for stockpiling were not reachable (404/blocked); the BBK guide PDF is the source.
