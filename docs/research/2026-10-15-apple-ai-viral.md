# Research 15 Oct 2026: Apple Intelligence and growth through sharing

Web research for ToHuus (iOS SwiftUI app, web app/PWA, self-hostable server; server AI through `server/lib/ai.ts` on OpenRouter/Mistral EU). Every claim has a source and a date. "Pub." is the date of the source, "checked" means the page was read on 15 Oct 2026. Where sources disagree or only secondary reporting exists, the text says so. Nothing here was tested on a device.

Already in the code (checked 15 Oct 2026): `ios/ToHuus/Core/OCR/OnDeviceAI.swift` uses the Foundation Models framework (iOS 26+, off by default, per device, kid lock respected) to tidy receipt and paper-list OCR on device. `ios/ToHuus/App/AddToListIntent.swift` has an App Intent plus `AppShortcutsProvider` for "add to the list". The web app already calls `navigator.share` with text/URL (`web/src/pages/Shopping.tsx`, `web/src/pages/Away.tsx`, `web/src/money/lists.tsx`).

---

## Part A – Apple Intelligence

### A1. What Apple Intelligence can do with outside models, and where

**ChatGPT since iOS 18.2 (Dec 2024).** ChatGPT came in as an opt-in extension under Settings › Apple Intelligence & Siri. It can be called from Siri, Writing Tools, Visual Intelligence, Image Playground and Shortcuts. An OpenAI account is optional; linking one adds history and paid features. Without an account only the request and its attachments go to OpenAI, with no Apple-account information.
- iPhoneIslam, "iOS 18.2: Everything you can do with ChatGPT integration", pub. Dec 2024: https://www.iphoneislam.com/en/2024/12/ios-18-2-everything-you-can-do-with-chatgpt-integration/152931
- iGeeksBlog, "How to use ChatGPT on iPhone with Apple Intelligence" (undated guide): https://www.igeeksblog.com/ios-18-2-how-to-use-chatgpt-on-iphone/

**Germany/EU and German.** On 31 Mar 2025 iOS 18.4 brought Apple Intelligence to iPhone and iPad in the EU and added German (with French, Italian, Spanish, Portuguese and others). heise listed "use ChatGPT via Siri", Writing Tools, image and Genmoji generation, and German mail and message summaries as part of the EU launch. The ChatGPT detail comes from secondary reporting, not from the Apple newsroom text.
- Apple Newsroom, "Apple Intelligence features expand to new languages and regions today", pub. 31 Mar 2025: https://www.apple.com/newsroom/2025/03/apple-intelligence-features-expand-to-new-languages-and-regions-today/
- heise, "iOS 18.4 release: Apple Intelligence starts in Germany", pub. 31 Mar/1 Apr 2025: https://heise.de/-10334964
- 9to5Mac, "Apple Intelligence is now fully supported in the EU with iOS 18.4", pub. 1 Apr 2025: https://9to5mac.com/2025/04/01/apple-intelligence-is-now-fully-supported-in-the-eu-with-ios-18-4/

**Google Gemini.** In January 2026 Apple and Google announced a multi-year deal: Apple's next Foundation Models are built on Google's Gemini technology, including for "a more personalized Siri" in 2026. Bloomberg reported about 1 bn USD a year (no figure in the joint statement). The new Siri was planned for iOS 26.4 and then slipped to later releases.
- Android Authority, Apple–Google Gemini deal, pub. Jan 2026: https://www.androidauthority.com/apple-siri-google-gemini-deal-3631890
- GIGAZINE, "Apple will reportedly release Gemini-based Siri in iOS 26.4 and later", pub. 12 Feb 2026: https://gigazine.net/gsc_news/en/20260212-apple-ios-26-4-siri-gemini-update

