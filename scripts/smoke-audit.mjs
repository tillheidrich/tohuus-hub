#!/usr/bin/env node
/**
 * Function smoke test for the web app: opens every route, settings tab and main sheet of scripts/audit-shared.mjs
 * (same targets as ui-audit / a11y-audit) and reports what a person would hit as "it doesn't work":
 *
 *   pageerror   an uncaught JavaScript error
 *   console     console.error output (React warnings, failed fetches)
 *   api         an /api request answered with 4xx/5xx (401 for the signed-out pages and 404 on optional endpoints
 *               listed in EXPECTED are left out)
 *   crash       the crash card ("Diese Seite hat nicht geladen") is shown – web/src/crash.tsx
 *   not-reached a sheet could not be opened
 *
 * Usage (playwright via NODE_PATH, see docs/ui-audit.md):
 *   node scripts/smoke-audit.mjs http://localhost:8711 [--seed] [--out dir] [--only /urlaub,sheet:]
 * Writes <out>/smoke.json and <out>/smoke.md. Exit code 1 with --strict when something was found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { args, loadPlaywright, pages, prepare, reset, visit } from './audit-shared.mjs';

const A = args({ out: 'smoke-audit-out', viewports: '390x844', themes: 'light' });
const { OUT, EXEC, flag } = A;
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright();

/** answers that are part of normal operation (feature probes, optional modules) */
const EXPECTED = [/\/api\/operator\/status$/, /\/api\/auth\/me$/, /\/api\/me$/];

const browser = await chromium.launch({ executablePath: EXEC });
const { storage, fresh, list } = await prepare(browser, A);
const run = { w: 390, h: 844, theme: 'light', tag: '390x844-light' };
const P = pages(browser, run, { storage, fresh, password: A.opt('password') ?? 'audit-geheim-1234' });
const report = [];
for (const t of list) {
  const page = await P.get(t);
  const issues = [];
  const onError = (e) => issues.push({ kind: 'pageerror', text: String(e.message ?? e).slice(0, 300) });
  const onConsole = (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // the failed request itself is reported below as "api" – the browser's own line adds nothing
    if (/Failed to load resource/.test(text)) return;
    issues.push({ kind: 'console', text: text.slice(0, 300) });
  };
  const onResponse = (r) => {
    const u = r.url();
    if (!u.includes('/api/') || r.status() < 400) return;
    if (t.as === 'anon' && r.status() === 401) return;
    if (EXPECTED.some((re) => re.test(new URL(u).pathname))) return;
    issues.push({ kind: 'api', text: `${r.request().method()} ${new URL(u).pathname} → ${r.status()}` });
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  page.on('response', onResponse);
  let res = { error: null };
  try {
    res = await visit(page, t);
    await page.waitForTimeout(400);
  } catch (e) {
    issues.push({ kind: 'not-reached', text: String(e.message ?? e).split('\n')[0] });
  }
  if (res.error) issues.push({ kind: 'not-reached', text: res.error });
  if (await page.locator('.crash').count().catch(() => 0)) issues.push({ kind: 'crash', text: (await page.locator('.crash h2').first().innerText().catch(() => '')) || 'crash card' });
  page.off('pageerror', onError);
  page.off('console', onConsole);
  page.off('response', onResponse);
  await reset(page, t);
  report.push({ page: t.name, issues });
  console.log(`${issues.length ? '✗' : '✓'} ${t.name}${issues.length ? ` (${issues.length})` : ''}`);
}
await P.close();
await browser.close();
fs.writeFileSync(path.join(OUT, 'smoke.json'), JSON.stringify(report, null, 2));
const bad = report.filter((r) => r.issues.length);
const md = [`# Smoke test`, ``, `${report.length} views, ${bad.length} with findings.`, ``, ...bad.flatMap((r) => [`## ${r.page}`, ...r.issues.map((i) => `- **${i.kind}** ${i.text}`), ''])];
fs.writeFileSync(path.join(OUT, 'smoke.md'), md.join('\n'));
console.log(`\n${bad.length} of ${report.length} views with findings → ${path.join(OUT, 'smoke.md')}`);
if (flag('strict') && bad.length) process.exit(1);
