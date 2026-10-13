/**
 * The website's addresses in one place (docs/domain.md). A domain change: SITE and CLOUD here, site/CNAME, and the
 * other places listed in docs/domain.md.
 */
export const SITE = 'https://tohuus.heidrich-digital.de/';
export const CLOUD = 'https://cloud.tohuus.heidrich-digital.de';
/** the host name shown in texts ("tohuus.heidrich-digital.de") */
export const SITE_HOST = new URL(SITE).host;
/** a help article on this website (for links in posts and facts) */
export const help = (slug) => `${SITE}hilfe/${slug}.html`;
