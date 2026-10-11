/**
 * Invitations into the household (wave 6, owns what server/lib/data.ts started).
 *
 * An admin invites someone – name and e-mail are optional, the role is member or admin, or a guest level for
 * a permanent guest (aunt, babysitter). The invitee gets a branded mail with a button, or the admin hands over the
 * link (copy, QR code, share sheet) when the server has no SMTP. The link works once, expires after 7 days,
 * can be withdrawn and re-sent (re-sending makes a new link; the old one stops working).
 *
 * On /einladung/<token> the invitee sees the household and who invited them and picks how to sign in:
 * password, passkey, e-mail link or SSO – then they're in. Works the same for one person, a couple, a family or a
 * shared flat: nothing here assumes a family.
 */
import { config } from '../config.js';
import { brand, db, getSetting, lang, migrate } from '../db.js';
import { t } from '../i18n.js';
import { NAME_MAX, hashPassword, randomToken, sha256 } from './auth.js';
import { EMAIL_RE, authPolicy, mailAvailable, normEmail, ssoLabel, ssoReady } from './auth-policy.js';
import { emit } from './bus.js';
import { mailHousehold, sendMail, APP_NAME } from './mail.js';
import { GUEST_LEVELS, type GuestLevel, isGuestLevel } from './people-policy.js';

// Same name and SQL as before (it used to live in data.ts): installs that have it skip it, new ones get it here.
migrate(
  'data-1',
  `CREATE TABLE invites (
    id INTEGER PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
    color TEXT NOT NULL DEFAULT '#2f5bea',
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    used_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );`,
);
migrate(
  'invites-2',
  `ALTER TABLE invites ADD COLUMN email TEXT;
  ALTER TABLE invites ADD COLUMN message TEXT;
  ALTER TABLE invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'member';
  ALTER TABLE invites ADD COLUMN guest_level TEXT;
  ALTER TABLE invites ADD COLUMN created_by_user_id INTEGER;
  ALTER TABLE invites ADD COLUMN sent_at TEXT;
  ALTER TABLE invites ADD COLUMN send_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE invites ADD COLUMN revoked_at TEXT;`,
);

export const INVITE_DAYS = 7;
export const inviteUrl = (token: string) => `${config.baseUrl}/einladung/${token}`;

export class InviteError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type InviteKind = 'member' | 'guest';
export type InviteStatus = 'pending' | 'used' | 'expired' | 'revoked';

interface Row {
  id: number;
  token_hash: string;
  name: string;
  role: 'admin' | 'member';
  color: string;
  created_by: string | null;
  created_by_user_id: number | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by_user_id: number | null;
  revoked: number;
  revoked_at: string | null;
  email: string | null;
  message: string | null;
  kind: InviteKind;
  guest_level: string | null;
  sent_at: string | null;
  send_count: number;
}

export interface InviteInput {
  name?: string | null;
  email?: string | null;
  role?: 'admin' | 'member';
  kind?: InviteKind;
  guestLevel?: GuestLevel | null;
  message?: string | null;
  color?: string;
  createdBy?: string | null;
  createdByUserId?: number | null;
  /** send the invitation mail right away (needs an address and SMTP) */
  send?: boolean;
}

const COLORS = ['#176B50', '#C2583A', '#2F5BEA', '#8E44AD', '#B97C0C', '#0F8A9D'];
const nameTaken = (name: string) => Boolean(db.prepare('SELECT 1 FROM users WHERE lower(name) = lower(?)').get(name));
const emailTaken = (email: string) => Boolean(db.prepare('SELECT 1 FROM users WHERE lower(email) = ? AND email_verified_at IS NOT NULL').get(email));
const rowById = (id: number) => db.prepare('SELECT * FROM invites WHERE id = ?').get(id) as Row | undefined;

function statusOf(r: Row): InviteStatus {
  if (r.used_at) return 'used';
  if (r.revoked) return 'revoked';
  if (r.expires_at <= new Date().toISOString().replace('T', ' ').slice(0, 19)) return 'expired';
  return 'pending';
}

