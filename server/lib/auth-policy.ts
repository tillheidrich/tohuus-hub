/**
 * Sign-in methods (area: auth): household policy, SSO configuration, e-mail delivery and small helpers
 * shared by magic links, passkeys, OIDC, sessions and TOTP.
 */
import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { APP_NAME, canSendMail, mailHousehold, sendMail, type MailContent } from './mail.js';

// ---------------------------------------------------------------- policy

export interface AuthPolicy {
  /** sign-in link by e-mail (needs SMTP and a verified address) */
  magicLink: boolean;
  passkeys: boolean;
  /** 'admins' = SSO/passkeys/links for everyone, passwords only as admin break-glass */
  passwordFor: 'all' | 'admins';
  /** admins signing in with a password need a TOTP code */
  requireTotpAdmins: boolean;
  /** "new sign-in on …" to the member concerned */
  newDeviceAlerts: boolean;
  /** quick profile switch with a PIN on devices an admin marked as shared */
  pinSwitch: boolean;
}

export const DEFAULT_POLICY: AuthPolicy = {
  magicLink: true,
  passkeys: true,
  passwordFor: 'all',
  requireTotpAdmins: false,
  newDeviceAlerts: true,
  pinSwitch: true,
};

/** AUTH_BREAK_GLASS=true relaxes the policy (passwords for everyone, no TOTP requirement) – for lockouts. */
export const breakGlass = () => process.env.AUTH_BREAK_GLASS === 'true';

export function authPolicy(): AuthPolicy {
  const p = { ...DEFAULT_POLICY, ...getSetting<Partial<AuthPolicy>>('auth.policy', {}) };
  if (breakGlass()) return { ...p, passwordFor: 'all', requireTotpAdmins: false };
  return p;
}

export function setAuthPolicy(patch: Partial<AuthPolicy>) {
  setSetting('auth.policy', { ...DEFAULT_POLICY, ...getSetting<Partial<AuthPolicy>>('auth.policy', {}), ...patch });
}

// ---------------------------------------------------------------- SSO (OpenID Connect) configuration

export interface SsoConfig {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  label: string;
  /** create a member on the first SSO sign-in when nobody matches */
  autoCreate: boolean;
  defaultRole: 'member' | 'admin';
  /** accept the provider's e-mail even without email_verified=true (e.g. Authentik with default mappings) */
  trustEmail: boolean;
}

export const DEFAULT_SSO: SsoConfig = {
  enabled: false,
  issuer: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid email profile',
  label: '',
  autoCreate: false,
  defaultRole: 'member',
  trustEmail: false,
};

/** Environment variables seed the UI settings on the first start; afterwards the UI wins. */
export function seedSsoFromEnv(env = process.env) {
  if (getSetting<SsoConfig | null>('auth.sso', null)) return;
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID) return;
  setSetting('auth.sso', {
    ...DEFAULT_SSO,
    enabled: true,
    issuer: env.OIDC_ISSUER.trim(),
    clientId: env.OIDC_CLIENT_ID.trim(),
    clientSecret: env.OIDC_CLIENT_SECRET ?? '',
    scopes: env.OIDC_SCOPES || DEFAULT_SSO.scopes,
    label: env.OIDC_BUTTON_LABEL ?? '',
    autoCreate: env.OIDC_AUTO_CREATE === 'true',
  } satisfies SsoConfig);
}
seedSsoFromEnv();

export function ssoConfig(): SsoConfig {
  return { ...DEFAULT_SSO, ...getSetting<Partial<SsoConfig>>('auth.sso', {}) };
}
export const ssoReady = (c = ssoConfig()) => Boolean(c.enabled && c.issuer && c.clientId);
export const ssoLabel = (c = ssoConfig()) => c.label.trim() || t('Sign in with SSO');

export function setSsoConfig(patch: Partial<SsoConfig>) {
  const cur = ssoConfig();
  const next = { ...cur, ...patch };
  // the UI shows a placeholder for a stored secret – keep the secret unless a new one is typed
  if (patch.clientSecret === SECRET_MASK) next.clientSecret = cur.clientSecret;
  next.issuer = next.issuer.trim().replace(/\/+$/, '');
  setSetting('auth.sso', next);
}
export const SECRET_MASK = '••••••••';

// ---------------------------------------------------------------- e-mail

export type { OutgoingMail } from './mail.js';
/** Tests (and future transports) can hook in here instead of SMTP – the same object as in ./mail.ts. */
export { mailHook } from './mail.js';

export const mailAvailable = () => canSendMail();

/**
 * Fire-and-forget: callers must not await (response time must not reveal whether an address is known).
 * Rendered in the shared mail layout (server/lib/mail.ts).
 */
export function sendAuthMail(
  to: string,
  subject: string,
  title: string,
  message: string,
  button?: { url: string; label: string },
  footer = '',
  extra: Partial<MailContent> = {},
) {
  return sendMail(to, { subject, title, eyebrow: t('Your account'), paragraphs: [message], button: button ?? null, footnote: footer || null, ...extra }).catch((e: Error) =>
    console.warn('[auth mail]', e.message),
  );
}

export const householdName = () => mailHousehold() || APP_NAME;

// ---------------------------------------------------------------- helpers

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const normEmail = (e: string) => e.trim().toLowerCase();

/** "Safari · iPhone" from a user agent – good enough for a device list. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return t('Unknown device');
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'Mac'
            : /Windows/.test(ua)
              ? 'Windows'
              : /Linux/.test(ua)
                ? 'Linux'
                : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox|FxiOS/.test(ua)
      ? 'Firefox'
      : /Chrome|CriOS/.test(ua)
        ? 'Chrome'
        : /Safari/.test(ua)
          ? 'Safari'
          : /curl|node|python|undici/i.test(ua)
            ? t('Script')
            : '';
  return [browser, os].filter(Boolean).join(' · ') || t('Unknown device');
}

export const methodLabel = (m: string | null | undefined) =>
  ({
    password: t('Password'),
    link: t('E-mail link'),
    passkey: t('Passkey'),
    sso: 'SSO',
    pin: 'PIN',
    reset: t('Password reset'),
    invite: t('Invitation'),
  })[m ?? ''] ?? t('Sign-in');

export interface UserAuthRow {
  id: number;
  name: string;
  color: string;
  role: 'admin' | 'member';
  password_hash: string;
  email: string | null;
  email_verified_at: string | null;
  webauthn_handle: string | null;
  sso_sub: string | null;
  totp_secret: string | null;
  totp_recovery_secret: string | null;
  totp_last_step: number | null;
  pin_secret: string | null;
}

export const userById = (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserAuthRow | undefined;
export const userByName = (name: string) => db.prepare('SELECT * FROM users WHERE lower(name) = lower(?)').get(name.trim()) as UserAuthRow | undefined;
export const userByVerifiedEmail = (email: string) =>
  db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND email_verified_at IS NOT NULL ORDER BY id LIMIT 1').get(normEmail(email)) as
    | UserAuthRow
    | undefined;
export const hasPassword = (u: Pick<UserAuthRow, 'password_hash'>) => u.password_hash.startsWith('scrypt$');
export const passkeyCount = (userId: number) => (db.prepare('SELECT COUNT(*) n FROM auth_passkeys WHERE user_id = ?').get(userId) as { n: number }).n;

export const cookieBase = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: config.baseUrl.startsWith('https') });
export const ownOrigin = () => new URL(config.baseUrl).origin;
export const rpId = () => new URL(config.baseUrl).hostname;
