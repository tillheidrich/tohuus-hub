/**
 * Generic German till receipt parser (pdftotext -layout output, plain-text or HTML mail bodies).
 *
 * Used for everything that is not a REWE document (REWE has its own, tested parser). The layouts of the
 * big German chains share one grammar, they only differ in details:
 *
 *   NAME                         PRICE [EUR] [TAX]      item line (TAX = A/B/C/D or 1/2; dm prints 1/2)
 *     2 x 0,99                                          quantity line, after (REWE, Edeka, Aldi, dm) …
 *   2 x 0,99                                            … or before the item line (Kaufland, Netto)
 *   NAME                                                name-only line followed by
 *     2 x 0,99                 1,98 A                   a quantity line that carries the total
 *   Joghurt        0,49 x 2    0,98 A                   inline quantity (Lidl)
 *     0,512 kg x 2,99 EUR/kg                            weighed goods
 *   Pfand 0,25 / Leergut -0,75                          deposit (kept, status 'deposit')
 *   Rabatt / Coupon / Preisvorteil / Lidl Plus  -0,30   discount → folded into the item it belongs to (previous
 *                                                     item, same tax code, or the item named in the discount)
 *   Rabattsammler 5% auf den Einkauf  -0,36           discount on the whole purchase → meta.receiptDiscount
 *   Storno <name> -0,79 / <name> -0,79                void of an item above → the item is removed again
 *   Rückgabe <name> -1,25  (-1 x 1,25)                return of an earlier purchase → own line, status 'returned'
 *   Handeingabe 0,486 kg x 2,99 EUR/kg                hand-weighed goods; "1,234 kg * 1,99 €/kg" also works
 *   SUMME | Summe EUR | zu zahlen | Gesamtbetrag        total – parsing of items stops here
 *   A= 19,0 %  /  B 7%  /  1 19,00 %                    tax table → VAT rate per item (food = 7 %)
 *
 * The parser is pure (no database). It returns null when the text does not look like a receipt, so the
 * caller can fall back to the vision model.
 */
import { parseGermanNumber } from '../lib/text.js';
import type { ParsedImport, ParsedLine } from './types.js';

export type StoreKey =
  | 'lidl'
  | 'aldi-sued'
  | 'aldi-nord'
  | 'edeka'
  | 'netto'
  | 'kaufland'
  | 'penny'
  | 'rewe'
  | 'norma'
  | 'globus'
  | 'tegut'
  | 'dm'
  | 'rossmann'
  | 'mueller'
  | 'budni';

interface StoreDef {
  key: StoreKey;
  name: string;
  /** matched against the first lines (header) */
  header: RegExp;
  /** matched against the whole text (web address, loyalty programme) */
  anywhere?: RegExp;
  drugstore?: boolean;
}

