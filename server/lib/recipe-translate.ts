/**
 * English recipe lines → the household language (area: recipes2).
 *
 * A small built-in dictionary of common ingredients (no cloud translation) plus measure conversion:
 * cups / oz / lb / fl oz / pints → g / ml when the household region uses metric units; spoons become
 * EL/TL (German). The original English line is always kept next to the translation.
 */

type Target = 'de';

// en | de  (singular forms; plurals are handled by the matcher)
const DICT_SRC = `
all-purpose flour|Weizenmehl
plain flour|Weizenmehl
self-raising flour|Mehl mit Backpulver
self raising flour|Mehl mit Backpulver
bread flour|Brotmehl
wholemeal flour|Vollkornmehl
whole wheat flour|Vollkornmehl
cornflour|Speisestärke
cornstarch|Speisestärke
flour|Mehl
caster sugar|feiner Zucker
granulated sugar|Zucker
brown sugar|brauner Zucker
dark brown sugar|dunkler brauner Zucker
light brown sugar|heller brauner Zucker
icing sugar|Puderzucker
powdered sugar|Puderzucker
demerara sugar|Rohrzucker
muscovado sugar|Muscovado-Zucker
sugar|Zucker
honey|Honig
maple syrup|Ahornsirup
golden syrup|Zuckersirup
treacle|Melasse
molasses|Melasse
baking powder|Backpulver
baking soda|Natron
bicarbonate of soda|Natron
yeast|Hefe
dried yeast|Trockenhefe
vanilla extract|Vanilleextrakt
vanilla essence|Vanillearoma
vanilla|Vanille
cocoa powder|Kakaopulver
cocoa|Kakao
dark chocolate|Zartbitterschokolade
milk chocolate|Vollmilchschokolade
white chocolate|weiße Schokolade
chocolate chips|Schokotropfen
chocolate|Schokolade
salt|Salz
sea salt|Meersalz
black pepper|schwarzer Pfeffer
pepper|Pfeffer
white pepper|weißer Pfeffer
butter|Butter
unsalted butter|ungesalzene Butter
salted butter|gesalzene Butter
margarine|Margarine
olive oil|Olivenöl
extra virgin olive oil|natives Olivenöl extra
vegetable oil|Pflanzenöl
sunflower oil|Sonnenblumenöl
rapeseed oil|Rapsöl
canola oil|Rapsöl
sesame oil|Sesamöl
coconut oil|Kokosöl
oil|Öl
milk|Milch
whole milk|Vollmilch
skimmed milk|Magermilch
semi-skimmed milk|fettarme Milch
buttermilk|Buttermilch
coconut milk|Kokosmilch
almond milk|Mandelmilch
oat milk|Haferdrink
cream|Sahne
double cream|Schlagsahne
heavy cream|Schlagsahne
whipping cream|Schlagsahne
single cream|Kochsahne
sour cream|Saure Sahne
creme fraiche|Crème fraîche
crème fraîche|Crème fraîche
yogurt|Joghurt
yoghurt|Joghurt
greek yogurt|griechischer Joghurt
plain yogurt|Naturjoghurt
egg|Ei
eggs|Eier
onions|Zwiebeln
red onions|rote Zwiebeln
carrots|Karotten
potatoes|Kartoffeln
tomatoes|Tomaten
apples|Äpfel
lemons|Zitronen
limes|Limetten
shallots|Schalotten
bananas|Bananen
spring onions|Frühlingszwiebeln
garlic cloves|Knoblauchzehen
red peppers|rote Paprika
mushroom caps|Pilzköpfe
egg yolk|Eigelb
egg white|Eiweiß
free-range egg|Freilandei
cheese|Käse
cheddar cheese|Cheddar
cheddar|Cheddar
parmesan cheese|Parmesan
parmesan|Parmesan
mozzarella|Mozzarella
feta cheese|Feta
feta|Feta
cream cheese|Frischkäse
ricotta|Ricotta
mascarpone|Mascarpone
goat cheese|Ziegenkäse
gruyere|Gruyère
gruyère|Gruyère
cottage cheese|Hüttenkäse
halloumi|Halloumi
water|Wasser
cold water|kaltes Wasser
hot water|heißes Wasser
boiling water|kochendes Wasser
ice|Eis
chicken stock|Hühnerbrühe
chicken broth|Hühnerbrühe
beef stock|Rinderbrühe
beef broth|Rinderbrühe
vegetable stock|Gemüsebrühe
vegetable broth|Gemüsebrühe
stock cube|Brühwürfel
stock|Brühe
white wine|Weißwein
red wine|Rotwein
dry white wine|trockener Weißwein
beer|Bier
white wine vinegar|Weißweinessig
red wine vinegar|Rotweinessig
balsamic vinegar|Balsamico-Essig
cider vinegar|Apfelessig
apple cider vinegar|Apfelessig
rice vinegar|Reisessig
vinegar|Essig
soy sauce|Sojasauce
dark soy sauce|dunkle Sojasauce
light soy sauce|helle Sojasauce
fish sauce|Fischsauce
oyster sauce|Austernsauce
worcestershire sauce|Worcestersauce
hot sauce|scharfe Sauce
tabasco sauce|Tabasco
sriracha|Sriracha
tomato ketchup|Ketchup
ketchup|Ketchup
mayonnaise|Mayonnaise
mustard|Senf
dijon mustard|Dijon-Senf
english mustard|scharfer Senf
wholegrain mustard|grober Senf
tomato puree|Tomatenmark
tomato paste|Tomatenmark
passata|passierte Tomaten
chopped tomatoes|gehackte Tomaten
canned tomatoes|Dosentomaten
plum tomatoes|Eiertomaten
cherry tomatoes|Kirschtomaten
tomato|Tomate
sun-dried tomatoes|getrocknete Tomaten
onion|Zwiebel
red onion|rote Zwiebel
white onion|weiße Zwiebel
brown onion|Zwiebel
yellow onion|Zwiebel
spring onion|Frühlingszwiebel
green onion|Frühlingszwiebel
scallion|Frühlingszwiebel
shallot|Schalotte
leek|Lauch
garlic|Knoblauch
garlic clove|Knoblauchzehe
ginger|Ingwer
fresh ginger|frischer Ingwer
ground ginger|gemahlener Ingwer
chilli|Chili
chili|Chili
red chilli|rote Chili
green chilli|grüne Chili
chilli powder|Chilipulver
chili powder|Chilipulver
chilli flakes|Chiliflocken
red pepper flakes|Chiliflocken
cayenne pepper|Cayennepfeffer
paprika|Paprikapulver
smoked paprika|geräuchertes Paprikapulver
cumin|Kreuzkümmel
ground cumin|gemahlener Kreuzkümmel
cumin seeds|Kreuzkümmelsamen
coriander|Koriander
ground coriander|gemahlener Koriander
coriander leaves|Korianderblätter
cilantro|Koriander
turmeric|Kurkuma
garam masala|Garam Masala
curry powder|Currypulver
curry paste|Currypaste
red curry paste|rote Currypaste
green curry paste|grüne Currypaste
cinnamon|Zimt
ground cinnamon|gemahlener Zimt
cinnamon stick|Zimtstange
nutmeg|Muskatnuss
cloves|Gewürznelken
allspice|Piment
cardamom|Kardamom
star anise|Sternanis
fennel seeds|Fenchelsamen
mustard seeds|Senfsaat
bay leaf|Lorbeerblatt
bay leaves|Lorbeerblätter
thyme|Thymian
fresh thyme|frischer Thymian
dried thyme|getrockneter Thymian
rosemary|Rosmarin
oregano|Oregano
dried oregano|getrockneter Oregano
basil|Basilikum
basil leaves|Basilikumblätter
parsley|Petersilie
flat-leaf parsley|glatte Petersilie
mint|Minze
mint leaves|Minzblätter
dill|Dill
chives|Schnittlauch
sage|Salbei
tarragon|Estragon
mixed herbs|gemischte Kräuter
italian seasoning|italienische Kräuter
lemon|Zitrone
lemon juice|Zitronensaft
lemon zest|Zitronenschale
lime|Limette
lime juice|Limettensaft
orange|Orange
orange juice|Orangensaft
orange zest|Orangenschale
apple|Apfel
pear|Birne
banana|Banane
strawberry|Erdbeere
raspberry|Himbeere
blueberry|Heidelbeere
blackberry|Brombeere
cherry|Kirsche
peach|Pfirsich
apricot|Aprikose
dried apricots|getrocknete Aprikosen
plum|Pflaume
mango|Mango
pineapple|Ananas
grape|Weintraube
raisins|Rosinen
sultanas|Sultaninen
dates|Datteln
coconut|Kokosnuss
desiccated coconut|Kokosraspeln
avocado|Avocado
potato|Kartoffel
sweet potato|Süßkartoffel
new potatoes|neue Kartoffeln
carrot|Karotte
celery|Staudensellerie
celery stick|Selleriestange
celeriac|Knollensellerie
parsnip|Pastinake
beetroot|Rote Bete
beet|Rote Bete
turnip|Rübe
radish|Radieschen
cucumber|Gurke
courgette|Zucchini
zucchini|Zucchini
aubergine|Aubergine
eggplant|Aubergine
pumpkin|Kürbis
butternut squash|Butternut-Kürbis
squash|Kürbis
red pepper|rote Paprika
green pepper|grüne Paprika
yellow pepper|gelbe Paprika
bell pepper|Paprika
red bell pepper|rote Paprika
sweet pepper|Paprika
broccoli|Brokkoli
cauliflower|Blumenkohl
cabbage|Kohl
red cabbage|Rotkohl
savoy cabbage|Wirsing
brussels sprouts|Rosenkohl
kale|Grünkohl
spinach|Spinat
baby spinach|Babyspinat
lettuce|Salat
rocket|Rucola
arugula|Rucola
watercress|Brunnenkresse
asparagus|Spargel
green beans|grüne Bohnen
peas|Erbsen
frozen peas|TK-Erbsen
sweetcorn|Mais
corn|Mais
mushroom|Pilz
mushrooms|Champignons
button mushrooms|Champignons
chestnut mushrooms|braune Champignons
shiitake mushrooms|Shiitake-Pilze
olive|Olive
black olives|schwarze Oliven
green olives|grüne Oliven
capers|Kapern
fennel|Fenchel
artichoke|Artischocke
bean sprouts|Sojasprossen
pak choi|Pak Choi
bok choy|Pak Choi
rice|Reis
basmati rice|Basmatireis
long grain rice|Langkornreis
jasmine rice|Jasminreis
arborio rice|Risottoreis
risotto rice|Risottoreis
brown rice|Naturreis
pasta|Nudeln
spaghetti|Spaghetti
penne|Penne
fusilli|Fusilli
tagliatelle|Tagliatelle
linguine|Linguine
lasagne sheets|Lasagneplatten
macaroni|Makkaroni
egg noodles|Eiernudeln
rice noodles|Reisnudeln
noodles|Nudeln
couscous|Couscous
bulgur|Bulgur
quinoa|Quinoa
oats|Haferflocken
rolled oats|Haferflocken
porridge oats|Haferflocken
breadcrumbs|Semmelbrösel
bread|Brot
white bread|Weißbrot
baguette|Baguette
pitta bread|Pitabrot
tortillas|Tortillas
flour tortillas|Weizentortillas
puff pastry|Blätterteig
shortcrust pastry|Mürbeteig
filo pastry|Filoteig
chicken|Hähnchen
chicken breast|Hähnchenbrust
chicken breasts|Hähnchenbrustfilets
chicken thighs|Hähnchenschenkel
chicken thigh|Hähnchenschenkel
chicken legs|Hähnchenkeulen
chicken wings|Hähnchenflügel
whole chicken|ganzes Hähnchen
turkey|Pute
duck|Ente
duck breast|Entenbrust
beef|Rindfleisch
minced beef|Rinderhackfleisch
ground beef|Rinderhackfleisch
beef mince|Rinderhackfleisch
steak|Steak
sirloin steak|Rumpsteak
stewing beef|Rindergulasch
pork|Schweinefleisch
pork chops|Schweinekoteletts
pork belly|Schweinebauch
pork shoulder|Schweineschulter
pork tenderloin|Schweinefilet
minced pork|Schweinehackfleisch
ground pork|Schweinehackfleisch
lamb|Lamm
lamb mince|Lammhackfleisch
minced lamb|Lammhackfleisch
lamb shoulder|Lammschulter
leg of lamb|Lammkeule
bacon|Speck
streaky bacon|Frühstücksspeck
pancetta|Pancetta
ham|Schinken
sausages|Würstchen
sausage|Wurst
chorizo|Chorizo
salami|Salami
fish|Fisch
salmon|Lachs
salmon fillet|Lachsfilet
smoked salmon|Räucherlachs
cod|Kabeljau
haddock|Schellfisch
tuna|Thunfisch
tinned tuna|Thunfisch aus der Dose
mackerel|Makrele
sardines|Sardinen
anchovies|Sardellen
anchovy fillets|Sardellenfilets
prawns|Garnelen
king prawns|Riesengarnelen
shrimp|Garnelen
mussels|Miesmuscheln
clams|Venusmuscheln
squid|Tintenfisch
crab|Krebsfleisch
white fish|weißer Fisch
tofu|Tofu
firm tofu|fester Tofu
lentils|Linsen
red lentils|rote Linsen
green lentils|grüne Linsen
chickpeas|Kichererbsen
kidney beans|Kidneybohnen
black beans|schwarze Bohnen
cannellini beans|weiße Bohnen
white beans|weiße Bohnen
butter beans|Butterbohnen
baked beans|Baked Beans
almonds|Mandeln
ground almonds|gemahlene Mandeln
flaked almonds|Mandelblättchen
walnuts|Walnüsse
hazelnuts|Haselnüsse
pecans|Pekannüsse
peanuts|Erdnüsse
cashew nuts|Cashewkerne
cashews|Cashewkerne
pine nuts|Pinienkerne
pistachios|Pistazien
peanut butter|Erdnussbutter
sesame seeds|Sesam
sunflower seeds|Sonnenblumenkerne
pumpkin seeds|Kürbiskerne
chia seeds|Chiasamen
flaxseed|Leinsamen
jam|Marmelade
strawberry jam|Erdbeermarmelade
gelatine|Gelatine
custard|Vanillesoße
ice cream|Eiscreme
`;

