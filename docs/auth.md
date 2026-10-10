# Signing in

ToHuus Hub supports several ways to sign in. Everything is optional; admins switch methods on and off under
*Settings → Members → Ways to sign in*, and every member manages their own under *Settings → My account*.
The password stays as a fallback unless an admin restricts it to admins (emergency access).

| Method | What it needs | Notes |
|---|---|---|
| **Password** | – | scrypt-hashed, rate-limited per IP and per name. Optional two-step code (TOTP) per member. |
| **Passkey** | HTTPS (or `localhost`) | Face ID / Touch ID / Windows Hello / device PIN. Several per member. RP ID = host of `BASE_URL`. |
| **Sign-in link by e-mail** | SMTP, a confirmed address | One-time link, 15 minutes, stored hashed, bound to the browser that asked. |
| **Single sign-on (OpenID Connect)** | an OIDC provider | Authentik, Keycloak, Authelia, Forgejo/Gitea, Nextcloud, Google, Microsoft Entra … |
| **PIN switch** | a device an admin marked as *shared* | 4–6 digits, only on that device, sessions bound to it and limited to 30 days. |

Also: list of signed-in devices with "sign out others", password reset by e-mail (or a reset link an admin
hands over), "new sign-in" alerts (push + e-mail, only to the member concerned; event `auth.new_device`).

## E-mail links in detail

1. *Link per e-mail* on the sign-in screen. The answer is always the same ("if the address is known, a link
   is on its way"), so nobody can find out which addresses exist. At most 3 mails per address per 15 minutes.
2. The asking browser gets a short-lived nonce cookie and shows a **4-digit code**.
3. Opened **in the same browser**: signed in immediately.
   Opened **somewhere else** (the mail app on the phone, a forwarded mail): the page asks for the code shown on
   the asking device. With the right code you choose *Sign in on this device* or *Sign in the device that asked*
   (the asking page is waiting and signs in by itself). Three wrong codes burn the link.
4. The token is in the URL fragment (`/anmelden/link#…`): it never reaches server logs, and mail scanners that
   pre-open links cannot use it up – only the page's own request does.

**iPhone home-screen app:** links from Mail open in Safari, which has its own cookies. Use *Sign in the device
that asked* – the home-screen app then signs in by itself.

## Passkeys

*Settings → My account → Passkeys → Add*. Sign in with *Sign in with passkey*; when names are hidden on the sign-in
screen, the name field also offers passkeys in the keyboard/autofill bar (conditional UI).

- The RP ID is the host of `BASE_URL`. Passkeys stop working if you move the app to a different host name –
  members then add new ones.
- User verification is required (Face ID, fingerprint or device PIN). Security keys without a PIN are refused.
- iOS: works in Safari and in the home-screen app (iOS 16+). Passkeys saved in iCloud Keychain sync to the
  member's other Apple devices.

## Single sign-on (OpenID Connect)

*Settings → Members → Single sign-on*: issuer URL, client ID, client secret, button text, scopes
(default `openid email profile`). Copy the **redirect URI** shown there into your provider:

```
https://your-host/api/auth/oidc/callback
```

The flow is Authorization Code with PKCE (S256), state (bound to the browser by a cookie) and nonce; the ID
token's signature, issuer, audience, expiry and nonce are checked against the provider's published keys.

**Who is who?** In this order:
1. a provider account already linked to a member (*My account → Single sign-on → Link*),
2. a provider e-mail marked `email_verified` that equals a member's *confirmed* address (the account is linked
   from then on),
3. *Create members on first sign-in* (off by default; choose the role) – otherwise the sign-in is refused.

*Trust e-mail addresses without "verified" flag* accepts provider addresses without `email_verified=true`.
Only turn it on if your provider verifies addresses itself.

**Passwords: admins only** turns the household into "SSO / passkey / link" mode while admins keep a password as
break-glass access.

