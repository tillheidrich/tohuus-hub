/**
 * Category keywords for English (UK + US) and Swedish product names, as printed on receipts and shelves.
 * catalog.ts guessCategory() asks these first when the household region shops in that language, so
 * "OVEN CHIPS" lands in frozen in the UK and "Krossade tomater" in the pantry in Sweden.
 * German rules stay in catalog.ts and keep priority for German households.
 */
import type { CategoryKey } from './basedata.js';
import { region } from './region.js';

type Rule = [RegExp, CategoryKey];

/** whole word (letters incl. å ä ö on both sides) */
const w = (words: string) => new RegExp(`(?<!\\p{L})(?:${words})(?!\\p{L})`, 'iu');
/** word ending (Swedish compounds put the head noun last: "mellanmjölk", "fullkornsbröd") */
const end = (words: string) => new RegExp(`(?:${words})(?!\\p{L})`, 'iu');

export const EN_RULES: Rule[] = [
  [w('ice cream|gelato|ice lolly|ice lollies|popsicles?|sorbet|frozen yogh?urt|cornetto|magnum|ben & jerry\'?s|haagen[- ]dazs'), 'icecream'],
  [w('frozen|froz|fish fingers|fish sticks|oven chips|hash browns|frozen peas|tater tots|waffles frz|pizza'), 'frozen'],
  [w('washing[- ]up liquid|dish ?soap|dishwasher (?:tablets|tabs|pods)|laundry|detergent|fabric conditioner|softener|bleach|cleaner|kitchen roll|paper towels?|toilet (?:roll|tissue|paper)|bath tissue|tissues|bin (?:bags|liners)|trash bags|foil|cling film|plastic wrap|zip(?:lock|loc)? bags|batteries|light bulbs?|sponges?|tape|candles?'), 'household'],
  [w('toothpaste|toothbrush|shampoo|conditioner|shower gel|body wash|deodorant|deo|nappies|diapers|baby wipes|wipes|soap|plasters|band[- ]aids?|razors?|tampons|sanitary|lotion|moisturi[sz]er|sunscreen|mouthwash|floss'), 'toiletries'],
  [w('chopped tomatoes|tinned tomatoes|canned tomatoes|tomato (?:paste|puree|purée|sauce)|passata|baked beans|kidney beans|black beans|chickpeas|lentils|stock cubes?|broth|bouillon'), 'pantry'],
  [w('juice|water|sparkling|seltzer|beer|lager|ale|cider|wine|prosecco|soda|pop|cola|coke|pepsi|sprite|lemonade|squash|cordial|energy drink|kombucha|\\d+ ?pk|\\d+pk|12 ?pack|2 ?l|2l'), 'drinks'],
  [w('bananas?|apples?|pears?|grapes|berries|strawberries|blueberries|raspberries|lemons?|limes?|oranges?|clementines?|satsumas?|mandarins?|avocados?|melons?|mangoe?s?|pineapples?|kiwis?|cucumbers?|tomato(?:es)?|peppers?|bell peppers?|courgettes?|zucchini|aubergines?|eggplants?|broccoli|cauliflower|potato(?:es)?|sweet potato(?:es)?|onions?|scallions|spring onions|garlic|carrots?|celery|mushrooms?|lettuce|salad|spinach|kale|cabbage|leeks?|cilantro|coriander|parsley|basil|herbs|loose|organic produce|produce'), 'produce'],
  [w('milk|semi skimmed|skimmed|whole milk|half ?& ?half|creamer|cream|cheese|cheddar|mozzarella|feta|brie|parmesan|yogh?urt|butter|margarine|spread|eggs?|ham|bacon|sausages?|hot dogs|deli|turkey|chicken|beef|ground beef|mince|pork|lamb|salmon|cod|tuna steaks?|prawns|shrimp|hummus|tofu|fresh pasta|lg eggs'), 'chilled'],
  [w('pasta|spaghetti|penne|noodles|rice|flour|sugar|oats|porridge|cereal|cheerios|corn ?flakes|granola|muesli|lentils|beans|tinned|canned|soup|vinegar|oil|olive oil|spices?|herbs|salt|pepper|ketchup|mayo(?:nnaise)?|mustard|jam|peanut butter|honey|coffee|tea|pg tips|teabags|tea bags'), 'pantry'],
  [w('bread|loaf|toastie|sourdough|rolls|baps|buns|bagels?|wraps|tortillas|croissants?|muffins|crumpets|pitta|pita|baguette'), 'bakery'],
  [w('crisps|chips|pretzels|popcorn|chocolate|biscuits?|cookies?|sweets|candy|gummies|crackers|cereal bars?|granola bars?|nuts|doritos|pringles|kitkat|oreos?'), 'snacks'],
];

