/**
 * Illustrations in the "Dutch Detail" language (docs/design/2026-10-11-dutch-detail-system.md):
 * flat geometric shapes (arches, circles, half discs, squares), palette fills only, an occasional 1.5–2px ink
 * contour, and one small original character (a bird, a cat, a potted plant) as an easter egg – never in every card.
 * Colours come from CSS classes (.ia …) so light and dark follow. No invented rooms or devices: housing forms are
 * presets, the neutral home is a plant on a shelf. Purely decorative: every drawing is aria-hidden.
 */
import type { ReactNode } from 'react';
import { t } from './i18n';

function Svg({ vb, className, children }: { vb: string; className?: string; children: ReactNode }) {
  return (
    <svg className={`ia${className ? ` ${className}` : ''}`} viewBox={vb} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** The ToHuus mark: a green house with an arched mustard door (app icon, sidebar, login). */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg className={`mark${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M4 28V14L16 4l12 10v14z" className="mk-house" />
      <path d="M12.5 28v-6.5a3.5 3.5 0 0 1 7 0V28z" className="mk-door" />
    </svg>
  );
}

/** The little bird that sits on the date tile on Today. */
export function Bird({ className }: { className?: string }) {
  return (
    <svg className={`ia-bird${className ? ` ${className}` : ''}`} viewBox="0 0 30 20" aria-hidden="true" focusable="false">
      <path d="M27 11c-1-6-7-9-12-7L8 1l2 6c-2 5 2 9 9 9 5 0 8-2 8-5z" className="b-body" />
      <path d="M27 11c-1-6-7-9-12-7L8 1l2 6c-2 5 2 9 9 9 5 0 8-2 8-5z" className="b-line" />
      <circle cx="21" cy="8" r="1.3" className="b-eye" />
      <path d="M27 9l3 1-3 1" className="b-beak" />
      <path d="M16 16v4M20 16v4" className="b-line" />
    </svg>
  );
}

export type HomePreset = 'flat' | 'terraced' | 'house' | 'shared' | 'other' | null | undefined;

/** Housing forms as flat tiles (onboarding, login, tour). Each is equal – no default single-family house. */
const HOMES: Record<'flat' | 'shared' | 'terraced' | 'house', ReactNode> = {
  flat: (
    <>
      <rect x="46" y="58" width="108" height="150" className="f-pd" />
      <rect x="40" y="52" width="120" height="8" className="f-k" />
      <g className="f-ps">
        <rect x="60" y="74" width="16" height="18" />
        <rect x="92" y="74" width="16" height="18" />
        <rect x="124" y="74" width="16" height="18" />
        <rect x="60" y="106" width="16" height="18" />
        <rect x="124" y="106" width="16" height="18" />
        <rect x="60" y="138" width="16" height="18" />
        <rect x="92" y="138" width="16" height="18" />
        <rect x="124" y="138" width="16" height="18" />
      </g>
      <rect x="92" y="106" width="16" height="18" className="f-m" />
      <path d="M100 124c-5-4-5-10 0-14 5 4 5 10 0 14z" className="f-p" />
      <rect x="96" y="121" width="8" height="5" className="f-c" />
      <rect x="88" y="124" width="24" height="3" className="f-k" />
      <rect x="88" y="174" width="24" height="34" className="f-m" />
      <rect x="134" y="38" width="10" height="14" className="f-k" />
    </>
  ),
  shared: (
    <>
      <rect x="34" y="70" width="132" height="140" className="f-k" />
      <rect x="28" y="62" width="144" height="10" className="f-pd" />
      <path d="M52 118V98a9 9 0 0 1 18 0v20zM91 118V98a9 9 0 0 1 18 0v20zM52 160v-20a9 9 0 0 1 18 0v20zM130 160v-20a9 9 0 0 1 18 0v20z" className="f-s" />
      <path d="M130 118V98a9 9 0 0 1 18 0v20z" className="f-c" />
      <path d="M86 210v-34a14 14 0 0 1 28 0v34z" className="f-p" />
      <rect x="118" y="174" width="12" height="22" rx="1" className="f-s" />
      <g className="f-k">
        <circle cx="124" cy="179" r="1.6" />
        <circle cx="124" cy="185" r="1.6" />
        <circle cx="124" cy="191" r="1.6" />
      </g>
      <g className="f-m">
        <circle cx="40" cy="62" r="3" />
        <circle cx="56" cy="64" r="3" />
        <circle cx="72" cy="62" r="3" />
      </g>
    </>
  ),
  terraced: (
    <>
      <path d="M22 110l30-30 30 30v100H22z" className="f-p" />
      <path d="M82 110l30-30 30 30v100H82z" className="f-k" />
      <path d="M142 110l30-30 30 30v100h-60z" className="f-pd" />
      <rect x="44" y="166" width="16" height="44" className="f-m" />
      <rect x="104" y="166" width="16" height="44" className="f-s" />
      <rect x="164" y="166" width="16" height="44" className="f-m" />
      <g className="f-w">
        <rect x="44" y="124" width="16" height="16" />
        <rect x="104" y="124" width="16" height="16" />
        <rect x="164" y="124" width="16" height="16" />
      </g>
      <rect x="122" y="70" width="10" height="24" className="f-k" />
      {/* the cat on the roof */}
      <path d="M58 76a9 9 0 0 1 18 0v8H58z" className="f-k" />
      <path d="M60 70l2-8 5 6zM74 70l-2-8-5 6z" className="f-k" />
      <path d="M76 82c8 0 10-8 6-12" className="s-k3" />
      <circle cx="64" cy="73" r="1.4" className="f-m" />
      <circle cx="70" cy="73" r="1.4" className="f-m" />
    </>
  ),
  house: (
    <>
      <circle cx="150" cy="58" r="22" className="f-m" />
      <path d="M34 112l56-48 56 48z" className="f-p" />
      <rect x="46" y="112" width="88" height="98" className="f-s s-k3" />
      <path d="M78 210v-36a12 12 0 0 1 24 0v36z" className="f-k" />
      <rect x="58" y="130" width="18" height="18" className="f-w s-k3" />
      <rect x="104" y="130" width="18" height="18" className="f-w s-k3" />
      <circle cx="164" cy="176" r="16" className="f-g" />
      <rect x="162" y="190" width="4" height="20" className="f-k" />
    </>
  ),
};

const HOME_LABEL = { flat: 'Flat', shared: 'Shared flat', terraced: 'Terraced house', house: 'House' } as const;

/** One housing-form tile. */
export function HomeTile({ kind, label = true, className }: { kind: keyof typeof HOMES; label?: boolean; className?: string }) {
  return (
    <div className={`home-tile ht-${kind}${className ? ` ${className}` : ''}`}>
      <svg className="ia" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        {HOMES[kind]}
      </svg>
      {label && <span className="tag">{t(HOME_LABEL[kind])}</span>}
    </div>
  );
}

/** Four housing forms side by side, offset like the website hero – "home, not house". */
export function HomeTiles({ className, labels = true }: { className?: string; labels?: boolean }) {
  return (
    <div className={`home-tiles${className ? ` ${className}` : ''}`} role="img" aria-label={t('Flat, shared flat, terraced house and house – ToHuus works for every kind of home')}>
      {(['flat', 'shared', 'terraced', 'house'] as const).map((k) => (
        <HomeTile key={k} kind={k} label={labels} />
      ))}
    </div>
  );
}

/** Neutral "home" art: the chosen housing preset, or – without one – a plant on a simple shelf. */
export function HomeArt({ preset, className }: { preset?: HomePreset; className?: string }) {
  if (preset === 'flat' || preset === 'terraced' || preset === 'house' || preset === 'shared') return <HomeTile kind={preset} label={false} className={className} />;
  return (
    <Svg vb="0 0 200 200" className={`home-neutral${className ? ` ${className}` : ''}`}>
      <circle cx="100" cy="100" r="92" className="f-ps" />
      <rect x="34" y="128" width="132" height="8" className="f-k" />
      <rect x="46" y="136" width="6" height="34" className="f-k" />
      <rect x="148" y="136" width="6" height="34" className="f-k" />
      {/* plant */}
      <path d="M70 128h28l-4-26H74z" className="f-c" />
      <path d="M84 102c-16-6-22-22-16-38 14 6 20 20 16 38z" className="f-p" />
      <path d="M84 102c12-12 28-12 38-2-12 10-26 10-38 2z" className="f-pd" />
      <path d="M84 102c-2-14 2-30 14-40 6 16 0 30-14 40z" className="f-g" />
      {/* two jars and a book */}
      <rect x="110" y="100" width="18" height="28" rx="3" className="f-s s-k2" />
      <rect x="110" y="96" width="18" height="6" className="f-k" />
      <rect x="132" y="108" width="14" height="20" rx="3" className="f-m" />
    </Svg>
  );
}

export type ArtName = 'list' | 'shelf' | 'book' | 'receipt' | 'fridge' | 'box' | 'done' | 'calendar' | 'suitcase' | 'bag';

/* small scenes for empty states: same shapes, fewer details (detail level 2) */
const ARTS: Record<Exclude<ArtName, 'fridge'>, ReactNode> = {
  list: (
    <>
      <circle cx="60" cy="48" r="40" className="f-ps" />
      <rect x="30" y="16" width="38" height="56" rx="3" className="f-w s-k2" />
      <rect x="40" y="11" width="18" height="9" rx="2" className="f-k" />
      <rect x="36" y="28" width="7" height="7" className="f-p" />
      <rect x="36" y="42" width="7" height="7" className="s-k15 f-w" />
      <rect x="36" y="56" width="7" height="7" className="s-k15 f-w" />
      <path d="M48 31h14M48 45h11M48 59h13" className="s-k15" />
      <path d="M70 50h32l-4 26H74z" className="f-pd" />
      <path d="M77 50c0-9 5-13 9-13s9 4 9 13" className="s-k2" />
    </>
  ),
  shelf: (
    <>
      <circle cx="60" cy="46" r="40" className="f-ps" />
      <rect x="14" y="66" width="92" height="6" className="f-k" />
      <rect x="22" y="72" width="5" height="12" className="f-k" />
      <rect x="93" y="72" width="5" height="12" className="f-k" />
      <path d="M34 66h22l-3-18H37z" className="f-c" />
      <path d="M45 48c-11-4-15-15-11-26 10 4 14 14 11 26z" className="f-p" />
      <path d="M45 48c8-8 19-8 26-1-8 7-18 7-26 1z" className="f-pd" />
      <rect x="66" y="44" width="14" height="22" rx="3" className="f-s s-k15" />
      <rect x="66" y="40" width="14" height="5" className="f-k" />
      <rect x="84" y="52" width="11" height="14" rx="2" className="f-m" />
    </>
  ),
  book: (
    <>
      <circle cx="60" cy="46" r="40" className="f-ps" />
      <path d="M60 24c-10-6-26-7-38-3v52c12-4 28-3 38 3Z" className="f-w s-k2" />
      <path d="M60 24c10-6 26-7 38-3v52c-12-4-28-3-38 3Z" className="f-s s-k2" />
      <path d="M30 34c8-2 15-1 22 2M30 44c8-2 15-1 22 2M30 54c6-2 11-1 16 1" className="s-k15" />
      <path d="M80 20v20l5-4 5 4V19" className="f-c" />
    </>
  ),
  receipt: (
    <>
      <circle cx="60" cy="46" r="40" className="f-ps" />
      <path d="M34 10h40v62l-5-4-5 4-5-4-5 4-5-4-5 4-5-4-5 4Z" className="f-w s-k2" />
      <path d="M42 24h24M42 33h16M42 42h20" className="s-k15" />
      <path d="M42 54h24" className="s-k2" />
      <circle cx="88" cy="66" r="14" className="f-p" />
      <path d="m82 66 4 4 8-8" className="s-w3" />
    </>
  ),
  box: (
    <>
      <circle cx="60" cy="46" r="40" className="f-ps" />
      <rect x="26" y="40" width="68" height="36" rx="4" className="f-s s-k2" />
      <rect x="22" y="32" width="76" height="10" rx="3" className="f-pd" />
      <rect x="44" y="52" width="32" height="12" rx="2" className="f-w s-k15" />
      <path d="M50 58h20" className="s-k15" />
    </>
  ),
  done: (
    <>
      <circle cx="60" cy="46" r="40" className="f-ps" />
      <path d="M38 44 60 24l22 20v32H38z" className="f-p" />
      <path d="M53 76V62a7 7 0 0 1 14 0v14z" className="f-m" />
      <circle cx="88" cy="30" r="13" className="f-w s-k2" />
      <path d="m82 30 4 4 8-8" className="s-p3" />
    </>
  ),
  calendar: (
    <>
      <circle cx="60" cy="46" r="40" className="f-ps" />
      <path d="M28 76V34a20 20 0 0 1 20-20h24a20 20 0 0 1 20 20v42z" className="f-w s-k2" />
      <path d="M36 44h8M52 44h8M68 44h8M36 56h8M68 56h8M36 68h8M52 68h8" className="s-k15" />
      <circle cx="56" cy="56" r="6" className="f-p" />
      <path d="M44 14v8M76 14v8" className="s-k3" />
    </>
  ),
  suitcase: (
    <>
      <circle cx="60" cy="46" r="40" className="f-ps" />
      <rect x="30" y="30" width="56" height="42" rx="5" className="f-pd" />
      <path d="M48 30v-8a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v8" className="s-k2" />
      <path d="M44 30v42M72 30v42" className="s-w2" />
      <circle cx="40" cy="78" r="3" className="f-k" />
      <circle cx="76" cy="78" r="3" className="f-k" />
      <circle cx="98" cy="22" r="8" className="f-m" />
    </>
  ),
  bag: (
    <>
      <circle cx="60" cy="46" r="40" className="f-ps" />
      <path d="M44 28c-12-2-10-14 0-14 4 0 6 4 6 8M76 28c12-2 10-14 0-14-4 0-6 4-6 8" className="f-p" />
      <path d="M30 34h60l-5 44H35z" className="f-s s-k2" />
      <path d="M46 34c0-12 4-16 14-16s14 4 14 16" className="s-k2" />
      <rect x="50" y="46" width="20" height="14" rx="2" className="f-m" />
    </>
  ),
};

/** A small drawing for empty states (no fridge as default: "fridge" falls back to a neutral storage box). */
export function EmptyArt({ name }: { name: ArtName }) {
  const k = name === 'fridge' ? 'box' : name;
  return <Svg vb="0 0 120 88" className={`ia-empty ia-${k}`}>{ARTS[k]}</Svg>;
}
