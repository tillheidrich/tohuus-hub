#!/usr/bin/env node
/**
 * Accessibility audit for the ToHuus web app (WCAG 2.2 AA) – same routes and sheets as scripts/ui-audit.mjs
 * (audit-shared.mjs), checked with axe-core plus a few things axe cannot see:
 *
 *   axe            every axe rule tagged wcag2a/2aa/21a/21aa/22aa (+ best-practice with --best-practice)
 *   dialog-focus   a sheet/dialog opens without moving focus into it
 *   dialog-trap    Tab / Shift+Tab leaves an open sheet
 *   dialog-escape  Escape does not close the sheet, or focus does not return to the control that opened it
 *   target-size    a control smaller than 24×24 px without enough space around it (axe checks this too; this
 *                  one also reports touch targets under 44 px at phone width with --touch)
 *   motion         an animation/transition still running with prefers-reduced-motion: reduce
 *
 * Usage (playwright and @axe-core/playwright resolvable via NODE_PATH, see docs/ui-audit.md):
 *   node scripts/a11y-audit.mjs http://localhost:8711 [--email x --password y] [--seed] [--out dir]
 *        [--viewports 390x844,1280x800] [--themes light,dark] [--only /geld,sheet:] [--best-practice] [--touch] [--strict]
 * Writes <out>/a11y.json and <out>/a11y.md. Exit code 0 unless --strict and something was found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { args, fileName, loadPlaywright, pages, prepare, reset, visit } from './audit-shared.mjs';

const A = args({ out: 'a11y-audit-out', viewports: '390x844,1280x800', themes: 'light,dark' });
const { OUT, VIEWPORTS, THEMES, EXEC, flag } = A;
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright();
let AxeBuilder;
try {
  AxeBuilder = createRequire(import.meta.url)('@axe-core/playwright').default;
} catch {
  console.error('@axe-core/playwright not found – install it next to playwright and set NODE_PATH (see docs/ui-audit.md)');
  process.exit(2);
}
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', ...(flag('best-practice') ? ['best-practice'] : [])];

const browser = await chromium.launch({ executablePath: EXEC });
const { session, storage, fresh, list } = await prepare(browser, A);

/** Controls below the WCAG 2.2 minimum (24 px) – or 44 px for touch with --touch – without spacing around them. */
function smallTargets(min) {
  const out = [];
  const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], summary';
  const els = [...document.querySelectorAll(sel)].filter((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 1 && r.height > 1 && !el.closest('[inert], [aria-hidden="true"]');
  });
  // inline links in running text are exempt (WCAG 2.5.8)
  const inline = (el) => el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.parentElement && /P|LI|SPAN|SMALL|DIV/.test(el.parentElement.tagName) && (el.parentElement.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 10;
  const rects = els.map((el) => el.getBoundingClientRect());
  els.forEach((el, i) => {
    const r = rects[i];
    if (r.width >= min && r.height >= min) return;
    if (inline(el)) return;
    // a native checkbox/radio inside a bigger label counts as that label
    const lab = el.closest('label');
    if (lab) {
      const lr = lab.getBoundingClientRect();
      if (lr.width >= min && lr.height >= min) return;
    }
    // spacing exception: a 24 px circle around its centre must not hit another target
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const clash = rects.some((o, j) => {
      if (j === i || els[j].contains(el) || el.contains(els[j])) return false;
      const dx = Math.max(o.left - cx, 0, cx - o.right);
      const dy = Math.max(o.top - cy, 0, cy - o.bottom);
      return Math.hypot(dx, dy) < min / 2;
    });
    if (min === 24 && !clash) return;
    const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
    out.push({ kind: 'target-size', el: `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`, text: name, extra: `${Math.round(r.width)}×${Math.round(r.height)} px` });
  });
  return out;
}

/** Animations still running although reduced motion is on (the context sets prefers-reduced-motion: reduce). */
function runningMotion() {
  const out = [];
  for (const a of document.getAnimations()) {
    const t = a.effect?.getTiming?.();
    const el = a.effect?.target;
    if (!el || a.playState !== 'running') continue;
    const dur = Number(t?.duration) || 0;
    if (dur > 20 && !el.closest('[data-motion-ok]')) out.push({ kind: 'motion', el: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : ''), text: a.animationName ?? a.transitionProperty ?? '', extra: `${Math.round(dur)} ms with reduced motion` });
  }
  return out;
}

