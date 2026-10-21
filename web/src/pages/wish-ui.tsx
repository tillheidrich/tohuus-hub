/**
 * Shared pieces of the wish lists (20 Oct 2026): types, the placeholder symbol per wish (server key → Phosphor icon,
 * the iPhone uses SF Symbols for the same keys), the arch-top thumbnail, occasion and date lines, prices, and the
 * title a link gives away by its address (no server fetch – docs/wishes.md › Links).
 */
import {
  Baby,
  Bicycle,
  BookOpen,
  Cake,
  Car,
  Coffee,
  Cookie,
  CookingPot,
  Cube,
  DeviceMobile,
  Diamond,
  Drop,
  Flower,
  GameController,
  Gift,
  Handbag,
  Headphones,
  Heart,
  type Icon,
  Lamp,
  PaintBrush,
  PawPrint,
  PiggyBank,
  Plant,
  Sneaker,
  SoccerBall,

  Star,
  TShirt,
  Tent,
  Ticket,
  TreeEvergreen,
  Wine,
  Wrench,
  Rabbit,
  Egg,
  Confetti,
} from '@phosphor-icons/react';
import { useState } from 'react';
import type { ListVisibility } from '../shop/privacy';
import { t } from '../i18n';
import { money } from '../region';

// ------------------------------------------------------------------ types

export interface WishLink {
  id: number;
  label: string | null;
  url: string;
  price: number | null;
  title: string | null;
  site: string | null;
  image_path: string | null;
  preview: 'pending' | 'ok' | 'failed';
}

export type WishStatus = 'open' | 'reserved' | 'bought';

export interface Wish {
  id: number;
  list_id: number;
  title: string;
  note: string | null;
  photo_path: string | null;
  icon: string;
  price: number | null;
  price_from_links: boolean;
  quantity: number;
  priority: 1 | 2 | 3;
  links: WishLink[];
  giver: { user_id: number | null; name: string } | null;
  status: WishStatus;
  status_by: { user_id: number | null; name: string | null; mine: boolean; guest?: boolean } | null;
  status_at: string | null;
  reminder: { remind_on: string; sent: boolean } | null;
  on_shopping_list: boolean;
  /** the viewer may take it off the list (owner, co-editor, admin on a household list, or who added it) */
  can_delete?: boolean;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  list_name?: string;
}

export type Occasion = 'birthday' | 'christmas' | 'wedding' | 'baby' | 'easter' | 'other';

export interface WishListInfo {
  id: number;
  name: string;
  note: string | null;
  owner_id: number | null;
  owner: string | null;
  for_user_id: number | null;
  for_name: string | null;
  occasion: Occasion | null;
  event_date: string | null;
  days_until: number | null;
  visibility: ListVisibility;
  share_with: number[];
  editors: number[];
  surprise: boolean;
  archived: boolean;
  mine: boolean;
  role: 'owner' | 'editor' | 'member';
  for_me: boolean;
  can_reserve: boolean;
  /** the viewer may delete any wish here (owner, co-editor, admin on a household list) */
  can_edit?: boolean;
  /** the viewer may delete the whole list */
  can_delete?: boolean;
  count: number;
  reserved: number | null;
  bought: number | null;
  open: number | null;
  people: number;
  link: { url: string; created_at: string } | null;
  photos: string[];
  icons: string[];
}

export interface GiftItem extends Wish {
  list: { id: number; name: string; for_name: string | null; occasion: Occasion | null; event_date: string | null; days_until: number | null };
  suggest_remind_on: string | null;
}

export interface Giving {
  todo: GiftItem[];
  bought: GiftItem[];
  count: number;
  sum: number;
  todo_sum: number;
  bought_sum: number;
}

// ------------------------------------------------------------------ symbols