const DICT = new Map<string, string>();
for (const line of DICT_SRC.split('\n')) {
  const [en, de] = line.split('|').map((s) => s?.trim());
  if (en && de) DICT.set(en.toLowerCase(), de);
}
const KEYS = [...DICT.keys()].sort((a, b) => b.length - a.length);
export const dictionarySize = () => DICT.size;

/** Preparation notes after the ingredient ("chopped" → "gehackt"). */
const PREP: [RegExp, string][] = [
  [/\bfinely chopped\b/i, 'fein gehackt'],
  [/\broughly chopped\b/i, 'grob gehackt'],
  [/\bchopped\b/i, 'gehackt'],
  [/\bdiced\b/i, 'gewürfelt'],
  [/\bcubed\b/i, 'gewürfelt'],
  [/\bthinly sliced\b/i, 'in dünnen Scheiben'],
  [/\bsliced\b/i, 'in Scheiben'],
  [/\bminced\b/i, 'fein gehackt'],
  [/\bcrushed\b/i, 'zerdrückt'],
  [/\bgrated\b/i, 'gerieben'],
  [/\bpeeled\b/i, 'geschält'],
  [/\bbeaten\b/i, 'verquirlt'],
  [/\bmelted\b/i, 'geschmolzen'],
  [/\bsoftened\b/i, 'weich'],
  [/\bshredded\b/i, 'in Streifen'],
  [/\bjuiced\b/i, 'ausgepresst'],
  [/\bzested\b/i, 'Schale abgerieben'],
  [/\bto taste\b/i, 'nach Geschmack'],
  [/\bto serve\b/i, 'zum Servieren'],
  [/\bfor frying\b/i, 'zum Braten'],
  [/\bfor greasing\b/i, 'zum Einfetten'],
  [/\bfor garnish\b/i, 'zum Garnieren'],
  [/\boptional\b/i, 'optional'],
];
const SIZE: [RegExp, string][] = [
  [/\blarge\b/i, 'groß'],
  [/\bmedium\b/i, 'mittelgroß'],
  [/\bsmall\b/i, 'klein'],
  [/\bfresh\b/i, 'frisch'],
  [/\bdried\b/i, 'getrocknet'],
  [/\bfrozen\b/i, 'TK'],
  [/\bground\b/i, 'gemahlen'],
];

