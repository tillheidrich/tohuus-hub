/**
 * Self-hosted language on first start (UX audit 2026-10, P1-11, Paket D): a new self-hosted ToHuus used to greet
 * everyone in English, even when the browser said `de-DE`. Now, as long as nobody chose a language (no LANGUAGE in
 * the environment, no `language` setting in the household), the server answers in the browser's language
 * (Accept-Language) and falls back to German – ToHuus speaks German first. The first admin who opens the app fixes
 * that choice for the household (mails, pushes, new categories follow it); Settings › Household changes it later.
 * ToHuus Cloud is not affected: there the household language is chosen at sign-up.
 */
import type { Request } from 'express';
import { config } from '../config.js';
import { getSetting, lang, setSetting } from '../db.js';
import { isLang, type Lang } from '../languages.js';

/** Fallback when the browser names no supported language */
export const FIRST_LANGUAGE: Lang = 'de';

/** The first supported language of an Accept-Language header, by weight ("de-AT,de;q=0.9,en;q=0.8" → de). */
export function langFromHeader(header: string | null | undefined): Lang | null {
  if (!header) return null;
  const parts = header
    .split(',')
    .map((p, i) => {
      const [tag, ...params] = p.trim().split(';');
      const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
      return { base: tag.trim().toLowerCase().split(/[-_]/)[0], q: q ? Number(q.slice(2)) : 1, i };
    })
    .filter((x) => x.base && x.base !== '*' && Number.isFinite(x.q) && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  const hit = parts.find((x) => isLang(x.base));
  return hit ? (hit.base as Lang) : null;
}

/** Did someone choose the language – the environment (LANGUAGE) or a household setting? */
export function languageChosen(): boolean {
  if (config.multiTenant) return true;
  if (isLang(process.env.LANGUAGE)) return true;
  return getSetting<string | null>('language', null) !== null;
}

/** The language a self-hosted server speaks to this request before anyone chose one. */
export function requestLang(req: Pick<Request, 'headers'>): Lang {
  if (languageChosen()) return lang();
  return langFromHeader(req.headers['accept-language']) ?? FIRST_LANGUAGE;
}

/**
 * The first admin who opens the app fixes the household language (self-hosted only, once) – from the language the
 * browser or iPhone sends. Without a supported Accept-Language (scripts, API clients) nothing is fixed yet.
 */
export function adoptRequestLang(req: Pick<Request, 'headers'>, admin: boolean): void {
  if (!admin || languageChosen()) return;
  const l = langFromHeader(req.headers['accept-language']);
  if (l) setSetting('language', l);
}
