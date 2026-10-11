/**
 * Receipt anonymisation for "Help improve recognition" fixtures.
 *
 * Pure function (no database): takes the text of a till receipt (pdftotext -layout output, a mail body,
 * pasted text) and returns a copy that keeps what a parser needs – the store chain, the item lines with
 * their prices, quantity/weight lines, deposit and discount lines, totals and the tax table – and removes
 * or neutralises everything that points to a person or a place:
 *
 *  - store address, phone numbers, branch/till/operator numbers, the store's VAT / tax number
 *  - payment card numbers, terminal / trace / authorisation ids, IBANs
 *  - loyalty programmes (PAYBACK, DeutschlandCard, Lidl Plus, Kaufland Card, REWE Bonus …): card numbers,
 *    points and balances
 *  - names (cashier, customer, greeting lines), e-mail addresses, links with personal tokens
 *  - TSE data (transaction number, signature counter, serial numbers, signature, start/stop time)
 *  - dates move to the 1st of their month, times are rounded down to the full hour
 *
 * The approach is "keep the structure, scrub the values": a line keeps its label ("Trace-Nr.") but loses
 * its value, so the fixture still looks like the original layout. Long digit runs outside of item lines are
 * always masked, whatever the label says – that is the safety net for layouts nobody anticipated.
 */

export type RedactionKind =
  | 'address'
  | 'phone'
  | 'tax_id'
  | 'card'
  | 'loyalty'
  | 'name'
  | 'email'
  | 'link'
  | 'tse'
  | 'ids'
  | 'date'
  | 'time';

export interface RedactionResult {
  text: string;
  /** how many values of each kind were removed (for the "what we removed" list) */
  removed: Partial<Record<RedactionKind, number>>;
}

const MONEY = /-?\d{1,4},\d\d(?!\d)/;
/** a line that ends in a price (+ optional currency, tax code, star): an item, deposit, discount or total line */
const PRICE_END = /-?\d{1,4},\d\d(?:\s*(?:EUR|€))?(?:\s+\*?[A-D1-4]\*?)?\s*\*?\s*$/i;
const QTY_LINE = /^\s*-?\d{1,3}\s*(?:Stk\.?|St\.?|Stück)?\s*[x×*]\s*\d{1,4},\d\d/i;
const WEIGHT_LINE = /^\s*(?:handeingabe|hand|waage|gewicht:?)?\s*\d{1,3},\d{2,3}\s*kg\b/i;
const TOTAL = /^\s*(?:summe|zu\s+zahlen|gesamtbetrag|gesamtsumme|gesamt|total|endbetrag)\b/i;

/** chain names and legal names that may stay verbatim */
const CHAIN =
  /\b(?:r\s?e\s?w\s?e|e\s?d\s?e\s?k\s?a|lidl|aldi|netto|kaufland|p\s?e\s?n\s?n\s?y|dm|rossmann|m(?:ü|ue)ller|budni(?:kowsky)?|norma|globus|tegut|marktkauf|famila|combi|hit|real|nahkauf|netto marken-discount)\b/i;
/** words that may stay next to a chain name in the header */
const SAFE_WORDS = new Set(
  [
    'rewe', 'edeka', 'lidl', 'aldi', 'süd', 'sued', 'nord', 'netto', 'marken-discount', 'marken', 'discount', 'kaufland', 'penny',
    'dm', 'dm-drogerie', 'drogerie', 'markt', 'rossmann', 'dirk', 'müller', 'mueller', 'budni', 'budnikowsky', 'norma', 'globus',
    'tegut', 'marktkauf', 'famila', 'combi', 'hit', 'nahkauf', 'center', 'city', 'express', 'to', 'go', 'neukauf', 'aktiv',
    'frischemarkt', 'supermarkt', 'warenhaus', 'sb', 'filiale', 'vertriebs-gmbh', 'vertriebs', 'gmbh', 'kg', 'ohg', 'ag', 'se',
    'co.', 'co', '&', '+', 'e.k.', 'ek', 'stiftung', 'zentrale', 'handels', 'handelsgesellschaft', 'mbh', 'markt-gmbh', 'eur',
    'r', 'e', 'w', 'd', 'k', 'a', 'p', 'n', 'y', 'die', 'der', 'ihr', 'dein', 'xpress',
  ],
);

const KNOWN_HOSTS =
  /(?:^|\.)(?:rewe\.de|edeka\.de|lidl\.de|aldi-sued\.de|aldi-nord\.de|netto-online\.de|kaufland\.de|penny\.de|dm\.de|rossmann\.de|mueller\.de|budni\.de|globus\.de|tegut\.com|norma-online\.de|payback\.de|deutschlandcard\.de)$/i;

