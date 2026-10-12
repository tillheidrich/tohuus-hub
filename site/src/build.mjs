/**
 * Builds the marketing site (site/index.html in English, site/de/index.html in German) from one template, plus the
 * legal pages from legal.mjs (site/privacy.html, site/terms.html, site/de/datenschutz.html, site/de/nutzungsbedingungen.html).
 * Run from the repo root:  node site/src/build.mjs
 *
 * Product frame and wording: docs/plan-2026-10-12.md and the strategy "ToHuus merkt sich, was zu Hause fehlt"
 * (12.10.2026). ToHuus is the shopping and household assistant of a home: Einkauf, Kochen, Geld. Outward verb
 * "merkt sich", never "Gedächtnis"; "KI" is never the promise; data claims only where they can be checked.
 * No real names of the maker's family anywhere (copy, alt texts, screenshots). Demo people: Sam, Mira, Jonas.
 *
 * Design: "Dutch Detail" (docs/design/2026-10-11-dutch-detail-system.md): same tokens, fonts and icons as the app.
 * Signature elements: the illustrated homes, the green block with circles, the ticket with punch notches, the
 * receipt with a zigzag edge, arches. Fonts: site/assets/fonts (OFL). Icons: Phosphor, inline sprite at build time.
 *
 * Screenshots: real screens of the web app with invented demo data, 390x844 at 3x, saved as
 * site/assets/shots/<lang>/<name>-<480|960>.webp. The slots are listed in SHOTS; the build fails if one is missing.
 * How they are made: see the comment at the end of this file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Ph from '@phosphor-icons/react/ssr';
import { homeTiles, brandMark, bird } from './art.mjs';
import { legalCopy } from './legal.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://tohuus.heidrich-digital.de/';
const GH = 'https://github.com/tillheidrich/tohuus-hub';
/** Required provider line (Impressum). The only place where the en dash is allowed. */
const PROVIDER = 'Till Heidrich – Content Creation';
/** Contact data of the provider for the legal pages (Datenschutz, Nutzungsbedingungen). */
const CONTACT = { MAIL: 'mail@tillheidrich.de', PHONE: '0157 73953819', ADDRESS: ['Rotdornweg 17', '21255 Tostedt'], CLOUD: 'https://cloud.tohuus.heidrich-digital.de' };
const LEGAL = legalCopy({ PROVIDER, SITE, GH, ...CONTACT });
/** Draft status shown on top of every legal page until the owner decides on a legal review. */
const LEGAL_STATUS = { de: 'Stand: 12.10.2026 · Entwurf, rechtlich noch nicht geprüft', en: 'As of 12 October 2026 · Draft, not yet legally reviewed' };

