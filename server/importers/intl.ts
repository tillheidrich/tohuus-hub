/**
 * Sam receipts from the UK, the US and Sweden (pdftotext -layout output, plain-text or HTML mail bodies).
 *
 * The German chains have their own grammar in generic.ts. This one is region-aware:
 *
 *   number styles      uk/us: 1,234.56   se: 1 234,56 / 1.234,56   (prefix £ $ €, suffix kr / SEK / :-)
 *   item line          NAME [UPC] [FLAG]      PRICE [TAX FLAG]      (Walmart: "GV MILK 1G 007874235186 F 3.48 N")
 *                      DPCI NAME  FLAG        $PRICE                (Target: "212030123 GG MILK  NF  $4.29")
 *                      NAME  EAN  UNIT  QTY st|kg  TOTAL            (ICA column layout)
 *   quantity           2 x £1.10 · 2 @ 1.99 · 2 st x 12,90 · 2st*12,90 [TOTAL]   before or after the item
 *   weighed goods      0.540 kg @ £0.99/kg · 2.68 lb @ 0.46 /lb · 2.68 lb @ 1 lb /0.46 · 0,812kg x 24,90kr/kg
 *   discounts          Clubcard Price, Nectar Price, Multibuy/Meal Deal saving, coupons, BOGO, "SC … SAVINGS 0.50-",
 *                      Rabatt, Stammispris, Medlemspris, "2 för 30" → folded into the item above
 *   deposits           US "BOTTLE DEP" / "CRV", Swedish "Pant" / "Pantretur" → status 'deposit'
 *   tax                US "TAX 1 7.000 % 1.23" is added on top (sum + tax = total); UK VAT / Swedish moms are included
 *   total              TOTAL · BALANCE DUE · AMOUNT DUE · Totalt · Att betala · Summa att betala   (not SUBTOTAL)
 *
 * Pure (no database). Returns null when the text does not look like a receipt.
 */
import type { ParsedImport } from './types.js';
import type { GenericLine } from './generic.js';

export type Grammar = 'uk' | 'us' | 'se';
export type NumberStyle = 'dot' | 'comma';

export const styleOf = (g: Grammar): NumberStyle => (g === 'se' ? 'comma' : 'dot');

/**
 * Parse an amount written in a regional style.
 * dot: "1,234.56" / "1234.56" / "-£0.75" / "0.50-";  comma: "1 234,56" / "1.234,56" / "12,90 kr" / "-5,00".
 * Without a style the last separator followed by exactly two digits is the decimal mark.
 */
