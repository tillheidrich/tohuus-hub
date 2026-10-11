/**
 * English recipe lines → the household language (area: recipes2).
 *
 * A small built-in dictionary of common ingredients (no cloud translation) plus measure conversion:
 * cups / oz / lb / fl oz / pints → g / ml when the household region uses metric units; spoons become
 * EL/TL (German) or msk/tsk (Swedish). The original English line is always kept next to the translation.
 */

type Target = 'de' | 'sv';

// en | de | sv  (singular forms; plurals are handled by the matcher)
const DICT_SRC = `
all-purpose flour|Weizenmehl|vetemjöl
plain flour|Weizenmehl|vetemjöl
self-raising flour|Mehl mit Backpulver|självjäsande mjöl
self raising flour|Mehl mit Backpulver|självjäsande mjöl
bread flour|Brotmehl|vetemjöl special
wholemeal flour|Vollkornmehl|fullkornsmjöl
whole wheat flour|Vollkornmehl|fullkornsmjöl
cornflour|Speisestärke|majsstärkelse
cornstarch|Speisestärke|majsstärkelse
flour|Mehl|mjöl
caster sugar|feiner Zucker|strösocker
granulated sugar|Zucker|strösocker
brown sugar|brauner Zucker|farinsocker
dark brown sugar|dunkler brauner Zucker|mörkt farinsocker
light brown sugar|heller brauner Zucker|ljust farinsocker
icing sugar|Puderzucker|florsocker
powdered sugar|Puderzucker|florsocker
demerara sugar|Rohrzucker|råsocker
muscovado sugar|Muscovado-Zucker|muscovadosocker
sugar|Zucker|socker
honey|Honig|honung
maple syrup|Ahornsirup|lönnsirap
golden syrup|Zuckersirup|ljus sirap
treacle|Melasse|mörk sirap
molasses|Melasse|melass
baking powder|Backpulver|bakpulver
baking soda|Natron|bikarbonat
bicarbonate of soda|Natron|bikarbonat
yeast|Hefe|jäst
dried yeast|Trockenhefe|torrjäst
vanilla extract|Vanilleextrakt|vaniljextrakt
vanilla essence|Vanillearoma|vaniljarom
vanilla|Vanille|vanilj
cocoa powder|Kakaopulver|kakao
cocoa|Kakao|kakao
dark chocolate|Zartbitterschokolade|mörk choklad
milk chocolate|Vollmilchschokolade|mjölkchoklad
white chocolate|weiße Schokolade|vit choklad
chocolate chips|Schokotropfen|chokladknappar
chocolate|Schokolade|choklad
salt|Salz|salt
sea salt|Meersalz|havssalt
black pepper|schwarzer Pfeffer|svartpeppar
pepper|Pfeffer|peppar
white pepper|weißer Pfeffer|vitpeppar
butter|Butter|smör
unsalted butter|ungesalzene Butter|osaltat smör
salted butter|gesalzene Butter|saltat smör
margarine|Margarine|margarin
olive oil|Olivenöl|olivolja
extra virgin olive oil|natives Olivenöl extra|extra jungfru olivolja
vegetable oil|Pflanzenöl|neutral olja
sunflower oil|Sonnenblumenöl|solrosolja
rapeseed oil|Rapsöl|rapsolja
canola oil|Rapsöl|rapsolja
sesame oil|Sesamöl|sesamolja
coconut oil|Kokosöl|kokosolja
oil|Öl|olja
milk|Milch|mjölk
whole milk|Vollmilch|standardmjölk
skimmed milk|Magermilch|lättmjölk
semi-skimmed milk|fettarme Milch|mellanmjölk
buttermilk|Buttermilch|kärnmjölk
coconut milk|Kokosmilch|kokosmjölk
almond milk|Mandelmilch|mandeldryck
oat milk|Haferdrink|havredryck
cream|Sahne|grädde
double cream|Schlagsahne|vispgrädde
heavy cream|Schlagsahne|vispgrädde
whipping cream|Schlagsahne|vispgrädde
single cream|Kochsahne|matlagningsgrädde
sour cream|Saure Sahne|gräddfil
creme fraiche|Crème fraîche|crème fraiche
crème fraîche|Crème fraîche|crème fraiche
yogurt|Joghurt|yoghurt
yoghurt|Joghurt|yoghurt
greek yogurt|griechischer Joghurt|grekisk yoghurt
plain yogurt|Naturjoghurt|naturell yoghurt
egg|Ei|ägg
eggs|Eier|ägg
onions|Zwiebeln|lökar
red onions|rote Zwiebeln|rödlökar
carrots|Karotten|morötter
potatoes|Kartoffeln|potatisar
tomatoes|Tomaten|tomater
apples|Äpfel|äpplen
lemons|Zitronen|citroner
limes|Limetten|limefrukter
shallots|Schalotten|schalottenlökar
bananas|Bananen|bananer
spring onions|Frühlingszwiebeln|salladslökar
garlic cloves|Knoblauchzehen|vitlöksklyftor
red peppers|rote Paprika|röda paprikor
mushroom caps|Pilzköpfe|svamphattar
egg yolk|Eigelb|äggula
egg white|Eiweiß|äggvita
free-range egg|Freilandei|frigående ägg
cheese|Käse|ost
cheddar cheese|Cheddar|cheddar
cheddar|Cheddar|cheddar
parmesan cheese|Parmesan|parmesan
parmesan|Parmesan|parmesan
mozzarella|Mozzarella|mozzarella
feta cheese|Feta|fetaost
feta|Feta|fetaost
cream cheese|Frischkäse|färskost
ricotta|Ricotta|ricotta
mascarpone|Mascarpone|mascarpone
goat cheese|Ziegenkäse|getost
gruyere|Gruyère|gruyère
gruyère|Gruyère|gruyère
cottage cheese|Hüttenkäse|keso
halloumi|Halloumi|halloumi
water|Wasser|vatten
cold water|kaltes Wasser|kallt vatten
hot water|heißes Wasser|hett vatten
boiling water|kochendes Wasser|kokande vatten
ice|Eis|is
chicken stock|Hühnerbrühe|kycklingbuljong
chicken broth|Hühnerbrühe|kycklingbuljong
beef stock|Rinderbrühe|köttbuljong
beef broth|Rinderbrühe|köttbuljong
vegetable stock|Gemüsebrühe|grönsaksbuljong
vegetable broth|Gemüsebrühe|grönsaksbuljong
stock cube|Brühwürfel|buljongtärning
stock|Brühe|buljong
white wine|Weißwein|vitt vin
red wine|Rotwein|rött vin
dry white wine|trockener Weißwein|torrt vitt vin
beer|Bier|öl
white wine vinegar|Weißweinessig|vitvinsvinäger
red wine vinegar|Rotweinessig|rödvinsvinäger
balsamic vinegar|Balsamico-Essig|balsamvinäger
cider vinegar|Apfelessig|äppelcidervinäger
apple cider vinegar|Apfelessig|äppelcidervinäger
rice vinegar|Reisessig|risvinäger
vinegar|Essig|vinäger
soy sauce|Sojasauce|soja
dark soy sauce|dunkle Sojasauce|mörk soja
light soy sauce|helle Sojasauce|ljus soja
fish sauce|Fischsauce|fisksås
oyster sauce|Austernsauce|ostronsås
worcestershire sauce|Worcestersauce|worcestershiresås
hot sauce|scharfe Sauce|het sås
tabasco sauce|Tabasco|tabasco
sriracha|Sriracha|sriracha
tomato ketchup|Ketchup|ketchup
ketchup|Ketchup|ketchup
mayonnaise|Mayonnaise|majonnäs
mustard|Senf|senap
dijon mustard|Dijon-Senf|dijonsenap
english mustard|scharfer Senf|stark senap
wholegrain mustard|grober Senf|grov senap
tomato puree|Tomatenmark|tomatpuré
tomato paste|Tomatenmark|tomatpuré
passata|passierte Tomaten|passerade tomater
chopped tomatoes|gehackte Tomaten|krossade tomater
canned tomatoes|Dosentomaten|krossade tomater
plum tomatoes|Eiertomaten|plommontomater
cherry tomatoes|Kirschtomaten|körsbärstomater
tomato|Tomate|tomat
sun-dried tomatoes|getrocknete Tomaten|soltorkade tomater
onion|Zwiebel|lök
red onion|rote Zwiebel|rödlök
white onion|weiße Zwiebel|gul lök
brown onion|Zwiebel|gul lök
yellow onion|Zwiebel|gul lök
spring onion|Frühlingszwiebel|salladslök
green onion|Frühlingszwiebel|salladslök
scallion|Frühlingszwiebel|salladslök
shallot|Schalotte|schalottenlök
leek|Lauch|purjolök
garlic|Knoblauch|vitlök
garlic clove|Knoblauchzehe|vitlöksklyfta
ginger|Ingwer|ingefära
fresh ginger|frischer Ingwer|färsk ingefära
ground ginger|gemahlener Ingwer|malen ingefära
chilli|Chili|chili
chili|Chili|chili
red chilli|rote Chili|röd chili
green chilli|grüne Chili|grön chili
chilli powder|Chilipulver|chilipulver
chili powder|Chilipulver|chilipulver
chilli flakes|Chiliflocken|chiliflakes
red pepper flakes|Chiliflocken|chiliflakes
cayenne pepper|Cayennepfeffer|cayennepeppar
paprika|Paprikapulver|paprikapulver
smoked paprika|geräuchertes Paprikapulver|rökt paprikapulver
cumin|Kreuzkümmel|spiskummin
ground cumin|gemahlener Kreuzkümmel|malen spiskummin
cumin seeds|Kreuzkümmelsamen|hel spiskummin
coriander|Koriander|koriander
ground coriander|gemahlener Koriander|malen koriander
coriander leaves|Korianderblätter|färsk koriander
cilantro|Koriander|färsk koriander
turmeric|Kurkuma|gurkmeja
garam masala|Garam Masala|garam masala
curry powder|Currypulver|curry
curry paste|Currypaste|currypasta
red curry paste|rote Currypaste|röd currypasta
green curry paste|grüne Currypaste|grön currypasta
cinnamon|Zimt|kanel
ground cinnamon|gemahlener Zimt|malen kanel
cinnamon stick|Zimtstange|kanelstång
nutmeg|Muskatnuss|muskotnöt
cloves|Gewürznelken|kryddnejlikor
allspice|Piment|kryddpeppar
cardamom|Kardamom|kardemumma
star anise|Sternanis|stjärnanis
fennel seeds|Fenchelsamen|fänkålsfrön
mustard seeds|Senfsaat|senapsfrön
bay leaf|Lorbeerblatt|lagerblad
bay leaves|Lorbeerblätter|lagerblad
thyme|Thymian|timjan
fresh thyme|frischer Thymian|färsk timjan
dried thyme|getrockneter Thymian|torkad timjan
rosemary|Rosmarin|rosmarin
oregano|Oregano|oregano
dried oregano|getrockneter Oregano|torkad oregano
basil|Basilikum|basilika
basil leaves|Basilikumblätter|basilikablad
parsley|Petersilie|persilja
flat-leaf parsley|glatte Petersilie|bladpersilja
mint|Minze|mynta
mint leaves|Minzblätter|myntablad
dill|Dill|dill
chives|Schnittlauch|gräslök
sage|Salbei|salvia
tarragon|Estragon|dragon
mixed herbs|gemischte Kräuter|örtkryddor
italian seasoning|italienische Kräuter|italiensk örtblandning
lemon|Zitrone|citron
lemon juice|Zitronensaft|citronsaft
lemon zest|Zitronenschale|citronskal
lime|Limette|lime
lime juice|Limettensaft|limesaft
orange|Orange|apelsin
orange juice|Orangensaft|apelsinjuice
orange zest|Orangenschale|apelsinskal
apple|Apfel|äpple
pear|Birne|päron
banana|Banane|banan
strawberry|Erdbeere|jordgubbe
raspberry|Himbeere|hallon
blueberry|Heidelbeere|blåbär
blackberry|Brombeere|björnbär
cherry|Kirsche|körsbär
peach|Pfirsich|persika
apricot|Aprikose|aprikos
dried apricots|getrocknete Aprikosen|torkade aprikoser
plum|Pflaume|plommon
mango|Mango|mango
pineapple|Ananas|ananas
grape|Weintraube|vindruva
raisins|Rosinen|russin
sultanas|Sultaninen|sultanrussin
dates|Datteln|dadlar
coconut|Kokosnuss|kokos
desiccated coconut|Kokosraspeln|riven kokos
avocado|Avocado|avokado
potato|Kartoffel|potatis
sweet potato|Süßkartoffel|sötpotatis
new potatoes|neue Kartoffeln|färskpotatis
carrot|Karotte|morot
celery|Staudensellerie|blekselleri
celery stick|Selleriestange|selleristjälk
celeriac|Knollensellerie|rotselleri
parsnip|Pastinake|palsternacka
beetroot|Rote Bete|rödbeta
beet|Rote Bete|rödbeta
turnip|Rübe|rova
radish|Radieschen|rädisa
cucumber|Gurke|gurka
courgette|Zucchini|zucchini
zucchini|Zucchini|zucchini
aubergine|Aubergine|aubergine
eggplant|Aubergine|aubergine
pumpkin|Kürbis|pumpa
butternut squash|Butternut-Kürbis|butternutpumpa
squash|Kürbis|pumpa
red pepper|rote Paprika|röd paprika
green pepper|grüne Paprika|grön paprika
yellow pepper|gelbe Paprika|gul paprika
bell pepper|Paprika|paprika
red bell pepper|rote Paprika|röd paprika
sweet pepper|Paprika|paprika
broccoli|Brokkoli|broccoli
cauliflower|Blumenkohl|blomkål
cabbage|Kohl|vitkål
red cabbage|Rotkohl|rödkål
savoy cabbage|Wirsing|savojkål
brussels sprouts|Rosenkohl|brysselkål
kale|Grünkohl|grönkål
spinach|Spinat|spenat
baby spinach|Babyspinat|babyspenat
lettuce|Salat|sallad
rocket|Rucola|ruccola
arugula|Rucola|ruccola
watercress|Brunnenkresse|vattenkrasse
asparagus|Spargel|sparris
green beans|grüne Bohnen|haricots verts
peas|Erbsen|ärtor
frozen peas|TK-Erbsen|frysta ärtor
sweetcorn|Mais|majs
corn|Mais|majs
mushroom|Pilz|svamp
mushrooms|Champignons|champinjoner
button mushrooms|Champignons|champinjoner
chestnut mushrooms|braune Champignons|skogschampinjoner
shiitake mushrooms|Shiitake-Pilze|shiitakesvamp
olive|Olive|oliv
black olives|schwarze Oliven|svarta oliver
green olives|grüne Oliven|gröna oliver
capers|Kapern|kapris
fennel|Fenchel|fänkål
artichoke|Artischocke|kronärtskocka
bean sprouts|Sojasprossen|böngroddar
pak choi|Pak Choi|pak choi
bok choy|Pak Choi|pak choi
rice|Reis|ris
basmati rice|Basmatireis|basmatiris
long grain rice|Langkornreis|långkornigt ris
jasmine rice|Jasminreis|jasminris
arborio rice|Risottoreis|arborioris
risotto rice|Risottoreis|risottoris
brown rice|Naturreis|fullkornsris
pasta|Nudeln|pasta
spaghetti|Spaghetti|spaghetti
penne|Penne|penne
fusilli|Fusilli|fusilli
tagliatelle|Tagliatelle|tagliatelle
linguine|Linguine|linguine
lasagne sheets|Lasagneplatten|lasagneplattor
macaroni|Makkaroni|makaroner
egg noodles|Eiernudeln|äggnudlar
rice noodles|Reisnudeln|risnudlar
noodles|Nudeln|nudlar
couscous|Couscous|couscous
bulgur|Bulgur|bulgur
quinoa|Quinoa|quinoa
oats|Haferflocken|havregryn
rolled oats|Haferflocken|havregryn
porridge oats|Haferflocken|havregryn
breadcrumbs|Semmelbrösel|ströbröd
bread|Brot|bröd
white bread|Weißbrot|vitt bröd
baguette|Baguette|baguette
pitta bread|Pitabrot|pitabröd
tortillas|Tortillas|tortillabröd
flour tortillas|Weizentortillas|vetetortillas
puff pastry|Blätterteig|smördeg
shortcrust pastry|Mürbeteig|mördeg
filo pastry|Filoteig|filodeg
chicken|Hähnchen|kyckling
chicken breast|Hähnchenbrust|kycklingbröst
chicken breasts|Hähnchenbrustfilets|kycklingbröst
chicken thighs|Hähnchenschenkel|kycklinglår
chicken thigh|Hähnchenschenkel|kycklinglår
chicken legs|Hähnchenkeulen|kycklingklubbor
chicken wings|Hähnchenflügel|kycklingvingar
whole chicken|ganzes Hähnchen|hel kyckling
turkey|Pute|kalkon
duck|Ente|anka
duck breast|Entenbrust|ankbröst
beef|Rindfleisch|nötkött
minced beef|Rinderhackfleisch|nötfärs
ground beef|Rinderhackfleisch|nötfärs
beef mince|Rinderhackfleisch|nötfärs
steak|Steak|biff
sirloin steak|Rumpsteak|ryggbiff
stewing beef|Rindergulasch|grytbitar av nöt
pork|Schweinefleisch|fläskkött
pork chops|Schweinekoteletts|fläskkotletter
pork belly|Schweinebauch|sidfläsk
pork shoulder|Schweineschulter|fläskbog
pork tenderloin|Schweinefilet|fläskfilé
minced pork|Schweinehackfleisch|fläskfärs
ground pork|Schweinehackfleisch|fläskfärs
lamb|Lamm|lamm
lamb mince|Lammhackfleisch|lammfärs
minced lamb|Lammhackfleisch|lammfärs
lamb shoulder|Lammschulter|lammbog
leg of lamb|Lammkeule|lammstek
bacon|Speck|bacon
streaky bacon|Frühstücksspeck|bacon
pancetta|Pancetta|pancetta
ham|Schinken|skinka
sausages|Würstchen|korv
sausage|Wurst|korv
chorizo|Chorizo|chorizo
salami|Salami|salami
fish|Fisch|fisk
salmon|Lachs|lax
salmon fillet|Lachsfilet|laxfilé
smoked salmon|Räucherlachs|rökt lax
cod|Kabeljau|torsk
haddock|Schellfisch|kolja
tuna|Thunfisch|tonfisk
tinned tuna|Thunfisch aus der Dose|tonfisk på burk
mackerel|Makrele|makrill
sardines|Sardinen|sardiner
anchovies|Sardellen|sardeller
anchovy fillets|Sardellenfilets|sardellfiléer
prawns|Garnelen|räkor
king prawns|Riesengarnelen|jätteräkor
shrimp|Garnelen|räkor
mussels|Miesmuscheln|blåmusslor
clams|Venusmuscheln|musslor
squid|Tintenfisch|bläckfisk
crab|Krebsfleisch|krabba
white fish|weißer Fisch|vit fisk
tofu|Tofu|tofu
firm tofu|fester Tofu|fast tofu
lentils|Linsen|linser
red lentils|rote Linsen|röda linser
green lentils|grüne Linsen|gröna linser
chickpeas|Kichererbsen|kikärtor
kidney beans|Kidneybohnen|kidneybönor
black beans|schwarze Bohnen|svarta bönor
cannellini beans|weiße Bohnen|vita bönor
white beans|weiße Bohnen|vita bönor
butter beans|Butterbohnen|smörbönor
baked beans|Baked Beans|bakade bönor
almonds|Mandeln|mandlar
ground almonds|gemahlene Mandeln|mandelmjöl
flaked almonds|Mandelblättchen|mandelspån
walnuts|Walnüsse|valnötter
hazelnuts|Haselnüsse|hasselnötter
pecans|Pekannüsse|pekannötter
peanuts|Erdnüsse|jordnötter
cashew nuts|Cashewkerne|cashewnötter
cashews|Cashewkerne|cashewnötter
pine nuts|Pinienkerne|pinjenötter
pistachios|Pistazien|pistaschmandlar
peanut butter|Erdnussbutter|jordnötssmör
sesame seeds|Sesam|sesamfrön
sunflower seeds|Sonnenblumenkerne|solrosfrön
pumpkin seeds|Kürbiskerne|pumpafrön
chia seeds|Chiasamen|chiafrön
flaxseed|Leinsamen|linfrö
jam|Marmelade|sylt
strawberry jam|Erdbeermarmelade|jordgubbssylt
gelatine|Gelatine|gelatin
custard|Vanillesoße|vaniljsås
ice cream|Eiscreme|glass
`;

