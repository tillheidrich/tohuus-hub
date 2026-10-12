/**
 * Notifications per person (market research 12 Oct 2026, block D – "like Equilo"): every member decides for
 * themselves which events reach them on which of their own channels – iPhone push (APNs), browser push (Web Push)
 * and an e-mail summary – plus quiet hours, "only when I'm at home" (presence comes from the app or Home Assistant
 * later) and how much a lock screen may show. Calm defaults: only what is addressed to you is on.
 *
 * Household channels for self-hosters (Home Assistant webhook, ntfy, Telegram, Gotify, Matrix, webhook, the
 * household e-mail address) keep their admin matrix in notify.ts; this module only decides the personal channels.
 *
 * Who gets a personal notification: the member it is addressed to (`toUserId`), else every member (never permanent
 * guests) except `exceptUserIds` – and only if their own row says so.
 */
import { config } from '../config.js';
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { APP_NAME, canSendMail, mailHousehold, sendMail } from './mail.js';
import { getUserPref, setUserPref } from './onboard.js';
import { currentHousehold } from './tenancy.js';
import './people-policy.js';

migrate(
  'notify-person-1',
  `CREATE TABLE IF NOT EXISTS notify_digest (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     event TEXT NOT NULL,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     path TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     sent_at TEXT
   );
   CREATE INDEX IF NOT EXISTS notify_digest_open ON notify_digest(user_id, sent_at);`,
);

/** The events a person can switch – English labels, translated on display. `module` hides it when switched off (modules.ts). */
export const PERSON_EVENTS = [
  { key: 'trip.addon', label: 'Something added to my shopping trip', module: null, on: true },
  { key: 'trip.started', label: 'Someone is shopping right now', module: null, on: false },
  { key: 'rhythm.due', label: 'Something is due again', module: null, on: false },
  { key: 'stock.expiring', label: '“Still at home” runs out soon', module: 'stock', on: false },
  { key: 'import.review', label: 'A receipt was recognised', module: 'money', on: false },
  { key: 'plan.reminder', label: 'Reminder for the week plan', module: 'cook', on: false },
  { key: 'order.new', label: 'A wish (Treats)', module: 'treats', on: true },
  { key: 'guest.order', label: 'An order from guests', module: 'guests', on: false },
  { key: 'budget.warning', label: 'Budget hint', module: 'money', on: false },
] as const;
export type PersonEvent = (typeof PERSON_EVENTS)[number]['key'];
export const PERSON_CHANNELS = ['apns', 'push', 'digest'] as const;
export type PersonChannel = (typeof PERSON_CHANNELS)[number];

export interface PersonPrefs {
  events: Record<string, Partial<Record<PersonChannel, boolean>>>;
  /** "22:00"–"07:00" local time; null = no quiet hours */
  quiet: { from: string; to: string } | null;
  /** events that only come while the person is at home (presence from the app / Home Assistant) */
  homeOnly: string[];
  /** lock screen: the real text, or only "Neues in ToHuus" */
  preview: 'full' | 'generic';
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function defaultPrefs(): PersonPrefs {
  const events: PersonPrefs['events'] = {};
  for (const e of PERSON_EVENTS) events[e.key] = { apns: e.on, push: e.on, digest: false };
  return { events, quiet: { from: '22:00', to: '07:00' }, homeOnly: [], preview: 'full' };
}

export function personPrefs(userId: number): PersonPrefs {
  const d = defaultPrefs();
  const raw = getUserPref<Partial<PersonPrefs>>(userId, 'notify', {});
  const events = { ...d.events };
  for (const [k, v] of Object.entries(raw.events ?? {})) if (k in events && v && typeof v === 'object') events[k] = { ...events[k], ...v };
  const quiet = raw.quiet === null ? null : raw.quiet && HHMM.test(raw.quiet.from) && HHMM.test(raw.quiet.to) ? raw.quiet : d.quiet;
  return {
    events,
    quiet,
    homeOnly: Array.isArray(raw.homeOnly) ? raw.homeOnly.filter((k) => PERSON_EVENTS.some((e) => e.key === k)) : [],
    preview: raw.preview === 'generic' ? 'generic' : 'full',
  };
}

export function setPersonPrefs(userId: number, p: Partial<PersonPrefs>): PersonPrefs {
  const cur = personPrefs(userId);
  const events = { ...cur.events };
  for (const [k, v] of Object.entries(p.events ?? {})) {
    if (!(k in events) || !v) continue;
    const clean: Partial<Record<PersonChannel, boolean>> = {};
    for (const c of PERSON_CHANNELS) if (typeof v[c] === 'boolean') clean[c] = v[c];
    events[k] = { ...events[k], ...clean };
  }
  const next: PersonPrefs = {
    events,
    quiet: p.quiet === undefined ? cur.quiet : p.quiet === null ? null : HHMM.test(p.quiet.from) && HHMM.test(p.quiet.to) ? p.quiet : cur.quiet,
    homeOnly: p.homeOnly ? p.homeOnly.filter((k) => PERSON_EVENTS.some((e) => e.key === k)) : cur.homeOnly,
    preview: p.preview === 'generic' || p.preview === 'full' ? p.preview : cur.preview,
  };
  setUserPref(userId, 'notify', next);
  return next;
}

// ------------------------------------------------------------------ presence ("nur wenn ich zu Hause bin")

/** The app or Home Assistant tells where the person is. Older than 12 hours = unknown. */
export function setPresence(userId: number, home: boolean, source = 'app') {
  setUserPref(userId, 'presence', { home, source, at: new Date().toISOString() });
  return { home, source };
}

export function presence(userId: number): boolean | null {
  const p = getUserPref<{ home?: boolean; at?: string } | null>(userId, 'presence', null);
  if (!p || typeof p.home !== 'boolean' || !p.at || Date.now() - Date.parse(p.at) > 12 * 3600_000) return null;
  return p.home;
}

// ------------------------------------------------------------------ routing

/** Which person event a household notification is (null = not a personal one). */
export function personEventOf(event: string, data: Record<string, unknown> = {}): PersonEvent | null {
  if (event === 'order.new') return data.kind === 'guest' || data.kind === 'party' ? 'guest.order' : 'order.new';
  return (PERSON_EVENTS.find((e) => e.key === event)?.key as PersonEvent | undefined) ?? null;
}

function localMinutes(nowMs: number) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: config.timezone }).format(new Date(nowMs)).split(':').map(Number);
  return (h % 24) * 60 + m;
}
const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

