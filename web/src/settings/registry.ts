/**
 * Einstellungen (UX audit 2026-10, Paket C, docs/settings.md): six pages, each a short list. This file is the one
 * register for the web: the pages, every row on them (with the words people search for), where each row lives and
 * which old link (`/einstellungen?tab=…`) goes where. No React and no i18n in here – titles are the English keys,
 * the UI translates them – so tests, the server (apns.ts mirrors OLD_TABS) and the iOS port can check against it.
 * iOS: ios/ToHuus/Features/Settings/SettingsHome.swift (same page ids and row ids – test/settings-registry.test.ts).
 */

export type PageId = 'ich' | 'haushalt' | 'bereiche' | 'mitteilungen' | 'verbindungen' | 'daten';

export interface SettingsPage {
  id: PageId;
  /** English key, translated in the UI */
  title: string;
  /** one short line under the title in the list */
  hint: string;
  /** Phosphor icon name (resolved in SettingsPages.tsx) */
  icon: string;
}

export const PAGES: SettingsPage[] = [
  { id: 'ich', title: 'Me', hint: 'Calm & focus, your bar, how it looks, signing in', icon: 'UserCircle' },
  { id: 'haushalt', title: 'Household', hint: 'Name, language, who lives here, how you cook', icon: 'House' },
  { id: 'bereiche', title: 'Areas & places', hint: 'What you use, places, pantry, recipes', icon: 'SquaresFour' },
  { id: 'mitteilungen', title: 'Notifications & calendar', hint: 'What reaches you, and your calendar', icon: 'Bell' },
  { id: 'verbindungen', title: 'Connections & devices', hint: 'AI, Home Assistant, displays, printers', icon: 'Plugs' },
  { id: 'daten', title: 'Data, plan & account', hint: 'Plan, backups, export, reset', icon: 'Database' },
];

export type RowKind =
  /** shown on the page itself (the switches for days without strength: Ruhe & Fokus) */
  | 'inline'
  /** its own sub page /einstellungen/<page>/<id> */
  | 'sub'
  /** a function elsewhere in the app */
  | 'link';

export interface SettingsRow {
  /** unique, also the URL slug of a sub page – the same ids on iOS */
  id: string;
  page: PageId;
  kind: RowKind;
  title: string;
  hint?: string;
  icon: string;
  /** German and English words people type (lower case) */
  words: string;
  /** link rows: where to */
  to?: string;
  /** listed under "Mehr Optionen" on its page (rarely needed) */
  more?: boolean;
  /** a small group heading on the page (rows with the same group stand together) */
  group?: string;
  /** visible to permanent guests (they only ever see "Ich") */
  guest?: boolean;
  /** needs a signed-in member (not a display or a device token) */
  user?: boolean;
  /** only admins can use it at all (cards that are read-only for members stay visible) */
  admin?: boolean;
  /** true = only ToHuus Cloud, false = only self-hosted */
  cloud?: boolean;
  /** switchable area of "Was nutzt ihr?" */
  module?: string;
  /** only on one platform (e.g. the shop hint needs the iPhone's location) */
  platform?: 'web' | 'ios';
}

