import { describe, expect, it } from 'vitest';
import { emptyModel, formatItem, learnTrip, looksLikeQuickAdd, parseQuickAdd, setManualOrder, sortBySections, tripSequence } from '../server/lib/shopparse';

const brief = (text: string) => parseQuickAdd(text).map((p) => [p.qty, p.unit, p.name, p.amount]);

describe('quick add parser', () => {
  it('splits on commas and "und", reads quantities and containers', () => {
    expect(brief('2 Milch, Paketband und 3 Dosen Tomaten')).toEqual([
      [2, null, 'Milch', null],
      [null, null, 'Paketband', null],
      [3, 'Dosen', 'Tomaten', null],
    ]);
  });
  it('understands x-notation before and after the name', () => {
    expect(brief('2x Butter; Joghurt x3; Eier 10')).toEqual([
      [2, null, 'Butter', null],
      [3, null, 'Joghurt', null],
      [10, null, 'Eier', null],
    ]);
  });
  it('keeps measures as an amount, not a count', () => {
    expect(brief('500 g Hackfleisch, 1,5 kg Kartoffeln, 500g Mehl')).toEqual([
      [null, 'g', 'Hackfleisch', '500 g'],
      [null, 'kg', 'Kartoffeln', '1,5 kg'],
      [null, 'g', 'Mehl', '500 g'],
    ]);
  });
  it('reads number words in German and English', () => {
    expect(brief('zwei Gurken and a loaf of bread & three cans of tomatoes')).toEqual([
      [2, null, 'Gurken', null],
      [1, 'loaf', 'Bread', null],
      [3, 'cans', 'Tomatoes', null],
    ]);
  });
  it('does not mistake product names with digits for quantities', () => {
    expect(brief('7up, Cola Zero 1,5l')).toEqual([
      [null, null, '7up', null],
      [null, null, 'Cola Zero 1,5l', null],
    ]);
  });
  it('merges repeats and ignores empty fragments and bullets', () => {
    expect(brief('- Milch\n- Milch\n\n• 2 Äpfel,,')).toEqual([
      [2, null, 'Milch', null],
      [2, null, 'Äpfel', null],
    ]);
  });
  it('capitalises the first letter (German nouns)', () => {
    expect(parseQuickAdd('klopapier')[0].name).toBe('Klopapier');
  });
  it('decides when the preview is worth showing', () => {
    expect(looksLikeQuickAdd('Paketband')).toBe(false);
    expect(looksLikeQuickAdd('2 Milch')).toBe(true);
    expect(looksLikeQuickAdd('Milch, Butter')).toBe(true);
  });
  it('formats items for external lists', () => {
    expect(formatItem({ text: 'Milch', qty: 2 })).toBe('2 Milch');
    expect(formatItem({ text: 'Milch', qty: 1 })).toBe('Milch');
    expect(formatItem({ text: 'Milch', qty: null })).toBe('Milch');
  });
});

describe('aisle order learning', () => {
  const visited = (order: string[], seq: string[]) => order.filter((s) => seq.includes(s));

  it('takes the first-tick order of sections in a trip', () => {
    expect(
      tripSequence([
        { section: 'drinks', at: '2026-10-10 10:00:01' },
        { section: 'produce', at: '2026-10-10 10:03:00' },
        { section: 'drinks', at: '2026-10-10 10:09:00' },
        { section: 'chilled', at: '2026-10-10 10:05:00' },
      ]),
    ).toEqual(['drinks', 'produce', 'chilled']);
  });

  it('learns the walking order from one trip and keeps unvisited sections in place', () => {
    const m = learnTrip(emptyModel(), ['drinks', 'produce', 'chilled']);
    expect(visited(m.order, ['drinks', 'produce', 'chilled'])).toEqual(['drinks', 'produce', 'chilled']);
    // bakery, frozen, pantry … keep their relative default order
    const rest = m.order.filter((s) => !['drinks', 'produce', 'chilled'].includes(s));
    expect(rest).toEqual(['bakery', 'frozen', 'pantry', 'snacks', 'drugstore', 'household', 'other']);
    expect(m.trips).toBe(1);
  });

  it('a single odd trip does not undo a habit, a repeated change does', () => {
    let m = emptyModel();
    for (let i = 0; i < 3; i++) m = learnTrip(m, ['produce', 'bakery', 'chilled']);
    m = learnTrip(m, ['chilled', 'produce']);
    expect(visited(m.order, ['produce', 'chilled'])).toEqual(['produce', 'chilled']);
    for (let i = 0; i < 4; i++) m = learnTrip(m, ['chilled', 'produce']);
    expect(visited(m.order, ['produce', 'chilled'])).toEqual(['chilled', 'produce']);
  });

  it('a manual order wins and is sticky against one contrary trip', () => {
    let m = setManualOrder(emptyModel(), ['household', 'drinks', 'produce']);
    expect(m.order.slice(0, 3)).toEqual(['household', 'drinks', 'produce']);
    expect(m.order).toHaveLength(10);
    m = learnTrip(m, ['produce', 'household']);
    expect(visited(m.order, ['household', 'produce'])).toEqual(['household', 'produce']);
  });

  it('sorts groups by the learned order, unknown last', () => {
    const groups = [{ k: 'other' }, { k: 'drinks' }, { k: 'mystery' }, { k: 'produce' }];
    expect(sortBySections(groups, ['drinks', 'produce', 'other'], (g) => g.k).map((g) => g.k)).toEqual(['drinks', 'produce', 'other', 'mystery']);
  });
});
