// Renders the brand images for Home Assistant / HACS from the ToHuus Hub app icon.
// Run from the ToHuus Hub repository root (it needs `sharp` and the Geist font from node_modules):
//   node ha-integration/scripts/render_brand.mjs
// Writes custom_components/tohuus_hub/{icon,logo}.png (+ dark/@2x variants under brands/) for the
// home-assistant/brands pull request.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const ha = path.join(root, 'ha-integration');
const svg = fs.readFileSync(path.join(root, 'web/public/icon-light.svg'));
// the app icon's viewBox width (1024 since the 2026-10 redesign) decides the render density
const vbw = Number(/viewBox="0 0 (\d+)/.exec(svg.toString())?.[1] ?? 32);
const font = path.join(root, 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2');
const comp = path.join(ha, 'custom_components/tohuus_hub');
const brands = path.join(ha, 'brands/custom_integrations/tohuus_hub');
fs.mkdirSync(brands, { recursive: true });

const icon = (size) => sharp(svg, { density: Math.max(1, Math.ceil((size / vbw) * 72)) }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** Icon + wordmark on transparent background; height = icon size, trimmed. */
async function logo(size, color) {
  const mark = await icon(size);
  const text = await sharp({
    text: {
      text: `<span foreground="${color}" font_weight="600">ToHuus Hub</span>`,
      font: `Geist ${Math.round(size * 0.42)}px`,
      ...(fs.existsSync(font) ? { fontfile: font } : {}),
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer();
  const tm = await sharp(text).metadata();
  const gap = Math.round(size * 0.18);
  const width = size + gap + (tm.width ?? 0);
  return sharp({ create: { width, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: mark, left: 0, top: 0 },
      { input: text, left: size + gap, top: Math.max(0, Math.round((size - (tm.height ?? 0)) / 2)) },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const out = {
  [path.join(comp, 'icon.png')]: await icon(256),
  [path.join(comp, 'logo.png')]: await logo(256, '#1e5e4b'),
  [path.join(brands, 'icon.png')]: await icon(256),
  [path.join(brands, 'icon@2x.png')]: await icon(512),
  [path.join(brands, 'logo.png')]: await logo(256, '#1e5e4b'),
  [path.join(brands, 'logo@2x.png')]: await logo(512, '#1e5e4b'),
  [path.join(brands, 'dark_logo.png')]: await logo(256, '#efeadf'),
  [path.join(brands, 'dark_logo@2x.png')]: await logo(512, '#efeadf'),
};
for (const [file, buf] of Object.entries(out)) {
  fs.writeFileSync(file, buf);
  const m = await sharp(buf).metadata();
  console.log(`${path.relative(root, file)}  ${m.width}×${m.height}`);
}
