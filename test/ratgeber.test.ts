/** Ratgeber cards for the apps: the served list matches the website's published posts (scripts/ratgeber-cards.mjs). */
import { describe, expect, it } from 'vitest';
import RATGEBER from '../server/data/ratgeber.json';

describe('ratgeber cards', () => {
  it('server/data/ratgeber.json is current – run `node scripts/ratgeber-cards.mjs` after changing a post', async () => {
    // @ts-expect-error plain ESM script without types
    const { ratgeberCards } = await import('../scripts/ratgeber-cards.mjs');
    expect(await ratgeberCards()).toEqual(RATGEBER);
  });
  it('every card has a title, a teaser and an area', () => {
    for (const p of RATGEBER.posts) {
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.teaser.length).toBeLessThanOrEqual(142);
      expect(p.area).toMatch(/^[a-z]+$/);
    }
  });
});
