# Blog / Ratgeber: SEO and GEO groundwork

Status 13 Oct 2026: **20 German posts published** (`site/src/posts/a-einkauf.mjs`, `b-geld.mjs`, `c-kochen.mjs`, `d-zuhause.mjs`). Facts were checked against search results of the original sources; the source pages themselves could not be opened from the build environment, so spot-check them now and then.

Originally prepared without posts: The website build (`node site/src/build.mjs`) can publish posts,
but as long as `POSTS` in `site/src/blog.mjs` holds no post with `status: 'published'`, no blog page exists and
nothing links to it.

## What is in place

| Piece | Where | What it does |
|---|---|---|
| Post data and rules | `site/src/blog.mjs` | `POSTS.de` / `POSTS.en`, the post format, `checkPost` (slug, dates, title ≤ 70, description 80 to 170 characters, direct answer, sections) |
| Pages | `site/src/build.mjs` (`blogIndex`, `blogPost`) | German at `/ratgeber/`, English at `/blog/`, same look as the help pages; table of contents, FAQ, links into the help, a "try ToHuus" line |
| Structured data | same | `Blog`, `BlogPosting`, `BreadcrumbList`, `FAQPage` (JSON-LD) |
| hreflang | same | only between real translations (`pair`), never to an unrelated page |
| Footer link | `pageFoot` | "Ratgeber" / "Blog" appears once the first post of that language is published |
| `sitemap.xml` | site root, built | home pages, legal pages, all help articles, blog index and posts with `lastmod` |
| `robots.txt` | site root, built | everything allowed (search engines and AI crawlers), sitemap link |
| `llms.txt` | site root, built | a plain summary of ToHuus plus every help article and post with its description, for AI answer engines (GEO) |

Register `https://tohuus.heidrich-digital.de/sitemap.xml` in Google Search Console and Bing Webmaster Tools once
(Bing feeds ChatGPT search and Copilot).

## Writing a post

1. Add the post to `POSTS.de` (and, if translated, `POSTS.en` with `pair` on both sides) with `status: 'draft'`.
2. Title = the question people type. First thing under the headline (`answer`) = the answer in two or three
   sentences. AI answer engines quote exactly this part.
3. Sections with clear `h2` headings, short paragraphs, lists and tables where they help. One concrete example per
   post with the demo household (Familie Berg, Sam, Mira, Mika, Ben). No real names.
4. Three to five FAQ entries with short, self-contained answers.
5. Link one to three help articles (`help: [...]`). Only claim what the app does today.
6. House rules: no em or en dashes (the build fails), no family names.
7. Set `status: 'published'`, run `node site/src/build.mjs`, look at the page, commit.

## Planned topics (not written)

Ordered by what people search for and where ToHuus has a real answer. German first; English versions where the
search exists in the UK/US too.

| # | German title (working) | Search intent | Shows in ToHuus |
|---|---|---|---|
| 1 | Einkaufsliste teilen: so klappt es in Familie, Paar und WG | geteilte Einkaufsliste App | live list, "Ich hol's", aisles |
| 2 | Haushaltsbuch für Lebensmittel ohne Tippen: Kassenbons auswerten | Haushaltsbuch App Kassenbon | receipts, Geld, categories |
| 3 | Was kostet Essen im Monat? Zahlen für Familien, Paare und Singles | Lebensmittelkosten pro Monat | Geld, monthly comparison |
| 4 | WG-Kosten fair teilen: Einkauf, Pizzaabend, Putzmittel | WG Kosten teilen | money split per person and shared |
| 5 | Wochenplan Essen: aus dem kochen, was da ist | Essensplan Woche Familie | cook planner, "Alles da" |
| 6 | Reste verwerten statt wegwerfen | Lebensmittelverschwendung vermeiden | "muss bald weg" |
| 7 | Wunschliste für Kinder teilen, ohne die Überraschung zu verraten | Wunschliste teilen Weihnachten | wishes, hidden reservations |
| 8 | Bring mir was: kleine Wünsche im Haushalt (Partyabend, Besuch, Sofa) | Partyplanung Getränkekarte | Bring mir was, guest link |
| 9 | Infos für Babysitter und Gäste: WLAN, Smart Home, Notfall | Babysitter Infoblatt Vorlage | house info with photos and videos |
| 10 | Urlaub: Übergabe für Tiersitter und Blumengießen | Haustiersitter Checkliste | holiday handover |
| 11 | REWE eBon, Lidl Plus, Aldi: digitale Kassenbons nutzen | eBon exportieren | imports |
| 12 | Einkaufsliste mit Siri, Apple Watch und Widgets | Einkaufsliste Apple Watch | widgets, Watch, Live Activity |
| 13 | Haushalts-App ohne Tracking, Server in Deutschland | datenschutzfreundliche App | privacy, self-hosting |
| 14 | Home Assistant: Einkaufsliste und Haushalt einbinden | Home Assistant Einkaufsliste | add-on, integration |

Rhythm suggestion: one post every two weeks, each post updated (`updated`) when the app changes. A post that
names a shop or a service keeps the website's trademark note in mind (ToHuus is not affiliated with them).