export const ROWS: SettingsRow[] = [
  // ---------------------------------------------------------------- Ich
  { id: 'fokus', page: 'ich', kind: 'inline', title: 'Calm & focus', hint: 'Gentle mode, Just one, how much Today shows', icon: 'Leaf', user: true,
    words: 'ruhe fokus sanfter modus nur eins adhs ads autismus überfordert weniger timer erinnerungen bündeln abends fragen check-in gentle just one calm focus' },
  { id: 'profil', page: 'ich', kind: 'sub', title: 'Name, picture & taste', hint: 'How the others see you, what you like, allergies', icon: 'Smiley', guest: true,
    words: 'name bild foto avatar tier geschmack allergien unverträglichkeit vegetarisch profil picture taste allergy' },
  { id: 'leiste', page: 'ich', kind: 'sub', title: 'Your bar', hint: 'Which areas sit at the bottom', icon: 'SquaresFour', user: true,
    words: 'leiste deine leiste tabs unten reiter anpassen bereiche tauschen bar' },
  { id: 'darstellung', page: 'ich', kind: 'sub', title: 'Appearance & readability', hint: 'Light or dark, text size, how the list looks', icon: 'CircleHalf',
    words: 'darstellung hell dunkel dark mode farbe schrift größe lesbarkeit liste ansicht kompakt appearance theme' },
  { id: 'anmeldung', page: 'ich', kind: 'sub', title: 'Sign-in & security', hint: 'Password, passkeys, e-mail, devices', icon: 'Key', guest: true,
    words: 'anmelden anmeldung passwort passkey e-mail mail zwei-schritt 2fa sso pin geräte sitzungen abmelden sicherheit konto iphone app verbinden password security' },

  // ---------------------------------------------------------------- Haushalt
  { id: 'name', page: 'haushalt', kind: 'inline', title: 'Name & language', icon: 'House',
    words: 'haushalt name sprache deutsch englisch language household' },
  { id: 'leute', page: 'haushalt', kind: 'sub', title: 'Who lives here?', hint: 'People, children, guests, invitations', icon: 'UsersThree',
    words: 'leute mitglieder personen kinder gäste einladen rolle admin familie wg wer wohnt hier people members invite' },
  { id: 'anmeldewege', page: 'haushalt', kind: 'sub', title: 'Ways to sign in', hint: 'Passkeys, e-mail links, passwords, single sign-on', icon: 'Key', admin: true, more: true,
    words: 'anmeldewege anmeldung passkeys passwort sso openid single sign-on zwei-schritt pin login mitglieder anmelden sign in' },
  { id: 'region', page: 'haushalt', kind: 'sub', title: 'Region & currency', icon: 'Globe',
    words: 'region land währung euro franken läden region currency' },
  { id: 'kochstil', page: 'haushalt', kind: 'sub', title: 'How do you cook?', hint: 'Thermomix, how much time, what you avoid', icon: 'CookingPot', module: 'cook',
    words: 'kochen kochstil thermomix zeit vegetarisch wie kocht ihr cook style' },
  { id: 'extras', page: 'haushalt', kind: 'sub', title: 'Extras in the weekly shop', icon: 'Cookie',
    words: 'extras kontingent luxus naschen süßes spaß budget woche weekly treats allowance' },
  { id: 'brotdose', page: 'haushalt', kind: 'sub', title: 'Lunchbox', icon: 'Bread',
    words: 'brotdose schule kita pausenbrot lunchbox' },
  { id: 'wochenfrage', page: 'haushalt', kind: 'sub', title: 'Question of the week', icon: 'ChatCircle', more: true,
    words: 'wochenfrage umfrage frage der woche puls pulse question' },
  { id: 'sterne', page: 'haushalt', kind: 'sub', title: 'Stars', icon: 'Star', more: true,
    words: 'sterne punkte belohnung kinder stars' },
  { id: 'teilen-zeile', page: 'haushalt', kind: 'sub', title: 'Line under shared lists', icon: 'ShareNetwork', more: true,
    words: 'geteilt aus tohuus zeile fußzeile teilen liste footer shared' },

  // ---------------------------------------------------------------- Bereiche & Orte
  { id: 'module', page: 'bereiche', kind: 'sub', title: 'What do you use?', hint: 'Switch off what you don’t need', icon: 'ToggleRight',
    words: 'was nutzt ihr bereiche module ausschalten einschalten weniger überfordert areas modules' },
  { id: 'orte', page: 'bereiche', kind: 'sub', title: 'Places & categories', hint: 'Fridge, cellar, shelves', icon: 'MapPin',
    words: 'orte räume kategorien regal schrank kühlschrank keller places categories' },
  { id: 'vorrat', page: 'bereiche', kind: 'sub', title: 'Pantry: what to track?', hint: 'Everything, or only what runs out', icon: 'Package', module: 'stock',
    words: 'vorrat bestand verfolgen was verfolgen nur was ausgeht alles tracking pantry track' },
  { id: 'rezepte', page: 'bereiche', kind: 'sub', title: 'Recipes & imports', hint: 'From websites, apps and Cookidoo', icon: 'BookOpen', module: 'cook',
    words: 'rezepte import cookidoo chefkoch webseite übernehmen recipes' },
  { id: 'karte', page: 'bereiche', kind: 'sub', title: 'Bring me something: menu', icon: 'HandHeart', module: 'treats',
    words: 'bring mir was karte speisekarte bestellen getränke treats menu' },
  { id: 'urlaub', page: 'bereiche', kind: 'link', to: '/urlaub', title: 'Trip & handover', icon: 'Suitcase',
    words: 'urlaub verreist unterwegs übergabe haushüter trip away handover' },

  // ---------------------------------------------------------------- Mitteilungen & Kalender
  { id: 'meine', page: 'mitteilungen', kind: 'sub', title: 'What reaches you', hint: 'On this phone or browser, only for you', icon: 'Bell', user: true,
    words: 'mitteilungen benachrichtigungen push ruhezeiten nur für mich notifications' },
  { id: 'haushalt-kanaele', page: 'mitteilungen', kind: 'sub', title: 'For the whole household', hint: 'Home Assistant, ntfy, e-mail, Telegram', icon: 'Broadcast',
    words: 'kanäle haushalt e-mail ntfy webhook telegram matrix tagesübersicht mhd warnung push channels digest' },
  { id: 'kalender-lesen', page: 'mitteilungen', kind: 'sub', title: 'Read your calendar', hint: 'Bin dates and appointments from your calendar', icon: 'CalendarBlank', user: true, group: 'Calendar',
    words: 'kalender lesen müll abfuhr termine google outlook ics calendar read' },
  { id: 'caldav', page: 'mitteilungen', kind: 'sub', title: 'Reminders & calendar', hint: 'Tasks in Apple Reminders or your calendar app', icon: 'CalendarCheck', user: true, group: 'Calendar',
    words: 'apple erinnerungen caldav kalender aufgaben termine reminders' },
  { id: 'kalender-abo', page: 'mitteilungen', kind: 'sub', title: 'Calendar subscription', hint: 'A link your calendar app can subscribe to', icon: 'LinkSimple', user: true, group: 'Calendar',
    words: 'kalender abo abonnieren ics link feed subscription' },
  // Platz für den Wunschlisten-Bereich: eine Zeile „Geschenk-Erinnerungen“ (id z. B. 'geschenke', module 'wishes')
  // kommt hier dazu, sobald die Wunschlisten fertig sind – dieselbe Zeile in SettingsHome.swift eintragen.
  { id: 'laden', page: 'mitteilungen', kind: 'sub', title: 'Hint in the shop', icon: 'NavigationArrow', platform: 'ios',
    words: 'laden ort standort geofence hinweis im laden supermarkt shop location' },

  // ---------------------------------------------------------------- Verbindungen & Geräte
  { id: 'ki', page: 'verbindungen', kind: 'sub', title: 'AI', hint: 'On or off, and what it may see', icon: 'Sparkle',
    words: 'ki künstliche intelligenz assistent datenschutz mit ohne ki gedächtnis ai privacy' },
  { id: 'assistent', page: 'verbindungen', kind: 'sub', title: 'AI assistants & access', hint: 'Claude, ChatGPT, scripts (MCP)', icon: 'Key',
    words: 'mcp claude chatgpt token zugang zugriff api schlüssel skript access' },
  { id: 'home-assistant', page: 'verbindungen', kind: 'sub', title: 'Home Assistant', icon: 'House', module: 'ha',
    words: 'home assistant smart home hacs alexa sprachassistent cookidoo to-do' },
  { id: 'displays', page: 'verbindungen', kind: 'sub', title: 'Displays & family tablet', icon: 'Monitor',
    words: 'display bildschirm tablet kiosk familien-tablet küche wand displays' },
  { id: 'drucker', page: 'verbindungen', kind: 'sub', title: 'Printers', hint: 'Print lists and notes on a receipt printer', icon: 'Printer',
    words: 'drucker bondrucker ausdruck zettel ticket printer print' },
  { id: 'etiketten', page: 'verbindungen', kind: 'link', to: '/etiketten', title: 'QR labels', icon: 'QrCode',
    words: 'etiketten qr drucken aufkleber labels' },
  { id: 'teilen', page: 'verbindungen', kind: 'sub', title: 'Share from other apps', hint: 'Shortcuts, links and e-receipts', icon: 'ShareNetwork', user: true, platform: 'web',
    words: 'teilen kurzbefehl shortcut aus anderen apps link e-bon share' },
  { id: 'mail', page: 'verbindungen', kind: 'sub', title: 'Receipts by e-mail', icon: 'Envelope', admin: true, more: true,
    words: 'e-mail postfach bon mail kassenbon weiterleiten imap inbox' },
  // the iPhone has the system share sheet instead of "teilen" (web: shortcut keys, the installed web app)
  { id: 'server', page: 'verbindungen', kind: 'sub', title: 'Servers & households', icon: 'HardDrives', platform: 'ios',
    words: 'server haushalt wechseln eigener server verbinden cloud' },

  // ---------------------------------------------------------------- Daten, Abo & Konto
  { id: 'abo', page: 'daten', kind: 'sub', title: 'Plan & storage', hint: 'Your plan, the assistant this month, storage', icon: 'CreditCard',
    words: 'abo plan speicher bezahlen preis kündigen rechnung subscription storage' },
  { id: 'sicherung', page: 'daten', kind: 'sub', title: 'Data & backups', hint: 'Export, backups, move, purchase history', icon: 'Database',
    words: 'daten export sicherung backup import umzug csv kaufhistorie fehlerprotokoll data backups' },
  { id: 'zuruecksetzen', page: 'daten', kind: 'sub', title: 'Data & reset', hint: 'Sample data, clear areas, start over', icon: 'ArrowCounterClockwise',
    words: 'zurücksetzen löschen leeren beispieldaten demo neu anfangen wiederherstellen reset clear sample' },
  { id: 'konto', page: 'daten', kind: 'sub', title: 'Your data & account', hint: 'Download everything, or delete the account', icon: 'Trash', cloud: true, user: true,
    words: 'konto löschen account löschen deine daten herunterladen dsgvo auskunft delete account your data' },
];

