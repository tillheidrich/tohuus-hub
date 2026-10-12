/** German strings of branch b-core: AI switches, OCR, OAuth for MCP, account mails, operator page, cloud move. */
export const de_core: Record<string, string> = {
  // AI switches (ai.ts, ai-policy.ts)
  'AI was switched off by your parents.': 'KI wurde von deinen Eltern ausgeschaltet.',
  'You switched AI off for yourself (Settings › Access & AI).': 'Du hast KI für dich ausgeschaltet (Einstellungen › Zugang & KI).',
  'AI is switched off for this household (Settings › Access & AI).': 'KI ist in diesem Haushalt ausgeschaltet (Einstellungen › Zugang & KI).',
  'AI is off – I understand simple sentences like “milk is out and 2 peppers”.': 'KI ist aus – ich verstehe einfache Sätze wie „Milch ist alle und 2 Paprika“.',

  // text recognition (ocr.ts, receipt-read.ts)
  'Text recognition is busy, please try again in a moment.': 'Die Texterkennung ist gerade beschäftigt. Versuch es bitte gleich noch mal.',
  'This image could not be read.': 'Dieses Bild konnte nicht gelesen werden.',
  'Text recognition took too long.': 'Die Texterkennung hat zu lange gebraucht.',
  'Text recognition is not installed on this server.': 'Auf diesem Server ist keine Texterkennung installiert.',
  'Text recognition failed.': 'Die Texterkennung hat nicht geklappt.',
  'Receipt (photo)': 'Bon (Foto)',
  'Deposit for: {name}': 'Pfand für: {name}',
  'Read unclearly – please check': 'Unscharf gelesen – bitte prüfen',
  'Photos cannot be read on this server (no text recognition, no AI). Upload the PDF, or type the items.':
    'Fotos kann dieser Server nicht lesen (keine Texterkennung, keine KI). Lad das PDF hoch oder tipp die Sachen ab.',
  'No receipt lines were recognised in the photo. A sharper photo in good light, flat and straight, helps.':
    'Auf dem Foto wurden keine Bonzeilen erkannt. Ein schärferes Foto bei gutem Licht, glatt und gerade, hilft.',

  // OAuth for MCP (routes/oauth.ts, account-mail.ts)
  Allow: 'Erlauben',
  Cancel: 'Abbrechen',
  Allowed: 'Erlaubt',
  Read: 'Lesen',
  'Read and change': 'Lesen und ändern',
  'Open settings': 'Einstellungen öffnen',
  'Allergies and children’s details': 'Allergien und Kinderdaten',
  'Also put things on the list, book receipts, save recipes.': 'Auch Sachen auf die Liste setzen, Bons buchen, Rezepte speichern.',
  'Connect {client} with ToHuus?': '{client} mit ToHuus verbinden?',
  'Guests and children cannot connect assistants, and the household may have switched MCP access off. Ask an adult of your household.':
    'Gäste und Kinder können keine Assistenten verbinden, und vielleicht ist der MCP-Zugriff im Haushalt ausgeschaltet. Frag einen Erwachsenen aus eurem Haushalt.',
  'Household: {name}': 'Haushalt: {name}',
  'If this was not you, end the connection in Settings › Access & AI and change your password.':
    'Warst du das nicht? Dann beende die Verbindung unter Einstellungen › Zugang & KI und ändere dein Passwort.',
  'New connection': 'Neue Verbindung',
  'Not possible with this account': 'Mit diesem Konto nicht möglich',
  'Off unless you tick it. Even then only if your household allows sharing health data with AI.':
    'Aus, solange du es nicht ankreuzt. Auch dann nur, wenn euer Haushalt Gesundheitsdaten für KI freigegeben hat.',
  'See the list, what is at home, recipes and spending.': 'Die Liste sehen, was da ist, Rezepte und Ausgaben.',
  'The app that sent you here is unknown to ToHuus, or its return address does not match. Start connecting again in the app.':
    'Die App, die dich hierher geschickt hat, kennt ToHuus nicht, oder ihre Rücksprungadresse passt nicht. Starte das Verbinden in der App noch mal.',
  'This connection request is not valid': 'Diese Verbindungsanfrage ist ungültig',
  'What may it do?': 'Was darf er?',
  'Which household?': 'Welcher Haushalt?',
  '{client} can now use your household on your behalf.': '{client} kann jetzt in deinem Namen auf euren Haushalt zugreifen.',
  '{client} is now connected to ToHuus': '{client} ist jetzt mit ToHuus verbunden',
  '{client} wants to use your household on your behalf. You can end this at any time in Settings › Access & AI.':
    '{client} möchte in deinem Namen auf euren Haushalt zugreifen. Du kannst das jederzeit unter Einstellungen › Zugang & KI beenden.',
};
