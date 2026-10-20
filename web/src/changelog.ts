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
    id: '2026-10-15.2',
    title: { en: 'Seen: on your mind, what you solved, who you look after', de: 'Gesehen werden: Im Kopf, heute gelöst, für wen du da bist' },
    items: [
      { en: '“On my mind”: get thoughts out of your head – private or for everyone, with a “someday” if you like. And “done on the side” for what never was on a list.', de: '„Im Kopf“: Gedanken loswerden – privat oder für alle, gern mit „irgendwann“. Und „Nebenbei erledigt“ für das, was nie auf einer Liste stand.', to: '/kopf' },
      { en: 'In the evening Heute may ask “What did you solve today?” – two taps, and the others get a thank-you.', de: 'Abends fragt Heute ab und zu „Was habt ihr heute gelöst?“ – zwei Tipps, und die anderen bekommen ein Danke.', to: '/' },
      { en: '“People I look after”: visits, appointments, prescriptions – that’s work, and it gets room here. Private unless you share it.', de: '„Für wen ich da bin“: Besuche, Termine, Rezepte – das ist Arbeit und bekommt hier Platz. Privat, außer du teilst es.', to: '/fuer-wen' },
      { en: 'Swipe to decide: what to eat this week, what’s still on your mind, what can wait.', de: 'Wischen zum Entscheiden: was ihr diese Woche esst, was dir noch im Kopf ist, was warten darf.', to: '/kochen' },
      { en: 'Share lists to Notes or Mail, and your week as a picture for stories.', de: 'Listen in Notizen oder per Mail teilen, und eure Woche als Bild für Stories.', to: '/woche' },
    ],
  },
  {
    id: '2026-10-15',
    title: { en: 'Away, one by one – and a look back at your week', de: 'Einzeln unterwegs – und ein Blick auf eure Woche' },
    items: [
      { en: '“Only I’m away”: a business trip or a hospital stay – the house runs on, tasks go to whoever is home or may wait.', de: '„Nur ich bin weg“: Dienstreise oder Krankenhaus – zu Hause läuft alles weiter, Aufgaben gehen an die, die da sind, oder dürfen warten.', to: '/urlaub' },
      { en: 'Guests can help too: Grandma waters the plants, your aunt helps while you’re in hospital.', de: 'Auch Gäste können helfen: Oma gießt die Blumen, die Tante hilft, während du im Krankenhaus bist.', to: '/urlaub' },
      { en: 'Your week and your month at home – only what went well, no comparisons.', de: 'Eure Woche und euer Monat to Huus – nur, was gut lief, ohne Vergleiche.', to: '/woche' },
      { en: 'ToHuus learns who usually does what, and suggests who cooks.', de: 'ToHuus lernt, wer was meistens macht, und schlägt vor, wer kocht.', to: '/aufgaben' },
    ],
  },
  {
    id: '2026-10-14',
    title: { en: 'Tasks for the whole household', de: 'Aufgaben für den ganzen Haushalt' },
    items: [
      { en: 'Household tasks with taking turns, “I’ll do it” and who keeps what in mind – no points, no ranking.', de: 'Aufgaben im Haushalt mit Abwechseln, „Mach ich“ und wer was im Blick hat – ohne Punkte, ohne Rangliste.', to: '/aufgaben' },
      { en: 'Bin dates from your calendar, and tasks in your own calendar app.', de: 'Mülltermine aus eurem Kalender, und Aufgaben in deiner eigenen Kalender-App.', to: '/einstellungen/mitteilungen' },
      { en: 'The assistant button is a small sparkle now – the microphone inside still listens.', de: 'Der Assistent-Knopf ist jetzt ein kleiner Stern – das Mikrofon darin hört weiter zu.' },
    ],
  },
  {
    id: '2026-10-12',
    title: { en: 'Faster, five tabs and “Today” at a glance', de: 'Schneller, fünf Tabs und „Heute“ auf einen Blick' },
    items: [
      { en: 'The app opens much faster: each page loads only when you need it.', de: 'Die App startet deutlich schneller: Jede Seite lädt erst, wenn du sie brauchst.' },
      { en: 'Five tabs at the bottom – Today, Shopping, Pantry, Cook, Money. Everything else is behind your picture on “Today”.', de: 'Fünf Tabs unten – Heute, Einkauf, Vorrat, Kochen, Geld. Alles andere findest du über dein Bild auf „Heute“.', to: '/mehr' },
      { en: '“Today” shows what is due, the list, what to use soon, an idea for dinner and this week’s spending.', de: '„Heute“ zeigt, was fällig ist, die Liste, was weg muss, eine Idee fürs Essen und was die Woche gekostet hat.', to: '/' },
      { en: 'Every item on the list says where it came from, and a tick can be undone right away.', de: 'Jeder Eintrag auf der Liste zeigt, woher er kommt, und ein Haken lässt sich sofort zurücknehmen.', to: '/einkauf' },
      { en: 'New: “Money” – per month, shop and category, with your budget.', de: 'Neu: „Geld“ – pro Monat, Laden und Kategorie, mit eurem Budget.', to: '/geld' },
      { en: 'Cooking is one page now: ideas from what is at home, the week plan and your recipes.', de: 'Kochen ist jetzt eine Seite: Ideen aus dem, was da ist, Wochenplan und eure Rezepte.', to: '/kochen' },
    ],
  },
  {
    id: '2026-10-11',
    title: { en: 'A fresh look and a lot more for the whole family', de: 'Neuer Look und viel mehr für die ganze Familie' },
    items: [
      { en: 'New design, light or dark – everyone can choose if the admin allows it.', de: 'Neues Design, hell oder dunkel – wenn der Admin es erlaubt, für jeden einzeln.', to: '/einstellungen/ich/darstellung' },
      { en: 'Profile pictures, children without their own login, and permanent guests who only see what you allow.', de: 'Profilbilder, Kinder ohne eigenen Login und feste Gäste, die nur sehen, was du freigibst.', to: '/einstellungen/haushalt/leute' },
      { en: 'Rate dishes per person and see everyone’s favourites.', de: 'Gerichte pro Person bewerten und die Lieblinge aller sehen.', to: '/lieblinge' },
      { en: '“Who wants what?” – vote on dinner, secretly or together, and see the matches.', de: '„Wer will was?“ – übers Essen abstimmen, geheim oder gemeinsam, und die Treffer sehen.', to: '/kochen' },
      { en: 'Cook for more people just once: servings per planned meal, the shopping list follows.', de: 'Einmal für mehr Leute kochen: Portionen pro geplantem Essen, der Einkauf rechnet mit.', to: '/kochen' },
      { en: 'Week plans that rotate over several weeks.', de: 'Wochenpläne, die über mehrere Wochen rotieren.', to: '/kochen' },
      { en: 'Leftovers and freezer labels with QR code – scan to see what is inside and until when.', de: 'Reste- und Einfrier-Etiketten mit QR-Code – scannen und sehen, was drin ist und bis wann.', to: '/etiketten' },
      { en: 'Trip mode: use things up before you leave, packing list, holiday kitchen and a welcome-home list.', de: 'Urlaubsmodus: vorher aufbrauchen, Packliste, Ferienküche und Einkauf für die Rückkehr.', to: '/urlaub' },
      { en: 'Share lists from WhatsApp straight into the app, and add discreet items only you can see.', de: 'Listen aus WhatsApp direkt in die App teilen und diskrete Einträge, die nur du siehst.', to: '/einkauf' },
      { en: 'Edit the order menu yourself – coffee, drinks, snacks, with options and notes.', de: 'Die Bestell-Karte selbst bearbeiten – Kaffee, Getränke, Snacks, mit Optionen und Notizen.', to: '/bestellen/karte' },
      { en: 'Bring recipes from other apps, websites in English and German, or any AI.', de: 'Rezepte aus anderen Apps, englischen und deutschen Webseiten oder von jeder KI übernehmen.', to: '/einstellungen/bereiche/rezepte' },
    ],
  },
  {
    id: '2026-10-10.3',
    title: { en: 'Dinner, spending, sign-in and more', de: 'Abendessen, Ausgaben, Anmeldung und mehr' },
    items: [
      { en: '“What do we eat today?” shows what works with what is at home – and can simply decide for you.', de: '„Was essen wir heute?“ zeigt, was mit dem Vorrat geht – und kann auch einfach für euch entscheiden.', to: '/kochen' },
      { en: 'Your own way of cooking: rice instead of potatoes? Save it once – suggestions and shopping follow your version.', de: 'Eure eigene Art zu kochen: Reis statt Kartoffeln? Einmal speichern – Vorschläge und Einkauf richten sich danach.', to: '/kochen' },
      { en: 'Spending with charts for week, month, year and all time, budgets and items you can leave out.', de: 'Ausgaben mit Diagrammen für Woche, Monat, Jahr und gesamt, Budgets und Posten, die nicht mitzählen.', to: '/ausgaben' },
      { en: 'Sign in with a passkey, an e-mail link or your own single sign-on.', de: 'Anmelden per Passkey, E-Mail-Link oder eigenem Single Sign-on.', to: '/einstellungen/ich/anmeldung' },
      { en: 'Receipt-style tickets: print shopping lists, kitchen orders and care tasks on a thermal printer or send them.', de: 'Bons zum Ausdrucken: Einkaufszettel, Küchenbons und Pflege-Aufgaben auf dem Bondrucker oder digital verschicken.', to: '/einstellungen/verbindungen/drucker' },
      { en: 'Telegram: add things to the list by message, get notifications with buttons.', de: 'Telegram: Sachen per Nachricht auf die Liste setzen, Benachrichtigungen mit Knöpfen.' },
      { en: 'A real Home Assistant integration with sensors, to-do list, calendars and dashboards – and the Cookidoo week comes in by itself.', de: 'Eine richtige Home-Assistant-Integration mit Sensoren, To-do-Liste, Kalendern und Dashboards – und die Cookidoo-Woche kommt von selbst.' },
      { en: 'Svenska! And receipts from the UK, the US and Sweden.', de: 'Svenska! Und Bons aus Großbritannien, den USA und Schweden.' },
    ],
  },
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
