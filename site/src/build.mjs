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
import { helpCopy } from './help.mjs';
import { BLOG_COPY, BLOG_DIR, checkPost, publishedPosts } from './blog.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = 'https://tohuus.heidrich-digital.de/';
const GH = 'https://github.com/tillheidrich/tohuus-hub';
/** Required provider line (Impressum). The only place where the en dash is allowed. */
const PROVIDER = 'Till Heidrich – Content Creation';
/** Contact data of the provider for the legal pages (Datenschutz, Nutzungsbedingungen). */
const CONTACT = { MAIL: 'mail@tillheidrich.de', PHONE: '0157 73953819', ADDRESS: ['Rotdornweg 17', '21255 Tostedt'], CLOUD: 'https://cloud.tohuus.heidrich-digital.de' };
const LEGAL = legalCopy({ PROVIDER, SITE, GH, ...CONTACT });
/** TestFlight: a prefilled e-mail asks for what we need to invite someone (no form, no tracking). */
const TF_MAIL = 'tohuus@tillheidrich.de';
const tfHref = (lang) => {
  const body = lang === 'de'
    ? 'Hallo,\n\nich hätte gern einen TestFlight-Platz für ToHuus.\n\nApple-ID-E-Mail für TestFlight: \nWie viele Personen im Haushalt: \nWo wir meistens einkaufen: \niPhone-Modell: \n\nViele Grüße\n'
    : 'Hello,\n\nI would like a TestFlight place for ToHuus.\n\nApple ID e-mail for TestFlight: \nHow many people in the household: \nWhere we usually shop: \niPhone model: \n\nBest wishes\n';
  return `mailto:${TF_MAIL}?subject=${encodeURIComponent('ToHuus TestFlight')}&body=${encodeURIComponent(body)}`;
};
/** Help section: German at site/hilfe/, English at site/help/ (help.mjs). From the home and legal pages: */
const HELP_DIR = { de: 'hilfe', en: 'help' };
const helpIndexHref = (lang) => (lang === 'de' ? `../${HELP_DIR.de}/` : `${HELP_DIR.en}/`);
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
  power: 'Power', plug: 'Plug', house: 'House', question: 'Question', scan: 'Scan', watch: 'Watch', image: 'ImageSquare', share: 'ShareNetwork',
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
    legalLabel: 'Rechtliches', tocLabel: 'Inhalt', back: 'Zur Startseite', ids: { jobs: 'einkauf', cook: 'kochen', money: 'geld', levels: 'einstieg', how: 'so-merkt-es-sich', who: 'fuer-wen', ways: 'zwei-wege', prices: 'preise', privacy: 'datenschutz', host: 'selbst-hosten', why: 'warum', faq: 'fragen', install: 'installieren', tf: 'testflight', ha: 'home-assistant' },
    nav: [['#einkauf', 'Einkauf'], ['#kochen', 'Kochen'], ['#geld', 'Geld'], ['#bring-mir-was', 'Bring mir was'], ['#preise', 'Preise'], ['#datenschutz', 'Datenschutz'], ['#selbst-hosten', 'Selbst hosten'], ['HELP', 'Hilfe']],
    rail: [['#einkauf', 'Einkauf', 'basket'], ['#kochen', 'Kochen', 'pot'], ['#geld', 'Geld', 'wallet'], ['#preise', 'Preise', 'receipt']],
    hero: {
      label: 'Einkaufs- und Haushaltsassistent',
      h1: 'Damit nicht einer alles <span class="hl">im Kopf</span> haben muss.',
      lede: 'ToHuus merkt sich für euren Haushalt, was da ist, was fehlt und was es kostet. Dafür reichen eure Kassenbons und eure gemeinsame Liste.',
      ios: 'TestFlight-Platz anfragen', iosSub: 'iPhone-App, kleiner Testkreis', gh: 'Selbst hosten auf GitHub',
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
      intro: 'Aus dem, was ihr einkauft, wird gekocht, und dafür geht das Geld weg. Deshalb kümmert sich ToHuus um alle drei. Und um das, was ein Zuhause sonst noch ausmacht: einander was Gutes tun und Wünsche festhalten.',
      list: [
        { id: 'einkauf', no: '1', label: 'Einkauf', h3: 'ToHuus merkt sich, was fehlt.', shot: 'shopping',
          alt: 'Einkaufsliste in ToHuus: oben Vorschläge wie Hackfleisch mit „merkt sich: alle ~12 Tage“, darunter nach Bereichen sortierte Einträge mit Ich-hol’s-Knopf und Herkunft wie „Mira, heute“.',
          p: 'Aus euren Bons und dem, was ihr auf der Liste abhakt, sieht ToHuus, wie oft ihr etwas kauft. Ist es wieder so weit, erscheint es als Vorschlag mit Grund. Einen Vorrat müsst ihr dafür nicht führen.',
          points: ['Eine Liste, live auf allen Handys, auch während einer im Laden steht', 'Wer etwas übernimmt, tippt auf „Ich hol’s“', 'Im Laden nach Gängen sortiert, auch ohne Netz'] },
        { id: 'kochen', no: '2', label: 'Kochen', h3: 'Daraus könnt ihr heute kochen.', shot: 'cook',
          alt: 'Seite Kochen: „Daraus könnt ihr heute kochen“ mit Gnocchi-Pfanne und Ofengemüse mit Feta, beide mit „Alles da“, dazu Filter mit und ohne Thermomix.',
          p: 'Der Kochplaner fängt bei dem an, was zu Hause ist. Er zeigt, was sofort geht, wo nur eine Zutat fehlt und was bald weg muss. Wer mag, plant die Woche, und was dafür fehlt, kommt mit einem Tipp auf die Liste.',
          points: ['Rezepte von Hand, per Link, vom Foto oder aus anderen Apps', 'Viele auf einmal als Rezeptpaket, auch von deiner eigenen KI gebaut', 'Mit und ohne Thermomix, Allergien werden beim Vorschlagen berücksichtigt'] },
        { id: 'geld', no: '3', label: 'Geld', h3: 'Ihr seht, wohin das Geld für Essen und Haushalt geht.', shot: 'money',
          alt: 'Seite Geld für September 2026: 215,81 Euro ausgegeben, 17 Euro mehr als im Vormonat, darunter ein Wochenverlauf und Balken nach Kategorie.',
          p: 'Jeder Bon zählt mit. ToHuus zeigt, was ein Monat gekostet hat, in welchem Laden und für welche Kategorie, und vergleicht mit dem Vormonat. Ein Haushaltsbuch müsst ihr dafür nicht führen.',
          points: ['Ausgaben nach Monat, Laden und Kategorie', 'Preisänderungen bei Dingen, die ihr oft kauft', 'Budgets pro Woche, Monat oder Jahr, für alle oder nur für dich, mit Hinweis bei 80 Prozent', 'Export als CSV'] },
        { id: 'bring-mir-was', no: '4', label: 'Bring mir was', h3: 'Einer liegt auf dem Sofa, einer steht in der Küche.', shot: 'treats',
          alt: 'Seite Bring mir was: „Was hättest du gern?“, darunter Karten wie Was Süßes, Was zu trinken, Was zum Knabbern und Aus dem Kühlschrank, dazu die Reiter Gäste und Party.',
          p: 'Wer gerade festsitzt, im Bett, beim Zubettbringen oder mit Kind auf dem Arm, wünscht sich mit zwei Tipps eine Kleinigkeit. Die anderen sehen es sofort, einer sagt „Bring ich“, und die Hauskarte zeigt nur, was wirklich da ist. Für Besuch gibt es eine eigene Karte, und am Partyabend bestellen die Gäste direkt von eurer Partykarte.',
          points: ['Eure eigene Hauskarte: Süßes, Getränke, Snacks, aus dem Kühlschrank', 'Gäste wünschen sich etwas über einen Link, ganz ohne App', 'Party: ihr seht, was bestellt ist und was noch da ist'] },
        { id: 'wuensche', no: '5', label: 'Wünsche', h3: 'Wunschlisten, die nichts verraten.', shot: 'wishes',
          alt: 'Seite Wünsche: Listen „Weihnachten für Mika“ mit drei Wünschen, zwei davon vergeben, und die Merkliste „Neue Kekse & Fundstücke“.',
          p: 'Geburtstag, Weihnachten oder einfach eine Merkliste: Wünsche mit Foto, mehreren Links, Preis und Notiz. Wer etwas reserviert, sieht der Rest der Familie, die beschenkte Person aber nie. Eine Liste lässt sich ganz oder in Teilen per Nachricht verschicken.',
          points: ['Foto, Links, Preis und „wer könnte das schenken“', 'Private Listen, die nur du siehst', 'Teilen als Link oder fertige Nachricht'] },
      ],
    },
    levels: {
      label: 'Einstieg', h2: 'Egal, wie digital ihr schon einkauft.',
      intro: 'Wenn der Einkauf digitaler wird, solltest du auch etwas davon haben. ToHuus arbeitet mit dem, was ihr ohnehin habt. Für den Anfang reicht einer dieser Wege.',
      shot: 'import', alt: 'Seite Importe: Bons als PDF, Foto, QR-Link oder Text, darunter der Verlauf mit gebuchten Bons von REWE und Aldi.',
      list: [
        ['receipt', 'Lieferdienst und eBon', 'Bestellt ihr bei REWE oder bekommt ihr digitale Bons, kommen Bestellung und Bon als PDF herein. ToHuus gleicht beides ab und bucht, was wirklich geliefert wurde.'],
        ['camera', 'Bon fotografieren', 'Bei Aldi, Lidl oder auf Papier reicht ein Foto vom Bon. Was ToHuus nicht sicher lesen kann, legt es dir zum Prüfen vor, bevor etwas gebucht wird. Die Texterkennung läuft ohne KI, auf dem Server oder direkt auf deinem iPhone.'],
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
        ['Apps', 'iPhone-App und im Browser, auch auf Android. iPad und Apple Watch kommen mit der App', 'Im Browser als Web-App (auch auf dem Startbildschirm), dazu Home Assistant und eigene Assistenten über MCP. Die iPhone-App gibt es nur für die Cloud'],
        ['Daten', 'Server in Deutschland (Hetzner), jeder Haushalt mit eigenem Schlüssel verschlüsselt', 'Auf deinem Server, auf Wunsch verschlüsselt'],
        ['Bon-Fotos und Assistent', 'Dabei, mit Kontingent je nach Tarif. KI abschaltbar für Haushalt, Person und Kinder', 'Mit eigenem KI-Schlüssel oder ganz ohne'],
        ['Claude, ChatGPT (MCP)', 'Über MCP mit Anmeldung (OAuth)', 'Über MCP mit Zugangsschlüssel'],
        ['Home Assistant', 'Über die HACS-Integration, verbunden mit einem Code aus der App', 'Voll, dazu Bon-Postfach, Telegram und Bon-Drucker im eigenen Netz'],
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
        { name: 'Selbst hosten', price: '0 €', sub: 'AGPL-3.0', storage: 'so viel dein Server hat', items: ['Alles freigeschaltet', 'Eigener KI-Schlüssel oder keiner', 'Web-App im Browser, Home Assistant, MCP'], host: true },
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
        ['power', 'KI lässt sich abschalten', 'Für den ganzen Haushalt, nur für dich oder für einzelne Kinder. Dann geht keine Anfrage an ein Sprachmodell, und Liste, Vorschläge, Kochen und Geld laufen weiter.'],
        ['scan', 'Texterkennung ohne KI', 'Bon-Fotos liest zuerst eine Texterkennung ohne Sprachmodell auf dem Server, oder dein iPhone liest sie selbst und schickt nur den Text. Nur wenn das nicht aufgeht und KI an ist, liest Mistral das Foto.'],
        ['plug', 'Eure Assistenten nur, wenn ihr wollt', 'Claude oder ChatGPT verbindet ihr selbst über MCP. Diskrete Einträge sehen sie nur als Platzhalter, und ein Admin kann MCP abschalten.'],
        ['trash', 'Wenn ihr löscht', 'Löscht ihr den Haushalt, wird zuerst sein Schlüssel vernichtet, dann folgen die Daten und ihre Sicherungen. Sicherungskopien der Kontoverwaltung laufen nach ihrer Frist ab.'],
      ],
      link: 'Technische Details zur Cloud', linkHref: `${GH}/blob/main/docs/cloud.md`,
    },
    host: {
      label: 'Selbst hosten', h2: 'Für alle mit eigenem Server.',
      p: 'Ein Docker-Container und eine SQLite-Datei, kostenlos unter AGPL-3.0. Im Browser läuft ToHuus als Web-App, die du auf den Startbildschirm legen kannst. Die iPhone-App ist für die ToHuus Cloud gedacht. Ein Konto bei uns brauchst du dafür nicht.',
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
        ['HTTPS davor', 'Dein üblicher Reverse Proxy reicht. Danach die Web-App im Browser öffnen und auf den Startbildschirm legen.'],
      ],
      envComment: '# en oder de',
    },
    tf: {
      label: 'iPhone-App', h2: 'Teste die iPhone-App mit.',
      p: 'Die iPhone-App ist im Test über TestFlight, das Testprogramm von Apple. Der Kreis ist klein und geschlossen, die Teilnahme kostet nichts. Wir suchen Haushalte, die ToHuus im Alltag nutzen und ehrlich sagen, was hakt.',
      points: ['Kleiner, geschlossener Kreis', 'Kostenlos', 'Rückmeldung ausdrücklich erwünscht, auch Kritik', 'iPad und Apple Watch kommen mit der App'],
      cardTitle: 'Was wir für die Einladung brauchen', cardSub: 'steht schon in der Mail',
      rows: ['Deine Apple-ID-E-Mail für TestFlight', 'Wie viele Personen im Haushalt leben', 'Wo ihr meistens einkauft', 'Welches iPhone du hast'],
      cta: 'TestFlight-Platz anfragen', ctaSub: 'öffnet eine vorbereitete Mail',
      note: 'Wir nutzen die Angaben nur für die Einladung und den Test.',
    },
    ha: {
      label: 'Home Assistant', h2: 'ToHuus in Home Assistant.',
      p: 'Die Integration bringt die Einkaufsliste als To-do-Liste, Sensoren für Fälliges, die Liste und die Ausgaben, den Wochenplan als Kalender und ToHuus-Mitteilungen nach Home Assistant. Verbunden wird mit einem Code aus der App, für die ToHuus Cloud genauso wie für den eigenen Server. Home Assistant baut die Verbindung selbst auf, bei dir zu Hause muss nichts aus dem Internet erreichbar sein.',
      steps: [
        ['Über HACS installieren', 'Benutzerdefiniertes Repository <code>tillheidrich/tohuus-hub-ha</code>, Typ Integration.'],
        ['Code in ToHuus holen', 'Einstellungen › Home Assistant › „Home Assistant verbinden“. Der Code gilt 10 Minuten.'],
        ['Integration hinzufügen', 'ToHuus Cloud oder eigener Server wählen und den Code eingeben.'],
      ],
      link: 'Schritt für Schritt, mit Beispiel-Dashboard',
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
      label: 'Fragen', h2: 'Was oft gefragt wird.', more: 'Mehr Antworten in Hilfe & Tipps',
      list: [
        ['Muss ich alles abtippen?', 'Nein. Bons kommen als PDF oder Foto herein, beim Selbsthosten auch über ein eigenes Mail-Postfach. Was ihr auf der Liste abhakt, zählt ebenfalls als Einkauf. Einen Vorrat müsst ihr nicht pflegen.'],
        ['Funktioniert das ohne REWE?', 'Ja. ToHuus liest auch Bons von Lidl, Aldi, Edeka, Netto, Kaufland, Penny, dm und Rossmann, Papierbons per Foto. Wer gar keine Bons sammeln will, hakt einfach auf der Liste ab.'],
        ['Gibt es ToHuus für Android?', 'Eine eigene Android-App gibt es nicht. Im Browser läuft ToHuus als Web-App, die du auf den Startbildschirm legen kannst, auf Android genauso wie am Rechner.'],
        ['Wann kommt die iPhone-App?', `Sie ist im Test über TestFlight, in einem kleinen, geschlossenen Kreis. Einen Platz kannst du <a href="${tfHref('de')}">per Mail anfragen</a>. iPad und Apple Watch kommen mit der App. Wer selbst hostet, kann die Web-App schon heute nutzen.`],
        ['Brauche ich dafür KI?', 'Nein. Liste, Vorschläge, Kochplaner und Ausgaben funktionieren ohne. Ein Sprachmodell braucht es nur für Fotos von Papierbons und für freie Fragen an den Assistenten. Ihr könnt die KI für den Haushalt, für einzelne Personen und für Kinder abschalten.'],
        ['Kann ich meine Rezepte mitbringen?', 'Ja. Per Link, Foto, aus Apps wie Mealie, Paprika oder Nextcloud Kochbuch, oder viele auf einmal als Rezeptpaket. Das Paket kann dir auch deine eigene KI aus Fotos deiner Kochbücher bauen.'],
        ['Was ist die Hausinfo?', 'Karten für Babysitter und Gäste mit Sprachbefehlen, Abläufen, Tipps und Notfallinfos. Codes wie für die Tür oder das WLAN sind dort eigens geschützt und gehen nie an eine KI. Auf dem Babysitter-Link steht sie neben „Wo ist was?“, auch offline.'],
        ['Brauche ich einen Thermomix?', 'Nein. Der Kochplaner zeigt Rezepte mit und ohne Thermomix, und ihr könnt danach filtern.'],
        ['Wer zahlt, wenn wir zu viert sind?', 'Ein Abo gilt für den ganzen Haushalt. Mitglieder, Kinder, Gäste und verbundene Haushalte zahlen nichts.'],
        ['Was passiert, wenn ich das Abo kündige?', 'Der Haushalt geht auf Free zurück. Gelöscht wird nichts. Ihr seht dann die letzten 60 Tage, und der Assistent hat 20 Nachrichten im Monat.'],
        ['Was passiert mit meinen Daten, wenn ich lösche?', 'Zuerst wird der Schlüssel des Haushalts vernichtet, damit ist die Datenbank nicht mehr lesbar. Danach werden die Dateien und die Sicherungen des Haushalts gelöscht. Sicherungskopien der Kontoverwaltung, die noch den verschlüsselten Schlüssel enthalten, laufen nach ihrer Frist ab.'],
        ['Ist ToHuus ein Familienkalender?', 'Nein. ToHuus kümmert sich um Einkauf, Kochen und das Geld dafür. Termine, Aufgaben mit Zuständigkeiten oder Punkte gibt es bewusst nicht.'],
      ],
    },
    foot: {
      about: 'ToHuus ist ein Angebot von Heidrich Digital.', provider: `Anbieter: ${PROVIDER}`,
      project: 'Projekt', legal: 'Rechtliches', help: 'Hilfe & Tipps', code: 'Quellcode auf GitHub', license: 'Lizenz App: AGPL-3.0', licenseHa: 'Lizenz HA-Integration: MIT', issues: 'Fehler melden',
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
    legalLabel: 'Legal', tocLabel: 'Contents', back: 'Back to the home page', ids: { jobs: 'shopping', cook: 'cooking', money: 'money', levels: 'getting-started', how: 'how-it-remembers', who: 'who', ways: 'two-ways', prices: 'pricing', privacy: 'privacy', host: 'self-hosting', why: 'why', faq: 'faq', install: 'install', tf: 'testflight', ha: 'home-assistant' },
    nav: [['#shopping', 'Shopping'], ['#cooking', 'Cooking'], ['#money', 'Money'], ['#bring-me-something', 'Bring me something'], ['#pricing', 'Pricing'], ['#privacy', 'Privacy'], ['#self-hosting', 'Self-hosting'], ['HELP', 'Help']],
    rail: [['#shopping', 'Shopping', 'basket'], ['#cooking', 'Cooking', 'pot'], ['#money', 'Money', 'wallet'], ['#pricing', 'Pricing', 'receipt']],
    hero: {
      label: 'Shopping and household assistant',
      h1: 'So one person doesn’t have to keep it all <span class="hl">in their head.</span>',
      lede: 'ToHuus remembers for your household what is there, what is missing and what it costs. Your receipts and your shared list are all it needs.',
      ios: 'Ask for a TestFlight place', iosSub: 'iPhone app, small test group', gh: 'Self-host from GitHub',
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
      intro: 'What you buy is what you cook, and that is where the money goes. So ToHuus looks after all three. And after the rest of what makes a home: doing each other a good turn and keeping track of wishes.',
      list: [
        { id: 'shopping', no: '1', label: 'Shopping', h3: 'ToHuus remembers what is missing.', shot: 'shopping',
          alt: 'Shopping list in ToHuus: suggestions at the top such as beef mince with “remembers: every ~12 days”, below it items sorted by section with an I’ll-get-it button and where they came from, like “Mira, today”.',
          p: 'From your receipts and what you tick off the list, ToHuus learns how often you buy things. When something is due again, it shows up as a suggestion with its reason. You do not have to keep a stock list for that.',
          points: ['One list, live on every phone, also while someone is in the shop', 'Whoever takes something taps “I’ll get it”', 'Sorted by aisle in the shop, even without signal'] },
        { id: 'cooking', no: '2', label: 'Cooking', h3: 'You can cook this today.', shot: 'cook',
          alt: 'Cook page: “You can cook this today” with a gnocchi skillet and roast vegetables with feta, both marked “everything is at home”, plus filters with and without Thermomix.',
          p: 'The cook planner starts with what is at home. It shows what works right now, where only one ingredient is missing and what should be used soon. Plan the week if you like, and whatever it needs goes on the list in one tap.',
          points: ['Recipes by hand, from a link, a photo or other apps', 'Many at once as a recipe pack, even built by your own AI', 'With or without a Thermomix, and allergies are taken into account'] },
        { id: 'money', no: '3', label: 'Money', h3: 'You see where the money for food and household goes.', shot: 'money',
          alt: 'Money page for September 2026: £215.81 spent, £17 more than the month before, with a weekly line and bars by category below.',
          p: 'Every receipt counts. ToHuus shows what a month cost, in which shop and for which category, and compares it with the month before. You do not need to keep a ledger.',
          points: ['Spending by month, shop and category', 'Price changes on things you buy often', 'Budgets per week, month or year, shared or just for you, with a note at 80 percent', 'CSV export'] },
        { id: 'bring-me-something', no: '4', label: 'Bring me something', h3: 'One of you is on the sofa, one is in the kitchen.', shot: 'treats',
          alt: 'Treats page: “What would you like?”, with cards such as Something sweet, Something to drink, Something to nibble and From the fridge, plus tabs for Guests and Party.',
          p: 'Whoever is stuck, in bed, at bedtime or with a child on their arm, asks for a little something in two taps. The others see it right away, someone says “I’ll bring it”, and the house menu only shows what is actually at home. Visitors get their own menu, and on party night guests order straight from your party menu.',
          points: ['Your own house menu: sweets, drinks, snacks, from the fridge', 'Guests ask through a link, no app needed', 'Party: you see what was ordered and what is left'] },
        { id: 'wishes', no: '5', label: 'Wishes', h3: 'Wish lists that give nothing away.', shot: 'wishes',
          alt: 'Wishes page: the list “Christmas for Mika” with three wishes and the saved list “New biscuits & finds”.',
          p: 'Birthdays, Christmas or just a list of things to remember: wishes with a photo, several links, a price and a note. The family sees who reserved what, the person it is for never does. Send a whole list or part of it as a message.',
          points: ['Photo, links, price and “who could give this”', 'Private lists only you can see', 'Share as a link or a ready-made message'] },
      ],
    },
    levels: {
      label: 'Getting started', h2: 'However digital your shopping already is.',
      intro: 'If shopping is going digital anyway, you should get something out of it too. ToHuus works with what you already have. One of these is enough to start.',
      shot: 'import', alt: 'Imports page: receipts as PDF, photo, QR link or text, with the history of booked receipts from Tesco and Aldi below.',
      list: [
        ['receipt', 'Delivery and e-receipts', 'If you order groceries online or get digital receipts, the order and the receipt come in as a PDF. ToHuus matches them and books what was actually delivered.'],
        ['camera', 'Snap the receipt', 'For a paper receipt, a photo is enough. Anything ToHuus cannot read with confidence is shown to you for a check before it is booked. Text recognition runs without AI, on the server or right on your iPhone.'],
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
        ['Apps', 'iPhone app and the browser, Android included. iPad and Apple Watch come with the app', 'In the browser as a web app (also on the home screen), plus Home Assistant and your own assistants over MCP. The iPhone app is for the cloud only'],
        ['Data', 'Servers in Germany (Hetzner), every household encrypted with its own key', 'On your server, encrypted if you like'],
        ['Receipt photos and assistant', 'Included, with an allowance per plan. AI can be switched off for the household, a person or a child', 'With your own AI key, or without'],
        ['Claude, ChatGPT (MCP)', 'Through MCP with sign-in (OAuth)', 'Through MCP with an access key'],
        ['Home Assistant', 'Through the HACS integration, connected with a code from the app', 'Fully, plus receipt inbox, Telegram and receipt printer on your network'],
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
        { name: 'Self-hosted', price: '€0', sub: 'AGPL-3.0', storage: 'as much as your server has', items: ['Everything unlocked', 'Your own AI key, or none', 'Web app in the browser, Home Assistant, MCP'], host: true },
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
        ['power', 'AI can be switched off', 'For the whole household, just for you or for a single child. Then no request goes to a language model, and the list, suggestions, cooking and money keep working.'],
        ['scan', 'Text recognition without AI', 'Receipt photos are first read by text recognition without a language model on the server, or your iPhone reads them itself and sends only the text. Only if that does not add up and AI is on does Mistral read the photo.'],
        ['plug', 'Your assistants only if you want', 'You connect Claude or ChatGPT yourself through MCP. They see discreet items only as a placeholder, and an admin can switch MCP off.'],
        ['trash', 'When you delete', 'When you delete the household, its key is destroyed first, then the data and its backups follow. Backup copies of the account directory expire after their retention period.'],
      ],
      link: 'Technical details about the cloud', linkHref: `${GH}/blob/main/docs/cloud.md`,
    },
    host: {
      label: 'Self-hosting', h2: 'For everyone with their own server.',
      p: 'One Docker container and one SQLite file, free under the AGPL-3.0. In the browser ToHuus runs as a web app you can add to your home screen. The iPhone app is meant for ToHuus Cloud. You do not need an account with us.',
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
        ['Put HTTPS in front', 'Your usual reverse proxy is enough. Then open the web app in the browser and add it to your home screen.'],
      ],
      envComment: '# en or de',
    },
    tf: {
      label: 'iPhone app', h2: 'Help us test the iPhone app.',
      p: 'The iPhone app is being tested on TestFlight, Apple’s test programme. The group is small and closed, and taking part costs nothing. We are looking for households that use ToHuus in everyday life and say honestly what does not work.',
      points: ['Small, closed group', 'Free', 'Feedback very welcome, criticism included', 'iPad and Apple Watch come with the app'],
      cardTitle: 'What we need to invite you', cardSub: 'already in the e-mail',
      rows: ['Your Apple ID e-mail for TestFlight', 'How many people live in the household', 'Where you usually shop', 'Which iPhone you have'],
      cta: 'Ask for a TestFlight place', ctaSub: 'opens a prepared e-mail',
      note: 'We only use these details for the invitation and the test.',
    },
    ha: {
      label: 'Home Assistant', h2: 'ToHuus in Home Assistant.',
      p: 'The integration brings the shopping list as a to-do list, sensors for what is due, the list and spending, the week plan as a calendar and ToHuus notifications into Home Assistant. You connect with a code from the app, for ToHuus Cloud just like for your own server. Home Assistant connects out by itself, so nothing in your home has to be reachable from the internet.',
      steps: [
        ['Install through HACS', 'Custom repository <code>tillheidrich/tohuus-hub-ha</code>, type Integration.'],
        ['Get a code in ToHuus', 'Settings › Home Assistant › “Connect Home Assistant”. The code is valid for 10 minutes.'],
        ['Add the integration', 'Choose ToHuus Cloud or your own server and enter the code.'],
      ],
      link: 'Step by step, with an example dashboard',
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
      label: 'Questions', h2: 'What people often ask.', more: 'More answers in Help & tips',
      list: [
        ['Do I have to type everything in?', 'No. Receipts come in as a PDF or a photo, and when you self-host also through your own e-mail inbox. What you tick off the list counts as a purchase too. You do not have to keep a stock list.'],
        ['Does it work without online grocery delivery?', 'Yes. Paper receipts come in as a photo, and if you do not want to collect receipts at all, simply tick things off the list.'],
        ['Is there an Android app?', 'There is no separate Android app. In the browser ToHuus runs as a web app you can add to your home screen, on Android just like on a computer.'],
        ['When is the iPhone app coming?', `It is being tested on TestFlight in a small, closed group. You can <a href="${tfHref('en')}">ask for a place by e-mail</a>. iPad and Apple Watch come with the app. If you self-host, you can use the web app today.`],
        ['Do I need AI for this?', 'No. The list, suggestions, cook planner and spending all work without it. A language model is only needed for photos of paper receipts and for open questions to the assistant. You can switch AI off for the household, for single people and for children.'],
        ['Can I bring my recipes?', 'Yes. From a link, a photo, apps like Mealie, Paprika or Nextcloud Cookbook, or many at once as a recipe pack. Your own AI can build the pack from photos of your cookbooks.'],
        ['What is the house info?', 'Cards for babysitters and guests with voice commands, routines, tips and emergency details. Codes such as the door or the Wi-Fi are protected separately and never go to an AI. On the babysitter link it sits next to “where is what”, also offline.'],
        ['Do I need a Thermomix?', 'No. The cook planner shows recipes with and without a Thermomix, and you can filter by it.'],
        ['Who pays if there are four of us?', 'One subscription covers the whole household. Members, children, guests and connected households pay nothing.'],
        ['What happens if I cancel?', 'The household goes back to Free. Nothing is deleted. You then see the last 60 days, and the assistant has 20 messages a month.'],
        ['What happens to my data when I delete it?', 'First the household’s key is destroyed, so the database can no longer be read. Then the household’s files and backups are deleted. Backup copies of the account directory, which still hold the encrypted key, expire after their retention period.'],
        ['Is ToHuus a family calendar?', 'No. ToHuus looks after shopping, cooking and the money for both. There are deliberately no appointments, chores with owners or points.'],
      ],
    },
    foot: {
      about: 'ToHuus is offered by Heidrich Digital.', provider: `Provider: ${PROVIDER}`,
      project: 'Project', legal: 'Legal', help: 'Help & tips', code: 'Source code on GitHub', license: 'App licence: AGPL-3.0', licenseHa: 'HA integration licence: MIT', issues: 'Report a bug',
      imprint: 'Imprint', privacy: 'Privacy', terms: 'Terms of use', otherLang: 'Deutsche Version',
      fine: 'This website sets no cookies, does not track you and loads nothing from third parties. Fonts: Familjen Grotesk and Hedvig Letters (SIL Open Font License), served locally. Icons: Phosphor (MIT). The screenshots show a demo household with invented names and receipts. ToHuus is not affiliated with Tesco, REWE, Lidl, Aldi, Vorwerk/Thermomix, Apple or the other shops and services named here. The names only describe compatible formats and services.',
    },
  },
};