const TSE = /\btse\b|signatur|signature|pr(?:ü|ue)fwert|serien+u?m+er|serien-?nr|serial|z(?:ä|ae)hler|transaktion|\btransaction\b|start\s*:|stop\s*:|kassen-?id|client-?id|log-?time|public key|pubkey/i;
const LOYALTY = /payback|\bbonus|deutschlandcard|deutschland card|lidl plus|kaufland card|k-card|rewe bonus|bonus-?guthaben|bonusguthaben|punkte|punktestand|°p\b|guthaben|kontostand|saldo|mitglied|member|kundenkarte|kunden-?nr|kundennummer|kunden-?id|app-?id/i;
const CARD = /karte|card|kartennr|karten-?nr|\bnr\b|\bpan\b|konto|iban|\bbic\b|terminal|trace|genehmigung|autori[sz]|\bauth\b|\baid\b|\bemv\b|vu-?nr|pos-?info|as-?zeit|kontaktlos|contactless/i;
const IDS = /beleg|\bbon\b|bon-?nr|bonnr|kasse|markt|filiale|\bbed\b|bediener|kassierer|vorgang|bestell|order|referenz|\bref\b|\bid\b|transakt/i;
const NAME =
  /^(\s*(?:es\s+bediente\s+(?:sie|dich)|bediener(?:in)?|kassierer(?:in)?|mitarbeiter(?:in)?|verk(?:ä|ae)ufer(?:in)?|marktleit(?:er|erin|ung)|inhaber(?:in)?|kunde|kundin|name|empf(?:ä|ae)nger(?:in)?|hallo|hi|hey|liebe[rs]?|guten\s+tag|moin|servus)\b(?:\s*[:,]\s*|\s+))([^@\s].*)$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** links: with a scheme or www., or a bare domain followed by a path (tokens live in paths and queries) */
