# Preise: kein Free in der Cloud, nach der Testphase „nur lesen“

## Nachtrag 18.10.2026 (2): KI-Grenzen und Kostenbremse je Tarif (gilt)

Till (18.10.2026): „Mache ich überhaupt Plus bei 1.500 KI-Nachrichten im Monat?“ Antwort: bei typischer Nutzung ja, deutlich. Wer die alten Grenzen ausreizt, kostete aber mehr, als ein Plus-Jahresabo nach Apple und USt. bringt. Deshalb neu:

| | vorher | jetzt |
|---|---|---|
| Plus und Testphase: Nachrichten in voller Länge | 1.500 / Monat | **800 / Monat** |
| Plus und Testphase: KI pausiert bis Monatsende ab | 3.000 | **1.500** (dazwischen kürzere Antworten, max. 250 Token) |
| Haushalt: Nachrichten | 100 | 100 (unverändert) |
| KI-Kostenbremse je Haushalt und Monat | 3,50 $ für alle | **Haushalt 1,50 $, Plus und Plus für immer 2,50 $, Testphase 1,00 $** |
| Bons/Importe mit KI pro Tag | Haushalt 40/40, Plus 60/100 | unverändert (die Kostenbremse schützt) |
| Preise | 3,99/34,99 €, 5,99/59,99 € | **unverändert** |

**Wo:** `server/lib/plans.ts` (`PLUS_FAIR_MESSAGES`, `PLUS_HARD_MESSAGES`, `DEFAULT_AI_COST_CAPS`, `capClassOf`, `aiCostCap(plan)`, `householdsAtCostCap`), Einstellungen in `/betrieb` › Geld: `ai.household_cost_cap` (= Plus, wie bisher), neu `ai.household_cost_cap.haushalt` und `ai.household_cost_cap.trial`; Umgebung `AI_HOUSEHOLD_COST_CAP`, `…_HAUSHALT`, `…_TRIAL`. **Prüfen:** Steht in `/betrieb` noch ein gespeicherter Wert 3.5, gilt er weiter für Plus – Feld leeren.

### Kosten je Vorgang (abgeleitet, nicht gemessen)

Gemessen wurde die Prompt-Größe (`promptFor` mit einem Testhaushalt, 15 Einträge auf der Liste): System-Prompt mit Kontext 2.100–3.100 Zeichen, Werkzeugdefinitionen 0,9–10,4 Tsd. Zeichen (3–25 Werkzeuge je Thema; alle 45 zusammen 19 Tsd.), zusammen **≈ 850–3.850 Token** (3,5 Zeichen/Token). Dazu bis 12 frühere Nachrichten und je Werkzeug-Runde das Ergebnis (bis 8.000 Zeichen); bis 4 Runden je Nachricht (`MAX_ROUNDS`). Echte Token aus `ai_usage_daily` waren nicht lesbar (kein Zugriff in den Container); `/betrieb › Umsatz` zeigt sie ab jetzt je Tarif.

| Vorgang (Mistral Small 2603, 0,15/0,60 $ je Mio.) | Eingabe / Ausgabe Token | Kosten |
|---|---|---|
| Nachricht leicht (1 Runde) | 2.500 / 120 | 0,045 ct $ |
| Nachricht typisch (2 Runden, ein Werkzeug) | 7.700 / 240 | **0,13 ct $** |
| Nachricht aufwendig (3 Runden, Rezept) | 27.000 / 900 | 0,46 ct $ |
| Nachricht Maximum (4 Runden, voller Verlauf) | 54.000 / 1.600 | 0,9 ct $ |
| Bon, 1 Foto (Bild ≈ 2.500 Token bei 1.600 px) | 3.100 / 1.200 | 0,12 ct $ |
| Bon mit zweitem Versuch Mistral Large 4 (1,36/4,18 $) | + 3.100 / 1.200 | + 0,92 ct $ |
| Bon im Mittel (Annahme: jeder 4. braucht Large) | | **≈ 0,35 ct $** |
| Import Rezept (Link/Text/Foto) | 4.700 / 1.000 | 0,13–0,15 ct $ |
| Wochenplan, Monatsauswertung | 5.000 / 3.000 | ≈ 0,26 ct $ |

1 $ KI ≈ 0,91 € (Kurs 0,86 + 5,5 % OpenRouter-Gebühr, Annahme).

### Deckungsbeitrag je Haushalt und Monat (€, nach 19 % USt. und Apple)

Netto: Haushalt 2,85 € (Monat) / 2,08 € (Jahr), Plus 4,28 € / 3,57 € bei 15 %; bei 30 %: 2,35 / 1,72 / 3,52 / 2,94 €. Apple führt die USt. ab – Kleinunternehmer ändert daran nichts. Server/Speicher anteilig 0,05–0,12 € (Maximum: volle 2 bzw. 5 GB, 0,17 / 0,35 €).

Nutzungsprofile: **leicht** 30 Nachrichten, 8 Bons; **typisch** Haushalt 100 Nachr. + 20 Bons (0,27 $), Plus 150 Nachr. + 20 Bons + 10 Importe (0,37 $); **stark** Haushalt 100 Nachr. + 120 Bons (0,72 $), Plus 600 Nachr. + 60 Bons + 30 Importe (1,77 $); **Maximum** = Kostenbremse voll.