export const SV_RULES: Rule[] = [
  [w('glass|gräddglass|glasspinne|glasstrut|sorbet|magnum|cornetto'), 'icecream'],
  [w('fryst|frysta|djupfryst|fiskpinnar|pommes frites|pommes|frysta grönsaker|pizza'), 'frozen'],
  [end('diskmedel|tvättmedel|sköljmedel|maskindisk|disktabletter|rengöring|allrengöring|toalettpapper|hushållspapper|soppåsar|sopsäckar|aluminiumfolie|plastfolie|fryspåsar|batterier|glödlampa|disksvamp|stearinljus|värmeljus|kronljus'), 'household'],
  [end('tandkräm|tandborste|schampo|balsam|duschtvål|duschkräm|deodorant|deo|blöjor|våtservetter|tvål|plåster|bindor|tamponger|hudkräm|solkräm|munskölj'), 'toiletries'],
  [w('krossade tomater|tomatpuré|passerade tomater|kokosmjölk|buljong|buljongtärning|kikärtor|bönor|linser'), 'pantry'],
  [end('läsk|juice|vatten|mineralvatten|kolsyrat|öl|lättöl|folköl|vin|cider|saft|must|cola|energidryck'), 'drinks'],
  [end('banan|bananer|äpple|äpplen|päron|apelsin|apelsiner|citron|lime|vindruvor|druvor|bär|jordgubbar|blåbär|hallon|avokado|melon|mango|ananas|kiwi|gurka|tomat|tomater|paprika|potatis|sötpotatis|lök|rödlök|vitlök|morot|morötter|selleri|sallad|spenat|svamp|champinjoner|broccoli|blomkål|vitkål|purjolök|zucchini|aubergine|örter|dill|persilja|basilika'), 'produce'],
  [end('mjölk|mellanmjölk|lättmjölk|filmjölk|yoghurt|kvarg|grädde|crème fraiche|ost|smör|bregott|margarin|ägg|skinka|korv|falukorv|prinskorv|bacon|kyckling|kycklingfilé|fläsk|fläskfilé|nötfärs|köttfärs|blandfärs|kött|lax|torsk|räkor|tofu|hummus'), 'chilled'],
  [end('pasta|spaghetti|makaroner|penne|nudlar|ris|mjöl|vetemjöl|socker|havregryn|gryn|müsli|flingor|konserv|olja|olivolja|rapsolja|vinäger|kryddor|salt|peppar|ketchup|senap|majonnäs|sylt|honung|kaffe'), 'pantry'],
  [w('te|tepåsar'), 'pantry'],
  [w('fil'), 'chilled'],
  [end('bröd|limpa|frallor|bullar|bulle|knäckebröd|tunnbröd|kanelbulle|baguette|tortilla|wraps'), 'bakery'],
  [end('chips|choklad|godis|lösgodis|kakor|kex|ostbågar|popcorn|nötter|marabou|snacks|bars'), 'snacks'],
];

/** Rules in the order guessCategory should try them, before (`first`) and after (`last`) the German rules. */
export function regionCategoryRules(): { first: Rule[]; last: Rule[] } {
  let pl: string;
  try {
    pl = region().productLang;
  } catch {
    pl = 'de';
  }
  if (pl === 'sv') return { first: SV_RULES, last: EN_RULES };
  if (pl === 'en') return { first: EN_RULES, last: SV_RULES };
  return { first: [], last: [...EN_RULES, ...SV_RULES] };
}
