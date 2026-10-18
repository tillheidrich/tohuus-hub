/**
 * "Hilfe & Tipps" / "Help & tips": the public help section of the website (no login, no tracking).
 * German pages: site/hilfe/<slug>.html (the app links them, contract in docs/help-slugs.md; never rename a slug).
 * English pages: site/help/<slug>.html (the main articles).
 *
 * Copy: product voice (du-Form, plain, warm, short, no superlatives, no dashes as punctuation). Only what exists
 * or is being built in this release; anything not live yet carries `soon: true` and says so in the text.
 * Slugs beyond docs/help-slugs.md (site only, can be added to the contract later): gemeinsam-einkaufen,
 * benachrichtigungen, claude-chatgpt, erinnerungen-spiegeln, umzug-in-die-cloud, selbst-hosten, datenschutz-kurz,
 * abo-und-kuendigen, fragen, aufgaben, kopf-voll.
 *
 * `k` is the toolkit from build.mjs: { code(id, label, text), CLOUD, GH, MAIL, APP_DE, APP_EN }.
 */

const p = (...xs) => xs.map((x) => `<p>${x}</p>`).join('');
const ul = (...xs) => `<ul>${xs.map((x) => `<li>${x}</li>`).join('')}</ul>`;
const ol = (...xs) => `<ol class="help-steps">${xs.map((x) => `<li><span>${x}</span></li>`).join('')}</ol>`;
const tip = (x) => `<p class="help-tip">${x}</p>`;