**WWDC 2026 / iOS 27 (announced 8 Jun 2026, released 14 Sep 2026).**
- Apple's third-generation Foundation Models are five models "custom-built in collaboration with Google": on device AFM 3 Core (about 3B, dense) and AFM 3 Core Advanced (20B sparse, 1–4B active, newest chips only); on Private Cloud Compute (PCC) AFM 3 Cloud, ADM 3 Cloud (Image) and AFM 3 Cloud Pro (runs on NVIDIA GPUs in Google Cloud). German is in the evaluated "PFIGSCJK" locale group. Apple Machine Learning Research, pub. 8 Jun 2026 (footnote updated 9 Sep 2026): https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models
- New "Siri AI": Apple's own footnote says "Siri AI will not be available initially in the EU in iOS, iPadOS, and watchOS". In the EU it works only on Mac and Vision Pro, and the Siri AI beta is English-only. Apple lists 16 languages for Apple Intelligence in general, German among them. Apple Newsroom, pub. 8 Jun 2026: https://www.apple.com/newsroom/2026/06/apple-intelligence-brings-powerful-ai-capabilities-into-everyday-experiences/
- German-language reporting at launch: Siri AI is missing in Germany/EU on iPhone. Spanish, French, Japanese, Korean and Portuguese follow in October; German has no date (estimates say 2027). The earlier Apple Intelligence features (Writing Tools, summaries, Live Translation) keep working in German. Borncity, pub. 12 Sep 2026: https://borncity.com/news/ios-27-siri-ai-fehlt-in-deutschland-und-der-eu-zum-start/ ; Notebookcheck (undated): https://www.notebookcheck.com/Apple-Siri-AI-In-Deutschland-nur-auf-dem-Mac-und-auf-Englisch.1399697.0.html
- iOS 27 release date 14 Sep 2026: Mezha, pub. Sep 2026: https://mezha.ua/en/news/ios-27-release-date-315063/

**Other third-party models (Anthropic, Gemini as a user choice).**
- *For users (reported, not confirmed by Apple):* Bloomberg/MacRumors reported that iOS 27 lets people choose Claude or Gemini instead of ChatGPT as the default for Writing Tools and Image Playground, through a system feature called "Extensions" that any AI app can support. The Apple newsroom release of 8 Jun 2026 does not name ChatGPT, Claude or Gemini as user extensions. MacRumors (page shows 5 May 2026, URL path says 9 Jun 2026; based on Bloomberg and beta builds): https://www.macrumors.com/2026/06/09/ios-27-third-party-chatbots-apple-intelligence/ – treat this as open until checked on an iOS 27 device in German/EU settings.
- *For developers (confirmed):* the Foundation Models framework in iOS 27 lets apps use "models such as Claude and Gemini, or any provider that implements the new language model protocol". Apple Newsroom, pub. 8 Jun 2026: https://www.apple.com/newsroom/2026/06/apple-aids-app-development-with-new-intelligence-frameworks-and-advanced-tools/ . Anthropic publishes a Swift package (`ClaudeForFoundationModels`) that conforms Claude to `LanguageModel`; requests go straight to the Claude API, not through Apple. Collected by Michael Tsai, pub. 16 Jun 2026: https://mjtsai.com/blog/2026/06/16/apple-foundation-models-in-appleos-27/

### A2. What a third-party app such as ToHuus can use

