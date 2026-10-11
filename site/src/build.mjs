/**
 * Builds the marketing site (site/index.html in English, site/de/index.html in German) from one template.
 * Run from the repo root:  node site/src/build.mjs
 *
 * Design: "Dutch Detail" (docs/design/2026-10-11-dutch-detail-system.md): same tokens, fonts and icons as the app.
 * Signature elements on the page: the green block with circles, the ticket with punch notches, the receipt with a
 * zigzag edge, the arch photo with a stamp, the floating black bar (mobile) and the offset housing-form tiles.
 * Fonts: site/assets/fonts (woff2 copied from the pinned @fontsource packages, OFL licences next to them).
 * Icons: Phosphor (regular), rendered into an inline sprite at build time, like the app.
 *
 * Screenshots: real screens from the app, 390 px wide phone viewport at 2x, saved as
 * site/assets/shots/<lang>/<name>-<light|dark>.webp (780 px wide, webp q80). The slots in use are listed in SHOTS
 * below; the build fails if one is missing. How they are made: see the comment at the end of this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Ph from '@phosphor-icons/react/ssr';
import { homeTiles, brandMark, bird } from './art.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://tohuus.heidrich-digital.de/';
const GH = 'https://github.com/tillheidrich/tohuus-hub';

// ---------------------------------------------------------------- icons (Phosphor regular, like the app)
const ICONS = {
  arrow: 'ArrowRight', github: 'GithubLogo', copy: 'Copy', sun: 'Sun', moon: 'Moon', check: 'Check', home: 'House',
  hand: 'Hand', eyeoff: 'EyeSlash', store: 'Storefront', pot: 'CookingPot', calendar: 'CalendarBlank', heart: 'Heart',
  download: 'DownloadSimple', swap: 'ArrowsLeftRight', scale: 'Scales', gauge: 'Gauge', qr: 'QrCode', pin: 'MapPin',
  receipt: 'Receipt', sparkle: 'Sparkle', chart: 'ChartBar', list: 'ListChecks', smile: 'Smiley', child: 'Baby',
  key: 'Key', mic: 'Microphone', party: 'Confetti', suitcase: 'Suitcase', moonstar: 'MoonStars', door: 'Door',
  refresh: 'ArrowsClockwise', package: 'Package', tv: 'Television', send: 'PaperPlaneTilt', chat: 'ChatCircle',
  bolt: 'Lightning', server: 'HardDrives', db: 'Database', lock: 'LockSimple', camera: 'Camera', globe: 'Globe',
  code: 'Code', mail: 'EnvelopeSimple', zoom: 'MagnifyingGlassPlus', play: 'Play', user: 'User', barcode: 'Barcode',
  gift: 'HandHeart', bell: 'BellSimple', users: 'Users', robot: 'Robot', translate: 'Translate', terminal: 'TerminalWindow',
};
const symbol = (id, name) => {
  const C = Ph[`${name}Icon`] || Ph[name];
  if (!C) throw new Error(`unknown Phosphor icon ${name}`);
  const svg = renderToStaticMarkup(createElement(C, { size: 24 }));
  const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return `<symbol id="i-${id}" viewBox="0 0 256 256">${inner}</symbol>`;
};
const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${Object.entries(ICONS).map(([k, v]) => symbol(k, v)).join('')}</svg>`;
const ico = (n, cls = 'ico') => {
  if (!ICONS[n]) throw new Error(`icon ${n} is not in the sprite`);
  return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${n}"/></svg>`;
};

// ---------------------------------------------------------------- copy
const COPY = {
  de: {
    lang: 'de', locale: 'de_DE', alt: 'en_GB', url: `${SITE}de/`, base: '../', other: '../', otherLang: 'en',
    title: 'ToHuus Hub · Weniger im Kopf. Mehr Zuhause.',
    desc: 'Kostenlose Open-Source-App für jedes Zuhause, auf deinem eigenen Server: gemeinsame Einkaufsliste, Vorrat, Rezepte und Wochenplan, Verwöhnen für Alltag, Gäste und Partys, Bons und Ausgaben, Home Assistant und KI-Assistenten. Für Wohnung, WG, Reihenhaus oder Haus.',
    ogAlt: 'Das ToHuus-Zeichen, der Satz „Weniger im Kopf. Mehr Zuhause.“ und vier gezeichnete Wohnformen: Wohnung, WG, Reihenhaus und Haus.',
    skip: 'Zum Inhalt springen', navLabel: 'Hauptnavigation', railLabel: 'Schnellnavigation',
    ids: { home: 'zuhause', treats: 'verwoehnen', install: 'installieren', host: 'selbst-hosten', tour: 'tour' },
    nav: [['#zuhause', 'Zuhause'], ['#alltag', 'Alltag'], ['#verwoehnen', 'Verwöhnen'], ['#kochen', 'Kochen'], ['#vorrat', 'Vorrat'], ['#selbst-hosten', 'Selbst hosten']],
    rail: [['#alltag', 'Alltag', 'home'], ['#verwoehnen', 'Verwöhnen', 'gift'], ['#installieren', 'Installieren', 'download'], ['#kochen', 'Kochen', 'pot'], ['#tour', 'Tour', 'play']],
    themeLabel: 'Dunkles Design', homeLabel: 'ToHuus Hub Startseite', langLabel: 'Sprache',
    copy: 'Kopieren', copied: 'Kopiert',
    hero: {
      label: 'Open Source · auf deinem Server',
      h1: 'Weniger im Kopf.<br><span class="hl">Mehr Zuhause.</span>',
      lede: 'Ob Wohnung, WG, Reihenhaus oder Haus: ToHuus bringt Einkauf, Vorräte und Rezepte zusammen.',
      cta: 'Installieren', code: 'Code ansehen', tour: 'Tour ansehen',
      facts: ['Kostenlos, AGPL-3.0', 'Kein Konto, kein Tracking', 'Läuft auf NAS oder kleinem Server'],
      tiles: { flat: 'Wohnung', shared: 'WG', terraced: 'Reihenhaus', house: 'Haus' },
      tilesLabel: 'Vier gezeichnete Wohnformen: eine Wohnung im Mehrfamilienhaus, eine Altbau-WG mit drei Klingeln, Reihenhäuser mit einer Katze auf dem Dach und ein freistehendes Haus mit Baum.',
    },
    worries: {
      label: 'Mental Load', h2: 'Die Fragen, die sonst eine Person im Kopf hat.',
      p: 'Meistens weiß eine Person, was fehlt, was weg muss und wo das Paketband liegt. Das ist in Familien so, bei Paaren und in WGs. ToHuus übernimmt diesen Teil. Dann könnt ihr ihn euch teilen oder gar nicht mehr daran denken.',
      bonTitle: 'Im Kopf', bonFoot: 'Jetzt in ToHuus',
      list: ['Haben wir noch Milch?', 'Was essen wir heute?', 'Wer holt das?', 'Wo ist das Paketband?', 'Ist der Joghurt noch gut?', 'Hast du das schon gekauft?', 'Was brauchen wir für Samstag?', 'Wann war der Wasserfilter dran?'],
    },
    home: {
      label: 'Zuhause, nicht Haus', h2: 'Für jedes Zuhause, so wie es wirklich ist.',
      intro: 'Beim Start fragt ToHuus, wer bei euch wohnt. Daraus werden nur Vorschläge. Gesperrt wird nichts, und umstellen könnt ihr jederzeit.',
      forms: [['c', 'Allein', 'Keine Abstimmungen und kein „Wer holt’s?“, nur deine Listen.'], ['h', 'Zu zweit', 'Gemeinsame Listen und Abstimmen übers Essen, ohne Kinderbereich.'], ['s', 'Familie', 'Alles, auch Kinder und Gäste.'], ['t', 'WG', 'Gemeinsame und eigene Orte, ohne Familien-Wörter.']],
      placesH: 'Nur die Orte, die ihr wirklich habt.',
      placesP: 'Kühlschrank, Keller oder Gefriertruhe setzt ToHuus nicht voraus. Ihr benennt eure Orte selbst, verschachtelt, sortiert und archiviert sie. Was noch keinen Ort hat, steht unter „Noch keinem Ort zugewiesen“. Auch das ist in Ordnung.',
      chips: ['Küchenzeile', 'WG-Kühlschrank', 'Fach von Jonas', 'Regal im Flur', 'Gefriertruhe im Keller'], chipNone: 'Noch keinem Ort zugewiesen',
      shots: [['home', 'Einstellungen, Bereich Haushalt: Auswahl Allein, Zu zweit, Familie oder WG'], ['places', 'Einstellungen, Bereich Orte: selbst benannte Orte mit Anzahl der Dinge']],
    },
    everyday: { id: 'alltag', label: 'Alltag', h2: 'Ein Blick am Morgen reicht.', intro: '„Heute“ zeigt auf einer Seite, was zuerst dran ist, und genau einen nächsten Schritt. Die Einkaufsliste ist auf allen Handys gleichzeitig aktuell.', shots: [['today', 'Startseite Heute mit grünem Kopfblock und dem Ticket Heute zuerst'], ['shopping', 'Einkaufsliste mit Gruppen, Ich-hol’s-Knöpfen und Hinzufügen-Feld']], points: [
      ['home', 'Heute zuerst', 'Höchstens vier Zeilen aus euren echten Daten: was weg muss, was alle ist, was auf der Liste steht. Keine Kennzahlen-Kacheln.'],
      ['hand', 'Einkaufsliste mit „Ich hol’s“', 'Wer etwas übernimmt, tippt drauf. Dann kauft keiner doppelt. Im Laden sortiert sich die Liste nach Gängen, auch ohne Netz.'],
      ['store', '„Wo kaufen?“', 'Am Produkt legst du fest, wo es das gibt, etwa in der Drogerie oder auf dem Wochenmarkt. Die Liste zeigt es direkt daneben. Die App trägt hier nie selbst etwas ein.'],
      ['eyeoff', 'Diskrete Einträge', 'Private Einträge sehen die anderen nur als neutralen Platzhalter oder gar nicht. Das Geschenk für Samstag bleibt eine Überraschung.'],
      ['check', 'Abhaken heißt eingeräumt', 'Was du im Laden abhakst, landet direkt im Vorrat, wenn ihr das so eingestellt habt.'],
    ] },
    treats: {
      label: 'Verwöhnen', h2: 'Einander was Gutes tun.',
      story: [
        'Es ist halb acht, und Lea bringt Mila ins Bett. Heute dauert es. Zwischen zwei Seiten Vorlesen tippt sie auf „Was Süßes“ und dann auf Vanilleeis.',
        'Bei Till brummt das Handy: „Lea fragt dich nach was“. Ein Tipp auf „Ich bring’s“. Als sie aus dem Kinderzimmer kommt, steht das Eis schon da, mit Löffel. Der Abend ist danach nicht mehr ganz so lang.',
      ],
      after: 'Dafür ist Verwöhnen da. Wer gerade festsitzt, beim Zubettbringen, krank im Bett oder nach einem langen Tag, wünscht sich eine Kleinigkeit aus dem, was da ist. Jemand anderes bringt sie.',
      ticketH: 'So läuft ein Wunsch',
      steps: [
        ['Lea wünscht sich was', 'Was Süßes, was zu trinken, was zum Knabbern oder ein freier Wunsch. Dazu eine Notiz wie „mit Löffel, bitte“.'],
        ['Die Nachricht geht los', 'Hat Lea jemanden gefragt, brummt nur dessen Handy. Sonst bekommen alle Bescheid, die gerade können.'],
        ['„Ich bring’s“ oder „Geht gerade nicht“', 'Ein Tipp in der Nachricht reicht, auf Wunsch mit kurzem Grund wie „Gleich, in ein paar Minuten“.'],
      ],
      thanks: 'Danach ein kleines Danke. Einmal, nur an die Person, die es gebracht hat. Keine Punkte, keine Liste, wer wie oft.',
      shot: ['order', 'Seite Verwöhnen: Was hättest du gern?, darunter ein Wunsch von Lea mit Ich bring’s und Geht gerade nicht'],
      modesH: 'Dasselbe für Besuch und Partys',
      modes: [
        ['Für euch', 'Für alle, die hier wohnen. Wer allein wohnt, bekommt diesen Teil gar nicht erst angezeigt.'],
        ['Gäste', 'Besuch, Babysitter oder Großeltern bekommen einen Link oder QR-Code und wünschen sich etwas aus dem, was da ist. Mit Namen, damit klar ist, für wen der Kaffee ist.'],
        ['Party', 'Der Fernseher zeigt den QR-Code zum Mitmachen und was fertig ist. Die Küche hat ihre eigene Ansicht, und die Party endet von selbst.'],
      ],
      menu: 'Was auf der Karte steht, legt ihr fest: aus dem Vorrat oder nur auf der Karte, wie Leitungswasser oder Cappuccino.',
    },
    chapters: [
      { id: 'kochen', label: 'Kochen', h2: 'Was essen wir heute? In einer Minute entschieden.', intro: 'ToHuus schlägt vor, was zu eurem Vorrat passt, und plant die Woche mit euch. Wer mag, stimmt mit ab.', shots: [['cook', 'Seite Was essen wir heute? mit Vorschlägen aus dem Vorrat'], ['plan-vote', 'Abstimmung über Rezepte fürs Wochenende']], flip: true, points: [
        ['pot', 'Was geht sofort?', 'Was jetzt kochbar ist, wo nur eine Sache fehlt und was weg muss. Oder ein Tipp auf „Entscheidet ihr für uns“.'],
        ['calendar', 'Wochenplan', 'Freie Abende füllen sich mit passenden Rezepten, auf Wunsch im Wechsel über mehrere Wochen. Was der Woche fehlt, kommt mit einem Tipp auf die Liste.'],
        ['heart', 'Gemeinsam abstimmen', 'Alle sagen auf dem eigenen Handy nein, ja oder super, oder ein Handy geht reihum. Ohne Rangliste und ohne Diskussion am Herd.'],
        ['scale', 'Portionen pro Abend', 'Bolognese für sechs statt vier? Die Menge gilt für diesen Abend, für den Einkauf und für das, was nach dem Kochen aus dem Vorrat geht. Das Rezept bleibt, wie es ist.'],
      ] },
      { id: 'rezepte', label: 'Rezepte', h2: 'Eure Version, nicht die aus dem Internet.', intro: 'Rezepte kommen von dort, wo ihr sie schon habt. Gekocht wird dann so, wie es bei euch üblich ist.', shots: [['recipe', 'Rezeptseite mit Foto, Bewertungen und Gekocht-Knopf']], arch: { alt: 'Gnocchi-Pfanne mit Tomate und Mozzarella', stamp: 'Eure<br>Version' }, points: [
        ['download', 'Aus anderen Apps', 'Jede Rezeptseite mit strukturierten Daten, dazu Mealie, Tandoor, Paprika, Nextcloud Cookbook, KitchenOwl, Grocy und CSV. Mit einem Bildmodell auch Fotos und Text.'],
        ['translate', 'Englische Seiten', 'Die Zutaten kommen auf Deutsch an, Cups und Ounces werden zu Gramm und Millilitern. Die Schritte bleiben im Original, und nichts geht an einen Übersetzungsdienst.'],
        ['robot', 'Mit jeder KI', 'Eine fertige Vorlage zum Kopieren: Foto oder Kochbuchseite in den Chat, Antwort zurück in ToHuus.'],
        ['refresh', 'Cookidoo über Home Assistant', 'Eure Cookidoo-Woche kommt über Home Assistant herein. Thermomix-Schritte behalten Zeit, Temperatur und Stufe.'],
        ['swap', 'Die Hausversion', 'Reis statt Kartoffeln, ohne Koriander, Hafermilch statt Milch. Einmal festgelegt, gilt es für Vorschläge, Kochen und Einkaufsliste. Das Original bleibt unberührt.'],
        ['zoom', 'Fotos zum Reinzoomen', 'Ein Tipp aufs Foto öffnet es bildschirmfüllend, dann lässt es sich vergrößern.'],
        ['smile', 'Wem schmeckt’s?', 'Jede Person bewertet Rezepte und sammelt Lieblinge. Abneigungen und Allergien fließen in die Vorschläge ein, ein Gericht mit Allergen wird nie automatisch eingeplant.'],
      ] },
      { id: 'vorrat', label: 'Vorrat', h2: 'Vorrat ohne Tabelle.', intro: 'Niemand muss Nudeln zählen. Fang mit dem an, was euch ausgeht, und lass den Rest weg.', shots: [['stock', 'Bestand nach Orten mit Mengen und Filtern'], ['labels', 'QR-Etiketten für Produkte und Reste']], flip: true, points: [
        ['list', '„Nur was ausgeht“', 'Ein Startmodus für alle ohne Lust auf Inventur. Später lässt sich auf alles umstellen, ohne etwas zu verlieren.'],
        ['gauge', 'Halb voll ist eine Antwort', 'Obst und Brot sind voll, halb, wenig oder leer. Packungen werden gezählt, manches gar nicht.'],
        ['qr', 'Etiketten für Reste', 'Eine Dose Reste ist in zwei Tipps verstaut, mit Datum, Kurzcode und QR-Etikett. Scannen öffnet essen, auftauen, wegwerfen oder einplanen.'],
        ['pin', 'Wo ist was?', 'Jedes Ding kann einen genauen Platz haben. Tipp „Pflaster“ ein, und du weißt, welches Fach.'],
        ['barcode', 'Barcode scannen', 'Produktname und Foto kommen aus Open Food Facts.'],
      ] },
      { id: 'bons', label: 'Bons & Ausgaben', h2: 'Der Bon räumt mit ein.', intro: 'Digitale Bons und Bestellungen bringen den Vorrat auf Stand. Abtippen ist der Notnagel, nicht der Plan.', shots: [['receipts', 'Importe: Bons als PDF, Foto, QR-Link oder Text, darunter der Verlauf'], ['spending', 'Ausgaben im Monat, aus den Bons berechnet']], points: [
        ['receipt', 'Bons aus vielen Läden', 'eBons und Abholscheine von REWE, Bons von Lidl, Aldi, Edeka, Netto, Kaufland, Penny, dm, Rossmann und anderen. Als PDF, Foto, QR-Code oder über ein eigenes Bon-Postfach.'],
        ['sparkle', 'Lernt aus Korrekturen', 'Korrigierst du einmal, wofür eine Bon-Abkürzung steht, gilt das beim nächsten Bon aus diesem Laden. Die Regeln kannst du ansehen und löschen.'],
        ['check', 'Prüfen statt raten', 'Jeder Import geht über eine kurze Prüfliste: Ersatzartikel, Fehlendes, neue Produkte.'],
        ['chart', 'Ausgaben ohne Haushaltsbuch', 'Summen nach Woche, Monat oder Jahr, nach Laden und Kategorie, direkt aus den Bons. Dazu Budgets und CSV-Export.'],
      ] },
      { id: 'gemeinsam', label: 'Mitbewohner, Familie, Gäste', h2: 'Für alle, die hier wohnen. Und für die, die nur zu Besuch sind.', intro: 'Jede Person hat ein eigenes Konto und ihr Gesicht in der App. Gäste sehen nur, was ihr freigebt.', shots: [['members', 'Mitglieder des Haushalts mit Familie, Kindern und festen Gästen']], flip: true, points: [
        ['mail', 'Einladen per Mail oder Link', 'Wer dazukommt, bekommt einen persönlichen Link, per E-Mail oder als QR-Code. Angemeldet wird mit Passkey, Passwort oder E-Mail-Link. Der Link gilt einmal und sieben Tage lang.'],
        ['key', 'Feste Gäste mit Stufen', 'Die Tante, der Babysitter oder die Freundin aus der WG sehen so viel, wie ihr wollt: nur Verwöhnen, auch den Vorrat, auch Rezepte oder den ganzen Alltag. Einstellungen und Ausgaben bleiben bei euch.'],
        ['user', 'Gäste mit Namen', 'Wer über einen Gäste-Link etwas möchte, trägt einmal den Namen ein. Das Handy merkt ihn sich.'],
        ['child', 'Kinder ohne Login', 'In Familien wird ein Tablet zum Kinderbildschirm: sich etwas wünschen, nachsehen, wo etwas ist. Jeder Wunsch wartet auf ein Elternteil.'],
        ['mic', 'Babysitter-Link', 'Ein Link zeigt, wo was ist, mit deiner Notiz obendrauf. Mit Home Assistant gehen auch ausgewählte Sprachbefehle. Schlösser, Alarm und Kameras sind nie dabei.'],
      ] },
      { id: 'unterwegs', label: 'Unterwegs', h2: 'Urlaub ohne vergessenen Joghurt.', intro: 'Sag ToHuus, wann ihr weg seid. Den Rest plant es um die Reise herum.', shots: [['away', 'Urlaubsmodus mit Reise, Aufbrauchen und Packliste']], points: [
        ['pot', 'Vorher aufbrauchen', 'In den Tagen davor kommen Gerichte, die aufbrauchen, was sonst schlecht wird. Nichts Frisches landet mehr auf der Liste.'],
        ['suitcase', 'Packliste', 'Was aus dem Vorrat mitkommt, wird ausgebucht und nach der Reise wieder eingebucht.'],
        ['moonstar', 'Ruhe unterwegs', 'Während ihr weg seid, kommen nur dringende Hinweise, und automatische Einkaufsvorschläge machen Pause.'],
        ['door', 'Ankommen', 'Die Willkommensliste steht, bevor ihr die Tür aufschließt. Dazu ein Blick darauf, was inzwischen abgelaufen ist.'],
      ] },
      { id: 'home-assistant', label: 'Smart Home', h2: 'Home Assistant, in beide Richtungen.', intro: 'Wenn ihr schon Automationen habt, macht ToHuus mit, statt sie zu ersetzen.', shots: [['ha-dashboard', 'Einstellungen, Bereich Home Assistant']], flip: true, points: [
        ['package', 'Über HACS installiert', 'Eine eigene Integration mit fertigen Dashboards, unter MIT-Lizenz.'],
        ['refresh', 'Zwei Richtungen, pro Thema', 'Einkaufsliste als To-do-Liste für Assist, Wochenplan und Pflege als Kalender, Sensoren für heute Abend und Knappes. Pro Thema legst du fest, ob ToHuus mit einer Liste oder einem Kalender abgleicht, den ihr in Home Assistant schon habt.'],
        ['tv', 'Küchen-Display', 'Ein altes Tablet oder der Fernseher zeigt den Tag, auch dunkel. Für E-Ink-Rahmen gibt es ein fertiges Bild.'],
      ] },
    ],
    everywhere: {
      label: 'Überall dabei', h2: 'Telegram, Kurzbefehl, KI-Assistent.', p: 'Dinge landen dort, wo ihr ohnehin schon tippt oder sprecht.',
      ai: ['KI-Assistenten über MCP', 'Claude, ChatGPT und andere Assistenten verbinden sich direkt mit eurem Haushalt. Ein Foto vom Bon reicht.', 'bon.jpg', 'Trag das bitte in ToHuus ein.', 'Erledigt. Die Artikel warten in deiner Prüfliste.'],
      tg: ['Telegram und Co.', 'Schreib „2 Milch, Brot“ in den Chat, und es steht auf der Liste. Hinweise kommen auch per Push, Gotify, Matrix, ntfy oder E-Mail.'],
      mail: ['E-Mails im ToHuus-Look', 'Einladungen, Anmeldelinks und die tägliche Übersicht kommen als ruhige Mail mit Textfassung, hell und dunkel lesbar.'],
      sc: ['Kurzbefehl und Teilen', 'Ein iPhone-Kurzbefehl setzt Dinge auf die Liste. Auf Android und am Rechner taucht ToHuus im Teilen-Menü auf, für Rezepte, Listen und Bons.'],
    },
    host: {
      label: 'Privatsphäre & Selbst hosten', h2: 'Bleibt bei euch.',
      p: 'Ein Docker-Container, eine SQLite-Datei. Kein Konto bei uns, kein Tracking, nichts telefoniert nach Hause. Alles, was mit der Außenwelt spricht, ist optional.',
      facts: [
        ['server', 'Läuft fast überall', 'Docker auf einem NAS oder einem kleinen VPS.'],
        ['db', 'Eure Daten', 'Eine SQLite-Datei, Export als JSON, nächtliche Backups, auf Wunsch nach WebDAV oder Nextcloud. Vor jeder Datenbank-Migration läuft ein Backup.'],
        ['lock', 'Anmelden', 'Passkeys, Passwort mit zweitem Faktor, E-Mail-Link, OpenID Connect und eine PIN am geteilten Tablet.'],
        ['camera', 'Fotos lesen', 'Optional, mit einem Modell deiner Wahl über eine OpenAI-kompatible Schnittstelle. Auch lokal, zum Beispiel mit Ollama.'],
        ['globe', 'Sprachen und Regionen', 'Deutsch, Englisch und Schwedisch. Die Region legt Währung, Datumsformat und die erwarteten Bons fest.'],
        ['sun', 'Hell und dunkel', 'Der Haushalt wählt hell, dunkel oder wie das Gerät. Auf Wunsch entscheidet jede Person selbst.'],
      ],
      licenceH: 'Lizenzen',
      licence: 'Die App steht unter der <a href="' + GH + '/blob/main/LICENSE">AGPL-3.0</a>, die Home-Assistant-Integration unter <a href="' + GH + '/blob/main/ha-integration/LICENSE">MIT</a>. Keine Firma dahinter, kein Abo.',
      installH: 'Installation', steps: [
        ['Holen und einstellen', 'In <code>.env</code> trägst du <code>BASE_URL</code>, deinen Namen und ein Passwort ein. Alle weiteren Optionen stehen kommentiert in <code>.env.example</code>.'],
        ['Starten', 'Mit <code>docker compose up -d --build</code>, dann <code>http://localhost:8080</code> öffnen. Die Daten liegen in <code>./data</code>.'],
        ['Leer oder mit Demo', 'Beim ersten Start wählst du, ob du leer anfängst oder dich erst mit Demo-Daten umsiehst. Die sind später mit einem Tipp wieder weg.'],
        ['HTTPS davor', 'Dein üblicher Reverse Proxy reicht. Passkeys und das Teilen-Menü brauchen HTTPS. Danach die App auf den Homescreen legen.'],
      ],
      envComment: '# en, de oder sv',
    },
    tour: { label: 'Tour', h2: 'Erst mal umsehen? Mit Demo-Daten.', p: 'Die Tour führt dich direkt auf den echten Seiten durch die wichtigsten Stellen. Danach sind die Demo-Daten mit einem Tipp wieder weg.', a: 'Installieren', b: 'Auf GitHub ansehen', shot: 'Die Tour erklärt die Einkaufsliste direkt auf der echten Seite' },
    story: {
      word: 'To Huus', wordSub: 'Plattdeutsch für „zu Hause“. Gesprochen an Nord- und Ostsee.',
      ps: [
        'Angefangen hat ToHuus in einem ganz normalen Familienalltag. Eine Person wusste, wo alles liegt und was zur Neige geht, die andere hat gefragt. Die eine Regel beim Bauen: Es muss an einem müden Dienstag funktionieren.',
        'Gebaut ist es für jedes Zuhause, für die Einzimmerwohnung ohne Gefrierfach genauso wie für die WG, in der jede Person ihr eigenes Fach im Kühlschrank hat.',
        'Es ist kostenlos und quelloffen. Issues und Pull Requests sind willkommen, Übersetzungen auch.',
      ],
      sig: 'Till & Lea',
    },
    foot: {
      about: 'Open-Source-App für jedes Zuhause, von einer Familie gebaut, mit viel Hilfe von Claude.',
      project: 'Projekt', legal: 'Rechtliches', code: 'Quellcode auf GitHub', license: 'Lizenz App: AGPL-3.0', licenseHa: 'Lizenz HA-Integration: MIT', issues: 'Fehler melden',
      imprint: 'Impressum', privacy: 'Datenschutz', otherLang: 'English version',
      fine: 'Diese Website setzt keine Cookies, trackt nicht und lädt nichts von Dritten. Schriften: Familjen Grotesk und Hedvig Letters (SIL Open Font License), lokal ausgeliefert. Icons: Phosphor (MIT). Rezeptfoto: Max Griss auf Unsplash. Produktdaten und -bilder in der App stammen teilweise von Open Food Facts (ODbL / CC BY-SA). ToHuus Hub steht in keiner Verbindung zu REWE, Vorwerk/Thermomix, Cookidoo, Telegram, Apple oder den genannten Apps und Läden. Die Namen beschreiben nur kompatible Formate und Dienste.',
    },
  },
  en: {
    lang: 'en', locale: 'en_GB', alt: 'de_DE', url: SITE, base: '', other: 'de/', otherLang: 'de',
    title: 'ToHuus Hub · Less on your mind. More at home.',
    desc: 'Free, open-source app for every kind of home, on your own server: shared shopping list, stock, recipes and meal plan, treats for everyday life, guests and parties, receipts and spending, Home Assistant and AI assistants. For a flat, a flat share, a terraced house or a house.',
    ogAlt: 'The ToHuus mark, the line “Less on your mind. More at home.” and four drawn homes: a flat, a flat share, a terraced house and a house.',
    skip: 'Skip to content', navLabel: 'Main', railLabel: 'Quick navigation',
    ids: { home: 'home', treats: 'treats', install: 'install', host: 'self-hosting', tour: 'tour' },
    nav: [['#home', 'Home'], ['#everyday', 'Everyday'], ['#treats', 'Treats'], ['#cooking', 'Cooking'], ['#stock', 'Stock'], ['#self-hosting', 'Self-hosting']],
    rail: [['#everyday', 'Everyday', 'home'], ['#treats', 'Treats', 'gift'], ['#install', 'Install', 'download'], ['#cooking', 'Cooking', 'pot'], ['#tour', 'Tour', 'play']],
    themeLabel: 'Dark theme', homeLabel: 'ToHuus Hub home', langLabel: 'Language',
    copy: 'Copy', copied: 'Copied',
    hero: {
      label: 'Open source · on your server',
      h1: 'Less on your mind.<br><span class="hl">More at home.</span>',
      lede: 'Flat, flat share, terraced house or house: ToHuus brings shopping, supplies and recipes together.',
      cta: 'Install it', code: 'Read the code', tour: 'Take the tour',
      facts: ['Free, AGPL-3.0', 'No account, no tracking', 'Runs on a NAS or small server'],
      tiles: { flat: 'Flat', shared: 'Flat share', terraced: 'Terraced house', house: 'House' },
      tilesLabel: 'Four drawn homes: a flat in an apartment block, a flat share in an old building with three doorbells, terraced houses with a cat on the roof and a detached house with a tree.',
    },
    worries: {
      label: 'Mental load', h2: 'The questions one person usually carries around.',
      p: 'Usually one person knows what is missing, what needs eating and where the parcel tape lives. In families, in couples and in flat shares alike. ToHuus takes that part over, so you can share it, or stop thinking about it altogether.',
      bonTitle: 'On your mind', bonFoot: 'Now in ToHuus',
      list: ['Do we still have milk?', 'What are we eating tonight?', 'Who is getting that?', 'Where is the parcel tape?', 'Is the yoghurt still good?', 'Did you already buy it?', 'What do we need for Saturday?', 'When was the water filter due?'],
    },
    home: {
      label: 'Home, not house', h2: 'For every kind of home, as it really is.',
      intro: 'On first start ToHuus asks who lives with you. That only shapes suggestions. Nothing is locked, and you can switch any time.',
      forms: [['c', 'Just me', 'No votes and no “who is getting it”, just your lists.'], ['h', 'The two of us', 'Shared lists and votes for dinner, no kids section.'], ['s', 'Family', 'Everything, including kids and guests.'], ['t', 'Flat share', 'Shared and personal places, no family wording.']],
      placesH: 'Only the places you really have.',
      placesP: 'ToHuus does not assume a fridge, a cellar or a chest freezer. You name your places yourselves, nest, sort and archive them. Anything without a place shows up under “not assigned to a place yet”. That is fine too.',
      chips: ['Kitchenette', 'Shared fridge', 'Jonas’ shelf', 'Hallway shelf', 'Chest freezer in the cellar'], chipNone: 'Not assigned to a place yet',
      shots: [['home', 'Settings, household section: choose just me, the two of us, family or flat share'], ['places', 'Settings, places section: self-named places with the number of things in each']],
    },
    everyday: { id: 'everyday', label: 'Everyday', h2: 'One look in the morning is enough.', intro: '“Today” shows on one page what comes first, and exactly one next step. The shopping list is current on every phone at once.', shots: [['today', 'Today page with the green header block and the Today first ticket'], ['shopping', 'Shopping list with groups, I’ll-get-it buttons and the add field']], points: [
      ['home', 'Today first', 'At most four lines from your real data: what needs eating, what has run out, what is on the list. No dashboard tiles.'],
      ['hand', 'Shopping list with “I’ll get it”', 'Whoever takes something taps it, so nobody buys it twice. In the shop the list sorts itself by aisle, even without signal.'],
      ['store', '“Where to buy?”', 'On a product you set where you get it, say the chemist or the weekly market. The list shows it right next to the item. The app never fills this in by itself.'],
      ['eyeoff', 'Discreet items', 'Others see private items only as a neutral placeholder, or not at all. Saturday’s present stays a surprise.'],
      ['check', 'Ticked means put away', 'What you tick off in the shop goes straight into stock, if you have it set up that way.'],
    ] },
    treats: {
      label: 'Treats', h2: 'Do each other a good turn.',
      story: [
        'It is half past seven and Lea is putting Mila to bed. Tonight it takes a while. Between two pages of the bedtime story she taps “Something sweet”, then vanilla ice cream.',
        'Till’s phone buzzes: “Lea asks you for something”. One tap on “I’ll bring it”. By the time she comes out of the kids’ room the ice cream is waiting, spoon included. The evening feels a little shorter after that.',
      ],
      after: 'That is what Treats is for. Whoever is stuck, with bedtime, ill in bed or after a long day, asks for a small something from what is in the house. Someone else brings it.',
      ticketH: 'How a wish travels',
      steps: [
        ['Lea asks for something', 'Something sweet, something to drink, a snack or a free-text wish. Plus a note like “with a spoon, please”.'],
        ['The message goes out', 'If Lea asked one person, only their phone buzzes. Otherwise everyone who can right now hears about it.'],
        ['“I’ll bring it” or “Can’t right now”', 'One tap in the notification, with a short reason like “In a few minutes” if needed.'],
      ],
      thanks: 'Then a small thank you. Once, only to the person who brought it. No points, no tally of who did what.',
      shot: ['order', 'Treats page: What would you like?, below it a wish from Lea with I’ll bring it and Can’t right now'],
      modesH: 'The same for visitors and parties',
      modes: [
        ['For you', 'For everyone who lives here. If you live alone, this part simply does not show up.'],
        ['Guests', 'Visitors, the babysitter or grandparents get a link or QR code and ask for something from what is in the house. With their name, so it is clear whose coffee it is.'],
        ['Party', 'The TV shows a QR code to join and what is ready. The kitchen gets its own view, and the party ends by itself.'],
      ],
      menu: 'You decide what is on the menu: things from stock, or menu-only items like tap water or a cappuccino.',
    },
    chapters: [
      { id: 'cooking', label: 'Cooking', h2: 'What are we eating tonight? Decided in a minute.', intro: 'ToHuus suggests what fits what you have and plans the week with you. Anyone who wants to can vote.', shots: [['cook', 'What do we eat today page with suggestions from stock'], ['plan-vote', 'A vote on recipes for the weekend']], flip: true, points: [
        ['pot', 'What works right now?', 'What you can cook now, what lacks just one thing and what needs using up. Or one tap on “You decide for us”.'],
        ['calendar', 'Week plan', 'Free evenings fill up with fitting recipes, rotating over several weeks if you like. Whatever the week is missing goes on the list in one tap.'],
        ['heart', 'Vote together', 'Everyone says no, yes or super on their own phone, or one phone goes round the table. No ranking, no debate at the stove.'],
        ['scale', 'Servings per evening', 'Bolognese for six instead of four? The amount applies to that evening, to the shopping and to what comes out of stock after cooking. The recipe stays as it is.'],
      ] },
      { id: 'recipes', label: 'Recipes', h2: 'Your version, not the internet’s.', intro: 'Recipes come from wherever you already keep them. Then you cook them the way your household does.', shots: [['recipe', 'Recipe page with photo, ratings and the cooked button']], arch: { alt: 'Gnocchi with tomato and mozzarella in a pan', stamp: 'House<br>version' }, points: [
        ['download', 'From other apps', 'Any recipe page with structured data, plus Mealie, Tandoor, Paprika, Nextcloud Cookbook, KitchenOwl, Grocy and CSV. With a vision model, photos and plain text too.'],
        ['translate', 'Units that fit', 'Cups, ounces and pounds become grams and millilitres if you cook metric. German and Swedish households get the ingredient lines translated, without any translation service.'],
        ['robot', 'With any AI', 'A ready-made prompt to copy: put a photo or a cookbook page into the chat, paste the answer back into ToHuus.'],
        ['refresh', 'Cookidoo via Home Assistant', 'Your Cookidoo week comes in through Home Assistant. Thermomix steps keep time, temperature and speed.'],
        ['swap', 'The house version', 'Rice instead of potatoes, no coriander, oat milk instead of milk. Set it once and it applies to suggestions, cooking and the shopping list. The original stays untouched.'],
        ['zoom', 'Photos you can zoom into', 'One tap opens a photo full screen, and then you can zoom in.'],
        ['smile', 'Who liked it?', 'Everyone rates recipes and keeps favourites. Dislikes and allergies feed into suggestions, and a dish with an allergen is never planned automatically.'],
      ] },
      { id: 'stock', label: 'Stock', h2: 'Stock without a spreadsheet.', intro: 'Nobody has to count pasta. Start with what runs out and leave the rest.', shots: [['stock', 'Stock by place with amounts and filters'], ['labels', 'QR labels for products and leftovers']], flip: true, points: [
        ['list', '“Only what runs out”', 'A start mode for anyone who does not want an inventory. Switch to everything later without losing anything.'],
        ['gauge', 'Half full is an answer', 'Fruit and bread are full, half, low or empty. Packs get counted, some things not at all.'],
        ['qr', 'Labels for leftovers', 'A box of leftovers is put away in two taps, with a date, a short code and a QR label. Scanning it opens eat, thaw, throw away or plan.'],
        ['pin', 'Where is what?', 'Every item can have an exact spot. Type “plasters” and you know which shelf.'],
        ['barcode', 'Scan a barcode', 'Product name and photo come from Open Food Facts.'],
      ] },
      { id: 'receipts', label: 'Receipts & spending', h2: 'The receipt puts things away.', intro: 'Digital receipts and orders bring your stock up to date. Typing is the fallback, not the plan.', shots: [['receipts', 'Imports: receipts as PDF, photo, QR link or text, with the history below'], ['spending', 'Monthly spending, worked out from the receipts']], points: [
        ['receipt', 'Receipts from many shops', 'German eBons and pickup notes, receipts from Lidl, Aldi, dm and others, plus UK, US and Swedish formats. As PDF, photo, QR code or through your own receipt inbox.'],
        ['sparkle', 'Learns from corrections', 'Fix once what a receipt abbreviation stands for, and it applies to the next receipt from that shop. You can see the rules and delete them.'],
        ['check', 'Check, don’t guess', 'Every import goes through a short review: substitutions, missing items, new products.'],
        ['chart', 'Spending without a ledger', 'Totals per week, month or year, by shop and category, straight from the receipts. Budgets and CSV export too.'],
      ] },
      { id: 'together', label: 'Flatmates, family, guests', h2: 'For everyone who lives here. And for the ones just visiting.', intro: 'Everyone has their own account and their face in the app. Guests only see what you share.', shots: [['members', 'Household members with family, children and permanent guests']], flip: true, points: [
        ['mail', 'Invite by e-mail or link', 'Whoever joins gets a personal link, by e-mail or as a QR code. They sign in with a passkey, a password or an e-mail link. The link works once and for seven days.'],
        ['key', 'Permanent guests with levels', 'The aunt, the babysitter or a flatmate’s partner see as much as you want: treats only, stock too, recipes too, or the whole day to day. Settings and spending stay with you.'],
        ['user', 'Guests with names', 'Anyone asking for something through a guest link types their name once. The phone remembers it.'],
        ['child', 'Kids without a login', 'In families a tablet becomes a kids’ screen: wish for something, look up where things are. Every wish waits for a parent.'],
        ['mic', 'Babysitter link', 'A link shows where things are, with your note on top. With Home Assistant, selected voice commands work too. Locks, alarms and cameras are never on the list.'],
      ] },
      { id: 'away', label: 'Away', h2: 'Holidays without forgotten yoghurt.', intro: 'Tell ToHuus when you are away. It plans the rest around the trip.', shots: [['away', 'Away mode with the trip, use-up days and packing list']], points: [
        ['pot', 'Use it up before', 'In the days before, suggestions use up what would otherwise go off. Nothing fresh goes on the list.'],
        ['suitcase', 'Packing list', 'What comes along from stock is booked out, and back in after the trip.'],
        ['moonstar', 'Quiet while away', 'While you are gone, only urgent notifications come through and automatic shopping suggestions pause.'],
        ['door', 'Coming home', 'The welcome list is ready before you unlock the door, along with a look at what expired in the meantime.'],
      ] },
      { id: 'home-assistant', label: 'Smart home', h2: 'Home Assistant, both ways.', intro: 'If you already have automations, ToHuus joins in instead of replacing them.', shots: [['ha-dashboard', 'Settings, Home Assistant section']], flip: true, points: [
        ['package', 'Installed via HACS', 'A dedicated integration with ready-made dashboards, MIT licensed.'],
        ['refresh', 'Two ways, per topic', 'Shopping list as a to-do list for Assist, meal plan and home care as calendars, sensors for tonight and low stock. Per topic you decide whether ToHuus syncs with a list or calendar you already have in Home Assistant.'],
        ['tv', 'Kitchen display', 'An old tablet or the TV shows the day, dark mode included. E-ink frames get a ready-made picture.'],
      ] },
    ],
    everywhere: {
      label: 'Wherever you are', h2: 'Telegram, Shortcuts, AI assistants.', p: 'Things land where you already type or talk.',
      ai: ['AI assistants via MCP', 'Claude, ChatGPT and other assistants connect straight to your household. A photo of the receipt is enough.', 'receipt.jpg', 'Please add this to ToHuus.', 'Done. The items are waiting in your review list.'],
      tg: ['Telegram and friends', 'Write “2 milk, bread” in the chat and it is on the list. Notifications also come by push, Gotify, Matrix, ntfy or e-mail.'],
      mail: ['E-mail in the ToHuus look', 'Invitations, sign-in links and the daily digest arrive as calm e-mails with a plain-text version, readable in light and dark.'],
      sc: ['Shortcuts and sharing', 'An iPhone Shortcut adds things to the list. On Android and desktop ToHuus shows up in the share menu, for recipes, lists and receipts.'],
    },
    host: {
      label: 'Privacy & self-hosting', h2: 'It stays with you.',
      p: 'One Docker container, one SQLite file. No account with us, no tracking, nothing phones home. Everything that talks to the outside world is optional.',
      facts: [
        ['server', 'Runs almost anywhere', 'Docker on a NAS or a small VPS.'],
        ['db', 'Your data', 'One SQLite file, JSON export, nightly backups, optionally to WebDAV or Nextcloud. A backup runs before every database migration.'],
        ['lock', 'Sign-in', 'Passkeys, password with a second factor, e-mail link, OpenID Connect and a PIN on the shared tablet.'],
        ['camera', 'Reading photos', 'Optional, with a model of your choice through an OpenAI-compatible API. Locally too, for example with Ollama.'],
        ['globe', 'Languages and regions', 'English, German and Swedish. The region sets currency, date format and which receipts to expect.'],
        ['sun', 'Light and dark', 'The household picks light, dark or like the device. If you like, everyone decides for themselves.'],
      ],
      licenceH: 'Licences',
      licence: 'The app is licensed under the <a href="' + GH + '/blob/main/LICENSE">AGPL-3.0</a>, the Home Assistant integration under <a href="' + GH + '/blob/main/ha-integration/LICENSE">MIT</a>. No company behind it, no subscription.',
      installH: 'Install', steps: [
        ['Get it and set it up', 'In <code>.env</code> you fill in <code>BASE_URL</code>, your name and a password. Every other option is listed with comments in <code>.env.example</code>.'],
        ['Start it', 'Run <code>docker compose up -d --build</code>, then open <code>http://localhost:8080</code>. Your data lives in <code>./data</code>.'],
        ['Empty or demo', 'On first start you choose to begin empty or to look around with demo data first. One tap removes it later.'],
        ['Put HTTPS in front', 'Your usual reverse proxy is enough. Passkeys and the share menu need HTTPS. Then add the app to your home screen.'],
      ],
      envComment: '# en, de or sv',
    },
    tour: { label: 'Tour', h2: 'Want to look around first? Use the demo data.', p: 'The tour walks you through the important places, right on the real pages. Afterwards the demo data is gone with one tap.', a: 'Install it', b: 'View on GitHub', shot: 'The tour explains the shopping list on the real page' },
    story: {
      word: 'To Huus', wordSub: 'Low German for “at home”. Spoken along the North Sea and the Baltic.',
      ps: [
        'ToHuus started in an ordinary family routine. One person knew where everything was and what was running out, the other one asked. The one rule while building it: it has to work on a tired Tuesday.',
        'It is built for every kind of home, the studio flat without a freezer just as much as the flat share where everyone has their own shelf in the fridge.',
        'It is free and open source. Issues and pull requests are welcome, and so are translations.',
      ],
      sig: 'Till & Lea',
    },
    foot: {
      about: 'Open-source app for every kind of home, built by a family with a lot of help from Claude.',
      project: 'Project', legal: 'Legal', code: 'Source code on GitHub', license: 'App licence: AGPL-3.0', licenseHa: 'HA integration licence: MIT', issues: 'Report a bug',
      imprint: 'Imprint', privacy: 'Privacy', otherLang: 'Deutsche Version',
      fine: 'This website sets no cookies, does not track you and loads nothing from third parties. Fonts: Familjen Grotesk and Hedvig Letters (SIL Open Font License), served locally. Icons: Phosphor (MIT). Recipe photo: Max Griss on Unsplash. Product data and images in the app come partly from Open Food Facts (ODbL / CC BY-SA). ToHuus Hub is not affiliated with REWE, Vorwerk/Thermomix, Cookidoo, Telegram, Apple or the apps and shops named here. The names only describe compatible formats and services.',
    },
  },
};

// ---------------------------------------------------------------- screenshots
/** Every screenshot slot the page uses. The build fails when a file is missing, so no placeholder ever ships. */
const SHOTS = ['today', 'shopping', 'order', 'cook', 'plan-vote', 'recipe', 'stock', 'labels', 'receipts', 'spending', 'members', 'away', 'ha-dashboard', 'tour', 'home', 'places'];
/** Not on the page, but README.md shows it. */
const README_SHOTS = ['people'];
for (const lang of Object.keys(COPY)) for (const n of [...SHOTS, ...README_SHOTS]) for (const m of ['light', 'dark']) {
  const f = path.join(ROOT, `assets/shots/${lang}/${n}-${m}.webp`);
  if (!fs.existsSync(f)) throw new Error(`missing screenshot ${path.relative(ROOT, f)}`);
}

