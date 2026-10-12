/**
 * Legal pages of the site: privacy policy (Datenschutzerklärung) and terms of use (Nutzungsbedingungen), German and
 * English. Rendered by build.mjs into site/de/datenschutz.html, site/de/nutzungsbedingungen.html, site/privacy.html
 * and site/terms.html.
 *
 * Every statement here must match the implementation: docs/cloud.md, docs/plan-2026-10-12.md, docs/assistant.md,
 * docs/architecture.md (security model), docs/receipts.md, server/lib/ai.ts, server/lib/plans.ts,
 * server/lib/apple.ts and ios/. When the code changes (retention, providers, limits, cookies), change these texts in
 * the same commit. The German text is binding; the English one is a translation.
 *
 * Status 12.10.2026: draft, not reviewed by a lawyer. Keep the status line visible until the owner decides otherwise.
 * House style of the site applies: no em or en dashes (the provider line is the only exception).
 */

const p = (...xs) => xs.map((x) => `<p>${x}</p>`).join('');
const ul = (...xs) => `<ul>${xs.map((x) => `<li>${x}</li>`).join('')}</ul>`;
const dl = (rows) => `<dl class="legal-dl">${rows.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>`;
const h3 = (t) => `<h3>${t}</h3>`;

/**
 * @param {{ PROVIDER: string, MAIL: string, PHONE: string, ADDRESS: string[], CLOUD: string, SITE: string, GH: string }} k
 */
