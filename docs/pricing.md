# Preise: kein Free in der Cloud, nach der Testphase „nur lesen“

## Entscheidung vom 18.10.2026 (gilt)

Till (18.10.2026, 03:02): „Free-User sollten wirklich nur das Nötigste haben und schnell checken, dass es ohne das Abo oder eigenen Server keinen Sinn macht.“ Entscheidung 03:06: **ToHuus Cloud hat kein Free mehr.** Grundlage: Wiki „Monetarisierung ToHuus ab Store-Start“ (18.10.2026).

| Plan | What | Price |
|---|---|---|
| **Trial** | 14 days at Plus level with every new household, no payment details, nothing renews on its own. | 0 € |
| **Haushalt** | Full history, price history and spending, connected households, mirrored lists, AI imports, 100 assistant messages a month, 2 GB. | 3,99 €/month or 34,99 €/year |
| **Plus** | Haushalt plus the assistant for everyday use, week plan from the pantry, monthly analysis, substitutes, Plus recipes. 1,500 messages a month, then slower; **from 3,000 AI pauses until the month ends** (F5). 5 GB. | 5,99 €/month or 59,99 €/year |
| **Plus for good** | optional `plus.lifetime`, same limits as Plus (incl. the AI cost cap). | set in App Store Connect |
| **Read-only** (no plan) | After the trial or a subscription without a new plan: everything visible (full history), export, delete account/household, buy/restore, gift codes, hardship form, notification and AI-consent settings. Writing answers `402 { code: 'plan.readonly', reason: 'trial_end' }`. Ticking off the shopping list keeps working for 7 days after the end (`GRACE_DAYS`). Nothing is deleted. | – |
| **Self-hosted** | Everything, unchanged, with your own AI. | free |

- **Where:** `server/lib/plans.ts` (`afterTrial()`, `PLAN_LIMITS.readonly`, `readonlyGuard`, `READONLY_ALLOW`, `graceWrite`, `GRACE_DAYS`), wired in `server/index.ts` for `/api`. The switch back to the old Free is one place: back office › Einstellungen `trial.after` = `free` (or `TRIAL_AFTER=free`).
- **Transition:** households without a plan when the update starts get a new 14-day trial from that moment (accounts.db schema step in `server/lib/accounts.ts`), then the same rule.
- **Untouched:** beta gift (`beta.gift`), gift codes, hardship licences, operator plans, Plus for good. Members, children and guests never pay; one plan covers the household.
- **AI cost cap (F5):** every model answer is priced (`server/lib/ai-prices.ts`, Mistral Small 2603 0.15/0.60 $ per million tokens, OpenRouter 18.10.2026) and added to the household (`usage_counters` kind `aiCostMicro`). From `ai.household_cost_cap` (default 3.50 USD ≈ 3 €) AI pauses for that household until the 1st (`402/429 quota.ai_paused`).
- **End of trial (F1):** `server/lib/trial-end.ts` – mail/push 3 days before and on the last day (admins only, once per trial end, switchable), look back `GET /api/billing/trial-summary`.
- **Apple:** subscriptions only, with a free trial run by the server, is allowed (3.1.2). The app keeps a way on at every read-only moment: plans, restore purchases, export. The iPhone app never points to buying on the web (3.1.1). App Review needs a demo household with an active trial or plan.

---

## Ersetzt am 18.10.2026: Entscheidung vom 15.10.2026

Decision of 15 Oct 2026. Till: "In der Free-Version wirklich nur das Minimum. Man soll direkt die Testversion buchen. Und ein Funnel-Formular nach dem Motto 'Wir können uns das nicht leisten' – das landet als E-Mail bei mir, ohne dass meine Adresse sichtbar wird. Transparent: Die Abos finanzieren das mit."

## Plans (ToHuus Cloud)

| Plan | What | Price |
|---|---|---|
| **Free** | The minimum, **without any AI**: shared list with shop mode, tasks, Im Kopf, week plan and recipes by hand, reviews, sharing. The assistant only understands simple commands without AI ("Milch und Brot"). History of 30 days, 20 uploads a day, 100 MB. | 0 € |
| **Trial** | 14 days at Plus level. It starts with every new household, needs no payment data, and falls back to Free afterwards. | 0 € |
| **Haushalt** | Full history, price history and spending, connected households, mirrored lists, AI imports, 100 assistant messages a month, 2 GB. | 3,99 €/month or 34,99 €/year |
| **Plus** | Haushalt plus the assistant for everyday use (week plan from the pantry, monthly analysis, substitutes from stock), 1,500 messages a month as fair use (slowed down, never blocked), 5 GB. | 5,99 €/month or 59,99 €/year |
| **Self-hosted** | Everything, with your own AI (any OpenAI-compatible provider, or none). | free |

**Why free stays in the cloud and is not "local only on the iPhone":**
- Without AI, a household costs almost nothing to run: one small SQLite file and no model calls.
- A local-only app would need a second storage and sync engine for the same features, and would not work on the web.
- The real cost is AI, and Free has none. AI calls answer HTTP 402 `plan.assistant` or 429 `quota.*` with a message that points to the trial.

`plans.ts PLAN_LIMITS.free`: `assistantPerMonth 0`, `receiptAiPerDay 0`, `importAiPerDay 0`, `uploadsPerDay 20`, `storageBytes 100 MB`, `historyDays 30`. `/api/assistant/status` carries `planAi`.

## "Wir können uns das gerade nicht leisten" (`server/lib/hardship.ts`)

- **The form:** it is on the website (pricing section) as a plain HTML form, with no script and no CORS. It posts to `POST /api/cloud/hardship` (cloud only) and then redirects to `de/danke.html` or `thanks.html`.
  - Fields: e-mail, optional name, optional household ("2 Erwachsene, 2 Kinder"), optional message, plus `website` as a honeypot.
  - It is rate-limited to 5 requests an hour per IP. Each address can have only one open request.
- **Where the request goes:** it lands in accounts.db (encrypted) and as an e-mail to `OPERATOR_EMAILS`. The operators' address is never shown anywhere.
- **Back office** (`/betrieb` › Härtefälle; `GET /api/operator/hardship`, `POST …/:id/grant { plan, days }`, `POST …/:id/decline`):
  - One click creates a single-use plan code (`gifts.ts`) and e-mails it to the person, who redeems it on the web.
  - Without SMTP the code is shown in the back office instead, to be passed on by hand.
- **Privacy:** the record holds only what the person typed. It is deleted 180 days after it was answered. There is no tracking.
- **Transparency on the website:** "Mit jedem Abo finanziert ihr auch Lizenzen für Familien, die es sich gerade nicht leisten können."
