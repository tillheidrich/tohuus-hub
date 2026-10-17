/**
 * What did someone paste into a code or link field on the start pages (sign-in, sign-up, invitation)?
 * One answer for every field, so a code never ends in "doesn’t look like an invitation link" (tester, 18 Oct 2026).
 * The iPhone app has the same rules in ios/ToHuus/Features/Start/JoinInviteView.swift (StartCode).
 *
 *   access   access code for a new account (beta gate, server/lib/beta.ts: "TOHU-XXXX-XXXX", or any short code
 *            the operator chose) → sign-up with the code filled in
 *   gift     plan code ("GIFT-XXXX-XXXX", server/lib/gifts.ts) → redeemed after sign-in on the web, Settings › Abo
 *   invite   invitation into a household (https://…/einladung/<token>, or the bare token) → /einladung/<token>
 *   connect  tohuus://connect?server=…&code=… (web: Settings › My account › Connect the iPhone app) → for the app
 *   address  just a web address (e.g. the cloud's own) – nothing to open, only explain
 */
export type StartCode =
  | { kind: 'empty' }
  | { kind: 'access'; code: string }
  | { kind: 'gift'; code: string }
  | { kind: 'invite'; token: string; base?: string }
  | { kind: 'connect'; url: string }
  | { kind: 'address'; url: string }
  | { kind: 'unknown' };

/** like server/lib/beta.ts normCode: upper case, spaces/underscores → "-", nothing else */
export const normStartCode = (s: string) =>
  s.trim().toUpperCase().replace(/[\s_]+/g, '-').replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

/** "TOHU-82BM-3EYT", also typed as "tohu 82bm 3eyt" or "TOHU82BM3EYT" (also inside a longer message) */
const prefixed = (raw: string, prefix: 'TOHU' | 'GIFT'): string | null => {
  const m = raw.toUpperCase().match(new RegExp(`(?:^|[^A-Z0-9])${prefix}[\\s_-]*([A-Z0-9]{4})[\\s_-]*([A-Z0-9]{4})(?![A-Z0-9])`));
  return m ? `${prefix}-${m[1]}-${m[2]}` : null;
};

export function classifyStartCode(raw: string): StartCode {
  const s = (raw ?? '').trim();
  if (!s) return { kind: 'empty' };
  const connect = s.match(/tohuus:\/\/connect\?[^\s"'<>]+/i);
  if (connect) return { kind: 'connect', url: connect[0] };
  const url = s.match(/https?:\/\/[^\s"'<>]+/i);
  if (url) {
    try {
      const u = new URL(url[0]);
      const parts = u.pathname.split('/').filter(Boolean);
      const i = parts.findIndex((p) => p === 'einladung' || p === 'invite');
      if (i >= 0 && parts[i + 1]) {
        const prefix = parts.slice(0, i).join('/');
        return { kind: 'invite', token: decodeURIComponent(parts[i + 1]), base: `${u.origin}${prefix ? `/${prefix}` : ''}` };
      }
    } catch {
      /* not a usable URL – look at the rest */
    }
  }
  const access = prefixed(s, 'TOHU');
  if (access) return { kind: 'access', code: access };
  const gift = prefixed(s, 'GIFT');
  if (gift) return { kind: 'gift', code: gift };
  // a web address with a code in its query (…/signup?code=…)
  if (url) {
    try {
      const c = new URL(url[0]).searchParams.get('code');
      if (c) return classifyStartCode(c);
    } catch {
      /* ignore */
    }
    return { kind: 'address', url: url[0] };
  }
  // one word: an invitation token is long (24 random bytes, base64url, maybe with a household prefix "h…_"),
  // an access code the operator typed himself is short
  if (/^[A-Za-z0-9_-]{24,}$/.test(s)) return { kind: 'invite', token: s };
  // (one word with a digit, e.g. "FAMILIE2026"; plain words like "hallo" stay unknown)
  if (/^[A-Za-z0-9-]{6,23}$/.test(s) && /\d/.test(s)) return { kind: 'access', code: normStartCode(s) };
  return { kind: 'unknown' };
}