/** where a row lives */
export function rowPath(r: SettingsRow): string {
  if (r.kind === 'link') return r.to ?? '/';
  if (r.kind === 'inline') return `/einstellungen/${r.page}#${r.id}`;
  return `/einstellungen/${r.page}/${r.id}`;
}
export const pagePath = (p: PageId) => `/einstellungen/${p}`;

export interface SettingsCtx {
  guest: boolean;
  user: boolean;
  admin: boolean;
  cloud: boolean;
  modules?: Record<string, boolean>;
  platform?: 'web' | 'ios';
}

export function rowVisible(r: SettingsRow, c: SettingsCtx): boolean {
  if (r.platform && r.platform !== (c.platform ?? 'web')) return false;
  if (c.guest && !r.guest) return false;
  if (r.user && !c.user) return false;
  if (r.admin && !c.admin) return false;
  if (r.cloud !== undefined && r.cloud !== c.cloud) return false;
  if (r.module && c.modules && c.modules[r.module] === false) return false;
  return true;
}
export const visibleRows = (c: SettingsCtx, page?: PageId) => ROWS.filter((r) => (!page || r.page === page) && rowVisible(r, c));
export const visiblePages = (c: SettingsCtx) => PAGES.filter((p) => visibleRows(c, p.id).length > 0);

