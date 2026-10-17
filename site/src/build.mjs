/**
 * Builds the marketing site (site/index.html in English, site/de/index.html in German) from one template, plus the
 * legal pages from legal.mjs (site/privacy.html, site/terms.html, site/de/datenschutz.html, site/de/nutzungsbedingungen.html).
 * Run from the repo root:  node site/src/build.mjs
 *
 * Product frame and wording: docs/plan-2026-10-12.md and the strategy "ToHuus merkt sich, was zu Hause fehlt"
 * (12.10.2026). ToHuus is the shopping and household assistant of a home: Einkauf, Kochen, Geld. Outward verb
 * "merkt sich", never "Gedächtnis"; "KI" is never the promise; data claims only where they can be checked.
 * No real names of the maker's family anywhere (copy, alt texts, screenshots). Demo people: Sam, Mira, Ben.
 *
 * Design: "Dutch Detail" (docs/design/2026-10-11-dutch-detail-system.md): same tokens, fonts and icons as the app.
 * Signature elements: the illustrated homes, the green block with circles, the ticket with punch notches, the
 * receipt with a zigzag edge, arches. Fonts: site/assets/fonts (OFL). Icons: Phosphor, inline sprite at build time.
 *
 * Screenshots: real screens of the iPhone app (store-assets/tools/web-shots.mjs, build 13) or, for focus, loadcards,
 * treats and houseinfo-guest, of the web app (scripts/site-shots.mjs), invented demo data, 390x844 at 3x, saved as
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
import { SITE, CLOUD } from './config.mjs';
// Plattdeutsche Sprüche: the same data as the app (server/data/platt.json); site.js picks the one for the visitor's moment
const PLATT = JSON.parse(fs.readFileSync(new URL('../../server/data/platt.json', import.meta.url), 'utf8')).sayings;
const GH = 'https://github.com/tillheidrich/tohuus-hub';
/** Required provider line (Impressum). The only place where the en dash is allowed. */
const PROVIDER = 'Till Heidrich – Content Creation';
/** Contact data of the provider for the legal pages (Datenschutz, Nutzungsbedingungen). */
const CONTACT = { MAIL: 'mail@tillheidrich.de', PHONE: '0157 73953819', ADDRESS: ['Rotdornweg 17', '21255 Tostedt'], CLOUD };
const LEGAL = legalCopy({ PROVIDER, SITE, GH, ...CONTACT });
/** Contact address (help pages "Fehlt etwas?"). */
const TF_MAIL = 'tohuus@tillheidrich.de';
/** The App Store page of the app (iPhone, iPad, Apple Watch). */
const APP_STORE = { de: 'https://apps.apple.com/de/app/tohuus/id6822059656', en: 'https://apps.apple.com/app/tohuus/id6822059656' };
const appHref = (lang) => APP_STORE[lang];
/** Help section: German at site/hilfe/, English at site/help/ (help.mjs). From the home and legal pages: */
const HELP_DIR = { de: 'hilfe', en: 'help' };
const helpIndexHref = (lang) => (lang === 'de' ? `../${HELP_DIR.de}/` : `${HELP_DIR.en}/`);
/** Draft status shown on top of every legal page until the owner decides on a legal review. */
const LEGAL_STATUS = { de: 'Stand: 15.10.2026', en: 'As of 15 October 2026' };

