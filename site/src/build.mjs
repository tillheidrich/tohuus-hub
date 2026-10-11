/**
 * Builds the marketing site (site/index.html in English, site/de/index.html in German) from one template.
 * Run from the repo root:  node site/src/build.mjs
 *
 * Screenshots: drop PNGs into site/assets/shots/<lang>/<name>-light.png and <name>-dark.png (390 px wide phone
 * screens, any height; they are shown top-aligned). Until a file exists, the phone frame shows a calm
 * placeholder. Names: today, shopping, cook, plan-vote, recipe, stock, labels, spending, receipts, people,
 * away, ha-dashboard, order, tour.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://tohuus.heidrich-digital.de/';
const GH = 'https://github.com/tillheidrich/tohuus-hub';

// ---------------------------------------------------------------- icons (24px, stroke)
const ICONS = {
  arrow: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  home: '<path d="M4 10.5 12 4l8 6.5"/><path d="M6 9v10.5h12V9"/><path d="M10 19.5v-5h4v5"/>',
  basket: '<path d="M4 9.5h16l-1.6 9a1.5 1.5 0 0 1-1.5 1.2H7.1a1.5 1.5 0 0 1-1.5-1.2Z"/><path d="m8.5 9.5 3-5.5M15.5 9.5l-3-5.5M9.5 13.5v3M14.5 13.5v3"/>',
  hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L4 15a1.5 1.5 0 0 1 2.3-1.9L8 15"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 8.5 4.2 9.5 6-.4.8-1.4 2.2-2.8 3.5M6.6 7.6C4.7 8.9 3.3 10.7 2.5 12c1 1.8 4.5 6 9.5 6 1.6 0 3-.4 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  box: '<path d="M4 7.5 12 3.5l8 4v9l-8 4-8-4Z"/><path d="M4 7.5l8 4 8-4M12 11.5v9"/>',
  pot: '<path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z"/><path d="M2 10h20M9 6.5c0-1 1-1.5 1-2.5M13 6.5c0-1 1-1.5 1-2.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.6-7.5 10-7.5 10Z"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16.5 14.3c2.4.2 4 1.8 4.5 4.6"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
  swap: '<path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5"/>',
  scale: '<path d="M12 4v16M5 20h14M6 8h12"/><path d="M6 8 3 14a3 3 0 0 0 6 0Zm12 0-3 6a3 3 0 0 0 6 0Z"/>',
  gauge: '<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="M12 13l3.5-3.5"/>',
  tag: '<path d="M3.5 12V4.5h7.5l9.5 9.5-7.5 7.5Z"/><circle cx="8" cy="9" r="1.4"/>',
  pin: '<path d="M12 21s6.5-6 6.5-11.2a6.5 6.5 0 0 0-13 0C5.5 15 12 21 12 21Z"/><circle cx="12" cy="10" r="2.4"/>',
  receipt: '<path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6L6 20.5Z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  sparkle: '<path d="M12 3.5c.6 4 2.5 6 6.5 6.5-4 .6-5.9 2.5-6.5 6.5-.6-4-2.5-5.9-6.5-6.5 4-.5 5.9-2.5 6.5-6.5Z"/><path d="M18.5 15.5c.3 1.6 1 2.4 2.5 2.5-1.5.2-2.2 1-2.5 2.5-.3-1.5-1-2.3-2.5-2.5 1.5-.1 2.2-.9 2.5-2.5Z"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="m3.8 6.5 1 1 1.8-2M3.8 12l1 1 1.8-2M3.8 17.5l1 1 1.8-2"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c.8 1.3 2 2 3.5 2s2.7-.7 3.5-2M9 9.5h.01M15 9.5h.01"/>',
  child: '<circle cx="12" cy="6" r="2.6"/><path d="M8 21v-5.5L6 13l3-3.5h6l3 3.5-2 2.5V21"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  party: '<path d="M4 20 8.5 7.5l8 8Z"/><path d="M14 4.5c.5 1.5 0 2.5-1 3.5M19.5 10c-1.5-.5-2.5 0-3.5 1M17.5 4h.01M20 6.5h.01"/>',
  suitcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3.5 12.5h17"/>',
  moonstar: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z"/>',
  door: '<path d="M6 20.5V4.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v16M3.5 20.5h17"/><path d="M14.5 12h.01"/>',
  refresh: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5l2 2M19.5 12a7.5 7.5 0 0 1-13 5l-2-2"/><path d="M19.5 4.5V9H15M4.5 19.5V15H9"/>',
  package: '<path d="M4 7.5 12 3.5l8 4v9l-8 4-8-4Z"/><path d="m8 5.5 8 4v3.5"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M8.5 20.5h7"/>',
  send: '<path d="M20.5 3.5 3.5 10.5l7 3 3 7Z"/><path d="m10.5 13.5 4-4"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z"/>',
  chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V17A2.5 2.5 0 0 1 4 14.5Z"/>',
  server: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.01M8 16.5h.01"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5Z"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5"/>',
};
const ico = (n, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const sprite = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('')}</svg>`;

// ---------------------------------------------------------------- copy
const COPY = {
  de: {
    lang: 'de', locale: 'de_DE', alt: 'en_GB', url: `${SITE}de/`, base: '../', other: '../', otherLang: 'en',
    title: 'ToHuus Hub · Wenn der Einkauf digitaler wird, solltest du auch etwas davon haben',
    desc: 'Kostenlose Open-Source-App für den Haushalt, auf deinem eigenen Server: Einkaufsliste, Was essen wir heute, Vorrat, Bons und Ausgaben, Familie und Gäste, Home Assistant und KI-Assistenten.',
    ogAlt: 'Das ToHuus-Hub-Symbol, ein kleines Haus mit roter Tür, neben dem Satz: Wenn der Einkauf digitaler wird, solltest du auch etwas davon haben.',
    skip: 'Zum Inhalt springen', navLabel: 'Hauptnavigation',
    nav: [['#alltag', 'Alltag'], ['#kochen', 'Kochen'], ['#vorrat', 'Vorrat'], ['#familie', 'Familie'], ['#selbst-hosten', 'Selbst hosten']],
    themeLabel: 'Hell oder dunkel', homeLabel: 'ToHuus Hub Startseite', langLabel: 'Sprache',
    phLabel: 'Screenshot folgt', copy: 'Kopieren', copied: 'Kopiert',
    hero: {
      eyebrow: 'Open Source · auf deinem Server',
      h1: 'Wenn der Einkauf digitaler wird, solltest du auch <em class="mark">etwas davon haben.</em>',
      lede: 'Bons, Bestellungen, Rezepte und die Einkaufsliste sind längst digital. ToHuus Hub macht daraus einen ruhigen Überblick für alle im Haus, damit keiner mehr alles im Kopf haben muss.',
      cta: 'Installieren', code: 'Code ansehen',
      facts: ['Kostenlos, AGPL', 'Kein Konto, kein Tracking', 'Läuft auf NAS oder kleinem Server'],
      n1: ['Milch ist alle', 'steht schon auf der Liste'], n2: ['Jonas holt’s', 'Hafermilch, Brot, Kaffee'],
    },
    worries: {
      eyebrow: 'Mental Load', h2: 'Die Fragen, die sonst eine Person im Kopf hat.',
      p: 'In vielen Familien weiß eine Person, was fehlt, was weg muss und wo das Paketband liegt. ToHuus Hub übernimmt diesen Teil. Dann könnt ihr ihn euch teilen oder gar nicht mehr daran denken.',
      list: ['Haben wir noch Milch?', 'Was essen wir heute?', 'Wer holt das?', 'Wo ist das Paketband?', 'Ist der Joghurt noch gut?', 'Hast du das schon gekauft?', 'Was brauchen wir für Samstag?', 'Wann war der Wasserfilter dran?'],
    },
    chapters: [
      { id: 'alltag', eyebrow: 'Alltag', h2: 'Ein Blick am Morgen reicht.', intro: '„Heute“ zeigt auf einer Seite, was weg muss, was alle ist und was es abends gibt. Die Einkaufsliste ist auf allen Handys gleichzeitig aktuell.', shots: ['shopping'], points: [
        ['home', 'Heute', 'Zuerst essen, alle, knapp, heute Abend. Mehr steht da nicht, und mehr braucht es an den meisten Tagen nicht.'],
        ['hand', 'Einkaufsliste mit „Ich hol’s“', 'Wer etwas übernimmt, tippt drauf. Dann kauft keiner doppelt. Im Laden sortiert sich die Liste nach Gängen, auch ohne Netz.'],
        ['eyeoff', 'Diskrete Einträge', 'Manches muss nicht jede und jeder sehen. Private Einträge erscheinen nur bei dir, das Geschenk für Samstag bleibt eine Überraschung.'],
        ['check', 'Abhaken heißt eingeräumt', 'Was du im Laden abhakst, landet direkt im Vorrat.'],
      ] },
      { id: 'kochen', eyebrow: 'Kochen', h2: 'Was essen wir heute? In einer Minute entschieden.', intro: 'ToHuus Hub schlägt vor, was zu eurem Vorrat passt, und plant die Woche mit euch. Wer mag, stimmt mit ab.', shots: ['cook', 'plan-vote'], flip: true, points: [
        ['pot', 'Was geht sofort?', 'Was jetzt kochbar ist, wo nur eine Sache fehlt und was weg muss. Oder ein Tipp auf „Entscheidet ihr für uns“.'],
        ['calendar', 'Wochenplan', 'Freie Abende füllen sich mit passenden Rezepten, auf Wunsch im Wechsel über mehrere Wochen. Was der Woche fehlt, kommt mit einem Tipp auf die Liste.'],
        ['heart', 'Gemeinsam abstimmen', 'Alle wischen für sich durch Vorschläge. Gekocht wird, was mehreren schmeckt. Ohne Rangliste und ohne Diskussion am Herd.'],
        ['scale', 'Portionen für einen Abend', 'Besuch am Freitag? Die Menge gilt nur für diesen Abend, das Rezept bleibt, wie es ist.'],
      ] },
      { id: 'rezepte', eyebrow: 'Rezepte', h2: 'Eure Version, nicht die aus dem Internet.', intro: 'Rezepte kommen von dort, wo ihr sie schon habt. Gekocht wird dann so, wie es bei euch üblich ist.', shots: ['recipe'], points: [
        ['download', 'Import von fast überall', 'Rezeptseiten, offene Rezeptdatenbanken, andere Rezept-Apps, ein Foto oder einfach Text. Englische Rezepte kommen übersetzt an, Cups und Ounces werden zu Gramm.'],
        ['refresh', 'Cookidoo und Thermomix', 'Eure Cookidoo-Woche kommt über Home Assistant herein. Thermomix-Schritte behalten Zeit, Temperatur und Stufe.'],
        ['swap', 'Die Hausversion', 'Reis statt Kartoffeln, ohne Koriander, Hafermilch statt Milch. Einmal festgelegt, gilt es für Vorschläge, Kochen und Einkaufsliste.'],
        ['smile', 'Wem schmeckt’s?', 'Jede Person kann Rezepte bewerten und Lieblinge sammeln. Daraus werden bessere Vorschläge, kein Wettbewerb.'],
      ] },
      { id: 'vorrat', eyebrow: 'Vorrat', h2: 'Vorrat ohne Tabelle.', intro: 'Niemand muss Nudeln zählen. Fang mit dem an, was euch ausgeht, und lass den Rest weg.', shots: ['stock', 'labels'], flip: true, points: [
        ['list', '„Nur was ausgeht“', 'Ein Startmodus für alle ohne Lust auf Inventur: ToHuus Hub merkt sich nur, was nachgekauft werden muss.'],
        ['gauge', 'Halb voll ist eine Antwort', 'Obst und Brot sind voll, halb, wenig oder leer. Packungen werden gezählt, der Kaffee aus der Maschine gar nicht.'],
        ['tag', 'Etiketten für Reste und Gefrierfach', 'Reste und Eingefrorenes bekommen ein Datum und ein QR-Etikett mit Fach. Scannen, ein Tipp, und es ist aus dem Vorrat raus.'],
        ['pin', 'Wo ist was?', 'Jedes Ding kann einen genauen Platz haben. Tipp „Pflaster“ ein, und du weißt, welches Fach.'],
      ] },
      { id: 'bons', eyebrow: 'Bons & Ausgaben', h2: 'Der Bon räumt mit ein.', intro: 'Digitale Bons und Bestellungen bringen den Vorrat auf Stand. Abtippen ist der Notnagel, nicht der Plan.', shots: ['receipts', 'spending'], points: [
        ['receipt', 'Bons aus vielen Läden', 'eBons und Abholscheine von REWE, Bons von Lidl, Aldi, Edeka, Kaufland, dm, Rossmann und anderen. Als PDF, Foto, QR-Code oder über ein eigenes Bon-Postfach.'],
        ['sparkle', 'Lernt aus Korrekturen', 'Korrigierst du einmal, wofür eine Bon-Abkürzung steht, erkennt ToHuus Hub den Artikel beim nächsten Mal selbst.'],
        ['check', 'Prüfen statt raten', 'Jeder Import geht über eine kurze Prüfliste: Ersatzartikel, Fehlendes, neue Produkte.'],
        ['chart', 'Ausgaben ohne Haushaltsbuch', 'Monatssummen nach Laden und Kategorie, direkt aus den Bons. Und ein Hinweis, wenn etwas teurer geworden ist.'],
      ] },
      { id: 'familie', eyebrow: 'Familie & Gäste', h2: 'Für alle im Haus. Auch für die, die nur zu Besuch sind.', intro: 'Jede Person hat ihr Gesicht in der App. Kinder brauchen kein Konto, Gäste sehen nur, was du freigibst.', shots: ['people', 'order'], flip: true, points: [
        ['smile', 'Gesichter statt Namenslisten', 'Ein Foto oder ein Tier als Avatar, damit auch Kinder sehen, wer was holt.'],
        ['child', 'Kinder ohne Login', 'Ein Tablet wird zum Kinderbildschirm: sich etwas wünschen, nachsehen, wo etwas ist. Ohne Passwort, mit Eltern-PIN zum Verlassen.'],
        ['key', 'Dauergäste mit Stufen', 'Großeltern oder Mitbewohner sehen so viel, wie ihr wollt: nur bestellen, Vorrat, Rezepte oder alles. Für ein Wochenende lässt sich das umschalten.'],
        ['mic', 'Babysitter-Link mit Sprachbefehlen', 'Ein Link zeigt, wo was ist, mit deiner Notiz obendrauf. Mit Home Assistant kann die Babysitterin auch per Sprache Licht und Co. bedienen.'],
        ['party', 'Party- und Bestellmodus', 'Gäste scannen einen QR-Code und bestellen aus dem, was da ist. Der Fernseher zeigt, was fertig ist. Im Alltag bestellt man so vom Sofa einen Kaffee.'],
      ] },
      { id: 'unterwegs', eyebrow: 'Unterwegs', h2: 'Urlaub ohne vergessenen Joghurt.', intro: 'Sag ToHuus Hub, wann ihr weg seid. Den Rest plant es um die Reise herum.', shots: ['away'], points: [
        ['pot', 'Vorher aufbrauchen', 'In den Tagen davor kommen Gerichte, die den Kühlschrank leeren. Nichts Frisches landet mehr auf der Liste.'],
        ['moonstar', 'Ruhe unterwegs', 'Während ihr weg seid, kommen nur dringende Hinweise.'],
        ['door', 'Ankommen', 'Milch, Brot und was für morgen früh fehlt: die Willkommensliste steht, bevor ihr die Tür aufschließt.'],
      ] },
      { id: 'home-assistant', eyebrow: 'Smart Home', h2: 'Home Assistant, in beide Richtungen.', intro: 'Wenn ihr schon Automationen habt, macht ToHuus Hub mit, statt sie zu ersetzen.', shots: ['ha-dashboard'], flip: true, points: [
        ['package', 'Über HACS installiert', 'Eine native Integration mit fertigen Dashboards.'],
        ['refresh', 'Zwei Richtungen', 'Einkaufsliste als To-do-Liste für Assist, Wochenplan und Pflege als Kalender, Sensoren für heute Abend, Knappes und Fälliges. Und was ihr in Home Assistant schon automatisiert, meldet sich in der App zurück.'],
        ['tv', 'Küchen-Display', 'Ein altes Tablet oder der Fernseher zeigt den Tag. Nachts gedimmt, auch dunkel.'],
      ] },
    ],
    everywhere: {
      eyebrow: 'Überall dabei', h2: 'Telegram, Kurzbefehl, KI-Assistent.', p: 'Dinge landen dort, wo ihr ohnehin schon tippt oder sprecht.',
      ai: ['KI-Assistenten über MCP', 'Claude, ChatGPT und andere Assistenten verbinden sich direkt mit deinem Haushalt. Ein Foto vom Gefrierfach reicht.', 'gefrierfach.jpg', 'Trag das bitte in ToHuus Hub ein.', 'Erledigt. 6 Sachen fürs Gefrierfach warten in deiner Prüfliste.'],
      tg: ['Telegram', 'Schreib „2 Milch, Brot“ in den Chat, und es steht auf der Liste. Hinweise kommen auch dort an. Gotify und Matrix gehen ebenfalls.'],
      sc: ['iPhone-Kurzbefehl und Teilen', 'Ein Kurzbefehl setzt Dinge per Siri auf die Liste. Rezepte und Bons teilst du direkt aus anderen Apps an ToHuus Hub.'],
    },
    host: {
      eyebrow: 'Privatsphäre & Selbst hosten', h2: 'Bleibt im Haus.',
      p: 'Ein Docker-Container, eine SQLite-Datei. Kein Konto bei uns, kein Tracking, nichts telefoniert nach Hause. Alles, was mit der Außenwelt spricht, ist optional.',
      facts: [
        ['server', 'Läuft fast überall', 'Docker auf einem NAS oder einem kleinen VPS.'],
        ['db', 'Deine Daten', 'Eine SQLite-Datei, Export als JSON, nächtliche Backups, auf Wunsch nach WebDAV oder Nextcloud.'],
        ['lock', 'Anmelden', 'Passkeys, E-Mail-Link, OpenID Connect, PIN am Familien-Tablet.'],
        ['camera', 'Fotos lesen', 'Optional, mit einem Modell deiner Wahl. Auch lokal, zum Beispiel mit Ollama.'],
        ['globe', 'Sprachen', 'Deutsch, Englisch und Schwedisch. Jede weitere ist eine Datei.'],
        ['code', 'Open Source', 'AGPL-3.0. Keine Firma dahinter, kein Abo.'],
      ],
      installH: 'Installation', steps: [
        ['Compose-Datei speichern', 'Trag <code>BASE_URL</code>, deinen Namen und ein Passwort ein.'],
        ['Starten', '<code>docker compose up -d</code>, dann <code>http://localhost:8080</code> öffnen.'],
        ['Leer oder mit Demo', 'Beim ersten Start wählst du, ob du leer anfängst oder dich erst umsiehst.'],
        ['HTTPS davor', 'Dein üblicher Reverse Proxy reicht. Danach die App auf den Homescreen legen.'],
      ],
      langComment: '# oder en, sv',
    },
    story: {
      word: 'To Huus', wordSub: 'Plattdeutsch für „zu Hause“. Gesprochen an Nord- und Ostsee.',
      ps: [
        'ToHuus Hub ist für ein ganz normales Familienleben gebaut worden: ein Kühlschrank, ein Gefrierfach, ein Vorratsregal, das nie ganz aufgeräumt ist, und ein Schrank, in dem Dinge gern verschwinden.',
        'Jahrelang wusste eine Person, wo alles liegt und was zur Neige geht, und die andere hat gefragt. Die eine Regel beim Bauen: Es muss an einem müden Dienstag funktionieren.',
        'Es ist kostenlos und steht unter der AGPL. Issues und Pull Requests sind willkommen, Übersetzungen auch.',
      ],
      sig: 'Till & Lea',
    },
    cta: { h2: 'Erst mal umsehen? Mit Demo-Daten.', p: 'Die Tour zeigt dir in zwei Minuten die wichtigsten Stellen, direkt auf den echten Seiten. Danach sind die Demo-Daten mit einem Tipp wieder weg.', a: 'Installieren', b: 'Auf GitHub ansehen' },
    foot: {
      about: 'Open-Source-App für den Haushalt, von einer Familie gebaut, mit viel Hilfe von Claude.',
      project: 'Projekt', legal: 'Rechtliches', code: 'Quellcode auf GitHub', license: 'Lizenz: AGPL-3.0', issues: 'Fehler melden',
      imprint: 'Impressum', privacy: 'Datenschutz', otherLang: 'English version',
      fine: 'Diese Website setzt keine Cookies, trackt nicht und lädt nichts von Dritten. Produktdaten und -bilder in der App stammen teilweise von Open Food Facts (ODbL / CC BY-SA). ToHuus Hub steht in keiner Verbindung zu REWE, Vorwerk/Thermomix, Cookidoo, HelloFresh, Telegram oder Apple; die Namen beschreiben nur kompatible Formate und Dienste.',
    },
  },
  en: {
    lang: 'en', locale: 'en_GB', alt: 'de_DE', url: SITE, base: '', other: 'de/', otherLang: 'de',
    title: 'ToHuus Hub · When shopping goes digital, you should get something out of it',
    desc: 'Free, open-source home app on your own server: shared shopping list, what to eat tonight, stock, receipts and spending, family and guests, Home Assistant and AI assistants.',
    ogAlt: 'The ToHuus Hub icon, a small house with a red door, next to the sentence: When shopping goes digital, you should get something out of it.',
    skip: 'Skip to content', navLabel: 'Main',
    nav: [['#everyday', 'Everyday'], ['#cooking', 'Cooking'], ['#stock', 'Stock'], ['#family', 'Family'], ['#self-hosting', 'Self-hosting']],
    themeLabel: 'Light or dark', homeLabel: 'ToHuus Hub home', langLabel: 'Language',
    phLabel: 'Screenshot coming', copy: 'Copy', copied: 'Copied',
    hero: {
      eyebrow: 'Open source · on your server',
      h1: 'When shopping goes digital, you should <em class="mark">get something out of it.</em>',
      lede: 'Receipts, orders, recipes and the shopping list are digital already. ToHuus Hub turns them into one calm overview for everyone at home, so nobody has to keep it all in their head.',
      cta: 'Install it', code: 'Read the code',
      facts: ['Free, AGPL', 'No account, no tracking', 'Runs on a NAS or small server'],
      n1: ['Out of milk', 'already on the list'], n2: ['Jonas is on it', 'oat milk, bread, coffee'],
    },
    worries: {
      eyebrow: 'Mental load', h2: 'The questions one person usually carries around.',
      p: 'In many families one person knows what is missing, what needs eating and where the parcel tape lives. ToHuus Hub takes that part over, so you can share it, or stop thinking about it altogether.',
      list: ['Do we still have milk?', 'What are we eating tonight?', 'Who is getting that?', 'Where is the parcel tape?', 'Is the yoghurt still good?', 'Did you already buy it?', 'What do we need for Saturday?', 'When was the water filter due?'],
    },
    chapters: [
      { id: 'everyday', eyebrow: 'Everyday', h2: 'One look in the morning is enough.', intro: '“Today” shows on one page what needs eating, what has run out and what is for dinner. The shopping list is current on every phone at once.', shots: ['shopping'], points: [
        ['home', 'Today', 'Eat first, run out, running low, tonight. That is all it shows, and on most days that is all you need.'],
        ['hand', 'Shopping list with “I’ll get it”', 'Whoever takes something taps it, so nobody buys it twice. In the shop the list sorts itself by aisle, even without signal.'],
        ['eyeoff', 'Discreet items', 'Not everything is for everyone. Private items only show up for you, so Saturday’s present stays a surprise.'],
        ['check', 'Ticked means put away', 'What you tick off in the shop goes straight into stock.'],
      ] },
      { id: 'cooking', eyebrow: 'Cooking', h2: 'What are we eating tonight? Decided in a minute.', intro: 'ToHuus Hub suggests what fits what you have and plans the week with you. Anyone who wants to can vote.', shots: ['cook', 'plan-vote'], flip: true, points: [
        ['pot', 'What works right now?', 'What you can cook now, what lacks just one thing and what needs using up. Or one tap on “You decide for us”.'],
        ['calendar', 'Week plan', 'Free evenings fill up with fitting recipes, rotating over several weeks if you like. Whatever the week is missing goes on the list in one tap.'],
        ['heart', 'Vote together', 'Everyone swipes through suggestions on their own. You cook what several people like. No ranking, no debate at the stove.'],
        ['scale', 'Servings for one evening', 'Guests on Friday? The amount changes for that evening only, the recipe stays as it is.'],
      ] },
      { id: 'recipes', eyebrow: 'Recipes', h2: 'Your version, not the internet’s.', intro: 'Recipes come from wherever you already keep them. Then you cook them the way your household does.', shots: ['recipe'], points: [
        ['download', 'Import from almost anywhere', 'Recipe sites, open recipe databases, other recipe apps, a photo or plain text. English recipes work too, and cups and ounces turn into grams if you cook metric.'],
        ['refresh', 'Cookidoo and Thermomix', 'Your Cookidoo week comes in through Home Assistant. Thermomix steps keep time, temperature and speed.'],
        ['swap', 'The house version', 'Rice instead of potatoes, no coriander, oat milk instead of milk. Set it once and it applies to suggestions, cooking and the shopping list.'],
        ['smile', 'Who liked it?', 'Everyone can rate recipes and keep favourites. That makes for better suggestions, not a competition.'],
      ] },
      { id: 'stock', eyebrow: 'Stock', h2: 'Stock without a spreadsheet.', intro: 'Nobody has to count pasta. Start with what runs out and leave the rest.', shots: ['stock', 'labels'], flip: true, points: [
        ['list', '“Only what runs out”', 'A start mode for anyone who does not want an inventory: ToHuus Hub only keeps track of what needs buying again.'],
        ['gauge', 'Half full is an answer', 'Fruit and bread are full, half, low or empty. Packs get counted, coffee from the machine not at all.'],
        ['tag', 'Labels for leftovers and the freezer', 'Leftovers and frozen food get a date and a QR label with their compartment. Scan, one tap, and it is out of stock.'],
        ['pin', 'Where is what?', 'Every item can have an exact spot. Type “plasters” and you know which shelf.'],
      ] },
      { id: 'receipts', eyebrow: 'Receipts & spending', h2: 'The receipt puts things away.', intro: 'Digital receipts and orders bring your stock up to date. Typing is the fallback, not the plan.', shots: ['receipts', 'spending'], points: [
        ['receipt', 'Receipts from many shops', 'German eBons and pickup notes, receipts from Lidl, Aldi, dm and others, plus UK, US and Swedish formats. As PDF, photo, QR code or through your own receipt inbox.'],
        ['sparkle', 'Learns from corrections', 'Fix once what a receipt abbreviation stands for, and ToHuus Hub recognises the item by itself next time.'],
        ['check', 'Check, don’t guess', 'Every import goes through a short review: substitutions, missing items, new products.'],
        ['chart', 'Spending without a ledger', 'Monthly totals by shop and category, straight from the receipts. And a hint when something got more expensive.'],
      ] },
      { id: 'family', eyebrow: 'Family & guests', h2: 'For everyone at home. Including the ones just visiting.', intro: 'Everyone has their face in the app. Kids need no account, guests only see what you share.', shots: ['people', 'order'], flip: true, points: [
        ['smile', 'Faces, not name lists', 'A photo or an animal avatar, so even kids can see who is getting what.'],
        ['child', 'Kids without a login', 'A tablet becomes a kids’ screen: wish for something, look up where things are. No password, a parent PIN to leave.'],
        ['key', 'Permanent guests with levels', 'Grandparents or flatmates see as much as you want: ordering only, stock, recipes or everything. Switch it for a weekend if you need to.'],
        ['mic', 'Babysitter link with voice commands', 'A link shows where things are, with your note on top. With Home Assistant the sitter can also use voice for the lights and so on.'],
        ['party', 'Party and order mode', 'Guests scan a QR code and order from what is actually there. The TV shows what is ready. On normal days, that is how someone orders a coffee from the sofa.'],
      ] },
      { id: 'away', eyebrow: 'Away', h2: 'Holidays without forgotten yoghurt.', intro: 'Tell ToHuus Hub when you are away. It plans the rest around the trip.', shots: ['away'], points: [
        ['pot', 'Use it up before', 'In the days before, suggestions empty the fridge. Nothing fresh goes on the list.'],
        ['moonstar', 'Quiet while away', 'While you are gone, only urgent notifications come through.'],
        ['door', 'Coming home', 'Milk, bread and what tomorrow’s breakfast needs: the welcome list is ready before you unlock the door.'],
      ] },
      { id: 'home-assistant', eyebrow: 'Smart home', h2: 'Home Assistant, both ways.', intro: 'If you already have automations, ToHuus Hub joins in instead of replacing them.', shots: ['ha-dashboard'], flip: true, points: [
        ['package', 'Installed via HACS', 'A native integration with ready-made dashboards.'],
        ['refresh', 'Two directions', 'Shopping list as a to-do list for Assist, meal plan and home care as calendars, sensors for tonight, low stock and what is due. And what you already automate in Home Assistant reports back into the app.'],
        ['tv', 'Kitchen display', 'An old tablet or the TV shows the day. Dimmed at night, dark mode included.'],
      ] },
    ],
    everywhere: {
      eyebrow: 'Wherever you are', h2: 'Telegram, Shortcuts, AI assistants.', p: 'Things land where you already type or talk.',
      ai: ['AI assistants via MCP', 'Claude, ChatGPT and other assistants connect straight to your household. A photo of the freezer is enough.', 'freezer.jpg', 'Please add this to ToHuus Hub.', 'Done. 6 items for the freezer are waiting in your review list.'],
      tg: ['Telegram', 'Write “2 milk, bread” in the chat and it is on the list. Notifications arrive there too. Gotify and Matrix work as well.'],
      sc: ['iPhone Shortcut and sharing', 'A Shortcut adds things to the list with Siri. Share recipes and receipts to ToHuus Hub straight from other apps.'],
    },
    host: {
      eyebrow: 'Privacy & self-hosting', h2: 'It stays at home.',
      p: 'One Docker container, one SQLite file. No account with us, no tracking, nothing phones home. Everything that talks to the outside world is optional.',
      facts: [
        ['server', 'Runs almost anywhere', 'Docker on a NAS or a small VPS.'],
        ['db', 'Your data', 'One SQLite file, JSON export, nightly backups, optionally to WebDAV or Nextcloud.'],
        ['lock', 'Sign-in', 'Passkeys, e-mail link, OpenID Connect, PIN on the family tablet.'],
        ['camera', 'Reading photos', 'Optional, with a model of your choice. Locally too, for example with Ollama.'],
        ['globe', 'Languages', 'English, German and Swedish. Each new one is a single file.'],
        ['code', 'Open source', 'AGPL-3.0. No company behind it, no subscription.'],
      ],
      installH: 'Install', steps: [
        ['Save the compose file', 'Fill in <code>BASE_URL</code>, your name and a password.'],
        ['Start it', '<code>docker compose up -d</code>, then open <code>http://localhost:8080</code>.'],
        ['Empty or demo', 'On first start you choose to begin empty or to look around first.'],
        ['Put HTTPS in front', 'Your usual reverse proxy is enough. Then add the app to your home screen.'],
      ],
      langComment: '# or de, sv',
    },
    story: {
      word: 'To Huus', wordSub: 'Low German for “at home”. Spoken along the North Sea and the Baltic.',
      ps: [
        'ToHuus Hub was built for an ordinary family life: a fridge, a freezer compartment, a pantry shelf that is never quite tidy and a cupboard where things like to disappear.',
        'For years one person knew where everything was and what was running out, and the other one asked. The one rule while building it: it has to work on a tired Tuesday.',
        'It is free and licensed under the AGPL. Issues and pull requests are welcome, and so are translations.',
      ],
      sig: 'Till & Lea',
    },
    cta: { h2: 'Want to look around first? Use the demo data.', p: 'The tour shows you the important places in two minutes, right on the real pages. Afterwards the demo data is gone with one tap.', a: 'Install it', b: 'View on GitHub' },
    foot: {
      about: 'Open-source home app, built by a family with a lot of help from Claude.',
      project: 'Project', legal: 'Legal', code: 'Source code on GitHub', license: 'Licence: AGPL-3.0', issues: 'Report a bug',
      imprint: 'Imprint', privacy: 'Privacy', otherLang: 'Deutsche Version',
      fine: 'This website sets no cookies, does not track you and loads nothing from third parties. Product data and images in the app come partly from Open Food Facts (ODbL / CC BY-SA). ToHuus Hub is not affiliated with REWE, Vorwerk/Thermomix, Cookidoo, HelloFresh, Telegram or Apple; the names only describe compatible formats and services.',
    },
  },
};

// ---------------------------------------------------------------- building blocks
const phone = (c, name, extra = '') => `<div class="phone${extra}" aria-hidden="true" data-shot-name="${name}">
        <div class="screen">
          <div class="ph" aria-hidden="true"><i class="t1"></i><i class="t2"></i><i class="c1"></i><div class="row"><i></i><i></i></div><i class="c2"></i><i class="acc"></i><i class="tab"></i></div>
          <span class="ph-label" aria-hidden="true">${c.phLabel}</span>
          <img class="light-only" data-shot src="${c.base}assets/shots/${c.lang}/${name}-light.webp" alt="" loading="lazy" decoding="async" width="390" height="844">
          <img class="dark-only" data-shot src="${c.base}assets/shots/${c.lang}/${name}-dark.webp" alt="" loading="lazy" decoding="async" width="390" height="844">
        </div>
      </div>`;

const chapter = (c, ch, i) => `
<section class="chapter${ch.flip ? ' flip' : ''}" id="${ch.id}" aria-labelledby="${ch.id}-h">
  <div class="wrap chapter-grid">
    <div class="chapter-copy">
      <span class="eyebrow reveal">${ch.eyebrow}</span>
      <h2 class="reveal" id="${ch.id}-h" style="--d:60ms">${ch.h2}</h2>
      <p class="intro reveal" style="--d:120ms">${ch.intro}</p>
      <ul class="points">
${ch.points.map(([icon, b, s], k) => `        <li class="reveal" style="--d:${120 + k * 60}ms"><span class="pi">${ico(icon)}</span><div><b>${b}</b><span>${s}</span></div></li>`).join('\n')}
      </ul>
    </div>
    <div class="phones reveal" style="--d:100ms">
      ${ch.shots.map((s) => phone(c, s)).join('\n      ')}
    </div>
  </div>
</section>`;

function page(c) {
  const b = c.base;
  const h = c.host;
  const e = c.everywhere;
  const install = c.lang === 'de' ? 'installation' : 'install';
  const hostId = c.lang === 'de' ? 'selbst-hosten' : 'self-hosting';
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
<meta name="theme-color" content="#f5f2eb" media="(prefers-color-scheme: light)">
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
<link rel="preload" href="${b}assets/fonts/bricolage-grotesque-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${b}assets/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${b}assets/site.css">
<script>(function(){var d=document.documentElement;d.classList.add('js');var t=null;try{t=localStorage.getItem('tohuus.site.theme')}catch(e){}if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.setAttribute('data-theme',t);document.addEventListener('error',function(e){var x=e.target;if(x&&x.hasAttribute&&x.hasAttribute('data-shot'))x.remove()},true)})()</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"ToHuus Hub","description":"${c.desc}","applicationCategory":"LifestyleApplication","operatingSystem":"Docker, Linux","license":"https://www.gnu.org/licenses/agpl-3.0.html","offers":{"@type":"Offer","price":"0","priceCurrency":"EUR"},"url":"${c.url}","image":"${SITE}assets/img/og-${c.lang}.png","codeRepository":"${GH}","inLanguage":["en","de"],"author":{"@type":"Person","name":"Till Heidrich","url":"https://github.com/tillheidrich"}}
</script>
</head>
<body>
${sprite}
<a class="skip" href="#main">${c.skip}</a>

<header class="nav">
  <div class="nav-in">
    <a class="brand" href="./" aria-label="${c.homeLabel}"><img src="${b}assets/favicon-light.svg" alt="" width="30" height="30">ToHuus Hub</a>
    <nav class="nav-links" aria-label="${c.navLabel}">
${c.nav.map(([h, l]) => `      <a href="${h}">${l}</a>`).join('\n')}
    </nav>
    <div class="lang" role="group" aria-label="${c.langLabel}">
      <a class="pill" href="${c.lang === 'en' ? './' : '../'}" hreflang="en" lang="en"${c.lang === 'en' ? ' aria-current="true"' : ''}>EN</a>
      <a class="pill" href="${c.lang === 'de' ? './' : 'de/'}" hreflang="de" lang="de"${c.lang === 'de' ? ' aria-current="true"' : ''}>DE</a>
    </div>
    <button class="pill theme-btn" type="button" aria-label="${c.themeLabel}">${ico('sun', 'ico sun')}${ico('moon', 'ico moon')}</button>
    <a class="pill nav-gh" href="${GH}" aria-label="GitHub">${ico('github')}<span>GitHub</span></a>
  </div>
</header>

<main id="main">

<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <span class="eyebrow reveal">${c.hero.eyebrow}</span>
      <h1 class="reveal" style="--d:60ms">${c.hero.h1}</h1>
      <p class="lede reveal" style="--d:140ms">${c.hero.lede}</p>
      <div class="btns reveal" style="--d:220ms">
        <a class="btn btn-primary" href="#${install}">${c.hero.cta}<span class="btn-ico">${ico('arrow')}</span></a>
        <a class="btn btn-ghost" href="${GH}">${ico('github')}${c.hero.code}</a>
      </div>
      <p class="small reveal" style="--d:280ms">${c.hero.facts.map((f) => `<span>${ico('check')}${f}</span>`).join('')}</p>
    </div>
    <div class="hero-visual reveal" style="--d:120ms">
      <div class="note n1"><b><span class="dot"></span>${c.hero.n1[0]}</b><small>${c.hero.n1[1]}</small></div>
      ${phone(c, 'today')}
      <div class="note n2"><b>${c.hero.n2[0]}</b><small>${c.hero.n2[1]}</small></div>
    </div>
  </div>
</section>

<section class="worries" aria-labelledby="worries-h">
  <div class="wrap">
    <div class="lead">
      <span class="eyebrow reveal">${c.worries.eyebrow}</span>
      <h2 class="reveal" id="worries-h" style="--d:60ms; margin-top:16px">${c.worries.h2}</h2>
      <p class="lead reveal" style="--d:120ms">${c.worries.p}</p>
    </div>
    <ul class="bubbles" role="list">
${c.worries.list.map((q, i) => `      <li class="bubble reveal" style="--d:${80 + i * 50}ms; list-style:none"><s>${q}</s></li>`).join('\n')}
    </ul>
  </div>
</section>
${c.chapters.map((ch, i) => chapter(c, ch, i)).join('\n')}

<section class="chapter" aria-labelledby="everywhere-h">
  <div class="wrap">
    <span class="eyebrow reveal">${e.eyebrow}</span>
    <h2 class="reveal" id="everywhere-h" style="--d:60ms; margin:16px 0 14px">${e.h2}</h2>
    <p class="intro reveal" style="--d:120ms">${e.p}</p>
    <div class="panel-grid">
      <div class="panel reveal">
        <span class="pi" style="display:inline-grid">${ico('chat')}</span>
        <h3>${e.ai[0]}</h3>
        <p>${e.ai[1]}</p>
        <div class="chat" aria-hidden="true">
          <div class="m me"><span class="file">${ico('camera')}${e.ai[2]}</span><br>${e.ai[3]}</div>
          <div class="m it">${e.ai[4]}</div>
        </div>
      </div>
      <div class="panel reveal" style="--d:80ms"><span class="pi" style="display:inline-grid">${ico('send')}</span><h3>${e.tg[0]}</h3><p>${e.tg[1]}</p></div>
      <div class="panel reveal" style="--d:140ms"><span class="pi" style="display:inline-grid">${ico('bolt')}</span><h3>${e.sc[0]}</h3><p>${e.sc[1]}</p></div>
    </div>
  </div>
</section>

<section class="chapter" id="${hostId}" aria-labelledby="host-h">
  <div class="wrap">
    <div class="host">
      <span class="eyebrow">${h.eyebrow}</span>
      <h2 id="host-h">${h.h2}</h2>
      <p class="intro">${h.p}</p>
      <div class="facts">
${h.facts.map(([i, t, s]) => `        <div class="fact">${ico(i)}<div><b>${t}</b><span>${s}</span></div></div>`).join('\n')}
      </div>
      <div class="install" id="${install}">
        <div>
          <h3 style="color:#fffdf8; margin-bottom:18px">${h.installH}</h3>
          <ol class="steps">
${h.steps.map(([t, s]) => `            <li><span><b>${t}</b>${s}</span></li>`).join('\n')}
          </ol>
        </div>
        <div class="code">
          <div class="code-head"><span>docker-compose.yml</span><button class="copy" type="button" data-copy="code-compose" data-done="${c.copied}">${ico('copy')}<span>${c.copy}</span></button></div>
<pre id="code-compose"><span class="k">services:</span>
  <span class="k">tohuus:</span>
    <span class="k">image:</span> <span class="s">ghcr.io/tillheidrich/tohuus-hub:latest</span>
    <span class="k">restart:</span> unless-stopped
    <span class="k">ports:</span>
      - <span class="s">"8080:8080"</span>
    <span class="k">volumes:</span>
      - ./data:/data
    <span class="k">environment:</span>
      <span class="k">BASE_URL:</span> <span class="s">https://home.example.org</span>
      <span class="k">ADMIN_NAME:</span> Alex
      <span class="k">ADMIN_PASSWORD:</span> change-me
      <span class="k">LANGUAGE:</span> ${c.lang} <span class="c">${h.langComment}</span></pre>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="story" aria-labelledby="story-h">
  <div class="wrap story-grid">
    <div class="word reveal" id="story-h">${c.story.word}<small>${c.story.wordSub}</small></div>
    <div class="reveal" style="--d:80ms">
${c.story.ps.map((p) => `      <p>${p}</p>`).join('\n')}
      <p class="sig">${c.story.sig}</p>
    </div>
  </div>
</section>

<section class="cta" aria-labelledby="cta-h">
  <div class="wrap">
    <div class="cta-card">
      <div>
        <h2 id="cta-h">${c.cta.h2}</h2>
        <p style="color:var(--ink-2); max-width:52ch; margin:16px 0 26px">${c.cta.p}</p>
        <div class="btns">
          <a class="btn btn-primary" href="#${install}">${c.cta.a}<span class="btn-ico">${ico('arrow')}</span></a>
          <a class="btn btn-ghost" href="${GH}">${ico('github')}${c.cta.b}</a>
        </div>
      </div>
      <div class="phones">${phone(c, 'tour')}</div>
    </div>
  </div>
</section>

</main>

<footer class="foot">
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <a class="brand" href="./"><img src="${b}assets/favicon-light.svg" alt="" width="30" height="30">ToHuus Hub</a>
        <p style="margin:12px 0 0; max-width:40ch">${c.foot.about}</p>
      </div>
      <div>
        <h4>${c.foot.project}</h4>
        <ul>
          <li><a href="${GH}">${c.foot.code}</a></li>
          <li><a href="${GH}/blob/main/LICENSE">${c.foot.license}</a></li>
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

<script src="${b}assets/site.js" defer></script>
</body>
</html>
`;
}

// guard: no em dashes in the copy (house style)
for (const c of Object.values(COPY)) {
  const s = JSON.stringify(c);
  if (s.includes('—')) throw new Error(`em dash in ${c.lang} copy`);
}
fs.writeFileSync(path.join(ROOT, 'index.html'), page(COPY.en));
fs.mkdirSync(path.join(ROOT, 'de'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'de/index.html'), page(COPY.de));
fs.mkdirSync(path.join(ROOT, 'assets/shots'), { recursive: true });
console.log('built site/index.html and site/de/index.html');