// ---------------------------------------------------------------- screenshots
/** Every screenshot slot the page uses. The build fails when a file is missing, so no placeholder ever ships. */
const SHOTS = ['today', 'today-dark', 'shopping', 'cook', 'money', 'import', 'treats', 'wishes'];
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
${m.alt.en && m.alt.de ? `<link rel="alternate" hreflang="en" href="${m.alt.en}">
<link rel="alternate" hreflang="de" href="${m.alt.de}">
<link rel="alternate" hreflang="x-default" href="${m.alt.en}">` : ''}
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
` : ''}${m.extraLd ? `<script type="application/ld+json">${m.extraLd}</script>
` : ''}</head>
<body${m.bodyClass ? ` class="${m.bodyClass}"` : ''}>
${sprite}
<a class="skip" href="#main">${c.skip}</a>

<header class="nav-wrap">
<div class="nav">
  <a class="brand" href="${m.home ?? './'}" aria-label="${c.homeLabel}">${brandMark(28)}<span>ToHuus</span></a>
  <nav class="nav-links" aria-label="${c.navLabel}">
${c.nav.map(([href, l]) => `    <a href="${href === 'HELP' ? (m.helpHref ?? helpIndexHref(c.lang)) : m.navBase + href}"${href === 'HELP' && m.isHelp ? ' aria-current="page"' : ''}>${l}</a>`).join('\n')}
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
        <a class="brand" href="${m.home ?? './'}">${brandMark(26)}<span>ToHuus</span></a>
        <p>${c.foot.about}<br>${c.foot.provider}</p>
      </div>
      <div>
        <h4>${c.foot.project}</h4>
        <ul>
          <li><a href="${m.helpHref ?? helpIndexHref(c.lang, 'home')}">${c.foot.help}</a></li>
${publishedPosts(c.lang).length ? `          <li><a href="${m.home ?? './'}${c.lang === 'de' ? '../' : ''}${BLOG_DIR[c.lang]}/">${BLOG_COPY[c.lang].title}</a></li>
` : ''}          <li><a href="${GH}">${c.foot.code}</a></li>
          <li><a href="${GH}/blob/main/LICENSE">${c.foot.license}</a></li>
          <li><a href="${GH}/blob/main/ha-integration/LICENSE">${c.foot.licenseHa}</a></li>
          <li><a href="${GH}/issues">${c.foot.issues}</a></li>
        </ul>
      </div>
      <div>
        <h4>${c.foot.legal}</h4>
        <ul>
          <li><a href="https://heidrich-digital.de/impressum">${c.foot.imprint}</a></li>
          <li><a href="${m.legalBase ?? ''}${LEGAL[c.lang].privacy.file}">${c.foot.privacy}</a></li>
          <li><a href="${m.legalBase ?? ''}${LEGAL[c.lang].terms.file}">${c.foot.terms}</a></li>
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
  const TF = c.tf;
  const HA = c.ha;
  const m = homeMeta(c);
  return `${pageTop(c, m)}<main id="main">

