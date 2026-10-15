# Im Kopf

Decision of 15 Oct 2026. Till: "Es gibt immer Dinge, die sind so einfach, dass man sie nicht extra in eine Listen-App eintragen möchte – trotzdem verdient das gesehen zu werden." He also asked about "Till hat gerade im Kopf: Was essen wir Samstag, wenn Mira abends weg ist? Was schenke ich Oma zu Weihnachten?"

Server: `server/lib/mind.ts`. Web: `web/src/pages/Mind.tsx` (`/kopf`, a card on Heute, a link on Aufgaben). iOS: `ios/ToHuus/Features/Today/MindViews.swift` (a card on Heute, a link on Aufgaben).

## Why

Mental-load apps (Fair Play / FairShare, Balance, PairCalm, Relia) let a household decide who owns which tasks. Those tasks are fixed in advance, as cards or chores. What is missing in them is the small, unplanned thinking:
- the question someone carries around for days;
- the call made in passing;
- the birthday someone remembered.

Our team research (`docs/research/2026-10-14-team-review.md`) showed the same thing: what makes the load heavy is that it stays invisible, not how much it is. So:

- **"Im Kopf"** (`open`): a thought, not yet a task. It can be ticked off, become a task with one tap, or simply stay there.
- **"Nebenbei erledigt"** (`done`): something done without ever having been on a list.
- **Being seen:** others tap "Ich denk mit" on a thought or "Danke" on something done. Only names are shown, never counts, scores or rankings. The author can't nod at their own entries.
- **Weekly review:**
  - The person's own part gets "Sachen nebenbei erledigt oder dran gedacht", with up to three texts, private ones included.
  - The household part only gets a number ("Sachen nebenbei erledigt"), with no texts and no names. Entries hidden from someone don't count there.

## Privacy

- **Visibility:** each entry is `private` (only the author) or `household`. It can be switched either way at any time.
- **Hidden from members:** a household entry can be hidden from single members (`hide_from`), for example a present idea for the person it is for. Only the author sees whom it is hidden from.
- **Never shared with:** guests, house guests, guest links, the assistant, MCP, Home Assistant, notifications, widgets and exports. The live-update topic `mind` isn't even forwarded to Home Assistant.
- **Lifetime:** done entries leave the lists after 14 days. It's a moment, not an archive. Open thoughts stay until they are ticked off or deleted.

## API (members only, otherwise 403)

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/api/mind` | – | `{ mine: { open, done }, others: { open, done }, members: [{ id, name }] }` |
| POST | `/api/mind` | `{ text, kind?: open\|done, visibility?: private\|household, hide_from?: [userId] }` | the entry |
| PATCH | `/api/mind/:id` | `{ text?, kind?, visibility?, hide_from? }` (own entries) | the entry |
| DELETE | `/api/mind/:id` | – (own entries) | `{ ok }` |
| POST | `/api/mind/:id/nod` | – ("Ich denk mit" / "Danke"; tap again to take it back) | the entry |
| POST | `/api/mind/:id/task` | – (own open thought → task; a private thought stays private) | the task |

An entry has these fields: `{ id, text, kind, mine, by: { id, name, color }, visibility, hide_from, nods: [{ id, name }], nodded, created_at, done_at }`.