// ---------------------------------------------------------------- building blocks
const phone = (c, [name, alt], cls = '') => {
  if (!SHOTS.includes(name)) throw new Error(`screenshot slot ${name} is not in SHOTS`);
  return `<figure class="phone${cls}">
          <div class="screen">
            <img class="light-only" src="${c.base}assets/shots/${c.lang}/${name}-light.webp" alt="${alt}" loading="lazy" decoding="async" width="390" height="844">
            <img class="dark-only" src="${c.base}assets/shots/${c.lang}/${name}-dark.webp" alt="" loading="lazy" decoding="async" width="390" height="844">
          </div>
        </figure>`;
};

const head = (no, label) => `<div class="ch-head reveal"><span class="ch-no">${String(no).padStart(2, '0')}</span><span class="label">${label}</span></div>`;

const points = (list) => `<ul class="points">
${list.map(([icon, b, s], k) => `          <li class="reveal" style="--d:${60 + k * 40}ms"><span class="pi">${ico(icon)}</span><div><b>${b}</b><span>${s}</span></div></li>`).join('\n')}
        </ul>`;

const archPhoto = (c, a) => `<figure class="arch-card">
          <div class="arch"><img src="${c.base}assets/img/recipe-gnocchi.webp" alt="${a.alt}" loading="lazy" decoding="async" width="560" height="659"></div>
          <span class="stamp" aria-hidden="true">${a.stamp}</span>
        </figure>`;

