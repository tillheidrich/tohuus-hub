/**
 * Generates every ToHuus Hub icon (SVG + PNG) from one geometry – "Dutch Detail" (wave 6,
 * docs/design/2026-10-11-dutch-detail-system.md): a flat green tile, the ToHuus house in warm paper with an arched
 * mustard door, and a quarter disc in the corner like the header block on Today. No gradients, no glow.
 * Run from the repo root:  node docs/design/build-icons.mjs
 * (The former second look "Fredirando" was retired in wave 6; its icon files were removed.)
 */
import fs from 'node:fs';
import sharp from 'sharp';

const PUB = 'web/public';
const SITE = 'site/assets';

const PAL = {
  light: { bg: '#176b50', disc: '#2c7a5f', house: '#f7f5ef', door: '#e8b865', edge: '#000000' },
  dark: { bg: '#0f1513', disc: '#1c3229', house: '#74cda2', door: '#e8b865', edge: '#ffffff' },
};

/** the mark on a 1024 canvas: house (M4 28V14L16 4l12 10v14z) with the arched door, from the 32-unit brand mark */
function mark(c) {
  return `
  <g transform="translate(112 132) scale(25)">
    <path d="M4 28V14L16 4l12 10v14z" fill="${c.house}"/>
    <path d="M12.5 28v-6.5a3.5 3.5 0 0 1 7 0V28z" fill="${c.door}"/>
  </g>`;
}

function iconSvg(theme, { rounded = true, scale = 1, id = 'a' } = {}) {
  const c = PAL[theme];
  const rx = rounded ? 232 : 0;
  const t = scale === 1 ? '' : ` transform="translate(${512 - 512 * scale} ${512 - 512 * scale}) scale(${scale})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs><clipPath id="clip-${id}"><rect width="1024" height="1024" rx="${rx}"/></clipPath></defs>
  <g clip-path="url(#clip-${id})">
    <rect width="1024" height="1024" fill="${c.bg}"/>
    <circle cx="1000" cy="1010" r="380" fill="${c.disc}"/>
  </g>
  ${rounded ? `<rect x="3" y="3" width="1018" height="1018" rx="${rx - 3}" fill="none" stroke="${c.edge}" stroke-opacity="${theme === 'dark' ? 0.1 : 0.07}" stroke-width="6"/>` : ''}
  <g${t}>${mark(c)}
  </g>
</svg>
`;
}

/** favicon: follows the browser's light/dark setting */
function faviconSvg() {
  const body = (c, id) => `<g class="${id}"><rect width="1024" height="1024" rx="232" fill="${c.bg}"/><g transform="translate(-61 -40) scale(1.12)">${mark(c)}</g></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <style>.d{display:none}@media (prefers-color-scheme: dark){.l{display:none}.d{display:inline}}</style>
  ${body(PAL.light, 'l')}
  ${body(PAL.dark, 'd')}
</svg>
`;
}

const write = (f, s) => { fs.writeFileSync(f, s); console.log('wrote', f); };
const png = async (svg, size, file) => { await sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toFile(file); console.log('wrote', file); };

const light = iconSvg('light', { id: 'l' });
const dark = iconSvg('dark', { id: 'd' });
const maskL = iconSvg('light', { rounded: false, scale: 0.8, id: 'm' });
const flatL = iconSvg('light', { rounded: false, id: 't' });
const flatD = iconSvg('dark', { rounded: false, id: 'u' });
write(`${PUB}/icon.svg`, faviconSvg());
write(`${PUB}/icon-light.svg`, light);
write(`${PUB}/icon-dark.svg`, dark);
write(`${PUB}/tohuus-logo.svg`, light);
write(`${PUB}/tohuus-logo-dark.svg`, dark);
await png(light, 1024, `${PUB}/icon-1024.png`);
await png(light, 512, `${PUB}/icon-512.png`);
await png(light, 192, `${PUB}/icon-192.png`);
await png(dark, 512, `${PUB}/icon-512-dark.png`);
await png(dark, 192, `${PUB}/icon-192-dark.png`);
await png(maskL, 512, `${PUB}/icon-maskable-512.png`);
await png(maskL, 192, `${PUB}/icon-maskable-192.png`);
await png(light, 32, `${PUB}/favicon-32.png`);
// iOS rounds the corners itself: full-bleed square
await png(flatL, 180, `${PUB}/apple-touch-icon.png`);
await png(flatD, 180, `${PUB}/apple-touch-icon-dark.png`);
write(`${SITE}/favicon.svg`, faviconSvg());
write(`${SITE}/favicon-light.svg`, light);
write(`${SITE}/favicon-dark.svg`, dark);
await png(flatL, 180, `${SITE}/apple-touch-icon.png`);
await png(flatD, 180, `${SITE}/apple-touch-icon-dark.png`);
await png(light, 192, `${SITE}/icon-192.png`);
await png(dark, 192, `${SITE}/icon-192-dark.png`);
await png(light, 32, `${SITE}/favicon-32.png`);
