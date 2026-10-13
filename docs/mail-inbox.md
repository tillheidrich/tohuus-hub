# Bon-Postfach in ToHuus Cloud (receipt address per household)

Status 13 Oct 2026: concept agreed with the founder, receiving and recognition built, waiting for the domain
(`tohuus-app.de`) and sample mails to tune the recognition. Plus feature (and the 14-day trial).

## What the person sees

*Importe › Bons per E-Mail* (web) and *Bons › Per E-Mail* (iPhone):

- the household's own address, e.g. `bons-7k2m9qx4hd@bons.tohuus-app.de`, with a copy button
- one sentence: "Leite Bons, Bestell- und Abholbestätigungen an diese Adresse weiter. Alles andere verwirft ToHuus
  sofort, ohne es zu speichern."
- how to forward automatically (Gmail filter, Outlook rule, iCloud rule) **by sender**, so one-time codes and
  newsletters never leave the person's mailbox in the first place
- counters: received, became receipts, ignored (with the reason, never the content)
- "Neue Adresse" (admins): the old address stops working at once (when it leaked or gets spam)

No IMAP, no password, no mailbox of our own for the person, no mail is kept.

## How a mail flows

```
shop → person's mailbox ──(forward or filter rule)──▶ MX bons.tohuus-app.de
      ──▶ ToHuus SMTP listener (inside the cloud app, port 25, Hetzner)
          ├─ RCPT TO unknown address → rejected in the SMTP dialogue (no bounce spam, no storage)
          ├─ household without Plus → accepted, ignored, counted ("plan")
          ├─ quick filter (in memory): one-time codes, sign-in mails, newsletters without receipt → dropped, counted
          └─ recognition (same code as the self-hosted IMAP inbox, lib/retail-inbox.ts › processMessage):
               PDF attachment (eBon, REWE pickup/delivery bill) → import
               receipt in the mail body (HTML / text eBon)       → import
               REWE order confirmation / pickup notice           → import (order), matched with the bill later
               nothing recognised                                → dropped, counted ("no receipt")
```

Only the resulting imports are stored, exactly like an upload, and go through the usual review. The mail itself
(headers, body, attachments that were not a receipt) only lives in memory while it is processed. Unrecognised PDFs
are deleted again right away. The AI reading fallback runs only for known shop senders (cost, privacy).

## Receiving: why our own SMTP listener on Hetzner

| Option | Pro | Contra |
|---|---|---|
| **SMTP listener in the ToHuus app (chosen)** | everything stays on the Hetzner server in Germany, no extra service or contract, no separate mail server to maintain, addresses are checked live against the database | port 25 must be reachable on the server (Hetzner allows inbound 25; only outbound is restricted), one more port in Coolify |
| EU inbound service (e.g. a provider's inbound webhook) | no open port | another processor (DPA, privacy policy), costs, mails pass a third party |
| Cloudflare Email Routing + Worker | free, DNS is already there | US company, every receipt passes Cloudflare |

The listener is a small inbound-only SMTP server (`smtp-server`, the Nodemailer project, MIT): no AUTH, no relay,
only `RCPT TO` addresses that exist, 15 MB per mail, STARTTLS with the server's certificate when configured, rate
limits per sending IP and per household. A webhook entry (`POST /api/mail/inbound`, secret header) takes the same
raw mail, so an inbound service could be added later without changing the recognition.

## Setup (once the domain exists)

1. DNS at Cloudflare (proxy off for mail):
   - `bons.tohuus-app.de  MX 10  mail.tohuus-app.de`
   - `mail.tohuus-app.de  A     <Hetzner IPv4>` (and `AAAA` if the server has IPv6)
   - optional: `_mta-sts` / TLS reporting later; no SPF/DKIM needed for receiving only
2. Coolify, app `tohuus-cloud`:
   - expose TCP port 25 → container port 2525 (Coolify › Network › Ports Mappings `25:2525`)
   - env `MAIL_INBOUND_DOMAIN=bons.tohuus-app.de`, `MAIL_SMTP_PORT=2525`
   - optional TLS: `MAIL_TLS_CERT_FILE` / `MAIL_TLS_KEY_FILE` pointing at a certificate for `mail.tohuus-app.de`
     (e.g. from Coolify's Traefik certificates volume); without it, mail is accepted unencrypted (most shops use TLS
     where offered – recommended to set it up)
   - optional webhook: `MAIL_INBOUND_SECRET=<long random>`
3. Hetzner Cloud firewall (if used): allow inbound TCP 25.
4. Test: send a mail to the household address; the counter in *Importe › Bons per E-Mail* goes up.

Until `MAIL_INBOUND_DOMAIN` is set, the feature is invisible in the apps.

## Recognition, next step with sample mails

The founder will send anonymised examples of order confirmations, pickup notices and receipt mails. Each becomes a
test fixture (`test/fixtures/mail/*.eml`, invented names and addresses) so the recognition is checked on every
change. Known shop senders for the AI fallback live in `server/lib/mail-inbound.ts` (`KNOWN_SENDERS`).

## Privacy

- The privacy policy gets a paragraph: forwarded mails are processed in memory only, only receipts are stored, the
  rest is discarded without being stored; counters without content; Hetzner as host (already listed).
- Members see the address; guests do not. The address does not reveal the household (random token).