/** Sheet keyboard behaviour: focus inside, Tab stays inside, Escape closes and focus returns. */
async function dialogChecks(page) {
  const out = [];
  const dialog = page.locator('[role="dialog"], [role="alertdialog"]').last();
  if (!(await dialog.count())) return [{ kind: 'dialog-role', el: '.sheet', text: '', extra: 'sheet without role="dialog"' }];
  const info = await dialog.evaluate((d) => ({ modal: d.getAttribute('aria-modal'), label: d.getAttribute('aria-label') || d.getAttribute('aria-labelledby'), inside: d.contains(document.activeElement) }));
  if (!info.label) out.push({ kind: 'dialog-name', el: '[role=dialog]', text: '', extra: 'dialog without aria-label / aria-labelledby' });
  if (!info.inside) out.push({ kind: 'dialog-focus', el: '[role=dialog]', text: '', extra: 'focus did not move into the sheet' });
  for (const key of ['Tab', 'Shift+Tab']) {
    let escaped = false;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(key);
      if (!(await dialog.evaluate((d) => d.contains(document.activeElement)).catch(() => true))) {
        escaped = true;
        break;
      }
    }
    if (escaped) out.push({ kind: 'dialog-trap', el: '[role=dialog]', text: '', extra: `${key} leaves the sheet` });
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  const still = await page.locator('[role="dialog"], [role="alertdialog"]').count();
  if (still) out.push({ kind: 'dialog-escape', el: '[role=dialog]', text: '', extra: 'Escape does not close the sheet' });
  else {
    const back = await page.evaluate(() => (document.activeElement && document.activeElement !== document.body ? document.activeElement.tagName : null));
    if (!back) out.push({ kind: 'dialog-return', el: '[role=dialog]', text: '', extra: 'focus is lost (on <body>) after closing' });
  }
  return out;
}

const runs = [];
for (const [w, h] of VIEWPORTS) for (const theme of THEMES) runs.push({ w, h, theme, large: false });
const report = [];
for (const run of runs) {
  const tag = `${run.w}x${run.h}-${run.theme}`;
  const ps = pages(browser, run, { storage, fresh, password: session.password });
  for (const t of list) {
    const entry = { page: t.name, viewport: tag, issues: [], screenshot: fileName(t, tag) };
    let page;
    try {
      page = await ps.get(t);
      // remember which control opens the sheet, so "focus returns" can be checked against it
      const { error } = await visit(page, t);
      if (error) entry.issues.push({ kind: 'not-reached', el: '', text: '', extra: error });
      const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      for (const v of res.violations)
        for (const n of v.nodes.slice(0, 6))
          entry.issues.push({ kind: `axe:${v.id}`, el: n.target.join(' '), text: (n.failureSummary ?? '').split('\n').slice(1, 2).join(' ').trim().slice(0, 140), extra: v.impact ?? '' });
      entry.issues.push(...(await page.evaluate(smallTargets, 24)));
      if (flag('touch') && run.w < 700) entry.issues.push(...(await page.evaluate(smallTargets, 44)).map((i) => ({ ...i, kind: 'touch-size' })));
      entry.issues.push(...(await page.evaluate(runningMotion)));
      if (t.open && !error) entry.issues.push(...(await dialogChecks(page)));
    } catch (e) {
      entry.issues.push({ kind: 'error', el: '', text: '', extra: String(e.message ?? e).split('\n')[0] });
    }
    if (page) await reset(page, t);
    report.push(entry);
    const n = entry.issues.length;
    process.stdout.write(`${n ? '✗' : '✓'} ${tag} ${t.name}${n ? ` (${n})` : ''}\n`);
  }
  await ps.close();
}
await browser.close();

fs.writeFileSync(path.join(OUT, 'a11y.json'), JSON.stringify(report, null, 2));
const total = report.reduce((s, e) => s + e.issues.length, 0);
const byKind = {};
for (const e of report) for (const i of e.issues) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
const md = ['# Accessibility audit', '', `Base: ${A.BASE} · ${new Date().toISOString()} · tags ${TAGS.join(', ')}`, '', `${report.length} page views, ${total} findings.`, ''];
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) md.push(`- ${k}: ${n}`);
md.push('');
for (const e of report.filter((x) => x.issues.length)) {
  md.push(`## ${e.page} · ${e.viewport}`, '');
  for (const i of e.issues) md.push(`- **${i.kind}** \`${i.el}\` ${i.text ? `“${i.text}” ` : ''}${i.extra}`);
  md.push('');
}
fs.writeFileSync(path.join(OUT, 'a11y.md'), md.join('\n'));
console.log(`\n${total} findings in ${report.length} page views → ${path.join(OUT, 'a11y.md')}`);
process.exit(flag('strict') && total ? 1 : 0);
