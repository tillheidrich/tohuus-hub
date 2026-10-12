import { Bread, Broom, Carrot, Cheese, Cookie, Grains, Snowflake, Sparkle, Storefront, Tag, Wine } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { t } from '../i18n';

/** Store sections (aisles). Keys match server/lib/shopparse.ts SECTIONS; labels are English source text. */
export const SECTION_META: Record<string, { label: string; icon: Icon }> = {
  produce: { label: 'Fruit & veg', icon: Carrot },
  bakery: { label: 'Bread & bakery', icon: Bread },
  chilled: { label: 'Dairy & chilled', icon: Cheese },
  frozen: { label: 'Frozen', icon: Snowflake },
  pantry: { label: 'Pantry & cans', icon: Grains },
  snacks: { label: 'Snacks & sweets', icon: Cookie },
  drinks: { label: 'Drinks', icon: Wine },
  drugstore: { label: 'Drugstore', icon: Sparkle },
  household: { label: 'Household', icon: Broom },
  other: { label: 'Other', icon: Tag },
};

export const SECTION_KEYS = Object.keys(SECTION_META);
/** store mode only: open items somebody marked for another store ("Where to buy?", wave 6) */
export const ELSEWHERE = 'elsewhere';
export const sectionLabel = (k: string) => (k === ELSEWHERE ? t('Other stores') : t(SECTION_META[k]?.label ?? 'Other'));
/** Dutch Detail: each aisle gets a small geometric marker next to its name (never the shape alone). */
const SHAPES: Record<string, string> = {
  produce: 'c',
  bakery: 'a',
  chilled: 'h',
  frozen: 'd',
  pantry: 's',
  snacks: 'c2',
  drinks: 'r',
  drugstore: 's2',
  household: 't',
  other: 't2',
};
export const SectionShape = ({ k }: { k: string }) => <span className={`shape ${SHAPES[k] ?? 't2'}`} aria-hidden="true" />;
export const SectionIcon = ({ k, size = 18 }: { k: string; size?: number }) => {
  const I = k === ELSEWHERE ? Storefront : (SECTION_META[k]?.icon ?? Tag);
  return <I size={size} />;
};

export interface Claim {
  user_id: number;
  name: string;
  color: string;
}

export interface ShopItem {
  id: number;
  product_id: number | null;
  text: string;
  qty: number | null;
  note: string | null;
  source: string;
  added_by: string | null;
  checked_at: string | null;
  in_basket: number;
  brand: string | null;
  image_path: string | null;
  section: string;
  claim: Claim | null;
  /** queued offline, not on the server yet */
  pending?: boolean;
  /** discreet / private entry (area: share) */
  share?: import('../pages/Share').ShareInfo;
  /** "Where to buy?" – only what a person entered; empty = anywhere (wave 6) */
  buy_at?: string[];
  /** where the row comes from (server-worded) */
  origin?: string | null;
  /** substitute rule: exactly this one / a substitute is fine / ask first (list2) */
  substitute?: Substitute | null;
  /** a photo somebody took for this row ("this one!") */
  photo_path?: string | null;
  /** what the receipts say was bought last time */
  last_bought?: LastBought | null;
  /** list it belongs to (null = the main list) */
  list_id?: number | null;
}

export type Substitute = 'exact' | 'ok' | 'ask';
export const SUBSTITUTE_LABEL: Record<Substitute, string> = { exact: 'Exactly this one', ok: 'Substitute is fine', ask: 'Ask first' };

export interface LastBought {
  name: string;
  size: string | null;
  image_path: string | null;
  shop: string | null;
  day: string;
  price: number | null;
}

export interface Store {
  id: number;
  name: string;
  order: string[];
  trips: number;
}

export interface ShopView {
  store: Store | null;
  stores: Store[];
  order: string[];
  sections: { key: string; items: ShopItem[] }[];
  basket: ShopItem[];
  done: ShopItem[];
  open: number;
  /** when the server answered (list2: "zuletzt abgeglichen") */
  serverTime?: string;
  listId?: number | 'all';
  lists?: import('./fill').ListInfo[];
  estimate?: import('./fill').Estimate;
}