const singular = (w: string) =>
  w.replace(/ies$/i, 'y').replace(/(tomato|potato)es$/i, '$1').replace(/(ch|sh|ss|x)es$/i, '$1').replace(/([^s])s$/i, '$1');

/** Translate an ingredient name; returns null when nothing in the dictionary fits. */
export function translateName(name: string, to: Target): string | null {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  const pick = (k: string) => DICT.get(k)!;
  if (DICT.has(n)) return pick(n);
  const sg = n.split(' ').map(singular).join(' ');
  if (DICT.has(sg)) return pick(sg);
  for (const k of KEYS) {
    const re = new RegExp(`(^|[^a-z])(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(e?s)?($|[^a-z])`, 'i');
    const m = n.match(re) ?? sg.match(re);
    if (!m) continue;
    const rest = (m.input ?? n).replace(re, ' ').replace(/\s+/g, ' ').trim();
    if (!rest) return pick(k);
    // translate known size words, keep the rest in English in brackets (the original is shown anyway)
    let words = rest;
    const adj: string[] = [];
    for (const [r, de] of SIZE) if (r.test(words)) {
      adj.push(de);
      words = words.replace(r, ' ').replace(/\s+/g, ' ').trim();
    }
    const extra = words.replace(/^[-,\s]+|[-,\s]+$/g, '');
    return [pick(k), adj.length ? `(${adj.join(', ')}${extra ? ', ' + extra : ''})` : extra ? `(${extra})` : ''].filter(Boolean).join(' ');
  }
  return null;
}

