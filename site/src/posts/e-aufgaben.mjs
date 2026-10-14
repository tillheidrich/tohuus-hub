import { help } from '../config.mjs';

// Aufgaben, Kopf voll, Haltbarkeit, Hausinfo für Gäste, Extras, Putzplan (14 Oct 2026). Sources: docs/facts.md,
// section "Research for the Ratgeber (14 Oct 2026)".

export default [
  {
    slug: 'mental-load-haushalt-fair-verteilen', status: 'published', date: '2026-10-14',
    title: 'Mental Load im Haushalt: Was ist das und wie verteilt man ihn fair?',
    desc: 'Mental Load ist das Drandenken, Planen und Im-Blick-Behalten im Haushalt. Er ist unsichtbar und ungleich verteilt. So macht ihr ihn sichtbar und teilt ihn fair.',
    answer: 'Mental Load ist die Denkarbeit im Haushalt: merken, was gebraucht wird, Möglichkeiten suchen, entscheiden und im Blick behalten, ob es erledigt ist. Sie fällt kaum auf, weil sie im Kopf passiert, und sie liegt laut Studien deutlich öfter bei Frauen. Fair verteilt wird sie, wenn ihr sie erst sichtbar macht und dann ganze Bereiche abgebt, das Drandenken eingeschlossen.',
    sections: [
      ['Was mit Mental Load gemeint ist',
        '<p>Bevor jemand das Bad putzt, den Kinderarzttermin macht oder Geschenkpapier kauft, hat meistens schon jemand anders daran gedacht. Genau diese Arbeit vorher meint der Begriff Mental Load. Die Soziologin Allison Daminger hat sie 2019 in einer <a href="https://doi.org/10.1177/0003122419859007">Studie in der American Sociological Review</a> mit 35 Paaren genauer beschrieben und in vier Teile zerlegt:</p>'
        + '<ol><li><b>Bedarf erkennen</b>: Die Kinderschuhe werden zu klein, der Rauchmelder piept bald.</li><li><b>Möglichkeiten suchen</b>: Welcher Laden, welche Größe, welcher Termin?</li><li><b>Entscheiden</b>: Diese Schuhe, am Samstag.</li><li><b>Im Blick behalten</b>: Sind sie bestellt, passen sie, muss noch etwas zurück?</li></ol>'
        + '<p>Interessant ist, wie sich das verteilt. In Damingers Paaren machten Frauen insgesamt mehr von dieser Arbeit, vor allem das Erkennen und das Im-Blick-Behalten. Beim Entscheiden waren Männer und Frauen etwa gleich oft dabei. Wer nur mitentscheidet, hat also noch lange nicht mitgedacht.</p>'],
      ['Warum diese Arbeit so unsichtbar ist',
        '<p>Mental Load hat kein sichtbares Ergebnis. Ein geputztes Bad sieht man, den Gedanken „wir brauchen bis Freitag ein Geschenk für den Kindergeburtstag“ sieht niemand. Er passiert nebenbei, auf dem Weg zur Arbeit oder abends kurz vor dem Einschlafen, und er hört nicht auf, wenn gerade nichts zu tun ist.</p>'
        + '<p>Daminger beschreibt diese Arbeit als anstrengend und oft unsichtbar, und zwar für beide, die Person, die sie macht, und die andere. Genau deshalb sei sie eine häufige Quelle für Streit. Eine <a href="https://asu.elsevierpure.com/en/publications/invisible-household-labor-and-ramifications-for-adjustment-mother/">Studie von Ciciolla und Luthar (2019)</a> mit 393 Müttern in den USA fand, dass fast neun von zehn sich allein für die Organisation der Familientermine verantwortlich fühlten, auch wenn zwei Drittel von ihnen berufstätig waren. Ein allein getragenes Verantwortungsgefühl für das Wohl der Kinder hing dort mit geringerer Zufriedenheit mit dem Leben und mit der Partnerschaft zusammen. Die Stichprobe war klein und eher gut situiert, die Richtung ist trotzdem deutlich.</p>'],
      ['Was die Zahlen für Deutschland sagen',
        '<p>Die <a href="https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Einkommen-Konsum-Lebensbedingungen/Zeitverwendung/Ergebnisse/_inhalt.html">Zeitverwendungserhebung des Statistischen Bundesamts</a> misst die sichtbare Seite. 2022 leisteten Frauen knapp 29,5 Stunden unbezahlte Arbeit pro Woche, Männer knapp 20,5 Stunden. Der Unterschied, der Gender Care Gap, liegt bei 43,4 Prozent. Das ist weniger als 2012/2013 (52,4 Prozent), aber immer noch rund neun Stunden pro Woche.</p>'
        + '<p>Für die Denkarbeit selbst gibt es eine Auswertung des <a href="https://www.boeckler.de/de/pressemitteilungen-2675-alltagsorganisation-bei-paaren-und-familien-51349.htm">WSI der Hans-Böckler-Stiftung</a> von 2023 mit rund 2.200 Erwerbspersonen. Danach liegt die geschätzte Wahrscheinlichkeit, die Alltagsorganisation überwiegend selbst zu übernehmen, bei erwerbstätigen Frauen bei 62 Prozent, bei Männern bei 20 Prozent. Mit Kindern im Haushalt steigt der Wert bei Frauen auf 74 Prozent. Das sind Modellwerte aus einer Befragung, keine Auszählung, und sie sagen nichts über einen einzelnen Haushalt. Wie es bei euch aussieht, findet ihr am besten selbst heraus.</p>'
        + '<p>Wie das beim Einkaufen aussieht, steht ausführlicher im Beitrag <a href="mental-load-einkaufen.html">Mental Load beim Einkaufen</a>.</p>'],
      ['Erst sichtbar machen: der Denkarbeit-Check',
        '<p>Über Mental Load zu reden, ist schwer, solange er unsichtbar bleibt. Sätze wie „ich denke immer an alles“ klingen schnell nach Vorwurf, und „sag doch einfach, was ich machen soll“ verschiebt das Problem nur. Hilfreicher ist eine ruhige Bestandsaufnahme, Punkt für Punkt.</p>'
        + '<p>Genau dafür gibt es in ToHuus unter Aufgaben › Wer hat was im Blick den Denkarbeit-Check. Das sind 33 Karten in sieben Bereichen, von Einkauf und Kochen über Geld und Zuhause bis zu Terminen, Kindern und dem Miteinander. Auf jeder steht eine ganz konkrete Sache, etwa „Merken, wenn etwas zur Neige geht“, „Arzttermine ausmachen“, „Wasserfilter, Rauchmelder, Entkalken“ oder „Merken, wann Kleidung oder Schuhe zu klein sind“. Jede Person beantwortet jede Karte für sich, mit „Mache meistens ich“, „Teilen wir“, „Macht meistens jemand anders“ oder „Betrifft uns nicht“.</p>'
        + '<ul><li>Die Antworten gehören dir. Du siehst für dich, wie viele Sachen du meistens im Kopf hast, wie viele ihr teilt und um wie viele sich jemand anders kümmert.</li><li>Der Haushalt sieht die Antworten erst, wenn alle zugestimmt haben. Dann steht pro Karte, wer was gesagt hat, und ToHuus weist auf zwei Dinge hin: wo alle denken, jemand anders macht es, und wo zwei oder mehr „mache meistens ich“ sagen.</li><li>Jede Karte zeigt, wie ToHuus dir diese Sache abnehmen kann. Aus einer Karte mit „Mache meistens ich“ wird auf Wunsch eine Aufgabe, die du im Blick hast.</li></ul>'
        + '<p>Der Denkarbeit-Check zählt keine Punkte, führt keine Rangliste und zeigt keine Prozentwerte pro Person. Oft ist schon das Durchgehen der Karten der wichtigste Teil. Viele merken erst dabei, wie viele kleine Dinge jemand im Kopf hat, und es wird leichter, darüber zu reden, ohne dass jemand angeklagt wird.</p>'],
      ['So verteilt ihr die Denkarbeit fairer',
        '<ol><li><b>Ganze Bereiche abgeben.</b> Wer „Kinderkleidung“ übernimmt, merkt auch selbst, wann die Schuhe zu klein werden, sucht aus und kauft. Nur das Kaufen abzugeben, entlastet kaum.</li>'
        + '<li><b>Drandenken und Machen trennen.</b> Manchmal macht eine Person etwas, die andere hat es im Blick. Sagt das ausdrücklich, dann weiß jede, wofür sie zuständig ist.</li>'
        + '<li><b>Einmal pro Woche zehn Minuten.</b> Gemeinsam auf die nächsten Tage schauen: Was steht an, wer kümmert sich?</li>'
        + '<li><b>Raus aus dem Kopf.</b> Was aufgeschrieben ist, muss niemand mehr im Kopf behalten. In einer Studie von <a href="https://doi.org/10.1037/a0024192">Masicampo und Baumeister (2011)</a> drängten sich unerledigte Ziele deutlich weniger in die Gedanken, sobald die Leute einen konkreten Plan dafür aufgeschrieben hatten.</li></ol>'
        + '<p>Fair heißt dabei nicht unbedingt fünfzig zu fünfzig. Wichtig ist, dass alle wissen, wer was trägt, und dass es sich für alle stimmig anfühlt.</p>'],
      ['Ein Beispiel: Familie Berg macht den Check',
        '<p>Mira hatte schon länger das Gefühl, an fast alles selbst zu denken. Sam sah das anders, schließlich kauft Sam oft ein und bringt den Müll raus. An einem Sonntagabend gehen beide den Denkarbeit-Check durch, jede Person für sich auf dem eigenen Handy. Danach stimmen beide zu, das Ergebnis gemeinsam anzusehen.</p>'
        + '<p>Bei „Den Wocheneinkauf planen“ haben beide „Teilen wir“ angeklickt, das stimmt. Bei „An Geburtstage und Geschenke denken“, „Arzttermine ausmachen“ und „Merken, wann Kleidung oder Schuhe zu klein sind“ steht bei Mira „Mache meistens ich“ und bei Sam „Macht meistens jemand anders“. Und bei „Wasserfilter, Rauchmelder, Entkalken“ zeigt ToHuus den Hinweis „alle denken, jemand anders macht es“.</p>'
        + '<p>Sam übernimmt ab jetzt die Kinderkleidung ganz, mit Drandenken. Für den Rauchmelder legt Sam eine Aufgabe an und stellt sich auf „Ich hab’s im Blick“. Was zur Neige geht, lassen beide über die Vorschläge von ToHuus kommen.</p>'],
      ['So hilft ToHuus beim Mental Load',
        '<p>ToHuus ist dafür gebaut, dass nicht eine Person alles im Kopf haben muss. Unter Aufgaben › Wer hat was im Blick steht für die letzten 28 Tage, wer sich um Einkauf, Kochen, Geld und Aufgaben gekümmert hat. Dort stehen nur Namen, alphabetisch und ohne Zahlen. Deine eigene Zahl siehst nur du, Anteile in Prozent erscheinen erst, wenn alle im Haushalt „Anteile vergleichen“ eingeschaltet haben. Darunter steht, welche Aufgaben gerade niemand im Blick hat.</p>'
        + '<p>Bei jeder Aufgabe gibt es „Wer macht es“ und davon getrennt „Ich hab’s im Blick“. Was ihr regelmäßig kauft, merkt sich ToHuus aus Kassenbons und abgehakten Einträgen und schlägt es vor, wenn es wieder fällig ist. Es gibt keine Ranglisten, Sterne nur, wenn ihr sie selbst einschaltet, und private Einträge zählen nie mit. Mehr dazu in der Hilfe unter <a href="../hilfe/aufgaben.html">Aufgaben</a>.</p>'
        + '<p>ToHuus ist gerade in der Beta, einen TestFlight-Platz fragst du auf der <a href="../de/#testflight">Startseite</a> an.</p>'],
    ],
    faq: [
      ['Was ist Mental Load einfach erklärt?', 'Die Denkarbeit hinter dem Haushalt: merken, was gebraucht wird, Möglichkeiten suchen, entscheiden und im Blick behalten, ob es erledigt ist. Sie kostet Kraft, auch wenn man von außen nichts sieht.'],
      ['Tragen wirklich vor allem Frauen den Mental Load?', 'Im Schnitt ja. Laut WSI-Auswertung von 2023 übernehmen erwerbstätige Frauen die Alltagsorganisation mit einer geschätzten Wahrscheinlichkeit von 62 Prozent überwiegend selbst, Männer mit 20 Prozent. In einzelnen Haushalten kann es ganz anders sein.'],
      ['Sieht mein Partner meine Antworten im Denkarbeit-Check?', 'Erst wenn alle im Haushalt dem Vergleich zugestimmt haben. Bis dahin sieht jede Person nur ihre eigenen Antworten.'],
      ['Wie spreche ich Mental Load an, ohne dass es Streit gibt?', 'Fangt bei konkreten Dingen an, nicht bei Gefühlen über den anderen. Eine Liste wie der Denkarbeit-Check hilft, weil es dann um Klopapier und Arzttermine geht und nicht darum, wer mehr tut.'],
      ['Zählt ToHuus, wer wie viel macht?', 'Jede Person sieht nur ihre eigene Zahl. Für alle anderen stehen Namen ohne Zahlen da. Anteile erscheinen erst, wenn alle zustimmen, Punkte und Ranglisten gibt es nicht.'],
    ],
    facts: [
      { value: '43,4 %', text: 'So viel mehr unbezahlte Arbeit leisteten Frauen 2022 als Männer, knapp 29,5 gegenüber 20,5 Stunden pro Woche.', source: 'Destatis 2025', url: 'https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Einkommen-Konsum-Lebensbedingungen/Zeitverwendung/Ergebnisse/_inhalt.html' },
      { value: '62 %', text: 'So wahrscheinlich übernehmen erwerbstätige Frauen die Alltagsorganisation überwiegend selbst, bei Männern sind es 20 Prozent (Modellwerte, 2023).', source: 'WSI 2023', url: 'https://www.boeckler.de/de/pressemitteilungen-2675-alltagsorganisation-bei-paaren-und-familien-51349.htm' },
      { value: '74 %', text: 'Leben Kinder im Haushalt, steigt dieser Wert bei erwerbstätigen Frauen auf 74 Prozent (Modellwert, WSI 2023).', source: 'WSI 2023', url: 'https://www.boeckler.de/de/pressemitteilungen-2675-alltagsorganisation-bei-paaren-und-familien-51349.htm' },
      { value: '4 Teile', text: 'Denkarbeit im Haushalt heißt: Bedarf erkennen, Möglichkeiten suchen, entscheiden und im Blick behalten (Daminger 2019).', source: 'Daminger, ASR 2019', url: 'https://doi.org/10.1177/0003122419859007' },
    ],
    sources: [
      ['Daminger: The Cognitive Dimension of Household Labor, American Sociological Review 84 (4), 2019', 'https://doi.org/10.1177/0003122419859007'],
      ['Ciciolla, Luthar: Invisible Household Labor and Ramifications for Adjustment, Sex Roles 2019', 'https://asu.elsevierpure.com/en/publications/invisible-household-labor-and-ramifications-for-adjustment-mother/'],
      ['Statistisches Bundesamt: Zeitverwendungserhebung 2022, Ergebnisse (revidiert 2025)', 'https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Einkommen-Konsum-Lebensbedingungen/Zeitverwendung/Ergebnisse/_inhalt.html'],
      ['Hans-Böckler-Stiftung: Alltagsorganisation bei Paaren und Familien (WSI Report 87, 2023)', 'https://www.boeckler.de/de/pressemitteilungen-2675-alltagsorganisation-bei-paaren-und-familien-51349.htm'],
      ['Masicampo, Baumeister: Consider it done! Plan making can eliminate the cognitive effects of unfulfilled goals, JPSP 2011', 'https://doi.org/10.1037/a0024192'],
    ],
    help: ['aufgaben', 'haushalt-teilen', 'wer-sieht-was'],
  },

  {
    slug: 'haushalt-mit-adhs', status: 'published', date: '2026-10-14',
    title: 'Haushalt mit ADHS: Was hilft, wenn der Kopf voll ist?',
    desc: 'Mit ADHS ist im Haushalt oft der Anfang das Schwerste. Kleine Schritte, eins nach dem anderen, ein Timer und Erinnerungen außerhalb des Kopfes helfen.',
    answer: 'Mit ADHS hakt es im Haushalt selten am Wollen. Schwer fallen oft das Anfangen, das Planen und das Drandenken. Was vielen hilft: Aufgaben in sehr kleine Schritte teilen, immer nur eine Sache vor sich haben, mit einem kurzen Timer anfangen und Erinnerungen dorthin legen, wo man sie sieht. Das ersetzt keine Diagnose oder Behandlung, kann den Alltag aber spürbar leichter machen.',
    sections: [
      ['Warum der Anfang so schwer ist',
        '<p>Wer ADHS hat, kennt das: Die Küche müsste aufgeräumt werden, man weiß das auch, und trotzdem passiert eine Stunde lang nichts, oder man fängt an und landet beim Sortieren der Gewürze. Das hat wenig mit Faulheit zu tun. Das Institut für Qualität und Wirtschaftlichkeit im Gesundheitswesen schreibt auf <a href="https://www.gesundheitsinformation.de/adhs-bei-erwachsenen.html">gesundheitsinformation.de</a>, dass Erwachsene mit ADHS vor allem Probleme haben, ihren Alltag oder ihre Arbeit zu organisieren, sich länger auf eine Sache zu konzentrieren und Termine einzuhalten.</p>'
        + '<p>Der Haushalt ist dafür eine besonders schwierige Umgebung. Er hat kein Ende, keine Chefin, die eine Frist setzt, und fast alles ist gleichzeitig ein bisschen dran. Ein Tool kann daran nichts heilen. Es kann aber einiges von dem übernehmen, was der Kopf sonst gleichzeitig halten müsste.</p>'],
      ['Wie häufig ADHS bei Erwachsenen ist',
        '<p>Belastbare Zahlen gibt es weniger, als man denkt. Eine repräsentative Befragung von 1.655 Erwachsenen in Deutschland kam 2012 auf 4,7 Prozent mit aktuellen ADHS-Anzeichen (<a href="https://link.springer.com/doi/10.1007/s00406-011-0211-9">de Zwaan und andere</a>). Das beruht auf Fragebögen zur Selbsteinschätzung, nicht auf ärztlichen Diagnosen.</p>'
        + '<p>Diagnosen bei Erwachsenen werden jedenfalls deutlich häufiger. Laut einer <a href="https://www.aerzteblatt.de/archiv/inzidenz-von-adhs-spektrum-stoerungen-bei-erwachsenen">Auswertung des Zentralinstituts für die kassenärztliche Versorgung im Deutschen Ärzteblatt (2025)</a> stieg die Zahl der neuen Diagnosen von rund 8,6 auf 25,7 pro 10.000 gesetzlich Versicherte zwischen 2015 und 2024, besonders bei jungen Frauen. Die Zahlen für 2024 sind noch vorläufig. Für manche kommt die Diagnose also erst als Erwachsene.</p>'],
      ['Kleine Schritte statt großer Aufgaben',
        '<p>„Bad putzen“ ist keine Aufgabe, sondern ein Projekt. „Spiegel abwischen“ ist eine Aufgabe. Je kleiner der erste Schritt, desto eher fängt man an, und nach dem ersten kommt der zweite oft von allein. Auch gesundheitsinformation.de nennt das Aufteilen in kleinere Schritte als einen der Wege, den Alltag leichter zu machen.</p>'
        + '<p>Ähnliche Werkzeuge stecken in psychotherapeutischen Programmen für Erwachsene mit ADHS. In einer <a href="https://doi.org/10.1001/jama.2010.1192">Studie von Safren und anderen (JAMA 2010)</a> mit 86 Erwachsenen, die schon Medikamente nahmen, ging es in den ersten Sitzungen um Kalender, eine feste Aufgabenliste und darum, überwältigende Aufgaben in Schritte zu zerlegen. Die Gruppe mit dieser Therapie hatte danach weniger Beschwerden als die Vergleichsgruppe. Das war eine Therapie mit Fachleuten, keine App, aber es zeigt, dass diese Strategien nicht aus der Luft gegriffen sind.</p>'],
      ['Eine Sache, ein Timer, ein klarer Moment',
        '<p>Eine lange Liste ist für einen vollen Kopf oft schon zu viel. Hilfreicher ist, nur die nächste Sache zu sehen. Ein sichtbarer Timer hilft beim Anfangen: Fünf Minuten sind überschaubar, und wenn der Ring abgelaufen ist, darf man aufhören. Oft macht man dann doch weiter.</p>'
        + '<p>Dazu passt eine der am besten untersuchten Ideen der Psychologie, die Wenn-dann-Pläne. Statt „ich will die Wäsche machen“ heißt es „wenn ich vom Frühstück aufstehe, stelle ich die Maschine an“. Eine <a href="https://doi.org/10.1016/S0065-2601(06)38002-1">Übersicht von Gollwitzer und Sheeran (2006)</a> über 94 Tests fand dafür einen mittleren bis großen Effekt auf das Erreichen von Zielen. Die Studien betrafen aber vor allem Menschen ohne ADHS, für Erwachsene mit ADHS ist die Forschung dünner.</p>'],
      ['Erinnerungen außerhalb des Kopfes',
        '<p>gesundheitsinformation.de rät, Erinnerungshilfen an wichtige Stellen zu legen, etwa an die Haustür oder an den Kühlschrank, und Listen zu machen, damit man nichts vergisst. Die Forschung nennt das kognitives Auslagern: Wer sich vom Handy erinnern lässt, muss die Sache nicht selbst behalten (<a href="https://doi.org/10.1016/j.tics.2016.07.002">Risko und Gilbert 2016</a>).</p>'
        + '<p>Zu viele Erinnerungen bewirken allerdings das Gegenteil. Zwanzig Mitteilungen am Tag erzeugen Stress statt Ordnung. Besser ist eine gebündelte Nachricht zu einer Uhrzeit, die man selbst wählt, und eine Liste, die nicht rot leuchtet, wenn etwas liegen geblieben ist.</p>'],
      ['Ein Beispiel: Sam und der Samstag',
        '<p>Sam fällt das Anfangen schwer, besonders bei großen Aufgaben. Samstags soll das Bad dran sein, und lange war das der Tag, an dem es nicht passierte. Jetzt hat Sam in ToHuus den sanften Modus an. Auf Heute stehen nur drei Sachen, und die Erinnerungen kommen gesammelt um zehn Uhr.</p>'
        + '<p>Um zehn öffnet Sam „Eins nach dem anderen“. Dort steht nur „Bad putzen“ und darunter der erste Schritt: „Spiegel abwischen“. Sam startet den Timer mit fünf Minuten. Danach tippt Sam auf „Geschafft“, der nächste Schritt ist das Waschbecken. Beim Boden ist die Luft raus, Sam tippt auf „Später“. Das Bad ist nicht perfekt, aber zu drei Vierteln sauber, und niemand im Haushalt sieht, dass Sam den sanften Modus nutzt.</p>'],
      ['So hilft ToHuus, wenn der Kopf voll ist',
        '<p>Unter Aufgaben gibt es dafür ein paar Werkzeuge, die allen im Haushalt offenstehen, ohne dass jemand erklären muss, warum er sie nutzt:</p>'
        + '<ul><li><b>Kleine Schritte</b>: Jede Aufgabe lässt sich in Schritte teilen. „In kleine Schritte teilen“ schlägt welche vor, mit KI, wenn euer Haushalt das erlaubt, sonst aus fertigen Schritten für häufige Aufgaben.</li><li><b>Eins nach dem anderen</b>: nur die nächste Aufgabe und darin der nächste Schritt, mit „Geschafft“, „Später“ und „Zu groß? Kleiner machen“.</li><li><b>Sichtbarer Timer</b>: 5, 10, 15 oder 25 Minuten, ein Ring und ein sanftes Signal am Ende. Gespeichert wird nichts.</li><li><b>Sanfter Modus</b>: kein Rot für Überfälliges, „wäre dran“ statt „überfällig“, wenige Sachen auf Heute, Erinnerungen gebündelt einmal am Tag.</li><li><b>Neu anfangen</b>: Überfälliges rückt auf einen frischen Start, zwei Aufgaben pro Tag. Nichts wird als verpasst festgehalten.</li></ul>'
        + '<p>Es gibt keine Streaks und keine Statistik über dich, und im sanften Modus siehst du auch keine Sterne. Deine Einstellungen sieht niemand sonst im Haushalt. ToHuus ist kein Gesundheits- oder Therapieangebot und ersetzt keine Beratung. Mehr dazu in der Hilfe unter <a href="../hilfe/kopf-voll.html">Wenn der Kopf voll ist</a>. ToHuus ist gerade in der Beta, einen TestFlight-Platz fragst du auf der <a href="../de/#testflight">Startseite</a> an.</p>'],
    ],
    faq: [
      ['Warum fällt Menschen mit ADHS der Haushalt so schwer?', 'Weil er viel Planen, Anfangen und Drandenken verlangt, und genau das fällt mit ADHS oft schwer. Mit Faulheit hat das wenig zu tun.'],
      ['Was hilft beim Anfangen?', 'Ein sehr kleiner erster Schritt und ein kurzer Timer, zum Beispiel fünf Minuten. Wer danach aufhören darf, fängt leichter an.'],
      ['Helfen Erinnerungen bei ADHS?', 'Erinnerungen an der richtigen Stelle helfen vielen, so rät es auch gesundheitsinformation.de. Zu viele Mitteilungen stressen aber eher, gebündelt zu einer festen Uhrzeit ist oft besser.'],
      ['Ist ToHuus eine ADHS-App?', 'Nein. ToHuus ist eine Haushalts-App mit Funktionen, die bei vollem Kopf helfen. Sie ersetzt keine Diagnose, Therapie oder Beratung.'],
      ['Sehen die anderen, dass ich den sanften Modus nutze?', 'Nein. Der sanfte Modus ist eine persönliche Einstellung, die niemand sonst im Haushalt sieht.'],
    ],
    facts: [
      { value: '4,7 %', text: 'So viele Erwachsene zwischen 18 und 64 zeigten 2012 in einer repräsentativen Befragung in Deutschland ADHS-Anzeichen (Selbsteinschätzung, keine Diagnose).', source: 'de Zwaan u. a. 2012', url: 'https://link.springer.com/doi/10.1007/s00406-011-0211-9' },
      { value: '25,7', text: 'So viele neue ADHS-Diagnosen pro 10.000 gesetzlich versicherte Erwachsene gab es 2024, nach 8,6 im Jahr 2015 (vorläufig).', source: 'Zi, Ärzteblatt 2025', url: 'https://www.aerzteblatt.de/archiv/inzidenz-von-adhs-spektrum-stoerungen-bei-erwachsenen' },
      { value: '5 Minuten', text: 'Mit einem kurzen, sichtbaren Timer fällt das Anfangen leichter. In ToHuus wird dabei nichts gezählt oder gespeichert.', source: 'ToHuus', url: help('kopf-voll') },
    ],
    sources: [
      ['IQWiG, gesundheitsinformation.de: ADHS bei Erwachsenen', 'https://www.gesundheitsinformation.de/adhs-bei-erwachsenen.html'],
      ['de Zwaan u. a.: The estimated prevalence and correlates of adult ADHD in a German community sample, 2012', 'https://link.springer.com/doi/10.1007/s00406-011-0211-9'],
      ['Deutsches Ärzteblatt: Inzidenz von AD(H)S-Spektrum-Störungen bei Erwachsenen (2025)', 'https://www.aerzteblatt.de/archiv/inzidenz-von-adhs-spektrum-stoerungen-bei-erwachsenen'],
      ['Safren u. a.: Cognitive behavioral therapy vs relaxation with educational support for medication-treated adults with ADHD, JAMA 2010', 'https://doi.org/10.1001/jama.2010.1192'],
      ['Gollwitzer, Sheeran: Implementation intentions and goal achievement, a meta-analysis, 2006', 'https://doi.org/10.1016/S0065-2601(06)38002-1'],
      ['Risko, Gilbert: Cognitive Offloading, Trends in Cognitive Sciences 2016', 'https://doi.org/10.1016/j.tics.2016.07.002'],
    ],
    help: ['kopf-voll', 'aufgaben', 'benachrichtigungen'],
  },

  {
    slug: 'haltbarkeit-lebensmittel-nach-dem-oeffnen', status: 'published', date: '2026-10-14',
    title: 'Wie lange ist was haltbar? MHD, Verbrauchsdatum und nach dem Öffnen',
    desc: 'Nach dem MHD ist vieles noch gut, nach dem Verbrauchsdatum nicht. Was für Eier, Käse, Wurst, Marmelade und Milch gilt, auch nach dem Öffnen.',
    answer: 'Das Mindesthaltbarkeitsdatum (MHD) sagt, bis wann der Hersteller die Qualität garantiert, danach ist vieles noch gut, wenn es richtig gelagert war. Nach dem Verbrauchsdatum („zu verbrauchen bis“) solltet ihr das Lebensmittel nicht mehr essen. Nach dem Öffnen gilt das aufgedruckte Datum nicht mehr, dann helfen Kühlschrank, ein notiertes Öffnungsdatum und Augen, Nase und Zunge.',
    sections: [
      ['MHD oder Verbrauchsdatum: der wichtige Unterschied',
        '<p>Auf fast jeder Packung steht eines von zwei Daten, und sie bedeuten etwas ganz Unterschiedliches. Die <a href="https://www.verbraucherzentrale.de/wissen/lebensmittel/auswaehlen-zubereiten-aufbewahren/mindesthaltbarkeitsdatum-mhd-ist-nicht-gleich-verbrauchsdatum-13452">Verbraucherzentrale</a> und das <a href="https://www.bfr.bund.de/cm/343/essen-nachhaltig-und-sicher-geniessen-so-gehts.pdf">Bundesinstitut für Risikobewertung (BfR)</a> erklären es so:</p>'
        + '<ul><li><b>„Mindestens haltbar bis“</b>: Bis zu diesem Tag garantiert der Hersteller die Qualität. Danach ist vieles noch lange genießbar, wenn es richtig gelagert war. Prüft dann, wie es aussieht, riecht und schmeckt.</li><li><b>„Zu verbrauchen bis“</b>: Steht auf leicht verderblichen Sachen wie Hackfleisch oder frischem Fisch. Nach diesem Tag nicht mehr essen. Krankheitserreger verderben ein Lebensmittel selten sichtbar, man riecht sie also nicht.</li></ul>'
        + '<p>Wichtig für den Alltag: Beide Daten gelten für die geschlossene Packung. Sobald sie offen ist, zählt, wie lange das Lebensmittel nach dem Öffnen hält, und das steht oft nicht oder nur ungenau drauf.</p>'],
      ['Eier',
        '<p>Für rohe Eier ist das MHD fest vorgeschrieben, es liegt 28 Tage nach dem Legen. Im Kühlschrank bei höchstens 7 Grad halten Eier laut <a href="https://www.verbraucherzentrale.de/wissen/lebensmittel/auswaehlen-zubereiten-aufbewahren/eier-haltbarkeit-und-lagerung-58925">Verbraucherzentrale</a> bis zu sechs Wochen. Nach dem MHD solltet ihr sie nur noch gut durchgegart essen, also nicht mehr für Tiramisu oder ein weiches Frühstücksei. Die Kühlschranktür ist für Eier nicht ideal, weil die Temperatur dort beim Öffnen schwankt.</p>'],
      ['Käse und Wurst',
        '<p>Bei Käse und Wurst kommt es vor allem auf die Sorte an. Hartkäse wie Parmesan hält deutlich länger als Frischkäse, Mozzarella oder Aufschnitt in Scheiben. Angeschnittene Salami gehört in den Kühlschrank, sagt die <a href="https://www.verbraucherzentrale.de/tipps-zur-haltbarkeit-und-lagerung-von-lebensmitteln-59515">Verbraucherzentrale</a>, Käse sollte immer abgedeckt liegen.</p>'
        + '<p>Und wenn Schimmel auftaucht? Verschimmelte Wurst und verschimmeltes Fleisch nicht mehr essen, rät das <a href="https://www.bfr.bund.de/cm/343/essen-nachhaltig-und-sicher-geniessen-so-gehts.pdf">BfR</a>. Eine Ausnahme sind luftgetrocknete Salami und Schinken am Stück: Dort darf man die befallene Stelle großzügig wegschneiden, bei Scheiben nicht. Schimmelgereifter Käse wie Camembert ist natürlich in Ordnung, er sollte aber getrennt verpackt sein, damit man echten Schimmel erkennt.</p>'],
      ['Marmelade und Konfitüre',
        '<p>Gekaufte Konfitüre hält ungeöffnet bis zu zwei Jahre, nach dem Öffnen meist mehrere Monate, dann im Kühlschrank (<a href="https://www.verbraucherzentrale.nrw/wissen/lebensmittel/konfituere-und-marmelade-haltbarkeit-und-lagerung-58932">Verbraucherzentrale NRW</a>). Nehmt sie immer mit einem sauberen Löffel heraus, Brotkrümel und Butterreste bringen Schimmel ins Glas. Fruchtaufstriche mit wenig Zucker und selbst gekochte, kalt gerührte Konfitüre halten deutlich kürzer.</p>'],
      ['Milch',
        '<p>Frische Milch sollte bei etwa 5 Grad stehen, ist die Packung offen, darf sie laut Verbraucherzentrale auch in die Kühlschranktür. Ungeöffnete H-Milch hält Monate, geöffnet aber nur noch wenige Tage, genau wie frische Milch. Hafer- und andere Pflanzendrinks gehören nach dem Öffnen ebenfalls in den Kühlschrank und sollten zügig leer werden.</p>'],
      ['Was auf der Packung fehlt',
        '<p>Viele Hersteller schreiben „nach dem Öffnen gekühlt lagern und alsbald verbrauchen“. Wie viele Tage „alsbald“ ist, bleibt offen. Die <a href="https://www.verbraucherzentrale.de/wissen/lebensmittel/lebensmittel-nach-dem-oeffnen-gekuehlt-lagern-angaben-oft-zu-vage-109122">Verbraucherzentrale</a> hat in zwei Marktchecks 230 Produkte bewertet, bei 107 davon stand gar kein Zeitraum für die Zeit nach dem Öffnen. Ihr Rat: Fehlt die Angabe, im Kühlschrank lagern, das Öffnungsdatum notieren und vor dem Essen prüfen.</p>'
        + '<p>Für gekochte Reste rät das BfR, sie innerhalb weniger Stunden auf unter 7 Grad abzukühlen und dann verschlossen in den Kühlschrank zu stellen. Je kälter ein Lebensmittel steht, desto langsamer verdirbt es.</p>'],
      ['Ein Beispiel: der Kühlschrank von Familie Berg',
        '<p>Ben öffnet am Montag ein Glas Pesto und eine Packung Aufschnitt und tippt in ToHuus bei beiden auf „Angebrochen“. Am Donnerstag stehen beide unter „Zuerst essen“, der Aufschnitt weiter oben. Mira kocht abends Nudeln mit dem Pesto, der Aufschnitt wird am Freitag in die Brotdosen gepackt.</p>'
        + '<p>Die Eier vom Wochenmarkt hat Sam ohne Datum eingetragen. ToHuus zeigt bei ihnen „etwa bis“ und den Hinweis „geschätzt“. Als Sam das Datum vom Eierkarton nachträgt, verschwindet der Hinweis.</p>'],
      ['So hilft ToHuus bei der Haltbarkeit',
        '<p>Wer im <a href="../hilfe/vorrat.html">Vorrat</a> Bestand führt, bekommt zu frischen Sachen ein geschätztes Haltbarkeitsdatum, ausgehend von der üblichen Haltbarkeit ab dem Kauf. Das Datum steht als „geschätzt“ da, bis jemand das Datum von der Packung einträgt. Tippst du auf „Angebrochen“, rechnet ToHuus mit der üblichen Haltbarkeit nach dem Öffnen, etwa vier Tage für Milch oder Aufschnitt, und zeigt „hält etwa bis“. Pro Produkt kannst du diese Tage selbst ändern.</p>'
        + '<p>Was bald weg sollte, steht auf Heute unter „Zuerst essen“, und der <a href="../hilfe/kochen.html">Kochplaner</a> schlägt bevorzugt Gerichte damit vor. Reste aus dem Kochen landen auf Wunsch ebenfalls dort, am besten innerhalb von drei Tagen. Alle Schätzungen sind Richtwerte und ersetzen nie den Blick auf die Packung und den eigenen Geruchssinn. Beim Verbrauchsdatum gilt immer das, was aufgedruckt ist.</p>'
        + '<p>ToHuus ist gerade in der Beta, einen TestFlight-Platz fragst du auf der <a href="../de/#testflight">Startseite</a> an.</p>'],
    ],
    faq: [
      ['Kann ich Lebensmittel nach dem MHD noch essen?', 'Oft ja, wenn sie richtig gelagert und ungeöffnet waren. Prüft Aussehen, Geruch und Geschmack. Nach dem Verbrauchsdatum dagegen nicht mehr essen.'],
      ['Wie lange halten Eier im Kühlschrank?', 'Laut Verbraucherzentrale bis zu sechs Wochen bei höchstens 7 Grad. Nach dem MHD, 28 Tage nach dem Legen, nur noch gut durchgegart essen.'],
      ['Wie lange hält offene Marmelade?', 'Gekaufte Konfitüre meist mehrere Monate im Kühlschrank, wenn ihr sie mit einem sauberen Löffel herausnehmt. Fruchtaufstriche mit wenig Zucker halten kürzer.'],
      ['Gilt das MHD auch nach dem Öffnen?', 'Nein. Das Datum gilt für die geschlossene Packung. Danach zählt die Angabe nach dem Öffnen, und wenn die fehlt: kühl lagern, Öffnungsdatum notieren, vor dem Essen prüfen.'],
      ['Woher hat ToHuus die Haltbarkeit?', 'Aus Richtwerten für übliche Lebensmittel. Sie stehen als geschätzt da, bis ihr das Datum von der Packung eintragt, und lassen sich pro Produkt ändern.'],
    ],
    facts: [
      { value: '28 Tage', text: 'So lange nach dem Legen liegt das vorgeschriebene Mindesthaltbarkeitsdatum von rohen Eiern.', source: 'Verbraucherzentrale 2026', url: 'https://www.verbraucherzentrale.de/wissen/lebensmittel/auswaehlen-zubereiten-aufbewahren/eier-haltbarkeit-und-lagerung-58925' },
      { value: '6 Wochen', text: 'Bis zu so lange halten Eier im Kühlschrank bei höchstens 7 Grad. Nach dem MHD nur noch gut durchgegart essen.', source: 'Verbraucherzentrale 2026', url: 'https://www.verbraucherzentrale.de/wissen/lebensmittel/auswaehlen-zubereiten-aufbewahren/eier-haltbarkeit-und-lagerung-58925' },
      { value: '107 von 230', text: 'Bei so vielen geprüften Produkten stand kein Zeitraum, wie lange sie nach dem Öffnen halten (Marktchecks 2018 und 2023).', source: 'Verbraucherzentrale 2025', url: 'https://www.verbraucherzentrale.de/wissen/lebensmittel/lebensmittel-nach-dem-oeffnen-gekuehlt-lagern-angaben-oft-zu-vage-109122' },
      { value: '74,5 kg', text: 'So viele Lebensmittel warf jede Person 2022 im eigenen Haushalt weg, Schalen und Kaffeesatz mitgezählt.', source: 'Umweltbundesamt 2025', url: 'https://umweltbundesamt.de/themen/abfall-ressourcen/abfallwirtschaft/abfallvermeidung/lebensmittelabfaelle' },
    ],
    sources: [
      ['Verbraucherzentrale: Mindesthaltbarkeitsdatum (MHD) ist nicht gleich Verbrauchsdatum', 'https://www.verbraucherzentrale.de/wissen/lebensmittel/auswaehlen-zubereiten-aufbewahren/mindesthaltbarkeitsdatum-mhd-ist-nicht-gleich-verbrauchsdatum-13452'],
      ['Verbraucherzentrale: Eier, alles zu Lagerung und Haltbarkeit', 'https://www.verbraucherzentrale.de/wissen/lebensmittel/auswaehlen-zubereiten-aufbewahren/eier-haltbarkeit-und-lagerung-58925'],
      ['Verbraucherzentrale: Tipps zur Haltbarkeit und Lagerung von Lebensmitteln', 'https://www.verbraucherzentrale.de/tipps-zur-haltbarkeit-und-lagerung-von-lebensmitteln-59515'],
      ['Verbraucherzentrale NRW: Konfitüre und Marmelade, Haltbarkeit und Lagerung', 'https://www.verbraucherzentrale.nrw/wissen/lebensmittel/konfituere-und-marmelade-haltbarkeit-und-lagerung-58932'],
      ['Verbraucherzentrale: Lebensmittel nach dem Öffnen „gekühlt lagern“, Angaben oft zu vage (2025)', 'https://www.verbraucherzentrale.de/wissen/lebensmittel/lebensmittel-nach-dem-oeffnen-gekuehlt-lagern-angaben-oft-zu-vage-109122'],
      ['Bundesinstitut für Risikobewertung: Essen nachhaltig und sicher genießen, so geht’s', 'https://www.bfr.bund.de/cm/343/essen-nachhaltig-und-sicher-geniessen-so-gehts.pdf'],
      ['Umweltbundesamt: Lebensmittelabfälle', 'https://umweltbundesamt.de/themen/abfall-ressourcen/abfallwirtschaft/abfallvermeidung/lebensmittelabfaelle'],
    ],
    help: ['vorrat', 'kochen'],
  },

  {
    slug: 'infos-fuer-gaeste-wlan-kaffeemaschine', status: 'published', date: '2026-10-14',
    title: 'Infos für Babysitter und Gäste: vom WLAN bis zur Kaffeemaschine',
    desc: 'Was Besuch, Großeltern und Babysitter bei euch wissen müssen, schreibt ihr einmal auf: WLAN, Geräte, Hausregeln. Codes wie der Türcode bleiben getrennt.',
    answer: 'Schreibt einmal auf, was Gäste bei euch immer wieder fragen: WLAN, Heizung, Dusche, Kaffeemaschine, Müll und ein paar Hausregeln, gern mit Foto oder kurzem Video. Teilt das als Link statt als Zettel am Kühlschrank. Codes wie WLAN-Passwort oder Türcode gebt ihr getrennt davon frei, nur an die, die sie brauchen, und nur so lange wie nötig.',
    sections: [
      ['Was Gäste wirklich fragen',
        '<p>Wer bei euch übernachtet oder auf die Kinder aufpasst, fragt fast immer dasselbe. Wie ist das WLAN? Wie geht die Dusche warm? Wo sind die Filter für die Kaffeemaschine? Wann kommt die Mülltonne raus? Jede Frage für sich ist schnell beantwortet, aber wenn die Großeltern zum dritten Mal im Jahr kommen, beantwortet ihr sie zum dritten Mal.</p>'
        + '<p>Einmal aufschreiben spart euch das, und Gäste müssen nicht nachfragen, wenn ihr schon schlaft oder unterwegs seid. Für Babysitter gehören dazu noch Notrufnummern und die Abläufe der Kinder. Dazu steht mehr im Beitrag <a href="babysitter-infoblatt.html">Infoblatt für Babysitter</a>.</p>'],
      ['Das WLAN: am besten ein eigenes für Gäste',
        '<p>Das Bundesamt für Sicherheit in der Informationstechnik empfiehlt in seiner <a href="https://www.bsi.bund.de/DE/Themen/Verbraucherinnen-und-Verbraucher/Informationen-und-Empfehlungen/Cyber-Sicherheitsempfehlungen/Router-WLAN-VPN/Schritt-fuer-Schritt-zum-Gaeste-WLAN/Schritt-fuer-Schritt-zum-Gaeste-WLAN_node.html">Anleitung zum Gäste-WLAN</a>, Besuch ein eigenes Netz zu geben. Das trennt eure Geräte von denen eurer Gäste, auch wenn auf deren Handy mal Schadsoftware sein sollte. Die meisten Router haben dafür unter WLAN einen Punkt „Gastzugang“.</p>'
        + '<ul><li>Das Passwort sollte laut BSI aus mindestens 20 zusammenhanglosen Zeichen bestehen.</li><li>Hängt die Zugangsdaten nirgends aus, sondern gebt sie weiter, wenn jemand fragt.</li><li>Ein QR-Code erspart das Abtippen. Viele Router erzeugen ihn selbst.</li></ul>'
        + '<p>Zwanzig zufällige Zeichen tippt niemand gern ab. Mit QR-Code ist das egal, das Handy ist nach einem Scan im Netz.</p>'],
      ['So geht’s hier: Geräte kurz erklärt',
        '<p>Die meisten Fragen betreffen Geräte, die bei euch selbstverständlich sind. Für jedes reichen zwei, drei Sätze, und bei manchen sagt ein Foto mehr:</p>'
        + '<ul><li>Kaffeemaschine: wo Bohnen und Filter sind, welcher Knopf was macht, wie man entkalkt, falls sie piept</li><li>Heizung und Dusche: wie es warm wird und wie lange das dauert</li><li>Waschmaschine und Spülmaschine: welches Programm ihr normalerweise nehmt</li><li>Fernseher: welche Fernbedienung, welcher Eingang</li><li>Rollläden und Licht, besonders wenn sie per App oder Sprachbefehl laufen</li><li>Müll: was in welche Tonne gehört und wann sie raus muss</li></ul>'
        + '<p>Ein kurzes Video ist bei Geräten oft schneller als jeder Text. Zehn Sekunden, in denen man sieht, wie die Heizung entlüftet wird, ersparen einen Anruf am Abend.</p>'],
      ['Codes gehören nicht an den Kühlschrank',
        '<p>WLAN-Passwort, Code für die Haustür, das Schließfach im Keller oder die Alarmanlage sind etwas anderes als die Anleitung für die Kaffeemaschine. Einen Zettel am Kühlschrank sehen auch Handwerker, Nachbarn und alle, die mal kurz reinkommen. Trennt deshalb die Infos von den Codes:</p>'
        + '<ul><li>Infos dürfen alle sehen, die bei euch zu Gast sind.</li><li>Codes nur, wer sie wirklich braucht, und nur so lange, wie sie gebraucht werden.</li><li>Auf einem Ausdruck steht statt des Codes besser „bitte fragen“.</li></ul>'
        + '<p>Ändert Codes nach einem langen Besuch oder einem Wechsel bei der Kinderbetreuung, wenn das bei eurem Schloss geht. Beim Gäste-WLAN reicht oft ein neues Passwort.</p>'],
      ['Ein Beispiel: Oma und Opa übernachten bei Familie Berg',
        '<p>Die Großeltern kommen übers Wochenende, Mira und Sam sind am Samstagabend auf einer Hochzeit. Mira schickt am Donnerstag einen Link. Darin stehen das Gäste-WLAN „Berg-Gast“, eine Karte „Kaffeemaschine“ mit einem kurzen Video, wie man den Wassertank einsetzt, eine Karte „Dusche im Gästebad“ und eine Karte „Was Mika darf“.</p>'
        + '<p>Den Code für die Haustür gibt Mira nur für dieses Wochenende frei. Opa tippt am Samstag auf „Zeigen“, und Mira sieht später, dass der Code einmal angezeigt wurde. Am Montag ist er für den Link wieder gesperrt, und die Kaffeemaschine hat niemand verstellt.</p>'],
      ['So hilft ToHuus mit der Hausinfo',
        '<p>Unter Zuhause › Hausinfo legt ihr Karten an, nach Raum oder nach Art sortiert: Gäste-WLAN, So geht’s hier, Hausregeln und Kinder, Notfall, Sprachbefehle. Jede Karte kann bis zu acht Fotos oder kurze Videos haben. Pro Karte legt ihr fest, wer sie sieht, zum Beispiel alle, die hier wohnen, feste Gäste oder bestimmte Gast-Links. Vorlagen helfen beim Anfangen.</p>'
        + '<p>Codes liegen getrennt von den Karten. Sie sind verdeckt, bis jemand auf „Zeigen“ tippt, beim Gäste-WLAN erscheint dazu ein QR-Code zum Scannen. Gäste bekommen einen Code nur, wenn ihr ihn freigebt, auf Wunsch bis zu einem Datum. Ihr seht, wer einen Code wann angezeigt hat, und Codes gehen nie an den Assistenten, an KI-Assistenten über MCP oder an Home Assistant, und in einen Export nur, wenn ein Admin das ausdrücklich ankreuzt.</p>'
        + '<p>Gäste brauchen keine App und kein Konto, sie öffnen einen <a href="../hilfe/babysitter.html">Link oder QR-Code</a>. Einmal geöffnet ist die Hausinfo auch ohne Netz lesbar, und über „Drucken“ wird ein A4-Blatt daraus, auf dem statt der Codes „bitte fragen“ steht. ToHuus ist gerade in der Beta, einen TestFlight-Platz fragst du auf der <a href="../de/#testflight">Startseite</a> an.</p>'],
    ],
    faq: [
      ['Sollte ich Gästen mein normales WLAN geben?', 'Besser nicht. Das BSI empfiehlt ein eigenes Gäste-WLAN, das eure Geräte vom Besuch trennt. Die meisten Router haben dafür einen Gastzugang.'],
      ['Wie teile ich das WLAN-Passwort am einfachsten?', 'Als QR-Code. Gäste scannen ihn mit der Kamera und sind im Netz, auch bei einem langen Passwort.'],
      ['Was gehört in eine Gästemappe?', 'WLAN, wie Heizung, Dusche und Kaffeemaschine gehen, wann der Müll rausgeht, ein paar Hausregeln und wichtige Nummern. Codes gehören getrennt davon.'],
      ['Brauchen Gäste für die Hausinfo eine App?', 'Bei ToHuus nicht. Sie öffnen einen Link oder QR-Code, ohne App und ohne Konto, und können die Hausinfo auch ausgedruckt bekommen.'],
    ],
    facts: [
      { value: '20 Zeichen', text: 'So lang sollte ein WLAN-Passwort laut BSI mindestens sein, aus zusammenhanglosen Zeichen, auch beim Gäste-WLAN.', source: 'BSI 2026', url: 'https://www.bsi.bund.de/DE/Themen/Verbraucherinnen-und-Verbraucher/Informationen-und-Empfehlungen/Cyber-Sicherheitsempfehlungen/Router-WLAN-VPN/Schritt-fuer-Schritt-zum-Gaeste-WLAN/Schritt-fuer-Schritt-zum-Gaeste-WLAN_node.html' },
      { value: 'Nicht aushängen', text: 'Zugangsdaten fürs WLAN nirgends aushängen, sondern auf Nachfrage weitergeben, zum Beispiel per QR-Code, rät das BSI.', source: 'BSI 2026', url: 'https://www.bsi.bund.de/DE/Themen/Verbraucherinnen-und-Verbraucher/Informationen-und-Empfehlungen/Cyber-Sicherheitsempfehlungen/Router-WLAN-VPN/Schritt-fuer-Schritt-zum-Gaeste-WLAN/Schritt-fuer-Schritt-zum-Gaeste-WLAN_node.html' },
      { value: 'Ohne App', text: 'Gäste öffnen die Hausinfo von ToHuus über einen Link oder QR-Code, ohne App und ohne Konto, auch offline lesbar.', source: 'ToHuus', url: help('hausinfo') },
    ],
    sources: [
      ['BSI: Schritt für Schritt zum Gäste-WLAN', 'https://www.bsi.bund.de/DE/Themen/Verbraucherinnen-und-Verbraucher/Informationen-und-Empfehlungen/Cyber-Sicherheitsempfehlungen/Router-WLAN-VPN/Schritt-fuer-Schritt-zum-Gaeste-WLAN/Schritt-fuer-Schritt-zum-Gaeste-WLAN_node.html'],
    ],
    help: ['hausinfo', 'hausinfo-codes', 'babysitter'],
  },

  {
    slug: 'spontankaeufe-wochenbudget-extras', status: 'published', date: '2026-10-14',
    title: 'Spontankäufe im Griff: So klappt ein Wochenbudget für Extras',
    desc: 'Süßes, Chips, Eis und Getränke landen gern spontan im Wagen. Ein festes Wochenbudget für Extras hilft, ohne Verbote und ohne schlechtes Gewissen.',
    answer: 'Legt fest, was bei euch als Extra zählt, etwa Süßes, Knabberzeug, Eis und Getränke, und gebt dem einen festen Betrag oder eine feste Anzahl pro Woche. Dann seht ihr beim Einkaufen, wie viel davon schon verplant ist, und entscheidet bewusst. Verboten wird dabei nichts, ihr behaltet nur den Überblick.',
    sections: [
      ['Was als Extra zählt',
        '<p>Extras sind die Dinge, die nicht auf dem Plan standen und trotzdem mitkommen. Bei den meisten sind das Schokolade, Chips, Gummibärchen, Eis, Limo, Bier oder Wein. Bei euch gehört vielleicht der Coffee to go dazu oder die Zeitschrift an der Kasse, und das Bier zählt nicht, weil es fest eingeplant ist.</p>'
        + '<p>Genau das ist der erste Schritt: Klärt im Haushalt, was ihr als Extra rechnet. Es gibt keine richtige Liste, nur eure.</p>'],
      ['Was Haushalte dafür ausgeben',
        '<p>Laut <a href="https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/06/PD26_204_639.html">Statistischem Bundesamt</a> gaben private Haushalte in Deutschland 2023 im Schnitt rund 335 Euro im Monat für Nahrungsmittel aus. Davon gingen 8 Prozent an Zucker und Süßwaren. Für Getränke kamen rund 75 Euro im Monat dazu, 45 Prozent davon für alkoholische, also knapp 35 Euro.</p>'
        + '<p>Das sind Durchschnittswerte über alle Haushalte, vom Single bis zur Großfamilie, und ohne Restaurant und Café. Euer eigener Wert kann ganz anders aussehen. Wie viel bei euch in Extras fließt, zeigen eure Kassenbons am verlässlichsten.</p>'],
      ['Warum ein eigenes Budget hilft',
        '<p>Menschen führen im Kopf gern getrennte Töpfe, für Urlaub, für Kleidung, für Essen. Die Forscher Chip Heath und Jack Soll haben 1996 gezeigt, dass solche Töpfe tatsächlich das Kaufverhalten lenken. In ihren <a href="https://doi.org/10.1086/209465">Studien im Journal of Consumer Research</a> kauften Leute in einer Kategorie weniger, wenn ihr Topf dafür schon gut gefüllt war, und das umso deutlicher, je typischer der Kauf für die Kategorie war.</p>'
        + '<p>Das waren Experimente mit einzelnen Personen in den USA, keine Haushaltsstudie. Die Idee ist trotzdem einfach übertragbar. Wer weiß, dass für Extras diese Woche noch 6 Euro übrig sind, entscheidet sich vor dem Süßigkeitenregal bewusster, als wer gar keinen Rahmen hat.</p>'],
      ['Betrag oder Anzahl',
        '<p>Ein Budget in Euro passt gut für Erwachsene und für Haushalte, die eh auf das Geld schauen. Eine Anzahl ist oft einfacher, gerade mit Kindern: fünf Extras pro Woche, egal ob Eis oder Gummibärchen. Kinder verstehen „noch zwei“ schneller als „noch 3,40 Euro“.</p>'
        + '<p>Fangt großzügig an. Ein Budget, das schon am Dienstag aufgebraucht ist, frustriert und wird nach zwei Wochen ignoriert. Schaut nach einem Monat, ob es passt, und dreht dann nach.</p>'],
      ['Tipps gegen Spontankäufe',
        '<p>Die <a href="https://www.verbraucherzentrale.de/wissen/lebensmittel/einkaufsfallen-im-supermarkt-diese-tricks-sollen-zum-kauf-verfuehren-48915">Verbraucherzentrale</a> nennt ein paar einfache Mittel gegen die Einkaufsfallen im Supermarkt:</p>'
        + '<ul><li>mit Einkaufsliste losgehen und vorher planen</li><li>nicht hungrig einkaufen</li><li>bei Aktionen den Grundpreis pro Kilo oder Liter vergleichen</li></ul>'
        + '<p>Dazu kommt die Kasse. Dort liegen Süßigkeiten genau in Kinderhöhe. Wer vorher abmacht, ob und was es heute an der Kasse gibt, erspart sich die Diskussion in der Schlange.</p>'],
      ['Ein Beispiel: die Extras von Familie Berg',
        '<p>Familie Berg hat sich auf 15 Euro pro Woche für Extras geeinigt. Am Montag setzt Mika „Eis“ auf die Liste, Ben ergänzt „Chips“ für den Spieleabend. ToHuus erkennt beides als Extra und zeigt auf der Liste, dass 7,50 Euro von 15 Euro verplant sind, gerechnet mit den Preisen vom letzten Einkauf.</p>'
        + '<p>Am Donnerstag will Sam im Laden noch Schokolade mitnehmen und sieht, dass noch gut 4 Euro übrig sind. Die Schokolade kommt mit, die zweite Tüte Gummibärchen bleibt im Regal. Hätte Sam sie trotzdem genommen, wäre auch nichts passiert. Die Liste hätte nur gezeigt, dass das Budget diese Woche etwas überzogen ist.</p>'],
      ['So hilft ToHuus mit den Extras',
        '<p>Unter Extras im Wocheneinkauf legt ihr ein Kontingent pro Woche fest, als Betrag oder als Anzahl. ToHuus erkennt typische Extras von selbst, etwa Sachen aus Snacks & Süßes oder Eis, oder Schokolade, Chips, Cola, Bier und Wein. Backschokolade oder Weinessig zählen nicht. Ihr könnt jeden Eintrag von Hand als Extra markieren oder davon befreien, ToHuus merkt sich das für das nächste Mal.</p>'
        + '<p>Beim Betrag rechnet ToHuus mit euren Kassenbons dieser Woche, mit abgehakten Einträgen und mit dem, was noch auf der Liste steht, bewertet mit dem Preis vom letzten Kauf. ToHuus sperrt nichts, und es wird nichts rot. Private Einträge zählen nur für die, die sie sehen dürfen. Mehr dazu in der Hilfe unter <a href="../hilfe/kopf-voll.html">Wenn der Kopf voll ist</a> und <a href="../hilfe/geld.html">Geld</a>.</p>'
        + '<p>ToHuus ist gerade in der Beta, einen TestFlight-Platz fragst du auf der <a href="../de/#testflight">Startseite</a> an.</p>'],
    ],
    faq: [
      ['Wie hoch sollte ein Budget für Extras sein?', 'Schaut in eure Kassenbons der letzten Wochen und setzt das Budget etwas darunter an. Fangt lieber großzügig an und dreht nach einem Monat nach.'],
      ['Betrag oder Anzahl, was ist besser?', 'Ein Betrag passt für Erwachsene, eine Anzahl ist mit Kindern oft einfacher, etwa fünf Extras pro Woche.'],
      ['Was zählt bei ToHuus als Extra?', 'Was ihr markiert. Von selbst erkennt ToHuus typische Extras wie Süßes, Knabberzeug, Eis und Getränke wie Cola, Bier oder Wein.'],
      ['Verbietet ToHuus Einkäufe, wenn das Budget weg ist?', 'Nein. ToHuus sperrt nichts und färbt nichts rot. Es zeigt nur, wie viel schon verplant ist, entscheiden tut ihr.'],
    ],
    facts: [
      { value: '335 €', text: 'So viel gaben private Haushalte in Deutschland 2023 im Schnitt pro Monat für Nahrungsmittel aus, ohne Restaurant und Café.', source: 'Destatis 2026', url: 'https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/06/PD26_204_639.html' },
      { value: '8 %', text: 'So viel der Ausgaben für Nahrungsmittel ging 2023 an Zucker und Süßwaren.', source: 'Destatis 2026', url: 'https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/06/PD26_204_639.html' },
      { value: '75 €', text: 'So viel gaben Haushalte 2023 im Schnitt pro Monat für Getränke aus, 45 Prozent davon für alkoholische.', source: 'Destatis 2026', url: 'https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/06/PD26_204_639.html' },
    ],
    sources: [
      ['Statistisches Bundesamt: Gut ein Fünftel der Nahrungsmittelausgaben entfallen auf Fleisch und Fisch (2026)', 'https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/06/PD26_204_639.html'],
      ['Heath, Soll: Mental Budgeting and Consumer Decisions, Journal of Consumer Research 1996', 'https://doi.org/10.1086/209465'],
      ['Verbraucherzentrale: Einkaufsfallen im Supermarkt', 'https://www.verbraucherzentrale.de/wissen/lebensmittel/einkaufsfallen-im-supermarkt-diese-tricks-sollen-zum-kauf-verfuehren-48915'],
    ],
    help: ['kopf-voll', 'einkaufsliste', 'geld'],
  },

  {
    slug: 'putzplan-wg-paar-familie', status: 'published', date: '2026-10-14',
    title: 'Putzplan ohne Punkte und Streit: für WG, Paar und Familie',
    desc: 'Ein Putzplan klappt, wenn jede Aufgabe einen Rhythmus hat, klar ist, wer dran ist und wer dran denkt, und niemand Punkte zählt. So geht es in WG, Paar und Familie.',
    answer: 'Ein Putzplan klappt, wenn jede Aufgabe einen eigenen Rhythmus hat, klar ist, wer sie macht, und jemand sie im Blick hat. Wer sich abwechselt, gibt die Aufgabe nach dem Erledigen einfach weiter. Punkte, Ranglisten und Strichlisten braucht es dafür nicht, die sorgen eher für neuen Streit.',
    sections: [
      ['Warum Putzen so oft Streit bringt',
        '<p>Über wenig wird in Wohngemeinschaften und Beziehungen so zuverlässig gestritten wie über den Abwasch. Das hat Gründe. In einer <a href="https://www.pewresearch.org/short-reads/2016/11/30/sharing-chores-a-key-to-good-marriage-say-majority-of-married-adults/">Umfrage des Pew Research Center</a> nannten 56 Prozent der Verheirateten in den USA das Teilen der Hausarbeit „sehr wichtig“ für eine gute Ehe, mehr als gemeinsame Kinder (43 Prozent).</p>'
        + '<p>In Deutschland verbringen Frauen laut <a href="https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Einkommen-Konsum-Lebensbedingungen/Zeitverwendung/Ergebnisse/_inhalt.html">Zeitverwendungserhebung 2022</a> knapp 13 Stunden pro Woche mit klassischer Hausarbeit wie Kochen, Putzen und Wäsche, Männer deutlich weniger. Und selbst wo das Machen fair geteilt ist, bleibt das Drandenken oft an einer Person hängen. Mehr dazu im Beitrag <a href="mental-load-haushalt-fair-verteilen.html">Mental Load im Haushalt</a>.</p>'],
      ['Rhythmus statt starrer Wochentabelle',
        '<p>Der klassische Putzplan ist eine Tabelle mit Wochentagen. Das Problem: Nicht alles muss jede Woche passieren. Das Bad vielleicht schon, die Bettwäsche alle zwei Wochen, die Fenster ein paar Mal im Jahr und das Altglas, wenn es voll ist. Besser funktioniert ein Plan, in dem jede Aufgabe ihren eigenen Rhythmus hat:</p>'
        + '<ul><li><b>fester Tag</b>, etwa „Müll rausbringen jeden Dienstag“, weil die Abfuhr nicht wartet</li><li><b>Abstand ab dem letzten Mal</b>, etwa „Bad alle sieben Tage“, gezählt ab dem Tag, an dem es zuletzt geputzt wurde</li><li><b>bei Bedarf</b>, ohne Datum, etwa „Altglas wegbringen“</li></ul>'
        + '<p>Nach ein paar Wochen merkt ihr, wie oft ihr etwas wirklich macht. Wenn das Bad im Schnitt alle neun Tage dran ist, ist ein Plan mit sieben Tagen vielleicht einfach zu ehrgeizig. Das ist eine Erkenntnis, kein Versagen.</p>'],
      ['Abwechseln, ohne Punkte zu zählen',
        '<p>Viele Putzplan-Apps vergeben Punkte für erledigte Aufgaben und zeigen, wer vorne liegt. Das klingt motivierend, führt aber leicht zu einer neuen Diskussion: Ist Bad putzen mehr wert als Staubsaugen? Und warum hat Ben diese Woche 40 Punkte und ich nur 25? Wir halten das für den falschen Weg, und ToHuus verzichtet deshalb ganz darauf.</p>'
        + '<p>Einfacher ist Abwechseln. Wer das Bad geputzt hat, gibt es an die nächste Person weiter, und alle sehen, wer gerade dran ist. Wer einmal tauscht, tauscht eben. Daneben hilft, zwei Fragen getrennt zu beantworten: Wer macht es? Und wer hat es im Blick? Beim Rauchmelder muss nicht die Person, die ihn testet, auch daran denken.</p>'],
      ['WG, Paar oder Familie: was jeweils hilft',
        '<p><b>In der WG</b> funktioniert Abwechseln am besten, und zwar für die gemeinsamen Räume. Was in den eigenen Zimmern passiert, gehört nicht in den Plan. Wer neu einzieht, wird einfach in die Reihe aufgenommen.</p>'
        + '<p><b>Als Paar</b> klappt es oft besser, ganze Bereiche aufzuteilen, statt jede Woche neu zu tauschen. Eine Person hat Wäsche und Bad, die andere Küche und Müll, inklusive Drandenken. Einmal im Monat kurz schauen, ob das noch passt.</p>'
        + '<p><b>In der Familie</b> können Kinder je nach Alter kleine Aufgaben übernehmen, den Tisch decken, die Spülmaschine ausräumen, das eigene Zimmer. Große Aufgaben werden für Kinder leichter, wenn sie in kleine Schritte geteilt sind.</p>'],
      ['Erinnerungen da, wo ihr sie seht',
        '<p>Ein Plan an der Kühlschranktür wird nach drei Wochen zur Tapete. Erinnerungen wirken besser, wenn sie dort auftauchen, wo ihr eh schaut. Für viele ist das die Erinnerungen-App auf dem Handy oder der Kalender, den sie ohnehin nutzen. Wichtig ist nur, dass ein Häkchen dort auch im Putzplan ankommt, sonst pflegt ihr zwei Listen.</p>'],
      ['Ein Beispiel: der Putzplan von Familie Berg',
        '<p>Bei Familie Berg gibt es fünf feste Aufgaben. Das Bad wird jeden Samstag geputzt, Mira und Sam abwechselnd. Den Müll bringt Ben jeden Dienstag raus, Sam hat das im Blick und kennt den Abfuhrkalender. Mika räumt alle zwei Tage die Spülmaschine aus, die Aufgabe hat drei kleine Schritte: Besteck, Teller, Gläser. Bettwäsche ist alle zwei Wochen dran, Altglas bei Bedarf.</p>'
        + '<p>Als Mira am Samstag das Bad geputzt hat, hakt Mira es in Apple Erinnerungen ab. In ToHuus ist die Aufgabe erledigt und steht für den nächsten Samstag bei Sam. Niemand hat Punkte, niemand führt Strichlisten, und Mika bekommt keine Sterne fürs Ausräumen, aber ein Danke.</p>'],
      ['So hilft ToHuus beim Putzplan',
        '<p>Unter Zuhause › Aufgaben legt ihr Aufgaben einmal, immer wieder oder bei Bedarf an, mit festen Wochentagen oder einem Abstand ab dem letzten Erledigen. Vorlagen für die üblichen Hausarbeiten helfen beim Anfangen, und Unterpunkte stehen nach dem Erledigen beim nächsten Mal wieder offen da. Bei „Wer macht es“ wählt ihr ein Mitglied, ein Kind aus euren Kinderprofilen oder „Wer gerade Zeit hat“, mit „Abwechselnd“ gibt „Erledigt“ die Aufgabe an die nächste Person weiter. Unabhängig davon kann jemand sagen „Ich hab’s im Blick“.</p>'
        + '<p>Nach ein paar Malen zeigt ToHuus, wie oft ihr eine Aufgabe wirklich macht. Mit einem Passwort erscheinen eure Aufgaben in Apple Erinnerungen und im Apple Kalender, in beide Richtungen, für Google Kalender und Outlook gibt es ein Kalender-Abo. Punkte, Ranglisten und Belohnungen gibt es nicht. Mehr dazu in der Hilfe unter <a href="../hilfe/aufgaben.html">Aufgaben</a> und <a href="../hilfe/erinnerungen-spiegeln.html">Erinnerungen und Kalender</a>.</p>'
        + '<p>ToHuus ist gerade in der Beta, einen TestFlight-Platz fragst du auf der <a href="../de/#testflight">Startseite</a> an.</p>'],
    ],
    faq: [
      ['Wie erstelle ich einen fairen Putzplan?', 'Sammelt alle Aufgaben, gebt jeder einen eigenen Rhythmus und legt fest, wer sie macht und wer sie im Blick hat. Bei gemeinsamen Räumen hilft Abwechseln.'],
      ['Wie oft sollte man das Bad putzen?', 'Das legt ihr selbst fest, viele nehmen einmal pro Woche. ToHuus zeigt nach ein paar Wochen, wie oft ihr es wirklich macht, dann könnt ihr den Plan anpassen.'],
      ['Braucht ein Putzplan Punkte oder Belohnungen?', 'Nein. Punkte führen leicht zu Streit darüber, was wie viel wert ist. Abwechseln und klare Zuständigkeiten sind einfacher.'],
      ['Kann ich den Putzplan in Apple Erinnerungen sehen?', 'Ja. Mit einem Passwort erscheinen eure Aufgaben in Apple Erinnerungen. Ein Häkchen dort erledigt die Aufgabe auch in ToHuus.'],
      ['Wie beziehe ich Kinder ein?', 'Mit kleinen, klaren Aufgaben passend zum Alter, aufgeteilt in Schritte. In ToHuus legt ihr Kinderprofile an und tragt sie bei „Wer macht es“ ein.'],
    ],
    facts: [
      { value: '56 %', text: 'So viele Verheiratete in den USA nannten 2016 das Teilen der Hausarbeit sehr wichtig für eine gute Ehe, mehr als Kinder (43 Prozent).', source: 'Pew Research 2016', url: 'https://www.pewresearch.org/short-reads/2016/11/30/sharing-chores-a-key-to-good-marriage-say-majority-of-married-adults/' },
      { value: '13 Stunden', text: 'So viel Zeit verbrachten Frauen 2022 pro Woche mit klassischer Hausarbeit wie Kochen, Putzen und Wäsche, Männer deutlich weniger.', source: 'Destatis 2025', url: 'https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Einkommen-Konsum-Lebensbedingungen/Zeitverwendung/Ergebnisse/_inhalt.html' },
      { value: '0 Ranglisten', text: 'ToHuus führt keine Ranglisten und keine Serien. Sterne gibt es nur, wenn ihr sie einschaltet, und dann zählt vor allem eure Woche zusammen.', source: 'ToHuus', url: help('aufgaben') },
    ],
    sources: [
      ['Pew Research Center: Sharing chores a key to good marriage, say majority of married adults (2016)', 'https://www.pewresearch.org/short-reads/2016/11/30/sharing-chores-a-key-to-good-marriage-say-majority-of-married-adults/'],
      ['Statistisches Bundesamt: Zeitverwendungserhebung 2022, Ergebnisse (revidiert 2025)', 'https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Einkommen-Konsum-Lebensbedingungen/Zeitverwendung/Ergebnisse/_inhalt.html'],
    ],
    help: ['aufgaben', 'erinnerungen-spiegeln'],
  },
];