Environment variables seed the settings on the **first start only**; afterwards the UI wins:
`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_BUTTON_LABEL`, `OIDC_SCOPES`, `OIDC_AUTO_CREATE`.

### Authentik

1. *Applications → Providers → Create → OAuth2/OpenID Provider*. Client type *Confidential*,
   redirect URI as above (strict), signing key: any certificate (RS256).
2. *Applications → Create*, slug e.g. `tohuus`, provider from step 1.
3. In ToHuus Hub: issuer `https://auth.example.org/application/o/tohuus` (no trailing slash), client ID and secret
   from the provider.
4. Authentik's default e-mail mapping may send `email_verified: false`. Either link accounts once from
   *My account*, or turn on *Trust e-mail addresses without "verified" flag*.

### Forgejo / Gitea

1. *Site administration → Integrations → Applications* (or *User settings → Applications*) → *Create OAuth2
   application*, redirect URI as above, *Confidential client*.
2. Issuer: `https://git.example.org` (your Forgejo base URL, no trailing slash). Scopes `openid email profile`.
3. Forgejo puts the e-mail in the userinfo response; ToHuus Hub fetches it automatically.

### Google

1. Google Cloud console → *APIs & Services → Credentials → Create OAuth client ID → Web application*,
   authorised redirect URI as above (must be HTTPS).
2. Issuer `https://accounts.google.com`, client ID and secret from the console.
3. Google marks addresses as verified, so members are matched by their confirmed e-mail.

### Others

- **Keycloak:** issuer `https://kc.example.org/realms/<realm>`.
- **Authelia:** issuer `https://auth.example.org`; register a client with `redirect_uris` as above and
  `token_endpoint_auth_method: client_secret_basic`.
- **Nextcloud** (app *OIDC Identity Provider*): issuer is your Nextcloud URL.
- **Microsoft Entra ID:** use the tenant-specific issuer `https://login.microsoftonline.com/<tenant-id>/v2.0`
  (the `common` endpoint is not supported). Entra only sends `email` as an optional claim – link accounts from
  *My account* instead.

**iPhone home-screen app:** depending on the iOS version, the provider's page may open in a Safari sheet and the
sign-in may land in Safari instead of the app. If that happens, use a passkey or a sign-in link in the app.

## Shared family devices and the PIN switch

On the kitchen tablet, an admin opens *My account → This is a shared family device* (optionally with a name).
Members set a 4–6 digit PIN under *My account*. The sign-in screen on that tablet then shows their pictures;
tap, type the PIN, done. Wrong PINs: 5 per member and 10 per device in 15 minutes. PIN sessions only work
together with that tablet's device cookie and end after 30 days. Turning shared mode off ends them.

## Two-step sign-in (TOTP)

*My account → Two-step sign-in*: scan the QR code with any authenticator app (Aegis, 2FAS, Google
Authenticator, 1Password …), confirm with a code, keep the 8 recovery codes. Password sign-ins then also need a
code; codes cannot be replayed. Passkeys, e-mail links and SSO don't ask for it (they are a separate factor).
Admins can require it for admins' password sign-ins and turn it off for a member who lost their phone.

## Locked out?

Set `AUTH_BREAK_GLASS=true` and restart: passwords work for everyone again and the two-step requirement for admins
is suspended. Remove it afterwards. An admin can always create a password reset link for a member
(*Members → How members sign in → member*).

## Security notes

- All one-time tokens (links, resets, address confirmation) are random 256-bit values stored as SHA-256 hashes.
- State-changing requests are checked against the app's own origin. The OIDC callback is a plain GET redirect
  from the provider and is protected by state cookie, PKCE and nonce.
- Sessions: random tokens stored hashed, httpOnly + SameSite=Lax cookies, 365 days (PIN sessions 30 days).
  *My account* lists them with browser, sign-in method, IP and last activity.
- Exports and backups never contain sessions, one-time tokens, TOTP secrets, PIN hashes or the client secret.