const chapter = (c, ch, no) => `
<section class="chapter${ch.flip ? ' flip' : ''}" id="${ch.id}" aria-labelledby="${ch.id}-h">
  <div class="wrap">
    ${head(no, ch.label)}
    <div class="ch-grid">
      <div class="ch-copy">
        <h2 class="reveal" id="${ch.id}-h">${ch.h2}</h2>
        <p class="intro reveal">${ch.intro}</p>
        ${points(ch.points)}
      </div>
      <div class="ch-visual reveal${ch.shots.length > 1 ? ' two' : ''}${ch.arch ? ' with-arch' : ''}">
        ${ch.arch ? archPhoto(c, ch.arch) : ''}
        ${ch.shots.map((s) => phone(c, s)).join('\n        ')}
      </div>
    </div>
  </div>
</section>`;

const treats = (c, no) => {
  const v = c.treats;
  return `
<section class="treats" id="${c.ids.treats}" aria-labelledby="treats-h">
  <div class="wrap">
    ${head(no, v.label)}
    <div class="treats-block">
      <span class="disc" aria-hidden="true"></span><span class="half" aria-hidden="true"></span>
      <div class="treats-copy">
        <h2 class="reveal" id="treats-h">${v.h2}</h2>
        <div class="tale reveal">
${v.story.map((p) => `          <p>${p}</p>`).join('\n')}
        </div>
        <p class="after reveal">${v.after}</p>
      </div>
      <div class="treats-phone reveal">${phone(c, v.shot)}</div>
    </div>
    <div class="treats-grid">
      <div class="ticket wish reveal">
        <div class="ticket-top">
          <p class="label">${v.ticketH}</p>
          <ol class="wish-steps">
${v.steps.map(([t, s]) => `            <li><b>${t}</b><span>${s}</span></li>`).join('\n')}
          </ol>
        </div>
        <div class="tear" aria-hidden="true"></div>
        <p class="thanks">${ico('heart')}<span>${v.thanks}</span></p>
      </div>
      <div class="modes">
        <h3 class="reveal">${v.modesH}</h3>
        <ul class="doors">
${v.modes.map(([t, s], k) => `          <li class="door d${k + 1} reveal" style="--d:${k * 60}ms"><b>${t}</b><span>${s}</span></li>`).join('\n')}
        </ul>
        <p class="menu-note reveal">${v.menu}</p>
      </div>
    </div>
  </div>
</section>`;
};