// ------------------------------------------------------------------ measures

/** grams per US cup for dry things people measure in cups */
const CUP_GRAMS: [RegExp, number][] = [
  [/flour|cornflour|cornstarch/i, 125],
  [/icing sugar|powdered sugar/i, 120],
  [/brown sugar/i, 220],
  [/sugar/i, 200],
  [/butter|margarine/i, 227],
  [/rice/i, 185],
  [/oats/i, 90],
  [/cocoa/i, 100],
  [/cheese/i, 110],
  [/nuts|almonds|walnuts|pecans|hazelnuts|cashews|peanuts/i, 140],
  [/raisins|sultanas|dates|apricots/i, 150],
  [/chocolate/i, 170],
  [/breadcrumbs/i, 60],
  [/coconut/i, 80],
  [/lentils|chickpeas|beans|quinoa|couscous/i, 190],
  [/spinach|lettuce|rocket|kale|herbs|parsley|coriander|basil/i, 30],
  [/peas|corn|berries|blueberries|raspberries/i, 145],
];

interface Parsed {
  qty: number | null;
  unit: string | null;
  rest: string;
}

const UNICODE_FRAC: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };

const UNIT_RE: [RegExp, string][] = [
  [/^(cups?|c)\b\.?/i, 'cup'],
  [/^(tablespoons?|tbsps?|tblsps?|tbls|tbs|tbl)\b\.?/i, 'tbsp'],
  [/^(teaspoons?|tsps?|tsp)\b\.?/i, 'tsp'],
  [/^(fl\.?\s?oz|fluid ounces?)\b\.?/i, 'floz'],
  [/^(ounces?|oz)\b\.?/i, 'oz'],
  [/^(pounds?|lbs?)\b\.?/i, 'lb'],
  [/^(pints?|pt)\b\.?/i, 'pint'],
  [/^(quarts?|qt)\b\.?/i, 'quart'],
  [/^(kilograms?|kgs?)\b\.?/i, 'kg'],
  [/^(grams?|grammes?|gr|g)\b\.?/i, 'g'],
  [/^(millilitres?|milliliters?|ml)\b\.?/i, 'ml'],
  [/^(centilitres?|cl)\b\.?/i, 'cl'],
  [/^(litres?|liters?|l)\b\.?/i, 'l'],
  [/^(cloves?)\b/i, 'clove'],
  [/^(cans?|tins?)\b/i, 'can'],
  [/^(pinch(es)?)\b/i, 'pinch'],
  [/^(dash(es)?|splash(es)?)\b/i, 'dash'],
  [/^(handfuls?)\b/i, 'handful'],
  [/^(slices?)\b/i, 'slice'],
  [/^(bunch(es)?)\b/i, 'bunch'],
  [/^(sprigs?)\b/i, 'sprig'],
  [/^(sticks?)\b/i, 'stick'],
  [/^(packets?|packs?|packages?)\b/i, 'pack'],
  [/^(jars?)\b/i, 'jar'],
  [/^(pieces?|pcs?)\b/i, 'piece'],
];