const ICONS: Record<string, Icon> = {
  bricks: Cube,
  teddy: Rabbit,
  game: GameController,
  book: BookOpen,
  bike: Bicycle,
  ball: SoccerBall,
  shoe: Sneaker,
  shirt: TShirt,
  music: Headphones,
  device: DeviceMobile,
  beauty: Drop,
  jewel: Diamond,
  flower: Flower,
  coffee: Coffee,
  wine: Wine,
  sweets: Cookie,
  kitchen: CookingPot,
  tool: Wrench,
  garden: Plant,
  paint: PaintBrush,
  camping: Tent,
  ticket: Ticket,
  baby: Baby,
  car: Car,
  home: Lamp,
  bag: Handbag,
  pet: PawPrint,
  money: PiggyBank,
  gift: Gift,
};
/** calm tile colours from the design tokens, picked by the symbol so the same kind of thing looks the same */
const TINTS = ['var(--tint-1)', 'var(--tint-2)', 'var(--tint-3)', 'var(--tint-4)', 'var(--tint-5)', 'var(--tint-6)'];
const tintOf = (key: string) => TINTS[[...key].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

export const WishSymbol = ({ icon, size = 24 }: { icon: string; size?: number }) => {
  const I = ICONS[icon] ?? Gift;
  return <I size={size} weight="duotone" aria-hidden />;
};

const OCCASION_ICON: Record<Occasion, Icon> = { birthday: Cake, christmas: TreeEvergreen, wedding: Heart, baby: Baby, easter: Egg, other: Confetti };
export const OccasionIcon = ({ o, size = 16 }: { o: Occasion | null; size?: number }) => {
  const I = o ? OCCASION_ICON[o] : Star;
  return <I size={size} weight="duotone" aria-hidden />;
};
export const OCCASIONS: [Occasion, string][] = [
  ['birthday', 'Birthday'],
  ['christmas', 'Christmas'],
  ['wedding', 'Wedding'],
  ['baby', 'Baby'],
  ['easter', 'Easter'],
  ['other', 'Other occasion'],
];
export const occasionLabel = (o: Occasion | null) => (o ? t(OCCASIONS.find(([k]) => k === o)?.[1] ?? 'Other occasion') : null);

/** Photo with an arch top (Dutch Detail), or a tinted tile with the wish's symbol. */
export function WishThumb({ photo, icon, size = 72, title, className = '' }: { photo: string | null; icon: string; size?: number | 'fill'; title?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = size === 'fill' ? undefined : { width: size, height: size };
  return (
    <div className={`wish-thumb ${className}`} style={style}>
      {photo && !broken ? (
        <img src={photo} alt={title ?? ''} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <div className="wish-thumb-tile" style={{ background: tintOf(icon) }}>
          <WishSymbol icon={icon} size={size === 'fill' ? 64 : Math.round(size * 0.42)} />
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ text helpers

export const priceText = (w: Pick<Wish, 'price' | 'price_from_links'>) => (w.price == null ? null : w.price_from_links ? t('from {price}', { price: money(w.price) }) : money(w.price));

export const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const PRIORITY: [string, string][] = [
  ['1', 'Nice to have'],
  ['2', 'Would like'],
  ['3', 'Really wants'],
];
export const PRIORITIES = PRIORITY;
export const priorityLabel = (p: number) => t(PRIORITY.find(([k]) => Number(k) === p)?.[1] ?? 'Would like');

export function fmtDay(d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) {
  try {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString(document.documentElement.lang || 'de', { ...opts, timeZone: 'UTC' });
  } catch {
    return d;
  }
}

/** "in 12 Tagen", "morgen", "heute", "vorbei" */
export function whenText(days: number | null) {
  if (days == null) return null;
  if (days < 0) return t('over');
  if (days === 0) return t('today');
  if (days === 1) return t('tomorrow');
  return t('in {n} days', { n: days });
}

/** "Geburtstag · 6. Dezember · in 12 Tagen" (parts that exist) */
export function occasionLine(l: Pick<WishListInfo, 'occasion' | 'event_date' | 'days_until'>) {
  return [occasionLabel(l.occasion), l.event_date ? fmtDay(l.event_date) : null, whenText(l.days_until)].filter(Boolean).join(' · ');
}

/**
 * A readable title from a shop address, without opening it: the last meaningful path part, dashes to spaces,
 * product numbers and file endings removed ("…/lego-city-feuerwehrstation-60320.html" → "Lego City Feuerwehrstation").
 */
export function titleFromUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const parts = u.pathname
    .split('/')
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    })
    .map((p) => p.replace(/\.(html?|php|aspx?)$/i, ''))
    .filter((p) => p && !/^(dp|p|product|products|produkt|artikel|item|gp|de|en|shop|s)$/i.test(p) && /[a-zäöüß]{3}/i.test(p));
  const best = parts.sort((a, b) => (b.match(/[-_ ]/g)?.length ?? 0) - (a.match(/[-_ ]/g)?.length ?? 0))[0];
  if (!best) return null;
  const words = best
    .split(/[-_+ ]+/)
    .filter((w) => w && !/^\d{4,}$/.test(w) && !/^[a-z]*\d{5,}[a-z]*$/i.test(w))
    .slice(0, 10);
  if (!words.length) return null;
  const s = words.join(' ');
  return (s.charAt(0).toUpperCase() + s.slice(1)).slice(0, 160);
}

