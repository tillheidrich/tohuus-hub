/**
 * Kid mode pictures: friendly animals for the profiles and simple food drawings for items without a photo.
 * Flat shapes, warm colours, no text – a kid who can't read recognises them.
 */
import type { ReactNode } from 'react';

const Svg = ({ children, size, label }: { children: ReactNode; size: number | string; label?: string }) => (
  <svg viewBox="0 0 100 100" width={size} height={size} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {children}
  </svg>
);

const eyes = (y = 50, dx = 13, r = 4.2) => (
  <>
    <circle cx={50 - dx} cy={y} r={r} fill="#2b2622" />
    <circle cx={50 + dx} cy={y} r={r} fill="#2b2622" />
    <circle cx={50 - dx + 1.4} cy={y - 1.4} r={1.3} fill="#fff" />
    <circle cx={50 + dx + 1.4} cy={y - 1.4} r={1.3} fill="#fff" />
  </>
);
const cheeks = (y = 60, dx = 22) => (
  <>
    <ellipse cx={50 - dx} cy={y} rx={5} ry={3.2} fill="#f4a3a0" opacity={0.75} />
    <ellipse cx={50 + dx} cy={y} rx={5} ry={3.2} fill="#f4a3a0" opacity={0.75} />
  </>
);
const smile = (y = 64, w = 6) => <path d={`M${50 - w} ${y} q${w} ${w * 0.9} ${w * 2} 0`} fill="none" stroke="#2b2622" strokeWidth={2.6} strokeLinecap="round" />;

