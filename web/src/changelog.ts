/**
 * "What's new" – shown once per member after an update (Shell › WhatsNew).
 * Newest entry first. `id` is the release day, optionally with a suffix for a second release that day
 * ("2026-10-10.2"); ids are compared as strings, so keep the format. Plain, friendly language –
 * this is read by the partner, not by the admin. `to` links an item to the page where it lives.
 */
export interface ChangeItem {
  en: string;
  de: string;
  /** Swedish – optional so a new entry never breaks the build; falls back to English */
  sv?: string;
  to?: string;
}
export interface ChangeEntry {
  id: string;
  title: { en: string; de: string; sv?: string };
  items: ChangeItem[];
}

export const CHANGELOG: ChangeEntry[] = [
  {
    id: '2026-10-11',
    title: { en: 'A fresh look and a lot more for the whole family', de: 'Neuer Look und viel mehr für die ganze Familie', sv: 'Nytt utseende och mycket mer för hela familjen' },
    items: [
      { en: 'New design, light or dark – everyone can choose if the admin allows it.', de: 'Neues Design, hell oder dunkel – wenn der Admin es erlaubt, für jeden einzeln.', sv: 'Ny design, ljus eller mörk – var och en kan välja om admin tillåter det.', to: '/einstellungen?tab=account' },
      { en: 'Profile pictures, children without their own login, and permanent guests who only see what you allow.', de: 'Profilbilder, Kinder ohne eigenen Login und feste Gäste, die nur sehen, was du freigibst.', sv: 'Profilbilder, barn utan eget konto och fasta gäster som bara ser det du tillåter.', to: '/einstellungen?tab=members' },
      { en: 'Rate dishes per person and see everyone’s favourites.', de: 'Gerichte pro Person bewerten und die Lieblinge aller sehen.', sv: 'Betygsätt rätter per person och se allas favoriter.', to: '/lieblinge' },
      { en: '“Who wants what?” – vote on dinner, secretly or together, and see the matches.', de: '„Wer will was?“ – übers Essen abstimmen, geheim oder gemeinsam, und die Treffer sehen.', sv: '”Vem vill ha vad?” – rösta om middagen, i hemlighet eller tillsammans.', to: '/kochen' },
      { en: 'Cook for more people just once: servings per planned meal, the shopping list follows.', de: 'Einmal für mehr Leute kochen: Portionen pro geplantem Essen, der Einkauf rechnet mit.', sv: 'Laga till fler en gång: portioner per planerad måltid, inköpslistan följer med.', to: '/kochen' },
      { en: 'Week plans that rotate over several weeks.', de: 'Wochenpläne, die über mehrere Wochen rotieren.', sv: 'Veckoplaner som roterar över flera veckor.', to: '/kochen' },
      { en: 'Leftovers and freezer labels with QR code – scan to see what is inside and until when.', de: 'Reste- und Einfrier-Etiketten mit QR-Code – scannen und sehen, was drin ist und bis wann.', sv: 'Etiketter för rester och frys med QR-kod.', to: '/etiketten' },
      { en: 'Trip mode: use things up before you leave, packing list, holiday kitchen and a welcome-home list.', de: 'Urlaubsmodus: vorher aufbrauchen, Packliste, Ferienküche und Einkauf für die Rückkehr.', sv: 'Reseläge: använd upp innan ni åker, packlista, semesterkök och hemkomstlista.', to: '/urlaub' },
      { en: 'Share lists from WhatsApp straight into the app, and add discreet items only you can see.', de: 'Listen aus WhatsApp direkt in die App teilen und diskrete Einträge, die nur du siehst.', sv: 'Dela listor från WhatsApp direkt till appen och lägg till diskreta saker.', to: '/einkauf' },
      { en: 'Edit the order menu yourself – coffee, drinks, snacks, with options and notes.', de: 'Die Bestell-Karte selbst bearbeiten – Kaffee, Getränke, Snacks, mit Optionen und Notizen.', sv: 'Redigera beställningsmenyn själv – kaffe, drycker, snacks.', to: '/bestellen/karte' },
      { en: 'Bring recipes from other apps, websites in English and German, or any AI.', de: 'Rezepte aus anderen Apps, englischen und deutschen Webseiten oder von jeder KI übernehmen.', sv: 'Ta med recept från andra appar, webbplatser eller valfri AI.', to: '/einstellungen?tab=recipes' },
    ],
  },
  {
    id: '2026-10-10.3',
    title: { en: 'Dinner, spending, sign-in and more', de: 'Abendessen, Ausgaben, Anmeldung und mehr', sv: 'Middag, utgifter, inloggning och mer' },
    items: [
      { en: '“What do we eat today?” shows what works with what is at home – and can simply decide for you.', de: '„Was essen wir heute?“ zeigt, was mit dem Vorrat geht – und kann auch einfach für euch entscheiden.', sv: '”Vad äter vi i dag?” visar vad som går med det som finns hemma – och kan bestämma åt er.', to: '/kochen' },
      { en: 'Your own way of cooking: rice instead of potatoes? Save it once – suggestions and shopping follow your version.', de: 'Eure eigene Art zu kochen: Reis statt Kartoffeln? Einmal speichern – Vorschläge und Einkauf richten sich danach.', sv: 'Ert eget sätt att laga mat: ris i stället för potatis? Spara en gång – förslag och inköp följer er version.', to: '/kochen' },
      { en: 'Spending with charts for week, month, year and all time, budgets and items you can leave out.', de: 'Ausgaben mit Diagrammen für Woche, Monat, Jahr und gesamt, Budgets und Posten, die nicht mitzählen.', sv: 'Utgifter med diagram för vecka, månad, år och totalt, budgetar och poster som inte räknas.', to: '/ausgaben' },
      { en: 'Sign in with a passkey, an e-mail link or your own single sign-on.', de: 'Anmelden per Passkey, E-Mail-Link oder eigenem Single Sign-on.', sv: 'Logga in med passkey, e-postlänk eller egen single sign-on.', to: '/einstellungen?tab=account' },
      { en: 'Receipt-style tickets: print shopping lists, kitchen orders and care tasks on a thermal printer or send them.', de: 'Bons zum Ausdrucken: Einkaufszettel, Küchenbons und Pflege-Aufgaben auf dem Bondrucker oder digital verschicken.', sv: 'Kvitton att skriva ut: inköpslistor, köksorder och skötseluppgifter på kvittoskrivare eller skicka dem.', to: '/einstellungen?tab=print' },
      { en: 'Telegram: add things to the list by message, get notifications with buttons.', de: 'Telegram: Sachen per Nachricht auf die Liste setzen, Benachrichtigungen mit Knöpfen.', sv: 'Telegram: lägg till saker på listan via meddelande, få aviseringar med knappar.' },
      { en: 'A real Home Assistant integration with sensors, to-do list, calendars and dashboards – and the Cookidoo week comes in by itself.', de: 'Eine richtige Home-Assistant-Integration mit Sensoren, To-do-Liste, Kalendern und Dashboards – und die Cookidoo-Woche kommt von selbst.', sv: 'En riktig Home Assistant-integration med sensorer, att göra-lista, kalendrar och dashboards – och Cookidoo-veckan kommer av sig själv.' },
      { en: 'Svenska! And receipts from the UK, the US and Sweden.', de: 'Svenska! Und Bons aus Großbritannien, den USA und Schweden.', sv: 'Svenska! Och kvitton från Storbritannien, USA och Sverige.' },
    ],
  },
  {
    id: '2026-10-10.2',
    title: { en: 'Easier to get started', de: 'Leichter loslegen', sv: 'Enklare att komma igång' },
    items: [
      {
        en: 'A short setup for new households: name, rooms, invite your partner, first stock – each step can be skipped.',
        de: 'Ein kurzer Start für neue Haushalte: Name, Räume, Partner einladen, erster Bestand – jeder Schritt lässt sich überspringen.',
        sv: 'En kort start för nya hushåll: namn, rum, bjud in din partner, första lagret – varje steg går att hoppa över.',
      },
      {
        en: 'Typical staples per room with one tap – pasta, rice, toilet paper, dishwasher tabs … with a rough fill level instead of counting.',
        de: 'Typische Vorräte pro Raum mit einem Tipp – Nudeln, Reis, Klopapier, Spülmaschinentabs … mit grobem Füllstand statt Zählen.',
        sv: 'Vanliga basvaror per rum med ett tryck – pasta, ris, toapapper, diskmaskinstabletter … med ungefärlig nivå i stället för att räkna.',
        to: '/bestand',
      },
      { en: 'Help with short how-tos: phone home screen and push, Claude, Home Assistant, guests, backups.', de: 'Hilfe mit kurzen Anleitungen: Handy-Startbildschirm und Push, Claude, Home Assistant, Gäste, Backups.',
        sv: 'Hjälp med korta guider: mobilens hemskärm och push, Claude, Home Assistant, gäster, säkerhetskopior.', to: '/hilfe' },
      { en: 'The menu is sorted into groups, so everything is easy to find on the phone.', de: 'Das Menü ist in Gruppen sortiert, damit du auf dem Handy alles schnell findest.', sv: 'Menyn är sorterad i grupper, så att du snabbt hittar allt i mobilen.' },
      { en: 'Kid mode: children order with pictures, a parent says yes or no.', de: 'Kindermodus: Kinder bestellen mit Bildern, ein Elternteil sagt ja oder nein.', sv: 'Barnläge: barnen beställer med bilder, en förälder säger ja eller nej.' },
      { en: 'A calm kitchen display for a tablet or e-ink screen on the wall.', de: 'Eine ruhige Küchenanzeige für ein Tablet oder einen E-Ink-Bildschirm an der Wand.', sv: 'En lugn köksskärm för en surfplatta eller en e-bläckskärm på väggen.' },
      { en: 'More shops for receipts, and “use by” is told apart from “best before”.', de: 'Mehr Läden für Kassenbons, und „zu verbrauchen bis“ wird von „mindestens haltbar bis“ unterschieden.', sv: 'Fler butiker för kvitton, och ”sista förbrukningsdag” skiljs från ”bäst före”.' },
    ],
  },
  {
    id: '2026-10-10',
    title: { en: 'Party, fresher stock, store mode', de: 'Party, frischerer Bestand, Einkaufsmodus', sv: 'Fest, fräschare lager, butiksläge' },
    items: [
      { en: 'Party mode: a menu for guests, a QR code on the TV and a kitchen view for the orders.', de: 'Partymodus: eine Karte für Gäste, ein QR-Code auf dem Fernseher und eine Küchenansicht für die Bestellungen.',
        sv: 'Festläge: en meny för gästerna, en QR-kod på tv:n och en köksvy för beställningarna.', to: '/bar' },
      { en: '“Eat me first” on Today, opened and frozen items with their own shelf life, and leftovers after cooking.', de: '„Zuerst essen“ auf Heute, geöffnete und eingefrorene Sachen mit eigener Haltbarkeit und Reste nach dem Kochen.',
        sv: '”Ät först” på Idag, öppnade och frysta varor med egen hållbarhet och rester efter matlagningen.', to: '/' },
      { en: 'Quick check: go through one place in a minute – right, less, empty, gone.', de: 'Schnell-Check: einen Ort in einer Minute durchgehen – stimmt, weniger, leer, weg.',
        sv: 'Snabbkoll: gå igenom en plats på en minut – stämmer, mindre, tomt, borta.', to: '/abgleich' },
      { en: 'Store mode for the shopping list: sorted by aisle, works offline, “I’ll get it”, push to your phone.', de: 'Einkaufsmodus für die Liste: nach Gängen sortiert, funktioniert offline, „Ich hol das“, Push aufs Handy.',
        sv: 'Butiksläge för listan: sorterad efter gångar, fungerar offline, ”Jag fixar det”, push till mobilen.', to: '/einkauf' },
      { en: 'Home care: water filter, smoke detectors, descaling – reminded on time, done with one tap.', de: 'Haus & Pflege: Wasserfilter, Rauchmelder, Entkalken – rechtzeitig erinnert, mit einem Tipp erledigt.',
        sv: 'Hem & skötsel: vattenfilter, brandvarnare, avkalkning – påminnelse i tid, klart med ett tryck.', to: '/pflege' },
      { en: 'Spending per month from your receipts, and QR labels for shelves and boxes.', de: 'Ausgaben pro Monat aus deinen Kassenbons und QR-Etiketten für Regale und Kisten.',
        sv: 'Utgifter per månad från dina kvitton och QR-etiketter för hyllor och lådor.', to: '/ausgaben' },
      { en: 'Invite links: whoever joins picks their own password. Plus nightly backups you can restore.', de: 'Einladungslinks: Wer dazukommt, wählt das Passwort selbst. Dazu nächtliche Backups zum Wiederherstellen.', sv: 'Inbjudningslänkar: den som går med väljer sitt eget lösenord. Plus nattliga säkerhetskopior som du kan återställa.' },
    ],
  },
];

export const latestChange = () => CHANGELOG[0]?.id ?? '';

/** Entries newer than `seen` (all when nothing was seen yet), newest first, at most `max`. */
export function unseenChanges(seen: string | null | undefined, max = 2) {
  return CHANGELOG.filter((e) => !seen || e.id > seen).slice(0, max);
}
