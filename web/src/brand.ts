import { t } from './i18n';

export type BrandKey = 'tohuus' | 'fredirando';

export const BRANDS: Record<BrandKey, { name: string; logo: string; tagline: string }> = {
  tohuus: {
    name: 'ToHuus Hub',
    logo: '/tohuus-logo.svg',
    get tagline() {
      return t('Your home. Organized.');
    },
  },
  fredirando: {
    name: 'Fredirando',
    logo: '/fredirando.svg',
    get tagline() {
      return t('Ordered. Delivered. From kitchen & pantry.');
    },
  },
};

export function currentBrand(): BrandKey {
  return document.documentElement.dataset.brand === 'fredirando' ? 'fredirando' : 'tohuus';
}

export function applyBrand(b: string | undefined) {
  const key: BrandKey = b === 'fredirando' ? 'fredirando' : 'tohuus';
  if (key === 'fredirando') document.documentElement.dataset.brand = 'fredirando';
  else delete document.documentElement.dataset.brand;
  document.title = BRANDS[key].name;
  return BRANDS[key];
}
