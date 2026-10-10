export const sv_retail: Record<string, string> = {
  Receipt: 'Kvitto',
  'PDF format not recognised (supported: REWE notices and eBons, receipts from most German supermarkets and drugstores).':
    'PDF-formatet känns inte igen (stöds: REWE-besked och e-kvitton, kvitton från de flesta tyska livsmedelsbutiker och drogerier).',
  // inbox
  'Login failed. Check the user name and password – many providers (Gmail, GMX, web.de, Outlook) need an app password for this.':
    'Inloggningen misslyckades. Kontrollera användarnamn och lösenord – många leverantörer (Gmail, GMX, web.de, Outlook) kräver ett applösenord för det här.',
  'The mail server “{host}” could not be found. Check the server name.': 'E-postservern ”{host}” hittades inte. Kontrollera servernamnet.',
  'No connection to the mail server. Check server name and port (usually 993 with TLS).': 'Ingen anslutning till e-postservern. Kontrollera servernamn och port (oftast 993 med TLS).',
  'The secure connection failed (certificate or TLS). Check port and the TLS switch.': 'Den säkra anslutningen misslyckades (certifikat eller TLS). Kontrollera porten och TLS-reglaget.',
  'The folder “{folder}” does not exist in this mailbox.': 'Mappen ”{folder}” finns inte i den här brevlådan.',
  'The mailbox could not be read: {error}': 'Brevlådan kunde inte läsas: {error}',
  '{n} PDF attachment(s), but no receipt recognised.': '{n} PDF-bilaga/bilagor, men inget kvitto känt igen.',
  'No receipt found in this mail.': 'Inget kvitto hittades i det här mejlet.',
  '{n} attachment(s) could not be read.': '{n} bilaga/bilagor kunde inte läsas.',
  'The receipt inbox is not set up yet.': 'Kvittoinkorgen är inte inställd än.',
  'The receipt inbox is switched off.': 'Kvittoinkorgen är avstängd.',
  'Could not move the mail to “{folder}”.': 'Mejlet kunde inte flyttas till ”{folder}”.',
  'Checked – no new mails.': 'Kontrollerat – inga nya mejl.',
  '1 new receipt imported – waiting for your review.': '1 nytt kvitto importerat – väntar på din granskning.',
  '{n} new receipts imported – waiting for your review.': '{n} nya kvitton importerade – väntar på din granskning.',
  '{n} new mail(s), no new receipt in them.': '{n} nytt/nya mejl, men inget nytt kvitto i dem.',
  // best-before vs use-by
  '{name}: use-by date passed – please don’t eat it anymore': '{name}: sista förbrukningsdag har passerat – ät det inte längre',
  '{name}: past best-before – look, smell, taste; often still fine': '{name}: bäst före har passerat – titta, lukta, smaka; ofta fortfarande bra',
  '{product} – use by {date} ({qty} left).': '{product} – sista förbrukningsdag {date} ({qty} kvar).',
};
