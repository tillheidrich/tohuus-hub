/**
 * "Hilfe & Tipps" / "Help & tips": the public help section of the website (no login, no tracking).
 * German pages: site/hilfe/<slug>.html (the app links them, contract in docs/help-slugs.md; never rename a slug).
 * English pages: site/help/<slug>.html (the main articles).
 *
 * Copy: product voice (du-Form, plain, warm, short, no superlatives, no dashes as punctuation). Only what exists
 * or is being built in this release; anything not live yet carries `soon: true` and says so in the text.
 * Slugs beyond docs/help-slugs.md (site only, can be added to the contract later): gemeinsam-einkaufen,
 * benachrichtigungen, claude-chatgpt, erinnerungen-spiegeln, umzug-in-die-cloud, selbst-hosten, datenschutz-kurz,
 * abo-und-kuendigen, fragen.
 *
 * `k` is the toolkit from build.mjs: { code(id, label, text), CLOUD, GH, MAIL, TF_DE, TF_EN }.
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
    desc: 'Anleitungen für ToHuus: Liste, Bons, Kochen, Geld, Sprechen, Home Assistant, Datenschutz und Abo. Ohne Anmeldung, ohne Tracking.',
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
      ['money', 'Geld'],
      ['ai', 'Sprechen und KI'],
      ['people', 'Teilen, Gäste, Hausinfo'],
      ['connect', 'Verbinden'],
      ['account', 'Konto, Daten, Datenschutz'],
    ],
    articles: [
      {
        slug: 'erste-schritte', pair: 'getting-started', group: 'start', title: 'Erste Schritte',
        desc: 'Konto anlegen, sagen, wer dazugehört, und die fünf Bereiche kennenlernen.',
        sections: [
          ['Konto oder eigener Server', p(
            `In der ToHuus Cloud legst du in der iPhone-App oder im Browser unter <a href="${k.CLOUD}">${k.CLOUD.replace('https://', '')}</a> ein Konto und einen Haushalt an. Jeder neue Haushalt nutzt 14 Tage lang Plus, ohne Zahlungsdaten.`,
            'Hast du einen eigenen Server, läuft ToHuus dort als Docker-Container. Wie das geht, steht unter <a href="selbst-hosten.html">Selbst hosten</a>. Dort nutzt ihr die Web-App im Browser, die iPhone-App ist für die ToHuus Cloud gedacht.',
          )],
          ['Wer gehört dazu?', p(
            'Beim Start fragt ToHuus nur das: allein, zu zweit, Familie, WG oder ein Haushalt, den du mitversorgst. Danach richtet sich, was du siehst. Ändern kannst du es später in den Einstellungen.',
          )],
          ['Die fünf Bereiche', ul(
            '<b>Heute</b>: was fällig ist, was weg muss, was ihr heute kochen könnt und was der Monat bisher gekostet hat.',
            '<b>Einkauf</b>: die gemeinsame Liste und der Modus für den Laden.',
            '<b>Vorrat</b>: freiwillig. Wer mag, führt hier Bestand.',
            '<b>Kochen</b>: Ideen aus dem, was da ist, Rezepte und der Wochenplan.',
            '<b>Geld</b>: was Essen und Haushalt kosten, nach Laden und Kategorie.',
          ), p('Der Knopf „Sprechen“ ist auf jeder Seite. Einstellungen und alles Seltene findest du über dein Bild oben auf „Heute“.')],
          ['Die erste Woche', ol(
            'Schreibt auf die Liste, was fehlt, und hakt ab, was ihr kauft.',
            'Teilt eure Bons, wenn ihr welche habt (siehe <a href="kassenbons.html">Kassenbons einlesen</a>).',
            'Ladet die anderen ein (siehe <a href="haushalt-teilen.html">Haushalt teilen</a>).',
          ), p('Pflegen müsst ihr nichts. Nach ein paar Wochen kennt ToHuus euren Rhythmus und schlägt vor, was wieder fällig ist.')],
        ],
        related: ['so-funktioniert-tohuus', 'einkaufsliste', 'kassenbons'],
      },
      {
        slug: 'so-funktioniert-tohuus', group: 'start', title: 'So funktioniert ToHuus',
        desc: 'Wie ToHuus sich merkt, was fehlt, und warum jede Zeile sagt, woher sie kommt.',
        sections: [
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
        ],
        related: ['merkt-sich', 'einkaufsliste', 'wer-sieht-was'],
      },
      {
        slug: 'einkaufsliste', group: 'shop', title: 'Die Einkaufsliste',
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
          ['Auf der Apple Watch', p(`<span class="soon-tag">${'Kommt mit der App'}</span> Mit der iPhone-App kommt eine Apple-Watch-App: die Liste nach Laden sortiert, abhaken mit Rückgängig, auch ohne iPhone in der Nähe.`)],
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
          ['Wie weit zurück', p('Im Tarif Free merkt sich ToHuus die letzten 60 Tage. Mit Haushalt und Plus bleibt die ganze Geschichte, selbst gehostet sowieso.')],
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
            'Jeder Bon wartet erst in der Prüfung: Zeilen, erkannte Produkte, Mengen und Preise. Was ToHuus nicht sicher lesen konnte, ist markiert. Korrigierst du eine Zeile, merkt sich ToHuus das für diesen Laden.',
            'Pfand wird nie als Vorrat gebucht. Geht Text eines Bons an die KI, entfernt ToHuus vorher Karten- und Bonusnummern, TSE-Daten und die Adresse.',
          )],
          ['Welche Läden', p('Am besten getestet ist REWE. Für Lidl, Aldi, Edeka, Netto, Kaufland, Penny, dm, Rossmann und weitere gibt es einen allgemeinen Leser, der mit nachgebauten Bons getestet ist. Echte, anonymisierte Bons helfen: In jeder Prüfung gibt es dafür „Erkennung verbessern helfen“. Verschickt wird dabei nichts von allein.')],
          ['Selbst gehostet', p('Dort kannst du zusätzlich ein Bon-Postfach einrichten: Mails mit Bons weiterleiten, ToHuus holt sie alle 10 Minuten ab.')],
        ],
        related: ['geld', 'ki-an-oder-aus', 'merkt-sich'],
      },
      {
        slug: 'vorrat', group: 'shop', title: 'Vorrat (freiwillig)',
        desc: 'Wer mag, führt Bestand. Nötig ist das für ToHuus nicht.',
        sections: [
          ['Freiwillig', p('ToHuus braucht keinen Vorrat, um zu wissen, was fehlt. Der Rhythmus kommt aus Bons und Häkchen. Wer trotzdem Bestand führen will, macht das hier.')],
          ['Nur was ausgeht', p('Statt alles zu zählen, kannst du nur die Dinge verfolgen, die regelmäßig ausgehen. Umstellen geht jederzeit, ohne dass Daten verloren gehen.')],
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
          ['Portionen und Hausversion', p('Portionen änderst du auf der Rezeptseite. In der Hausversion passt ihr ein Rezept an euren Haushalt an, ohne das Original zu verändern.')],
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
          ['Preise', p('Bei Dingen, die ihr oft kauft, zeigt ToHuus Preisänderungen gegenüber den 90 Tagen davor, wenn möglich pro Kilo oder Liter.')],
          ['Budget und Hinweise', p('Ein Budget pro Woche, Monat oder Jahr ist freiwillig, für den ganzen Haushalt oder unter „Nur meins“ nur für dich. Hinweise kommen nur aus euren eigenen Bons, zum Beispiel wenn etwas in einem anderen eurer Läden günstiger war. Angebote von außen, Werbung oder Affiliate-Links gibt es nicht.')],
          ['Ohne Bon', p('Wochenmarkt oder Bäcker trägst du von Hand ein, oder du sagst es: „Beim Bäcker 6,40 ausgegeben.“ Alles lässt sich als CSV exportieren.')],
          ['Wie weit zurück', p('Free zeigt die letzten 60 Tage, Haushalt und Plus die ganze Geschichte.')],
        ],
        related: ['kassenbons', 'abo-und-kuendigen'],
      },
      {
        slug: 'sprechen', pair: 'speak', group: 'ai', title: 'Sprechen und der Assistent',
        desc: 'Was der Knopf „Sprechen“ kann, was er einträgt und wie du es zurücknimmst.',
        sections: [
          ['Sprechen oder tippen', p('Der Knopf „Sprechen“ ist auf jeder Seite. Sag oder schreib, was los ist: „Milch ist alle, und wir brauchen was für Sonntag.“ Der Assistent setzt Milch auf die Liste und fragt nach, was es Sonntag geben soll.')],
          ['Was er kann', ul(
            'Auf die Liste setzen, abhaken, streichen.',
            'Sagen, was noch da ist und was fällig ist.',
            'Vorschlagen, was ihr kochen könnt, und ein Gericht in den Wochenplan legen.',
            'Fragen zum Geld beantworten: „Was hat der Einkauf im September gekostet?“',
            'Einen Einkauf ohne Bon festhalten: „Bei Aldi Milch, Eier und Brot für 12,40 gekauft.“',
            'Sich etwas für den Haushalt merken, wenn du ihn darum bittest.',
            'Ein Budget setzen, für alle oder nur für dich: „Setz uns 400 Euro im Monat für Lebensmittel.“',
            'Fragen zur App beantworten: „Wo stelle ich das Jahresbudget ein?“ Er sagt dir den Weg und verlinkt die passende Hilfeseite.',
          )],
          ['Nur für euren Haushalt', p('Der Assistent kümmert sich um Einkauf, Kochen, Vorrat, Geld und alles rund um ToHuus. Hausaufgaben, Programmieren, Politik oder Wetter lehnt er freundlich ab, ohne dafür ein Sprachmodell zu fragen und ohne dass es von deinem Kontingent abgeht. Versuche, ihm eine andere Rolle zu geben oder seine Regeln auszulesen, laufen ins Leere. Was in Rezepten, Bons oder Links steht, behandelt er als Inhalt, nie als Anweisung.')],
          ['Alles bleibt rückgängig', p('Unter jeder Antwort steht, was er eingetragen hat, mit „Rückgängig“. Er schreibt nur, wenn du ihn darum bittest.')],
          ['Ohne KI', p('Ist die KI aus oder das Kontingent für den Monat verbraucht, versteht der Assistent weiter die häufigen kurzen Sätze wie „Klopapier ist alle und 2 Paprika“.')],
          ['Privat', p('Gespräche sieht nur die Person, die sie geführt hat. Sie werden 30 Tage nach der letzten Nachricht gelöscht. Sprachaufnahmen werden nur in Text umgewandelt und nicht gespeichert.')],
        ],
        related: ['ki-an-oder-aus', 'datenschutz-kurz', 'abo-und-kuendigen'],
      },
      {
        slug: 'ki-an-oder-aus', pair: 'ai-on-or-off', group: 'ai', title: 'Mit oder ohne KI',
        desc: 'Was ohne KI geht, was sie dazu bringt, und wie du sie für Haushalt, dich oder Kinder abschaltest.',
        sections: [
          ['Ohne KI', p('Liste, Vorschläge aus dem Kaufrhythmus, Kochplaner, Wochenplan, Geld, PDF-Bons und die häufigen kurzen Sätze im Assistenten funktionieren ganz ohne Sprachmodell.')],
          ['Was die KI dazubringt', p('Fotos von Papierbons und Rezepten lesen, freie Fragen an den Assistenten, gesprochene Sätze in Text umwandeln.')],
          ['Welches Modell', p('In der ToHuus Cloud geht jede Anfrage an Mistral, einen Anbieter aus Frankreich, mit Verarbeitung in der EU, fest eingestellt und ohne Ausweichen auf andere Anbieter. Nichts wird zum Training genutzt. Bevor KI für dich läuft, fragt ToHuus einmal nach deiner Zustimmung; zurückziehen kannst du sie unter Einstellungen › Zugänge & KI. Selbst gehostet nimmst du deinen eigenen Schlüssel oder gar keinen.')],
          ['Abschalten', ul(
            '<b>Für den ganzen Haushalt</b>: Einstellungen › Zugänge & KI, nur Admins.',
            '<b>Nur für dich</b>: an derselben Stelle. Die anderen sehen deine Einstellung nicht.',
            '<b>Für ein Kind</b>: Eltern schalten die KI pro Kind ab. Auf dem Kinder-Tablet lässt sich das nicht ändern.',
            '<b>KI-Assistenten über MCP</b> (Claude, ChatGPT) haben einen eigenen Schalter.',
          ), p('Ist die KI aus, geht keine einzige Anfrage an ein Sprachmodell. ToHuus sagt dann an den passenden Stellen, dass sie aus ist.')],
          ['Gesundheitsdaten', p('Allergien und Angaben zu Kindern gehen nur an ein Sprachmodell, wenn ein Admin das ausdrücklich einschaltet. Ohne das filtert ToHuus ungeeignete Gerichte trotzdem, nur eben auf dem Server.')],
          ['Texterkennung ohne KI', p('Bon-Fotos und Fotos von Zetteln liest ToHuus direkt auf dem Server, ohne Sprachmodell. Das ist manchmal weniger genau als die KI, aber das Foto verlässt den Server nicht. Mit KI wird die Texterkennung zuerst versucht, das Modell nur, wenn die Summe nicht stimmt.')],
        ],
        related: ['sprechen', 'kassenbons', 'datenschutz-kurz'],
      },
      {
        slug: 'hausinfo', group: 'people', title: 'Hausinfo für Gäste und Babysitter',
        desc: 'Karten mit allem, was jemand wissen muss, der auf euer Zuhause aufpasst.',
        sections: [
          ['Karten', p('Die Hausinfo (Mehr › Hausinfo) sammelt auf Karten, was Babysitter, Großeltern oder Haushüter wissen müssen: Sprachbefehle für Licht und Rollläden, Abläufe wie das Zubettgehen, Tipps und wichtige Nummern. Vorlagen helfen beim Anfangen. Pro Karte legst du fest, wer sie sieht: Mitglieder, Gäste je nach Stufe, Babysitter- und Gast-Links.')],
          ['Sprachbefehle aus Home Assistant', p('Mit Home Assistant übernimmt ToHuus die Geräte, die ihr für Alexa, Google oder Assist freigegeben habt, mit Beispielsätzen. Nur Namen und Räume, nie Schlösser, Alarmanlagen, Kameras oder Garagentore.')],
          ['Für Gäste', p('Auf dem <a href="babysitter.html">Babysitter-Link</a> erscheint die Hausinfo als eigener Bereich, auch offline lesbar und als A4-Blatt zum Ausdrucken.')],
        ],
        related: ['babysitter', 'hausinfo-codes', 'gaeste'],
      },
      {
        slug: 'hausinfo-codes', group: 'people', title: 'Codes sicher teilen',
        desc: 'Türcode, WLAN, Alarmanlage: wie ToHuus Codes behandelt.',
        sections: [
          ['Codes sind Geheimnisse', ul(
            'Du legst fest, wer einen Code sieht, und auf Wunsch, bis wann.',
            'Ihr seht, wann ein Code angezeigt wurde.',
            'Codes gehen nie an eine KI, nie an KI-Assistenten über MCP, nie an Home Assistant, nie in Benachrichtigungen, Protokolle oder Exporte.',
          )],
          ['So geht es', p('Codes legst du unter Hausinfo › Codes an. Sie sind verdeckt, bis jemand auf „Anzeigen“ tippt, und jedes Anzeigen wird protokolliert. Auf einem Gast-Link kannst du einen Code bis zu einem Datum freigeben. Beim Umzug in die Cloud kommen Codes nur mit, wenn du das ausdrücklich ankreuzt.')],
        ],
        related: ['hausinfo', 'babysitter', 'wer-sieht-was'],
      },
      {
        slug: 'babysitter', group: 'people', title: 'Der Babysitter-Link',
        desc: 'Ein Link ohne Konto: wo was ist, eine Notiz und die Sprachbefehle.',
        sections: [
          ['Anlegen', p('Unter Gäste legst du einen Link mit der Vorlage „Babysitter“ an. Er funktioniert ohne Konto, als Link oder QR-Code.')],
          ['Was die Person sieht', ul(
            '„Wo ist was?“ für die Orte, die du auswählst, nur zum Lesen.',
            'Deine Notiz, zum Beispiel Notfallnummern und wann Schlafenszeit ist.',
            'Mit Home Assistant eine Liste der Sprachbefehle für Licht, Rollläden und Musik.',
          )],
          ['Ablauf und Widerruf', p('Gib dem Link ein Ablaufdatum oder widerruf ihn, wenn er nicht mehr gebraucht wird. Wer verreist, nimmt den Haushüten-Link: Er endet am Tag nach eurer Rückkehr.')],
        ],
        related: ['gaeste', 'hausinfo', 'home-assistant'],
      },
      {
        slug: 'gaeste', group: 'people', title: 'Gäste und Rechte',
        desc: 'Gast-Links ohne Konto und feste Gäste mit eigenen Stufen.',
        sections: [
          ['Gast-Links', p('Ein Link oder QR-Code ohne Konto, mit Vorlagen für Besuch, Babysitter und Großeltern. Je nach Link kann man etwas von eurer Karte wünschen, nachsehen, wo etwas ist, oder auf die Liste schreiben. Ablaufdatum optional, widerrufen jederzeit.')],
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
        slug: 'wer-sieht-was', group: 'people', title: 'Wer sieht was?',
        desc: 'Was gemeinsam ist, was privat bleibt und was nur du siehst.',
        sections: [
          ['Gemeinsam', p('Die Liste, der Wochenplan, Rezepte und der Vorrat gehören dem Haushalt. Jede Zeile zeigt, wer sie eingetragen hat.')],
          ['Diskret und nur für dich', p('Diskrete Einträge sehen die anderen nur als Platzhalter, private gar nicht. Beides geht nie an Home Assistant, Displays, Gast-Links oder KI-Assistenten.')],
          ['Nur für dich', p('Deine Gespräche mit dem Assistenten, deine Anmeldungen und Geräte und deine persönlichen Einstellungen, auch ob du die KI für dich abgeschaltet hast.')],
          ['Gäste und Kinder', p('Sehen nur, was ihr freigebt (siehe <a href="gaeste.html">Gäste und Rechte</a>).')],
        ],
        related: ['einkaufsliste', 'gaeste', 'datenschutz-kurz'],
      },
      {
        slug: 'benachrichtigungen', group: 'connect', title: 'Benachrichtigungen',
        desc: 'Wann ToHuus sich meldet, wie du es einstellst und wie es ruhig bleibt.',
        sections: [
          ['Auf dem iPhone', p(`<span class="soon-tag">Kommt mit der App</span> Mitteilungen mit Knöpfen wie „Auf die Liste“, „Mach ich“ oder „Geht nicht“. Pro Ereignis schaltest du sie an oder aus, und Ruhezeiten halten die Nacht frei.`)],
          ['Im Browser', p('Legst du die Web-App auf den Startbildschirm, kann sie Push-Mitteilungen schicken: Einstellungen › Benachrichtigungen › Push auf diesem Gerät.')],
          ['Wann', p('Zum Beispiel wenn ein Bon auf die Prüfung wartet, etwas ausgeht, ein Budget knapp wird oder sich ein neues Gerät anmeldet. Eine tägliche Übersicht zu einer festen Uhrzeit ist möglich. Im Urlaub bleibt es still.')],
          ['Selbst gehostet', p('Zusätzlich Telegram, ntfy, Gotify, Matrix, E-Mail und beliebige Webhooks.')],
          ['Home Assistant', p('Mit der Integration gehen ToHuus-Mitteilungen auch an eure Benachrichtigungsdienste in Home Assistant, etwa ans Handy oder an den Fernseher. Siehe <a href="home-assistant.html">Home Assistant</a>.')],
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
          ['Wer führt?', p('Habt ihr schon eine Einkaufsliste in Home Assistant (Bring!, die eingebaute Liste, Todoist) oder einen Kalender für Essen, entscheidet ihr pro Thema, wer führt: beide, Home Assistant oder ToHuus. Einstellen geht in ToHuus unter Einstellungen › Home Assistant oder direkt in Home Assistant über die Auswahl „wer führt“ am Gerät ToHuus Hub.')],
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
            'Liste, Vorrat, Rezepte, Wochenplan und Ausgaben deines Haushalts.',
            'Diskrete Einträge nur als Platzhalter, private gar nicht.',
            'Allergien und Angaben zu Kindern nur, wenn ein Admin das ausdrücklich erlaubt.',
            'Codes aus der Hausinfo nie.',
          ), p('Einkäufe, die der Assistent festhält, warten erst in der Prüfung. Ein Admin kann MCP für den ganzen Haushalt abschalten (Einstellungen › Zugänge & KI).')],
        ],
        related: ['ki-an-oder-aus', 'datenschutz-kurz', 'rezeptpaket'],
      },
      {
        slug: 'erinnerungen-spiegeln', group: 'connect', title: 'Apple Erinnerungen oder Nextcloud spiegeln',
        desc: 'Die Einkaufsliste zusätzlich in einer anderen Listen-App, über CalDAV.',
        sections: [
          ['So geht es', p('ToHuus ist selbst ein CalDAV-Server: Jede eurer Listen erscheint als eigene Erinnerungsliste. Abhaken, Hinzufügen und Umbenennen gehen in beide Richtungen.'), ol(
            'In ToHuus: Einstellungen › Mein Konto › Die Liste in der Erinnerungen-App › Passwort erstellen. Server, Benutzername und Passwort werden einmal angezeigt.',
            'Auf dem iPhone: Einstellungen › Apps › Erinnerungen › Accounts › Account hinzufügen › Andere › CalDAV-Account hinzufügen, die drei Angaben eintragen.',
            'Erinnerungen öffnen: Deine ToHuus-Listen stehen unter dem neuen Account.',
          ), p('Nextcloud Tasks, DAVx⁵ oder Thunderbird nehmen die volle Adresse mit <code>/caldav/</code> am Ende. Jedes Passwort lässt sich einzeln widerrufen.')],
          ['Oder über Home Assistant', ol(
            'In Home Assistant die Integration „CalDAV“ mit deinem Nextcloud-Konto einrichten. Deine Aufgabenlisten erscheinen dort als To-do-Listen.',
            'Die ToHuus-Integration verbinden (siehe <a href="home-assistant.html">Home Assistant</a>).',
            'In ToHuus unter Einstellungen › Home Assistant bei „Einkaufsliste“ die Nextcloud-Liste wählen und „beide“ einstellen.',
          )],
          ['Siri und Kurzbefehle', p('Etwas per Siri auf die Liste setzen geht mit einem persönlichen Schlüssel und einem Kurzbefehl: Einstellungen › Mein Konto › Aus anderen Apps an ToHuus teilen. Der Schlüssel kann nur auf die Liste schreiben.')],
        ],
        related: ['home-assistant', 'gemeinsam-einkaufen'],
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
          ['HTTPS und die App', p('Stell deinen üblichen Reverse Proxy davor. Dann öffnest du die Web-App im Browser und legst sie auf den Startbildschirm.')],
          ['KI', p('Optional, mit einem Schlüssel für jeden OpenAI-kompatiblen Dienst, etwa Mistral, auch lokal. Ohne Schlüssel läuft alles außer Fotos von Papierbons und freien Fragen an den Assistenten.')],
          ['Sicherungen', p('Jede Nacht eine Sicherung, auf Wunsch zusätzlich auf eine WebDAV-Freigabe wie Nextcloud. Die Datenbank lässt sich mit <code>DB_ENCRYPTION_KEY</code> verschlüsseln.')],
          ['Nur im eigenen Netz', p('Bon-Postfach per IMAP, Telegram, Bon-Drucker und Home Assistant mit allen Extras.')],
        ],
        related: ['home-assistant', 'umzug-in-die-cloud', 'daten-export'],
      },
      {
        slug: 'daten-export', group: 'account', title: 'Deine Daten mitnehmen',
        desc: 'Export, Rezeptpaket und was beim Löschen passiert.',
        sections: [
          ['Export', p('Einstellungen › Daten & Sicherung › Export herunterladen gibt eine JSON-Datei mit allen Daten eures Haushalts. Passwörter, Zugänge und Geheimnisse von Integrationen lässt der Export weg. Das dürfen nur Admins.')],
          ['Rezepte', p('Eure Rezepte mit Fotos gehen als <a href="rezeptpaket.html">Rezeptpaket</a> mit, das andere Apps zum großen Teil lesen können.')],
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
        desc: 'Free, Haushalt und Plus, wie bezahlt wird und was beim Kündigen passiert.',
        sections: [
          ['Ein Abo pro Haushalt', p('Free kostet nichts. Haushalt kostet 3,99 € im Monat oder 34,99 € im Jahr, Plus 5,99 € im Monat oder 59,99 € im Jahr. Mitglieder, Kinder, Gäste und verbundene Haushalte zahlen nie. Selbst gehostet ist alles kostenlos.')],
          ['Ausprobieren', p('Jeder neue Haushalt in der Cloud nutzt 14 Tage lang Plus, ohne Zahlungsdaten. Danach geht er auf Free, wenn ihr nichts abschließt.')],
          ['Bezahlen', p('Abgeschlossen wird in der iPhone-App, bezahlt über deine Apple-ID.')],
          ['Kündigen', ol(
            'Auf dem iPhone: Einstellungen › dein Name › Abonnements.',
            'ToHuus wählen und „Abo kündigen“ tippen.',
          ), p('Das Abo läuft bis zum Ende des bezahlten Zeitraums. Danach geht der Haushalt auf Free zurück. Gelöscht wird nichts: Ihr seht dann die letzten 60 Tage, und der Assistent hat 20 Nachrichten im Monat.')],
          ['Preise zum Start', p('Wir prüfen die Preise im Test mit Familien und passen sie an, wenn sie nicht stimmen.')],
        ],
        related: ['haushalt-teilen', 'daten-export', 'fragen'],
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
          ['Funktioniert das ohne REWE?', p('Ja. Papierbons per Foto, PDF-Bons von EDEKA und Kaufland, und wer gar keine Bons sammeln will, hakt einfach auf der Liste ab.')],
          ['Brauche ich KI?', p('Nein. Siehe <a href="ki-an-oder-aus.html">Mit oder ohne KI</a>.')],
          ['Gibt es eine Android-App?', p('Nein. Im Browser läuft ToHuus als Web-App, die du auf den Startbildschirm legen kannst.')],
          ['Wann kommt die iPhone-App?', p(`Sie ist im Test über TestFlight, in einem kleinen, geschlossenen Kreis. Einen Platz kannst du per <a href="${k.TF_DE}">Mail anfragen</a>. iPad und Apple Watch kommen mit der App.`)],
          ['Brauche ich einen Thermomix?', p('Nein. Der Kochplaner zeigt Rezepte mit und ohne Thermomix.')],
          ['Ist ToHuus ein Familienkalender?', p('Nein. ToHuus kümmert sich um Einkauf, Kochen und das Geld dafür. Termine, Aufgaben mit Zuständigen oder Punkte gibt es bewusst nicht.')],
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
    desc: 'How-tos for ToHuus: the list, receipts, speaking, AI on or off, recipe packs, Home Assistant, privacy and subscriptions. No sign-in, no tracking.',
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
      ['ai', 'Speaking and AI'],
      ['connect', 'Connect'],
      ['account', 'Account, data, privacy'],
    ],
    articles: [
      {
        slug: 'getting-started', pair: 'erste-schritte', group: 'start', title: 'Getting started',
        desc: 'Create an account, say who belongs to the household and meet the five areas.',
        sections: [
          ['Account or your own server', p(
            `In ToHuus Cloud you create an account and a household in the iPhone app or in the browser at <a href="${k.CLOUD}">${k.CLOUD.replace('https://', '')}</a>. Every new household gets 14 days of Plus, no payment details needed.`,
            'If you have your own server, ToHuus runs there as a Docker container (see <a href="self-hosting.html">Self-hosting</a>). There you use the web app in the browser; the iPhone app is meant for ToHuus Cloud.',
          )],
          ['Who belongs to it?', p('On first start ToHuus only asks this: just you, the two of you, a family, a flat share, or a household you look after. What you see follows from that, and you can change it later.')],
          ['The five areas', ul(
            '<b>Today</b>: what is due, what should be used soon, what you can cook, what the month has cost so far.',
            '<b>Shopping</b>: the shared list and shop mode.',
            '<b>Stock</b>: optional, for anyone who likes to keep stock.',
            '<b>Cook</b>: ideas from what is at home, recipes and the week plan.',
            '<b>Money</b>: what food and household cost, by shop and category.',
          ), p('The “Speak” button is on every page. Settings live behind your picture at the top of Today.')],
          ['The first week', p('Write what is missing on the list, tick off what you buy, share receipts if you have them and invite the others. Nothing needs upkeep. After a few weeks ToHuus knows your rhythm and suggests what is due again.')],
        ],
        related: ['receipts', 'shopping-together', 'faq'],
      },
      {
        slug: 'shopping-together', pair: 'gemeinsam-einkaufen', group: 'shop', title: 'Shopping together',
        desc: 'Live on every phone, adding while someone is in the shop, and splitting the aisles.',
        sections: [
          ['Live on every device', p('The list is up to date on every phone and in the browser at once. When someone ticks something off in the shop, it disappears for everyone else within seconds.')],
          ['Add while someone is out', p('Thought of something at home? Put it on the list. Whoever is in the shop sees it right away in shop mode, in the right aisle. No phone call needed.')],
          ['Two of you in the shop', p('Tap “I’ll get it” on an item and the others see it is taken. Nobody buys twice, and you can split the aisles.')],
          ['No signal', p('ToHuus remembers what you tick off and syncs as soon as you are back online.')],
          ['On the Apple Watch', p(`<span class="soon-tag">Comes with the app</span> The iPhone app brings a Watch app: the list sorted by shop, tick off with undo, also without the iPhone nearby.`)],
        ],
        related: ['getting-started', 'speak'],
      },
      {
        slug: 'receipts', pair: 'kassenbons', group: 'shop', title: 'Sharing receipts',
        desc: 'E-receipts, PDF, photos and text: how receipts get into ToHuus and what happens to them.',
        sections: [
          ['Digital receipts', p('Share an e-receipt or order PDF with ToHuus, for example from your mail app. For REWE in Germany, ToHuus matches the order with the receipt and books what was actually delivered.')],
          ['Paper receipts', p('Take a photo in the app. ToHuus first reads the text itself on the server (text recognition without AI) and checks that the lines add up to the total. Only if they do not and AI is on, Mistral reads the photo again.', 'With AI off it stays with text recognition. Lines read unclearly are marked, you correct them in the check.')],
          ['Check before booking', p('Every receipt waits for a check first. Anything ToHuus could not read with confidence is marked. Correct a line and ToHuus remembers it for that shop. Before receipt text goes to the AI, card and loyalty numbers, TSE data and the address are removed.')],
          ['Which shops', p('REWE is tested best. Other German chains, UK, US and Swedish receipts have parsers tested with synthetic receipts. Anonymised real receipts help: every check has “Help improve recognition”. Nothing is sent by itself.')],
        ],
        related: ['ai-on-or-off', 'getting-started'],
      },
      {
        slug: 'speak', pair: 'sprechen', group: 'ai', title: 'Speak and the assistant',
        desc: 'What the “Speak” button does, what it adds and how to undo it.',
        sections: [
          ['Speak or type', p('The “Speak” button is on every page. Say or type what is going on: “We are out of milk, and we need something for Sunday.” The assistant puts milk on the list and asks what you would like on Sunday.')],
          ['What it can do', ul(
            'Add to the list, tick off, remove.',
            'Say what is still there and what is due.',
            'Suggest what you can cook and put a dish into the week plan.',
            'Answer money questions: “What did the shopping cost in September?”',
            'Log a purchase without a receipt.',
          )],
          ['Everything can be undone', p('Under every answer it says what it added, with “Undo”. It only writes when you ask it to.')],
          ['Private', p('Only the person who had a conversation sees it. Conversations are deleted 30 days after the last message. Voice recordings are turned into text and not stored.')],
        ],
        related: ['ai-on-or-off', 'privacy-in-short'],
      },
      {
        slug: 'ai-on-or-off', pair: 'ki-an-oder-aus', group: 'ai', title: 'With or without AI',
        desc: 'What works without AI, what it adds, and how to switch it off for the household, yourself or a child.',
        sections: [
          ['Without AI', p('The list, suggestions from the purchase rhythm, the cook planner, the week plan, money, PDF receipts and the common short sentences in the assistant all work without a language model.')],
          ['What AI adds', p('Reading photos of paper receipts and recipes, open questions to the assistant, turning speech into text.')],
          ['Which model', p('In ToHuus Cloud every request goes to Mistral, a provider based in France, processed in the EU, pinned with no fallback. Nothing is used for training. Before AI runs for you, ToHuus asks once for your consent; you can withdraw it under Settings › Access & AI. Self-hosted, you bring your own key or none.')],
          ['Switching it off', ul(
            '<b>For the whole household</b>: Settings › Access & AI, admins only.',
            '<b>Just for you</b>: same place. The others do not see your choice.',
            '<b>For a child</b>: parents switch AI off per child. It cannot be changed on the kid tablet.',
            '<b>AI assistants via MCP</b> (Claude, ChatGPT) have their own switch.',
          ), p('While AI is off, not a single request goes to a language model.')],
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
            'Your household’s list, stock, recipes, week plan and spending.',
            'Discreet items only as a placeholder, private ones not at all.',
            'Allergies and details about children only if an admin explicitly allows it.',
            'House info codes never.',
          ), p('Purchases the assistant logs wait for a check first. An admin can switch MCP off for the whole household.')],
        ],
        related: ['ai-on-or-off', 'privacy-in-short'],
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
          ['HTTPS and the app', p('Put your usual reverse proxy in front. Then open the web app in the browser and add it to your home screen.')],
          ['AI', p('Optional, with a key for any OpenAI-compatible service, such as Mistral, local ones included. Without a key everything works except photos of paper receipts and open questions to the assistant.')],
          ['Backups', p('A backup every night, optionally copied to a WebDAV share like Nextcloud. The database can be encrypted with <code>DB_ENCRYPTION_KEY</code>.')],
        ],
        related: ['home-assistant', 'move-to-the-cloud'],
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
        desc: 'Free, Household and Plus, how you pay and what happens when you cancel.',
        sections: [
          ['One subscription per household', p('Free costs nothing. Household is €3.99 a month or €34.99 a year, Plus €5.99 a month or €59.99 a year. Members, children, guests and connected households never pay. Self-hosted, everything is free.')],
          ['Trying it', p('Every new cloud household gets 14 days of Plus, no payment details needed.')],
          ['Paying and cancelling', p('You subscribe in the iPhone app and pay through your Apple ID. To cancel: iPhone Settings › your name › Subscriptions › ToHuus › Cancel subscription. It runs until the end of the paid period, then the household goes back to Free. Nothing is deleted.')],
        ],
        related: ['faq', 'privacy-in-short'],
      },
      {
        slug: 'faq', pair: 'fragen', group: 'start', title: 'Frequently asked questions',
        desc: 'Short answers to what people often ask.',
        sections: [
          ['Do I have to type everything in?', p('No. Receipts come in as a PDF or a photo, and what you tick off the list counts as a purchase too. You do not have to keep stock.')],
          ['Do I need AI?', p('No. See <a href="ai-on-or-off.html">With or without AI</a>.')],
          ['Is there an Android app?', p('No. In the browser ToHuus runs as a web app you can add to your home screen.')],
          ['When is the iPhone app coming?', p(`It is being tested on TestFlight in a small, closed group. You can <a href="${k.TF_EN}">ask for a place by e-mail</a>. iPad and Apple Watch come with the app.`)],
          ['Do I need a Thermomix?', p('No. The cook planner shows recipes with and without one.')],
          ['Is ToHuus a family calendar?', p('No. ToHuus looks after shopping, cooking and the money for both. There are deliberately no appointments, chores with owners or points.')],
          ['Where do I report a bug?', p(`By e-mail to <a href="mailto:${k.MAIL}">${k.MAIL}</a> or as an issue on <a href="${k.GH}/issues">GitHub</a>.`)],
        ],
        related: ['getting-started', 'subscription'],
      },
    ],
  };
  return { de, en };
}
