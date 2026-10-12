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
};
