export type LineStatus =
  | 'ok' // delivered / bought as expected
  | 'substitute' // replacement article (REWE "Ersatzartikel")
  | 'unavailable' // ordered but not delivered
  | 'reduced' // fewer than ordered
  | 'returned' // delivered in the avis but refused at pickup (not on the final receipt)
  | 'extra' // on the receipt but not in the order (bought additionally)
  | 'deposit' // Pfand / Leergut / fees
  | 'unknown';

export interface ParsedLine {
  raw: string;
  name: string;
  qty: number;
  unit?: string | null;
  /** total price of the line in EUR */
  price?: number | null;
  unitPrice?: number | null;
  weightKg?: number | null;
  status: LineStatus;
  note?: string | null;
  substituteFor?: string | null;
  /** deposit lines: the item (name) the deposit belongs to, e.g. the drink right above it */
  depositFor?: string | null;
  /** text recognition (OCR): how sure the reading of this line was, 0..1 */
  ocrConfidence?: number | null;
  /** ordered quantity (avis only) */
  ordered?: number | null;
}

export interface ParsedImport {
  kind: 'rewe-avis' | 'rewe-ebon' | 'receipt' | 'photo' | 'text' | 'mcp' | 'url' | 'shelf';
  title: string;
  shop?: string | null;
  ref?: string | null;
  date?: string | null;
  total?: number | null;
  meta: Record<string, unknown>;
  lines: ParsedLine[];
}
