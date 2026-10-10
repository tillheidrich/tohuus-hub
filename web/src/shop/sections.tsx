import { Bread, Broom, Carrot, Cheese, Cookie, Grains, Snowflake, Sparkle, Tag, Wine } from '@phosphor-icons/react';
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
export const sectionLabel = (k: string) => t(SECTION_META[k]?.label ?? 'Other');
export const SectionIcon = ({ k, size = 18 }: { k: string; size?: number }) => {
  const I = SECTION_META[k]?.icon ?? Tag;
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
}
