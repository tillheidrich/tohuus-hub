/**
 * Parsers for REWE documents, working on `pdftotext -layout` output:
 *  - Abholavis / Lieferavis (online order notice with substitutions, unavailable items, weights)
 *  - eBon (digital receipt from the till, also used for pickup orders)
 * Plus reconciliation: the eBon is the truth of what was actually taken home; items listed in the
 * avis but missing on the eBon were refused at pickup.
 */
import { parseGermanNumber, similarity } from '../lib/text.js';
import type { ParsedImport, ParsedLine } from './types.js';

const money = (s: string) => Math.round(parseGermanNumber(s) * 100) / 100;

export function detectReweKind(text: string): 'rewe-avis' | 'rewe-ebon' | null {
  if (/Abholavis|Lieferavis|Artikelbezeichnung\s+Bestellmenge/i.test(text)) return 'rewe-avis';
  if (/R\s?E\s?W\s?E/.test(text.slice(0, 400)) && /SUMME\s+EUR/.test(text)) return 'rewe-ebon';
  return null;
}

// ---------------------------------------------------------------- eBon

const EBON_ITEM = /^\s{0,3}(\S.*?)\s{2,}(-?\d{1,4},\d\d)\s+([A-C])(\s*\*)?\s*$/;
const EBON_QTY_STK = /^\s+(\d+)\s*Stk\s*x\s+(-?\d+,\d\d)/;
const EBON_QTY_KG = /(\d+,\d{3})\s*kg(?:\s*x\s+(\d+,\d\d)\s*EUR\/kg)?/;

export function parseReweEbon(text: string): ParsedImport {
  const rawLines = text.split('\n');
  const lines: ParsedLine[] = [];
  let i = 0;
  // header = everything until a line that is just "EUR"
  const header: string[] = [];
  for (; i < rawLines.length; i++) {
    const l = rawLines[i].trim();
    if (/^EUR$/.test(l)) {
      i++;
      break;
    }
    if (l) header.push(l);
  }
  for (; i < rawLines.length; i++) {
    const l = rawLines[i];
    if (/^\s*-{5,}/.test(l) || /SUMME/.test(l)) break;
    const m = l.match(EBON_ITEM);
    if (m) {
      const name = m[1].trim();
      const price = money(m[2]);
      const isDeposit = /^(PFAND|LEERG|LEERGUT|TRANSPORTBOX|SERVICEGEB)/i.test(name) || Boolean(m[4] && price <= 3.3 && /PFAND|LEER/i.test(name));
      lines.push({
        raw: l.trim(),
        name,
        qty: 1,
        unit: null,
        price,
        unitPrice: price,
        status: isDeposit ? 'deposit' : 'ok',
      });
      continue;
    }
    const last = lines[lines.length - 1];
    if (!last) continue;
    const q = l.match(EBON_QTY_STK);
    if (q) {
      last.qty = Number(q[1]);
      last.unitPrice = money(q[2]);
      last.raw += ' | ' + l.trim();
      continue;
    }
    const kg = l.match(EBON_QTY_KG);
    if (kg) {
      last.weightKg = parseGermanNumber(kg[1]);
      last.note = `${kg[1]} kg`;
      last.raw += ' | ' + l.trim();
    }
  }
  const total = text.match(/SUMME\s+EUR\s+(-?\d+,\d\d)/);
  const date = text.match(/Datum:\s+(\d\d)\.(\d\d)\.(\d{4})/) ?? text.match(/(\d\d)\.(\d\d)\.(\d{4})\s+\d\d:\d\d\s+Bon-Nr/);
  const time = text.match(/Uhrzeit:\s+(\d\d:\d\d)/);
  const bonNr = text.match(/Bon-Nr\.:\s*(\d+)/);
  const market = text.match(/Markt:\s*(\d+)/);
  const order = text.match(/Bestellnummer:\s*([\w-]+)/);
  const street = header[1] ?? '';
  const city = header[2] ?? '';
  const isoDate = date ? `${date[3]}-${date[2]}-${date[1]}` : null;
  return {
    kind: 'rewe-ebon',
    title: `REWE ${titleCity(city)} · Bon${isoDate ? ' vom ' + date![1] + '.' + date![2] + '.' : ''}`,
    shop: `REWE ${[street, city].filter(Boolean).join(', ')}`.trim(),
    ref: bonNr ? `bon-${market?.[1] ?? ''}-${bonNr[1]}-${isoDate ?? ''}` : null,
    date: isoDate ? `${isoDate}${time ? ' ' + time[1] : ''}` : null,
    total: total ? money(total[1]) : null,
    meta: { market: market?.[1] ?? null, orderNumber: order?.[1] ?? null, bonNr: bonNr?.[1] ?? null },
    lines,
  };
}

function titleCity(c: string) {
  const m = c.match(/\d{5}\s+(.*)/);
  const name = (m ? m[1] : c).trim();
  return name.charAt(0) + name.slice(1).toLowerCase();
}

// ---------------------------------------------------------------- Avis

