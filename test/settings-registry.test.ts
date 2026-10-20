/**
 * Einstellungen in six pages (UX audit 2026-10, Paket C; web/src/settings/registry.ts, iOS SettingsHome.swift):
 * every row is in the search, old links (?tab=…, pushes, mails, help) lead somewhere, web and iOS list the same rows.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OLD_TABS,
  PAGES,
  ROWS,
  legacySettingsTarget,
  resolveSettingsPath,
  rowPath,
  searchRows,
  visiblePages,
  visibleRows,
  type SettingsCtx,
} from '../web/src/settings/registry';
import { de } from '../web/src/locales/de/index';
import { SETTINGS_OLD_TABS, apnsPayload, settingsDeepLink } from '../server/lib/apns';

const tr = (en: string) => de[en] ?? en;
const full = (over: Partial<SettingsCtx> = {}): SettingsCtx => ({ guest: false, user: true, admin: true, cloud: true, ...over });

describe('settings register', () => {
  it('has six pages, unique row ids and URL-safe slugs', () => {
    expect(PAGES.map((p) => p.id)).toEqual(['ich', 'haushalt', 'bereiche', 'mitteilungen', 'verbindungen', 'daten']);
    const ids = ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ROWS) {
      expect(r.id).toMatch(/^[a-z][a-z-]*$/);
      expect(r.id).not.toBe('mehr');
      expect(PAGES.some((p) => p.id === r.page)).toBe(true);
      expect(r.words.length).toBeGreaterThan(5);
      if (r.kind === 'link') expect(r.to).toMatch(/^\//);
    }
  });

  it('puts Ruhe & Fokus first on Ich and Was nutzt ihr? first on Bereiche & Orte', () => {
    expect(visibleRows(full(), 'ich')[0]).toMatchObject({ id: 'fokus', kind: 'inline' });
    expect(visibleRows(full(), 'bereiche')[0]).toMatchObject({ id: 'module', kind: 'sub' });
    expect(ROWS.find((r) => r.id === 'zuruecksetzen')?.page).toBe('daten');
  });

  it('keeps each page short (at most 8 rows outside "Mehr Optionen")', () => {
    for (const p of PAGES) expect(visibleRows(full({ platform: 'ios' }), p.id).filter((r) => !r.more).length).toBeLessThanOrEqual(8);
  });

  it('the search index finds every row by its own title, German and English, on its platform', () => {
    for (const platform of ['web', 'ios'] as const)
      for (const cloud of [true, false]) {
        const ctx = full({ cloud, platform });
        for (const r of visibleRows(ctx)) {
          expect(searchRows(r.title, ctx, tr).map((x) => x.id), `${r.id} (en)`).toContain(r.id);
          expect(searchRows(tr(r.title), ctx, tr).map((x) => x.id), `${r.id} (de)`).toContain(r.id);
        }
      }
    // every row of the register is reachable in at least one setup
    const seen = new Set<string>();
    for (const platform of ['web', 'ios'] as const) for (const cloud of [true, false]) visibleRows(full({ cloud, platform })).forEach((r) => seen.add(r.id));
    expect([...seen].sort()).toEqual(ROWS.map((r) => r.id).sort());
  });

  it('finds things by the words people type (umlauts optional)', () => {
    const ids = (q: string) => searchRows(q, full(), tr).map((r) => r.id);
    expect(ids('sanfter modus')).toContain('fokus');
    expect(ids('adhs')).toContain('fokus');
    expect(ids('Nur eins')).toContain('fokus');
    expect(ids('passwort')).toContain('anmeldung');
    expect(ids('dunkel')).toContain('darstellung');
    expect(ids('bereiche ausschalten')).toContain('module');
    expect(ids('zurucksetzen')).toContain('zuruecksetzen');
    expect(ids('mitglieder')).toContain('leute');
    expect(ids('kalender')).toEqual(expect.arrayContaining(['kalender-lesen', 'caldav', 'kalender-abo']));
    expect(ids('')).toEqual([]);
    expect(ids('xyzzy')).toEqual([]);
  });

  it('guests see only Ich, and only what they can use', () => {
    const g = full({ guest: true, admin: false });
    expect(visiblePages(g).map((p) => p.id)).toEqual(['ich']);
    expect(visibleRows(g).map((r) => r.id)).toEqual(['profil', 'anmeldung']);
  });

  it('hides switched-off areas, cloud-only rows on a self-hosted server and iPhone-only rows on the web', () => {
    const ids = (c: SettingsCtx) => visibleRows(c).map((r) => r.id);
    expect(ids(full({ modules: { cook: false } }))).not.toContain('kochstil');
    expect(ids(full({ cloud: false }))).not.toContain('konto');
    expect(ids(full({ cloud: false }))).toContain('abo');
    expect(ids(full())).not.toContain('laden');
    expect(ids(full({ platform: 'ios' }))).toContain('laden');
    expect(ids(full({ admin: false }))).not.toContain('mail');
  });
});

describe('old settings links', () => {
  it('every old tab leads to a page or sub page that exists', () => {
    expect(Object.keys(OLD_TABS).sort()).toEqual(['access', 'account', 'data', 'displays', 'ha', 'home', 'members', 'notify', 'places', 'plan', 'print', 'recipes']);
    for (const [tab, to] of Object.entries(OLD_TABS)) {
      expect(resolveSettingsPath(to), tab).not.toBeNull();
      expect(legacySettingsTarget(`?tab=${tab}`)).toBe(to);
    }
  });

  it('keeps other parameters and the hash', () => {
    expect(legacySettingsTarget('?tab=account&sso=linked')).toBe('/einstellungen/ich/anmeldung?sso=linked');
    expect(legacySettingsTarget('?tab=data', '#demo')).toBe('/einstellungen/daten/zuruecksetzen#demo');
    expect(legacySettingsTarget('?tab=notify', '#x')).toBe('/einstellungen/mitteilungen#x');
    expect(legacySettingsTarget('?tab=nonsense')).toBe('/einstellungen');
    expect(legacySettingsTarget('')).toBeNull();
    expect(legacySettingsTarget('?sso=linked')).toBeNull();
  });

  it('resolves new paths and refuses unknown ones', () => {
    expect(resolveSettingsPath('/einstellungen')).toEqual({ page: null, sub: null });
    expect(resolveSettingsPath('/einstellungen/ich')).toEqual({ page: 'ich', sub: null });
    expect(resolveSettingsPath('/einstellungen/ich/darstellung')).toEqual({ page: 'ich', sub: 'darstellung' });
    expect(resolveSettingsPath('/einstellungen/haushalt/mehr')).toEqual({ page: 'haushalt', sub: 'mehr' });
    expect(resolveSettingsPath('/einstellungen/ich/fokus')).toBeNull(); // inline: lives on the page (#fokus)
    expect(resolveSettingsPath('/einstellungen/ich/orte')).toBeNull(); // a row of another page
    expect(resolveSettingsPath('/einstellungen/konto')).toBeNull();
    for (const r of ROWS) if (r.kind !== 'link') expect(resolveSettingsPath(rowPath(r)), r.id).not.toBeNull();
  });

  it('the push deep links follow the same table (iPhone: Mehr › Einstellungen › page)', () => {
    expect(Object.fromEntries(Object.entries(SETTINGS_OLD_TABS).map(([k, v]) => [k, `/einstellungen/${v}`]))).toEqual(OLD_TABS);
    expect(settingsDeepLink('/einstellungen?tab=notify')).toBe('tohuus://more/settings/mitteilungen');
    expect(settingsDeepLink('/einstellungen/daten/zuruecksetzen')).toBe('tohuus://more/settings/daten/zuruecksetzen');
    expect(settingsDeepLink('/einstellungen')).toBe('tohuus://more/settings');
    expect(settingsDeepLink('/einkauf')).toBeNull();
    expect(apnsPayload({ title: 'x', body: 'y', event: 'billing.trial', path: '/einstellungen/daten/abo' }).url).toBe('tohuus://more/settings/daten/abo');
    expect(apnsPayload({ title: 'x', body: 'y', event: 'x', path: '/mehr' }).url).toBe('tohuus://more');
  });

  it('no settings link anywhere in the code leads nowhere', () => {
    const roots = ['web/src', 'server', 'site/src'];
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (n === 'node_modules' || n === 'locales') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|mjs|js|html)$/.test(n)) files.push(p);
      }
    };
    roots.forEach(walk);
    let checked = 0;
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      for (const m of s.matchAll(/\/einstellungen(?:\/[a-z-]+)*(?:\?tab=([a-z]+))?/g)) {
        if (/^\/einstellungen\/\*/.test(s.slice(m.index!, m.index! + 15))) continue; // the route itself
        checked++;
        if (m[1]) expect(OLD_TABS[m[1]], `${f}: ${m[0]}`).toBeDefined();
        else expect(resolveSettingsPath(m[0]), `${f}: ${m[0]}`).not.toBeNull();
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('web and iPhone list the same settings', () => {
  const swift = readFileSync('ios/ToHuus/Features/Settings/SettingsHome.swift', 'utf8');
  it('same pages', () => {
    const pages = [...swift.matchAll(/case (\w+) = "([a-z]+)"/g)].map((m) => m[2]);
    expect(pages).toEqual(PAGES.map((p) => p.id));
  });
  it('same rows on the same pages', () => {
    const rows = [...swift.matchAll(/Row\("([a-z-]+)", \.(\w+)/g)].map((m) => `${m[2]}:${m[1]}`).sort();
    expect(rows).toEqual(ROWS.filter((r) => r.platform !== 'web').map((r) => `${r.page}:${r.id}`).sort());
  });
  it('the web shows every web row (pages/Settings.tsx)', () => {
    const tsx = readFileSync('web/src/pages/Settings.tsx', 'utf8');
    const union = /type RowId =([^;]+);/.exec(tsx)![1];
    for (const r of ROWS) if (r.kind !== 'link' && r.platform !== 'ios') expect(union, r.id).toContain(`'${r.id}'`);
  });
});
