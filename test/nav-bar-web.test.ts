/**
 * "Deine Leiste" on the web (web/src/nav.tsx): the phone bar, the sidebar and the areas at the top of "Mehr" follow
 * the person's own choice; without one everything stays as before (Geld gives way first).
 */
import { beforeAll, describe, expect, it } from 'vitest';

// the web's i18n reads the browser language at import – a tiny stand-in, English
const g = globalThis as any;
g.document ??= { documentElement: { lang: 'en' } };
g.localStorage ??= { getItem: () => 'en', setItem: () => {}, removeItem: () => {} };
g.window ??= { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };

let nav: typeof import('../web/src/nav');
beforeAll(async () => {
  nav = await import('../web/src/nav');
});
const areasInMore: typeof nav.areasInMore = (...a) => nav.areasInMore(...a);
const cleanNav: typeof nav.cleanNav = (...a) => nav.cleanNav(...a);
const defaultNavTabs: typeof nav.defaultNavTabs = (...a) => nav.defaultNavTabs(...a);
const myBar: typeof nav.myBar = (...a) => nav.myBar(...a);
const mySidebar: typeof nav.mySidebar = (...a) => nav.mySidebar(...a);
const tabFor: typeof nav.tabFor = (...a) => nav.tabFor(...a);

const keys = (tabs: { key: string }[]) => tabs.map((l) => l.key);

describe('Deine Leiste (web nav)', () => {
  it('without a choice: the default bar, Geld in Mehr on phones only', () => {
    expect(keys(myBar(undefined, {}, null))).toEqual(['/', '/einkauf', '/kochen', '/aufgaben', '/bestand']);
    expect(keys(mySidebar(undefined, {}, null))).toContain('/geld');
    expect(areasInMore(undefined, {}, null)).toMatchObject({ phoneOnly: true });
    expect(keys(areasInMore(undefined, {}, null).tabs)).toEqual(['/geld']);
    expect(defaultNavTabs(undefined, {})).toEqual(['shopping', 'cooking', 'tasks', 'stock']);
  });

  it('with a choice: Heute first, then the own areas in order; the rest goes to Mehr everywhere', () => {
    const pref = cleanNav(['money', 'knowledge', 'shopping']);
    expect(keys(myBar(undefined, {}, pref))).toEqual(['/', '/geld', '/wissen', '/einkauf']);
    expect(keys(mySidebar(undefined, {}, pref))).toEqual(['/', '/geld', '/wissen', '/einkauf']);
    const more = areasInMore(undefined, {}, pref);
    expect(more.phoneOnly).toBe(false);
    expect(keys(more.tabs)).toEqual(['/kochen', '/aufgaben', '/bestand']);
  });

  it('areas the household switched off are left out', () => {
    const pref = cleanNav(['cooking', 'money', 'stock']);
    expect(keys(myBar(undefined, { cook: false, money: false }, pref))).toEqual(['/', '/bestand']);
    expect(keys(areasInMore(undefined, { cook: false, money: false }, pref).tabs)).toEqual(['/einkauf', '/aufgaben']);
  });

  it('cleans a stored choice like the server and marks Haushaltswissen active', () => {
    expect(cleanNav(['today', 'stock', 'stock', 'x', 'money', 'tasks', 'cooking', 'shopping'])).toEqual(['stock', 'money', 'tasks', 'cooking']);
    expect(cleanNav(null)).toBeNull();
    expect(tabFor('/wissen')).toBe('/wissen');
  });
});
