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
        '<ul><li><b>Personen</b>: Schuh- und Kleidergrößen der Kinder, Lieblingskuchen, was jemand mag und was nicht, Unverträglichkeiten und Allergien, die Nummer der Kinderärztin</li><li><b>Räume</b>: Maße von Rollos, Fenstern und Vorhängen, welcher Sockel in welche Lampe gehört (E14, E27 oder GU10), wo der Hauptwasserhahn und der Sicherungskasten sind</li><li><b>Dinge</b>: Zählernummern und Zählerstände, Staubsaugerbeutel, Filter für Dunstabzug oder Wasserkanne, die Reifengröße vom Auto, wann die Heizung zuletzt gewartet wurde</li><li><b>Regeln</b>: was bei euch in welche Tonne gehört, wohin der Sperrmüll angemeldet wird, welche Batterien in die Fernbedienung kommen</li></ul>'
        + '<p>Was nicht dazugehört: Passwörter, PIN, WLAN-Schlüssel und Türcodes. Die brauchen einen eigenen, geschützten Platz, in ToHuus sind das die Codes in der Hausinfo.</p>'],
      ['Warum das entlastet',
        '<p>In vielen Haushalten trägt eine Person das meiste davon im Kopf. Sie wird gefragt, wenn im Laden die Größe fehlt, wenn der Ableser vor der Tür steht oder wenn die Birne im Flur kaputt ist. Jede Frage ist klein, aber zusammen sind es viele, und sie kommen zu jeder Tageszeit. Die Soziologin Allison Daminger hat diese Denkarbeit 2019 in vier Teile zerlegt: vorausdenken, Möglichkeiten finden, entscheiden und nachhalten (<a href="https://doi.org/10.1177/0003122419859007">American Sociological Review</a>). Das Wissen übers Zuhause gehört zum Nachhalten, und genau das sieht von außen niemand.</p>'
        + '<p>Steht es an einem Ort, an dem alle nachsehen können, fragt man ToHuus statt dieser einen Person. Pflegen muss man dafür nichts: Was sich ändert, trägt einfach ein, wer es gerade merkt.</p>'],
      ['Auch für die KI',
        '<p>Ein Assistent kann nur mit dem arbeiten, was er über euch weiß. Ohne Haushaltswissen rät er bei der Schuhgröße oder fragt zurück. Mit Haushaltswissen antwortet er, für den Assistenten in ToHuus genauso wie für Claude oder ChatGPT, wenn ihr sie über MCP verbindet. Mehr dazu im Beitrag <a href="ki-braucht-kontext.html">Warum auch die beste KI ohne Kontext nur rät</a>.</p>'],
      ['Warum ein fester Ort hilft',
        '<p>Aufschreiben allein reicht nicht, man muss es auch wiederfinden. Hilfreich ist eine einfache Form: <i>wer oder was</i>, <i>welche Eigenschaft</i>, <i>welcher Wert</i>. Also „Mika · Schuhgröße: 31“ statt „Mika hat glaube ich jetzt 31, oder?“. Dann findet man es über die Person, über den Raum oder über die Suche.</p>'
        + '<p>Dazu kommt ein Effekt, den man aus der Forschung kennt. In Studien von <a href="https://doi.org/10.1037/a0024192">Masicampo und Baumeister (2011)</a> drängten sich offene Dinge weniger in die Gedanken, sobald es einen konkreten Plan dafür gab. Ein festes „steht in ToHuus“ ist kein Plan, aber es nimmt die Frage aus dem Kopf, wo das noch mal war.</p>'],
      ['Ein Beispiel: Familie Berg',
        '<p>Bei Familie Berg trägt Sam an einem Abend ein paar Sachen ein, jeweils mit einem Satz: „Mika Schuhgröße 31“, „Rollo Wohnzimmer 120 x 160“, „Zählernummer Strom 1ESY1160“. ToHuus macht daraus Karten und hängt sie an Mika, ans Wohnzimmer und an „Strom“. Im Frühjahr ist Mika gewachsen, Mira schreibt „Mika hat jetzt 32“. Die Karte zeigt 32, im Verlauf steht noch die 31 mit Datum.</p>'
        + '<p>Als Mira im Schuhladen steht, fragt sie den Assistenten: „Welche Schuhgröße hat Mika?“ Die Antwort steht da, ohne dass jemand zu Hause ans Telefon muss.</p>'],
      ['So hilft ToHuus dabei',
        '<p>In ToHuus heißt das Haushaltswissen „Was ToHuus sich merkt“. Jede Karte gehört zu einem Mitglied, einem Kinderprofil, einem Ort aus „Wo ist was?“, einem Produkt oder einer freien Bezeichnung wie „Rollo Erdgeschoss“. Ihr tippt einen Satz oder sagt ihn dem Assistenten, kurze Sätze wie „Rollo Wohnzimmer 120 x 160“ versteht ToHuus auch ganz ohne KI. Gibt es zur selben Sache schon eine Karte, bekommt sie den neuen Wert, und der alte bleibt im Verlauf.</p>'
        + '<ul><li>Jede Karte gilt für den ganzen Haushalt oder nur für dich. Private Karten sieht niemand sonst.</li><li>Gesundheitsangaben wie die Telefonnummer der Kinderärztin bleiben privat, bis du sie ausdrücklich teilst, und gehen ohne eure Zustimmung nie an eine KI.</li><li>Codes und Passwörter nimmt ToHuus hier nicht an und verweist auf die Hausinfo.</li><li>Feste Gäste sehen nur Karten, die ihr für Gäste freigebt.</li><li>Was schon irgendwo steht, holt ihr rein: Text aus Notizen oder Mails einfügen oder eine Liste wählen (Excel, Numbers, Google Tabellen als CSV, Textdatei). Ihr seht vorher alles. Wie das geht, steht im Beitrag <a href="notizen-und-listen-uebernehmen.html">Notizen und Listen in den Haushalt holen</a>.</li><li>Sichern geht jederzeit als Datei, in Markdown, CSV oder JSON.</li></ul>'
        + tail],
    ],
    faq: [
      ['Was ist Haushaltswissen?', 'Die kleinen Fakten über euer Zuhause, die man selten braucht und dann sofort: Größen, Maße, Zählerstände, Filtertypen, Wartungstermine.'],
      ['Kann ich Passwörter im Haushaltswissen speichern?', 'Nein. ToHuus lehnt Codes und Passwörter dort ab. Dafür gibt es die Codes in der Hausinfo, die verdeckt bleiben und nie an eine KI gehen.'],
      ['Sehen alle im Haushalt meine Einträge?', 'Nur die, die du für den Haushalt anlegst. Einträge nur für dich sieht niemand sonst, Gesundheitsangaben sind von sich aus privat.'],
      ['Geht der alte Wert verloren, wenn ich etwas ändere?', 'Nein. Die Karte zeigt den neuen Wert, die früheren stehen mit Datum im Verlauf und lassen sich zurückholen.'],
      ['Brauche ich dafür KI?', 'Nein. Kurze Sätze wie „Mika Schuhgröße 31“ liest ToHuus ohne KI. Mit KI versteht der Assistent auch freiere Formulierungen.'],
      ['Muss ich alles abtippen, was schon in Notizen steht?', 'Nein. Text aus Notizen oder Mails einfügen oder eine Liste als CSV oder Textdatei wählen. ToHuus zeigt vorher, was es erkannt hat.'],
    ],
    facts: [
      { value: '1 Satz', text: 'So viel braucht eine Karte im Haushaltswissen von ToHuus, etwa „Rollo Wohnzimmer 120 x 160“. Das geht auch ohne KI.', source: 'ToHuus', url: help('erste-schritte') },
    ],
    sources: [
      ['Masicampo, E. J., & Baumeister, R. F. (2011): Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals. JPSP 101(4)', 'https://doi.org/10.1037/a0024192'],
      ['Daminger, A. (2019): The Cognitive Dimension of Household Labor. American Sociological Review 84(4)', 'https://doi.org/10.1177/0003122419859007'],
    ],
    help: ['haushaltswissen', 'hausinfo', 'datenschutz-kurz'],
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
  {
    slug: 'ki-braucht-kontext', area: 'wissen', status: 'published', date: '2026-10-18',
    title: 'Warum auch die beste KI ohne Kontext nur rät',
    desc: 'Ein Sprachmodell weiß viel über die Welt, aber nichts über euer Zuhause. Welche Schuhgröße Mika hat oder welcher Filter in die Haube gehört, muss irgendwo stehen.',
    answer: 'Eine KI kann nur mit dem arbeiten, was sie über euch weiß. Fragt ihr nach der Schuhgröße eures Kindes oder dem Filter für die Dunstabzugshaube, rät sie oder fragt zurück. Erst wenn das Wissen über euren Haushalt an einem Ort steht, kann ein Assistent damit etwas anfangen. In ToHuus ist das das Haushaltswissen, und es funktioniert auch ganz ohne KI.',
    sections: [
      ['Was eine KI weiß und was nicht',
        '<p>Sprachmodelle haben aus riesigen Textmengen gelernt, wie Sprache funktioniert und was allgemein bekannt ist. Wie man den Fettfilter einer Dunstabzugshaube reinigt, erklären sie ziemlich gut. Welche Haube bei euch hängt und welcher Filter da reinpasst, wissen sie nicht, denn das stand in keinem Text, aus dem sie gelernt haben.</p>'
        + '<p>Fragt man trotzdem, passiert eins von zwei Dingen. Entweder die KI fragt zurück, dann muss doch jemand nachschauen. Oder sie antwortet mit etwas, das plausibel klingt, aber für euch nicht stimmt. Bei einer Schuhgröße ist das ärgerlich, bei einer Allergie kann es gefährlich werden.</p>'],
      ['Kontext heißt: was bei euch gilt',
        '<p>Gemeint ist hier nichts Technisches. Es sind die Fakten, die nur ihr kennt:</p>'
        + '<ul><li>wer zum Haushalt gehört und was jemand nicht verträgt</li><li>welche Größen die Kinder gerade tragen</li><li>welche Maße Fenster und Rollos haben und welche Glühbirne in welche Lampe gehört</li><li>welcher Zähler welche Nummer hat und wann die Heizung zuletzt gewartet wurde</li><li>was bei euch in welche Tonne gehört</li></ul>'
        + '<p>Steht das irgendwo, wo der Assistent nachsehen darf, wird aus „Das kann ich leider nicht wissen“ eine brauchbare Antwort: „Mika trägt seit März Größe 32.“</p>'],
      ['Warum eine Notiz dafür selten reicht',
        '<p>Viele haben solche Sachen in einer Notiz auf dem Handy. Das ist besser als nichts, hat aber zwei Haken. Die Notiz liegt meistens bei genau einer Person, und die anderen fragen weiter diese Person. Außerdem ist ein langer Text für Menschen und Assistenten gleich schwer zu lesen: Gilt die 31 noch, oder steht weiter unten schon die 32?</p>'
        + '<p>Hilfreich ist eine einfache Form: wer oder was, welche Eigenschaft, welcher Wert. „Mika · Schuhgröße: 32“ versteht ein Mensch so schnell wie ein Assistent, und ein alter Wert lässt sich klar vom neuen trennen.</p>'],
      ['Ein Beispiel: Familie Berg',
        '<p>Mira steht im Baumarkt und will Ersatzbirnen für die Flurlampe mitnehmen. Früher hätte sie Sam angerufen, und der hätte auf die Leiter steigen müssen. Jetzt fragt sie den Assistenten in ToHuus: „Welche Birne gehört in die Flurlampe?“ Die Antwort kommt aus einer Karte, die Sam vor ein paar Wochen angelegt hat: „Flurlampe · Sockel: E14, warmweiß“.</p>'
        + '<p>Am Abend fragt Sam seinen eigenen KI-Assistenten, den er über MCP mit ToHuus verbunden hat, welche Winterreifen er bestellen muss. Der Assistent liest die Reifengröße aus dem Haushaltswissen. Raten muss er nicht.</p>'],
      ['So hilft ToHuus dabei',
        '<p>Das Haushaltswissen ist das Gedächtnis eures Haushalts. Jede Karte gehört zu einer Person, einem Raum oder einem Ding und hat einen Verlauf. Der Assistent in ToHuus schaut dort nach, wenn ihr ihn etwas fragt, und trägt auf Wunsch etwas ein. Wer lieber Claude, ChatGPT oder einen anderen Assistenten nutzt, verbindet ihn über MCP und gibt ihm damit denselben Zugang.</p>'
        + '<ul><li>Ohne KI geht es auch: Kurze Sätze wie „Mika Schuhgröße 32“ liest ToHuus selbst, und die Suche findet jede Karte.</li><li>Private Karten sieht nur, wem sie gehören, auch kein Assistent einer anderen Person.</li><li>Gesundheitsangaben wie Allergien gehen nur an eine KI, wenn ihr das ausdrücklich erlaubt.</li><li>Codes und Passwörter gehören in die Hausinfo und gehen nie an eine KI.</li></ul>'
        + tail],
    ],
    faq: [
      ['Weiß eine KI nicht sowieso alles?', 'Nein. Sie weiß viel Allgemeines, aber nichts über euren Haushalt, solange es nirgends steht. Fehlt dieses Wissen, rät sie oder fragt zurück.'],
      ['Brauche ich KI, damit das Haushaltswissen etwas bringt?', 'Nein. Jede Karte findet ihr über die Suche, die Person, den Raum oder das Ding. Die KI ist nur ein weiterer Weg zu fragen.'],
      ['Bekommt die KI alles zu sehen?', 'Nur, was die fragende Person sehen darf. Private Karten anderer nie, Gesundheitsangaben nur mit eurer Erlaubnis, Codes und Passwörter nie.'],
      ['Kann ich meinen eigenen KI-Assistenten nutzen?', 'Ja. Über MCP verbindet ihr Claude, ChatGPT oder einen anderen Assistenten mit eurem Haushalt. Er sieht das Haushaltswissen dann nach denselben Regeln.'],
    ],
    facts: [
      { value: '1 Ort', text: 'Was ihr übers Zuhause wisst, steht in ToHuus an einer Stelle: für euch, für den Assistenten und auf Wunsch für eure eigene KI.', source: 'ToHuus', url: help('haushaltswissen') },
    ],
    help: ['haushaltswissen', 'sprechen', 'claude-chatgpt'],
  },
  {
    slug: 'notizen-und-listen-uebernehmen', area: 'wissen', status: 'published', date: '2026-10-18',
    title: 'Notizen und Listen in den Haushalt holen, ohne abzutippen',
    desc: 'Größen in einer Notiz, Zählerstände in einer Tabelle, Maße in einer alten Mail: So holt ihr das in ToHuus, seht vorher alles und sichert es jederzeit wieder als Datei.',
    answer: 'Abtippen müsst ihr nichts. Text aus einer Notiz oder Mail fügt ihr einfach ein, oder ihr wählt eine Liste als Datei, etwa aus Excel, Numbers oder Google Tabellen als CSV oder eine Textdatei. ToHuus zeigt vorher jede erkannte Zeile, und ihr hakt an, was übernommen wird. Genauso sichert ihr das Haushaltswissen jederzeit als Datei.',
    sections: [
      ['Wo das Wissen heute steht',
        '<p>Kaum ein Haushalt fängt bei null an. Die Kleidergrößen der Kinder stehen in einer Notiz, die Zählerstände in einer Tabelle, die jemand jedes Jahr ergänzt, und das Maß fürs Rollo steckt in der Bestellbestätigung vom letzten Mal. Das alles noch einmal abzutippen, macht niemand gern. Also bleibt es meistens, wo es ist.</p>'],
      ['Text einfügen',
        '<p>Am schnellsten geht es mit Kopieren und Einfügen. Markiert den Text in eurer Notiz oder Mail, kopiert ihn und fügt ihn in ToHuus unter Haushaltswissen › Importieren ein. ToHuus liest jede Zeile für sich:</p>'
        + '<ul><li>„Mika Schuhgröße 31“ wird eine Karte für Mika, genauso „Schuhgröße: 31“ unter einer Zeile „Mika:“.</li><li>„Rollo Wohnzimmer 120 x 160“ wird eine Karte fürs Wohnzimmer.</li><li>Zeilen ohne klare Angabe kommen als Notiz mit, damit nichts verloren geht.</li></ul>'],
      ['Eine Liste wählen',
        '<p>Habt ihr eine Tabelle, speichert sie als CSV. Das geht in Excel, Numbers und Google Tabellen über „Exportieren“ oder „Herunterladen“. Am besten hat sie drei Spalten: wer oder was, welche Eigenschaft, welcher Wert, also zum Beispiel „Strom“, „Zählerstand“, „41230“. Überschriften auf Deutsch oder Englisch erkennt ToHuus, ohne Überschrift zählt die Reihenfolge der Spalten. Eine einfache Textdatei geht genauso.</p>'
        + '<p>Wer Notizen in Obsidian oder Notion führt, exportiert sie als Markdown. Überschriften werden dabei zur Person oder zum Ding, Links werden zu normalem Text.</p>'],
      ['Erst ansehen, dann übernehmen',
        '<p>Gespeichert wird nichts, bevor ihr es gesehen habt. Die Vorschau zeigt jede erkannte Karte und was mit ihr passiert:</p>'
        + '<ul><li><b>neu</b>: die Karte gibt es noch nicht</li><li><b>neuer Wert</b>: die Karte gibt es schon, der alte Wert wandert in den Verlauf</li><li><b>unverändert</b>: steht schon genau so drin</li><li><b>nicht übernommen</b>: Codes und Passwörter, die gehören in die Hausinfo</li></ul>'
        + '<p>Ihr hakt an, was rein soll, und wählt, ob es für den ganzen Haushalt ist oder nur für euch. Gesundheitsangaben wie die Nummer der Kinderärztin bleiben dabei immer privat. Hat etwas nicht gepasst, nimmt „Rückgängig“ den ganzen Import auf einmal zurück.</p>'],
      ['Als Datei sichern',
        '<p>Andersherum geht es genauso. Unter Haushaltswissen › Exportieren bekommt ihr eine Datei als Markdown, CSV oder JSON, mit allem oder nur mit dem, was die Suche gerade zeigt. Auf dem iPhone legt ihr sie über „In Dateien sichern“ ab, zum Beispiel in iCloud Drive. Exportiert wird nur, was ihr selbst sehen dürft, und jede dieser Dateien lässt sich später wieder einlesen.</p>'],
      ['Ein Beispiel: Familie Berg',
        '<p>Mira hat seit Jahren eine Notiz „Größen Mika“ auf dem Handy. Sie kopiert sie, fügt sie in ToHuus ein und sieht in der Vorschau sechs Karten: Schuhe, Jacke, Hose, Handschuhe, Mütze und Fahrradhelm. Zwei Zeilen, die keine Größe sind, kommen als Notiz mit. Sie hakt alles an und wählt „Ganzer Haushalt“.</p>'
        + '<p>Sam führt die Zählerstände in einer Tabelle. Er speichert sie als CSV und wählt die Datei aus. Bei „Strom · Zählerstand“ steht „neuer Wert“, weil Mira den Stand vom Sommer schon eingetragen hatte. Der landet im Verlauf, die Karte zeigt den aktuellen.</p>'],
      ['So hilft ToHuus dabei',
        '<p>Import und Export gehören zum Haushaltswissen und funktionieren ganz ohne KI, auf dem iPhone und im Browser. Eine Datei darf bis zu 512 KB groß sein, pro Import kommen bis zu 200 Einträge herein. Wer seinen eigenen KI-Assistenten über MCP verbunden hat, kann ihm auch einfach eine Notiz geben und sagen: „Trag das ins Haushaltswissen ein.“</p>'
        + tail],
    ],
    faq: [
      ['Muss ich meine Notizen abtippen?', 'Nein. Text einfügen oder eine Datei wählen reicht. ToHuus zeigt vorher, was es erkannt hat.'],
      ['Welche Dateien gehen?', 'Textdateien, CSV aus Excel, Numbers oder Google Tabellen, Markdown und JSON. PDF, Word-Dateien und Bilder nicht.'],
      ['Was passiert mit Einträgen, die es schon gibt?', 'Die Karte bekommt den neuen Wert, der alte bleibt im Verlauf. Wer das nicht will, lässt vorhandene Karten beim Import einfach, wie sie sind.'],
      ['Kann ich alles wieder exportieren?', 'Ja, jederzeit als Markdown, CSV oder JSON. Jede dieser Dateien lässt sich wieder einlesen.'],
    ],
    help: ['haushaltswissen', 'daten-export'],
  },
  {
    slug: 'haushalts-app-leiste-anpassen', area: 'zuhause', status: 'published', date: '2026-10-18',
    title: 'Die Leiste unten so, wie ihr lebt',
    desc: 'Heute, Einkauf, Kochen, Aufgaben und Vorrat sind der Anfang. Was ihr öfter braucht, etwa Geld oder das Haushaltswissen, holt jede Person für sich nach unten.',
    answer: 'In ToHuus stellt jede Person die Leiste unten selbst zusammen. Heute bleibt vorn, dazu kommen bis zu vier Bereiche in eigener Reihenfolge: Einkauf, Kochen, Aufgaben, Vorrat, Geld, Wissen, Bring mir was, Wünsche oder Hausinfo. Was nicht in der Leiste ist, steht unter „Mehr“. Einstellen geht unter Einstellungen › Deine Leiste oder mit langem Drücken auf die Leiste.',
    sections: [
      ['Warum nicht alle dieselbe Leiste brauchen',
        '<p>Im Haushalt macht selten jede Person dasselbe. Wer einkauft und kocht, braucht Liste und Kochplaner jeden Tag. Wer die Ausgaben im Blick hat, schaut eher auf Geld. Und wer abends ständig nach dem WLAN-Passwort oder Mikas Schuhgröße gefragt wird, hätte Hausinfo oder Haushaltswissen gern mit einem Tipp erreichbar.</p>'
        + '<p>Mehr als fünf Plätze bleiben auf dem Handy kaum gut bedienbar. Deshalb wählt jede Person selbst, was dort steht.</p>'],
      ['Der Anfang: Heute, Einkauf, Kochen, Aufgaben, Vorrat',
        '<p>So startet ToHuus. <b>Heute</b> zeigt, was fällig ist, was bald weg muss und was demnächst kommt. <b>Einkauf</b> ist die gemeinsame Liste, <b>Kochen</b> der Kochplaner, <b>Aufgaben</b> das, was zu Hause zu tun ist, und <b>Vorrat</b> das, was da ist. Habt ihr Kochen oder Vorrat unter „Was nutzt ihr?“ abgeschaltet, rückt Geld nach.</p>'],
      ['Was ihr nach unten holen könnt',
        '<ul><li><b>Geld</b>: was Essen und Haushalt kosten</li><li><b>Wissen</b>: das Haushaltswissen mit Größen, Maßen und Zählerständen</li><li><b>Bring mir was</b>: sich zu Hause eine Kleinigkeit wünschen</li><li><b>Wünsche</b>: Wunschlisten und Merklisten</li><li><b>Hausinfo</b>: WLAN, wie die Heizung geht, wichtige Nummern</li></ul>'
        + '<p>Heute bleibt immer vorn, und der Assistent bleibt der runde Knopf unten rechts. Werkzeuge und Einstellungen wie Personen, Urlaub oder „Wo ist was?“ findet ihr weiter unter „Mehr“.</p>'],
      ['So stellt ihr sie um',
        '<ol><li>Lange auf die Leiste drücken oder unter „Mehr“ auf „Leiste anpassen“ tippen. Im Browser geht es auch über Einstellungen › Deine Leiste.</li><li>Mit dem grünen Plus holt ihr einen Bereich dazu, mit dem roten Minus nehmt ihr ihn raus.</li><li>Am Griff zieht ihr die Bereiche in die Reihenfolge, die ihr wollt.</li><li>„Wie am Anfang“ setzt alles zurück.</li></ol>'
        + '<p>Die Leiste gilt für dich, auf dem iPhone und im Browser gleich. Die anderen im Haushalt behalten ihre eigene.</p>'],
      ['Ein Beispiel: Familie Berg',
        '<p>Sam kocht fast jeden Abend und kauft dafür ein, in den Vorrat schaut er selten. Seine Leiste: Heute, Einkauf, Kochen, Aufgaben, Wissen. Mira behält die Ausgaben im Blick und wird ständig nach Mikas Größen gefragt. Ihre Leiste: Heute, Einkauf, Aufgaben, Geld, Wissen. Bring mir was nutzen beide eher abends und holen es sich bei Bedarf über „Mehr“.</p>'],
      ['So hilft ToHuus dabei',
        '<p>ToHuus speichert die Leiste pro Person, damit iPhone, iPad und Browser gleich aussehen. Auf dem iPad und am Computer zeigt die Seitenleiste zuerst deine Bereiche, die übrigen folgen darunter. Schaltet ihr einen Bereich für den Haushalt ab, fällt er aus allen Leisten weg. Feste Gäste bekommen immer die Standardleiste.</p>'
        + tail],
    ],
    faq: [
      ['Kann ich die Leiste in ToHuus anpassen?', 'Ja. Heute bleibt vorn, dazu kommen bis zu vier Bereiche in deiner Reihenfolge. Lange auf die Leiste drücken oder Einstellungen › Deine Leiste öffnen.'],
      ['Ändert das die Leiste für alle?', 'Nein. Jede Person hat ihre eigene Leiste, auf dem iPhone und im Browser gleich.'],
      ['Wo finde ich Bereiche, die nicht in der Leiste sind?', 'Unter „Mehr“. Dort stehen oben die Hauptbereiche, die übrigen behalten ihre gewohnte Zeile.'],
    ],
    help: ['deine-leiste', 'erste-schritte'],
  },
  {
    slug: 'haushalt-mit-eigenem-ki-assistenten', area: 'assistent', status: 'published', date: '2026-10-18',
    title: 'ToHuus mit dem eigenen KI-Assistenten nutzen: so geht MCP',
    desc: 'Wer Claude, ChatGPT oder einen anderen Assistenten nutzt, verbindet ihn über MCP mit dem Haushalt. Dann weiß er, was ansteht und was ihr übers Zuhause wisst.',
    answer: 'MCP ist ein offenes Protokoll, über das KI-Assistenten auf andere Programme zugreifen. ToHuus bietet dafür eine eigene Adresse an. Verbindet ihr Claude, ChatGPT oder einen anderen Assistenten damit, kann er Liste, Aufgaben, Rezepte und das Haushaltswissen lesen und auf Wunsch ändern, nach denselben Regeln wie in der App. Ihr meldet euch mit eurem ToHuus-Konto an und legt fest, was er darf.',
    sections: [
      ['Worum es geht',
        '<p>Viele nutzen inzwischen einen KI-Assistenten für alles Mögliche. Über euren Haushalt weiß der aber nichts, solange es ihm niemand sagt. Mit MCP müsst ihr das nicht jedes Mal neu erklären. Ihr gebt ihm einmal einen festen Zugang zu ToHuus, und danach könnt ihr dort fragen „Was steht diese Woche noch an?“ oder ein Foto vom Kühlschrank schicken und sagen „Setz auf die Liste, was fehlt“.</p>'],
      ['Was der Assistent damit kann',
        '<ul><li>die Einkaufsliste lesen, ergänzen und abhaken</li><li>Aufgaben und Termine anlegen und sagen, was demnächst kommt</li><li>im Haushaltswissen nachsehen und auf Wunsch etwas eintragen, auch eine ganze eingefügte Notiz</li><li>Rezepte, Wochenplan, Vorrat und Ausgaben lesen</li></ul>'
        + '<p>Er ändert nur etwas, wenn ihr ihn darum bittet. Einkäufe, die er festhält, warten erst in der Prüfung.</p>'],
      ['So verbindet ihr ihn',
        '<ol><li>In Claude unter Einstellungen › Connectors › Eigenen Connector hinzufügen, in ChatGPT unter Einstellungen › Connectors, je nach Tarif im Entwicklermodus.</li><li>Die MCP-Adresse eintragen. Sie steht in der Hilfe unter <a href="../hilfe/claude-chatgpt.html">Mit Claude oder ChatGPT verbinden</a>.</li><li>Mit dem ToHuus-Konto anmelden, den Haushalt wählen und festlegen, ob der Assistent nur lesen oder auch ändern darf.</li></ol>'],
      ['Was er nicht sieht',
        '<ul><li>private Einträge und Aufgaben anderer</li><li>Codes aus der Hausinfo</li><li>Allergien, Angaben zu Kindern und andere Gesundheitsangaben, außer ihr kreuzt das beim Verbinden an und der Haushalt erlaubt es</li></ul>'
        + '<p>Unter Einstellungen › Zugänge & KI seht ihr jede Verbindung und könnt sie beenden. Ein Admin kann MCP für den ganzen Haushalt abschalten.</p>'],
      ['Und die KI-Grenzen?',
        '<p>Fragt ihr euren eigenen Assistenten, arbeitet dort dessen Sprachmodell, bei dem Anbieter, den ihr ohnehin nutzt. Von den Nachrichten an den Assistenten in ToHuus geht dabei nichts ab. Wer viel mit KI arbeitet, fährt mit diesem Weg oft gut.</p>'],
      ['Ein Beispiel: Familie Berg',
        '<p>Sam plant die Woche ohnehin mit Claude. Seit er ToHuus verbunden hat, fragt er sonntags: „Was steht diese Woche an, und was kochen wir mit dem, was da ist?“ Claude liest Aufgaben, Vorrat und Rezepte und schlägt drei Abende vor. Sam sagt „Plan die ein und setz auf die Liste, was fehlt“, und ein paar Sekunden später steht es auf Miras Handy.</p>'],
      ['So hilft ToHuus dabei',
        '<p>Die MCP-Adresse gibt es in der ToHuus Cloud und auf dem eigenen Server. Selbst gehostet verbindet ihr euch genauso oder mit einem Zugangsschlüssel. Behandelt so einen Schlüssel wie ein Passwort.</p>'
        + tail],
    ],
    faq: [
      ['Was ist MCP?', 'Das Model Context Protocol ist ein offener Standard, über den KI-Assistenten auf andere Programme zugreifen. ToHuus bietet dafür eine eigene Adresse an.'],
      ['Welche Assistenten gehen?', 'Claude, ChatGPT und andere Assistenten, die eigene MCP-Verbindungen mit Anmeldung erlauben.'],
      ['Sieht der Assistent alles?', 'Nur, was du selbst sehen darfst. Gesundheitsangaben nur mit ausdrücklicher Erlaubnis, Codes aus der Hausinfo nie.'],
      ['Kann ich die Verbindung wieder trennen?', 'Ja, unter Einstellungen › Zugänge & KI, jederzeit und sofort.'],
    ],
    help: ['claude-chatgpt', 'haushaltswissen', 'ki-an-oder-aus'],
  },
  {
    slug: 'wenn-die-ki-pausiert', area: 'assistent', status: 'published', date: '2026-10-18',
    title: 'Wenn die KI pausiert: was ohne sie geht und warum es eine Grenze gibt',
    desc: 'Jede KI-Nachricht kostet Geld. Deshalb hat ToHuus eine faire Obergrenze im Monat. Was dann passiert, was ohne KI weiterläuft und wie ihr selten an die Grenze kommt.',
    answer: 'Jede Nachricht an ein Sprachmodell kostet Geld, deshalb hat ToHuus pro Haushalt eine Grenze im Monat. Mit Plus und in der Testphase sind es 800 Nachrichten in voller Länge, danach werden die Antworten kürzer, und ab 1.500 pausiert die KI bis zum Monatsende. Mit Haushalt sind es 100 Nachrichten. Liste, Aufgaben, Haushaltswissen und die häufigen kurzen Sätze an den Assistenten laufen auch in der Pause weiter.',
    sections: [
      ['Warum es überhaupt eine Grenze gibt',
        '<p>Für viele Antworten fragt der Assistent in der ToHuus Cloud ein Sprachmodell von Mistral. Das kostet pro Nachricht einen kleinen Betrag, ein Bon-Foto etwas mehr. Bei den meisten Haushalten ist das im Abo locker drin. Ohne Grenze könnten aber einzelne Haushalte so viel verbrauchen, dass ihr Abo es nicht mehr trägt, und das zahlen dann alle anderen mit.</p>'
        + '<p>Wir haben die Grenze deshalb so gelegt, dass sie im Alltag kaum jemand erreicht, und schreiben offen hin, wo sie liegt. Eine „unbegrenzte“ KI, die dann doch irgendwo still gedrosselt wird, wollten wir nicht.</p>'],
      ['Die Grenzen im Monat',
        '<ul><li><b>Plus und Testphase</b>: 800 Nachrichten in voller Länge. Danach kommen kürzere Antworten, ab 1.500 Nachrichten pausiert die KI bis zum Monatsende.</li><li><b>Haushalt</b>: 100 Nachrichten an den Assistenten, gedacht für ab und zu.</li><li><b>Kostenbremse</b>: Für jeden Haushalt gibt es zusätzlich einen festen Höchstbetrag für KI im Monat. Wird er erreicht, etwa durch sehr viele Bon-Fotos auf einmal, pausiert die KI auch früher.</li><li><b>Selbst gehostet</b>: keine Grenze von uns, ihr nehmt euren eigenen Schlüssel oder gar keinen.</li></ul>'
        + '<p>Eine gesprochene Nachricht zählt einmal, egal wie lang sie ist. Wie viele Nachrichten euer Haushalt in diesem Monat schon hatte, steht unter Einstellungen › Abo.</p>'],
      ['Was ohne KI weiterläuft',
        '<p>Die Pause betrifft nur das Sprachmodell. Alles andere bleibt, wie es ist:</p>'
        + '<ul><li>Liste, Vorschläge aus dem Kaufrhythmus, Aufgaben, Vorrat, Kochplaner und Geld</li><li>das Haushaltswissen mit Suche, Import und Export, neue Karten auch mit einem Satz wie „Mika Schuhgröße 32“</li><li>die häufigen kurzen Sätze an den Assistenten, etwa „Milch ist alle und 2 Paprika“ oder „Merk dir …“</li><li>Bon-Fotos, die dann die Texterkennung auf dem Server liest, und PDF-Bons wie immer</li><li>euer eigener KI-Assistent über MCP</li></ul>'
        + '<p>ToHuus sagt an den passenden Stellen, dass die KI für diesen Monat pausiert. Nachberechnet wird nichts.</p>'],
      ['Wie ihr selten an die Grenze kommt',
        '<ul><li>Mehrere Sachen in einen Satz packen: „Milch, Brot und Spüli fehlen, und Samstag ist Bad dran“ ist eine Nachricht.</li><li>Für die Liste reicht oft das Eingabefeld, dort wird nichts gezählt.</li><li>Digitale Bons als PDF teilen statt den Bildschirm zu fotografieren, PDF-Bons liest ToHuus ohne KI.</li></ul>'],
      ['Ein Beispiel: Familie Berg',
        '<p>Familie Berg hat Plus und schreibt dem Assistenten ein paar Mal am Tag, meistens kurze Sachen für die Liste und die Aufgaben. Im Oktober kommen sie auf gut 200 Nachrichten und merken von der Grenze nichts. Im Dezember planen sie mit dem Assistenten die Feiertage, fotografieren jeden Bon und fragen viel nach Rezepten. Kurz vor Silvester steht auf Heute, dass die KI bis Monatsende pausiert. Die Einkaufsliste für Silvester schreiben sie trotzdem, über das Eingabefeld und mit kurzen Sätzen an den Assistenten.</p>'],
      ['So hilft ToHuus dabei',
        '<p>Wer die KI gar nicht will, schaltet sie für den Haushalt, für sich oder für ein Kind ab. Dann geht keine einzige Anfrage an ein Sprachmodell, und ToHuus funktioniert trotzdem. Mehr dazu steht in der Hilfe unter <a href="../hilfe/ki-grenzen.html">Faire KI-Grenzen</a> und <a href="../hilfe/ki-an-oder-aus.html">Mit oder ohne KI</a>.</p>'
        + tail],
    ],
    faq: [
      ['Ist die KI in ToHuus unbegrenzt?', 'Nein. Mit Plus und in der Testphase gibt es 800 Nachrichten in voller Länge im Monat, danach kürzere Antworten und ab 1.500 eine Pause bis Monatsende. Mit Haushalt sind es 100 Nachrichten.'],
      ['Was geht, wenn die KI pausiert?', 'Fast alles: Liste, Aufgaben, Vorrat, Kochplaner, Geld, Haushaltswissen und die häufigen kurzen Sätze an den Assistenten. Bon-Fotos liest dann die Texterkennung.'],
      ['Kostet die Pause etwas extra?', 'Nein. Es wird nichts nachberechnet, und im nächsten Monat ist die KI wieder da.'],
      ['Gibt es die Grenze auch selbst gehostet?', 'Nein. Dort nutzt ihr euren eigenen KI-Schlüssel oder gar keinen.'],
    ],
    facts: [
      { value: '800', text: 'Nachrichten in voller Länge hat der Assistent mit Plus und in der Testphase im Monat. Danach werden die Antworten kürzer.', source: 'ToHuus', url: help('ki-grenzen') },
    ],
    help: ['ki-grenzen', 'ki-an-oder-aus', 'sprechen'],
  },
];
