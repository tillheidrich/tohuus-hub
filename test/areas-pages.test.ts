/**
 * Bereichsseiten (UX audit 2026-10, Paket E): timers from step text (web = iPhone `CookTimers.durations`), the
 * Küchenmodus on both platforms, the Aufgaben tools out of the main flow, one labelled „Werkzeuge“ menu per area.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fmtTimer, stepDurations } from '../web/src/area/durations';
import { FUNCTIONS, MORE_SPEC } from '../web/src/search/functions';

const ROOT = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

describe('cook timers from the step text', () => {
  it('finds minutes, hours, seconds and ranges (the longer end)', () => {
    expect(stepDurations('Die Zwiebeln 10 Min. glasig dünsten.')).toEqual([600]);
    expect(stepDurations('1–2 Std. schmoren, dann 30 Sek. ruhen lassen')).toEqual([7200, 30]);
    expect(stepDurations('Bake for 25 minutes')).toEqual([1500]);
    expect(stepDurations('Simmer 5 to 8 mins')).toEqual([480]);
    expect(stepDurations('Mixen', '20 Min.')).toEqual([1200]);
    expect(stepDurations('1,5 Stunden im Ofen')).toEqual([5400]);
  });
  it('ignores what is not a time', () => {
    expect(stepDurations('200 g Mehl und 3 Eier')).toEqual([]);
    expect(stepDurations('2 s')).toEqual([]);
    expect(stepDurations('10 Stunden')).toEqual([]);
    expect(stepDurations('10 Min., dann nochmal 10 Min.')).toEqual([600]);
  });
  it('formats like the iPhone', () => {
    expect(fmtTimer(600)).toBe('10:00');
    expect(fmtTimer(65)).toBe('1:05');
    expect(fmtTimer(3725)).toBe('1:02:05');
  });
  it('uses the same pattern as the iPhone', () => {
    const swift = read('ios', 'ToHuus', 'Features', 'Cooking', 'CookModeView.swift');
    const web = read('web', 'src', 'area', 'durations.ts');
    const unit = 'stunden|stunde|std\\.?|hours?|hrs?|h|minuten|minutes?|min\\.?|mins?|sekunden|sek\\.?|seconds?|secs?|s';
    expect(swift).toContain(unit);
    expect(web).toContain(unit);
  });
});

describe('Küchenmodus, Aufgaben tools, Werkzeuge menu', () => {
  const byId = new Map(FUNCTIONS.map((f) => [f.id, f]));
  it('Küchenmodus is on the web and the iPhone', () => {
    expect(byId.get('kitchen')).toMatchObject({ web: '/kochen/kueche', ios: 'kitchen', platforms: ['web', 'ios'] });
    const page = read('web', 'src', 'pages', 'KitchenMode.tsx');
    // full screen, the screen stays on, step by step, timers, the list
    expect(page).toContain('requestFullscreen');
    expect(read('web', 'src', 'area', 'cookTimers.tsx')).toContain("wakeLock");
    expect(page).toMatch(/StepTimerButtons/);
    expect(page).toMatch(/KitchenList/);
  });
  it('„Wer hat was im Blick“ has its own page and a row in Kopf & Fairness', () => {
    expect(byId.get('blick')).toMatchObject({ group: 'kopf', web: '/aufgaben/blick', ios: 'blick' });
    expect(MORE_SPEC.groups.find((g) => g.id === 'kopf')!.rows).toContain('blick');
    expect(byId.get('taskideas')).toMatchObject({ web: '/aufgaben/ideen', ios: 'taskIdeas' });
  });
  it('the Aufgaben page keeps the tools and suggestions out of its main flow', () => {
    const care = read('web', 'src', 'pages', 'Care.tsx');
    const main = care.slice(care.indexOf('export function Care()'), care.indexOf('export function TaskIdeasPage()'));
    for (const gone of ['<WhoDoesWhatSection', '<BlickSection', '<RatgeberCards', 'freeTemplates', "nav('/etiketten?kind=care')"]) expect(main, gone).not.toContain(gone);
    expect(main).toContain('<AreaTiles');
    expect(main).toContain('<AreaTools');
  });
  it('every area page has one labelled Werkzeuge menu on the web and the iPhone', () => {
    for (const f of ['Shopping.tsx', 'Cook.tsx', 'Care.tsx', 'Stock.tsx', 'Money.tsx']) expect(read('web', 'src', 'pages', f), f).toContain('<AreaTools');
    const ios: [string, ...string[]][] = [
      ['Shopping', 'ShoppingView.swift'],
      ['Cooking', 'CookingView.swift'],
      ['Household', 'CareView.swift'],
      ['Pantry', 'PantryView.swift'],
      ['Money', 'MoneyView.swift'],
    ];
    for (const [dir, file] of ios) expect(read('ios', 'ToHuus', 'Features', dir, file), file).toContain('AreaToolsMenu');
  });
  it('the hand means „Bring mir was“ only (P1-14)', () => {
    expect(read('web', 'src', 'shop', 'claims.tsx')).not.toContain('HandHeart');
    expect(read('web', 'src', 'pages', 'Shopping.tsx')).not.toContain('HandHeart');
  });
});
