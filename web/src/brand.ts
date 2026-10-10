export type BrandKey = 'stockwerk' | 'fredirando';

export const BRANDS: Record<BrandKey, { name: string; logo: string; tagline: string }> = {
  stockwerk: { name: 'Stockwerk', logo: '/stockwerk-logo.svg', tagline: 'Was im Haus ist. Auf einen Blick.' },
  fredirando: { name: 'Fredirando', logo: '/fredirando.svg', tagline: 'Bestellt. Gebracht. Aus Küche & Keller.' },
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
