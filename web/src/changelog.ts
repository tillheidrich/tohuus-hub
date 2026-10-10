/**
 * "What's new" – shown once per member after an update (Shell › WhatsNew).
 * Newest entry first. `id` is the release day, optionally with a suffix for a second release that day
 * ("2026-10-10.2"); ids are compared as strings, so keep the format. Plain, friendly language –
 * this is read by the partner, not by the admin. `to` links an item to the page where it lives.
 */
export interface ChangeItem {
  en: string;
  de: string;
  to?: string;
}
export interface ChangeEntry {
  id: string;
  title: { en: string; de: string };
  items: ChangeItem[];
}

export const CHANGELOG: ChangeEntry[] = [
  {
    id: '2026-10-10.2',
    title: { en: 'Easier to get started', de: 'Leichter loslegen' },
    items: [
      {
        en: 'A short setup for new households: name, rooms, invite your partner, first stock – each step can be skipped.',
        de: 'Ein kurzer Start für neue Haushalte: Name, Räume, Partner einladen, erster Bestand – jeder Schritt lässt sich überspringen.',
      },
      {
        en: 'Typical staples per room with one tap – pasta, rice, toilet paper, dishwasher tabs … with a rough fill level instead of counting.',
        de: 'Typische Vorräte pro Raum mit einem Tipp – Nudeln, Reis, Klopapier, Spülmaschinentabs … mit grobem Füllstand statt Zählen.',
        to: '/bestand',
      },
      { en: 'Help with short how-tos: phone home screen and push, Claude, Home Assistant, guests, backups.', de: 'Hilfe mit kurzen Anleitungen: Handy-Startbildschirm und Push, Claude, Home Assistant, Gäste, Backups.', to: '/hilfe' },
      { en: 'The menu is sorted into groups, so everything is easy to find on the phone.', de: 'Das Menü ist in Gruppen sortiert, damit du auf dem Handy alles schnell findest.' },
      { en: 'Kid mode: children order with pictures, a parent says yes or no.', de: 'Kindermodus: Kinder bestellen mit Bildern, ein Elternteil sagt ja oder nein.' },
      { en: 'A calm kitchen display for a tablet or e-ink screen on the wall.', de: 'Eine ruhige Küchenanzeige für ein Tablet oder einen E-Ink-Bildschirm an der Wand.' },
      { en: 'More shops for receipts, and “use by” is told apart from “best before”.', de: 'Mehr Läden für Kassenbons, und „zu verbrauchen bis“ wird von „mindestens haltbar bis“ unterschieden.' },
    ],
  },
  {
    id: '2026-10-10',
    title: { en: 'Party, fresher stock, store mode', de: 'Party, frischerer Bestand, Einkaufsmodus' },
    items: [
      { en: 'Party mode: a menu for guests, a QR code on the TV and a kitchen view for the orders.', de: 'Partymodus: eine Karte für Gäste, ein QR-Code auf dem Fernseher und eine Küchenansicht für die Bestellungen.', to: '/bar' },
      { en: '“Eat me first” on Today, opened and frozen items with their own shelf life, and leftovers after cooking.', de: '„Zuerst essen“ auf Heute, geöffnete und eingefrorene Sachen mit eigener Haltbarkeit und Reste nach dem Kochen.', to: '/' },
      { en: 'Quick check: go through one place in a minute – right, less, empty, gone.', de: 'Schnell-Check: einen Ort in einer Minute durchgehen – stimmt, weniger, leer, weg.', to: '/abgleich' },
      { en: 'Store mode for the shopping list: sorted by aisle, works offline, “I’ll get it”, push to your phone.', de: 'Einkaufsmodus für die Liste: nach Gängen sortiert, funktioniert offline, „Ich hol das“, Push aufs Handy.', to: '/einkauf' },
      { en: 'Home care: water filter, smoke detectors, descaling – reminded on time, done with one tap.', de: 'Haus & Pflege: Wasserfilter, Rauchmelder, Entkalken – rechtzeitig erinnert, mit einem Tipp erledigt.', to: '/pflege' },
      { en: 'Spending per month from your receipts, and QR labels for shelves and boxes.', de: 'Ausgaben pro Monat aus deinen Kassenbons und QR-Etiketten für Regale und Kisten.', to: '/ausgaben' },
      { en: 'Invite links: whoever joins picks their own password. Plus nightly backups you can restore.', de: 'Einladungslinks: Wer dazukommt, wählt das Passwort selbst. Dazu nächtliche Backups zum Wiederherstellen.' },
    ],
  },
];

export const latestChange = () => CHANGELOG[0]?.id ?? '';

/** Entries newer than `seen` (all when nothing was seen yet), newest first, at most `max`. */
export function unseenChanges(seen: string | null | undefined, max = 2) {
  return CHANGELOG.filter((e) => !seen || e.id > seen).slice(0, max);
}
