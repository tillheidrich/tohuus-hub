/**
 * Flat line illustrations in an assembly-manual style (docs/design/2026-10-11-ikea-direction.md):
 * one ink stroke weight, flat fills from the theme tokens (surface, birch, brand, lingon), a small numbered
 * callout or an arrow where it helps. Colours come from CSS classes (.ia …) so light, dark and Fredirando follow.
 * Purely decorative: every drawing is aria-hidden.
 */
import type { ReactNode } from 'react';

function Svg({ vb, className, children }: { vb: string; className?: string; children: ReactNode }) {
  return (
    <svg className={`ia${className ? ` ${className}` : ''}`} viewBox={vb} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** a numbered callout like a part number in an assembly manual */
const Callout = ({ x, y, n }: { x: number; y: number; n: number | string }) => (
  <g className="ia-call">
    <circle cx={x} cy={y} r={7.5} className="w" />
    <text x={x} y={y + 3.4} textAnchor="middle" className="ia-n">
      {n}
    </text>
  </g>
);

/** the ToHuus house: a terraced gable house in cross-section (fridge, cupboard, door, bathroom cabinet) */
export function HouseArt({ className }: { className?: string }) {
  return (
    <Svg vb="0 0 168 140" className={`ia-house${className ? ` ${className}` : ''}`}>
      {/* neighbours, drawn lighter */}
      <path className="ia-ghost" d="M2 132V70l12-9M166 132V70l-12-9" />
      {/* chimney behind the roof */}
      <rect x="112" y="20" width="11" height="24" className="b" />
      {/* walls */}
      <rect x="20" y="58" width="128" height="74" className="w" />
      {/* roof */}
      <path d="M10 63 84 10l74 53Z" className="p" />
      <circle cx="84" cy="40" r="7" className="w" />
      <path className="thin" d="M84 33v14M77 40h14" />
      {/* floors and walls */}
      <path d="M20 95h128M74 58v37M62 95v37" />
      {/* bathroom cabinet + basin */}
      <rect x="32" y="66" width="24" height="14" rx="1.5" className="b" />
      <path className="thin" d="M44 66v14" />
      <path d="M33 86h22c-1 5-5 7-11 7s-10-2-11-7Z" className="w" />
      {/* shelf with jars */}
      <path d="M84 80h56" />
      <rect x="88" y="68" width="9" height="12" rx="2" className="b" />
      <rect x="101" y="71" width="9" height="9" rx="2" className="w" />
      <rect x="114" y="66" width="13" height="14" rx="1.5" className="l" />
      <rect x="130" y="70" width="8" height="10" rx="2" className="b" />
      {/* front door */}
      <rect x="30" y="104" width="20" height="28" rx="1.5" className="l" />
      <circle cx="45" cy="119" r="1.4" className="k" />
      {/* fridge, wall cabinet, counter, pot */}
      <rect x="70" y="101" width="22" height="31" rx="2.5" className="w" />
      <path className="thin" d="M70 112h22M88 105v4M88 116v6" />
      <rect x="100" y="100" width="40" height="9" rx="1" className="b" />
      <path className="thin" d="M113 100v9M127 100v9" />
      <rect x="96" y="117" width="48" height="15" className="b" />
      <path d="M94 117h52" />
      <path d="M106 117v-5h12v5" className="w" />
      {/* ground */}
      <path d="M0 132h168" />
      <path className="ia-hatch" d="M8 136l4-4M20 136l4-4M32 136l4-4M44 136l4-4M56 136l4-4M68 136l4-4M80 136l4-4M92 136l4-4M104 136l4-4M116 136l4-4M128 136l4-4M140 136l4-4M152 136l4-4" />
      <Callout x={81} y={93} n={1} />
    </Svg>
  );
}

export type ArtName = 'list' | 'shelf' | 'book' | 'receipt' | 'fridge' | 'done' | 'calendar' | 'suitcase';

const ground = <path className="ia-ghost" d="M10 80h100" />;
const arrow = (d: string, head: string) => (
  <g className="ia-arrow">
    <path d={d} />
    <path d={head} />
  </g>
);

const ARTS: Record<ArtName, ReactNode> = {
  list: (
    <>
      {ground}
      <rect x="22" y="14" width="40" height="58" rx="3" className="w" />
      <rect x="34" y="9" width="16" height="9" rx="2" className="b" />
      <rect x="29" y="27" width="6" height="6" rx="1" className="w" />
      <rect x="29" y="40" width="6" height="6" rx="1" className="w" />
      <rect x="29" y="53" width="6" height="6" rx="1" className="w" />
      <path className="thin" d="M40 30h15M40 43h12M40 56h14" />
      <path d="M74 46h30l-3 28H77Z" className="b" />
      <path d="M81 46c0-9 4-13 8-13s8 4 8 13" />
      {arrow('M60 30c12-6 22-2 27 9', 'M82 36l5 3 1-6')}
      <Callout x={18} y={14} n={1} />
    </>
  ),
  shelf: (
    <>
      {ground}
      <path d="M18 18v62M102 18v62" className="thin" />
      <rect x="16" y="36" width="88" height="4" rx="1" className="b" />
      <rect x="16" y="66" width="88" height="4" rx="1" className="b" />
      <rect x="26" y="20" width="13" height="16" rx="3" className="w" />
      <path className="thin" d="M26 24h13" />
      <rect x="45" y="22" width="22" height="14" rx="1.5" className="b" />
      <rect x="73" y="25" width="10" height="11" rx="2" className="l" />
      <rect x="54" y="48" width="22" height="18" rx="1.5" className="ia-dash" />
      <path className="thin" d="M65 53v8M61 57h8" />
      {arrow('M92 22c6 10 2 22-10 28', 'M85 45l-3 5 6 1')}
      <Callout x={36} y={52} n={1} />
    </>
  ),
  book: (
    <>
      {ground}
      <path d="M60 22c-10-6-26-7-38-3v52c12-4 28-3 38 3Z" className="w" />
      <path d="M60 22c10-6 26-7 38-3v52c-12-4-28-3-38 3Z" className="w" />
      <path d="M60 22v52" />
      <path className="thin" d="M29 30c8-2 16-1 23 2M29 40c8-2 16-1 23 2M29 50c8-2 12-1 16 1M68 32c7-3 15-4 23-2M68 42c7-3 15-4 23-2" />
      <path d="M80 18v20l4-4 4 4V17" className="l" />
      <path d="M70 58h20l-2 9H72Z" className="b" />
      <path className="thin" d="M75 54c0-3 2-3 2-6M83 54c0-3 2-3 2-6" />
      <Callout x={22} y={14} n={1} />
    </>
  ),
  receipt: (
    <>
      {ground}
      <path d="M20 10h34v58l-4-3-5 3-4-3-5 3-4-3-5 3-4-3-3 3Z" className="w" />
      <path className="thin" d="M27 22h20M27 31h14M27 40h18M27 49h10" />
      <path d="M41 49h6" />
      <rect x="72" y="50" width="34" height="24" rx="2" className="b" />
      <path d="M70 50h38" />
      <rect x="82" y="58" width="14" height="7" rx="1" className="w" />
      {arrow('M58 26c18-2 30 6 31 20', 'M85 42l4 5 3-6')}
      <Callout x={16} y={10} n={1} />
    </>
  ),
  fridge: (
    <>
      {ground}
      <rect x="22" y="8" width="38" height="72" rx="4" className="w" />
      <path d="M22 34h38" />
      <path className="thin" d="M53 16v10M53 42v14" />
      <circle cx="31" cy="20" r="2.5" className="l" />
      <rect x="76" y="56" width="30" height="20" rx="3" className="w" />
      <path d="M74 56h34" className="thin" />
      <rect x="82" y="62" width="14" height="8" rx="1" className="b" />
      {arrow('M88 50c-2-14-12-20-24-18', 'M68 28l-5 4 6 3')}
      <Callout x={104} y={40} n={1} />
    </>
  ),
  done: (
    <>
      {ground}
      <rect x="30" y="40" width="50" height="40" className="w" />
      <path d="M24 44 55 18l31 26Z" className="p" />
      <rect x="49" y="56" width="12" height="24" rx="1" className="l" />
      <circle cx="90" cy="30" r="13" className="w" />
      <path d="m84 30 4 4 8-8" className="ia-check" />
      <Callout x={22} y={22} n={1} />
    </>
  ),
  calendar: (
    <>
      {ground}
      <rect x="22" y="16" width="62" height="58" rx="4" className="w" />
      <path d="M22 30h62" />
      <rect x="22" y="16" width="62" height="14" rx="4" className="b" />
      <path d="M36 11v10M70 11v10" />
      <path className="thin" d="M30 42h6M44 42h6M58 42h6M72 42h6M30 54h6M44 54h6M72 54h6M30 66h6M44 66h6M58 66h6" />
      <circle cx="61" cy="54" r="6" className="p" />
      {arrow('M98 24c6 14 2 26-10 32', 'M92 51l-4 5 6 1')}
      <Callout x={18} y={14} n={1} />
    </>
  ),
  suitcase: (
    <>
      {ground}
      <rect x="28" y="28" width="56" height="44" rx="5" className="b" />
      <path d="M46 28v-8a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v8" />
      <path className="thin" d="M42 28v44M70 28v44" />
      <circle cx="40" cy="78" r="3" className="w" />
      <circle cx="72" cy="78" r="3" className="w" />
      <circle cx="98" cy="20" r="8" className="l" />
      <path className="thin" d="M98 6v3M98 31v3M84 20h3M109 20h3" />
      <Callout x={22} y={26} n={1} />
    </>
  ),
};

/** a small instructional drawing for empty states */
export function EmptyArt({ name }: { name: ArtName }) {
  return <Svg vb="0 0 120 88" className="ia-empty">{ARTS[name]}</Svg>;
}