/** Order matters: more specific first (Aldi Süd before Aldi, Netto Marken-Discount before tax "Netto"). */
const STORES: StoreDef[] = [
  { key: 'dm', name: 'dm', header: /\bdm[- ]?drogerie\s*markt\b|^\s*dm\s*$/im, anywhere: /\bdm\.de\b|dm-drogerie/i, drugstore: true },
  { key: 'rossmann', name: 'Rossmann', header: /\brossmann\b/i, anywhere: /rossmann\.de/i, drugstore: true },
  { key: 'mueller', name: 'Müller', header: /\bm(?:ü|ue)ller\b.*\b(?:drogerie|handels)/i, anywhere: /mueller\.de/i, drugstore: true },
  { key: 'budni', name: 'Budni', header: /\bbudni(?:kowsky)?\b/i, drugstore: true },
  { key: 'lidl', name: 'Lidl', header: /\blidl\b/i, anywhere: /lidl\.de|lidl plus|lidl vertriebs/i },
  // ALDI SÜD invoices as "ALDI SE & Co. KG", Aldi Nord as "ALDI GmbH & Co. KG" (regional companies)
  { key: 'aldi-sued', name: 'Aldi Süd', header: /\baldi\s*s(?:ü|ue|u)d\b|\baldi\s+se\b/i, anywhere: /aldi-sued\.de/i },
  { key: 'aldi-nord', name: 'Aldi Nord', header: /\baldi\b/i, anywhere: /aldi-nord\.de/i },
  { key: 'netto', name: 'Netto', header: /\bnetto\b(?=.*marken|\s*$|\s+(?:filiale|city|stavenhagen))/im, anywhere: /netto-online\.de|netto marken-discount/i },
  // Edeka stores are run by independent merchants: the header names the merchant ("Bade", "Muster e.K."), the
  // chain shows up on the card slip ("Edeka Markt"), as edeka.de, or in the till footer of the Edeka till system
  // ("Datum Uhrzeit Filiale Pos Bed Bon")
  { key: 'edeka', name: 'EDEKA', header: /\be\s?d\s?e\s?k\s?a\b|\bmarktkauf\b/i, anywhere: /edeka\.de|\bedeka\b|^\s*datum\s+uhrzeit\s+filiale\s+pos\s+bed\s+bon\s*$/im },
  { key: 'kaufland', name: 'Kaufland', header: /\bkaufland\b/i, anywhere: /kaufland\.de|kaufland card/i },
  { key: 'penny', name: 'Penny', header: /\bp\s?e\s?n\s?n\s?y\b/i, anywhere: /penny\.de/i },
  { key: 'norma', name: 'Norma', header: /\bnorma\b/i },
  { key: 'globus', name: 'Globus', header: /\bglobus\b/i },
  { key: 'tegut', name: 'tegut', header: /\btegut\b/i },
  { key: 'rewe', name: 'REWE', header: /\bR\s?E\s?W\s?E\b/ },
];

export interface DetectedStore {
  key: StoreKey;
  name: string;
  drugstore: boolean;
  /** how it was recognised: shop name in the header, or a web address / company name further down */
  via: 'header' | 'text';
}

/** Display name of a store key (for the recognition report). */
export function storeName(key: string): string | null {
  return STORES.find((s) => s.key === key)?.name ?? null;
}

export function detectStore(text: string): DetectedStore | null {
  const header = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n');
  for (const s of STORES) if (s.header.test(header)) return { key: s.key, name: s.name, drugstore: Boolean(s.drugstore), via: 'header' };
  for (const s of STORES) if (s.anywhere?.test(text)) return { key: s.key, name: s.name, drugstore: Boolean(s.drugstore), via: 'text' };
  return null;
}

export type CategoryHint = 'toiletries' | 'household' | null;

export interface GenericLine extends ParsedLine {
  /** VAT rate in percent, when the receipt prints a tax table */
  vatRate?: number | null;
  /** where a new product from this line should live (drugstores) */
  categoryHint?: CategoryHint;
}

const P = '-?\\d{1,4},\\d\\d';
const money = (s: string) => Math.round(parseGermanNumber(s) * 100) / 100;
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;

// tax code after the price, also glued to it after the "not discountable" star: "0,25*B"
const TAX = '(?:(?:\\s+|\\s*\\*)(\\*?[A-D]\\*?|[1-4]))?';
const itemRe = (sep: string) =>
  new RegExp(
    `^\\s*(\\S.*?)${sep}(?:(\\d{1,3})\\s*(?:Stk\\.?|St\\.?)?\\s*[x×*]\\s*(${P})\\s+|(${P})\\s*[x×*]\\s*(\\d{1,3})\\s+)?(${P})(?:\\s*(?:EUR|€))?${TAX}\\s*\\*?\\s*$`,
    'i',
  );