// ---------------------------------------------------------------- icons (Phosphor regular, like the app)
const ICONS = {
  arrow: 'ArrowRight', github: 'GithubLogo', apple: 'AppleLogo', copy: 'Copy', sun: 'Sun', moon: 'Moon', check: 'Check',
  basket: 'Basket', pot: 'CookingPot', wallet: 'Wallet', receipt: 'Receipt', camera: 'Camera', mic: 'Microphone',
  lock: 'LockSimple', key: 'Key', trash: 'Trash', server: 'HardDrives', cloud: 'Cloud', eyeoff: 'EyeSlash', db: 'Database',
  robot: 'Robot', package: 'Package', refresh: 'ArrowsClockwise', send: 'PaperPlaneTilt', mail: 'EnvelopeSimple',
  terminal: 'TerminalWindow', code: 'Code', export: 'Export', plus: 'Plus', caret: 'CaretDown', printer: 'Printer',
  phone: 'DeviceMobile', globe: 'Globe', chart: 'ChartBar', list: 'ListChecks', store: 'Storefront', sparkle: 'Sparkle',
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
    title: 'ToHuus · Merkt sich, was zu Hause fehlt',
    desc: 'ToHuus merkt sich für euren Haushalt, was da ist, was fehlt und was es kostet, aus euren Kassenbons und eurer Liste. Für iPhone und im Browser, in der ToHuus Cloud oder auf dem eigenen Server.',
    ogAlt: 'Das ToHuus-Zeichen, der Satz „Damit nicht einer alles im Kopf haben muss.“ und vier gezeichnete Wohnformen.',
    skip: 'Zum Inhalt springen', navLabel: 'Hauptnavigation', railLabel: 'Schnellnavigation',
    themeLabel: 'Dunkles Design', homeLabel: 'ToHuus Startseite', langLabel: 'Sprache', copy: 'Kopieren', copied: 'Kopiert',
    legalLabel: 'Rechtliches', tocLabel: 'Inhalt', back: 'Zur Startseite', ids: { jobs: 'einkauf', cook: 'kochen', money: 'geld', levels: 'einstieg', how: 'so-merkt-es-sich', who: 'fuer-wen', ways: 'zwei-wege', prices: 'preise', privacy: 'datenschutz', host: 'selbst-hosten', why: 'warum', faq: 'fragen', install: 'installieren' },
    nav: [['#einkauf', 'Einkauf'], ['#kochen', 'Kochen'], ['#geld', 'Geld'], ['#preise', 'Preise'], ['#datenschutz', 'Datenschutz'], ['#selbst-hosten', 'Selbst hosten']],
    rail: [['#einkauf', 'Einkauf', 'basket'], ['#kochen', 'Kochen', 'pot'], ['#geld', 'Geld', 'wallet'], ['#preise', 'Preise', 'receipt']],
    hero: {
      label: 'Einkaufs- und Haushaltsassistent',
      h1: 'Damit nicht einer alles <span class="hl">im Kopf</span> haben muss.',
      lede: 'ToHuus merkt sich für euren Haushalt, was da ist, was fehlt und was es kostet. Dafür reichen eure Kassenbons und eure gemeinsame Liste.',
      ios: 'Für iPhone', iosSub: 'bald in TestFlight', gh: 'Selbst hosten auf GitHub',
      facts: ['Server in Deutschland (Hetzner)', 'Kein Tracking, keine Werbung', 'Selbst hosten kostenlos'],
      tiles: { flat: 'Wohnung', shared: 'WG', terraced: 'Reihenhaus', house: 'Haus' },
      tilesLabel: 'Vier gezeichnete Wohnformen: eine Wohnung, eine WG, Reihenhäuser und ein Haus.',
      shot: 'ToHuus auf dem iPhone, Seite Heute: Hackfleisch und Haferflocken sind fällig, mit dem Hinweis „merkt sich: alle ~20 Tage, zuletzt vor 19 Tagen“, darunter die gemeinsame Liste mit Einträgen von Mira und Sam.',
    },
    ask: {
      label: 'Haben wir noch …?', h2: 'Meistens weiß es nur eine Person.',
      p: 'Ob noch Kaffee da ist, was diese Woche gekocht wird und wann das Waschmittel alle ist, weiß in vielen Haushalten genau einer. Die anderen fragen nach oder kaufen doppelt. ToHuus nimmt diesen Teil aus dem Kopf und legt ihn dorthin, wo alle nachsehen können.',
      p2: 'Danach wissen alle, was fehlt, und keiner muss es sich merken.',
      bonTitle: 'Im Kopf', bonFoot: 'Steht jetzt in ToHuus',
      list: ['Haben wir noch Kaffee?', 'Was essen wir heute?', 'Ist noch Milch da?', 'Hast du Klopapier mitgebracht?', 'Brauchen wir was für Sonntag?', 'Was hat der Einkauf diesen Monat gekostet?'],
    },
    jobs: {
      label: 'Was ToHuus macht', h2: 'Einkauf, Kochen und Geld hängen zusammen.',
      intro: 'Aus dem, was ihr einkauft, wird gekocht, und dafür geht das Geld weg. Deshalb kümmert sich ToHuus um alle drei.',
      list: [
        { id: 'einkauf', no: '1', label: 'Einkauf', h3: 'ToHuus merkt sich, was fehlt.', shot: 'shopping',
          alt: 'Einkaufsliste in ToHuus: oben Vorschläge wie Hackfleisch mit „merkt sich: alle ~12 Tage“, darunter nach Bereichen sortierte Einträge mit Ich-hol’s-Knopf und Herkunft wie „Mira, heute“.',
          p: 'Aus euren Bons und dem, was ihr auf der Liste abhakt, sieht ToHuus, wie oft ihr etwas kauft. Ist es wieder so weit, erscheint es als Vorschlag mit Grund. Einen Vorrat müsst ihr dafür nicht führen.',
          points: ['Eine Liste, auf allen Handys gleichzeitig aktuell', 'Wer etwas übernimmt, tippt auf „Ich hol’s“', 'Im Laden nach Gängen sortiert, auch ohne Netz'] },
        { id: 'kochen', no: '2', label: 'Kochen', h3: 'Daraus könnt ihr heute kochen.', shot: 'cook',
          alt: 'Seite Kochen: „Daraus könnt ihr heute kochen“ mit Gnocchi-Pfanne und Ofengemüse mit Feta, beide mit „Alles da“, dazu Filter mit und ohne Thermomix.',
          p: 'Der Kochplaner fängt bei dem an, was zu Hause ist. Er zeigt, was sofort geht, wo nur eine Zutat fehlt und was bald weg muss. Wer mag, plant die Woche, und was dafür fehlt, kommt mit einem Tipp auf die Liste.',
          points: ['Rezepte von Hand, per Link oder aus anderen Apps', 'Mit und ohne Thermomix, Allergien werden beim Vorschlagen berücksichtigt'] },
        { id: 'geld', no: '3', label: 'Geld', h3: 'Ihr seht, wohin das Geld für Essen und Haushalt geht.', shot: 'money',
          alt: 'Seite Geld für September 2026: 215,81 Euro ausgegeben, 17 Euro mehr als im Vormonat, darunter ein Wochenverlauf und Balken nach Kategorie.',
          p: 'Jeder Bon zählt mit. ToHuus zeigt, was ein Monat gekostet hat, in welchem Laden und für welche Kategorie, und vergleicht mit dem Vormonat. Ein Haushaltsbuch müsst ihr dafür nicht führen.',
          points: ['Ausgaben nach Monat, Laden und Kategorie', 'Preisänderungen bei Dingen, die ihr oft kauft', 'Ein Budget, wenn ihr eins wollt', 'Export als CSV'] },
      ],
    },
    levels: {
      label: 'Einstieg', h2: 'Egal, wie digital ihr schon einkauft.',
      intro: 'Wenn der Einkauf digitaler wird, solltest du auch etwas davon haben. ToHuus arbeitet mit dem, was ihr ohnehin habt. Für den Anfang reicht einer dieser Wege.',
      shot: 'import', alt: 'Seite Importe: Bons als PDF, Foto, QR-Link oder Text, darunter der Verlauf mit gebuchten Bons von REWE und Aldi.',
      list: [
        ['receipt', 'Lieferdienst und eBon', 'Bestellt ihr bei REWE oder bekommt ihr digitale Bons, kommen Bestellung und Bon als PDF herein. ToHuus gleicht beides ab und bucht, was wirklich geliefert wurde.'],
        ['camera', 'Bon fotografieren', 'Bei Aldi, Lidl oder auf Papier reicht ein Foto vom Bon. Was ToHuus nicht sicher lesen kann, legt es dir zum Prüfen vor, bevor etwas gebucht wird.'],
        ['mic', 'Einfach sprechen', 'Du tippst auf „Sprechen“ und sagst: „Milch ist alle, und wir brauchen was für Sonntag.“ Der Assistent setzt es auf die Liste und sagt dir, was er eingetragen hat. Jeder Schritt lässt sich zurücknehmen.'],
      ],
    },
    how: {
      label: 'So merkt es sich', h2: 'Ihr entscheidet, was auf die Liste kommt.',
      intro: 'ToHuus macht Vorschläge und schreibt nie still etwas auf eure Liste. Jede Zeile zeigt, woher sie kommt.',
      steps: [
        ['Einkäufe sammeln', 'Jeder Bon und jedes Häkchen auf der Liste zählt als Einkauf. Mehr Pflege braucht es nicht.'],
        ['Rhythmus erkennen', 'Nach ein paar Wochen sieht ToHuus zum Beispiel, dass ihr Haferflocken etwa alle 20 Tage kauft.'],
        ['Vorschlagen', 'Ist es wieder so weit, erscheint ein Vorschlag mit seinem Grund. Ein Tipp setzt ihn auf die Liste.'],
        ['Zurückhalten', '„Haben wir noch“ schiebt den Vorschlag auf. Lehnt ihr ihn zweimal ab, fragt ToHuus nicht mehr.'],
      ],
      cardTitle: 'Einkaufsliste', cardSub: 'mit Herkunft',
      rows: [['Mozzarella', 'merkt sich: alle ~9 Tage', 'rhythm'], ['Backpapier', 'Mira · heute 16:41', 'person'], ['2× Haferdrink', 'Mira · heute 16:41', 'person'], ['Paketband', 'Jonas · gestern', 'person'], ['Tomaten, stückig', 'aus dem Wochenplan', 'plan']],
      cardFoot: 'Keine Zeile ohne Absender',
    },
    who: {
      label: 'Für wen', h2: 'Für jeden Haushalt, in dem eingekauft wird.',
      intro: 'Beim Start fragt ToHuus nur, wer dazugehört. Danach richtet sich, was ihr seht.',
      forms: [
        ['c', 'Allein', 'Du musst dir nichts merken, und am Monatsende siehst du, was Essen und Haushalt gekostet haben.'],
        ['h', 'Zu zweit', 'Beide wissen, was fehlt. Keiner muss den anderen fragen, ob noch Kaffee da ist.'],
        ['s', 'Familie', 'Alle schreiben auf dieselbe Liste. Kinder und feste Gäste sehen nur, was ihr freigebt.'],
        ['t', 'WG', 'Gemeinsames kommt auf eine Liste, private Einträge sehen die anderen nicht.'],
        ['a', 'Mitversorgen', 'Wer für Eltern oder Großeltern mit einkauft, verbindet die beiden Haushalte und sieht, was dort fehlt.'],
      ],
      note: 'ToHuus setzt keinen Keller, keine Gefriertruhe und keinen Thermomix voraus. Ihr legt fest, welche Orte es bei euch gibt.',
    },
    ways: {
      label: 'Zwei Wege', h2: 'In der ToHuus Cloud oder auf deinem eigenen Server.',
      intro: 'Es ist dieselbe App mit demselben Code. Der Unterschied ist, wer den Server betreibt.',
      cols: ['ToHuus Cloud', 'Selbst hosten'],
      rows: [
        ['Für wen', 'Alle, die einfach anfangen wollen', 'Alle mit eigenem Server, NAS oder Home Assistant'],
        ['Apps', 'iPhone-App und im Browser, auch auf Android', 'iPhone-App mit deinem Server verbunden, dazu der Browser'],
        ['Daten', 'Server in Deutschland (Hetzner), jeder Haushalt mit eigenem Schlüssel verschlüsselt', 'Auf deinem Server, auf Wunsch verschlüsselt'],
        ['Bon-Fotos und Assistent', 'Dabei, mit Kontingent je nach Tarif', 'Mit eigenem KI-Schlüssel oder ganz ohne'],
        ['Home Assistant', 'Über die HACS-Integration', 'Voll, dazu Bon-Postfach, Telegram und Bon-Drucker im eigenen Netz'],
        ['Kosten', 'Free, Haushalt oder Plus', 'Kostenlos, AGPL-3.0'],
      ],
    },
    prices: {
      label: 'Preise', h2: 'Ein Abo pro Haushalt.',
      intro: 'Mitglieder und Gäste zahlen nie. Jeder neue Haushalt in der Cloud nutzt 14 Tage lang Plus, ohne Zahlungsdaten. Endet ein Abo, geht der Haushalt auf Free zurück, und nichts wird gelöscht.',
      per: '/ Monat', or: 'oder', year: '/ Jahr', storage: 'Speicher',
      plans: [
        { name: 'Free', price: '0 €', sub: 'für immer', storage: '250 MB', items: ['Gemeinsame Liste mit Einkaufsmodus', 'Bons ohne Limit', 'Merkt sich 60 Tage zurück', 'Rezepte von Hand oder per Link', '20 Nachrichten an den Assistenten im Monat'] },
        { name: 'Haushalt', price: '3,99 €', year: '34,99 €', storage: '2 GB', items: ['Alles aus Free', 'Die ganze Geschichte mit Preisverlauf, Ausgaben und Rückblick', 'Verbundene Haushalte zum Mitversorgen', 'Import aus Screenshots und Fotos von Papierlisten', '100 Nachrichten im Monat'] },
        { name: 'Plus', price: '5,99 €', year: '59,99 €', storage: '5 GB', items: ['Alles aus Haushalt', 'Wochenplan aus dem, was da ist', 'Monatsauswertung vom Assistenten', '1.500 Nachrichten im Monat'], mark: '14 Tage zum Ausprobieren' },
        { name: 'Selbst hosten', price: '0 €', sub: 'AGPL-3.0', storage: 'so viel dein Server hat', items: ['Alles freigeschaltet', 'Eigener KI-Schlüssel oder keiner', 'iPhone-App und Browser'], host: true },
      ],
      note: 'Preise zum Start. Wir prüfen sie im Test mit Familien und passen sie an, wenn sie nicht stimmen. Bezahlt wird in der iPhone-App über Apple.',
    },
    privacy: {
      label: 'Datenschutz und Sicherheit', h2: 'Eure Bons arbeiten für euch, nicht für Marktforschung.',
      intro: 'Hier steht nur, was sich prüfen lässt. Wie die Cloud aufgebaut ist, steht offen im Quellcode und in der Dokumentation.',
      facts: [
        ['server', 'Server in Deutschland', 'Die ToHuus Cloud läuft auf Servern von Hetzner in Deutschland.'],
        ['key', 'Jeder Haushalt mit eigenem Schlüssel', 'Jeder Haushalt hat eine eigene, verschlüsselte Datenbank mit eigenem Schlüssel. Fotos und Bon-Dateien sind ebenfalls verschlüsselt.'],
        ['eyeoff', 'Kein Tracking, keine Werbung', 'Eure Bons werden weder verkauft noch für Werbung ausgewertet. Auch diese Website setzt keine Cookies.'],
        ['robot', 'KI nur über Mistral', 'Bon-Fotos, Spracheingaben und der Assistent laufen über OpenRouter zu Mistral, einem Anbieter aus Frankreich. Jede Anfrage ist auf Mistral festgelegt, ohne Ausweichen auf andere Anbieter, und geht laut OpenRouter nur an Anbieter, die keine Nutzerdaten sammeln. Sprachaufnahmen werden nicht gespeichert.'],
        ['lock', 'Sensible Angaben bleiben zu Hause', 'Allergien und Angaben zu Kindern gehen nur an ein Sprachmodell, wenn ihr das ausdrücklich einschaltet.'],
        ['trash', 'Wenn ihr löscht', 'Löscht ihr den Haushalt, wird zuerst sein Schlüssel vernichtet, dann folgen die Daten und ihre Sicherungen. Sicherungskopien der Kontoverwaltung laufen nach ihrer Frist ab.'],
      ],
      link: 'Technische Details zur Cloud', linkHref: `${GH}/blob/main/docs/cloud.md`,
    },
    host: {
      label: 'Selbst hosten', h2: 'Für alle mit eigenem Server.',
      p: 'Ein Docker-Container und eine SQLite-Datei, kostenlos unter AGPL-3.0. Die iPhone-App verbindet sich mit deinem Server, im Browser läuft ToHuus als Web-App. Ein Konto bei uns brauchst du dafür nicht.',
      facts: [
        ['refresh', 'Home Assistant in beide Richtungen', 'Einkaufsliste als To-do-Liste für Assist, Sensoren für Fälliges und den Wochenplan als Kalender. Installiert über HACS, die Integration steht unter MIT-Lizenz.'],
        ['mail', 'Bon-Postfach, Telegram, Drucker', 'Bons kommen per Mail herein, „2 Milch, Brot“ im Chat landet auf der Liste, und ein Bon-Drucker in der Küche druckt sie aus.'],
        ['robot', 'KI optional', 'Mit einem Schlüssel für OpenRouter oder jeden OpenAI-kompatiblen Dienst, auch lokal. Ohne Schlüssel läuft alles außer Bon-Fotos und dem Assistenten.'],
        ['db', 'Eure Daten', 'Eine SQLite-Datei, auf Wunsch verschlüsselt, mit nächtlichen Sicherungen und Export als JSON.'],
        ['code', 'KI-Assistenten über MCP', 'Claude, ChatGPT und andere Assistenten verbinden sich über MCP direkt mit eurem Haushalt.'],
      ],
      installH: 'Installation', steps: [
        ['Holen und einstellen', 'In <code>.env</code> trägst du <code>BASE_URL</code>, deinen Namen und ein Passwort ein. Alle weiteren Optionen stehen kommentiert in <code>.env.example</code>.'],
        ['Starten', 'Mit <code>docker compose up -d --build</code>, dann <code>http://localhost:8080</code> öffnen. Die Daten liegen in <code>./data</code>.'],
        ['Leer oder mit Demo', 'Beim ersten Start wählst du, ob du leer anfängst oder dich erst mit Demo-Daten umsiehst. Die sind später mit einem Tipp wieder weg.'],
        ['HTTPS davor', 'Dein üblicher Reverse Proxy reicht. Danach die iPhone-App mit der Adresse verbinden oder die Web-App auf den Startbildschirm legen.'],
      ],
      envComment: '# en oder de',
    },
    why: {
      label: 'Warum es ToHuus gibt', word: 'To Huus', wordSub: 'Plattdeutsch für „zu Hause“.',
      ps: [
        'Ich habe ToHuus für unseren eigenen Haushalt gebaut. Bei uns wusste nur eine Person, was noch im Kühlschrank ist, was diese Woche gekocht wird und ob noch Kaffee da ist, und alle anderen haben gefragt. Das wollte ich ändern, ohne dass dafür jemand eine Tabelle pflegen muss.',
        'Den Code haben zum größten Teil KI-Agenten geschrieben. Mein Teil war, zu entscheiden, was ToHuus können soll, es bei uns im Alltag zu testen und alles wieder rauszuwerfen, was in einem echten Haushalt nicht funktioniert. Das war ehrlich gesagt eine ganze Menge.',
        'Wenn der Einkauf ohnehin digitaler wird, solltest du auch etwas davon haben. Jetzt testen die ersten Familien ToHuus, und ich bin gespannt, was davon in ihrem Alltag bleibt.',
      ],
      sig: 'Till',
    },
    faq: {
      label: 'Fragen', h2: 'Was oft gefragt wird.',
      list: [
        ['Muss ich alles abtippen?', 'Nein. Bons kommen als PDF oder Foto herein, beim Selbsthosten auch über ein eigenes Mail-Postfach. Was ihr auf der Liste abhakt, zählt ebenfalls als Einkauf. Einen Vorrat müsst ihr nicht pflegen.'],
        ['Funktioniert das ohne REWE?', 'Ja. ToHuus liest auch Bons von Lidl, Aldi, Edeka, Netto, Kaufland, Penny, dm und Rossmann, Papierbons per Foto. Wer gar keine Bons sammeln will, hakt einfach auf der Liste ab.'],
        ['Gibt es ToHuus für Android?', 'Eine eigene Android-App gibt es nicht. Im Browser läuft ToHuus als Web-App, die du auf den Startbildschirm legen kannst, auf Android genauso wie am Rechner.'],
        ['Wann kommt die iPhone-App?', 'Sie kommt bald in TestFlight, zuerst für einen kleinen Kreis von Testhaushalten. Wer selbst hostet, kann die Web-App schon heute nutzen.'],
        ['Brauche ich dafür KI?', 'Nein. Liste, Vorschläge, Kochplaner und Ausgaben funktionieren ohne. Ein Sprachmodell braucht es nur für Fotos von Papierbons und für den Assistenten.'],
        ['Brauche ich einen Thermomix?', 'Nein. Der Kochplaner zeigt Rezepte mit und ohne Thermomix, und ihr könnt danach filtern.'],
        ['Wer zahlt, wenn wir zu viert sind?', 'Ein Abo gilt für den ganzen Haushalt. Mitglieder, Kinder, Gäste und verbundene Haushalte zahlen nichts.'],
        ['Was passiert, wenn ich das Abo kündige?', 'Der Haushalt geht auf Free zurück. Gelöscht wird nichts. Ihr seht dann die letzten 60 Tage, und der Assistent hat 20 Nachrichten im Monat.'],
        ['Was passiert mit meinen Daten, wenn ich lösche?', 'Zuerst wird der Schlüssel des Haushalts vernichtet, damit ist die Datenbank nicht mehr lesbar. Danach werden die Dateien und die Sicherungen des Haushalts gelöscht. Sicherungskopien der Kontoverwaltung, die noch den verschlüsselten Schlüssel enthalten, laufen nach ihrer Frist ab.'],
        ['Ist ToHuus ein Familienkalender?', 'Nein. ToHuus kümmert sich um Einkauf, Kochen und das Geld dafür. Termine, Aufgaben mit Zuständigkeiten oder Punkte gibt es bewusst nicht.'],
      ],
    },
    foot: {
      about: 'ToHuus ist ein Angebot von Heidrich Digital.', provider: `Anbieter: ${PROVIDER}`,
      project: 'Projekt', legal: 'Rechtliches', code: 'Quellcode auf GitHub', license: 'Lizenz App: AGPL-3.0', licenseHa: 'Lizenz HA-Integration: MIT', issues: 'Fehler melden',
      imprint: 'Impressum', privacy: 'Datenschutz', terms: 'Nutzungsbedingungen', otherLang: 'English version',
      fine: 'Diese Website setzt keine Cookies, trackt nicht und lädt nichts von Dritten. Schriften: Familjen Grotesk und Hedvig Letters (SIL Open Font License), lokal ausgeliefert. Icons: Phosphor (MIT). Die Bildschirmfotos zeigen einen Demo-Haushalt mit ausgedachten Namen und Bons. ToHuus steht in keiner Verbindung zu REWE, Lidl, Aldi, Vorwerk/Thermomix, Apple oder den anderen genannten Läden und Diensten. Die Namen beschreiben nur kompatible Formate und Dienste.',
    },
  },
  en: {
    lang: 'en', locale: 'en_GB', alt: 'de_DE', url: SITE, base: '', other: 'de/', otherLang: 'de',
    title: 'ToHuus · Remembers what your home is missing',
    desc: 'ToHuus remembers for your household what is there, what is missing and what it costs, from your receipts and your list. For iPhone and the browser, in ToHuus Cloud or on your own server.',
    ogAlt: 'The ToHuus mark, the line “So one person doesn’t have to keep it all in their head.” and four drawn homes.',
    skip: 'Skip to content', navLabel: 'Main', railLabel: 'Quick navigation',
    themeLabel: 'Dark theme', homeLabel: 'ToHuus home', langLabel: 'Language', copy: 'Copy', copied: 'Copied',
    legalLabel: 'Legal', tocLabel: 'Contents', back: 'Back to the home page', ids: { jobs: 'shopping', cook: 'cooking', money: 'money', levels: 'getting-started', how: 'how-it-remembers', who: 'who', ways: 'two-ways', prices: 'pricing', privacy: 'privacy', host: 'self-hosting', why: 'why', faq: 'faq', install: 'install' },
    nav: [['#shopping', 'Shopping'], ['#cooking', 'Cooking'], ['#money', 'Money'], ['#pricing', 'Pricing'], ['#privacy', 'Privacy'], ['#self-hosting', 'Self-hosting']],
    rail: [['#shopping', 'Shopping', 'basket'], ['#cooking', 'Cooking', 'pot'], ['#money', 'Money', 'wallet'], ['#pricing', 'Pricing', 'receipt']],
    hero: {
      label: 'Shopping and household assistant',
      h1: 'So one person doesn’t have to keep it all <span class="hl">in their head.</span>',
      lede: 'ToHuus remembers for your household what is there, what is missing and what it costs. Your receipts and your shared list are all it needs.',
      ios: 'For iPhone', iosSub: 'soon on TestFlight', gh: 'Self-host from GitHub',
      facts: ['Servers in Germany (Hetzner)', 'No tracking, no ads', 'Self-hosting is free'],
      tiles: { flat: 'Flat', shared: 'Flat share', terraced: 'Terraced house', house: 'House' },
      tilesLabel: 'Four drawn homes: a flat, a flat share, terraced houses and a house.',
      shot: 'ToHuus on the iPhone, Today page: beef mince and porridge oats are due, with the note “remembers: every ~20 days, last 19 days ago”, below it the shared list with items from Mira and Sam.',
    },
    ask: {
      label: 'Do we still have …?', h2: 'Usually only one person knows.',
      p: 'Whether there is coffee left, what is for dinner this week and when the detergent runs out: in many households exactly one person knows. Everyone else asks or buys it twice. ToHuus takes that part out of one head and puts it where everybody can look.',
      p2: 'Then everyone knows what is missing, and nobody has to remember it.',
      bonTitle: 'On your mind', bonFoot: 'Now in ToHuus',
      list: ['Do we still have coffee?', 'What are we eating tonight?', 'Is there any milk left?', 'Did you get toilet roll?', 'Do we need anything for Sunday?', 'What did the shopping cost this month?'],
    },
    jobs: {
      label: 'What ToHuus does', h2: 'Shopping, cooking and money belong together.',
      intro: 'What you buy is what you cook, and that is where the money goes. So ToHuus looks after all three.',
      list: [
        { id: 'shopping', no: '1', label: 'Shopping', h3: 'ToHuus remembers what is missing.', shot: 'shopping',
          alt: 'Shopping list in ToHuus: suggestions at the top such as beef mince with “remembers: every ~12 days”, below it items sorted by section with an I’ll-get-it button and where they came from, like “Mira, today”.',
          p: 'From your receipts and what you tick off the list, ToHuus learns how often you buy things. When something is due again, it shows up as a suggestion with its reason. You do not have to keep a stock list for that.',
          points: ['One list, up to date on every phone at once', 'Whoever takes something taps “I’ll get it”', 'Sorted by aisle in the shop, even without signal'] },
        { id: 'cooking', no: '2', label: 'Cooking', h3: 'You can cook this today.', shot: 'cook',
          alt: 'Cook page: “You can cook this today” with a gnocchi skillet and roast vegetables with feta, both marked “everything is at home”, plus filters with and without Thermomix.',
          p: 'The cook planner starts with what is at home. It shows what works right now, where only one ingredient is missing and what should be used soon. Plan the week if you like, and whatever it needs goes on the list in one tap.',
          points: ['Recipes by hand, from a link or from other apps', 'With or without a Thermomix, and allergies are taken into account'] },
        { id: 'money', no: '3', label: 'Money', h3: 'You see where the money for food and household goes.', shot: 'money',
          alt: 'Money page for September 2026: £215.81 spent, £17 more than the month before, with a weekly line and bars by category below.',
          p: 'Every receipt counts. ToHuus shows what a month cost, in which shop and for which category, and compares it with the month before. You do not need to keep a ledger.',
          points: ['Spending by month, shop and category', 'Price changes on things you buy often', 'A budget, if you want one', 'CSV export'] },
      ],
    },
    levels: {
      label: 'Getting started', h2: 'However digital your shopping already is.',
      intro: 'If shopping is going digital anyway, you should get something out of it too. ToHuus works with what you already have. One of these is enough to start.',
      shot: 'import', alt: 'Imports page: receipts as PDF, photo, QR link or text, with the history of booked receipts from Tesco and Aldi below.',
      list: [
        ['receipt', 'Delivery and e-receipts', 'If you order groceries online or get digital receipts, the order and the receipt come in as a PDF. ToHuus matches them and books what was actually delivered.'],
        ['camera', 'Snap the receipt', 'For a paper receipt, a photo is enough. Anything ToHuus cannot read with confidence is shown to you for a check before it is booked.'],
        ['mic', 'Just speak', 'Tap “Speak” and say: “We are out of milk, and we need something for Sunday.” The assistant puts it on the list and tells you what it added. Every step can be undone.'],
      ],
    },
    how: {
      label: 'How it remembers', h2: 'You decide what goes on the list.',
      intro: 'ToHuus makes suggestions and never quietly writes on your list. Every line shows where it came from.',
      steps: [
        ['Collect purchases', 'Every receipt and every tick on the list counts as a purchase. No more upkeep than that.'],
        ['Spot the rhythm', 'After a few weeks ToHuus sees, for example, that you buy porridge oats about every 20 days.'],
        ['Suggest', 'When it is due again, a suggestion appears with its reason. One tap puts it on the list.'],
        ['Hold back', '“Still have it” postpones the suggestion. Turn it down twice and ToHuus stops asking.'],
      ],
      cardTitle: 'Shopping list', cardSub: 'with origins',
      rows: [['Mozzarella', 'remembers: every ~9 days', 'rhythm'], ['Baking paper', 'Mira · today 16:41', 'person'], ['2× Oat drink', 'Mira · today 16:41', 'person'], ['Parcel tape', 'Jonas · yesterday', 'person'], ['Chopped tomatoes', 'from the week plan', 'plan']],
      cardFoot: 'No line without a sender',
    },
    who: {
      label: 'Who it is for', h2: 'For every household that does a food shop.',
      intro: 'On first start ToHuus only asks who belongs to the household. What you see follows from that.',
      forms: [
        ['c', 'Just me', 'Nothing to remember, and at the end of the month you see what food and household cost.'],
        ['h', 'The two of us', 'Both of you know what is missing. Nobody has to ask whether there is coffee left.'],
        ['s', 'Family', 'Everyone writes on the same list. Children and regular guests only see what you share.'],
        ['t', 'Flat share', 'Shared things go on one list, and the others do not see private items.'],
        ['a', 'Looking after someone', 'If you shop for parents or grandparents too, connect the two households and see what is missing there.'],
      ],
      note: 'ToHuus does not assume a cellar, a chest freezer or a Thermomix. You decide which places your home has.',
    },
    ways: {
      label: 'Two ways', h2: 'In ToHuus Cloud or on your own server.',
      intro: 'It is the same app with the same code. The difference is who runs the server.',
      cols: ['ToHuus Cloud', 'Self-hosted'],
      rows: [
        ['Who for', 'Anyone who just wants to start', 'Anyone with a server, a NAS or Home Assistant'],
        ['Apps', 'iPhone app and the browser, Android included', 'iPhone app connected to your server, plus the browser'],
        ['Data', 'Servers in Germany (Hetzner), every household encrypted with its own key', 'On your server, encrypted if you like'],
        ['Receipt photos and assistant', 'Included, with an allowance per plan', 'With your own AI key, or without'],
        ['Home Assistant', 'Through the HACS integration', 'Fully, plus receipt inbox, Telegram and receipt printer on your network'],
        ['Cost', 'Free, Household or Plus', 'Free, AGPL-3.0'],
      ],
    },
    prices: {
      label: 'Pricing', h2: 'One subscription per household.',
      intro: 'Members and guests never pay. Every new household in the cloud gets 14 days of Plus, no payment details needed. When a subscription ends, the household goes back to Free and nothing is deleted.',
      per: '/ month', or: 'or', year: '/ year', storage: 'Storage',
      plans: [
        { name: 'Free', price: '€0', sub: 'for good', storage: '250 MB', items: ['Shared list with shop mode', 'Unlimited receipts', 'Remembers 60 days back', 'Recipes by hand or from a link', '20 assistant messages a month'] },
        { name: 'Household', price: '€3.99', year: '€34.99', storage: '2 GB', items: ['Everything in Free', 'The full history with prices, spending and review', 'Connected households for looking after someone', 'Import from screenshots and photos of paper lists', '100 messages a month'] },
        { name: 'Plus', price: '€5.99', year: '€59.99', storage: '5 GB', items: ['Everything in Household', 'Week plan from what is at home', 'Monthly review from the assistant', '1,500 messages a month'], mark: '14 days to try' },
        { name: 'Self-hosted', price: '€0', sub: 'AGPL-3.0', storage: 'as much as your server has', items: ['Everything unlocked', 'Your own AI key, or none', 'iPhone app and browser'], host: true },
      ],
      note: 'Launch prices. We are testing them with families and will change them if they turn out wrong. Payment runs through Apple in the iPhone app.',
    },
    privacy: {
      label: 'Privacy and security', h2: 'Your receipts work for you, not for market research.',
      intro: 'This lists only what can be checked. How the cloud is built is described openly in the source code and the documentation.',
      facts: [
        ['server', 'Servers in Germany', 'ToHuus Cloud runs on Hetzner servers in Germany.'],
        ['key', 'Every household with its own key', 'Every household has its own encrypted database with its own key. Photos and receipt files are encrypted too.'],
        ['eyeoff', 'No tracking, no ads', 'Your receipts are neither sold nor analysed for advertising. This website sets no cookies either.'],
        ['robot', 'AI only through Mistral', 'Receipt photos, voice input and the assistant go through OpenRouter to Mistral, a provider based in France. Every request is pinned to Mistral with no fallback to other providers, and according to OpenRouter only goes to providers that do not collect user data. Voice recordings are not stored.'],
        ['lock', 'Sensitive details stay at home', 'Allergies and details about children only go to a language model if you explicitly switch that on.'],
        ['trash', 'When you delete', 'When you delete the household, its key is destroyed first, then the data and its backups follow. Backup copies of the account directory expire after their retention period.'],
      ],
      link: 'Technical details about the cloud', linkHref: `${GH}/blob/main/docs/cloud.md`,
    },
    host: {
      label: 'Self-hosting', h2: 'For everyone with their own server.',
      p: 'One Docker container and one SQLite file, free under the AGPL-3.0. The iPhone app connects to your server, and in the browser ToHuus runs as a web app. You do not need an account with us.',
      facts: [
        ['refresh', 'Home Assistant, both ways', 'The shopping list as a to-do list for Assist, sensors for what is due and the week plan as a calendar. Installed via HACS, the integration is MIT licensed.'],
        ['mail', 'Receipt inbox, Telegram, printer', 'Receipts arrive by e-mail, “2 milk, bread” in a chat lands on the list, and a receipt printer in the kitchen prints it.'],
        ['robot', 'AI is optional', 'With a key for OpenRouter or any OpenAI-compatible service, local ones included. Without a key everything works except receipt photos and the assistant.'],
        ['db', 'Your data', 'One SQLite file, encrypted if you like, with nightly backups and JSON export.'],
        ['code', 'AI assistants via MCP', 'Claude, ChatGPT and other assistants connect straight to your household through MCP.'],
      ],
      installH: 'Install', steps: [
        ['Get it and set it up', 'In <code>.env</code> you fill in <code>BASE_URL</code>, your name and a password. Every other option is listed with comments in <code>.env.example</code>.'],
        ['Start it', 'Run <code>docker compose up -d --build</code>, then open <code>http://localhost:8080</code>. Your data lives in <code>./data</code>.'],
        ['Empty or demo', 'On first start you choose to begin empty or to look around with demo data first. One tap removes it later.'],
        ['Put HTTPS in front', 'Your usual reverse proxy is enough. Then connect the iPhone app to the address or add the web app to your home screen.'],
      ],
      envComment: '# en or de',
    },
    why: {
      label: 'Why ToHuus exists', word: 'To Huus', wordSub: 'Low German for “at home”.',
      ps: [
        'I built ToHuus for our own household. Only one of us knew what was still in the fridge, what we were cooking this week and whether there was coffee left, and everyone else asked. I wanted to change that without anyone having to keep a spreadsheet.',
        'Most of the code was written by AI coding agents. My part was deciding what ToHuus should do, testing it in our everyday life and throwing out everything that does not work in a real household. Honestly, that was quite a lot.',
        'If shopping is going digital anyway, you should get something out of it too. Now the first families are testing ToHuus, and I am curious what of it sticks in their everyday life.',
      ],
      sig: 'Till',
    },
    faq: {
      label: 'Questions', h2: 'What people often ask.',
      list: [
        ['Do I have to type everything in?', 'No. Receipts come in as a PDF or a photo, and when you self-host also through your own e-mail inbox. What you tick off the list counts as a purchase too. You do not have to keep a stock list.'],
        ['Does it work without online grocery delivery?', 'Yes. Paper receipts come in as a photo, and if you do not want to collect receipts at all, simply tick things off the list.'],
        ['Is there an Android app?', 'There is no separate Android app. In the browser ToHuus runs as a web app you can add to your home screen, on Android just like on a computer.'],
        ['When is the iPhone app coming?', 'Soon on TestFlight, first for a small group of test households. If you self-host, you can use the web app today.'],
        ['Do I need AI for this?', 'No. The list, suggestions, cook planner and spending all work without it. A language model is only needed for photos of paper receipts and for the assistant.'],
        ['Do I need a Thermomix?', 'No. The cook planner shows recipes with and without a Thermomix, and you can filter by it.'],
        ['Who pays if there are four of us?', 'One subscription covers the whole household. Members, children, guests and connected households pay nothing.'],
        ['What happens if I cancel?', 'The household goes back to Free. Nothing is deleted. You then see the last 60 days, and the assistant has 20 messages a month.'],
        ['What happens to my data when I delete it?', 'First the household’s key is destroyed, so the database can no longer be read. Then the household’s files and backups are deleted. Backup copies of the account directory, which still hold the encrypted key, expire after their retention period.'],
        ['Is ToHuus a family calendar?', 'No. ToHuus looks after shopping, cooking and the money for both. There are deliberately no appointments, chores with owners or points.'],
      ],
    },
    foot: {
      about: 'ToHuus is offered by Heidrich Digital.', provider: `Provider: ${PROVIDER}`,
      project: 'Project', legal: 'Legal', code: 'Source code on GitHub', license: 'App licence: AGPL-3.0', licenseHa: 'HA integration licence: MIT', issues: 'Report a bug',
      imprint: 'Imprint', privacy: 'Privacy', terms: 'Terms of use', otherLang: 'Deutsche Version',
      fine: 'This website sets no cookies, does not track you and loads nothing from third parties. Fonts: Familjen Grotesk and Hedvig Letters (SIL Open Font License), served locally. Icons: Phosphor (MIT). The screenshots show a demo household with invented names and receipts. ToHuus is not affiliated with Tesco, REWE, Lidl, Aldi, Vorwerk/Thermomix, Apple or the other shops and services named here. The names only describe compatible formats and services.',
    },
  },
};