| Building block | Since | What it gives ToHuus | Data path |
|---|---|---|---|
| **Foundation Models framework** (on device) | iOS 26 (WWDC 8 Jun 2025) | Swift API to the on-device model: `LanguageModelSession`, streaming, **guided generation** (`@Generable` Swift types instead of parsing text), **tool calling** (`Tool` protocol; the model calls app functions). Offline, no inference cost. Same languages as Apple Intelligence, German included. Small model with a ~4K-token context, so short tasks only (summarise, extract, classify, short wording). Apple Intelligence must be on and the device eligible (iPhone 15 Pro or later). | Stays on the device |
| **Foundation Models on PCC** | iOS 27 | Same API, server models (AFM 3 Cloud/Cloud Pro) at **no API cost**, but only for members of the App Store Small Business Program with **fewer than 2 million first-time downloads across all apps the developer ever released**. Critics call the lockout above the limit a "poison pill". EU availability for developers not stated anywhere I found. | Apple PCC: not stored, not accessible to Apple |
| **Language model protocol** | iOS 27 | Plug other providers (Claude, Gemini, any adapter) into the same session API. ToHuus could write an adapter for its own server/Mistral so the app code stays the same whether the answer comes from the device or from ToHuus. | Wherever the adapter sends it |
| **Core AI** | iOS 27 | Run own custom models on Apple silicon. Not needed now. | Device |
| **App Intents / App Shortcuts** | iOS 16, extended in 26/27 | Siri, Spotlight, Shortcuts, Action button, widgets call ToHuus actions. iOS 27 App Intents connect to Siri AI's personal context, app actions and on-screen awareness (not on EU iPhones at launch). | Device; Siri AI uses device/PCC |
| **Visual Intelligence** (`IntentValueQuery`) | iOS 26 | When someone points the camera or takes a screenshot, ToHuus can offer matching entities (e.g. "this product is on your list"/"add to list"). Beta-era reports of the query not running. | Device |
| **Writing Tools** | iOS 18.1 | Comes for free in standard text views (`UITextView`, SwiftUI `TextEditor`/`TextField`; full inline experience with TextKit 2). Control with `writingToolsBehavior` (`.complete`, `.limited`, `.none`). | Device/PCC, or ChatGPT if the user picks it |
| **Shortcuts "Use Model"** | iOS 26 | People can build their own flows: On-Device, Cloud, Cloud Pro (PCC) or Extension Model (ChatGPT). Output can be shaped into a fixed format and passed to ToHuus App Intents. | As chosen in the action |

Sources for the table:
- TechCrunch, "Apple lets developers tap into its offline AI models", pub. 9 Jun 2025 (offline, no inference cost, guided generation and tool calling built in): https://techcrunch.com/2025/06/09/apple-lets-developers-tap-into-its-offline-ai-models/
- Natasha the Robot, "Introduction to Apple's FoundationModels" (languages follow Apple Intelligence incl. German; text-only on iOS 26), pub. 2025: https://www.natashatherobot.com/p/apple-foundation-models
- Apple Developer documentation, Foundation Models (checked 15 Oct 2026): https://developer.apple.com/documentation/foundationmodels
- Apple Newsroom (PCC for developers, language model protocol, Core AI, App Intents ↔ Siri AI), pub. 8 Jun 2026: https://www.apple.com/newsroom/2026/06/apple-aids-app-development-with-new-intelligence-frameworks-and-advanced-tools/
- WWDC26 session 319 "Build with the new Apple Foundation Model on Private Cloud Compute": https://developer.apple.com/videos/play/wwdc2026/319/
- Daring Fireball on the 2M-download limit, pub. 13 Jun 2026: https://daringfireball.net/linked/2026/06/13/pcc-severely-limited-third-party-developers ; 4K context and other reactions collected by Michael Tsai, pub. 16 Jun 2026: https://mjtsai.com/blog/2026/06/16/apple-foundation-models-in-appleos-27/
- Blake Crosley, "App Intents 2.0 in iOS 26: Visual Intelligence and Snippets" (2025): https://blakecrosley.com/blog/app-intents-2-ios-26-additions ; Apple Developer Forums, IntentValueQuery not executed in beta: https://origin-devforums.apple.com/forums/thread/794382
- WWDC Notes, "Get started with Writing Tools" (WWDC24 10168): https://wwdcnotes.com/documentation/wwdc24-10168-get-started-with-writing-tools/ ; Apple Developer Forums on `.complete` being downgraded: https://developer.apple.com/forums/thread/756869
- Apple Support, "Use Apple Intelligence in Shortcuts on iPhone or iPad" (On-Device / Cloud / Cloud Pro / Extension Model; checked 15 Oct 2026): https://support.apple.com/guide/shortcuts/tpg3vrvwmclv ; heise, "iOS 26 allows selection of AI model in shortcuts", pub. Jul 2025: https://heise.de/-10506981

