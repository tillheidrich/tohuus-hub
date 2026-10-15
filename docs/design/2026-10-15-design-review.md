# Design review 15 Oct 2026: website, web app, iOS

Three reviewers looked at the product with screenshots (web, both themes, 390 and 1280 px) and with the SwiftUI code (iOS). The skills they used:
- **Website:** design-taste-frontend, impeccable, accessibility review
- **Web app:** impeccable, ui-ux-design-pro, design critique, accessibility review
- **iOS:** ui-ux-design-pro, impeccable, accessibility review, design-system

This was a "redesign, preserve" review: the brand stays as it is ("Dutch Detail", serif display, Till's voice with en dashes). Only targeted changes were made.

## Done

**Website**
- Dark mode follows the device until the visitor picks one.
- The logo house is visible again. The nav has 6 items instead of 11 ("Funktionen" points to the feature section).
- Mobile gutter is 20/24 px instead of 16. The feature phones are larger, and the Hausinfo pair stacks on phones.
- Eyebrow labels remain only on the hero, prices, privacy and FAQ. The numbered circles are gone.
- The hero h1 is at most 2 lines on desktop, and the hero label carries the positioning line ("Der smarte Assistent für euren Haushalt").
- The phone bar appears only after the hero.
- Code wraps on phones.
- Tap targets are 44 px: language switch, small buttons, footer links.
- The nd grid is 3×3. The pull quote and the help tip have no side stripes.
- All app screenshots were renewed (de and en).

**Web app**
- Heute: the three tiles stack below 420 px and no longer break mid-word ("Einkaufszette/l").
- Segmented controls keep their width. `Seg full` fills the row (Aufgaben/Vorrat).
- The door chip row runs to the edge and fades out instead of being cut off.
- Aufgaben: the calendar settings are now a single link to Einstellungen, where they live.
- Denkarbeit-Check: the four answers are one compact control with short labels. The hint shows once you answered "mostly me". The page is about half as long.
- Einkauf: "Ich hol's" is an icon button on phones, so the name keeps its room. A disabled primary button looks disabled.
- Vorrat: the stepper is slimmer on phones, and the tap area stays 44 px.
- Region: the price sample uses `num` instead of monospace.
- Person colours are earthy (no saturated blue). Older stored colours are shown as their calmer twin (`personColor`, iOS `PersonColor.calm`).
- Cards with text have padding (`.card.stack`, `.loadcard`, `.ratgeber-card`).
- `scripts/ui-audit.mjs` reports text closer than 6 px to its box border (`tight`).

**iOS**
- App tint is `Theme.accent` (readable in dark mode). Filled buttons keep `Theme.primary`.
- Initials circles have readable contrast and scale with Dynamic Type.
- Task rows are announced as buttons.
- 44 pt hit areas are inside the label: focus minutes, home doors, money month, "Alle zeigen".
- The toast honours Reduce Motion and keeps clear of the assistant button.
- No endless spinners or silent failures: focus settings, calendar sync, dismissing a suggestion.
- Timer and year-in-review numbers scale with Dynamic Type.
- Denkarbeit answers are compact like on the web.

## Open – Till decides

- **iOS 26 / Liquid Glass:** let the system draw the tab and nav bars, and the assistant as `tabViewBottomAccessory`. This touches the "white tab bar" decision.
- **Website length:** 16 sections, about 43 screens on a phone. The suggestion is to move self-hosting, Home Assistant and "Für wen" to their own pages, keep 6 FAQs, and use a bento instead of 6 alternating image/text rows.
- **Dark variants of the website screenshots.**

## Open – next

- Systemic: enforce radius tokens (raw 8/9/11/12/15/17 px), three levels of border weight, a spacing rhythm, and shared components (`HScroll`, `MonthNav`, `EmptyState`).
- iOS: a `cardSurface()` modifier for the 70 ad-hoc surfaces, a single `ChoiceChip`, and a lint for `.system(size:)`, `withAnimation` and colour literals.
- Kochen: remove duplicates across sections. Settings on desktop: a vertical sub-navigation. Assistant button in dark mode: primary fill.