/** "1 1/2 cups", "2tbs", "175g", "½ tsp", "1-2", "3 cloves" → parts */
export function parseMeasure(s: string): Parsed {
  let rest = s.trim().replace(/(\d)([a-z])/gi, '$1 $2');
  let qty: number | null = null;
  const m =
    rest.match(/^(\d+)\s+(\d+)\/(\d+)/) ?? // 1 1/2
    rest.match(/^()(\d+)\/(\d+)/) ?? // 1/2
    rest.match(/^(\d+(?:[.,]\d+)?)()()\s*([½¼¾⅓⅔⅛])?/) ?? // 2, 1.5, 1½
    rest.match(/^()()()([½¼¾⅓⅔⅛])/); // ½
  if (m) {
    const whole = m[1] ? Number(m[1].replace(',', '.')) : 0;
    const frac = m[2] && m[3] && Number(m[3]) ? Number(m[2]) / Number(m[3]) : 0;
    const uni = m[4] ? UNICODE_FRAC[m[4]] : 0;
    qty = whole + frac + uni || null;
    rest = rest.slice(m[0].length).replace(/^\s*[-–]\s*\d+(?:[.,/]\d+)?/, '').trim();
  }
  let unit: string | null = null;
  for (const [re, u] of UNIT_RE) {
    const um = rest.match(re);
    if (um) {
      unit = u;
      rest = rest.slice(um[0].length).trim();
      break;
    }
  }
  return { qty, unit, rest: rest.replace(/^of\s+/i, '') };
}