export function helpCopy(k) {
  const de = {
    lang: 'de',
    dir: 'hilfe',
    title: 'Hilfe & Tipps',
    desc: 'Anleitungen für ToHuus: Liste, Bons, Kochen, Aufgaben, Geld, der Assistent, Home Assistant, Datenschutz und Abo. Ohne Anmeldung, ohne Tracking.',
    label: 'Hilfe & Tipps',
    h1: 'Wie geht das mit ToHuus?',
    lede: 'Kurze Anleitungen zu allem, was ToHuus heute kann. Was noch nicht fertig ist, steht als „Kommt bald“ dabei.',
    soon: 'Kommt bald',
    soonLong: 'Kommt bald: Diese Funktion ist in Arbeit. Hier steht, was geplant ist und was du schon heute tun kannst.',
    related: 'Passt dazu',
    back: 'Alle Hilfe-Themen',
    onPage: 'Auf dieser Seite',
    missing: 'Fehlt dir etwas oder stimmt etwas nicht? Schreib uns an',
    other: 'English',
    groups: [
      ['start', 'Loslegen'],
      ['shop', 'Einkauf'],
      ['cook', 'Kochen'],
      ['home', 'Zuhause'],
      ['money', 'Geld'],
      ['ai', 'Assistent und KI'],
      ['people', 'Teilen, Gäste, Hausinfo'],
      ['connect', 'Verbinden'],
      ['account', 'Konto, Daten, Datenschutz'],
    ],
    articles: [
      {
        slug: 'erste-schritte', pair: 'getting-started', group: 'start', title: 'Erste Schritte',
        desc: 'Konto anlegen, sagen, wer dazugehört, und die Bereiche kennenlernen.',
        sections: [
          ['Konto oder eigener Server', p(
            `In der ToHuus Cloud legst du in der iPhone-App oder im Browser unter <a href="${k.CLOUD}">${k.CLOUD.replace('https://', '')}</a> ein Konto und einen Haushalt an, mit Mail-Code, Passwort, Passkey oder „Mit Apple anmelden“. Jeder neue Haushalt nutzt 14 Tage lang Plus, ohne Zahlungsdaten. Die App findest du <a href="${k.APP_DE}">im App Store</a>.`,
            'Hast du einen eigenen Server, läuft ToHuus dort als Docker-Container. Wie das geht, steht unter <a href="selbst-hosten.html">Selbst hosten</a>. Ihr nutzt dann die Web-App im Browser oder die iPhone-App: Dort tippst du auf dem Startbildschirm auf „Eigener Server“ und meldest dich mit Adresse und Passwort an, im Browser oder per QR-Code aus der Web-App.',
          )],
          ['Wer gehört dazu?', p(
            'Beim Start fragt ToHuus nur das: allein, zu zweit, Familie, WG oder ein Haushalt, den du mitversorgst. Danach richtet sich, was du siehst. Ändern kannst du es später in den Einstellungen.',
          )],
          ['Die Bereiche', ul(
            '<b>Heute</b>: was fällig ist, was demnächst kommt, was bald weg muss und was ihr heute kochen könnt.',
            '<b>Einkauf</b>: die gemeinsame Liste, der Modus für den Laden und eure Wünsche.',
            '<b>Kochen</b>: Ideen aus dem, was da ist, Rezepte, Lieblinge und der Wochenplan.',
            '<b>Aufgaben</b>: was zu Hause zu tun ist, auch mit Termin. Oben findest du die Hausinfo und den Urlaub.',
            '<b>Vorrat</b>: was da ist und was bald weg muss, nur wenn ihr mögt.',
          ), p('Geld, das <a href="haushaltswissen.html">Haushaltswissen</a>, <a href="bring-mir-was.html">Bring mir was</a>, Wünsche und alles Weitere stehen unter „Mehr“. Was du oft brauchst, holst du dir in die Leiste unten, siehe <a href="deine-leiste.html">Deine Leiste</a>. Habt ihr Kochen, Vorrat oder Geld unter „Was nutzt ihr?“ abgeschaltet, verschwinden sie überall.', 'Der runde Knopf mit dem Funkeln ist der Assistent, er ist auf jeder Seite. Oben rechts auf jeder Seite findest du die Suche und dein Bild. Dein Bild öffnet „Mehr“ mit Haushalt, Einstellungen, Geräten & Verbindungen und der Hilfe.')],
          ['Alles finden', p('Die Lupe oben rechts sucht in Funktionen, Einstellungen und allem aus eurem Haushalt: Produkte, Liste, Rezepte, Aufgaben, Hausinfo und Leute. Im Browser öffnest du sie auch mit ⌘K, Strg+K oder „/“. Mehr dazu unter <a href="so-funktioniert-tohuus.html#suchen">So funktioniert ToHuus</a>.')],
          ['Die erste Woche', ol(
            'Schreibt auf die Liste, was fehlt, und hakt ab, was ihr kauft.',
            'Teilt eure Bons, wenn ihr welche habt (siehe <a href="kassenbons.html">Kassenbons einlesen</a>).',
            'Ladet die anderen ein (siehe <a href="haushalt-teilen.html">Haushalt teilen</a>).',
            'Tragt unter Aufgaben ein, was immer wieder ansteht, etwa Bad putzen oder Müll rausbringen, wenn ihr mögt (siehe <a href="aufgaben.html">Aufgaben</a>).',
            'Schreibt ein paar Sachen ins Haushaltswissen, die sonst nur einer weiß, etwa die Schuhgrößen der Kinder. Steht das schon in einer Notiz, fügt ihr den Text einfach ein (siehe <a href="haushaltswissen.html">Haushaltswissen</a>).',
          ), p('Pflegen müsst ihr nichts. Nach ein paar Wochen kennt ToHuus euren Rhythmus und schlägt vor, was wieder fällig ist.')],
        ],
        related: ['so-funktioniert-tohuus', 'einkaufsliste', 'aufgaben'],
      },
      {
        slug: 'so-funktioniert-tohuus', pair: 'how-tohuus-works', group: 'start', title: 'So funktioniert ToHuus',
        desc: 'Ein Ort für den Haushalt: wie ToHuus sich merkt, was fehlt, was ansteht und was ihr wisst, und wie du alles findest.',
        sections: [
          ['Ein Ort für den Haushalt', p(
            'ToHuus ist ein Ort für den Haushalt: was fehlt, was ansteht, was zu tun ist, was es kostet und was ihr übers Zuhause wisst. Einkaufen ist der Einstieg, nicht die ganze App.',
            'Kalender, Notizen-App und Chat ersetzt ToHuus nicht. Es holt sich daraus, was zum Haushalt gehört, zum Beispiel die Abfuhrtermine aus eurem Kalender, und gibt Aufgaben auf Wunsch dorthin zurück.',
          )],
          ['Reinschreiben, ToHuus sortiert', p(
            'Tippen, sagen oder einen Bon fotografieren: „Milch ist alle“, „Gelbe Tonne alle zwei Wochen“, „Mika hat jetzt Schuhgröße 31“. Die Milch kommt auf die Liste, die Tonne zu den Aufgaben und die Schuhgröße ins <a href="haushaltswissen.html">Haushaltswissen</a>. Was ToHuus nicht sicher versteht, legt es euch zum Bestätigen vor, statt zu raten.',
          )],
          ['Aus Einkäufen lernen', p(
            'Jeder Bon und jedes Häkchen auf der Liste zählt als Einkauf. Daraus sieht ToHuus, wie oft ihr etwas kauft, zum Beispiel Haferflocken etwa alle 20 Tage. Einen Vorrat müsst ihr dafür nicht führen.',
          )],
          ['Vorschläge statt Automatik', p(
            'Ist etwas wieder fällig, erscheint es als Vorschlag mit seinem Grund, etwa „merkt sich: alle ~9 Tage“. Erst wenn du tippst, kommt es auf die Liste. ToHuus schreibt nie still etwas auf eure Liste.',
            '„Haben wir noch“ schiebt einen Vorschlag auf. Lehnt ihr ihn zweimal ab, fragt ToHuus nicht mehr, bis ihr das Produkt wieder kauft.',
          )],
          ['Jede Zeile hat einen Absender', p(
            'Auf der Liste steht bei jedem Eintrag, woher er kommt: wer ihn wann eingetragen hat, „merkt sich“, „aus dem Wochenplan“, „vom Assistenten“ oder „über Home Assistant“. Was der Assistent einträgt, lässt sich zurücknehmen.',
          )],
          ['Das Gedächtnis eures Haushalts', p(
            'Größen, Maße, Zählerstände und was sonst nur einer im Kopf hat, stehen im <a href="haushaltswissen.html">Haushaltswissen</a> als Karten. Ab dann fragt ihr ToHuus statt dieser einen Person, und zu pflegen gibt es nichts. Notizen und Listen holt ihr per Einfügen oder als Datei herein, sichern geht genauso.',
            'Das hilft auch der KI: Ein Assistent kann nur mit dem arbeiten, was er über euch weiß. Mit dem Haushaltswissen antwortet er, ohne zu raten, der Assistent in ToHuus genauso wie Claude oder ChatGPT über <a href="claude-chatgpt.html">MCP</a>.',
          )],
          ['Demnächst', p(
            'Auf Heute zeigt „Demnächst“, was morgen und in den nächsten Tagen kommt, mit Termin und wer es sich vorgenommen hat. Die Tonne steht dort schon am Vorabend mit „heute Abend rausstellen“, ab 17 Uhr ganz oben. Freitags und samstags schaut „Demnächst“ zwei Tage voraus.',
          )],
          ['Alles lässt sich zurücknehmen', p(
            'Aus Versehen abgehakt, gelöscht oder etwas Falsches importiert? „Rückgängig“ holt es zurück, auch bei dem, was der Assistent eingetragen hat.',
          )],
          ['Deine Leiste', p(
            'Unten stehen am Anfang Heute, Einkauf, Kochen, Aufgaben und Vorrat. Geld, Wissen, Bring mir was, Wünsche oder die Hausinfo holst du dir bei Bedarf dazu, jede Person für sich (siehe <a href="deine-leiste.html">Deine Leiste</a>).',
          )],
          ['KI, wenn ihr wollt', p(
            'Das meiste geht ohne KI. Mit KI liest ToHuus schwierige Bons und versteht freie Fragen, in der Cloud über Mistral und nur mit eurer Zustimmung. Pro Monat gibt es eine offene Grenze, siehe <a href="ki-grenzen.html">Faire KI-Grenzen</a>.',
          )],
          ['Suchen', p(
            'Die Lupe oben rechts ist auf jeder Seite, im Browser auch das Suchfeld in der Seitenleiste. Mit ⌘K, Strg+K oder „/“ öffnest du sie von überall, solange du nicht gerade woanders tippst.',
            'Gefunden wird, was du in ToHuus erreichen kannst: Funktionen und Einstellungen (auch mit Wörtern wie „Passwort“, „Etiketten drucken“ oder „Dunkelmodus“), Produkte im Vorrat, was auf der Liste steht, Rezepte, auch über eine Zutat, Aufgaben, Karten der Hausinfo und Leute im Haushalt.',
            'Findet die Suche nichts, bietet sie dir an, das Gesuchte auf die Liste zu setzen oder als neue Aufgabe anzulegen.',
          ), tip('Die Suche hält sich an dieselben Regeln wie der Rest: Private Einträge und private Aufgaben findet nur, wem sie gehören, Codes aus der Hausinfo nie, und Gäste nur, was ihre Stufe zeigt.')],
        ],
        related: ['erste-schritte', 'haushaltswissen', 'wer-sieht-was'],
      },
      {
        slug: 'einkaufsliste', pair: 'shopping-list', group: 'shop', title: 'Die Einkaufsliste',
        desc: 'Eine Liste für alle, Schnelleingabe, „Ich hol’s“ und der Modus für den Laden.',
        sections: [
          ['Eintragen', p(
            'Schreib einfach, wie du sprichst: „2 l Milch, Brot, 6 Eier“ wird zu drei Einträgen. Bekannte Produkte erkennt ToHuus, und was schon auf der Liste steht, kommt nicht doppelt drauf. Eine kopierte Liste aus dem Chat fügst du mit dem Einfügen-Knopf als Ganzes ein.',
          )],
          ['Im Laden', p(
            'Der Modus „Im Laden“ sortiert nach Gängen und lernt pro Laden eure Laufreihenfolge. Er funktioniert auch ohne Netz und gleicht ab, sobald das Handy wieder online ist.',
          )],
          ['Abhaken und ausblenden', p(
            'Abgehakte Einträge blendest du mit einem Tipp aus. Gelöscht wird dabei nichts: ToHuus zählt sie weiter als Einkauf für den Rhythmus.',
          )],
          ['Diskret und privat', p(
            'Unter „Wer sieht es?“ machst du einen Eintrag <b>diskret</b> (die anderen sehen nur einen Platzhalter wie „Drogerie-Artikel“) oder <b>nur für dich</b>. Der echte Name geht nie an Home Assistant, Displays, Gast-Links oder KI-Assistenten.',
          )],
        ],
        related: ['gemeinsam-einkaufen', 'merkt-sich', 'wer-sieht-was'],
      },
      {
        slug: 'gemeinsam-einkaufen', pair: 'shopping-together', group: 'shop', title: 'Gemeinsam einkaufen',
        desc: 'Live auf allen Handys, ergänzen, während jemand im Laden steht, und zu zweit losziehen.',
        sections: [
          ['Live auf allen Geräten', p(
            'Die Liste ist auf allen Handys und im Browser gleichzeitig aktuell. Hakt jemand im Laden etwas ab, verschwindet es bei allen anderen innerhalb von Sekunden.',
          )],
          ['Ergänzen, während jemand unterwegs ist', p(
            'Fällt zu Hause noch etwas ein, schreib es auf die Liste. Wer im Laden ist, sieht es sofort im Modus „Im Laden“ an der richtigen Stelle. Anrufen musst du nicht.',
          )],
          ['Zu zweit im Laden', p(
            'Tippt einer bei einem Eintrag auf „Ich hol’s“, sehen die anderen, dass er vergeben ist. So kauft niemand doppelt, und ihr könnt euch die Gänge aufteilen.',
          )],
          ['Ohne Netz', p(
            'Im Keller des Supermarkts ist oft kein Empfang. ToHuus merkt sich, was du abhakst, und gleicht ab, sobald wieder Netz da ist.',
          )],
          ['Auf der Apple Watch', p(`Zur iPhone-App gehört eine Apple-Watch-App: die Liste nach Laden sortiert, abhaken mit Rückgängig, auch ohne iPhone in der Nähe.`)],
        ],
        related: ['einkaufsliste', 'benachrichtigungen', 'haushalt-teilen'],
      },
      {
        slug: 'merkt-sich', group: 'shop', title: 'Was ToHuus sich merkt',
        desc: 'Kaufrhythmus, Vorschläge, „Haben wir noch“ und warum kein Vorrat nötig ist.',
        sections: [
          ['Der Kaufrhythmus', p(
            'Ab drei Käufen eines Produkts schätzt ToHuus, wie oft ihr es kauft. Je mehr Käufe, desto sicherer die Schätzung. Lücken wie ein Urlaub werden ausgelassen.',
          )],
          ['Wann ein Vorschlag kommt', p(
            'Wenn ein Produkt wieder fällig ist, nicht schon auf der Liste steht und ihr es nicht gerade zweimal abgelehnt habt. Führt ihr für ein Produkt Vorrat und ist genug da, kommt kein Vorschlag.',
          )],
          ['Was nie auftaucht', p('Diskrete und private Einträge erscheinen nie als Vorschlag.')],
          ['Wie weit zurück', p('Mit Haushalt und Plus bleibt die ganze Geschichte, selbst gehostet sowieso. Ohne Abo könnt ihr sie weiter ansehen und exportieren.')],
        ],
        related: ['so-funktioniert-tohuus', 'kassenbons', 'vorrat'],
      },
      {
        slug: 'kassenbons', pair: 'receipts', group: 'shop', title: 'Kassenbons einlesen',
        desc: 'REWE eBon, PDF, Foto und Text: wie Bons zu ToHuus kommen und was damit passiert.',
        sections: [
          ['Digitale Bons und Lieferungen', p(
            'Bestellt ihr bei REWE, teilst du Abhol- oder Lieferavis und eBon als PDF mit ToHuus, zum Beispiel aus der Mail-App über „Teilen“. ToHuus gleicht beides ab und bucht, was wirklich mitkam. Auch EDEKA und Kaufland geben PDF-Bons aus.',
          )],
          ['Papierbons', p(
            'Fotografier den Bon in der App. ToHuus liest den Text zuerst selbst auf dem Server (Texterkennung ohne KI) und prüft, ob die Zeilen die Summe ergeben. Nur wenn das nicht aufgeht und die KI an ist, liest Mistral das Foto noch einmal.',
            'Ist die KI aus, bleibt es bei der Texterkennung. Unscharf gelesene Zeilen sind markiert, du korrigierst sie in der Prüfung. Auf dem iPhone kann die App den Text auch direkt auf dem Gerät erkennen und schickt dann nur den Text.',
          )],
          ['Links und Text', p('Steckt ein digitaler Bon hinter einem QR-Code oder Link, füg den Link ein. Text aus einer Mail kannst du auch einfach einfügen.')],
          ['Prüfen vor dem Buchen', p(
            'Alle Bons findest du unter Geld › Bons. Jeder Bon wartet erst in der Prüfung: Zeilen, erkannte Produkte, Mengen und Preise. Was ToHuus nicht sicher lesen konnte, ist markiert. Korrigierst du eine Zeile, merkt sich ToHuus das für diesen Laden.',
            'Pfand wird nie als Vorrat gebucht. Geht Text eines Bons an die KI, entfernt ToHuus vorher Karten- und Bonusnummern, TSE-Daten und die Adresse.',
          )],
          ['Welche Läden', p('Am besten getestet ist REWE. Für Lidl, Aldi, Edeka, Netto, Kaufland, Penny, dm, Rossmann und weitere gibt es einen allgemeinen Leser, der mit nachgebauten Bons getestet ist. Echte, anonymisierte Bons helfen: In jeder Prüfung gibt es dafür „Erkennung verbessern helfen“. Verschickt wird dabei nichts von allein.')],
          ['Bons per Mail (Plus, Cloud)', p('<span class="soon-tag">Kommt bald</span> Mit Plus bekommt euer Haushalt eine eigene Bon-Adresse (Einstellungen › Bons per Mail). Leite eBons dorthin weiter oder richte im Mailprogramm eine Regel für den Absender ein. ToHuus nimmt nur echte Bons und Lieferavise. Bestellbestätigungen, etwa vom REWE Abholservice, werden nicht gebucht, denn gekauft ist erst, was auf dem eBon steht. Alles andere verwirft ToHuus, ohne es zu speichern. Über „Neue Adresse“ machst du die alte ungültig.')],
          ['Selbst gehostet', p('Dort kannst du zusätzlich ein Bon-Postfach einrichten: Mails mit Bons weiterleiten, ToHuus holt sie alle 10 Minuten ab.')],
        ],
        related: ['geld', 'ki-an-oder-aus', 'merkt-sich'],
      },
      {
        slug: 'vorrat', pair: 'stock', group: 'home', title: 'Vorrat (freiwillig)',
        desc: 'Wer mag, führt Bestand. Nötig ist das für ToHuus nicht.',
        sections: [
          ['Freiwillig', p('ToHuus braucht keinen Vorrat, um zu wissen, was fehlt. Der Rhythmus kommt aus Bons und Häkchen. Wer trotzdem Bestand führen will, findet den Vorrat als eigenen Bereich unten in der Leiste. Wer ihn nicht braucht, schaltet ihn unter „Was nutzt ihr?“ ab.')],
          ['Nur was ausgeht', p('Statt alles zu zählen, kannst du nur die Sachen verfolgen, die regelmäßig ausgehen. Umstellen geht jederzeit, ohne dass Daten verloren gehen.')],
          ['Zählen oder Füllstand', p('Pro Produkt: gezählt, als Füllstand (voll, halb, wenig, leer) oder gar nicht. Dazu Mindesthaltbarkeit pro Packung, geöffnet und eingefroren.')],
          ['Ab wann etwas knapp ist', p('Das legst du pro Produkt selbst fest. Beim Zählen mit „Mindestens vorrätig“: Fällt der Bestand darunter, gilt es als knapp und kommt auf Wunsch auf die Liste. Beim Füllstand wählst du „Knapp ab wenig“ oder schon „ab halb“. Ob du dazu eine Mitteilung bekommst, stellst du unter Benachrichtigungen für dich selbst ein.')],
          ['Schnell abgleichen', p('Der Schnell-Abgleich geht einen Ort durch, ein Tipp pro Produkt: stimmt, weniger, leer, weg. Barcodes scannst du mit der Kamera.')],
          ['Orte', p('Ihr legt fest, welche Orte es bei euch gibt. Keller, Gefriertruhe oder Vorratskammer setzt ToHuus nicht voraus.')],
        ],
        related: ['merkt-sich', 'kochen'],
      },
      {
        slug: 'kochen', group: 'cook', title: 'Kochen mit dem, was da ist',
        desc: 'Ideen aus dem Vorhandenen, der Wochenplan, Portionen und eure Hausversion.',
        sections: [
          ['Was essen wir heute?', p('Der Kochplaner fängt bei dem an, was zu Hause ist: was sofort geht, wo nur eine Zutat fehlt (ein Tipp setzt sie auf die Liste) und was bald weg muss. Filter für Zeit, vegetarisch, mit oder ohne Thermomix.')],
          ['Wochenplan', p('Plant Mittag oder Abend, verschiebt Einträge und setzt alles, was für die Woche fehlt, mit einem Tipp auf die Liste. Wer mag, füllt freie Abende mit Vorschlägen aus dem Vorrat.')],
          ['Portionen und Hausversion', p('Portionen änderst du auf der Rezeptseite. In der Hausversion passt ihr ein Rezept an euren Haushalt an, ohne das Original zu verändern. Eure Lieblinge findest du ebenfalls unter Kochen.')],
          ['Allergien', p('Allergien und Abneigungen tragt ihr pro Person ein. Ein Gericht mit einem Allergen bekommt einen Hinweis und wird nie von allein eingeplant. Allergien sind Gesundheitsdaten: ToHuus fragt beim ersten Eintrag nach eurer Zustimmung, und an die KI gehen sie nur, wenn ihr das ausdrücklich erlaubt.')],
        ],
        related: ['rezepte-importieren', 'rezeptpaket', 'cookidoo'],
      },
      {
        slug: 'rezepte-importieren', group: 'cook', title: 'Rezepte per Link, Social Media und Foto',
        desc: 'Rezepte von Webseiten, aus Posts, von Fotos und aus anderen Apps übernehmen.',
        sections: [
          ['Per Link', p('Unter Kochen › + Rezept › Link fügst du die Adresse einer Rezeptseite ein. Die meisten Rezeptseiten liefern ihre Daten in einem Standardformat mit, das ToHuus direkt liest: Zutaten, Schritte, Zeiten und Foto. Aus anderen Apps geht das auch über „Teilen“.')],
          ['Aus Social Media', p(
            'Bei Instagram, TikTok und ähnlichen steht das Rezept meist in der Beschreibung oder nur im Video. Einen Link teilen kannst du trotzdem; was ToHuus von der Seite lesen kann, übernimmt es. Klappt das nicht, mach einen Screenshot der Beschreibung und nimm ihn als Foto.',
          )],
          ['Per Foto oder Text', p('Bis zu sechs Fotos pro Rezept, etwa Vorder- und Rückseite einer Rezeptkarte oder eine Kochbuchseite. Fotos und eingefügter Text werden mit KI gelesen; ist sie aus, tippst du das Rezept ein oder nimmst ein <a href="rezeptpaket.html">Rezeptpaket</a> von deiner eigenen KI.')],
          ['Aus Küchenmaschinen-Apps', p('Cookidoo, Monsieur Cuisine, Cookit und ähnliche Apps zeigen ihre Rezepte nur mit Anmeldung. In der ToHuus Cloud bestätigst du deshalb Name und Zutaten selbst, am einfachsten per eingefügtem Text. Mehr unter <a href="cookidoo.html">Cookidoo, Monsieur Cuisine und andere Küchenmaschinen</a>.')],
          ['Aus anderen Apps', p('Unter Einstellungen › Rezepte nimmt ToHuus Exporte von Mealie, Tandoor, Paprika, Nextcloud Kochbuch, KitchenOwl und als CSV. Du siehst vorher eine Vorschau und wählst aus.')],
          ['Nur eigene Inhalte', tip('Übernimm Rezepte für dich und deinen Haushalt. Fremde Rezepte gehören ihren Urhebern: zum Kochen speichern ja, weiterverbreiten nein.')],
        ],
        related: ['rezeptpaket', 'kochen', 'cookidoo'],
      },
      {
        slug: 'rezeptpaket', pair: 'recipe-pack', group: 'cook', title: 'Das ToHuus-Rezeptpaket',
        desc: 'Viele Rezepte auf einmal: das Format, ein Prompt für deine eigene KI und der Weg zurück.',
        sections: [
          ['Was es ist', p(
            'Ein Rezeptpaket ist eine ZIP-Datei mit einer <code>rezepte.json</code> und einem Ordner <code>bilder/</code>, oder nur die JSON-Datei. Drin steht jedes Rezept im offenen Format schema.org/Recipe, dazu auf Wunsch Geräteschritte (Thermomix, Backofen, Airfryer) mit Zeit, Temperatur, Stufe und Modus. Andere Apps können das meiste davon lesen.',
          )],
          ['Importieren', ol(
            'Kochen › Rezepte › Rezeptpaket öffnen.',
            'ZIP oder JSON auswählen. ToHuus zeigt eine Vorschau: neu, Aktualisierung oder „schon da?“.',
            'Auswählen und übernehmen. Fotos werden verkleinert und verschlüsselt gespeichert.',
          ), p('Bis 100 MB pro Paket und 1.000 Rezepte. Ein zweiter Import desselben Pakets ändert nichts doppelt.')],
          ['Exportieren', p('Dasselbe Menü gibt eure Rezepte als Paket aus, mit oder ohne Fotos. Damit sicherst du eure Sammlung oder nimmst sie in eine andere App oder einen anderen Haushalt mit.')],
          ['Mit deiner eigenen KI erstellen', p(
            'Hast du Rezepte in Kochbüchern, auf Karteikarten, als Screenshots oder in Notizen, kann jede KI, die du ohnehin nutzt (ChatGPT, Claude, Le Chat), daraus ein Paket bauen. Die App hat den vollständigen Prompt mit Beispiel zum Kopieren. Die Kurzfassung:',
          ), k.code('prompt-de', 'Prompt', `Erstelle mir ein ToHuus-Rezeptpaket aus diesen Fotos.

Gib mir eine Datei rezepte.json im Format schema.org Recipe:
{"format": "tohuus-rezeptpaket", "version": 1, "recipes": [ ... ]}

Pro Rezept: name, recipeYield, totalTime (ISO 8601, z. B. PT35M),
recipeIngredient (eine Zeile pro Zutat, wie sie dasteht),
recipeInstructions (ein HowToStep pro Schritt).
Für Geräte pro Schritt einen Block "tohuus" mit device, time,
temperature, speed und mode, nur was die Quelle sagt.
Kannst du Dateien erzeugen, gib mir eine ZIP mit rezepte.json und
einem Ordner bilder/ mit den Fotos; "image" ist dann "bilder/<datei>".
Sonst antworte nur mit dem JSON.
Behalte die Sprache des Rezepts bei und erfinde nichts.`), p('Die Antwort lädst du unter Kochen › Rezepte › Rezeptpaket hoch. Prüf die Vorschau, bevor du übernimmst: Auch eine KI liest mal eine Menge falsch.')],
          ['Rechtlich sauber', ul(
            'Nimm nur Inhalte, die dir gehören oder auf die du mit deinem eigenen Konto Zugriff hast: deine Kochbücher, deine Notizen, deine Exporte.',
            'Das Paket ist für deinen privaten Gebrauch im eigenen Haushalt. Fremde Rezeptsammlungen weiterzugeben oder zu veröffentlichen ist etwas anderes.',
            'Keine Zugangsdaten an die KI und keine automatisierten Abrufe aus fremden Konten oder Diensten.',
          )],
        ],
        related: ['rezepte-importieren', 'daten-export', 'kochen'],
      },
      {
        slug: 'cookidoo', group: 'cook', title: 'Cookidoo, Monsieur Cuisine und andere Küchenmaschinen',
        desc: 'Wie Rezepte aus Cookidoo, Monsieur Cuisine, Cookit und anderen Küchenmaschinen-Apps neben ToHuus funktionieren.',
        sections: [
          ['Welche Apps', p('Das gilt für Cookidoo (Thermomix), Monsieur Cuisine, Home Connect mit dem Bosch Cookit, Kenwood World, die Companion-Apps von Tefal, Moulinex und Krups, Magimix Cook Expert, den KitchenAid Cook Processor, Cecotec Mambo und Philips NutriU. Offene Rezeptseiten wie Kitchen Stories oder Ninja Kitchen übernimmst du ganz normal per Link.')],
          ['In der ToHuus Cloud', p('ToHuus greift nicht auf dein Konto bei diesen Apps zu und ruft selbst nichts von dort ab, auch keine Fotos. Ein Rezept teilst du mit ToHuus oder fügst den Link ein, dann bestätigst du Name und Zutaten. Die Schritte kannst du dazuschreiben oder aus deinen eigenen Screenshots lesen lassen. Alles bleibt privat in eurem Haushalt.')],
          ['Text einfügen', p('Am schnellsten geht es so: In der App das ganze Rezept kopieren, in ToHuus unter „Text einfügen“ einsetzen und „Mit KI lesen“ tippen. ToHuus sortiert es in Name, Zutaten und Schritte, du schaust drüber und speicherst. Ist die KI aus, sortiert ToHuus nach Zeilen: Zeilen mit Mengen werden Zutaten, der Rest Schritte.')],
          ['Viele auf einmal, mit Fotos', p('Hast du eine eigene KI wie Claude oder ChatGPT per MCP verbunden, kann sie Rezepte mit Schritten und Fotos in einem Rutsch speichern, auch hunderte. Oder du lädst ein <a href="rezeptpaket.html">Rezeptpaket</a> mit Fotos hoch, auf dem iPhone direkt aus der Dateien-App. Fotos, die nur als Link ankommen, lädt dein eigenes Gerät: im Browser unter Einstellungen › Rezepte › Rezeptfotos mit „Fotos über diesen Browser laden“.')],
          ['Selbst gehostet mit Home Assistant', p('Selbst gehostet liest ToHuus öffentliche Rezeptseiten dieser Apps wie jede andere Rezeptseite. Nutzt ihr die offizielle Cookidoo-Integration in Home Assistant, holt die ToHuus-Integration eure Cookidoo-Woche in den Wochenplan. Details unter <a href="home-assistant.html">Home Assistant</a>.')],
          ['Eigene Geräterezepte', p('Rezepte mit Geräteschritten (Zeit, Temperatur, Stufe, Linkslauf) kannst du über ein <a href="rezeptpaket.html">Rezeptpaket</a> übernehmen, etwa aus Fotos deines eigenen Kochbuchs. Das klappt für den Thermomix genauso wie für Monsieur Cuisine oder Cookit.')],
        ],
        related: ['kochen', 'rezeptpaket', 'home-assistant'],
      },
      {
        slug: 'geld', group: 'money', title: 'Geld: Lebensmittel und Haushalt',
        desc: 'Was ein Monat gekostet hat, wo, wofür, und was teurer geworden ist.',
        sections: [
          ['Der Monat', p('Jeder Bon zählt mit. Die Seite Geld zeigt, was der Monat gekostet hat, nach Woche, Laden und Kategorie, und vergleicht mit dem Vormonat bis zum gleichen Tag.')],
          ['Preise', p('Bei Sachen, die ihr oft kauft, zeigt ToHuus Preisänderungen gegenüber den 90 Tagen davor, wenn möglich pro Kilo oder Liter.')],
          ['Budget und Hinweise', p('Ein Budget pro Woche, Monat oder Jahr ist freiwillig, für den ganzen Haushalt oder unter „Nur meins“ nur für dich. Hinweise kommen nur aus euren eigenen Bons, zum Beispiel wenn etwas in einem anderen eurer Läden günstiger war. Angebote von außen, Werbung oder Affiliate-Links gibt es nicht.')],
          ['Ohne Bon', p('Wochenmarkt oder Bäcker trägst du von Hand ein, oder du sagst es: „Beim Bäcker 6,40 ausgegeben.“ Alles lässt sich als CSV exportieren.')],
          ['Wie weit zurück', p('Haushalt und Plus zeigen die ganze Geschichte. Ohne Abo bleibt sie sichtbar, Neues kommt dann nicht dazu.')],
        ],
        related: ['kassenbons', 'abo-und-kuendigen'],
      },
      {
        slug: 'aufgaben', pair: 'tasks', group: 'home', title: 'Aufgaben',
        desc: 'Was zu Hause zu tun ist, einmal oder immer wieder, wer es macht und wer was im Blick hat.',
        sections: [
          ['Was dazugehört', p(
            'Unter Aufgaben steht, was bei euch zu tun ist. <b>Haushalt</b> sind Sachen wie Bad putzen, Müll rausbringen oder Bettwäsche wechseln. <b>Pflege & Fristen</b> sind Wasserfilter, Rauchmelder, TÜV oder Ausweise. Oben filterst du nach Alle, Haushalt, Pflege & Fristen und Meine.',
            'Für den Anfang gibt es Vorlagen für die üblichen Hausarbeiten. Auf „Heute“ zeigt eine Karte, was heute ansteht, und ein Tipp hakt es ab.',
          )],
          ['Einmal, immer wieder oder bei Bedarf', ul(
            '<b>Einmal</b>: mit festem Datum. Ist sie erledigt, verschwindet sie aus der Übersicht.',
            '<b>Immer wieder</b>: alle paar Tage, Wochen oder Monate, oder an festen Wochentagen. Du wählst, ob das nächste Mal ab dem Erledigen zählt oder ab dem geplanten Tag, etwa „jeden Montag“.',
            '<b>Bei Bedarf</b>: ohne Datum, etwa Altglas wegbringen. Die Aufgabe wird nie fällig und steht bereit, wenn es so weit ist.',
          ), p('Bei wiederkehrenden Aufgaben reicht ein Tipp auf „Erledigt“. Den nächsten Termin rechnet ToHuus selbst aus.')],
          ['Für alle oder nur für mich', p(
            'Eine Aufgabe gehört dem ganzen Haushalt oder nur dir. Was „Nur für mich“ ist, sieht sonst niemand: nicht die anderen Mitglieder, keine Gäste, nicht der Assistent, keine Displays, nicht Home Assistant. Erinnerungen dazu bekommst nur du.',
          )],
          ['Unterpunkte', p('Eine Aufgabe kann Unterpunkte haben, zum Beispiel beim Bad: Waschbecken, Spiegel, Boden. Du hakst sie einzeln ab. Ist die Aufgabe erledigt, stehen sie beim nächsten Mal wieder offen da.')],
          ['Wer macht es', p(
            'Bei „Wer macht es“ wählst du ein Mitglied oder ein Kind aus euren Kinderprofilen, oder du lässt es bei „Wer gerade Zeit hat“. Unabhängig davon kann jemand sagen „Ich hab’s im Blick“: Diese Person denkt dran, auch wenn jemand anders es erledigt.',
            'Wechselt ihr euch ab, stellst du „Abwechselnd“ ein und wählst, wer mitmacht, etwa „Bad jeden Samstag, Mira und Sam abwechselnd“. „Erledigt“ gibt die Aufgabe an die nächste Person weiter, „Rückgängig“ gibt sie zurück.',
          )],
          ['Demnächst und die Tonne', p('Auf Heute zeigt „Demnächst“, was morgen und in den nächsten Tagen fällig ist und wer es sich vorgenommen hat. Aufgaben rund um die Tonne stehen dort schon am Abend vor dem Fälligkeitstag mit „heute Abend rausstellen“, ab 17 Uhr ganz oben. Die Abfuhrtermine liest ToHuus auf dem iPhone auf Wunsch aus eurem Kalender, unter Aufgaben › Euren Kalender lesen (siehe <a href="../ratgeber/tonne-am-vorabend-erinnerung.html">Tonne am Vorabend</a>).')],
          ['Aus Versehen erledigt', p('Ein Tipp auf „Rückgängig“ nimmt das Erledigen zurück. Bei abwechselnden Aufgaben ist danach wieder die Person dran, die vorher dran war.')],
          ['Zuletzt erledigt und euer Rhythmus', p('Unter „Zuletzt erledigt“ seht ihr, was in den letzten Tagen geschafft wurde. Bei jeder Aufgabe zeigt ToHuus nach ein paar Malen, wie oft ihr sie wirklich macht, etwa „Ihr macht das etwa alle 9 Tage“. So merkt ihr, ob der geplante Rhythmus zu eurem Alltag passt.')],
          ['Wer hat was im Blick', p(
            'Dran denken und planen ist auch Arbeit. „Wer hat was im Blick“ zeigt für die letzten 28 Tage, wer sich um Einkauf, Kochen, Geld und Aufgaben gekümmert hat: wer etwas auf die Liste gesetzt oder eingekauft, das Essen geplant, Bons erfasst oder Aufgaben erledigt hat.',
            'Dort stehen nur Namen, alphabetisch, ohne Zahlen. Deine eigene Zahl siehst nur du. Anteile in Prozent erscheinen erst, wenn alle im Haushalt „Anteile vergleichen“ eingeschaltet haben. Darunter steht, welche fälligen Aufgaben noch niemand im Blick hat.',
          ), tip('Private Einträge, persönliche Bons und Aufgaben „Nur für mich“ zählen hier nie mit. Gäste sehen diesen Teil nicht.')],
          ['Termine', p(
            'Gibst du einer Aufgabe mit Datum eine Uhrzeit, wird daraus ein Termin, auf Wunsch mit Dauer und Ort, etwa „Zahnarzt, Dienstag 15 Uhr, 30 Min.“. Über „In den Kalender“ legst du eine einzelne Aufgabe in deinen Kalender.',
            'Alle Aufgaben und Termine gleichzeitig in Apple Kalender, Apple Erinnerungen, Google Kalender oder Outlook: siehe <a href="erinnerungen-spiegeln.html">Erinnerungen und Kalender</a>. Deine privaten Aufgaben landen dabei in deinem eigenen Kalender, getrennt von denen des Haushalts. Auf dem iPhone geht das auch direkt: Aufgaben › Euren Kalender lesen › „Deine privaten Aufgaben“.',
          )],
          ['Mit dem Assistenten', p('Sag dem <a href="sprechen.html">Assistenten</a> zum Beispiel „Bettwäsche wechseln alle zwei Wochen“, „Schornsteinfeger Dienstag um halb neun“ oder „Was steht heute an?“. Er legt Aufgaben und Termine an, hakt sie ab und verteilt sie. Alles, was er einträgt, lässt sich zurücknehmen.')],
        ],
        related: ['erinnerungen-spiegeln', 'wer-sieht-was', 'kopf-voll'],
      },
      {
        slug: 'kopf-voll', pair: 'a-lot-on-your-mind', group: 'home', title: 'Wenn der Kopf voll ist',
        desc: 'Kleine Schritte, eins nach dem anderen, ein sichtbarer Timer und der sanfte Modus: für Köpfe, in denen viel los ist.',
        sections: [
          ['Für wen', p('Mit ADHS, Autismus oder einfach in einer vollen Woche ist oft der Anfang das Schwerste. Diese Funktionen sind dafür gebaut, und sie helfen allen im Haushalt. Niemand muss erklären, warum er sie nutzt. ToHuus ist kein Gesundheits- oder Therapieangebot und ersetzt keine Beratung.')],
          ['Kleine Schritte', p('Jede Aufgabe lässt sich in kleine Schritte teilen, die du einzeln abhakst. „In kleine Schritte teilen“ schlägt welche vor: mit KI, wenn euer Haushalt KI erlaubt, sonst aus fertigen Schritten für häufige Aufgaben wie Bad putzen, Küche, Wäsche, Staubsaugen oder Bett beziehen. Du kannst jeden Vorschlag ändern oder löschen. Ist die Aufgabe erledigt, stehen die Schritte beim nächsten Mal wieder offen da.')],
          ['Eins nach dem anderen', p('Die Fokusansicht zeigt nur eine Sache: die nächste Aufgabe und darin den nächsten Schritt, groß und ohne Liste drumherum.'), ul(
            '<b>Geschafft</b>: hakt den Schritt ab und zeigt den nächsten.',
            '<b>Später</b>: legt die Aufgabe zur Seite, ohne Vorwurf.',
            '<b>Zu groß? Kleiner machen</b>: teilt die Aufgabe in kleinere Schritte.',
          )],
          ['Sichtbarer Timer', p('Starte mit fünf Minuten, nur um anzufangen. Ein Ring zeigt, wie viel Zeit noch bleibt, am Ende kommt ein sanftes Signal. Es gibt keine Auswertung und keine Statistik, gezählt wird nichts.')],
          ['Sanfter Modus', p('Eine persönliche Einstellung, die nur für dich gilt:'), ul(
            'Keine roten Warnungen für Überfälliges und keine Zähler. Was fällig ist, „wäre dran“.',
            '„Neu anfangen“ legt alles Überfällige auf einen frischen Start, ohne schlechtes Gewissen.',
            'Mitteilungen kommen gebündelt in einer Nachricht, zu der Uhrzeit, die du wählst.',
            'Auf Heute stehen höchstens drei Sachen.',
          ), p('Die anderen im Haushalt sehen nicht, ob du den sanften Modus eingeschaltet hast.')],
          ['Extras im Wocheneinkauf', p('Ihr legt ein Kontingent für Extras fest, also für Luxus- und Spaßartikel: pro Woche als Betrag oder als Anzahl. Einträge auf der Liste markiert ihr als Extra, und die Liste zeigt, wie viel vom Kontingent schon verplant ist. ToHuus sperrt nichts, es hält nur den Überblick, gerade bei spontanen Käufen.')],
          ['Was es schon gibt', ul(
            'Keine Streaks, keine Ranglisten. Sterne gibt es nur, wenn ihr sie in den Haushalts-Einstellungen einschaltet, und im sanften Modus sind sie ausgeblendet. „Wer hat was im Blick“ zeigt Namen alphabetisch, Anteile nur, wenn alle zustimmen (siehe <a href="aufgaben.html">Aufgaben</a>).',
            '„Wo ist was?“ weiß, wo etwas liegt, und der <a href="vorrat.html">Vorrat</a> zeigt, was da ist und was bald alle ist.',
            'Mit dem <a href="sprechen.html">Assistenten</a> ist ein Gedanke mit einem Satz auf der Liste oder bei den Aufgaben.',
            '„Bring mir was“ für Tage, an denen das Aufstehen schwerfällt.',
            'ToHuus richtet sich nach „Bewegung reduzieren“ auf deinem Gerät.',
          )],
        ],
        related: ['aufgaben', 'sprechen', 'benachrichtigungen'],
      },
      {
        slug: 'sprechen', pair: 'speak', group: 'ai', title: 'Der Assistent',
        desc: 'Was der Assistent kann, was er einträgt und wie du es zurücknimmst.',
        sections: [
          ['Sprechen oder tippen', p('Der runde Knopf mit dem Funkeln unten rechts ist der Assistent, er ist auf jeder Seite. Schreib, was los ist, oder tipp auf das Mikrofon und sag es: „Milch ist alle, und wir brauchen was für Sonntag.“ Der Assistent setzt Milch auf die Liste und fragt nach, was es Sonntag geben soll.')],
          ['Was er kann', ul(
            'Auf die Liste setzen, abhaken, streichen.',
            'Sagen, was noch da ist und was fällig ist.',
            'Vorschlagen, was ihr kochen könnt, und ein Gericht in den Wochenplan legen.',
            'Fragen zum Geld beantworten: „Was hat der Einkauf im September gekostet?“',
            'Einen Einkauf ohne Bon festhalten: „Bei Aldi Milch, Eier und Brot für 12,40 gekauft.“',
            'Sich etwas für den Haushalt merken, wenn du ihn darum bittest.',
            'Ein Budget setzen, für alle oder nur für dich: „Setz uns 400 Euro im Monat für Lebensmittel.“',
            'Aufgaben anlegen, abhaken und verteilen: „Bad putzen jeden Samstag, Mira und Sam abwechselnd.“ Mit Uhrzeit wird daraus ein Termin.',
            'Im Haushaltswissen nachsehen und eintragen: „Welche Schuhgröße hat Mika?“ oder „Merk dir, das Rollo im Bad ist 65 breit.“',
            'Sagen, was heute ansteht und wer was im Blick hat.',
            'Fragen zur App beantworten: „Wo stelle ich das Jahresbudget ein?“ Er sagt dir den Weg und verlinkt die passende Hilfeseite.',
          )],
          ['Nur für euren Haushalt', p('Der Assistent kümmert sich um Einkauf, Kochen, Vorrat, Aufgaben, Geld und alles rund um ToHuus. Hausaufgaben, Programmieren, Politik oder Wetter lehnt er freundlich ab, ohne dafür ein Sprachmodell zu fragen und ohne dass es von deinem Kontingent abgeht. Versuche, ihm eine andere Rolle zu geben oder seine Regeln auszulesen, laufen ins Leere. Was in Rezepten, Bons oder Links steht, behandelt er als Inhalt, nie als Anweisung.')],
          ['Alles bleibt rückgängig', p('Unter jeder Antwort steht, was er eingetragen hat, mit „Rückgängig“. Er schreibt nur, wenn du ihn darum bittest.')],
          ['Ohne KI', p('Ist die KI aus oder pausiert sie für den Rest des Monats, versteht der Assistent weiter die häufigen kurzen Sätze wie „Klopapier ist alle und 2 Paprika“. Wie viele Nachrichten es im Monat gibt, steht unter <a href="ki-grenzen.html">Faire KI-Grenzen</a>.')],
          ['Privat', p('Gespräche sieht nur die Person, die sie geführt hat. Sie werden 30 Tage nach der letzten Nachricht gelöscht. Sprachaufnahmen werden nur in Text umgewandelt und nicht gespeichert. Aufgaben, die nur für dich sind, bekommt der Assistent nie zu sehen.')],
        ],
        related: ['ki-an-oder-aus', 'ki-grenzen', 'haushaltswissen'],
      },
      {
        slug: 'ki-an-oder-aus', pair: 'ai-on-or-off', group: 'ai', title: 'Mit oder ohne KI',
        desc: 'Was ohne KI geht, was sie dazu bringt, und wie du sie für Haushalt, dich oder Kinder abschaltest.',
        sections: [
          ['Ohne KI', p('Liste, Vorschläge aus dem Kaufrhythmus, Kochplaner, Wochenplan, Geld, PDF-Bons und die häufigen kurzen Sätze im Assistenten funktionieren ganz ohne Sprachmodell.')],
          ['Was die KI dazubringt', p('Fotos von Papierbons und Rezepten lesen, freie Fragen an den Assistenten, gesprochene Sätze in Text umwandeln.')],
          ['Welches Modell', p('In der ToHuus Cloud geht jede Anfrage an Mistral, einen Anbieter aus Frankreich, vermittelt über OpenRouter (USA), fest eingestellt und ohne Ausweichen auf andere Anbieter. Nichts wird zum Training genutzt. Bevor KI für dich läuft, fragt ToHuus einmal nach deiner Zustimmung; zurückziehen kannst du sie unter Einstellungen › Zugänge & KI. Selbst gehostet nimmst du deinen eigenen Schlüssel oder gar keinen.')],
          ['Abschalten', ul(
            '<b>Für den ganzen Haushalt</b>: Einstellungen › Zugänge & KI, nur Admins.',
            '<b>Nur für dich</b>: an derselben Stelle. Die anderen sehen deine Einstellung nicht.',
            '<b>Für ein Kind</b>: Eltern schalten die KI pro Kind ab. Auf dem Kinder-Tablet lässt sich das nicht ändern.',
            '<b>KI-Assistenten über MCP</b> (Claude, ChatGPT) haben einen eigenen Schalter.',
          ), p('In der ToHuus Cloud ist die KI für Kinder erst aus, bis ein Elternteil sie einschaltet. Bons per Mail und Kinder nutzen KI erst, wenn ein Admin zugestimmt hat.', 'Ist die KI aus, geht keine einzige Anfrage an ein Sprachmodell. ToHuus sagt dann an den passenden Stellen, dass sie aus ist.')],
          ['Gesundheitsdaten', p('Allergien und Angaben zu Kindern gehen nur an ein Sprachmodell, wenn ein Admin das ausdrücklich einschaltet. Ohne das filtert ToHuus ungeeignete Gerichte trotzdem, nur eben auf dem Server.')],
          ['Grenzen', p('In der ToHuus Cloud hat jeder Haushalt eine offene Grenze an KI-Nachrichten im Monat. Was dann passiert und was weiterläuft, steht unter <a href="ki-grenzen.html">Faire KI-Grenzen</a>.')],
          ['Texterkennung ohne KI', p('Bon-Fotos und Fotos von Zetteln liest ToHuus direkt auf dem Server, ohne Sprachmodell. Das ist manchmal weniger genau als die KI, aber das Foto verlässt den Server nicht. Mit KI wird die Texterkennung zuerst versucht, das Modell nur, wenn die Summe nicht stimmt.')],
        ],
        related: ['sprechen', 'ki-grenzen', 'datenschutz-kurz'],
      },
      {
        slug: 'hausinfo', pair: 'house-info', group: 'people', title: 'Hausinfo für Gäste und Babysitter',
        desc: 'Vom Gäste-WLAN bis zur Kaffeemaschine: Karten mit allem, was jemand wissen muss, der bei euch aufpasst oder zu Besuch ist.',
        sections: [
          ['Wofür', p('Die Hausinfo (oben unter Aufgaben, auf Wunsch auch in deiner Leiste) sammelt auf Karten, was Babysitter, Großeltern, Haus- und Tiersitter oder Übernachtungsbesuch wissen müssen. Ihr schreibt es einmal auf und schickt danach nur noch einen Link, statt jedes Mal dieselben Fragen zu beantworten.')],
          ['Was auf die Karten kommt', ul(
            '<b>Gäste-WLAN</b>: Netz und Passwort als Code. Wer ihn sehen darf, tippt auf „Zeigen“ und bekommt einen QR-Code, mit dem das Handy ins WLAN kommt.',
            '<b>So geht’s hier</b>: Heizung, Spülmaschine, Rollläden, Waschmaschine, Fernseher, Kaffeemaschine.',
            '<b>Hausregeln und Kinder</b>: was die Kinder dürfen, wann Schlafenszeit ist, was sonst bei euch gilt.',
            '<b>Notfall</b>: Sicherungskasten, Haupthahn und wichtige Nummern. Die Nummern stehen immer ganz oben.',
            '<b>Sprachbefehle und Abläufe</b>: „Alexa, Licht im Wohnzimmer an“ oder was „Gute Nacht“ alles auslöst.',
          ), p('Karten ordnet ihr nach Raum oder nach Art. Räume sind freier Text, ToHuus setzt keinen Keller oder Garten voraus.')],
          ['Vorlagen', p('Für den Anfang gibt es Vorlagen für Alexa, Google, Apple und Home Assistant und eine mit Tipps: Heizung, Rollläden, Müll, Waschmaschine, Fernseher, Sicherungskasten, Haupthahn, Notruf, Polizei, Giftnotruf, eure eigenen Nummern und die Nachbarn. Was noch ausgefüllt werden muss, sehen nur Admins.')],
          ['Sprachbefehle aus Home Assistant', p('Mit Home Assistant übernimmt ToHuus die Geräte, die ihr für Alexa, Google oder Assist freigegeben habt, mit Beispielsätzen. Schlösser, Alarmanlagen, Kameras und Garagentore stehen dort nie, auch nicht, wenn jemand sie von Hand hinzufügt.')],
          ['Fotos und Videos', p('Jede Karte kann bis zu acht Fotos oder kurze Videos haben, etwa wie die Heizung entlüftet wird. Sie sind genauso sichtbar wie die Karte selbst. Eine Datei darf bis zu 100 MB groß sein, die iPhone-App macht Videos vorher kleiner.')],
          ['Wer was sieht', p('Pro Karte legst du fest, wer sie sieht: alle, die hier wohnen, feste Gäste ab einer Stufe, alle Babysitter-Links oder nur bestimmte Gast-Links. Neue Karten sehen zuerst Mitglieder, feste Gäste und Babysitter-Links. Admins sehen immer alles.', 'Codes sind strenger, siehe <a href="hausinfo-codes.html">Codes sicher teilen</a>.')],
          ['Für Gäste', p('Auf dem <a href="babysitter.html">Babysitter-Link</a> erscheint die Hausinfo als eigener Bereich, einmal geöffnet auch ohne Netz lesbar. Feste Gäste sehen sie in ihrer App. Über „Drucken“ wird daraus ein A4-Blatt „Für den Babysitter“.')],
          ['Urlaubsübergabe', p('Unter Aufgaben › Urlaub legst du pro Reise fest, was der Haushüter wann tun soll: Katze füttern, Pflanzen gießen, Post holen, mit Rhythmus und Tageszeit, auf Wunsch mit Fotos und Videos. Er sieht es über seinen Link und hakt ab, was erledigt ist, und ihr seht, dass alles läuft.')],
        ],
        related: ['babysitter', 'hausinfo-codes', 'gaeste'],
      },
      {
        slug: 'hausinfo-codes', pair: 'sharing-codes', group: 'people', title: 'Codes sicher teilen',
        desc: 'Türcode, WLAN, Alarmanlage: wie ToHuus Codes behandelt.',
        sections: [
          ['Codes sind Geheimnisse', ul(
            'Codes liegen getrennt von den Karten. In der Cloud sind sie verschlüsselt, selbst gehostet, wenn du einen Schlüssel für die Datenbank gesetzt hast.',
            'Am Anfang sehen nur die, die hier wohnen, einen Code. Gäste und Links bekommen ihn nur, wenn du ihn freigibst, auf Wunsch bis zu einem Datum.',
            'Ihr seht, wer einen Code wann angezeigt hat. Der Code selbst steht dabei nie im Protokoll.',
            'Codes gehen nie an den Assistenten oder eine andere KI, nie an KI-Assistenten über MCP, nie an Home Assistant, Displays oder Benachrichtigungen.',
          )],
          ['So geht es', p('Codes legst du unter Hausinfo › Codes an. Sie sind verdeckt, bis jemand auf „Zeigen“ tippt, und werden nach einer Minute wieder verdeckt. Beim Gäste-WLAN erscheint dazu ein QR-Code zum Scannen.', 'Steht ein Code im Text einer Karte, weist ToHuus die Karte ab. Codes gehören in den Tresor.')],
          ['Drucken und Export', p('Auf dem A4-Blatt steht statt der Codes „bitte fragen“, außer ein Admin kreuzt „Codes mitdrucken“ an. Auch im Export und beim Umzug in die Cloud sind Codes nur dabei, wenn ein Admin das ausdrücklich ankreuzt.')],
        ],
        related: ['hausinfo', 'babysitter', 'wer-sieht-was'],
      },
      {
        slug: 'babysitter', pair: 'babysitter-link', group: 'people', title: 'Der Babysitter-Link',
        desc: 'Ein Link ohne Konto: Hausinfo, wo was ist und eine Notiz, auch offline und zum Ausdrucken.',
        sections: [
          ['Anlegen', p('Unter Gäste legst du einen Link mit der Vorlage „Babysitter“ an. Er funktioniert ohne Konto und ohne App, als Link oder QR-Code.')],
          ['Was die Person sieht', ul(
            'Die <a href="hausinfo.html">Hausinfo</a> mit den Karten, die für Babysitter-Links freigegeben sind, und den Codes, die du ausdrücklich freigibst.',
            '„Wo ist was?“ für die Orte, die du auswählst, nur zum Lesen und ohne Mengen.',
            'Deine Notiz, zum Beispiel wann ihr zurück seid.',
            'Mit Home Assistant eine Liste der Sprachbefehle für Licht, Rollläden und Musik.',
          )],
          ['Offline und auf Papier', p('Einmal geöffnet, bleibt die Hausinfo auf dem Handy lesbar, auch ohne Netz. Codes brauchen eine Verbindung. Über „Drucken“ gibt es alles als A4-Blatt, die Codes stehen dort als „bitte fragen“.')],
          ['Nur für diesen Link', p('Bei jeder Karte und jedem Code kannst du auch einzelne Gast-Links auswählen, bei Codes auf Wunsch bis zu einem Datum. Für den Haushüter-Link einer Reise legst du unter Urlaub über „Hausinfo für diesen Link“ fest, was genau er zeigt.')],
          ['Ablauf und Widerruf', p('Gib dem Link ein Ablaufdatum oder widerruf ihn, wenn er nicht mehr gebraucht wird. Wer verreist, nimmt den Haushüter-Link der Reise: Er endet am Tag nach eurer Rückkehr.')],
        ],
        related: ['gaeste', 'hausinfo', 'home-assistant'],
      },
      {
        slug: 'gaeste', pair: 'guests', group: 'people', title: 'Gäste und Rechte',
        desc: 'Gast-Links ohne Konto und feste Gäste mit eigenen Stufen.',
        sections: [
          ['Gast-Links', p('Ein Link oder QR-Code ohne Konto, mit Vorlagen für Besuch, Babysitter und Großeltern. Je nach Link sieht man die Hausinfo, schaut nach, wo etwas ist, oder schreibt auf die Liste. Ablaufdatum optional, widerrufen jederzeit.', 'Der Party-Modus ist am Anfang aus. Wer ihn braucht, schaltet ihn unter Einstellungen › Was nutzt ihr? ein.')],
          ['Feste Gäste', p('Wer oft da ist, bekommt ein eigenes Konto mit einer Stufe: nur bestellen und Liste, dazu Vorrat, dazu Rezepte, oder fast wie ein Mitglied. Eine Stufe lässt sich auf Zeit ändern oder pausieren.')],
          ['Was Gäste nie sehen', p('Einstellungen, Bons, Ausgaben, Budgets, Sicherungen und Zugänge, auf keiner Stufe. Diskrete und private Einträge auf der Liste auch nicht.')],
        ],
        related: ['babysitter', 'haushalt-teilen', 'wer-sieht-was'],
      },
      {
        slug: 'haushalt-teilen', group: 'people', title: 'Haushalt teilen',
        desc: 'Mitglieder einladen, Kinder anlegen und einen zweiten Haushalt mitversorgen.',
        sections: [
          ['Mitglieder', p('Unter Einstellungen › Mitglieder erstellst du einen Einladungslink. Wer ihn öffnet, legt sein eigenes Passwort an und ist dabei. Admins dürfen alles einstellen, Mitglieder nutzen den Haushalt im Alltag.')],
          ['Kinder', p('Kinder brauchen kein Konto. Sie bekommen ein Profil mit einem Tier und auf Wunsch ein Kinder-Tablet mit großen Bildern. Wünsche warten auf ein Elternteil.')],
          ['Zwei Haushalte', p('Wer für Eltern oder Großeltern mit einkauft, verbindet die beiden Haushalte und sieht, was dort fehlt. Das gehört zum Tarif Haushalt.')],
          ['Wer zahlt', p('Ein Abo gilt für den ganzen Haushalt. Mitglieder, Kinder, Gäste und verbundene Haushalte zahlen nichts.')],
        ],
        related: ['wer-sieht-was', 'gaeste', 'abo-und-kuendigen'],
      },
      {
        slug: 'wer-sieht-was', pair: 'who-sees-what', group: 'people', title: 'Wer sieht was?',
        desc: 'Was gemeinsam ist, was privat bleibt und was nur du siehst.',
        sections: [
          ['Gemeinsam', p('Die Liste, der Wochenplan, Rezepte, der Vorrat und die Aufgaben des Haushalts gehören allen. Jede Zeile zeigt, wer sie eingetragen hat.')],
          ['Diskret und nur für dich', p('Diskrete Einträge sehen die anderen nur als Platzhalter, private gar nicht. Beides geht nie an Home Assistant, Displays, Gast-Links oder KI-Assistenten.')],
          ['Nur für dich', p('Deine Gespräche mit dem Assistenten, deine Anmeldungen und Geräte, deine persönlichen Einstellungen, auch ob du die KI für dich abgeschaltet hast, und Aufgaben „Nur für mich“.', 'Bei „Wer hat was im Blick“ stehen nur Namen. Deine eigene Zahl siehst nur du, Anteile erst, wenn alle zustimmen (siehe <a href="aufgaben.html">Aufgaben</a>).')],
          ['Gäste und Kinder', p('Sehen nur, was ihr freigebt (siehe <a href="gaeste.html">Gäste und Rechte</a>).')],
        ],
        related: ['einkaufsliste', 'gaeste', 'datenschutz-kurz'],
      },
      {
        slug: 'benachrichtigungen', pair: 'notifications', group: 'connect', title: 'Benachrichtigungen',
        desc: 'Wann ToHuus sich meldet, wie du es einstellst und wie es ruhig bleibt.',
        sections: [
          ['Auf dem iPhone', p(`In der iPhone-App gibt es Mitteilungen mit Knöpfen wie „Auf die Liste“, „Mach ich“ oder „Geht nicht“. Pro Ereignis schaltest du sie an oder aus, und Ruhezeiten halten die Nacht frei.`)],
          ['Im Browser', p('Legst du die Web-App auf den Startbildschirm, kann sie Push-Mitteilungen schicken: Einstellungen › Benachrichtigungen › Push auf diesem Gerät.')],
          ['Wann', p('Zum Beispiel wenn ein Bon auf die Prüfung wartet, etwas ausgeht, ein Budget knapp wird oder sich ein neues Gerät anmeldet. Eine tägliche Übersicht zu einer festen Uhrzeit ist möglich. Im Urlaub bleibt es still.')],
          ['Selbst gehostet', p('Zusätzlich Telegram, ntfy, Gotify, Matrix, E-Mail und beliebige Webhooks.')],
          ['Home Assistant', p('Mit der Integration gehen ToHuus-Mitteilungen auch an eure Benachrichtigungsdienste in Home Assistant, etwa ans Handy oder an den Fernseher. Siehe <a href="home-assistant.html">Home Assistant</a>.')],
          ['Mails von ToHuus', p('Die tägliche Zusammenfassung und die Erinnerung vor einer Abo-Verlängerung kommen per Mail. Unter Einstellungen › Benachrichtigungen schaltest du mit „Mails von ToHuus“ alle ab, oder du klickst in einer dieser Mails auf „Diese Mails abbestellen“. Anmeldelinks und Sicherheitshinweise kommen trotzdem, sie gehören zum Konto.')],
          ['Diskret bleibt diskret', p('Diskrete Einträge erscheinen in Mitteilungen nur als Platzhalter, private gar nicht.')],
        ],
        related: ['gemeinsam-einkaufen', 'home-assistant'],
      },
      {
        slug: 'home-assistant', pair: 'home-assistant', group: 'connect', title: 'Home Assistant verbinden',
        desc: 'Schritt für Schritt über HACS, mit Code aus der App, für ToHuus Cloud und eigenen Server.',
        sections: [
          ['Was du bekommst', ul(
            'Die Einkaufsliste als To-do-Liste, in beide Richtungen, auch für Assist und Sprachbefehle.',
            'Sensoren: was fällig ist, wie viel auf der Liste steht, was der Monat und die Woche gekostet haben.',
            'Den Wochenplan als Kalender.',
            'ToHuus-Mitteilungen an eure Benachrichtigungsdienste.',
            'Pro Thema die Wahl, wer führt: Home Assistant, ToHuus oder beide.',
          ), p('Home Assistant baut die Verbindung selbst auf (HTTPS und Live-Updates). Bei dir zu Hause muss nichts aus dem Internet erreichbar sein.')],
          ['HACS installieren', p('Falls noch nicht da: HACS nach der Anleitung auf <a href="https://hacs.xyz/docs/use/">hacs.xyz</a> einrichten und Home Assistant neu starten.')],
          ['Die Integration hinzufügen', ol(
            'In Home Assistant: HACS › ⋮ › Benutzerdefinierte Repositories.',
            `Repository <code>tillheidrich/tohuus-hub-ha</code> eintragen, Typ „Integration“, hinzufügen.`,
            'Nach „ToHuus Hub“ suchen, herunterladen und Home Assistant neu starten.',
          )],
          ['Code in ToHuus holen', p('In ToHuus: Einstellungen › Home Assistant › „Home Assistant verbinden“. Du bekommst einen Code wie <code>ABCD-EFGH</code>. Er gilt 10 Minuten und nur einmal. Das darf nur ein Admin des Haushalts.')],
          ['Integration einrichten', ol(
            'In Home Assistant: Einstellungen › Geräte & Dienste › Integration hinzufügen › ToHuus Hub.',
            '<b>ToHuus Cloud</b> wählen und den Code eingeben. Fertig.',
            'Oder <b>Eigener Server</b>: die Adresse, unter der Home Assistant dein ToHuus erreicht (zum Beispiel <code>http://192.168.1.20:8080</code>), und den Code eingeben.',
          ), p('Home Assistant bekommt damit einen eigenen Zugang. Du findest ihn in ToHuus unter Einstellungen › Zugänge & KI und kannst ihn dort widerrufen. Er kann nur die Home-Assistant-Schnittstelle nutzen, sonst nichts.')],
          ['Wer führt?', p('Habt ihr schon eine Einkaufsliste in Home Assistant (die eingebaute Liste, Todoist oder eine andere Listen-App) oder einen Kalender für Essen, entscheidet ihr pro Thema, wer führt: beide, Home Assistant oder ToHuus. Einstellen geht in ToHuus unter Einstellungen › Home Assistant oder direkt in Home Assistant über die Auswahl „wer führt“ am Gerät ToHuus Hub.')],
          ['Mitteilungen', p('In den Optionen der Integration wählst du Benachrichtigungsdienste (Handy, Fernseher, Lautsprecher) und welche Arten von Mitteilungen dorthin gehen. Schickt ToHuus sie schon pro Person über die Companion-App, lass das leer, sonst kommen sie doppelt.')],
          ['Beispiel-Dashboard', p('Im Dashboard › Bearbeiten › Karte hinzufügen › Manuell einfügen:'), k.code('ha-yaml-de', 'YAML', `type: vertical-stack
cards:
  - type: tile
    entity: sensor.tohuus_hub_due
    name: Fällig
  - type: todo-list
    entity: todo.tohuus_hub_shopping_list
    title: Einkaufsliste
  - type: glance
    entities:
      - entity: sensor.tohuus_hub_shopping_list
        name: Liste
      - entity: sensor.tohuus_hub_spending_week
        name: Woche
      - entity: sensor.tohuus_hub_spending_month
        name: Monat
  - type: calendar
    initial_view: listWeek
    entities:
      - calendar.tohuus_hub_meal_plan`), p('Fertige Dashboards für Küche und Wandtablet liegen im Repository im Ordner <code>dashboards/</code>.')],
          ['Selbst gehostet', p('Alles oben gilt genauso. Zusätzlich holt die Integration eure Cookidoo-Woche aus der offiziellen Cookidoo-Integration in den Wochenplan, und NFC-Tags lassen sich als Schnellaktion nutzen. Ältere ToHuus-Versionen ohne Code verbindest du mit „Token statt Code“ (Einstellungen › Zugänge & KI › Neuer Zugang › Home Assistant).')],
          ['Wenn es hakt', ul(
            '„Dieser Code gilt nicht (mehr)“: Codes gelten 10 Minuten und einmal. Hol dir einen neuen.',
            '„Nicht erreichbar“ beim eigenen Server: Nimm die Adresse, die Home Assistant erreicht. In Docker meint „localhost“ den Container selbst.',
            'Diagnose: Einstellungen › Geräte & Dienste › ToHuus Hub › ⋮ › Diagnose herunterladen. Zugang, Adressen und Namen sind darin unkenntlich gemacht.',
          )],
        ],
        related: ['benachrichtigungen', 'babysitter', 'erinnerungen-spiegeln'],
      },
      {
        slug: 'claude-chatgpt', pair: 'connect-claude-chatgpt', group: 'connect', title: 'Mit Claude oder ChatGPT verbinden',
        desc: 'Deinen Haushalt über MCP mit dem KI-Assistenten verbinden, den du schon nutzt.',
        sections: [
          ['Worum es geht', p('Über das offene Protokoll MCP verbindest du Claude, ChatGPT oder einen anderen Assistenten mit deinem Haushalt. Dann kannst du dort zum Beispiel ein Foto vom Kühlschrank schicken und sagen: „Setz auf die Liste, was fehlt.“')],
          ['Die Adresse', k.code('mcp-url', 'MCP', `${k.CLOUD}/mcp`), p('Selbst gehostet ist es die Adresse deines Servers mit <code>/mcp</code> am Ende.')],
          ['Anmelden', p(
            'Beim Verbinden meldest du dich mit deinem ToHuus-Konto an (OAuth). Du wählst den Haushalt und was der Assistent darf: lesen oder lesen und ändern, Allergien und Kinderdaten nur, wenn du das ankreuzt. Unter Einstellungen › Zugänge & KI siehst du jede Verbindung und kannst sie beenden.',
            'Für Home Assistant und ältere Apps gibt es weiter einen Zugang mit Schlüssel in der Adresse: Einstellungen › Zugänge & KI › Neuer Zugang › KI-Assistent. Behandle ihn wie ein Passwort.',
          )],
          ['In Claude und ChatGPT', ul(
            'Claude: Einstellungen › Connectors › Eigenen Connector hinzufügen, Adresse einfügen.',
            'ChatGPT: Einstellungen › Connectors (je nach Tarif im Entwicklermodus), Adresse einfügen.',
          )],
          ['Was der Assistent sehen darf', ul(
            'Liste, Aufgaben, Vorrat, Rezepte, Wochenplan, Ausgaben und das Haushaltswissen deines Haushalts.',
            'Diskrete Einträge nur als Platzhalter, private gar nicht.',
            'Allergien und Angaben zu Kindern nur, wenn ein Admin das ausdrücklich erlaubt.',
            'Codes aus der Hausinfo nie.',
          ), p('Einkäufe, die der Assistent festhält, warten erst in der Prüfung. Ein Admin kann MCP für den ganzen Haushalt abschalten (Einstellungen › Zugänge & KI).')],
          ['Und die KI-Grenzen?', p('Dein eigener Assistent arbeitet mit seinem eigenen Sprachmodell. Von den Nachrichten an den Assistenten in ToHuus geht dabei nichts ab. Warum das Haushaltswissen dabei so viel ausmacht, steht im Beitrag <a href="../ratgeber/ki-braucht-kontext.html">Warum auch die beste KI ohne Kontext nur rät</a>.')],
        ],
        related: ['ki-an-oder-aus', 'haushaltswissen', 'rezeptpaket'],
      },
      {
        slug: 'erinnerungen-spiegeln', pair: 'reminders-calendar', group: 'connect', title: 'Erinnerungen und Kalender',
        desc: 'Einkaufslisten, Aufgaben und Termine in Apple Erinnerungen, Apple Kalender, Nextcloud, Google Kalender oder Outlook.',
        sections: [
          ['Was du bekommst', p('ToHuus ist selbst ein CalDAV-Server. Mit einem Passwort erscheinen in Apple Erinnerungen und im Apple Kalender:'), ul(
            'Jede eurer Einkaufslisten als eigene Erinnerungsliste.',
            '„ToHuus · Aufgaben“ mit den Aufgaben des Haushalts und „ToHuus · Nur für mich“ mit deinen eigenen.',
            '„ToHuus · Kalender“ und „ToHuus · Mein Kalender“ mit allen Aufgaben, die ein Datum haben, und euren Terminen.',
          ), p(
            'Alles geht in beide Richtungen. Hakst du in Erinnerungen etwas ab, ist es in ToHuus erledigt. Eine neue Erinnerung in „ToHuus · Aufgaben“ wird eine Aufgabe. Verschiebst oder benennst du einen Termin im Kalender um, ändert sich die Aufgabe, und ein neuer Termin dort wird zur Aufgabe. Löschen räumt die Aufgabe in ToHuus weg.',
            'Eine wiederkehrende Aufgabe steht als ein Termin am nächsten Datum im Kalender, den Rhythmus behält ToHuus. Was nur für dich ist, steht nur in „Nur für mich“ und „Mein Kalender“ und nur mit deinem eigenen Passwort.',
          )],
          ['Auf dem iPhone einrichten', ol(
            'In ToHuus: ganz unten unter Aufgaben oder unter Einstellungen › Mein Konto bei „Erinnerungen & Kalender“ auf „Passwort erstellen“ tippen. Server, Benutzername und Passwort werden einmal angezeigt.',
            'Für Erinnerungen: Einstellungen › Apps › Erinnerungen › Accounts › Account hinzufügen › Andere › CalDAV-Account hinzufügen, die drei Angaben eintragen.',
            'Für den Kalender: Einstellungen › Apps › Kalender › Kalenderaccounts › Account hinzufügen › Andere › CalDAV-Account hinzufügen, mit denselben Angaben.',
            'Erinnerungen und Kalender öffnen: Deine ToHuus-Listen und Kalender stehen unter dem neuen Account.',
          ), p('Nextcloud Tasks, DAVx⁵ oder Thunderbird nehmen die volle Adresse mit <code>/caldav/</code> am Ende. Jedes Passwort lässt sich einzeln widerrufen.')],
          ['Google Kalender und Outlook', p('Für Kalender ohne CalDAV gibt es ein Kalender-Abo. Unter „Kalender-Abo für Google, Outlook und andere“ tippst du auf „Link erstellen“, auf Wunsch mit deinen privaten Aufgaben.'), ul(
            'Google Kalender (im Browser): Weitere Kalender › + › Per URL, dann den Link einfügen.',
            'Outlook: Kalender hinzufügen › Aus dem Internet abonnieren, dann den Link einfügen.',
            'Auf dem Mac oder iPhone reicht ein Tipp auf „Im Kalender öffnen“.',
          ), p('Über das Abo lässt sich nichts ändern, und der Kalender holt sich etwa stündlich den neuen Stand. Behalte den Link für dich, denn wer ihn hat, sieht die Einträge. Du kannst ihn jederzeit wieder löschen.')],
          ['Eine einzelne Aufgabe', p('Bei jeder Aufgabe mit Datum gibt es „In den Kalender“. Auf dem iPhone öffnet sich der Termin direkt im Kalender, im Browser lädst du ihn als Datei herunter. Dafür brauchst du kein Passwort. Der Eintrag ist dann eine Kopie und ändert sich nicht mehr mit.')],
          ['Oder über Home Assistant', ol(
            'In Home Assistant die Integration „CalDAV“ mit deinem Nextcloud-Konto einrichten. Deine Aufgabenlisten erscheinen dort als To-do-Listen.',
            'Die ToHuus-Integration verbinden (siehe <a href="home-assistant.html">Home Assistant</a>).',
            'In ToHuus unter Einstellungen › Home Assistant bei „Einkaufsliste“ die Nextcloud-Liste wählen und „beide“ einstellen.',
          )],
          ['Siri und Kurzbefehle', p('Etwas per Siri auf die Liste setzen geht mit einem persönlichen Schlüssel und einem Kurzbefehl: Einstellungen › Mein Konto › Aus anderen Apps an ToHuus teilen. Der Schlüssel kann nur auf die Liste schreiben.')],
        ],
        related: ['aufgaben', 'home-assistant', 'gemeinsam-einkaufen'],
      },
      {
        slug: 'umzug-in-die-cloud', pair: 'move-to-the-cloud', group: 'account', title: 'Vom eigenen Server in die Cloud',
        desc: 'Einen selbst gehosteten Haushalt in die ToHuus Cloud mitnehmen.',
        sections: [
          ['In einem Rutsch', ol(
            'Auf deinem Server: Einstellungen › Daten › Umzug in die ToHuus Cloud › Umzugsdatei herunterladen. Darin sind Liste, Vorrat, Rezepte, Bons, Rhythmus und Fotos.',
            'In der ToHuus Cloud einen neuen Haushalt anlegen.',
            'Dort: Einstellungen › Daten › Haushalt vom eigenen Server übernehmen, Passwort eingeben, Datei wählen.',
          ), p('Leute werden über E-Mail oder Namen zugeordnet. Wer noch kein Cloud-Konto hat, steht als Person drin und bekommt eine Einladung von dir.')],
          ['Was nicht mitkommt', ul(
            'Anmeldungen, Geräte, Zugänge und Links: die richtest du in der Cloud neu ein.',
            'Gespräche mit dem Assistenten und was andere als „nur für mich“ markiert haben.',
            'Codes aus der Hausinfo nur, wenn du „Codes mitnehmen“ ankreuzt.',
            'Die Einwilligung für Gesundheitsdaten gibt ihr in der Cloud neu.',
          ), p('Home Assistant: in der Integration „Neu konfigurieren“ wählen und auf die Cloud umstellen.')],
        ],
        related: ['daten-export', 'selbst-hosten', 'rezeptpaket'],
      },
      {
        slug: 'selbst-hosten', pair: 'self-hosting', group: 'account', title: 'Selbst hosten mit Docker',
        desc: 'ToHuus auf deinem eigenen Server, kostenlos unter AGPL-3.0.',
        sections: [
          ['Was du brauchst', p('Einen Rechner mit Docker, etwa einen kleinen Server oder ein NAS. Ein Konto bei uns brauchst du nicht.')],
          ['Installieren', k.code('host-sh', 'Terminal', `git clone ${k.GH}.git
cd tohuus-hub
cp .env.example .env
docker compose up -d --build`), p('In <code>.env</code> trägst du <code>BASE_URL</code>, deinen Namen und ein Passwort ein. Danach <code>http://localhost:8080</code> öffnen. Die Daten liegen in <code>./data</code>.')],
          ['HTTPS und die Web-App', p('Stell deinen üblichen Reverse Proxy davor, etwa Caddy oder einen anderen mit Let’s Encrypt. Dann öffnest du die Web-App im Browser und legst sie auf den Startbildschirm.')],
          ['Mit der iPhone-App', p('Die iPhone-App funktioniert auch mit deinem eigenen Server. Sie braucht https mit gültigem Zertifikat, einfaches http geht nur im Heimnetz. Auf dem Startbildschirm der App tippst du auf „Eigener Server“ und gibst die Adresse ein, mit der du ToHuus im Browser öffnest. Dann hast du drei Wege:'), ul(
            '<b>Mit Passwort</b>: Name oder E-Mail und Passwort, dazu der Bestätigungscode, wenn du die Anmeldung in zwei Schritten eingeschaltet hast.',
            '<b>Im Browser anmelden</b>: mit allem, was dein Server anbietet, etwa Passkey, E-Mail-Link oder SSO. Danach fragt eine Seite „ToHuus-App verbinden?“, und du bestätigst.',
            '<b>Per QR-Code</b>: In der Web-App unter Einstellungen › Mein Konto › „iPhone-App verbinden“ erscheint ein QR-Code. In der App auf „QR-Code scannen“ tippen und darauf halten. Adresse und Passwort musst du dann nicht tippen.',
          ), p('Auf einem iPhone können mehrere Server und Haushalte angemeldet sein, du wechselst mit einem Tipp. Auf dem eigenen Server ist in der App alles dabei, ohne Tarif und ohne Bezahlen.'), tip('Einen Passkey direkt in der App anlegen geht nur mit der ToHuus Cloud, so regelt Apple das. Auf deinem eigenen Server nimmst du für den Passkey den Weg „Im Browser anmelden“.')],
          ['KI', p('Optional, mit einem Schlüssel für jeden OpenAI-kompatiblen Dienst, etwa Mistral, auch lokal. Ohne Schlüssel läuft alles außer freien Fragen an den Assistenten. Fotos von Papierbons liest dann die Texterkennung auf deinem Server, ohne KI.')],
          ['Sicherungen', p('Jede Nacht eine Sicherung, auf Wunsch zusätzlich auf eine WebDAV-Freigabe wie Nextcloud. Die Datenbank lässt sich mit <code>DB_ENCRYPTION_KEY</code> verschlüsseln.')],
          ['Nur im eigenen Netz', p('Bon-Postfach per IMAP, Telegram, Bon-Drucker und Home Assistant mit allen Extras.')],
        ],
        related: ['erste-schritte', 'home-assistant', 'umzug-in-die-cloud'],
      },
      {
        slug: 'daten-export', pair: 'your-data', group: 'account', title: 'Deine Daten mitnehmen',
        desc: 'Export, Rezeptpaket und was beim Löschen passiert.',
        sections: [
          ['Export', p('Einstellungen › Daten & Sicherung › Export herunterladen gibt eine JSON-Datei mit allen Daten eures Haushalts. Passwörter, Zugänge und Geheimnisse von Integrationen lässt der Export weg. Das dürfen nur Admins.')],
          ['Rezepte', p('Eure Rezepte mit Fotos gehen als <a href="rezeptpaket.html">Rezeptpaket</a> mit, das andere Apps zum großen Teil lesen können.')],
          ['Haushaltswissen', p('Das Haushaltswissen sicherst du als Markdown, CSV oder JSON, siehe <a href="haushaltswissen.html">Haushaltswissen</a>.')],
          ['Ausgaben', p('Auf der Seite Geld als CSV.')],
          ['Haushalt löschen', p('In der Cloud wird beim Löschen zuerst der Schlüssel des Haushalts vernichtet. Ab da ist die Datenbank nicht mehr lesbar. Danach werden Dateien und Sicherungen gelöscht. Dein Konto löschst du unter Einstellungen › Mein Konto.')],
        ],
        related: ['datenschutz-kurz', 'umzug-in-die-cloud', 'abo-und-kuendigen'],
      },
      {
        slug: 'datenschutz-kurz', pair: 'privacy-in-short', group: 'account', title: 'Datenschutz kurz erklärt',
        desc: 'Wo eure Daten liegen, wer sie sieht und was nie passiert.',
        sections: [
          ['Wo', p('Die ToHuus Cloud läuft auf Servern von Hetzner in Deutschland. Jeder Haushalt hat eine eigene, verschlüsselte Datenbank mit eigenem Schlüssel. Fotos und Bon-Dateien sind ebenfalls verschlüsselt.')],
          ['Was nie passiert', ul(
            'Kein Tracking und keine Werbung, weder in der App noch auf dieser Website.',
            'Eure Bons werden nicht verkauft und nicht für Marktforschung ausgewertet.',
            'Keine Angebote von außen und keine Affiliate-Links.',
          )],
          ['KI', p('Nur über Mistral, fest eingestellt. Gesundheitsdaten nur mit eurer ausdrücklichen Erlaubnis. Abschalten geht für den Haushalt, für dich und für Kinder (siehe <a href="ki-an-oder-aus.html">Mit oder ohne KI</a>).')],
          ['Im Haushalt', p('Gespräche mit dem Assistenten und persönliche Einstellungen sieht nur die jeweilige Person. Diskrete und private Einträge bleiben, was sie sind.')],
          ['Alles im Detail', p('In der <a href="../de/datenschutz.html">Datenschutzerklärung</a>.')],
        ],
        related: ['wer-sieht-was', 'ki-an-oder-aus', 'daten-export'],
      },
      {
        slug: 'abo-und-kuendigen', pair: 'subscription', group: 'account', title: 'Abo und Kündigen',
        desc: 'Testphase, Haushalt und Plus, wie bezahlt wird und was beim Kündigen passiert.',
        sections: [
          ['Ein Abo pro Haushalt', p('Haushalt kostet 3,99 € im Monat oder 34,99 € im Jahr, Plus 5,99 € im Monat oder 59,99 € im Jahr. Mitglieder, Kinder, Gäste und verbundene Haushalte zahlen nie. Selbst gehostet ist alles kostenlos.')],
          ['Ausprobieren', p('Jeder neue Haushalt in der Cloud nutzt 14 Tage lang Plus, ohne Zahlungsdaten. Schließt ihr danach nichts ab, bleibt alles sichtbar und exportierbar, nur Neues eintragen und ändern geht nicht mehr. Abhaken auf der Einkaufsliste klappt noch sieben Tage. Abgebucht wird nichts von selbst.')],
          ['Bezahlen', p('Abgeschlossen wird in der iPhone-App, bezahlt über deine Apple-ID.')],
          ['Kündigen', ol(
            'Auf dem iPhone: Einstellungen › dein Name › Abonnements.',
            'ToHuus wählen und „Abo kündigen“ tippen.',
          ), p('Das Abo läuft bis zum Ende des bezahlten Zeitraums. Gelöscht wird danach nichts. Ihr könnt alles ansehen und exportieren, Neues eintragen geht wieder mit dem nächsten Abo.')],
          ['Codes von uns', p('Von uns kannst du auch einen Code bekommen, für einen Monat, ein Jahr oder für immer. Ein Admin eures Haushalts löst ihn im Browser ein, unter Einstellungen › Abo › Code einlösen. Danach gilt er auf jedem Gerät, auch auf dem iPhone. In der iPhone-App selbst geht das nicht.')],
          ['Wenn das Geld gerade nicht reicht', p('Schreib uns über das Formular „Wir können uns das gerade nicht leisten“ bei den <a href="../de/#nicht-leisten">Preisen</a>. Du bekommst eine Lizenz, ohne Begründung. Mit jedem Abo finanzieren andere Haushalte das mit.')],
        ],
        related: ['haushalt-teilen', 'daten-export', 'fragen'],
      },
      {
        slug: 'haushaltswissen', pair: 'household-knowledge', group: 'home', title: 'Haushaltswissen',
        desc: 'Größen, Maße, Zählerstände und was ihr sonst übers Zuhause wisst: eintragen, finden, übernehmen und als Datei sichern.',
        sections: [
          ['Was dazugehört', p('Die kleinen Fakten über euer Zuhause, die man selten braucht und dann sofort.'), ul(
            '<b>Personen</b>: Schuh- und Kleidergrößen der Kinder, was jemand mag und was nicht, Unverträglichkeiten und Allergien, die Nummer der Kinderärztin.',
            '<b>Räume</b>: Rollo- und Fenstermaße, welcher Sockel in welche Lampe gehört, wo Hauptwasserhahn und Sicherungskasten sind.',
            '<b>Dinge</b>: Zählernummern und Zählerstände, Filter für Dunstabzug und Staubsauger, die Reifengröße, wann die Heizung zuletzt gewartet wurde.',
            '<b>Regeln</b>: was bei euch in welche Tonne gehört.',
          ), tip('Codes, PIN und WLAN-Schlüssel nimmt ToHuus hier nicht an. Die gehören in die Hausinfo unter Codes (siehe <a href="hausinfo-codes.html">Codes sicher teilen</a>).')],
          ['Warum das hilft', p(
            'Meistens weiß so etwas eine Person, und die wird ständig gefragt. Steht es in ToHuus, fragt ihr ToHuus. Zu pflegen gibt es nichts: Wer merkt, dass sich etwas geändert hat, trägt den neuen Wert ein, und der alte bleibt im Verlauf.',
            'Das hilft auch der KI. Ein Assistent kann nur mit dem arbeiten, was er über euch weiß. Mit dem Haushaltswissen beantwortet er „Welche Schuhgröße hat Mika?“, ohne zu raten, der Assistent in ToHuus genauso wie Claude oder ChatGPT über <a href="claude-chatgpt.html">MCP</a>.',
          )],
          ['Eintragen', p(
            'Das Haushaltswissen findest du unter „Mehr“ › Wissen oder in deiner Leiste. Tipp einen Satz wie „Mika Schuhgröße 31“ oder „Rollo Wohnzimmer 120 x 160“, oder sag ihn dem Assistenten. Solche kurzen Sätze versteht ToHuus auch ohne KI. Jede Karte gehört zu einer Person, einem Raum aus „Wo ist was?“, einem Produkt oder einer freien Bezeichnung.',
            'Gibt es zur selben Sache schon eine Karte, bekommt sie den neuen Wert. Im Verlauf stehen die früheren Werte mit Datum, und du kannst einen zurückholen.',
          )],
          ['Finden', p('Über die Suche, über die Person, den Raum oder das Ding, oder du fragst den Assistenten: „Wie breit ist das Rollo im Bad?“')],
          ['Notizen und Listen übernehmen', p(
            'Unter Importieren fügst du Text aus Notizen oder Mails ein oder wählst eine Liste: Excel, Numbers oder Google Tabellen als CSV, oder eine Textdatei. Markdown, etwa aus Obsidian oder Notion, und JSON gehen auch.',
            'Bevor etwas gespeichert wird, siehst du jede erkannte Karte mit „neu“, „neuer Wert“ oder „unverändert“ und hakst an, was übernommen wird. Codes und Passwörter bleiben draußen, Gesundheitsangaben werden privat. „Rückgängig“ nimmt den ganzen Import zurück. Pro Import gehen bis zu 200 Einträge und 512 KB.',
          )],
          ['Als Datei sichern', p('Unter Exportieren bekommst du alles oder das, was die Suche gerade zeigt, als Markdown, CSV oder JSON. Auf dem iPhone sicherst du die Datei über „In Dateien sichern“. Exportiert wird nur, was du sehen darfst, und jede dieser Dateien lässt sich wieder einlesen.')],
          ['Wer sieht was', ul(
            'Jede Karte gilt für den ganzen Haushalt oder nur für dich. Private Karten sieht niemand sonst.',
            'Gesundheitsangaben sind von sich aus privat. Teilen fragt noch einmal nach, und an eine KI gehen sie nur, wenn euer Haushalt das erlaubt.',
            'Feste Gäste sehen nur Karten, die ihr für Gäste freigebt.',
          )],
        ],
        related: ['hausinfo', 'sprechen', 'claude-chatgpt'],
      },
      {
        slug: 'deine-leiste', pair: 'your-bar', group: 'start', title: 'Deine Leiste',
        desc: 'Welche Bereiche unten in der Leiste stehen, stellt jede Person für sich ein.',
        sections: [
          ['Der Anfang', p('Am Anfang stehen unten Heute, Einkauf, Kochen, Aufgaben und Vorrat. Habt ihr Kochen oder Vorrat abgeschaltet, rückt Geld nach. Alles andere findest du unter „Mehr“.')],
          ['Was du nach unten holen kannst', p('Heute bleibt immer vorn. Dazu wählst du bis zu vier Bereiche in deiner Reihenfolge:'), ul(
            'Einkauf, Kochen, Aufgaben, Vorrat und Geld',
            'Wissen, also das <a href="haushaltswissen.html">Haushaltswissen</a>',
            '<a href="bring-mir-was.html">Bring mir was</a>',
            'Wünsche und Hausinfo',
          ), p('Der Assistent bleibt der runde Knopf unten rechts. Personen, Urlaub, „Wo ist was?“ und die Einstellungen bleiben unter „Mehr“.')],
          ['So geht es', ol(
            'Lange auf die Leiste drücken, unter „Mehr“ auf „Leiste anpassen“ tippen oder Einstellungen › Deine Leiste öffnen.',
            'Mit dem grünen Plus holst du einen Bereich dazu, mit dem roten Minus nimmst du ihn raus.',
            'Am Griff ziehst du die Bereiche in die Reihenfolge, die du willst. „Wie am Anfang“ setzt alles zurück.',
          ), p('Im Browser am Computer geht es auch mit einem Rechtsklick auf die Bereiche in der Seitenleiste.')],
          ['Für wen es gilt', p('Die Leiste gilt nur für dich, auf iPhone, iPad und im Browser gleich. Die anderen im Haushalt behalten ihre. Schaltet ein Admin einen Bereich unter „Was nutzt ihr?“ ab, fällt er aus allen Leisten weg. Feste Gäste haben immer die Standardleiste.')],
        ],
        related: ['erste-schritte', 'so-funktioniert-tohuus', 'haushaltswissen'],
      },
      {
        slug: 'bring-mir-was', pair: 'bring-me-something', group: 'home', title: 'Bring mir was',
        desc: 'Sich zu Hause eine Kleinigkeit wünschen, und wer kann, bringt sie.',
        sections: [
          ['Wofür', p('Auf dem Sofa festgesessen, krank im Bett oder ein Kind auf dem Arm: Mit Bring mir was wünschst du dir eine Kleinigkeit, und jemand im Haushalt bringt sie. Das gibt es, sobald ihr zu mehreren seid.')],
          ['So geht es', ol(
            'Bring mir was öffnen, über „Mehr“ oder deine Leiste.',
            'Eine Kachel wählen, etwa „Was Süßes“, „Was zu trinken“ oder „Aus dem Kühlschrank“, oder mit „Was anderes“ einen freien Wunsch schreiben, zum Beispiel Tee mit Honig.',
            'Eine bestimmte Person fragen oder alle.',
          ), p('Die anderen bekommen eine Mitteilung mit „Ich bring’s“ oder „Geht gerade nicht“ und einem kurzen Grund. Du siehst, wer es bringt, und kannst danach Danke sagen.')],
          ['Was es nicht gibt', p('Punkte, Ranglisten oder eine Liste, wer was gebracht hat. Niemand führt Buch.')],
          ['Eure Karte', p('Was auf den Kacheln zur Auswahl steht, legt ihr unter Bring mir was › Bearbeiten fest, auf Wunsch mit Bild und Auswahl wie „mit Milch“.')],
          ['Abschalten', p('Wer Bring mir was nicht braucht, schaltet es unter „Was nutzt ihr?“ in den Einstellungen ab.')],
        ],
        related: ['kopf-voll', 'deine-leiste', 'haushalt-teilen'],
      },
      {
        slug: 'ki-grenzen', pair: 'ai-limits', group: 'ai', title: 'Faire KI-Grenzen',
        desc: 'Wie viele Nachrichten der Assistent im Monat hat, was danach passiert und was ohne KI weiterläuft.',
        sections: [
          ['Warum es eine Grenze gibt', p('Jede Nachricht an ein Sprachmodell kostet Geld, ein Bon-Foto etwas mehr. Damit einzelne Haushalte nicht so viel verbrauchen, dass alle anderen es mitbezahlen, hat jeder Haushalt in der ToHuus Cloud eine Grenze im Monat. Wo sie liegt, steht hier offen.')],
          ['Die Grenzen', ul(
            '<b>Plus und Testphase</b>: 800 Nachrichten in voller Länge im Monat. Danach werden die Antworten kürzer, ab 1.500 Nachrichten pausiert die KI bis zum Monatsende.',
            '<b>Haushalt</b>: 100 Nachrichten an den Assistenten im Monat.',
            '<b>Kostenbremse</b>: Dazu hat jeder Haushalt einen festen Höchstbetrag für KI im Monat. Ist er erreicht, etwa nach sehr vielen Bon-Fotos, pausiert die KI auch früher.',
            '<b>Selbst gehostet</b>: keine Grenze von uns.',
          ), p('Eine Sprachnachricht zählt einmal. Wie viele Nachrichten ihr in diesem Monat schon hattet, steht unter Einstellungen › Abo.')],
          ['Was in der Pause weiterläuft', p(
            'Liste, Vorschläge, Aufgaben, Vorrat, Kochplaner, Geld und das Haushaltswissen mit Import und Export. Der Assistent versteht weiter die häufigen kurzen Sätze wie „Milch ist alle und 2 Paprika“, Bon-Fotos liest die Texterkennung, PDF-Bons laufen wie immer. Ein eigener KI-Assistent über <a href="claude-chatgpt.html">MCP</a> zählt nicht mit.',
            'Nachberechnet wird nichts. Im nächsten Monat ist die KI wieder da.',
          )],
          ['Weniger verbrauchen', ul(
            'Mehrere Sachen in eine Nachricht schreiben.',
            'Für die Liste das Eingabefeld nehmen, das zählt nicht.',
            'Digitale Bons als PDF teilen statt sie zu fotografieren.',
          )],
        ],
        related: ['ki-an-oder-aus', 'sprechen', 'abo-und-kuendigen'],
      },
      {
        slug: 'gut-zu-wissen', group: 'start', title: 'Gut zu wissen',
        desc: 'Kurze Hinweise rund um Einkauf, Lagern und Kochen, jeweils mit Quelle.',
        sections: [
          ['Was dort steht', p('Unter Mehr › Gut zu wissen sammelt ToHuus kurze Hinweise rund um Einkauf, Lagern und Kochen. Jeder Hinweis nennt seine Quelle, damit du nachlesen kannst.')],
          ['Was es nicht ist', p('Keine Ernährungs- oder Gesundheitsberatung. Bei Allergien und Unverträglichkeiten zählt, was eure Ärztin oder euer Arzt sagt.')],
        ],
        related: ['kochen', 'so-funktioniert-tohuus'],
      },
      {
        slug: 'fragen', pair: 'faq', group: 'start', title: 'Häufige Fragen',
        desc: 'Kurze Antworten auf das, was oft gefragt wird.',
        sections: [
          ['Muss ich alles abtippen?', p('Nein. Bons kommen als PDF oder Foto herein, und was ihr auf der Liste abhakt, zählt auch als Einkauf. Einen Vorrat müsst ihr nicht pflegen.')],
          ['Ist ToHuus nur eine Einkaufsliste?', p('Nein. Die Liste ist bei den meisten der Einstieg. Dazu kommen Aufgaben mit Terminen, Vorrat, Kochen, Geld, das <a href="haushaltswissen.html">Haushaltswissen</a> und der Assistent, alles im selben Haushalt.')],
          ['Gibt es eine kostenlose Version?', p('In der ToHuus Cloud nicht. Jeder neue Haushalt nutzt 14 Tage lang alles, danach geht es mit einem Abo weiter, oder ihr seht und exportiert alles weiter, nur Neues eintragen geht dann nicht. Kostenlos ist ToHuus auf dem eigenen Server (siehe <a href="selbst-hosten.html">Selbst hosten</a>).')],
          ['Ist die KI unbegrenzt?', p('Nein. Die Grenze ist großzügig und steht offen da, siehe <a href="ki-grenzen.html">Faire KI-Grenzen</a>.')],
          ['Funktioniert das ohne REWE?', p('Ja. Papierbons per Foto, PDF-Bons von EDEKA und Kaufland, und wer gar keine Bons sammeln will, hakt einfach auf der Liste ab.')],
          ['Brauche ich KI?', p('Nein. Siehe <a href="ki-an-oder-aus.html">Mit oder ohne KI</a>.')],
          ['Gibt es eine Android-App?', p('Nein. Im Browser läuft ToHuus als Web-App, die du auf den Startbildschirm legen kannst.')],
          ['Geht die iPhone-App mit meinem eigenen Server?', p('Ja. Auf dem Startbildschirm der App tippst du auf „Eigener Server“. Wie die Anmeldung geht, steht unter <a href="selbst-hosten.html">Selbst hosten</a>.')],
          ['Gibt es ToHuus als iPhone-App?', p(`Ja, <a href="${k.APP_DE}">im App Store</a>, für iPhone, iPad und Apple Watch.`)],
          ['Brauche ich einen Thermomix?', p('Nein. Der Kochplaner zeigt Rezepte mit und ohne Thermomix.')],
          ['Ist ToHuus für ADHS geeignet?', p('Für alle, in deren Kopf viel los ist, gibt es kleine Schritte, eine Ansicht mit nur einer Sache, einen sichtbaren Timer und einen sanften Modus, und nirgends Ranglisten. Sterne gibt es nur, wenn ihr sie einschaltet. Siehe <a href="kopf-voll.html">Wenn der Kopf voll ist</a>.')],
          ['Brauchen Babysitter ein Konto?', p('Nein. Sie bekommen einen Link oder QR-Code und sehen die <a href="hausinfo.html">Hausinfo</a> und was ihr sonst freigebt.')],
          ['Ist ToHuus ein Familienkalender?', p('Nein. ToHuus kümmert sich um Einkauf, Kochen, Geld und das, was zu Hause zu tun ist. Dafür gibt es <a href="aufgaben.html">Aufgaben</a>, auch mit Uhrzeit als Termin, und die stehen auf Wunsch in eurem Kalender. Chat und Ranglisten gibt es bewusst nicht, Sterne nur, wenn ihr sie selbst einschaltet.')],
          ['Wo melde ich einen Fehler?', p(`Per Mail an <a href="mailto:${k.MAIL}">${k.MAIL}</a> oder als Issue auf <a href="${k.GH}/issues">GitHub</a>.`)],
        ],
        related: ['erste-schritte', 'abo-und-kuendigen', 'datenschutz-kurz'],
      },
    ],
  };

  const en = {
    lang: 'en',
    dir: 'help',
    title: 'Help & tips',
    desc: 'How-tos for ToHuus: the list, receipts, tasks, the assistant, AI on or off, recipe packs, Home Assistant, privacy and subscriptions. No sign-in, no tracking.',
    label: 'Help & tips',
    h1: 'How does ToHuus work?',
    lede: 'Short guides to what ToHuus does today. Anything not finished yet is marked “Coming soon”. The full set of articles is in German.',
    soon: 'Coming soon',
    soonLong: 'Coming soon: this is being built. This page says what is planned and what you can do today.',
    related: 'Related',
    back: 'All help topics',
    onPage: 'On this page',
    missing: 'Something missing or wrong? Write to',
    other: 'Deutsch',
    groups: [
      ['start', 'Getting started'],
      ['shop', 'Shopping'],
      ['cook', 'Cooking'],
      ['home', 'Home'],
      ['ai', 'Assistant and AI'],
      ['people', 'Guests and house info'],
      ['connect', 'Connect'],
      ['account', 'Account, data, privacy'],
    ],
    articles: [
      {
        slug: 'getting-started', pair: 'erste-schritte', group: 'start', title: 'Getting started',
        desc: 'Create an account, say who belongs to the household and meet the areas.',
        sections: [
          ['Account or your own server', p(
            `In ToHuus Cloud you create an account and a household in the iPhone app or in the browser at <a href="${k.CLOUD}">${k.CLOUD.replace('https://', '')}</a>. You can sign in with an e-mail code, a password, a passkey or Sign in with Apple. Every new household gets 14 days of Plus, no payment details needed. You find the app <a href="${k.APP_EN}">on the App Store</a>.`,
            'If you have your own server, ToHuus runs there as a Docker container (see <a href="self-hosting.html">Self-hosting</a>). You then use the web app in the browser or the iPhone app: on its start screen tap “Own server” and sign in with the address and your password, in the browser or with a QR code from the web app.',
          )],
          ['Who belongs to it?', p('On first start ToHuus only asks this: just you, the two of you, a family, a flat share, or a household you look after. What you see follows from that, and you can change it later.')],
          ['The areas', ul(
            '<b>Today</b>: what is due, what is coming up, what should be used soon and what you can cook.',
            '<b>Shopping</b>: the shared list, shop mode and your wishes.',
            '<b>Cooking</b>: ideas from what is at home, recipes, favourites and the week plan.',
            '<b>Tasks</b>: what needs doing at home, appointments included. At the top you find the house info and “Trip / away”.',
            '<b>Stock</b>: what is at home and what should be used soon, only if you want it.',
          ), p('Money, <a href="household-knowledge.html">home knowledge</a>, <a href="bring-me-something.html">Bring me something</a>, wishes and the rest are under “More”. Whatever you need often goes into the bar at the bottom, see <a href="your-bar.html">Your bar</a>. If you switch off cooking, stock or money under “What do you use?”, they disappear everywhere.', 'The round button with the sparkle is the assistant, on every page. At the top right of every page you find search and your picture. Your picture opens “More” with household, settings, devices & connections and help.')],
          ['Search', p(
            'The magnifier at the top right is on every page; in the browser there is also the search field in the sidebar. Press ⌘K, Ctrl+K or “/” to open it from anywhere, as long as you are not typing somewhere else.',
            'It finds what you can reach in ToHuus: functions and settings (also with words like “password”, “print labels” or “dark mode”), products in stock, what is on the list, recipes, also by an ingredient, tasks, house info cards and people in the household. If nothing fits, it offers to put your words on the list or create a new task.',
          ), tip('Search follows the same rules as everything else: private items and private tasks only for their owner, house info codes never, and guests only what their level shows.')],
          ['The first week', p('Write what is missing on the list, tick off what you buy, share receipts if you have them and invite the others. If you like, add what comes up again and again at home under Tasks (see <a href="tasks.html">Tasks</a>). Nothing needs upkeep. After a few weeks ToHuus knows your rhythm and suggests what is due again.')],
        ],
        related: ['receipts', 'tasks', 'faq'],
      },
      {
        slug: 'shopping-together', pair: 'gemeinsam-einkaufen', group: 'shop', title: 'Shopping together',
        desc: 'Live on every phone, adding while someone is in the shop, and splitting the aisles.',
        sections: [
          ['Live on every device', p('The list is up to date on every phone and in the browser at once. When someone ticks something off in the shop, it disappears for everyone else within seconds.')],
          ['Add while someone is out', p('Thought of something at home? Put it on the list. Whoever is in the shop sees it right away in shop mode, in the right aisle. No phone call needed.')],
          ['Two of you in the shop', p('Tap “I’ll get it” on an item and the others see it is taken. Nobody buys twice, and you can split the aisles.')],
          ['No signal', p('ToHuus remembers what you tick off and syncs as soon as you are back online.')],
          ['On the Apple Watch', p(`The iPhone app comes with a Watch app: the list sorted by shop, tick off with undo, also without the iPhone nearby.`)],
        ],
        related: ['getting-started', 'speak'],
      },
      {
        slug: 'receipts', pair: 'kassenbons', group: 'shop', title: 'Sharing receipts',
        desc: 'E-receipts, PDF, photos and text: how receipts get into ToHuus and what happens to them.',
        sections: [
          ['Digital receipts', p('Share an e-receipt or order PDF with ToHuus, for example from your mail app. For REWE in Germany, ToHuus matches the order with the receipt and books what was actually delivered.')],
          ['Paper receipts', p('Take a photo in the app. ToHuus first reads the text itself on the server (text recognition without AI) and checks that the lines add up to the total. Only if they do not and AI is on, Mistral reads the photo again.', 'With AI off it stays with text recognition. Lines read unclearly are marked, you correct them in the check.')],
          ['Check before booking', p('You find all receipts under Money › Receipts. Every receipt waits for a check first. Anything ToHuus could not read with confidence is marked. Correct a line and ToHuus remembers it for that shop. Before receipt text goes to the AI, card and loyalty numbers, TSE data and the address are removed.')],
          ['Which shops', p('REWE is tested best. Other German chains, UK, US and Swedish receipts have parsers tested with synthetic receipts. Anonymised real receipts help: every check has “Help improve recognition”. Nothing is sent by itself.')],
        ],
        related: ['ai-on-or-off', 'getting-started'],
      },
      {
        slug: 'tasks', pair: 'aufgaben', group: 'home', title: 'Tasks',
        desc: 'What needs doing at home, once or again and again, who does it and who keeps what in mind.',
        sections: [
          ['What belongs here', p(
            'Tasks holds what needs doing in your home. <b>Household</b> is things like cleaning the bathroom, taking out the bins or changing the bed linen. <b>Care & deadlines</b> is water filters, smoke detectors, the car inspection or passports. At the top you filter by All, Household, Care & deadlines and Mine.',
            'To get going there are templates for the usual chores. On Today a card shows what is on today, and one tap ticks it off.',
          )],
          ['Once, again and again, or when needed', ul(
            '<b>Once</b>: on a fixed date. When it is done, it leaves the overview.',
            '<b>Again and again</b>: every few days, weeks or months, or on fixed weekdays. You choose whether the next time counts from when it was done or from the planned day, such as “every Monday”.',
            '<b>When needed</b>: no date, such as taking the glass away. It is never due and is there when the time comes.',
          ), p('For recurring tasks one tap on “Done” is enough. ToHuus works out the next date.')],
          ['For everyone or only for me', p('A task belongs to the whole household or only to you. Nobody else sees what is “Only for me”: not the other members, no guests, not the assistant, no displays, not Home Assistant. Reminders for it go only to you.')],
          ['Sub-items', p('A task can have sub-items, for the bathroom say sink, mirror, floor. You tick them off one by one. When the task is done, they are open again for next time.')],
          ['Who does it', p(
            'Under “Who does it” you choose a member or a child from your kid profiles, or leave it at “Whoever has time”. Separately, someone can say “I keep it in mind”: that person remembers it, even when someone else does it.',
            'If you take turns, switch on “Take turns” and choose who joins in, for example “Bathroom every Saturday, Mira and Sam take turns”. “Done” passes the task to the next person, “Undo” gives it back.',
          )],
          ['Coming up and the bins', p('On Today, “Coming up” shows what is due tomorrow and over the next days, and who has taken it on. Bin tasks show up the evening before they are due with “tonight: put out”, and from 5 pm at the very top. On the iPhone ToHuus can read collection dates from your calendar, under Tasks › Read your existing calendar.')],
          ['Done by mistake', p('One tap on “Undo” takes it back. With tasks you take turns on, it goes back to whoever was up before.')],
          ['Recently done and your rhythm', p('“Recently done” shows what got done in the last few days. After a few times each task shows how often you really do it, for example “You do it about every 9 days”. That tells you whether the planned rhythm fits your life.')],
          ['Who keeps what in mind', p(
            'Noticing and planning is work too. “Who keeps what in mind” shows for the last 28 days who looked after shopping, cooking, money and tasks: who put something on the list or shopped, planned meals, brought in receipts or did tasks.',
            'It shows names only, in alphabetical order, without numbers. Only you see your own number. Shares in percent appear only once everyone in the household has switched on “Compare shares”. Below, it lists due tasks nobody keeps in mind yet.',
          ), tip('Private list items, personal receipts and tasks that are “Only for me” never count here. Guests do not see this part.')],
          ['Appointments', p(
            'Give a task with a date a time and it becomes an appointment, with a duration and a place if you like, such as “Dentist, Tuesday 3 pm, 30 min”. “Add to calendar” puts a single task into your calendar.',
            'All tasks and appointments in Apple Calendar, Apple Reminders, Google Calendar or Outlook at once: see <a href="reminders-calendar.html">Reminders and calendars</a>. Your private tasks go into your own calendar, apart from the household’s.',
          )],
          ['With the assistant', p('Tell the <a href="speak.html">assistant</a> something like “Change the bed linen every two weeks” or “What is on today?”. It adds tasks, ticks them off and hands them out. Everything it adds can be undone.')],
        ],
        related: ['reminders-calendar', 'speak', 'getting-started'],
      },
      {
        slug: 'a-lot-on-your-mind', pair: 'kopf-voll', group: 'home', title: 'When your head is full',
        desc: 'Small steps, one thing at a time, a visible timer and gentle mode: for heads with a lot going on.',
        sections: [
          ['Who it is for', p('With ADHD, autism or just a packed week, starting is often the hardest part. These features are built for that, and they help everyone in the household. Nobody has to explain why they use them. ToHuus is not a health or therapy service and does not replace advice.')],
          ['Small steps', p('Every task can be split into small steps you tick off one by one. “Split into small steps” suggests some: with AI if your household allows AI, otherwise from ready-made steps for common chores such as cleaning the bathroom, the kitchen, laundry, hoovering or changing the bed. You can change or delete every suggestion. When the task is done, the steps are open again for next time.')],
          ['One thing at a time', p('The focus view shows just one thing: the next task and its next step, large and without a list around it.'), ul(
            '<b>Done</b>: ticks off the step and shows the next one.',
            '<b>Later</b>: puts the task aside, no guilt.',
            '<b>Too big? Make it smaller</b>: splits the task into smaller steps.',
          )],
          ['Visible timer', p('Start with five minutes, just to get going. A ring shows how much time is left, and a gentle signal sounds at the end. There is no tracking and no statistics, nothing is counted.')],
          ['Gentle mode', p('A personal setting that only applies to you:'), ul(
            'No red overdue warnings and no counters. Things that are due say “could be done”.',
            '“Fresh start” moves everything overdue to a new start, without a guilty conscience.',
            'Notifications arrive bundled in one message at a time you choose.',
            'Today shows at most three things.',
          ), p('The others in the household do not see whether you have switched gentle mode on.')],
          ['Extras in the weekly shop', p('You set an allowance for extras, the treats and fun things: per week as an amount or a number of items. Mark items on the list as an extra, and the list shows how much of the allowance is used. ToHuus blocks nothing, it just keeps the overview, especially with impulse buys.')],
          ['Already there', ul(
            'No streaks, no rankings. Stars only exist if you switch them on in the household settings, and gentle mode hides them. “Who keeps what in mind” lists names alphabetically, shares only if everyone agrees (see <a href="tasks.html">Tasks</a>).',
            '“Where is what?” knows where things are, and the stock list shows what is at home and what is running out.',
            'With the <a href="speak.html">assistant</a> a thought is on the list or with the tasks in one sentence.',
            '“Bring me something” for days when getting up is hard.',
            'ToHuus follows “Reduce motion” on your device.',
          )],
        ],
        related: ['tasks', 'speak', 'getting-started'],
      },
      {
        slug: 'house-info', pair: 'hausinfo', group: 'people', title: 'House info for guests and babysitters',
        desc: 'From the guest Wi-Fi to the coffee machine: cards with everything someone looking after your home needs to know, and a link without an account.',
        sections: [
          ['What it is for', p('The house info (at the top of Tasks, or in your bar if you like) holds on cards what babysitters, grandparents, house and pet sitters or overnight guests need to know. Write it down once and then just send a link instead of answering the same questions every time.')],
          ['What goes on the cards', ul(
            '<b>Guest Wi-Fi</b>: network and password as a code. Whoever may see it taps “Show” and gets a QR code that takes a phone onto the Wi-Fi.',
            '<b>How things work</b>: heating, dishwasher, blinds, washing machine, TV, coffee machine.',
            '<b>House rules and kids</b>: what the kids may do, when bedtime is, whatever else goes in your home.',
            '<b>Emergencies</b>: fuse box, water stopcock and important numbers. The numbers always come first.',
            '<b>Voice commands and routines</b>: “Alexa, living room lights on” or what “Good night” sets off.',
          ), p('Templates for Alexa, Google, Apple, Home Assistant and everyday tips help you get started. Every card can have up to eight photos or short videos.')],
          ['Who sees what', p('For every card you decide who sees it: everyone who lives here, regular guests from a level up, all babysitter links or specific guest links. Codes can be shared until a date.')],
          ['Codes', ul(
            'Door code, alarm, garage and Wi-Fi are stored apart from the cards, encrypted in the cloud.',
            'At first only the people who live here see a code. Guests and links only get it if you share it.',
            'A code stays hidden until someone taps “Show”, and you see who looked when, never the code itself.',
            'Codes never go to the assistant or any other AI, to AI assistants over MCP, Home Assistant, displays or notifications. They only go into an export or onto the printed sheet if an admin ticks that.',
          )],
          ['The babysitter link', p('Under Guests you create a link with the “Babysitter” template. It works without an account or app, as a link or a QR code. It shows the house info, “Where is what?” for the places you choose and your note. Once opened, the house info stays readable without a connection. “Print” turns it into an A4 sheet “For the babysitter”. Give the link an end date or revoke it at any time.')],
          ['Holiday handover', p('For a trip you set what the house sitter should do and when: feed the cat, water the plants, collect the post, with photos. They see it through their link and tick off what is done. The house sitter link ends the day after you are back.')],
        ],
        related: ['tasks', 'privacy-in-short'],
      },
      {
        slug: 'speak', pair: 'sprechen', group: 'ai', title: 'The assistant',
        desc: 'What the assistant does, what it adds and how to undo it.',
        sections: [
          ['Speak or type', p('The round button with the sparkle at the bottom right is the assistant, on every page. Type what is going on, or tap the microphone and say it: “We are out of milk, and we need something for Sunday.” The assistant puts milk on the list and asks what you would like on Sunday.')],
          ['What it can do', ul(
            'Add to the list, tick off, remove.',
            'Say what is still there and what is due.',
            'Suggest what you can cook and put a dish into the week plan.',
            'Answer money questions: “What did the shopping cost in September?”',
            'Log a purchase without a receipt.',
            'Add, tick off and hand out tasks: “Clean the bathroom every Saturday, Mira and Sam take turns.” With a time it becomes an appointment.',
            'Say what is on today and who keeps what in mind.',
            'Look up and add home knowledge: “What shoe size is Mika?” or “Remember, the bathroom blind is 65 wide.”',
          )],
          ['Everything can be undone', p('Under every answer it says what it added, with “Undo”. It only writes when you ask it to.')],
          ['Private', p('Only the person who had a conversation sees it. Conversations are deleted 30 days after the last message. Voice recordings are turned into text and not stored. Tasks that are only for you never reach the assistant.')],
        ],
        related: ['ai-on-or-off', 'ai-limits', 'household-knowledge'],
      },
      {
        slug: 'ai-on-or-off', pair: 'ki-an-oder-aus', group: 'ai', title: 'With or without AI',
        desc: 'What works without AI, what it adds, and how to switch it off for the household, yourself or a child.',
        sections: [
          ['Without AI', p('The list, suggestions from the purchase rhythm, the cook planner, the week plan, money, PDF receipts and the common short sentences in the assistant all work without a language model.')],
          ['What AI adds', p('Reading photos of paper receipts and recipes, open questions to the assistant, turning speech into text.')],
          ['Which model', p('In ToHuus Cloud every request goes to Mistral, a provider based in France, routed through OpenRouter (USA), pinned with no fallback. Nothing is used for training. Before AI runs for you, ToHuus asks once for your consent; you can withdraw it under Settings › Access & AI. Self-hosted, you bring your own key or none.')],
          ['Switching it off', ul(
            '<b>For the whole household</b>: Settings › Access & AI, admins only.',
            '<b>Just for you</b>: same place. The others do not see your choice.',
            '<b>For a child</b>: parents switch AI off per child. It cannot be changed on the kid tablet.',
            '<b>AI assistants via MCP</b> (Claude, ChatGPT) have their own switch.',
          ), p('In ToHuus Cloud AI only starts after you agreed once; you can withdraw that under Settings › Access & AI. For children it is off until a parent switches it on, and receipts by mail and children only use AI after an admin agreed.', 'While AI is off, not a single request goes to a language model.')],
          ['Health data', p('Allergies and details about children only go to a language model if an admin explicitly switches that on.')],
        ],
        related: ['speak', 'privacy-in-short'],
      },
      {
        slug: 'recipe-pack', pair: 'rezeptpaket', group: 'cook', title: 'The ToHuus recipe pack',
        desc: 'Many recipes at once: the format, a prompt for your own AI and the way back out.',
        sections: [
          ['What it is', p('A ZIP file with a <code>rezepte.json</code> and a folder <code>bilder/</code>, or just the JSON. Every recipe is in the open schema.org/Recipe format, optionally with appliance steps (Thermomix, oven, air fryer) with time, temperature, speed and mode.')],
          ['Import and export', p('Cook › Recipes › Recipe pack. You get a preview (new, update or “already here?”) and choose. Up to 100 MB and 1,000 recipes per pack. The same menu exports your recipes as a pack, with or without photos.')],
          ['Make one with your own AI', p('The app has the full prompt with an example to copy. The short version:'), k.code('prompt-en', 'Prompt', `Make me a ToHuus recipe pack from these photos.

Give me a file rezepte.json in schema.org Recipe format:
{"format": "tohuus-rezeptpaket", "version": 1, "recipes": [ ... ]}

Per recipe: name, recipeYield, totalTime (ISO 8601, e.g. PT35M),
recipeIngredient (one line per ingredient as written),
recipeInstructions (one HowToStep per step).
For appliances, a "tohuus" block per step with device, time,
temperature, speed and mode, only what the source says.
If you can create files, give me a ZIP with rezepte.json and a
folder bilder/ with the photos; "image" is then "bilder/<file>".
Otherwise answer with the JSON only.
Keep the recipe's language and do not invent anything.`), p('Check the preview before importing. An AI can misread a quantity too.')],
          ['Keep it legal', ul(
            'Only use content that is yours or that you can access with your own account: your cookbooks, your notes, your exports.',
            'The pack is for private use in your own household.',
            'No passwords for the AI and no automated fetching from other people’s accounts or services.',
          )],
        ],
        related: ['getting-started', 'faq'],
      },
      {
        slug: 'home-assistant', pair: 'home-assistant', group: 'connect', title: 'Connect Home Assistant',
        desc: 'Step by step with HACS and a code from the app, for ToHuus Cloud and your own server.',
        sections: [
          ['What you get', ul(
            'The shopping list as a to-do list, both ways, also for Assist and voice.',
            'Sensors: what is due, how much is on the list, what this month and week cost.',
            'The week plan as a calendar.',
            'ToHuus notifications to your notify services.',
            'Per topic, who leads: Home Assistant, ToHuus or both.',
          ), p('Home Assistant connects out by itself (HTTPS and live updates). Nothing in your home has to be reachable from the internet.')],
          ['Install HACS', p('If you have not yet: follow <a href="https://hacs.xyz/docs/use/">hacs.xyz</a> and restart Home Assistant.')],
          ['Add the integration', ol(
            'Home Assistant: HACS › ⋮ › Custom repositories.',
            'Enter <code>tillheidrich/tohuus-hub-ha</code>, type “Integration”, add it.',
            'Search for “ToHuus Hub”, download, restart Home Assistant.',
          )],
          ['Get a code in ToHuus', p('ToHuus: Settings › Home Assistant › “Connect Home Assistant”. You get a code like <code>ABCD-EFGH</code>, valid for 10 minutes and once. Household admins only.')],
          ['Set it up', ol(
            'Home Assistant: Settings › Devices & services › Add integration › ToHuus Hub.',
            'Choose <b>ToHuus Cloud</b> and enter the code. Done.',
            'Or <b>Own server</b>: the address Home Assistant reaches your ToHuus at (e.g. <code>http://192.168.1.20:8080</code>) and the code.',
          ), p('Home Assistant gets its own access, listed in ToHuus under Settings › Access & AI, where you can revoke it. It can only use the Home Assistant interface.')],
          ['Example dashboard', k.code('ha-yaml-en', 'YAML', `type: vertical-stack
cards:
  - type: tile
    entity: sensor.tohuus_hub_due
    name: Due
  - type: todo-list
    entity: todo.tohuus_hub_shopping_list
    title: Shopping list
  - type: glance
    entities:
      - entity: sensor.tohuus_hub_shopping_list
        name: List
      - entity: sensor.tohuus_hub_spending_week
        name: Week
      - entity: sensor.tohuus_hub_spending_month
        name: Month
  - type: calendar
    initial_view: listWeek
    entities:
      - calendar.tohuus_hub_meal_plan`), p('Ready-made dashboards for the kitchen and a wall tablet are in the repository folder <code>dashboards/</code>.')],
          ['If it does not work', ul(
            '“This code is not valid (any more)”: codes last 10 minutes and work once. Get a new one.',
            'Own server “cannot be reached”: use the address Home Assistant can reach. Inside Docker, “localhost” is the container itself.',
          )],
        ],
        related: ['connect-claude-chatgpt', 'self-hosting'],
      },
      {
        slug: 'connect-claude-chatgpt', pair: 'claude-chatgpt', group: 'connect', title: 'Connect Claude or ChatGPT',
        desc: 'Connect your household to the AI assistant you already use, through MCP.',
        sections: [
          ['The address', k.code('mcp-url-en', 'MCP', `${k.CLOUD}/mcp`), p('Self-hosted, it is your server’s address with <code>/mcp</code> at the end.')],
          ['Signing in', p('When connecting you sign in with your ToHuus account (OAuth), choose the household and what the assistant may do: read, or read and change; allergies and details about children only if you tick it. Settings › Access & AI lists every connection, and you can end it there.', 'For Home Assistant and older apps there is still an access with a key in the address: Settings › Access & AI › New access › AI assistant. Treat it like a password.')],
          ['In Claude and ChatGPT', ul('Claude: Settings › Connectors › Add custom connector, paste the address.', 'ChatGPT: Settings › Connectors (developer mode on some plans), paste the address.')],
          ['What the assistant may see', ul(
            'Your household’s list, tasks, stock, recipes, week plan, spending and home knowledge.',
            'Discreet items only as a placeholder, private ones not at all.',
            'Allergies and details about children only if an admin explicitly allows it.',
            'House info codes never.',
          ), p('Purchases the assistant logs wait for a check first. An admin can switch MCP off for the whole household.')],
          ['And the AI limits?', p('Your own assistant uses its own language model. Nothing comes off the messages to the assistant in ToHuus.')],
        ],
        related: ['ai-on-or-off', 'household-knowledge', 'privacy-in-short'],
      },
      {
        slug: 'reminders-calendar', pair: 'erinnerungen-spiegeln', group: 'connect', title: 'Reminders and calendars',
        desc: 'Shopping lists, tasks and appointments in Apple Reminders, Apple Calendar, Nextcloud, Google Calendar or Outlook.',
        sections: [
          ['What you get', p('ToHuus is a CalDAV server itself. With one password, Apple Reminders and Apple Calendar show:'), ul(
            'Each of your shopping lists as its own reminder list.',
            '“ToHuus · Tasks” with the household’s tasks and “ToHuus · Only for me” with your own.',
            '“ToHuus · Calendar” and “ToHuus · My calendar” with every task that has a date, and your appointments.',
          ), p(
            'Everything works both ways. Tick something off in Reminders and it is done in ToHuus. A new reminder in “ToHuus · Tasks” becomes a task. Move or rename an appointment in the calendar and the task changes; a new event there becomes a task. Deleting puts the task away in ToHuus.',
            'A recurring task shows as one event on its next date; ToHuus keeps the rhythm. What is only for you appears only in “Only for me” and “My calendar”, and only with your own password.',
          )],
          ['Set it up on the iPhone', ol(
            'In ToHuus: at the bottom of Tasks or under Settings › My account, find “Reminders & Calendar” and tap “Create password”. Server, user name and password are shown once.',
            'For Reminders: Settings › Apps › Reminders › Accounts › Add Account › Other › Add CalDAV Account, and enter the three details.',
            'For Calendar: Settings › Apps › Calendar › Calendar Accounts › Add Account › Other › Add CalDAV Account, with the same details.',
            'Open Reminders and Calendar: your ToHuus lists and calendars are under the new account.',
          ), p('Nextcloud Tasks, DAVx⁵ or Thunderbird take the full address ending in <code>/caldav/</code>. Every password can be revoked on its own.')],
          ['Google Calendar and Outlook', p('For calendars without CalDAV there is a calendar subscription. Under “Calendar subscription for Google, Outlook and others” tap “Create link”, with your private tasks if you like.'), ul(
            'Google Calendar (web): Other calendars › + › From URL, paste the link.',
            'Outlook: Add calendar › Subscribe from web, paste the link.',
            'On a Mac or iPhone one tap on “Open in calendar” is enough.',
          ), p('The subscription is read-only, and the calendar fetches the latest state about every hour. Keep the link to yourself: whoever has it sees the entries. You can delete it any time.')],
          ['A single task', p('Every task with a date has “Add to calendar”. On the iPhone the event opens straight in Calendar; in the browser you download it as a file. No password needed. The entry is a copy and does not change along with the task.')],
        ],
        related: ['tasks', 'home-assistant', 'shopping-together'],
      },
      {
        slug: 'move-to-the-cloud', pair: 'umzug-in-die-cloud', group: 'account', title: 'From your own server to the cloud',
        desc: 'Taking a self-hosted household into ToHuus Cloud.',
        sections: [
          ['In one go', ol('On your server: Settings › Data › Move to ToHuus Cloud › Download move file. It holds list, stock, recipes, receipts, rhythm and photos.', 'In ToHuus Cloud, create a new household.', 'There: Settings › Data › Bring a household from your own server, enter your password, choose the file.'), p('People are matched by e-mail or name; anyone without a cloud account yet appears as a person you can invite.')],
          ['What stays behind', ul('Sign-ins, devices, accesses and links.', 'Conversations with the assistant and what others marked “only for me”.', 'House info codes, unless you tick “take the codes along”.')],
        ],
        related: ['self-hosting', 'recipe-pack'],
      },
      {
        slug: 'self-hosting', pair: 'selbst-hosten', group: 'account', title: 'Self-hosting with Docker',
        desc: 'ToHuus on your own server, free under the AGPL-3.0.',
        sections: [
          ['Install', k.code('host-sh-en', 'Terminal', `git clone ${k.GH}.git
cd tohuus-hub
cp .env.example .env
docker compose up -d --build`), p('In <code>.env</code> set <code>BASE_URL</code>, your name and a password, then open <code>http://localhost:8080</code>. Your data lives in <code>./data</code>.')],
          ['HTTPS and the web app', p('Put your usual reverse proxy in front, such as Caddy or another one with Let’s Encrypt. Then open the web app in the browser and add it to your home screen.')],
          ['With the iPhone app', p('The iPhone app works with your own server too. It needs https with a valid certificate; plain http only works in your home network. On the app’s start screen tap “Own server” and enter the address you open ToHuus with in the browser. Then there are three ways in:'), ul(
            '<b>Password</b>: name or e-mail and password, plus the code if you switched on two-step sign-in.',
            '<b>Sign in in the browser</b>: with whatever your server offers, such as a passkey, an e-mail link or SSO. A page then asks “Connect the ToHuus app?” and you confirm.',
            '<b>QR code</b>: in the web app, Settings › My account › “Connect the iPhone app” shows a QR code. In the app tap “Scan QR code” and point it there. No address or password to type.',
          ), p('One iPhone can be signed in to several servers and households; you switch with one tap. On your own server everything in the app is included, no plans, no payments.'), tip('Creating a passkey right in the app only works with ToHuus Cloud; that is Apple’s rule. On your own server, use “Sign in in the browser” for your passkey.')],
          ['AI', p('Optional, with a key for any OpenAI-compatible service, such as Mistral, local ones included. Without a key everything works except open questions to the assistant. Photos of paper receipts are then read by text recognition on your server, without AI.')],
          ['Backups', p('A backup every night, optionally copied to a WebDAV share like Nextcloud. The database can be encrypted with <code>DB_ENCRYPTION_KEY</code>.')],
        ],
        related: ['getting-started', 'home-assistant', 'move-to-the-cloud'],
      },
      {
        slug: 'privacy-in-short', pair: 'datenschutz-kurz', group: 'account', title: 'Privacy in short',
        desc: 'Where your data lives, who sees it and what never happens.',
        sections: [
          ['Where', p('ToHuus Cloud runs on Hetzner servers in Germany. Every household has its own encrypted database with its own key. Photos and receipt files are encrypted too.')],
          ['What never happens', ul('No tracking and no ads, in the app or on this website.', 'Your receipts are not sold or analysed for market research.', 'No offers from outside, no affiliate links.')],
          ['AI', p('Only through Mistral, pinned. Health data only with your explicit permission. You can switch AI off for the household, for yourself and for children.')],
          ['The details', p('In the <a href="../privacy.html">privacy policy</a>.')],
        ],
        related: ['ai-on-or-off', 'subscription'],
      },
      {
        slug: 'subscription', pair: 'abo-und-kuendigen', group: 'account', title: 'Subscription and cancelling',
        desc: 'Trial, Household and Plus, how you pay and what happens when you cancel.',
        sections: [
          ['One subscription per household', p('Household is €3.99 a month or €34.99 a year, Plus €5.99 a month or €59.99 a year. Members, children, guests and connected households never pay. Self-hosted, everything is free.')],
          ['Trying it', p('Every new cloud household gets 14 days of Plus, no payment details needed. Without a plan after that, everything stays visible and exportable, only adding and changing things stops. Ticking off the shopping list keeps working for seven days. Nothing is charged on its own.')],
          ['Paying and cancelling', p('You subscribe in the iPhone app and pay through your Apple ID. To cancel: iPhone Settings › your name › Subscriptions › ToHuus › Cancel subscription. It runs until the end of the paid period. Nothing is deleted after that: you can look at everything and export it, and adding things works again with the next subscription.')],
          ['Codes from us', p('You can also get a code from us, for a month, a year or for good. An admin of your household redeems it in the browser under Settings › Subscription › Redeem code. After that it works on every device, the iPhone included. It cannot be redeemed inside the iPhone app.')],
          ['When money is tight', p('Write to us through the form “We can’t afford this right now” under <a href="../#cant-afford">Pricing</a>. You get a licence, no reasons needed. Every subscription helps pay for it.')],
        ],
        related: ['faq', 'privacy-in-short'],
      },
      {
        slug: 'how-tohuus-works', pair: 'so-funktioniert-tohuus', group: 'start', title: 'How ToHuus works',
        desc: 'One place for the household: how ToHuus remembers what is missing, what is coming up and what you know.',
        sections: [
          ['One place for the household', p('ToHuus is one place for the household: what is missing, what is coming up, what needs doing, what it costs and what you know about your home. Shopping is where it starts, not the whole app.', 'It does not replace your calendar, notes app or chat. It takes what belongs to the household from them, like bin collection dates from your calendar, and puts tasks back there if you like.')],
          ['Write it in, ToHuus sorts it', p('Type it, say it or take a photo of a receipt: “Out of milk”, “Yellow bin every two weeks”, “Mika is shoe size 12 now”. The milk goes on the list, the bin to the tasks and the shoe size into <a href="household-knowledge.html">home knowledge</a>. Whatever ToHuus is not sure about, it asks you to confirm instead of guessing.')],
          ['Suggestions, not automation', p('From receipts and ticks on the list ToHuus learns how often you buy things. When something is due again, it shows up as a suggestion with its reason. Nothing lands on your list without a tap.')],
          ['Your household’s memory', p('Sizes, measurements, meter readings and whatever else only one person keeps in mind live as cards in home knowledge. From then on you ask ToHuus instead of that one person, and there is nothing to maintain.', 'It helps AI too: an assistant can only work with what it knows about you. With home knowledge it answers without guessing, the assistant in ToHuus as well as Claude or ChatGPT over <a href="connect-claude-chatgpt.html">MCP</a>.')],
          ['Coming up', p('On Today, “Coming up” shows what is next tomorrow and over the next days. The bin is there the evening before, from 5 pm at the very top.')],
          ['Everything can be undone', p('Ticked off, deleted or imported by mistake? “Undo” brings it back, also for what the assistant added.')],
          ['Your bar', p('The bar at the bottom starts with Today, Shopping, Cooking, Tasks and Stock. Money, home knowledge, Bring me something and more can go in, per person (see <a href="your-bar.html">Your bar</a>).')],
          ['AI if you want it', p('Most things work without AI. With AI, ToHuus reads tricky receipts and understands open questions, in the cloud through Mistral and only with your consent. There is an open monthly limit, see <a href="ai-limits.html">Fair AI limits</a>.')],
        ],
        related: ['getting-started', 'household-knowledge', 'your-bar'],
      },
      {
        slug: 'household-knowledge', pair: 'haushaltswissen', group: 'home', title: 'Home knowledge',
        desc: 'Sizes, measurements, meter readings and whatever else you know about your home: add it, find it, bring it in, save it as a file.',
        sections: [
          ['What belongs here', ul(
            '<b>People</b>: the children’s shoe and clothing sizes, likes and dislikes, intolerances and allergies, the paediatrician’s number.',
            '<b>Rooms</b>: blind and window measurements, which bulb base fits which lamp, where the main water tap and the fuse box are.',
            '<b>Things</b>: meter numbers and readings, filters for the cooker hood and the hoover, tyre size, when the boiler was last serviced.',
            '<b>Rules</b>: what goes in which bin at your place.',
          ), tip('Codes, PINs and Wi-Fi keys are not accepted here. They belong in the house info under Codes.')],
          ['Why it helps', p('Usually one person knows these things and keeps getting asked. Once it is in ToHuus, you ask ToHuus. There is nothing to maintain: whoever notices a change adds the new value, and the old one stays in the history.', 'It helps AI too. With home knowledge the assistant answers “What shoe size is Mika?” without guessing, and so do Claude or ChatGPT over <a href="connect-claude-chatgpt.html">MCP</a>.')],
          ['Adding', p('Find it under “More” › Knowledge or in your bar. Type a sentence like “Mika shoe size 12” or “Living room blind 120 x 160”, or tell the assistant. ToHuus understands short sentences like these without AI too.')],
          ['Bringing notes and lists in', p('Under Import, paste text from notes or emails, or pick a list: Excel, Numbers or Google Sheets as CSV, or a text file. Markdown, for example from Obsidian or Notion, and JSON work too.', 'Before anything is saved you see every card found, marked “new”, “new value” or “unchanged”, and tick what goes in. Codes and passwords stay out, health details become private. “Undo” takes back the whole import.')],
          ['Saving it as a file', p('Under Export you get everything, or what the search shows, as Markdown, CSV or JSON. On the iPhone use “Save to Files”. Only what you may see is exported, and every one of these files can be read in again.')],
          ['Who sees what', p('Every card is for the whole household or only for you. Health details are private by default and only reach an AI if your household allows it. Regular guests only see cards you share with guests.')],
        ],
        related: ['house-info', 'speak', 'connect-claude-chatgpt'],
      },
      {
        slug: 'your-bar', pair: 'deine-leiste', group: 'start', title: 'Your bar',
        desc: 'Everyone chooses which areas sit in the bar at the bottom.',
        sections: [
          ['The start', p('The bar starts with Today, Shopping, Cooking, Tasks and Stock. If cooking or stock is switched off, Money moves up. Everything else is under “More”.')],
          ['What you can add', p('Today always stays first. Then up to four areas in your order: Shopping, Cooking, Tasks, Stock, Money, Knowledge, <a href="bring-me-something.html">Bring me something</a>, Wishes or House info. The assistant stays the round button at the bottom right.')],
          ['How', ol('Touch and hold the bar, tap “Adjust the bar” under “More”, or open Settings › Your bar.', 'The green plus adds an area, the red minus removes it.', 'Drag the handles into the order you like. “Back to the start” resets it.')],
          ['Who it is for', p('Your bar is yours, the same on iPhone, iPad and in the browser. The others keep theirs. Regular guests always get the standard bar.')],
        ],
        related: ['getting-started', 'how-tohuus-works'],
      },
      {
        slug: 'bring-me-something', pair: 'bring-mir-was', group: 'home', title: 'Bring me something',
        desc: 'Ask for a little something at home, and whoever can brings it.',
        sections: [
          ['What it is for', p('Stuck on the sofa, ill in bed or with a child in your arms: ask for a little something, and someone at home brings it. It is there as soon as more than one person lives with you.')],
          ['How', ol('Open Bring me something, under “More” or in your bar.', 'Tap a tile such as something sweet, something to drink or from the fridge, or write a free wish like tea with honey.', 'Ask one person or everyone.'), p('The others get a notification with “I’ll bring it” or “Can’t right now” and a short reason. You see who is bringing it and can say thanks.')],
          ['What it does not have', p('No points, no rankings, no tally of who brought what.')],
        ],
        related: ['a-lot-on-your-mind', 'your-bar'],
      },
      {
        slug: 'ai-limits', pair: 'ki-grenzen', group: 'ai', title: 'Fair AI limits',
        desc: 'How many messages the assistant has a month, what happens then and what keeps working without AI.',
        sections: [
          ['Why there is a limit', p('Every message to a language model costs money, a receipt photo a bit more. So that a few households do not use so much that everyone else pays for it, every household in ToHuus Cloud has a monthly limit. Here is where it is.')],
          ['The limits', ul(
            '<b>Plus and the trial</b>: 800 full-length messages a month. Then replies get shorter, and from 1,500 messages AI pauses until the month ends.',
            '<b>Household</b>: 100 messages to the assistant a month.',
            '<b>Cost cap</b>: every household also has a fixed maximum AI spend per month. If it is reached, for example after a great many receipt photos, AI pauses earlier.',
            '<b>Self-hosted</b>: no limit from us.',
          ), p('A voice message counts once. Settings › Subscription shows how many messages you have used this month.')],
          ['What keeps working', p('The list, suggestions, tasks, stock, the cook planner, money and home knowledge with import and export. The assistant still understands the common short sentences, text recognition reads receipt photos, PDF receipts work as always. Your own AI assistant over MCP does not count.', 'Nothing is charged extra. Next month AI is back.')],
        ],
        related: ['ai-on-or-off', 'speak', 'subscription'],
      },
      {
        slug: 'shopping-list', pair: 'einkaufsliste', group: 'shop', title: 'The shopping list',
        desc: 'One list for everyone, quick entry, “I’ll get it” and shop mode.',
        sections: [
          ['Adding things', p('Write the way you talk: “2 l milk, bread, 6 eggs” becomes three items. ToHuus recognises known products, and what is already on the list does not go on twice. A list copied from a chat goes in as a whole with the paste button.')],
          ['In the shop', p('Shop mode sorts by aisle and learns your route per shop. It works without a connection and syncs as soon as the phone is back online.')],
          ['Ticking off and hiding', p('Hide ticked items with one tap. Nothing is deleted: ToHuus keeps counting them as purchases for the rhythm.')],
          ['Discreet and private', p('Under “Who sees it?” you make an item <b>discreet</b> (the others only see a placeholder like “Drugstore item”) or <b>only for you</b>. The real name never goes to Home Assistant, displays, guest links or AI assistants.')],
        ],
        related: ['shopping-together', 'who-sees-what'],
      },
      {
        slug: 'stock', pair: 'vorrat', group: 'home', title: 'Stock (optional)',
        desc: 'Keep stock if you like. ToHuus does not need it.',
        sections: [
          ['Optional', p('ToHuus does not need stock to know what is missing. The rhythm comes from receipts and ticks. If you want to keep stock anyway, Stock is its own area in the bar at the bottom. If you do not need it, switch it off under “What do you use?”.')],
          ['Only what runs out', p('Instead of counting everything, you can track only the things that regularly run out. Switch at any time, nothing is lost.')],
          ['Counting or fill level', p('Per product: counted, as a fill level (full, half, low, empty) or not at all. Plus best-before per pack, opened and frozen.')],
          ['When something is low', p('You decide per product. When counting, with “keep at least”: below that it counts as low and goes on the list if you like. With fill levels choose “low from low” or already “from half”.')],
          ['Places', p('You decide which places exist at your home. ToHuus does not assume a cellar, chest freezer or pantry.')],
        ],
        related: ['shopping-list', 'how-tohuus-works'],
      },
      {
        slug: 'who-sees-what', pair: 'wer-sieht-was', group: 'people', title: 'Who sees what?',
        desc: 'What is shared, what stays private and what only you see.',
        sections: [
          ['Shared', p('The list, the week plan, recipes, stock and the household’s tasks belong to everyone. Every row shows who added it.')],
          ['Discreet and only for you', p('Others see discreet items only as a placeholder, private ones not at all. Neither ever goes to Home Assistant, displays, guest links or AI assistants.')],
          ['Only for you', p('Your conversations with the assistant, your sign-ins and devices, your personal settings, including whether you switched AI off for yourself, tasks that are “Only for me” and home knowledge cards you keep private.', '“Who keeps what in mind” shows names only. Only you see your own number, shares only once everyone agrees.')],
          ['Guests and children', p('They only see what you share (see <a href="guests.html">Guests and permissions</a>).')],
        ],
        related: ['shopping-list', 'guests', 'privacy-in-short'],
      },
      {
        slug: 'guests', pair: 'gaeste', group: 'people', title: 'Guests and permissions',
        desc: 'Guest links without an account, and regular guests with their own levels.',
        sections: [
          ['Guest links', p('A link or QR code without an account, with templates for visitors, babysitters and grandparents. Depending on the link, people see the house info, look up where things are or write on the list. An end date is optional, revoking works at any time.', 'Party mode is off at first. If you need it, switch it on under Settings › What do you use?.')],
          ['Regular guests', p('Someone who is often there gets their own account with a level that decides what they see, from list only up to almost like a member. A level can be changed for a while or paused.')],
          ['What guests never see', p('Settings, receipts, spending, budgets, backups and access keys, on no level. Discreet and private list items neither.')],
        ],
        related: ['babysitter-link', 'house-info', 'who-sees-what'],
      },
      {
        slug: 'babysitter-link', pair: 'babysitter', group: 'people', title: 'The babysitter link',
        desc: 'A link without an account: house info, where things are and a note, offline and printable too.',
        sections: [
          ['Creating it', p('Under Guests create a link with the “Babysitter” template. It works without an account or app, as a link or QR code.')],
          ['What they see', ul(
            'The <a href="house-info.html">house info</a> with the cards shared with babysitter links, and the codes you explicitly share.',
            '“Where is what?” for the places you choose, read-only and without amounts.',
            'Your note, for example when you will be back.',
            'With Home Assistant, a list of voice commands for lights, blinds and music.',
          )],
          ['Offline and on paper', p('Once opened, the house info stays readable on the phone without a connection. Codes need a connection. “Print” gives you everything as an A4 sheet, with codes shown as “please ask”.')],
          ['End date and revoking', p('Give the link an end date or revoke it when it is no longer needed. For a trip, use the house sitter link: it ends the day after you are back.')],
        ],
        related: ['guests', 'house-info', 'sharing-codes'],
      },
      {
        slug: 'sharing-codes', pair: 'hausinfo-codes', group: 'people', title: 'Sharing codes safely',
        desc: 'Door code, Wi-Fi, alarm: how ToHuus treats codes.',
        sections: [
          ['Codes are secrets', ul(
            'Codes are kept apart from the cards. In the cloud they are encrypted, self-hosted if you set a database key.',
            'At first only the people who live here see a code. Guests and links only get it if you share it, until a date if you like.',
            'You see who showed a code when. The code itself never appears in the log.',
            'Codes never go to the assistant or any other AI, to AI assistants over MCP, Home Assistant, displays or notifications.',
          )],
          ['How', p('Add codes under House info › Codes. They stay hidden until someone taps “Show” and are hidden again after a minute. For the guest Wi-Fi a QR code appears too.', 'If a code is typed into the text of a card, ToHuus refuses the card. Codes belong in the vault.')],
          ['Printing and export', p('The A4 sheet says “please ask” instead of the codes, unless an admin ticks “Print codes”. Exports and moving to the cloud only include codes if an admin explicitly ticks that.')],
        ],
        related: ['house-info', 'babysitter-link', 'who-sees-what'],
      },
      {
        slug: 'notifications', pair: 'benachrichtigungen', group: 'connect', title: 'Notifications',
        desc: 'When ToHuus gets in touch, how to set it up and how it stays quiet.',
        sections: [
          ['On the iPhone', p('The iPhone app sends notifications with buttons like “Add to list”, “I’ll do it” or “Can’t right now”. Switch them on or off per event, and quiet hours keep the night free.')],
          ['In the browser', p('Add the web app to your home screen and it can send push notifications: Settings › Notifications › Push on this device.')],
          ['When', p('For example when a receipt waits for a check, something runs out, a budget gets tight or a new device signs in. A daily summary at a fixed time is possible. While you are away it stays quiet.')],
          ['Self-hosted', p('Also Telegram, ntfy, Gotify, Matrix, e-mail and any webhook.')],
          ['Discreet stays discreet', p('Discreet items appear in notifications only as a placeholder, private ones not at all.')],
        ],
        related: ['shopping-together', 'home-assistant'],
      },
      {
        slug: 'your-data', pair: 'daten-export', group: 'account', title: 'Taking your data with you',
        desc: 'Export, recipe pack, home knowledge as a file and what happens when you delete.',
        sections: [
          ['Export', p('Settings › Data & backups › Download export gives you a JSON file with all your household’s data. Passwords, access keys and integration secrets are left out. Only admins can do this.')],
          ['Recipes and home knowledge', p('Your recipes with photos go along as a <a href="recipe-pack.html">recipe pack</a>. Home knowledge exports as Markdown, CSV or JSON (see <a href="household-knowledge.html">Home knowledge</a>).')],
          ['Spending', p('On the Money page as CSV.')],
          ['Deleting the household', p('In the cloud, deleting first destroys the household’s key, so the database can no longer be read. Then files and backups are deleted. You delete your account under Settings › My account.')],
        ],
        related: ['privacy-in-short', 'move-to-the-cloud', 'subscription'],
      },
      {
        slug: 'faq', pair: 'fragen', group: 'start', title: 'Frequently asked questions',
        desc: 'Short answers to what people often ask.',
        sections: [
          ['Do I have to type everything in?', p('No. Receipts come in as a PDF or a photo, and what you tick off the list counts as a purchase too. You do not have to keep stock.')],
          ['Is ToHuus just a shopping list?', p('No. The list is where most people start. Then there are tasks with appointments, stock, cooking, money, <a href="household-knowledge.html">home knowledge</a> and the assistant, all in the same household.')],
          ['Is there a free version?', p('Not in ToHuus Cloud. Every new household gets 14 days of everything, then you subscribe, or you keep seeing and exporting everything without adding new things. ToHuus is free on your own server (see <a href="self-hosting.html">Self-hosting</a>).')],
          ['Do I need AI?', p('No. See <a href="ai-on-or-off.html">With or without AI</a>. In the cloud there is an open monthly limit, see <a href="ai-limits.html">Fair AI limits</a>.')],
          ['Is there an Android app?', p('No. In the browser ToHuus runs as a web app you can add to your home screen.')],
          ['Does the iPhone app work with my own server?', p('Yes. On the app’s start screen tap “Own server”. How signing in works is under <a href="self-hosting.html">Self-hosting</a>.')],
          ['Is there an iPhone app?', p(`Yes, <a href="${k.APP_EN}">on the App Store</a>, for iPhone, iPad and Apple Watch.`)],
          ['Do I need a Thermomix?', p('No. The cook planner shows recipes with and without one.')],
          ['Is ToHuus good for ADHD?', p('For everyone with a lot going on in their head there are small steps, a view with just one thing, a visible timer and a gentle mode, and nowhere any points or rankings. See <a href="a-lot-on-your-mind.html">When your head is full</a>.')],
          ['Do babysitters need an account?', p('No. They get a link or QR code and see the <a href="house-info.html">house info</a> and whatever else you share.')],
          ['Is ToHuus a family calendar?', p('No. ToHuus looks after shopping, cooking, money and what needs doing at home. For that there are <a href="tasks.html">tasks</a>, also with a time as an appointment, and they can show up in your own calendar. There is deliberately no chat and no leaderboards; stars only if you switch them on.')],
          ['Where do I report a bug?', p(`By e-mail to <a href="mailto:${k.MAIL}">${k.MAIL}</a> or as an issue on <a href="${k.GH}/issues">GitHub</a>.`)],
        ],
        related: ['getting-started', 'subscription'],
      },
    ],
  };
  return { de, en };
}
