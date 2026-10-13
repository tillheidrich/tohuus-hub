/**
 * "So geht's" links to the help articles on the website. The slugs are the contract with the website
 * (docs/help-slugs.md – test/help-slugs.test.ts keeps both lists equal). Never rename a slug.
 */
import { Question } from '@phosphor-icons/react';
import { t } from './i18n';
import { SITE_URL } from './urls';

export const HELP_BASE = `${SITE_URL}/hilfe/`;

export const HELP_SLUGS = [
  'erste-schritte',
  'so-funktioniert-tohuus',
  'einkaufsliste',
  'merkt-sich',
  'kassenbons',
  'vorrat',
  'kochen',
  'rezepte-importieren',
  'rezeptpaket',
  'cookidoo',
  'geld',
  'sprechen',
  'ki-an-oder-aus',
  'hausinfo',
  'hausinfo-codes',
  'babysitter',
  'gaeste',
  'haushalt-teilen',
  'wer-sieht-was',
  'daten-export',
  'home-assistant',
  'gut-zu-wissen',
  'gemeinsam-einkaufen',
  'benachrichtigungen',
  'claude-chatgpt',
  'erinnerungen-spiegeln',
  'umzug-in-die-cloud',
  'selbst-hosten',
  'datenschutz-kurz',
  'abo-und-kuendigen',
  'fragen',
] as const;
export type HelpSlug = (typeof HELP_SLUGS)[number];

export const helpUrl = (slug: HelpSlug) => `${HELP_BASE}${slug}.html`;

/** Small "So geht's" link that opens the help article in a new tab. */
export function HowTo({ slug, label, className = '' }: { slug: HelpSlug; label?: string; className?: string }) {
  return (
    <a className={`howto ${className}`} href={helpUrl(slug)} target="_blank" rel="noopener noreferrer">
      <Question size={15} aria-hidden="true" />
      <span>{label ?? t('How it works')}</span>
    </a>
  );
}

/** Which help article belongs to a screen (the shell shows it under the page). */
const ROUTE_HELP: [RegExp, HelpSlug][] = [
  [/^\/$/, 'merkt-sich'],
  [/^\/einkauf/, 'einkaufsliste'],
  [/^\/bestand$/, 'vorrat'],
  [/^\/wo$/, 'babysitter'],
  [/^\/kochen/, 'kochen'],
  [/^\/geld/, 'geld'],
  [/^\/import$/, 'kassenbons'],
  [/^\/merkt-sich/, 'merkt-sich'],
  [/^\/urlaub/, 'babysitter'],
  [/^\/bar/, 'gaeste'],
];

/** "So geht's" under the current screen – null where the page has its own link or there is no article. */
export function RouteHelp({ path }: { path: string }) {
  const slug = ROUTE_HELP.find(([re]) => re.test(path))?.[1];
  if (!slug) return null;
  return (
    <div className="route-help">
      <HowTo slug={slug} />
    </div>
  );
}
