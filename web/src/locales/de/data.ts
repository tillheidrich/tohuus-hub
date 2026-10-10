// German strings for members, invitations, backups & restore, guest-link security (area: data)
export const data: Record<string, string> = {
  // sizes
  '{n} KB': '{n} KB',
  '{n} MB': '{n} MB',

  // members
  'Only admins can invite people or change who belongs to the household.': 'Nur Admins können Leute einladen oder ändern, wer zum Haushalt gehört.',
  'Invite someone': 'Jemanden einladen',
  you: 'du',
  Admin: 'Admin',
  'Waiting for a reply': 'Warten auf Antwort',
  'For safety, an invitation link is only shown once. Lost it? Withdraw it and invite again.':
    'Aus Sicherheitsgründen wird ein Einladungslink nur einmal angezeigt. Verlegt? Zurückziehen und neu einladen.',
  'valid until {date}': 'gültig bis {date}',
  Withdraw: 'Zurückziehen',
  'Show names on the sign-in screen': 'Namen auf der Anmeldeseite zeigen',
  'Handy at home: tap your name, type your password. Turn it off if the app is reachable from the internet – then everyone types their name.':
    'Praktisch zu Hause: Namen antippen, Passwort eingeben. Schalt es aus, wenn die App aus dem Internet erreichbar ist – dann tippt jede:r den eigenen Namen.',
  'You get a personal link. Whoever opens it picks their own password – nobody has to pass passwords around. The link works once and for 7 days.':
    'Du bekommst einen persönlichen Link. Wer ihn öffnet, wählt das eigene Passwort – niemand muss Passwörter weitergeben. Der Link gilt einmal und 7 Tage lang.',
  'e.g. Lea': 'z. B. Lea',
  Role: 'Rolle',
  'Admins can also change settings, members and backups.': 'Admins können auch Einstellungen, Mitglieder und Sicherungen ändern.',
  'Members can use everything day to day, but not change settings.': 'Mitglieder können im Alltag alles nutzen, aber keine Einstellungen ändern.',
  'Creating …': 'Wird erstellt …',
  'Create invitation': 'Einladung erstellen',
  'Invitation for {name}': 'Einladung für {name}',
  'Copy link': 'Link kopieren',
  Invitation: 'Einladung',
  'Join our household app – set your own password here:': 'Komm in unsere Haushalts-App – hier legst du dein eigenes Passwort fest:',
  'Scan with the phone, or send the link. Valid until {date}, works once. It is shown only now.':
    'Mit dem Handy scannen oder den Link schicken. Gültig bis {date}, funktioniert einmal. Er wird nur jetzt angezeigt.',
  'Add with a password instead': 'Stattdessen mit Passwort anlegen',
  'e.g. for a shared kitchen tablet': 'z. B. für ein gemeinsames Küchen-Tablet',
  'Password (at least 8 characters)': 'Passwort (mindestens 8 Zeichen)',

  // invitation page
  'This link no longer works': 'Dieser Link funktioniert nicht mehr',
  'Invitation links work once and for 7 days. Ask whoever invited you for a new one.':
    'Einladungslinks gelten einmal und 7 Tage lang. Frag die Person, die dich eingeladen hat, nach einem neuen.',
  'To the sign-in page': 'Zur Anmeldung',
  'Welcome to {household}': 'Willkommen bei {household}',
  'You join as an admin. Choose your password – then you’re in.': 'Du kommst als Admin dazu. Wähl dein Passwort – dann bist du drin.',
  'Choose your password – then you’re in. You’ll stay signed in on this device.': 'Wähl dein Passwort – dann bist du drin. Auf diesem Gerät bleibst du angemeldet.',
  'Your name': 'Dein Name',
  'This is the name you sign in with.': 'Mit diesem Namen meldest du dich an.',
  'Hide password': 'Passwort verbergen',
  'Show password': 'Passwort zeigen',
  'At least 8 characters. A short sentence is easy to remember.': 'Mindestens 8 Zeichen. Ein kurzer Satz ist leicht zu merken.',
  'Repeat password': 'Passwort wiederholen',
  'The passwords don’t match yet.': 'Die Passwörter stimmen noch nicht überein.',
  'One moment …': 'Einen Moment …',
  Join: 'Loslegen',

  // backups
  'Data & backups': 'Daten & Sicherung',
  'Backed up here, but the off-site copy failed: {error}': 'Hier gesichert, aber die externe Kopie ist fehlgeschlagen: {error}',
  'Backed up – also copied off-site': 'Gesichert – auch extern abgelegt',
  'Backed up': 'Gesichert',
  'Last backup: {when}': 'Letzte Sicherung: {when}',
  'No backup yet': 'Noch keine Sicherung',
  'Automatically every night at {hour}:00. Keeps the last {daily} days and {weekly} weeks.':
    'Automatisch jede Nacht um {hour}:00 Uhr. Bewahrt die letzten {daily} Tage und {weekly} Wochen auf.',
  'Off-site copy: {when}': 'Externe Kopie: {when}',
  'Off-site copy failed {when}: {error}': 'Externe Kopie fehlgeschlagen ({when}): {error}',
  'Backing up …': 'Sichere …',
  'Back up now': 'Jetzt sichern',
  'Restored on {when} from “{source}”. The database it replaced is kept in the backups folder.':
    'Am {when} aus „{source}“ wiederhergestellt. Die ersetzte Datenbank liegt im Sicherungsordner.',
  Backups: 'Sicherungen',
  '{n} backups · {size}': '{n} Sicherungen · {size}',
  Download: 'Herunterladen',
  Restore: 'Wiederherstellen',
  nightly: 'nachts',
  'by hand': 'von Hand',
  'before a restore': 'vor einer Wiederherstellung',
  'The first backup is made tonight – or right now with “Back up now”.': 'Die erste Sicherung entsteht heute Nacht – oder sofort mit „Jetzt sichern“.',
  'Show fewer': 'Weniger zeigen',
  'Show all {n}': 'Alle {n} zeigen',
  'Restore from a file': 'Aus einer Datei wiederherstellen',
  'A backup file (.db) from here or another ToHuus Hub, or an export (.json). Everything currently stored is replaced – a safety backup is made first.':
    'Eine Sicherungsdatei (.db) von hier oder aus einem anderen ToHuus Hub, oder ein Export (.json). Alles, was jetzt gespeichert ist, wird ersetzt – vorher entsteht eine Sicherheitskopie.',
  'Choose file': 'Datei wählen',
  'Restore this backup?': 'Diese Sicherung wiederherstellen?',
  'Everything stored right now is replaced by this backup. Changes since then are lost – a safety backup of the current state is made first, so you can go back.':
    'Alles, was jetzt gespeichert ist, wird durch diese Sicherung ersetzt. Änderungen seitdem gehen verloren – vorher wird der aktuelle Stand gesichert, du kannst also zurück.',
  'The file is checked.': 'Die Datei wird geprüft.',
  'ToHuus Hub restarts and swaps the database (a few seconds).': 'ToHuus Hub startet neu und tauscht die Datenbank aus (ein paar Sekunden).',
  'The page reloads by itself. You may need to sign in again.': 'Die Seite lädt von selbst neu. Eventuell musst du dich neu anmelden.',
  'Checking …': 'Prüfe …',
  'Replace and restart': 'Ersetzen und neu starten',
  'Restoring …': 'Stelle wieder her …',
  'ToHuus Hub is restarting with the backup. This page reloads by itself.': 'ToHuus Hub startet mit der Sicherung neu. Die Seite lädt von selbst neu.',
  'Taking longer than usual. If nothing happens, restart the container (e.g. “docker compose restart”).':
    'Dauert länger als sonst. Wenn nichts passiert, starte den Container neu (z. B. „docker compose restart“).',
  'Connection works': 'Verbindung klappt',
  'Off-site copy (optional)': 'Externe Kopie (optional)',
  'If the server breaks, backups on the same disk break with it. ToHuus Hub can put a copy into a WebDAV folder every night, e.g. Nextcloud. One file per weekday – the folder always holds the last seven nights.':
    'Wenn der Server kaputtgeht, sind Sicherungen auf derselben Platte mit weg. ToHuus Hub kann jede Nacht eine Kopie in einen WebDAV-Ordner legen, z. B. Nextcloud. Eine Datei pro Wochentag – im Ordner liegen immer die letzten sieben Nächte.',
  'WebDAV folder address': 'Adresse des WebDAV-Ordners',
  'Nextcloud: Files › Settings (bottom left) › WebDAV, then add the folder name.': 'Nextcloud: Dateien › Einstellungen (unten links) › WebDAV, dann den Ordnernamen anhängen.',
  User: 'Benutzer',
  'App password': 'App-Passwort',
  'Use an app password (Nextcloud: Settings › Security), not your main password.': 'Nimm ein App-Passwort (Nextcloud: Einstellungen › Sicherheit), nicht dein Hauptpasswort.',
  'Save & test': 'Speichern & testen',
  'Turn off': 'Ausschalten',
  'Everything as JSON – your data belongs to you. Passwords and access keys are never included.':
    'Alles als JSON – deine Daten gehören dir. Passwörter und Zugangsschlüssel sind nie enthalten.',

  // guest links
  'A link without expiry keeps working until you revoke it – also if it is forwarded. Create it anyway?':
    'Ein Link ohne Ablaufdatum funktioniert, bis du ihn widerrufst – auch wenn er weitergeleitet wird. Trotzdem erstellen?',
  'The current link for “{name}” stops working. Create a new one?': 'Der bisherige Link für „{name}“ funktioniert dann nicht mehr. Neuen erstellen?',
  'New link': 'Neuer Link',
};