**Privacy reading for ToHuus.**
- On device means nothing leaves the iPhone. That fits the ToHuus privacy rules and the health-data consent (`ai.health_share`) best: allergies, intolerances or diet notes could be used in an on-device step without counting as "sharing" with the server AI. It still needs the household AI switch and kid lock, as `OnDeviceAI.active` already does.
- PCC: Apple says personal data "is not stored nor made accessible to Apple or anyone else", and is not used for training unless the person opts in (opt-in added 9 Sep 2026). Sources: Apple Newsroom 8 Jun 2026 and Apple ML Research (links above). This is a third processor besides Mistral/OpenRouter. ToHuus's privacy text would have to name it, and the 2M-download rule makes it an unsafe base for a core feature.
- The ChatGPT/Claude/Gemini extensions are the user's own choice in iOS. When someone uses Writing Tools with ChatGPT in a ToHuus text field, the text goes to OpenAI. ToHuus cannot see this, so private fields (Hausinfo codes, personal money notes) should set `writingToolsBehavior = .none`.

### A3. Recommendation for ToHuus

1. **Expand on-device Foundation Models (do now, iOS 26+).** Build on `OnDeviceAI`: (a) "Was steht an?" summary of the person's own list, tasks and week plan in two sentences; (b) private summaries of personal money entries ("Du hast diesen Monat …"), which may never go to the server or the assistant; (c) structure a free-text or dictated list into `@Generable` rows (name, amount, unit, category) before saving; (d) recipe ideas from the stock as a *suggestion* without health data leaving the device. Always with a fallback to the current path when the model is unavailable (`.notSupported`, `.notEnabled`, `.notReady`), always in German instructions + German prompt, and kept short (4K context). Same opt-in switch, same kid lock.
2. **Use tool calling only for reading.** Tools like `searchList`, `stockFor(item)` let the on-device model look things up. Writing (adding, ticking off) goes through confirmed App Intents, so nothing changes without the person seeing it.
3. **Widen App Intents (high value, low effort).** Next to `AddToListIntent`: "Was fehlt noch?", "Tick off …", "Was kochen wir heute?", "Wer ist dran mit …?", "Neue Aufgabe", and `AppEntity` types for list item, list, recipe and task with German `AppShortcut` phrases. These work today with classic Siri in German, in Spotlight, Shortcuts, the Action button and widgets. They are also the way into Siri AI later, once it reaches EU iPhones and German (no date; estimates 2027). Personal and private items must not be returned to Siri as entities.
4. **Visual Intelligence (later, iOS 26).** An `IntentValueQuery` that recognises products ("Milch" → "steht schon auf der Liste" / "Auf die Liste"). Medium effort; test carefully because of beta reports.
5. **Shortcuts: offer recipes, don't build AI around them.** Publish 3–4 ready Shortcuts on the help site (e.g. "Bon-Foto → Use Model (On-Device) → ToHuus Einkauf eintragen"). This costs ToHuus nothing and lets power users choose their model.
6. **Writing Tools: let them work, but turn them off for sensitive fields** (Hausinfo codes, Wi-Fi password, personal money notes, private wishes).
7. **PCC and the language model protocol: watch, don't depend on them.** The server AI stays the cross-platform core (web, self-host, Android later). An adapter that conforms the ToHuus server to `LanguageModel` would keep iOS code uniform, but it only pays off once on-device features exist in several places. Do not build core features on free PCC access: the 2M-download limit and missing EU statements make it a risk.
8. **Self-hosted mode:** on-device features work the same with a self-hosted server, because no ToHuus server is involved. That is a good argument for self-hosters who don't want any cloud AI at all.

---

## Part B – Growth through sharing

### B1. Case studies and what makes people share

