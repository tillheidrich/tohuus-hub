/**
 * Generates every ToHuus Hub / Fredirando icon (SVG + PNG) from one geometry.
 * Run from the repo root:  node docs/design/build-icons.mjs
 * Design notes: docs/design/2026-10-11-nordic-direction.md ("Icon").
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const PUB = 'web/public';
const SITE = 'site/assets';

const PAL = {
  tohuus: {
    light: { bg: ['#fbf8f2', '#efe8db'], edge: '#1a2321', mark: '#1e5e4b', dot: '#d2553c', door: null },
    dark: { bg: ['#16201c', '#0c1210'], edge: '#ffffff', mark: '#efeadf', dot: '#ef7a62', door: null },
  },
  fredirando: {
    light: { bg: ['#fff8f1', '#fbe6d4'], edge: '#7a3a14', mark: '#e8561a', dot: '#2a1d16', door: null, speed: true },
    dark: { bg: ['#241812', '#140c08'], edge: '#ffffff', mark: '#ff7a3d', dot: '#fbefe7', door: null, speed: true },
  },
};

/** the mark on a 1024 canvas: A-frame roof, cabin body with an arched door, a small round "lingon" sun */
function mark(c, id) {
  const speed = c.speed
    ? `<g stroke="${c.mark}" stroke-width="40" stroke-linecap="round" opacity="0.55">
         <line x1="132" y1="590" x2="226" y2="590"/><line x1="160" y1="672" x2="236" y2="672"/><line x1="132" y1="754" x2="200" y2="754"/>
       </g>`
    : '';
  const dx = c.speed ? 40 : 0;
  return `
  ${speed}
  <g transform="translate(${dx} 0)">
    <path d="M214 486 L512 246 L810 486" fill="none" stroke="${c.mark}" stroke-width="92" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="306" y="516" width="412" height="306" rx="64" fill="${c.mark}"/>
    <path d="M454 822 V700 a58 58 0 0 1 116 0 V822 Z" fill="${c.dot}"/>
  </g>`;
}

function iconSvg(brand, theme, { rounded = true, scale = 1.06, id = 'a' } = {}) {
  const c = PAL[brand][theme];
  const rx = rounded ? 232 : 0;
  const t = scale === 1 ? '' : ` transform="translate(${512 - 512 * scale} ${512 - 512 * scale}) scale(${scale})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.bg[0]}"/><stop offset="1" stop-color="${c.bg[1]}"/></linearGradient>
    <radialGradient id="glow-${id}" cx="0.3" cy="0.12" r="0.9"><stop offset="0" stop-color="#ffffff" stop-opacity="${theme === 'dark' ? 0.06 : 0.55}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1024" height="1024" rx="${rx}" fill="url(#bg-${id})"/>
  <rect width="1024" height="1024" rx="${rx}" fill="url(#glow-${id})"/>
  ${rounded ? `<rect x="3" y="3" width="1018" height="1018" rx="${rx - 3}" fill="none" stroke="${c.edge}" stroke-opacity="${theme === 'dark' ? 0.08 : 0.07}" stroke-width="6"/>` : ''}
  <g${t}>${mark(c, id)}
  </g>
</svg>
`;
}

/** favicon: follows the browser's light/dark setting */
function faviconSvg(brand) {
  const l = PAL[brand].light, d = PAL[brand].dark;
  const body = (c, id) => `<g class="${id}"><rect width="1024" height="1024" rx="232" fill="${c.bg[1]}"/><g transform="translate(-61 -61) scale(1.12)">${mark(c, id)}</g></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <style>.d{display:none}@media (prefers-color-scheme: dark){.l{display:none}.d{display:inline}}</style>
  ${body(l, 'l')}
  ${body(d, 'd')}
</svg>
`;
}

const write = (f, s) => { fs.writeFileSync(f, s); console.log('wrote', f); };
const png = async (svg, size, file) => { await sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file); console.log('wrote', file); };

for (const brand of ['tohuus', 'fredirando']) {
  const pre = brand === 'tohuus' ? 'icon' : 'fredirando';
  const light = iconSvg(brand, 'light', { id: 'l' });
  const dark = iconSvg(brand, 'dark', { id: 'd' });
  const maskL = iconSvg(brand, 'light', { rounded: false, scale: 0.84, id: 'm' });
  const flatL = iconSvg(brand, 'light', { rounded: false, id: 't' });
  const flatD = iconSvg(brand, 'dark', { rounded: false, id: 'u' });
  if (brand === 'tohuus') {
    write(`${PUB}/icon.svg`, faviconSvg(brand));
    write(`${PUB}/icon-light.svg`, light);
    write(`${PUB}/icon-dark.svg`, dark);
    write(`${PUB}/tohuus-logo.svg`, light);
    write(`${PUB}/tohuus-logo-dark.svg`, dark);
  } else {
    write(`${PUB}/fredirando.svg`, light);
    write(`${PUB}/fredirando-light.svg`, light);
    write(`${PUB}/fredirando-dark.svg`, dark);
  }
  await png(light, 1024, `${PUB}/${pre}-1024.png`);
  await png(light, 512, `${PUB}/${pre}-512.png`);
  await png(light, 192, `${PUB}/${pre}-192.png`);
  await png(dark, 512, `${PUB}/${pre}-512-dark.png`);
  await png(dark, 192, `${PUB}/${pre}-192-dark.png`);
  await png(maskL, 512, `${PUB}/${pre}-maskable-512.png`);
  await png(maskL, 192, `${PUB}/${pre}-maskable-192.png`);
  await png(light, 32, `${PUB}/${brand === 'tohuus' ? 'favicon' : 'fredirando'}-32.png`);
  // iOS rounds the corners itself: full-bleed square
  await png(flatL, 180, `${PUB}/${brand === 'tohuus' ? 'apple-touch-icon' : 'fredirando-touch'}.png`);
  await png(flatD, 180, `${PUB}/${brand === 'tohuus' ? 'apple-touch-icon-dark' : 'fredirando-touch-dark'}.png`);
  if (brand === 'tohuus') {
    write(`${SITE}/favicon.svg`, faviconSvg(brand));
    write(`${SITE}/favicon-light.svg`, light);
    write(`${SITE}/favicon-dark.svg`, dark);
    await png(flatL, 180, `${SITE}/apple-touch-icon.png`);
    await png(flatD, 180, `${SITE}/apple-touch-icon-dark.png`);
    await png(light, 192, `${SITE}/icon-192.png`);
    await png(dark, 192, `${SITE}/icon-192-dark.png`);
    await png(light, 32, `${SITE}/favicon-32.png`);
  }
}
