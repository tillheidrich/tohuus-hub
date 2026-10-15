# Guests and permissions

ToHuus Hub knows five kinds of people and devices. This page says what each can see and do, and where the rules live in the code.

| Who | Signs in? | Sees | Set up under |
|---|---|---|---|
| **Admin** | yes | everything, including settings, members, backups, tokens | first account from `ADMIN_NAME`; more under *Settings › Members* |
| **Member** | yes | the whole household; most settings read-only | *Settings › Members* (invite link) |
| **Permanent guest** | yes, own account | what their level allows (table below) | *Settings › Members › Our household › Add a permanent guest (Festen Gast hinzufügen)* |
| **Child** | never | a paired kid tablet with pictures; wishes wait for a parent | *Settings › Members › Kids (Kinder)* |
| **Guest link** | no account | ordering, read-only places, or adding to the list, depending on the link | *Guests & Bar › Guest links (Gäste & Bar › Gäste-Links)* |

API tokens are a sixth kind of actor, for machines: an "AI assistant" token only reaches MCP, a "Home Assistant" token only `/api/ha/*` and `/api/events`, a "Full API access" token acts like an admin.

## Permanent guest levels

A permanent guest (the aunt who is often there, a regular babysitter) is a normal sign-in account with `users.kind = 'guest'` and a level. The levels build on each other.

| Level | Opens | Can do |
|---|---|---|
| `order` | order, shopping | order from the sofa and the bar menu (read the order menu, never edit it), the shopping list incl. store mode, quick add, claims and sharing text onto the list; see which products exist |
| `stock` | + stock, where is what | everything in `order`, plus the overview, stock changes, products (incl. photo and enrichment), reading places and categories, where-is-what search, keeping stock fresh (quick check, opened, frozen, leftovers), barcode lookup, QR quick actions, using leftover and freezer boxes (not printing label sheets) |
| `recipes` | + recipes, week plan | everything in `stock`, plus recipes (incl. recipe import), the week plan, "what do we eat today", house versions, seeing the week, taking part in family votes, ratings and favourites. Plan templates and rotation stay with the family. |
| `family` | everything a member uses day to day | like a member, except the private areas listed below. Some household settings are read-only: start mode and staples, onboarding, region, places and categories, stores and the HA to-do link, the order menu. |
| `paused` (override only) | nothing | sees a "your access is paused" screen; can still sign out |

Every guest, at every level, can manage their own account: profile picture and likes, password, passkeys, sessions, push devices, the tour, and the people directory.

**Never for guests, at any level** (including `family`): settings, data and backups, members, invites, tokens, restore, guest links, channels, displays, kiosk, Telegram, demo data and reset, imports and receipts, spending and budgets, the receipt inbox and waste value, home care and tasks (incl. "Wer hat was im Blick"), the extras allowance, printer setup, sign-in policy and SSO, Home Assistant, kids, people administration, receipt recognition, trips (including sitter links), share tokens and the share inbox, starting the tour for the household.

On top of that, a request whose path contains one of these words is always refused for guests: `spend`, `spending`, `budget(s)`, `receipt(s)`, `bon(s)`, `import(s)`, `backup(s)`, `token(s)`, `restore`, `export.json`, `reset`, `settings`, `invite(s)`, `webdav`. Recipe imports (`/recipes/import/…`, `/recipes/open/…`) are the one exception; they follow the recipe rules.

Discreet and private shopping items are hidden from guests, and the overview never shows a guest the import queue.

### Tasks handed to a guest (15 Oct 2026)

Grandma waters the plants and feeds the cats while you're on holiday; your aunt helps at home while you're in hospital, or looks after Felix today. A permanent guest can be given single tasks:
- as their **doer**;
- as the **stand-in** in "Zu Hause, solange … weg ist" on a trip. `homePlan` lists permanent guests as takers, marked `guest: true`.

At every level except `paused`, the guest reaches only their own tasks, and only these two routes:
- `GET /api/guest-tasks`: tasks where they are the doer or stand-in, with name, note, due date, checklist and the stand-in reason.
- `POST /api/guest-tasks/:id/done`.

The rest of Aufgaben stays closed. Heute shows them as "Deine Aufgaben hier", and each one reminds them on their own devices. A stand-in reminder goes out even while the household is away and otherwise quiet.

### Temporary overrides

