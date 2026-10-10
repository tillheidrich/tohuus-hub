/**
 * Region hints for the vision model: which country the household shops in, how amounts are written there
 * and which receipt lines are discounts, deposits or tax – so a photo of a Tesco, Walmart or ICA receipt
 * comes back with the right decimals and without VAT/tax/savings lines as items.
 */
import { region } from './region.js';

const DECIMALS: Record<string, string> = {
  dot: 'Amounts use a decimal point (1,234.56 means one thousand two hundred thirty-four point five six).',
  comma: 'Amounts use a decimal comma (1 234,56 or 1.234,56 means one thousand two hundred thirty-four comma five six).',
};

const RECEIPT_WORDS: Record<string, string> = {
  uk: 'Typical UK lines: "Clubcard Price", "Nectar Price", "Multibuy saving", "Meal Deal saving" are discounts – subtract them from the item above. "BALANCE DUE"/"TOTAL" is the total, "SUBTOTAL" is not. VAT lines are not items. Weighed goods look like "0.540 kg @ £0.99/kg".',
  us: 'Typical US lines: "SAVINGS", "COUPON", "BOGO", amounts with a trailing minus ("0.50-") are discounts – subtract them from the item above. "BOTTLE DEP"/"CRV" are deposits (deposit=true). "TAX" lines are sales tax, not items; "TOTAL"/"BALANCE DUE" is the total including tax. Weighed goods look like "2.68 lb @ 0.46 /lb". Item lines may carry a UPC and tax flags (N, T, F, X) – leave those out of the name.',
  se: 'Typical Swedish lines: "Rabatt", "Stammispris", "Medlemspris", "Willys Plus", "2 för 30" are discounts – subtract them from the item above. "Pant" is a deposit (deposit=true), "Pantretur" a returned deposit (negative). "Moms" is VAT, not an item. "Totalt"/"Att betala" is the total. Weighed goods look like "0,812 kg x 24,90 kr/kg".',
  de: 'Typical German lines: "Pfand" is a deposit (deposit=true), "Leergut" a returned deposit (negative). "Rabatt", "Coupon", "Preisvorteil" are discounts. "SUMME"/"zu zahlen" is the total. Weighed goods look like "0,512 kg x 2,99 EUR/kg".',
};

/** Extra prompt lines for a vision task, or '' when the region adds nothing. */
export function visionRegionHint(task: string): string {
  let r;
  try {
    r = region();
  } catch {
    return '';
  }
  const style = new Intl.NumberFormat(r.locale).format(1.5).includes(',') ? 'comma' : 'dot';
  if (task === 'receipt' || task === 'text-items') {
    return [
      `The household lives in ${r.name} and pays in ${r.currency}. Unless the receipt clearly shows another currency, prices are in ${r.currency}.`,
      `Return prices as JSON numbers with a decimal point (e.g. 3.49). ${DECIMALS[style]} If the receipt shows £, $, € or kr, read the amounts in that convention.`,
      r.receipts ? RECEIPT_WORDS[r.receipts] : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (task === 'recipe' || task === 'text-recipe') {
    return r.units === 'us'
      ? 'Keep ingredient amounts and units exactly as printed (cups, oz, lb, tbsp, tsp are fine); qty as a JSON number (1/2 → 0.5).'
      : 'Keep ingredient amounts and units as printed; qty as a JSON number (1/2 → 0.5).';
  }
  return '';
}