const ITEM_STRICT = itemRe('\\s{2,}');
const ITEM_LOOSE = itemRe('\\s+');
/** "2 x 0,99" or "2 Stk x 0,99" (optionally with the line total) */
const QTY = new RegExp(`^\\s*(-?\\d{1,3})\\s*(?:Stk\\.?|St\\.?|Stück)?\\s*[x×*]\\s*(${P})(?:\\s*(?:EUR|€))?(?:\\s+(${P})(?:\\s*(?:EUR|€))?${TAX})?\\s*$`, 'i');
/** "0,512 kg x 2,99 EUR/kg", "Handeingabe 0,486 kg x 2,99 EUR/kg", "1,234 kg * 1,99 €/kg" (optionally with the line total) */
const WEIGHT = new RegExp(`^\\s*(?:handeingabe|hand|waage|gewicht:?)?\\s*(\\d{1,3},\\d{2,3})\\s*kg\\s*(?:[x×*]\\s*)?(\\d{1,4},\\d\\d)\\s*(?:EUR|€)?\\s*/\\s*kg(?:\\s+(${P})(?:\\s*(?:EUR|€))?${TAX})?\\s*$`, 'i');
const TOTAL = new RegExp(`^\\s*(?:summe|zu\\s+zahlen|gesamtbetrag|gesamtsumme|gesamt|total|endbetrag)\\b[^\\d\\n-]*(${P})`, 'i');
const NOT_AN_ITEM =
  /^(?:zwischensumme|summe|total|gesamt|zu zahlen|bar|r(?:ü|ue)ckgeld|gegeben|ec[- ]?(?:karte|cash|zahlung)|girocard|karten?zahlung|kreditkarte|visa|mastercard|maestro|v pay|kontaktlos|mwst|ust|steuer|netto|brutto|posten|betrag|zahlung|wechselgeld|payback|punkte|datum|uhrzeit|bon[- ]?nr|beleg|kasse|filiale|tse|signatur|seriennr|terminal|trace|genehmigung|tel|fax|www|steuer-?nr|ust-?id|handeingabe|kunden-?nr|kundennummer|karten-?nr|kartennr|e-?mail|es bediente)\b/i;
const DEPOSIT = /pfand|leergut|einweg|mehrweg|flaschenr(?:ü|ue)ck/i;
/** a cashier void of an item above */
const VOID = /^(?:storno|stornierung|sofortstorno|zeilenstorno|void)\b[\s:.-]*/i;
/** a customer return of something bought earlier */
const RETURN = /^(?:r(?:ü|ue)ckgabe|retoure|umtausch|r(?:ü|ue)cknahme)\b[\s:.-]*/i;
/** discounts on the whole purchase, not on one item */
const WHOLE_DISCOUNT =
  /auf\s+(?:den|ihren|deinen|dein|ihr|alles|den\s+gesamten)\s+einkauf|einkaufsrabatt|gesamtrabatt|rabattsammler|mitarbeiterrabatt|bonrabatt|warenkorb|auf\s+alles\b/i;
/** words in a discount line that say nothing about which item it belongs to */
const DISCOUNT_WORDS =
  /\b(?:rabatt|coupon|preisvorteil|aktion|angebot|sofortrabatt|mengenrabatt|nachlass|lidl|plus|app|k-?card|card|payback|deutschlandcard|f(?:ü|ue)r|auf|und|mit|der|die|das)\b|\d+\s*%|\d+/gi;

/** Tax table: "A= 19,0%", "B 7%", "1  19,00 %", "MwSt 2 7%" → code → rate. */
function readTaxTable(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const re = /^\s*(?:mwst\.?|ust\.?|steuer)?\s*\*?([A-D1-4])\s*[=:]?\s*(\d{1,2})(?:[,.]\d+)?\s*%/gim;
  for (const m of text.matchAll(re)) {
    const code = m[1].toUpperCase();
    const rate = Number(m[2]);
    if ((rate === 7 || rate === 19 || rate === 0 || rate === 5 || rate === 16) && !map.has(code)) map.set(code, rate);
  }
  return map;
}

const HOUSEHOLD =
  /sp(?:ü|ue)l|wasch|reinig|putz|m(?:ü|ue)llbeutel|m(?:ü|ue)lltüte|k(?:ü|ue)chenrolle|toilettenpapier|klopapier|taschent(?:ü|ue)cher|batterie|folie|schwamm|weichsp(?:ü|ue)l|entkalk|geschirr|tabs\b|wc[- ]|allzweck|kerze|gl(?:ü|ue)hbirne|leuchtmittel|beutel/i;
