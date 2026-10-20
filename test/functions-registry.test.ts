/**
 * The shared function register (shared/functions.json, Paket D, docs/glossary.md): every web route exists, every
 * iPhone target is known, every help page exists, and the web and the iPhone search show the same functions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FUNCTIONS, FUNCTION_GROUPS, functionsFor, matchFunctions, type FnCtx } from '../web/src/search/functions';
import { resolveSettingsPath } from '../web/src/settings/registry';
import { helpCopy } from '../site/src/help.mjs';

const ROOT = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/** functions that exist on one platform only, on purpose (docs/glossary.md › Register) */
const ONE_PLATFORM: Record<string, 'web' | 'ios'> = {
  // Küchenmodus: iPad at the counter; the web decides in Paket E (UX audit P1-10)
  kitchen: 'ios',
};

/** routes of the signed-in web app (App.tsx) */
function webRoutes(): string[] {
  return [...read('web', 'src', 'App.tsx').matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
}
function routeExists(to: string): boolean {
  const p = to.split(/[?#]/)[0];
  if (p.startsWith('/einstellungen')) return resolveSettingsPath(p) !== null;
  return webRoutes().some((r) => {
    if (r === '*' || r.endsWith('/*')) return r !== '*' && p.startsWith(r.slice(0, -2));
    const re = new RegExp(`^${r.replace(/:[^/]+/g, '[^/]+')}$`);
    return re.test(p);
  });
}

/** iPhone: the screens of SearchRegistry.Target and the tabs of AppArea */
function iosTargets(): { targets: Set<string>; tabs: Set<string> } {
  const search = read('ios', 'ToHuus', 'Features', 'Search', 'GlobalSearchView.swift');
  const en = /enum Target: String \{([\s\S]*?)\n {4}\}/.exec(search)![1];
  const targets = new Set([...en.matchAll(/case ([^\n]+)/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())));
  const tabsSrc = read('ios', 'ToHuus', 'App', 'MainTabView.swift');
  const tabs = new Set(/enum AppArea: String[^{]*\{\s*case ([^\n]+)/.exec(tabsSrc)![1].split(',').map((s) => s.trim()));
  return { targets, tabs };
}

function helpSlugs(): Set<string> {
  const kit = { code: () => '', CLOUD: '', GH: '', MAIL: '', APP_DE: '', APP_EN: '' };
  const h = helpCopy(kit) as { de: { articles: { slug: string }[] } };
  return new Set(h.de.articles.map((a) => a.slug));
}

describe('shared/functions.json', () => {
  it('is complete and consistent', () => {
    const ids = FUNCTIONS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(FUNCTION_GROUPS.map((g) => g.id));
    // the groups of Mehr (target architecture, UX audit 5.2) plus the tab areas and the Zuhause doors
    expect([...groups]).toEqual(['bereiche', 'zuhause', 'alltag', 'familie', 'kopf', 'hilfe']);
    for (const f of FUNCTIONS) {
      expect(groups.has(f.group), f.id).toBe(true);
      expect(f.title.de && f.title.en && f.words.de && f.words.en, f.id).toBeTruthy();
      expect(f.platforms.length, f.id).toBeGreaterThan(0);
      for (const r of f.roles) expect(['admin', 'member', 'guest'], f.id).toContain(r);
      expect(f.roles, f.id).toContain('admin');
      // a platform listed has its target, a missing one is a documented exception
      expect(Boolean(f.web), `${f.id} web`).toBe(f.platforms.includes('web'));
      expect(Boolean(f.ios), `${f.id} ios`).toBe(f.platforms.includes('ios'));
      if (f.platforms.length === 1) expect(ONE_PLATFORM[f.id], `${f.id} is on one platform only`).toBe(f.platforms[0]);
    }
  });

  it('every web route exists', () => {
    const missing = FUNCTIONS.filter((f) => f.web && !routeExists(f.web)).map((f) => `${f.id}: ${f.web}`);
    expect(missing).toEqual([]);
  });

  it('every iPhone target is known', () => {
    const { targets, tabs } = iosTargets();
    const missing = FUNCTIONS.filter((f) => f.ios).filter((f) => {
      const t = f.ios!;
      return t.startsWith('tab:') ? !tabs.has(t.slice(4)) : t !== 'settings' && !targets.has(t);
    });
    expect(missing.map((f) => `${f.id}: ${f.ios}`)).toEqual([]);
  });

  it('every help page exists', () => {
    const slugs = helpSlugs();
    expect(slugs.size).toBeGreaterThan(20);
    expect(FUNCTIONS.filter((f) => f.help && !slugs.has(f.help)).map((f) => `${f.id}: ${f.help}`)).toEqual([]);
  });

  it('the web and the iPhone search find the same functions', () => {
    const ctxs: Omit<FnCtx, 'platform'>[] = [
      { guest: false, admin: true },
      { guest: false, admin: false },
      { guest: true, admin: false },
      { guest: false, admin: true, modules: { cook: false, money: false, stock: false, treats: false, guests: false, knowledge: false, homeinfo: false } },
    ];
    const onlyOne = new Set(Object.keys(ONE_PLATFORM));
    for (const c of ctxs) {
      const web = functionsFor({ ...c, platform: 'web' }).map((f) => f.id).filter((id) => !onlyOne.has(id));
      const ios = functionsFor({ ...c, platform: 'ios' }).map((f) => f.id).filter((id) => !onlyOne.has(id));
      expect(web).toEqual(ios);
      for (const q of ['geld', 'wunsch', 'nur eins', 'wlan', 'Wissen', 'einstellungen', 'Bring me', 'muell']) {
        const list = functionsFor({ ...c, platform: 'web' });
        expect(matchFunctions(q, list).map((f) => f.id).filter((id) => !onlyOne.has(id))).toEqual(
          matchFunctions(q, functionsFor({ ...c, platform: 'ios' })).map((f) => f.id).filter((id) => !onlyOne.has(id)),
        );
      }
    }
    // guests never see household-only functions; switched-off areas disappear
    expect(functionsFor({ guest: true, admin: false, platform: 'web' }).map((f) => f.id)).not.toContain('money');
    expect(functionsFor({ guest: false, admin: true, modules: { cook: false }, platform: 'ios' }).map((f) => f.id)).not.toContain('cooking');
    expect(matchFunctions('wlan', FUNCTIONS).map((f) => f.id)).toContain('houseinfo');
    expect(matchFunctions('nur eins', FUNCTIONS).map((f) => f.id)).toEqual(['focus']);
  });

  it('both searches read the register and use the same rules', () => {
    const web = read('web', 'src', 'search', 'GlobalSearch.tsx');
    expect(web).toContain("functionsFor({ guest: Boolean(guest), admin, modules, platform: 'web' })");
    expect(web).not.toMatch(/function registry\(\)/);
    const ios = read('ios', 'ToHuus', 'Features', 'Search', 'GlobalSearchView.swift');
    expect(ios).toContain('Bundle.main.url(forResource: "functions", withExtension: "json")');
    expect(ios).toContain('f.platforms.contains("ios") && f.roles.contains(role) && (f.module.map { app.moduleOn($0) } ?? true)');
    expect(ios).toContain('terms.allSatisfy { hay.contains($0) }');
    // no hand-written function list on the iPhone any more
    expect(ios).not.toMatch(/Entry\(title: L\("Today"\)/);
    expect(read('ios', 'project.yml')).toMatch(/- path: \.\.\/shared\/functions\.json\n\s+buildPhase: resources/);
  });
});
