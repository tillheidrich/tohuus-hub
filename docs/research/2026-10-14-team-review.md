# Team review 14 Oct 2026: personas, marketing, tech

Seven reviewers read the code, docs and website. Six were personas: Familie Berg, a WG of four, a single person working full time, Sam (ADHS), a babysitter or grandparent, and a self-hoster with Home Assistant on a Pi. The other two were a marketing expert and a tech/UX lead. All of them only read. This page collects their findings and records what was done the same evening.

## Covered well (all reviewers)

- The list and the shop mode with a learned walking order work offline. Purchase rhythms only suggest, nothing goes on the list by itself.
- The week plan has "Wer kocht?", polls, rotation and portions. Allergies are never planned.
- Mental load: "Wer hat was im Blick" shows no numbers. The Denkarbeit-Check, "Mach ich", and rotation with separate "wer macht's" and "wer behält's im Blick" cover the rest.
- WG: private and discreet rows, "Nur meins", lines for one person, "wer hat bezahlt", monthly balance with the fewest transfers, and money lists.
- ADHS/ND: small steps, "Eins nach dem anderen", a timer, gentle mode, "Neu anfangen" and quiet notifications.
- Hausinfo: codes are masked and logged, there is a Wi-Fi QR, `tel:` links, an A4 sheet, offline reading and a handover.
- Self-host: arm64 image, healthcheck, migrations with a backup first, nightly backups and WebDAV, the iOS app works with your own server, MCP with OAuth.
- Positioning: no competitor connects receipt, list, cooking and money. Bring! and Listonic show ads, OurHome, Tody and Sweepy use points, FamilyWall is calendar and chat. The hero line "Damit nicht einer alles im Kopf haben muss" is right.
- Web ↔ iOS: every web route has a native counterpart.

## Done right away (14 Oct, evening)

| Finding | Fix |
|---|---|
| Geld: there was no direct way to the items of a purchase (persona, tech #3, Till) | "Einkäufe" list on Geld, web and iPhone. A tap opens the receipt with its items or the expense (`purchases` in `/api/money/overview`). |
| Web offline queue under one fixed key: after an account switch, ops could be replayed into another household (tech #2) | Ops carry `scope` (household + person), only that account's ops are replayed, and the server answers 409 for any other |
| Website said "Verarbeitung in der EU" without OpenRouter (USA), unlike the privacy policy (marketing #1) | Wording fixed in German and English, website and help |
| "Bons ohne Limit" while uploads and AI reads are rate-limited; the Plus receipt address is not live yet (marketing #2) | "Bons ohne Monatslimit", "(kommt bald)" |
| Locale key "Home" defined twice (tech) | duplicate removed. 20 more duplicate keys with slightly different wording remain, but the order of the `de` spread decides deterministically |
| Year-end review wanted (Till) | "Euer Jahr to Huus" built and off by default (docs/review.md), framed as the marketing reviewer suggested ("wir", thankful, no ranking) |

## Open, ranked (proposal)

### Product
1. **Extend gentle mode to Vorrat, MHD and Heute.** No red "abgelaufen", say "Bitte mal anschauen" instead, and no counters. Optional single daily bundle (Sam).
2. **Hausinfo template "Kinder & Abend"** with bedtime, routine, allergies and the order of emergency calls, visible to sitter links by default. Also an arrival QR (Wi-Fi + link) and a DE/EN switch on the guest page.
3. **Recurring shared costs** (rent, internet, shared kitty) in the WG balance. Still no money moves (WG).
4. **Rotation: "skip this round" and "swap with …"**, tied to away mode (WG).
5. **Diet per person** (vegan, vegetarian, halal) as a hard filter in plan, "Was essen wir?" and suggestions (WG).
6. **Task with a shopping need**: "bis Do. besorgen" creates a list row with origin, and ticking the row completes the task (family).
7. **Denkarbeit-Check: "Übergeben an …"**, so a card becomes a task for the other person (family).
8. **Modules preset by household form**: for single, Bring mir was, guests and HA are off at first (the wave-3 plan, branch `wip/r-ios`).
9. **Leftovers in the plan**: extra portions become "Rest für Do." or "einfrieren" with a box label (single).
10. **Sunday view on Heute**: is the week planned, are missing ingredients on the list, what is due.

### Tech / self-host
1. **CI build for iOS** (macOS job: xcodegen + xcodebuild test). Until now the app is only checked by `swiftc -parse`, the Linux decode harness and the contract check.
2. **Backup health**: show "Letzte Sicherung vor X Tagen" and "Off-site fehlgeschlagen" as an admin hint or HA sensor. Add an optional full backup with `images/` and `imports/`.
3. **Deeper `/health`** (DB, write test, migrations), a version hint "Neue Version verfügbar", and the app warning about a server that is too old.
4. **Push relay for self-hosters** via the cloud, opt-in, carrying only the event and device and no text. Until then, explain the HA companion app inside the iOS app.
5. **Deep links**: push and universal links to a task, recipe, receipt or poll, not just to the tab.
6. **`spendStats` performance**: limit the range in SQL and cache per household.
7. **Reduced motion on iOS**: route 27× `withAnimation` through `Motion.perform`, plus a grep lint.
8. **Tap targets**: `.icon-btn.sm` (32 px), `.wmeal .icon-btn.sm` (26 px), some 36 px buttons on iOS. Hit area ≥ 44 px, and make `ui-audit.mjs` fail below that.
9. **Generic offline queue** for tasks and Vorrat, not just the list.
10. **Export for every member** (`/api/auth/me/export` with only their own private data, GDPR Art. 20).

### Marketing
1. Primary call to action: "Im Browser starten / Zugangscode anfragen". TestFlight second.
2. Sell the move from Bring! (the list import exists): a block on the website and a Ratgeber article "Bring!-Alternative ohne Werbung".
3. Pull the first moment of value forward: "Teil deinen letzten eBon – du siehst sofort, was ihr ausgegeben habt". Onboarding mails on day 1, 3 and 7.
4. Sell features that exist but aren't advertised: WG splitting and balance (a Splitwise/Tricount replacement), "Wo war's günstiger", estimated shelf life, CalDAV, widgets and Watch, "Mach ich", Mitversorgen.
5. Explain the payment path honestly: "Ein iPhone im Haushalt reicht, das Abo gilt für alle". Plan web payment for later.
6. App Store: subtitle "Einkaufsliste & Haushaltsbuch"; keywords putzplan, wg-kasse, haushaltsbuch, babysitter, mental load; new screenshot order.
7. Segments: families (core), WGs (web app is a must), ND households through communities, self-hosters through the HA forum and r/selfhosted. Singles are not marketed actively.
8. Word of mouth without gamification: a quiet "Erstellt mit ToHuus" footer on the Hausinfo sheet, wish list, party and handover links; the Denkarbeit-Check as a web version without an account; "Schenk einem Haushalt einen Monat".
9. Rückblick: "Euer Jahr to Huus" between the years, announced by an e-mail people can unsubscribe from. Free gets a short version.
10. Tie the honest note "Code größtenteils von KI-Agenten" to proof: the security review, open code and tests.

### Docs
- `docs/home-model.md` §5/§8 still says "Ausgaben pro Person in der WG nicht umgesetzt". That is out of date, because `hhforms.ts` does it.