const FOODISH =
  /\btee\b|kaffee|schoko|riegel|m(?:ü|ue)sli|n(?:ü|ue)sse|saft|smoothie|brei|gl(?:ä|ae)schen|chips|nudeln|reis\b|keks|hafer|drink|getr(?:ä|ae)nk|wasser\b|sirup|honig|aufstrich|bonbon|gummib|snack|cracker|zwieback|babymilch|folgemilch|anfangsmilch/i;

function hintFor(name: string, vatRate: number | null | undefined): CategoryHint {
  if (vatRate === 7 || vatRate === 5) return null; // reduced rate = food (or books) in Germany
  if (HOUSEHOLD.test(name)) return 'household';
  if (vatRate == null && FOODISH.test(name)) return null;
  return 'toiletries';
}

const MONTHS: Record<string, number> = {
  januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6, juli: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
};

/**
 * Purchase date of a receipt. A date with a time next to it ("17.10.26 18:42") is the till's own stamp and beats a
 * plain date further up (a coupon "gültig bis 27.10.2026", a delivery date). Shop apps head a digital receipt with
 * "13. September" (Lidl Plus): without a year it is the latest such day that is not in the future.
 */
export function parseDate(text: string, today: Date = new Date()): { iso: string; time: string | null } | null {
  let plain: { iso: string; time: string | null } | null = null;
  for (const m of text.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)(?:\D{0,12}?(\d{1,2}):(\d{2}))?/g)) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) continue;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const time = m[4] && Number(m[4]) < 24 ? `${m[4].padStart(2, '0')}:${m[5]}` : null;
    if (time) return { iso, time };
    plain ??= { iso, time };
  }
  if (plain) return plain;
  const named = text.match(/(?:^|[^\d])(\d{1,2})\.\s*(Januar|Februar|M(?:ä|ae)rz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)(?:\s+(\d{4}))?(?![a-zäöü])/i);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS[named[2].toLowerCase()];
    if (day >= 1 && day <= 31 && month) {
      let year = named[3] ? Number(named[3]) : today.getFullYear();
      const iso = (y: number) => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (!named[3] && iso(year) > todayIso) year -= 1;
      return { iso: iso(year), time: null };
    }
  }
  return null;
}

/**
 * Item name as printed, without till noise: "Avocado Stk." → "Avocado" (a unit word without a number is no pack
 * size), runs of spaces. Pack sizes stay ("Bioland Eier 6St" – the product keeps "6St" as its size, never a quantity).
 */
export function cleanItemName(name: string): string {
  return name
    .replace(/\s{2,}/g, ' ')
    .replace(/(?<![\d,.])\s+(?:stk|st|stck|stück)\.?$/i, '')
    .trim();
}

/** typical German deposit amounts per bottle/can/crate (Einweg 0,25, Mehrweg 0,08 / 0,15, Kasten 1,50 / 3,10 / 3,42) */
const DEPOSIT_UNITS = [0.25, 0.15, 0.08];

/** Does `amount` look like deposit (1–12 bottles of one kind)? */
export function looksLikeDeposit(amount: number): boolean {
  const cents = Math.round(amount * 100);
  if (cents <= 0 || cents > 300) return false;
  return DEPOSIT_UNITS.some((u) => {
    const uc = Math.round(u * 100);
    return cents % uc === 0 && cents / uc <= 12;
  });
}

/** "Mit Lidl Plus 0,70 EUR gespart", "Sie haben 1,20 € gespart", "Ersparnis 0,50" → 0.70 (the savings the receipt prints). */
export function savingsHint(text: string): number | null {
  const m =
    text.match(/(?:mit\s+lidl\s+plus|sie\s+haben|du\s+hast|heute|insgesamt)[\s\n]+(?:[a-zäöü ]{0,20}?)(\d{1,3},\d\d)\s*(?:EUR|€)?[\s\n]+gespart/i) ??
    text.match(/(?:ersparnis|gespart|eingespart|sie\s+sparen|du\s+sparst)\s*:?\s*(\d{1,3},\d\d)\s*(?:EUR|€)?/i);
  if (!m) return null;
  const v = money(m[1]);
  return v > 0 ? v : null;
}

