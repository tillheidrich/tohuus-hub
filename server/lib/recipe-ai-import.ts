/**
 * Recipe imports that may need a model (area: recipes2, October 2026):
 *
 * - **Social media share** (Instagram, TikTok, Pinterest, YouTube): only what is public without a login – the text
 *   the person shared along (caption), the page's public metadata (oEmbed, og:title/og:description/og:image,
 *   JSON-LD) – never anything behind a login, no scraping of feeds or comments. A recipe in the caption is read by
 *   the model (counted as `importAi`); a video without recipe text becomes a recipe stub with title, link and the
 *   public still image, to be completed by hand or from a photo.
 * - **Cookidoo links in the cloud**: nothing is fetched from Cookidoo. The recipe keeps title + link + the ingredient
 *   list the person confirmed (pasted, or read from their own screenshot), no steps, no photos; cooking happens in
 *   Cookidoo ("Zum Kochen in Cookidoo öffnen"), an own photo of the dish is welcome.
 * - **Photos and screenshots**: cookbook page, handwritten note, screenshot, photo of a Thermomix or other appliance
 *   display → ingredients, steps and appliance steps (vision prompt in vision.ts).
 *
 * Every model call goes through vision.ts → ai.ts (central AI switch, Mistral pin, quotas).
 */
import { config } from '../config.js';
import { db } from '../db.js';
import { t, userError } from '../i18n.js';
import { emit } from './bus.js';
import { safeFetch } from './net.js';
import { cleanText, findRecipeNode, jsonLdBlocks, lenientJson, oneLine } from './recipe-jsonld.js';
import { saveRecipe, type RecipeInput } from './recipes.js';
import { bulkImport, setRecipeImageUrl } from './recipes2.js';
import { runVision, visionAvailable } from './vision.js';

export type Platform = 'instagram' | 'tiktok' | 'pinterest' | 'youtube';

/** A message for the person with an HTTP status (400 wrong input, 501 needs AI). */
const fail = (message: string, status = 400) => Object.assign(userError(message), { status });

const HOSTS: [RegExp, Platform][] = [
  [/(^|\.)instagram\.com$|(^|\.)instagr\.am$/i, 'instagram'],
  [/(^|\.)tiktok\.com$/i, 'tiktok'],
  [/(^|\.)pinterest\.[a-z.]+$|(^|\.)pin\.it$/i, 'pinterest'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/i, 'youtube'],
];

export function platformOf(url: string): Platform | null {
  try {
    const h = new URL(url).hostname;
    return HOSTS.find(([re]) => re.test(h))?.[1] ?? null;
  } catch {
    return null;
  }
}

export const PLATFORM_LABEL: Record<Platform, string> = { instagram: 'Instagram', tiktok: 'TikTok', pinterest: 'Pinterest', youtube: 'YouTube' };

/** The link without tracking parameters (igsh, utm_*, si, …) – used to find a recipe imported before. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|igsh|igshid|si|feature|_r|_t|is_from_webapp|sender_device|share_|fbclid|mibextid)/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1).split('/')[0] || null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{6,})/);
    return m?.[2] ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ public metadata (no login)

export interface PageFetch {
  ok: boolean;
  status: number;
  url: string;
  body: string;
}
export type PageFetcher = (url: string) => Promise<PageFetch>;

const defaultFetcher: PageFetcher = async (url) => {
  const r = await safeFetch(url, {
    maxBytes: 3 * 1024 * 1024,
    timeoutMs: 12000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ToHuus Hub recipe import)', Accept: 'text/html,application/json;q=0.9,*/*;q=0.5' },
  });
  return { ok: r.ok, status: r.status, url: r.url ?? url, body: r.buf.toString("utf8") };
};
let fetcher: PageFetcher = defaultFetcher;
/** Tests: serve pages without the network. Pass null to restore the real (SSRF-safe) fetch. */
export function setSocialFetch(f: PageFetcher | null) {
  fetcher = f ?? defaultFetcher;
}

export interface SocialMeta {
  title: string | null;
  description: string | null;
  image: string | null;
  author: string | null;
  /** a schema.org Recipe on the public page (Pinterest pins sometimes have one) */
  recipeLd: any | null;
  /** the page wanted a login – nothing from it was used */
  loginWall: boolean;
}

const meta = (html: string, key: string) => {
  const re = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${key.replace(/[.:]/g, '\\$&')}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const content = tag?.match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
  const v = content ? (content[1] ?? content[2]) : null;
  return v ? cleanText(v) || null : null;
};

