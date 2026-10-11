/**
 * The ToHuus house: a terraced gable house in cross-section, drawn like an assembly manual
 * (one ink line weight, flat fills, numbered callouts). Successor of the old build_house.py / house.svg.tpl.
 *
 * houseSvg({ label, mode }) returns the SVG markup.
 *   mode 'inline' (default): colours come from CSS classes (.hz …) styled in site/assets/site.css, so the
 *   page's light and dark theme apply automatically.
 *   mode 'light' | 'dark': a standalone file with its own <style> (site/assets/img/house-<mode>.svg, for
 *   social images, docs, the README).
 *
 * Inclusive by design (Till's rule): no cellar, no stairs, no chest freezer. Rooms: kitchen with fridge and
 * wall cupboard, hallway with front door and a chest of drawers, bathroom with mirror cabinet, living room,
 * attic storage with labelled boxes.
 */

export const PALETTE = {
  light: { ink: '#121715', ink3: '#5a6360', ghost: '#c9c1b2', room: '#ffffff', wall: '#ead9bb', wood: '#ead9bb', brand: '#0b6148', soft: '#d9ece3', door: '#d4482f', sky: 'none' },
  dark: { ink: '#f3f1ec', ink3: '#8f9894', ghost: '#3b433f', room: '#191d1b', wall: '#3d3427', wood: '#4a3f2f', brand: '#5fd0a0', soft: '#17342a', door: '#f07a62', sky: 'none' },
};

const call = (n, x, y, lx, ly) => `
  <g class="hz-call" data-n="${n}">
    ${lx != null ? `<path class="hz-lead" d="M${x} ${y}L${lx} ${ly}"/>` : ''}
    <circle cx="${x}" cy="${y}" r="15" class="w"/>
    <text x="${x}" y="${y + 6}" text-anchor="middle" class="hz-n">${n}</text>
  </g>`;

const hatch = Array.from({ length: 40 }, (_, i) => `M${4 + i * 16} 514l10-12`).join('');

