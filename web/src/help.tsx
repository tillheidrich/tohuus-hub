/**
 * "So geht's" links to the help articles on the website. The slugs are the contract with the website
 * (docs/help-slugs.md – test/help-slugs.test.ts keeps both lists equal). Never rename a slug.
 */
import { Question } from '@phosphor-icons/react';
import { t } from './i18n';

export const HELP_BASE = 'https://tohuus.heidrich-digital.de/hilfe/';

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
