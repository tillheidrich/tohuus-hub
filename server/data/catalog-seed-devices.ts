/**
 * ToHuus-Rezepte for kitchen machines (13 Oct 2026): four each for Thermomix, Monsieur Cuisine (Lidl) and Bosch
 * Cookit. Written for ToHuus from scratch with AI assistance – no texts from Cookidoo, the Monsieur Cuisine app or Home
 * Connect – so they start as Plus drafts like catalog-seed-plus.ts: the operator reads them and checks the settings on
 * the real machine before publishing. Steps carry the appliance settings (`tohuus` on a HowToStep, docs/recipe-package.md).
 *
 * Settings follow the usual ranges of each machine (Thermomix TM6/TM7: Stufe 1–10, up to 120 °C, Varoma, Linkslauf;
 * Monsieur Cuisine Smart: Stufe 1–10, up to 130 °C, Linkslauf; Cookit: up to 200 °C, Universalmesser or 3D-Rührer with
 * Stufe 1–7). Names of the machines are trademarks of their makers; ToHuus is not connected with them.
 */
import type { PlusSeedRecipe } from './catalog-seed-plus.js';

export interface DeviceStep {
  text: string;
  time?: string;
  temp?: string;
  speed?: string;
  mode?: string;
  /** another appliance for this step (e.g. "Backofen"); default the recipe's machine */
  device?: string;
}

export interface DeviceSeedRecipe extends Omit<PlusSeedRecipe, 'steps'> {
  /** the kitchen machine (also tag and `tohuus.devices`) */
  machine: 'Thermomix' | 'Monsieur Cuisine' | 'Cookit';
  steps: (string | DeviceStep)[];
}

