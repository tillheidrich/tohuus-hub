# Wachstum und Positionierung (15. Oktober 2026)

Kurz gesagt: ToHuus ist der smarte Assistent, der nicht den Anspruch hat, das Tool für alles zu sein (Till, 15.10.2026). Wir gewinnen nicht mit mehr Funktionen als die anderen. Wir gewinnen, weil Liste, Kochen, Aufgaben und Geld aus denselben Bons zusammenhängen, weil unsichtbare Arbeit sichtbar wird, ohne dass jemand Punkte zählt, und weil ToHuus ruhig ist. Wachsen soll ToHuus über Sachen, die Leute ohnehin teilen: die Liste, eine Einladung in den Haushalt, eine Karte mit einer Zahl, die stimmt.

Quellen in diesem Repo:
- `docs/research/2026-10-15-apple-ai-viral.md` (Apple Intelligence, Fallstudien zum Teilen, Formate)
- `docs/research/2026-10-15-screen-time-wellbeing.md` (Bildschirmzeit, Mitteilungen, UWG/HWG)
- `docs/research/2026-10-15-care-single-parents.md` (Pflege, Alleinerziehende, Mental Load)
- `docs/research/2026-10-10-wettbewerb-und-nutzerbedarf.md` (Wettbewerb)
- `docs/who-does-what.md`, `docs/mind.md`, `docs/away.md`, `docs/carefor.md`, `docs/checkin.md`, `docs/sharing.md` (was ToHuus wirklich kann)

Umgesetzt am 15.10.2026:
- Website-Abschnitt „Was anders ist“ / „What is different“ (`site/src/build.mjs`, Anker `#was-anders-ist` / `#what-is-different`)
- Seite „Zum Teilen“: `site/de/teilen.html`, englisch `site/share.html`; dazu passende Karten am Ende von vier Ratgeber-Beiträgen
- Karten-Generator `scripts/share-cards.mjs` → `site/assets/share/` (18 Karten, je 4:5 und 9:16)

---

## 1. Positionierung gegenüber dem Wettbewerb

Regel: nichts schlechtreden, nur sagen, wofür die anderen gut sind und was ToHuus anders macht. Jede Zeile muss sich mit einer Quelle oder einem Dokument im Repo belegen lassen. Die Spalte „Wofür sie gut sind“ beschreibt, was die Anbieter selbst oder Tests über sie sagen.

