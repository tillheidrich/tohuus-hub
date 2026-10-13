/**
 * Recipe platforms of kitchen appliances (area: recipes2, October 2026): Cookidoo (Thermomix), Monsieur Cuisine
 * (Lidl), Home Connect (Bosch Cookit), Kenwood World, the Groupe SEB companions (Tefal, Moulinex, Krups), Magimix
 * Cook Expert, KitchenAid Cook Processor, Cecotec Mambo and Philips NutriU.
 *
 * ToHuus Cloud treats all of them like Cookidoo (decision 13 Oct 2026, docs/recipes-import.md): the server never
 * fetches their pages or photos. The recipe keeps title, link and what the person confirms (pasted text, their own
 * screenshots, their own AI over MCP). Self-hosted servers keep the normal page import.
 *
 * Public recipe sites with schema.org JSON-LD (Kitchen Stories, Ninja Kitchen …) are not in this list – they keep
 * the normal import.
 *
 * Pure module (no DB, no config): safe to import anywhere.
 */

export interface DevicePlatform {
  /** stored as the recipe's source_type ('cookidoo' stays 'cookidoo') */
  id: string;
  /** what the person sees: "Monsieur Cuisine-Rezept", "Schritte in Monsieur Cuisine" */
  label: string;
  /** the appliance the recipes are written for (kept as a tag on the recipe) */
  device: string;
  /** hostnames of the recipe pages and share links */
  hosts: RegExp[];
  /** brand sites that also sell other things: only links whose host + path look like a recipe */
  path?: RegExp;
  /** image CDNs the cloud never fetches from (besides the hosts above) */
  imageHosts?: RegExp[];
  /** the platform's own recipe id from a link, when the link carries one */
  recipeId?: (url: string) => string | null;
}

/** recipe words in the languages the brands use for their recipe pages */
const RECIPE_PATH = /recipe|rezept|recette|receta|ricetta|recept|przepis|receit/i;

export const DEVICE_PLATFORMS: DevicePlatform[] = [
  {
    id: 'cookidoo',
    label: 'Cookidoo',
    device: 'Thermomix',
    hosts: [/(^|\.)cookidoo\.[a-z.]+$/i],
    imageHosts: [/(^|\.)tmecosys\.com$/i],
    recipeId: (url) => url.match(/cookidoo\.[a-z.]+\/.*?\/(r\d+)(?:[/?#]|$)/i)?.[1] ?? null,
  },
  { id: 'monsieur-cuisine', label: 'Monsieur Cuisine', device: 'Monsieur Cuisine', hosts: [/(^|\.)monsieur-cuisine\.[a-z.]+$/i] },
  {
    id: 'cookit',
    label: 'Home Connect',
    device: 'Cookit',
    hosts: [/(^|\.)home-connect\.[a-z.]+$/i, /(^|\.)homeconnect\.page\.link$/i, /(^|\.)cookit\.bosch-home\.[a-z.]+$/i],
    imageHosts: [/(^|\.)home-connect\.[a-z.]+$/i],
  },
  { id: 'cookit', label: 'Home Connect', device: 'Cookit', hosts: [/(^|\.)bosch-home\.[a-z.]+$/i], path: /cookit/i },
  { id: 'kenwood', label: 'Kenwood World', device: 'Kenwood', hosts: [/(^|\.)kenwoodworld\.com$/i] },
  { id: 'tefal', label: 'Tefal', device: 'Tefal Companion', hosts: [/(^|\.)tefal\.[a-z.]+$/i], path: RECIPE_PATH, imageHosts: [/(^|\.)groupe-seb\.com$/i] },
  { id: 'moulinex', label: 'Moulinex', device: 'Moulinex Companion', hosts: [/(^|\.)moulinex\.[a-z.]+$/i], path: RECIPE_PATH, imageHosts: [/(^|\.)groupe-seb\.com$/i] },
  { id: 'krups', label: 'Krups', device: 'Krups Prep&Cook', hosts: [/(^|\.)krups\.[a-z.]+$/i], path: RECIPE_PATH, imageHosts: [/(^|\.)groupe-seb\.com$/i] },
  { id: 'magimix', label: 'Magimix', device: 'Cook Expert', hosts: [/(^|\.)magimix\.[a-z.]+$/i], path: RECIPE_PATH },
  { id: 'kitchenaid', label: 'KitchenAid', device: 'Cook Processor', hosts: [/(^|\.)kitchenaid\.[a-z.]+$/i], path: RECIPE_PATH },
  { id: 'cecotec', label: 'Cecotec Mambo', device: 'Mambo', hosts: [/(^|\.)cecotec\.[a-z.]+$/i], path: /mambo|recipe|rezept|recette|receta|ricetta|receit/i },
  { id: 'nutriu', label: 'NutriU', device: 'Philips', hosts: [/(^|\.)nutriu\.com$/i] },
];

/** The ids used as source_type (unique). */
export const DEVICE_PLATFORM_IDS: string[] = [...new Set(DEVICE_PLATFORMS.map((p) => p.id))];

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The appliance platform a recipe link belongs to, or null. */
export function devicePlatformOf(url: string | null | undefined): DevicePlatform | null {
  const u = url ? parse(url) : null;
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  return DEVICE_PLATFORMS.find((p) => p.hosts.some((re) => re.test(host)) && (!p.path || p.path.test(host + u.pathname))) ?? null;
}

/** The platform by its id (source_type), or null. */
export function devicePlatformById(id: string | null | undefined): DevicePlatform | null {
  return (id && DEVICE_PLATFORMS.find((p) => p.id === id)) || null;
}

/** True for a photo the cloud never downloads: the platform's own hosts (any path) and its image CDNs. */
export function isDevicePlatformImage(url: string): boolean {
  const u = parse(url);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  return DEVICE_PLATFORMS.some((p) => [...p.hosts, ...(p.imageHosts ?? [])].some((re) => re.test(host)));
}

/** The platform's recipe id from a link (Cookidoo: "r123456"), else null. */
export function devicePlatformRecipeId(url: string): string | null {
  return devicePlatformOf(url)?.recipeId?.(url) ?? null;
}
