/**
 * Blog / Ratgeber (13 Oct 2026: "vorbereiten, dass wir Blog-Beiträge auf der Website haben, damit wir SEO und GEO
 * pushen"). Prepared, not written: the build renders an index and one page per post with `status: 'published'`,
 * plus the sitemap, robots.txt and llms.txt entries. As long as nothing is published, no blog page exists and the
 * site has no link to it. How to write a post: docs/blog.md.
 *
 * German posts live at site/ratgeber/<slug>.html, English ones at site/blog/<slug>.html.
 *
 * A post:
 *   {
 *     slug: 'einkaufsliste-teilen',          // lowercase, a-z 0-9 and hyphens; the URL, never changed after publishing
 *     pair: 'shared-shopping-list',          // slug of the same post in the other language (optional)
 *     status: 'draft' | 'published',
 *     date: '2026-11-02', updated: '2026-11-10',
 *     title: 'Einkaufsliste teilen: ...',    // up to ~60 characters, the question people type
 *     desc: '...',                           // 140 to 160 characters, the answer in one sentence
 *     answer: '...',                         // 2 to 3 sentences right under the headline: the direct answer (GEO)
 *     sections: [['Zwischenüberschrift', '<p>…</p>'], ...],
 *     faq: [['Frage?', 'Antwort.'], ...],    // optional, also as FAQPage schema
 *     help: ['einkaufsliste'],               // optional, help articles to link (slugs of help.mjs)
 *   }
 *
 * House rules as on the rest of the site: no em or en dashes, invented names only (Sam, Mira, Mika, Ben, Familie
 * Berg), no claims the app cannot keep.
 */

export const BLOG_DIR = { de: 'ratgeber', en: 'blog' };

export const BLOG_COPY = {
  de: {
    title: 'Ratgeber', label: 'Ratgeber', h1: 'Einkauf, Kochen und Geld im Haushalt',
    lede: 'Praktische Antworten für Familien, Paare und WGs: wie ihr Einkauf, Essensplanung und Haushaltsgeld gemeinsam organisiert.',
    desc: 'Ratgeber von ToHuus: Einkaufslisten teilen, Essen planen, Haushaltsgeld im Blick behalten, für Familien, Paare und WGs.',
    back: 'Alle Beiträge', other: 'English version', published: 'Veröffentlicht', updated: 'Aktualisiert', faq: 'Häufige Fragen',
    help: 'Passend aus der Hilfe', tryIt: 'ToHuus ausprobieren', tryText: 'ToHuus merkt sich für euren Haushalt, was da ist, was fehlt und was es kostet.',
  },
  en: {
    title: 'Blog', label: 'Blog', h1: 'Shopping, cooking and money at home',
    lede: 'Practical answers for families, couples and flatshares: how to organise shopping, meal planning and household money together.',
    desc: 'The ToHuus blog: sharing a shopping list, planning meals and keeping an eye on household money, for families, couples and flatshares.',
    back: 'All posts', other: 'Deutsche Version', published: 'Published', updated: 'Updated', faq: 'Frequently asked questions',
    help: 'From the help', tryIt: 'Try ToHuus', tryText: 'ToHuus remembers what is at home, what is missing and what it costs.',
  },
};

/** The posts. Nothing is published yet; the plan for the first ones is in docs/blog.md. */
export const POSTS = {
  de: [],
  en: [],
};

/** Published posts of a language, newest first. */
export const publishedPosts = (lang) => POSTS[lang].filter((p) => p.status === 'published').sort((a, b) => b.date.localeCompare(a.date));

/** Checks a post before it is built (the build fails on a broken post rather than shipping it). */
export function checkPost(lang, p) {
  const where = `blog ${lang}/${p.slug}`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) throw new Error(`${where}: bad slug`);
  if (!/^\d{4}-\d\d-\d\d$/.test(p.date) || (p.updated && !/^\d{4}-\d\d-\d\d$/.test(p.updated))) throw new Error(`${where}: date as YYYY-MM-DD`);
  if (!p.title || p.title.length > 70) throw new Error(`${where}: title missing or longer than 70 characters`);
  if (!p.desc || p.desc.length < 80 || p.desc.length > 170) throw new Error(`${where}: description should be 80 to 170 characters`);
  if (!p.answer) throw new Error(`${where}: the direct answer under the headline is missing`);
  if (!p.sections?.length) throw new Error(`${where}: no sections`);
}