export function legalCopy(k) {
  const addr = k.ADDRESS.join('<br>');
  const mail = `<a href="mailto:${k.MAIL}">${k.MAIL}</a>`;
  const cloudHost = k.CLOUD.replace(/^https:\/\//, '');

  // ================================================================== German (binding)
  const dePrivacy = {
    file: 'datenschutz.html', label: 'Rechtliches', h1: 'Datenschutzerklärung',
    title: 'Datenschutz · ToHuus',
    desc: 'Welche Daten ToHuus Cloud, die iPhone-App und die Web-App verarbeiten, wozu, bei wem und wie lange.',
    summaryH: 'Kurz gesagt',
    summary: [
      'Eure Haushaltsdaten liegen auf Servern von Hetzner in Deutschland, jeder Haushalt in einer eigenen, verschlüsselten Datenbank.',
      'Kein Tracking, keine Werbung, keine Analyse-Werkzeuge. Wir verkaufen keine Daten und werten eure Bons nicht für Dritte aus.',
      'Für Bon-Fotos, Importe und den Assistenten nutzen wir ein Sprachmodell von Mistral AI (Frankreich), vermittelt über OpenRouter (USA).',
      'Allergien und Angaben zu Kindern gehen nur an das Sprachmodell, wenn ihr das ausdrücklich einschaltet.',
      'Haushalt und Konto könnt ihr jederzeit in der App löschen.',
    ],
    sections: [
      { id: 'verantwortlich', h: 'Wer verantwortlich ist', body:
        p(`Verantwortlich für die Verarbeitung personenbezogener Daten in ToHuus Cloud, in der iPhone-App und in der Web-App, soweit sie mit ToHuus Cloud verbunden sind, und auf dieser Website ist:`)
        + `<address>${k.PROVIDER}<br>${addr}<br>E-Mail: ${mail}<br>Telefon: ${k.PHONE}</address>`
        + p('ToHuus ist ein Angebot von Heidrich Digital. Im Folgenden steht „wir“ für den oben genannten Anbieter.',
          `Einen Datenschutzbeauftragten haben wir nicht benannt, weil dafür keine Pflicht besteht. Für alle Fragen zum Datenschutz erreichst du uns unter ${mail}.`) },

      { id: 'geltung', h: 'Wofür diese Erklärung gilt', body:
        ul(`<b>ToHuus Cloud</b>: der von uns betriebene Server unter <code>${cloudHost}</code>.`,
          '<b>Die iPhone-App ToHuus</b>, wenn sie mit ToHuus Cloud verbunden ist.',
          '<b>Die Web-App</b> im Browser, wenn sie mit ToHuus Cloud verbunden ist.',
          '<b>Diese Website</b> (tohuus.heidrich-digital.de).')
        + p('<b>Selbst gehostete Server:</b> Wer ToHuus auf einem eigenen Server betreibt, ist für die Daten auf diesem Server selbst verantwortlich. Wir erhalten dabei keine Daten, auch nicht, wenn die iPhone-App mit einem solchen Server verbunden ist. Die App spricht dann nur mit diesem Server und mit dem KI-Dienst, den der Betreiber dort eingerichtet hat. Siehe Abschnitt <a href="#selbst-hosten">Selbst gehostete Server</a>.') },

      { id: 'daten', h: 'Welche Daten wir verarbeiten und wozu', body:
        h3('Konto')
        + p('Deine E-Mail-Adresse, dein Name, wie er im Haushalt angezeigt wird, dein Passwort (nur als scrypt-Hash, nie im Klartext), ob deine E-Mail-Adresse bestätigt ist, Sprache und Region. Wir brauchen diese Angaben, um dein Konto zu führen, dich anzumelden und dir E-Mails zu schicken, die zum Dienst gehören: Bestätigung der Adresse, Anmeldelinks, Zurücksetzen des Passworts und Einladungen in einen Haushalt. Werbe-E-Mails schicken wir nicht.',
          'Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Vertrag über die Nutzung von ToHuus Cloud).')
        + h3('Inhalte eures Haushalts')
        + p('Alles, was ihr in ToHuus eintragt oder hochladet: Einkaufsliste mit Herkunft der Einträge, Vorrat, Produkte, Orte, Rezepte, Wochenplan, Kassenbons und Bestellbelege (als Datei oder Foto und die daraus erkannten Positionen mit Laden, Datum und Preisen), Ausgaben und Budget, Notizen dazu, was ToHuus sich für euch merkt, sowie die Personen im Haushalt mit Namen, Rolle, Vorlieben und Abneigungen. Wenn ihr Kinder anlegt, können das auch deren Namen und Geburtsjahre sein.',
          'Diese Daten verarbeiten wir, damit ToHuus für euch funktioniert: Liste, Vorschläge nach eurem Einkaufsrhythmus, Kochplaner und Ausgabenübersicht. Sehen können sie die Mitglieder und Gäste eures Haushalts im Rahmen der Rechte, die ihr vergebt. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.',
          'Wir sehen uns die Inhalte eurer Haushalte nicht an. Technisch hat der Betreiber des Servers Zugriff auf die Schlüssel. Wir nutzen ihn nur, wenn du uns für eine Supportanfrage ausdrücklich darum bittest oder wenn wir gesetzlich dazu verpflichtet sind.')
        + h3('Allergien und Unverträglichkeiten (Gesundheitsdaten)')
        + p('Ihr könnt für Personen im Haushalt Allergien und Unverträglichkeiten eintragen. Das sind Gesundheitsdaten im Sinne von Art. 9 DSGVO. ToHuus nutzt sie nur in eurem Haushalt: um sie anzuzeigen und um ungeeignete Rezepte beim Vorschlagen wegzulassen. Rechtsgrundlage ist deine ausdrückliche Einwilligung (Art. 9 Abs. 2 lit. a DSGVO), die du mit dem Eintragen gibst. Trag Angaben zu anderen Personen nur ein, wenn sie damit einverstanden sind oder du sie gesetzlich vertrittst, etwa als Elternteil.',
          'An ein Sprachmodell gehen Allergien und Angaben zu Kindern nur, wenn ein Admin eures Haushalts das unter <i>Einstellungen › Zugänge &amp; KI › Assistent &amp; Datenschutz</i> ausdrücklich einschaltet. Ab Werk ist das aus. Du kannst deine Einwilligung jederzeit widerrufen, indem du die Angaben löschst oder den Schalter ausschaltest. Was bis dahin geschehen ist, bleibt rechtmäßig.')
        + h3('Assistent und Spracheingabe')
        + p('Was du dem Assistenten schreibst oder sagst, und seine Antworten speichern wir als Gespräch. Gespräche gehören der Person, die sie führt, andere Mitglieder sehen sie nicht. Sie werden 30 Tage nach der letzten Nachricht automatisch gelöscht, und du kannst sie jederzeit vorher löschen.',
          'Sprachaufnahmen speichern wir nicht. Auf dem iPhone wird Gesprochenes nach Möglichkeit direkt auf dem Gerät in Text umgewandelt. Unterstützt dein iPhone das für deine Sprache nicht, nutzt iOS dafür die Spracherkennung von Apple, für die Apples Bedingungen gelten (iOS fragt dich vorher um Erlaubnis). Ist keine Spracherkennung verfügbar, und im Browser immer, schickt die App die Aufnahme an unseren Server. Dort wird sie im Arbeitsspeicher an das Sprachmodell zur Umwandlung in Text weitergegeben und danach verworfen.',
          'Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.')
        + h3('Tarif, Kontingente und Käufe')
        + p('Zu jedem Haushalt speichern wir den Tarif, das Ende der Testphase, Zähler für die Kontingente (Nachrichten an den Assistenten, KI-Lesevorgänge für Bons und Importe, Uploads) und den belegten Speicherplatz. Kaufst du ein Abo, speichern wir die Angaben aus der von Apple signierten Transaktion (siehe <a href="#apple">Käufe über Apple</a>). Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.')
        + p('Für den Betrieb sehen wir nur Summen: wie viele Haushalte es gibt und wie viele aktiv sind, Anmeldungen pro Woche, Tarife, belegten Speicher, KI-Verbrauch pro Tag und die Fehlerquote des Servers. Inhalte eines Haushalts und Angaben zu einzelnen Personen gehören nicht dazu.')
        + h3('Sicherheit und Missbrauchsschutz')
        + p('Bei jeder Anmeldung speichern wir zur Sitzung die IP-Adresse und die Gerätekennung des Browsers oder der App (User-Agent) sowie den Zeitpunkt der letzten Nutzung. So kannst du deine angemeldeten Geräte sehen und abmelden, und wir können Missbrauch erkennen. Für die iPhone-App speichern wir zum Geräte-Token den Gerätenamen und wann es zuletzt benutzt wurde. Um Anmeldeversuche, Registrierungen und das Versenden von E-Mails zu begrenzen, zählen wir IP-Adressen und E-Mail-Adressen kurzzeitig im Arbeitsspeicher des Servers, höchstens eine Stunde lang. Fehlermeldungen des Servers schreiben wir in ein Protokoll.',
          'Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist der sichere Betrieb des Dienstes und der Schutz eurer Konten.')
        + h3('Wenn du uns schreibst')
        + p('Schreibst du uns eine E-Mail, verarbeiten wir deine Adresse und deine Nachricht, um zu antworten. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO, wenn es um dein Konto oder deinen Haushalt geht, sonst Art. 6 Abs. 1 lit. f DSGVO.') },

      { id: 'ki', h: 'Sprachmodelle: Mistral über OpenRouter', body:
        p('Einige Funktionen nutzen ein Sprachmodell. Dafür schickt ToHuus Cloud die nötigen Daten an <b>OpenRouter, Inc.</b> (USA), einen Vermittler für Sprachmodelle. OpenRouter leitet die Anfrage an <b>Mistral AI SAS</b> (Paris, Frankreich) weiter, die das Modell betreibt und die Antwort erzeugt. Jede Anfrage ist fest auf Mistral eingestellt, ohne Ausweichen auf andere Anbieter, und mit der Vorgabe, dass sie nur an Anbieter gehen darf, die nach Einstufung von OpenRouter keine Nutzerdaten sammeln, also Anfragen nicht dauerhaft speichern und nicht zum Training verwenden.')
        + p('<b>Wann das passiert</b>, nur wenn ihr eine dieser Funktionen nutzt:')
        + ul('Fotos und Screenshots von Kassenbons sowie Bon-Texte, die ToHuus nicht ohne Sprachmodell lesen kann. Aus Bon-Texten entfernen wir vorher Kartennummern, Kundenkarten, TSE-Daten und Adressen. Fotos werden verkleinert und so geschickt, wie sie sind.',
          'Importe von Rezepten und Produkten aus Links, Texten, Fotos und Screenshots, zum Beispiel ein Foto einer Einkaufsliste auf Papier.',
          'Der Assistent und die Spracheingabe, wenn die Sprache nicht auf dem Gerät erkannt wurde.')
        + p('KI lässt sich abschalten: für den ganzen Haushalt, für jede Person und für jedes Kind (das legen die Eltern fest). Dann geht keine Anfrage mehr an ein Sprachmodell; Bons werden auf unserem Server per Texterkennung gelesen.')
        + p('<b>Was der Assistent erfährt:</b> den Namen eures Haushalts, das Datum, wer gerade schreibt, die Personen mit Vorlieben und Abneigungen, die offene Liste ohne private Einträge, was nach eurem Rhythmus fällig ist, den Wochenplan, die Ausgaben dieser Woche und dieses Monats mit Budget und was ToHuus sich merkt, ohne als sensibel erkannte Einträge. Allergien, Geburtsjahre von Kindern und sensible Einträge nur mit der oben beschriebenen Einwilligung.',
          '<b>Was OpenRouter speichert:</b> Nach eigenen Angaben speichert OpenRouter die Inhalte von Anfragen und Antworten nicht, solange die Protokollierung im Konto nicht eingeschaltet ist. Bei uns ist sie nicht eingeschaltet. OpenRouter speichert Metadaten wie Zeitpunkt, Modell und Anzahl der Tokens und kann nach eigenen Angaben einen kleinen Teil der Anfragen anonymisiert auswerten, um sie Kategorien zuzuordnen.',
          'Wir nutzen eure Daten nicht, um Modelle zu trainieren. Rechtsgrundlage für die Übermittlung ist Art. 6 Abs. 1 lit. b DSGVO, weil ihr die Funktion nutzt, für Gesundheitsdaten Art. 9 Abs. 2 lit. a DSGVO. Wer ohne Sprachmodell auskommen will, nutzt diese Funktionen nicht: Liste, Vorschläge, Kochplaner, Ausgaben und PDF-Bons der meisten Märkte funktionieren ohne.') },

      { id: 'empfaenger', h: 'Dienstleister und andere Empfänger', body:
        p('Wir geben personenbezogene Daten nur an die folgenden Stellen weiter. Wo sie in unserem Auftrag arbeiten, haben wir mit ihnen einen Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO geschlossen.')
        + dl([
          ['Hetzner Online GmbH', 'Industriestr. 25, 91710 Gunzenhausen. Betreibt die Server von ToHuus Cloud und den Speicher für Sicherungskopien, beides in Rechenzentren in Deutschland. Auftragsverarbeiter.'],
          ['ALL-INKL.COM, Neue Medien Münnich', 'Hauptstraße 68, 02742 Friedersdorf. Versendet unsere E-Mails (SMTP): Bestätigung, Anmeldelinks, Zurücksetzen des Passworts, Einladungen. Dafür verarbeitet ALL-INKL die Empfängeradresse und den Inhalt der E-Mail. Auftragsverarbeiter.'],
          ['OpenRouter, Inc.', 'USA. Vermittelt Anfragen an das Sprachmodell (siehe oben). Auftragsverarbeiter. Übermittlung in die USA siehe nächster Abschnitt.'],
          ['Mistral AI SAS', 'Paris, Frankreich. Betreibt das Sprachmodell. Wird über OpenRouter eingebunden.'],
          ['Apple', 'Apple Distribution International Ltd., Cork, Irland. Verkauf der Abos im App Store, Zahlung und Abrechnung. Apple ist dafür selbst verantwortlich (siehe <a href="#apple">Käufe über Apple</a>).'],
          ['Push-Dienste der Browser', 'Wenn du in der Web-App Mitteilungen einschaltest, laufen sie über den Push-Dienst deines Browsers (bei Safari Apple, bei Chrome Google, bei Firefox Mozilla). Der Inhalt der Mitteilung ist dabei Ende-zu-Ende verschlüsselt. Der Push-Dienst sieht nur, dass eine Mitteilung an dein Gerät geht.'],
          ['GitHub, Inc.', 'USA. Liefert diese Website aus (GitHub Pages), siehe <a href="#website">Diese Website</a>.'],
        ])
        + p('Wenn ihr selbst einen anderen Dienst mit eurem Haushalt verbindet, etwa Home Assistant oder einen KI-Assistenten über MCP, gehen Daten auf eure Veranlassung dorthin. Für diese Dienste gelten deren Bestimmungen.',
          'Darüber hinaus geben wir Daten nur weiter, wenn wir gesetzlich dazu verpflichtet sind.') },

      { id: 'drittland', h: 'Übermittlung in Länder außerhalb der EU', body:
        p('Die Inhalte eurer Haushalte speichern wir ausschließlich in Deutschland. In ein Land außerhalb der EU und des EWR gelangen Daten in diesen Fällen:')
        + ul('<b>OpenRouter (USA)</b>, wenn ihr eine Funktion mit Sprachmodell nutzt. Grundlage sind Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO) bzw., soweit vorhanden, eine Zertifizierung nach dem EU-US Data Privacy Framework (Art. 45 DSGVO).',
          '<b>GitHub (USA)</b> beim Aufruf dieser Website, auf denselben Grundlagen.',
          '<b>Apple</b> verarbeitet Käufe nach seinen eigenen Bestimmungen, auch in den USA.') },

      { id: 'sicherheit', h: 'Speicherort und Verschlüsselung', body:
        ul('Die Server von ToHuus Cloud stehen bei Hetzner in Deutschland.',
          'Jeder Haushalt hat eine eigene Datenbank, verschlüsselt mit einem eigenen, zufälligen Schlüssel. Fotos und Bon-Dateien sind einzeln mit AES-256-GCM verschlüsselt, ebenso die nächtlichen Sicherungskopien.',
          'Die Kontoverwaltung (Konten, Mitgliedschaften, Sitzungen, Abos) ist ebenfalls verschlüsselt. Die Schlüssel der Haushalte liegen dort nur verschlüsselt mit einem Hauptschlüssel, der nicht auf dem Datenspeicher liegt.',
          'Die Verbindung zwischen App, Browser und Server ist per TLS verschlüsselt.',
          'Haushalte sind voneinander getrennt: Jede Anfrage läuft im Kontext genau eines Haushalts, ohne diesen Kontext verweigert der Server den Zugriff. Wie das umgesetzt ist, steht offen im Quellcode.') },

      { id: 'speicherdauer', h: 'Wie lange wir Daten speichern', body:
        dl([
          ['Inhalte eines Haushalts', 'Bis der Haushalt gelöscht wird. Beim Löschen wird zuerst der Schlüssel des Haushalts vernichtet, damit sind Datenbank, Dateien und Sicherungskopien nicht mehr lesbar. Danach löschen wir den Ordner des Haushalts und seine Sicherungskopien, auch die im externen Sicherungsspeicher.'],
          ['Konto', 'Bis du es löschst. Aus den Sicherungskopien der Kontoverwaltung verschwindet es mit deren Ablauf: lokal nach spätestens fünf Wochen, im externen Sicherungsspeicher nach spätestens 60 Tagen.'],
          ['Gespräche mit dem Assistenten', '30 Tage nach der letzten Nachricht, oder früher, wenn du sie löschst.'],
          ['Sprachaufnahmen', 'Werden nicht gespeichert.'],
          ['Sitzungen mit IP-Adresse und Gerätekennung', 'Bis du dich abmeldest, das Gerät entfernst oder die Sitzung nach 180 Tagen abläuft.'],
          ['Zähler für Anmeldeversuche', 'Im Arbeitsspeicher, höchstens eine Stunde.'],
          ['Kaufbelege von Apple', 'Bis der Haushalt gelöscht wird, dann löschen wir sie mit. Verkäufer ist Apple, die Kaufbelege führt Apple. Aus den Sicherungskopien der Kontoverwaltung verschwinden sie mit deren Ablauf.'],
          ['Nach dem Ende eines Abos', 'Wird nichts gelöscht. Der Haushalt geht auf den Tarif Free zurück.'],
        ]) },

      { id: 'apple', h: 'Käufe über Apple', body:
        p('Abos für ToHuus Cloud kaufst du in der iPhone-App über den App Store. Bezahlung und Abrechnung übernimmt Apple. Deine Zahlungsdaten und deine Apple-ID erhalten wir nicht.',
          'Von Apple bekommen wir eine signierte Transaktion und Benachrichtigungen zu Verlängerung, Kündigung oder Erstattung. Daraus speichern wir: Transaktionsnummer, Produkt, Kauf- und Ablaufdatum, ob es ein Test- oder echter Kauf war, und eine Kennung, die den Kauf eurem Haushalt zuordnet. Die Signatur prüfen wir auf unserem eigenen Server, ohne weitere Dienstleister. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.',
          'Für die Verarbeitung durch Apple gilt die Datenschutzrichtlinie von Apple.') },

      { id: 'geraet', h: 'Was auf deinem Gerät gespeichert wird', body:
        p('ToHuus enthält kein Tracking, keine Werbung, keine Analyse-Werkzeuge und keine Bausteine von Drittanbietern. Die iPhone-App nutzt nur Funktionen von iOS selbst.')
        + ul('<b>Web-App:</b> ein technisch notwendiges Sitzungs-Cookie, das dich angemeldet hält (bis zu 180 Tage), und ein Zwischenspeicher, damit die App schnell lädt und die Liste auch ohne Netz funktioniert. Weitere Cookies setzen wir nicht.',
          '<b>iPhone-App:</b> das Geräte-Token für die Anmeldung im Schlüsselbund (Keychain) von iOS, dazu ein Zwischenspeicher für die Liste und Aufträge, die noch an den Server gehen müssen. Widget und Teilen-Funktion lesen diese Daten auf dem Gerät mit.',
          '<b>Berechtigungen:</b> Kamera (Barcodes, Bons, QR-Code des eigenen Servers), Mikrofon und Spracherkennung (Spracheingabe für den Assistenten), Hinzufügen zur Fotomediathek (Bilder sichern). Die App fragt jeweils erst, wenn du die Funktion nutzt, und du kannst die Erlaubnis in den iOS-Einstellungen wieder entziehen.')
        + p('Rechtsgrundlage für das Speichern auf deinem Gerät ist § 25 Abs. 2 Nr. 2 TDDDG, weil es für den von dir gewünschten Dienst unbedingt erforderlich ist.') },

      { id: 'website', h: 'Diese Website', body:
        p('Diese Website setzt keine Cookies, trackt nicht und lädt nichts von Dritten. Schriften und Bilder liegen auf demselben Server.',
          'Ausgeliefert wird sie über GitHub Pages von GitHub, Inc. (USA). Beim Aufruf verarbeitet GitHub technisch notwendige Daten wie deine IP-Adresse, um die Seite auszuliefern und vor Angriffen zu schützen. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist eine sichere, verlässliche Auslieferung der Website.',
          'Wählst du das dunkle Design, merkt sich dein Browser diese Wahl im lokalen Speicher. An uns wird sie nicht übertragen.') },

      { id: 'selbst-hosten', h: 'Selbst gehostete Server', body:
        p('ToHuus ist Open Source und lässt sich auf einem eigenen Server betreiben. Verantwortlich für die Daten auf einem solchen Server ist, wer ihn betreibt, nicht wir. Das gilt auch, wenn du die iPhone-App mit deinem eigenen Server verbindest: Die App schickt dann keine Daten an uns. Welcher KI-Dienst dort genutzt wird, legt der Betreiber fest. Käufe gibt es mit einem eigenen Server nicht.',
          'Unabhängig davon verarbeitet Apple beim Laden der App aus dem App Store Daten nach seinen eigenen Bestimmungen.') },

      { id: 'rechte', h: 'Deine Rechte', body:
        p('Du hast gegenüber uns das Recht')
        + ul('auf Auskunft über die Daten, die wir über dich verarbeiten (Art. 15 DSGVO),',
          'auf Berichtigung unrichtiger Daten (Art. 16 DSGVO),',
          'auf Löschung (Art. 17 DSGVO),',
          'auf Einschränkung der Verarbeitung (Art. 18 DSGVO),',
          'auf Datenübertragbarkeit (Art. 20 DSGVO): Admins eines Haushalts können die Daten des Haushalts jederzeit als JSON exportieren,',
          'eine Einwilligung jederzeit mit Wirkung für die Zukunft zu widerrufen (Art. 7 Abs. 3 DSGVO).')
        + p('<b>Widerspruchsrecht (Art. 21 DSGVO):</b> Verarbeiten wir Daten auf Grundlage eines berechtigten Interesses (Art. 6 Abs. 1 lit. f DSGVO), kannst du aus Gründen, die sich aus deiner besonderen Situation ergeben, jederzeit widersprechen.',
          '<b>Konto und Haushalt löschen:</b> Das geht jederzeit selbst in der App unter den Einstellungen deines Kontos. Bist du die einzige Person in einem Haushalt, wird er mitgelöscht. In gemeinsamen Haushalten verlässt du ihn, und die Daten bleiben für die anderen Mitglieder erhalten.',
          `Für alles andere genügt eine E-Mail an ${mail}.`,
          '<b>Beschwerde:</b> Du kannst dich bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO). Für uns zuständig ist der Landesbeauftragte für den Datenschutz Niedersachsen, Prinzenstraße 5, 30159 Hannover.') },

      { id: 'sonstiges', h: 'Pflichtangaben und automatisierte Entscheidungen', body:
        p('Für ein Konto in ToHuus Cloud brauchen wir deine E-Mail-Adresse und ein Passwort oder die Anmeldung per E-Mail-Link. Ohne sie können wir kein Konto anlegen. Alle anderen Angaben sind freiwillig.',
          'Eine automatisierte Entscheidung im Sinne von Art. 22 DSGVO, die dir gegenüber rechtliche Wirkung entfaltet, findet nicht statt. Vorschläge von ToHuus sind Vorschläge: Ihr entscheidet, was auf die Liste kommt.') },

      { id: 'aenderungen', h: 'Änderungen', body:
        p('Ändert sich ToHuus so, dass sich diese Erklärung ändern muss, passen wir sie an. Wesentliche Änderungen teilen wir angemeldeten Nutzern vorher per E-Mail oder in der App mit. Es gilt die jeweils auf dieser Seite veröffentlichte Fassung.') },
    ],
  };

  const deTerms = {
    file: 'nutzungsbedingungen.html', label: 'Rechtliches', h1: 'Nutzungsbedingungen',
    title: 'Nutzungsbedingungen · ToHuus',
    desc: 'Die Bedingungen für ToHuus Cloud, die iPhone-App und die Web-App: Tarife, Kontingente, eure Inhalte, Haftung.',
    summaryH: 'Kurz gesagt',
    summary: [
      'ToHuus ist in der Testphase. Funktionen können sich ändern, und es kann Ausfälle geben.',
      'Free kostet nichts. Abos laufen über Apple und werden dort gekündigt.',
      'Eure Inhalte bleiben eure. Wir nutzen sie nur, damit ToHuus für euch funktioniert.',
      'Die Allergie-Warnung ersetzt nicht den Blick auf die Zutatenliste.',
    ],
    sections: [
      { id: 'geltung', h: 'Worum es geht', body:
        p(`Diese Bedingungen gelten für die Nutzung von ToHuus Cloud (<code>${cloudHost}</code>) über die iPhone-App oder die Web-App. Anbieter ist ${k.PROVIDER}, ${k.ADDRESS.join(', ')} (im Folgenden „wir“). ToHuus ist ein Angebot von Heidrich Digital.`,
          'Für die iPhone-App selbst gilt zusätzlich der Standard-Lizenzvertrag von Apple für Apps aus dem App Store (Licensed Application End User License Agreement).',
          'Wer ToHuus auf einem eigenen Server betreibt, braucht diese Bedingungen nicht. Dafür gilt nur die Open-Source-Lizenz (siehe <a href="#open-source">Open Source</a>).',
          'Wie wir mit Daten umgehen, steht in der <a href="datenschutz.html">Datenschutzerklärung</a>.') },

      { id: 'testphase', h: 'Testphase', body:
        p('ToHuus ist neu und wird gerade mit den ersten Haushalten getestet. Funktionen können sich ändern, dazukommen oder wegfallen, und es kann Fehler und Ausfälle geben. Wir bemühen uns um einen verlässlichen Betrieb und sichern die Daten jede Nacht, können aber in der Testphase keine bestimmte Verfügbarkeit zusagen. Fällt eine Funktion weg, die zu einem bezahlten Tarif gehört, sagen wir das vorher an.') },

      { id: 'konto', h: 'Konto und Haushalt', body:
        ul('Ein Konto kannst du ab 18 Jahren anlegen. Kinder und Jugendliche können als Mitglieder oder Gäste eines Haushalts dabei sein, wenn ein Erwachsener sie einlädt und dafür verantwortlich ist.',
          'Gib eine E-Mail-Adresse an, die dir gehört und unter der du erreichbar bist. Halte dein Passwort geheim. Bemerkst du, dass jemand dein Konto missbraucht, sag uns bitte Bescheid.',
          'Wer einen Haushalt anlegt, ist dort Admin. Admins laden Mitglieder und Gäste ein, vergeben Rechte und entscheiden über Einstellungen wie die Weitergabe von Allergien an das Sprachmodell. Lade nur Menschen ein, die das wollen, und trag Angaben über andere nur mit deren Einverständnis ein.',
          'Ein Abo gilt für einen Haushalt. Mitglieder, Kinder, Gäste und verbundene Haushalte zahlen nichts.') },

      { id: 'tarife', h: 'Tarife und Preise', body:
        dl([
          ['Free', '0 €. Gemeinsame Liste mit Einkaufsmodus, Bons ohne Limit, ToHuus merkt sich 60 Tage zurück, Rezepte von Hand oder per Link, 20 Nachrichten an den Assistenten im Monat, 250 MB Speicher.'],
          ['Haushalt', '3,99 € im Monat oder 34,99 € im Jahr. Dazu die ganze Geschichte mit Preisverlauf, Ausgaben und Rückblick, verbundene Haushalte, Import aus Screenshots und Fotos von Papierlisten, 100 Nachrichten im Monat, 2 GB Speicher.'],
          ['Plus', '5,99 € im Monat oder 59,99 € im Jahr. Dazu Wochenplan aus dem, was da ist, Monatsauswertung vom Assistenten, 1.500 Nachrichten im Monat, 5 GB Speicher.'],
        ])
        + p('Maßgeblich ist der Preis, den der App Store beim Kauf anzeigt. Jeder neue Haushalt nutzt 14 Tage lang den Tarif Plus, ohne Zahlungsdaten und ohne dass danach automatisch ein Abo beginnt. Nach der Testphase oder wenn ein Abo endet, geht der Haushalt auf Free zurück. Gelöscht wird dabei nichts. Ältere Einträge sind dann bis zum nächsten Abo nicht sichtbar.') },

      { id: 'apple', h: 'Bezahlen und Kündigen über Apple', body:
        ul('Abos kaufst du in der iPhone-App über den App Store. Vertragspartner für den Kauf und die Zahlung ist Apple, es gelten die Bedingungen von Apple für Medienservices.',
          'Ein Abo verlängert sich automatisch um den gewählten Zeitraum, wenn du es nicht spätestens 24 Stunden vor Ablauf kündigst.',
          'Kündigen kannst du jederzeit in den Einstellungen deiner Apple-ID unter „Abonnements“. Das Abo läuft dann bis zum Ende des bezahlten Zeitraums.',
          'Erstattungen und ein Widerrufsrecht richten sich nach den Bedingungen von Apple. Anträge stellst du bei Apple.',
          'Preise für laufende Abos ändern sich nur nach den Regeln des App Store. Apple informiert dich vorher und fragt dich, wo die Regeln es vorsehen, um Zustimmung. Du kannst jederzeit kündigen.') },

      { id: 'kontingente', h: 'Kontingente und faire Nutzung', body:
        p('Damit der Dienst für alle bezahlbar bleibt, gelten je Haushalt diese Grenzen:')
        + dl([
          ['Nachrichten an den Assistenten', 'Free 20, Haushalt 100, Plus 1.500 im Monat. Ist das Kontingent aufgebraucht, versteht der Assistent weiter die üblichen Sätze wie „Milch ist alle“ ohne Sprachmodell. In Plus wird über 1.500 nicht gesperrt, die Antworten werden kürzer.'],
          ['Bons mit Sprachmodell lesen', 'Free 15, Haushalt 40, Plus 60 am Tag. Bons als PDF der meisten Märkte brauchen kein Sprachmodell und sind nicht begrenzt.'],
          ['Importe mit Sprachmodell', 'Rezepte und Produkte aus Links, Texten oder Fotos: Free 10, Haushalt 40, Plus 100 am Tag.'],
          ['Uploads', 'Free 60, Haushalt 200, Plus 300 am Tag.'],
          ['Speicher', 'Free 250 MB, Haushalt 2 GB, Plus 5 GB für Fotos, Bon-Dateien und Datenbank. Ist der Speicher voll, sind neue Uploads gesperrt, bis ihr Platz schafft oder den Tarif wechselt. Gelöscht wird nichts, und kleine Änderungen im Alltag funktionieren weiter.'],
        ])
        + p('Bitte nutze ToHuus für deinen Haushalt und nicht automatisiert in großen Mengen. Ändern wir Kontingente zu deinem Nachteil, gilt das für laufende Abos erst ab dem nächsten Abrechnungszeitraum, und wir sagen es vorher an.') },

      { id: 'grenzen', h: 'Was ToHuus nicht ist', body:
        ul('<b>Allergien:</b> ToHuus warnt nach einer Wortliste und ersetzt nicht den Blick auf die Zutatenliste. Es kann Zutaten übersehen oder falsch zuordnen. Prüf bei Allergien immer selbst die Verpackung.',
          '<b>Keine medizinische Beratung und keine Ernährungsberatung.</b> Rezeptvorschläge, Hinweise und Antworten des Assistenten sind keine Empfehlungen für deine Gesundheit.',
          '<b>Sprachmodelle machen Fehler.</b> Erkannte Bons, Importe und Antworten des Assistenten können falsch sein. Was ToHuus nicht sicher lesen kann, legt es dir zum Prüfen vor. Jeder Schritt des Assistenten lässt sich zurücknehmen.',
          '<b>Keine Finanzberatung.</b> Die Ausgabenübersicht zeigt, was in euren Bons steht, nicht mehr.') },

      { id: 'inhalte', h: 'Eure Inhalte', body:
        p('Was ihr eintragt und hochladet, bleibt euer. Ihr gebt uns nur die Rechte, die wir brauchen, damit ToHuus für euch funktioniert: speichern, verarbeiten, für die Mitglieder eures Haushalts anzeigen und, wenn ihr eine solche Funktion nutzt, an das Sprachmodell geben, wie in der Datenschutzerklärung beschrieben. Wir nutzen eure Inhalte nicht für Werbung, verkaufen sie nicht und trainieren damit keine Modelle.',
          'Lade nur Inhalte hoch, die du hochladen darfst, und nichts Rechtswidriges. Rezepte und Fotos anderer bleiben deren Werk.',
          'Exportieren können Admins die Daten ihres Haushalts jederzeit als JSON.') },

      { id: 'regeln', h: 'Was nicht erlaubt ist', body:
        ul('den Dienst anzugreifen, zu überlasten oder Grenzen und Sperren zu umgehen,',
          'auf Haushalte oder Konten zuzugreifen, die nicht deine sind,',
          'ToHuus für rechtswidrige Zwecke zu nutzen.')
        + p(`Findest du eine Sicherheitslücke, schreib uns bitte an ${mail}, bevor du sie öffentlich machst.`) },

      { id: 'ende', h: 'Löschen, Kündigen, Sperren', body:
        ul('Du kannst deinen Haushalt und dein Konto jederzeit in der App löschen. Ein laufendes Abo kündigst du zusätzlich bei Apple, sonst verlängert es sich weiter.',
          'Wir können die Nutzung von Free mit einer Frist von vier Wochen beenden. Bezahlte Abos laufen bis zum Ende des bezahlten Zeitraums. Ohne Frist sperren oder beenden dürfen wir nur aus wichtigem Grund, etwa bei Angriffen auf den Dienst oder bei rechtswidrigen Inhalten.',
          'Wir behalten uns vor, Haushalte im Tarif Free zu löschen, die seit zwölf Monaten niemand geöffnet hat. Vorher schreiben wir den Admins zweimal per E-Mail, die letzte Nachricht mindestens vier Wochen vor dem Löschen. Bis dahin genügt es, ToHuus einmal zu öffnen. Derzeit löschen wir inaktive Haushalte nicht.',
          'Endet die Nutzung, kannst du vorher deine Daten exportieren.') },

      { id: 'haftung', h: 'Haftung', body:
        p('Wir haften unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit, nach dem Produkthaftungsgesetz und soweit wir eine Garantie übernommen haben.',
          'Bei leichter Fahrlässigkeit haften wir nur, wenn wir eine wesentliche Vertragspflicht verletzen, also eine Pflicht, deren Erfüllung die Nutzung von ToHuus überhaupt erst möglich macht und auf die du vertrauen darfst. Dann ist die Haftung auf den Schaden begrenzt, der bei Vertragsschluss typischerweise vorhersehbar war.',
          'Im Übrigen ist die Haftung ausgeschlossen, soweit das gesetzlich zulässig ist. Deine gesetzlichen Rechte als Verbraucher bleiben unberührt.') },

      { id: 'aenderungen', h: 'Änderungen dieser Bedingungen', body:
        p('Ändern wir diese Bedingungen, schicken wir dir die neue Fassung mindestens sechs Wochen vorher per E-Mail. Änderungen, die nur Neues hinzufügen oder Fehler im Text berichtigen, gelten ab dem angekündigten Tag. Änderungen, die deine Rechte schmälern, gelten nur, wenn du zustimmst. Stimmst du nicht zu, können beide Seiten den Vertrag beenden.') },

      { id: 'open-source', h: 'Open Source', body:
        p(`Der Quellcode von ToHuus ist offen. Server und Web-App stehen unter der GNU Affero General Public License 3.0 (AGPL-3.0), die Home-Assistant-Integration unter der MIT-Lizenz. Diese Bedingungen schränken deine Rechte aus diesen Lizenzen nicht ein. Den Code findest du auf <a href="${k.GH}">GitHub</a>.`,
          'Name und Zeichen von ToHuus sind von den Lizenzen nicht umfasst.') },

      { id: 'recht', h: 'Recht und Streitbeilegung', body:
        p('Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts. Bist du Verbraucher mit gewöhnlichem Aufenthalt in einem anderen Land der EU, bleiben dir die zwingenden Schutzvorschriften dieses Landes erhalten.',
          'Wir sind nicht bereit und nicht verpflichtet, an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen. Schreib uns einfach, wir finden in aller Regel eine Lösung.',
          `Kontakt: ${k.PROVIDER}, ${k.ADDRESS.join(', ')}, E-Mail ${mail}, Telefon ${k.PHONE}.`) },
    ],
  };

  // ================================================================== English (translation)
  const enNote = 'This is a translation. Only the <a href="de/{file}" hreflang="de" lang="de">German version</a> is binding.';
  const enPrivacy = {
    file: 'privacy.html', label: 'Legal', h1: 'Privacy policy',
    title: 'Privacy · ToHuus',
    desc: 'What data ToHuus Cloud, the iPhone app and the web app process, why, with whom and for how long.',
    note: enNote.replace('{file}', 'datenschutz.html'),
    summaryH: 'In short',
    summary: [
      'Your household data is stored on Hetzner servers in Germany, every household in its own encrypted database.',
      'No tracking, no ads, no analytics tools. We do not sell data and do not analyse your receipts for anyone else.',
      'For receipt photos, imports and the assistant we use a language model from Mistral AI (France), routed through OpenRouter (USA).',
      'Allergies and details about children only go to the language model if you explicitly switch that on.',
      'You can delete your household and your account in the app at any time.',
    ],
    sections: [
      { id: 'controller', h: 'Who is responsible', body:
        p('The controller for the processing of personal data in ToHuus Cloud, in the iPhone app and in the web app when they are connected to ToHuus Cloud, and on this website is:')
        + `<address>${k.PROVIDER}<br>${addr}<br>Germany<br>E-mail: ${mail}<br>Phone: ${k.PHONE.replace(/^0/, '+49 ')}</address>`
        + p('ToHuus is offered by Heidrich Digital. Below, “we” means the provider named above.',
          `We have not appointed a data protection officer because we are not required to. For any question about data protection, write to ${mail}.`) },

      { id: 'scope', h: 'What this policy covers', body:
        ul(`<b>ToHuus Cloud</b>: the server we run at <code>${cloudHost}</code>.`,
          '<b>The ToHuus iPhone app</b>, when it is connected to ToHuus Cloud.',
          '<b>The web app</b> in the browser, when it is connected to ToHuus Cloud.',
          '<b>This website</b> (tohuus.heidrich-digital.de).')
        + p('<b>Self-hosted servers:</b> whoever runs ToHuus on their own server is responsible for the data on that server. We receive no data from it, also not when the iPhone app is connected to such a server. The app then only talks to that server and to the AI service its operator has set up. See <a href="#self-hosting">Self-hosted servers</a>.') },

      { id: 'data', h: 'What data we process and why', body:
        h3('Account')
        + p('Your e-mail address, your name as shown in the household, your password (only as a scrypt hash, never in plain text), whether your e-mail address is confirmed, language and region. We need these to run your account, sign you in and send you the e-mails that belong to the service: address confirmation, sign-in links, password resets and household invitations. We do not send marketing e-mails.',
          'Legal basis: Art. 6(1)(b) GDPR (contract for the use of ToHuus Cloud).')
        + h3('Your household’s content')
        + p('Everything you enter or upload in ToHuus: the shopping list with the origin of each item, stock, products, places, recipes, the week plan, receipts and order notices (as a file or photo, and the lines recognised from them with shop, date and prices), spending and budget, notes on what ToHuus remembers for you, and the people in the household with name, role, likes and dislikes. If you add children, this can include their names and birth years.',
          'We process this data so that ToHuus works for you: the list, suggestions from your purchase rhythm, the cook planner and the spending overview. The members and guests of your household can see it within the rights you grant. Legal basis: Art. 6(1)(b) GDPR.',
          'We do not look at the content of your households. Technically, the operator of the server has access to the keys. We only use that access if you explicitly ask us to for a support request or if we are legally required to.')
        + h3('Allergies and intolerances (health data)')
        + p('You can record allergies and intolerances for people in the household. This is health data within the meaning of Art. 9 GDPR. ToHuus only uses it within your household: to show it and to leave out unsuitable recipes when making suggestions. The legal basis is your explicit consent (Art. 9(2)(a) GDPR), which you give by entering it. Only enter details about other people if they agree or if you are their legal representative, for example as a parent.',
          'Allergies and details about children only go to a language model if an admin of your household explicitly switches that on under <i>Settings › Access &amp; AI › Assistant &amp; privacy</i>. It is off by default. You can withdraw your consent at any time by deleting the details or switching it off. What happened before remains lawful.')
        + h3('Assistant and voice input')
        + p('What you write or say to the assistant, and its answers, are stored as a conversation. Conversations belong to the person who has them; other members do not see them. They are deleted automatically 30 days after the last message, and you can delete them earlier at any time.',
          'We do not store voice recordings. On the iPhone, speech is turned into text on the device where possible. If your iPhone does not support that for your language, iOS uses Apple’s speech recognition, which is subject to Apple’s terms (iOS asks for your permission first). If no speech recognition is available, and always in the browser, the app sends the recording to our server. There it is passed in memory to the language model to be turned into text and then discarded.',
          'Legal basis: Art. 6(1)(b) GDPR.')
        + h3('Plan, allowances and purchases')
        + p('For each household we store the plan, the end of the trial, counters for the allowances (assistant messages, AI reads for receipts and imports, uploads) and the storage used. If you buy a subscription, we store the details from the transaction signed by Apple (see <a href="#apple">Purchases through Apple</a>). Legal basis: Art. 6(1)(b) GDPR.')
        + p('To run the service we only look at totals: how many households there are and how many are active, sign-ups per week, plans, storage used, AI usage per day and the server error rate. Household content and details about individual people are not part of it.')
        + h3('Security and abuse prevention')
        + p('With every sign-in we store the IP address and the browser or app identifier (user agent) together with the session, plus when it was last used. This lets you see and sign out your devices, and lets us detect abuse. For the iPhone app we store the device name with the device token and when it was last used. To limit sign-in attempts, sign-ups and outgoing e-mails, we count IP addresses and e-mail addresses briefly in the server’s memory, for one hour at most. Server error messages are written to a log.',
          'Legal basis: Art. 6(1)(f) GDPR. Our legitimate interest is running the service securely and protecting your accounts.')
        + h3('When you write to us')
        + p('If you e-mail us, we process your address and your message to reply. Legal basis: Art. 6(1)(b) GDPR if it concerns your account or household, otherwise Art. 6(1)(f) GDPR.') },

      { id: 'ai', h: 'Language models: Mistral through OpenRouter', body:
        p('Some features use a language model. For these, ToHuus Cloud sends the necessary data to <b>OpenRouter, Inc.</b> (USA), an intermediary for language models. OpenRouter forwards the request to <b>Mistral AI SAS</b> (Paris, France), which runs the model and produces the answer. Every request is pinned to Mistral with no fallback to other providers, and with the requirement that it may only go to providers that, as classified by OpenRouter, do not collect user data, meaning they do not store requests permanently and do not use them for training.')
        + p('<b>When this happens</b>, only when you use one of these features:')
        + ul('Photos and screenshots of receipts, and receipt texts that ToHuus cannot read without a language model. Card numbers, loyalty cards, TSE data and addresses are removed from receipt texts first. Photos are scaled down and sent as they are.',
          'Imports of recipes and products from links, texts, photos and screenshots, for example a photo of a paper shopping list.',
          'The assistant, and voice input when the speech was not recognised on the device.')
        + p('AI can be switched off: for the whole household, for each person and for each child (the parents decide). Then no request goes to a language model; receipts are read on our server with text recognition.')
        + p('<b>What the assistant is told:</b> your household’s name, the date, who is writing, the people with their likes and dislikes, the open list without private items, what is due by your rhythm, the week plan, this week’s and this month’s spending with the budget, and what ToHuus remembers, without entries recognised as sensitive. Allergies, children’s birth years and sensitive entries only with the consent described above.',
          '<b>What OpenRouter stores:</b> according to OpenRouter, it does not store the content of requests and answers unless logging is switched on in the account. We have not switched it on. OpenRouter stores metadata such as time, model and number of tokens and, according to OpenRouter, may analyse a small share of requests anonymously to assign them to categories.',
          'We do not use your data to train models. The legal basis for the transfer is Art. 6(1)(b) GDPR because you use the feature, and Art. 9(2)(a) GDPR for health data. If you want to do without a language model, do not use these features: the list, suggestions, cook planner, spending and PDF receipts from most shops work without one.') },

      { id: 'recipients', h: 'Service providers and other recipients', body:
        p('We only pass personal data to the following. Where they work on our behalf, we have concluded a data processing agreement with them under Art. 28 GDPR.')
        + dl([
          ['Hetzner Online GmbH', 'Industriestr. 25, 91710 Gunzenhausen, Germany. Runs the ToHuus Cloud servers and the storage for backup copies, both in data centres in Germany. Processor.'],
          ['ALL-INKL.COM, Neue Medien Münnich', 'Hauptstraße 68, 02742 Friedersdorf, Germany. Sends our e-mails (SMTP): confirmations, sign-in links, password resets, invitations. For this, ALL-INKL processes the recipient address and the content of the e-mail. Processor.'],
          ['OpenRouter, Inc.', 'USA. Routes requests to the language model (see above). Processor. For the transfer to the USA see the next section.'],
          ['Mistral AI SAS', 'Paris, France. Runs the language model. Used through OpenRouter.'],
          ['Apple', 'Apple Distribution International Ltd., Cork, Ireland. Sale of subscriptions in the App Store, payment and billing. Apple is responsible for this itself (see <a href="#apple">Purchases through Apple</a>).'],
          ['Browser push services', 'If you turn on notifications in the web app, they go through your browser’s push service (Apple for Safari, Google for Chrome, Mozilla for Firefox). The content of the notification is end-to-end encrypted. The push service only sees that a notification is going to your device.'],
          ['GitHub, Inc.', 'USA. Serves this website (GitHub Pages), see <a href="#website">This website</a>.'],
        ])
        + p('If you connect another service to your household yourself, such as Home Assistant or an AI assistant through MCP, data goes there at your request. That service’s own terms apply.',
          'Beyond this, we only pass on data where the law requires us to.') },

      { id: 'transfers', h: 'Transfers outside the EU', body:
        p('We store your households’ content in Germany only. Data reaches a country outside the EU and the EEA in these cases:')
        + ul('<b>OpenRouter (USA)</b>, when you use a feature with a language model. The basis is the European Commission’s standard contractual clauses (Art. 46(2)(c) GDPR) or, where available, a certification under the EU-US Data Privacy Framework (Art. 45 GDPR).',
          '<b>GitHub (USA)</b> when you visit this website, on the same bases.',
          '<b>Apple</b> processes purchases under its own terms, including in the USA.') },

      { id: 'security', h: 'Location and encryption', body:
        ul('The ToHuus Cloud servers are hosted by Hetzner in Germany.',
          'Every household has its own database, encrypted with its own random key. Photos and receipt files are encrypted one by one with AES-256-GCM, and so are the nightly backup copies.',
          'The account directory (accounts, memberships, sessions, subscriptions) is encrypted too. The households’ keys are stored there only in encrypted form, under a master key that is not kept on the data storage.',
          'The connection between the app, the browser and the server is encrypted with TLS.',
          'Households are kept apart: every request runs in the context of exactly one household, and without that context the server refuses access. How this works is open in the source code.') },

      { id: 'retention', h: 'How long we keep data', body:
        dl([
          ['A household’s content', 'Until the household is deleted. On deletion the household’s key is destroyed first, so its database, files and backup copies can no longer be read. Then we delete the household’s folder and its backup copies, including those in the external backup storage.'],
          ['Account', 'Until you delete it. It disappears from the backup copies of the account directory as they expire: locally after five weeks at most, in the external backup storage after 60 days at most.'],
          ['Assistant conversations', '30 days after the last message, or earlier if you delete them.'],
          ['Voice recordings', 'Not stored.'],
          ['Sessions with IP address and user agent', 'Until you sign out, remove the device or the session expires after 180 days.'],
          ['Counters for sign-in attempts', 'In memory, one hour at most.'],
          ['Purchase records from Apple', 'Until the household is deleted, then we delete them too. Apple is the seller and keeps the purchase records. They disappear from the backups of the account database as those expire.'],
          ['After a subscription ends', 'Nothing is deleted. The household goes back to the Free plan.'],
        ]) },

      { id: 'apple', h: 'Purchases through Apple', body:
        p('You buy ToHuus Cloud subscriptions in the iPhone app through the App Store. Apple handles payment and billing. We do not receive your payment details or your Apple ID.',
          'Apple sends us a signed transaction and notifications about renewals, cancellations and refunds. From these we store: transaction number, product, purchase and expiry date, whether it was a test or a real purchase, and an identifier that links the purchase to your household. We verify the signature on our own server, without further service providers. Legal basis: Art. 6(1)(b) GDPR.',
          'Apple’s privacy policy applies to Apple’s processing.') },

      { id: 'device', h: 'What is stored on your device', body:
        p('ToHuus contains no tracking, no ads, no analytics tools and no third-party components. The iPhone app only uses features of iOS itself.')
        + ul('<b>Web app:</b> a technically necessary session cookie that keeps you signed in (up to 180 days), and a cache so the app loads quickly and the list works without a connection. We set no other cookies.',
          '<b>iPhone app:</b> the device token for signing in, in the iOS keychain, plus a cache for the list and for changes still waiting to go to the server. The widget and the share extension read this data on the device.',
          '<b>Permissions:</b> camera (barcodes, receipts, the QR code of your own server), microphone and speech recognition (voice input for the assistant), adding to the photo library (saving images). The app only asks when you use the feature, and you can withdraw permission in the iOS settings.')
        + p('The legal basis for storing on your device is section 25(2) no. 2 TDDDG (German Telecommunications Digital Services Data Protection Act), because it is strictly necessary for the service you asked for.') },

      { id: 'website', h: 'This website', body:
        p('This website sets no cookies, does not track you and loads nothing from third parties. Fonts and images are served from the same server.',
          'It is served through GitHub Pages by GitHub, Inc. (USA). When you visit it, GitHub processes technically necessary data such as your IP address to deliver the page and protect it from attacks. Legal basis: Art. 6(1)(f) GDPR. Our legitimate interest is delivering the website securely and reliably.',
          'If you choose the dark theme, your browser remembers that choice in its local storage. It is not sent to us.') },

      { id: 'self-hosting', h: 'Self-hosted servers', body:
        p('ToHuus is open source and can run on your own server. Whoever runs such a server is responsible for the data on it, not us. This also applies when you connect the iPhone app to your own server: the app then sends no data to us. The operator decides which AI service is used there. There are no purchases with your own server.',
          'Independently of this, Apple processes data under its own terms when you download the app from the App Store.') },

      { id: 'rights', h: 'Your rights', body:
        p('You have the right')
        + ul('of access to the data we process about you (Art. 15 GDPR),',
          'to rectification of inaccurate data (Art. 16 GDPR),',
          'to erasure (Art. 17 GDPR),',
          'to restriction of processing (Art. 18 GDPR),',
          'to data portability (Art. 20 GDPR): admins of a household can export the household’s data as JSON at any time,',
          'to withdraw consent at any time with effect for the future (Art. 7(3) GDPR).')
        + p('<b>Right to object (Art. 21 GDPR):</b> where we process data on the basis of a legitimate interest (Art. 6(1)(f) GDPR), you can object at any time on grounds relating to your particular situation.',
          '<b>Deleting your account and household:</b> you can do this yourself at any time in the app, in your account settings. If you are the only person in a household, it is deleted too. In shared households you leave, and the data stays for the other members.',
          `For anything else, an e-mail to ${mail} is enough.`,
          '<b>Complaints:</b> you can lodge a complaint with a data protection supervisory authority (Art. 77 GDPR). The authority responsible for us is the Data Protection Commissioner of Lower Saxony (Der Landesbeauftragte für den Datenschutz Niedersachsen), Prinzenstraße 5, 30159 Hannover, Germany.') },

      { id: 'other', h: 'Required data and automated decisions', body:
        p('For an account in ToHuus Cloud we need your e-mail address and a password, or sign-in by e-mail link. Without them we cannot create an account. Everything else is voluntary.',
          'There is no automated decision within the meaning of Art. 22 GDPR that has legal effect on you. Suggestions from ToHuus are suggestions: you decide what goes on the list.') },

      { id: 'changes', h: 'Changes', body:
        p('If ToHuus changes in a way that requires this policy to change, we will update it. We tell signed-in users about significant changes beforehand by e-mail or in the app. The version published on this page applies.') },
    ],
  };

  const enTerms = {
    file: 'terms.html', label: 'Legal', h1: 'Terms of use',
    title: 'Terms of use · ToHuus',
    desc: 'The terms for ToHuus Cloud, the iPhone app and the web app: plans, allowances, your content, liability.',
    note: enNote.replace('{file}', 'nutzungsbedingungen.html'),
    summaryH: 'In short',
    summary: [
      'ToHuus is in testing. Features can change, and there can be outages.',
      'Free costs nothing. Subscriptions run through Apple and are cancelled there.',
      'Your content stays yours. We only use it so that ToHuus works for you.',
      'The allergy warning does not replace reading the ingredients list.',
    ],
    sections: [
      { id: 'scope', h: 'What this is about', body:
        p(`These terms apply to the use of ToHuus Cloud (<code>${cloudHost}</code>) through the iPhone app or the web app. The provider is ${k.PROVIDER}, ${k.ADDRESS.join(', ')}, Germany (“we” below). ToHuus is offered by Heidrich Digital.`,
          'The iPhone app itself is also subject to Apple’s standard Licensed Application End User License Agreement for apps from the App Store.',
          'If you run ToHuus on your own server, you do not need these terms. Only the open source licence applies (see <a href="#open-source">Open source</a>).',
          'How we handle data is described in the <a href="privacy.html">privacy policy</a>.') },

      { id: 'testing', h: 'Testing phase', body:
        p('ToHuus is new and is currently being tested with the first households. Features can change, be added or be removed, and there can be bugs and outages. We aim for reliable operation and back up the data every night, but during testing we cannot promise a particular availability. If a feature that belongs to a paid plan is removed, we will announce it beforehand.') },

      { id: 'account', h: 'Account and household', body:
        ul('You can create an account from the age of 18. Children and teenagers can be members or guests of a household if an adult invites them and is responsible for them.',
          'Use an e-mail address that belongs to you and where you can be reached. Keep your password secret. If you notice someone misusing your account, please tell us.',
          'Whoever creates a household is its admin. Admins invite members and guests, grant rights and decide on settings such as sharing allergies with the language model. Only invite people who want to join, and only enter details about others with their agreement.',
          'One subscription covers one household. Members, children, guests and connected households pay nothing.') },

      { id: 'plans', h: 'Plans and prices', body:
        dl([
          ['Free', '€0. Shared list with shop mode, unlimited receipts, ToHuus remembers 60 days back, recipes by hand or from a link, 20 assistant messages a month, 250 MB storage.'],
          ['Household (Haushalt)', '€3.99 a month or €34.99 a year. Adds the full history with price history, spending and review, connected households, import from screenshots and photos of paper lists, 100 messages a month, 2 GB storage.'],
          ['Plus', '€5.99 a month or €59.99 a year. Adds the week plan from what is at home, a monthly review from the assistant, 1,500 messages a month, 5 GB storage.'],
        ])
        + p('The price shown by the App Store at the time of purchase applies. Every new household gets 14 days of the Plus plan, without payment details and without a subscription starting automatically afterwards. After the trial, or when a subscription ends, the household goes back to Free. Nothing is deleted. Older entries are then hidden until the next subscription.') },

      { id: 'apple', h: 'Paying and cancelling through Apple', body:
        ul('You buy subscriptions in the iPhone app through the App Store. Apple is the contracting party for the purchase and the payment, and Apple’s Media Services terms apply.',
          'A subscription renews automatically for the chosen period unless you cancel it at least 24 hours before it ends.',
          'You can cancel at any time in your Apple ID settings under “Subscriptions”. The subscription then runs until the end of the paid period.',
          'Refunds and any right of withdrawal are governed by Apple’s terms. You apply to Apple for them.',
          'Prices of running subscriptions only change under the App Store rules. Apple informs you beforehand and asks for your consent where the rules require it. You can cancel at any time.') },

      { id: 'allowances', h: 'Allowances and fair use', body:
        p('To keep the service affordable for everyone, these limits apply per household:')
        + dl([
          ['Assistant messages', 'Free 20, Household 100, Plus 1,500 a month. When the allowance is used up, the assistant still understands the usual sentences such as “we are out of milk” without a language model. In Plus nothing is blocked above 1,500; the answers get shorter.'],
          ['Reading receipts with a language model', 'Free 15, Household 40, Plus 60 a day. PDF receipts from most shops need no language model and are not limited.'],
          ['Imports with a language model', 'Recipes and products from links, texts or photos: Free 10, Household 40, Plus 100 a day.'],
          ['Uploads', 'Free 60, Household 200, Plus 300 a day.'],
          ['Storage', 'Free 250 MB, Household 2 GB, Plus 5 GB for photos, receipt files and the database. When storage is full, new uploads are blocked until you free up space or change plan. Nothing is deleted, and small everyday changes keep working.'],
        ])
        + p('Please use ToHuus for your household and not automatically in large volumes. If we change allowances to your disadvantage, this applies to running subscriptions only from the next billing period, and we announce it beforehand.') },

      { id: 'limits', h: 'What ToHuus is not', body:
        ul('<b>Allergies:</b> ToHuus warns based on a word list and does not replace reading the ingredients list. It can miss ingredients or match them wrongly. With allergies, always check the packaging yourself.',
          '<b>No medical advice and no nutritional advice.</b> Recipe suggestions, hints and the assistant’s answers are not recommendations for your health.',
          '<b>Language models make mistakes.</b> Recognised receipts, imports and the assistant’s answers can be wrong. Anything ToHuus cannot read with confidence is shown to you for a check. Every step of the assistant can be undone.',
          '<b>No financial advice.</b> The spending overview shows what is on your receipts, nothing more.') },

      { id: 'content', h: 'Your content', body:
        p('What you enter and upload stays yours. You only grant us the rights we need so that ToHuus works for you: to store it, process it, show it to the members of your household and, when you use such a feature, pass it to the language model as described in the privacy policy. We do not use your content for advertising, do not sell it and do not train models with it.',
          'Only upload content you are allowed to upload, and nothing unlawful. Other people’s recipes and photos remain their work.',
          'Admins can export their household’s data as JSON at any time.') },

      { id: 'rules', h: 'What is not allowed', body:
        ul('attacking or overloading the service, or getting around limits and blocks,',
          'accessing households or accounts that are not yours,',
          'using ToHuus for unlawful purposes.')
        + p(`If you find a security issue, please write to ${mail} before making it public.`) },

      { id: 'ending', h: 'Deleting, cancelling, suspending', body:
        ul('You can delete your household and your account in the app at any time. A running subscription must also be cancelled with Apple, otherwise it keeps renewing.',
          'We can end the use of Free with four weeks’ notice. Paid subscriptions run until the end of the paid period. We may only suspend or end use without notice for good cause, for example attacks on the service or unlawful content.',
          'We reserve the right to delete households on the Free plan that nobody has opened for twelve months. Before that, we write to the admins twice by e-mail, the last message at least four weeks before deletion. Until then, opening ToHuus once is enough. We do not delete inactive households at present.',
          'Before your use ends, you can export your data.') },

      { id: 'liability', h: 'Liability', body:
        p('We are liable without limitation for intent and gross negligence, for injury to life, body or health, under the German Product Liability Act and where we have given a guarantee.',
          'For slight negligence we are only liable if we breach an essential contractual obligation, meaning an obligation whose fulfilment makes the use of ToHuus possible in the first place and on which you may rely. In that case liability is limited to the damage that was typically foreseeable when the contract was concluded.',
          'Otherwise liability is excluded as far as the law permits. Your statutory rights as a consumer remain unaffected.') },

      { id: 'changes', h: 'Changes to these terms', body:
        p('If we change these terms, we send you the new version by e-mail at least six weeks in advance. Changes that only add something new or correct mistakes in the text apply from the announced date. Changes that reduce your rights only apply if you agree. If you do not agree, either side can end the contract.') },

      { id: 'open-source', h: 'Open source', body:
        p(`The source code of ToHuus is open. The server and the web app are licensed under the GNU Affero General Public License 3.0 (AGPL-3.0), the Home Assistant integration under the MIT licence. These terms do not restrict your rights under those licences. You can find the code on <a href="${k.GH}">GitHub</a>.`,
          'The ToHuus name and mark are not covered by the licences.') },

      { id: 'law', h: 'Governing law and disputes', body:
        p('German law applies, excluding the UN Convention on Contracts for the International Sale of Goods. If you are a consumer habitually resident in another EU country, you keep the mandatory consumer protection of that country.',
          'We are neither willing nor obliged to take part in dispute resolution proceedings before a consumer arbitration board. Just write to us; we will almost always find a solution.',
          `Contact: ${k.PROVIDER}, ${k.ADDRESS.join(', ')}, Germany, e-mail ${mail}, phone ${k.PHONE.replace(/^0/, '+49 ')}.`) },
    ],
  };

  return { de: { privacy: dePrivacy, terms: deTerms }, en: { privacy: enPrivacy, terms: enTerms } };
}
