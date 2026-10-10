// Swedish strings for members, invitations, backups & restore, guest-link security (area: data)
export const data: Record<string, string> = {
  // sizes
  '{n} KB': '{n} kB',
  '{n} MB': '{n} MB',

  // members
  'Only admins can invite people or change who belongs to the household.': 'Bara administratörer kan bjuda in folk eller ändra vem som hör till hushållet.',
  'Invite someone': 'Bjud in någon',
  you: 'du',
  Admin: 'Admin',
  'Waiting for a reply': 'Väntar på svar',
  'For safety, an invitation link is only shown once. Lost it? Withdraw it and invite again.':
    'Av säkerhetsskäl visas en inbjudningslänk bara en gång. Tappat bort den? Dra tillbaka den och bjud in igen.',
  'valid until {date}': 'giltig till {date}',
  Withdraw: 'Dra tillbaka',
  'Show names on the sign-in screen': 'Visa namn på inloggningssidan',
  'Handy at home: tap your name, type your password. Turn it off if the app is reachable from the internet – then everyone types their name.':
    'Smidigt hemma: tryck på ditt namn, skriv lösenordet. Stäng av om appen går att nå från internet – då skriver alla in sitt namn.',
  'You get a personal link. Whoever opens it picks their own password – nobody has to pass passwords around. The link works once and for 7 days.':
    'Du får en personlig länk. Den som öppnar den väljer sitt eget lösenord – ingen behöver skicka lösenord vidare. Länken fungerar en gång och i 7 dagar.',
  'e.g. Lea': 't.ex. Lea',
  Role: 'Roll',
  'Admins can also change settings, members and backups.': 'Administratörer kan också ändra inställningar, medlemmar och säkerhetskopior.',
  'Members can use everything day to day, but not change settings.': 'Medlemmar kan använda allt i vardagen, men inte ändra inställningar.',
  'Creating …': 'Skapar …',
  'Create invitation': 'Skapa inbjudan',
  'Invitation for {name}': 'Inbjudan till {name}',
  'Copy link': 'Kopiera länk',
  Invitation: 'Inbjudan',
  'Join our household app – set your own password here:': 'Gå med i vår hushållsapp – här väljer du ditt eget lösenord:',
  'Scan with the phone, or send the link. Valid until {date}, works once. It is shown only now.':
    'Skanna med mobilen eller skicka länken. Giltig till {date}, fungerar en gång. Den visas bara nu.',
  'Add with a password instead': 'Lägg till med lösenord i stället',
  'e.g. for a shared kitchen tablet': 't.ex. för en gemensam surfplatta i köket',
  'Password (at least 8 characters)': 'Lösenord (minst 8 tecken)',

  // invitation page
  'This link no longer works': 'Den här länken fungerar inte längre',
  'Invitation links work once and for 7 days. Ask whoever invited you for a new one.':
    'Inbjudningslänkar fungerar en gång och i 7 dagar. Be den som bjöd in dig om en ny.',
  'To the sign-in page': 'Till inloggningen',
  'Welcome to {household}': 'Välkommen till {household}',
  'You join as an admin. Choose your password – then you’re in.': 'Du går med som admin. Välj ditt lösenord – sedan är du inne.',
  'Choose your password – then you’re in. You’ll stay signed in on this device.': 'Välj ditt lösenord – sedan är du inne. Du förblir inloggad på den här enheten.',
  'Your name': 'Ditt namn',
  'This is the name you sign in with.': 'Det är namnet du loggar in med.',
  'Hide password': 'Dölj lösenord',
  'Show password': 'Visa lösenord',
  'At least 8 characters. A short sentence is easy to remember.': 'Minst 8 tecken. En kort mening är lätt att komma ihåg.',
  'Repeat password': 'Upprepa lösenordet',
  'The passwords don’t match yet.': 'Lösenorden stämmer inte överens än.',
  'One moment …': 'Ett ögonblick …',
  Join: 'Gå med',

  // backups
  'Data & backups': 'Data & säkerhetskopior',
  'Backed up here, but the off-site copy failed: {error}': 'Säkerhetskopierat här, men den externa kopian misslyckades: {error}',
  'Backed up – also copied off-site': 'Säkerhetskopierat – även externt',
  'Backed up': 'Säkerhetskopierat',
  'Last backup: {when}': 'Senaste säkerhetskopia: {when}',
  'No backup yet': 'Ingen säkerhetskopia än',
  'Automatically every night at {hour}:00. Keeps the last {daily} days and {weekly} weeks.':
    'Automatiskt varje natt kl. {hour}:00. Sparar de senaste {daily} dagarna och {weekly} veckorna.',
  'Off-site copy: {when}': 'Extern kopia: {when}',
  'Off-site copy failed {when}: {error}': 'Extern kopia misslyckades ({when}): {error}',
  'Backing up …': 'Säkerhetskopierar …',
  'Back up now': 'Säkerhetskopiera nu',
  'Restored on {when} from “{source}”. The database it replaced is kept in the backups folder.':
    'Återställd {when} från ”{source}”. Databasen som ersattes ligger kvar i mappen för säkerhetskopior.',
  Backups: 'Säkerhetskopior',
  '{n} backups · {size}': '{n} säkerhetskopior · {size}',
  Download: 'Ladda ner',
  Restore: 'Återställ',
  nightly: 'nattlig',
  'by hand': 'manuell',
  'before a restore': 'före en återställning',
  'The first backup is made tonight – or right now with “Back up now”.': 'Den första säkerhetskopian görs i natt – eller direkt med ”Säkerhetskopiera nu”.',
  'Show fewer': 'Visa färre',
  'Show all {n}': 'Visa alla {n}',
  'Restore from a file': 'Återställ från en fil',
  'A backup file (.db) from here or another ToHuus Hub, or an export (.json). Everything currently stored is replaced – a safety backup is made first.':
    'En säkerhetskopia (.db) härifrån eller från en annan ToHuus Hub, eller en export (.json). Allt som är sparat nu ersätts – en säkerhetskopia görs först.',
  'Choose file': 'Välj fil',
  'Restore this backup?': 'Återställa den här säkerhetskopian?',
  'Everything stored right now is replaced by this backup. Changes since then are lost – a safety backup of the current state is made first, so you can go back.':
    'Allt som är sparat just nu ersätts av den här säkerhetskopian. Ändringar sedan dess försvinner – nuvarande läge säkerhetskopieras först, så du kan gå tillbaka.',
  'The file is checked.': 'Filen kontrolleras.',
  'ToHuus Hub restarts and swaps the database (a few seconds).': 'ToHuus Hub startar om och byter databas (några sekunder).',
  'The page reloads by itself. You may need to sign in again.': 'Sidan laddas om av sig själv. Du kan behöva logga in igen.',
  'Checking …': 'Kontrollerar …',
  'Replace and restart': 'Ersätt och starta om',
  'Restoring …': 'Återställer …',
  'ToHuus Hub is restarting with the backup. This page reloads by itself.': 'ToHuus Hub startar om med säkerhetskopian. Sidan laddas om av sig själv.',
  'Taking longer than usual. If nothing happens, restart the container (e.g. “docker compose restart”).':
    'Det tar längre tid än vanligt. Om inget händer, starta om containern (t.ex. ”docker compose restart”).',
  'Connection works': 'Anslutningen fungerar',
  'Off-site copy (optional)': 'Extern kopia (valfritt)',
  'If the server breaks, backups on the same disk break with it. ToHuus Hub can put a copy into a WebDAV folder every night, e.g. Nextcloud. One file per weekday – the folder always holds the last seven nights.':
    'Om servern går sönder följer säkerhetskopiorna på samma disk med. ToHuus Hub kan lägga en kopia i en WebDAV-mapp varje natt, t.ex. Nextcloud. En fil per veckodag – mappen innehåller alltid de senaste sju nätterna.',
  'WebDAV folder address': 'Adress till WebDAV-mappen',
  'Nextcloud: Files › Settings (bottom left) › WebDAV, then add the folder name.': 'Nextcloud: Filer › Inställningar (nere till vänster) › WebDAV, lägg sedan till mappnamnet.',
  User: 'Användare',
  'App password': 'Applösenord',
  'Use an app password (Nextcloud: Settings › Security), not your main password.': 'Använd ett applösenord (Nextcloud: Inställningar › Säkerhet), inte ditt huvudlösenord.',
  'Save & test': 'Spara & testa',
  'Turn off': 'Stäng av',
  'Everything as JSON – your data belongs to you. Passwords and access keys are never included.':
    'Allt som JSON – din data tillhör dig. Lösenord och åtkomstnycklar följer aldrig med.',

  // guest links
  'A link without expiry keeps working until you revoke it – also if it is forwarded. Create it anyway?':
    'En länk utan slutdatum fungerar tills du återkallar den – även om den skickas vidare. Skapa den ändå?',
  'The current link for “{name}” stops working. Create a new one?': 'Den nuvarande länken för ”{name}” slutar fungera. Skapa en ny?',
  'New link': 'Ny länk',
};