function body() {
  return `
  <!-- neighbours (terraced): only hinted -->
  <g class="hz-ghost">
    <path d="M0 150 72 200M640 150 568 200"/>
    <rect x="16" y="282" width="44" height="58" rx="2"/><path d="M38 282v58"/>
    <rect x="16" y="396" width="44" height="76" rx="2"/>
    <rect x="580" y="282" width="44" height="58" rx="2"/><path d="M602 282v58"/>
    <rect x="580" y="396" width="44" height="76" rx="2"/>
  </g>

  <!-- chimney, walls, roof in section -->
  <rect x="408" y="62" width="36" height="72" class="b"/>
  <rect x="402" y="56" width="48" height="10" rx="2" class="w"/>
  <rect x="80" y="200" width="480" height="300" class="wall"/>
  <path d="M56 214 320 40 584 214Z" class="p hz-roof"/>
  <path d="M112 210 320 72 528 210Z" class="w"/>

  <!-- attic: round window, a shelf of labelled boxes -->
  <circle cx="320" cy="130" r="22" class="glass"/>
  <path class="thin" d="M320 108v44M298 130h44"/>
  <circle cx="320" cy="130" r="22"/>
  <rect x="196" y="190" width="248" height="6" rx="1" class="b"/>
  <rect x="212" y="158" width="46" height="32" rx="2" class="b"/>
  <rect x="222" y="167" width="20" height="12" rx="1" class="w"/><path class="thin" d="M226 171h12M226 175h8"/>
  <rect x="266" y="170" width="32" height="20" rx="2" class="w"/>
  <rect x="384" y="154" width="48" height="36" rx="2" class="b"/>
  <rect x="394" y="164" width="20" height="12" rx="1" class="w"/><path class="thin" d="M398 168h12M398 172h8"/>
  <path d="M340 190v-18h28v18" class="soft"/>

  <!-- rooms -->
  <rect x="96" y="222" width="166" height="130" class="w"/>
  <rect x="276" y="222" width="268" height="130" class="w"/>
  <rect x="96" y="366" width="140" height="122" class="w"/>
  <rect x="250" y="366" width="294" height="122" class="w"/>

  <!-- bathroom: mirror cabinet, basin, towel -->
  <rect x="134" y="240" width="80" height="52" rx="2" class="b"/>
  <rect x="139" y="245" width="33" height="42" rx="1" class="glass"/>
  <rect x="176" y="245" width="33" height="42" rx="1" class="glass"/>
  <path class="thin" d="M150 252l10 10M187 252l10 10"/>
  <path d="M134 308h80c-3 15-18 21-40 21s-37-6-40-21Z" class="w"/>
  <path d="M174 308v-9h11"/>
  <rect x="166" y="329" width="16" height="23" class="w"/>
  <path d="M228 262h26"/>
  <path d="M232 262h18v42h-18Z" class="soft"/>

  <!-- living room: sofa, wall shelf, TV on a sideboard -->
  <rect x="306" y="248" width="112" height="5" rx="1" class="b"/>
  <rect x="314" y="226" width="8" height="22" class="b"/><rect x="324" y="230" width="8" height="18" class="l"/><rect x="334" y="228" width="8" height="20" class="w"/>
  <path d="M380 248l4-14h16l4 14Z" class="b"/><path class="thin" d="M392 234c-6-8-2-14 0-16M392 234c6-8 3-13 1-15"/>
  <rect x="298" y="286" width="150" height="24" rx="4" class="p"/>
  <rect x="298" y="304" width="150" height="30" rx="4" class="p"/>
  <rect x="290" y="296" width="18" height="38" rx="4" class="p"/>
  <rect x="438" y="296" width="18" height="38" rx="4" class="p"/>
  <path d="M302 334v18M444 334v18"/>
  <rect x="468" y="250" width="64" height="40" rx="3" class="tv"/>
  <path d="M500 290v14"/>
  <rect x="464" y="304" width="72" height="48" rx="2" class="b"/>
  <path class="thin" d="M500 304v48"/>

  <!-- hallway: front door, coat hooks, chest of drawers -->
  <rect x="110" y="390" width="54" height="98" rx="2" class="l"/>
  <rect x="122" y="402" width="30" height="18" rx="1" class="glass"/>
  <circle cx="155" cy="442" r="3" class="k"/>
  <path d="M178 388h52M208 388v6M222 388v6"/>
  <path d="M208 394l-8 34h18l-4-34" class="soft"/>
  <rect x="176" y="438" width="54" height="50" rx="2" class="b"/>
  <path class="thin" d="M176 454h54M176 471h54"/>
  <path d="M199 446h8M199 462h8M199 479h8"/>

  <!-- kitchen: fridge, wall cupboard, counter with pot, window, plant -->
  <rect x="264" y="380" width="66" height="108" rx="5" class="w"/>
  <path d="M264 420h66"/>
  <path d="M320 390v18M320 430v26" class="hz-handle"/>
  <circle cx="279" cy="470" r="4" class="l"/>
  <rect x="276" y="434" width="18" height="18" class="b" transform="rotate(-6 285 443)"/>
  <rect x="350" y="380" width="120" height="38" rx="2" class="b"/>
  <path class="thin" d="M390 380v38M430 380v38"/>
  <path d="M384 396v6M436 396v6"/>
  <rect x="484" y="380" width="46" height="44" rx="2" class="glass"/>
  <path class="thin" d="M507 380v44M484 402h46"/>
  <rect x="484" y="380" width="46" height="44" rx="2"/>
  <rect x="344" y="440" width="190" height="48" class="b"/>
  <path class="thin" d="M392 444v44M440 444v44M488 444v44"/>
  <path d="M338 440h202" class="hz-top"/>
  <path d="M446 440v-16h40v16" class="l"/>
  <path d="M440 428h6M486 428h6"/>
  <path class="hz-steam" d="M458 416c0-6 5-6 5-12M472 416c0-6 5-6 5-12"/>
  <path d="M356 440l3-14h16l3 14Z" class="w"/><path class="thin" d="M367 426c-8-10-2-18 1-20M367 426c7-9 4-16 0-19"/>

  <!-- ground -->
  <path d="M0 500h640" class="hz-ground"/>
  <path class="hz-hatch" d="${hatch}"/>

  <!-- part numbers -->
  ${call(1, 297, 402)}
  ${call(2, 410, 399)}
  ${call(3, 188, 414)}
  ${call(4, 116, 266, 134, 266)}`;
}

const CLASSES = (c) => `
  .hz{fill:none;stroke:${c.ink};stroke-width:2.25;stroke-linecap:round;stroke-linejoin:round}
  .hz .w{fill:${c.room}}.hz .wall{fill:${c.wall}}.hz .b{fill:${c.wood}}.hz .p{fill:${c.brand}}.hz .l{fill:${c.door}}
  .hz .k{fill:${c.ink};stroke:none}.hz .tv{fill:#1b201e}.hz .soft{fill:${c.soft}}.hz .glass{fill:${c.soft}}
  .hz .thin{stroke-width:1.4}.hz .hz-ghost{stroke:${c.ghost};stroke-width:1.6}.hz .hz-hatch{stroke:${c.ink3};stroke-width:1.3}
  .hz .hz-roof{stroke-width:2.75}.hz .hz-top{stroke-width:4}.hz .hz-ground{stroke-width:2.75}
  .hz .hz-steam{stroke:${c.ink3};stroke-width:1.5}.hz .hz-lead{stroke-width:1.5}
  .hz .hz-call circle{stroke-width:2}.hz .hz-n{fill:${c.ink};stroke:none;font:800 16px/1 Geist,ui-sans-serif,system-ui,sans-serif}`;

export function houseSvg({ label = '', mode = 'inline' } = {}) {
  const head = mode === 'inline'
    ? `<svg class="hz" viewBox="0 0 640 520" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">`
    : `<svg class="hz" viewBox="0 0 640 520" xmlns="http://www.w3.org/2000/svg">${label ? `<title>${label}</title>` : ''}<style>${CLASSES(PALETTE[mode])}</style>`;
  return `${head}${body()}\n</svg>`;
}
