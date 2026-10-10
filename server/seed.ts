import { config } from './config.js';
import { db, getSetting, setSetting } from './db.js';
import { adjustStock, createProduct } from './lib/catalog.js';
import { hashPassword, randomToken } from './lib/auth.js';
import { saveRecipe } from './lib/recipes.js';

const LOCATIONS = [
  { name: 'Kühlschrank', kind: 'fridge', icon: 'refrigerator' },
  { name: 'Gefrierschrank', kind: 'freezer', icon: 'snowflake' },
  { name: 'Vorratsschrank', kind: 'pantry', icon: 'archive' },
  { name: 'Keller', kind: 'cellar', icon: 'warehouse' },
  { name: 'Küche', kind: 'kitchen', icon: 'cooking-pot' },
  { name: 'Bad', kind: 'bathroom', icon: 'bath' },
  { name: 'Hauswirtschaftsraum', kind: 'utility', icon: 'washing-machine' },
];

const CATEGORIES: { name: string; icon: string; loc: string; track: 'count' | 'level' | 'none' }[] = [
  { name: 'Eis', icon: 'ice-cream-cone', loc: 'Gefrierschrank', track: 'count' },
  { name: 'Tiefkühl', icon: 'snowflake', loc: 'Gefrierschrank', track: 'count' },
  { name: 'Getränke', icon: 'cup-soda', loc: 'Keller', track: 'count' },
  { name: 'Kühlregal', icon: 'milk', loc: 'Kühlschrank', track: 'count' },
  { name: 'Obst & Gemüse', icon: 'apple', loc: 'Küche', track: 'level' },
  { name: 'Brot & Backwaren', icon: 'croissant', loc: 'Küche', track: 'level' },
  { name: 'Vorrat', icon: 'wheat', loc: 'Vorratsschrank', track: 'count' },
  { name: 'Snacks & Süßes', icon: 'cookie', loc: 'Vorratsschrank', track: 'count' },
  { name: 'Drogerie', icon: 'sparkles', loc: 'Bad', track: 'count' },
  { name: 'Haushalt', icon: 'package', loc: 'Hauswirtschaftsraum', track: 'count' },
  { name: 'Bar & Kaffee', icon: 'coffee', loc: 'Küche', track: 'none' },
];