export const CATALOG_SEED_DEVICES: DeviceSeedRecipe[] = [
  // ------------------------------------------------------------------ Thermomix
  {
    machine: 'Thermomix',
    title: 'Kürbisrisotto aus dem Thermomix',
    description: 'Ohne ständiges Rühren: Der Thermomix macht das Risotto cremig, du reibst nur den Käse.',
    servings: 4,
    minutes: 35,
    tags: ['vegetarisch', 'Hauptgericht', 'Herbst', 'Thermomix'],
    ingredients: ['60|g|Parmesan|in Stücken', '1||Zwiebel|halbiert', '1||Knoblauchzehe|', '30|g|Butter|', '300|g|Hokkaido-Kürbis|in Stücken', '300|g|Risottoreis|', '100|ml|Weißwein|oder Brühe', '800|ml|Gemüsebrühe|', '||Salz und Pfeffer|'],
    steps: [
      { text: 'Parmesan in den Mixtopf geben, zerkleinern und umfüllen.', time: '10 Sek.', speed: '10' },
      { text: 'Zwiebel, Knoblauch und Kürbis in den Mixtopf geben und zerkleinern, mit dem Spatel nach unten schieben.', time: '5 Sek.', speed: '5' },
      { text: 'Butter zugeben und andünsten.', time: '3 Min.', temp: '120 °C', speed: '1' },
      { text: 'Reis zugeben und ohne Messbecher mitdünsten.', time: '2 Min.', temp: '120 °C', speed: '1', mode: 'Linkslauf' },
      { text: 'Wein zugeben und ohne Messbecher ablöschen.', time: '1 Min.', temp: '120 °C', speed: '1', mode: 'Linkslauf' },
      { text: 'Brühe zugeben, Garkörbchen statt Messbecher auf den Deckel setzen und garen.', time: '15 Min.', temp: '100 °C', speed: '1', mode: 'Linkslauf' },
      'Parmesan unterrühren, mit Salz und Pfeffer abschmecken und 2 Minuten im Mixtopf ziehen lassen.',
    ],
    canva: 'MAHX5-42Go4',
  },
  {
    machine: 'Thermomix',
    title: 'Möhren-Ingwer-Suppe aus dem Thermomix',
    description: 'Fünf Zutaten, eine halbe Stunde, fein püriert ohne Pürierstab.',
    servings: 4,
    minutes: 30,
    tags: ['vegan', 'Suppe', 'schnell', 'Thermomix'],
    ingredients: ['1||Zwiebel|halbiert', '1|Stück|Ingwer|daumengroß', '1|EL|Öl|', '600|g|Möhren|in Stücken', '200|g|Kartoffeln|in Stücken', '900|ml|Gemüsebrühe|', '200|ml|Kokosmilch|', '||Salz und Pfeffer|'],
    steps: [
      { text: 'Zwiebel und Ingwer in den Mixtopf geben und zerkleinern.', time: '5 Sek.', speed: '5' },
      { text: 'Öl zugeben und andünsten.', time: '3 Min.', temp: '120 °C', speed: '1' },
      { text: 'Möhren und Kartoffeln zugeben und zerkleinern.', time: '5 Sek.', speed: '5' },
      { text: 'Brühe zugeben und garen.', time: '20 Min.', temp: '100 °C', speed: '1' },
      { text: 'Kokosmilch zugeben und langsam ansteigend pürieren.', time: '1 Min.', speed: '5–10' },
      'Mit Salz und Pfeffer abschmecken.',
    ],
    canva: 'MAHX565zdyY',
  },
  {
    machine: 'Thermomix',
    title: 'Blechpizza mit Thermomix-Teig',
    description: 'Den Teig knetet der Thermomix, den Belag sucht ihr euch aus dem Kühlschrank zusammen.',
    servings: 4,
    minutes: 90,
    tags: ['vegetarisch', 'Kinder', 'Backen', 'Thermomix', 'Reste'],
    ingredients: ['300|ml|Wasser|lauwarm', '1/2|Würfel|Hefe|21 g', '1|TL|Zucker|', '500|g|Mehl|Type 550', '2|EL|Olivenöl|', '1|TL|Salz|', '1|Dose|passierte Tomaten|400 g', '1|TL|Oregano|', '200|g|Mozzarella|gerieben', '300|g|Belag|was da ist: Paprika, Pilze, Schinken, Mais'],
    steps: [
      { text: 'Wasser, Hefe und Zucker in den Mixtopf geben und erwärmen.', time: '2 Min.', temp: '37 °C', speed: '2' },
      { text: 'Mehl, Öl und Salz zugeben und kneten.', time: '2 Min.', mode: 'Teigknetstufe' },
      'Teig in eine Schüssel geben und abgedeckt 45 Minuten gehen lassen, bis er sich sichtbar vergrößert hat.',
      'Tomaten mit Oregano und etwas Salz verrühren. Belag klein schneiden.',
      'Teig auf einem Blech mit Backpapier dünn ausrollen, mit Tomatensoße bestreichen, belegen und mit Käse bestreuen.',
      { text: 'Backen, bis der Rand goldbraun ist.', device: 'Backofen', time: '15–18 Min.', temp: '230 °C', mode: 'Ober-/Unterhitze, unterste Schiene' },
    ],
    canva: 'MAHX5_YkMQE',
  },
  {
    machine: 'Thermomix',
    title: 'Linsen-Bolognese aus dem Thermomix',
    description: 'Bolognese ohne Fleisch, mit roten Linsen und viel Gemüse. Kinder merken es oft gar nicht.',
    servings: 4,
    minutes: 35,
    tags: ['vegan', 'Hauptgericht', 'Kinder', 'Vorrat', 'Thermomix'],
    ingredients: ['1||Zwiebel|halbiert', '1||Knoblauchzehe|', '1||Möhre|in Stücken', '1/2||Zucchini|in Stücken', '2|EL|Olivenöl|', '2|EL|Tomatenmark|', '120|g|rote Linsen|', '1|Dose|stückige Tomaten|400 g', '300|ml|Gemüsebrühe|', '1|TL|italienische Kräuter|', '||Salz und Pfeffer|', '400|g|Spaghetti|'],
    steps: [
      { text: 'Zwiebel, Knoblauch, Möhre und Zucchini in den Mixtopf geben und zerkleinern, nach unten schieben.', time: '5 Sek.', speed: '5' },
      { text: 'Öl und Tomatenmark zugeben und andünsten.', time: '4 Min.', temp: '120 °C', speed: '1' },
      { text: 'Linsen, Tomaten, Brühe und Kräuter zugeben und garen, Garkörbchen statt Messbecher aufsetzen.', time: '20 Min.', temp: '100 °C', speed: '1', mode: 'Linkslauf' },
      'Inzwischen die Spaghetti in einem Topf in Salzwasser bissfest kochen.',
      'Soße mit Salz und Pfeffer abschmecken und mit den Nudeln servieren.',
    ],
    canva: 'MAHX53DxLeo',
  },

  // ------------------------------------------------------------------ Monsieur Cuisine (Lidl)
  {
    machine: 'Monsieur Cuisine',
    title: 'Kartoffel-Lauch-Suppe aus dem Monsieur Cuisine',
    description: 'Cremig ohne Sahne, weil ein Teil der Kartoffeln mitpüriert wird.',
    servings: 4,
    minutes: 35,
    tags: ['vegetarisch', 'Suppe', 'Monsieur Cuisine'],
    ingredients: ['1||Zwiebel|halbiert', '1||Lauchstange|in Ringen', '20|g|Butter|', '600|g|Kartoffeln|mehligkochend, in Stücken', '900|ml|Gemüsebrühe|', '100|g|Schmand|', '||Salz, Pfeffer, Muskat|', '||Schnittlauch|zum Bestreuen'],
    steps: [
      { text: 'Zwiebel in den Mixbehälter geben und zerkleinern.', time: '5 Sek.', speed: '5' },
      { text: 'Butter und Lauch zugeben und andünsten.', time: '4 Min.', temp: '120 °C', speed: '1' },
      { text: 'Kartoffeln und Brühe zugeben und garen.', time: '20 Min.', temp: '100 °C', speed: '1' },
      { text: 'Schmand zugeben und pürieren.', time: '40 Sek.', speed: '8' },
      'Mit Salz, Pfeffer und Muskat abschmecken und mit Schnittlauch servieren.',
    ],
    canva: 'MAHX57q7VGA',
  },
  {
    machine: 'Monsieur Cuisine',
    title: 'Milchreis mit Kirschen aus dem Monsieur Cuisine',
    description: 'Kein Anbrennen, kein Rühren am Herd. Mit Kirschen aus dem Glas oder Zimt und Zucker.',
    servings: 4,
    minutes: 40,
    tags: ['vegetarisch', 'süß', 'Kinder', 'Vorrat', 'Monsieur Cuisine'],
    ingredients: ['1|l|Milch|', '200|g|Milchreis|', '50|g|Zucker|', '1|Prise|Salz|', '1|Päckchen|Vanillezucker|', '1|Glas|Sauerkirschen|abgetropft etwa 350 g', '1|EL|Speisestärke|'],
    steps: [
      { text: 'Milch, Milchreis, Zucker, Salz und Vanillezucker in den Mixbehälter geben und garen.', time: '35 Min.', temp: '90 °C', speed: '1', mode: 'Linkslauf' },
      'Kirschen abtropfen lassen, den Saft auffangen. 4 EL Saft mit der Stärke verrühren.',
      'Restlichen Saft in einem kleinen Topf aufkochen, Stärke einrühren, kurz köcheln und die Kirschen unterheben.',
      'Milchreis 5 Minuten ruhen lassen, dann mit den Kirschen servieren.',
    ],
    canva: 'MAHX5yPeM3o',
  },
  {
    machine: 'Monsieur Cuisine',
    title: 'Hummus mit Gemüsesticks aus dem Monsieur Cuisine',
    description: 'Aus einer Dose Kichererbsen in fünf Minuten. Hält sich drei Tage im Kühlschrank.',
    servings: 4,
    minutes: 10,
    tags: ['vegan', 'Snack', 'schnell', 'Vorrat', 'Monsieur Cuisine'],
    ingredients: ['1||Knoblauchzehe|', '1|Dose|Kichererbsen|400 g, abgetropft, 3 EL Wasser aufheben', '3|EL|Tahin|', '2|EL|Zitronensaft|', '3|EL|Olivenöl|', '1/2|TL|Kreuzkümmel|', '||Salz|', '3||Möhren|', '1||Paprika|', '1/2||Gurke|'],
    steps: [
      { text: 'Knoblauch in den Mixbehälter geben und zerkleinern.', time: '5 Sek.', speed: '8' },
      { text: 'Kichererbsen, Tahin, Zitronensaft, Öl, Kreuzkümmel, Salz und das aufgehobene Wasser zugeben und fein pürieren, zwischendurch nach unten schieben.', time: '1 Min.', speed: '7' },
      'Abschmecken und bei Bedarf mit etwas Wasser cremiger machen.',
      'Gemüse in Sticks schneiden und mit dem Hummus servieren.',
    ],
    canva: 'MAHX56l8pII',
  },
  {
    machine: 'Monsieur Cuisine',
    title: 'Chili con Carne aus dem Monsieur Cuisine',
    description: 'Ein Topf, große Menge. Die Hälfte lässt sich gut einfrieren.',
    servings: 6,
    minutes: 45,
    tags: ['Hauptgericht', 'zwei Tage', 'Monsieur Cuisine'],
    ingredients: ['1||Zwiebel|halbiert', '2||Knoblauchzehen|', '1||rote Paprika|in Stücken', '2|EL|Öl|', '400|g|Rinderhackfleisch|', '2|EL|Tomatenmark|', '1|TL|Paprikapulver|', '1|TL|Kreuzkümmel|', '1|Prise|Chiliflocken|', '1|Dose|stückige Tomaten|400 g', '1|Dose|Kidneybohnen|abgespült', '1|Dose|Mais|abgetropft', '200|ml|Rinderbrühe|', '||Salz|'],
    steps: [
      { text: 'Zwiebel, Knoblauch und Paprika in den Mixbehälter geben und zerkleinern, nach unten schieben.', time: '5 Sek.', speed: '5' },
      { text: 'Öl zugeben und andünsten.', time: '3 Min.', temp: '120 °C', speed: '1' },
      { text: 'Hackfleisch zugeben und anbraten, dabei wird es zerteilt.', time: '6 Min.', temp: '130 °C', speed: '1', mode: 'Linkslauf' },
      { text: 'Tomatenmark, Gewürze, Tomaten, Bohnen, Mais und Brühe zugeben und ohne Messbecher garen.', time: '20 Min.', temp: '100 °C', speed: '1', mode: 'Linkslauf' },
      'Prüfen, dass das Hackfleisch durchgegart ist: nirgends mehr rosa. Mit Salz abschmecken.',
    ],
    canva: 'MAHX5w4J1Ik',
  },

  // ------------------------------------------------------------------ Bosch Cookit
  {
    machine: 'Cookit',
    title: 'Hähnchen-Geschnetzeltes mit Champignons aus dem Cookit',
    description: 'Der Cookit brät scharf an wie eine Pfanne. Dazu Reis oder Nudeln.',
    servings: 4,
    minutes: 35,
    tags: ['Hauptgericht', 'Cookit'],
    ingredients: ['600|g|Hähnchenbrust|in Streifen', '1||Zwiebel|in Würfeln', '250|g|Champignons|in Scheiben', '2|EL|Öl|', '1|EL|Mehl|', '200|ml|Hühnerbrühe|', '150|g|Sahne|', '1|TL|Senf|', '||Salz und Pfeffer|', '||Petersilie|'],
    steps: [
      { text: 'Öl in den Topf geben, Hähnchenstreifen zugeben und rundum anbraten.', time: '6 Min.', temp: '180 °C', speed: '2', mode: '3D-Rührer' },
      { text: 'Zwiebel und Champignons zugeben und mitbraten.', time: '5 Min.', temp: '160 °C', speed: '2', mode: '3D-Rührer' },
      { text: 'Mehl darüberstäuben, Brühe, Sahne und Senf zugeben und köcheln.', time: '8 Min.', temp: '100 °C', speed: '1', mode: '3D-Rührer' },
      'Prüfen, dass das Hähnchen durchgegart ist: innen nicht mehr rosa. Mit Salz, Pfeffer und Petersilie abschmecken.',
    ],
    canva: 'MAHX57a45vk',
  },
  {
    machine: 'Cookit',
    title: 'One-Pot-Pasta mit Gemüse aus dem Cookit',
    description: 'Nudeln, Gemüse und Soße garen zusammen im Topf. Danach ist nur ein Topf zu spülen.',
    servings: 4,
    minutes: 25,
    tags: ['vegetarisch', 'Hauptgericht', 'schnell', 'Kinder', 'Cookit'],
    ingredients: ['1||Zwiebel|in Würfeln', '1||Knoblauchzehe|gehackt', '2|EL|Olivenöl|', '1||Zucchini|in Würfeln', '1||Paprika|in Würfeln', '250|g|Kirschtomaten|halbiert', '400|g|Fusilli|', '900|ml|Gemüsebrühe|', '100|g|Frischkäse|', '||Salz und Pfeffer|', '||Basilikum|'],
    steps: [
      { text: 'Öl, Zwiebel und Knoblauch in den Topf geben und andünsten.', time: '3 Min.', temp: '140 °C', speed: '2', mode: '3D-Rührer' },
      { text: 'Zucchini und Paprika zugeben und mitdünsten.', time: '3 Min.', temp: '140 °C', speed: '2', mode: '3D-Rührer' },
      { text: 'Nudeln, Tomaten und Brühe zugeben und garen, bis die Nudeln bissfest sind und die Brühe fast aufgesogen ist.', time: '12 Min.', temp: '100 °C', speed: '1', mode: '3D-Rührer' },
      'Frischkäse unterrühren, mit Salz und Pfeffer abschmecken und mit Basilikum servieren.',
    ],
    canva: 'MAHX51B9Pw4',
  },
  {
    machine: 'Cookit',
    title: 'Grießbrei mit Apfelkompott aus dem Cookit',
    description: 'Warm, süß, schnell. Das Kompott kocht nebenher im kleinen Topf.',
    servings: 4,
    minutes: 20,
    tags: ['vegetarisch', 'süß', 'Kinder', 'Vorrat', 'Cookit'],
    ingredients: ['800|ml|Milch|', '60|g|Zucker|', '1|Päckchen|Vanillezucker|', '1|Prise|Salz|', '100|g|Weichweizengrieß|', '3||Äpfel|', '1|EL|Zitronensaft|', '1|TL|Zimt|', '50|ml|Wasser|'],
    steps: [
      { text: 'Milch, Zucker, Vanillezucker und Salz in den Topf geben und aufkochen.', time: '8 Min.', temp: '95 °C', speed: '2', mode: '3D-Rührer' },
      { text: 'Grieß einrieseln lassen und quellen lassen.', time: '5 Min.', temp: '90 °C', speed: '3', mode: '3D-Rührer' },
      'Inzwischen Äpfel schälen, würfeln und mit Zitronensaft, Zimt und Wasser in einem kleinen Topf 8 Minuten weich köcheln.',
      'Grießbrei mit dem warmen Kompott servieren.',
    ],
    canva: 'MAHX54VKjOM',
  },
  {
    machine: 'Cookit',
    title: 'Linsencurry mit Spinat aus dem Cookit',
    description: 'Würzig, mild genug für Kinder, und mit TK-Spinat aus dem Vorrat.',
    servings: 4,
    minutes: 35,
    tags: ['vegan', 'Hauptgericht', 'Vorrat', 'Cookit'],
    ingredients: ['1||Zwiebel|', '2||Knoblauchzehen|', '1|Stück|Ingwer|daumengroß', '2|EL|Öl|', '2|TL|Currypulver|', '200|g|rote Linsen|', '1|Dose|stückige Tomaten|400 g', '400|ml|Kokosmilch|', '400|ml|Gemüsebrühe|', '200|g|Blattspinat|TK', '||Salz|', '250|g|Basmatireis|'],
    steps: [
      { text: 'Zwiebel, Knoblauch und Ingwer in den Topf geben und zerkleinern.', time: '6 Sek.', speed: '5', mode: 'Universalmesser' },
      { text: 'Messer gegen den 3D-Rührer tauschen, Öl und Currypulver zugeben und andünsten.', time: '3 Min.', temp: '140 °C', speed: '2', mode: '3D-Rührer' },
      { text: 'Linsen, Tomaten, Kokosmilch und Brühe zugeben und köcheln.', time: '15 Min.', temp: '100 °C', speed: '1', mode: '3D-Rührer' },
      { text: 'Spinat zugeben und weiterköcheln, bis er heiß ist.', time: '5 Min.', temp: '100 °C', speed: '1', mode: '3D-Rührer' },
      'Inzwischen Reis nach Packungsangabe kochen. Curry mit Salz abschmecken und mit Reis servieren.',
    ],
    canva: 'MAHX50PuHzA',
  },
];
