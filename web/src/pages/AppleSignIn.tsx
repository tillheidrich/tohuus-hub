/**
 * Sign in with Apple on the ToHuus Cloud sign-in and sign-up pages (package D, 1.0). No Apple JS SDK: the button
 * is a plain link to `/api/auth/apple/start`, which sets a state cookie and redirects to Apple; Apple posts back to
 * `/api/auth/apple/callback` (routes/cloud-apple.ts). Shown only when `GET /api/instance` → `auth.apple` is true.
 */
import { useInstance } from '../data';
import { t } from '../i18n';
import './account.css';

/** Apple's logo glyph for the button (allowed and required by Apple's Sign in with Apple guidelines). */
function AppleLogo() {
  return (
    <svg viewBox="0 0 17 20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M14.07 10.62c-.02-2.19 1.79-3.25 1.87-3.3-1.02-1.49-2.6-1.69-3.17-1.72-1.35-.14-2.63.79-3.31.79-.69 0-1.74-.77-2.86-.75-1.47.02-2.83.86-3.59 2.17-1.53 2.65-.39 6.58 1.1 8.73.73 1.05 1.6 2.23 2.73 2.19 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.32-3.5zM11.89 4.2c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22z"
      />
    </svg>
  );
}

/** "Mit Apple anmelden" – black on light, white on dark. `next` = where to go afterwards (relative path). */
export function AppleButton({ next, label, code }: { next?: string; label?: string; /** beta gate: access code for a new account */ code?: string }) {
  const inst = useInstance();
  if (inst.data?.mode !== 'cloud' || !inst.data.auth?.apple) return null;
  const q = new URLSearchParams();
  if (next) q.set('next', next);
  if (code?.trim()) q.set('code', code.trim());
  const href = `/api/auth/apple/start${q.size ? `?${q}` : ''}`;
  return (
    <a className="apple-btn" href={href}>
      <AppleLogo />
      <span>{label ?? t('Sign in with Apple')}</span>
    </a>
  );
}

const APPLE_ERRORS: Record<string, string> = {
  failed: 'Sign in with Apple didn’t work. Please try again.',
  expired: 'That took too long or was started in another browser. Please try again.',
  exists: 'There is already an account with this address. Please sign in with your password or an e-mail link first.',
  closed: 'New sign-ups are closed at the moment.',
  busy: 'Too many attempts. Please wait a few minutes.',
  invite: 'ToHuus is in a small test right now. You need an access code – feel free to ask by e-mail.',
  code: 'This access code doesn’t work (anymore). Check it or ask for a new one.',
};

/** The reason after a failed Apple sign-in (`/?apple=…`), shown once; a cancel at Apple says nothing. */
export function appleError(): string {
  return appleErrorKey().text;
}

/** Like appleError(), with the key (`invite`/`code` = beta gate: the sign-up page shows the code field and the mail link). */
export function appleErrorKey(): { key: string; text: string } {
  if (typeof location === 'undefined') return { key: '', text: '' };
  const p = new URLSearchParams(location.search);
  const k = p.get('apple');
  if (!k) return { key: '', text: '' };
  p.delete('apple');
  const q = p.toString();
  history.replaceState(null, '', location.pathname + (q ? `?${q}` : ''));
  return { key: k, text: k === 'cancelled' ? '' : t(APPLE_ERRORS[k] ?? APPLE_ERRORS.failed) };
}