const roundSmart = (v: number) => (v >= 200 ? Math.round(v / 10) * 10 : v >= 50 ? Math.round(v / 5) * 5 : v >= 10 ? Math.round(v) : Math.round(v * 10) / 10);

const UNIT_WORDS: Record<string, { de: [string, string] }> = {
  tbsp: { de: ['EL', 'EL'] },
  tsp: { de: ['TL', 'TL'] },
  clove: { de: ['Zehe', 'Zehen'] },
  can: { de: ['Dose', 'Dosen'] },
  pinch: { de: ['Prise', 'Prisen'] },
  dash: { de: ['Spritzer', 'Spritzer'] },
  handful: { de: ['Handvoll', 'Handvoll'] },
  slice: { de: ['Scheibe', 'Scheiben'] },
  bunch: { de: ['Bund', 'Bund'] },
  sprig: { de: ['Zweig', 'Zweige'] },
  stick: { de: ['Stange', 'Stangen'] },
  pack: { de: ['Packung', 'Packungen'] },
  jar: { de: ['Glas', 'Gläser'] },
  piece: { de: ['Stück', 'Stück'] },
  cup: { de: ['Tasse', 'Tassen'] },
  oz: { de: ['oz', 'oz'] },
  lb: { de: ['lb', 'lb'] },
  floz: { de: ['fl oz', 'fl oz'] },
  pint: { de: ['Pint', 'Pints'] },
  quart: { de: ['Quart', 'Quarts'] },
};

/** Metric conversion of a parsed amount (null when the unit is already fine or unknown). */
export function toMetric(qty: number, unit: string, ingredient: string): { qty: number; unit: 'g' | 'ml' } | null {
  switch (unit) {
    case 'oz':
      return { qty: roundSmart(qty * 28.35), unit: 'g' };
    case 'lb':
      return { qty: roundSmart(qty * 453.6), unit: 'g' };
    case 'floz':
      return { qty: roundSmart(qty * 29.57), unit: 'ml' };
    case 'pint':
      return { qty: roundSmart(qty * 473), unit: 'ml' };
    case 'quart':
      return { qty: roundSmart(qty * 946), unit: 'ml' };
    case 'cup': {
      const dry = CUP_GRAMS.find(([re]) => re.test(ingredient));
      return dry ? { qty: roundSmart(qty * dry[1]), unit: 'g' } : { qty: roundSmart(qty * 240), unit: 'ml' };
    }
    case 'kg':
      return null;
    case 'cl':
      return { qty: qty * 10, unit: 'ml' };
    default:
      return null;
  }
}

const fmt = (n: number, lang: string) => {
  const r = Math.round(n * 100) / 100;
  const frac: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' };
  const whole = Math.floor(r);
  const rest = (r - whole).toFixed(2);
  if (frac[rest] && r < 10) return `${whole ? whole + ' ' : ''}${frac[rest]}`;
  return lang === 'en' ? String(r) : String(r).replace('.', ',');
};