const URL = /(?:\bhttps?:\/\/(?:www\.)?|\bwww\.)([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(\/[^\s]*)?|\b([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:de|com|net|org|eu|info|app|io|shop))(\/[^\s]+)/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g;
const VAT = /\b(?:DE|AT|NL|BE|FR|LU|DK|PL|CZ)\s?\d{8,11}\b/g;
const TAXNO = /\b\d{2,3}\s?\/\s?\d{3,4}\s?\/\s?\d{4,5}\b/g;
const PHONE = /(?:\+\d{2}\s?\(?0?\)?|\b0)\d{2,5}\s?[\/-]?\s?\d{3,}(?:[\s-]\d{2,})*/g;
const POSTCODE_LINE = /^\s*(?:D-)?\d{5}\s+[A-ZÄÖÜa-zäöüß][\wäöüßÄÖÜ .()/-]*$/;
const STREET =
  /[A-Za-zäöüßÄÖÜ.-]*(?:stra(?:ß|ss)e|str\.|weg|platz|allee|ring|gasse|damm|chaussee|ufer|steig|pfad|hof|markt|berg|feld|kamp|twiete|wall|deich|tor|zeile)\s*\d+\s*[a-z]?(?:\s*[-–]\s*\d+\s*[a-z]?)?\b/i;
const DATE_DMY = /\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?!\d)/g;
const DATE_ISO = /\b(\d{4})-(\d{2})-(\d{2})(?=\b|T)/g;
const TIME = /\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?\b/g;
const B64 = /^\s*(?=[A-Za-z0-9+/=]*\d)(?=[A-Za-z0-9+/=]*[A-Za-z])[A-Za-z0-9+/=]{16,}\s*$/;

const zeros = (s: string) => s.replace(/\d/g, '0');

export function redactReceipt(input: string): RedactionResult {
  const removed: Partial<Record<RedactionKind, number>> = {};
  const count = (k: RedactionKind, n = 1) => {
    if (n > 0) removed[k] = (removed[k] ?? 0) + n;
  };
  const rows = input.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/\t/g, '    ').split('\n');

  // where do item lines start and end? (header = before the first priced line, footer = after the total)
  let firstItem = rows.findIndex((r) => (PRICE_END.test(r) && /[A-Za-zÄÖÜäöü]{2,}/.test(r) && !TOTAL.test(r)) || QTY_LINE.test(r) || WEIGHT_LINE.test(r));
  // Kaufland & co: "NAME" alone, then "2 x 0,59   1,18 A" – the name line belongs to the items
  if (firstItem > 0 && (QTY_LINE.test(rows[firstItem]) || WEIGHT_LINE.test(rows[firstItem]))) {
    const prev = rows[firstItem - 1].trim();
    if (/[A-Za-zÄÖÜäöü]{3,}/.test(prev) && !/^(?:eur|€)$/i.test(prev) && !CHAIN.test(prev) && !/\d{4,}/.test(prev) && !STREET.test(prev)) firstItem--;
  }
  const totalIdx = rows.findIndex((r, i) => i > firstItem && TOTAL.test(r.trim()) && MONEY.test(r));
  const inItems = (i: number) => firstItem >= 0 && i >= firstItem && (totalIdx < 0 || i < totalIdx);

  /** mask digits that are not money, dates, times or percentages; `min` = minimum run length */
  const maskDigits = (s: string, min: number, kind: RedactionKind) =>
    s.replace(/\d(?:[\d ]*\d)?/g, (m: string, off: number, all: string) => {
      const before = all[off - 1] ?? '';
      const after = all.slice(off + m.length, off + m.length + 2);
      // money (12,34), dates (09.10.2026), times (14:36), percentages and decimals stay
      if (/[.,:]/.test(before) && /\d/.test(all[off - 2] ?? '')) return m;
      if (/^[,.:]\d/.test(after) || /^\s?%/.test(after)) return m;
      const digits = m.replace(/\D/g, '');
      if (digits.length < min) return m;
      // our own placeholders
      if (m === '01234 567890' || m === '12345') return m;
      count(kind);
      return zeros(m);
    });

  /** dates → 1st of the month, times → full hour */
  const shiftDates = (cell: string) =>
    cell
      .replace(DATE_DMY, (m, d: string, mo: string, y?: string) => {
        const dd = Number(d);
        const mm = Number(mo);
        if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return m;
        if (dd === 1) return m;
        count('date');
        return `${d.length === 2 ? '01' : '1'}.${mo}.${y ?? ''}`;
      })
      .replace(DATE_ISO, (m, y: string, mo: string, d: string) => {
        if (d === '01') return m;
        count('date');
        return `${y}-${mo}-01`;
      })
      .replace(TIME, (m, h: string, min: string) => {
        if (min === '00' && m.length <= 5) return m;
        count('time');
        return `${h}:00`;
      });

  /** Scrub one column of a non-item line. */
  const scrubCell = (cell: string, header: boolean, itemArea: boolean, flags: { loyalty: boolean; card: boolean; ids: boolean }): string => {
    let c = cell;
    const indent = c.match(/^\s*/)![0];
    const tc = c.trim();
    if (/^[-=_*·.\s]+$/.test(tc) || /^(?:eur|€)$/i.test(tc)) return c;

    // e-mail addresses and links ("VEG.SPICK.MORTA." on an item line is no domain – items never get here)
    c = c.replace(EMAIL, () => {
      count('email');
      return 'name@example.org';
    });
    c = c.replace(URL, (m, h1: string | undefined, p1: string | undefined, h2: string | undefined, p2: string | undefined) => {
      const host = h1 ?? h2 ?? '';
      const pathPart = p1 ?? p2;
      if (!host || host === 'example.org') return m;
      const prefix = /^https?:\/\//i.test(m) ? m.match(/^https?:\/\//i)![0] : '';
      const www = /^(?:https?:\/\/)?www\./i.test(m) ? 'www.' : '';
      const bare = host.replace(/^www\./i, '');
      if (KNOWN_HOSTS.test(bare)) {
        if (pathPart && pathPart.length > 1) count('link');
        return `${prefix}${www}${bare}`;
      }
      count('link');
      return `${prefix}${www}example.org`;
    });

    // names (cashier, customer, greetings)
    const nm = c.match(NAME);
    if (nm && /[A-Za-zÄÖÜäöü]{2,}/.test(nm[2]) && !/^(?:sie|dich|du|ihr)\b/i.test(nm[2].trim())) {
      c = nm[1] + 'Muster';
      count('name');
    }

    const hasDate = /\b\d{1,2}\.\d{1,2}\.(?:\d{2,4})?|\b\d{4}-\d{2}-\d{2}|\b\d{1,2}:\d{2}\b/.test(c);
    const hasLabel = /:/.test(c) || LOYALTY.test(c) || CARD.test(c) || IDS.test(c);
    if (header && !hasDate && !hasLabel && c.trim() !== 'Muster' && !/example\.org/.test(c)) {
      // header: store name and address
      const t = c.trim();
      // column titles and document names say nothing about anyone
      if (/^(?:artikel(?:bezeichnung)?|bezeichnung|menge|bestellmenge|liefermenge|einzelpreis|preis|betrag|summe|abholavis|lieferavis|lieferschein|rechnung|kassenbon|kundenbeleg|e-?bon|zahlungsart|zahlung im markt|eur|€)$/i.test(t)) return c;
      // values without letters (customer / order / market numbers in a column of their own)
      if (!/[A-Za-zÄÖÜäöü]/.test(t)) return maskDigits(c, 1, 'ids');
      if (/^(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{5,}$/.test(t)) {
        count('ids');
        return indent + t.replace(/[A-Za-z]/g, 'X').replace(/\d/g, '0');
      }
      if (CHAIN.test(t) && !/\d{5}/.test(t)) {
        // keep the chain and legal-form words, replace the rest (a merchant's name: "EDEKA Center Muster e.K.")
        let replaced = 0;
        const words = t.split(/(\s+)/).map((w) => {
          if (/^\s+$/.test(w)) return w;
          const lw = w.toLowerCase().replace(/[,;:]$/, '');
          if (SAFE_WORDS.has(lw) || CHAIN.test(w) || /^[&+.,()-]+$/.test(w)) return w;
          if (/^\d+$/.test(w)) return zeros(w);
          replaced++;
          return 'Muster';
        });
        if (replaced) count('address');
        return indent + words.join('').replace(/(?:Muster\s+)+Muster/g, 'Muster');
      }
      if (/^(?:tel|telefon|fon|fax|phone)\b/i.test(t) || new RegExp(PHONE.source).test(t)) {
        count('phone');
        return indent + (/^[\d\s/+()-]+$/.test(t) ? '01234 567890' : 'Tel.: 01234 567890');
      }
      if (/\b(?:ust|uid|steuer|st\.?-?nr|vat)/i.test(t)) return maskDigits(c, 2, 'tax_id');
      count('address');
      if (/\b\d{5}\b/.test(t)) return indent + (STREET.test(t) ? 'Musterstraße 1, 12345 Musterstadt' : '12345 Musterstadt');
      if (STREET.test(t)) return indent + 'Musterstraße 1';
      return indent + 'Musterstadt';
    }
    if (header && /\b(?:ust|uid|steuer|st\.?-?nr|vat)/i.test(c)) c = maskDigits(c, 2, 'tax_id');

    // addresses anywhere: "Zinnhütte 11-13", "21255 Tostedt"
    if (!/\d,\d\d/.test(c)) {
      if (POSTCODE_LINE.test(c.trim())) {
        count('address');
        return indent + '12345 Musterstadt';
      }
      c = c.replace(STREET, () => {
        count('address');
        return 'Musterstraße 1';
      });
      const POST_CITY = /\b(?:D-)?\d{5}\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß]+(?:[ -][A-ZÄÖÜ][A-Za-zÄÖÜäöüß.]+)*/g;
      if (POST_CITY.test(c)) {
        // an address written in one line: "…, Zinnhütte 11-13, 21255 Tostedt" – the street has no suffix to go by
        c = c.replace(/\b[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+(?:\s[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.-]+)?\s+\d{1,4}\s?[a-z]?(?:\s?[-–]\s?\d{1,4}\s?[a-z]?)?(?=\s*,)/g, () => {
          count('address');
          return 'Musterstraße 1';
        });
      }
      c = c.replace(POST_CITY, () => {
        count('address');
        return '12345 Musterstadt';
      });
    }

    // phone numbers
    c = c.replace(PHONE, (m) => {
      if (/^\d{1,2}\.\d/.test(m) || m.replace(/\D/g, '').length < 6) return m;
      count('phone');
      return '01234 567890';
    });

    // loyalty programmes: numbers, points and balances
    if (flags.loyalty) {
      c = c.replace(/[#*xX•]{3,}\s*\d+/g, (m) => {
        count('loyalty');
        return zeros(m);
      });
      c = maskDigits(c, 2, 'loyalty');
      // balances and collected amounts after the total are personal; discounts in the item area are not
      if (!itemArea) c = c.replace(/\d{1,4},\d\d(?!\d)/g, '0,00').replace(/\b\d{1,3}(?:\.\d{3})+\b/g, '0');
    }
    // payment cards and terminal data
    if (flags.card) {
      c = c.replace(/[#*xX•]{3,}\s*\d+(?:\s+\d+)?/g, (m) => {
        count('card');
        return m.replace(/\d/g, '0');
      });
      c = maskDigits(c, 2, 'card');
    }
    // branch, till, operator, receipt and order numbers (also alphanumeric ones: "B-7RA-6US-RBE")
    if (flags.ids || flags.card || flags.loyalty) {
      c = c.replace(/\b(?=[A-Za-z0-9-]*\d)(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9-]{4,}\b/g, (m) => {
        if (/^\d+(?:g|kg|ml|l|er|x\d+)$/i.test(m) || /^[A-Z]{2}0+$/.test(m)) return m;
        count('ids');
        return m.replace(/[A-Za-z]/g, 'X').replace(/\d/g, '0');
      });
    }
    if (flags.ids) c = maskDigits(c, 2, 'ids');

    c = shiftDates(c);
    // safety net: any remaining run of 5+ digits outside item lines
    return maskDigits(c, 5, 'ids');
  };

  const out: string[] = [];
  let lastWasRemoved = false;
  for (let i = 0; i < rows.length; i++) {
    let line = rows[i];
    const trimmed = line.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }

    // ---- signature blobs and other opaque tokens: drop (collapse into one marker)
    if (B64.test(line) && !PRICE_END.test(line)) {
      if (!lastWasRemoved) out.push(line.match(/^\s*/)![0] + '[removed]');
      count('tse');
      lastWasRemoved = true;
      continue;
    }
    lastWasRemoved = false;

    // ---- IBAN, VAT ids, tax numbers (anywhere)
    line = line.replace(IBAN, (m) => {
      count('card');
      return m.slice(0, 2) + zeros(m.slice(2)).replace(/[A-Z]/g, '0');
    });
    line = line.replace(VAT, (m) => {
      count('tax_id');
      return m.slice(0, 2) + zeros(m.slice(2));
    });
    line = line.replace(TAXNO, (m) => {
      count('tax_id');
      return zeros(m);
    });

    const isItemArea = inItems(i);
    const isPricedItem = isItemArea && PRICE_END.test(line);
    const isQtyOrWeight = QTY_LINE.test(line) || WEIGHT_LINE.test(line);

    if (isPricedItem || (isItemArea && isQtyOrWeight)) {
      // item, quantity, weight, deposit and discount lines stay as they are – except long codes
      // (gift cards, vouchers, EANs) that could identify a purchase
      line = maskDigits(line, 8, 'ids');
      out.push(line);
      continue;
    }

    // ---- TSE block
    if (TSE.test(line)) {
      // keep only the label ("TSE-Signatur:"), never a value – also when several fields share a line
      const indent = line.match(/^\s*/)![0];
      const colon = trimmed.indexOf(':');
      const firstDigit = trimmed.search(/\d/);
      let label: string;
      if (colon > 0 && (firstDigit < 0 || colon < firstDigit)) label = trimmed.slice(0, colon + 1);
      else {
        const words: string[] = [];
        for (const w of trimmed.split(/\s+/)) {
          if (/\d/.test(w) || w.length > 24 || words.length >= 3) break;
          words.push(w);
        }
        label = words.join(' ') || 'TSE';
      }
      out.push(`${indent}${label} [removed]`);
      count('tse');
      continue;
    }

    // what the whole line is about decides how strictly its numbers are masked (labels and values are often
    // in different columns: "Beleg-Nr.            5224")
    const flags = { loyalty: LOYALTY.test(line), card: CARD.test(line), ids: IDS.test(line) };
    const header = firstItem >= 0 && i < firstItem && !TOTAL.test(trimmed);
    // two-column layouts (REWE notices: address left, order data right) – every column on its own
    const parts = line.split(/(\s{3,})/);
    const cells = parts.map((p, k) => (k % 2 === 1 || !p.trim() ? p : scrubCell(p, header, isItemArea, flags)));
    out.push(cells.join('').replace(/\s+$/, ''));
  }
  return { text: out.join('\n'), removed };
}

/** Human-readable list of what was removed (English source strings, translated by the caller). */
export const REDACTION_LABELS: Record<RedactionKind, string> = {
  address: 'store address',
  phone: 'phone numbers',
  tax_id: 'tax and VAT numbers',
  card: 'card and account numbers',
  loyalty: 'loyalty card numbers, points and balances',
  name: 'names',
  email: 'e-mail addresses',
  link: 'personal links',
  tse: 'TSE signature and transaction data',
  ids: 'receipt, till and branch numbers',
  date: 'exact dates (moved to the 1st of the month)',
  time: 'exact times (rounded to the hour)',
};