| App | Wofür sie gut ist | Was ToHuus anders macht | Beleg |
|---|---|---|---|
| **Bring!** | Geteilte Einkaufsliste, im Laden mit einer Hand bedienbar; Maßstab für Bedienbarkeit. Nach eigener Angabe über 20 Mio. Nutzer (nicht geprüft) | Auch eine geteilte Liste, im Laden nach Gängen sortiert. Dazu lernt ToHuus aus Bons und Häkchen, wann etwas wieder fällig ist, und verbindet Kochen und Geld damit | [getbring.com/en/about-us](https://www.getbring.com/en/about-us); Wettbewerbsrecherche 10.10.2026, Abschnitt 1 und Fazit 2 |
| **Cozi** | Familienkalender, Listen, Rezepte: „Was ist heute los?“ für alle | Kein eigener Kalender und kein Chat. Termine gehen in den Kalender, den der Haushalt schon nutzt (CalDAV, Abo-Link) | [JustUseApp: Cozi](https://justuseapp.com/en/app/407108860/cozi-family-organizer/reviews); `CLAUDE.md`; `docs/calendar-sync.md` |
| **FamilyWall** | Kalender, Listen, Essensplan, Ortung, Chat, großzügiger Gratis-Tarif | Keine Ortung, kein Chat. ToHuus bleibt bei Einkauf, Kochen, Geld und Aufgaben | Wettbewerbsrecherche 10.10.2026 (Quelle dort als schwach bewertet, nur Funktionsliste nutzen) |
| **OurHome** | Aufgaben, Punkte, Belohnungen, rotierende Aufgaben, Kinder-Motivation | Abwechseln ja, Punkte, Ranglisten und Serien nein. ToHuus lernt, wer was meistens macht („meistens Sam“). Sterne nur, wenn ein Admin sie einschaltet | [JustUseApp: OurHome](https://justuseapp.com/en/app/879717020/ourhome-chores-and-rewards/reviews); `docs/who-does-what.md`; `docs/points.md` |
| **Fair Play / FairShare** | Machen unsichtbare Arbeit sichtbar: Bereiche („Karten“) werden bewusst verteilt; „Wild Cards“ für Ausnahmezeiten | Bereiche werden aus dem Alltag gelernt statt von Hand verteilt. „Im Kopf“ und „Nebenbei erledigt“ zeigen das Kleine, das auf keiner Karte steht. Abwesenheiten (Dienstreise, Krankenhaus) ändern, wer zu Hause was übernimmt und was warten darf | `docs/who-does-what.md`, `docs/mind.md`, `docs/away.md` |
| **Todoist** | Geteilte Projekte, Erinnerungen für andere. Todoist schreibt selbst, dass oft nur eine Person im Paar begeistert ist | Nur Haushalt, dafür mit Abwechseln, Vorschlägen und „Wer macht was“. Aufgaben erscheinen auf Wunsch in Apple Erinnerungen | [Todoist-Blog](https://www.todoist.com/inspiration/how-to-trick-your-partner-into-using-todoist); `docs/tasks.md` |
| **Apple Erinnerungen / Notizen** | Schnell etwas aufschreiben, im System eingebaut | ToHuus ersetzt sie nicht. Aufgaben gehen auf Wunsch in Erinnerungen, Listen als Text an Notizen, Mail oder Nachrichten | `docs/sharing.md`, `docs/calendar-sync.md` |
| **Pflege-Apps (Nui/DAK Pflege-App, Caring Village, CaringBridge)** | Pflege-Bürokratie, Pflegeplanung, Updates an die Familie | ToHuus wird keine Pflege-App. Es gibt Raum für den zweiten Haushalt (Besuche, Arzttermine, Besorgungen als Aufgaben, privat als Standard) und verweist auf offizielle Hilfe, ohne zu beraten | Pflege-Recherche, Abschnitt 4; `docs/carefor.md` |

**Was nur ToHuus zusammenbringt (Stand der Recherche, nicht als „einzige App“ bewerben):**
1. Liste, Kochen, Aufgaben und Geld an einem Ort, gespeist aus Bons und Häkchen statt Tipparbeit.
2. Lernt, wer was macht, ohne Punkte, Ranglisten und Streaks.
3. „Im Kopf“ und „Nebenbei erledigt“ machen die kleine Denkarbeit sichtbar; „Danke“ statt Zähler.
4. Abwesenheiten mit Wofür (Urlaub, Arbeit, Feier, Krankenhaus) ändern, was zu Hause passiert.
5. Raum für alle, die sich um jemanden kümmern oder allein erziehen, ohne Diagnose und ohne Vergleich.
6. Ruhig gebaut: kein Feed, keine Serien, Mitteilungen auf Wunsch gebündelt, „Für heute ist alles Wichtige erledigt“.
7. Datenschutz: Server in Deutschland, KI nur mit Zustimmung und über Mistral, selbst gehostet mit eigener KI oder ohne. Gesundheitsangaben nur mit ausdrücklicher Einwilligung an eine KI, Angaben zu umsorgten Personen nie.
8. Arbeitet mit Kalender, Erinnerungen, Notizen und Mail, statt sie zu ersetzen.

Warum „nicht als einzige App bewerben“: Ein Alleinstellungsanspruch ist eine Tatsachenbehauptung nach § 5 UWG und müsste für den ganzen Markt belegt sein. Unsere Recherche deckt nur die angesehenen Apps ab. Auf der Website steht deshalb „Stand Oktober 2026, nach den Beschreibungen der Anbieter und unserer eigenen Recherche“, und die Namen sind als fremde Marken gekennzeichnet.

---

## 2. Virale Schleifen, in dieser Reihenfolge

Grundregeln für alle (aus der Apple-AI-Viral-Recherche, B4, und `docs/sharing.md`):
- Geteilt wird nur, wenn die Person selbst auf „Teilen“ tippt. Nichts wird von allein gepostet.
- Auf Karten und Links stehen keine Namen, kein Haushaltsname, keine Beträge, keine privaten Einträge, nichts aus „Für wen ich da bin“, keine Gesundheitsdaten, keine Hausinfo-Codes, keine Abwesenheitsgründe.
- Der Hinweis „geteilt aus ToHuus“ ist eine Zeile und lässt sich für den Haushalt abschalten.
- UTM-Parameter nur kleingeschrieben und nie mit Nutzer- oder Haushalts-ID. Gezählt werden nur Summen.
- Keine Streaks, keine Ranglisten, kein Vergleich zwischen Menschen.

| # | Schleife | Warum sie trägt | Schutz | Stand |
|---|---|---|---|---|
| 1 | **Einladung in den Haushalt** (Bring!-Prinzip) | Eine Liste funktioniert erst, wenn die anderen drin sind. Höchste Wirkung | Einmal im Onboarding fragen, danach nur über den Teilen-Knopf. Gäste sehen nur, was freigegeben ist | gibt es |
| 2 | **Befristeter Listen-Link für Leute ohne App** („Kannst du das mitbringen?“) | Großeltern, Babysitter, Nachbarn sehen ToHuus im Einsatz | Ablauf nach 48 h, keine privaten Zeilen, widerrufbar | als Nächstes |
| 3 | **Fußzeile unter geteilten Listen** (Hotmail-Prinzip, Tally: rund 10 % der Neuanmeldungen über das Badge) | Jede geteilte Liste erreicht genau die Zielgruppe | Eine Zeile, abschaltbar (`PUT /api/share/settings`) | seit 15.10.2026 |
| 4 | **Rezeptkarte** (4:5 / 9:16 plus öffentliche Rezeptseite) | Rezepte werden ohnehin geteilt | Nur eigene Rezepte oder mit Quellenangabe | geplant |
| 5 | **Hausinfo-Blatt mit „Erstellt mit ToHuus“** | Erreicht Familien und Gastgeber | Codes nie auf geteilten Bildern; Zeile abschaltbar | geplant |
| 6 | **Jahresrückblick „Unser Jahr im Haushalt“** (Wrapped-Prinzip, Dezember) | Identität und Stolz ohne Vergleich; Spotify Wrapped 2025: über 500 Mio. Shares | Karten auf dem Gerät gebaut, pro Karte freiwillig, keine Beträge, keine Personenvergleiche. Statt Prozentrang ein „Haushaltstyp“ | nur wenn der Server es freigibt |
| 7 | **Wochen- und Monatsrückblick als Karte** | Stolz auf das Geschaffte, auch „3 Mal für jemanden da gewesen“ ohne Namen | Persönliche Karten nur für die Person selbst | seit 15.10.2026 (Karten-Spezifikation in `docs/sharing.md`) |
| 8 | **„Bring mir was“ für Gäste** | Besuch wird zum Kontakt | Link pro Haushalt, Rate-Limit, abschaltbar | gibt es |
| 9 | **Umzugshilfe von Bring! oder Notizen** | Wechsler laden danach den Haushalt ein (startet Schleife 1) | Nur Einfügen oder Datei, nichts abgreifen | Listen-Import gibt es |
| 10 | **Fertige Kurzbefehle und Siri-Sätze in der Hilfe** | Geringe Reichweite, aber Mundpropaganda unter Power-Usern | Je iOS-Version prüfen | geplant |
| 11 | **Faktenkarten auf Website und im Ratgeber** | Nützlich für die, die sie sehen; gute Gründe zum Teilen in Pflege- und Eltern-Gruppen | Nur Zahlen mit Quelle, keine Wirkversprechen | seit 15.10.2026 |
| 12 | **Empfehlung ohne Geld** („einen anderen Haushalt einladen“, beide einen Monat Plus) | Klassisch, wirkt | Limit pro Konto, nur Cloud | später |

Gemessen wird nur: Einladungen gesendet und angenommen, geöffnete Teilen-Links, UTM-Summen auf der Website. Keine Auswertung pro Person.

---

## 3. Das Karten-System

Spezifikation: `docs/sharing.md`, Teil 2. Umsetzung für die Website: `scripts/share-cards.mjs`.

- **Formate:** 4:5 (1080 × 1350, Feed, 72 px Rand) und 9:16 (1080 × 1920, Story und WhatsApp Status, kein Text in den oberen 260 px und den unteren 360 px).
- **Aussehen:** Fakten auf Papier `#f7f5ef` mit Tinte und grüner Zahl; Markenkarten grün `#176b50` mit `#fffdf9`. Bildmarke und „ToHuus“ oben links, Augenbraue, eine große Zahl oder ein Wort in Hedvig Letters Serif, Titel in Familjen Grotesk, Bogen der Haustür mit 8 % unten rechts. Unten „Quelle: …, Jahr“ bei Fakten, sonst „Gemacht mit ToHuus · tohuus.heidrich-digital.de“. Keine Emojis, keine Verläufe, keine Fotos.
- **Kontrast (gemessen):** Fließtext auf Papier 10:1, Quelle 6:1. Auf Grün: Titel 6,4:1, Text 85 % 5,1:1 (4,4:1 über dem Bogen), Fußzeile 70 % 4,0:1 (3,5:1 über dem Bogen). Alles ab 28 px, also große Schrift, Grenze 3:1.
- **Prüfung im Skript:** Zahl zu breit → Schrift wird kleiner; Titel über drei Zeilen, Inhalt zu hoch oder Text außerhalb der sicheren Zone → Fehler, Exit-Code 1.
- **Aufruf:**
  ```bash
  NODE_PATH=<scratch>/pw/node_modules PW_CHROMIUM=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell \
    node scripts/share-cards.mjs            # alle; --only slug1,slug2 für einzelne
  node site/src/build.mjs                   # Seite „Zum Teilen“ neu bauen
  ```
- **Index:** `site/assets/share/index.json` (slug, kind, Text, Quelle, Link, Dateien). Der Website-Build bricht ab, wenn eine Datei fehlt.

### Die 18 Karten

| Slug | Zahl / Wort | Aussage | Quelle |
|---|---|---|---|
| `pflege-zu-hause` | 86 % | der Pflegebedürftigen werden zu Hause versorgt (4,9 von 5,7 Mio.) | Destatis, Pflegestatistik 2023 (PM 18.12.2024) |
| `pflege-zweiter-haushalt` | 64 % | der Pflege durch Angehörige passiert außerhalb des eigenen Haushalts | DIW Wochenbericht 37/2025 |
| `pflege-wertschaetzung` | 41 % | der Angehörigen, die aus der Ferne helfen, sagen: Andere verkennen, wie viel sie tun | ZQP, Pflege auf Distanz, 2022 (Primärquelle; die frühere 52-%-Zahl aus 2018 ließ sich nur über die Ärzte Zeitung belegen und wurde ersetzt) |
| `entlastungsbetrag` | 80 % | der befragten Pflegenden rufen den Entlastungsbetrag nicht ab; Hinweis aufs Pflegetelefon | VdK-Pflegestudie 2022, nicht repräsentativ (steht auf der Karte) |
| `young-carers` | 6 % | der 10- bis 19-Jährigen pflegen mit (rund 480.000) | Uni Witten/Herdecke, Metzing u. a. |
| `alleinerziehende` | 1,62 Mio. | Alleinerziehende mit minderjährigen Kindern, 84 % Mütter | Destatis, PM 23.07.2026 |
| `alleinerziehende-vollzeit` | 38,6 % | der alleinerziehenden Mütter arbeiten Vollzeit (Paarfamilien 30,7 %) | Destatis, PM 23.07.2026 |
| `mental-load-termine` | 9 von 10 | Müttern in Partnerschaft fühlten sich allein zuständig für Familientermine | Ciciolla & Luthar 2019 (393 US-Mütter) |
| `denkarbeit` | 4 | Teile der Denkarbeit: vorausdenken, Möglichkeiten finden, entscheiden, nachhalten | Daminger 2019 |
| `care-gap` | 43,8 % | mehr unbezahlte Arbeit leisten Frauen als Männer | Destatis ZVE 2022, revidiert 2025 |
| `plan-im-kopf` | Plan | Mit konkretem Plan drängt sich eine offene Aufgabe weniger in den Kopf | Masicampo & Baumeister 2011 (Laborstudien, steht auf der Karte) |
| `danke` | Danke | Paare mit mehr Wertschätzung waren nach neun Monaten eher noch zusammen | Gordon u. a. 2012 |
| `mitteilungen-buendeln` | 3× | gebündelte Mitteilungen: mehr Aufmerksamkeit, weniger Stress berichtet; ganz ohne mehr Sorge, etwas zu verpassen | Fitz u. a. 2019 |
| `serien` | Serie | Reißt eine Serie, machen viele danach weniger weiter | Silverman & Barasch 2023 |
| `brand-nicht-alles` | (Zitat) | „ToHuus ist der smarte Assistent, der nicht den Anspruch hat, das Tool für alles zu sein.“ | Markenkarte |
| `brand-handy-weg` | Fertig. | Schnell erledigt, dann Handy weg. | Markenkarte (Produktfakt: kein Feed, „Fertig für heute“) |
| `brand-liegen-lassen` | Pause. | Liegen lassen ist erlaubt. ToHuus wartet. | Markenkarte (Produktfakt: keine Serien, keine Ranglisten) |
| `brand-gesehen-werden` | Gesehen. | Im Kopf & nebenbei erledigt. | Markenkarte (`docs/mind.md`) |

**Bewusst weggelassen:**
- „Die Hälfte der Hauptpflegepersonen kümmert sich mehr als 12 Stunden täglich“ (BARMER 2018): belegt, aber alt und schwer ohne Kontext lesbar; Kandidat für eine spätere Karte.
- Frauenanteil 64 % / 72 % bei Pflegenden: doppelte Zahl neben der 64-%-Karte, zwei Quellen mit verschiedenen Werten.
- Sandwich-Generation: Für Deutschland gibt es laut Recherche keine gesicherte Zahl.
- Stunden pro Woche unbezahlter Arbeit speziell für Alleinerziehende: nicht gemessen, nur gefolgert.
- „One sec“ −37 % Öffnungen, Kushlev & Dunn (E-Mail 3× täglich): belegt, aber zu nah an einem Wirkversprechen für ToHuus.
- Scullin „9 Minuten schneller einschlafen“: nur Sekundärquelle, Schlaf wäre ein Gesundheitsclaim.
- Zeigarnik-Effekt: nicht repliziert.
- Alles aus der Bildschirmzeit-Debatte (Haidt, Orben, Detox): umstritten.

---

## 4. Ehrliche Werbesätze und was sie trägt

| Satz | Was ihn trägt | Risiko |
|---|---|---|
| „ToHuus ist der smarte Assistent, der nicht den Anspruch hat, das Tool für alles zu sein.“ | Positionierung, kein Ergebnisversprechen | niedrig |
| „Damit nicht einer alles im Kopf haben muss.“ | Hero-Satz; Daminger 2019, Ciciolla & Luthar 2019 belegen das Problem, nicht die Lösung | niedrig, keine Fairness-Garantie daraus machen |
| „Schnell erledigt, dann Handy weg.“ | Produktfakt: Siri, Widget, Sprache, kein Feed, „Fertig für heute“ | niedrig, solange der Weg wirklich kurz ist |
| „Kein Feed. Keine Serien. Kein Grund, länger zu bleiben.“ | Produktfakt (`docs/checkin.md`, `docs/points.md`) | niedrig |
| „Einmal am Tag ein kurzer Überblick statt ständig Pling.“ | Produktfakt (gebündelte Erinnerungen, `docs/focus.md`, Tageszusammenfassung); Hintergrund Fitz 2019 | niedrig, aber kein „weniger Stress“ daraus machen |
| „Liegen lassen ist erlaubt. ToHuus wartet.“ | Keine Serien, keine Strafen; Silverman & Barasch 2023, Lally 2010 | niedrig |
| „Gesehen werden: Im Kopf & nebenbei erledigt.“ | `docs/mind.md` („Ich denk mit“, „Danke“, keine Zähler); Gordon 2012, Algoe 2010/2013 | niedrig, keine Beziehungswirkung versprechen |
| „Was fehlt, weiß jetzt nicht mehr nur eine Person.“ | Gemeinsame Liste; Daminger 2019 | niedrig |
| „Aufgeschrieben, wer's macht, und der Kopf hat Pause.“ | Masicampo & Baumeister 2011 (Labor) | mittel: Alltagssprache lassen, nicht zu „gegen Stress“ steigern |
| „Wir zählen nicht, wie lange du in der App bist.“ | Nur verwenden, wenn wirklich keine Sitzungsdauer-Analytics laufen | mittel: vorher technisch prüfen |
| „Für alle, die sich um jemanden kümmern.“ | `docs/carefor.md`; 86 % werden zu Hause versorgt, 64 % der Pflege außerhalb des eigenen Haushalts | niedrig; nie „Pflege-App“ oder Beratung versprechen |

**Nicht verwenden (UWG § 5, HWG §§ 1 und 3, Strengeprinzip):**
- „ToHuus reduziert Stress“, „gegen Stress“, „besser schlafen“, „mehr Konzentration“, „gegen Handysucht“, „Digital Detox“: Gesundheits- bzw. Wirkversprechen, keine Studie mit ToHuus.
- „Weniger Bildschirmzeit, wissenschaftlich belegt“, „spart dir 30 Minuten am Tag“: Ergebnisaussage ohne eigenen Beleg; eine Fußnote heilt das nicht (OLG Nürnberg 3 U 747/22).
- „Smartphones machen unglücklich, ToHuus nicht“: umstrittene Fachmeinung, Beweislast läge bei uns.
- „Endlich gerecht verteilt“, „nie mehr Streit“: Ergebnisversprechen über Beziehungen.
- „Die einzige App, die …“: Alleinstellung ohne Marktbeleg.
- „Dank Zeigarnik-Effekt …“: nicht repliziert.
- Im Kochen-Bereich keine Gesundheitsangaben zu Lebensmitteln („gesund“, „stärkt das Immunsystem“).
- Studien zeigen, was dort gemessen wurde (E-Mail-Regeln, Mitteilungs-Bündelung, Paar-Tagebücher). Auf Faktenkarten beschreiben wir den Befund, nie eine Wirkung von ToHuus.

Vor dem Einsatz in bezahlter Werbung: Sätze kurz anwaltlich prüfen lassen (UWG/HWG).

---

## 5. „Kann man bei Apple Intelligence ChatGPT nutzen?“

**Ja.**
- **Seit iOS 18.2 (Dezember 2024)** ist ChatGPT eine freiwillige Erweiterung unter Einstellungen › Apple Intelligence & Siri. Sie lässt sich aus Siri, den Schreibwerkzeugen, Visual Intelligence, Image Playground und Kurzbefehlen nutzen. Ein OpenAI-Konto ist nicht nötig; ohne Konto gehen nur Anfrage und Anhänge an OpenAI, ohne Apple-Kontodaten.
- **In Deutschland/der EU und auf Deutsch seit iOS 18.4 (31. März 2025).** Laut heise gehörte „ChatGPT über Siri“ zum EU-Start; das steht in Berichten, nicht im Text der Apple-Pressemitteilung.
- **Seit iOS 27 (14. September 2026)** bauen Apples eigene Modelle der dritten Generation auf Google-Gemini-Technik auf. Die neue „Siri AI“ gibt es auf iPhone in der EU zum Start nicht und vorerst nur auf Englisch; die älteren Apple-Intelligence-Funktionen laufen auf Deutsch weiter. Dass man in iOS 27 Claude oder Gemini statt ChatGPT als Erweiterung wählen kann, ist nur berichtet (Bloomberg/MacRumors), nicht von Apple bestätigt.
- **Für Entwickler:** Das Foundation-Models-Framework (seit iOS 26) gibt Apps das Modell auf dem Gerät: offline, ohne Kosten, mit geführter Ausgabe und Tool-Calling, aber kleinem Kontext (etwa 4K Tokens). Seit iOS 27 kommen Modelle auf Private Cloud Compute (nur für kleine Entwickler unter 2 Mio. Erstdownloads, EU-Verfügbarkeit offen) und ein Protokoll für andere Anbieter (Claude, Gemini, eigene Adapter) dazu.

**Empfehlung für ToHuus:**
1. Auf dem Gerät ausbauen (iOS 26+), wie `OnDeviceAI` es schon für Bon-Texte tut: kurze Zusammenfassung „Was steht an?“, private Geld-Zusammenfassungen, die nie den Server sehen, Listen aus Diktat strukturieren. Immer mit Rückfall, immer hinter dem KI-Schalter und der Kindersperre.
2. App Intents erweitern („Was fehlt noch?“, „Neue Aufgabe“, „Wer ist dran?“). Das wirkt heute mit Siri auf Deutsch und ist später der Weg zu Siri AI. Private Einträge nie als Entität an Siri geben.
3. Schreibwerkzeuge zulassen, aber in sensiblen Feldern abschalten (Hausinfo-Codes, WLAN-Passwort, persönliche Geld-Notizen, private Wünsche), weil dort sonst Text an ChatGPT gehen kann, wenn die Person das gewählt hat.
4. PCC und das Anbieter-Protokoll beobachten, aber keine Kernfunktion darauf bauen. Die Server-KI über `server/lib/ai.ts` (Mistral) bleibt der Kern für Web, Selbst-Hosting und später Android.
5. Fürs Marketing: „KI“ ist nicht das Versprechen. Ehrlich sagen lässt sich: „Auf neueren iPhones kann Apple Intelligence auf dem Gerät helfen, auf Wunsch, und dafür verlässt nichts das Gerät.“

---

## 6. Bildschirmzeit: was wir ehrlich versprechen können

**Was die Forschung trägt:** Dass „Bildschirmzeit an sich“ unglücklich macht, ist nicht gesichert (Orben & Przybylski 2019; Odgers 2024). Besser belegt ist das engere Thema Unterbrechungen: Gebündelte, planbare Mitteilungen gingen in Experimenten mit mehr Aufmerksamkeit und weniger Stress einher (Fitz u. a. 2019; Kushlev & Dunn 2015). Gar keine Mitteilungen waren aber nicht besser, sondern brachten mehr Sorge, etwas zu verpassen.

**Was wir versprechen (Gestaltung, nachprüfbar):**
- Kein Feed, kein Autoplay, keine „Entdecke mehr“-Bereiche. Jeder Bildschirm hat ein Ende.
- Keine Streaks, keine Ranglisten, keine Strafen für Pausen.
- „Für heute ist alles Wichtige erledigt. Leg das Handy ruhig weg.“ als sichtbarer Endzustand.
- Erinnerungen auf Wunsch gebündelt zu einer selbst gewählten Uhrzeit; keine Werbe-Pushs.
- Viel geht ohne App öffnen: Siri, Widget, Sprache, Apple Watch.
- Wir sammeln keine Bildschirmzeit-Daten über andere Apps und sind kein Blocker.

**Was wir nicht versprechen:** weniger Stress, weniger Bildschirmzeit in Minuten, besseren Schlaf, mehr Konzentration, gesündere Beziehungen. Dafür bräuchte es eine eigene, vorher dokumentierte Messung (Opt-in, geloggte Nutzung statt Selbstauskunft, randomisierter Vergleich gebündelt vs. einzeln). Erst danach dürften wir über das Messbare sprechen („im Schnitt X Sekunden pro Eintrag“), nie über Gesundheit.

**Satz für Website und App Store:** „Gebaut, damit du schnell wieder weg bist.“
