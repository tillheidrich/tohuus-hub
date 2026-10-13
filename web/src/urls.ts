/**
 * The two public addresses of ToHuus in one place (docs/domain.md): the website (help, legal, Ratgeber) and the
 * ToHuus Cloud. A domain change means changing these defaults (or setting VITE_SITE_URL / VITE_CLOUD_URL at build
 * time); the server's own address comes from BASE_URL / SITE_URL.
 */
const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

export const SITE_URL = (env.VITE_SITE_URL || 'https://tohuus.heidrich-digital.de').replace(/\/$/, '');
export const CLOUD_URL = (env.VITE_CLOUD_URL || 'https://cloud.tohuus.heidrich-digital.de').replace(/\/$/, '');
