/** Place and category icons (area: home), chosen by name. Separate from ui.tsx so the first load stays small. */
import {
  Archive,
  Bathtub,
  Bread,
  Coffee,
  Cookie,
  CookingPot,
  Cube,
  Drop,
  Hamburger,
  IceCream,
  Orange,
  Package,
  Snowflake,
  Sparkle,
  Tag,
  Warehouse,
  WashingMachine,
  Wine,
  Grains,
  Rows,
  Stairs,
  Dresser,
  PottedPlant,
  Desk,
  CoatHanger,
  Garage,
  Couch,
  Bed,
  Door,
  HouseSimple,
  Basket,
  Toolbox,
  Lockers,
  Jar,
} from '@phosphor-icons/react';

// ------------------------------------------------------------------ icons

function Fridge({ size = 20, weight = 'regular' }: { size?: number; weight?: string }) {
  const sw = weight === 'bold' ? 22 : weight === 'fill' ? 20 : 16;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <rect x="56" y="24" width="144" height="208" rx="16" fill={weight === 'fill' ? 'currentColor' : 'none'} fillOpacity={0.2} />
      <line x1="56" y1="104" x2="200" y2="104" />
      <line x1="88" y1="56" x2="88" y2="76" />
      <line x1="88" y1="132" x2="88" y2="164" />
    </svg>
  );
}

/** A chest freezer: a low wide box with a lid line and a snowflake mark (area: home). */
function ChestFreezer({ size = 20, weight = 'regular' }: { size?: number; weight?: string }) {
  const sw = weight === 'bold' ? 22 : weight === 'fill' ? 20 : 16;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <rect x="24" y="88" width="208" height="128" rx="14" fill={weight === 'fill' ? 'currentColor' : 'none'} fillOpacity={0.2} />
      <line x1="24" y1="120" x2="232" y2="120" />
      <line x1="104" y1="104" x2="152" y2="104" />
      <line x1="128" y1="146" x2="128" y2="190" />
      <line x1="108" y1="156" x2="148" y2="180" />
      <line x1="148" y1="156" x2="108" y2="180" />
    </svg>
  );
}

const ICONS: Record<string, any> = {
  refrigerator: Fridge,
  snowflake: Snowflake,
  archive: Archive,
  warehouse: Warehouse,
  'cooking-pot': CookingPot,
  bath: Bathtub,
  'washing-machine': WashingMachine,
  box: Cube,
  'ice-cream-cone': IceCream,
  'cup-soda': Drop,
  milk: Drop,
  apple: Orange,
  croissant: Bread,
  wheat: Grains,
  cookie: Cookie,
  sparkles: Sparkle,
  package: Package,
  coffee: Coffee,
  wine: Wine,
  tag: Tag,
  food: Hamburger,
  // places (area: home)
  shelf: Rows,
  cellar: Stairs,
  'chest-freezer': ChestFreezer,
  drawer: Dresser,
  balcony: PottedPlant,
  desk: Desk,
  wardrobe: CoatHanger,
  garage: Garage,
  couch: Couch,
  bed: Bed,
  door: Door,
  house: HouseSimple,
  basket: Basket,
  toolbox: Toolbox,
  lockers: Lockers,
  jar: Jar,
};
export const ICON_CHOICES = Object.keys(ICONS);

export function Ic({ name, size = 20, weight = 'regular' as const }: { name: string; size?: number; weight?: any }) {
  const C = ICONS[name] ?? Cube;
  return <C size={size} weight={weight} />;
}

// ------------------------------------------------------------------ thumbs & badges

// soft tints from the design tokens (they switch with light / dark)
