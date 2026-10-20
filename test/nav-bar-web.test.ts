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

  it('cleans a stored choice like the server; Haushaltswissen lights Zuhause, or itself when in the bar', () => {
    expect(cleanNav(['today', 'stock', 'stock', 'x', 'money', 'tasks', 'cooking', 'shopping'])).toEqual(['stock', 'money', 'tasks', 'cooking']);
    expect(cleanNav(null)).toBeNull();
    expect(tabFor('/wissen')).toBe('/bestand');
    expect(tabFor('/wissen', ['/', '/wissen'])).toBe('/wissen');
  });

  it('Bring mir was, Wünsche and Hausinfo can take a place – and keep their own row when not in it', () => {
    const pref = cleanNav(['orders', 'shopping', 'wishes', 'houseinfo']);
    expect(pref).toEqual(['orders', 'shopping', 'wishes', 'houseinfo']);
    expect(keys(myBar(undefined, {}, pref))).toEqual(['/', '/bestellen', '/einkauf', '/einkauf/wuensche', '/hausinfo']);
    // only main areas move to the top of Mehr
    expect(keys(areasInMore(undefined, {}, pref).tabs)).toEqual(['/kochen', '/aufgaben', '/bestand', '/geld']);
    // unknown ids are dropped
    expect(keys(myBar(undefined, {}, cleanNav(['nope', 'tasks'])))).toEqual(['/', '/aufgaben']);
  });

  it('respects "Was nutzt ihr?": Bring mir was leaves with its module', () => {
    const pref = cleanNav(['orders', 'shopping']);
    expect(keys(myBar(undefined, { treats: false }, pref))).toEqual(['/', '/einkauf']);
    const ids = nav.pickableAreas(undefined, { treats: false }).map((p) => p.id);
    expect(ids).not.toContain('orders');
    expect(nav.pickableAreas(undefined, {}).map((p) => p.id)).toEqual(['shopping', 'cooking', 'tasks', 'stock', 'money', 'knowledge', 'orders', 'wishes', 'houseinfo']);
  });

  it('lights an extra area of the own bar on its pages, otherwise the area it belongs to', () => {
    expect(tabFor('/einkauf/wuensche/3')).toBe('/einkauf');
    expect(tabFor('/einkauf/wuensche/3', ['/', '/einkauf', '/einkauf/wuensche'])).toBe('/einkauf/wuensche');
    expect(tabFor('/einkauf', ['/', '/einkauf', '/einkauf/wuensche'])).toBe('/einkauf');
    // Hausinfo is a door of Zuhause now (Paket A), Urlaub a row of Mehr
    expect(tabFor('/hausinfo')).toBe('/bestand');
    expect(tabFor('/wo')).toBe('/bestand');
    expect(tabFor('/urlaub')).toBe('/mehr');
    expect(tabFor('/zuhause')).toBe('/bestand');
    expect(tabFor('/hausinfo', ['/', '/hausinfo'])).toBe('/hausinfo');
    expect(tabFor('/bestellen', ['/', '/bestellen'])).toBe('/bestellen');
  });
});

describe('Mehr and Zuhause (Paket A)', () => {
  const ids = (gs: { key: string }[]) => gs.map((g) => g.key);
  const tos = (g?: { items: { to: string }[] }) => (g?.items ?? []).map((l) => l.to);
  const groupsFor = (o: { guest?: string; admin?: boolean; modules?: Record<string, boolean>; pref?: string[] | null; single?: boolean }) => {
    const pref = nav.cleanNav(o.pref ?? null);
    return nav.moreGroups({
      guest: o.guest,
      admin: o.admin ?? true,
      cloud: true,
      modules: o.modules ?? {},
      areas: nav.areasInMore(o.guest, o.modules ?? {}, pref),
      bar: myBar(o.guest, o.modules ?? {}, pref).map((l) => l.key),
      sidebar: mySidebar(o.guest, o.modules ?? {}, pref).map((l) => l.key),
      single: o.single,
    });
  };

  it('the default bar: Zuhause instead of Vorrat, four groups in Mehr, Wünsche first in Alltag', () => {
    expect(myBar(undefined, {}, null).map((l) => l.label())).toEqual(['Today', 'Shopping', 'Cooking', 'Tasks', 'Home']);
    const gs = groupsFor({});
    expect(ids(gs)).toEqual(['alltag', 'familie', 'kopf', 'hilfe']);
    const alltag = gs.find((g) => g.key === 'alltag')!;
    expect(alltag.items[0]).toMatchObject({ to: '/einkauf/wuensche', label: 'Wish lists & gifts' });
    expect(tos(alltag)).toEqual(['/einkauf/wuensche', '/geld', '/bestellen', '/urlaub', '/import']);
    // Geld: a row on the phone, the desktop sidebar shows it as an area
    expect(alltag.items.find((l) => l.to === '/geld')?.phoneOnly).toBe(true);
    expect(tos(gs.find((g) => g.key === 'familie'))).toEqual(['/einstellungen/haushalt/leute', '/bar', '/fuer-wen']);
    expect(tos(gs.find((g) => g.key === 'kopf'))).toEqual(['/kopf', '/fokus', '/denkarbeit', '/woche']);
    expect(tos(gs.find((g) => g.key === 'hilfe'))).toEqual(['/einstellungen', '/hilfe', '/so-funktioniert-tohuus', '/gut-zu-wissen', '/mehr/alle']);
    for (const g of gs) expect(g.items.filter((l) => l.to !== '/mehr/alle').length, g.key).toBeLessThanOrEqual(nav.MORE_MAX);
    // no settings rows in Mehr any more – one row „Einstellungen“
    expect(gs.flatMap((g) => g.items).filter((l) => l.to.startsWith('/einstellungen') && l.to !== '/einstellungen' && l.to !== '/einstellungen/haushalt/leute')).toEqual([]);
  });

  it('what is in the own bar is not repeated; without Zuhause in the bar its doors become a group', () => {
    const gs = groupsFor({ pref: ['shopping', 'wishes', 'money', 'orders'] });
    const all = gs.flatMap((g) => tos(g));
    expect(all).not.toContain('/einkauf/wuensche');
    expect(all).not.toContain('/geld');
    expect(all).not.toContain('/bestellen');
    expect(tos(gs.find((g) => g.key === 'zuhause'))).toEqual(['/hausinfo', '/wissen', '/wo']);
    // the main areas left out sit on top (Geld has its row in Alltag)
    expect(tos(gs.find((g) => g.key === 'areas'))).toEqual(['/kochen', '/aufgaben', '/bestand']);
  });

  it('switched-off areas, a household of one, guests', () => {
    const off = groupsFor({ modules: { stock: false, money: false, treats: false } });
    expect(tos(off.find((g) => g.key === 'zuhause'))).toEqual(['/hausinfo', '/wissen']);
    expect(off.flatMap((g) => tos(g))).not.toContain('/geld');
    expect(groupsFor({ single: true }).flatMap((g) => tos(g))).not.toContain('/bestellen');
    // a permanent guest (only „Bring mir was“ and the list): no wishes, no money, no people; their handover
    const guest = groupsFor({ guest: 'order', admin: false });
    const rows = guest.flatMap((g) => tos(g));
    expect(rows).toEqual(expect.arrayContaining(['/bestellen', '/uebergabe', '/hausinfo', '/wissen', '/einstellungen', '/hilfe']));
    for (const no of ['/einkauf/wuensche', '/geld', '/urlaub', '/einstellungen/haushalt/leute', '/kopf', '/wo']) expect(rows).not.toContain(no);
  });
});
