/** Plattdeutsche Begrüßung (server/lib/platt.ts, data server/data/platt.json). */
import { describe, expect, it } from 'vitest';
import { SAYINGS, easterSunday, matches, pickSaying, plattHello, slotOf, specialsOf, type PlattContext } from '../server/lib/platt';

const ctx = (date: string, hour: number): PlattContext => ({ date, hour, weekday: new Date(date + 'T12:00:00Z').getUTCDay(), month: Number(date.slice(5, 7)) });

describe('Platt sayings', () => {
  it('data is complete: unique ids, text, meaning and a short note; no dashes in the copy', () => {
    const ids = new Set<string>();
    for (const s of SAYINGS) {
      expect(ids.has(s.id), s.id).toBe(false);
      ids.add(s.id);
      expect(s.text && s.meaning && s.note, s.id).toBeTruthy();
      expect(s.note.length, s.id).toBeLessThanOrEqual(140);
      expect(`${s.text} ${s.meaning} ${s.note}`, s.id).not.toMatch(/[–—]/);
    }
    expect(SAYINGS.length).toBeGreaterThanOrEqual(50);
  });

  it('slots, Easter and special days', () => {
    expect([4, 5, 10, 11, 13, 14, 17, 18, 22, 23].map(slotOf)).toEqual(['night', 'morning', 'morning', 'noon', 'noon', 'afternoon', 'afternoon', 'evening', 'evening', 'night']);
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(specialsOf('2026-04-03')).toContain('easter');
    expect(specialsOf('2026-12-10')).toEqual(['advent']);
    expect(specialsOf('2026-12-24')).toEqual(['christmas']);
    expect(specialsOf('2026-12-31')).toEqual(['newyear-eve']);
    expect(specialsOf('2027-01-01')).toEqual(['newyear']);
    expect(plattHello(8)).toBe('Moin');
    expect(plattHello(20)).toBe("'n Avend");
  });

  it('every pick fits the moment, stays stable within a slot and varies over the month', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 28; d++)
      for (const h of [2, 7, 12, 15, 20]) {
        const c = ctx(`2026-10-${String(d).padStart(2, '0')}`, h);
        const s = pickSaying(c, 'u1')!;
        expect(matches(s, c), `${c.date} ${h} ${s.id}`).toBe(true);
        expect(pickSaying({ ...c, hour: h === 2 ? 3 : h + 1 }, 'u1')!.id).toBe(s.id);
        seen.add(s.id);
      }
    expect(seen.size).toBeGreaterThan(20);
    expect(matches(SAYINGS.find((s) => s.id === 'hitt')!, ctx('2026-10-13', 12))).toBe(false);
    expect(matches(SAYINGS.find((s) => s.id === 'rut-ut-de-feddern')!, ctx('2026-10-13', 23))).toBe(false);
  });

  it('special days show their saying most of the time', () => {
    let xmas = 0;
    for (const h of [7, 12, 15, 20, 23]) for (const u of ['a', 'b', 'c', 'd']) if (pickSaying(ctx('2026-12-24', h), u)!.id === 'wiehnachten') xmas++;
    expect(xmas).toBeGreaterThan(8);
  });
});