const DICT = new Map<string, [string, string]>();
for (const line of DICT_SRC.split('\n')) {
  const [en, de, sv] = line.split('|').map((s) => s?.trim());
  if (en && de && sv) DICT.set(en.toLowerCase(), [de, sv]);
}
const KEYS = [...DICT.keys()].sort((a, b) => b.length - a.length);
export const dictionarySize = () => DICT.size;

/** Preparation notes after the ingredient ("chopped" → "gehackt"). */
const PREP: [RegExp, string, string][] = [
  [/\bfinely chopped\b/i, 'fein gehackt', 'finhackad'],
  [/\broughly chopped\b/i, 'grob gehackt', 'grovhackad'],
  [/\bchopped\b/i, 'gehackt', 'hackad'],
  [/\bdiced\b/i, 'gewürfelt', 'tärnad'],
  [/\bcubed\b/i, 'gewürfelt', 'tärnad'],
  [/\bthinly sliced\b/i, 'in dünnen Scheiben', 'tunt skivad'],
  [/\bsliced\b/i, 'in Scheiben', 'skivad'],
  [/\bminced\b/i, 'fein gehackt', 'finhackad'],
  [/\bcrushed\b/i, 'zerdrückt', 'krossad'],
  [/\bgrated\b/i, 'gerieben', 'riven'],
  [/\bpeeled\b/i, 'geschält', 'skalad'],
  [/\bbeaten\b/i, 'verquirlt', 'uppvispad'],
  [/\bmelted\b/i, 'geschmolzen', 'smält'],
  [/\bsoftened\b/i, 'weich', 'rumsvarm'],
  [/\bshredded\b/i, 'in Streifen', 'strimlad'],
  [/\bjuiced\b/i, 'ausgepresst', 'pressad'],
  [/\bzested\b/i, 'Schale abgerieben', 'rivet skal'],
  [/\bto taste\b/i, 'nach Geschmack', 'efter smak'],
  [/\bto serve\b/i, 'zum Servieren', 'till servering'],
  [/\bfor frying\b/i, 'zum Braten', 'till stekning'],
  [/\bfor greasing\b/i, 'zum Einfetten', 'till smörjning'],
  [/\bfor garnish\b/i, 'zum Garnieren', 'till garnering'],
  [/\boptional\b/i, 'optional', 'valfritt'],
];
const SIZE: [RegExp, string, string][] = [
  [/\blarge\b/i, 'groß', 'stor'],
  [/\bmedium\b/i, 'mittelgroß', 'medelstor'],
  [/\bsmall\b/i, 'klein', 'liten'],
  [/\bfresh\b/i, 'frisch', 'färsk'],
  [/\bdried\b/i, 'getrocknet', 'torkad'],
  [/\bfrozen\b/i, 'TK', 'fryst'],
  [/\bground\b/i, 'gemahlen', 'malen'],
];

