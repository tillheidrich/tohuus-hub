/**
 * Recipe photos: which URL to show and which to download (area: recipes2, photos).
 *
 * A recipe can have a local copy (`image_path`, `/img/...`) and the link it came with (`image_url`).
 * Until the local copy exists the app shows the remote photo, so an import of hundreds of recipes has pictures
 * right away; once the download queue has stored the photo, the local copy is used.
 *
 * Cookidoo photos (assets.tmecosys.com, Cloudinary) are 4000+ px originals of several MB. Cloudinary serves
 * named size variants of the same asset; we use one of those for display and download (about 80 KB instead of
 * 2–5 MB – less memory for sharp on a small server, faster on a phone). The original stays the fallback.
 */
// the columns image_url / image_tries / image_error come from the recipes2 migrations – make sure they ran
// before any query uses recipeImageSql() (modules that join recipes may load before the recipes2 routes)
import './recipes2.js';

const TME_PLAIN = 'https://assets.tmecosys.com/image/upload/img/';
/** 876×720 – the 1.5× variant Cookidoo itself uses on recipe pages. */
export const TME_VARIANT = 't_web_rdp_recipe_584x480_1_5x';
const TME_SIZED = `https://assets.tmecosys.com/image/upload/${TME_VARIANT}/img/`;

/** A smaller CDN variant of the same photo (only where we know one), else the URL itself. */
export function sizedImageUrl(url: string): string {
  return url.startsWith(TME_PLAIN) ? TME_SIZED + url.slice(TME_PLAIN.length) : url;
}

/** URLs to try for a download, best first (sized variant, then the original). */
export function downloadCandidates(url: string): string[] {
  const sized = sizedImageUrl(url);
  return sized === url ? [url] : [sized, url];
}

/** What the app shows: the local copy, else the remote photo (https only – the CSP allows `img-src https:`). */
export function displayImage(r: { image_path?: string | null; image_url?: string | null }): string | null {
  if (r.image_path) return r.image_path;
  const u = r.image_url;
  return u && /^https:\/\//i.test(u) ? sizedImageUrl(u) : null;
}

/**
 * The same as displayImage() as an SQL expression for queries that join recipes (`AS image_path`).
 * `a` is the table alias of `recipes` in that query.
 */
export function recipeImageSql(a = 'r'): string {
  return `COALESCE(${a}.image_path, CASE WHEN ${a}.image_url LIKE '${TME_PLAIN}%' THEN REPLACE(${a}.image_url, '${TME_PLAIN}', '${TME_SIZED}') WHEN ${a}.image_url LIKE 'https://%' THEN ${a}.image_url END)`;
}