| Tarif (Apple 15 % / 30 %) | leicht | typisch | stark | Maximum alt (3,50 $) | Maximum neu |
|---|---|---|---|---|---|
| Haushalt Monat | 2,74 / 2,23 | 2,54 / 2,03 | 2,08 / 1,57 | **−0,50 / −1,00** | 1,32 / 0,82 |
| Haushalt Jahr | 1,97 / 1,60 | 1,77 / 1,40 | 1,31 / 0,94 | **−1,26 / −1,63** | 0,55 / 0,18 |
| Plus Monat | 4,15 / 3,40 | 3,87 / 3,12 | 2,55 / 1,80 | 0,75 / 0,00 | 1,66 / 0,91 |
| Plus Jahr | 3,44 / 2,81 | 3,17 / 2,53 | 1,84 / 1,21 | 0,05 / **−0,58** | 0,95 / 0,32 |

Ohne Bremse hätte ein Plus-Haushalt an den alten Grenzen (3.000 Nachrichten, 60 Bons/Tag, 100 Importe/Tag) rund 16 $ im Monat gekostet. **Testphase:** typisch ≈ 0,10 $ (40 Nachrichten, 6 Bons); höchstens 1 $ je Kalendermonat (eine Testphase kann zwei Monate berühren: ≤ 1,81 €; vorher bis 6,35 €). Bei 10 % Umwandlung kostet die Testphase je zahlendem Haushalt ≈ 0,90 € einmalig.

---

## Entscheidung vom 18.10.2026 (gilt, außer KI-Grenzen und Kostenbremse – ersetzt durch Nachtrag (2))

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

## Nachtrag 18.10.2026 (3): KI-Kosten gesenkt – zweiter Bon-Versuch und Assistent-Kontext

**Zweiter Bon-Versuch:** `AI_MODEL_VISION_HARD` ist jetzt **Mistral Medium 3.1** (`mistralai/mistral-medium-3.1`,
OpenRouter 0,40 / 2,00 $ je Mio. Token, Bilder ja, 131k Kontext; geprüft 18.10.) statt Mistral Large 4 (1,36 / 4,18 $
als Vollpreis angesetzt). Large 4 springt nur ein, wenn Medium ausgelastet/weg ist (`DEFAULT_FALLBACKS.visionHard`;
neu: auch bei 404 „No endpoints found“, `ai.ts modelGone`). Mistral Medium 3.5 (`mistralai/mistral-medium-3-5`,
1,50 / 7,50 $) ist teurer als Large 4 und wird nicht genutzt; Preis steht trotzdem in `ai-prices.ts`.

| Bon mit zweitem Versuch (3.100 / 1.200 Token) | vorher Large 4 | jetzt Medium 3.1 |
|---|---|---|
| zweiter Versuch | + 0,92 ct $ | **+ 0,36 ct $** (−61 %) |
| Bon im Mittel (jeder 4. braucht den zweiten Versuch) | ≈ 0,35 ct $ | **≈ 0,21 ct $** |

**Assistent-Kontext** (gemessen mit `test/assistant-cost.test.ts`, Haushalt mit 80 gemerkten Einträgen; Zeichen
System-Prompt + Werkzeugdefinitionen, Token ≈ Zeichen/4):

| Nachricht (Bildschirm) | vorher | nachher |
|---|---|---|
| „Haben wir noch Kaffee?“ (–) | 6.897 + 3.224 Z., 11 Werkzeuge, ≈ 2.530 Tok. | 3.376 + 2.982 Z., 10 W., **≈ 1.590 Tok. (−37 %)** |
| „Was kochen wir heute?“ (Kochen) | 7.500 + 3.641, 11 W., ≈ 2.785 | 3.979 + 3.399, 10 W., **≈ 1.845 (−34 %)** |
| „Was steht diese Woche an?“ (Aufgaben) | 7.693 + 7.172, 14 W., ≈ 3.716 | 4.172 + 2.680, 5 W., **≈ 1.713 (−54 %)** |
| „Leg Bad putzen auf Samstag“ (Aufgaben) | ≈ 3.716, 14 W. | 4.172 + 2.215, 4 W., **≈ 1.597 (−57 %)** |
| „Wer ist diese Woche mit dem Müll dran?“ (Aufgaben) | ≈ 3.716, 14 W. | 4.172 + 3.186, 6 W., **≈ 1.840 (−50 %)** |
| „Welche Schuhgröße hat Mika?“ (Wissen) | 7.209 + 2.262, 5 W., ≈ 2.368 | 3.470 + 2.020, 4 W., **≈ 1.373 (−42 %)** |

Wie: (1) Die Zeile „Remembered“ hat eine Obergrenze (`assistant-context.ts` `MEMORY_LINE_MAX` 1.200 Zeichen,
`MEMORY_ENTRIES_MAX` 25), Einträge mit Wörtern aus der Nachricht zuerst, dann die neuesten, Rest als „+N more
remembered“. MCP bekommt weiter alles. (2) Aufgaben-Thema nach Anfrage (`assistant-tools.ts` `taskToolsFor`):
`tasks_list`, `task_add`, `task_done` immer, die übrigen (Zurücknehmen, Demnächst, Zuständig, Überblick, Im Kopf,
Rückblick, Unterwegs) nur bei passenden Wörtern; `forget` nur bei „vergiss/lösch …“. (3) Werkzeugbeschreibungen der
Aufgaben gekürzt. Grenzen im Test: ≤ 10 Werkzeuge, < 8.000 Zeichen je Aufruf. Pro Runde gilt die Ersparnis bei jedem
Werkzeug-Durchlauf erneut (bis 4 Runden). Eine typische Nachricht (2 Runden) sinkt damit von ≈ 7.700 auf ≈ 4.500
Eingabe-Token, ≈ 0,13 → ≈ 0,08 ct $ (Annahme, nicht live gemessen).

Außerdem ohne KI (kostet nichts): „Ich hab den Müll rausgebracht“, „Spülmaschine ausgeräumt“, „hab gestaubsaugt“
haken die passende offene Aufgabe ab (`assistant-done.ts`, mit Rückgängig; mehrere Treffer → Rückfrage).
