import { help } from '../config.mjs';

// Ein Ort für den Haushalt (18 Oct 2026, Build 15): Haushaltswissen, Tonne am Vorabend, Aufgaben fair verteilen,
// 14 Tage testen, selbst hosten. Facts about ToHuus from docs/knowledge.md, docs/calendar-sync.md, docs/tasks.md,
// docs/pricing.md and .env.example. The one outside source (Masicampo & Baumeister 2011) is already in docs/facts.md.

const APP = 'https://apps.apple.com/de/app/tohuus/id6822059656';
const tail = `<p>Die iPhone-App findest du <a href="${APP}">im App Store</a>, mehr zu ToHuus auf der <a href="../de/">Startseite</a>.</p>`;

export default [
  {
    slug: 'haushaltswissen-an-einem-ort', area: 'hausinfo', status: 'published', date: '2026-10-18',
    title: 'Schuhgrößen, Rollo-Maße, Zählerstände: Haushaltswissen an einem Ort',
    desc: 'Schuhgröße, Rollo-Maß, Zählerstand: Was ihr übers Zuhause wisst, liegt oft auf Zetteln oder in einem Kopf. So sammelt ihr es an einem Ort, ohne eine Tabelle zu pflegen.',
    answer: 'Haushaltswissen sind die kleinen Fakten, die man selten braucht und dann sofort: Schuhgrößen, Maße, Zählerstände, Filtertypen. Am besten liegt jede Angabe an einem festen Ort, gehört zu einer Person, einem Raum oder einem Ding und lässt sich ändern, ohne dass der alte Wert verloren geht. In ToHuus ist das eine Karte, die ihr mit einem Satz anlegt.',
    sections: [
      ['Was mit Haushaltswissen gemeint ist',
        '<p>Im Laden stehen und nicht wissen, ob das Kind jetzt 30 oder 31 trägt. Ein neues Rollo bestellen wollen und das Maß nicht finden. Der Netzbetreiber fragt nach dem Zählerstand, und der Zettel vom letzten Jahr ist weg. Das sind keine Aufgaben und keine Termine, sondern Wissen über euer Zuhause, das irgendwer irgendwann mal aufgeschrieben hat.</p>'
        + '<p>Meistens liegt es an Orten, die nicht dafür gemacht sind: in einem alten Chat, auf der Rückseite eines Briefumschlags, in einer Notiz auf genau einem Handy oder im Kopf von genau einer Person. Wer gerade fragt, muss diese Person fragen.</p>'],
      ['Was typischerweise dazugehört',
        '<ul><li><b>Personen</b>: Schuh-, Jacken- und Hemdgrößen, Lieblingskuchen, was jemand nicht verträgt</li><li><b>Räume</b>: Maße von Rollos, Fenstern und Vorhängen, welche Glühbirne in welche Lampe gehört</li><li><b>Dinge</b>: Zählernummern und Zählerstände, Staubsaugerbeutel, Filter für Dunstabzug oder Wasserkanne, wann die Heizung zuletzt gewartet wurde</li></ul>'
        + '<p>Was nicht dazugehört: Passwörter, PIN und Türcodes. Die brauchen einen eigenen, geschützten Platz, in ToHuus sind das die Codes in der Hausinfo.</p>'],
      ['Warum ein fester Ort hilft',
        '<p>Aufschreiben allein reicht nicht, man muss es auch wiederfinden. Hilfreich ist eine einfache Form: <i>wer oder was</i>, <i>welche Eigenschaft</i>, <i>welcher Wert</i>. Also „Mika · Schuhgröße: 31“ statt „Mika hat glaube ich jetzt 31, oder?“. Dann findet man es über die Person, über den Raum oder über die Suche.</p>'
        + '<p>Dazu kommt ein Effekt, den man aus der Forschung kennt. In Studien von <a href="https://doi.org/10.1037/a0024192">Masicampo und Baumeister (2011)</a> drängten sich offene Dinge weniger in die Gedanken, sobald es einen konkreten Plan dafür gab. Ein festes „steht in ToHuus“ ist kein Plan, aber es nimmt die Frage aus dem Kopf, wo das noch mal war.</p>'],
      ['Ein Beispiel: Familie Berg',
        '<p>Bei Familie Berg trägt Sam an einem Abend ein paar Sachen ein, jeweils mit einem Satz: „Mika Schuhgröße 31“, „Rollo Wohnzimmer 120 x 160“, „Zählernummer Strom 1ESY1160“. ToHuus macht daraus Karten und hängt sie an Mika, ans Wohnzimmer und an „Strom“. Im Frühjahr ist Mika gewachsen, Mira schreibt „Mika hat jetzt 32“. Die Karte zeigt 32, im Verlauf steht noch die 31 mit Datum.</p>'
        + '<p>Als Mira im Schuhladen steht, fragt sie den Assistenten: „Welche Schuhgröße hat Mika?“ Die Antwort steht da, ohne dass jemand zu Hause ans Telefon muss.</p>'],
      ['So hilft ToHuus dabei',
        '<p>In ToHuus heißt das Haushaltswissen „Was ToHuus sich merkt“. Jede Karte gehört zu einem Mitglied, einem Kinderprofil, einem Ort aus „Wo ist was?“, einem Produkt oder einer freien Bezeichnung wie „Rollo Erdgeschoss“. Ihr tippt einen Satz oder sagt ihn dem Assistenten, kurze Sätze wie „Rollo Wohnzimmer 120 x 160“ versteht ToHuus auch ganz ohne KI. Gibt es zur selben Sache schon eine Karte, bekommt sie den neuen Wert, und der alte bleibt im Verlauf.</p>'
        + '<ul><li>Jede Karte gilt für den ganzen Haushalt oder nur für dich. Private Karten sieht niemand sonst.</li><li>Gesundheitsangaben wie die Telefonnummer der Kinderärztin bleiben privat, bis du sie ausdrücklich teilst, und gehen ohne eure Zustimmung nie an eine KI.</li><li>Codes und Passwörter nimmt ToHuus hier nicht an und verweist auf die Hausinfo.</li><li>Feste Gäste sehen nur Karten, die ihr für Gäste freigebt.</li><li>Was schon in einer Notiz-App steht, bringt ihr mit: als Markdown (auch aus Obsidian oder Notion exportiert), TXT, CSV oder JSON. Exportieren geht jederzeit.</li></ul>'
        + tail],
    ],
    faq: [
      ['Was ist Haushaltswissen?', 'Die kleinen Fakten über euer Zuhause, die man selten braucht und dann sofort: Größen, Maße, Zählerstände, Filtertypen, Wartungstermine.'],
      ['Kann ich Passwörter im Haushaltswissen speichern?', 'Nein. ToHuus lehnt Codes und Passwörter dort ab. Dafür gibt es die Codes in der Hausinfo, die verdeckt bleiben und nie an eine KI gehen.'],
      ['Sehen alle im Haushalt meine Einträge?', 'Nur die, die du für den Haushalt anlegst. Einträge nur für dich sieht niemand sonst, Gesundheitsangaben sind von sich aus privat.'],
      ['Geht der alte Wert verloren, wenn ich etwas ändere?', 'Nein. Die Karte zeigt den neuen Wert, die früheren stehen mit Datum im Verlauf und lassen sich zurückholen.'],
      ['Brauche ich dafür KI?', 'Nein. Kurze Sätze wie „Mika Schuhgröße 31“ liest ToHuus ohne KI. Mit KI versteht der Assistent auch freiere Formulierungen.'],
    ],
    facts: [
      { value: '1 Satz', text: 'So viel braucht eine Karte im Haushaltswissen von ToHuus, etwa „Rollo Wohnzimmer 120 x 160“. Das geht auch ohne KI.', source: 'ToHuus', url: help('erste-schritte') },
    ],
    sources: [
      ['Masicampo, E. J., & Baumeister, R. F. (2011): Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals. JPSP 101(4)', 'https://doi.org/10.1037/a0024192'],
    ],
    help: ['erste-schritte', 'hausinfo', 'datenschutz-kurz'],
  },
  {
    slug: 'tonne-am-vorabend-erinnerung', area: 'aufgaben', status: 'published', date: '2026-10-18',
    title: 'Tonne am Vorabend: Erinnerungen, ohne den Kalender zu ersetzen',
    desc: 'Die Tonne muss am Abend vorher raus, nicht am Abfuhrtag. So erinnert ToHuus rechtzeitig daran, mit den Terminen aus eurem Kalender, ohne selbst ein Kalender zu werden.',
    answer: 'Damit die Tonne nicht vergessen wird, muss die Erinnerung am Abend vorher kommen, nicht am Abfuhrtag selbst. ToHuus liest auf Wunsch die Abfuhrtermine aus dem Kalender, den ihr schon habt, und macht daraus eine Aufgabe für den Vorabend. Auf Heute steht sie unter „Demnächst“, abends ganz oben.',
    sections: [
      ['Warum die Erinnerung am Abfuhrtag zu spät kommt',
        '<p>Die meisten Abfuhrkalender sagen, wann die Müllabfuhr kommt. Rausstellen müsst ihr die Tonne aber vorher, oft schon am Abend, weil das Fahrzeug früh am Morgen durch die Straße fährt. Ein Termin „Gelbe Tonne“ am Montag erinnert also genau dann, wenn es zu spät ist.</p>'
        + '<p>Dazu kommt, dass in vielen Haushalten nur eine Person den Abfuhrkalender im Kopf hat. Die anderen merken es, wenn die Nachbarn ihre Tonnen schon an der Straße stehen haben.</p>'],
      ['Den Kalender behalten, den ihr schon habt',
        '<p>Viele Haushalte haben die Abfuhrtermine längst in einem Kalender, oft im gemeinsamen Familienkalender oder als Abo der Gemeinde. Den muss niemand ersetzen. ToHuus liest auf dem iPhone die Kalender, die ihr auswählt, erkennt darin die Abfuhren und macht aus jeder Art eine Aufgabe, etwa „Gelbe Tonne raus“.</p>'
        + '<ul><li>Erkannt werden Restmüll, Bio, Papier, Gelbe Tonne oder Gelber Sack, Sperrmüll, Grünschnitt und der Weihnachtsbaum.</li><li>Das passiert ohne KI auf dem Handy. An den Server gehen nur die Art und der Tag, keine Titel und keine anderen Termine.</li><li>Neue Arten schlägt ToHuus nur vor. Ihr hakt an, was ihr übernehmen wollt.</li><li>Gelesen werden auf Wunsch bis zu 26 Wochen im Voraus, damit auch Sperrmüll und der Weihnachtsbaum dabei sind.</li></ul>'],
      ['Vorabend oder Morgen: was wann erscheint',
        '<p>Jede übernommene Abfuhr wird eine Aufgabe, die standardmäßig am Vorabend fällig ist. Wer die Tonne lieber morgens rausstellt, stellt das um. Ist sie erledigt, springt die Aufgabe auf die nächste Abfuhr aus dem Kalender, nicht einfach eine Woche weiter. So stimmen auch Feiertagsverschiebungen.</p>'
        + '<p>Auf Heute zeigt die Karte „Demnächst“, was morgen und in den nächsten Tagen kommt. Die Tonne steht dort mit „heute Abend rausstellen“ und dem Abfuhrtag. Ab 17 Uhr rückt sie ganz nach oben, in der Hausfarbe statt in Rot. Freitags und samstags schaut „Demnächst“ zwei Tage voraus, damit die Montagsabfuhr nicht überrascht.</p>'],
      ['Ohne Kalender geht es auch',
        '<p>Wer keinen Abfuhrkalender im Handy hat, legt die Tonne als normale Aufgabe an, zum Beispiel „Restmüll raus, alle zwei Wochen“. Aufgaben mit „Tonne“, „Restmüll“ und Ähnlichem im Namen erscheinen in „Demnächst“ ebenfalls am Abend vor dem Fälligkeitstag.</p>'
        + '<p>Andersherum tragen ToHuus-Aufgaben mit Datum sich auf Wunsch in euren Kalender ein, deine privaten Aufgaben in deinen eigenen. Eine eigene Kalenderansicht hat ToHuus bewusst nicht.</p>'],
      ['Ein Beispiel: Familie Berg',
        '<p>Bei Familie Berg stehen alle Abfuhren im gemeinsamen Kalender. Sam wählt ihn einmal unter Aufgaben › Euren Kalender lesen aus, ToHuus schlägt Restmüll, Papier und Gelbe Tonne vor, Sam hakt alle drei an. Die Gelbe Tonne bekommt Mira, die Papiertonne wechselt zwischen Sam und Mira.</p>'
        + '<p>Am Sonntagabend steht auf Heute ganz oben „Gelbe Tonne raus, heute Abend rausstellen, Abfuhr Montag“. Mira tippt auf Erledigt, und die Aufgabe springt auf die Abfuhr in zwei Wochen.</p>'],
      ['So hilft ToHuus dabei',
        '<p>Den Kalender liest ToHuus auf dem iPhone unter Aufgaben › Euren Kalender lesen, erst nach eurer Erlaubnis und nur die Kalender, die ihr auswählt. Abwechseln, „Mach ich“, Erinnerungen und Apple Erinnerungen funktionieren für die Tonne wie für jede andere Aufgabe. Wer will, lässt sich von einer KI aus anderen Kalendereinträgen Aufgaben vorschlagen. Dafür gibt es eine eigene Zustimmung pro Person, und gespeichert wird davon nichts.</p>'
        + tail],
    ],
    faq: [
      ['Ersetzt ToHuus unseren Familienkalender?', 'Nein. ToHuus liest nur die Abfuhrtermine aus eurem Kalender und trägt auf Wunsch Aufgaben dort ein. Eure übrigen Termine bleiben im Kalender und auf dem Handy.'],
      ['Wann erinnert ToHuus an die Tonne?', 'Standardmäßig am Vorabend der Abfuhr. Unter „Demnächst“ auf Heute steht sie mit „heute Abend rausstellen“, ab 17 Uhr ganz oben.'],
      ['Welche Daten gehen dafür an den Server?', 'Nur die Art der Abfuhr und der Tag. Titel und andere Termine bleiben auf dem iPhone.'],
      ['Geht das auch ohne Kalender?', 'Ja. Legt die Tonne als Aufgabe an, etwa „Restmüll raus, alle zwei Wochen“. Sie erscheint dann ebenfalls am Vorabend unter „Demnächst“.'],
    ],
    help: ['aufgaben', 'erinnerungen-spiegeln'],
  },
  {
    slug: 'aufgaben-im-haushalt-verteilen', area: 'aufgaben', status: 'published', date: '2026-10-18',
    title: 'Aufgaben im Haushalt verteilen: wer macht es, wer denkt dran?',
    desc: 'Aufgaben im Haushalt fair verteilen heißt, das Machen und das Drandenken zu klären. Mit Abwechseln, klaren Zusagen und ohne Punkte. So klappt es im Alltag.',
    answer: 'Fair verteilt sind Aufgaben, wenn zu jeder klar ist, wer sie macht und wer sie im Blick hat, und wenn das für alle stimmig ist. Abwechseln hilft bei Aufgaben, die keiner gern macht, ganze Bereiche helfen beim Drandenken. Punkte und Ranglisten braucht es dafür nicht.',
    sections: [
      ['Zwei Fragen statt einer',
        '<p>„Wer bringt den Müll raus?“ klingt nach einer Frage, sind aber zwei. Die eine ist, wer die Tonne an die Straße stellt. Die andere ist, wer weiß, dass morgen Abfuhr ist. Die zweite Arbeit sieht man nicht, sie passiert im Kopf, und sie bleibt oft an einer Person hängen. Mehr dazu steht im Beitrag <a href="mental-load-haushalt-fair-verteilen.html">Mental Load im Haushalt</a>.</p>'
        + '<p>Hilfreich ist deshalb, beides getrennt festzulegen. Wer eine Aufgabe macht, kann wechseln. Wer sie im Blick hat, sollte für eine Weile dieselbe Person sein.</p>'],
      ['Abwechseln, ganze Bereiche oder spontan',
        '<ul><li><b>Abwechseln</b> passt für Aufgaben, die keiner gern macht und die regelmäßig kommen: Bad, Müll, Spülmaschine. Nach „Erledigt“ ist die nächste Person dran.</li><li><b>Ganze Bereiche</b> passen für alles, wo Drandenken die eigentliche Arbeit ist: Kinderkleidung, Geschenke, Arzttermine. Wer den Bereich hat, merkt auch, wann etwas fällig ist.</li><li><b>Wer gerade Zeit hat</b> passt für Kleinkram ohne festen Rhythmus, etwa Altglas wegbringen.</li></ul>'],
      ['Zusagen statt Nachfragen',
        '<p>Viel Ärger entsteht aus Unklarheit: Macht das jemand, oder denkt jeder, die anderen machen es? Eine kurze, sichtbare Zusage hilft. „Mach ich morgen“ heißt für alle anderen, dass sie nicht mehr dran denken müssen. Und wenn es nicht geklappt hat, reicht ein freundlicher Hinweis statt einer Erinnerungsflut.</p>'],
      ['Was beim Verteilen nicht hilft',
        '<p>Punkte für jede Aufgabe klingen fair, führen aber schnell zur nächsten Diskussion, was wie viel wert ist. Ranglisten machen aus dem Haushalt einen Wettbewerb, in dem meist die Person verliert, die ohnehin am meisten im Kopf hat. Serien, die reißen, wenn man mal eine Woche krank ist, demotivieren eher. Deshalb verzichtet ToHuus darauf. Sterne gibt es nur, wenn ihr sie selbst einschaltet.</p>'],
      ['Ein Beispiel: Familie Berg',
        '<p>Bei Familie Berg wechseln Sam und Mira sich beim Bad ab. Die Tonnen hat Mira im Blick, rausstellen darf auch Sam. Mika räumt alle zwei Tage die Spülmaschine aus, in drei kleinen Schritten. Als der Schornsteinfeger sich für Dienstag um halb neun ankündigt, tippt Sam auf „Mach ich“ und wählt den Tag. Mira sieht auf Heute unter „Demnächst“, dass Sam das übernimmt, und muss nicht mehr dran denken.</p>'
        + '<p>Am Abend hakt Mika aus Versehen die falsche Aufgabe ab. Ein Tipp auf „Rückgängig“, und alles ist wieder wie vorher.</p>'],
      ['So hilft ToHuus dabei',
        '<p>Unter Aufgaben legt ihr fest, wer etwas macht: ein Mitglied, ein Kind, „Wer gerade Zeit hat“ oder abwechselnd. Unabhängig davon kann jemand sagen „Ich hab’s im Blick“. Mit „Mach ich“ sagt jemand eine Aufgabe für heute, morgen, das Wochenende oder einen Tag zu. Ist der Tag vorbei, steht dort freundlich, wer es vorhatte, ohne Rot und ohne Erinnerungsflut.</p>'
        + '<ul><li>Unter „Wer hat was im Blick“ stehen Namen alphabetisch, Anteile nur, wenn alle zustimmen.</li><li>Der Denkarbeit-Check mit 33 Karten macht sichtbar, wer woran denkt.</li><li>Private Aufgaben siehst nur du, auf Wunsch auch in deinem eigenen Kalender.</li><li>Erledigt aus Versehen? Ein Tipp nimmt es zurück.</li></ul>'
        + tail],
    ],
    faq: [
      ['Wie verteilt man Aufgaben im Haushalt fair?', 'Legt zu jeder Aufgabe fest, wer sie macht und wer sie im Blick hat. Abwechseln hilft bei unbeliebten Aufgaben, ganze Bereiche beim Drandenken.'],
      ['Brauchen wir Punkte oder Belohnungen?', 'Nein. Punkte führen schnell zu Streit, was wie viel wert ist. ToHuus hat keine Punkte, keine Ranglisten und keine Serien, Sterne nur, wenn ihr sie einschaltet.'],
      ['Was bedeutet „Mach ich“?', 'Eine Zusage mit Tag. Alle sehen, wer sich kümmert und wann. Ist der Tag vorbei, steht dort freundlich, wer es vorhatte.'],
      ['Können Kinder mitmachen?', 'Ja. Legt Kinderprofile an und tragt sie bei „Wer macht es“ ein. Große Aufgaben lassen sich in kleine Schritte teilen.'],
    ],
    help: ['aufgaben', 'kopf-voll'],
  },
  {
    slug: 'haushalts-app-14-tage-testen', area: 'zuhause', status: 'published', date: '2026-10-18',
    title: '14 Tage testen, dann entscheiden: So funktioniert das Abo von ToHuus',
    desc: 'Jeder neue Haushalt in der ToHuus Cloud nutzt 14 Tage lang alles, ohne Zahlungsdaten. Danach entscheidet ihr: Abo, selbst hosten oder nur lesen. Gelöscht wird nichts.',
    answer: 'Jeder neue Haushalt in der ToHuus Cloud startet mit 14 Tagen Plus, ohne Zahlungsdaten, und nichts verlängert sich von selbst. Danach geht es mit Haushalt für 3,99 € oder Plus für 5,99 € im Monat weiter. Ohne Abo bleibt alles sichtbar und exportierbar, nur Neues eintragen geht nicht mehr.',
    sections: [
      ['Warum 14 Tage',
        '<p>Ob eine Haushalts-App passt, merkt man nicht am ersten Abend. Man merkt es nach dem ersten Wocheneinkauf, wenn die Tonne zum ersten Mal pünktlich draußen stand oder wenn jemand im Laden die Schuhgröße nachschauen konnte. Zwei Wochen reichen, um das im Alltag zu sehen, mit allem, was ToHuus kann, auch dem Assistenten und dem Lesen von Bon-Fotos.</p>'],
      ['Was in den 14 Tagen drin ist',
        '<ul><li>Alles aus Plus: Liste, Aufgaben, Vorrat, Kochplaner, Geld, Haushaltswissen und der Assistent</li><li>Für den ganzen Haushalt, alle Mitglieder, Kinder und Gäste</li><li>Keine Zahlungsdaten, kein Abo, das sich von selbst verlängert</li><li>Drei Tage vor dem Ende und am letzten Tag kommt eine Erinnerung an die Admins des Haushalts</li></ul>'],
      ['Was danach passiert',
        '<p>Nach den 14 Tagen wählt ihr ein Abo, und alles läuft weiter. Wenn nicht, wird nichts gelöscht. Ihr seht weiter eure ganze Geschichte, könnt alles exportieren und den Haushalt oder euer Konto löschen. Nur Neues eintragen und ändern geht ohne Abo nicht mehr. Abhaken auf der Einkaufsliste klappt noch sieben Tage, damit niemand mitten im Laden festsitzt. Mit dem nächsten Abo ist alles wieder da.</p>'],
      ['Die Preise',
        '<p>Ein Abo gilt für den ganzen Haushalt, Mitglieder, Kinder und Gäste zahlen nie.</p>'
        + '<ul><li><b>Haushalt</b>: 3,99 € im Monat oder 34,99 € im Jahr. Gemeinsame Liste, Aufgaben, Wochenplan, Rezepte, die ganze Geschichte mit Preisen und Ausgaben, Bons mit KI lesen, der Assistent für ab und zu, 2 GB.</li><li><b>Plus</b>: 5,99 € im Monat oder 59,99 € im Jahr. Alles aus Haushalt, dazu der Assistent für jeden Tag, Wochenplan aus dem Vorrat, Monatsauswertung und Plus-Rezepte, 5 GB.</li><li><b>Selbst hosten</b>: kostenlos, mit allem, auf eurem eigenen Server.</li></ul>'
        + '<p>Bezahlt wird in der iPhone-App über Apple. Wenn das Geld gerade nicht reicht, gibt es auf der Startseite ein Formular, und ihr bekommt eine Lizenz, ohne Begründung.</p>'],
      ['Ein Beispiel: Familie Berg',
        '<p>Familie Berg legt den Haushalt an einem Sonntag an. In den zwei Wochen danach landen drei Wocheneinkäufe als Bons in ToHuus, die Tonnen kommen aus dem Kalender, und Mira trägt die Größen der Kinder ein. Am zwölften Tag kommt die Erinnerung. Sam und Mira schauen, was sie wirklich genutzt haben, und nehmen Haushalt im Jahresabo. Den Assistenten haben sie selten gebraucht, die Liste und die Aufgaben jeden Tag.</p>'],
      ['So entscheidet ihr',
        '<p>Schaut nach den zwei Wochen, was ihr wirklich benutzt habt. Wer vor allem Liste, Aufgaben und Geld braucht, kommt mit Haushalt gut aus. Wer viel mit dem Assistenten spricht und den Wochenplan aus dem Vorrat füllen lässt, nimmt Plus. Und wer einen eigenen Server hat, kann ToHuus dort kostenlos betreiben. Wie das geht, steht im Beitrag <a href="haushalts-app-selbst-hosten.html">Haushalts-App selbst hosten</a>.</p>'
        + tail],
    ],
    faq: [
      ['Muss ich für die Testphase Zahlungsdaten angeben?', 'Nein. Jeder neue Haushalt in der Cloud startet von selbst mit 14 Tagen Plus, ohne Zahlungsdaten.'],
      ['Verlängert sich die Testphase automatisch in ein Abo?', 'Nein. Abgebucht wird nichts von selbst. Ihr entscheidet nach den 14 Tagen.'],
      ['Was passiert ohne Abo mit unseren Daten?', 'Nichts wird gelöscht. Ihr seht alles weiter und könnt es exportieren, nur Neues eintragen geht nicht mehr.'],
      ['Gibt es eine kostenlose Version?', 'In der ToHuus Cloud nicht. Kostenlos ist ToHuus auf dem eigenen Server, unter AGPL-3.0.'],
      ['Wer zahlt, wenn wir zu viert sind?', 'Ein Abo gilt für den ganzen Haushalt. Mitglieder, Kinder, Gäste und verbundene Haushalte zahlen nichts.'],
    ],
    facts: [
      { value: '14 Tage', text: 'So lange nutzt jeder neue Haushalt in der ToHuus Cloud alles aus Plus, ohne Zahlungsdaten. Danach wird nichts gelöscht.', source: 'ToHuus', url: help('abo-und-kuendigen') },
    ],
    help: ['abo-und-kuendigen', 'selbst-hosten'],
  },
  {
    slug: 'haushalts-app-selbst-hosten', area: 'zuhause', status: 'published', date: '2026-10-18',
    title: 'Haushalts-App selbst hosten: ToHuus auf dem eigenen Server',
    desc: 'ToHuus läuft kostenlos auf dem eigenen Server, als Docker-Container mit einer SQLite-Datei. Mit iPhone-App, Web-App, Home Assistant und KI nur, wenn ihr wollt.',
    answer: 'ToHuus lässt sich kostenlos selbst hosten, als ein Docker-Container mit einer SQLite-Datei, unter AGPL-3.0. Die iPhone-App verbindet sich mit eurem Server, im Browser läuft ToHuus als Web-App. KI ist optional, ohne Schlüssel laufen Liste, Aufgaben, Bon-Texterkennung und die häufigen Sätze an den Assistenten trotzdem.',
    sections: [
      ['Für wen sich das lohnt',
        '<p>Selbst hosten lohnt sich für alle, die schon einen Server, ein NAS oder Home Assistant betreiben und ihre Daten lieber zu Hause behalten. Es ist dieselbe App mit demselben Code wie in der ToHuus Cloud. Der Unterschied ist nur, wer den Server betreibt. Ein Konto bei uns braucht ihr dafür nicht.</p>'],
      ['Was ihr braucht',
        '<ul><li>Einen Rechner oder Server mit Docker</li><li>Einen Reverse Proxy mit HTTPS, wenn ihr von unterwegs zugreifen wollt</li><li>Optional einen Schlüssel für einen OpenAI-kompatiblen KI-Dienst, etwa Mistral, auch lokal</li></ul>'
        + '<p>Die Daten liegen in einer SQLite-Datei im Ordner <code>./data</code>, auf Wunsch verschlüsselt, mit nächtlichen Sicherungen und Export als JSON.</p>'],
      ['So geht die Installation',
        '<ol><li>Das Repository von GitHub holen und <code>.env.example</code> nach <code>.env</code> kopieren.</li><li>In <code>.env</code> die Adresse (<code>BASE_URL</code>), deinen Namen und ein Passwort eintragen.</li><li>Mit <code>docker compose up -d --build</code> starten und die Adresse im Browser öffnen.</li><li>Beim ersten Start leer anfangen oder dich erst mit Demo-Daten umsehen.</li></ol>'
        + '<p>Die Schritte mit allen Befehlen stehen auf der Startseite unter Selbst hosten und in der Hilfe.</p>'],
      ['Mit oder ohne KI',
        '<p>Ohne KI-Schlüssel läuft alles Wesentliche weiter. Bon-Fotos liest eine Texterkennung auf eurem Server, und der Assistent versteht die häufigen kurzen Sätze wie „Milch ist alle und 2 Paprika“ oder „Merk dir …“. Mit einem Schlüssel kommen freie Fragen an den Assistenten, schwierige Bon-Fotos und Vorschläge dazu. Welchen Anbieter ihr nehmt, entscheidet ihr selbst.</p>'],
      ['Was selbst gehostet anders ist',
        '<ul><li>Alles ist freigeschaltet, ohne Abo und ohne Testphase.</li><li>Dazu gibt es ein Bon-Postfach, Telegram und einen Bon-Drucker im eigenen Netz.</li><li>Home Assistant bindet ihr über HACS ein, Claude, ChatGPT und andere Assistenten über MCP mit einem Zugangsschlüssel.</li><li>Push-Mitteilungen von Apple gehen vom eigenen Server nicht. Stattdessen gibt es Web Push, ntfy, Telegram oder E-Mail.</li></ul>'],
      ['Ein Beispiel: Familie Berg',
        '<p>Sam hat zu Hause ohnehin einen kleinen Server mit Home Assistant. ToHuus läuft dort als weiterer Container, die iPhone-Apps von Sam und Mira verbinden sich über den QR-Code aus der Web-App. In Home Assistant steht die Einkaufsliste jetzt als To-do-Liste, und „Gelbe Tonne raus“ taucht als Sensor auf dem Dashboard im Flur auf.</p>'],
      ['So hilft ToHuus dabei',
        '<p>Der Quellcode liegt offen auf <a href="https://github.com/tillheidrich/tohuus-hub">GitHub</a>, die App unter AGPL-3.0, die Home-Assistant-Integration unter MIT. Wer später doch lieber nicht selbst betreiben will, zieht mit dem Haushalt in die ToHuus Cloud um. Wie das geht, steht in der Hilfe unter <a href="../hilfe/umzug-in-die-cloud.html">Umzug in die Cloud</a>.</p>'
        + tail],
    ],
    faq: [
      ['Kostet selbst hosten etwas?', 'Nein. ToHuus ist selbst gehostet kostenlos, unter AGPL-3.0, mit allen Funktionen.'],
      ['Funktioniert die iPhone-App mit dem eigenen Server?', 'Ja. Auf dem Startbildschirm „Eigener Server“ tippen, am einfachsten verbindet ihr per QR-Code aus der Web-App.'],
      ['Brauche ich eine KI?', 'Nein. Ohne Schlüssel laufen Liste, Aufgaben, Bon-Texterkennung und die häufigen Sätze an den Assistenten weiter.'],
      ['Gibt es Push-Mitteilungen?', 'Apple-Push nicht vom eigenen Server. Dafür Web Push, ntfy, Telegram oder E-Mail.'],
    ],
    help: ['selbst-hosten', 'home-assistant', 'umzug-in-die-cloud'],
  },
];