function page(c) {
  const b = c.base;
  const h = c.host;
  const e = c.everywhere;
  const hm = c.home;
  const id = c.ids;
  let no = 0;
  const n = () => ++no;
  return `<!doctype html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${c.title}</title>
<meta name="description" content="${c.desc}">
<link rel="canonical" href="${c.url}">
<link rel="alternate" hreflang="en" href="${SITE}">
<link rel="alternate" hreflang="de" href="${SITE}de/">
<link rel="alternate" hreflang="x-default" href="${SITE}">
<meta name="theme-color" content="#f7f5ef" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1513" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ToHuus Hub">
<meta property="og:title" content="${c.title}">
<meta property="og:description" content="${c.desc}">
<meta property="og:url" content="${c.url}">
<meta property="og:image" content="${SITE}assets/img/og-${c.lang}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${c.ogAlt}">
<meta property="og:locale" content="${c.locale}">
<meta property="og:locale:alternate" content="${c.alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${c.title}">
<meta name="twitter:description" content="${c.desc}">
<meta name="twitter:image" content="${SITE}assets/img/og-${c.lang}.png">
<link rel="icon" href="${b}assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${b}assets/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="${b}assets/apple-touch-icon.png">
<link rel="preload" href="${b}assets/fonts/familjen-grotesk-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${b}assets/fonts/hedvig-letters-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${b}assets/site.css">
<script>(function(){var d=document.documentElement;d.classList.add('js');var t=null;try{t=localStorage.getItem('tohuus.site.theme')}catch(e){}if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.setAttribute('data-theme',t)})()</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"ToHuus Hub","description":"${c.desc}","applicationCategory":"LifestyleApplication","operatingSystem":"Docker, Linux","license":"https://www.gnu.org/licenses/agpl-3.0.html","isAccessibleForFree":true,"url":"${c.url}","image":"${SITE}assets/img/og-${c.lang}.png","codeRepository":"${GH}","inLanguage":["en","de"],"author":{"@type":"Person","name":"Till Heidrich","url":"https://github.com/tillheidrich"}}
</script>
</head>
<body>
${sprite}
<a class="skip" href="#main">${c.skip}</a>

<header class="nav-wrap">
<div class="nav">
  <a class="brand" href="./" aria-label="${c.homeLabel}">${brandMark(28)}<span>ToHuus</span></a>
  <nav class="nav-links" aria-label="${c.navLabel}">
${c.nav.map(([href, l]) => `    <a href="${href}">${l}</a>`).join('\n')}
  </nav>
  <a class="nav-gh" href="${GH}">${ico('github')}<span>GitHub</span></a>
  <div class="lang" role="group" aria-label="${c.langLabel}">
    <a href="${c.lang === 'en' ? './' : '../'}" hreflang="en" lang="en"${c.lang === 'en' ? ' aria-current="true"' : ''}>EN</a>
    <a href="${c.lang === 'de' ? './' : 'de/'}" hreflang="de" lang="de"${c.lang === 'de' ? ' aria-current="true"' : ''}>DE</a>
  </div>
  <button class="icon-btn theme-btn" type="button" aria-label="${c.themeLabel}" aria-pressed="false">${ico('moon', 'ico moon')}${ico('sun', 'ico sun')}</button>
</div>
</header>

<main id="main">

<section class="hero" aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <p class="label">${c.hero.label}</p>
      <h1 id="hero-h">${c.hero.h1}</h1>
      <p class="lede">${c.hero.lede}</p>
      <div class="ctas">
        <a class="btn primary" href="#${id.install}">${c.hero.cta}<span class="tail">${ico('download')}</span></a>
        <a class="btn" href="${GH}">${ico('github')}${c.hero.code}</a>
        <a class="link-play" href="#${id.tour}">${ico('play')}${c.hero.tour}</a>
      </div>
      <ul class="facts">${c.hero.facts.map((f) => `<li>${f}</li>`).join('')}</ul>
    </div>
    <div class="hero-art">
    ${homeTiles(c.hero.tiles, c.hero.tilesLabel)}
    </div>
  </div>
</section>

<section class="worries" aria-labelledby="worries-h">
  <div class="wrap worries-grid">
    <div>
      <p class="label reveal">${c.worries.label}</p>
      <h2 class="reveal" id="worries-h">${c.worries.h2}</h2>
      <p class="intro reveal">${c.worries.p}</p>
    </div>
    <div class="receipt reveal" aria-label="${c.worries.bonTitle}">
      <div class="receipt-h"><b>${c.worries.bonTitle}</b><span aria-hidden="true">ToHuus</span></div>
      <ul>
${c.worries.list.map((q) => `        <li><s>${q}</s>${ico('check', 'ico ok')}</li>`).join('\n')}
      </ul>
      <p class="receipt-f">${c.worries.bonFoot}</p>
    </div>
  </div>
</section>

<section class="chapter" id="${id.home}" aria-labelledby="home-h">
  <div class="wrap">
    ${head(n(), hm.label)}
    <div class="ch-grid">
      <div class="ch-copy">
        <h2 class="reveal" id="home-h">${hm.h2}</h2>
        <p class="intro reveal">${hm.intro}</p>
        <ul class="forms">
${hm.forms.map(([shape, t, s], k) => `          <li class="reveal" style="--d:${60 + k * 50}ms"><span class="shape ${shape}" aria-hidden="true"></span><b>${t}</b><span>${s}</span></li>`).join('\n')}
        </ul>
        <h3 class="reveal">${hm.placesH}</h3>
        <p class="reveal">${hm.placesP}</p>
        <ul class="chips reveal">${hm.chips.map((x) => `<li>${x}</li>`).join('')}<li class="none">${hm.chipNone}</li></ul>
      </div>
      <div class="ch-visual two reveal">
        ${hm.shots.map((s) => phone(c, s)).join('\n        ')}
      </div>
    </div>
  </div>
</section>
${chapter(c, c.everyday, n())}
${treats(c, n())}
${c.chapters.map((ch) => chapter(c, ch, n())).join('\n')}

<section class="chapter everywhere" aria-labelledby="everywhere-h">
  <div class="wrap">
    ${head(n(), e.label)}
    <h2 class="reveal" id="everywhere-h">${e.h2}</h2>
    <p class="intro reveal">${e.p}</p>
    <div class="panels">
      <article class="panel big reveal">
        <span class="pi">${ico('chat')}</span>
        <h3>${e.ai[0]}</h3>
        <p>${e.ai[1]}</p>
        <div class="chat" aria-hidden="true">
          <div class="m me"><span class="file">${ico('camera')}${e.ai[2]}</span>${e.ai[3]}</div>
          <div class="m it">${e.ai[4]}</div>
        </div>
      </article>
      <article class="panel reveal"><span class="pi">${ico('send')}</span><h3>${e.tg[0]}</h3><p>${e.tg[1]}</p></article>
      <article class="panel reveal"><span class="pi">${ico('mail')}</span><h3>${e.mail[0]}</h3><p>${e.mail[1]}</p></article>
      <article class="panel reveal"><span class="pi">${ico('bolt')}</span><h3>${e.sc[0]}</h3><p>${e.sc[1]}</p></article>
    </div>
  </div>
</section>

<section class="chapter host" id="${id.host}" aria-labelledby="host-h">
  <div class="wrap">
    ${head(n(), h.label)}
    <div class="host-grid">
      <div>
        <h2 class="reveal" id="host-h">${h.h2}</h2>
        <p class="intro reveal">${h.p}</p>
        <dl class="facts-list">
${h.facts.map(([i, t, s]) => `          <div class="reveal">${ico(i)}<dt>${t}</dt><dd>${s}</dd></div>`).join('\n')}
          <div class="reveal">${ico('code')}<dt>${h.licenceH}</dt><dd>${h.licence}</dd></div>
        </dl>
      </div>
      <div class="ticket install reveal" id="${id.install}">
        <div class="ticket-top">
          <h3>${h.installH}</h3>
          <ol class="steps">
${h.steps.map(([t, s]) => `            <li><b>${t}</b><span>${s}</span></li>`).join('\n')}
          </ol>
        </div>
        <div class="tear" aria-hidden="true"></div>
        <div class="code">
          <div class="code-head"><span>${ico('terminal')}Terminal</span><button class="btn sm copy" type="button" data-copy="code-sh" data-done="${c.copied}">${ico('copy')}<span>${c.copy}</span></button></div>
<pre id="code-sh"><span class="k">git clone</span> ${GH}.git
<span class="k">cd</span> tohuus-hub
<span class="k">cp</span> .env.example .env
<span class="k">docker compose up</span> -d --build</pre>
          <div class="code-head"><span>${ico('code')}.env</span><button class="btn sm copy" type="button" data-copy="code-env" data-done="${c.copied}">${ico('copy')}<span>${c.copy}</span></button></div>
<pre id="code-env"><span class="k">BASE_URL</span>=<span class="s">https://home.example.org</span>
<span class="k">ADMIN_NAME</span>=Alex
<span class="k">ADMIN_PASSWORD</span>=change-me
<span class="k">LANGUAGE</span>=${c.lang} <span class="c">${h.envComment}</span>
<span class="k">TZ</span>=Europe/Berlin</pre>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="tour" id="${id.tour}" aria-labelledby="tour-h">
  <div class="wrap">
    <div class="block">
      <span class="disc" aria-hidden="true"></span><span class="half" aria-hidden="true"></span>
      <div class="block-copy">
        <p class="label on-block">${bird()}${c.tour.label}</p>
        <h2 id="tour-h">${c.tour.h2}</h2>
        <p>${c.tour.p}</p>
        <div class="ctas">
          <a class="btn on-block-primary" href="#${id.install}">${c.tour.a}<span class="tail">${ico('download')}</span></a>
          <a class="btn on-block-ghost" href="${GH}">${ico('github')}${c.tour.b}</a>
        </div>
      </div>
      <div class="block-phone">${phone(c, ['tour', c.tour.shot])}</div>
    </div>
  </div>
</section>

<section class="story" aria-labelledby="story-h">
  <div class="wrap story-grid">
    <p class="word reveal" id="story-h">${c.story.word}<small>${c.story.wordSub}</small></p>
    <div class="reveal">
${c.story.ps.map((p) => `      <p>${p}</p>`).join('\n')}
      <p class="sig">${c.story.sig}</p>
    </div>
  </div>
</section>

</main>

<footer class="foot">
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <a class="brand" href="./">${brandMark(26)}<span>ToHuus</span></a>
        <p>${c.foot.about}</p>
      </div>
      <div>
        <h4>${c.foot.project}</h4>
        <ul>
          <li><a href="${GH}">${c.foot.code}</a></li>
          <li><a href="${GH}/blob/main/LICENSE">${c.foot.license}</a></li>
          <li><a href="${GH}/blob/main/ha-integration/LICENSE">${c.foot.licenseHa}</a></li>
          <li><a href="${GH}/issues">${c.foot.issues}</a></li>
        </ul>
      </div>
      <div>
        <h4>${c.foot.legal}</h4>
        <ul>
          <li><a href="https://heidrich-digital.de/impressum">${c.foot.imprint}</a></li>
          <li><a href="https://heidrich-digital.de/datenschutz">${c.foot.privacy}</a></li>
          <li><a href="${c.other}" hreflang="${c.otherLang}">${c.foot.otherLang}</a></li>
        </ul>
      </div>
    </div>
    <p class="fine">${c.foot.fine}</p>
  </div>
</footer>

<nav class="rail" aria-label="${c.railLabel}">
${c.rail.map(([href, l, i], k) => `  <a href="${href}"${k === 2 ? ' class="plus"' : ''}>${ico(i)}<span>${l}</span></a>`).join('\n')}
</nav>

<script src="${b}assets/site.js" defer></script>
</body>
</html>
`;
}