<section class="hero" aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      ${label(H.label)}
      <h1 id="hero-h">${H.h1}</h1>
      <p class="lede">${H.lede}</p>
      <div class="ctas">
        <a class="btn primary" href="${tfHref(c.lang)}">${ico('apple')}<span class="btn-2"><b>${H.ios}</b><small>${H.iosSub}</small></span><span class="tail">${ico('mail')}</span></a>
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
      <div class="block-phone">${device(img(c, L.shot, L.alt, { sizes: '(min-width: 960px) 300px, 70vw' }))}</div>
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

<section class="tf" id="${id.tf}" aria-labelledby="tf-h">
  <div class="wrap how-grid">
    <div>
      ${label(TF.label, ' reveal')}
      <h2 class="reveal" id="tf-h">${TF.h2}</h2>
      <p class="intro reveal">${TF.p}</p>
      <ul class="ticks tf-points reveal">${TF.points.map((x) => `<li>${ico('check')}<span>${x}</span></li>`).join('')}</ul>
    </div>
    <div class="ticket tf-card reveal" role="group" aria-label="${TF.cardTitle}">
      <div class="ticket-top">
        <p class="origin-h"><b>${TF.cardTitle}</b><span>${TF.cardSub}</span></p>
        <ol class="tf-rows">
${TF.rows.map((r) => `          <li>${r}</li>`).join('\n')}
        </ol>
      </div>
      <div class="tear" aria-hidden="true"></div>
      <div class="tf-foot">
        <a class="btn primary" href="${tfHref(c.lang)}">${ico('mail')}<span class="btn-2"><b>${TF.cta}</b><small>${TF.ctaSub}</small></span><span class="tail">${ico('arrow')}</span></a>
        <p>${TF.note}</p>
      </div>
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