export function ensureBaseData() {
  if ((db.prepare('SELECT COUNT(*) n FROM locations').get() as { n: number }).n === 0) {
    const ins = db.prepare('INSERT INTO locations (name, kind, icon, sort) VALUES (?, ?, ?, ?)');
    LOCATIONS.forEach((l, i) => ins.run(l.name, l.kind, l.icon, i));
  }
  if ((db.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n === 0) {
    const loc = (n: string) => (db.prepare('SELECT id FROM locations WHERE name = ?').get(n) as { id: number } | undefined)?.id ?? null;
    const ins = db.prepare('INSERT INTO categories (name, icon, default_location_id, track_mode, sort) VALUES (?, ?, ?, ?, ?)');
    CATEGORIES.forEach((c, i) => ins.run(c.name, c.icon, loc(c.loc), c.track, i));
  }
  if ((db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n === 0) {
    const pw = config.adminPassword || randomToken(9);
    db.prepare(`INSERT INTO users (name, role, password_hash, color) VALUES (?, 'admin', ?, '#2f5bea')`).run(config.adminName, hashPassword(pw));
    if (!config.adminPassword) console.log(`\n  Stockwerk: Admin "${config.adminName}" angelegt, Passwort: ${pw}\n`);
  }
  if (!getSetting('household.name', null)) setSetting('household.name', 'Unser Zuhause');
}

const cat = (name: string) => (db.prepare('SELECT id FROM categories WHERE name = ?').get(name) as { id: number }).id;
const loc = (name: string) => (db.prepare('SELECT id FROM locations WHERE name = ?').get(name) as { id: number }).id;

const COFFEE_OPTIONS = [
  { group: 'Milch', choices: ['Normal', 'Laktosefrei', 'Hafer'], multi: false },
  { group: 'Koffein', choices: ['Normal', 'Entkoffeiniert'], multi: false },
  { group: 'Aroma', choices: ['Keins', 'Vanille', 'Karamell'], multi: false },
];

type DemoItem = [name: string, brand: string | null, size: string | null, category: string, qty: number, min: number, opts?: Record<string, unknown>];

const DEMO: DemoItem[] = [
  // Fredirando-Bar (die alten Demo-Daten: Getränke, Eis, Snacks, Extern)
  ['Cappuccino', null, null, 'Bar & Kaffee', 0, 0, { orderable: true, order_group: 'Getränke', options: COFFEE_OPTIONS, unit: 'Tasse' }],
  ['Latte Macchiato', null, null, 'Bar & Kaffee', 0, 0, { orderable: true, order_group: 'Getränke', options: COFFEE_OPTIONS, unit: 'Glas' }],
  ['Espresso', null, null, 'Bar & Kaffee', 0, 0, { orderable: true, order_group: 'Getränke', options: [COFFEE_OPTIONS[1]], unit: 'Tasse' }],
  ['Pizza (Wunsch in Notiz)', null, null, 'Bar & Kaffee', 0, 0, { orderable: true, order_group: 'Extern', unit: 'Bestellung' }],
  ['Vanille-Eis', 'Langnese', '900ml', 'Eis', 8, 2, { orderable: true, order_group: 'Eis', options: [{ group: 'Toppings', choices: ['Streusel', 'Schokosauce', 'Nüsse'], multi: true }], unit: 'Kugel' }],
  ['Schoko-Eis', 'Langnese', '900ml', 'Eis', 6, 2, { orderable: true, order_group: 'Eis', options: [{ group: 'Toppings', choices: ['Streusel', 'Schokosauce', 'Nüsse'], multi: true }], unit: 'Kugel' }],
  ['Erdbeer-Eis', 'Langnese', '900ml', 'Eis', 0, 2, { orderable: true, order_group: 'Eis', unit: 'Kugel' }],
  ['Cremissimo Stracciatella', 'Langnese', '1300ml', 'Eis', 1, 1],
  ['Frikadelle', null, null, 'Kühlregal', 4, 2, { orderable: true, order_group: 'Snacks', options: [{ group: 'Saucen', choices: ['Senf', 'Ketchup', 'Mayo'], multi: true }] }],
  ['Chips Paprika', 'Funny-frisch', '175g', 'Snacks & Süßes', 3, 1, { orderable: true, order_group: 'Snacks', unit: 'Tüte' }],
  ['Milchmäuse', 'Choceur', '210g', 'Snacks & Süßes', 2, 1, { orderable: true, order_group: 'Snacks', unit: 'Packung' }],
  // Getränke im Keller
  ['Mio Mio Mate', 'Mio Mio', '0,5l', 'Getränke', 7, 4, { orderable: true, order_group: 'Getränke', unit: 'Flasche' }],
  ['Mio Mio Cola', 'Mio Mio', '0,5l', 'Getränke', 3, 4, { orderable: true, order_group: 'Getränke', unit: 'Flasche' }],
  ['Mildes Frühstück Multivitamin', 'Valensina', '1l', 'Getränke', 5, 2, { unit: 'Flasche' }],
  ['Mineralwasser Medium', 'Gerolsteiner', '0,75l', 'Getränke', 11, 6, { orderable: true, order_group: 'Getränke', unit: 'Flasche' }],
  ['Fritz-Kola', 'Fritz-Kola', '0,33l', 'Getränke', 0, 0, { orderable: true, order_group: 'Getränke', unit: 'Flasche' }],
  // Tiefkühl
  ['Vegane Dino Nuggets', 'REWE Beste Wahl', '300g', 'Tiefkühl', 2, 1],
  ['Süsskartoffel Pommes', 'REWE Beste Wahl', '500g', 'Tiefkühl', 1, 1],
  ['Curly Fries pikant', 'ja!', '600g', 'Tiefkühl', 1, 0],
  ['Rahmspinat', 'Iglo', '750g', 'Tiefkühl', 1, 1],
  ['Erbsen', 'ja!', '750g', 'Tiefkühl', 2, 1],
  ['Mini Pizza Pomodori vegan', 'REWE Beste Wahl', '360g', 'Tiefkühl', 0, 1],
  ['6-Kräuter', 'REWE Bio', '50g', 'Tiefkühl', 1, 0],
  // Kühlschrank
  ['Eier Freilandhaltung', 'Cassenshof', '10 Stück', 'Kühlregal', 6, 4, { unit: 'Stk' }],
  ['Butter', 'Kerrygold', '250g', 'Kühlregal', 1, 1],
  ['Mozzarella', 'ja!', '125g', 'Kühlregal', 2, 1],
  ['Feta', 'REWE Bio', '200g', 'Kühlregal', 1, 0],
  ['Fruchtzwerge weniger süß', 'Danone', '6x50g', 'Kühlregal', 1, 1, { unit: 'Pack' }],
  ['Kochcreme 15%', 'REWE', '250ml', 'Kühlregal', 1, 1],
  ['Cheddar Scheiben', 'Violife', '140g', 'Kühlregal', 1, 0],
  ['Veganer Schinken Spicker Mortadella', 'Rügenwalder Mühle', '80g', 'Kühlregal', 1, 0],
  // Vorrat
  ['Gnocchi', 'Delverde', '500g', 'Vorrat', 2, 1],
  ['Spaghetti', 'Barilla', '500g', 'Vorrat', 3, 2],
  ['Eliche Tricolore', 'Delverde', '500g', 'Vorrat', 1, 0],
  ['Basmati Reis', 'ja!', '1kg', 'Vorrat', 1, 1],
  ['Rote Linsen', 'REWE Bio', '500g', 'Vorrat', 1, 0],
  ['Stückige Tomaten', 'REWE', '400g', 'Vorrat', 4, 2, { unit: 'Dose' }],
  ['Kokosmilch', 'REWE Beste Wahl', '400ml', 'Vorrat', 2, 1, { unit: 'Dose' }],
  ['Haferflocken', 'Kölln', '500g', 'Vorrat', 1, 1],
  ['Sonnenmais Supersweet', 'REWE Beste Wahl', '140g', 'Vorrat', 2, 0, { unit: 'Dose' }],
  ['Sesamöl Nativ', 'REWE Bio', '250ml', 'Vorrat', 1, 0, { unit: 'Flasche' }],
  ['Burger Gewürz', 'REWE Beste Wahl', '41g', 'Vorrat', 1, 0],
  ['Pom-Bär Ketchup Style', 'Funny-frisch', '75g', 'Snacks & Süßes', 1, 0, { unit: 'Tüte' }],
  // Obst & Gemüse (nur grob: voll / halb / knapp / leer)
  ['Bananen', null, null, 'Obst & Gemüse', 3, 1],
  ['Snack-Äpfel', 'REWE Beste Wahl', '1kg', 'Obst & Gemüse', 2, 1],
  ['Süßkartoffeln', null, null, 'Obst & Gemüse', 1, 1],
  ['Paprika', null, null, 'Obst & Gemüse', 2, 0],
  ['Zucchini', null, null, 'Obst & Gemüse', 1, 0],
  ['Kartoffeln', null, '2kg', 'Obst & Gemüse', 3, 1],
  ['Zwiebeln', null, null, 'Obst & Gemüse', 1, 1],
  ['Vollkornsandwich', 'REWE Bio', '750g', 'Brot & Backwaren', 2, 1],
  // Haushalt & Drogerie
  ['Paketband', 'tesa', '66m x 50mm', 'Haushalt', 0, 1, { unit: 'Rolle' }],
  ['Müllbeutel 35l', 'ja!', '25 Stück', 'Haushalt', 1, 1, { unit: 'Rolle' }],
  ['Spülmaschinen-Tabs', 'Finish', '50 Stück', 'Haushalt', 1, 1, { unit: 'Packung' }],
  ['Toilettenpapier', 'Hakle', '8 Rollen', 'Haushalt', 2, 1, { unit: 'Packung' }],
  ['Küchenrolle', 'Zewa', '4 Rollen', 'Haushalt', 1, 1, { unit: 'Packung' }],
  ['Waschmittel Megaperls', 'Persil', '1,04kg', 'Haushalt', 1, 1, { unit: 'Packung' }],
  ['Batterien AA', 'Varta', '8 Stück', 'Haushalt', 0, 0, { unit: 'Packung' }],
  ['Zahnpasta', 'elmex', '75ml', 'Drogerie', 2, 1, { unit: 'Tube' }],
  ['Slipeinlagen Daily Protect', 'Always', '40 Stück', 'Drogerie', 1, 1, { unit: 'Packung' }],
];

function addDays(d: number) {
  return new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
}

export function seedDemo() {
  if (getSetting('demo.seeded', false)) return;
  if ((db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n > 0) return;
  const ids = new Map<string, number>();
  for (const [name, brand, size, category, qty, min, o = {}] of DEMO) {
    const id = createProduct({
      name,
      brand,
      size,
      categoryId: cat(category),
      minQty: min,
      unit: (o.unit as string) ?? 'Stk',
      orderable: Boolean(o.orderable),
      orderGroup: (o.order_group as string) ?? null,
      orderOptions: (o.options as unknown[]) ?? undefined,
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
  db.prepare(`UPDATE products SET is_staple = 1 WHERE name IN ('Zwiebeln')`).run();
  // shopping list
  const shop = db.prepare('INSERT INTO shopping_items (product_id, text, source, added_by) VALUES (?, ?, ?, ?)');
  shop.run(ids.get('Paketband'), 'Paketband', 'manual', 'Till');
  shop.run(ids.get('Erdbeer-Eis'), 'Erdbeer-Eis', 'auto', 'Stockwerk');
  shop.run(ids.get('Mini Pizza Pomodori vegan'), 'Mini Pizza Pomodori vegan', 'auto', 'Stockwerk');
  shop.run(null, 'Geschenkpapier', 'manual', 'Lea');
  seedRecipes();
  db.prepare(`INSERT INTO guest_links (token, name, scopes, expires_at) VALUES (?, 'Grillabend', '["bar"]', datetime('now', '+30 days'))`).run(
    randomToken(12),
  );
  setSetting('demo.seeded', true);
}

function seedRecipes() {
  const R = (r: Parameters<typeof saveRecipe>[0], cookedDaysAgo?: number[]) => {
    const id = saveRecipe(r);
    for (const d of cookedDaysAgo ?? [])
      db.prepare(`INSERT INTO cook_log (recipe_id, cooked_at, actor) VALUES (?, datetime('now', ?), 'Demo')`).run(id, `-${d} days`);
  };
  R(
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
  );
  R(
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
  );
  R(
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
  );
  R(
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
  );
  R(
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
  );
  R(
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
  );
  R(
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
  );
  R(
    {
      title: 'Nuggets-Teller mit Süßkartoffel-Pommes',
      description: 'Der Freitags-Retter. Alles aus dem Gefrierschrank.',
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
  );
}