// ---------------------------------------------------------------- screenshots
/** Every screenshot slot the page uses. The build fails when a file is missing, so no placeholder ever ships. */
const SHOTS = ['today', 'today-dark', 'shopping', 'cook', 'money', 'import'];
const WIDTHS = [480, 960];
for (const lang of Object.keys(COPY)) for (const n of SHOTS) for (const w of WIDTHS) {
  const f = path.join(ROOT, `assets/shots/${lang}/${n}-${w}.webp`);
  if (!fs.existsSync(f)) throw new Error(`missing screenshot ${path.relative(ROOT, f)}`);
}

// ---------------------------------------------------------------- building blocks
const img = (c, name, alt, { eager = false, cls = '', sizes = '(min-width: 960px) 300px, 72vw' } = {}) => {
  if (!SHOTS.includes(name)) throw new Error(`screenshot slot ${name} is not in SHOTS`);
  const src = (w) => `${c.base}assets/shots/${c.lang}/${name}-${w}.webp`;
  return `<img${cls ? ` class="${cls}"` : ''} src="${src(480)}" srcset="${WIDTHS.map((w) => `${src(w)} ${w}w`).join(', ')}" sizes="${sizes}" alt="${alt}" width="390" height="844" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
};

/** A CSS-drawn iPhone around a web screenshot. */
const device = (inner, cls = '') => `<figure class="device${cls}">
          <div class="device-screen"><span class="sb" aria-hidden="true">9:41</span>${inner}</div>
          <span class="island" aria-hidden="true"></span>
        </figure>`;

const label = (t, cls = '') => `<p class="label${cls}">${t}</p>`;

/** Document head and site header, shared by the home page and the legal pages. */
const pageTop = (c, m, b = c.base) => `<!doctype html>
<html lang="${c.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${m.title}</title>
<meta name="description" content="${m.desc}">
<link rel="canonical" href="${m.url}">
<link rel="alternate" hreflang="en" href="${m.alt.en}">
<link rel="alternate" hreflang="de" href="${m.alt.de}">
<link rel="alternate" hreflang="x-default" href="${m.alt.en}">
<meta name="theme-color" content="#f7f5ef">
<meta name="color-scheme" content="light dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ToHuus">
<meta property="og:title" content="${m.title}">
<meta property="og:description" content="${m.desc}">
<meta property="og:url" content="${m.url}">
<meta property="og:image" content="${SITE}assets/img/og-${c.lang}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${c.ogAlt}">
<meta property="og:locale" content="${c.locale}">
<meta property="og:locale:alternate" content="${c.alt}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${m.title}">
<meta name="twitter:description" content="${m.desc}">
<meta name="twitter:image" content="${SITE}assets/img/og-${c.lang}.png">
<link rel="icon" href="${b}assets/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${b}assets/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="${b}assets/apple-touch-icon.png">
<link rel="preload" href="${b}assets/fonts/familjen-grotesk-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${b}assets/fonts/hedvig-letters-serif-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${b}assets/site.css">
<script>(function(){var d=document.documentElement;d.classList.add('js');var t=null;try{t=localStorage.getItem('tohuus.site.theme')}catch(e){}d.setAttribute('data-theme',t==='dark'?'dark':'light')})()</script>
${m.ld ? `<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareApplication","name":"ToHuus","description":"${c.desc}","applicationCategory":"LifestyleApplication","operatingSystem":"iOS, Web, Docker","license":"https://www.gnu.org/licenses/agpl-3.0.html","url":"${c.url}","image":"${SITE}assets/img/og-${c.lang}.png","codeRepository":"${GH}","inLanguage":["en","de"],"publisher":{"@type":"Organization","name":"Heidrich Digital","url":"https://heidrich-digital.de"}}
</script>
` : ''}</head>
<body${m.bodyClass ? ` class="${m.bodyClass}"` : ''}>
${sprite}
<a class="skip" href="#main">${c.skip}</a>

<header class="nav-wrap">
<div class="nav">
  <a class="brand" href="./" aria-label="${c.homeLabel}">${brandMark(28)}<span>ToHuus</span></a>
  <nav class="nav-links" aria-label="${c.navLabel}">
${c.nav.map(([href, l]) => `    <a href="${m.navBase}${href}">${l}</a>`).join('\n')}
  </nav>
  <div class="lang" role="group" aria-label="${c.langLabel}">
    <a href="${m.enHref}" hreflang="en" lang="en"${c.lang === 'en' ? ' aria-current="true"' : ''}>EN</a>
    <a href="${m.deHref}" hreflang="de" lang="de"${c.lang === 'de' ? ' aria-current="true"' : ''}>DE</a>
  </div>
  <button class="icon-btn theme-btn" type="button" aria-label="${c.themeLabel}" aria-pressed="false">${ico('moon', 'ico moon')}${ico('sun', 'ico sun')}</button>
</div>
</header>

`;

/** Site footer, shared by the home page and the legal pages. */
const pageFoot = (c, m) => `<footer class="foot">
  <div class="wrap">
    <div class="foot-grid">
      <div>
        <a class="brand" href="./">${brandMark(26)}<span>ToHuus</span></a>
        <p>${c.foot.about}<br>${c.foot.provider}</p>
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
          <li><a href="${LEGAL[c.lang].privacy.file}">${c.foot.privacy}</a></li>
          <li><a href="${LEGAL[c.lang].terms.file}">${c.foot.terms}</a></li>
          <li><a href="${m.otherHref}" hreflang="${c.otherLang}">${c.foot.otherLang}</a></li>
        </ul>
      </div>
    </div>
    <p class="fine">${c.foot.fine}</p>
  </div>
</footer>`;

/** Per-page values for the home page of a language. */
const homeMeta = (c) => ({
  title: c.title, desc: c.desc, url: c.url, alt: { en: SITE, de: `${SITE}de/` }, ld: true, navBase: '',
  enHref: c.lang === 'en' ? './' : '../', deHref: c.lang === 'de' ? './' : 'de/', otherHref: c.other,
});

function page(c) {
  const b = c.base;
  const id = c.ids;
  const H = c.hero;
  const A = c.ask;
  const J = c.jobs;
  const L = c.levels;
  const W = c.how;
  const F = c.who;
  const T = c.ways;
  const P = c.prices;
  const D = c.privacy;
  const S = c.host;
  const Y = c.why;
  const Q = c.faq;
  const m = homeMeta(c);
  return `${pageTop(c, m)}<main id="main">

<section class="hero" aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      ${label(H.label)}
      <h1 id="hero-h">${H.h1}</h1>
      <p class="lede">${H.lede}</p>
      <div class="ctas">
        <a class="btn primary" href="#${id.ways}">${ico('apple')}<span class="btn-2"><b>${H.ios}</b><small>${H.iosSub}</small></span><span class="tail">${ico('arrow')}</span></a>
        <a class="btn" href="${GH}">${ico('github')}${H.gh}</a>
      </div>
      <ul class="facts">${H.facts.map((f) => `<li>${ico('check')}${f}</li>`).join('')}</ul>
    </div>
    <div class="hero-art">
      ${homeTiles(H.tiles, H.tilesLabel)}
      ${device(`${img(c, 'today', H.shot, { eager: true, cls: 'light-only', sizes: '(min-width: 960px) 310px, 64vw' })}${img(c, 'today-dark', H.shot, { cls: 'dark-only', sizes: '(min-width: 960px) 310px, 64vw' })}`, ' hero-device')}
    </div>
  </div>
</section>

<section class="ask" aria-labelledby="ask-h">
  <div class="wrap ask-grid">
    <div>
      ${label(A.label, ' reveal')}
      <h2 class="reveal" id="ask-h">${A.h2}</h2>
      <p class="intro reveal">${A.p}</p>
      <p class="pull reveal">${A.p2}</p>
    </div>
    <div class="receipt reveal" role="group" aria-label="${A.bonTitle}">
      <div class="receipt-h"><b>${A.bonTitle}</b><span aria-hidden="true">ToHuus</span></div>
      <ul>
${A.list.map((q) => `        <li><s>${q}</s>${ico('check', 'ico ok')}</li>`).join('\n')}
      </ul>
      <p class="receipt-f">${A.bonFoot}</p>
    </div>
  </div>
</section>

<section class="jobs" aria-labelledby="jobs-h">
  <div class="wrap">
    <div class="sec-head">
      ${label(J.label, ' reveal')}
      <h2 class="reveal" id="jobs-h">${J.h2}</h2>
      <p class="intro reveal">${J.intro}</p>
    </div>
${J.list.map((j, k) => `    <article class="job${k % 2 ? ' flip' : ''}" id="${j.id}" aria-labelledby="${j.id}-h">
      <div class="job-copy reveal">
        <p class="job-no"><span>${j.no}</span>${j.label}</p>
        <h3 id="${j.id}-h">${j.h3}</h3>
        <p>${j.p}</p>
        <ul class="ticks">${j.points.map((p) => `<li>${ico('check')}<span>${p}</span></li>`).join('')}</ul>
      </div>
      <div class="job-visual reveal">
        <span class="job-shape s${k + 1}" aria-hidden="true"></span>
        ${device(img(c, j.shot, j.alt))}
      </div>
    </article>`).join('\n')}
  </div>
</section>

<section class="levels" id="${id.levels}" aria-labelledby="levels-h">
  <div class="wrap">
    <div class="block">
      <span class="disc" aria-hidden="true"></span><span class="half" aria-hidden="true"></span>
      <div class="block-copy">
        <p class="label on-block">${bird()}${L.label}</p>
        <h2 id="levels-h">${L.h2}</h2>
        <p class="block-intro">${L.intro}</p>
        <ol class="level-list">
${L.list.map(([i, t, s], k) => `          <li class="reveal" style="--d:${k * 70}ms"><span class="lv-ico">${ico(i)}</span><div><b>${t}</b><span>${s}</span></div></li>`).join('\n')}
        </ol>
      </div>
      <div class="block-phone">${device(img(c, L.shot, L.alt, { sizes: '(min-width: 960px) 300px, 70vw' }), ' cut')}</div>
    </div>
  </div>
</section>

<section class="how" id="${id.how}" aria-labelledby="how-h">
  <div class="wrap how-grid">
    <div>
      ${label(W.label, ' reveal')}
      <h2 class="reveal" id="how-h">${W.h2}</h2>
      <p class="intro reveal">${W.intro}</p>
      <ol class="how-steps">
${W.steps.map(([t, s], k) => `        <li class="reveal" style="--d:${k * 60}ms"><b>${t}</b><span>${s}</span></li>`).join('\n')}
      </ol>
    </div>
    <div class="ticket origin reveal" role="group" aria-label="${W.cardTitle}">
      <div class="ticket-top">
        <p class="origin-h"><b>${W.cardTitle}</b><span>${W.cardSub}</span></p>
        <ul class="origin-rows">
${W.rows.map(([t, o, k]) => `          <li class="o-${k}"><span class="box" aria-hidden="true"></span><span class="o-t">${t}</span><span class="o-o">${o}</span></li>`).join('\n')}
        </ul>
      </div>
      <div class="tear" aria-hidden="true"></div>
      <p class="origin-f">${W.cardFoot}</p>
    </div>
  </div>
</section>

<section class="who" id="${id.who}" aria-labelledby="who-h">
  <div class="wrap">
    <div class="sec-head">
      ${label(F.label, ' reveal')}
      <h2 class="reveal" id="who-h">${F.h2}</h2>
      <p class="intro reveal">${F.intro}</p>
    </div>
    <ul class="forms">
${F.forms.map(([shape, t, s], k) => `      <li class="reveal" style="--d:${k * 50}ms"><span class="shape ${shape}" aria-hidden="true"></span><b>${t}</b><span>${s}</span></li>`).join('\n')}
    </ul>
    <p class="note reveal">${F.note}</p>
  </div>
</section>

<section class="ways" id="${id.ways}" aria-labelledby="ways-h">
  <div class="wrap">
    <div class="sec-head">
      ${label(T.label, ' reveal')}
      <h2 class="reveal" id="ways-h">${T.h2}</h2>
      <p class="intro reveal">${T.intro}</p>
    </div>
    <div class="table-wrap reveal">
      <table class="compare">
        <thead><tr><td></td><th scope="col">${ico('cloud')}${T.cols[0]}</th><th scope="col">${ico('server')}${T.cols[1]}</th></tr></thead>
        <tbody>
${T.rows.map(([h, a, z]) => `          <tr><th scope="row">${h}</th><td data-col="${T.cols[0]}">${a}</td><td data-col="${T.cols[1]}">${z}</td></tr>`).join('\n')}
        </tbody>
      </table>
    </div>
  </div>
</section>

<section class="prices" id="${id.prices}" aria-labelledby="prices-h">
  <div class="wrap">
    <div class="sec-head">
      ${label(P.label, ' reveal')}
      <h2 class="reveal" id="prices-h">${P.h2}</h2>
      <p class="intro reveal">${P.intro}</p>
    </div>
    <ul class="plans">
${P.plans.map((p, k) => `      <li class="plan${p.host ? ' host' : ''}${p.mark ? ' marked' : ''} reveal" style="--d:${k * 60}ms">
        ${p.mark ? `<span class="plan-mark">${p.mark}</span>` : ''}
        <h3>${p.name}</h3>
        <p class="price"><b>${p.price}</b>${p.year ? `<span>${P.per}</span>` : `<span>${p.sub}</span>`}</p>
        ${p.year ? `<p class="price-y">${P.or} ${p.year} ${P.year}</p>` : '<p class="price-y" aria-hidden="true">&nbsp;</p>'}
        <ul>${p.items.map((x) => `<li>${ico('check')}<span>${x}</span></li>`).join('')}</ul>
        <p class="storage"><span>${P.storage}</span><b>${p.storage}</b></p>
      </li>`).join('\n')}
    </ul>
    <p class="note reveal">${P.note}</p>
  </div>
</section>

<section class="privacy" id="${id.privacy}" aria-labelledby="privacy-h">
  <div class="wrap">
    <div class="sec-head">
      ${label(D.label, ' reveal')}
      <h2 class="reveal" id="privacy-h">${D.h2}</h2>
      <p class="intro reveal">${D.intro}</p>
    </div>
    <dl class="facts-grid">
${D.facts.map(([i, t, s], k) => `      <div class="reveal" style="--d:${(k % 3) * 60}ms"><span class="pi">${ico(i)}</span><dt>${t}</dt><dd>${s}</dd></div>`).join('\n')}
    </dl>
    <p class="more reveal"><a href="${D.linkHref}">${D.link}${ico('arrow')}</a></p>
  </div>
</section>

<section class="host" id="${id.host}" aria-labelledby="host-h">
  <div class="wrap host-grid">
    <div>
      ${label(S.label, ' reveal')}
      <h2 class="reveal" id="host-h">${S.h2}</h2>
      <p class="intro reveal">${S.p}</p>
      <dl class="facts-list">
${S.facts.map(([i, t, s]) => `        <div class="reveal">${ico(i)}<dt>${t}</dt><dd>${s}</dd></div>`).join('\n')}
      </dl>
    </div>
    <div class="ticket install reveal" id="${id.install}">
      <div class="ticket-top">
        <h3>${S.installH}</h3>
        <ol class="steps">
${S.steps.map(([t, s]) => `          <li><b>${t}</b><span>${s}</span></li>`).join('\n')}
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
<span class="k">LANGUAGE</span>=${c.lang} <span class="c">${S.envComment}</span>
<span class="k">TZ</span>=Europe/Berlin</pre>
      </div>
    </div>
  </div>
</section>

<section class="why" id="${id.why}" aria-labelledby="why-h">
  <div class="wrap why-grid">
    <div class="reveal">
      ${label(Y.label)}
      <p class="word" id="why-h">${Y.word}<small>${Y.wordSub}</small></p>
    </div>
    <div class="reveal">
${Y.ps.map((p) => `      <p>${p}</p>`).join('\n')}
      <p class="sig">${Y.sig}</p>
    </div>
  </div>
</section>

<section class="faq" id="${id.faq}" aria-labelledby="faq-h">
  <div class="wrap faq-grid">
    <div class="sec-head">
      ${label(Q.label, ' reveal')}
      <h2 class="reveal" id="faq-h">${Q.h2}</h2>
    </div>
    <div class="qa">
${Q.list.map(([q, a]) => `      <details class="reveal"><summary>${q}${ico('plus', 'ico pm')}</summary><p>${a}</p></details>`).join('\n')}
    </div>
  </div>
</section>

</main>

${pageFoot(c, m)}

<nav class="rail" aria-label="${c.railLabel}">
${c.rail.map(([href, l, i]) => `  <a href="${href}">${ico(i)}<span>${l}</span></a>`).join('\n')}
</nav>

<script src="${b}assets/site.js" defer></script>
</body>
</html>
`;
}

/** One legal page (privacy or terms) in the site's design. `kind` is 'privacy' or 'terms'. */
function legalPage(c, kind) {
  const d = LEGAL[c.lang][kind];
  const otherKind = kind === 'privacy' ? 'terms' : 'privacy';
  const pair = (lang) => `${SITE}${lang === 'de' ? 'de/' : ''}${LEGAL[lang][kind].file}`;
  const m = {
    title: d.title, desc: d.desc, url: pair(c.lang), alt: { en: pair('en'), de: pair('de') }, ld: false, navBase: './',
    bodyClass: 'legal-page',
    enHref: c.lang === 'en' ? d.file : `../${LEGAL.en[kind].file}`, deHref: c.lang === 'de' ? d.file : `de/${LEGAL.de[kind].file}`,
    otherHref: c.lang === 'en' ? `de/${LEGAL.de[kind].file}` : `../${LEGAL.en[kind].file}`,
  };
  const other = LEGAL[c.lang][otherKind];
  return `${pageTop(c, m)}
<main id="main" class="legal">

<section class="legal-head" aria-labelledby="legal-h">
  <div class="wrap">
    ${label(c.legalLabel)}
    <h1 id="legal-h">${d.h1}</h1>
    <p class="legal-status">${LEGAL_STATUS[c.lang]}</p>
    ${d.note ? `<p class="legal-note">${d.note}</p>` : ''}
  </div>
</section>

<div class="wrap legal-grid">
  <nav class="legal-toc" aria-labelledby="toc-h">
    <p class="label" id="toc-h">${c.tocLabel}</p>
    <ol>
${d.sections.map((x, k) => `      <li><a href="#${x.id}"><span>${k + 1}</span>${x.h}</a></li>`).join('\n')}
    </ol>
    <p class="legal-links"><a href="${other.file}">${other.h1}${ico('arrow')}</a><a href="./">${c.back}${ico('arrow')}</a></p>
  </nav>
  <div class="legal-body">
    <div class="legal-summary" role="group" aria-label="${d.summaryH}">
      <p class="legal-summary-h">${d.summaryH}</p>
      <ul>${d.summary.map((x) => `<li>${ico('check')}<span>${x}</span></li>`).join('')}</ul>
    </div>
${d.sections.map((x, k) => `    <section id="${x.id}" aria-labelledby="${x.id}-h">
      <h2 id="${x.id}-h"><span class="legal-no">${k + 1}</span>${x.h}</h2>
      ${x.body}
    </section>`).join('\n')}
  </div>
</div>

</main>

${pageFoot(c, m)}

<script src="${c.base}assets/site.js" defer></script>
</body>
</html>
`;
}

// guards: house style (no em or en dashes, except in the required provider line) and no family names
const LEGAL_KINDS = ['privacy', 'terms'];
const checkText = (html, where, tillCount, extra = '') => {
  const s = html.replace(sprite, '').split(PROVIDER).join('');
  const all = s + extra.split(PROVIDER).join('');
  if (all.includes('—')) throw new Error(`em dash in ${where}`);
  if (all.includes('–')) throw new Error(`en dash in ${where}`);
  const text = s.replace(/https?:\/\/[^\s"'<)]+/g, '').replace(/mailto:[^\s"'<)]+/g, '').replace(/[\w.+-]+@[\w.-]+/g, '').replace(/heidrich-digital|Heidrich Digital/g, '');
  const bad = text.match(/\b(Lea|Felix|Heidrich|Mila)\b/);
  if (bad) throw new Error(`family name "${bad[0]}" in ${where}`);
  if ((text.match(/\bTill\b/g) ?? []).length !== tillCount) throw new Error(`"Till" must appear exactly ${tillCount}× in ${where}`);
};
for (const c of Object.values(COPY)) {
  checkText(page(c), `${c.lang} page`, 1, JSON.stringify(c));
  for (const kind of LEGAL_KINDS) {
    const html = legalPage(c, kind);
    checkText(html, `${c.lang} ${kind} page`, 0);
    if (!html.includes(LEGAL_STATUS[c.lang])) throw new Error(`draft status line missing on ${c.lang} ${kind} page`);
    // every in-page link points at a section that exists
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) if (id !== 'main' && !html.includes(`id="${id}"`)) throw new Error(`broken anchor #${id} in ${c.lang} ${kind} page`);
  }
}
fs.writeFileSync(path.join(ROOT, 'index.html'), page(COPY.en));
fs.mkdirSync(path.join(ROOT, 'de'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'de/index.html'), page(COPY.de));
for (const c of Object.values(COPY)) for (const kind of LEGAL_KINDS) {
  fs.writeFileSync(path.join(ROOT, c.lang === 'de' ? 'de' : '', LEGAL[c.lang][kind].file), legalPage(c, kind));
}
console.log(`built site/index.html, site/de/index.html and the legal pages (${LEGAL_KINDS.map((k) => `${LEGAL.en[k].file}, de/${LEGAL.de[k].file}`).join(', ')})`);