| Case | Mechanism | Result (source) | Lesson for ToHuus |
|---|---|---|---|
| **Spotify Wrapped** | Yearly personal recap as story slides, each with a share card | 2025: 200 M engaged users in 24 h (+19 %), **over 500 M shares (+41 %)** incl. screenshots. TechCrunch, pub. 4 Dec 2025: https://techcrunch.com/2025/12/04/spotify-says-wrapped-2025-is-its-biggest-yet-with-200m-users-in-its-first-day ; Music Business Worldwide (Dec 2025): https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase | Identity ("this is me") and nostalgia drive sharing. A survey study (N=471) found nostalgia linked to share intention, while self-presentation strategy made no difference. NCCU thesis: https://thesis.lib.nccu.edu.tw/detail/7506d9b7c5154c641958f1cf430b6045/ |
| **Duolingo Year in Review** | One compact card instead of a web page; percentile and "learner personality" as second share hook | Percentile on the card "increased overall share rates"; the personality card "significantly boosted" shares; top-10 % users made more than half of all shares, so Duolingo redesigned for every level. Duolingo Blog (undated, ~2021/22): https://blog.duolingo.com/year-in-review-behind-the-scenes | Make cards that also feel good for average households. Avoid rankings (ToHuus rule): use a *personality/type* instead of a percentile. |
| **Strava Year in Sport / activity cards** | Share each scene to Instagram, TikTok, messengers; 9 story segments in 2025 | No public numbers found. Strava Support (checked 15 Oct 2026): https://support.strava.com/hc/en-us/articles/22067973274509-Your-Year-in-Sport ; Tantek Çelik, pub. 2 Jan 2026: https://tantek.com/2026/002/t1/find-export-strava-year-in-sport | Pride in effort, nice visual template, map/route as "proof". Downside: no export of the whole recap. |
| **Apple Fitness activity sharing** | Invite friends, see rings, 7-day competitions, can hide own activity or mute | Apple Support (checked 15 Oct 2026): https://support.apple.com/guide/watch/apd68a69f5c7 | Small circles plus clear privacy switches. ToHuus is not a competition app, so take only "share with chosen people, hide any time". |
| **BeReal** | Daily prompt, must post to see friends, no likes; campus referral cash in 2022 | Peak ~2022, then strong decline (estimates disagree: 15 M → 6 M DAU by spring 2023 per Platformer; sold to Voodoo 2024 for ~€500 M). Wikipedia (checked 15 Oct 2026): https://en.wikipedia.org/wiki/BeReal ; Sherwood News (2024): https://sherwood.news/snacks/tech/unfiltered-social-app-bereal-is-sold-after-pandemic-growth-didnt-turn-into/ | Authenticity is attractive, but novelty and pressure loops burn out. No daily pressure. |
| **Bring!** | Shared shopping list; invite in onboarding; notifications when someone changes the list or goes shopping | Bring! says over 20 M users worldwide (company figure, unaudited). Bring! (checked 15 Oct 2026): https://www.getbring.com/en/about-us ; collaborative feature page: https://getbring.com/en/features/collaborative | The strongest household loop is utility: a list only works when the others are in it. Invite is part of the job, not marketing. |
| **Hotmail "PS: I love you"** | Footer in every outgoing mail with a sign-up link | About 12 M users in ~18 months (1996–97), sold to Microsoft (~400 M USD). TechCrunch, pub. 18 Oct 2009: https://techcrunch.com/2009/10/18/ps-i-love-you-get-your-free-email-at-hotmail/ | Every outgoing message is an ad. Works because recipients are exactly the target group. Must be visible and switchable today. |
| **"Made with Tally" badge** (stand-in for Notion/Things-style "shared from" footers) | Badge on forms created on the free plan | Brings in about **10 % of new users** (first-party). Tally Blog (checked 15 Oct 2026): https://blog.tally.so/how-our-users-help-tally-grow/ | A small, tasteful footer on shared things works without being pushy. No current source found for Notion or Things footer numbers, so those are not cited. |

