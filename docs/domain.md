# Domain: where it lives and how to move to tohuus-app.de

Today: website `tohuus.heidrich-digital.de` (GitHub Pages), cloud `cloud.tohuus.heidrich-digital.de` (Coolify on
Hetzner), DNS at Cloudflare, the domain itself at all-inkl. Planned: `tohuus-app.de` (registered at United Domains,
DNS moved to Cloudflare like today).

Suggested names on the new domain:

| What | New name |
|---|---|
| Website, help, Ratgeber | `tohuus-app.de` (and `www.tohuus-app.de` → redirect) |
| ToHuus Cloud (app, API) | `cloud.tohuus-app.de` |
| Receipt addresses (Bon-Postfach) | `bons.tohuus-app.de` (MX only, docs/mail-inbox.md) |

## Where the domain is written down (13 Oct 2026)

| Place | What to change | Notes |
|---|---|---|
| Coolify env of `tohuus-cloud` | `BASE_URL=https://cloud.tohuus-app.de`, `SITE_URL=https://tohuus-app.de`, later `MAIL_INBOUND_DOMAIN=bons.tohuus-app.de` | server: `server/config.ts` (`baseUrl`, `siteUrl`); `/api/instance` hands `siteUrl` to the apps |
| `site/src/config.mjs` | `SITE`, `CLOUD` | everything on the website (pages, posts, facts, sitemap, llms.txt, legal) is built from these |
| `site/CNAME` | `tohuus-app.de` | GitHub Pages › Settings › Pages › custom domain, HTTPS on |
| `web/src/urls.ts` | `SITE_URL`, `CLOUD_URL` defaults (or `VITE_SITE_URL` / `VITE_CLOUD_URL` at build time) | help links and the Home Assistant page |
| `ios/Shared/SharedConfig.swift` | `cloudURL`, `siteURL` | app, watch, widgets |
| `ios/project.yml` | `com.apple.developer.associated-domains`: add `webcredentials:cloud.tohuus-app.de` (keep the old one for a while) | needs a new build; the server serves `/.well-known/apple-app-site-association` on any host |
| `ha-integration/custom_components/tohuus_hub/const.py` | `CLOUD_URL` | new integration release; existing installations keep their stored URL (see below) |
| Apple Developer › Services ID `de.heidrichdigital.tohuus.web` | add domain `cloud.tohuus-app.de` and return URL `https://cloud.tohuus-app.de/api/auth/apple/callback` | Sign in with Apple on the web |
| App Store Connect | Server Notifications v2 URL, privacy policy URL, support URL, marketing URL | |
| `LEGAL_PRIVACY_URL`, `LEGAL_TERMS_URL` env | new website URLs | the apps show them |
| Google Search Console / Bing Webmaster | add the new property, submit `sitemap.xml`, use "change of address" | |

Company links (`heidrich-digital.de/impressum`, publisher in structured data) stay as they are.

## Order for the move

1. Register `tohuus-app.de`, put its DNS on Cloudflare (name servers at United Domains → Cloudflare).
2. DNS: `cloud` A/AAAA → the Hetzner server (proxy off, like today), apex and `www` → GitHub Pages
   (`185.199.108–111.153` and AAAA, or CNAME flattening to `tillheidrich.github.io`), later `MX bons` (mail inbox).
3. Coolify: add `cloud.tohuus-app.de` as a second domain of `tohuus-cloud` (both names served, certificates from
   Let's Encrypt), then set `BASE_URL` / `SITE_URL` to the new names and redeploy.
4. Website: change `site/src/config.mjs` and `site/CNAME`, build, merge; in GitHub Pages set the custom domain.
   The old website domain: a Cloudflare redirect rule `tohuus.heidrich-digital.de/*` → `https://tohuus-app.de/$1` (301).
5. Apps: change `web/src/urls.ts`, `SharedConfig.swift`, `project.yml`; new iOS build; HA integration release.
6. Keep `cloud.tohuus.heidrich-digital.de` running in parallel for at least three months. Do not redirect it:
   older app builds, Home Assistant installations and API clients keep using it directly.

## What breaks if you are not careful

- **Passkeys** are bound to the cloud host name (RP-ID = host of `BASE_URL`). After the switch, existing passkeys no
  longer work on the new name. People sign in with password, mail link or Apple and add a new passkey; the app shows
  that path. Announce it in the release notes.
- **Sessions in the browser** are per host: people sign in once more on the new address.
- **Home Assistant**: each installation stores the server URL. As long as the old host keeps serving, nothing breaks;
  in the integration's options people can switch to the new address.
- **Receipt addresses** (`bons-…@`) only exist on the new domain from the start (docs/mail-inbox.md), so they never
  have to move.
