import { t } from './i18n';

export type BrandKey = 'stockwerk' | 'fredirando';

export const BRANDS: Record<BrandKey, { name: string; logo: string; tagline: string }> = {
  stockwerk: {
    name: 'Stockwerk',
    logo: '/stockwerk-logo.svg',
    get tagline() {
      return t('What’s in the house. At a glance.');
    },
  },
  fredirando: {
    name: 'Fredirando',
    logo: '/fredirando.svg',
    get tagline() {
      return t('Ordered. Delivered. From kitchen & cellar.');
    },
  },
};

export function currentBrand(): BrandKey {
  return document.documentElement.dataset.brand === 'fredirando' ? 'fredirando' : 'stockwerk';
}

export function applyBrand(b: string | undefined) {
  const key: BrandKey = b === 'fredirando' ? 'fredirando' : 'stockwerk';
  if (key === 'fredirando') document.documentElement.dataset.brand = 'fredirando';
  else delete document.documentElement.dataset.brand;
  document.title = BRANDS[key].name;
  return BRANDS[key];
}