/*
 * Refreshing the screenshots (Playwright + sharp in a scratch folder outside the repo):
 *   1. npm run build
 *   2. per language a fresh self-hosted server with invented people:
 *      DATA_DIR=/tmp/site-<lang> SEED_DEMO=true ADMIN_NAME=Sam ADMIN_PASSWORD=demo12345 LANGUAGE=de REGION=DE
 *      PORT=8095 BASE_URL=http://localhost:8095 node dist/server.mjs   (English: LANGUAGE=en REGION=GB, port 8096)
 *   3. upload about four months of generated receipts (REWE/Lidl/Aldi/dm in German, Tesco/Lidl/Aldi/Boots in English)
 *      as text through POST /api/imports/upload and apply each (POST /api/imports/:id/apply), so the purchase rhythm,
 *      the money page and the suggestions have real data; add the members Mira and Jonas (POST /api/users), let Mira
 *      add two items, accept one rhythm suggestion (POST /api/rhythm/:id/accept), skip the tour (PUT /api/tour)
 *   4. shoot /, /einkauf, /kochen, /geld (previous month), /import and / in dark at 390x844, deviceScaleFactor 3,
 *      household theme via PATCH /api/appearance/household, with .demo-banner hidden
 *   5. convert to webp at 480 and 960 px wide into site/assets/shots/<lang>/<name>-<w>.webp
 *   Never use real names. Check every image before committing.
 *
 * OG images (site/assets/img/og-<lang>.png, 1200x630): a 1200x630 page with the wordmark, the hero headline and
 * homeTiles(), styled by site.css and screenshotted with Playwright from the served site/ folder.
 */