**What makes cards get shared** (synthesis of the sources above):
1. *Identity*: "this is our household" (Wrapped, Duolingo personalities).
2. *Pride* in effort without comparison (Strava, activity rings).
3. *Humour* and a light "type" (Duolingo personalities).
4. *Aesthetics*: a card that looks good in a story without editing.
5. *Utility for the receiver*: the shared thing helps them (Bring! list, Tally form, a recipe).
6. *Privacy control*: the person decides exactly what is on the card. Nothing personal by default, no amounts, no names unless chosen.

### B2. Format specs

| Target | Size | Notes / safe zones | Source |
|---|---|---|---|
| Instagram Story / Reels | 1080×1920 (9:16) | Keep ~250 px free at the top (name, progress bar). Bottom: ~250 px organic, ~340 px for ads (reply bar/CTA). Meta publishes **no official** safe-zone spec; the numbers are community measurements. Usable core about 1080×1420. | inro.social guide 2026 (checked 15 Oct 2026): https://www.inro.social/blog/instagram-story-size ; growthscribe 2026: https://growthscribe.com/instagram-story-size/ |
| Instagram Feed | 1080×1350 (4:5) | Portrait takes the most room in the feed. | Same guides; Postermywall, pub. 20 Jul 2026: https://www.postermywall.com/blog/2026/07/20/social-media-image-sizes/ |
| WhatsApp Status | 1080×1920 (9:16) | Wider images are letterboxed; keep the core in about 1080×1420–1600. Images up to 16 MB. Video length disputed (30 s vs 90 s). | Moda (checked 15 Oct 2026): https://moda.app/resources/sizes/whatsapp-status ; Spur: https://www.spurnow.com/en/blogs/whatsapp-image-size |
| TikTok | 1080×1920 | Keep text out of the top/bottom ~15 % and away from the right-hand button column. | Postermywall, pub. 20 Jul 2026 (link above) |
| LinkedIn | 1200×627 (link preview, 1.91:1); 1080×1350 or 1080×1080 for image posts | No official LinkedIn spec page found; vendor guides disagree. | Metricool: https://metricool.com/linkedin-images-sizes/ ; Postiz 2026: https://postiz.com/blog/linkedin-post-dimensions |
| Instagram from an iOS app | – | "Sharing to Stories" via `instagram-stories://share?source_application=<FB App ID>`, image on the pasteboard (`com.instagram.sharedSticker.backgroundImage`). **Facebook App ID required since Jan 2023**; add the scheme to `LSApplicationQueriesSchemes`. | Meta for Developers (checked 15 Oct 2026): https://developers.facebook.com/docs/instagram-platform/sharing-to-stories ; Meta blog, pub. 10 Oct 2022: https://developers.secure.facebook.com/blog/post/2022/10/10/introducing-important-update-to-Instagram-sharing-to-stories/ |

**Design rules derived for ToHuus cards** (own derivation from the specs above, not from a source):
- Headline ≥ 64 px, body ≥ 40 px on a 1080 px wide canvas (reads well on a ~390 pt phone); maximum ~12 words per card.
- ToHuus wordmark small at the **bottom of the safe core** (y ≈ 1500–1580), never in the top 250 px or bottom 340 px.
- A **short link** (`tohuus.de/k/…` or similar) is better than a QR code in stories (people view the story on the phone they would scan with). QR only for print (Hausinfo A4 sheet, fridge list).
- Dutch Detail colours, contrast checked with `docs/design/check-contrast.mjs`.

**UTM conventions.** Google requires `utm_source`, `utm_medium`, `utm_campaign`; Google recommends lowercase for `utm_term`, third-party guides recommend lowercase and hyphens for all parameters because values are case-sensitive; do not tag internal links. Google Analytics Help (checked 15 Oct 2026): https://support.google.com/analytics/answer/10917952 ; Shopify (2025): https://shopify.com/blog/utm-parameters
Proposal: `utm_source=tohuus-app|tohuus-web`, `utm_medium=share-card|list-footer|invite|email-footer`, `utm_campaign=jahresrueckblick-2026|liste|rezept`. For a privacy-first app, count only aggregated landing counts on the website, no per-person tracking. The UTM must never contain a household or user ID.

