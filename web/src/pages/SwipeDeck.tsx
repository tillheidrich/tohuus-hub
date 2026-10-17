/**
 * One swipe deck for the whole app: "Browse ideas" on the cook page and the secret family food vote.
 * Drag left = no, right = yes, up = super (optional). Buttons and arrow keys do the same.
 */
import { ChefHat, Heart, ThumbsDown, ThumbsUp } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';

export type SwipeDir = 'no' | 'yes' | 'super';

export interface DeckCard {
  key: string | number;
  title: string;
  image?: string | null;
  badges?: string[];
  sub?: string | null;
  /** highlighted badge (e.g. "all ingredients on hand") */
  accentBadge?: string | null;
}

const THRESHOLD = 110;

export function SwipeDeck({
  cards,
  onSwipe,
  allowSuper = false,
  stamps,
  hint,
  disabled = false,
  icons,
  buttonLabels,
}: {
  /** cards[0] is on top, cards[1] peeks out behind */
  cards: DeckCard[];
  onSwipe: (dir: SwipeDir, card: DeckCard) => void;
  allowSuper?: boolean;
  stamps?: Partial<Record<SwipeDir, string>>;
  hint?: ReactNode;
  disabled?: boolean;
  /** other icons for the buttons (e.g. a check for "done" instead of the heart) */
  icons?: Partial<Record<SwipeDir, ReactNode>>;
  /** visible words under the buttons – where the meaning isn't obvious (keep, let go, done) */
  buttonLabels?: Partial<Record<SwipeDir, string>>;
}) {
  const top = cards[0];
  const behind = cards[1];
  const [fly, setFly] = useState<SwipeDir | null>(null);
  const flyRef = useRef(false);
  const label = { no: t('No'), yes: t('Yes'), super: t('Super'), ...stamps };

  const decide = (dir: SwipeDir) => {
    if (!top || flyRef.current || disabled) return;
    flyRef.current = true;
    setFly(dir);
    window.setTimeout(() => {
      flyRef.current = false;
      setFly(null);
      onSwipe(dir, top);
    }, 220);
  };

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') decide('no');
      else if (e.key === 'ArrowRight') decide('yes');
      else if (e.key === 'ArrowUp' && allowSuper) decide('super');
      else return;
      e.preventDefault();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  if (!top) return null;
  return (
    <div className="swipe" ref={box} tabIndex={0} aria-label={t('Swipe deck: arrow left = no, arrow right = yes')}>
      <div className="deck">
        {behind && <Card key={`b-${behind.key}`} card={behind} behind />}
        <Card key={`t-${top.key}`} card={top} fly={fly} onRelease={decide} allowSuper={allowSuper} label={label} />
      </div>
      <div className="deck-actions">
        <span className="deck-btn">
          <button className="round" onClick={() => decide('no')} aria-label={buttonLabels?.no ?? label.no} disabled={disabled}>
            {icons?.no ?? <ThumbsDown size={24} />}
          </button>
          {buttonLabels?.no && <span className="small" aria-hidden="true">{buttonLabels.no}</span>}
        </span>
        {allowSuper && (
          <span className="deck-btn">
            <button className="round super" onClick={() => decide('super')} aria-label={buttonLabels?.super ?? label.super} disabled={disabled}>
              {icons?.super ?? <Heart size={24} weight="fill" />}
            </button>
            {buttonLabels?.super && <span className="small" aria-hidden="true">{buttonLabels.super}</span>}
          </span>
        )}
        <span className="deck-btn">
          <button className="round yes" onClick={() => decide('yes')} aria-label={buttonLabels?.yes ?? label.yes} disabled={disabled}>
            {icons?.yes ?? <ThumbsUp size={24} weight="fill" />}
          </button>
          {buttonLabels?.yes && <span className="small" aria-hidden="true">{buttonLabels.yes}</span>}
        </span>
      </div>
      {hint && <p className="small muted" style={{ textAlign: 'center', marginTop: 10 }}>{hint}</p>}
    </div>
  );
}

function Card({
  card,
  behind = false,
  fly = null,
  onRelease,
  allowSuper = false,
  label,
}: {
  card: DeckCard;
  behind?: boolean;
  fly?: SwipeDir | null;
  onRelease?: (dir: SwipeDir) => void;
  allowSuper?: boolean;
  label?: Record<SwipeDir, string>;
}) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [d, setD] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const onDown = (e: React.PointerEvent) => {
    if (behind) return;
    start.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    setD({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
  };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    if (allowSuper && d.y < -THRESHOLD && Math.abs(d.y) > Math.abs(d.x)) onRelease?.('super');
    else if (Math.abs(d.x) > THRESHOLD) onRelease?.(d.x > 0 ? 'yes' : 'no');
    else setD({ x: 0, y: 0 });
  };

  // where the card goes when decided (by drag or button)
  const pos = fly === 'yes' ? { x: 640, y: d.y } : fly === 'no' ? { x: -640, y: d.y } : fly === 'super' ? { x: d.x, y: -760 } : d;
  const intent: SwipeDir | null = fly ?? (allowSuper && d.y < -40 && Math.abs(d.y) > Math.abs(d.x) ? 'super' : d.x > 40 ? 'yes' : d.x < -40 ? 'no' : null);
  const strength = fly ? 1 : Math.min(1, Math.max(Math.abs(d.x), allowSuper ? -d.y : 0) / THRESHOLD);
  const style: React.CSSProperties = behind
    ? { transform: 'scale(0.94) translateY(14px)', opacity: 0.7 }
    : { transform: `translate(${pos.x}px, ${Math.min(pos.y, 40)}px) rotate(${pos.x / 22}deg)`, transition: dragging ? 'none' : undefined, opacity: fly ? 0 : 1 };

  return (
    <div className="dcard" style={style} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-hidden={behind}>
      {card.image ? <img className="bg" src={card.image} alt="" draggable={false} /> : <div className="pattern"><ChefHat size={56} weight="light" /></div>}
      {(card.badges?.length || card.accentBadge) && (
        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          {card.badges?.map((b) => (
            <span key={b} className="badge dbadge">{b}</span>
          ))}
          {card.accentBadge && <span className="badge dbadge accent">{card.accentBadge}</span>}
        </div>
      )}
      <h2>{card.title}</h2>
      {card.sub && <p className="dsub">{card.sub}</p>}
      {!behind && intent && label && (
        <div className={`dstamp ${intent}`} style={{ opacity: strength }}>
          {label[intent]}
        </div>
      )}
    </div>
  );
}