An admin can change a guest's level for a while: "full access until Sunday", "only ordering this weekend", or "paused until …". The effective level is computed from the clock on every request, so an override ends on time even if the server was down. The scheduler only clears expired overrides and tells open apps to refresh.

### How it is enforced

The rules live in [`server/lib/people-policy.ts`](../server/lib/people-policy.ts) and are checked centrally in `requireAuth` ([`server/lib/auth.ts`](../server/lib/auth.ts)) for every API route:

- Levels `order`, `stock` and `recipes` are an **allowlist**. A new route is closed for guests until someone adds it to the list.
- Level `family` is a **denylist** of everything private, plus a read-only list.
- Paths are lower-cased before matching, because Express routes match case-insensitively.
- The web app hides pages a guest cannot open (`guestAllows` in `web/src/people/People.tsx`), but that is only convenience. The server decides.

`LEVEL_AREAS` in the same file is what the settings screen and the `household_people` MCP tool show as "what this level opens".

## Children

Children never get a login. A child is a kid profile (an animal and a colour, optional birth year). Kid tablets are paired by an admin and are bound to that device. On the tablet a child picks from pictures; each wish waits for a parent (push with approve and decline buttons, or *Today*). Rules per child: which items, daily limits, quiet hours. Children can vote in a family food vote on a shared phone ("together" mode), and parents rate dishes for them.

## Privacy inside a household

Some things belong to one person, not to the household. Nobody else sees them – **admins included** – and they never end up in someone else's export.

| Personal | Where | Enforced in |
|---|---|---|
| Sessions (signed-in browsers) | `GET/DELETE /api/auth/sessions` – own only | `server/lib/auth-sessions.ts` |
| App devices (iPhone app tokens) | `GET/DELETE /api/auth/app/devices` – own only; `GET /api/tokens` (admins) lists machine accesses only (`mcp`, `ha`, `full`), never members' app tokens, and `DELETE /api/tokens/:id` cannot remove them | `server/routes/cloud.ts`, `server/routes/core.ts` |
| Push devices | `GET/DELETE /api/push/devices` – own only, also for admins | `server/routes/shop.ts` |
| Assistant conversations (and their undo log) | `GET/DELETE /api/assistant/conversations…` – own only | `server/lib/assistant.ts` |
| Personal AI setting (`ai.mine`) | `GET/PATCH /api/ai/settings` returns `mine` for the caller only | `server/routes/ai-settings.ts` |
| MCP connections (OAuth) | `GET/DELETE /api/oauth/connections` – own only | `server/routes/oauth.ts` |
| "Nur für mich" in *Was ToHuus sich merkt* | `POST /api/memory { text, onlyMe: true }` stores `ai_memory.private_to = <users.id>`; `GET /api/memory` returns other members' private rows to nobody (rows carry `onlyMe`); `DELETE` of someone else's private row answers 404; the person's own assistant and MCP connection (OAuth, as that person) see them, tokens without a person do not | `server/lib/memory.ts` |

**The admin export** (`GET /api/export.json`, cloud `GET /api/cloud/export`) contains every household table without credentials, and leaves out: other members' assistant conversations, messages and undo entries, other members' `user_prefs` (personal settings), memory rows marked "nur für mich" by someone else, and the OAuth tables. Code: `personalFilter()` in `server/lib/data.ts`. Test: `test/privacy.test.ts`.

## Guest links

A guest link is a random token (stored as a hash) with a name, an optional expiry and one or more scopes:

| Scope | What the guest sees |
|---|---|
| `bar` | the order menu with what is in stock; orders go to the order board |
| `stock` | read-only "where is what" for the chosen places: names and spots, no quantities; an optional note; optionally the voice command guide |
| `shopping` | add to the shopping list |

A babysitter link is a guest link with the `stock` scope and a note. A house-sitter link is created from a trip and ends the day after the trip. A party creates its own short-lived link that stops working when the party ends.

The voice command guide on a sitter page never lists locks, alarms, cameras, people, trackers, garage doors or gates, even if someone adds them by hand ([`server/lib/ha2-safety.ts`](../server/lib/ha2-safety.ts)). Scripts only appear when an admin adds them explicitly.

## Shared devices

An admin can mark a device as shared (the family tablet in the kitchen). On that device members switch person with a 4 to 6 digit PIN. These sessions are bound to the device and last at most 30 days. See [auth.md](auth.md#shared-family-devices-and-the-pin-switch).
