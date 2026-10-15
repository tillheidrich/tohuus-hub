#!/usr/bin/env node
/**
 * Share cards for the website and the Ratgeber (docs/sharing.md, part 2): branded PNGs in 4:5 (1080 × 1350, feed)
 * and 9:16 (1080 × 1920, story / WhatsApp Status), rendered from one HTML template with the site's own fonts
 * (site/assets/fonts, OFL) by Playwright.
 *
 *   NODE_PATH=<scratch>/pw/node_modules PW_CHROMIUM=/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell \
 *     node scripts/share-cards.mjs [--only pflege-zu-hause,brand-handy-weg] [--out site/assets/share]
 *
 * Writes site/assets/share/<slug>-4x5.png, <slug>-9x16.png and index.json (read by site/src/build.mjs for the
 * "Zum Teilen" page). Playwright is not a repo dependency (docs/ui-audit.md).
 *
 * Content rules:
 * - Facts only from docs/research/2026-10-15-care-single-parents.md and 2026-10-15-screen-time-wellbeing.md, each
 *   with its source line ("Quelle: …, Jahr"). A fact without a source is never published.
 * - No health or effect claims about ToHuus (screen-time research, "Nicht verwenden"): fact cards describe what a
 *   study found, brand cards describe how ToHuus is built.
 * - German, du-Form, "Sache/Sachen", invented names only (there are none on the cards).
 *
 * Layout (docs/sharing.md): 72 px margin on 4:5; on 9:16 no text in the top 260 px or the bottom 360 px. The script
 * measures every card in the browser and fails when a value is too wide, a title runs over three lines or any text
 * leaves the safe zone. Look at a few PNGs before committing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { args, loadPlaywright } from './audit-shared.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const A = args({ out: 'site/assets/share' });
const OUT = path.resolve(ROOT, A.opt('out', 'site/assets/share'));
const SITE_HOST = 'tohuus.heidrich-digital.de';

// ------------------------------------------------------------------ content
/**
 * kind: 'fact' (canvas, ink, green accent; bottom line = source) or 'brand' (green; bottom line = "Gemacht mit ToHuus").
 * title: shown on the website and used as the alt text together with value and text.
 */