<section class="ha" id="${id.ha}" aria-labelledby="ha-h">
  <div class="wrap how-grid">
    <div>
      ${label(HA.label, ' reveal')}
      <h2 class="reveal" id="ha-h">${HA.h2}</h2>
      <p class="intro reveal">${HA.p}</p>
      <p class="more reveal"><a href="${helpIndexHref(c.lang)}home-assistant.html">${HA.link}${ico('arrow')}</a></p>
    </div>
    <ol class="how-steps ha-steps">
${HA.steps.map(([t, x], k) => `      <li class="reveal" style="--d:${k * 60}ms"><b>${t}</b><span>${x}</span></li>`).join('\n')}
    </ol>
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
      <p class="more reveal"><a href="${helpIndexHref(c.lang)}">${Q.more}${ico('arrow')}</a></p>
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

// ---------------------------------------------------------------- help ("Hilfe & Tipps", help.mjs)
const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const helpKit = (lang) => ({
  CLOUD: CONTACT.CLOUD, GH, MAIL: TF_MAIL, TF_DE: tfHref('de'), TF_EN: tfHref('en'),
  code: (id, lbl, text) => `<div class="code help-code${lbl === 'Prompt' ? ' prose' : ''}"><div class="code-head"><span>${ico(lbl === 'Terminal' ? 'terminal' : 'code')}${lbl}</span><button class="btn sm copy" type="button" data-copy="${id}" data-done="${COPY[lang].copied}">${ico('copy')}<span>${COPY[lang].copy}</span></button></div><pre id="${id}">${esc(text)}</pre></div>`,
});
const HELP = { de: helpCopy(helpKit('de')).de, en: helpCopy(helpKit('en')).en };
const helpBySlug = (lang, slug) => HELP[lang].articles.find((a) => a.slug === slug);
const anchorId = (t) => t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Page values for a help page; `a` is the article (undefined = the help index). */
function helpMeta(c, a) {
  const H = HELP[c.lang];
  const other = c.lang === 'de' ? 'en' : 'de';
  const self = a ? `${a.slug}.html` : './';
  const otherFile = a?.pair && helpBySlug(other, a.pair) ? `${a.pair}.html` : '';
  const url = (lang, file) => `${SITE}${HELP_DIR[lang]}/${file === './' ? '' : file}`;
  const otherHref = `../${HELP_DIR[other]}/${otherFile}`;
  return {
    title: a ? `${a.title} · ToHuus` : `${H.title} · ToHuus`, desc: a ? a.desc : H.desc,
    url: url(c.lang, self), alt: { [c.lang]: url(c.lang, self), [other]: url(other, otherFile || './') }, ld: false,
    navBase: c.lang === 'de' ? '../de/' : '../', home: c.lang === 'de' ? '../de/' : '../', legalBase: c.lang === 'de' ? '../de/' : '../',
    helpHref: './', isHelp: true, bodyClass: 'legal-page help-page',
    enHref: c.lang === 'en' ? self : otherHref, deHref: c.lang === 'de' ? self : otherHref, otherHref,
  };
}

