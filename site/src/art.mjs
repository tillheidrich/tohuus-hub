/**
 * Drawings for the marketing site, in the same "Dutch Detail" language as the app (web/src/art.tsx):
 * flat geometric shapes, palette fills via classes (.ia .f-*), so light and dark follow the tokens.
 * The four housing forms are equal. There is no default single-family house and no invented rooms or devices.
 * Keep the shapes in sync with HOMES in web/src/art.tsx.
 */

const HOMES = {
  flat: `
      <rect x="46" y="58" width="108" height="150" class="f-pd"/>
      <rect x="40" y="52" width="120" height="8" class="f-k"/>
      <g class="f-ps"><rect x="60" y="74" width="16" height="18"/><rect x="92" y="74" width="16" height="18"/><rect x="124" y="74" width="16" height="18"/><rect x="60" y="106" width="16" height="18"/><rect x="124" y="106" width="16" height="18"/><rect x="60" y="138" width="16" height="18"/><rect x="92" y="138" width="16" height="18"/><rect x="124" y="138" width="16" height="18"/></g>
      <rect x="92" y="106" width="16" height="18" class="f-m"/>
      <path d="M100 124c-5-4-5-10 0-14 5 4 5 10 0 14z" class="f-p"/>
      <rect x="96" y="121" width="8" height="5" class="f-c"/>
      <rect x="88" y="124" width="24" height="3" class="f-k"/>
      <rect x="88" y="174" width="24" height="34" class="f-m"/>
      <rect x="134" y="38" width="10" height="14" class="f-k"/>`,
  shared: `
      <rect x="34" y="70" width="132" height="140" class="f-k"/>
      <rect x="28" y="62" width="144" height="10" class="f-pd"/>
      <path d="M52 118V98a9 9 0 0 1 18 0v20zM91 118V98a9 9 0 0 1 18 0v20zM52 160v-20a9 9 0 0 1 18 0v20zM130 160v-20a9 9 0 0 1 18 0v20z" class="f-s"/>
      <path d="M130 118V98a9 9 0 0 1 18 0v20z" class="f-c"/>
      <path d="M86 210v-34a14 14 0 0 1 28 0v34z" class="f-p"/>
      <rect x="118" y="174" width="12" height="22" rx="1" class="f-s"/>
      <g class="f-k"><circle cx="124" cy="179" r="1.6"/><circle cx="124" cy="185" r="1.6"/><circle cx="124" cy="191" r="1.6"/></g>
      <g class="f-m"><circle cx="40" cy="62" r="3"/><circle cx="56" cy="64" r="3"/><circle cx="72" cy="62" r="3"/></g>`,
  terraced: `
      <path d="M22 110l30-30 30 30v100H22z" class="f-p"/>
      <path d="M82 110l30-30 30 30v100H82z" class="f-k"/>
      <path d="M142 110l30-30 30 30v100h-60z" class="f-pd"/>
      <rect x="44" y="166" width="16" height="44" class="f-m"/>
      <rect x="104" y="166" width="16" height="44" class="f-s"/>
      <rect x="164" y="166" width="16" height="44" class="f-m"/>
      <g class="f-w"><rect x="44" y="124" width="16" height="16"/><rect x="104" y="124" width="16" height="16"/><rect x="164" y="124" width="16" height="16"/></g>
      <rect x="122" y="70" width="10" height="24" class="f-k"/>
      <path d="M58 76a9 9 0 0 1 18 0v8H58z" class="f-k"/>
      <path d="M60 70l2-8 5 6zM74 70l-2-8-5 6z" class="f-k"/>
      <path d="M76 82c8 0 10-8 6-12" class="s-k3"/>
      <circle cx="64" cy="73" r="1.4" class="f-m"/><circle cx="70" cy="73" r="1.4" class="f-m"/>`,
  house: `
      <circle cx="150" cy="58" r="22" class="f-m"/>
      <path d="M34 112l56-48 56 48z" class="f-p"/>
      <rect x="46" y="112" width="88" height="98" class="f-s s-k3"/>
      <path d="M78 210v-36a12 12 0 0 1 24 0v36z" class="f-k"/>
      <rect x="58" y="130" width="18" height="18" class="f-w s-k3"/>
      <rect x="104" y="130" width="18" height="18" class="f-w s-k3"/>
      <circle cx="164" cy="176" r="16" class="f-g"/>
      <rect x="162" y="190" width="4" height="20" class="f-k"/>`,
};

export const HOME_KINDS = ['flat', 'shared', 'terraced', 'house'];

/** One housing-form tile with its label. */
export const homeTile = (kind, label) => `<div class="home-tile ht-${kind}">
        <svg class="ia" viewBox="0 0 200 200" aria-hidden="true" focusable="false">${HOMES[kind]}
        </svg>${label ? `<span class="tag">${label}</span>` : ''}
      </div>`;

/** The offset ensemble of four housing forms (hero, OG image). */
export const homeTiles = (labels, aria) => `<div class="home-tiles" role="img" aria-label="${aria}">
      ${HOME_KINDS.map((k) => homeTile(k, labels[k])).join('\n      ')}
    </div>`;

/** The ToHuus mark: a green house with an arched mustard door. */
export const brandMark = (size = 28) => `<svg class="mark" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M4 28V14L16 4l12 10v14z" class="mk-house"/><path d="M12.5 28v-6.5a3.5 3.5 0 0 1 7 0V28z" class="mk-door"/></svg>`;

/** The little bird (sits on the green block, like on the date tile in the app). */
export const bird = () => `<svg class="ia-bird" viewBox="0 0 30 20" aria-hidden="true" focusable="false"><path d="M27 11c-1-6-7-9-12-7L8 1l2 6c-2 5 2 9 9 9 5 0 8-2 8-5z" class="b-body"/><path d="M27 11c-1-6-7-9-12-7L8 1l2 6c-2 5 2 9 9 9 5 0 8-2 8-5z" class="b-line"/><circle cx="21" cy="8" r="1.3" class="b-eye"/><path d="M27 9l3 1-3 1" class="b-beak"/><path d="M16 16v4M20 16v4" class="b-line"/></svg>`;