const FACTS = [
  {
    slug: 'pflege-zu-hause', eyebrow: 'Pflege in Deutschland', value: '86 %',
    title: 'der Pflegebedürftigen werden zu Hause versorgt.',
    text: 'Das sind 4,9 von knapp 5,7 Millionen Menschen. Ins Heim gehen 14 %.',
    source: 'Destatis, Pflegestatistik 2023 (2024)',
    url: 'https://www.destatis.de/DE/Presse/Pressemitteilungen/2024/12/PD24_478_224.html',
  },
  {
    slug: 'pflege-zweiter-haushalt', eyebrow: 'Pflege in Deutschland', value: '64 %',
    title: 'der Pflege durch Angehörige passiert außerhalb des eigenen Haushalts.',
    text: 'Meist bei den Eltern. Fast die Hälfte der Pflegenden ist dort dreimal pro Woche oder öfter.',
    source: 'DIW Wochenbericht 37/2025',
    url: 'https://www.diw.de/documents/publikationen/73/diw_01.c.973323.de/25-37-1.pdf',
  },
  {
    slug: 'pflege-wertschaetzung', eyebrow: 'Gesehen werden', value: '41 %',
    title: 'der Angehörigen, die aus der Ferne helfen, sagen: Andere verkennen, wie viel sie tun.',
    text: 'Aus einer Befragung von Menschen, die Eltern oder andere Angehörige auf Distanz unterstützen.',
    source: 'ZQP, Pflege auf Distanz, 2022',
    url: 'https://www.zqp.de/wp-content/uploads/ZQP_PI_DistanceCaregiving.pdf',
  },
  {
    slug: 'entlastungsbetrag', eyebrow: 'Hilfe, die liegen bleibt', value: '80 %',
    title: 'der befragten Pflegenden rufen den Entlastungsbetrag nicht ab.',
    text: 'Rat, was dir zusteht, gibt das Pflegetelefon des Bundes: 030 20179131.',
    source: 'VdK-Pflegestudie, 2022 (Mitgliederbefragung)',
    url: 'https://www.vdk.de/assets/bundesverband/dokumente/publikationen_vdk/Pflegestudie_2021/Naechstenpflege_Alleingelassen-und-in-Buerokratie-erstickt_VdK-Pflegestudie_Zentrale-Studienergebnisse_Forderungen.pdf',
  },
  {
    slug: 'young-carers', eyebrow: 'Young Carers', value: '6 %',
    title: 'der 10- bis 19-Jährigen pflegen Angehörige mit.',
    text: 'Das sind rund 480.000 Kinder und Jugendliche, etwa zwei pro Schulklasse.',
    source: 'Universität Witten/Herdecke (Metzing u. a.), 2018',
    url: 'https://www.gesundheit.bremen.de/sixcms/media.php/13/Bremer%2BInformationen%2Bzu%2BYoung%2BCarern%2BStand%2BApril%2B2025.pdf',
  },
  {
    slug: 'alleinerziehende', eyebrow: 'Alleinerziehend', value: '1,62 Mio.',
    title: 'Alleinerziehende mit minderjährigen Kindern leben in Deutschland.',
    text: '84 % von ihnen sind Mütter. Fast jede fünfte Familie mit Kindern hat ein Elternteil.',
    source: 'Destatis, Mikrozensus 2025 (2026)',
    url: 'https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/07/PD26_N051_12.html',
  },
  {
    slug: 'alleinerziehende-vollzeit', eyebrow: 'Alleinerziehend', value: '38,6 %',
    title: 'der alleinerziehenden Mütter arbeiten Vollzeit.',
    text: 'Bei Müttern in Paarfamilien sind es 30,7 %.',
    source: 'Destatis, Mikrozensus 2025 (2026)',
    url: 'https://www.destatis.de/DE/Presse/Pressemitteilungen/2026/07/PD26_N051_12.html',
  },
  {
    slug: 'mental-load-termine', eyebrow: 'Mental Load', value: '9 von 10',
    title: 'Müttern in Partnerschaft fühlten sich allein zuständig für die Familientermine.',
    text: 'Obwohl 65 % von ihnen erwerbstätig waren. Befragt wurden 393 Mütter in den USA.',
    source: 'Ciciolla & Luthar, Sex Roles, 2019',
    url: 'https://doi.org/10.1007/s11199-018-1001-x',
  },
  {
    slug: 'denkarbeit', eyebrow: 'Mental Load', value: '4',
    title: 'Teile hat die Denkarbeit im Haushalt.',
    text: 'Vorausdenken, Möglichkeiten finden, entscheiden, nachhalten. Frauen übernehmen öfter das Vorausdenken und Nachhalten.',
    source: 'Daminger, American Sociological Review, 2019',
    url: 'https://doi.org/10.1177/0003122419859007',
  },
  {
    slug: 'care-gap', eyebrow: 'Unbezahlte Arbeit', value: '43,8 %',
    title: 'mehr unbezahlte Arbeit leisten Frauen als Männer.',
    text: 'Rund 30 Stunden pro Woche gegenüber rund 21 Stunden.',
    source: 'Destatis, Zeitverwendungserhebung 2022 (2025)',
    url: 'https://www.bmbfsfj.bund.de/bmbfsfj/aktuelles/alle-meldungen/statistisches-bundesamt-veroeffentlicht-neue-zahlen-zum-gender-care-gap-236794',
  },
  {
    slug: 'plan-im-kopf', eyebrow: 'Aus dem Kopf', value: 'Plan',
    title: 'Mit einem konkreten Plan drängt sich eine offene Aufgabe weniger in den Kopf.',
    text: 'In Laborversuchen verschwanden die störenden Gedanken an eine offene Aufgabe, sobald es einen konkreten Plan gab.',
    source: 'Masicampo & Baumeister, JPSP, 2011 (Laborstudien)',
    url: 'https://supp.apa.org/psycarticles/supplemental/a0024192/a0024192_supp.html',
  },
  {
    slug: 'danke', eyebrow: 'Gesehen werden', value: 'Danke',
    title: 'Wer sich geschätzt fühlt, investiert mehr in die Beziehung.',
    text: 'Paare mit mehr gegenseitiger Wertschätzung waren nach neun Monaten eher noch zusammen.',
    source: 'Gordon u. a., Journal of Personality and Social Psychology, 2012',
    url: 'https://doi.org/10.1037/a0028723',
  },
  {
    slug: 'mitteilungen-buendeln', eyebrow: 'Mitteilungen', value: '3×',
    title: 'am Tag gebündelt statt jede einzeln.',
    text: 'In einem Experiment mit 237 Menschen berichteten sie so mehr Aufmerksamkeit und weniger Stress. Ganz ohne Mitteilungen wuchs die Sorge, etwas zu verpassen.',
    source: 'Fitz u. a., Computers in Human Behavior, 2019',
    url: 'https://scholars.duke.edu/publication/1402953',
  },
  {
    slug: 'serien', eyebrow: 'Ohne Serien', value: 'Serie',
    title: 'Reißt eine Serie, machen viele danach weniger weiter.',
    text: 'Besonders, wenn sie sich selbst die Schuld dafür geben.',
    source: 'Silverman & Barasch, Journal of Consumer Research, 2023',
    url: 'https://www.colorado.edu/business/faculty-research/2023/04/19/or-track-how-broken-streaks-affect-consumer-decisions',
  },
].map((c) => ({ ...c, kind: 'fact' }));