const soonTag = (H) => `<span class="soon-tag">${H.soon}</span>`;

function helpIndex(c) {
  const H = HELP[c.lang];
  const m = helpMeta(c);
  return `${pageTop(c, m, '../')}
<main id="main" class="legal help">

<section class="legal-head help-head" aria-labelledby="help-h">
  <div class="wrap">
    ${label(H.label)}
    <h1 id="help-h">${H.h1}</h1>
    <p class="legal-note help-lede">${H.lede}</p>
  </div>
</section>

<div class="wrap help-index">
${H.groups.map(([g, t]) => {
    const list = H.articles.filter((a) => a.group === g);
    if (!list.length) return '';
    return `  <section class="help-group" id="${g}" aria-labelledby="g-${g}">
    <h2 id="g-${g}">${t}</h2>
    <ul class="help-cards">
${list.map((a) => `      <li><a class="help-card" href="${a.slug}.html"><b>${a.title}</b>${a.soon ? soonTag(H) : ''}<span>${a.desc}</span>${ico('arrow')}</a></li>`).join('\n')}
    </ul>
  </section>`;
  }).join('\n')}
  <p class="help-missing">${H.missing} <a href="mailto:${TF_MAIL}">${TF_MAIL}</a>.</p>
</div>

</main>

${pageFoot(c, m)}

<script src="../assets/site.js" defer></script>
</body>
</html>
`;
}