// ---------------------------------------------------------------- icons (Phosphor regular, like the app)
const ICONS = {
  arrow: 'ArrowRight', github: 'GithubLogo', apple: 'AppleLogo', copy: 'Copy', sun: 'Sun', moon: 'Moon', check: 'Check',
  basket: 'Basket', pot: 'CookingPot', wallet: 'Wallet', receipt: 'Receipt', camera: 'Camera', mic: 'Microphone',
  lock: 'LockSimple', key: 'Key', trash: 'Trash', server: 'HardDrives', cloud: 'Cloud', eyeoff: 'EyeSlash', db: 'Database',
  robot: 'Robot', package: 'Package', refresh: 'ArrowsClockwise', send: 'PaperPlaneTilt', mail: 'EnvelopeSimple',
  terminal: 'TerminalWindow', code: 'Code', export: 'Export', plus: 'Plus', caret: 'CaretDown', printer: 'Printer',
  phone: 'DeviceMobile', globe: 'Globe', chart: 'ChartBar', list: 'ListChecks', store: 'Storefront', sparkle: 'Sparkle',
  power: 'Power', plug: 'Plug', house: 'House', question: 'Question', scan: 'Scan', watch: 'Watch', image: 'ImageSquare', share: 'ShareNetwork',
  wifi: 'WifiHigh', pin: 'MapPin', coffee: 'Coffee', moonstars: 'MoonStars', aid: 'FirstAidKit', baby: 'Baby', users: 'Users', paw: 'PawPrint',
  suitcase: 'Suitcase', bed: 'Bed', timer: 'Timer', target: 'Target', feather: 'Feather', tag: 'Tag',
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
    legalLabel: 'Rechtliches', tocLabel: 'Inhalt', back: 'Zur Startseite', ids: { jobs: 'einkauf', cook: 'kochen', money: 'geld', levels: 'einstieg', how: 'so-merkt-es-sich', who: 'fuer-wen', ways: 'zwei-wege', prices: 'preise', privacy: 'datenschutz', host: 'selbst-hosten', why: 'warum', faq: 'fragen', install: 'installieren', tf: 'iphone-app', ha: 'home-assistant', house: 'hausinfo', nd: 'kopf-voll', diff: 'was-anders-ist', good: 'gut-zu-wissen', calm: 'ruhig-gebaut' },
    nav: [['#funktionen', 'Funktionen'], ['#preise', 'Preise'], ['#datenschutz', 'Datenschutz'], ['#selbst-hosten', 'Selbst hosten'], ['HELP', 'Hilfe'], ['BLOG', 'Ratgeber']],
    rail: [['#einkauf', 'Einkauf', 'basket'], ['#kochen', 'Kochen', 'pot'], ['#geld', 'Geld', 'wallet'], ['#preise', 'Preise', 'receipt']],
    hero: {
      label: 'Der smarte Assistent für euren Haushalt',
      h1: 'Damit nicht einer alles <span class="hl">im Kopf</span> haben muss.',
      lede: 'ToHuus merkt sich für euren Haushalt, was da ist, was fehlt und was es kostet. Dafür reichen eure Kassenbons und eure gemeinsame Liste.',
      ios: 'Im App Store laden', iosSub: 'iPhone, iPad und Apple Watch', gh: 'Selbst hosten auf GitHub',
      facts: ['Server in Deutschland (Hetzner)', 'Kein Tracking, keine Werbung', 'Selbst hosten kostenlos'],
      tiles: { flat: 'Wohnung', shared: 'WG', terraced: 'Reihenhaus', house: 'Haus' },
      tilesLabel: 'Vier gezeichnete Wohnformen: eine Wohnung, eine WG, Reihenhäuser und ein Haus.',
      shot: 'ToHuus auf dem iPhone, Seite Heute: unter „Fällig“ stehen Pizza Margherita, Reis und Spülmittel mit dem Hinweis, wie oft ihr sie kauft, jeweils mit Auf die Liste und Haben wir noch, darunter die Karte „Liste“ mit sechs Sachen.',
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
      intro: 'Aus dem, was ihr einkauft, wird gekocht, und dafür geht das Geld weg. Deshalb kümmert sich ToHuus um alle drei. Und um das, was ein Zuhause sonst noch ausmacht: die Aufgaben, die immer wiederkommen, einander was Gutes tun und Wünsche festhalten.',
      list: [
        { id: 'einkauf', no: '1', label: 'Einkauf', h3: 'ToHuus merkt sich, was fehlt.', shot: 'shopping',
          alt: 'Einkaufsliste in ToHuus: oben das Feld „Was fehlt?“, darunter Vorschläge wie Pizza Margherita mit „alle ~32 Tage“, darunter nach Bereichen sortierte Einträge wie Erdbeer-Eis mit dem Hinweis „im Vorrat knapp“.',
          p: 'Aus euren Bons und dem, was ihr auf der Liste abhakt, sieht ToHuus, wie oft ihr etwas kauft. Ist es wieder so weit, erscheint es als Vorschlag mit Grund. Einen Vorrat müsst ihr dafür nicht führen.',
          points: ['Eine Liste, live auf allen Handys, auch während einer im Laden steht', 'Wer etwas übernimmt, tippt auf „Ich hol’s“', 'Im Laden nach Gängen sortiert, auch ohne Netz'] },
        { id: 'kochen', no: '2', label: 'Kochen', h3: 'Daraus könnt ihr heute kochen.', shot: 'cook',
          alt: 'Seite Kochen, „Was kochen wir?“: für heute Abend geplant Lasagne, der Knopf „Entscheidet ihr für uns“, Filter nach Zeit und vegetarisch, darunter „Geht sofort“ mit Gnocchi-Pfanne und Ofengemüse mit Feta.',
          p: 'Der Kochplaner fängt bei dem an, was zu Hause ist. Er zeigt, was sofort geht, wo nur eine Zutat fehlt und was bald weg muss. Wer mag, plant die Woche, und was dafür fehlt, kommt mit einem Tipp auf die Liste.',
          points: ['Rezepte von Hand, per Link, vom Foto oder aus anderen Apps', 'Viele auf einmal als Rezeptpaket, auch von deiner eigenen KI gebaut', 'Mit und ohne Küchenmaschine, Allergien werden beim Vorschlagen berücksichtigt'] },
        { id: 'geld', no: '3', label: 'Geld', h3: 'Ihr seht, wohin das Geld für Essen und Haushalt geht.', shot: 'money',
          alt: 'Seite Geld für Oktober 2026: bisher 59,18 Euro, 23 Prozent weniger als im Vormonat, darunter die Einkäufe bei REWE und EDEKA mit Datum und Betrag.',
          p: 'Jeder Bon zählt mit. ToHuus zeigt, was ein Monat gekostet hat, in welchem Laden und für welche Kategorie, und vergleicht mit dem Vormonat. Ein Haushaltsbuch müsst ihr dafür nicht führen.',
          points: ['Ausgaben nach Monat, Laden und Kategorie', 'Preisänderungen bei Sachen, die ihr oft kauft', 'Budgets pro Woche, Monat oder Jahr, für alle oder nur für dich, mit Hinweis bei 80 Prozent', 'Export als CSV'] },
        { id: 'aufgaben', no: '4', label: 'Aufgaben', h3: 'Wer bringt diese Woche den Müll raus?', shot: 'tasks',
          alt: 'Seite Aufgaben im Bereich Zuhause: das Feld „Neue Aufgabe, z. B. Papiermüll rausbringen“, darunter fällig Bad putzen (heute) und Müll rausbringen (morgen), jeweils mit der Person, die dran ist, und dem Knopf Fertig.',
          p: 'Bad putzen, Bettwäsche wechseln, den Wasserfilter tauschen oder der Termin mit dem Schornsteinfeger: ToHuus merkt sich, was wann dran ist und wer es macht. Wenn ihr euch abwechselt, gibt „Erledigt“ die Aufgabe an den Nächsten weiter. Ranglisten gibt es nicht, Sterne nur, wenn ihr sie einschaltet. Dafür gibt es einen ruhigen Blick darauf, wer gerade woran denkt.',
          points: ['Einmal, wiederkehrend oder bei Bedarf, für alle oder nur für dich', 'Termine mit Uhrzeit stehen in Apple Kalender, Google oder Outlook, Aufgaben in Apple Erinnerungen', 'Auch Kinder können dran sein, und was keiner im Blick hat, fällt auf'] },
        { id: 'bring-mir-was', no: '5', label: 'Bring mir was', h3: 'Einer liegt auf dem Sofa, einer steht in der Küche.', shot: 'treats',
          alt: 'Seite Bring mir was: „Was hättest du gern?“, darunter Karten wie Was Süßes, Was zu trinken, Was zum Knabbern und Aus dem Kühlschrank, dazu die Reiter Gäste und Party.',
          p: 'Wer gerade festsitzt, im Bett, beim Zubettbringen oder mit Kind auf dem Arm, wünscht sich mit zwei Tipps eine Kleinigkeit. Die anderen sehen es sofort, einer sagt „Ich bring’s“, und eure Karte zeigt nur, was wirklich da ist. Für Besuch gibt es eine eigene Karte, und am Partyabend bestellen die Gäste direkt von eurer Partykarte.',
          points: ['Eure eigene Karte: Süßes, Getränke, Snacks, aus dem Kühlschrank', 'Gäste wünschen sich etwas über einen Link, ganz ohne App', 'Party: ihr seht, was bestellt ist und was noch da ist'] },
        { id: 'wuensche', no: '6', label: 'Wünsche', h3: 'Wunschlisten, die nichts verraten.', shot: 'wishes',
          alt: 'Seite Wünsche: die Liste „Weihnachten Mika“ mit vier Wünschen, einer davon vergeben, und die „Merkliste Kekse“ mit drei Wünschen.',
          p: 'Geburtstag, Weihnachten oder einfach eine Merkliste: Wünsche mit Foto, mehreren Links, Preis und Notiz. Wer etwas reserviert, sieht der Rest der Familie, die beschenkte Person aber nie. Eine Liste lässt sich ganz oder in Teilen per Nachricht verschicken.',
          points: ['Foto, Links, Preis und „wer könnte das schenken“', 'Private Listen, die nur du siehst', 'Teilen als Link oder fertige Nachricht'] },
      ],
    },
    house: {
      label: 'Hausinfo', h2: 'Vom Gäste-WLAN bis zur Kaffeemaschine.',
      intro: 'Wer bei euch übernachtet, auf die Kinder aufpasst oder die Katze füttert, fragt meistens dasselbe: Wie ist das WLAN-Passwort, wie geht die Heizung, wann müssen die Kinder ins Bett? In der Hausinfo schreibt ihr das einmal auf, danach schickt ihr nur noch einen Link.',
      path: [
        ['wifi', 'Gäste-WLAN', 'Netz und Passwort liegen geschützt bei den Codes. Tippst du auf „Zeigen“, erscheint ein QR-Code, und euer Besuch ist mit der Handykamera im WLAN.'],
        ['pin', 'Wo was ist', 'Pflaster, Taschenlampe, Sicherungskasten, Haupthahn. Über „Wo ist was?“ findet der Babysitter auch die Kekse, aber nur an den Orten, die ihr freigebt.'],
        ['coffee', 'So geht’s hier', 'Heizung, Spülmaschine, Rollläden, Kaffeemaschine: kurz erklärt, auf Wunsch mit Foto oder kurzem Video. Mit Alexa, Google, Siri oder Home Assistant stehen die passenden Sprachbefehle dabei.'],
        ['moonstars', 'Hausregeln und Kinder', 'Was die Kinder dürfen, wann Schlafenszeit ist und was sonst bei euch gilt, zum Beispiel Schuhe aus im Flur.'],
        ['aid', 'Für den Notfall', 'Wichtige Nummern stehen ganz oben. Notruf, Giftnotruf, Nachbarn und eure eigenen Nummern gibt es als Vorlage, den Kinderarzt tragt ihr dazu.'],
      ],
      shots: [
        ['houseinfo', 'Seite Hausinfo nach Raum: unter Codes das Gäste-WLAN „Berg-Gast“ und die Haustür, beide verdeckt mit Zeigen-Knopf, darunter Karten fürs Kinderzimmer und die Küche.'],
        ['houseinfo-guest', 'Babysitter-Link von Familie Berg im Bereich Hausinfo, „So funktioniert’s hier“: das Gäste-WLAN verdeckt mit Zeigen-Knopf, darunter im Kinderzimmer die Karten „Schlafenszeiten Mika“ und „Was Mika darf“.'],
      ],
      caption: 'Links eure Hausinfo mit dem Gäste-WLAN, rechts das, was der Babysitter über seinen Link sieht.',
      forLabel: 'Gedacht für',
      for: [['baby', 'Babysitter'], ['users', 'Oma, Opa und alle, die oft da sind'], ['paw', 'Haus- und Tiersitter'], ['bed', 'Übernachtungsbesuch'], ['suitcase', 'Gäste in der Ferienwohnung']],
      facts: [
        ['eyeoff', 'Jeder sieht, was er sehen soll', 'Pro Karte legt ihr fest, wer sie sieht: alle, die hier wohnen, feste Gäste ab einer Stufe, alle Babysitter-Links oder nur bestimmte Links. Codes gebt ihr auf Wunsch nur bis zu einem Datum frei.'],
        ['key', 'Codes liegen extra', 'Türcode, Alarmanlage, Garage und WLAN liegen getrennt von den Karten, in der Cloud verschlüsselt. Sie bleiben verdeckt, bis jemand auf „Zeigen“ tippt, und ihr seht, wer wann nachgesehen hat. Gäste sehen einen Code nur, wenn ihr ihn freigebt.'],
        ['robot', 'Codes gehen nicht an KI', 'Der Assistent, KI-Assistenten über MCP, Home Assistant und Benachrichtigungen bekommen nie einen Code zu sehen. In einen Export kommen Codes nur, wenn ein Admin das ausdrücklich ankreuzt.'],
        ['share', 'Ein Link, kein Konto', 'Babysitter und Gäste öffnen einen Link oder scannen einen QR-Code, ohne App und ohne Anmeldung. Einmal geöffnet, bleiben die Karten auch ohne Netz lesbar. Der Link läuft ab, wann ihr wollt, und lässt sich jederzeit widerrufen.'],
        ['printer', 'Zum Ausdrucken', 'Als A4-Blatt „Für den Babysitter“ für den Kühlschrank: wichtige Nummern zuerst, dann alles nach Räumen. Statt der Codes steht dort „bitte fragen“, außer ihr druckt sie bewusst mit.'],
        ['suitcase', 'Wenn ihr weg seid', 'Für die Reise gibt es die Übergabe: Katze morgens und abends füttern, Blumen montags und donnerstags gießen, mit Fotos. Der Haushüter hakt ab, was erledigt ist, und sein Link endet am Tag nach eurer Rückkehr.'],
      ],
      more: 'Hausinfo und Babysitter-Link in der Hilfe', help: 'hausinfo.html',
    },
    nd: {
      label: 'Wenn der Kopf voll ist', h2: 'Für Köpfe, in denen viel los ist.',
      intro: 'Mit ADHS, Autismus oder einfach in einer vollen Woche ist oft der Anfang das Schwerste: Wo fange ich an, was war noch mal dran, und wie lange dauert das überhaupt? Ein paar Sachen in ToHuus sind genau dafür gebaut. Sie helfen allen im Haushalt, und niemand muss erklären, warum.',
      list: [
        ['list', 'Kleine Schritte', 'Jede Aufgabe lässt sich in kleine Schritte teilen, die du einzeln abhakst. „In kleine Schritte teilen“ schlägt welche vor: mit KI, wenn euer Haushalt das erlaubt, sonst aus fertigen Schritten für Bad putzen, Küche, Wäsche, Staubsaugen oder Bett beziehen. Ist die Aufgabe erledigt, stehen die Schritte beim nächsten Mal wieder offen da.'],
        ['target', 'Eins nach dem anderen', 'Die Fokusansicht zeigt nur eine Sache: die nächste Aufgabe und darin den nächsten Schritt, groß und ohne Liste drumherum. Darunter stehen „Geschafft“, „Später“ und „Zu groß? Kleiner machen“.'],
        ['timer', 'Sichtbarer Timer', 'Fünf Minuten, nur anfangen. Ein Ring zeigt, wie viel Zeit noch bleibt, am Ende kommt ein sanftes Signal. Gezählt oder ausgewertet wird dabei nichts.'],
        ['feather', 'Sanfter Modus', 'Eine Einstellung nur für dich: keine roten Warnungen und keine Zähler, was fällig ist, „wäre dran“. „Neu anfangen“ legt alles Überfällige auf einen frischen Start, ohne Vorwurf. Mitteilungen kommen gebündelt in einer Nachricht zu der Zeit, die du wählst, und auf Heute stehen höchstens drei Sachen.'],
        ['users', 'Keine Ranglisten, keine Serien', 'Es gibt keine Streaks und keine Ranglisten. Sterne gibt es nur, wenn ihr sie selbst einschaltet, und im sanften Modus sind sie ausgeblendet. „Wer hat was im Blick“ zeigt Namen alphabetisch, Anteile nur, wenn alle im Haushalt zustimmen.'],
        ['list', 'Denkarbeit-Check', '33 Karten für die unsichtbare Arbeit, von „Merken, wenn etwas zur Neige geht“ bis „An Geburtstage denken“. Jede Person antwortet für sich, der Haushalt sieht die Antworten nur, wenn alle zustimmen. Zu jeder Karte steht, was ToHuus dir davon abnimmt.'],
        ['pin', 'Aus den Augen, nicht aus dem Sinn', '„Wo ist was?“ weiß, wo die Batterien liegen und was im Gefrierfach ist. Wer mag, führt einen Vorrat und sieht, was da ist und was bald alle ist.'],
        ['mic', 'Schnell aus dem Kopf', 'Ein Tipp auf den Assistenten, ein Satz, und es steht auf der Liste oder bei den Aufgaben, bevor der Gedanke wieder weg ist.'],
        ['tag', 'Extras im Wocheneinkauf', 'Ihr legt fest, wie viel pro Woche für Extras drin ist, als Betrag oder als Anzahl. Einträge auf der Liste markiert ihr als Extra, und die Liste zeigt, wie viel davon schon verplant ist. Gesperrt wird nichts, ihr behaltet nur den Überblick, auch bei spontanen Käufen.'],
      ],
      shots: [
        ['focus', 'Fokusansicht „Eins nach dem anderen“: nur die Aufgabe „Bad putzen“, Schritt 2 von 3, ein Timer-Ring mit 5 Minuten und die Knöpfe Geschafft, Später und Zu groß? Kleiner machen.'],
        ['loadcards', 'Denkarbeit-Check: oben die eigene Zusammenfassung, darunter Karten wie „Merken, wenn etwas zur Neige geht“ mit den Antworten Mache meistens ich, Teilen wir, Macht meistens jemand anders.'],
      ],
      caption: 'Links eins nach dem anderen mit Timer, rechts der Denkarbeit-Check.',
      note: 'ToHuus richtet sich nach „Bewegung reduzieren“ auf deinem Gerät, und an Tagen, an denen das Aufstehen schwerfällt, gibt es „Bring mir was“. ToHuus ist kein Gesundheits- oder Therapieangebot. Es nimmt euch nur ein paar Sachen aus dem Kopf.',
      more: 'Alles dazu in der Hilfe', help: 'kopf-voll.html',
    },
    levels: {
      label: 'Einstieg', h2: 'Egal, wie digital ihr schon einkauft.',
      intro: 'Wenn der Einkauf digitaler wird, solltest du auch etwas davon haben. ToHuus arbeitet mit dem, was ihr ohnehin habt. Für den Anfang reicht einer dieser Wege.',
      shot: 'import', alt: 'Seite Bons: Bon hinzufügen, digitaler Bon per QR-Code oder Link, Schrank fotografieren oder Zeilen einfügen, darunter der Verlauf mit gebuchten Bons von REWE und EDEKA.',
      list: [
        ['receipt', 'Lieferdienst und eBon', 'Bestellt ihr bei REWE oder bekommt ihr digitale Bons, kommen Bestellung und Bon als PDF herein. ToHuus gleicht beides ab und bucht, was wirklich geliefert wurde.'],
        ['camera', 'Bon fotografieren', 'Bei Aldi, Lidl oder auf Papier reicht ein Foto vom Bon. Was ToHuus nicht sicher lesen kann, legt es dir zum Prüfen vor, bevor etwas gebucht wird. Die Texterkennung läuft ohne KI, auf dem Server oder direkt auf deinem iPhone.'],
        ['mic', 'Einfach sagen', 'Du tippst auf den runden Assistenten-Knopf und sagst: „Milch ist alle, und wir brauchen was für Sonntag.“ Der Assistent setzt es auf die Liste und sagt dir, was er eingetragen hat. Jeder Schritt lässt sich zurücknehmen.'],
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
      rows: [['Mozzarella', 'merkt sich: alle ~9 Tage', 'rhythm'], ['Backpapier', 'Mira · heute 16:41', 'person'], ['2× Haferdrink', 'Mira · heute 16:41', 'person'], ['Paketband', 'Ben · gestern', 'person'], ['Tomaten, stückig', 'aus dem Wochenplan', 'plan']],
      cardFoot: 'Keine Zeile ohne Absender',
    },
    who: {
      label: 'Für wen', h2: 'Für jeden Haushalt, in dem eingekauft wird.',
      intro: 'Beim Start fragt ToHuus nur, wer dazugehört. Danach richtet sich, was ihr seht.',
      forms: [
        ['c', 'Allein', 'Du musst dir nichts merken, und am Monatsende siehst du, was Essen und Haushalt gekostet haben.'],
        ['h', 'Zu zweit', 'Beide wissen, was fehlt. Keiner muss den anderen fragen, ob noch Kaffee da ist.'],
        ['s', 'Familie', 'Alle schreiben auf dieselbe Liste. Kinder und feste Gäste sehen nur, was ihr freigebt.'],
        ['t', 'WG', 'Gemeinsames kommt auf eine Liste, private Einträge sehen die anderen nicht. Beim Putzplan wechselt ihr euch ab, und keiner muss daran erinnern.'],
        ['a', 'Mitversorgen', 'Wer für Eltern oder Großeltern mit einkauft, verbindet die beiden Haushalte und sieht, was dort fehlt.'],
      ],
      note: 'ToHuus setzt keinen Keller, keine Gefriertruhe und keinen Thermomix voraus. Ihr legt fest, welche Orte es bei euch gibt.',
    },
    diff: {
      label: 'Was anders ist', h2: 'Nicht das Tool für alles. Der Teil, der Haushalt ist.',
      intro: 'ToHuus ist der smarte Assistent, der nicht den Anspruch hat, das Tool für alles zu sein. Für Termine, Notizen und Nachrichten habt ihr schon gute Apps. ToHuus nimmt sich davon, was Haushalt ist, und arbeitet mit ihnen zusammen.',
      list: [
        ['list', 'Ein Ort für Liste, Kochen, Aufgaben und Geld', 'Was ihr einkauft, wird gekocht, und dafür geht das Geld weg. ToHuus verbindet das aus euren Bons und eurer Liste. Vier Apps nebeneinander braucht ihr dafür nicht.'],
        ['users', 'Lernt, wer was macht, ohne Punkte', 'ToHuus merkt sich, wer eine Aufgabe meistens übernimmt, und schlägt es beim nächsten Mal vor. Punkte, Ranglisten und Serien gibt es nicht, Sterne nur, wenn ihr sie einschaltet.'],
        ['feather', 'Im Kopf & nebenbei erledigt', 'Unter „Im Kopf“ steht, woran jemand gerade denkt, unter „Nebenbei erledigt“, was ohne Liste passiert ist. Die anderen können „Danke“ sagen. Gezählt wird dabei nichts.'],
        ['sparkle', 'Was habt ihr heute gelöst?', 'Abends fragt ToHuus auf Heute ab und zu nach, was ihr ohne App geschafft habt. Die Antwort ist immer freundlich, und so lernt ToHuus, wer was macht. Du kannst die Frage abschalten.'],
        ['house', 'Für wen ich da bin', 'Wer für Eltern oder Großeltern da ist, legt Besuche, Arzttermine und Besorgungen als Aufgaben an, privat, solange du willst. Allein mit Kindern? Dann gibt es keine Vergleiche, nur den Blick auf das, was du geschafft hast.'],
        ['suitcase', 'Unterwegs, auch einzeln', 'Dienstreise oder Krankenhaus: Für die Zeit legt ihr fest, wer was übernimmt und was warten darf. Die Aufgaben zeigen dann, wer einspringt, und auch feste Gäste wie Oma können Aufgaben übernehmen.'],
        ['chart', 'Wochen- und Monatsrückblick', '„Das habt ihr geschafft“ für alle und „Das hast du geschafft“ nur für dich, ohne Vergleich und ohne Geld. Eine Karte, die dir gefällt, teilst du als Bild, ohne Namen.'],
        ['list', 'Wischen zum Entscheiden', 'Was essen wir? Jeder wischt für sich Ja oder Nein, und ihr seht, was alle wollen. Genauso gehst du ältere Gedanken in „Im Kopf“ durch: noch wichtig, erledigt oder loslassen.'],
        ['lock', 'Privat bleibt privat', 'KI nur mit eurer Zustimmung und über Mistral, selbst gehostet mit eigener KI oder ganz ohne. Gesundheitsangaben gehen nur an eine KI, wenn ihr das ausdrücklich erlaubt. Was du über Menschen einträgst, um die du dich kümmerst, nie.'],
      ],
      tableH: 'Neben anderen Apps', cols: ['Gut für', 'Was ToHuus anders macht'],
      rows: [
        ['Bring!', 'Eine geteilte Einkaufsliste, im Laden schnell mit einer Hand bedient.', 'Auch eine geteilte Liste, im Laden nach Gängen sortiert. Dazu merkt ToHuus sich aus Bons und Häkchen, wann etwas wieder fällig ist, und hängt Kochen und Geld daran.'],
        ['Cozi, FamilyWall', 'Familienkalender, Listen und Nachrichten an einem Ort.', 'Kein eigener Kalender und kein Chat. Termine gehen in den Kalender, den ihr schon nutzt. ToHuus kümmert sich um Einkauf, Kochen, Geld und Aufgaben.'],
        ['OurHome', 'Aufgaben für die Familie mit Punkten und Belohnungen.', 'Aufgaben mit Abwechseln, aber ohne Punkte und Ranglisten. ToHuus lernt, wer was meistens macht.'],
        ['Fair Play, FairShare', 'Unsichtbare Arbeit sichtbar machen, über Bereiche, die ihr miteinander aufteilt.', 'Die Bereiche lernt ToHuus aus eurem Alltag. „Im Kopf“ zeigt auch das Kleine, das auf keiner Karte steht.'],
        ['Todoist, Apple Erinnerungen', 'Aufgabenlisten für alles, vom Job bis zum Einkauf.', 'Nur Haushalt, dafür mit Abwechseln, Vorschlägen und dem Blick darauf, wer was im Kopf hat. Aufgaben stehen auf Wunsch zusätzlich in Apple Erinnerungen.'],
        ['Apple Notizen', 'Schnell etwas aufschreiben und teilen.', 'ToHuus ersetzt sie nicht: Listen gehen als Text an Notizen, Mail oder Nachrichten.'],
      ],
      note: 'Stand Oktober 2026, nach den Beschreibungen der Anbieter und unserer eigenen Recherche. Die Namen gehören ihren Inhabern, ToHuus steht in keiner Verbindung zu ihnen.',
      share: 'Zahlen und Sätze zum Teilen', shareHref: 'teilen.html',
    },
    good: {
      label: 'Gut zu wissen', h2: 'Was zu Hause oft keiner sieht.',
      intro: 'Ein paar Zahlen und Befunde rund um Pflege, Denkarbeit und Wertschätzung, jede mit Quelle. Sie beschreiben, was Studien und Statistiken gemessen haben, nicht eine Wirkung von ToHuus.',
      source: 'Quelle:', more: 'Alle Karten zum Teilen, als Bild für Feed und Story', href: 'teilen.html',
    },
    calm: {
      label: 'Ruhig gebaut', h2: 'Gebaut, damit du schnell wieder weg bist.',
      intro: 'Was ToHuus mit deinem Stress oder deiner Bildschirmzeit macht, haben wir nicht gemessen, also versprechen wir es auch nicht. Versprechen können wir, wie ToHuus gebaut ist.',
      list: [
        'Kein Feed und nichts zum Weiterscrollen. Jede Seite hat ein Ende.',
        'Keine Serien, keine Punkte, keine Ranglisten. Sterne nur, wenn ihr sie selbst einschaltet.',
        'Mitteilungen auf Wunsch gebündelt, zu einer Uhrzeit, die du wählst. Werbe-Pushs schicken wir nicht.',
        '„Fertig für heute“: Ist alles Wichtige erledigt, sagt Heute das. Leg das Handy ruhig weg.',
        'Die Abendfrage steht nur auf Heute, ohne Push und höchstens jeden zweiten Abend. Du kannst sie abschalten.',
        'Vieles geht, ohne die App zu öffnen: mit Siri, dem Widget oder der Apple Watch.',
      ],
      not: 'Was wir nicht versprechen: weniger Stress, weniger Minuten am Handy oder besseren Schlaf. Dafür müssten wir das erst sauber messen, und das haben wir nicht.',
    },
    ways: {
      label: 'Zwei Wege', h2: 'In der ToHuus Cloud oder auf deinem eigenen Server.',
      intro: 'Es ist dieselbe App mit demselben Code. Der Unterschied ist, wer den Server betreibt.',
      cols: ['ToHuus Cloud', 'Selbst hosten'],
      rows: [
        ['Für wen', 'Alle, die einfach anfangen wollen', 'Alle mit eigenem Server, NAS oder Home Assistant'],
        ['Apps', 'App für iPhone, iPad und Apple Watch, dazu im Browser, auch auf Android', 'Die iPhone-App, verbunden mit deinem Server, und im Browser als Web-App. Dazu Home Assistant und eigene Assistenten über MCP'],
        ['Daten', 'Server in Deutschland (Hetzner), jeder Haushalt mit eigenem Schlüssel verschlüsselt', 'Auf deinem Server, auf Wunsch verschlüsselt'],
        ['Bon-Fotos und Assistent', 'Free ohne KI, ab Haushalt mit KI und Kontingent je nach Tarif. KI abschaltbar für Haushalt, Person und Kinder', 'Mit eigenem KI-Schlüssel oder ganz ohne'],
        ['Claude, ChatGPT (MCP)', 'Über MCP mit Anmeldung (OAuth)', 'Über MCP mit Zugangsschlüssel'],
        ['Home Assistant', 'Über die HACS-Integration, verbunden mit einem Code aus der App', 'Voll, dazu Bon-Postfach, Telegram und Bon-Drucker im eigenen Netz'],
        ['Kosten', 'Free, Haushalt oder Plus', 'Kostenlos, AGPL-3.0'],
      ],
    },
    prices: {
      label: 'Preise', h2: 'Ein Abo pro Haushalt.',
      intro: 'Mitglieder und Gäste zahlen nie. Jeder neue Haushalt in der Cloud startet von selbst mit 14 Tagen Plus, ohne Zahlungsdaten. Danach geht er auf Free zurück, wenn ihr kein Abo abschließt. Gelöscht wird dabei nichts.',
      per: '/ Monat', or: 'oder', year: '/ Jahr', storage: 'Speicher',
      plans: [
        { name: 'Free', price: '0 €', sub: 'ohne KI', storage: '100 MB', items: ['Gemeinsame Liste mit Einkaufsmodus', 'Aufgaben und „Im Kopf“', 'Wochenplan und Rezepte von Hand', 'Rückblicke und Teilen', 'Der Assistent versteht einfache Sätze wie „Milch und Brot“, ganz ohne KI', 'Merkt sich 30 Tage zurück, 20 Uploads am Tag'] },
        { name: 'Haushalt', price: '3,99 €', year: '34,99 €', storage: '2 GB', items: ['Alles aus Free', 'Die ganze Geschichte mit Preisverlauf und Ausgaben', 'Verbundene Haushalte und gespiegelte Listen', 'Bons, Screenshots und Fotos mit KI lesen lassen', '100 Nachrichten an den Assistenten im Monat'] },
        { name: 'Plus', price: '5,99 €', year: '59,99 €', storage: '5 GB', items: ['Alles aus Haushalt', 'Der Assistent für jeden Tag', 'Wochenplan aus dem, was da ist', 'Monatsauswertung und Ersatz aus dem Vorrat', 'Neue ToHuus-Rezepte zur Jahreszeit, mit Bild', '1.500 Nachrichten im Monat. Wird es mehr, antwortet er langsamer, gesperrt wird nie'], mark: '14 Tage zum Ausprobieren' },
        { name: 'Selbst hosten', price: '0 €', sub: 'AGPL-3.0', storage: 'so viel dein Server hat', items: ['Alles freigeschaltet', 'Mit eigener KI, jeder OpenAI-kompatible Anbieter geht, oder ganz ohne', 'iPhone-App, Web-App, Home Assistant, MCP'], host: true },
      ],
      fund: 'Mit jedem Abo finanziert ihr auch Lizenzen für Familien, die es sich gerade nicht leisten können. Werbung gibt es bei uns nicht, und eure Daten verkaufen wir nicht.',
      note: 'Preise zum Start. Bezahlt wird in der iPhone-App über Apple.',
      codes: 'Von uns kannst du auch einen Code bekommen, für einen Monat, ein Jahr oder für immer. Du löst ihn im Browser ein (Einstellungen › Abo › Code einlösen), dann gilt er auf jedem Gerät, auch auf dem iPhone.',
      hardship: {
        id: 'nicht-leisten', h3: 'Wir können uns das gerade nicht leisten.',
        p: 'Wenn das Geld gerade nicht reicht, aber der Kopf voll ist, schreib uns. Du bekommst eine Lizenz, ohne Begründung und ohne Formular-Marathon. Wir melden uns per Mail.',
        email: 'Deine E-Mail-Adresse', name: 'Dein Name', people: 'Wer lebt bei euch?', peopleHint: 'z. B. 2 Erwachsene, 2 Kinder', message: 'Magst du noch was dazuschreiben?',
        optional: 'wenn du magst', send: 'Anfrage schicken', hp: 'Bitte leer lassen',
        privacy: 'Wir speichern nur, was du hier einträgst, verschlüsselt in der ToHuus Cloud, und löschen es 180 Tage nach unserer Antwort. Es gibt kein Tracking.', privacyLink: 'Mehr dazu im Datenschutz',
      },
    },
    privacy: {
      label: 'Datenschutz und Sicherheit', h2: 'Eure Bons arbeiten für euch, nicht für Marktforschung.',
      intro: 'Hier steht nur, was sich prüfen lässt. Wie die Cloud aufgebaut ist, steht offen im Quellcode und in der Dokumentation.',
      facts: [
        ['server', 'Server in Deutschland', 'Die ToHuus Cloud läuft auf Servern von Hetzner in Deutschland.'],
        ['key', 'Jeder Haushalt mit eigenem Schlüssel', 'Jeder Haushalt hat eine eigene, verschlüsselte Datenbank mit eigenem Schlüssel. Fotos und Bon-Dateien sind ebenfalls verschlüsselt.'],
        ['eyeoff', 'Kein Tracking, keine Werbung', 'Eure Bons werden weder verkauft noch für Werbung ausgewertet. Auch diese Website setzt keine Cookies.'],
        ['robot', 'KI nur über Mistral', 'Bon-Fotos, Spracheingaben und der Assistent laufen über Mistral, einen Anbieter aus Frankreich. Vermittelt wird die Anfrage über OpenRouter (USA), das Inhalte nicht speichert (Details in der Datenschutzerklärung). Jede Anfrage ist auf Mistral festgelegt, ohne Ausweichen auf andere Anbieter, und wird nicht zum Training genutzt. In der Cloud fragt ToHuus vorher: Ohne deine Zustimmung geht nichts an ein Sprachmodell. Sprachaufnahmen werden nicht gespeichert.'],
        ['lock', 'Sensible Angaben bleiben zu Hause', 'Allergien und Angaben zu Kindern gehen nur an ein Sprachmodell, wenn ihr das ausdrücklich einschaltet.'],
        ['mail', 'Mails nur, wenn du willst', 'Zusammenfassung und Abo-Erinnerung schaltest du unter Einstellungen › Benachrichtigungen › Mails von ToHuus ab, oder mit einem Klick in jeder dieser Mails. Werbung schicken wir nicht.'],
        ['power', 'KI lässt sich abschalten', 'Für den ganzen Haushalt, nur für dich oder für einzelne Kinder. Dann geht keine Anfrage an ein Sprachmodell, und Liste, Vorschläge, Kochen und Geld laufen weiter. Für Kinder ist sie in der Cloud erst aus, bis ein Elternteil sie einschaltet.'],
        ['phone', 'Apple Intelligence nur auf dem iPhone', 'Wer möchte, lässt Bon-Fotos und handgeschriebene Listen von Apple Intelligence direkt auf dem iPhone aufräumen. Das ist pro Gerät ausgeschaltet, bis du es einschaltest, und dafür verlässt nichts das Gerät.'],
        ['scan', 'Texterkennung ohne KI', 'Bon-Fotos liest zuerst eine Texterkennung ohne Sprachmodell auf dem Server, oder dein iPhone liest sie selbst und schickt nur den Text. Nur wenn das nicht aufgeht und KI an ist, liest Mistral das Foto.'],
        ['plug', 'Eure Assistenten nur, wenn ihr wollt', 'Claude oder ChatGPT verbindet ihr selbst über MCP. Diskrete Einträge sehen sie nur als Platzhalter, und ein Admin kann MCP abschalten.'],
        ['trash', 'Wenn ihr löscht', 'Löscht ihr den Haushalt, wird zuerst sein Schlüssel vernichtet, dann folgen die Daten und ihre Sicherungen. Sicherungskopien der Kontoverwaltung laufen nach ihrer Frist ab.'],
      ],
      link: 'Technische Details zur Cloud', linkHref: `${GH}/blob/main/docs/cloud.md`,
    },
    host: {
      label: 'Selbst hosten', h2: 'Für alle mit eigenem Server.',
      p: 'Ein Docker-Container und eine SQLite-Datei, kostenlos unter AGPL-3.0. Im Browser läuft ToHuus als Web-App, die du auf den Startbildschirm legen kannst. Die iPhone-App verbindest du mit deinem Server, am einfachsten mit dem QR-Code aus der Web-App. Ein Konto bei uns brauchst du dafür nicht.',
      facts: [
        ['refresh', 'Home Assistant in beide Richtungen', 'Einkaufsliste als To-do-Liste für Assist, Sensoren für Fälliges und den Wochenplan als Kalender. Installiert über HACS, die Integration steht unter MIT-Lizenz.'],
        ['mail', 'Bon-Postfach, Telegram, Drucker', 'Bons kommen per Mail herein, „2 Milch, Brot“ im Chat landet auf der Liste, und ein Bon-Drucker in der Küche druckt sie aus.'],
        ['robot', 'KI optional', 'Mit einem Schlüssel für jeden OpenAI-kompatiblen Dienst, etwa Mistral, auch lokal. Ohne Schlüssel läuft alles weiter: Bon-Fotos liest die Texterkennung auf deinem Server, und der Assistent versteht die häufigen kurzen Sätze.'],
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
      label: 'iPhone-App', h2: 'ToHuus auf dem iPhone.',
      p: 'Die App gibt es im App Store, für iPhone, iPad und Apple Watch. Sie läuft mit der ToHuus Cloud und mit deinem eigenen Server. Laden kostet nichts, und jeder neue Haushalt in der Cloud nutzt 14 Tage lang Plus, ohne Zahlungsdaten.',
      points: ['iPhone, iPad und Apple Watch', 'Mit der ToHuus Cloud oder deinem eigenen Server', 'Widget und Teilen aus anderen Apps', 'Ohne App geht ToHuus im Browser, auf jedem Gerät'],
      cardTitle: 'So fängst du an',
      rows: ['ToHuus im App Store laden', 'Einen Haushalt anlegen oder einer Einladung folgen', 'Eigener Server? Auf dem Startbildschirm „Eigener Server“ tippen', 'Die ersten Sachen auf die Liste setzen'],
      cta: 'Im App Store laden', ctaSub: 'iPhone, iPad und Apple Watch',
      note: 'Bezahlt wird nur, wenn du ein Abo abschließt, in der App über Apple.',
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
        ['Muss ich alles abtippen?', 'Nein. Bons kommen als PDF oder Foto herein. Mit Plus bekommt euer Haushalt in der Cloud eine eigene Bon-Adresse (kommt bald), selbst gehostet geht es über ein eigenes Postfach. Was ihr auf der Liste abhakt, zählt ebenfalls als Einkauf. Einen Vorrat müsst ihr nicht pflegen.'],
        ['Funktioniert das ohne REWE?', 'Ja. ToHuus liest auch Bons von Lidl, Aldi, Edeka, Netto, Kaufland, Penny, dm und Rossmann, Papierbons per Foto. Wer gar keine Bons sammeln will, hakt einfach auf der Liste ab.'],
        ['Gibt es ToHuus für Android?', 'Eine eigene Android-App gibt es nicht. Im Browser läuft ToHuus als Web-App, die du auf den Startbildschirm legen kannst, auf Android genauso wie am Rechner.'],
        ['Gibt es ToHuus als iPhone-App?', `Ja, <a href="${appHref('de')}">im App Store</a>, für iPhone, iPad und Apple Watch. Sie läuft mit der ToHuus Cloud und mit deinem eigenen Server.`],
        ['Brauche ich dafür KI?', 'Nein. Liste, Vorschläge, Kochplaner und Ausgaben funktionieren ohne. Bon-Fotos liest ToHuus zuerst mit einer Texterkennung ohne KI, auf dem Server oder direkt auf dem iPhone. Ein Sprachmodell hilft nur, wenn das nicht reicht, und bei freien Fragen an den Assistenten. Auf neueren iPhones kann auf Wunsch Apple Intelligence auf dem Gerät helfen. In der Cloud schaltest du KI erst mit deiner Zustimmung ein, und ihr könnt sie für den Haushalt, für einzelne Personen und für Kinder abschalten.'],
        ['Kann ich meine Rezepte mitbringen?', 'Ja. Per Link von Rezeptseiten, aus Instagram, TikTok, Pinterest oder YouTube, per Foto, aus Apps wie Mealie, Paprika oder Nextcloud Kochbuch, oder viele auf einmal als Rezeptpaket mit Fotos. Hast du Claude oder ChatGPT verbunden, kann deine eigene KI auch hunderte Rezepte samt Fotos in einem Rutsch speichern.'],
        ['Und Cookidoo, Monsieur Cuisine oder Cookit?', 'Teile ein Rezept aus Cookidoo, Monsieur Cuisine, Cookit oder einer anderen Küchenmaschinen-App mit ToHuus oder füge den Link ein, dann bestätigst du Name und Zutaten. Die Schritte kannst du dazuschreiben, als Text einfügen oder aus deinen Screenshots lesen lassen. ToHuus ruft diese Seiten selbst nie ab, und was du mitbringst, bleibt privat in eurem Haushalt.'],
        ['Was ist die Hausinfo?', 'Karten für alle, die bei euch aufpassen oder zu Besuch sind: Gäste-WLAN mit QR-Code, wie Heizung und Kaffeemaschine gehen, Hausregeln, Schlafenszeiten und wichtige Nummern, auf Wunsch mit Fotos und kurzen Videos. Babysitter öffnen sie über einen Link ohne Konto, einmal geöffnet auch offline, oder ihr druckt sie als A4-Blatt aus. Für den Urlaub gibt es die Übergabe: was der Haushüter wann tun soll, mit Fotos.'],
        ['Sehen Gäste unsere Codes?', 'Nur die, die ihr freigebt, auf Wunsch bis zu einem Datum. Jeder Code bleibt verdeckt, bis jemand auf „Zeigen“ tippt, und ihr seht, wer wann nachgesehen hat. An eine KI, an Home Assistant oder in Benachrichtigungen gehen Codes nie.'],
        ['Ist ToHuus für ADHS geeignet?', 'ToHuus ist für alle Haushalte gebaut, einiges davon aber gerade für Köpfe, in denen viel los ist: Aufgaben in kleinen Schritten, eine Ansicht, die nur das Nächste zeigt, ein sichtbarer Timer zum Anfangen und ein sanfter Modus ohne rote Warnungen. Streaks oder Ranglisten gibt es nicht, Sterne nur, wenn ihr sie einschaltet. Ob es zu dir passt, merkst du am besten im Alltag. Eine Behandlung oder Beratung ersetzt es nicht.'],
        ['Sehen die anderen, dass ich den sanften Modus nutze?', 'Nein. Der sanfte Modus ist eine persönliche Einstellung und ändert nur, was du siehst und wann du Mitteilungen bekommst.'],
        ['Hilft ToHuus bei Spontankäufen?', 'Ihr könnt ein Kontingent für Extras festlegen, pro Woche als Betrag oder als Anzahl. Einträge auf der Liste markiert ihr als Extra, und die Liste zeigt, wie viel davon schon verplant ist. ToHuus sperrt nichts, es zeigt nur, wo ihr steht.'],
        ['Brauche ich einen Thermomix?', 'Nein. Der Kochplaner zeigt Rezepte mit und ohne Küchenmaschine, und ihr könnt danach filtern. Mit Plus gibt es auch ToHuus-Rezepte für Thermomix, Monsieur Cuisine und Cookit, mit den Einstellungen bei jedem Schritt.'],
        ['Wer zahlt, wenn wir zu viert sind?', 'Ein Abo gilt für den ganzen Haushalt. Mitglieder, Kinder, Gäste und verbundene Haushalte zahlen nichts.'],
        ['Was passiert, wenn ich das Abo kündige?', 'Der Haushalt geht auf Free zurück. Gelöscht wird nichts. Ihr seht dann die letzten 30 Tage, und der Assistent versteht nur noch einfache Sätze, ohne KI. Mit dem nächsten Abo ist alles wieder da.'],
        ['Was passiert mit meinen Daten, wenn ich lösche?', 'Zuerst wird der Schlüssel des Haushalts vernichtet, damit ist die Datenbank nicht mehr lesbar. Danach werden die Dateien und die Sicherungen des Haushalts gelöscht. Sicherungskopien der Kontoverwaltung, die noch den verschlüsselten Schlüssel enthalten, laufen nach ihrer Frist ab.'],
        ['Ist ToHuus ein Familienkalender?', 'Nein. ToHuus kümmert sich um Einkauf, Kochen, das Geld dafür und die Aufgaben im Haushalt. Termine wie der Schornsteinfeger landen in dem Kalender, den ihr sowieso nutzt, also Apple Kalender, Google oder Outlook. Eine eigene Kalenderansicht oder einen Chat gibt es bewusst nicht, Sterne nur, wenn ihr sie einschaltet.'],
      ],
    },
    foot: {
      about: 'ToHuus ist ein Angebot von Heidrich Digital.', provider: `Anbieter: ${PROVIDER}`,
      project: 'Projekt', legal: 'Rechtliches', help: 'Hilfe & Tipps', code: 'Quellcode auf GitHub', license: 'Lizenz App: AGPL-3.0', licenseHa: 'Lizenz HA-Integration: MIT', issues: 'Fehler melden',
      imprint: 'Impressum', privacy: 'Datenschutz', terms: 'Nutzungsbedingungen', otherLang: 'English version',
      fine: 'Diese Website setzt keine Cookies, trackt nicht und lädt nichts von Dritten. Schriften: Familjen Grotesk und Hedvig Letters (SIL Open Font License), lokal ausgeliefert. Icons: Phosphor (MIT). Die Bildschirmfotos zeigen einen Demo-Haushalt mit ausgedachten Namen und Bons. Rezeptfotos: Pexels (mit Namensnennung) oder KI-erzeugt. ToHuus steht in keiner Verbindung zu REWE, Lidl, Aldi, Vorwerk/Thermomix, Apple oder den anderen genannten Läden und Diensten. Die Namen beschreiben nur kompatible Formate und Dienste.',
    },
  },
  en: {
    lang: 'en', locale: 'en_GB', alt: 'de_DE', url: SITE, base: '', other: 'de/', otherLang: 'de',
    title: 'ToHuus · Remembers what your home is missing',
    desc: 'ToHuus remembers for your household what is there, what is missing and what it costs, from your receipts and your list. For iPhone and the browser, in ToHuus Cloud or on your own server.',
    ogAlt: 'The ToHuus mark, the line “So one person doesn’t have to keep it all in their head.” and four drawn homes.',
    skip: 'Skip to content', navLabel: 'Main', railLabel: 'Quick navigation',
    themeLabel: 'Dark theme', homeLabel: 'ToHuus home', langLabel: 'Language', copy: 'Copy', copied: 'Copied',
    legalLabel: 'Legal', tocLabel: 'Contents', back: 'Back to the home page', ids: { jobs: 'shopping', cook: 'cooking', money: 'money', levels: 'getting-started', how: 'how-it-remembers', who: 'who', ways: 'two-ways', prices: 'pricing', privacy: 'privacy', host: 'self-hosting', why: 'why', faq: 'faq', install: 'install', tf: 'iphone-app', ha: 'home-assistant', house: 'house-info', nd: 'a-lot-on-your-mind', diff: 'what-is-different', good: 'good-to-know', calm: 'calm-by-design' },
    nav: [['#features', 'Features'], ['#pricing', 'Pricing'], ['#privacy', 'Privacy'], ['#self-hosting', 'Self-hosting'], ['HELP', 'Help']],
    rail: [['#shopping', 'Shopping', 'basket'], ['#cooking', 'Cooking', 'pot'], ['#money', 'Money', 'wallet'], ['#pricing', 'Pricing', 'receipt']],
    hero: {
      label: 'The smart assistant for your home',
      h1: 'So one person doesn’t have to keep it all <span class="hl">in their head.</span>',
      lede: 'ToHuus remembers for your household what is there, what is missing and what it costs. Your receipts and your shared list are all it needs.',
      ios: 'Download on the App Store', iosSub: 'iPhone, iPad and Apple Watch', gh: 'Self-host from GitHub',
      facts: ['Servers in Germany (Hetzner)', 'No tracking, no ads', 'Self-hosting is free'],
      tiles: { flat: 'Flat', shared: 'Flat share', terraced: 'Terraced house', house: 'House' },
      tilesLabel: 'Four drawn homes: a flat, a flat share, terraced houses and a house.',
      shot: 'ToHuus on the iPhone, Today page: under “Due” are pizza, rice and washing up liquid with how often you buy them, each with Put on the list and Still have it, below them the card “List” with six things.',
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
      intro: 'What you buy is what you cook, and that is where the money goes. So ToHuus looks after all three. And after the rest of what makes a home: the tasks that keep coming back, doing each other a good turn and keeping track of wishes.',
      list: [
        { id: 'shopping', no: '1', label: 'Shopping', h3: 'ToHuus remembers what is missing.', shot: 'shopping',
          alt: 'Shopping list in ToHuus: the field “What’s missing?” on top, below it suggestions like pizza with “every ~32 days”, below that entries sorted by area such as strawberry ice cream with “running low in stock”.',
          p: 'From your receipts and what you tick off the list, ToHuus learns how often you buy things. When something is due again, it shows up as a suggestion with its reason. You do not have to keep a stock list for that.',
          points: ['One list, live on every phone, also while someone is in the shop', 'Whoever takes something taps “I’ll get it”', 'Sorted by aisle in the shop, even without signal'] },
        { id: 'cooking', no: '2', label: 'Cooking', h3: 'You can cook this today.', shot: 'cook',
          alt: 'Cooking page, “What shall we cook?”: creamed spinach with potatoes and fried egg planned for tonight, the button “You decide for us”, filters for time and vegetarian, below it “Works right now” with a gnocchi skillet and roast vegetables.',
          p: 'The cook planner starts with what is at home. It shows what works right now, where only one ingredient is missing and what should be used soon. Plan the week if you like, and whatever it needs goes on the list in one tap.',
          points: ['Recipes by hand, from a link, a photo or other apps', 'Many at once as a recipe pack, even built by your own AI', 'With or without a kitchen machine, and allergies are taken into account'] },
        { id: 'money', no: '3', label: 'Money', h3: 'You see where the money for food and household goes.', shot: 'money',
          alt: 'Money page for October 2026: £47.40 so far, 22 % less than last month, below it the purchases at Tesco and Sainsbury’s with date and amount.',
          p: 'Every receipt counts. ToHuus shows what a month cost, in which shop and for which category, and compares it with the month before. You do not need to keep a ledger.',
          points: ['Spending by month, shop and category', 'Price changes on things you buy often', 'Budgets per week, month or year, shared or just for you, with a note at 80 percent', 'CSV export'] },
        { id: 'tasks', no: '4', label: 'Tasks', h3: 'Whose turn is it to take out the bins?', shot: 'tasks',
          alt: 'Tasks page in the Home area: the field “New task, e.g. take out the paper bin”, below it due Clean the bathroom (today) and Take out the bins (tomorrow), each with the person whose turn it is and a Done button.',
          p: 'Cleaning the bathroom, changing the bed linen, the water filter or the chimney sweep’s visit: ToHuus remembers what is due when and who does it. If you take turns, “Done” passes the task on to the next person. There are no rankings, just a calm look at who keeps what in mind, and stars only if you switch them on.',
          points: ['Once, recurring or when needed, for everyone or only for you', 'Appointments with a time show up in Apple Calendar, Google or Outlook, tasks in Apple Reminders', 'Children can have a turn too, and what nobody keeps in mind gets noticed'] },
        { id: 'bring-me-something', no: '5', label: 'Bring me something', h3: 'One of you is on the sofa, one is in the kitchen.', shot: 'treats',
          alt: 'Treats page: “What would you like?”, with cards such as Something sweet, Something to drink, Something to nibble and From the fridge, plus tabs for Guests and Party.',
          p: 'Whoever is stuck, in bed, at bedtime or with a child on their arm, asks for a little something in two taps. The others see it right away, someone says “I’ll bring it”, and your menu only shows what is actually at home. Visitors get their own menu, and on party night guests order straight from your party menu.',
          points: ['Your own menu: sweets, drinks, snacks, from the fridge', 'Guests ask through a link, no app needed', 'Party: you see what was ordered and what is left'] },
        { id: 'wishes', no: '6', label: 'Wishes', h3: 'Wish lists that give nothing away.', shot: 'wishes',
          alt: 'Wishes page: the list “Christmas for Mika” with three wishes and “New biscuits & finds” with two.',
          p: 'Birthdays, Christmas or just a list of things to remember: wishes with a photo, several links, a price and a note. The family sees who reserved what, the person it is for never does. Send a whole list or part of it as a message.',
          points: ['Photo, links, price and “who could give this”', 'Private lists only you can see', 'Share as a link or a ready-made message'] },
      ],
    },
    house: {
      label: 'House info', h2: 'From the guest Wi-Fi to the coffee machine.',
      intro: 'Whoever stays over, looks after the kids or feeds the cat usually asks the same things: what is the Wi-Fi password, how does the heating work, when do the kids go to bed? Write it down once in the house info, and from then on you just send a link.',
      path: [
        ['wifi', 'Guest Wi-Fi', 'Network and password are kept safe with the codes. Tap “Show” and a QR code appears, and your visitors join with their phone camera.'],
        ['pin', 'Where things are', 'Plasters, torch, fuse box, water stopcock. With “Where is what?” the babysitter finds the biscuits too, but only in the places you share.'],
        ['coffee', 'How things work here', 'Heating, dishwasher, blinds, coffee machine: explained in a few lines, with a photo or a short video if you like. With Alexa, Google, Siri or Home Assistant the right voice commands are listed too.'],
        ['moonstars', 'House rules and kids', 'What the kids may do, when bedtime is and whatever else goes in your home, such as shoes off in the hall.'],
        ['aid', 'In an emergency', 'Important numbers come first. Emergency, poison advice, neighbours and your own numbers come as a template, and you add the GP.'],
      ],
      shots: [
        ['houseinfo', 'House info page by room: under Codes the guest Wi-Fi “Berg-Guest” and the front door, both hidden with a Show button, below them cards for the kids’ room and the kitchen.'],
        ['houseinfo-guest', 'The Bergs’ babysitter link in the house info tab, “How things work here”: the guest Wi-Fi hidden with a Show button, below it in the kids’ room the cards “Bedtimes for Mika” and “What Mika may do”.'],
      ],
      caption: 'Left: your house info with the guest Wi-Fi. Right: what the babysitter sees through their link.',
      forLabel: 'Made for',
      for: [['baby', 'Babysitters'], ['users', 'Grandparents and everyone who is often around'], ['paw', 'House and pet sitters'], ['bed', 'Overnight guests'], ['suitcase', 'Guests in a holiday let']],
      facts: [
        ['eyeoff', 'Everyone sees what they should', 'For every card you decide who sees it: everyone who lives here, regular guests from a level up, all babysitter links or only certain links. Codes can be shared until a date.'],
        ['key', 'Codes are kept apart', 'Door code, alarm, garage and Wi-Fi are stored apart from the cards, encrypted in the cloud. They stay hidden until someone taps “Show”, and you see who looked when. Guests only see a code you share with them.'],
        ['robot', 'Codes never go to AI', 'The assistant, AI assistants over MCP, Home Assistant and notifications never get to see a code. Codes only go into an export if an admin explicitly ticks that.'],
        ['share', 'A link, no account', 'Babysitters and guests open a link or scan a QR code, no app and no sign-in. Once opened, the cards stay readable without a connection. The link expires when you want and can be revoked at any time.'],
        ['printer', 'To print', 'An A4 sheet “For the babysitter” for the fridge: important numbers first, then everything by room. Instead of codes it says “ask us”, unless you choose to print them.'],
        ['suitcase', 'While you are away', 'For a trip there is the handover: feed the cat morning and evening, water the plants on Monday and Thursday, with photos. The house sitter ticks off what is done, and their link ends the day after you are back.'],
      ],
      more: 'House info and the babysitter link in the help', help: 'house-info.html',
    },
    nd: {
      label: 'When your head is full', h2: 'For heads with a lot going on.',
      intro: 'With ADHD, autism or just a packed week, starting is often the hardest part: where do I begin, what was due again, and how long will it even take? A few things in ToHuus are built for exactly that. They help everyone in the household, and nobody has to explain why they use them.',
      list: [
        ['list', 'Small steps', 'Every task can be split into small steps you tick off one by one. “Split into small steps” suggests some: with AI if your household allows it, otherwise from ready-made steps for cleaning the bathroom, the kitchen, laundry, hoovering or changing the bed. When the task is done, the steps are open again for next time.'],
        ['target', 'One thing at a time', 'The focus view shows just one thing: the next task and its next step, large and without a list around it. Below it: “Done”, “Later” and “Too big? Make it smaller”.'],
        ['timer', 'Visible timer', 'Five minutes, just to get going. A ring shows how much time is left, and a gentle signal sounds at the end. Nothing is counted or analysed.'],
        ['feather', 'Gentle mode', 'A setting just for you: no red overdue warnings and no counters, things that are due say “could be done”. “Fresh start” moves everything overdue to a new start, no guilt. Notifications arrive bundled in one message at a time you choose, and Today shows at most three things.'],
        ['users', 'No rankings, no streaks', 'There are no streaks and no rankings. Stars only exist if you switch them on yourselves, and gentle mode hides them. “Who keeps what in mind” lists names alphabetically, and shares only if everyone in the household agrees.'],
        ['list', 'Mental load check', '33 cards for the invisible work, from “Noticing when something is running out” to “Remembering birthdays”. Everyone answers privately; the household sees the answers only when everyone agrees. Each card says what ToHuus takes off your head.'],
        ['pin', 'Out of sight, still in mind', '“Where is what?” knows where the batteries are and what is in the freezer. If you like, keep a stock list and see what is at home and what is running out.'],
        ['mic', 'Out of your head, fast', 'One tap on the assistant, one sentence, and it is on the list or with the tasks before the thought is gone again.'],
        ['tag', 'Extras in the weekly shop', 'You set how much a week there is for extras, as an amount or a number of items. Mark items on the list as an extra, and the list shows how much of the allowance is used. Nothing is blocked, you just keep the overview, impulse buys included.'],
      ],
      shots: [
        ['focus', 'Focus view “One thing at a time”: only the task “Clean the bathroom”, step 2 of 3, a 5-minute timer ring and the buttons Done it, Later and Too big? Make it smaller.'],
        ['loadcards', 'Mental load check: your own summary on top, below cards like “Noticing when something is running out” with the answers Mostly me, We share it, Mostly someone else.'],
      ],
      caption: 'Left, one thing at a time with a timer; right, the mental load check.',
      note: 'ToHuus follows “Reduce motion” on your device, and on days when getting up is hard there is “Bring me something”. ToHuus is not a health or therapy service. It just takes a few things off your mind.',
      more: 'More in the help', help: 'a-lot-on-your-mind.html',
    },
    levels: {
      label: 'Getting started', h2: 'However digital your shopping already is.',
      intro: 'If shopping is going digital anyway, you should get something out of it too. ToHuus works with what you already have. One of these is enough to start.',
      shot: 'import', alt: 'Receipts page: add a receipt, digital receipt via QR code or link, photograph a cupboard or paste lines, below it the history of booked receipts from Tesco and Sainsbury’s.',
      list: [
        ['receipt', 'Delivery and e-receipts', 'If you order groceries online or get digital receipts, the order and the receipt come in as a PDF. ToHuus matches them and books what was actually delivered.'],
        ['camera', 'Snap the receipt', 'For a paper receipt, a photo is enough. Anything ToHuus cannot read with confidence is shown to you for a check before it is booked. Text recognition runs without AI, on the server or right on your iPhone.'],
        ['mic', 'Just say it', 'Tap the round assistant button and say: “We are out of milk, and we need something for Sunday.” The assistant puts it on the list and tells you what it added. Every step can be undone.'],
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
      rows: [['Mozzarella', 'remembers: every ~9 days', 'rhythm'], ['Baking paper', 'Mira · today 16:41', 'person'], ['2× Oat drink', 'Mira · today 16:41', 'person'], ['Parcel tape', 'Ben · yesterday', 'person'], ['Chopped tomatoes', 'from the week plan', 'plan']],
      cardFoot: 'No line without a sender',
    },
    who: {
      label: 'Who it is for', h2: 'For every household that does a food shop.',
      intro: 'On first start ToHuus only asks who belongs to the household. What you see follows from that.',
      forms: [
        ['c', 'Just me', 'Nothing to remember, and at the end of the month you see what food and household cost.'],
        ['h', 'The two of us', 'Both of you know what is missing. Nobody has to ask whether there is coffee left.'],
        ['s', 'Family', 'Everyone writes on the same list. Children and regular guests only see what you share.'],
        ['t', 'Flat share', 'Shared things go on one list, and the others do not see private items. The cleaning rota takes turns by itself, so nobody has to remind anyone.'],
        ['a', 'Looking after someone', 'If you shop for parents or grandparents too, connect the two households and see what is missing there.'],
      ],
      note: 'ToHuus does not assume a cellar, a chest freezer or a Thermomix. You decide which places your home has.',
    },
    diff: {
      label: 'What is different', h2: 'Not the tool for everything. The part that is home.',
      intro: 'ToHuus is the smart assistant that does not try to be the tool for everything. For appointments, notes and messages you already have good apps. ToHuus takes from them what is household work and works alongside them.',
      list: [
        ['list', 'One place for the list, cooking, tasks and money', 'What you buy gets cooked, and that is where the money goes. ToHuus links them from your receipts and your list. You do not need four apps side by side.'],
        ['users', 'Learns who does what, without points', 'ToHuus remembers who usually takes on a task and suggests them next time. There are no points, rankings or streaks, and stars only if you switch them on.'],
        ['feather', 'On my mind & done on the side', '“On my mind” shows what someone is thinking about, “Done on the side” what happened without a list. The others can say “Thanks”. Nothing is counted.'],
        ['sparkle', 'What did you sort out today?', 'Now and then in the evening, Today asks what you got done without the app. The answer is always kind, and it is how ToHuus learns who does what. You can switch the question off.'],
        ['house', 'People I look after', 'If you look after parents or grandparents, visits, doctor’s appointments and errands become tasks, private for as long as you like. On your own with children? Then there are no comparisons, just a look at what you got done.'],
        ['suitcase', 'Away, even on your own', 'A business trip or a hospital stay: for that time you decide who takes over what and what can wait. The tasks then show who steps in, and regular guests such as Grandma can take on tasks too.'],
        ['chart', 'Weekly and monthly review', '“What you all got done” for everyone and “What you got done” just for you, with no comparisons and no money. Share a card you like as an image, without names.'],
        ['list', 'Swipe to decide', 'What shall we eat? Everyone swipes yes or no on their own, and you see what everyone wants. You go through older thoughts in “On my mind” the same way: still important, done or let go.'],
        ['lock', 'Private stays private', 'AI only with your consent and through Mistral, self-hosted with your own AI or none at all. Health details only go to an AI if you explicitly allow it. What you note about people you look after, never.'],
      ],
      tableH: 'Next to other apps', cols: ['Good for', 'What ToHuus does differently'],
      rows: [
        ['Bring!', 'A shared shopping list, quick to use with one hand in the shop.', 'A shared list too, sorted by aisle in the shop. On top, ToHuus learns from receipts and ticks when something is due again, and links cooking and money to it.'],
        ['Cozi, FamilyWall', 'Family calendar, lists and messages in one place.', 'No calendar of its own and no chat. Appointments go into the calendar you already use. ToHuus looks after shopping, cooking, money and tasks.'],
        ['OurHome', 'Family chores with points and rewards.', 'Tasks with taking turns, but no points or rankings. ToHuus learns who usually does what.'],
        ['Fair Play, FairShare', 'Making invisible work visible, through areas you split between you.', 'ToHuus learns the areas from your everyday life. “On my mind” also shows the small things that are on no card.'],
        ['Todoist, Apple Reminders', 'To-do lists for everything, from work to shopping.', 'Only the household, but with taking turns, suggestions and a view of who keeps what in mind. Tasks can also appear in Apple Reminders.'],
        ['Apple Notes', 'Writing something down quickly and sharing it.', 'ToHuus does not replace it: lists go as text to Notes, Mail or Messages.'],
      ],
      note: 'As of October 2026, based on the providers’ own descriptions and our research. The names belong to their owners; ToHuus is not affiliated with them.',
      share: 'Figures and lines to share', shareHref: 'share.html',
    },
    good: {
      label: 'Good to know', h2: 'What often goes unseen at home.',
      intro: 'A few figures and findings on caring, thinking work and appreciation, each with its source. They describe what studies and statistics measured, not an effect of ToHuus.',
      source: 'Source:', more: 'All cards to share (in German), as images for feed and stories', href: 'share.html',
    },
    calm: {
      label: 'Calm by design', h2: 'Built so you can put it down again quickly.',
      intro: 'We have not measured what ToHuus does to your stress or your screen time, so we do not promise anything about it. What we can promise is how ToHuus is built.',
      list: [
        'No feed and nothing to keep scrolling. Every page has an end.',
        'No streaks, no points, no rankings. Stars only if you switch them on yourselves.',
        'Notifications bundled if you like, at a time you choose. We never send promotional pushes.',
        '“Done for today”: when everything important is done, Today says so. Feel free to put the phone down.',
        'The evening question only appears on Today, without a push and at most every other evening. You can switch it off.',
        'A lot works without opening the app: with Siri, the widget or the Apple Watch.',
      ],
      not: 'What we do not promise: less stress, fewer minutes on your phone or better sleep. We would have to measure that properly first, and we have not.',
    },
    ways: {
      label: 'Two ways', h2: 'In ToHuus Cloud or on your own server.',
      intro: 'It is the same app with the same code. The difference is who runs the server.',
      cols: ['ToHuus Cloud', 'Self-hosted'],
      rows: [
        ['Who for', 'Anyone who just wants to start', 'Anyone with a server, a NAS or Home Assistant'],
        ['Apps', 'App for iPhone, iPad and Apple Watch, plus the browser, Android included', 'The iPhone app, connected to your server, and the browser as a web app. Plus Home Assistant and your own assistants over MCP'],
        ['Data', 'Servers in Germany (Hetzner), every household encrypted with its own key', 'On your server, encrypted if you like'],
        ['Receipt photos and assistant', 'Free works without AI; from Household on with AI and an allowance per plan. AI can be switched off for the household, a person or a child', 'With your own AI key, or without'],
        ['Claude, ChatGPT (MCP)', 'Through MCP with sign-in (OAuth)', 'Through MCP with an access key'],
        ['Home Assistant', 'Through the HACS integration, connected with a code from the app', 'Fully, plus receipt inbox, Telegram and receipt printer on your network'],
        ['Cost', 'Free, Household or Plus', 'Free, AGPL-3.0'],
      ],
    },
    prices: {
      label: 'Pricing', h2: 'One subscription per household.',
      intro: 'Members and guests never pay. Every new household in the cloud starts with 14 days of Plus on its own, no payment details needed. After that it goes back to Free unless you subscribe. Nothing is deleted.',
      per: '/ month', or: 'or', year: '/ year', storage: 'Storage',
      plans: [
        { name: 'Free', price: '€0', sub: 'without AI', storage: '100 MB', items: ['Shared list with shop mode', 'Tasks and “On my mind”', 'Week plan and recipes by hand', 'Reviews and sharing', 'The assistant understands simple sentences like “milk and bread”, no AI involved', 'Remembers 30 days back, 20 uploads a day'] },
        { name: 'Household', price: '€3.99', year: '€34.99', storage: '2 GB', items: ['Everything in Free', 'The full history with prices and spending', 'Connected households and mirrored lists', 'Receipts, screenshots and photos read with AI', '100 assistant messages a month'] },
        { name: 'Plus', price: '€5.99', year: '€59.99', storage: '5 GB', items: ['Everything in Household', 'The assistant for every day', 'Week plan from what is at home', 'Monthly review and substitutes from your stock', 'New seasonal ToHuus recipes (in German), with pictures', '1,500 messages a month. Beyond that it answers more slowly, it never locks you out'], mark: '14 days to try' },
        { name: 'Self-hosted', price: '€0', sub: 'AGPL-3.0', storage: 'as much as your server has', items: ['Everything unlocked', 'With your own AI, any OpenAI-compatible provider, or none at all', 'iPhone app, web app, Home Assistant, MCP'], host: true },
      ],
      fund: 'Every subscription also pays for licences for families who cannot afford one right now. There are no ads, and we do not sell your data.',
      note: 'Launch prices. Payment runs through Apple in the iPhone app.',
      codes: 'You can also get a code from us, for a month, a year or for good. You redeem it in the browser (Settings › Subscription › Redeem code), and then it works on every device, the iPhone included.',
      hardship: {
        id: 'cant-afford', h3: 'We can’t afford this right now.',
        p: 'If money is tight but your head is full, write to us. You get a licence, no reasons needed and no endless forms. We will reply by e-mail.',
        email: 'Your e-mail address', name: 'Your name', people: 'Who lives with you?', peopleHint: 'e.g. 2 adults, 2 children', message: 'Anything you would like to add?',
        optional: 'if you like', send: 'Send request', hp: 'Please leave empty',
        privacy: 'We only store what you enter here, encrypted in ToHuus Cloud, and delete it 180 days after we reply. There is no tracking.', privacyLink: 'More in the privacy policy',
      },
    },
    privacy: {
      label: 'Privacy and security', h2: 'Your receipts work for you, not for market research.',
      intro: 'This lists only what can be checked. How the cloud is built is described openly in the source code and the documentation.',
      facts: [
        ['server', 'Servers in Germany', 'ToHuus Cloud runs on Hetzner servers in Germany.'],
        ['key', 'Every household with its own key', 'Every household has its own encrypted database with its own key. Photos and receipt files are encrypted too.'],
        ['eyeoff', 'No tracking, no ads', 'Your receipts are neither sold nor analysed for advertising. This website sets no cookies either.'],
        ['robot', 'AI only through Mistral', 'Receipt photos, voice input and the assistant run on Mistral, a provider based in France. Requests are routed through OpenRouter (USA), which does not store their content (details in the privacy policy). Every request is pinned to Mistral with no fallback to other providers and is not used for training. In the cloud ToHuus asks first: without your consent nothing goes to a language model. Voice recordings are not stored.'],
        ['lock', 'Sensitive details stay at home', 'Allergies and details about children only go to a language model if you explicitly switch that on.'],
        ['mail', 'Mails only if you want them', 'Switch off the summary and the subscription reminder under Settings › Notifications › Mails from ToHuus, or with one click in each of these mails. We never send advertising.'],
        ['power', 'AI can be switched off', 'For the whole household, just for you or for a single child. Then no request goes to a language model, and the list, suggestions, cooking and money keep working. In the cloud it is off for children until a parent switches it on.'],
        ['phone', 'Apple Intelligence on the iPhone only', 'If you like, Apple Intelligence tidies up receipt photos and handwritten lists right on the iPhone. It is off on every device until you switch it on, and nothing leaves the device for it.'],
        ['scan', 'Text recognition without AI', 'Receipt photos are first read by text recognition without a language model on the server, or your iPhone reads them itself and sends only the text. Only if that does not add up and AI is on does Mistral read the photo.'],
        ['plug', 'Your assistants only if you want', 'You connect Claude or ChatGPT yourself through MCP. They see discreet items only as a placeholder, and an admin can switch MCP off.'],
        ['trash', 'When you delete', 'When you delete the household, its key is destroyed first, then the data and its backups follow. Backup copies of the account directory expire after their retention period.'],
      ],
      link: 'Technical details about the cloud', linkHref: `${GH}/blob/main/docs/cloud.md`,
    },
    host: {
      label: 'Self-hosting', h2: 'For everyone with their own server.',
      p: 'One Docker container and one SQLite file, free under the AGPL-3.0. In the browser ToHuus runs as a web app you can add to your home screen. You connect the iPhone app to your server, most easily with the QR code from the web app. You do not need an account with us.',
      facts: [
        ['refresh', 'Home Assistant, both ways', 'The shopping list as a to-do list for Assist, sensors for what is due and the week plan as a calendar. Installed via HACS, the integration is MIT licensed.'],
        ['mail', 'Receipt inbox, Telegram, printer', 'Receipts arrive by e-mail, “2 milk, bread” in a chat lands on the list, and a receipt printer in the kitchen prints it.'],
        ['robot', 'AI is optional', 'With a key for any OpenAI-compatible service, such as Mistral, local ones included. Without a key everything keeps working: receipt photos are read by text recognition on your server, and the assistant understands the common short sentences.'],
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
      label: 'iPhone app', h2: 'ToHuus on the iPhone.',
      p: 'The app is on the App Store, for iPhone, iPad and Apple Watch. It works with ToHuus Cloud and with your own server. Downloading it is free, and every new household in the cloud gets 14 days of Plus, no payment details needed.',
      points: ['iPhone, iPad and Apple Watch', 'With ToHuus Cloud or your own server', 'Widget and sharing from other apps', 'Without the app, ToHuus runs in the browser on any device'],
      cardTitle: 'How to start',
      rows: ['Download ToHuus from the App Store', 'Create a household or follow an invitation', 'Own server? Tap “Own server” on the start screen', 'Put the first things on the list'],
      cta: 'Download on the App Store', ctaSub: 'iPhone, iPad and Apple Watch',
      note: 'You only pay if you take out a subscription, in the app through Apple.',
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
        ['Do I have to type everything in?', 'No. Receipts come in as a PDF or a photo. With Plus your household gets its own receipt address in the cloud (coming soon), and self-hosted it works through your own inbox. What you tick off the list counts as a purchase too. You do not have to keep a stock list.'],
        ['Does it work without online grocery delivery?', 'Yes. Paper receipts come in as a photo, and if you do not want to collect receipts at all, simply tick things off the list.'],
        ['Is there an Android app?', 'There is no separate Android app. In the browser ToHuus runs as a web app you can add to your home screen, on Android just like on a computer.'],
        ['Is there an iPhone app?', `Yes, <a href="${appHref('en')}">on the App Store</a>, for iPhone, iPad and Apple Watch. It works with ToHuus Cloud and with your own server.`],
        ['Do I need AI for this?', 'No. The list, suggestions, cook planner and spending all work without it. Receipt photos are read first by text recognition without AI, on the server or right on the iPhone. A language model only helps when that is not enough, and with open questions to the assistant. On newer iPhones Apple Intelligence can help on the device if you like. In the cloud AI only starts with your consent, and you can switch it off for the household, for single people and for children.'],
        ['Can I bring my recipes?', 'Yes. From a link to a recipe site, from Instagram, TikTok, Pinterest or YouTube, from a photo, from apps like Mealie, Paprika or Nextcloud Cookbook, or many at once as a recipe pack with photos. If you connected Claude or ChatGPT, your own AI can save hundreds of recipes with their photos in one go.'],
        ['And Cookidoo, Monsieur Cuisine or Cookit?', 'Share a recipe from Cookidoo, Monsieur Cuisine, Cookit or another kitchen machine app with ToHuus or paste the link, then confirm the name and ingredients. Add the steps yourself, paste them as text or let ToHuus read them from your screenshots. ToHuus never fetches these sites itself, and what you bring along stays private in your household.'],
        ['What is the house info?', 'Cards for everyone who looks after your home or comes to stay: the guest Wi-Fi with a QR code, how the heating and the coffee machine work, house rules, bedtimes and important numbers, with photos and short videos if you like. Babysitters open it through a link without an account, offline once opened, or you print it as an A4 sheet. For holidays there is the handover: what the house sitter should do and when, with photos.'],
        ['Do guests see our codes?', 'Only the ones you share, until a date if you like. Every code stays hidden until someone taps “Show”, and you see who looked when. Codes never go to an AI, to Home Assistant or into notifications.'],
        ['Is ToHuus good for ADHD?', 'ToHuus is built for every household, but some of it is made for heads with a lot going on: tasks in small steps, a view that only shows the next thing, a visible timer to get started and a gentle mode without red warnings. There are no streaks or rankings, and stars only if you switch them on. Whether it suits you is best found out in everyday life. It does not replace treatment or advice.'],
        ['Do the others see that I use gentle mode?', 'No. Gentle mode is a personal setting and only changes what you see and when you get notifications.'],
        ['Does ToHuus help with impulse buys?', 'You can set an allowance for extras, per week as an amount or a number of items. Mark items on the list as an extra, and the list shows how much of it is used. ToHuus blocks nothing, it just shows where you stand.'],
        ['Do I need a Thermomix?', 'No. The cook planner shows recipes with and without a kitchen machine, and you can filter by it. With Plus there are also ToHuus recipes for Thermomix, Monsieur Cuisine and Cookit, with the settings for each step.'],
        ['Who pays if there are four of us?', 'One subscription covers the whole household. Members, children, guests and connected households pay nothing.'],
        ['What happens if I cancel?', 'The household goes back to Free. Nothing is deleted. You then see the last 30 days, and the assistant only understands simple sentences, without AI. With the next subscription everything is back.'],
        ['What happens to my data when I delete it?', 'First the household’s key is destroyed, so the database can no longer be read. Then the household’s files and backups are deleted. Backup copies of the account directory, which still hold the encrypted key, expire after their retention period.'],
        ['Is ToHuus a family calendar?', 'No. ToHuus looks after shopping, cooking, the money for both and the household tasks. Appointments such as the chimney sweep go into the calendar you already use, Apple Calendar, Google or Outlook. There is deliberately no calendar view of its own and no chat; stars only if you switch them on.'],
      ],
    },
    foot: {
      about: 'ToHuus is offered by Heidrich Digital.', provider: `Provider: ${PROVIDER}`,
      project: 'Project', legal: 'Legal', help: 'Help & tips', code: 'Source code on GitHub', license: 'App licence: AGPL-3.0', licenseHa: 'HA integration licence: MIT', issues: 'Report a bug',
      imprint: 'Imprint', privacy: 'Privacy', terms: 'Terms of use', otherLang: 'Deutsche Version',
      fine: 'This website sets no cookies, does not track you and loads nothing from third parties. Fonts: Familjen Grotesk and Hedvig Letters (SIL Open Font License), served locally. Icons: Phosphor (MIT). The screenshots show a demo household with invented names and receipts. Recipe photos: Pexels (credited) or AI-generated. ToHuus is not affiliated with Tesco, REWE, Lidl, Aldi, Vorwerk/Thermomix, Apple or the other shops and services named here. The names only describe compatible formats and services.',
    },
  },
};

// ---------------------------------------------------------------- screenshots
/** Every screenshot slot the page uses. The build fails when a file is missing, so no placeholder ever ships. */
const SHOTS = ['today', 'today-dark', 'shopping', 'cook', 'money', 'import', 'treats', 'wishes', 'tasks', 'houseinfo', 'houseinfo-guest', 'focus', 'loadcards'];
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

/**
 * The Plattdeutsch saying on the German home page, like on the app's Heute screen. Rendered with a timeless saying
 * (so it reads well without JavaScript); site.js swaps in the one for the visitor's time of day, weekday and season
 * and opens the meaning on tap. The data travels in the page as JSON.
 */
function plattBlock() {
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const first = PLATT.find((x) => !x.when) ?? PLATT[0];
  const data = JSON.stringify(PLATT.map(({ id, text, meaning, note, when }) => ({ id, text, meaning, note, when }))).replace(/</g, '\\u003c');
  return `<div class="platt" data-platt>
        <span class="platt-hi">Moin!</span>
        <button type="button" class="platt-say" aria-expanded="false" aria-controls="platt-more"><span lang="nds">„${esc(first.text)}“</span></button>
        <p class="platt-more" id="platt-more" hidden><b>${esc(first.meaning)}</b> ${esc(first.note)}</p>
        <script type="application/json" id="platt-data">${data}</script>
      </div>`;
}

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
${m.noindex ? '<meta name="robots" content="noindex">\n' : ''}${m.alt.en && m.alt.de ? `<link rel="alternate" hreflang="en" href="${m.alt.en}">
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
<script>(function(){var d=document.documentElement;d.classList.add('js');var t=null;try{t=localStorage.getItem('tohuus.site.theme')}catch(e){}d.setAttribute('data-theme',t==='dark'||(!t&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light')})()</script>
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
${c.nav
  .filter(([href]) => href !== 'BLOG' || publishedPosts(c.lang).length > 0)
  .map(([href, l]) => `    <a href="${href === 'HELP' ? (m.helpHref ?? helpIndexHref(c.lang)) : href === 'BLOG' ? `${m.home ?? './'}${c.lang === 'de' ? '../' : ''}${BLOG_DIR[c.lang]}/` : m.navBase + href}"${(href === 'HELP' && m.isHelp) || (href === 'BLOG' && m.bodyClass?.includes('blog-page')) ? ' aria-current="page"' : ''}>${l}</a>`)
  .join('\n')}
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
        <h2 class="foot-h">${c.foot.project}</h2>
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
        <h2 class="foot-h">${c.foot.legal}</h2>
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

/** "Gut zu wissen" on the home page: six share cards (site/assets/share/index.json), German from the index, English here. */
const HOME_FACTS = ['pflege-zu-hause', 'pflege-wertschaetzung', 'denkarbeit', 'plan-im-kopf', 'danke', 'serien'];
const HOME_FACTS_EN = {
  'pflege-zu-hause': { value: '86%', title: 'of people who need care in Germany are looked after at home.', text: 'That is 4.9 of almost 5.7 million people. 14% live in a care home.', source: 'Destatis, care statistics 2023 (2024)' },
  'pflege-wertschaetzung': { value: '41%', title: 'of relatives who help from a distance say others don’t see how much they do.', text: 'From a survey of people who support parents or other relatives from afar.', source: 'ZQP, Pflege auf Distanz, 2022' },
  denkarbeit: { value: '4', title: 'parts make up the thinking work at home.', text: 'Anticipating, finding options, deciding, keeping track. Women more often do the anticipating and the keeping track.', source: 'Daminger, American Sociological Review, 2019' },
  'plan-im-kopf': { value: 'Plan', title: 'With a concrete plan, an open task intrudes on your mind less.', text: 'In lab studies, intrusive thoughts about an open task faded once there was a concrete plan for it.', source: 'Masicampo & Baumeister, JPSP, 2011 (lab studies)' },
  danke: { value: 'Thanks', title: 'People who feel appreciated invest more in the relationship.', text: 'Couples with more mutual appreciation were more likely to still be together nine months later.', source: 'Gordon et al., Journal of Personality and Social Psychology, 2012' },
  serien: { value: 'Streak', title: 'When a streak breaks, many people do less afterwards.', text: 'Especially when they blame themselves for it.', source: 'Silverman & Barasch, Journal of Consumer Research, 2023' },
};
function homeFacts(c) {
  if (!SHARE) return [];
  return HOME_FACTS.map((slug) => {
    const card = SHARE.cards.find((x) => x.slug === slug);
    if (!card || !card.url) throw new Error(`home fact ${slug} is not a sourced card in assets/share/index.json`);
    return c.lang === 'en' ? { ...card, ...HOME_FACTS_EN[slug] } : card;
  });
}

/** "Wir können uns das gerade nicht leisten": a plain HTML form to the cloud (docs/pricing.md, server/routes/cloud.ts). */
const hardshipForm = (c) => {
  const Hs = c.prices.hardship;
  const opt = `<small>${Hs.optional}</small>`;
  return `<div class="hardship reveal" id="${Hs.id}">
      <div class="hardship-copy">
        <h3 id="${Hs.id}-h">${Hs.h3}</h3>
        <p>${Hs.p}</p>
      </div>
      <form class="hardship-form" method="post" action="${CLOUD}/api/cloud/hardship" accept-charset="utf-8" aria-labelledby="${Hs.id}-h">
        <input type="hidden" name="lang" value="${c.lang}">
        <p class="field"><label for="hs-email">${Hs.email}</label><input id="hs-email" name="email" type="email" required maxlength="254" autocomplete="email" inputmode="email" spellcheck="false"></p>
        <p class="field"><label for="hs-name">${Hs.name} ${opt}</label><input id="hs-name" name="name" type="text" maxlength="80" autocomplete="given-name"></p>
        <p class="field"><label for="hs-people">${Hs.people} ${opt}</label><input id="hs-people" name="people" type="text" maxlength="40" aria-describedby="hs-people-hint"><span class="hint" id="hs-people-hint">${Hs.peopleHint}</span></p>
        <p class="field wide"><label for="hs-message">${Hs.message} ${opt}</label><textarea id="hs-message" name="message" rows="4" maxlength="1000"></textarea></p>
        <div class="offscreen" aria-hidden="true"><label for="hs-website">${Hs.hp}</label><input id="hs-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
        <p class="hardship-send"><button class="btn primary" type="submit">${ico('send')}<span>${Hs.send}</span></button></p>
        <p class="hardship-privacy">${ico('lock')}<span>${Hs.privacy} <a href="${LEGAL[c.lang].privacy.file}#website">${Hs.privacyLink}</a></span></p>
      </form>
    </div>`;
};

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
  const HI = c.house;
  const N = c.nd;
  const X = c.diff;
  const G = c.good;
  const R = c.calm;
  const m = homeMeta(c);
  return `${pageTop(c, m)}<main id="main">

<section class="hero" aria-labelledby="hero-h">
  <div class="wrap hero-grid">
    <div class="hero-copy">
      ${label(H.label)}
      <h1 id="hero-h">${H.h1}</h1>
      <p class="lede">${H.lede}</p>
      <div class="ctas">
        <a class="btn primary" href="${appHref(c.lang)}">${ico('apple')}<span class="btn-2"><b>${H.ios}</b><small>${H.iosSub}</small></span><span class="tail">${ico('arrow')}</span></a>
        <a class="btn" href="${GH}">${ico('github')}${H.gh}</a>
      </div>
      <ul class="facts">${H.facts.map((f) => `<li>${ico('check')}${f}</li>`).join('')}</ul>
      ${c.lang === 'de' ? plattBlock() : ''}
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

<section class="jobs" id="${c.lang === 'de' ? 'funktionen' : 'features'}" aria-labelledby="jobs-h">
  <div class="wrap">
    <div class="sec-head">
      
      <h2 class="reveal" id="jobs-h">${J.h2}</h2>
      <p class="intro reveal">${J.intro}</p>
    </div>
${J.list.map((j, k) => `    <article class="job${k % 2 ? ' flip' : ''}" id="${j.id}" aria-labelledby="${j.id}-h">
      <div class="job-copy reveal">
        <p class="job-no">${j.label}</p>
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

<section class="house" id="${id.house}" aria-labelledby="house-h">
  <div class="wrap">
    <div class="house-grid">
      <div>
        
        <h2 class="reveal" id="house-h">${HI.h2}</h2>
        <p class="intro reveal">${HI.intro}</p>
        <ol class="house-path">
${HI.path.map(([i, t, s], k) => `          <li class="reveal" style="--d:${k * 60}ms"><span class="hp-ico">${ico(i)}</span><div><b>${t}</b><span>${s}</span></div></li>`).join('\n')}
        </ol>
      </div>
      <figure class="house-visual reveal">
        <span class="job-shape s2" aria-hidden="true"></span>
        <div class="house-pair">
${HI.shots.map(([n, alt]) => `          ${device(img(c, n, alt, { sizes: '(min-width: 960px) 250px, 44vw' }))}`).join('\n')}
        </div>
        <figcaption>${HI.caption}</figcaption>
      </figure>
    </div>
    <div class="house-for reveal">
      <p class="label">${HI.forLabel}</p>
      <ul>${HI.for.map(([i, t]) => `<li>${ico(i)}<span>${t}</span></li>`).join('')}</ul>
    </div>
    <dl class="facts-grid">
${HI.facts.map(([i, t, s], k) => `      <div class="reveal" style="--d:${(k % 3) * 60}ms"><dt><span class="pi">${ico(i)}</span>${t}</dt><dd>${s}</dd></div>`).join('\n')}
    </dl>
    <p class="more reveal"><a href="${helpIndexHref(c.lang)}${HI.help}">${HI.more}${ico('arrow')}</a></p>
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
      
      <h2 class="reveal" id="who-h">${F.h2}</h2>
      <p class="intro reveal">${F.intro}</p>
    </div>
    <ul class="forms">
${F.forms.map(([shape, t, s], k) => `      <li class="reveal" style="--d:${k * 50}ms"><span class="shape ${shape}" aria-hidden="true"></span><b>${t}</b><span>${s}</span></li>`).join('\n')}
    </ul>
    <p class="note reveal">${F.note}</p>
  </div>
</section>

<section class="nd" id="${id.nd}" aria-labelledby="nd-h">
  <div class="wrap">
    <div class="sec-head">
      
      <h2 class="reveal" id="nd-h">${N.h2}</h2>
      <p class="intro reveal">${N.intro}</p>
    </div>
    <figure class="house-visual nd-visual reveal">
      <div class="house-pair">
${N.shots.map(([n, alt]) => `        ${device(img(c, n, alt, { sizes: '(min-width: 960px) 250px, 44vw' }))}`).join('\n')}
      </div>
      <figcaption>${N.caption}</figcaption>
    </figure>
    <ul class="nd-grid">
${N.list.map(([i, t, s], k) => `      <li class="reveal" style="--d:${(k % 4) * 50}ms"><span class="nd-ico">${ico(i)}</span><b>${t}</b><span>${s}</span></li>`).join('\n')}
    </ul>
    <p class="note reveal">${N.note}</p>
    <p class="more reveal"><a href="${helpIndexHref(c.lang)}${N.help}">${N.more}${ico('arrow')}</a></p>
  </div>
</section>

<section class="diff" id="${id.diff}" aria-labelledby="diff-h">
  <div class="wrap">
    <div class="sec-head">
      <h2 class="reveal" id="diff-h">${X.h2}</h2>
      <p class="intro reveal">${X.intro}</p>
    </div>
    <ul class="nd-grid diff-grid">
${X.list.map(([, t, s], k) => `      <li class="reveal" style="--d:${(k % 4) * 50}ms"><b>${t}</b><span>${s}</span></li>`).join('\n')}
    </ul>
    <h3 class="diff-table-h reveal">${X.tableH}</h3>
    <div class="table-wrap reveal">
      <table class="compare vs">
        <thead><tr><td></td><th scope="col">${X.cols[0]}</th><th scope="col">${brandMark(24)}${X.cols[1]}</th></tr></thead>
        <tbody>
${X.rows.map(([h, a, z]) => `          <tr><th scope="row">${h}</th><td data-col="${X.cols[0]}">${a}</td><td data-col="${X.cols[1]}">${z}</td></tr>`).join('\n')}
        </tbody>
      </table>
    </div>
    <p class="note reveal">${X.note}</p>
    <p class="more reveal"><a href="${X.shareHref}">${X.share}${ico('arrow')}</a></p>
  </div>
</section>

<section class="good" id="${id.good}" aria-labelledby="good-h">
  <div class="wrap">
    <div class="sec-head">
      ${label(G.label, ' reveal')}
      <h2 class="reveal" id="good-h">${G.h2}</h2>
      <p class="intro reveal">${G.intro}</p>
    </div>
    <ul class="good-grid">
${homeFacts(c).map((f, k) => `      <li class="reveal" style="--d:${(k % 3) * 60}ms"><figure class="fact-card good-card">
        <p class="fact-v">${f.value}</p>
        <p class="fact-t">${f.title}</p>
        <p class="good-x">${f.text}</p>
        <figcaption>${G.source} <a href="${f.url}">${f.source}</a></figcaption>
      </figure></li>`).join('\n')}
    </ul>
    <p class="more reveal"><a href="${G.href}">${G.more}${ico('arrow')}</a></p>
  </div>
</section>

<section class="calm" id="${id.calm}" aria-labelledby="calm-h">
  <div class="wrap calm-grid">
    <div class="sec-head">
      ${label(R.label, ' reveal')}
      <h2 class="reveal" id="calm-h">${R.h2}</h2>
      <p class="intro reveal">${R.intro}</p>
    </div>
    <div class="calm-card reveal">
      <ul class="ticks">${R.list.map((x) => `<li>${ico('check')}<span>${x}</span></li>`).join('')}</ul>
      <p class="calm-not">${R.not}</p>
    </div>
  </div>
</section>

<section class="ways" id="${id.ways}" aria-labelledby="ways-h">
  <div class="wrap">
    <div class="sec-head">
      
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
  <span class="anchor" id="testflight" aria-hidden="true"></span>
  <div class="wrap how-grid">
    <div>
      <h2 class="reveal" id="tf-h">${TF.h2}</h2>
      <p class="intro reveal">${TF.p}</p>
      <div class="ctas reveal">
        <a class="btn primary" href="${appHref(c.lang)}">${ico('apple')}<span class="btn-2"><b>${TF.cta}</b><small>${TF.ctaSub}</small></span><span class="tail">${ico('arrow')}</span></a>
      </div>
      <ul class="ticks tf-points reveal">${TF.points.map((x) => `<li>${ico('check')}<span>${x}</span></li>`).join('')}</ul>
    </div>
    <div class="tf-start reveal">
      <h3>${TF.cardTitle}</h3>
      <ol class="how-steps tf-steps">
${TF.rows.map((r) => `        <li><b>${r}</b></li>`).join('\n')}
      </ol>
      <p class="tf-note">${TF.note}</p>
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
    <p class="fund reveal">${ico('users')}<span>${P.fund}</span></p>
    <p class="note reveal">${P.note} ${P.codes}</p>
    ${hardshipForm(c)}
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
${D.facts.map(([i, t, s], k) => `      <div class="reveal" style="--d:${(k % 3) * 60}ms"><dt><span class="pi">${ico(i)}</span>${t}</dt><dd>${s}</dd></div>`).join('\n')}
    </dl>
    <p class="more reveal"><a href="${D.linkHref}">${D.link}${ico('arrow')}</a></p>
  </div>
</section>

<section class="host" id="${id.host}" aria-labelledby="host-h">
  <div class="wrap host-grid">
    <div>
      
      <h2 class="reveal" id="host-h">${S.h2}</h2>
      <p class="intro reveal">${S.p}</p>
      <dl class="facts-list">
${S.facts.map(([i, t, s]) => `        <div class="reveal"><dt>${ico(i)}${t}</dt><dd>${s}</dd></div>`).join('\n')}
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
<pre id="code-sh" tabindex="0" role="region" aria-label="Terminal"><span class="k">git clone</span> ${GH}.git
<span class="k">cd</span> tohuus-hub
<span class="k">cp</span> .env.example .env
<span class="k">docker compose up</span> -d --build</pre>
        <div class="code-head"><span>${ico('code')}.env</span><button class="btn sm copy" type="button" data-copy="code-env" data-done="${c.copied}">${ico('copy')}<span>${c.copy}</span></button></div>
<pre id="code-env" tabindex="0" role="region" aria-label=".env"><span class="k">BASE_URL</span>=<span class="s">https://home.example.org</span>
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
  CLOUD: CONTACT.CLOUD, GH, MAIL: TF_MAIL, APP_DE: appHref('de'), APP_EN: appHref('en'),
  code: (id, lbl, text) => `<div class="code help-code${lbl === 'Prompt' ? ' prose' : ''}"><div class="code-head"><span>${ico(lbl === 'Terminal' ? 'terminal' : 'code')}${lbl}</span><button class="btn sm copy" type="button" data-copy="${id}" data-done="${COPY[lang].copied}">${ico('copy')}<span>${COPY[lang].copy}</span></button></div><pre id="${id}" tabindex="0" role="region" aria-label="${lbl}">${esc(text)}</pre></div>`,
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
    ${SHARE && c.lang === 'de' ? `<p class="blog-facts-link"><a class="btn" href="../de/teilen.html">${ico('share')}${SHARE_COPY.de.h1}</a></p>` : ''}
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
  ${posts.some((p) => p.facts?.length) || (SHARE && c.lang === 'de') ? `<p class="blog-facts-link">${posts.some((p) => p.facts?.length) ? `<a class="btn" href="fakten.html">${ico('chart')}${B.factsLink}</a>` : ''}${SHARE && c.lang === 'de' ? `<a class="btn" href="../de/teilen.html">${ico('share')}${SHARE_COPY.de.h1}</a>` : ''}</p>` : ''}
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
  const toc = [...secs, ...(p.facts?.length ? [{ id: 'fakten', h: B.factsHere }] : []), ...(shareStrip(c, p) ? [{ id: 'teilen', h: SHARE_COPY.de.post }] : []), ...(p.faq?.length ? [{ id: 'faq', h: B.faq }] : [])];
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
${shareStrip(c, p)}${p.faq?.length ? `    <section id="faq" aria-labelledby="faq-h">
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

// ---------------------------------------------------------------- share cards ("Zum Teilen", docs/sharing.md)
/**
 * The PNGs come from scripts/share-cards.mjs (site/assets/share/<slug>-4x5.png and -9x16.png, listed in index.json).
 * German page: site/de/teilen.html, English page: site/share.html. The cards themselves are German, because the
 * figures are about Germany. The build fails when a listed file is missing.
 */
const SHARE = (() => {
  const f = path.join(ROOT, 'assets/share/index.json');
  if (!fs.existsSync(f)) return null;
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const card of data.cards) for (const file of Object.values(card.files)) {
    if (!fs.existsSync(path.join(ROOT, 'assets/share', file))) throw new Error(`missing share card assets/share/${file} (run scripts/share-cards.mjs)`);
  }
  return data;
})();
const SHARE_FILE = { de: 'de/teilen.html', en: 'share.html' };
const SHARE_COPY = {
  de: {
    title: 'Zum Teilen: Zahlen und Sätze rund ums Zuhause', h1: 'Zum Teilen',
    desc: 'Karten zu Pflege, Alleinerziehenden, Mental Load und einem ruhigen Haushalt, jede Zahl mit Quelle. Als Bild für Feed, Story und WhatsApp Status.',
    lede: 'Zahlen und Sätze rund um Pflege, Alleinerziehende und die Denkarbeit zu Hause. Jede Zahl hat ihre Quelle unten auf der Karte. Speicher dir eine Karte und teil sie, wo du magst.',
    formats: '4:5 passt in den Feed, 9:16 in Story und WhatsApp Status.',
    facts: 'Zahlen mit Quelle', brand: 'Von ToHuus', source: 'Quelle:',
    dl: (f) => (f === '4x5' ? '4:5 laden' : '9:16 laden'), dlLabel: (f, t) => `${t}, Bild im Format ${f === '4x5' ? '4:5' : '9:16'} laden`,
    note: 'Auf den Karten stehen keine Namen und nichts aus einem Haushalt. Zahlen ohne Quelle gibt es hier nicht, und die Karten versprechen keine Wirkung. Stand: Oktober 2026.',
    crumb: 'Ratgeber', crumbHref: '../ratgeber/', post: 'Zum Teilen', postNote: 'Diese Karten passen zum Beitrag. Alle Karten findest du unter',
    lang: null,
  },
  en: {
    title: 'Cards to share: figures and lines about home', h1: 'Cards to share',
    desc: 'Cards on care, single parents, the mental load and a calm household, every figure with its source. As images for feed, story and WhatsApp Status.',
    lede: 'Figures and lines about caring for relatives, single parents and the thinking work at home. Every figure has its source at the bottom of the card. The cards are in German, because the figures are about Germany.',
    formats: '4:5 fits the feed, 9:16 stories and WhatsApp Status.',
    facts: 'Figures with sources', brand: 'From ToHuus', source: 'Source:',
    dl: (f) => (f === '4x5' ? 'Get 4:5' : 'Get 9:16'), dlLabel: (f, t) => `${t}, download the ${f === '4x5' ? '4:5' : '9:16'} image`,
    note: 'The cards carry no names and nothing from a household. There are no figures without a source here, and the cards promise no effects. As of October 2026.',
    crumb: 'ToHuus', crumbHref: './', lang: 'de',
  },
};
/** Ratgeber posts that show a few matching cards ("Zum Teilen"). */
const SHARE_ON_POST = {
  'mental-load-haushalt-fair-verteilen': ['mental-load-termine', 'denkarbeit', 'care-gap'],
  'mental-load-einkaufen': ['denkarbeit', 'plan-im-kopf', 'brand-gesehen-werden'],
  'haushalt-mit-adhs': ['mitteilungen-buendeln', 'serien', 'brand-liegen-lassen'],
  'putzplan-wg-paar-familie': ['danke', 'serien', 'brand-gesehen-werden'],
  'einkaufsliste-teilen': ['denkarbeit', 'danke', 'brand-nicht-alles'],
  'wochenplan-essen-familie': ['plan-im-kopf', 'denkarbeit'],
  'was-essen-wir-heute': ['denkarbeit', 'brand-handy-weg', 'brand-liegen-lassen'],
  'haushalts-app-datenschutz': ['brand-handy-weg', 'mitteilungen-buendeln', 'brand-nicht-alles'],
};

/** One card on the share page: the 4:5 image, what it says, its source and the two downloads. */
const shareCard = (c, card, b) => {
  const S = SHARE_COPY[c.lang];
  const src = (f) => `${b}assets/share/${card.files[f]}`;
  const alt = [card.eyebrow, card.value, card.title, card.text].filter(Boolean).join(' ').replace(/"/g, '&quot;');
  return `<li class="share-item">
        <figure>
          <img src="${src('4x5')}" alt="${alt}" width="1080" height="1350" loading="lazy" decoding="async"${S.lang ? ` lang="${S.lang}"` : ''}>
          <figcaption${S.lang ? ` lang="${S.lang}"` : ''}><b id="sc-${card.slug}${b === '../' ? '-p' : ''}">${card.kind === 'fact' && card.value ? `${card.value} ` : ''}${card.title}</b>${card.source ? `<span>${SHARE_COPY.de.source} <a href="${card.url}">${card.source}</a></span>` : ''}</figcaption>
        </figure>
        <p class="share-dl">${Object.keys(card.files).map((f) => `<a class="btn sm" href="${src(f)}" download="tohuus-${card.files[f]}" ${S.lang ? `aria-describedby="sc-${card.slug}${b === '../' ? '-p' : ''}"` : `aria-label="${S.dlLabel(f, card.title.replace(/"/g, '&quot;'))}"`}>${ico('export')}${S.dl(f)}</a>`).join('')}</p>
      </li>`;
};

function sharePage(c) {
  const S = SHARE_COPY[c.lang];
  const other = c.lang === 'de' ? 'en' : 'de';
  const rel = (from, to) => (from === 'de' ? (to === 'de' ? 'teilen.html' : '../share.html') : to === 'de' ? 'de/teilen.html' : 'share.html');
  const m = {
    title: `${S.title} · ToHuus`, desc: S.desc, url: `${SITE}${SHARE_FILE[c.lang]}`, alt: { en: `${SITE}${SHARE_FILE.en}`, de: `${SITE}${SHARE_FILE.de}` },
    ld: false, navBase: './', bodyClass: 'legal-page help-page',
    enHref: rel(c.lang, 'en'), deHref: rel(c.lang, 'de'), otherHref: rel(c.lang, other),
  };
  const groups = [[S.facts, SHARE.cards.filter((x) => x.kind === 'fact')], [S.brand, SHARE.cards.filter((x) => x.kind !== 'fact')]];
  return `${pageTop(c, m)}
<main id="main" class="legal help">

<section class="legal-head help-head" aria-labelledby="share-h">
  <div class="wrap">
    <p class="label help-crumbs"><a href="${S.crumbHref}">${S.crumb}</a></p>
    <h1 id="share-h">${S.h1}</h1>
    <p class="legal-note help-lede">${S.lede}</p>
    <p class="note">${S.formats}</p>
  </div>
</section>

<div class="wrap help-index share-index">
${groups.map(([h, cards], k) => `  <section class="help-group" aria-labelledby="sg-${k}">
    <h2 id="sg-${k}">${h}</h2>
    <ul class="share-grid">
      ${cards.map((x) => shareCard(c, x, c.base)).join('\n      ')}
    </ul>
  </section>`).join('\n')}
  <p class="note">${S.note}</p>
</div>

</main>

${pageFoot(c, m)}

<script src="${c.base}assets/site.js" defer></script>
</body>
</html>
`;
}

/** A few matching cards at the end of a Ratgeber post (German only, like the posts). */
const shareStrip = (c, p) => {
  const slugs = SHARE && c.lang === 'de' ? SHARE_ON_POST[p.slug] : null;
  if (!slugs) return '';
  if (new Set(slugs).size !== slugs.length) throw new Error(`share strip for ${p.slug}: a card is listed twice`);
  const cards = slugs.map((sl) => SHARE.cards.find((x) => x.slug === sl)).filter(Boolean);
  if (cards.length !== slugs.length) throw new Error(`share strip for ${p.slug}: unknown card`);
  const S = SHARE_COPY.de;
  return `    <section id="teilen" aria-labelledby="teilen-h">
      <h2 id="teilen-h">${S.post}</h2>
      <p>${S.postNote} <a href="../de/teilen.html">${S.h1}</a>.</p>
      <ul class="share-grid share-strip">
      ${cards.map((x) => shareCard(c, x, '../')).join('\n      ')}
      </ul>
    </section>
`;
};

// ---------------------------------------------------------------- thank-you pages for the hardship form (docs/pricing.md)
/** The cloud redirects here after the form (server/routes/cloud.ts): de/danke.html or thanks.html, `?error=1` when it failed. */
const THANKS_FILE = { de: 'de/danke.html', en: 'thanks.html' };
const THANKS_COPY = {
  de: {
    title: 'Danke für deine Nachricht', label: 'Wir können uns das gerade nicht leisten',
    h1: 'Danke, deine Nachricht ist bei uns.',
    p: 'Wir lesen jede Anfrage selbst und melden uns per Mail. Das kann ein paar Tage dauern. Schau zur Sicherheit auch im Spam-Ordner nach.',
    next: 'So geht es weiter', steps: ['Wir lesen deine Nachricht.', 'Du bekommst eine Mail mit einem Code für ToHuus.', 'Den Code löst du im Web unter Einstellungen › Abo › Code einlösen ein.'],
    errH1: 'Das hat leider nicht geklappt.',
    errP: 'Deine Anfrage ist nicht bei uns angekommen. Vielleicht gab es eine Störung, oder von dieser Adresse liegt schon eine offene Anfrage bei uns. Versuch es später noch einmal.',
    again: 'Zurück zum Formular', home: 'Zur Startseite',
  },
  en: {
    title: 'Thank you for your message', label: 'We can’t afford this right now',
    h1: 'Thank you, we have your message.',
    p: 'We read every request ourselves and reply by e-mail. It can take a few days. Have a look in your spam folder too, just in case.',
    next: 'What happens next', steps: ['We read your message.', 'You get an e-mail with a code for ToHuus.', 'You redeem the code on the web under Settings › Plan › Redeem a code.'],
    errH1: 'Sorry, that did not work.',
    errP: 'Your request did not reach us. There may have been a hiccup, or there is already an open request from this address. Please try again later.',
    again: 'Back to the form', home: 'Back to the home page',
  },
};
function thanksPage(c) {
  const T = THANKS_COPY[c.lang];
  const de = c.lang === 'de';
  const m = {
    title: `${T.title} · ToHuus`, desc: T.p, url: `${SITE}${THANKS_FILE[c.lang]}`, alt: { en: `${SITE}${THANKS_FILE.en}`, de: `${SITE}${THANKS_FILE.de}` },
    ld: false, navBase: './', bodyClass: 'legal-page thanks-page', noindex: true,
    enHref: de ? '../thanks.html' : 'thanks.html', deHref: de ? 'danke.html' : 'de/danke.html', otherHref: de ? '../thanks.html' : 'de/danke.html',
  };
  const form = `./#${c.prices.hardship.id}`;
  return `${pageTop(c, m)}
<main id="main" class="legal">

<section class="legal-head thanks" aria-labelledby="thanks-h">
  <div class="wrap">
    ${label(T.label)}
    <div data-thanks="ok">
      <h1 id="thanks-h">${T.h1}</h1>
      <p class="legal-note">${T.p}</p>
      <div class="legal-summary thanks-steps" role="group" aria-label="${T.next}">
        <p class="legal-summary-h">${T.next}</p>
        <ol>${T.steps.map((x, k) => `<li><span>${k + 1}</span>${x}</li>`).join('')}</ol>
      </div>
      <p class="legal-links thanks-links"><a href="./">${T.home}${ico('arrow')}</a></p>
    </div>
    <div data-thanks="error" hidden>
      <h1 id="thanks-err-h">${T.errH1}</h1>
      <p class="legal-note">${T.errP}</p>
      <p class="legal-links thanks-links"><a href="${form}">${T.again}${ico('arrow')}</a><a href="./">${T.home}${ico('arrow')}</a></p>
    </div>
  </div>
</section>
<script>(function(){if(!/[?&]error=1(&|$)/.test(location.search))return;var o=document.querySelector('[data-thanks="ok"]'),e=document.querySelector('[data-thanks="error"]');o.hidden=true;e.hidden=false;document.title=${JSON.stringify(`${T.errH1} · ToHuus`)};document.querySelector('.thanks').setAttribute('aria-labelledby','thanks-err-h')})()</script>

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
    if (!html.includes(LEGAL_STATUS[c.lang])) throw new Error(`status line missing on ${c.lang} ${kind} page`);
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
for (const c of Object.values(COPY)) {
  const html = thanksPage(c);
  checkText(html, THANKS_FILE[c.lang], 0);
  fs.writeFileSync(path.join(ROOT, THANKS_FILE[c.lang]), html);
}
if (SHARE) for (const c of Object.values(COPY)) {
  const html = sharePage(c);
  checkText(html, SHARE_FILE[c.lang], 0);
  fs.writeFileSync(path.join(ROOT, SHARE_FILE[c.lang]), html);
}
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
  ...(SHARE ? Object.values(SHARE_FILE).map((f) => [`${SITE}${f}`, today]) : []),
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

ToHuus is a shopping and household assistant for families, couples and flatshares (iPhone app and web app, in ToHuus Cloud or self-hosted with Docker, with a Home Assistant integration). It learns from receipts and the shared shopping list how often a household buys things and suggests them when they are due, plans meals from what is at home, shows where the money for food and household goes, keeps the household's recurring tasks and appointments (with Apple Reminders and calendar sync), lets people at home ask each other for a little something ("Bring me something", German "Bring mir was"), keeps wish lists with reservations hidden from the person they are for, and holds house info for guests, babysitters and house sitters (guest Wi-Fi with a join QR code, how things work, house rules, bedtimes, important numbers; codes such as door or alarm codes are kept apart, revealed only on purpose and never sent to AI) plus holiday handovers. For heads with a lot going on (ADHD, autism, a packed week) tasks split into small steps, a focus view shows one thing at a time, a visible timer helps to start, a personal gentle mode drops red warnings and counters, and an allowance for extras keeps impulse buys in view; there are no streaks, points or rankings. Servers in Germany, no tracking, no ads, open source (AGPL).

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
 * Never use real names. Check every image before committing. `--only houseinfo,houseinfo-guest` re-shoots just those
 * slots (the Hausinfo slots seed their own cards, two codes and a babysitter link) and leaves every other image alone.
 *
 * OG images (site/assets/img/og-<lang>.png, 1200x630): a 1200x630 page with the wordmark, the hero headline and
 * homeTiles(), styled by site.css and screenshotted with Playwright from the served site/ folder.
 */