const BRAND = [
  {
    slug: 'brand-nicht-alles', eyebrow: 'Was ToHuus ist', quote: true,
    title: 'ToHuus ist der smarte Assistent, der nicht den Anspruch hat, das Tool für alles zu sein.',
    text: 'Es arbeitet mit Kalender, Erinnerungen und Notizen zusammen, statt sie zu ersetzen.',
  },
  {
    slug: 'brand-handy-weg', eyebrow: 'So ist ToHuus gebaut', value: 'Fertig.',
    title: 'Schnell erledigt, dann Handy weg.',
    text: 'Kein Feed, keine Serien. Ist für heute alles erledigt, sagt ToHuus dir das auch.',
  },
  {
    slug: 'brand-liegen-lassen', eyebrow: 'Ohne Druck', value: 'Pause.',
    title: 'Liegen lassen ist erlaubt. ToHuus wartet.',
    text: 'Keine Serien, die reißen, keine Ranglisten. Was heute nicht klappt, ist eben morgen dran.',
  },
  {
    slug: 'brand-gesehen-werden', eyebrow: 'Gesehen werden', value: 'Gesehen.',
    title: 'Im Kopf & nebenbei erledigt.',
    text: 'Was du im Kopf trägst oder nebenbei erledigst, sehen die anderen, wenn du magst. Und sagen mit einem Tipp: Danke.',
  },
].map((c) => ({ ...c, kind: 'brand' }));

const CARDS = [...FACTS, ...BRAND];

const FORMATS = {
  '4x5': { w: 1080, h: 1350, top: 72, bottom: 72, side: 72, value: 240 },
  '9x16': { w: 1080, h: 1920, top: 260, bottom: 360, side: 72, value: 300 },
};

const THEMES = {
  fact: { bg: '#f7f5ef', fg: '#181d1a', accent: '#176b50', house: '#176b50', door: '#e8b865' },
  brand: { bg: '#176b50', fg: '#fffdf9', accent: '#fffdf9', house: '#fffdf9', door: '#e8b865' },
};