interface Pending {
  qty?: number;
  unitPrice?: number;
  weightKg?: number;
  pricePerKg?: number;
  raw: string;
}

/** Parse item lines; `sep` decides how strictly name and price must be separated. */
function readItems(rows: string[], item: RegExp, tax: Map<string, number>) {
  const lines: GenericLine[] = [];
  let total: number | null = null;
  let discounts = 0;
  let receiptDiscount = 0;
  const taxOf = new WeakMap<GenericLine, string>();
  let pendingName: string | null = null;
  let pending: Pending | null = null;
  let started = false;

  const push = (name: string, price: number, raw: string, taxCode?: string, qty = 1, unitPrice?: number) => {
    const isDeposit = DEPOSIT.test(name);
    const code = taxCode?.replace(/\*/g, '').toUpperCase();
    const l: GenericLine = {
      raw,
      name: cleanItemName(name) || name.trim(),
      qty,
      unit: null,
      price,
      unitPrice: unitPrice ?? (qty ? Math.round((price / qty) * 100) / 100 : price),
      status: isDeposit ? 'deposit' : 'ok',
      vatRate: code && tax.has(code) ? tax.get(code)! : null,
    };
    if (code) taxOf.set(l, code);
    // quantity / weight printed BEFORE the item (Kaufland, Netto)
    if (pending) {
      if (pending.qty && pending.unitPrice != null && near(pending.qty * pending.unitPrice, price)) {
        l.qty = pending.qty;
        l.unitPrice = pending.unitPrice;
        l.raw = `${pending.raw} | ${l.raw}`;
      } else if (pending.weightKg && pending.pricePerKg != null && near(pending.weightKg * pending.pricePerKg, price, 0.015)) {
        l.weightKg = pending.weightKg;
        l.note = `${String(pending.weightKg.toFixed(3)).replace('.', ',')} kg`;
        l.raw = `${pending.raw} | ${l.raw}`;
      }
      pending = null;
    }
    lines.push(l);
    pendingName = null;
    started = true;
  };

  for (const row of rows) {
    const line = row.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-=_*·.]{5,}$/.test(trimmed)) continue;
    const tot = trimmed.match(TOTAL);
    if (tot && !/^zwischen/i.test(trimmed)) {
      if (started || lines.length) {
        total = money(tot[1]);
        break;
      }
      continue;
    }
    const last = lines[lines.length - 1] as GenericLine | undefined;
    // weighed goods
    const w = line.match(WEIGHT);
    if (w) {
      const kg = parseGermanNumber(w[1]);
      const perKg = money(w[2]);
      if (w[3] && pendingName) {
        push(pendingName, money(w[3]), `${pendingName} | ${trimmed}`, w[4]);
        const l = lines[lines.length - 1];
        l.weightKg = kg;
        l.note = `${w[1]} kg`;
      } else if (last && !last.weightKg && near(kg * perKg, last.price ?? NaN, 0.015)) {
        last.weightKg = kg;
        last.note = [last.note, `${w[1]} kg`].filter(Boolean).join(' · ');
        last.raw += ' | ' + trimmed;
      } else pending = { weightKg: kg, pricePerKg: perKg, raw: trimmed };
      continue;
    }
    // quantity line
    const q = line.match(QTY);
    if (q) {
      const qty = Number(q[1]);
      const unit = money(q[2]);
      if (qty < 0) {
        // "-1 x 1,25" under a return line
        if (last && last.status === 'returned' && near(Math.abs(qty) * unit, Math.abs(last.price ?? NaN))) {
          last.qty = qty;
          last.unitPrice = unit;
          last.raw += ' | ' + trimmed;
        }
        continue;
      }
      if (q[3] && pendingName) {
        push(pendingName, money(q[3]), `${pendingName} | ${trimmed}`, q[4], qty, unit);
      } else if (last && last.qty === 1 && near(qty * unit, last.price ?? NaN)) {
        last.qty = qty;
        last.unitPrice = unit;
        last.raw += ' | ' + trimmed;
      } else if (!q[3]) pending = { qty, unitPrice: unit, raw: trimmed };
      continue;
    }
    const m = line.match(item);
    if (m && /[A-Za-zÄÖÜäöüß]/.test(m[1]) && !NOT_AN_ITEM.test(m[1].trim())) {
      // leading article numbers (Aldi, some Edeka tills)
      let name = m[1].trim().replace(/^\d{4,8}\s+(?=\S*[A-Za-zÄÖÜäöü])/, '');
      const price = money(m[6]);
      let inlineQty = m[2] ? Number(m[2]) : m[5] ? Number(m[5]) : null;
      let inlineUnit = m[3] ? money(m[3]) : m[4] ? money(m[4]) : null;
      // "Pfand 6 x 0,25   1,50": quantity glued to the name with single spaces
      const glued = !inlineQty ? name.match(new RegExp(`^(.*?[A-Za-zÄÖÜäöü.])\\s+(\\d{1,3})\\s*[x×*]\\s*(${P})$`)) : null;
      if (glued && near(Number(glued[2]) * money(glued[3]), price)) {
        name = glued[1].trim();
        inlineQty = Number(glued[2]);
        inlineUnit = money(glued[3]);
      }
      // "2 x H-Milch 1,5%   2,38" (shop apps, tidied text): a quantity in front of the name – only when the line total
      // splits into whole cents and the number is not the pack size printed in the name ("6 x Eier 6St 2,99" is one pack)
      const lead = !inlineQty && price > 0 ? name.match(/^(\d{1,2})\s*[x×]\s+(.*[A-Za-zÄÖÜäöü].*)$/) : null;
      if (lead) {
        const n = Number(lead[1]);
        const cents = Math.round(price * 100);
        const pack = lead[2].match(/(\d+)\s?(?:st\.?|stk\.?|stück|er)\b/i);
        name = lead[2].trim();
        if (n >= 2 && cents % n === 0 && !(pack && Number(pack[1]) === n)) {
          inlineQty = n;
          inlineUnit = cents / n / 100;
        }
      }
      if (!DEPOSIT.test(name) && price < 0) {
        const code = m[7]?.replace(/\*/g, '').toUpperCase();
        const core = name.replace(VOID, '').replace(RETURN, '').trim();
        const sameItem = (l: GenericLine) => l.status === 'ok' && (l.price ?? 0) > 0 && l.name.toLowerCase() === (cleanItemName(core) || core).toLowerCase();
        const isVoid = VOID.test(name) || (!RETURN.test(name) && last != null && sameItem(last) && near(last.unitPrice ?? NaN, -price));
        if (isVoid) {
          // cashier void: take the item off again (one piece of it)
          const idx = lines.map((l, i) => [l, i] as const).reverse().find(([l]) => sameItem(l) && (near(l.price ?? NaN, -price) || near(l.unitPrice ?? NaN, -price)))?.[1];
          if (idx != null) {
            const l = lines[idx];
            if (l.qty > 1 && near(l.unitPrice ?? NaN, -price)) {
              l.qty -= 1;
              l.price = Math.round(((l.price ?? 0) + price) * 100) / 100;
              l.raw += ' | ' + trimmed;
            } else lines.splice(idx, 1);
            continue;
          }
        }
        if (RETURN.test(name)) {
          // a return of an earlier purchase: its own line, not booked in by default
          push(core || name, price, trimmed, m[7], -1, -price);
          const l = lines[lines.length - 1];
          l.status = 'returned';
          l.unitPrice = Math.abs(price);
          continue;
        }
        // discounts (Rabatt, Coupon, Preisvorteil, Lidl Plus …): find the item they belong to
        const fits = (l: GenericLine | undefined) => l != null && l.status === 'ok' && (l.price ?? 0) + price >= -0.001;
        const words = name.replace(DISCOUNT_WORDS, ' ').toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length >= 4);
        let target: GenericLine | undefined;
        if (!WHOLE_DISCOUNT.test(name)) {
          if (words.length) target = [...lines].reverse().find((l) => fits(l) && words.some((w) => l.name.toLowerCase().includes(w)));
          if (!target && fits(last) && (!code || !taxOf.get(last!) || taxOf.get(last!) === code)) target = last;
          // a different tax code than the item above: the nearest item with that code (only right after items –
          // coupons printed after the deposit block apply to the whole purchase)
          if (!target && code && last?.status === 'ok') target = [...lines].reverse().find((l) => fits(l) && taxOf.get(l) === code);
        }
        if (target) {
          target.price = Math.round(((target.price ?? 0) + price) * 100) / 100;
          target.note = [target.note, `${name} ${m[6]}`].filter(Boolean).join(' · ');
          target.raw += ' | ' + trimmed;
        } else receiptDiscount = Math.round((receiptDiscount + price) * 100) / 100;
        discounts += price;
        continue;
      }
      if (inlineQty && inlineUnit != null && near(inlineQty * inlineUnit, price)) push(name, price, trimmed, m[7], inlineQty, inlineUnit);
      else push(name, price, trimmed, m[7]);
      continue;
    }
    // a name without a price: the quantity line with the total follows (Kaufland)
    if (/[A-Za-zÄÖÜäöü]{3,}/.test(trimmed) && !/\d,\d\d/.test(trimmed) && trimmed.length <= 60 && !NOT_AN_ITEM.test(trimmed) && !VOID.test(trimmed)) pendingName = trimmed;
    else pendingName = null;
  }
  return { lines, total, discounts: Math.round(discounts * 100) / 100, receiptDiscount };
}

