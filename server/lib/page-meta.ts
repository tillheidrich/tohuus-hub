/**
 * Title, description and link preview (Open Graph, Twitter) of the web app page – the first thing someone sees when
 * a ToHuus link lands in a messenger. Name "ToHuus", claim "ToHuus merkt sich, was zu Hause fehlt" in German and
 * English like the website (site/index.html, site/de/index.html); "ToHuus Hub" stays the name of the open-source
 * project only. An invitation link (/einladung/…) previews as an invitation – without repeating its token.
 * Link previews come without cookies, so the instance language decides (server/index.ts passes lang()).
 */
const SITE = 'https://tohuus.heidrich-digital.de';

interface Texts {
  title: string;
  description: string;
  inviteTitle: string;
  inviteDescription: string;
  imageAlt: string;
  locale: string;
}

const DE: Texts = {
  title: 'ToHuus · Merkt sich, was zu Hause fehlt',
  description: 'ToHuus merkt sich für euren Haushalt, was da ist, was fehlt und was es kostet, aus euren Kassenbons und eurer Liste. Für iPhone und im Browser.',
  inviteTitle: 'Einladung zu ToHuus',
  inviteDescription: 'Du bist in einen Haushalt bei ToHuus eingeladen. Öffne den Link, um dabei zu sein.',
  imageAlt: 'Das ToHuus-Zeichen, der Satz „Damit nicht einer alles im Kopf haben muss.“ und vier gezeichnete Wohnformen.',
  locale: 'de_DE',
};
const EN: Texts = {
  title: 'ToHuus · Remembers what your home is missing',
  description: 'ToHuus remembers for your household what is there, what is missing and what it costs, from your receipts and your list. For iPhone and the browser.',
  inviteTitle: 'Invitation to ToHuus',
  inviteDescription: 'You are invited to a household on ToHuus. Open the link to join.',
  imageAlt: 'The ToHuus mark, the line “So one person doesn’t have to keep it all in their head.” and four drawn homes.',
  locale: 'en_GB',
};

export const pageTexts = (lang: string): Texts => (lang === 'de' ? DE : EN);

/** the short claim (manifest description, <meta name="description"> base) */
export const claim = (lang: string) => (lang === 'de' ? 'ToHuus merkt sich, was zu Hause fehlt.' : 'ToHuus remembers what’s missing at home.');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const isInvitePath = (p: string) => /^\/(?:einladung|invite)\//.test(p);

/**
 * Rewrites the head of web/index.html: <title>, description, apple-mobile-web-app-title, plus the Open Graph and
 * Twitter tags. `baseUrl` (config.baseUrl) makes og:url absolute; invitations get no og:url (the token stays out).
 */
export function withPageMeta(doc: string, o: { lang: string; path: string; baseUrl?: string }): string {
  const x = pageTexts(o.lang);
  const invite = isInvitePath(o.path);
  const title = invite ? x.inviteTitle : x.title;
  const description = invite ? x.inviteDescription : x.description;
  const image = `${SITE}/assets/img/og-${o.lang === 'de' ? 'de' : 'en'}.png`;
  const base = (o.baseUrl ?? '').replace(/\/+$/, '');
  const tags = [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'ToHuus'],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ...(base && !invite ? [['property', 'og:url', `${base}${o.path === '/' ? '/' : o.path}`]] : []),
    ['property', 'og:image', image],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '630'],
    ['property', 'og:image:alt', x.imageAlt],
    ['property', 'og:locale', x.locale],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
    ['name', 'twitter:image', image],
  ]
    .map(([k, n, v]) => `<meta ${k}="${n}" content="${esc(v)}" />`)
    .join('\n    ');
  return doc
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(invite ? x.inviteTitle : 'ToHuus')}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(description)}" />`)
    .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*"\s*\/?>/, '<meta name="apple-mobile-web-app-title" content="ToHuus" />')
    .replace(/<\/head>/, `  ${tags}\n  </head>`);
}
