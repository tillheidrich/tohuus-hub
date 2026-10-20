// Einstellungen in sechs Seiten (UX-Audit 2026-10, Paket C): Seiten, Zeilen, Suche, neue Wege in Hilfe-Texten.
export const settings: Record<string, string> = {
  // Seiten
  'Calm & focus, your bar, how it looks, signing in': 'Ruhe & Fokus, deine Leiste, Darstellung, Anmeldung',
  'Name, language, who lives here, how you cook': 'Name, Sprache, wer hier wohnt, wie ihr kocht',
  'Areas & places': 'Bereiche & Orte',
  'What you use, places, pantry, recipes': 'Was ihr nutzt, Orte, Vorrat, Rezepte',
  'Notifications & calendar': 'Mitteilungen & Kalender',
  'What reaches you, and your calendar': 'Was dich erreicht, und dein Kalender',
  'Connections & devices': 'Verbindungen & Geräte',
  'AI, Home Assistant, displays, printers': 'KI, Home Assistant, Displays, Drucker',
  'Data, plan & account': 'Daten, Abo & Konto',
  'Plan, backups, export, reset': 'Abo, Sicherung, Export, Zurücksetzen',
  // Zeilen
  AI: 'KI',
  'Gentle mode, Just one, how much Today shows': 'Sanfter Modus, Nur eins, wie viel Heute zeigt',
  'Name, picture & taste': 'Name, Bild & Geschmack',
  'How the others see you, what you like, allergies': 'Wie die anderen dich sehen, was du magst, Allergien',
  'Which areas sit at the bottom': 'Welche Bereiche unten stehen',
  'Appearance & readability': 'Darstellung & Lesbarkeit',
  'Light or dark, text size, how the list looks': 'Hell oder dunkel, Schrift, wie die Liste aussieht',
  'Sign-in & security': 'Anmeldung & Sicherheit',
  'Password, passkeys, e-mail, devices': 'Passwort, Passkeys, E-Mail, Geräte',
  'Name & language': 'Name & Sprache',
  'Who lives here?': 'Wer wohnt hier?',
  'People, children, guests, invitations': 'Leute, Kinder, Gäste, Einladungen',
  'Region & currency': 'Region & Währung',
  'Passkeys, e-mail links, passwords, single sign-on': 'Passkeys, Mail-Link, Passwort, Single Sign-on',
  'Thermomix, how much time, what you avoid': 'Thermomix, wie viel Zeit, was ihr nicht esst',
  Lunchbox: 'Brotdose',
  'Question of the week': 'Wochenfrage',
  'Line under shared lists': 'Zeile unter geteilten Listen',
  'Switch off what you don’t need': 'Schalt ab, was ihr nicht braucht',
  'Fridge, cellar, shelves': 'Kühlschrank, Keller, Regale',
  'Pantry: what to track?': 'Vorrat: was verfolgen?',
  'Everything, or only what runs out': 'Alles, oder nur was ausgeht',
  'Recipes & imports': 'Rezepte & Importe',
  'From websites, apps and Cookidoo': 'Aus Webseiten, Apps und Cookidoo',
  'Bring me something: menu': 'Bring mir was: Karte',
  'Trip & handover': 'Urlaub & Übergabe',
  'What reaches you': 'Was dich erreicht',
  'On this phone or browser, only for you': 'Auf diesem Handy oder Browser, nur für dich',
  'For the whole household': 'Für den ganzen Haushalt',
  'Home Assistant, ntfy, e-mail, Telegram': 'Home Assistant, ntfy, E-Mail, Telegram',
  'Read your calendar': 'Euren Kalender lesen',
  'Bin dates and appointments from your calendar': 'Müll- und andere Termine aus eurem Kalender',
  'Reminders & calendar': 'Erinnerungen & Kalender',
  'Tasks in Apple Reminders or your calendar app': 'Aufgaben in Apple Erinnerungen oder deiner Kalender-App',
  'Calendar subscription': 'Kalender-Abo',
  'A link your calendar app can subscribe to': 'Ein Link, den deine Kalender-App abonniert',
  'Hint in the shop': 'Hinweis im Laden',
  'On or off, and what it may see': 'An oder aus, und was sie sehen darf',
  'AI assistants & access': 'KI-Assistenten & Zugänge',
  'Claude, ChatGPT, scripts (MCP)': 'Claude, ChatGPT, Skripte (MCP)',
  'Displays & family tablet': 'Displays & Familien-Tablet',
  'Print lists and notes on a receipt printer': 'Listen und Zettel auf dem Bondrucker',
  'Share from other apps': 'Teilen aus anderen Apps',
  'Shortcuts, links and e-receipts': 'Kurzbefehle, Links und E-Bons',
  'Receipts by e-mail': 'Bons per E-Mail',
  'Servers & households': 'Server & Haushalte',
  'Your plan, the assistant this month, storage': 'Dein Abo, der Assistent diesen Monat, Speicher',
  'Export, backups, move, purchase history': 'Export, Sicherungen, Umzug, Kaufhistorie',
  'Sample data, clear areas, start over': 'Beispieldaten, Bereiche leeren, neu anfangen',
  'Your data & account': 'Deine Daten & Konto',
  'Download everything, or delete the account': 'Alles herunterladen, oder das Konto löschen',
  // Rahmen
  'Find a setting': 'Einstellung finden',
  'Clear search': 'Suche leeren',
  'Nothing found. Try another word, or ask the assistant.': 'Nichts gefunden. Probier ein anderes Wort, oder frag den Assistenten.',
  'More options': 'Mehr Optionen',
  'Settings & help': 'Einstellungen & Hilfe',
  'For everyone in the household': 'Für alle im Haushalt',
  'Own server – everything included': 'Eigener Server – alles inklusive',
  'Your household runs on your own server. Every function is there, nothing to pay.': 'Euer Haushalt läuft auf eurem eigenen Server. Alles ist dabei, nichts zu bezahlen.',
  'Backups: ToHuus Cloud saves your household every night, encrypted, also outside the data centre. You can download everything at any time under Data, plan & account › Your data & account.':
    'Sicherungen: Die ToHuus Cloud sichert euren Haushalt jede Nacht, verschlüsselt, auch außerhalb des Rechenzentrums. Unter Daten, Abo & Konto › Deine Daten & Konto könnt ihr jederzeit alles herunterladen.',
  // Hilfe: neue Wege
  'Settings › Notifications & calendar › “Push on this device”. On iPhone this only works from the home-screen icon.':
    'Einstellungen › Mitteilungen & Kalender › „Push auf diesem Gerät“. Auf dem iPhone geht das nur über das Symbol auf dem Startbildschirm.',
  'Settings › Me › Appearance & readability: Light, Dark or “Like the device” (follows each phone’s setting). Admins set it for everyone further down.':
    'Einstellungen › Ich › Darstellung & Lesbarkeit: Hell, Dunkel oder „Wie das Gerät“ (folgt der Einstellung des Handys). Admins legen es weiter unten für alle fest.',
  'Switch on “Let everyone choose for themselves” and each member picks their own there.': 'Schalt „Jede und jeder darf selbst wählen“ ein, dann wählt dort jedes Mitglied selbst.',
  'Open appearance': 'Darstellung öffnen',
  'It sees the list, tasks, recipes and household knowledge by the same rules as you – never house info codes. Settings › Connections & devices › AI assistants & access lists every connection; end one there and it stops at once.':
    'Er sieht Liste, Aufgaben, Rezepte und Wissen nach denselben Regeln wie du, nie die Codes aus der Hausinfo. Einstellungen › Verbindungen & Geräte › KI-Assistenten & Zugänge zeigt jede Verbindung; beendest du sie dort, ist sofort Schluss.',
  'Settings › Connections & devices › AI assistants & access › “Home Assistant” – copy the token.':
    'Einstellungen › Verbindungen & Geräte › KI-Assistenten & Zugänge › „Home Assistant“, dann den Schlüssel kopieren.',
  'Already using another list app, Mealie or the HA app for some of this? Settings › Connections & devices › Home Assistant shows what Home Assistant already does and keeps it in step – take over the suggestions with one tap.':
    'Nutzt ihr dafür schon eine andere Listen-App, Mealie oder die HA-App? Einstellungen › Verbindungen & Geräte › Home Assistant zeigt, was Home Assistant schon erledigt, und hält beides gleich. Die Vorschläge übernimmst du mit einem Tipp.',
  'Open Home Assistant settings': 'Home Assistant öffnen',
  'Voice commands for the babysitter (lights, blinds, music – never locks or cameras): Settings › Connections & devices › Home Assistant › Voice commands. They show on babysitter and house-sitter links; switch them off per link if you like.':
    'Sprachbefehle für den Babysitter (Licht, Rollos, Musik, nie Schlösser oder Kameras): Einstellungen › Verbindungen & Geräte › Home Assistant › Sprachbefehle. Sie stehen auf Babysitter- und Haushüter-Links; pro Link kannst du sie abschalten.',
  'Bring me something › “Edit menu” (also in Settings › Areas & places).': 'Bring mir was › „Karte bearbeiten“ (auch unter Einstellungen › Bereiche & Orte).',
  'Settings › Household › Who lives here?: tap a person for a photo (crop it square, or take one), an animal or initials, and what they like, don’t like and are allergic to.':
    'Einstellungen › Haushalt › Wer wohnt hier?: Tipp eine Person an, für ein Foto (quadratisch zuschneiden oder neu aufnehmen), ein Tier oder Initialen, und was sie mag, nicht mag und nicht verträgt.',
  'iPhone: iOS doesn’t offer the share menu to web apps. Settings › Connections & devices › Share from other apps › “Create a key for the iPhone shortcut” – the steps are shown right there.':
    'iPhone: iOS bietet Web-Apps das Teilen-Menü nicht an. Einstellungen › Verbindungen & Geräte › Teilen aus anderen Apps › „Schlüssel für den iPhone-Kurzbefehl erstellen“, die Schritte stehen direkt dabei.',
  'Settings › Areas & places › Pantry: what to track? › “Only what runs out”, then tap your staples.':
    'Einstellungen › Bereiche & Orte › Vorrat: was verfolgen? › „Nur was ausgeht“, dann deine Grundsachen antippen.',
  'Open pantry settings': 'Vorrat-Einstellungen öffnen',
  'Settings › Data, plan & account › Data & backups: download a backup, or restore one with a tap.':
    'Einstellungen › Daten, Abo & Konto › Daten & Sicherung: eine Sicherung herunterladen oder mit einem Tipp zurückholen.',
  'Settings › Areas & places › Recipes & imports › “Import from another app”: choose the export file, check the preview, import.':
    'Einstellungen › Bereiche & Orte › Rezepte & Importe › „Aus einer anderen App importieren“: Exportdatei wählen, Vorschau prüfen, importieren.',
  'Got a receipt printer? Add it under Settings › Connections & devices › Printers – until then, share or print from the browser.':
    'Ihr habt einen Bondrucker? Leg ihn unter Einstellungen › Verbindungen & Geräte › Drucker an. Bis dahin teilen oder aus dem Browser drucken.',
  'Private tasks only appear when you choose so, and only your own: in Apple Calendar in “ToHuus · Mein Kalender”, which only you see; in a subscription link only if you switch on “Include my private tasks” when you create it; on the iPhone in the calendar you pick for them. Both links are under Settings › Notifications & calendar.':
    'Private Aufgaben erscheinen nur, wenn du das willst, und nur deine eigenen: im Apple-Kalender in „ToHuus · Mein Kalender“, den nur du siehst; in einem Abo-Link nur, wenn du beim Erstellen „Meine privaten Aufgaben mitnehmen“ einschaltest; auf dem iPhone in dem Kalender, den du dafür wählst. Beide Links stehen unter Einstellungen › Mitteilungen & Kalender.',
};