export interface TranslatedLine {
  text: string;
  qty: number | null;
  unit: string | null;
  /** original line, set when anything was changed */
  orig: string | null;
}

/**
 * One English ingredient (measure + name, as TheMealDB has them) → line in the household language.
 * lang 'en' only converts units (when metric); 'de' translates known words too.
 */
export function translateIngredient(measure: string, name: string, lang: string, units: 'metric' | 'us'): TranslatedLine {
  const origLine = [measure.trim(), name.trim()].filter(Boolean).join(' ');
  const target: Target | null = lang === 'de' ? 'de' : null;
  const p = parseMeasure(measure);
  // notes in the measure ("chopped", "to taste") or in the name ("Onion, chopped")
  const [baseName, ...noteParts] = name.split(',');
  let notes = [p.rest, ...noteParts].map((s) => s.trim()).filter(Boolean).join(', ');
  let qty = p.qty;
  let unit = p.unit;
  if (qty !== null && unit && units === 'metric') {
    const m = toMetric(qty, unit, baseName);
    if (m) {
      qty = m.qty;
      unit = m.unit;
    }
  }
  let nameOut = baseName.trim();
  if (target) {
    // "1 carrots" → singular when the amount is one
    const one = qty !== null && qty <= 1 && !unit ? translateName(nameOut.split(' ').map(singular).join(' '), target) : null;
    const tr = one ?? translateName(nameOut, target);
    if (tr) nameOut = tr;
    for (const [re, de] of [...PREP, ...SIZE]) if (re.test(notes)) notes = notes.replace(re, de);
  }
  let unitWord: string | null = unit;
  if (unit && UNIT_WORDS[unit]) {
    const plural = (qty ?? 1) > 1;
    unitWord = target ? UNIT_WORDS[unit][target][plural ? 1 : 0] : unit === 'tbsp' || unit === 'tsp' ? unit : plural && !['oz', 'lb', 'floz'].includes(unit) ? unit + 's' : unit;
    if (unit === 'floz' && !target) unitWord = 'fl oz';
  }
  const text = [qty !== null ? fmt(qty, lang) : null, unitWord, nameOut].filter(Boolean).join(' ') + (notes ? `, ${notes}` : '');
  const cleanOrig = origLine.replace(/\s+/g, ' ');
  return { text: text.replace(/\s+/g, ' ').trim(), qty, unit: unit === 'floz' ? 'ml' : unit, orig: text.trim().toLowerCase() === cleanOrig.toLowerCase() ? null : cleanOrig };
}

/** Category / area words from TheMealDB → tags in the household language. */
const TAGS: Record<string, string> = {
  beef: 'Rind', chicken: 'Hähnchen', dessert: 'Dessert', lamb: 'Lamm',
  miscellaneous: 'Verschiedenes', pasta: 'Pasta', pork: 'Schwein', seafood: 'Meeresfrüchte',
  side: 'Beilage', starter: 'Vorspeise', vegan: 'Vegan', vegetarian: 'Vegetarisch',
  breakfast: 'Frühstück', goat: 'Ziege',
  american: 'Amerikanisch', british: 'Britisch', canadian: 'Kanadisch', chinese: 'Chinesisch',
  croatian: 'Kroatisch', dutch: 'Niederländisch', egyptian: 'Ägyptisch', filipino: 'Philippinisch',
  french: 'Französisch', greek: 'Griechisch', indian: 'Indisch', irish: 'Irisch',
  italian: 'Italienisch', jamaican: 'Jamaikanisch', japanese: 'Japanisch', kenyan: 'Kenianisch',
  malaysian: 'Malaysisch', mexican: 'Mexikanisch', moroccan: 'Marokkanisch', polish: 'Polnisch',
  portuguese: 'Portugiesisch', russian: 'Russisch', spanish: 'Spanisch', thai: 'Thailändisch',
  tunisian: 'Tunesisch', turkish: 'Türkisch', ukrainian: 'Ukrainisch', vietnamese: 'Vietnamesisch',
};
export function translateTag(tag: string, lang: string): string {
  const e = TAGS[tag.toLowerCase().trim()];
  if (!e || lang !== 'de') return tag;
  return e;
}
