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
 *     facts: [{ value: '78 kg', text: 'Ein Satz, der allein verständlich ist (mit Jahr).', source: 'Destatis 2023', url: 'https://…' }],
 *                                            // each a card on the page that can be saved as an image; also on fakten.html
 *     sources: [['Titel', 'https://…']],     // every source of the post, listed at the end
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
    sources: 'Quellen', source: 'Quelle:', factsHere: 'Fakten zum Mitnehmen', factsNote: 'Jede Karte lässt sich als Bild speichern oder auf dem Handy direkt teilen.', factsAll: 'Alle Fakten',
    factsTitle: 'Fakten rund um Einkauf, Kochen und Haushaltsgeld', factsH1: 'Fakten zum Mitnehmen', factsLink: 'Alle Fakten als Karten',
    factsLede: '{n} Zahlen aus unseren Beiträgen, jede mit Quelle. Jede Karte lässt sich als Bild speichern oder teilen.',
    factsDesc: 'Zahlen zu Lebensmittelkosten, Lebensmittelverschwendung, Einkauf und Haushalt, jede mit Quelle, als Karte zum Speichern und Teilen.',
    saveImage: 'Als Bild speichern', share: 'Teilen', saved: 'Gespeichert', toPost: 'Zum Beitrag',
  },
  en: {
    title: 'Blog', label: 'Blog', h1: 'Shopping, cooking and money at home',
    lede: 'Practical answers for families, couples and flatshares: how to organise shopping, meal planning and household money together.',
    desc: 'The ToHuus blog: sharing a shopping list, planning meals and keeping an eye on household money, for families, couples and flatshares.',
    back: 'All posts', other: 'Deutsche Version', published: 'Published', updated: 'Updated', faq: 'Frequently asked questions',
    help: 'From the help', tryIt: 'Try ToHuus', tryText: 'ToHuus remembers what is at home, what is missing and what it costs.',
    sources: 'Sources', source: 'Source:', factsHere: 'Facts to take away', factsNote: 'Every card can be saved as an image or shared straight from your phone.', factsAll: 'All facts',
    factsTitle: 'Facts on shopping, cooking and household money', factsH1: 'Facts to take away', factsLink: 'All facts as cards',
    factsLede: '{n} figures from our posts, each with its source. Every card can be saved as an image or shared.',
    factsDesc: 'Figures on food costs, food waste, shopping and the household, each with its source, as cards to save and share.',
    saveImage: 'Save as image', share: 'Share', saved: 'Saved', toPost: 'To the post',
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
  for (const [k, f] of (p.facts ?? []).entries()) {
    if (!f.value || f.value.length > 16) throw new Error(`${where}: fact ${k + 1} needs a short value (max 16 characters)`);
    if (!f.text || f.text.length > 170) throw new Error(`${where}: fact ${k + 1} text missing or longer than 170 characters`);
    if (!f.source || !/^https:\/\//.test(f.url ?? '')) throw new Error(`${where}: fact ${k + 1} needs a source and an https URL`);
    if (/["<>]/.test(f.value + f.text + f.source)) throw new Error(`${where}: fact ${k + 1} must not contain " < >`);
  }
  for (const [t, u] of p.sources ?? []) if (!t || !/^https:\/\//.test(u)) throw new Error(`${where}: bad source ${t}`);
}