### B3. Exporting lists to Apple Notes / Mail and from the web

**iOS app**
- `ShareLink` (SwiftUI) / `UIActivityViewController` hand plain text, attributed text, URLs, images or files to the share sheet. Notes and Mail appear as targets. Plain text with "• " or "- " lines is the most robust; Notes shows it as text, **not** as a real checklist.
- **Markdown in Notes (iOS 26):** Notes imports `.md` files from the share sheet ("Import to Notes" on iPad) and exports as Markdown. Headings, bullet lists, bold/italic and links convert; pasting Markdown text does **not** convert. Whether `- [ ]` becomes a real Notes checklist is not documented anywhere I found, so test before promising it. 9to5Mac, pub. 16 Oct 2025: https://9to5mac.com/2025/10/16/heres-everything-new-for-apple-notes-in-ios-26/ ; AppleInsider (2025): https://appleinsider.com/inside/ios-26/tips/how-to-import-and-export-markdown-with-apple-notes-in-ios-26
- **Shortcuts:** iOS 26 Shortcuts can add items directly to Notes checklists. Matthew Cassinelli, "Shortcuts gains actions for Apple Intelligence, Messages, and Notes checklists in iOS 26" (2025): https://matthewcassinelli.com/?p=36222 . So a real checklist in Notes is possible through a ready-made Shortcut that takes the ToHuus list (via a ToHuus App Intent returning the items) and adds them one by one. A third-party app cannot write a Notes checklist directly; Notes has no public API.
- **Mail:** `MFMailComposeViewController` takes an HTML body, so a list can be a real `<ul>` with ☐ characters, plus the opt-out footer. Falls back to the share sheet when no Mail account is set up.

**Web**
- Web Share API Level 2: `navigator.canShare({ files })` then `navigator.share({ files, title, text })`, HTTPS only. File sharing works in Safari (iOS/macOS), Chrome on Android/ChromeOS/Windows and Edge; Firefox desktop only behind a flag. web.dev, "Share files" (checked 15 Oct 2026): https://web.dev/articles/files/share-files ; W3C Web Share draft (2022): https://www.w3.org/TR/2022/WD-web-share-20220707/ . So the web app can share a generated PNG card or a `.md`/`.txt` list on iPhone directly into Instagram, WhatsApp or Notes. Fallback: download plus "copy text".
- `mailto:`: old tests show bodies breaking around 1,800–2,000 characters in Outlook, with no reliable current limit for Gmail or iOS Mail; line breaks as `%0D%0A`. Evolt list archive (2001): https://lists.evolt.org/archive/Week-of-Mon-20010813/028064.html ; Microsoft Support on the 2,084-character URL limit (updated 10 Nov 2023): https://support.microsoft.com/office/outlook-error-cannot-send-this-item-when-replying-to-an-email-9346c0cd-06c8-4491-b5bf-0b91909c377d . Rule for ToHuus: use `mailto:` only for short lists (< ~1,500 characters encoded), otherwise copy to the clipboard and say so.

### B4. Twelve sharing loops for ToHuus

Ground rules for all of them: the person shares actively, nothing is posted by itself; no amounts, private lists, health data, Hausinfo codes or real names on cards by default; the footer is one short line and can be turned off in settings (on by default only for things that go to people outside the household, off in the self-hosted mode unless the admin turns it on); no streaks, no rankings; German copy in du-Form.

