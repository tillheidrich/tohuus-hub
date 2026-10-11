import { t } from './i18n';

/**
 * One brand since wave 6 (Dutch Detail): ToHuus. The former second look (Fredirando) was retired; the household
 * name stays whatever the household set. Kept as a tiny module so title / logo / tagline live in one place.
 */
export type BrandKey = 'tohuus';

export const BRAND = {
  name: 'ToHuus Hub',
  logo: '/tohuus-logo.svg',
  get tagline() {
    return t('Less on your mind. More at home.');
  },
};

/** @deprecated single brand – use BRAND */
export const BRANDS: Record<BrandKey, typeof BRAND> = { tohuus: BRAND };

export function currentBrand(): BrandKey {
  return 'tohuus';
}

/** Sets the document title; any old data-brand attribute from a cached page is removed. */
export function applyBrand(_b?: string) {
  delete document.documentElement.dataset.brand;
  document.title = BRAND.name;
  return BRAND;
}
