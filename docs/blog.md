# Blog / Ratgeber: SEO and GEO groundwork

Status 18 Oct 2026: **31 German posts published** (five new ones in `site/src/posts/f-ein-ort.mjs`: Haushaltswissen, Tonne am Vorabend, Aufgaben verteilen, 14 Tage testen, selbst hosten; frame „Ein Ort für den Haushalt“, no AI quota numbers because they are being recalculated). Before: 26 German posts published (`site/src/posts/a-einkauf.mjs`, `b-geld.mjs`, `c-kochen.mjs`, `d-zuhause.mjs`, `e-aufgaben.mjs`), no English posts yet. The six posts of 14 Oct (mental load, ADHS, Haltbarkeit, Infos für Gäste, Extras, Putzplan) have their sources in `docs/facts.md` under "Research for the Ratgeber", with a note per fact whether the page itself was read or only search results quoting it. Facts of the older posts were checked against search results of the original sources; spot-check them now and then.

In-app cards: `docs/ratgeber-cards.json` lists the posts suited as cards in the app (`slug`, `title`, `teaser` ≤ 110 characters, `area`, `url`). Posts live at `https://tohuus.heidrich-digital.de/ratgeber/<slug>.html`. Add a line there when a new post fits the app.

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

## Topics

Ordered by what people search for and where ToHuus has a real answer. German first; English versions where the
search exists in the UK/US too.

| # | German title (working) | Search intent | Shows in ToHuus | Status |
|---|---|---|---|---|
| 1 | Einkaufsliste teilen: so klappt es in Familie, Paar und WG | geteilte Einkaufsliste App | live list, "Ich hol's", aisles | written: `einkaufsliste-teilen` |
| 2 | Haushaltsbuch für Lebensmittel ohne Tippen: Kassenbons auswerten | Haushaltsbuch App Kassenbon | receipts, Geld, categories | written: `haushaltsbuch-lebensmittel-kassenbon` |
| 3 | Was kostet Essen im Monat? Zahlen für Familien, Paare und Singles | Lebensmittelkosten pro Monat | Geld, monthly comparison | written: `lebensmittelkosten-pro-monat` |
| 4 | WG-Kosten fair teilen: Einkauf, Pizzaabend, Putzmittel | WG Kosten teilen | money split per person and shared | written: `wg-kosten-fair-teilen` |
| 5 | Wochenplan Essen: aus dem kochen, was da ist | Essensplan Woche Familie | cook planner, "Alles da" | written: `wochenplan-essen-familie` |
| 6 | Reste verwerten statt wegwerfen | Lebensmittelverschwendung vermeiden | "muss bald weg" | written: `reste-verwerten-lebensmittelverschwendung` |
| 7 | Wunschliste für Kinder teilen, ohne die Überraschung zu verraten | Wunschliste teilen Weihnachten | wishes, hidden reservations | written: `wunschliste-teilen-ohne-ueberraschung` |
| 8 | Bring mir was: kleine Wünsche im Haushalt (Partyabend, Besuch, Sofa) | Partyplanung Getränkekarte | Bring mir was, guest link | written: `partyabend-planen-getraenke` |
| 9 | Infos für Babysitter und Gäste: WLAN, Smart Home, Notfall | Babysitter Infoblatt Vorlage | house info with photos and videos | written: `babysitter-infoblatt` (babysitters, emergency numbers) and `infos-fuer-gaeste-wlan-kaffeemaschine` (guests, guest Wi-Fi, codes) |
| 10 | Urlaub: Übergabe für Tiersitter und Blumengießen | Haustiersitter Checkliste | holiday handover | written: `haustiersitter-checkliste-urlaub` |
| 11 | REWE eBon, Lidl Plus, Aldi: digitale Kassenbons nutzen | eBon exportieren | imports | open |
| 12 | Einkaufsliste mit Siri, Apple Watch und Widgets | Einkaufsliste Apple Watch | widgets, Watch, Live Activity | open |
| 13 | Haushalts-App ohne Tracking, Server in Deutschland | datenschutzfreundliche App | privacy, self-hosting | written: `haushalts-app-datenschutz` |
| 14 | Home Assistant: Einkaufsliste und Haushalt einbinden | Home Assistant Einkaufsliste | add-on, integration | open |
| 15 | Mental Load im Haushalt: was ist das, wie verteilt man ihn fair? | Mental Load Haushalt | Wer hat was im Blick, Denkarbeit-Check | written: `mental-load-haushalt-fair-verteilen` |
| 16 | Haushalt mit ADHS: was hilft, wenn der Kopf voll ist? | ADHS Haushalt Tipps | kleine Schritte, Eins nach dem anderen, Timer, sanfter Modus, Neu anfangen | written: `haushalt-mit-adhs` |
| 17 | Wie lange ist was haltbar? MHD, Verbrauchsdatum, nach dem Öffnen | wie lange haltbar nach dem Öffnen | Vorrat, „geschätzt“, Angebrochen, Zuerst essen | written: `haltbarkeit-lebensmittel-nach-dem-oeffnen` |
| 18 | Spontankäufe im Griff: Wochenbudget für Extras | Impulskäufe vermeiden, Budget Süßigkeiten | Extras im Wocheneinkauf | written: `spontankaeufe-wochenbudget-extras` |
| 19 | Putzplan ohne Punkte und Streit: WG, Paar, Familie | Putzplan WG / Familie | Aufgaben, Rhythmus, Abwechselnd, Apple Erinnerungen | written: `putzplan-wg-paar-familie` |
| 20 | Termine und Fristen im Haushalt: TÜV, Rauchmelder, Ausweise | Rauchmelder prüfen wann | Pflege & Fristen, Kalender-Abo | open |
| 21 | Allein wohnen: Einkauf und Haushalt für eine Person | Einkaufen für eine Person | Portionen, Vorrat, Aufgaben | open |

Rhythm suggestion: one post every two weeks, each post updated (`updated`) when the app changes. A post that
names a shop or a service keeps the website's trademark note in mind (ToHuus is not affiliated with them).