export function inQuietHours(q: PersonPrefs['quiet'], nowMs = Date.now()) {
  if (!q) return false;
  const n = localMinutes(nowMs);
  const a = mins(q.from);
  const b = mins(q.to);
  return a === b ? false : a < b ? n >= a && n < b : n >= a || n < b;
}

export interface Audience {
  toUserId?: number | null;
  exceptUserIds?: number[];
  urgent?: boolean;
  nowMs?: number;
}

/** Members (not guests) who want this event on this channel right now. Digest ignores quiet hours (it waits anyway). */
export function recipients(ev: PersonEvent, channel: PersonChannel, a: Audience = {}): number[] {
  if (a.toUserId === null) return [];
  const ids = a.toUserId
    ? [a.toUserId]
    : (db.prepare(`SELECT id FROM users WHERE COALESCE(kind, 'member') != 'guest'`).all() as { id: number }[]).map((r) => r.id);
  const except = new Set(a.exceptUserIds ?? []);
  return ids.filter((id) => {
    if (except.has(id)) return false;
    const p = personPrefs(id);
    if (!p.events[ev]?.[channel]) return false;
    if (channel !== 'digest' && !a.urgent && inQuietHours(p.quiet, a.nowMs)) return false;
    if (p.homeOnly.includes(ev) && presence(id) === false) return false;
    return true;
  });
}

/** What a lock screen may show for this person. */
export function textFor(userId: number, title: string, body: string) {
  return personPrefs(userId).preview === 'generic' ? { title: APP_NAME.replace(' Hub', ''), body: t('Something new in ToHuus') } : { title, body };
}

// ------------------------------------------------------------------ e-mail summary

export function queueDigest(userIds: number[], item: { event: string; title: string; body: string; path?: string }) {
  const ins = db.prepare('INSERT INTO notify_digest (user_id, event, title, body, path) VALUES (?, ?, ?, ?, ?)');
  for (const id of userIds) ins.run(id, item.event, item.title.slice(0, 200), item.body.slice(0, 600), item.path ?? null);
}

/** A member's confirmed e-mail address: their own (self-host) or their account's (cloud). */
export async function memberEmail(userId: number): Promise<string | null> {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as { email: string | null; email_verified_at?: string | null } | undefined;
  if (u?.email && u.email_verified_at) return u.email;
  if (!config.multiTenant) return null;
  const h = currentHousehold();
  if (!h) return null;
  // accounts.ts only in the cloud and only here (keeps notify.ts → notify-prefs.ts free of the directory)
  const { accountsDb } = await import('./accounts.js');
  const a = accountsDb()
    .prepare('SELECT a.email, a.verified_at AS email_verified_at FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.household_id = ? AND m.user_id = ?')
    .get(h.id, userId) as { email: string; email_verified_at: string | null } | undefined;
  return a?.email && a.email_verified_at ? a.email : null;
}

/** Once a day (scheduler, at the household's digest hour): one mail per person with what piled up. */
export async function sendPersonalDigests(opts: { force?: boolean } = {}) {
  const rows = db.prepare('SELECT * FROM notify_digest WHERE sent_at IS NULL ORDER BY id').all() as { id: number; user_id: number; title: string; body: string }[];
  if (!rows.length) return 0;
  const by = new Map<number, typeof rows>();
  for (const r of rows) by.set(r.user_id, [...(by.get(r.user_id) ?? []), r]);
  let sent = 0;
  for (const [uid, items] of by) {
    const to = await memberEmail(uid);
    const done = db.prepare(`UPDATE notify_digest SET sent_at = datetime('now') WHERE id = ?`);
    if (!to || !canSendMail()) {
      // nowhere to send it: drop after three days instead of piling up
      db.prepare(`UPDATE notify_digest SET sent_at = datetime('now') WHERE user_id = ? AND sent_at IS NULL AND created_at < datetime('now', '-3 days')`).run(uid);
      continue;
    }
    await sendMail(to, {
      subject: `${mailHousehold() || APP_NAME} · ${t('Your summary')}`,
      eyebrow: t('Summary'),
      title: t('What happened at home'),
      sections: [{ title: t('{n} things', { n: items.length }), items: items.map((i) => `${i.title} – ${i.body}`) }],
      button: { url: config.baseUrl, label: t('Open in ToHuus Hub') },
      reason: t('You get this because you chose the e-mail summary under Settings › Notifications.'),
    })
      .then(() => {
        for (const i of items) done.run(i.id);
        sent++;
      })
      .catch((e: Error) => console.warn('[digest]', e.message));
    void opts;
  }
  db.prepare(`DELETE FROM notify_digest WHERE sent_at IS NOT NULL AND sent_at < datetime('now', '-14 days')`).run();
  return sent;
}