function helpArticle(c, a) {
  const H = HELP[c.lang];
  const m = helpMeta(c, a);
  const group = H.groups.find(([g]) => g === a.group)?.[1] ?? '';
  const secs = a.sections.map(([h, ...body]) => ({ id: anchorId(h), h, body: body.join('') }));
  const rel = (a.related ?? []).map((sl) => helpBySlug(c.lang, sl)).filter(Boolean);
  return `${pageTop(c, m, '../')}
<main id="main" class="legal help">

<section class="legal-head help-head" aria-labelledby="help-h">
  <div class="wrap">
    <p class="label help-crumbs"><a href="./">${H.title}</a><span aria-hidden="true">›</span>${group}</p>
    <h1 id="help-h">${a.title}</h1>
    <p class="legal-note help-lede">${a.desc}</p>
    ${a.soon ? `<p class="legal-status help-soon">${H.soonLong}</p>` : ''}
  </div>
</section>

<div class="wrap legal-grid">
  <nav class="legal-toc" aria-labelledby="toc-h">
    <p class="label" id="toc-h">${H.onPage}</p>
    <ol>
${secs.map((x, k) => `      <li><a href="#${x.id}"><span>${k + 1}</span>${x.h}</a></li>`).join('\n')}
    </ol>
    <p class="legal-links"><a href="./">${H.back}${ico('arrow')}</a>${a.pair && helpBySlug(c.lang === 'de' ? 'en' : 'de', a.pair) ? `<a href="${m.otherHref}" hreflang="${c.otherLang}">${H.other}${ico('arrow')}</a>` : ''}</p>
  </nav>
  <div class="legal-body help-body">
${secs.map((x, k) => `    <section id="${x.id}" aria-labelledby="${x.id}-h">
      <h2 id="${x.id}-h"><span class="legal-no">${k + 1}</span>${x.h}</h2>
      ${x.body}
    </section>`).join('\n')}
${rel.length ? `    <aside class="help-related" aria-labelledby="rel-h">
      <p class="legal-summary-h" id="rel-h">${H.related}</p>
      <ul>${rel.map((r) => `<li><a href="${r.slug}.html">${r.title}${r.soon ? soonTag(H) : ''}${ico('arrow')}</a></li>`).join('')}</ul>
    </aside>` : ''}
    <p class="help-missing">${H.missing} <a href="mailto:${TF_MAIL}">${TF_MAIL}</a>.</p>
  </div>
</div>

</main>

${pageFoot(c, m)}

<script src="../assets/site.js" defer></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- blog / Ratgeber (blog.mjs, docs/blog.md)
const ldJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

function blogMeta(c, p) {
  const B = BLOG_COPY[c.lang];
  const other = c.lang === 'de' ? 'en' : 'de';
  const self = p ? `${p.slug}.html` : './';
  const pair = p?.pair && publishedPosts(other).some((x) => x.slug === p.pair) ? `${p.pair}.html` : '';
  const otherHasIndex = publishedPosts(other).length > 0;
  const url = (lang, file) => `${SITE}${BLOG_DIR[lang]}/${file === './' ? '' : file}`;
  const otherHref = pair || (otherHasIndex && !p) ? `../${BLOG_DIR[other]}/${pair}` : other === 'de' ? '../de/' : '../';
  // hreflang only between real translations (a post without a pair has none)
  const altOther = pair || (otherHasIndex && !p) ? url(other, pair || './') : null;
  return {
    title: p ? `${p.title} · ToHuus` : `${B.title} · ToHuus`, desc: p ? p.desc : B.desc,
    url: url(c.lang, self), alt: { [c.lang]: url(c.lang, self), [other]: altOther }, ld: false,
    navBase: c.lang === 'de' ? '../de/' : '../', home: c.lang === 'de' ? '../de/' : '../', legalBase: c.lang === 'de' ? '../de/' : '../',
    helpHref: `../${HELP_DIR[c.lang]}/`, bodyClass: 'legal-page help-page blog-page',
    enHref: c.lang === 'en' ? self : otherHref, deHref: c.lang === 'de' ? self : otherHref, otherHref,
  };
}

const fmtPostDate = (lang, d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * One fact as a card people can keep: the page shows it as a green card, the button draws the same card as a
 * 1080 × 1350 PNG (site.js, canvas, local fonts) and offers "Teilen" on phones or saves the file.
 */
const factCard = (c, p, f, n, { link = false } = {}) => {
  const B = BLOG_COPY[c.lang];
  const file = `tohuus-fakt-${p.slug}-${n}`;
  return `<li class="fact">
        <figure class="fact-card" id="fakt-${p.slug}-${n}" data-value="${f.value}" data-text="${f.text}" data-source="${f.source}">
          <span class="fact-brand" aria-hidden="true">ToHuus ${B.title}</span>
          <p class="fact-v">${f.value}</p>
          <p class="fact-t">${f.text}</p>
          <figcaption>${B.source} <a href="${f.url}">${f.source}</a></figcaption>
        </figure>
        <div class="fact-actions">
          <button class="fact-save" type="button" data-fact="fakt-${p.slug}-${n}" data-file="${file}" data-share="${B.share}" data-saved="${B.saved}" aria-label="${B.saveImage}: ${f.value}">${ico('image')}<span>${B.saveImage}</span></button>
          ${link ? `<a class="fact-link" href="${p.slug}.html">${B.toPost}${ico('arrow')}</a>` : ''}
        </div>
      </li>`;
};

function blogFacts(c) {
  const B = BLOG_COPY[c.lang];
  const posts = publishedPosts(c.lang).filter((p) => p.facts?.length);
  const m = blogMeta(c);
  m.title = `${B.factsTitle} · ToHuus`;
  m.desc = B.factsDesc;
  m.url = `${SITE}${BLOG_DIR[c.lang]}/fakten.html`;
  m.alt = { [c.lang]: m.url };
  m.enHref = c.lang === 'en' ? 'fakten.html' : m.enHref;
  m.deHref = c.lang === 'de' ? 'fakten.html' : m.deHref;
  const count = posts.reduce((a, p) => a + p.facts.length, 0);
  return `${pageTop(c, m, '../')}
<main id="main" class="legal help">

<section class="legal-head help-head" aria-labelledby="facts-h">
  <div class="wrap">
    <p class="label help-crumbs"><a href="./">${B.title}</a></p>
    <h1 id="facts-h">${B.factsH1}</h1>
    <p class="legal-note help-lede">${B.factsLede.replace('{n}', String(count))}</p>
  </div>
</section>

<div class="wrap help-index">
${posts.map((p) => `  <section class="help-group" aria-labelledby="f-${p.slug}">
    <h2 id="f-${p.slug}"><a href="${p.slug}.html">${p.title}</a></h2>
    <ul class="fact-cards">
      ${p.facts.map((f, k) => factCard(c, p, f, k + 1, { link: true })).join('\n      ')}
    </ul>
  </section>`).join('\n')}
</div>

</main>

${pageFoot(c, m)}

<script src="../assets/site.js" defer></script>
</body>
</html>
`;
}

function blogIndex(c) {
  const B = BLOG_COPY[c.lang];
  const m = blogMeta(c);
  const posts = publishedPosts(c.lang);
  m.extraLd = ldJson({ '@context': 'https://schema.org', '@type': 'Blog', name: `ToHuus ${B.title}`, url: m.url, inLanguage: c.lang, description: B.desc,
    blogPost: posts.map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}${BLOG_DIR[c.lang]}/${p.slug}.html`, datePublished: p.date })) });
  return `${pageTop(c, m, '../')}
<main id="main" class="legal help">

<section class="legal-head help-head" aria-labelledby="blog-h">
  <div class="wrap">
    ${label(B.label)}
    <h1 id="blog-h">${B.h1}</h1>
    <p class="legal-note help-lede">${B.lede}</p>
  </div>
</section>

<div class="wrap help-index">
  ${posts.some((p) => p.facts?.length) ? `<p class="blog-facts-link"><a class="btn" href="fakten.html">${ico('chart')}${B.factsLink}</a></p>` : ''}
  <ul class="help-cards">
${posts.map((p) => `    <li><a class="help-card" href="${p.slug}.html"><b>${p.title}</b><span>${p.desc}</span><span><time datetime="${p.date}">${fmtPostDate(c.lang, p.date)}</time></span>${ico('arrow')}</a></li>`).join('\n')}
  </ul>
</div>

</main>

${pageFoot(c, m)}

<script src="../assets/site.js" defer></script>
</body>
</html>
`;
}

