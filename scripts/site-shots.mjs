#!/usr/bin/env node
/**
 * Screenshots for the marketing website (site/assets/shots/<lang>/<name>-480|960.webp), shot like a real iPhone:
 * the web app at 390×844 pt, 3× pixels, with the iPhone's safe areas simulated (47 pt status bar on top, 34 pt home
 * indicator at the bottom – the app's own --safe-t / --safe-b), so the device frame on the site only rounds off empty
 * corners and never cuts the tab bar or the header (13 Oct 2026: "der Rand wird oft abgeschnitten").
 *
 * Needs a local ToHuus Cloud with open sign-up (CLOUD_SIGNUP=open) – it creates a fresh household per language with
 * the sample data and invented people (house rules: Familie Berg, Sam, Mira, Mika, Ben – never real names).
 *
 *   NODE_PATH=<scratch>/node_modules node scripts/site-shots.mjs http://localhost:8711 [--lang de,en] [--out site/assets/shots]
 *
 * Look at every image before committing.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { args, loadPlaywright, seed, setBase } from './audit-shared.mjs';

const A = args({ out: 'site/assets/shots' });
const OUT = path.resolve(A.opt('out', 'site/assets/shots'));
const LANGS = String(A.opt('lang', 'de,en')).split(',');
const { chromium } = loadPlaywright();
setBase(A.BASE);

/** iPhone 15/16 class: 390×844 pt with 47 pt status bar and 34 pt home indicator */
const SAFE = `:root { --safe-t: 47px !important; --safe-b: 34px !important; }
  .demo-tag, .demo-banner, [data-audit-ignore] { display: none !important; }
  * { scroll-behavior: auto !important; caret-color: transparent !important; }`;

const SHOTS = [
  { name: 'today', path: '/' },
  { name: 'today-dark', path: '/', dark: true },
  { name: 'shopping', path: '/einkauf' },
  { name: 'cook', path: '/kochen' },
  { name: 'money', path: '/geld' },
  { name: 'import', path: '/import' },
  { name: 'treats', path: '/bestellen' },
  { name: 'wishes', path: '/einkauf/wuensche' },
];

/** Four months of invented receipts: the purchase rhythm, "probably due", Geld and the price history get real data. */
const POOL = {
  de: {
    shops: ['REWE', 'Lidl', 'ALDI SÜD', 'Edeka', 'dm'],
    every: [['Vollmilch', 1.19, 4], ['Vollkornbrot', 2.49, 5], ['Bananen', 1.69, 6], ['Butter', 2.29, 9], ['Eier', 2.99, 8], ['Joghurt', 0.89, 5], ['Äpfel', 2.49, 9], ['Kaffee', 6.99, 21], ['Haferflocken', 0.99, 14], ['Tomaten', 1.99, 7], ['Käse', 2.79, 10], ['Nudeln', 1.29, 12]],
    sometimes: [['Spülmittel', 1.45], ['Zahnpasta', 1.95], ['Pizza Margherita', 2.49], ['Paprika', 1.79], ['Gurke', 0.79], ['Hähnchenbrust', 5.99], ['Reis', 1.89], ['Schokolade', 1.29], ['Toilettenpapier', 3.95], ['Mineralwasser', 3.49]],
    total: 'SUMME',
    date: (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)} 18:12`,
    price: (n) => `${n.toFixed(2).replace('.', ',')} A`,
    sum: (n) => n.toFixed(2).replace('.', ','),
  },
  en: {
    shops: ['TESCO', 'Lidl', 'ALDI', 'Sainsbury’s', 'Boots'],
    every: [['Semi skimmed milk', 1.45, 4], ['Wholemeal bread', 1.35, 5], ['Bananas', 0.95, 6], ['Butter', 2.1, 9], ['Free range eggs', 2.25, 8], ['Greek yoghurt', 1.5, 5], ['Apples', 1.8, 9], ['Coffee', 4.5, 21], ['Porridge oats', 0.9, 14], ['Tomatoes', 1.1, 7], ['Cheddar', 2.6, 10], ['Pasta', 0.8, 12]],
    sometimes: [['Washing up liquid', 1.2], ['Toothpaste', 1.5], ['Pizza', 2.2], ['Peppers', 1.3], ['Cucumber', 0.7], ['Chicken breast', 4.5], ['Rice', 1.4], ['Chocolate', 1.1], ['Toilet roll', 3.5], ['Sparkling water', 2.4]],
    total: 'TOTAL',
    date: (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} 18:12`,
    price: (n) => n.toFixed(2),
    sum: (n) => n.toFixed(2),
  },
};
async function receipts(ctx, lang) {
  const P = POOL[lang];
  let rnd = 7;
  const rand = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
  const last = new Map();
  for (let back = 120; back >= 1; back -= 3 + Math.floor(rand() * 3)) {
    const day = new Date(Date.now() - back * 864e5);
    const items = [];
    for (const [name, price, every] of P.every) if (!last.has(name) || back <= last.get(name) - every + Math.floor(rand() * 2)) {
      items.push([name, price]);
      last.set(name, back);
    }
    for (const x of P.sometimes) if (rand() < 0.18) items.push(x);
    if (!items.length) continue;
    const total = items.reduce((a, [, p]) => a + p, 0);
    const lines = [P.shops[Math.floor(rand() * P.shops.length)], ...items.map(([n, p]) => `${n} ${P.price(p)}`), `${P.total} ${P.sum(total)}`, P.date(day)];
    const r = await ctx.request.post(`${A.BASE}/api/imports/lines`, { data: { lines, source: 'ocr-device', mode: 'receipt' } });
    const j = await r.json().catch(() => null);
    if (j?.id) await ctx.request.post(`${A.BASE}/api/imports/${j.id}/apply`, { data: {} });
  }
}