| # | Loop | How it spreads | Expected effect | Risk / guard |
|---|---|---|---|---|
| 1 | **Invite to the household list** (Bring! model) | "Wer kauft mit ein?" in onboarding and when the list is shared; the link opens the list in the browser without an app, joining is one tap | **Highest.** Each household brings 1–3 people who need the list to work | Spam feeling if asked too often: ask once in onboarding, then only from the share button. Guests see only what they were given |
| 2 | **Shared list link for non-users** ("Kannst du das mitbringen?") | Read-and-tick web link for a specific list, valid 48 h; footer "Liste aus ToHuus · tohuus.de" | High: grandparents, babysitters, neighbours see the product in use | Link leaks: expiry, no private rows, revoke button |
| 3 | **Plain-text list footer** (Hotmail model) | When a list is shared as text to WhatsApp/Notes/Mail: last line "– geteilt aus ToHuus" (no URL in the message, or a short one) | Medium, steady, cheap | Annoying if it can't be turned off: one switch "Hinweis auf ToHuus anhängen", remembered |
| 4 | **Recipe card** | Share a recipe from Kochen as a 4:5 or 9:16 image + link to a public recipe page (no household data) | Medium; recipes are already shared a lot | Copyright for imported recipes: only own recipes or with source credit |
| 5 | **"Unser Jahr im Haushalt" recap** (Wrapped model, December) | 5–7 cards: "Sachen gekauft", most-cooked dish, "Reste gerettet", "Wer hatte was im Blick" as a *shared* achievement, a household "type" ("Die Vorratsprofis") | High in the first week of December, then fades | Must not compare people or show amounts; cards built on device, nothing to the server; opt-in per card |
| 6 | **Monthly "Reste gerettet" card** | Small card when food was used up instead of thrown away (count, never kg or money unless chosen) | Low–medium; positive, fits the sustainability angle | Must not become a streak; only on request, never as a push |
| 7 | **Hausinfo sheet for guests/babysitters** | The A4/QR sheet and the guest link already exist; add a small line "Erstellt mit ToHuus" at the bottom | Medium; reaches exactly the right group (families, hosts) | Never put codes on shared images; the line can be switched off |
| 8 | **"Bring mir was" request for outsiders** | Someone without the app can send a wish via link; the household sees it in the list | Medium; turns visitors into contacts | Abuse/spam: link per household, rate limit, admin can switch it off |
| 9 | **Money list / Abrechnung share** (WG) | Share the end-of-month settlement as text or PDF ("Mira zahlt Sam 12,40 €") with footer | Medium in WGs, which change members often | Amounts are sensitive: only the summary rows the person chose; personal entries never |
| 10 | **Ready-made Shortcuts and Siri phrases** | Help pages with "Hey Siri, setz Milch auf die ToHuus-Liste" and downloadable Shortcuts; shareable via iCloud link | Low reach, high retention and word of mouth among power users | None worth noting; keep them updated per iOS release |
| 11 | **Move-over helper** ("Von Bring! / Notizen zu ToHuus") | Import paste/Markdown, then "Lade die anderen ein" | Medium for switchers; makes loop 1 start sooner | Must not scrape competitor apps; paste/file only |
| 12 | **Referral without money** | "Lade einen anderen Haushalt ein": both get one month of the paid plan in the cloud (no cash, no ranks) | Medium; classic but works | Gaming via fake households: limit per account, cloud only, no effect on self-hosting |

**Order suggestion:** 1 → 2 → 3 (all cheap and close to the job), then 4 and 7, then 5 in time for December 2026. Measure only aggregated counts: how many invites sent/accepted, how many share links opened, landing-page UTM counts. No per-person tracking.

---

## Open points / not verified

- Whether the iOS 27 "Extensions" for Claude/Gemini shipped as reported, and whether they are available in Germany/EU in German.
- Whether Foundation Models on PCC (iOS 27) is available to developers for EU users.
- Whether Notes turns `- [ ]` Markdown lines into a real checklist on import.
- Official Instagram/LinkedIn safe-zone specs do not exist publicly; the numbers are community measurements.
- No current growth numbers found for Strava cards, Notion or Things "shared from" footers.