const LOGIN_WALL = /accounts\/login|\/login\b|loginForm|"requireLogin"|Log in to (see|continue)|Melde dich an/i;
const httpsImage = (u: string | null | undefined) => (u && /^https:\/\//i.test(u) && u.length < 2000 ? u : null);

async function oembed(endpoint: string): Promise<any | null> {
  try {
    const r = await fetcher(endpoint);
    if (!r.ok) return null;
    return lenientJson(r.body) ?? null;
  } catch {
    return null;
  }
}

/** What the platform shows anyone without a login. Never throws; an empty result means "nothing public". */
export async function socialMeta(url: string, platform: Platform): Promise<SocialMeta> {
  const out: SocialMeta = { title: null, description: null, image: null, author: null, recipeLd: null, loginWall: false };
  if (platform === 'youtube') {
    const o = await oembed(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    if (o) {
      out.title = typeof o.title === 'string' ? oneLine(o.title) : null;
      out.author = typeof o.author_name === 'string' ? o.author_name : null;
      out.image = httpsImage(o.thumbnail_url);
    }
    const id = youtubeId(url);
    if (id && !out.image) out.image = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }
  if (platform === 'tiktok') {
    const o = await oembed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (o) {
      // TikTok's oEmbed title is the caption
      out.description = typeof o.title === 'string' ? cleanText(o.title) : null;
      out.author = typeof o.author_name === 'string' ? o.author_name : null;
      out.image = httpsImage(o.thumbnail_url);
    }
  }
  try {
    const r = await fetcher(url);
    const body = r.body ?? '';
    if (LOGIN_WALL.test(r.url) || (!meta(body, 'og:title') && LOGIN_WALL.test(body.slice(0, 200_000)))) out.loginWall = true;
    else if (r.ok) {
      out.title ??= meta(body, 'og:title') ?? meta(body, 'twitter:title') ?? (body.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1] ? cleanText(body.match(/<title[^>]*>([^<]{1,300})<\/title>/i)![1]) : null);
      const desc = meta(body, 'og:description') ?? meta(body, 'description') ?? meta(body, 'twitter:description');
      if (desc && (!out.description || desc.length > out.description.length)) out.description = desc;
      out.image ??= httpsImage(meta(body, 'og:image') ?? meta(body, 'twitter:image'));
      for (const b of jsonLdBlocks(body)) {
        const node = findRecipeNode(b);
        if (node) {
          out.recipeLd = node;
          break;
        }
      }
    }
  } catch {
    /* a public page that does not answer is not an error – the shared text may be enough */
  }
  return out;
}

// ------------------------------------------------------------------ does the text hold a recipe?

const AMOUNT_LINE = /^\s*[-•*▪️✅🔸🔹]?\s*(\d+([.,/]\d+)?|[½¼¾⅓⅔])\s*(g|kg|ml|l|el|tl|stk|stück|prise|dose|dosen|bund|zehen?|tbsp|tsp|cups?|oz|lb|pck|packung|becher|scheiben?|handvoll)?\b/i;
const RECIPE_WORDS = /\b(zutaten|ingredients|zubereitung|so geht'?s|anleitung|instructions|method|directions|rezept|recipe)\b/i;

/** A caption with an ingredient list (or at least the words and a few amounts) – worth a model call. */
export function looksLikeRecipeText(text: string): boolean {
  const lines = text.split(/\n|(?<=\.)\s+(?=[-•*\d])/).map((l) => l.trim()).filter(Boolean);
  const amounts = lines.filter((l) => AMOUNT_LINE.test(l)).length;
  const inline = (text.match(/\b\d+\s?(g|ml|el|tl|tbsp|tsp|cups?)\b/gi) ?? []).length;
  return amounts >= 3 || (RECIPE_WORDS.test(text) && amounts + inline >= 2) || inline >= 4;
}

// ------------------------------------------------------------------ model output → recipe

const s = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Model JSON (vision.ts recipe / text-recipe) → RecipeInput, or null when there is nothing usable. */
export function modelToRecipe(j: any): RecipeInput | null {
  if (!j || typeof j !== 'object') return null;
  const ingredients = Array.isArray(j.ingredients)
    ? j.ingredients
        .filter((i: any) => i && typeof i.text === 'string' && i.text.trim())
        .slice(0, 150)
        .map((i: any) => ({ text: i.text.trim().slice(0, 300), qty: n(i.qty), unit: s(i.unit, 20), pantry: Boolean(i.pantry) }))
    : [];
  const steps = Array.isArray(j.steps)
    ? j.steps
        .filter((x: any) => x && typeof x.text === 'string' && x.text.trim())
        .slice(0, 120)
        .map((x: any) => {
          const tm = x.tm && typeof x.tm === 'object' ? { time: s(x.tm.time, 60), temp: s(x.tm.temp ?? x.tm.temperature, 60), speed: x.tm.speed == null ? null : s(String(x.tm.speed), 60), device: s(x.tm.device, 80), mode: s(x.tm.mode, 60) } : null;
          const has = tm && (tm.time || tm.temp || tm.speed || tm.mode);
          return { text: x.text.trim().slice(0, 3000), tm: has ? tm : null };
        })
    : [];
  if (!ingredients.length && !steps.length) return null;
  return {
    title: s(j.title, 200) ?? t('Recipe'),
    description: s(j.description, 2000),
    servings: n(j.servings),
    time_min: n(j.time_min),
    thermomix: Boolean(j.thermomix) || steps.some((x: any) => /thermomix|\btm\s?[4-7]\b/i.test(x.tm?.device ?? '')),
    tags: Array.isArray(j.tags) ? j.tags.filter((x: unknown) => typeof x === 'string').slice(0, 8) : [],
    ingredients,
    steps,
  };
}

/** Without a model: first line = title, lines with amounts = ingredients, the rest = steps. */
export function plainTextRecipe(text: string): RecipeInput {
  const lines = text.split('\n').map((l) => l.replace(/^\s*[-•*▪️✅🔸🔹]\s*/u, '').trim()).filter(Boolean);
  const [title, ...rest] = lines;
  return {
    title: (title ?? t('Recipe')).slice(0, 200),
    ingredients: rest.filter((l) => AMOUNT_LINE.test(l)).map((l) => ({ text: l.slice(0, 300) })),
    steps: rest.filter((l) => !AMOUNT_LINE.test(l) && !RECIPE_WORDS.test(l.replace(/[:：]$/, '')) ).map((l) => ({ text: l.slice(0, 3000) })),
  };
}

// ------------------------------------------------------------------ social import

export interface SocialResult {
  id: number;
  platform: Platform;
  /** the post had no recipe text – title, link and photo only */
  incomplete: boolean;
  /** a model read the caption */
  ai: boolean;
  /** this link was imported before – nothing new created */
  existed: boolean;
}

const existingByUrl = (url: string) => (db.prepare('SELECT id FROM recipes WHERE source_url = ? ORDER BY id LIMIT 1').get(url) as { id: number } | undefined)?.id ?? null;

/** Captions often end in hashtags and "link in bio" – keep the useful part for the model and the notes. */
export const cleanCaption = (text: string) =>
  text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/(\s#[\p{L}\p{N}_]+)+\s*$/gu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 20000);

export async function importSocial(input: { url: string; text?: string | null }): Promise<SocialResult> {
  const platform = platformOf(input.url);
  if (!platform) throw fail(t('That is not a link from Instagram, TikTok, Pinterest or YouTube.'));
  const url = canonicalUrl(input.url);
  const before = existingByUrl(url);
  if (before) return { id: before, platform, incomplete: false, ai: false, existed: true };
  const m = await socialMeta(url, platform);
  // a public recipe card on the page (Pinterest): the normal import, no model needed
  if (m.recipeLd) {
    const out = await bulkImport([{ ...m.recipeLd, url, source_type: platform, image: m.recipeLd.image ?? m.image }]);
    if (out.ids[0]) return { id: out.ids[0], platform, incomplete: false, ai: false, existed: false };
  }
  const caption = cleanCaption([input.text ?? '', m.description ?? ''].filter(Boolean).join('\n\n'));
  let rec: RecipeInput | null = null;
  let ai = false;
  if (caption && looksLikeRecipeText(caption)) {
    if (visionAvailable()) {
      rec = modelToRecipe(await runVision('text-recipe', { text: `${m.title ? m.title + '\n' : ''}${caption}` }));
      ai = Boolean(rec);
    }
    rec ??= plainTextRecipe(caption);
    if (!rec.ingredients?.length && !rec.steps?.length) rec = null;
  }
  const incomplete = !rec;
  const title = (rec?.title && rec.title !== t('Recipe') ? rec.title : null) ?? titleFrom(m.title, caption, platform);
  const id = saveRecipe({
    ...(rec ?? { ingredients: [], steps: [] }),
    title,
    source_type: platform,
    source_url: url,
    description: rec?.description ?? (incomplete && caption ? caption.slice(0, 400) : null),
    notes: incomplete ? t('The post had no recipe text. Add ingredients and steps, or a photo of the recipe.') : null,
  });
  // the public still image of the post (or the video thumbnail) – downloaded through the SSRF-safe fetch
  if (m.image) await setRecipeImageUrl(id, m.image).catch(() => false);
  emit('recipes');
  return { id, platform, incomplete, ai, existed: false };
}

function titleFrom(title: string | null, caption: string, platform: Platform): string {
  // og:title on Instagram looks like "Mira on Instagram: "Linsencurry …"" – take the quoted part
  const quoted = title?.match(/[:：]\s*["“„](.+?)["”“]?$/)?.[1];
  const first = caption.split('\n').map((l) => l.trim()).find((l) => l.length > 2 && !/^#/.test(l));
  const pick = quoted ?? (title && !/^(instagram|tiktok|pinterest|youtube)$/i.test(title.trim()) ? title : null) ?? first ?? t('Recipe from {platform}', { platform: PLATFORM_LABEL[platform] });
  return oneLine(pick).replace(/\s*[|–-]\s*(YouTube|TikTok|Pinterest|Instagram)\s*$/i, '').slice(0, 120);
}

// ------------------------------------------------------------------ Cookidoo (cloud: nothing fetched)

export const isCookidooUrl = (url: string) => {
  try {
    return /(^|\.)cookidoo\.[a-z.]+$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
};
export const cookidooRecipeId = (url: string) => url.match(/cookidoo\.[a-z.]+\/.*?\/(r\d+)(?:[/?#]|$)/i)?.[1] ?? null;

/** Cookidoo is never contacted from the cloud; self-hosted servers keep the public-page import. */
export const cookidooConfirmNeeded = (url: string) => config.multiTenant && isCookidooUrl(url);

/** A title out of what the Cookidoo app shares ("Schau dir dieses Rezept an: Linsencurry https://cookidoo…"). */
export function cookidooTitleFrom(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^(schau dir (doch )?(mal )?dieses rezept an|check out this recipe|ich habe ein rezept für dich|rezept|recipe)\s*[:!-]?\s*/i, '')
    .replace(/\s*(auf|on)\s+cookidoo.*$/i, '')
    .trim();
  return s ? oneLine(s).slice(0, 120) : null;
}

/** The draft the app shows for confirmation – nothing fetched. */
export function cookidooDraft(url: string, sharedText?: string | null) {
  return { url: canonicalUrl(url), external_id: cookidooRecipeId(url), title: cookidooTitleFrom(sharedText) ?? '', ingredients: [] as string[] };
}

/** Save what the person confirmed: title + link + ingredients. No steps, no photos – cooking happens in Cookidoo. */
export async function saveCookidoo(input: { url: string; title: string; ingredients: string[]; servings?: number | null; time_min?: number | null }): Promise<{ id: number; created: boolean }> {
  if (!isCookidooUrl(input.url)) throw fail(t('That is not a Cookidoo link.'));
  const ingredients = input.ingredients.map((l) => oneLine(l).slice(0, 300)).filter(Boolean).slice(0, 150);
  if (!ingredients.length) throw fail(t('Add the ingredients – copy them from Cookidoo or take a screenshot.'));
  const out = await bulkImport([
    {
      name: input.title.trim().slice(0, 200) || t('Cookidoo recipe'),
      url: canonicalUrl(input.url),
      source_type: 'cookidoo',
      external_id: cookidooRecipeId(input.url),
      recipeIngredient: ingredients,
      recipeInstructions: [],
      instructions_available: false,
      thermomix: true,
      ...(input.servings ? { recipeYield: input.servings } : {}),
      ...(input.time_min ? { totalTime: input.time_min } : {}),
    },
  ]);
  if (!out.ids[0]) throw userError(out.errors[0]?.error ?? t('Import failed.'));
  return { id: out.ids[0], created: out.created === 1 };
}

/** Read an ingredient list from the person's own screenshot (Cookidoo app, a cookbook) – shown for confirmation, not saved. */
export async function readIngredients(images: string[]): Promise<{ title: string | null; ingredients: string[]; servings: number | null }> {
  if (!visionAvailable()) throw fail(t('Reading photos needs AI. Copy the ingredients and paste them instead.'), 501);
  const j = await runVision('ingredients', { images });
  const list = Array.isArray(j?.ingredients) ? j.ingredients.map((x: any) => (typeof x === 'string' ? x : typeof x?.text === 'string' ? x.text : '')).map((x: string) => oneLine(x)).filter(Boolean).slice(0, 150) : [];
  return { title: s(j?.title, 200), ingredients: list, servings: n(j?.servings) };
}