/** lower case, without accents and ß, for matching typed words */
export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

/**
 * The settings search: every word typed must appear in the row's title (both languages), hint, words or page.
 * `tr` translates an English key (the UI passes t).
 */
export function searchRows(q: string, c: SettingsCtx, tr: (en: string) => string = (x) => x): SettingsRow[] {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return visibleRows(c).filter((r) => {
    const page = PAGES.find((p) => p.id === r.page)!;
    const hay = fold([r.title, tr(r.title), r.hint ?? '', r.hint ? tr(r.hint) : '', r.words, page.title, tr(page.title)].join(' '));
    return terms.every((w) => hay.includes(w));
  });
}

/** Old links: `/einstellungen?tab=<x>` (mails, pushes, help, changelog, bookmarks) → the new place. Mirrored in server/lib/apns.ts. */
export const OLD_TABS: Record<string, string> = {
  plan: '/einstellungen/daten/abo',
  home: '/einstellungen/haushalt',
  account: '/einstellungen/ich',
  members: '/einstellungen/haushalt/leute',
  places: '/einstellungen/bereiche/orte',
  notify: '/einstellungen/mitteilungen',
  access: '/einstellungen/verbindungen',
  ha: '/einstellungen/verbindungen/home-assistant',
  displays: '/einstellungen/verbindungen/displays',
  print: '/einstellungen/verbindungen/drucker',
  recipes: '/einstellungen/bereiche/rezepte',
  data: '/einstellungen/daten',
};

/**
 * The new place for an old settings link, or null when the link is already new. Keeps the other query parameters
 * (`sso=linked` after linking single sign-on) and the hash; `?tab=data#demo` (sample data) goes to Daten & Zurücksetzen.
 */
export function legacySettingsTarget(search: string, hash = ''): string | null {
  const q = new URLSearchParams(search);
  const tab = q.get('tab');
  if (tab === null) return null;
  q.delete('tab');
  let to = OLD_TABS[tab] ?? '/einstellungen';
  if (tab === 'data' && hash === '#demo') to = '/einstellungen/daten/zuruecksetzen';
  if (tab === 'account' && q.get('sso')) to = '/einstellungen/ich/anmeldung';
  const rest = q.toString();
  return `${to}${rest ? `?${rest}` : ''}${hash}`;
}

/** Does a settings path lead somewhere? (page, sub page of a row on it, or the "Mehr Optionen" list) */
export function resolveSettingsPath(path: string): { page: PageId | null; sub: string | null } | null {
  const m = /^\/einstellungen(?:\/([a-z-]+))?(?:\/([a-z-]+))?\/?$/.exec(path.split(/[?#]/)[0]);
  if (!m) return null;
  const page = (m[1] ?? null) as PageId | null;
  if (page && !PAGES.some((p) => p.id === page)) return null;
  const sub = m[2] ?? null;
  if (sub && sub !== 'mehr' && !ROWS.some((r) => r.page === page && r.id === sub && r.kind === 'sub')) return null;
  return { page, sub };
}
