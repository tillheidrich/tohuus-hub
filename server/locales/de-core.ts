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

  // account mails and cloud account errors (routes/cloud.ts) – all of a mail in one language
  'Sign in to ToHuus': 'Bei ToHuus anmelden',
  'Tap the button to sign in. The link works once and for 15 minutes.': 'Tipp auf den Knopf, um dich anzumelden. Der Link funktioniert einmal und 15 Minuten lang.',
  'Please confirm your e-mail address': 'Bitte bestätige deine E-Mail-Adresse',
  'Confirm your address': 'Adresse bestätigen',
  'Tap the button to confirm this address for ToHuus Cloud.': 'Tipp auf den Knopf, um diese Adresse für ToHuus Cloud zu bestätigen.',
  'Tap the button to choose a new password. The link works once and for one hour.': 'Tipp auf den Knopf, um ein neues Passwort zu wählen. Der Link funktioniert einmal und eine Stunde lang.',
  'New password': 'Neues Passwort',
  'You are not a member of this household.': 'Du gehörst nicht zu diesem Haushalt.',
  'E-mail or password is wrong.': 'E-Mail oder Passwort stimmt nicht.',
  'New sign-ups are closed at the moment.': 'Neue Anmeldungen sind gerade geschlossen.',
  'There is already an account with this address – please sign in.': 'Mit dieser Adresse gibt es schon ein Konto – bitte melde dich an.',
  'Not available in ToHuus Cloud.': 'In ToHuus Cloud nicht verfügbar.',
  'You are already a member of this household.': 'Du gehörst schon zu diesem Haushalt.',
  'Only admins of this household can delete it.': 'Nur Admins dieses Haushalts können ihn löschen.',
  'Please type the name of the household to confirm.': 'Bitte tipp zur Bestätigung den Namen des Haushalts ein.',
  'No household selected.': 'Kein Haushalt ausgewählt.',
  'Please confirm your e-mail address first.': 'Bitte bestätige zuerst deine E-Mail-Adresse.',
  'The current password is wrong.': 'Das aktuelle Passwort stimmt nicht.',
  'In ToHuus Cloud people join by invitation.': 'In ToHuus Cloud kommen Leute per Einladung dazu.',
  'Everyone changes their own password under My account.': 'Jede Person ändert ihr Passwort selbst unter Mein Konto.',
  Admin: 'Admin',
  Passkey: 'Passkey',
  'Your ToHuus account is deleted': 'Dein ToHuus-Konto ist gelöscht',
  'Account deleted': 'Konto gelöscht',
  'Your account and your sign-in are gone. Households where you were the only member were deleted with everything in them; in shared households you left, and the others keep their list.':
    'Dein Konto und deine Anmeldung sind weg. Haushalte, in denen nur du warst, wurden mit allem darin gelöscht; aus gemeinsamen Haushalten bist du ausgetreten, die anderen behalten ihre Liste.',
  'If you have a subscription through Apple, cancel it in the App Store as well – deleting the account does not end it.':
    'Hast du ein Abo über Apple, kündige es bitte auch im App Store – das Löschen des Kontos beendet es nicht.',
  'If this was not you, write to us right away.': 'Warst du das nicht? Dann schreib uns bitte sofort.',
  'ToHuus Cloud': 'ToHuus Cloud',
};