// ------------------------------------------------------------------ template
const font = (f) => `data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, 'site/assets/fonts', f)).toString('base64')}`;
const FONTS = `
@font-face { font-family: 'Familjen Grotesk'; src: url(${font('familjen-grotesk-latin-wght-normal.woff2')}) format('woff2'); font-weight: 400 700; }
@font-face { font-family: 'Hedvig Letters Sans'; src: url(${font('hedvig-letters-sans-latin-400-normal.woff2')}) format('woff2'); font-weight: 400; }
@font-face { font-family: 'Hedvig Letters Serif'; src: url(${font('hedvig-letters-serif-latin-400-normal.woff2')}) format('woff2'); font-weight: 400; }`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function html(card, fmt) {
  const F = FORMATS[fmt];
  const T = THEMES[card.kind];
  const story = fmt === '9x16';
  // the door arch of the brand mark, big, bottom right, partly cut off (8 % of the text colour)
  const arch = story ? { w: 760, h: 1180, r: -170, b: -300 } : { w: 620, h: 960, r: -150, b: -260 };
  const foot = card.kind === 'fact' ? `Quelle: ${card.source}` : `Gemacht mit ToHuus · ${SITE_HOST}`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>${FONTS}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${F.w}px; height: ${F.h}px; }
body { background: ${T.bg}; color: ${T.fg}; font-family: 'Familjen Grotesk', sans-serif; font-synthesis: none; -webkit-font-smoothing: antialiased; }
.card { position: relative; width: ${F.w}px; height: ${F.h}px; overflow: hidden; background: ${T.bg}; }
.arch { position: absolute; right: ${arch.r}px; bottom: ${arch.b}px; width: ${arch.w}px; height: ${arch.h}px; border-radius: 999px 999px 0 0; background: ${T.fg}; opacity: 0.08; }
.safe { position: absolute; left: ${F.side}px; right: ${F.side}px; top: ${F.top}px; bottom: ${F.bottom}px; display: flex; flex-direction: column; }
.head { display: flex; align-items: center; gap: 18px; }
.head svg { width: 64px; height: 64px; flex: none; }
.head span { font-family: 'Hedvig Letters Sans', serif; font-size: 46px; line-height: 1; }
.body { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: ${story ? 48 : 36}px 0; min-height: 0; }
.eyebrow { font-weight: 600; font-size: 30px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.8; display: flex; align-items: center; gap: 14px; }
.eyebrow::before { content: ''; width: 14px; height: 14px; background: ${T.accent}; flex: none; opacity: ${card.kind === 'fact' ? 1 : 0.9}; }
.value { font-family: 'Hedvig Letters Serif', serif; font-weight: 400; font-size: ${F.value}px; line-height: 1; letter-spacing: -0.02em; color: ${T.accent}; white-space: nowrap; margin: ${story ? 28 : 18}px 0 ${story ? 28 : 20}px; }
.title { font-weight: 600; font-size: 60px; line-height: 1.14; letter-spacing: -0.005em; text-wrap: balance; }
.quote { font-family: 'Hedvig Letters Serif', serif; font-weight: 400; font-size: ${story ? 96 : 86}px; line-height: 1.1; letter-spacing: -0.01em; margin-top: ${story ? 36 : 28}px; text-wrap: balance; }
.text { font-size: 40px; line-height: 1.32; opacity: 0.85; margin-top: ${story ? 32 : 26}px; text-wrap: pretty; }
.foot { font-size: 28px; line-height: 1.3; opacity: 0.7; max-width: ${card.kind === 'fact' ? 820 : 936}px; }
</style></head><body><div class="card">
<div class="arch" aria-hidden="true"></div>
<div class="safe">
  <div class="head" data-t><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 28V14L16 4l12 10v14z" fill="${T.house}"/><path d="M12.5 28v-6.5a3.5 3.5 0 0 1 7 0V28z" fill="${T.door}"/></svg><span>ToHuus</span></div>
  <div class="body">
    <p class="eyebrow" data-t>${esc(card.eyebrow)}</p>
    ${card.value ? `<p class="value" data-t>${esc(card.value)}</p>` : ''}
    <p class="${card.quote ? 'quote' : 'title'}" data-t>${esc(card.title)}</p>
    ${card.text ? `<p class="text" data-t>${esc(card.text)}</p>` : ''}
  </div>
  <p class="foot" data-t>${esc(foot)}</p>