const singular = (w: string) =>
  w.replace(/ies$/i, 'y').replace(/(tomato|potato)es$/i, '$1').replace(/(ch|sh|ss|x)es$/i, '$1').replace(/([^s])s$/i, '$1');

/** Translate an ingredient name; returns null when nothing in the dictionary fits. */
export function translateName(name: string, to: Target): string | null {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  const pick = (k: string) => DICT.get(k)![to === 'de' ? 0 : 1];
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
    for (const [r, de, sv] of SIZE) if (r.test(words)) {
      adj.push(to === 'de' ? de : sv);
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

const UNIT_WORDS: Record<string, { de: [string, string]; sv: [string, string] }> = {
  tbsp: { de: ['EL', 'EL'], sv: ['msk', 'msk'] },
  tsp: { de: ['TL', 'TL'], sv: ['tsk', 'tsk'] },
  clove: { de: ['Zehe', 'Zehen'], sv: ['klyfta', 'klyftor'] },
  can: { de: ['Dose', 'Dosen'], sv: ['burk', 'burkar'] },
  pinch: { de: ['Prise', 'Prisen'], sv: ['nypa', 'nypor'] },
  dash: { de: ['Spritzer', 'Spritzer'], sv: ['skvätt', 'skvättar'] },
  handful: { de: ['Handvoll', 'Handvoll'], sv: ['näve', 'nävar'] },
  slice: { de: ['Scheibe', 'Scheiben'], sv: ['skiva', 'skivor'] },
  bunch: { de: ['Bund', 'Bund'], sv: ['knippe', 'knippen'] },
  sprig: { de: ['Zweig', 'Zweige'], sv: ['kvist', 'kvistar'] },
  stick: { de: ['Stange', 'Stangen'], sv: ['stång', 'stänger'] },
  pack: { de: ['Packung', 'Packungen'], sv: ['förpackning', 'förpackningar'] },
  jar: { de: ['Glas', 'Gläser'], sv: ['burk', 'burkar'] },
  piece: { de: ['Stück', 'Stück'], sv: ['st', 'st'] },
  cup: { de: ['Tasse', 'Tassen'], sv: ['kopp', 'koppar'] },
  oz: { de: ['oz', 'oz'], sv: ['oz', 'oz'] },
  lb: { de: ['lb', 'lb'], sv: ['lb', 'lb'] },
  floz: { de: ['fl oz', 'fl oz'], sv: ['fl oz', 'fl oz'] },
  pint: { de: ['Pint', 'Pints'], sv: ['pint', 'pint'] },
  quart: { de: ['Quart', 'Quarts'], sv: ['quart', 'quart'] },
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
 * lang 'en' only converts units (when metric); 'de'/'sv' translate known words too.
 */
export function translateIngredient(measure: string, name: string, lang: string, units: 'metric' | 'us'): TranslatedLine {
  const origLine = [measure.trim(), name.trim()].filter(Boolean).join(' ');
  const target: Target | null = lang === 'de' || lang === 'sv' ? lang : null;
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
    for (const [re, de, sv] of [...PREP, ...SIZE]) if (re.test(notes)) notes = notes.replace(re, target === 'de' ? de : sv);
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
const TAGS: Record<string, [string, string]> = {
  beef: ['Rind', 'Nötkött'], chicken: ['Hähnchen', 'Kyckling'], dessert: ['Dessert', 'Efterrätt'], lamb: ['Lamm', 'Lamm'],
  miscellaneous: ['Verschiedenes', 'Blandat'], pasta: ['Pasta', 'Pasta'], pork: ['Schwein', 'Fläsk'], seafood: ['Meeresfrüchte', 'Skaldjur'],
  side: ['Beilage', 'Tillbehör'], starter: ['Vorspeise', 'Förrätt'], vegan: ['Vegan', 'Vegan'], vegetarian: ['Vegetarisch', 'Vegetariskt'],
  breakfast: ['Frühstück', 'Frukost'], goat: ['Ziege', 'Get'],
  american: ['Amerikanisch', 'Amerikanskt'], british: ['Britisch', 'Brittiskt'], canadian: ['Kanadisch', 'Kanadensiskt'], chinese: ['Chinesisch', 'Kinesiskt'],
  croatian: ['Kroatisch', 'Kroatiskt'], dutch: ['Niederländisch', 'Holländskt'], egyptian: ['Ägyptisch', 'Egyptiskt'], filipino: ['Philippinisch', 'Filippinskt'],
  french: ['Französisch', 'Franskt'], greek: ['Griechisch', 'Grekiskt'], indian: ['Indisch', 'Indiskt'], irish: ['Irisch', 'Irländskt'],
  italian: ['Italienisch', 'Italienskt'], jamaican: ['Jamaikanisch', 'Jamaicanskt'], japanese: ['Japanisch', 'Japanskt'], kenyan: ['Kenianisch', 'Kenyanskt'],
  malaysian: ['Malaysisch', 'Malaysiskt'], mexican: ['Mexikanisch', 'Mexikanskt'], moroccan: ['Marokkanisch', 'Marockanskt'], polish: ['Polnisch', 'Polskt'],
  portuguese: ['Portugiesisch', 'Portugisiskt'], russian: ['Russisch', 'Ryskt'], spanish: ['Spanisch', 'Spanskt'], thai: ['Thailändisch', 'Thailändskt'],
  tunisian: ['Tunesisch', 'Tunisiskt'], turkish: ['Türkisch', 'Turkiskt'], ukrainian: ['Ukrainisch', 'Ukrainskt'], vietnamese: ['Vietnamesisch', 'Vietnamesiskt'],
};
export function translateTag(tag: string, lang: string): string {
  const e = TAGS[tag.toLowerCase().trim()];
  if (!e || (lang !== 'de' && lang !== 'sv')) return tag;
  return e[lang === 'de' ? 0 : 1];
}