function blogPost(c, p) {
  const B = BLOG_COPY[c.lang];
  const m = blogMeta(c, p);
  const secs = p.sections.map(([h, body]) => ({ id: anchorId(h), h, body }));
  const help = (p.help ?? []).map((sl) => helpBySlug(c.lang, sl)).filter(Boolean);
  const toc = [...secs, ...(p.facts?.length ? [{ id: 'fakten', h: B.factsHere }] : []), ...(p.faq?.length ? [{ id: 'faq', h: B.faq }] : [])];
  const ld = [{ '@context': 'https://schema.org', '@type': 'BlogPosting', headline: p.title, description: p.desc, datePublished: p.date, dateModified: p.updated ?? p.date,
    inLanguage: c.lang, mainEntityOfPage: m.url, image: `${SITE}assets/img/og-${c.lang}.png`,
    author: { '@type': 'Organization', name: 'ToHuus', url: c.url }, publisher: { '@type': 'Organization', name: 'Heidrich Digital', url: 'https://heidrich-digital.de' } },
  { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'ToHuus', item: c.url },
    { '@type': 'ListItem', position: 2, name: B.title, item: `${SITE}${BLOG_DIR[c.lang]}/` },
    { '@type': 'ListItem', position: 3, name: p.title, item: m.url }] }];
  if (p.faq?.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  m.extraLd = ldJson(ld);
  return `${pageTop(c, m, '../')}
<main id="main" class="legal help">

<article aria-labelledby="post-h">
<header class="legal-head help-head">
  <div class="wrap">
    <p class="label help-crumbs"><a href="./">${B.title}</a></p>
    <h1 id="post-h">${p.title}</h1>
    <p class="legal-note help-lede">${p.answer}</p>
    <p class="legal-status"><time datetime="${p.date}">${B.published} ${fmtPostDate(c.lang, p.date)}</time>${p.updated && p.updated !== p.date ? ` · <time datetime="${p.updated}">${B.updated} ${fmtPostDate(c.lang, p.updated)}</time>` : ''}</p>
  </div>
</header>

<div class="wrap legal-grid">
  <nav class="legal-toc" aria-label="${p.title}">
    <ol>
${toc.map((x, k) => `      <li><a href="#${x.id}"><span>${k + 1}</span>${x.h}</a></li>`).join('\n')}
    </ol>
    <p class="legal-links"><a href="./">${B.back}${ico('arrow')}</a>${m.otherHref.endsWith('.html') ? `<a href="${m.otherHref}" hreflang="${c.otherLang}">${B.other}${ico('arrow')}</a>` : ''}</p>
  </nav>
  <div class="legal-body help-body">
${secs.map((x) => `    <section id="${x.id}" aria-labelledby="${x.id}-h">
      <h2 id="${x.id}-h">${x.h}</h2>
      ${x.body}
    </section>`).join('\n')}
${p.facts?.length ? `    <section id="fakten" aria-labelledby="fakten-h">
      <h2 id="fakten-h">${B.factsHere}</h2>
      <p>${B.factsNote} <a href="fakten.html">${B.factsAll}</a></p>
      <ul class="fact-cards">
      ${p.facts.map((f, k) => factCard(c, p, f, k + 1)).join('\n      ')}
      </ul>
    </section>` : ''}
${p.faq?.length ? `    <section id="faq" aria-labelledby="faq-h">
      <h2 id="faq-h">${B.faq}</h2>
${p.faq.map(([q, a]) => `      <h3>${q}</h3>\n      <p>${a}</p>`).join('\n')}
    </section>` : ''}
${help.length ? `    <aside class="help-related" aria-labelledby="rel-h">
      <p class="legal-summary-h" id="rel-h">${B.help}</p>
      <ul>${help.map((r) => `<li><a href="../${HELP_DIR[c.lang]}/${r.slug}.html">${r.title}${ico('arrow')}</a></li>`).join('')}</ul>
    </aside>` : ''}
${p.sources?.length ? `    <aside class="blog-sources" aria-labelledby="src-h">
      <p class="legal-summary-h" id="src-h">${B.sources}</p>
      <ol>${p.sources.map(([t, u]) => `<li><a href="${u}">${t}</a></li>`).join('')}</ol>
    </aside>` : ''}
    <p class="help-missing">${B.tryText} <a href="${c.lang === 'de' ? '../de/' : '../'}">${B.tryIt}</a></p>
  </div>
</div>
</article>

</main>

${pageFoot(c, m)}

<script src="../assets/site.js" defer></script>
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
// help: every slug of the app contract has a German page; every link, pair and related slug resolves
const contract = path.join(ROOT, '../docs/help-slugs.md');
if (fs.existsSync(contract)) {
  for (const [, slug] of fs.readFileSync(contract, 'utf8').matchAll(/^\| `([a-z0-9-]+)` \|/gm)) if (!helpBySlug('de', slug)) throw new Error(`help slug ${slug} (docs/help-slugs.md) has no page in site/src/help.mjs`);
}
const helpPages = [];
for (const c of Object.values(COPY)) {
  const H = HELP[c.lang];
  const slugs = new Set(H.articles.map((a) => a.slug));
  if (slugs.size !== H.articles.length) throw new Error(`duplicate help slug (${c.lang})`);
  helpPages.push([path.join(HELP_DIR[c.lang], 'index.html'), helpIndex(c), c]);
  for (const a of H.articles) {
    if (!H.groups.some(([g]) => g === a.group)) throw new Error(`help ${a.slug}: unknown group ${a.group}`);
    if (a.pair && !helpBySlug(c.lang === 'de' ? 'en' : 'de', a.pair)) throw new Error(`help ${a.slug}: pair ${a.pair} missing`);
    for (const r of a.related ?? []) if (!slugs.has(r)) throw new Error(`help ${a.slug}: related ${r} missing`);
    helpPages.push([path.join(HELP_DIR[c.lang], `${a.slug}.html`), helpArticle(c, a), c]);
  }
}
for (const [file, html, c] of helpPages) {
  checkText(html, `help ${file}`, 0);
  for (const [, href] of html.matchAll(/href="([a-z0-9-]+\.html)(#[^"]*)?"/g)) if (!helpPages.some(([f]) => f === path.join(HELP_DIR[c.lang], href))) throw new Error(`broken help link ${href} in ${file}`);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) if (id !== 'main' && !html.includes(`id="${id}"`)) throw new Error(`broken anchor #${id} in ${file}`);
}