</div></div></body></html>`;
}

/** Runs in the page: shrink the value until it fits, then report anything outside the safe zone. */
function measure({ w, h, top, bottom, side }) {
  const out = [];
  const v = document.querySelector('.value');
  if (v) {
    let size = parseFloat(getComputedStyle(v).fontSize);
    while (v.scrollWidth > v.clientWidth + 1 && size > 120) { size -= 4; v.style.fontSize = `${size}px`; }
    if (v.scrollWidth > v.clientWidth + 1) out.push(`value too wide (${v.scrollWidth}px)`);
  }
  const t = document.querySelector('.title');
  if (t) {
    const lines = Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight));
    if (lines > 3) out.push(`title has ${lines} lines`);
  }
  const body = document.querySelector('.body');
  if (body.scrollHeight > body.clientHeight + 1) out.push(`content taller than the space (${body.scrollHeight} > ${body.clientHeight})`);
  for (const el of document.querySelectorAll('[data-t]')) {
    const r = el.getBoundingClientRect();
    if (r.top < top - 0.5 || r.bottom > h - bottom + 0.5 || r.left < side - 0.5 || r.right > w - side + 0.5) out.push(`${el.className || el.tagName} outside the safe zone`);
  }
  return out;
}

// ------------------------------------------------------------------ render
const ONLY = A.ONLY;
const pick = ONLY.length ? CARDS.filter((c) => ONLY.includes(c.slug)) : CARDS;
if (!pick.length) throw new Error(`--only matches no card (${CARDS.map((c) => c.slug).join(', ')})`);
for (const c of CARDS) {
  if (c.kind === 'fact' && (!c.source || !c.url)) throw new Error(`${c.slug}: a fact needs a source and a link`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug)) throw new Error(`${c.slug}: bad slug`);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: A.EXEC });
fs.mkdirSync(OUT, { recursive: true });
const problems = [];
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const card of pick) {
    for (const [fmt, F] of Object.entries(FORMATS)) {
      await page.setViewportSize({ width: F.w, height: F.h });
      await page.setContent(html(card, fmt), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const issues = await page.evaluate(measure, F);
      for (const i of issues) problems.push(`${card.slug} ${fmt}: ${i}`);
      const file = path.join(OUT, `${card.slug}-${fmt}.png`);
      const shot = await page.screenshot({ clip: { x: 0, y: 0, width: F.w, height: F.h } });
      // flat colours and anti-aliased text: a 256-colour palette keeps them sharp at a fraction of the size
      await sharp(shot).png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 }).toFile(file);
      console.log(`${path.relative(ROOT, file)}${issues.length ? `  ! ${issues.join('; ')}` : ''}`);
    }
  }
} finally {
  await browser.close();
}

// index.json always lists every card (the site build reads it), in the order above
const index = {
  version: 1,
  note: 'Generated by scripts/share-cards.mjs (docs/sharing.md). Do not edit by hand.',
  cards: CARDS.map((c) => ({
    slug: c.slug, kind: c.kind, eyebrow: c.eyebrow, value: c.value ?? null, title: c.title, text: c.text ?? null,
    source: c.source ?? null, url: c.url ?? null,
    files: Object.fromEntries(Object.keys(FORMATS).map((f) => [f, `${c.slug}-${f}.png`])),
  })),
};
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`${pick.length} cards × ${Object.keys(FORMATS).length} formats → ${path.relative(ROOT, OUT)}`);
if (problems.length) {
  console.error(`\n${problems.length} layout problem(s):\n${problems.join('\n')}`);
  process.exit(1);
}