export function parseLocaleNumber(input: string, style?: NumberStyle): number {
  const s = String(input).replace(/[  ]/g, ' ').trim();
  const negative = /^-|^\(.*\)$|-$|^[£$€]\s?-|−/.test(s.replace(/\s/g, ''));
  let core = s.replace(/[^\d.,' ]/g, '').trim();
  let st = style;
  if (!st) {
    const lastDot = core.lastIndexOf('.');
    const lastComma = core.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) st = lastDot > lastComma ? 'dot' : 'comma';
    // "1,234" is a thousand (en), "0,812" and "12,90" are decimals (de/sv)
    else if (lastComma >= 0) st = /^[1-9]\d{0,2}(,\d{3})+$/.test(core) ? 'dot' : 'comma';
    else st = 'dot';
  }
  if (st === 'dot') core = core.replace(/[, ']/g, '');
  else core = core.replace(/[ .']/g, '').replace(',', '.');
  const n = Number(core);
  if (!Number.isFinite(n)) return NaN;
  return negative ? -n : n;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- store detection

export interface IntlStore {
  key: string;
  name: string;
  /** null = the chain exists in several countries; grammar then comes from cues or the household region */
  grammar: Grammar | null;
  drugstore?: boolean;
}

interface StoreDef extends IntlStore {
  header: RegExp;
  anywhere?: RegExp;
}

const STORES: StoreDef[] = [
  // UK
  { key: 'tesco', name: 'Tesco', grammar: 'uk', header: /\btesco\b/i, anywhere: /tesco\.com|clubcard/i },
  { key: 'sainsburys', name: "Sainsbury's", grammar: 'uk', header: /\bsainsbury'?s?\b/i, anywhere: /sainsburys\.co\.uk|nectar/i },
  { key: 'asda', name: 'Asda', grammar: 'uk', header: /\basda\b/i, anywhere: /asda\.com/i },
  { key: 'morrisons', name: 'Morrisons', grammar: 'uk', header: /\bmorrisons\b/i, anywhere: /morrisons\.com|more card/i },
  { key: 'waitrose', name: 'Waitrose', grammar: 'uk', header: /\bwaitrose\b/i, anywhere: /waitrose\.com|mywaitrose/i },
  { key: 'ms', name: 'M&S', grammar: 'uk', header: /marks\s*(?:&|and)\s*spencer|\bM\s?&\s?S\b/i, anywhere: /marksandspencer\.com/i },
  { key: 'coop-uk', name: 'Co-op', grammar: 'uk', header: /\bco-op\b|co-operative|cooperative food/i, anywhere: /coop\.co\.uk/i },
  { key: 'boots', name: 'Boots', grammar: 'uk', header: /\bboots\b/i, anywhere: /boots\.com|advantage card/i, drugstore: true },
  { key: 'superdrug', name: 'Superdrug', grammar: 'uk', header: /\bsuperdrug\b/i, drugstore: true },
  // US
  { key: 'walmart', name: 'Walmart', grammar: 'us', header: /\bwal[- ]?mart\b/i, anywhere: /walmart\.com/i },
  { key: 'target', name: 'Target', grammar: 'us', header: /^\s*target\b|\btarget\.com\b|\bsuper\s?target\b/im, anywhere: /target\.com|target circle/i },
  { key: 'costco', name: 'Costco', grammar: 'us', header: /\bcostco\b/i, anywhere: /costco\.com/i },
  { key: 'kroger', name: 'Kroger', grammar: 'us', header: /\bkroger\b/i, anywhere: /kroger\.com/i },
  { key: 'traderjoes', name: "Trader Joe's", grammar: 'us', header: /\btrader\s+joe'?s?\b/i, anywhere: /traderjoes\.com/i },
  { key: 'wholefoods', name: 'Whole Foods', grammar: 'us', header: /\bwhole\s*foods\b/i, anywhere: /wholefoodsmarket\.com/i },
  { key: 'safeway', name: 'Safeway', grammar: 'us', header: /\bsafeway\b/i, anywhere: /safeway\.com/i },
  { key: 'cvs', name: 'CVS', grammar: 'us', header: /\bcvs\b/i, anywhere: /cvs\.com|extracare/i, drugstore: true },
  { key: 'walgreens', name: 'Walgreens', grammar: 'us', header: /\bwalgreens\b/i, drugstore: true },
  // Sweden
  { key: 'ica', name: 'ICA', grammar: 'se', header: /\bICA\b/, anywhere: /ica\.se|stammis/i },
  { key: 'willys', name: 'Willys', grammar: 'se', header: /\bwillys\b/i, anywhere: /willys\.se/i },
  { key: 'hemkop', name: 'Hemköp', grammar: 'se', header: /\bhemk(?:ö|o)p\b/i, anywhere: /hemkop\.se/i },
  { key: 'citygross', name: 'City Gross', grammar: 'se', header: /\bcity\s*gross\b/i, anywhere: /citygross\.se/i },
  { key: 'coop-se', name: 'Coop', grammar: 'se', header: /\bcoop\b(?!-)/i, anywhere: /coop\.se|medlemspris/i },
  { key: 'apotek', name: 'Apotek Hjärtat', grammar: 'se', header: /apotek\s*hj(?:ä|a)rtat/i, drugstore: true },
  // several countries
  { key: 'lidl', name: 'Lidl', grammar: null, header: /\blidl\b/i, anywhere: /lidl\.(?:co\.uk|se|com)|lidl plus/i },
  { key: 'aldi', name: 'Aldi', grammar: null, header: /\baldi\b/i, anywhere: /aldi\.(?:co\.uk|us)/i },
];

const COUNTRY_SUFFIX: Record<Grammar, string> = { uk: 'UK', us: 'US', se: 'SE' };

export function detectIntlStore(text: string): IntlStore | null {
  const header = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n');
  for (const s of STORES) if (s.header.test(header)) return { key: s.key, name: s.name, grammar: s.grammar, drugstore: s.drugstore };
  for (const s of STORES) if (s.anywhere?.test(text)) return { key: s.key, name: s.name, grammar: s.grammar, drugstore: s.drugstore };
  return null;
}

/** Which country's receipt is this, judging by currency signs and keywords? null = no clear signal. */
export function receiptCues(text: string): Grammar | 'de' | null {
  const score = { uk: 0, us: 0, se: 0, de: 0 };
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  score.uk += count(/£\s?\d/g) * 2 + count(/\bGBP\b|\bVAT\b|clubcard|nectar|\.co\.uk\b|multibuy/gi) * 2;
  score.us += count(/\$\s?\d/g) * 2 + count(/\bUSD\b|sales tax|^\s*tax\s+\d|#\s?items sold|\bEBT\b|\bCRV\b|bottle dep/gim) * 2;
  score.se += count(/\d,\d\d\s?kr\b|\bSEK\b/gi) * 2 + count(/\bmoms\b|att betala|\btotalt\b|\bpant\b|stammis|medlemspris|org\.?\s?nr|kvitto/gi) * 2;
  score.de += count(/\d,\d\d\s?(?:€|EUR)\b/g) * 2 + count(/\bsumme\b|\bmwst\b|zu zahlen|\bpfand\b|bon-?nr|r(?:ü|ue)ckgeld/gi) * 2;
  const best = (Object.entries(score) as [Grammar | 'de', number][]).sort((a, b) => b[1] - a[1]);
  if (best[0][1] === 0 || best[0][1] === best[1][1]) return null;
  return best[0][0];
}

// ---------------------------------------------------------------- grammar

interface Rx {
  item: RegExp;
  itemLoose: RegExp;
  column: RegExp;
  qty: RegExp;
  weight: RegExp;
  total: RegExp;
  tax: RegExp;
  price: RegExp;
}

const FLAG = String.raw`(?:\s+(?:[A-Z]{1,2}\*?|\*|[A-Z]\s[A-Z]))?`;

function grammarRx(g: Grammar): Rx {
  const core = g === 'se' ? String.raw`\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}` : String.raw`\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}`;
  const coreTotal = g === 'se' ? String.raw`\d{1,3}(?:[ . ]\d{3})+,\d{2}|\d+,\d{2}` : core;
  const cur = String.raw`(?:[£$€]\s?)`;
  const suf = String.raw`(?:\s?(?:kr|SEK|:-|USD|GBP))?`;
  const P = String.raw`(?:-\s?)?${cur}?-?(?:${core})-?${suf}`;
  const PT = String.raw`(?:-\s?)?${cur}?-?(?:${coreTotal})-?${suf}`;
  const W = String.raw`\d{1,4}(?:[.,]\d{1,3})?`;
  const item = (sep: string) => new RegExp(String.raw`^\s*(\S.*?)${sep}(${P})${FLAG}\s*$`);
  return {
    item: item(String.raw`\s{2,}`),
    itemLoose: item(String.raw`\s+`),
    column: new RegExp(String.raw`^\s*(\S.*?)\s{2,}(?:\d{8,14}\s+)?(${P})\s+(${W})\s*(st|kg|g|pcs)\s+(${P})\s*$`, 'i'),
    qty: new RegExp(String.raw`^\s*(\d{1,3})\s*(?:st|pcs|stk)?\s*(?:@|x|×|\*)\s*(${P})\s*(?:ea\.?|each|\/\s?st|\/\s?ea|st)?(?:\s+(${P})${FLAG})?\s*$`, 'i'),
    weight: new RegExp(
      String.raw`^\s*(?:(?:WT|NET|Net\s+wt)\s+)?(${W})\s*(kg|lbs?|g)\s*(?:@|x|×|\*)\s*(?:1\s*(?:kg|lb)\s*\/\s*)?(${P})\s*(?:\/\s*(?:kg|lb))?(?:\s+(${P})${FLAG})?\s*$`,
      'i',
    ),
    total: new RegExp(
      String.raw`^[\s*]*(?:total(?!\s*(?:savings?|discounts?|tax|items?|number|points|you saved))|balance(?:\s+due)?|amount\s+due|total\s+to\s+pay|totalt|att\s+betala|summa(?:\s+att\s+betala)?(?:\s*\(sek\))?|total\s+sek)\b[^\d\n£$-]*(${PT})`,
      'i',
    ),
    // "TAX 1 6.250 % 0.56", "SALES TAX 0.56", Target "T = ST TAX 8.25000 on $2.79 $0.23"
    tax: new RegExp(String.raw`^\s*(?:[^\d\n]{0,12}?\s)?(?:sales\s+)?tax\b.*?(${P})\s*$`, 'i'),
    price: new RegExp(`(${P})`),
  };
}

const SKIP =
  /^[\s*]*(?:sub[- ]?total|delsumma|mellansumma|total\s+(?:savings?|discounts?|items?|tax|points)|you saved|savings total|sales tax|tax\b|vat\b|moms\b|netto|brutto|visa|mastercard|master card|amex|american express|debit|credit|cash|change|card\b|contactless|kort\b|kortbetalning|kontant|v(?:ä|a)xel|betalt|bankkort|swish|ebt|tend|\d*\s*items?\s+sold|#\s?items|number of items|antal|tc#|st#|op#|te#|tr#|ref\b|auth|aid\b|terminal|merchant|receipt|kvitto|org\.?\s*nr|tel\b|phone|www|thank|tack|vat no|vat reg|beskrivning|description|art\.?\s*nr|clubcard points|points|po[aä]ng|store\b|manager|cashier|kassa|kassör|served by|date|datum|time|tid)\b/i;
/** deposits and fees (carrier bags) – kept on the receipt, never booked into stock */
const DEPOSIT = /\b(?:pant|pantretur|returpant|crv|bottle\s*dep(?:osit)?|btl\s*dep|can\s*dep|deposit|carrier\s*bag|bag\s*(?:charge|fee)|b(?:ä|a)rkasse|plastkasse|papperskasse)\b/i;
const DISCOUNT =
  /saving|savings|clubcard|nectar|multibuy|meal deal|coupon|\bbogo\b|discount|promo|price cut|rollback|\bsc\s|rabatt|medlemspris|stammis|erbjudande|kampanj|\bf(?:ö|o)r\s+\d|mix\s?&\s?match|\bplus\s?pris|willys plus/i;

function parseDate(text: string, g: Grammar): { iso: string; time: string | null } | null {
  const mk = (y: number, mo: number, d: number, hh?: string, mm?: string, ampm?: string) => {
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000 || y > 2100) return null;
    let h = hh ? Number(hh) : null;
    if (h != null && ampm) h = (h % 12) + (/p/i.test(ampm) ? 12 : 0);
    return { iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, time: h != null ? `${String(h).padStart(2, '0')}:${mm}` : null };
  };
  if (g === 'se') {
    for (const m of text.matchAll(/(?<!\d)(20\d{2}|\d{2})-(\d{2})-(\d{2})(?!\d)(?:\D{0,12}?(\d{1,2}):(\d{2}))?/g)) {
      const r = mk(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5]);
      if (r) return r;
    }
  }
  for (const m of text.matchAll(/(?<![\d/])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/])(?:\D{0,12}?(\d{1,2}):(\d{2})(?::\d{2})?\s?([AaPp][Mm])?)?/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const [d, mo] = g === 'us' ? [b, a] : [a, b];
    const r = mk(Number(m[3]), mo, d, m[4], m[5], m[6]);
    if (r) return r;
  }
  // ISO dates also appear on UK/US e-receipts
  for (const m of text.matchAll(/(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)(?:\D{0,12}?(\d{1,2}):(\d{2}))?/g)) {
    const r = mk(Number(m[1]), Number(m[2]), Number(m[3]), m[4], m[5]);
    if (r) return r;
  }
  return null;
}

/** "GV MILK 1G   007874235186 F" → "GV MILK 1G";  "212030123  GG MILK   NF" → "GG MILK";  "E  1234567 KS WATER" → "KS WATER" */
export function cleanItemName(raw: string): string {
  return raw
    .replace(/^(?:WT|NET)\s+/, '')
    .replace(/^(?:[A-Z]\s+)?\d{5,13}\s+(?=\S*[A-Za-zÅÄÖåäö])/, '')
    .replace(/\s+\d{6,14}(?:\s*[A-Z]{1,2})?\s*$/, '')
    .replace(/\s{2,}[A-Z]{1,2}\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const LB = 0.45359237;

interface Pending {
  qty?: number;
  unitPrice?: number;
  weightKg?: number;
  pricePerUnit?: number;
  wUnitQty?: number;
  note?: string;
  raw: string;
}

function readItems(rows: string[], g: Grammar, loose: boolean) {
  const rx = grammarRx(g);
  const style = styleOf(g);
  const amount = (s: string) => round2(parseLocaleNumber(s, style));
  const lines: GenericLine[] = [];
  let total: number | null = null;
  let tax = 0;
  let discounts = 0;
  let pendingName: string | null = null;
  let pending: Pending | null = null;
  const LETTERS = /[A-Za-zÅÄÖÆØåäöæø]/;

  const push = (rawName: string, price: number, raw: string, qty = 1, unitPrice?: number) => {
    const name = cleanItemName(rawName);
    const l: GenericLine = {
      raw,
      name,
      qty,
      unit: null,
      price,
      unitPrice: unitPrice ?? (qty ? round2(price / qty) : price),
      status: DEPOSIT.test(name) ? 'deposit' : 'ok',
    };
    if (pending) {
      if (pending.qty && pending.unitPrice != null && near(pending.qty * pending.unitPrice, price)) {
        l.qty = pending.qty;
        l.unitPrice = pending.unitPrice;
        l.raw = `${pending.raw} | ${l.raw}`;
      } else if (pending.weightKg && pending.pricePerUnit != null && near((pending.wUnitQty ?? 0) * pending.pricePerUnit, price, 0.02)) {
        l.weightKg = pending.weightKg;
        l.note = pending.note;
        l.raw = `${pending.raw} | ${l.raw}`;
      }
      pending = null;
    }
    lines.push(l);
    pendingName = null;
    return l;
  };

  const applyDiscount = (label: string, value: number, raw: string) => {
    const neg = -Math.abs(value);
    const last = lines[lines.length - 1];
    if (last && last.status !== 'deposit') {
      last.price = round2((last.price ?? 0) + neg);
      last.note = [last.note, `${label.trim()} ${neg.toFixed(2)}`].filter(Boolean).join(' · ');
      last.raw += ' | ' + raw;
    }
    discounts = round2(discounts + neg);
  };

  for (const row of rows) {
    const line = row.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-=_*·.#]{5,}$/.test(trimmed)) continue;

    const tot = trimmed.match(rx.total);
    if (tot) {
      if (lines.length) {
        total = round2(parseLocaleNumber(tot[1], style));
        break;
      }
      continue;
    }
    // sales tax (US) is added on top of the items
    if (g === 'us') {
      const tx = trimmed.match(rx.tax);
      if (tx && lines.length) {
        tax = round2(tax + amount(tx[1]));
        continue;
      }
    }
    const last = lines[lines.length - 1];

    // weighed goods
    const w = line.match(rx.weight);
    if (w) {
      const qtyW = parseLocaleNumber(w[1], w[1].includes(',') ? 'comma' : 'dot');
      const unit = w[2].toLowerCase();
      const kg = unit.startsWith('lb') ? qtyW * LB : unit === 'g' ? qtyW / 1000 : qtyW;
      const per = Math.abs(amount(w[3]));
      const unitQty = unit === 'g' ? qtyW / 1000 : qtyW;
      const note = `${w[1]} ${unit.startsWith('lb') ? 'lb' : unit}`;
      const weightKg = Math.round(kg * 1000) / 1000;
      if (w[4] && pendingName) {
        const l = push(pendingName, amount(w[4]), `${pendingName} | ${trimmed}`);
        l.weightKg = weightKg;
        l.note = note;
      } else if (last && !last.weightKg && near(unitQty * per, last.price ?? NaN, 0.02)) {
        last.weightKg = weightKg;
        last.note = [last.note, note].filter(Boolean).join(' · ');
        last.raw += ' | ' + trimmed;
      } else if (w[4] && !last) {
        // weight line without a name: keep it, the name is unknown
        const l = push(note, amount(w[4]), trimmed);
        l.weightKg = weightKg;
      } else pending = { weightKg, pricePerUnit: per, wUnitQty: unitQty, note, raw: trimmed };
      continue;
    }

    // quantity line
    const q = line.match(rx.qty);
    if (q) {
      const qty = Number(q[1]);
      const unit = Math.abs(amount(q[2]));
      if (q[3] && pendingName) push(pendingName, amount(q[3]), `${pendingName} | ${trimmed}`, qty, unit);
      else if (last && last.qty === 1 && near(qty * unit, last.price ?? NaN)) {
        last.qty = qty;
        last.unitPrice = unit;
        last.raw += ' | ' + trimmed;
      } else if (!q[3]) pending = { qty, unitPrice: unit, raw: trimmed };
      continue;
    }

    // ICA column layout: NAME  [EAN]  UNIT PRICE  QTY st|kg  TOTAL
    const c = line.match(rx.column);
    if (c && LETTERS.test(c[1]) && !SKIP.test(c[1])) {
      const per = amount(c[2]);
      const n = parseLocaleNumber(c[3], c[3].includes(',') ? 'comma' : 'dot');
      const unit = c[4].toLowerCase();
      const price = amount(c[5]);
      if (DISCOUNT.test(c[1]) && !DEPOSIT.test(c[1])) {
        applyDiscount(c[1], price, trimmed);
        continue;
      }
      if (unit === 'kg' || unit === 'g') {
        const l = push(c[1], price, trimmed);
        l.weightKg = Math.round((unit === 'g' ? n / 1000 : n) * 1000) / 1000;
        l.note = `${c[3]} ${unit}`;
      } else push(c[1], price, trimmed, Math.max(1, Math.round(n)), per);
      continue;
    }

    const m = line.match(loose ? rx.itemLoose : rx.item);
    if (m && !SKIP.test(m[1].trim())) {
      const label = m[1].trim();
      const value = amount(m[2]);
      if (DEPOSIT.test(label)) {
        push(label, value, trimmed);
        continue;
      }
      // discounts: a negative amount, or a known saving keyword (Clubcard Price, Nectar, coupons …)
      if (value < 0 || DISCOUNT.test(label)) {
        applyDiscount(label, value, trimmed);
        continue;
      }
      if (!LETTERS.test(label)) continue;
      push(label, value, trimmed);
      continue;
    }

    // name without a price: the weight/quantity line with the total follows
    if (LETTERS.test(trimmed) && !rx.price.test(trimmed) && trimmed.length <= 48 && !SKIP.test(trimmed)) pendingName = trimmed;
    else pendingName = null;
  }
  return { lines, total, tax: round2(tax), discounts };
}

export interface IntlOptions {
  /** force a grammar; otherwise store, cues, then `fallback` decide */
  grammar?: Grammar;
  /** the household region's grammar, used when the text gives no clear signal */
  fallback?: Grammar;
  fallbackTitle?: string;
  currency?: string;
}

const CURRENCY: Record<Grammar, string> = { uk: 'GBP', us: 'USD', se: 'SEK' };

/** Decide which grammar fits: explicit > store > cues > fallback. Returns null for German receipts. */
export function intlGrammarFor(text: string, fallback?: Grammar | 'de' | null): Grammar | null {
  const store = detectIntlStore(text);
  const cue = receiptCues(text);
  if (store?.grammar) return store.grammar;
  if (cue === 'de') return null;
  if (cue) return cue;
  if (fallback && fallback !== 'de') return fallback;
  return null;
}

export function parseIntlReceipt(text: string, opts: IntlOptions = {}): ParsedImport | null {
  const clean = text.replace(/\r/g, '').replace(/[  ]/g, ' ').replace(/\t/g, '    ');
  const g = opts.grammar ?? intlGrammarFor(clean, opts.fallback);
  if (!g) return null;
  const rows = clean.split('\n');
  let res = readItems(rows, g, false);
  if (res.lines.filter((l) => l.status !== 'deposit').length === 0) res = readItems(rows, g, true);
  const { lines, total, tax } = res;
  const goods = lines.filter((l) => l.status !== 'deposit');
  if (goods.length === 0 || total == null) return null;
  const itemsSum = round2(lines.reduce((s, l) => s + (l.price ?? 0), 0));
  const sumMatches = near(itemsSum + tax, total, 0.03);
  const found = detectIntlStore(clean);
  if (!sumMatches && !found) return null;

  const storeName = found ? (found.grammar ? found.name : `${found.name} ${COUNTRY_SUFFIX[g]}`) : null;
  const storeKey = found ? (found.grammar ? found.key : `${found.key}-${g}`) : null;
  if (found?.drugstore) for (const l of goods) l.categoryHint = /food|snack|drink|water|juice|candy|chocolate|tea\b|coffee|godis|dryck/i.test(l.name) ? null : /bin bag|detergent|washing|cleaner|batter|foil|sponge|tissue|toilet roll|paper towel/i.test(l.name) ? 'household' : 'toiletries';

  const date = parseDate(clean, g);
  const receiptNo = clean.match(/(?:receipt\s*(?:no|#|number)?|trans(?:action)?\s*(?:no|#)?|trn|tr#|tc#|kvitto(?:nr|nummer)?|kvitto\s*nr|ref(?:erence)?\s*(?:no|#)?)\s*[:#.]?\s*(\d{3,})/i)?.[1] ?? null;
  const shown = date ? (g === 'us' ? `${date.iso.slice(5, 7)}/${date.iso.slice(8, 10)}/${date.iso.slice(0, 4)}` : g === 'se' ? date.iso : `${date.iso.slice(8, 10)}/${date.iso.slice(5, 7)}/${date.iso.slice(0, 4)}`) : null;
  const label = storeName ?? opts.fallbackTitle ?? 'Receipt';
  return {
    kind: 'receipt',
    title: shown ? `${label} · ${shown}` : label,
    shop: storeName,
    ref: date ? `rcpt-${storeKey ?? 'x'}-${date.iso}-${date.time ?? ''}-${receiptNo ?? ''}-${total}` : null,
    date: date ? `${date.iso}${date.time ? ' ' + date.time : ''}` : null,
    total,
    meta: {
      store: storeKey,
      drugstore: Boolean(found?.drugstore),
      country: COUNTRY_SUFFIX[g],
      currency: opts.currency ?? CURRENCY[g],
      receiptNo,
      tax: tax || null,
      sumMatches,
      itemsSum,
      discounts: res.discounts,
      parser: `intl-${g}`,
    },
    lines,
  };
}
