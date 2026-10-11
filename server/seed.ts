import { config } from './config.js';
import { db, getSetting, lang, setSetting } from './db.js';
import { t } from './i18n.js';
import { adjustStock, createProduct } from './lib/catalog.js';
import { NAME_MAX, PASSWORD_MIN, hashPassword, randomToken } from './lib/auth.js';
import { BASE_CATEGORIES, BASE_LOCATIONS, baseName, categoryIdByKey, locationIdByKey, type CategoryKey } from './lib/basedata.js';
import { saveRecipe } from './lib/recipes.js';
import { captureDemo } from './lib/demo.js';

/** Base locations and categories, named in the household language at creation time. */
export function ensureBaseData() {
  if ((db.prepare('SELECT COUNT(*) n FROM locations').get() as { n: number }).n === 0) {
    const ins = db.prepare('INSERT INTO locations (name, kind, icon, sort) VALUES (?, ?, ?, ?)');
    BASE_LOCATIONS.forEach((l, i) => ins.run(baseName(l), l.key, l.icon, i));
  }
  if ((db.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n === 0) {
    const ins = db.prepare('INSERT INTO categories (name, icon, default_location_id, track_mode, sort) VALUES (?, ?, ?, ?, ?)');
    BASE_CATEGORIES.forEach((c, i) => ins.run(baseName(c), c.icon, locationIdByKey(c.loc), c.track, i));
  }
  if ((db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n === 0) {
    const pw = config.adminPassword || randomToken(9);
    if (config.adminPassword && config.adminPassword.length < PASSWORD_MIN)
      console.warn(`  ToHuus Hub: ADMIN_PASSWORD is shorter than ${PASSWORD_MIN} characters – it works for the first login, but please change it in Settings.`);
    db.prepare(`INSERT INTO users (name, role, password_hash, color) VALUES (?, 'admin', ?, '#2f5bea')`).run(config.adminName.trim().slice(0, NAME_MAX) || 'Admin', hashPassword(pw));
    if (!config.adminPassword) console.log(`\n  ToHuus Hub: admin "${config.adminName}" created, password: ${pw}\n`);
  }
  if (!getSetting('household.name', null)) setSetting('household.name', t('Our home'));
}

const cat = (key: CategoryKey) => categoryIdByKey(key);

// ------------------------------------------------------------ demo household
// The German list is the source of truth (it is a German-supermarket household). For English and Swedish
// households every visible text goes through the EN / SV maps below; brands stay as they are.

const COFFEE_OPTIONS = [
  { group: 'Milch', choices: ['Normal', 'Laktosefrei', 'Hafer'], multi: false },
  { group: 'Koffein', choices: ['Normal', 'Entkoffeiniert'], multi: false },
  { group: 'Aroma', choices: ['Keins', 'Vanille', 'Karamell'], multi: false },
];

type DemoItem = [name: string, brand: string | null, size: string | null, category: CategoryKey, qty: number, min: number, opts?: Record<string, unknown>];

const DEMO: DemoItem[] = [
  // Fredirando bar (the original demo data: drinks, ice cream, snacks, takeaway)
  ['Cappuccino', null, null, 'bar', 0, 0, { orderable: true, order_group: 'Getränke', options: COFFEE_OPTIONS, unit: 'Tasse' }],
  ['Latte Macchiato', null, null, 'bar', 0, 0, { orderable: true, order_group: 'Getränke', options: COFFEE_OPTIONS, unit: 'Glas' }],
  ['Espresso', null, null, 'bar', 0, 0, { orderable: true, order_group: 'Getränke', options: [COFFEE_OPTIONS[1]], unit: 'Tasse' }],
  ['Pizza (Wunsch in Notiz)', null, null, 'bar', 0, 0, { orderable: true, order_group: 'Extern', unit: 'Bestellung' }],
  ['Vanille-Eis', 'Langnese', '900ml', 'icecream', 8, 2, { orderable: true, order_group: 'Eis', options: [{ group: 'Toppings', choices: ['Streusel', 'Schokosauce', 'Nüsse'], multi: true }], unit: 'Kugel' }],
  ['Schoko-Eis', 'Langnese', '900ml', 'icecream', 6, 2, { orderable: true, order_group: 'Eis', options: [{ group: 'Toppings', choices: ['Streusel', 'Schokosauce', 'Nüsse'], multi: true }], unit: 'Kugel' }],
  ['Erdbeer-Eis', 'Langnese', '900ml', 'icecream', 0, 2, { orderable: true, order_group: 'Eis', unit: 'Kugel' }],
  ['Cremissimo Stracciatella', 'Langnese', '1300ml', 'icecream', 1, 1],
  ['Frikadelle', null, null, 'chilled', 4, 2, { orderable: true, order_group: 'Snacks', options: [{ group: 'Saucen', choices: ['Senf', 'Ketchup', 'Mayo'], multi: true }] }],
  ['Chips Paprika', 'Funny-frisch', '175g', 'snacks', 3, 1, { orderable: true, order_group: 'Snacks', unit: 'Tüte' }],
  ['Milchmäuse', 'Choceur', '210g', 'snacks', 2, 1, { orderable: true, order_group: 'Snacks', unit: 'Packung' }],
  // drinks on the storage shelf
  ['Mio Mio Mate', 'Mio Mio', '0,5l', 'drinks', 7, 4, { orderable: true, order_group: 'Getränke', unit: 'Flasche' }],
  ['Mio Mio Cola', 'Mio Mio', '0,5l', 'drinks', 3, 4, { orderable: true, order_group: 'Getränke', unit: 'Flasche' }],
  ['Mildes Frühstück Multivitamin', 'Valensina', '1l', 'drinks', 5, 2, { unit: 'Flasche' }],
  ['Mineralwasser Medium', 'Gerolsteiner', '0,75l', 'drinks', 11, 6, { orderable: true, order_group: 'Getränke', unit: 'Flasche' }],
  ['Fritz-Kola', 'Fritz-Kola', '0,33l', 'drinks', 0, 0, { orderable: true, order_group: 'Getränke', unit: 'Flasche' }],
  // frozen
  ['Vegane Dino Nuggets', 'REWE Beste Wahl', '300g', 'frozen', 2, 1],
  ['Süsskartoffel Pommes', 'REWE Beste Wahl', '500g', 'frozen', 1, 1],
  ['Curly Fries pikant', 'ja!', '600g', 'frozen', 1, 0],
  ['Rahmspinat', 'Iglo', '750g', 'frozen', 1, 1],
  ['Erbsen', 'ja!', '750g', 'frozen', 2, 1],
  ['Mini Pizza Pomodori vegan', 'REWE Beste Wahl', '360g', 'frozen', 0, 1],
  ['6-Kräuter', 'REWE Bio', '50g', 'frozen', 1, 0],
  // fridge
  ['Eier Freilandhaltung', 'Cassenshof', '10 Stück', 'chilled', 6, 4, { unit: 'Stk' }],
  ['Butter', 'Kerrygold', '250g', 'chilled', 1, 1],
  ['Mozzarella', 'ja!', '125g', 'chilled', 2, 1],
  ['Feta', 'REWE Bio', '200g', 'chilled', 1, 0],
  ['Fruchtzwerge weniger süß', 'Danone', '6x50g', 'chilled', 1, 1, { unit: 'Pack' }],
  ['Kochcreme 15%', 'REWE', '250ml', 'chilled', 1, 1],
  ['Cheddar Scheiben', 'Violife', '140g', 'chilled', 1, 0],
  ['Veganer Schinken Spicker Mortadella', 'Rügenwalder Mühle', '80g', 'chilled', 1, 0],
  // pantry
  ['Gnocchi', 'Delverde', '500g', 'pantry', 2, 1],
  ['Spaghetti', 'Barilla', '500g', 'pantry', 3, 2],
  ['Eliche Tricolore', 'Delverde', '500g', 'pantry', 1, 0],
  ['Basmati Reis', 'ja!', '1kg', 'pantry', 1, 1],
  ['Rote Linsen', 'REWE Bio', '500g', 'pantry', 1, 0],
  ['Stückige Tomaten', 'REWE', '400g', 'pantry', 4, 2, { unit: 'Dose' }],
  ['Kokosmilch', 'REWE Beste Wahl', '400ml', 'pantry', 2, 1, { unit: 'Dose' }],
  ['Haferflocken', 'Kölln', '500g', 'pantry', 1, 1],
  ['Sonnenmais Supersweet', 'REWE Beste Wahl', '140g', 'pantry', 2, 0, { unit: 'Dose' }],
  ['Sesamöl Nativ', 'REWE Bio', '250ml', 'pantry', 1, 0, { unit: 'Flasche' }],
  ['Burger Gewürz', 'REWE Beste Wahl', '41g', 'pantry', 1, 0],
  ['Pom-Bär Ketchup Style', 'Funny-frisch', '75g', 'snacks', 1, 0, { unit: 'Tüte' }],
  // fruit & veg (only roughly: full / half / low / empty)
  ['Bananen', null, null, 'produce', 3, 1],
  ['Snack-Äpfel', 'REWE Beste Wahl', '1kg', 'produce', 2, 1],
  ['Süßkartoffeln', null, null, 'produce', 1, 1],
  ['Paprika', null, null, 'produce', 2, 0],
  ['Zucchini', null, null, 'produce', 1, 0],
  ['Kartoffeln', null, '2kg', 'produce', 3, 1],
  ['Zwiebeln', null, null, 'produce', 1, 1],
  ['Vollkornsandwich', 'REWE Bio', '750g', 'bakery', 2, 1],
  // household & toiletries
  ['Paketband', 'tesa', '66m x 50mm', 'household', 0, 1, { unit: 'Rolle', spot: 'Regal neben der Tür, Kiste „Post & Pakete“' }],
  ['Müllbeutel 35l', 'ja!', '25 Stück', 'household', 1, 1, { unit: 'Rolle' }],
  ['Spülmaschinen-Tabs', 'Finish', '50 Stück', 'household', 1, 1, { unit: 'Packung' }],
  ['Toilettenpapier', 'Hakle', '8 Rollen', 'household', 2, 1, { unit: 'Packung' }],
  ['Küchenrolle', 'Zewa', '4 Rollen', 'household', 1, 1, { unit: 'Packung' }],
  ['Waschmittel Megaperls', 'Persil', '1,04kg', 'household', 1, 1, { unit: 'Packung' }],
  ['Batterien AA', 'Varta', '8 Stück', 'household', 0, 0, { unit: 'Packung', spot: 'Oberste Schublade links' }],
  ['Zahnpasta', 'elmex', '75ml', 'toiletries', 2, 1, { unit: 'Tube', spot: 'Unterschrank, linke Tür' }],
  // not counted – only "where is what?"
  ['Fieberthermometer', null, null, 'toiletries', 0, 0, { track: 'none', spot: 'Spiegelschrank, mittleres Fach' }],
  ['Pflaster & Verbandszeug', null, null, 'toiletries', 0, 0, { track: 'none', spot: 'Spiegelschrank, unten – rote Box' }],
  ['Taschenlampe', null, null, 'household', 0, 0, { track: 'none', spot: 'Haken rechts neben dem Sicherungskasten' }],
  ['Sicherungskasten', null, null, 'household', 0, 0, { track: 'none', spot: 'Hinter der Tür, auf Augenhöhe' }],
  ['Werkzeugkiste', null, null, 'household', 0, 0, { track: 'none', spot: 'Unterstes Regal, grüne Kiste' }],
  ['Wärmflasche', null, null, 'toiletries', 0, 0, { track: 'none', spot: 'Handtuchregal, ganz oben' }],
  ['Slipeinlagen Daily Protect', 'Always', '40 Stück', 'toiletries', 1, 1, { unit: 'Packung' }],
];
/** German demo text → English (product names, units, order groups and options, spots, hints, shopping items). */
const EN: Record<string, string> = {
  // products
  'Pizza (Wunsch in Notiz)': 'Pizza (say which in the note)',
  'Vanille-Eis': 'Vanilla ice cream',
  'Schoko-Eis': 'Chocolate ice cream',
  'Erdbeer-Eis': 'Strawberry ice cream',
  Frikadelle: 'Meat patty',
  'Chips Paprika': 'Paprika crisps',
  Milchmäuse: 'Chocolate mice',
  'Mildes Frühstück Multivitamin': 'Multivitamin juice',
  'Mineralwasser Medium': 'Sparkling water (medium)',
  'Vegane Dino Nuggets': 'Vegan dino nuggets',
  'Süsskartoffel Pommes': 'Sweet potato fries',
  'Curly Fries pikant': 'Spicy curly fries',
  Rahmspinat: 'Creamed spinach',
  Erbsen: 'Peas',
  'Mini Pizza Pomodori vegan': 'Vegan mini pizza pomodori',
  '6-Kräuter': '6-herb mix',
  'Eier Freilandhaltung': 'Free-range eggs',
  'Fruchtzwerge weniger süß': 'Fruchtzwerge less sweet',
  'Kochcreme 15%': 'Cooking cream 15%',
  'Cheddar Scheiben': 'Cheddar slices',
  'Veganer Schinken Spicker Mortadella': 'Vegan mortadella slices',
  'Basmati Reis': 'Basmati rice',
  'Rote Linsen': 'Red lentils',
  'Stückige Tomaten': 'Chopped tomatoes',
  Kokosmilch: 'Coconut milk',
  Haferflocken: 'Rolled oats',
  'Sonnenmais Supersweet': 'Sweetcorn',
  'Sesamöl Nativ': 'Sesame oil',
  'Burger Gewürz': 'Burger seasoning',
  Bananen: 'Bananas',
  'Snack-Äpfel': 'Snack apples',
  Süßkartoffeln: 'Sweet potatoes',
  Paprika: 'Peppers',
  Zucchini: 'Courgettes',
  Kartoffeln: 'Potatoes',
  Zwiebeln: 'Onions',
  Vollkornsandwich: 'Wholegrain sandwich bread',
  Paketband: 'Parcel tape',
  'Müllbeutel 35l': 'Bin bags 35l',
  'Spülmaschinen-Tabs': 'Dishwasher tablets',
  Toilettenpapier: 'Toilet paper',
  Küchenrolle: 'Kitchen roll',
  'Waschmittel Megaperls': 'Laundry detergent Megaperls',
  'Batterien AA': 'AA batteries',
  Zahnpasta: 'Toothpaste',
  Fieberthermometer: 'Thermometer',
  'Pflaster & Verbandszeug': 'Plasters & first aid kit',
  Taschenlampe: 'Torch',
  Sicherungskasten: 'Fuse box',
  Werkzeugkiste: 'Toolbox',
  Wärmflasche: 'Hot-water bottle',
  'Slipeinlagen Daily Protect': 'Panty liners Daily Protect',
  Geschenkpapier: 'Wrapping paper',
  // units
  Stk: 'pc',
  Tasse: 'cup',
  Glas: 'glass',
  Bestellung: 'order',
  Kugel: 'scoop',
  Tüte: 'bag',
  Packung: 'pack',
  Pack: 'pack',
  Flasche: 'bottle',
  Dose: 'can',
  Rolle: 'roll',
  Tube: 'tube',
  // order groups and options
  Getränke: 'Drinks',
  Extern: 'Takeaway',
  Eis: 'Ice cream',
  Milch: 'Milk',
  Laktosefrei: 'Lactose-free',
  Hafer: 'Oat',
  Koffein: 'Caffeine',
  Entkoffeiniert: 'Decaf',
  Aroma: 'Flavour',
  Keins: 'None',
  Vanille: 'Vanilla',
  Karamell: 'Caramel',
  Streusel: 'Sprinkles',
  Schokosauce: 'Chocolate sauce',
  Nüsse: 'Nuts',
  Saucen: 'Sauces',
  Senf: 'Mustard',
  // spots and location hints
  'Regal neben der Tür, Kiste „Post & Pakete“': 'Shelf next to the door, box “Post & parcels”',
  'Oberste Schublade links': 'Top drawer on the left',
  'Unterschrank, linke Tür': 'Base cabinet, left door',
  'Spiegelschrank, mittleres Fach': 'Mirror cabinet, middle shelf',
  'Spiegelschrank, unten – rote Box': 'Mirror cabinet, bottom – red box',
  'Haken rechts neben dem Sicherungskasten': 'Hook to the right of the fuse box',
  'Hinter der Tür, auf Augenhöhe': 'Behind the door, at eye level',
  'Unterstes Regal, grüne Kiste': 'Bottom shelf, green box',
  'Handtuchregal, ganz oben': 'Towel shelf, right at the top',
  'Im Flur, das Regal links neben der Garderobe. Getränke unten, Vorräte oben.': 'In the hallway, the shelf left of the coat rack. Drinks at the bottom, supplies at the top.',
  'Unter der Spüle, linke Tür.': 'Under the sink, left door.',
  Grillabend: 'Barbecue night',
};

/** German demo text → Swedish (same keys as EN). Brands stay as they are. */
const SV: Record<string, string> = {
  // products
  'Pizza (Wunsch in Notiz)': 'Pizza (skriv vilken i kommentaren)',
  'Vanille-Eis': 'Vaniljglass',
  'Schoko-Eis': 'Chokladglass',
  'Erdbeer-Eis': 'Jordgubbsglass',
  Frikadelle: 'Köttbulle',
  'Chips Paprika': 'Paprikachips',
  Milchmäuse: 'Chokladmöss',
  'Mildes Frühstück Multivitamin': 'Multivitaminjuice',
  'Mineralwasser Medium': 'Mineralvatten (lätt kolsyrat)',
  'Vegane Dino Nuggets': 'Veganska dinonuggets',
  'Süsskartoffel Pommes': 'Sötpotatispommes',
  'Curly Fries pikant': 'Kryddiga curly fries',
  Rahmspinat: 'Stuvad spenat',
  Erbsen: 'Ärtor',
  'Mini Pizza Pomodori vegan': 'Vegansk minipizza pomodori',
  '6-Kräuter': 'Örtmix (6 örter)',
  'Eier Freilandhaltung': 'Ägg från frigående höns',
  'Fruchtzwerge weniger süß': 'Fruchtzwerge mindre söt',
  'Kochcreme 15%': 'Matlagningsgrädde 15 %',
  'Cheddar Scheiben': 'Cheddarskivor',
  'Veganer Schinken Spicker Mortadella': 'Vegansk mortadella i skivor',
  'Basmati Reis': 'Basmatiris',
  'Rote Linsen': 'Röda linser',
  'Stückige Tomaten': 'Krossade tomater',
  Kokosmilch: 'Kokosmjölk',
  Haferflocken: 'Havregryn',
  'Sonnenmais Supersweet': 'Majs',
  'Sesamöl Nativ': 'Sesamolja',
  'Burger Gewürz': 'Burgerkrydda',
  Bananen: 'Bananer',
  'Snack-Äpfel': 'Snackäpplen',
  Süßkartoffeln: 'Sötpotatis',
  Paprika: 'Paprika',
  Zucchini: 'Zucchini',
  Kartoffeln: 'Potatis',
  Zwiebeln: 'Lök',
  Vollkornsandwich: 'Fullkornsformbröd',
  Paketband: 'Packtejp',
  'Müllbeutel 35l': 'Soppåsar 35 l',
  'Spülmaschinen-Tabs': 'Diskmaskinstabletter',
  Toilettenpapier: 'Toalettpapper',
  Küchenrolle: 'Hushållspapper',
  'Waschmittel Megaperls': 'Tvättmedel Megaperls',
  'Batterien AA': 'AA-batterier',
  Zahnpasta: 'Tandkräm',
  Fieberthermometer: 'Febertermometer',
  'Pflaster & Verbandszeug': 'Plåster & förband',
  Taschenlampe: 'Ficklampa',
  Sicherungskasten: 'Proppskåp',
  Werkzeugkiste: 'Verktygslåda',
  Wärmflasche: 'Varmvattenflaska',
  'Slipeinlagen Daily Protect': 'Trosskydd Daily Protect',
  Butter: 'Smör',
  Feta: 'Fetaost',
  Geschenkpapier: 'Presentpapper',
  // units
  Stk: 'st',
  Tasse: 'kopp',
  Glas: 'glas',
  Bestellung: 'beställning',
  Kugel: 'kula',
  Tüte: 'påse',
  Packung: 'förp.',
  Pack: 'förp.',
  Flasche: 'flaska',
  Dose: 'burk',
  Rolle: 'rulle',
  Tube: 'tub',
  // order groups and options
  Getränke: 'Dryck',
  Extern: 'Hämtmat',
  Eis: 'Glass',
  Milch: 'Mjölk',
  Laktosefrei: 'Laktosfri',
  Hafer: 'Havre',
  Koffein: 'Koffein',
  Entkoffeiniert: 'Koffeinfri',
  Aroma: 'Smak',
  Keins: 'Ingen',
  Vanille: 'Vanilj',
  Karamell: 'Kola',
  Streusel: 'Strössel',
  Schokosauce: 'Chokladsås',
  Nüsse: 'Nötter',
  Saucen: 'Såser',
  Senf: 'Senap',
  // spots and location hints
  'Regal neben der Tür, Kiste „Post & Pakete“': 'Hyllan bredvid dörren, lådan ”Post & paket”',
  'Oberste Schublade links': 'Översta lådan till vänster',
  'Unterschrank, linke Tür': 'Underskåpet, vänstra dörren',
  'Spiegelschrank, mittleres Fach': 'Spegelskåpet, mittersta hyllan',
  'Spiegelschrank, unten – rote Box': 'Spegelskåpet, längst ner – röda lådan',
  'Haken rechts neben dem Sicherungskasten': 'Kroken till höger om proppskåpet',
  'Hinter der Tür, auf Augenhöhe': 'Bakom dörren, i ögonhöjd',
  'Unterstes Regal, grüne Kiste': 'Nedersta hyllan, gröna lådan',
  'Handtuchregal, ganz oben': 'Handdukshyllan, högst upp',
  'Im Flur, das Regal links neben der Garderobe. Getränke unten, Vorräte oben.': 'I hallen, hyllan till vänster om klädhängaren. Dryck längst ner, förråd högst upp.',
  'Unter der Spüle, linke Tür.': 'Under diskbänken, vänstra dörren.',
  Grillabend: 'Grillkväll',
};

/** Translation map for the household language (German is the source, so none for 'de'). */
const demoMap = (): Record<string, string> | null => ({ en: EN, sv: SV, de: null })[lang()];
/** Demo text in the household language. */
const tr = (s: string) => demoMap()?.[s] ?? s;
/** English: "0,5l" → "0.5l", "10 Stück" → "10 pcs", "8 Rollen" → "8 rolls"; Swedish: "10 st", "8 rullar" */
const trSize = (s: string | null) => {
  if (!s) return s;
  const l = lang();
  if (l === 'en') return s.replace(/(\d),(\d)/g, '$1.$2').replace(/\bStück\b/, 'pcs').replace(/\bRollen\b/, 'rolls');
  if (l === 'sv') return s.replace(/Stück/, 'st').replace(/Rollen/, 'rullar');
  return s;
};
const trOptions = (opts: unknown) =>
  (opts as { group: string; choices: string[]; multi: boolean }[] | undefined)?.map((o) => ({ ...o, group: tr(o.group), choices: o.choices.map(tr) }));


function addDays(d: number) {
  return new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
}

/**
 * The demo household. Runs once (SEED_DEMO on the first start, or "Explore with demo data" in the app);
 * `force` seeds again after the demo was removed, as long as the household has no products.
 * Every inserted row is marked as demo (server/lib/demo.ts), so it can be removed again precisely.
 */
export function seedDemo(opts: { force?: boolean } = {}): boolean {
  if (getSetting('demo.seeded', false) && !opts.force) return false;
  if ((db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n > 0) return false;
  captureDemo(seedDemoRows);
  setSetting('demo.seeded', true);
  return true;
}

/** Location hints the demo sets (current and earlier versions, all languages) – cleared again on removal. */
export const DEMO_HINTS_DE = [
  'Im Flur, das Regal links neben der Garderobe. Getränke unten, Vorräte oben.',
  'Unter der Spüle, linke Tür.',
  // earlier demo versions
  'Kellertreppe runter, erste Tür links. Licht rechts neben der Tür.',
  'Neben der Waschküche, Tür mit dem Kalender.',
];
const LEGACY_HINTS = [
  'Down the cellar stairs, first door on the left. Light switch to the right of the door.',
  'Next to the laundry, the door with the calendar.',
  'Ner för källartrappan, första dörren till vänster. Lysknappen till höger om dörren.',
  'Bredvid tvättstugan, dörren med kalendern.',
];

/** What the demo seed creates, in every language – used to recognise demo data seeded before rows were marked. */
export function demoSignatures() {
  const all = (s: string) => [...new Set([s, EN[s] ?? s, SV[s] ?? s])];
  const sizes = (s: string | null) => {
    if (!s) return [null];
    const en = s.replace(/(\d),(\d)/g, '$1.$2').replace(/\bStück\b/, 'pcs').replace(/\bRollen\b/, 'rolls');
    const sv = s.replace(/Stück/, 'st').replace(/Rollen/, 'rullar');
    return [...new Set([s, en, sv])];
  };
  return {
    entries: DEMO.length,
    products: DEMO.flatMap(([name, brand, size]) => all(name).map((n) => ({ name: n, brand, sizes: sizes(size) }))),
    recipes: [...RECIPES_DE, ...RECIPES_EN, ...RECIPES_SV].map(([r]) => r.title),
    shopping: ['Paketband', 'Erdbeer-Eis', 'Mini Pizza Pomodori vegan', 'Geschenkpapier'].flatMap(all),
    guestLinks: all('Grillabend'),
    hints: [...DEMO_HINTS_DE.flatMap(all), ...LEGACY_HINTS],
  };
}

function seedDemoRows() {
  const hint = db.prepare('UPDATE locations SET hint = ? WHERE id = ? AND hint IS NULL');
  hint.run(tr('Im Flur, das Regal links neben der Garderobe. Getränke unten, Vorräte oben.'), locationIdByKey('shelf'));
  hint.run(tr('Unter der Spüle, linke Tür.'), locationIdByKey('utility'));
  // keyed by the German demo name (the source of truth), whatever language the rows were created in
  const ids = new Map<string, number>();
  for (const [name, brand, size, category, qty, min, o = {}] of DEMO) {
    const id = createProduct({
      name: tr(name),
      brand,
      size: trSize(size),
      categoryId: cat(category),
      minQty: min,
      unit: tr((o.unit as string) ?? 'Stk'),
      orderable: Boolean(o.orderable),
      orderGroup: o.order_group ? tr(o.order_group as string) : null,
      orderOptions: trOptions(o.options),
      trackMode: (o.track as 'none' | undefined) ?? undefined,
      spot: o.spot ? tr(o.spot as string) : null,
    });
    ids.set(name, id);
    if (qty > 0) adjustStock({ productId: id, delta: qty, reason: 'inventory', actor: 'Demo', silent: true });
  }
  // a few best-before dates so the dashboard has something to warn about
  const date = (name: string, d: number) =>
    db.prepare('UPDATE stock SET best_before = ? WHERE product_id = ?').run(addDays(d), ids.get(name));
  date('Mozzarella', 1);
  date('Feta', 2);
  date('Kochcreme 15%', 4);
  date('Fruchtzwerge weniger süß', -1);
  date('Eier Freilandhaltung', 9);
  // staples count as always there for recipe suggestions
  db.prepare('UPDATE products SET is_staple = 1 WHERE id = ?').run(ids.get('Zwiebeln'));
  // shopping list
  const shop = db.prepare('INSERT INTO shopping_items (product_id, text, source, added_by) VALUES (?, ?, ?, ?)');
  shop.run(ids.get('Paketband'), tr('Paketband'), 'manual', 'Till');
  shop.run(ids.get('Erdbeer-Eis'), tr('Erdbeer-Eis'), 'auto', 'ToHuus Hub');
  shop.run(ids.get('Mini Pizza Pomodori vegan'), tr('Mini Pizza Pomodori vegan'), 'auto', 'ToHuus Hub');
  shop.run(null, tr('Geschenkpapier'), 'manual', 'Lea');
  seedRecipes();
  db.prepare(`INSERT INTO guest_links (token, name, scopes, expires_at) VALUES (?, ?, '["bar"]', datetime('now', '+30 days'))`).run(
    randomToken(12),
    tr('Grillabend'),
  );
}

type DemoRecipe = [recipe: Parameters<typeof saveRecipe>[0], cookedDaysAgo: number[]];

function seedRecipes() {
  for (const [r, cookedDaysAgo] of ({ en: RECIPES_EN, sv: RECIPES_SV, de: RECIPES_DE } as const)[lang()]) {
    const id = saveRecipe(r);
    for (const d of cookedDaysAgo)
      db.prepare(`INSERT INTO cook_log (recipe_id, cooked_at, actor) VALUES (?, datetime('now', ?), 'Demo')`).run(id, `-${d} days`);
  }
}

const RECIPES_DE: DemoRecipe[] = [
  [
    {
      title: 'Gnocchi-Pfanne mit Tomate & Mozzarella',
      description: 'Knusprig gebratene Gnocchi, schnelle Tomatensauce, Mozzarella obendrauf. 20 Minuten, ein Topf weniger.',
      source_type: 'hellofresh',
      servings: 3,
      time_min: 20,
      tags: ['schnell', 'vegetarisch', 'Familie'],
      favorite: true,
      ingredients: [
        { text: '500 g Gnocchi', qty: 500, unit: 'g' },
        { text: '1 Dose stückige Tomaten', qty: 1, unit: 'Dose' },
        { text: '1 Mozzarella', qty: 1 },
        { text: '1 Zucchini', qty: 1 },
        { text: '1 Zwiebel', qty: 1 },
        { text: 'Olivenöl, Salz, Pfeffer', pantry: true },
      ],
      steps: [
        { text: 'Zwiebel und Zucchini würfeln. Gnocchi in Öl goldbraun braten (ca. 6 Min.), herausnehmen.' },
        { text: 'Zwiebel und Zucchini in derselben Pfanne anbraten, Tomaten zugeben, 5 Min. köcheln, salzen und pfeffern.' },
        { text: 'Gnocchi unterheben, Mozzarella zerzupfen und darauf verteilen, abgedeckt 2 Min. schmelzen lassen.' },
      ],
    },
    [12, 40],
  ],
  [
    {
      title: 'Süßkartoffel-Kokos-Curry',
      description: 'Mild, cremig, kindertauglich – im Thermomix in 30 Minuten.',
      source_type: 'own',
      servings: 4,
      time_min: 30,
      thermomix: true,
      tags: ['Thermomix', 'vegan', 'Curry'],
      ingredients: [
        { text: '1 Zwiebel', qty: 1 },
        { text: '600 g Süßkartoffeln', qty: 600, unit: 'g' },
        { text: '400 ml Kokosmilch', qty: 400, unit: 'ml' },
        { text: '1 Dose stückige Tomaten', qty: 1, unit: 'Dose' },
        { text: '150 g rote Linsen', qty: 150, unit: 'g' },
        { text: '200 g Basmati Reis', qty: 200, unit: 'g' },
        { text: '2 TL Currypulver, Salz', pantry: true },
      ],
      steps: [
        { text: 'Zwiebel in den Mixtopf geben und zerkleinern.', tm: { time: '5 Sek.', temp: null, speed: '5' } },
        { text: 'Öl zugeben und andünsten.', tm: { time: '3 Min.', temp: '120°C', speed: '1' } },
        { text: 'Süßkartoffelwürfel, Linsen, Kokosmilch, Tomaten und Gewürze zugeben, garen.', tm: { time: '18 Min.', temp: '100°C', speed: 'Linkslauf 1' } },
        { text: 'Reis parallel im Garkörbchen oder im Topf garen, abschmecken und servieren.' },
      ],
    },
    [45],
  ],
  [
    {
      title: 'Spaghetti mit veganer Bolognese',
      source_type: 'own',
      servings: 4,
      time_min: 35,
      thermomix: true,
      tags: ['Thermomix', 'Klassiker', 'Familie'],
      favorite: true,
      ingredients: [
        { text: '500 g Spaghetti', qty: 500, unit: 'g' },
        { text: '1 Zwiebel', qty: 1 },
        { text: '2 Dosen stückige Tomaten', qty: 2, unit: 'Dose' },
        { text: '100 g rote Linsen', qty: 100, unit: 'g' },
        { text: '1 Zucchini', qty: 1 },
        { text: 'Salz, Pfeffer, Oregano, Olivenöl', pantry: true },
      ],
      steps: [
        { text: 'Zwiebel und Zucchini zerkleinern.', tm: { time: '5 Sek.', temp: null, speed: '5' } },
        { text: 'Mit Öl andünsten.', tm: { time: '4 Min.', temp: '120°C', speed: '1' } },
        { text: 'Tomaten, Linsen und Gewürze zugeben, köcheln lassen.', tm: { time: '20 Min.', temp: '100°C', speed: 'Linkslauf 1' } },
        { text: 'Spaghetti nach Packung kochen und mit der Sauce servieren.' },
      ],
    },
    [5],
  ],
  [
    {
      title: 'Ofengemüse mit Feta',
      description: 'Blech rein, Blech raus. Gut, wenn noch Gemüse weg muss.',
      source_type: 'hellofresh',
      servings: 2,
      time_min: 35,
      tags: ['Resteverwertung', 'vegetarisch'],
      ingredients: [
        { text: '2 Süßkartoffeln', qty: 2 },
        { text: '1 Zucchini', qty: 1 },
        { text: '1 Paprika', qty: 1 },
        { text: '200 g Feta', qty: 200, unit: 'g' },
        { text: 'Olivenöl, Salz, Kräuter', pantry: true },
      ],
      steps: [
        { text: 'Ofen auf 220 °C Umluft vorheizen. Gemüse in mundgerechte Stücke schneiden.' },
        { text: 'Mit Öl, Salz und Kräutern mischen und 25 Min. backen.' },
        { text: 'Feta darüberbröseln und weitere 5 Min. backen.' },
      ],
    },
    [],
  ],
  [
    {
      title: 'Pfannkuchen',
      source_type: 'own',
      servings: 4,
      time_min: 25,
      thermomix: true,
      tags: ['Thermomix', 'süß', 'Kinder'],
      favorite: true,
      ingredients: [
        { text: '4 Eier', qty: 4 },
        { text: '250 g Mehl', qty: 250, unit: 'g', pantry: true },
        { text: '500 ml Milch', qty: 500, unit: 'ml' },
        { text: 'Butter zum Braten', qty: null },
        { text: '1 Prise Salz, 1 EL Zucker', pantry: true },
      ],
      steps: [
        { text: 'Alle Zutaten außer Butter in den Mixtopf geben und verrühren.', tm: { time: '20 Sek.', temp: null, speed: '5' } },
        { text: 'Teig 10 Min. quellen lassen.' },
        { text: 'In Butter portionsweise ausbacken.' },
      ],
    },
    [20],
  ],
  [
    {
      title: 'Rahmspinat mit Kartoffeln und Spiegelei',
      source_type: 'own',
      servings: 3,
      time_min: 30,
      tags: ['Klassiker', 'vegetarisch'],
      ingredients: [
        { text: '750 g Rahmspinat (TK)', qty: 750, unit: 'g' },
        { text: '1 kg Kartoffeln', qty: 1, unit: 'kg' },
        { text: '6 Eier', qty: 6 },
        { text: 'Butter, Salz, Muskat', pantry: true },
      ],
      steps: [
        { text: 'Kartoffeln schälen und in Salzwasser ca. 20 Min. kochen.' },
        { text: 'Rahmspinat nach Packung erhitzen, mit Muskat abschmecken.' },
        { text: 'Spiegeleier in Butter braten und alles zusammen servieren.' },
      ],
    },
    [60],
  ],
  [
    {
      title: 'Linsen-Dal mit Reis',
      source_type: 'own',
      servings: 4,
      time_min: 30,
      thermomix: true,
      tags: ['Thermomix', 'vegan', 'günstig'],
      ingredients: [
        { text: '1 Zwiebel', qty: 1 },
        { text: '250 g rote Linsen', qty: 250, unit: 'g' },
        { text: '400 ml Kokosmilch', qty: 400, unit: 'ml' },
        { text: '1 Dose stückige Tomaten', qty: 1, unit: 'Dose' },
        { text: '250 g Basmati Reis', qty: 250, unit: 'g' },
        { text: 'Currypulver, Kurkuma, Salz, Gemüsebrühe', pantry: true },
      ],
      steps: [
        { text: 'Zwiebel zerkleinern und andünsten.', tm: { time: '3 Min.', temp: '120°C', speed: '1' } },
        { text: 'Linsen, Kokosmilch, Tomaten, 300 ml Wasser und Gewürze zugeben und garen.', tm: { time: '15 Min.', temp: '100°C', speed: 'Linkslauf 1' } },
        { text: 'Mit Reis servieren.' },
      ],
    },
    [],
  ],
  [
    {
      title: 'Nuggets-Teller mit Süßkartoffel-Pommes',
      description: 'Der Freitags-Retter. Alles aus dem Gefrierfach.',
      source_type: 'own',
      servings: 3,
      time_min: 25,
      tags: ['Kinder', 'Ofen', 'schnell'],
      ingredients: [
        { text: '1 Packung vegane Dino Nuggets', qty: 1 },
        { text: '1 Packung Süßkartoffel Pommes', qty: 1 },
        { text: '1 Dose Mais', qty: 1 },
        { text: 'Ketchup', pantry: true },
      ],
      steps: [{ text: 'Ofen auf 200 °C vorheizen, Nuggets und Pommes nach Packung backen (ca. 20 Min.), Mais erwärmen.' }],
    },
    [9],
  ],
];

/** English demo recipes – same dishes, order and cooking history as RECIPES_DE. */
const RECIPES_EN: DemoRecipe[] = [
  [
    {
      title: 'Gnocchi skillet with tomato & mozzarella',
      description: 'Crispy fried gnocchi, a quick tomato sauce, mozzarella on top. 20 minutes, one pan less to wash.',
      source_type: 'hellofresh',
      servings: 3,
      time_min: 20,
      tags: ['quick', 'vegetarian', 'family'],
      favorite: true,
      ingredients: [
        { text: '500 g gnocchi', qty: 500, unit: 'g' },
        { text: '1 can chopped tomatoes', qty: 1, unit: 'can' },
        { text: '1 mozzarella', qty: 1 },
        { text: '1 courgette', qty: 1 },
        { text: '1 onion', qty: 1 },
        { text: 'Olive oil, salt, pepper', pantry: true },
      ],
      steps: [
        { text: 'Dice the onion and courgette. Fry the gnocchi in oil until golden (approx. 6 min), then take them out.' },
        { text: 'Fry the onion and courgette in the same pan, add the tomatoes, simmer for 5 min, season with salt and pepper.' },
        { text: 'Stir the gnocchi back in, tear the mozzarella over the top and let it melt for 2 min with the lid on.' },
      ],
    },
    [12, 40],
  ],
  [
    {
      title: 'Sweet potato coconut curry',
      description: 'Mild, creamy, kid-friendly – 30 minutes in the Thermomix.',
      source_type: 'own',
      servings: 4,
      time_min: 30,
      thermomix: true,
      tags: ['Thermomix', 'vegan', 'curry'],
      ingredients: [
        { text: '1 onion', qty: 1 },
        { text: '600 g sweet potatoes', qty: 600, unit: 'g' },
        { text: '400 ml coconut milk', qty: 400, unit: 'ml' },
        { text: '1 can chopped tomatoes', qty: 1, unit: 'can' },
        { text: '150 g red lentils', qty: 150, unit: 'g' },
        { text: '200 g basmati rice', qty: 200, unit: 'g' },
        { text: '2 tsp curry powder, salt', pantry: true },
      ],
      steps: [
        { text: 'Put the onion in the mixing bowl and chop.', tm: { time: '5 sec', temp: null, speed: '5' } },
        { text: 'Add oil and sauté.', tm: { time: '3 min', temp: '120°C', speed: '1' } },
        { text: 'Add the diced sweet potato, lentils, coconut milk, tomatoes and spices and cook.', tm: { time: '18 min', temp: '100°C', speed: 'Reverse 1' } },
        { text: 'Meanwhile cook the rice in the simmering basket or in a pan, season to taste and serve.' },
      ],
    },
    [45],
  ],
  [
    {
      title: 'Spaghetti with vegan bolognese',
      source_type: 'own',
      servings: 4,
      time_min: 35,
      thermomix: true,
      tags: ['Thermomix', 'classic', 'family'],
      favorite: true,
      ingredients: [
        { text: '500 g spaghetti', qty: 500, unit: 'g' },
        { text: '1 onion', qty: 1 },
        { text: '2 cans chopped tomatoes', qty: 2, unit: 'can' },
        { text: '100 g red lentils', qty: 100, unit: 'g' },
        { text: '1 courgette', qty: 1 },
        { text: 'Salt, pepper, oregano, olive oil', pantry: true },
      ],
      steps: [
        { text: 'Chop the onion and courgette.', tm: { time: '5 sec', temp: null, speed: '5' } },
        { text: 'Sauté with oil.', tm: { time: '4 min', temp: '120°C', speed: '1' } },
        { text: 'Add the tomatoes, lentils and spices and simmer.', tm: { time: '20 min', temp: '100°C', speed: 'Reverse 1' } },
        { text: 'Cook the spaghetti according to the packet and serve with the sauce.' },
      ],
    },
    [5],
  ],
  [
    {
      title: 'Roast vegetables with feta',
      description: 'Tray in, tray out. Good when there are vegetables to use up.',
      source_type: 'hellofresh',
      servings: 2,
      time_min: 35,
      tags: ['leftovers', 'vegetarian'],
      ingredients: [
        { text: '2 sweet potatoes', qty: 2 },
        { text: '1 courgette', qty: 1 },
        { text: '1 pepper', qty: 1 },
        { text: '200 g feta', qty: 200, unit: 'g' },
        { text: 'Olive oil, salt, herbs', pantry: true },
      ],
      steps: [
        { text: 'Preheat the oven to 220 °C (fan). Cut the vegetables into bite-sized pieces.' },
        { text: 'Toss with oil, salt and herbs and roast for 25 min.' },
        { text: 'Crumble the feta over the top and roast for another 5 min.' },
      ],
    },
    [],
  ],
  [
    {
      title: 'Pancakes',
      source_type: 'own',
      servings: 4,
      time_min: 25,
      thermomix: true,
      tags: ['Thermomix', 'sweet', 'kids'],
      favorite: true,
      ingredients: [
        { text: '4 eggs', qty: 4 },
        { text: '250 g flour', qty: 250, unit: 'g', pantry: true },
        { text: '500 ml milk', qty: 500, unit: 'ml' },
        { text: 'Butter for frying', qty: null },
        { text: '1 pinch of salt, 1 tbsp sugar', pantry: true },
      ],
      steps: [
        { text: 'Put all ingredients except the butter in the mixing bowl and mix.', tm: { time: '20 sec', temp: null, speed: '5' } },
        { text: 'Let the batter rest for 10 min.' },
        { text: 'Fry in butter, one pancake at a time.' },
      ],
    },
    [20],
  ],
  [
    {
      title: 'Creamed spinach with potatoes and fried egg',
      source_type: 'own',
      servings: 3,
      time_min: 30,
      tags: ['classic', 'vegetarian'],
      ingredients: [
        { text: '750 g creamed spinach (frozen)', qty: 750, unit: 'g' },
        { text: '1 kg potatoes', qty: 1, unit: 'kg' },
        { text: '6 eggs', qty: 6 },
        { text: 'Butter, salt, nutmeg', pantry: true },
      ],
      steps: [
        { text: 'Peel the potatoes and boil them in salted water for approx. 20 min.' },
        { text: 'Heat the creamed spinach according to the packet and season with nutmeg.' },
        { text: 'Fry the eggs in butter and serve everything together.' },
      ],
    },
    [60],
  ],
  [
    {
      title: 'Lentil dal with rice',
      source_type: 'own',
      servings: 4,
      time_min: 30,
      thermomix: true,
      tags: ['Thermomix', 'vegan', 'budget'],
      ingredients: [
        { text: '1 onion', qty: 1 },
        { text: '250 g red lentils', qty: 250, unit: 'g' },
        { text: '400 ml coconut milk', qty: 400, unit: 'ml' },
        { text: '1 can chopped tomatoes', qty: 1, unit: 'can' },
        { text: '250 g basmati rice', qty: 250, unit: 'g' },
        { text: 'Curry powder, turmeric, salt, vegetable stock', pantry: true },
      ],
      steps: [
        { text: 'Chop the onion and sauté.', tm: { time: '3 min', temp: '120°C', speed: '1' } },
        { text: 'Add the lentils, coconut milk, tomatoes, 300 ml water and spices and cook.', tm: { time: '15 min', temp: '100°C', speed: 'Reverse 1' } },
        { text: 'Serve with rice.' },
      ],
    },
    [],
  ],
  [
    {
      title: 'Nuggets plate with sweet potato fries',
      description: 'The Friday rescue. Everything from the freezer.',
      source_type: 'own',
      servings: 3,
      time_min: 25,
      tags: ['kids', 'oven', 'quick'],
      ingredients: [
        { text: '1 pack vegan dino nuggets', qty: 1 },
        { text: '1 pack sweet potato fries', qty: 1 },
        { text: '1 can sweetcorn', qty: 1 },
        { text: 'Ketchup', pantry: true },
      ],
      steps: [{ text: 'Preheat the oven to 200 °C, bake the nuggets and fries according to the packet (approx. 20 min), warm the sweetcorn.' }],
    },
    [9],
  ],
];

/** Swedish demo recipes – same dishes, order and cooking history as RECIPES_DE. */
const RECIPES_SV: DemoRecipe[] = [
  [
    {
      title: 'Gnocchipanna med tomat & mozzarella',
      description: 'Krispigt stekta gnocchi, en snabb tomatsås och mozzarella på toppen. 20 minuter, en kastrull mindre att diska.',
      source_type: 'hellofresh',
      servings: 3,
      time_min: 20,
      tags: ['snabbt', 'vegetariskt', 'familj'],
      favorite: true,
      ingredients: [
        { text: '500 g gnocchi', qty: 500, unit: 'g' },
        { text: '1 burk krossade tomater', qty: 1, unit: 'burk' },
        { text: '1 mozzarella', qty: 1 },
        { text: '1 zucchini', qty: 1 },
        { text: '1 lök', qty: 1 },
        { text: 'Olivolja, salt, peppar', pantry: true },
      ],
      steps: [
        { text: 'Tärna löken och zucchinin. Stek gnocchin i olja tills den är gyllene (ca 6 min) och ta upp den.' },
        { text: 'Stek lök och zucchini i samma panna, tillsätt tomaterna, låt puttra i 5 min och smaka av med salt och peppar.' },
        { text: 'Vänd ner gnocchin igen, riv mozzarellan över och låt den smälta i 2 min under lock.' },
      ],
    },
    [12, 40],
  ],
  [
    {
      title: 'Sötpotatiscurry med kokos',
      description: 'Mild, krämig och barnvänlig – 30 minuter i Thermomixen.',
      source_type: 'own',
      servings: 4,
      time_min: 30,
      thermomix: true,
      tags: ['Thermomix', 'veganskt', 'curry'],
      ingredients: [
        { text: '1 lök', qty: 1 },
        { text: '600 g sötpotatis', qty: 600, unit: 'g' },
        { text: '400 ml kokosmjölk', qty: 400, unit: 'ml' },
        { text: '1 burk krossade tomater', qty: 1, unit: 'burk' },
        { text: '150 g röda linser', qty: 150, unit: 'g' },
        { text: '200 g basmatiris', qty: 200, unit: 'g' },
        { text: '2 tsk curry, salt', pantry: true },
      ],
      steps: [
        { text: 'Lägg löken i bunken och hacka.', tm: { time: '5 sek', temp: null, speed: '5' } },
        { text: 'Tillsätt olja och fräs.', tm: { time: '3 min', temp: '120°C', speed: '1' } },
        { text: 'Tillsätt tärnad sötpotatis, linser, kokosmjölk, tomater och kryddor och koka.', tm: { time: '18 min', temp: '100°C', speed: 'Motsols 1' } },
        { text: 'Koka under tiden riset i kokkorgen eller i en kastrull, smaka av och servera.' },
      ],
    },
    [45],
  ],
  [
    {
      title: 'Spaghetti med vegansk köttfärssås',
      source_type: 'own',
      servings: 4,
      time_min: 35,
      thermomix: true,
      tags: ['Thermomix', 'klassiker', 'familj'],
      favorite: true,
      ingredients: [
        { text: '500 g spaghetti', qty: 500, unit: 'g' },
        { text: '1 lök', qty: 1 },
        { text: '2 burkar krossade tomater', qty: 2, unit: 'burk' },
        { text: '100 g röda linser', qty: 100, unit: 'g' },
        { text: '1 zucchini', qty: 1 },
        { text: 'Salt, peppar, oregano, olivolja', pantry: true },
      ],
      steps: [
        { text: 'Hacka lök och zucchini.', tm: { time: '5 sek', temp: null, speed: '5' } },
        { text: 'Fräs med olja.', tm: { time: '4 min', temp: '120°C', speed: '1' } },
        { text: 'Tillsätt tomater, linser och kryddor och låt puttra.', tm: { time: '20 min', temp: '100°C', speed: 'Motsols 1' } },
        { text: 'Koka spaghettin enligt förpackningen och servera med såsen.' },
      ],
    },
    [5],
  ],
  [
    {
      title: 'Ugnsrostade grönsaker med fetaost',
      description: 'In med plåten, ut med plåten. Bra när det finns grönsaker som behöver ätas upp.',
      source_type: 'hellofresh',
      servings: 2,
      time_min: 35,
      tags: ['restmat', 'vegetariskt'],
      ingredients: [
        { text: '2 sötpotatis', qty: 2 },
        { text: '1 zucchini', qty: 1 },
        { text: '1 paprika', qty: 1 },
        { text: '200 g fetaost', qty: 200, unit: 'g' },
        { text: 'Olivolja, salt, örter', pantry: true },
      ],
      steps: [
        { text: 'Sätt ugnen på 220 °C varmluft. Skär grönsakerna i lagom stora bitar.' },
        { text: 'Blanda med olja, salt och örter och rosta i 25 min.' },
        { text: 'Smula fetaosten över och rosta ytterligare 5 min.' },
      ],
    },
    [],
  ],
  [
    {
      title: 'Pannkakor',
      source_type: 'own',
      servings: 4,
      time_min: 25,
      thermomix: true,
      tags: ['Thermomix', 'sött', 'barn'],
      favorite: true,
      ingredients: [
        { text: '4 ägg', qty: 4 },
        { text: '250 g vetemjöl', qty: 250, unit: 'g', pantry: true },
        { text: '500 ml mjölk', qty: 500, unit: 'ml' },
        { text: 'Smör till stekning', qty: null },
        { text: '1 nypa salt, 1 msk socker', pantry: true },
      ],
      steps: [
        { text: 'Lägg alla ingredienser utom smöret i bunken och blanda.', tm: { time: '20 sek', temp: null, speed: '5' } },
        { text: 'Låt smeten vila i 10 min.' },
        { text: 'Stek i smör, en pannkaka i taget.' },
      ],
    },
    [20],
  ],
  [
    {
      title: 'Stuvad spenat med potatis och stekt ägg',
      source_type: 'own',
      servings: 3,
      time_min: 30,
      tags: ['klassiker', 'vegetariskt'],
      ingredients: [
        { text: '750 g stuvad spenat (fryst)', qty: 750, unit: 'g' },
        { text: '1 kg potatis', qty: 1, unit: 'kg' },
        { text: '6 ägg', qty: 6 },
        { text: 'Smör, salt, muskot', pantry: true },
      ],
      steps: [
        { text: 'Skala potatisen och koka den i saltat vatten i ca 20 min.' },
        { text: 'Värm den stuvade spenaten enligt förpackningen och smaka av med muskot.' },
        { text: 'Stek äggen i smör och servera allt tillsammans.' },
      ],
    },
    [60],
  ],
  [
    {
      title: 'Linsdal med ris',
      source_type: 'own',
      servings: 4,
      time_min: 30,
      thermomix: true,
      tags: ['Thermomix', 'veganskt', 'billigt'],
      ingredients: [
        { text: '1 lök', qty: 1 },
        { text: '250 g röda linser', qty: 250, unit: 'g' },
        { text: '400 ml kokosmjölk', qty: 400, unit: 'ml' },
        { text: '1 burk krossade tomater', qty: 1, unit: 'burk' },
        { text: '250 g basmatiris', qty: 250, unit: 'g' },
        { text: 'Curry, gurkmeja, salt, grönsaksbuljong', pantry: true },
      ],
      steps: [
        { text: 'Hacka löken och fräs.', tm: { time: '3 min', temp: '120°C', speed: '1' } },
        { text: 'Tillsätt linser, kokosmjölk, tomater, 300 ml vatten och kryddor och koka.', tm: { time: '15 min', temp: '100°C', speed: 'Motsols 1' } },
        { text: 'Servera med ris.' },
      ],
    },
    [],
  ],
  [
    {
      title: 'Nuggetstallrik med sötpotatispommes',
      description: 'Fredagsräddaren. Allt från frysen.',
      source_type: 'own',
      servings: 3,
      time_min: 25,
      tags: ['barn', 'ugn', 'snabbt'],
      ingredients: [
        { text: '1 förp. veganska dinonuggets', qty: 1 },
        { text: '1 förp. sötpotatispommes', qty: 1 },
        { text: '1 burk majs', qty: 1 },
        { text: 'Ketchup', pantry: true },
      ],
      steps: [{ text: 'Sätt ugnen på 200 °C, grädda nuggets och pommes enligt förpackningen (ca 20 min) och värm majsen.' }],
    },
    [9],
  ],
];
