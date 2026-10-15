# Preise, Free ohne KI, "Wir können uns das nicht leisten"

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
