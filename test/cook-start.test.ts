/** Kochen, Startansicht (20.10.2026): web area/cookStart.ts, the iPhone mirrors it (CookingView.swift › CookStart). */
import { describe, expect, it } from 'vitest';
import { cookStartView } from '../web/src/area/cookStart';

describe('Kochen: start view', () => {
  it('opens on „Woche“ when the running week has at least one entry, else on „Was kochen wir?“', () => {
    expect(cookStartView({ weekEntries: 1 })).toBe('week');
    expect(cookStartView({ weekEntries: 5 })).toBe('week');
    expect(cookStartView({ weekEntries: 0 })).toBe('ideas');
  });

  it('waits while the plan is not loaded', () => {
    expect(cookStartView({ weekEntries: null })).toBeNull();
    expect(cookStartView({ weekEntries: undefined })).toBeNull();
  });

  it('a view picked by hand in this session stays, whatever the plan says', () => {
    expect(cookStartView({ chosen: 'recipes', weekEntries: 3 })).toBe('recipes');
    expect(cookStartView({ chosen: 'ideas', weekEntries: 3 })).toBe('ideas');
    expect(cookStartView({ chosen: 'week', weekEntries: 0 })).toBe('week');
    expect(cookStartView({ chosen: 'bogus', weekEntries: 0 })).toBe('ideas');
    expect(cookStartView({ chosen: null, weekEntries: null })).toBeNull();
  });

  it('the iPhone mirrors the same rule', async () => {
    const fs = await import('node:fs');
    const swift = fs.readFileSync(new URL('../ios/ToHuus/Features/Cooking/CookingView.swift', import.meta.url), 'utf8');
    expect(swift).toMatch(/enum CookStart/);
    expect(swift).toMatch(/n > 0 \? 1 : 0/);
  });
});