const SECTION: Record<string, ParsedLine['status']> = {
  'nicht lieferbar': 'unavailable',
  ersatzartikel: 'substitute',
  'abweichende menge': 'reduced',
  lieferbar: 'ok',
  'gebühren und pfand': 'deposit',
};

const AVIS_ROW = /^(\S.*?)\s{2,}((?:\d+(?:\s?g)?\s{2,})?(?:\d+(?:\s?g)?)?)\s{2,}(\d+(?:\s?g)?)\s{2,}(\d+,\d\d)\s?€\s{2,}(\d+,\d\d)\s?€\s*$/;

export function parseReweAvis(text: string, filename?: string): ParsedImport {
  const rows = text.split('\n');
  const lines: (ParsedLine & { _ordered?: number | null; _delivered?: number; _weight?: boolean })[] = [];
  let section: ParsedLine['status'] = 'ok';
  for (const rawRow of rows) {
    const row = rawRow.replace(/\s+$/, '');
    const trimmed = row.trim();
    if (!trimmed) continue;
    if (/^Gesamtpreis/i.test(trimmed)) break;
    const sec = SECTION[trimmed.toLowerCase()];
    if (sec) {
      section = sec;
      continue;
    }
    if (/^Artikelbezeichnung|^\d+ von \d+$|^Seite \d/i.test(trimmed)) continue;
    const parsed = parseAvisRow(trimmed);
    if (parsed) {
      const { name, ordered, delivered, unitPrice, total, weight } = parsed;
      let status: ParsedLine['status'] = section;
      if (section === 'substitute') status = ordered && ordered > 0 && delivered === 0 ? 'unavailable' : 'substitute';
      lines.push({
        raw: trimmed,
        name,
        qty: weight ? (delivered > 0 ? 1 : 0) : delivered,
        unit: weight ? 'Stk' : null,
        price: total,
        unitPrice,
        weightKg: weight ? delivered / 1000 : null,
        status,
        ordered,
        note: weight ? `${delivered} g geliefert (bestellt ${ordered ?? '?'} g)` : null,
        _ordered: ordered,
        _delivered: delivered,
        _weight: weight,
      });
      continue;
    }
    // continuation of the previous article (name wraps, origin, Mehrweg/Einweg)
    const last = lines[lines.length - 1];
    if (!last) continue;
    if (/^Herkunftsland/i.test(trimmed)) {
      last.note = [last.note, trimmed.replace(/\s*\/\s*Klasse.*$/, '')].filter(Boolean).join(' · ');
    } else if (/^(Mehrweg|Einweg)$/i.test(trimmed)) {
      last.note = [last.note, trimmed].filter(Boolean).join(' · ');
    } else if (trimmed.length < 70 && !/[€:]/.test(trimmed)) {
      last.name = `${last.name} ${trimmed}`.replace(/\s+/g, ' ');
    }
  }
  // link substitutes to the article they replace (they follow directly after it)
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    if (l.status === 'substitute') {
      const prev = lines[k - 1];
      if (prev && prev.status === 'unavailable') {
        l.substituteFor = prev.name;
        prev.note = [prev.note, `ersetzt durch ${l.name}`].filter(Boolean).join(' · ');
      }
    }
    if (l.status === 'reduced') l.note = [l.note, `bestellt ${l._ordered}, geliefert ${l._delivered}`].filter(Boolean).join(' · ');
    // weight articles in "Lieferbar" with a second weight row and no ordered value belong to the same order line
    delete l._ordered;
    delete l._delivered;
    delete l._weight;
  }
  const orderNo = text.match(/Bestellnummer:\s+([A-Z0-9-]+)/)?.[1] ?? null;
  const fileNo = filename?.match(/(\d{6,})/)?.[1] ?? null;
  const pickup = text.match(/(?:Abholdatum|Lieferdatum):\s+(\d\d)\.(\d\d)\.(\d{4})(?:\s+(\d\d:\d\d))?/);
  const market = text.match(/Marktnummer:\s+([\d ]+)/)?.[1]?.replace(/\s+/g, '') ?? null;
  const total = text.match(/Gesamtpreis[^:]*:\s*(\d+,\d\d)/);
  const shopLine = text.match(/Markt:\s+(.*)/)?.[1]?.trim() ?? null;
  const mode = /Lieferavis/i.test(text) ? 'Lieferung' : 'Abholung';
  const iso = pickup ? `${pickup[3]}-${pickup[2]}-${pickup[1]}` : null;
  return {
    kind: 'rewe-avis',
    title: `REWE ${mode}${pickup ? ' am ' + pickup[1] + '.' + pickup[2] + '.' : ''}`,
    shop: shopLine ? `REWE ${(shopLine.match(/\d{5}\s+([^,]+)/)?.[1] ?? '').trim()}`.trim() : null,
    ref: orderNo,
    date: iso ? `${iso}${pickup?.[4] ? ' ' + pickup[4] : ''}` : null,
    total: total ? money(total[1]) : null,
    meta: { orderNumber: orderNo, fileOrderNumber: fileNo, market, marketShort: market?.slice(-4) ?? null, mode, marketAddress: shopLine },
    lines,
  };
}