fs.writeFileSync(path.join(ROOT, 'index.html'), page(COPY.en));
fs.mkdirSync(path.join(ROOT, 'de'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'de/index.html'), page(COPY.de));
for (const c of Object.values(COPY)) for (const kind of LEGAL_KINDS) {
  fs.writeFileSync(path.join(ROOT, c.lang === 'de' ? 'de' : '', LEGAL[c.lang][kind].file), legalPage(c, kind));
}
for (const dir of Object.values(HELP_DIR)) fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
for (const [file, html] of helpPages) {
  fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, file), html);
}
// blog / Ratgeber: only published posts get a page; without any, the folder does not exist
const blogPages = [];
for (const c of Object.values(COPY)) {
  const posts = publishedPosts(c.lang);
  for (const p of posts) checkPost(c.lang, p);
  if (new Set(posts.map((p) => p.slug)).size !== posts.length) throw new Error(`duplicate blog slug (${c.lang})`);
  if (!posts.length) continue;
  blogPages.push([path.join(BLOG_DIR[c.lang], 'index.html'), blogIndex(c), c]);
  for (const p of posts) blogPages.push([path.join(BLOG_DIR[c.lang], `${p.slug}.html`), blogPost(c, p), c]);
  if (posts.some((p) => p.facts?.length)) blogPages.push([path.join(BLOG_DIR[c.lang], 'fakten.html'), blogFacts(c), c]);
}
for (const [file, html] of blogPages) {
  checkText(html, file, 0);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) if (id !== 'main' && !html.includes(`id="${id}"`)) throw new Error(`broken anchor #${id} in ${file}`);
}
for (const dir of Object.values(BLOG_DIR)) fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
for (const [file, html] of blogPages) {
  fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, file), html);
}

// sitemap.xml, robots.txt and llms.txt: for search engines and AI answer engines (SEO and GEO, docs/blog.md)
const today = new Date().toISOString().slice(0, 10);
const urls = [
  [SITE, today], [`${SITE}de/`, today],
  ...Object.values(COPY).flatMap((c) => LEGAL_KINDS.map((k) => [`${SITE}${c.lang === 'de' ? 'de/' : ''}${LEGAL[c.lang][k].file}`, today])),
  ...helpPages.map(([f]) => [`${SITE}${f.replace(/index\.html$/, '')}`, today]),
  ...Object.values(COPY).flatMap((c) => (publishedPosts(c.lang).length ? [[`${SITE}${BLOG_DIR[c.lang]}/`, publishedPosts(c.lang)[0].updated ?? publishedPosts(c.lang)[0].date]] : [])),
  ...Object.values(COPY).flatMap((c) => publishedPosts(c.lang).map((p) => [`${SITE}${BLOG_DIR[c.lang]}/${p.slug}.html`, p.updated ?? p.date])),
  ...Object.values(COPY).flatMap((c) => (publishedPosts(c.lang).some((p) => p.facts?.length) ? [[`${SITE}${BLOG_DIR[c.lang]}/fakten.html`, publishedPosts(c.lang)[0].updated ?? publishedPosts(c.lang)[0].date]] : [])),
];
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `  <url><loc>${u}</loc><lastmod>${d}</lastmod></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(ROOT, 'robots.txt'), `# ToHuus website: everything may be read, by search engines and by AI answer engines alike
User-agent: *
Allow: /

Sitemap: ${SITE}sitemap.xml
`);
const llmsList = (lang) => [
  ...helpPages.filter(([, , c]) => c.lang === lang).map(([f, html]) => [html.match(/<title>([^<]*) · ToHuus<\/title>/)?.[1] ?? f, `${SITE}${f.replace(/index\.html$/, '')}`, html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '']),
];
fs.writeFileSync(path.join(ROOT, 'llms.txt'), `# ToHuus

> ${COPY.en.desc}

ToHuus is a shopping and household assistant for families, couples and flatshares (iPhone app and web app in ToHuus Cloud, or self-hosted with Docker as a web app with a Home Assistant integration). It learns from receipts and the shared shopping list how often a household buys things and suggests them when they are due, plans meals from what is at home, shows where the money for food and household goes, lets people at home ask each other for a little something ("Bring me something", German "Bring mir was"), keeps wish lists with reservations hidden from the person they are for, and holds house info and holiday handovers for guests and sitters. Servers in Germany, no tracking, no ads, open source (AGPL).

## Website
- [ToHuus (English)](${SITE}): what it does, pricing, privacy, self-hosting
- [ToHuus (Deutsch)](${SITE}de/): German version
- [Privacy policy](${SITE}${LEGAL.en.privacy.file})
- [Source code](${GH})

## Help (English)
${llmsList('en').map(([t, u, d]) => `- [${t}](${u})${d ? `: ${d}` : ''}`).join('\n')}

## Hilfe (Deutsch)
${llmsList('de').map(([t, u, d]) => `- [${t}](${u})${d ? `: ${d}` : ''}`).join('\n')}
${Object.values(COPY).map((c) => (publishedPosts(c.lang).length ? `\n## ${BLOG_COPY[c.lang].title}\n${publishedPosts(c.lang).map((p) => `- [${p.title}](${SITE}${BLOG_DIR[c.lang]}/${p.slug}.html): ${p.desc}`).join('\n')}\n` : '')).join('')}${Object.values(COPY).map((c) => {
  const fs2 = publishedPosts(c.lang).flatMap((p) => (p.facts ?? []).map((f) => `- ${f.value}: ${f.text} (${f.source}, ${f.url})`));
  return fs2.length ? `\n## ${BLOG_COPY[c.lang].factsTitle}\n${fs2.join('\n')}\n` : '';
}).join('')}`);
console.log(`built ${blogPages.length} blog pages, sitemap.xml (${urls.length} URLs), robots.txt and llms.txt`);
console.log(`built ${helpPages.length} help pages (${Object.values(HELP_DIR).join('/, ')}/)`);
console.log(`built site/index.html, site/de/index.html and the legal pages (${LEGAL_KINDS.map((k) => `${LEGAL.en[k].file}, de/${LEGAL.de[k].file}`).join(', ')})`);

/*
 * Refreshing the screenshots: scripts/site-shots.mjs against a local ToHuus Cloud with open sign-up. It creates a
 * household per language with invented people and four months of invented receipts and shoots every slot in SHOTS at
 * 390x844 pt, 3x, with the iPhone's status area and home indicator simulated, so the device frame never cuts anything.
 * Never use real names. Check every image before committing.
 *
 * OG images (site/assets/img/og-<lang>.png, 1200x630): a 1200x630 page with the wordmark, the hero headline and
 * homeTiles(), styled by site.css and screenshotted with Playwright from the served site/ folder.
 */