const ANIMALS: Record<string, () => ReactNode> = {
  fox: () => (
    <>
      <path d="M18 22 L36 40 L24 50 Z" fill="#e8742c" />
      <path d="M82 22 L64 40 L76 50 Z" fill="#e8742c" />
      <path d="M22 28 L32 40 L26 45 Z" fill="#fbe3cf" />
      <path d="M78 28 L68 40 L74 45 Z" fill="#fbe3cf" />
      <path d="M50 86 C26 82 14 62 18 42 C30 34 70 34 82 42 C86 62 74 82 50 86 Z" fill="#f08a3c" />
      <path d="M50 86 C38 84 28 74 26 62 C36 62 44 66 50 72 C56 66 64 62 74 62 C72 74 62 84 50 86 Z" fill="#fff6ec" />
      {eyes(52, 14)}
      <ellipse cx={50} cy={70} rx={4.6} ry={3.4} fill="#2b2622" />
    </>
  ),
  bear: () => (
    <>
      <circle cx={24} cy={28} r={12} fill="#8a5a3b" />
      <circle cx={76} cy={28} r={12} fill="#8a5a3b" />
      <circle cx={24} cy={28} r={6} fill="#d9a77f" />
      <circle cx={76} cy={28} r={6} fill="#d9a77f" />
      <circle cx={50} cy={55} r={34} fill="#a06a45" />
      <ellipse cx={50} cy={66} rx={15} ry={11} fill="#e6c09c" />
      {eyes(50, 13)}
      <ellipse cx={50} cy={61} rx={5} ry={3.6} fill="#2b2622" />
      {smile(68, 4)}
    </>
  ),
  rabbit: () => (
    <>
      <ellipse cx={36} cy={22} rx={8} ry={20} fill="#e9e4de" />
      <ellipse cx={64} cy={22} rx={8} ry={20} fill="#e9e4de" />
      <ellipse cx={36} cy={24} rx={4} ry={14} fill="#f6c1c4" />
      <ellipse cx={64} cy={24} rx={4} ry={14} fill="#f6c1c4" />
      <circle cx={50} cy={60} r={30} fill="#f3efea" />
      {eyes(56, 12)}
      {cheeks(66, 19)}
      <path d="M46 64 L54 64 L50 69 Z" fill="#e88b93" />
      <path d="M50 69 v4" stroke="#2b2622" strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  cat: () => (
    <>
      <path d="M20 20 L40 34 L22 48 Z" fill="#8f949c" />
      <path d="M80 20 L60 34 L78 48 Z" fill="#8f949c" />
      <path d="M24 27 L34 35 L25 42 Z" fill="#f2b8bc" />
      <path d="M76 27 L66 35 L75 42 Z" fill="#f2b8bc" />
      <circle cx={50} cy={56} r={32} fill="#a3a8b0" />
      <path d="M44 26 q6 8 12 0" fill="none" stroke="#7d828a" strokeWidth={3} strokeLinecap="round" />
      {eyes(52, 13)}
      {cheeks(64, 20)}
      <path d="M46 62 L54 62 L50 66 Z" fill="#e88b93" />
      <path d="M22 64 H34 M22 70 H34 M66 64 H78 M66 70 H78" stroke="#5d6168" strokeWidth={1.8} strokeLinecap="round" />
      {smile(70, 4)}
    </>
  ),
  owl: () => (
    <>
      <path d="M22 20 L34 34 L22 38 Z" fill="#7b5a3e" />
      <path d="M78 20 L66 34 L78 38 Z" fill="#7b5a3e" />
      <ellipse cx={50} cy={58} rx={32} ry={34} fill="#9a7250" />
      <ellipse cx={50} cy={70} rx={20} ry={18} fill="#e8d2b5" />
      <circle cx={37} cy={46} r={12} fill="#fff" />
      <circle cx={63} cy={46} r={12} fill="#fff" />
      <circle cx={37} cy={46} r={5.5} fill="#2b2622" />
      <circle cx={63} cy={46} r={5.5} fill="#2b2622" />
      <path d="M45 56 L55 56 L50 64 Z" fill="#f2a33a" />
      <path d="M40 74 q4 3 8 0 M52 74 q4 3 8 0 M46 82 q4 3 8 0" fill="none" stroke="#c4a582" strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  frog: () => (
    <>
      <circle cx={32} cy={32} r={13} fill="#5cb85c" />
      <circle cx={68} cy={32} r={13} fill="#5cb85c" />
      <ellipse cx={50} cy={60} rx={36} ry={28} fill="#6cc46c" />
      <circle cx={32} cy={31} r={7.5} fill="#fff" />
      <circle cx={68} cy={31} r={7.5} fill="#fff" />
      <circle cx={33} cy={32} r={4} fill="#2b2622" />
      <circle cx={67} cy={32} r={4} fill="#2b2622" />
      {cheeks(66, 24)}
      <path d="M34 66 q16 12 32 0" fill="none" stroke="#2b5e2b" strokeWidth={3} strokeLinecap="round" />
    </>
  ),
  mouse: () => (
    <>
      <circle cx={24} cy={34} r={17} fill="#b9b4ad" />
      <circle cx={76} cy={34} r={17} fill="#b9b4ad" />
      <circle cx={24} cy={34} r={10} fill="#f2c3c6" />
      <circle cx={76} cy={34} r={10} fill="#f2c3c6" />
      <ellipse cx={50} cy={60} rx={28} ry={27} fill="#cdc8c1" />
      {eyes(55, 11, 3.8)}
      <circle cx={50} cy={68} r={4.2} fill="#e88b93" />
      <path d="M30 66 H42 M30 72 H42 M58 66 H70 M58 72 H70" stroke="#7a756f" strokeWidth={1.6} strokeLinecap="round" />
    </>
  ),
  hedgehog: () => (
    <>
      <path d="M12 62 L18 40 L24 52 L28 26 L36 44 L42 20 L50 40 L58 20 L64 44 L72 26 L76 52 L82 40 L88 62 C88 80 70 88 50 88 C30 88 12 80 12 62 Z" fill="#7a5a43" />
      <ellipse cx={50} cy={66} rx={26} ry={20} fill="#efd7b8" />
      {eyes(62, 10, 3.8)}
      <circle cx={50} cy={71} r={4} fill="#2b2622" />
      {cheeks(72, 17)}
    </>
  ),
};

export const ANIMAL_KEYS = Object.keys(ANIMALS);

export function KidAnimal({ name, size = 56, color }: { name: string; size?: number | string; color?: string }) {
  const draw = ANIMALS[name] ?? ANIMALS.fox;
  return (
    <span className="kid-animal" style={{ width: size, height: size, background: color ? `${color}33` : undefined }}>
      <Svg size="100%">{draw()}</Svg>
    </span>
  );
}

const FOOD: Record<string, () => ReactNode> = {
  apple: () => (
    <>
      <path d="M50 30 C40 22 20 24 18 46 C16 70 34 90 50 84 C66 90 84 70 82 46 C80 24 60 22 50 30 Z" fill="#e2483d" />
      <path d="M30 44 C30 38 36 34 40 36" fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={4} strokeLinecap="round" />
      <path d="M50 30 C50 22 52 16 56 12" fill="none" stroke="#6b4a2e" strokeWidth={4} strokeLinecap="round" />
      <path d="M54 20 C62 10 74 12 76 16 C70 24 60 24 54 20 Z" fill="#5cb85c" />
    </>
  ),
  banana: () => (
    <>
      <path d="M20 30 C18 64 42 86 80 74 C84 72 84 68 80 68 C50 72 32 56 30 30 C30 24 20 24 20 30 Z" fill="#f6cf3d" />
      <path d="M30 34 C34 58 50 68 74 70" fill="none" stroke="#d9a91f" strokeWidth={2.5} strokeLinecap="round" />
      <path d="M20 26 L24 18 L30 22 L28 30 Z" fill="#7a5a2c" />
    </>
  ),
  pear: () => (
    <>
      <path d="M50 22 C40 22 38 34 38 42 C38 50 24 56 24 70 C24 84 38 90 50 90 C62 90 76 84 76 70 C76 56 62 50 62 42 C62 34 60 22 50 22 Z" fill="#a5cf4c" />
      <path d="M50 22 C50 16 52 12 55 9" fill="none" stroke="#6b4a2e" strokeWidth={4} strokeLinecap="round" />
      <path d="M34 66 C34 60 38 56 40 56" fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={4} strokeLinecap="round" />
    </>
  ),
  grapes: () => (
    <>
      {[
        [38, 34], [54, 34], [70, 36], [46, 48], [62, 48], [38, 60], [54, 62], [46, 74], [60, 76], [52, 88],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={9} fill={i % 2 ? '#8e5bb8' : '#7b4aa6'} />
      ))}
      <path d="M54 26 C54 18 58 14 62 12" fill="none" stroke="#6b4a2e" strokeWidth={4} strokeLinecap="round" />
      <path d="M58 20 C66 10 80 14 80 18 C72 24 64 24 58 20 Z" fill="#5cb85c" />
    </>
  ),
  carrot: () => (
    <>
      <path d="M36 34 L64 34 L52 92 C51 95 49 95 48 92 Z" fill="#f08a3c" />
      <path d="M42 46 H50 M46 60 H54 M46 74 H52" stroke="#c9631f" strokeWidth={2.5} strokeLinecap="round" />
      <path d="M50 34 C44 22 38 16 32 14 C40 24 42 28 46 34 Z M50 34 C50 22 52 14 56 10 C56 22 54 28 54 34 Z M52 34 C58 24 66 20 72 20 C64 26 60 30 56 34 Z" fill="#5cb85c" />
    </>
  ),
  water: () => (
    <>
      <path d="M28 18 H72 L66 88 C66 90 64 92 62 92 H38 C36 92 34 90 34 88 Z" fill="#e7f3fb" stroke="#9cc7e6" strokeWidth={3} />
      <path d="M32 42 H68 L65 86 C65 88 63 89 61 89 H39 C37 89 35 88 35 86 Z" fill="#8fd0f5" />
      <path d="M40 50 V78" stroke="#fff" strokeOpacity={0.7} strokeWidth={4} strokeLinecap="round" />
    </>
  ),
  milk: () => (
    <>
      <path d="M32 30 L50 14 L68 30 Z" fill="#cfe0f4" />
      <rect x={30} y={30} width={40} height={60} rx={4} fill="#fbfbf8" stroke="#cfd6de" strokeWidth={2} />
      <path d="M30 56 C40 50 46 62 56 56 C62 52 66 54 70 56 V86 C70 88 68 90 66 90 H34 C32 90 30 88 30 86 Z" fill="#4f8fd8" />
      <circle cx={50} cy={42} r={6} fill="#4f8fd8" />
    </>
  ),
  juice: () => (
    <>
      <path d="M58 8 L52 40" stroke="#e2483d" strokeWidth={4} strokeLinecap="round" />
      <path d="M28 24 H72 L66 88 C66 90 64 92 62 92 H38 C36 92 34 90 34 88 Z" fill="#fff4e3" stroke="#f2c27a" strokeWidth={3} />
      <path d="M31 40 H69 L65 86 C65 88 63 89 61 89 H39 C37 89 35 88 35 86 Z" fill="#f7a531" />
      <circle cx={70} cy={26} r={12} fill="#f7c948" />
      <circle cx={70} cy={26} r={8} fill="#fbe08a" />
    </>
  ),
  drink: () => (
    <>
      <rect x={38} y={8} width={24} height={14} rx={3} fill="#2fa58a" />
      <path d="M36 22 H64 V30 C72 38 72 44 72 50 V86 C72 90 68 92 64 92 H36 C32 92 28 90 28 86 V50 C28 44 28 38 36 30 Z" fill="#59c3a8" />
      <rect x={28} y={50} width={44} height={22} fill="#fff" opacity={0.85} />
      <circle cx={50} cy={61} r={6} fill="#f2a33a" />
    </>
  ),
  icecream: () => (
    <>
      <path d="M32 52 L68 52 L52 94 C51 96 49 96 48 94 Z" fill="#e3b26d" />
      <path d="M38 58 L58 78 M48 54 L64 70 M36 64 L54 86 M62 56 L42 80" stroke="#c48c43" strokeWidth={2} />
      <circle cx={40} cy={44} r={14} fill="#f6a9c0" />
      <circle cx={60} cy={44} r={14} fill="#fbe8c5" />
      <circle cx={50} cy={28} r={14} fill="#a8724e" />
      <circle cx={54} cy={14} r={4} fill="#e2483d" />
    </>
  ),
  yoghurt: () => (
    <>
      <path d="M24 30 H76 L70 88 C70 90 68 92 66 92 H34 C32 92 30 90 30 88 Z" fill="#fdfaf5" stroke="#e2d6c6" strokeWidth={2} />
      <rect x={20} y={22} width={60} height={10} rx={4} fill="#f6a9c0" />
      <path d="M30 52 H70 L68 70 H32 Z" fill="#f6a9c0" />
      <circle cx={44} cy={61} r={4} fill="#e2483d" />
      <circle cx={56} cy={61} r={4} fill="#e2483d" />
    </>
  ),
  bread: () => (
    <>
      <path d="M22 44 C14 24 40 14 50 22 C60 14 86 24 78 44 V86 C78 88 76 90 74 90 H26 C24 90 22 88 22 86 Z" fill="#c98a45" />
      <path d="M28 46 C22 30 42 22 50 30 C58 22 78 30 72 46 V84 H28 Z" fill="#f4d9a8" />
      <circle cx={42} cy={56} r={2} fill="#d9b276" />
      <circle cx={58} cy={64} r={2} fill="#d9b276" />
      <circle cx={46} cy={72} r={2} fill="#d9b276" />
    </>
  ),
  cookie: () => (
    <>
      <circle cx={50} cy={52} r={36} fill="#d9a35f" />
      <circle cx={50} cy={52} r={36} fill="none" stroke="#b9823f" strokeWidth={3} />
      {[
        [36, 40], [58, 34], [64, 56], [42, 62], [52, 74], [30, 54],
      ].map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx={5} ry={4} fill="#5b3a24" />
      ))}
    </>
  ),
  snack: () => (
    <>
      {[
        [34, 44, -20], [50, 38, 10], [64, 46, 30], [42, 50, 40], [58, 52, -10],
      ].map(([x, y, r], i) => (
        <ellipse key={i} cx={x} cy={y} rx={12} ry={8} transform={`rotate(${r} ${x} ${y})`} fill={i % 2 ? '#f6cf3d' : '#f2b93a'} stroke="#d99a1f" strokeWidth={1.5} />
      ))}
      <path d="M14 54 H86 C84 76 70 90 50 90 C30 90 16 76 14 54 Z" fill="#4f8fd8" />
      <path d="M22 66 H78" stroke="#fff" strokeOpacity={0.5} strokeWidth={3} />
    </>
  ),
  cheese: () => (
    <>
      <path d="M14 70 L74 30 L88 52 V80 C88 82 86 84 84 84 H18 C16 84 14 82 14 80 Z" fill="#f7c948" />
      <path d="M14 70 L74 30 L88 52 Z" fill="#fbe08a" />
      <circle cx={34} cy={74} r={5} fill="#e3ac2a" />
      <circle cx={60} cy={66} r={6} fill="#e3ac2a" />
      <circle cx={76} cy={76} r={4} fill="#e3ac2a" />
    </>
  ),
  plate: () => (
    <>
      <circle cx={50} cy={54} r={34} fill="#fff" stroke="#d8d4cc" strokeWidth={3} />
      <circle cx={50} cy={54} r={22} fill="#f3efe7" />
      <path d="M8 26 V44 M4 26 V38 C4 42 12 42 12 38 V26" stroke="#9a978f" strokeWidth={3} strokeLinecap="round" fill="none" transform="translate(2 4)" />
      <path d="M92 26 C84 30 84 44 92 46 V70" stroke="#9a978f" strokeWidth={3} strokeLinecap="round" fill="none" />
    </>
  ),
};

export function KidArt({ art, size = '100%' }: { art: string; size?: number | string }) {
  const draw = FOOD[art] ?? FOOD.plate;
  return <Svg size={size}>{draw()}</Svg>;
}

/** Product photo if there is one, otherwise the drawing. */
export function KidPicture({ item, size = '100%' }: { item: { image_path?: string | null; art: string; name: string }; size?: number | string }) {
  return item.image_path ? <img src={item.image_path} alt="" style={{ width: size, height: size, objectFit: 'contain' }} /> : <KidArt art={item.art} size={size} />;
}