// guard: no em or en dashes in the copy or the template (house style)
for (const c of Object.values(COPY)) {
  const s = JSON.stringify(c) + page(c).replace(sprite, '');
  if (s.includes('—')) throw new Error(`em dash in ${c.lang} page`);
  if (s.includes('–')) throw new Error(`en dash in ${c.lang} page`);
}
fs.writeFileSync(path.join(ROOT, 'index.html'), page(COPY.en));
fs.mkdirSync(path.join(ROOT, 'de'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'de/index.html'), page(COPY.de));
console.log('built site/index.html and site/de/index.html');

/*
 * Refreshing the screenshots (needs Playwright, e.g. the helper in /tmp/pw used during development):
 *   1. npx vite build
 *   2. per language a fresh server: DATA_DIR=/tmp/site-<lang> SEED_DEMO=false LANGUAGE=<lang> ADMIN_NAME=Till
 *      ADMIN_PASSWORD=test1234 PORT=<port> BASE_URL=http://localhost:<port> node --import tsx server/index.ts
 *   3. start the demo via the tour API (POST /api/tour/start {choice:'demo'}), add the child Mila and the permanent
 *      guest Oma Inge, import the receipt fixtures from test/fixtures/receipts/ (POST /api/imports/upload, then
 *      /apply), add a member Lea (POST /api/users) and, as Lea, ask Till for vanilla ice cream with the note
 *      "with a spoon, please" (POST /api/bar/orders {bring_by}); Till asks Lea for crisps and Lea accepts
 *      (PATCH /api/orders/:id {status:'accepted'}), so the Treats page shows both directions
 *   4. shoot every slot in SHOTS (plus README_SHOTS) at 390x844, deviceScaleFactor 2, light and dark (household
 *      theme via PATCH /api/appearance/household), with the demo banner hidden (.demo-banner)
 *   5. convert to webp, 780 px wide, quality 80, into site/assets/shots/<lang>/<name>-<light|dark>.webp
 *
 * OG images (site/assets/img/og-<lang>.png, 1200x630): a 1200x630 page with the wordmark, the hero headline, one
 * line of copy and homeTiles(), styled by site.css and screenshotted with Playwright from the served site/ folder.
 */