const browser = await chromium.launch({ executablePath: A.EXEC });
for (const lang of LANGS) {
  const setup = await browser.newContext({ locale: lang === 'de' ? 'de-DE' : 'en-GB' });
  const email = `site-${lang}-${Date.now()}@example.org`;
  const r = await setup.request.post(`${A.BASE}/api/cloud/signup`, {
    data: { email, password: 'site-shots-1234', name: 'Sam', householdName: lang === 'de' ? 'Familie Berg' : 'The Bergs', form: 'family', lang, region: lang === 'de' ? 'DE' : 'GB', client: 'web' },
  });
  if (r.status() !== 200) throw new Error(`signup failed: ${r.status()} ${await r.text()}`);
  await setup.request.patch(`${A.BASE}/api/onboarding`, { data: { closed: true, skipped: true, started: true, checklistDismissed: true } });
  await setup.request.post(`${A.BASE}/api/tour/start`, { data: { choice: 'demo' } });
  await setup.request.put(`${A.BASE}/api/tour`, { data: { status: 'skipped' } });
  await receipts(setup, lang);
  if (lang === 'de') await seed(setup);
  else {
    // English wish lists (the shared seed writes German ones)
    const mk = async (body) => (await (await setup.request.post(`${A.BASE}/api/wishes/lists`, { data: body })).json());
    const xmas = await mk({ name: 'Christmas for Mika', for_name: 'Mika', note: 'What Mika would love – until mid December' });
    for (const w of [{ title: 'Wooden marble run', price: 49.9, links: [{ url: 'https://example.org/marble-run', label: 'Toy shop' }] }, { title: 'Dinosaur torch', price: 14.99 }, { title: 'Picture book about the sea', price: 12.5 }])
      await setup.request.post(`${A.BASE}/api/wishes/lists/${xmas.id}/items`, { data: w });
    const keep = await mk({ name: 'New biscuits & finds' });
    for (const w of [{ title: 'Salted caramel biscuits', note: 'From the food article – only in some shops so far', price: 2.99 }, { title: 'Oat & raspberry bars', price: 3.49 }])
      await setup.request.post(`${A.BASE}/api/wishes/lists/${keep.id}/items`, { data: w });
  }
  // the dark shot follows the browser's colour scheme
  await setup.request.patch(`${A.BASE}/api/appearance/household`, { data: { theme: 'system', userChoice: true } });
  await setup.request.patch(`${A.BASE}/api/appearance/me`, { data: { theme: null } });
  const storage = await setup.storageState();
  await setup.close();
  fs.mkdirSync(path.join(OUT, lang), { recursive: true });
  for (const s of SHOTS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: s.dark ? 'dark' : 'light', reducedMotion: 'reduce', storageState: storage, locale: lang === 'de' ? 'de-DE' : 'en-GB', hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => {
      try {
        sessionStorage.setItem('sw.onb.redirected', '1');
        localStorage.setItem('sw.theme', 'system');
      } catch {
        /* ignore */
      }
    });
    const page = await ctx.newPage();
    await page.goto(A.BASE + s.path, { waitUntil: 'load' });
    await page.addStyleTag({ content: SAFE });
    await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"], .skeleton'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const png = await page.screenshot({ type: 'png' });
    for (const w of [480, 960]) await sharp(png).resize({ width: w }).webp({ quality: 82 }).toFile(path.join(OUT, lang, `${s.name}-${w}.webp`));
    console.log(`✓ ${lang}/${s.name}`);
    await ctx.close();
  }
}
await browser.close();