export interface GenericOptions {
  /** title when no store is recognised */
  fallbackTitle?: string;
}

export function parseGenericReceipt(text: string, opts: GenericOptions = {}): ParsedImport | null {
  const clean = text.replace(/\r/g, '').replace(/ /g, ' ').replace(/\t/g, '    ');
  const rows = clean.split('\n');
  const tax = readTaxTable(clean);
  let res = readItems(rows, ITEM_STRICT, tax);
  // mail bodies and copied text often lose the column spacing
  if (res.lines.length === 0) res = readItems(rows, ITEM_LOOSE, tax);
  const { lines, total } = res;
  const goods = lines.filter((l) => l.status !== 'deposit');
  if (goods.length === 0) return null;
  let sum = Math.round((lines.reduce((s, l) => s + (l.price ?? 0), 0) + res.receiptDiscount) * 100) / 100;
  let sumMatches = total != null && near(sum, total, 0.021);
  const store = detectStore(clean);
  // every till receipt has a total; without it (or without a store and a matching sum) it is probably
  // a newsletter or an offer list, not a receipt
  if (total == null || (!sumMatches && !store)) return null;

  // Lidl prints short codes behind some names ("Bioland Eier OKT 6St") – they say nothing about the product
  if (store?.key === 'lidl') for (const l of lines) l.name = l.name.replace(/\s+OKT\b/g, '').trim() || l.name;

  // The total does not add up, and the gap is a discount or deposit row the text recognition missed (light blue
  // "Lidl Plus Rabatt", a faint "Pfand" row; 18.10.2026): the receipt's own "Mit Lidl Plus 0,70 EUR gespart" and the
  // usual deposit amounts say what is missing. Filled in, marked "please check" – never silently.
  const saved = savingsHint(clean);
  let receiptDiscount = res.receiptDiscount;
  const assumed: { kind: 'discount' | 'deposit'; amount: number }[] = [];
  let suggestion: { kind: 'discount' | 'deposit' | 'line'; amount: number } | null = null;
  if (!sumMatches) {
    const diff = Math.round((total - sum) * 100) / 100;
    const missingDiscount = saved != null ? Math.round((saved + res.discounts) * 100) / 100 : 0;
    const rest = Math.round((diff + missingDiscount) * 100) / 100;
    if (missingDiscount > 0 && (near(rest, 0) || looksLikeDeposit(rest))) {
      assumed.push({ kind: 'discount', amount: missingDiscount });
      receiptDiscount = Math.round((receiptDiscount - missingDiscount) * 100) / 100;
      if (!near(rest, 0)) assumed.push({ kind: 'deposit', amount: rest });
    } else if (looksLikeDeposit(diff)) assumed.push({ kind: 'deposit', amount: diff });
    else suggestion = diff < 0 ? { kind: 'discount', amount: -diff } : { kind: diff <= 3 ? 'deposit' : 'line', amount: diff };
    for (const a of assumed.filter((x) => x.kind === 'deposit'))
      lines.push({ raw: `Pfand ${a.amount.toFixed(2).replace('.', ',')} (assumed from the total)`, name: 'Pfand', qty: 1, unit: null, price: a.amount, unitPrice: a.amount, status: 'deposit', ocrConfidence: 0.5 });
    if (assumed.length) {
      sum = Math.round((lines.reduce((s, l) => s + (l.price ?? 0), 0) + receiptDiscount) * 100) / 100;
      sumMatches = near(sum, total, 0.021);
    }
  }

  if (store?.drugstore) for (const l of lines) if (l.status !== 'deposit') l.categoryHint = hintFor(l.name, l.vatRate);

  // the deposit printed right below a drink belongs to it ("Pfand 0,25" under "Spezi 0,33l")
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    if (l.status === 'deposit' && (l.price ?? 0) > 0 && prev && prev.status === 'ok' && !l.raw.includes('(assumed')) l.depositFor = prev.name;
  });

  // the till footer "Datum Uhrzeit Filiale Pos Bed Bon" + the values below it (Edeka) beats any other date
  const footer = clean.match(/^\s*datum\s+uhrzeit\s+filiale\s+pos\s+bed\s+bon\s*\n\s*(\d{1,2}\.\d{1,2}\.\d{2,4})\s+(\d{1,2}:\d{2})((?:\s+\d+){1,4})\s*$/im);
  const date = (footer ? parseDate(`${footer[1]} ${footer[2]}`) : null) ?? parseDate(clean);
  const bon = footer?.[3].trim().split(/\s+/).pop() ?? clean.match(/(?:Bon[- ]?Nr\.?|Beleg[- ]?Nr\.?|Bonnr\.?|Belegnummer|Trans(?:aktions)?[- ]?Nr\.?|Vorgang)\s*:?\s*(\d{2,})/i)?.[1] ?? null;
  const dm = date ? `${date.iso.slice(8, 10)}.${date.iso.slice(5, 7)}.${date.iso.slice(0, 4)}` : null;
  const label = store?.name ?? opts.fallbackTitle ?? 'Receipt';
  return {
    kind: 'receipt',
    title: dm ? `${label} · ${dm}` : label,
    shop: store?.name ?? null,
    ref: date ? `rcpt-${store?.key ?? 'x'}-${date.iso}-${date.time ?? ''}-${bon ?? ''}-${total ?? sum}` : null,
    date: date ? `${date.iso}${date.time ? ' ' + date.time : ''}` : null,
    total: total ?? sum,
    meta: {
      store: store?.key ?? null,
      storeVia: store?.via ?? null,
      drugstore: Boolean(store?.drugstore),
      bonNr: bon,
      sumMatches,
      itemsSum: sum,
      discounts: res.discounts,
      receiptDiscount: receiptDiscount || null,
      // what the receipt says it saved ("Mit Lidl Plus 0,70 EUR gespart")
      savingsHint: saved,
      // rows filled in from the total (missed by text recognition) – the review asks to check them
      sumAssumed: assumed.length ? true : undefined,
      assumed: assumed.length ? assumed : undefined,
      // the gap when nothing could be filled in: what probably is missing
      fixSuggestion: suggestion ?? undefined,
      parser: 'generic',
    },
    lines,
  };
}
