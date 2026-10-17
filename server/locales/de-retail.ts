export const de_retail: Record<string, string> = {
  Receipt: 'Kassenbon',
  'PDF format not recognised (supported: REWE notices and eBons, receipts from most German supermarkets and drugstores).':
    'PDF-Format nicht erkannt (unterstützt: REWE-Avise und eBons sowie Bons der meisten deutschen Supermärkte und Drogerien).',
  // inbox
  'Login failed. Check the user name and password – many providers (Gmail, GMX, web.de, Outlook) need an app password for this.':
    'Anmeldung fehlgeschlagen. Prüf Benutzername und Passwort – viele Anbieter (Gmail, GMX, web.de, Outlook) brauchen dafür ein App-Passwort.',
  'The mail server “{host}” could not be found. Check the server name.': 'Der Mailserver „{host}“ wurde nicht gefunden. Prüf den Servernamen.',
  'No connection to the mail server. Check server name and port (usually 993 with TLS).': 'Keine Verbindung zum Mailserver. Prüf Servername und Port (meist 993 mit TLS).',
  'The secure connection failed (certificate or TLS). Check port and the TLS switch.': 'Die sichere Verbindung hat nicht geklappt (Zertifikat oder TLS). Prüf den Port und den TLS-Schalter.',
  'The folder “{folder}” does not exist in this mailbox.': 'Den Ordner „{folder}“ gibt es in diesem Postfach nicht.',
  'The mailbox could not be read: {error}': 'Das Postfach konnte nicht gelesen werden: {error}',
  '{n} PDF attachment(s), but no receipt recognised.': '{n} PDF-Anhang/Anhänge, aber kein Bon erkannt.',
  'No receipt found in this mail.': 'In dieser Mail wurde kein Bon gefunden.',
  '{n} attachment(s) could not be read.': '{n} Anhang/Anhänge konnten nicht gelesen werden.',
  'The receipt inbox is not set up yet.': 'Das Bon-Postfach ist noch nicht eingerichtet.',
  'The receipt inbox is switched off.': 'Das Bon-Postfach ist ausgeschaltet.',
  'Could not move the mail to “{folder}”.': 'Die Mail konnte nicht nach „{folder}“ verschoben werden.',
  'Checked – no new mails.': 'Geprüft – keine neuen Mails.',
  '1 new receipt imported – waiting for your review.': '1 neuer Bon importiert – wartet auf deine Prüfung.',
  '{n} new receipts imported – waiting for your review.': '{n} neue Bons importiert – warten auf deine Prüfung.',
  '{n} new mail(s), no new receipt in them.': '{n} neue Mail(s), aber kein neuer Bon darin.',
  // best-before vs use-by
  '{name}: use-by date passed – please don’t eat it anymore': '{name}: Verbrauchsdatum vorbei – bitte nicht mehr essen',
  '{name}: past best-before – look, smell, taste; often still fine': '{name}: MHD vorbei – anschauen, riechen, probieren; oft noch gut',
  '{product} – use by {date} ({qty} left).': '{product} – zu verbrauchen bis {date} ({qty} da).',
  // receipts: reading, pasting, changing a booked one (18.10.2026)
  'The receipt could not be read right now (AI busy, text recognition found no receipt lines). Try again in a few minutes, or upload the receipt as a PDF.':
    'Der Bon ließ sich gerade nicht lesen (KI ausgelastet, die Texterkennung hat keine Bon-Zeilen gefunden). Versuch es in ein paar Minuten noch mal oder lade den Bon als PDF hoch.',
  'This looks like a receipt, but ToHuus could not read it. Share or upload the receipt as a PDF or a photo instead.':
    'Das sieht nach einem Kassenbon aus, ToHuus konnte ihn aber nicht lesen. Teil oder lade den Bon lieber als PDF oder Foto hoch.',
  'That is {n} lines – too many for one list. Paste up to {max} things, one per line. A receipt is best shared as a PDF or a photo.':
    'Das sind {n} Zeilen – zu viele für eine Liste. Füg bis zu {max} Sachen ein, eine pro Zeile. Einen Kassenbon teilst du am besten als PDF oder Foto.',
  'Nothing found to match.': 'Nichts gefunden, was sich zuordnen lässt.',
  'Open the receipt for changes first.': 'Öffne den Bon zuerst zum Ändern.',
  'added by hand': 'von Hand ergänzt',
  'Invalid date': 'Ungültiges Datum',
};