function cleanInput(b: InviteInput) {
  const name = (b.name ?? '').trim().slice(0, NAME_MAX);
  const email = b.email?.trim() ? normEmail(b.email) : null;
  if (email && !EMAIL_RE.test(email)) throw new InviteError(400, t('That doesn’t look like an e-mail address.'));
  if (name && nameTaken(name)) throw new InviteError(409, t('Someone with this name already exists.'));
  if (email && emailTaken(email)) throw new InviteError(409, t('Another member already uses this address.'));
  const kind: InviteKind = b.kind === 'guest' ? 'guest' : 'member';
  const guestLevel = kind === 'guest' ? (isGuestLevel(b.guestLevel) ? b.guestLevel : 'order') : null;
  const role = kind === 'guest' ? 'member' : b.role === 'admin' ? 'admin' : 'member';
  const color = b.color && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : COLORS[Math.floor(Math.random() * COLORS.length)];
  const message = b.message?.trim().slice(0, 500) || null;
  return { name, email, kind, guestLevel, role, color, message };
}

/** Create an invitation. Returns the one-time link (the token is only stored hashed). */
export function createInvite(b: InviteInput) {
  const c = cleanInput(b);
  const token = randomToken(24);
  const info = db
    .prepare(
      `INSERT INTO invites (token_hash, name, role, color, created_by, created_by_user_id, email, message, kind, guest_level, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
    )
    .run(sha256(token), c.name, c.role, c.color, b.createdBy ?? null, b.createdByUserId ?? null, c.email, c.message, c.kind, c.guestLevel, `+${INVITE_DAYS} days`);
  const id = Number(info.lastInsertRowid);
  const sent = Boolean(b.send && c.email && mailAvailable());
  if (sent) void deliver(id, token);
  emit('settings');
  const row = rowById(id)!;
  return { id, token, url: inviteUrl(token), expires_at: row.expires_at, email: c.email, sent, mail: mailAvailable() };
}

/** What the invitee is offered on the landing page. */
export function signInMethods(kind: InviteKind, role: 'admin' | 'member') {
  const p = authPolicy();
  return {
    // "passwords only for admins" keeps members (and guests) on passkeys, links or SSO
    password: p.passwordFor === 'all' || (kind === 'member' && role === 'admin'),
    passkey: p.passkeys,
    email: p.magicLink && mailAvailable(),
    sso: ssoReady() ? { label: ssoLabel() } : null,
  };
}

const levelLabel = (l: string | null) =>
  ({ order: t('Can order and add to the shopping list'), stock: t('Can order and sees stock and where things are'), recipes: t('Can order and sees stock, recipes and the week plan'), family: t('Like family, without settings') })[l ?? 'order'] ??
  t('Can order and add to the shopping list');

const roleLabel = (r: Pick<Row, 'kind' | 'role' | 'guest_level'>) => (r.kind === 'guest' ? t('Guest') : r.role === 'admin' ? t('Admin') : t('Member'));

const fmtDay = (sql: string) =>
  new Date(sql.replace(' ', 'T') + 'Z').toLocaleDateString(lang() === 'en' ? 'en-GB' : lang() === 'sv' ? 'sv-SE' : 'de-DE', { day: 'numeric', month: 'long', timeZone: config.timezone });

/** The invitation mail in the shared layout. */
function inviteMail(r: Row, token: string) {
  const household = mailHousehold() || t('our household');
  const by = r.created_by || household;
  const hello = r.name ? t('Hi {name},', { name: r.name }) : t('Hello,');
  return {
    subject: t('{by} invites you to {household}', { by, household }),
    eyebrow: t('Invitation'),
    title: t('Join {household}', { household }),
    preheader: t('{by} invites you to the household app of {household}. The link works once and for {days} days.', { by, household, days: INVITE_DAYS }),
    paragraphs: [
      hello,
      r.kind === 'guest'
        ? t('{by} invites you as a guest to {household} – our household app for the shopping list, orders from the sofa and more.', { by, household })
        : t('{by} invites you to {household} – our household app for the shopping list, stock, recipes and everyday things.', { by, household }),
      t('Tap the button, pick how you want to sign in (passkey, password or e-mail link) – then you’re in.'),
    ],
    quote: r.message ? { text: r.message, by: r.created_by } : null,
    rows: [
      { label: t('Access'), value: r.kind === 'guest' ? `${t('Guest')} · ${levelLabel(r.guest_level)}` : roleLabel(r) },
      { label: t('Valid until'), value: fmtDay(r.expires_at) },
    ],
    button: { url: inviteUrl(token), label: t('Accept invitation') },
    footnote: t('The link works once. If you weren’t expecting this, just ignore this e-mail – nothing happens without the link.'),
    reason: t('{by} typed your address when inviting you. We don’t send anything else unless you join.', { by }),
  };
}

async function deliver(id: number, token: string) {
  const r = rowById(id);
  if (!r?.email) return false;
  try {
    await sendMail(r.email, inviteMail(r, token));
    db.prepare(`UPDATE invites SET sent_at = datetime('now'), send_count = send_count + 1 WHERE id = ?`).run(id);
    emit('settings');
    return true;
  } catch (e) {
    console.warn('[invite mail]', (e as Error).message);
    return false;
  }
}

/** Preview content of an invitation mail (for tests and the mail preview script). */
export const inviteMailFor = (id: number, token: string) => inviteMail(rowById(id)!, token);

/**
 * Send again / make a new link: a fresh token (the old link stops working) and another 7 days.
 * `deliver: 'email'` also mails it (optionally to a corrected address).
 */
export function renewInvite(id: number, opts: { deliver: 'email' | 'link'; email?: string | null }) {
  const r = rowById(id);
  if (!r || r.used_at || r.revoked) throw new InviteError(404, t('This invitation is no longer open.'));
  let email = r.email;
  if (opts.email !== undefined && opts.email !== null && opts.email.trim()) {
    email = normEmail(opts.email);
    if (!EMAIL_RE.test(email)) throw new InviteError(400, t('That doesn’t look like an e-mail address.'));
    if (emailTaken(email)) throw new InviteError(409, t('Another member already uses this address.'));
  }
  if (opts.deliver === 'email') {
    if (!email) throw new InviteError(400, t('Please enter an e-mail address.'));
    if (!mailAvailable()) throw new InviteError(400, t('E-mail is not set up on this server (SMTP).'));
  }
  const token = randomToken(24);
  // sent_at belongs to the mailed link: a new link handed over by hand has not been mailed (deliver() sets it again)
  db.prepare(`UPDATE invites SET token_hash = ?, email = ?, expires_at = datetime('now', ?), sent_at = NULL WHERE id = ?`).run(sha256(token), email, `+${INVITE_DAYS} days`, id);
  if (opts.deliver === 'email') void deliver(id, token);
  emit('settings');
  return { id, url: inviteUrl(token), expires_at: rowById(id)!.expires_at, sent: opts.deliver === 'email', email };
}

export function revokeInvite(id: number) {
  const ok = db.prepare(`UPDATE invites SET revoked = 1, revoked_at = datetime('now') WHERE id = ? AND used_at IS NULL`).run(id).changes > 0;
  emit('settings');
  return ok;
}

/** Open, used and recently closed invitations for Settings › Members (newest first). */
export function listInvites() {
  const rows = db
    .prepare(
      `SELECT i.*, u.name AS used_by_name FROM invites i LEFT JOIN users u ON u.id = i.used_by_user_id
       WHERE i.used_at IS NULL AND i.revoked = 0 OR i.created_at > datetime('now', '-30 days')
       ORDER BY i.id DESC LIMIT 50`,
    )
    .all() as (Row & { used_by_name: string | null })[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    kind: r.kind,
    guest_level: r.guest_level,
    color: r.color,
    message: r.message,
    created_by: r.created_by,
    created_at: r.created_at,
    expires_at: r.expires_at,
    sent_at: r.sent_at,
    send_count: r.send_count,
    used_at: r.used_at,
    used_by_name: r.used_by_name,
    status: statusOf(r),
  }));
}

/** Only the open ones (older callers: onboarding checklist, tests). */
export const pendingInvites = () => listInvites().filter((i) => i.status === 'pending');

export interface InviteRow {
  id: number;
  name: string;
  role: 'admin' | 'member';
  color: string;
  expires_at: string;
  kind: InviteKind;
  guest_level: string | null;
  email: string | null;
  message: string | null;
  created_by: string | null;
  sent_at?: string | null;
}

export function findInvite(token: string): InviteRow | undefined {
  if (!token || token.length > 100) return undefined;
  return db
    .prepare(
      `SELECT id, name, role, color, expires_at, kind, guest_level, email, message, created_by, sent_at FROM invites
       WHERE token_hash = ? AND revoked = 0 AND used_at IS NULL AND expires_at > datetime('now')`,
    )
    .get(sha256(token)) as InviteRow | undefined;
}

/** Everything the landing page shows: household, who invited, the note, what you get, how you can sign in. */
export function invitePublicView(inv: InviteRow) {
  return {
    name: inv.name,
    role: inv.role,
    kind: inv.kind,
    guest_level: inv.guest_level,
    access: inv.kind === 'guest' ? levelLabel(inv.guest_level) : null,
    color: inv.color,
    expires_at: inv.expires_at,
    invited_by: inv.created_by,
    message: inv.message,
    email: inv.email,
    methods: signInMethods(inv.kind, inv.role),
    ...inviteContext(),
  };
}

export function inviteContext() {
  return { household: getSetting<string>('household.name', '') || mailHousehold() || '', brand: brand(), language: lang(), app: APP_NAME };
}

export type AcceptMethod = 'password' | 'passkey' | 'email' | 'sso';
export interface AcceptInput {
  name?: string;
  method?: AcceptMethod;
  password?: string;
  email?: string;
}

/**
 * Redeem an invitation: creates the member (or permanent guest) and marks the link used. One-time; atomic.
 * Password: set here. Passkey / SSO: the account starts without a password and the browser adds the passkey or
 * links SSO right after (signed in). E-mail: the address is stored – confirmed at once when the invitation went to
 * that very address (opening the link proves the mailbox), otherwise the caller sends a confirmation mail.
 */
export function acceptInvite(token: string, b: AcceptInput, msgs: { invalid: string; taken: string }): { userId: number; name: string; verifyEmail: string | null; method: AcceptMethod } {
  const method: AcceptMethod = b.method ?? 'password';
  return db.transaction(() => {
    const inv = findInvite(token);
    if (!inv) throw new InviteError(404, msgs.invalid);
    const name = (b.name?.trim() || inv.name).slice(0, NAME_MAX);
    if (!name) throw new InviteError(400, t('Please enter your name.'));
    if (nameTaken(name)) throw new InviteError(409, msgs.taken);
    const allowed = signInMethods(inv.kind, inv.role);
    if (method === 'password') {
      if (!b.password || b.password.length < 8) throw new InviteError(400, t('At least 8 characters, please.'));
      // also without an explicit method: an omitted method must not get around "passwords only for admins"
      if (!allowed.password) throw new InviteError(400, t('This household signs in without passwords – pick a passkey or an e-mail link.'));
    }
    if (method === 'sso' && !allowed.sso) throw new InviteError(400, t('Single sign-on is not set up here.'));
    if (method === 'passkey' && !allowed.passkey) throw new InviteError(400, t('Passkeys are switched off in this household.'));
    if (method === 'email' && !allowed.email) throw new InviteError(400, t('Sign-in links by e-mail aren’t available here.'));
    let email: string | null = null;
    let verified = false;
    const typed = b.email?.trim() ? normEmail(b.email) : null;
    if (method === 'email') {
      if (!typed || !EMAIL_RE.test(typed)) throw new InviteError(400, t('That doesn’t look like an e-mail address.'));
      email = typed;
    } else if (inv.email) email = inv.email;
    if (email) {
      if (emailTaken(email)) {
        if (method === 'email') throw new InviteError(409, t('Another member already uses this address.'));
        email = null;
      // confirmed only when this very link went to that address by mail (a link handed over by hand proves nothing
      // about the mailbox – the admin may have mistyped it); otherwise the caller sends a confirmation mail
      } else verified = Boolean(inv.email && email === inv.email && inv.sent_at);
    }
    const hash = method === 'password' ? hashPassword(b.password!) : `none$${randomToken(12)}`;
    const guest = inv.kind === 'guest';
    const info = db
      .prepare(
        `INSERT INTO users (name, password_hash, role, color, kind, guest_level, email, email_verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ${verified ? "datetime('now')" : 'NULL'})`,
      )
      .run(name, hash, guest ? 'member' : inv.role, inv.color, guest ? 'guest' : 'member', guest ? (inv.guest_level ?? 'order') : 'order', email);
    const userId = Number(info.lastInsertRowid);
    if (db.prepare(`UPDATE invites SET used_at = datetime('now'), used_by_user_id = ? WHERE id = ? AND used_at IS NULL`).run(userId, inv.id).changes !== 1)
      throw new InviteError(404, msgs.invalid);
    return { userId, name, verifyEmail: email && !verified ? email : null, method };
  })();
}

export { GUEST_LEVELS };