function parseAvisRow(row: string) {
  // split columns on 2+ spaces, then read from the right: total €, unit €, delivered, [ordered]
  const cols = row.split(/\s{2,}/);
  if (cols.length < 4) return null;
  const totalS = cols[cols.length - 1];
  const unitS = cols[cols.length - 2];
  if (!/^\d+,\d\d\s?€$/.test(totalS) || !/^\d+,\d\d\s?€$/.test(unitS)) return null;
  const qtyRe = /^(\d+)(\s?g)?$/;
  const deliveredS = cols[cols.length - 3];
  const orderedS = cols.length >= 5 ? cols[cols.length - 4] : null;
  const dm = deliveredS.match(qtyRe);
  if (!dm) return null;
  let nameEnd = cols.length - 3;
  let ordered: number | null = null;
  if (orderedS && qtyRe.test(orderedS)) {
    ordered = Number(orderedS.match(qtyRe)![1]);
    nameEnd = cols.length - 4;
  }
  const name = cols.slice(0, nameEnd).join(' ').trim();
  if (!name) return null;
  return {
    name,
    ordered,
    delivered: Number(dm[1]),
    unitPrice: money(unitS.replace('€', '')),
    total: money(totalS.replace('€', '')),
    weight: Boolean(dm[2]) || Boolean(orderedS && / ?g$/.test(orderedS)),
  };
}

// ---------------------------------------------------------------- reconciliation

export interface ReconcileResult {
  /** index in avis.lines → kept qty (0 = refused at pickup) */
  kept: Map<number, number>;
  /** avis line index → eBon receipt name, to learn as alias */
  aliases: Map<number, string>;
  /** eBon lines that did not match anything in the order (bought additionally in the store) */
  extras: ParsedLine[];
}

const cents = (n: number | null | undefined) => Math.round((n ?? 0) * 100);

export function isSameShopping(avis: ParsedImport, ebon: ParsedImport): boolean {
  const ao = (avis.meta.fileOrderNumber as string) ?? '';
  const eo = (ebon.meta.orderNumber as string) ?? '';
  if (ao && eo && ao === eo) return true;
  const sameDay = avis.date?.slice(0, 10) === ebon.date?.slice(0, 10);
  const sameMarket = avis.meta.marketShort && ebon.meta.market && String(avis.meta.marketShort) === String(ebon.meta.market);
  return Boolean(sameDay && sameMarket && eo);
}

export function reconcile(avis: ParsedImport, ebon: ParsedImport): ReconcileResult {
  // expand both sides into single units and assign globally by best name similarity within equal prices
  type Unit = { idx: number; price: number; name: string; used: boolean };
  const aUnits: Unit[] = [];
  avis.lines.forEach((a, idx) => {
    if (a.status === 'deposit' || a.status === 'unavailable' || a.qty <= 0) return;
    if (a.weightKg) aUnits.push({ idx, price: cents(a.price), name: a.name, used: false });
    else for (let k = 0; k < a.qty; k++) aUnits.push({ idx, price: cents(a.unitPrice), name: a.name, used: false });
  });
  const eUnits: Unit[] = [];
  ebon.lines.forEach((e, idx) => {
    if (e.status === 'deposit') return;
    if (e.weightKg) eUnits.push({ idx, price: cents(e.price), name: e.name, used: false });
    else for (let k = 0; k < e.qty; k++) eUnits.push({ idx, price: cents(e.unitPrice), name: e.name, used: false });
  });
  const pairs: { a: Unit; e: Unit; s: number }[] = [];
  for (const a of aUnits) for (const e of eUnits) if (a.price === e.price) pairs.push({ a, e, s: similarity(e.name, a.name) });
  pairs.sort((x, y) => y.s - x.s);
  const kept = new Map<number, number>();
  const aliases = new Map<number, string>();
  for (const p of pairs) {
    if (p.a.used || p.e.used) continue;
    // a weak name match is only accepted when nothing better can claim either side
    if (p.s < 0.12) continue;
    p.a.used = true;
    p.e.used = true;
    kept.set(p.a.idx, (kept.get(p.a.idx) ?? 0) + 1);
    if (!aliases.has(p.a.idx)) aliases.set(p.a.idx, p.e.name);
  }
  avis.lines.forEach((a, idx) => {
    if (a.status === 'deposit' || a.status === 'unavailable' || a.qty <= 0) return;
    if (!kept.has(idx)) kept.set(idx, 0);
  });
  const leftover = new Map<number, number>();
  for (const e of eUnits) if (!e.used) leftover.set(e.idx, (leftover.get(e.idx) ?? 0) + 1);
  const extras = [...leftover.entries()].map(([idx, q]) => ({ ...ebon.lines[idx], qty: ebon.lines[idx].weightKg ? 1 : q, status: 'extra' as const }));
  return { kept, aliases, extras };
}
