/**
 * A friendly placeholder for a wish without a photo (20 Oct 2026): a symbol picked from words in the title, German and
 * English, entirely local – no image generation, no network. The server sends a key (`icon`); the web draws the
 * matching Phosphor icon (web/src/pages/wish-ui.tsx), the iPhone an SF Symbol (WishesView.swift), the guest page the
 * same as the web – so all three always agree.
 */
export const WISH_ICONS = [
  'bricks',
  'teddy',
  'game',
  'book',
  'bike',
  'ball',
  'shoe',
  'shirt',
  'music',
  'device',
  'beauty',
  'jewel',
  'flower',
  'coffee',
  'wine',
  'sweets',
  'kitchen',
  'tool',
  'garden',
  'paint',
  'camping',
  'ticket',
  'baby',
  'car',
  'home',
  'bag',
  'pet',
  'money',
  'gift',
] as const;
export type WishIcon = (typeof WISH_ICONS)[number];

const RULES: [RegExp, WishIcon][] = [
  [/lego|baustein|duplo|playmobil|bricks?\b/, 'bricks'],
  [/puppe|doll|barbie|teddy|plüsch|kuscheltier|stofftier|plush/, 'teddy'],
  [/spiel|game|puzzle|brettspiel|karten|switch|playstation|xbox|konsole|console/, 'game'],
  [/buch|bücher|book|roman|comic|manga|kindle|tolino/, 'book'],
  [/fahrrad|\brad\b|bike|bicycle|roller|scooter|skateboard|laufrad/, 'bike'],
  [/\bball\b|fußball|fussball|football|basketball|tennis|sport/, 'ball'],
  [/schuh|shoe|sneaker|stiefel|boots?\b|sandale/, 'shoe'],
  [/jacke|jacket|mantel|coat|pullover|pulli|hoodie|shirt|hose|kleid|dress|mütze|schal|socken|kleidung|clothes/, 'shirt'],
  [/kopfhörer|headphone|airpods|earbuds|lautsprecher|speaker|musik|music|vinyl|schallplatte/, 'music'],
  [/handy|phone|smartphone|tablet|ipad|laptop|computer|macbook|smartwatch|\buhr\b|watch|kamera|camera/, 'device'],
  [/parfum|perfume|kosmetik|creme|cream|lippenstift|makeup|make-up|nagellack/, 'beauty'],
  [/schmuck|kette|\bring\b|ohrring|armband|jewel|necklace|bracelet/, 'jewel'],
  [/blume|flower|pflanze|plant|orchidee|\brose\b/, 'flower'],
  [/kaffee|coffee|espresso|\btee\b|\btea\b|tasse|mug/, 'coffee'],
  [/wein|wine|sekt|champagner|bier|beer|\bgin\b|whisky/, 'wine'],
  [/schokolade|chocolate|praline|süßigkeit|sweets|kekse|cookies|kuchen|cake/, 'sweets'],
  [/küche|kitchen|topf|pfanne|\bpan\b|messer|knife|backen|baking|mixer|thermomix/, 'kitchen'],
  [/werkzeug|\btool|bohrmaschine|drill|akkuschrauber|säge|hammer/, 'tool'],
  [/garten|garden|\bgrill\b|bbq|hochbeet/, 'garden'],
  [/\bmal(en|kasten|stifte|buch)|buntstift|stifte|farben|paint|zeichnen|drawing|basteln|craft|knete/, 'paint'],
  [/zelt|tent|camping|rucksack|backpack|wandern|hiking/, 'camping'],
  [/reise|\btrip\b|urlaub|holiday|ticket|konzert|concert|kino|cinema|theater|gutschein|voucher|erlebnis/, 'ticket'],
  [/baby|schnuller|kinderwagen|stroller|windel|strampler/, 'baby'],
  [/\bauto\b|\bcar\b|bobbycar|eisenbahn|\btrain\b|\bzug\b|carrera/, 'car'],
  [/lampe|lamp|licht|light|kerze|candle|deko|decor|kissen|pillow|\bdecke\b|blanket/, 'home'],
  [/tasche|\bbag\b|handtasche|portemonnaie|wallet|geldbörse/, 'bag'],
  [/hund|\bdog\b|katze|\bcat\b|haustier|\bpet\b|aquarium/, 'pet'],
  [/geld|money|sparschwein|spende|donation/, 'money'],
];

/** The symbol key for a wish title; a gift when nothing fits. */
export function wishIcon(title: string): WishIcon {
  const s = title.toLowerCase();
  for (const [re, icon] of RULES) if (re.test(s)) return icon;
  return 'gift';
}
