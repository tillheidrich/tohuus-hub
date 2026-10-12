import { config } from '../config.js';
import { APP_NAME, canSendMail, mailHousehold, sendMail, smtpTransport, type MailContent } from './mail.js';
import { db, getSetting } from '../db.js';
import { emit } from './bus.js';
import { t } from '../i18n.js';
import { actionsFor, pushDeviceCount, sendPush } from './webpush.js';
import { quietWhileAway } from './away-state.js';
import { sendApns } from './apns.js';
import { personEventOf, queueDigest, recipients, textFor } from './notify-prefs.js';
import { eventHidden } from './modules.js';

export type NotifyEvent =
  | 'stock.low'
  | 'stock.empty'
  | 'stock.expiring'
  | 'import.review'
  | 'order.new'
  | 'order.status'
  | 'shopping.added'
  | 'digest.daily'
  | 'care.due'
  | 'party.ending'
  | 'kids.wish'
  | 'auth.new_device'
  | 'budget.warning'
  | 'plan.vote'
  | 'plan.rotation'
  // list2 (12 Oct 2026): personal events, routed per person (notify-prefs.ts)
  | 'trip.started'
  | 'trip.addon'
  | 'rhythm.due'
  | 'plan.reminder'
  | 'test';

export interface NotifySettings {
  haWebhookUrl: string;
  webhookUrl: string;
  ntfyUrl: string;
  emailTo: string;
  digestHour: number; // -1 = off
  expiryWarnDays: number;
  autoShoppingList: boolean;
  events: Record<string, { ha: boolean; webhook: boolean; ntfy: boolean; email: boolean; push?: boolean; telegram?: boolean; gotify?: boolean; matrix?: boolean }>;
}

/** Channels that live in their own module (server/lib/channels.ts) and register themselves here. */
export const EXTRA_CHANNELS = ['telegram', 'gotify', 'matrix'] as const;
export type ExtraChannelName = (typeof EXTRA_CHANNELS)[number];
export interface ChannelMessage extends NotifyInput {
  /** absolute URL */
  url: string;
}
interface ExtraChannel {
  name: ExtraChannelName;
  /** configured and switched on */
  ready: () => boolean;
  send: (msg: ChannelMessage) => Promise<boolean>;
}
const extraChannels = new Map<ExtraChannelName, ExtraChannel>();
export function registerNotifyChannel(c: ExtraChannel) {
  extraChannels.set(c.name, c);
}

/** Per-member delivery override (ha2: push through Home Assistant's companion app instead of Web Push). */
type PersonalRouter = (msg: ChannelMessage) => { skipPushUsers: number[]; job: Promise<boolean> | null } | null;
let personalRouter: PersonalRouter | null = null;
export function setPersonalRouter(fn: PersonalRouter | null) {
  personalRouter = fn;
}

/** Small label at the top of the mail's ticket card, per event (English source text, translated at send time). */
const EVENT_EYEBROW: Partial<Record<NotifyEvent, string>> = {
  'stock.low': 'Stock',
  'stock.empty': 'Stock',
  'stock.expiring': 'Use soon',
  'import.review': 'Receipts',
  'order.new': 'Treats',
  'order.status': 'Treats',
  'shopping.added': 'Shopping list',
  'digest.daily': 'Daily overview',
  'care.due': 'Care',
  'party.ending': 'Party',
  'kids.wish': 'Wish',
  'auth.new_device': 'Security',
  'budget.warning': 'Budget',
  'plan.vote': 'Meal plan',
  'plan.rotation': 'Meal plan',
  'trip.started': 'Shopping',
  'trip.addon': 'Shopping',
  'rhythm.due': 'Shopping list',
  'plan.reminder': 'Meal plan',
  test: 'Test',
};

export const DEFAULT_NOTIFY: NotifySettings = {
  haWebhookUrl: '',
  webhookUrl: '',
  ntfyUrl: '',
  emailTo: '',
  digestHour: 17,
  expiryWarnDays: 3,
  // off by default since Oct 2026: derived items are suggestions, never silently on the list (shopping-trust.ts keeps it
  // on for households that already maintained their stock before)
  autoShoppingList: false,
  events: {
    'stock.low': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    'stock.empty': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    'stock.expiring': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    'import.review': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    'order.new': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    // goes only to the person who asked ("Mira is bringing it") – guests have no account and get nothing
    'order.status': { ha: false, webhook: true, ntfy: false, email: false, push: true, telegram: false, gotify: false, matrix: false },
    'shopping.added': { ha: false, webhook: true, ntfy: false, email: false, push: false },
    'digest.daily': { ha: true, webhook: true, ntfy: false, email: true, push: false },
    'care.due': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    'party.ending': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    'kids.wish': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    // goes only to the member concerned (their own devices / verified address) – see server/lib/auth-sessions.ts
    'auth.new_device': { ha: false, webhook: false, ntfy: false, email: true, push: true },
    'budget.warning': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    // family food votes (started / result) and the quiet weekly rotation fill (plan2)
    'plan.vote': { ha: false, webhook: true, ntfy: true, email: false, push: true },
    'plan.rotation': { ha: false, webhook: true, ntfy: false, email: false, push: false },
    // personal events: phones and browsers follow each person's own choice (notify-prefs.ts); here only the
    // household channels for self-hosters
    'trip.started': { ha: true, webhook: true, ntfy: false, email: false, push: false, telegram: false, gotify: false, matrix: false },
    'trip.addon': { ha: false, webhook: true, ntfy: false, email: false, push: false, telegram: false, gotify: false, matrix: false },
    'rhythm.due': { ha: true, webhook: true, ntfy: false, email: false, push: false, telegram: false, gotify: false, matrix: false },
    'plan.reminder': { ha: false, webhook: true, ntfy: false, email: false, push: false, telegram: false, gotify: false, matrix: false },
    test: { ha: true, webhook: true, ntfy: true, email: true, push: true },
  },
};

export function notifySettings(): NotifySettings {
  const s = getSetting<Partial<NotifySettings>>('notify', {});
  const events = { ...DEFAULT_NOTIFY.events, ...(s.events ?? {}) };
  // routes saved before Web Push existed get the default for the push column
  for (const [k, v] of Object.entries(events)) if (v.push === undefined) events[k] = { ...v, push: DEFAULT_NOTIFY.events[k]?.push ?? false };
  // Telegram, Gotify, Matrix start with the same events as push
  for (const [k, v] of Object.entries(events))
    for (const ch of EXTRA_CHANNELS) if (v[ch] === undefined) events[k] = { ...events[k], [ch]: events[k].push ?? false };
  return { ...DEFAULT_NOTIFY, ...s, events };
}

/** The shared SMTP transport (server/lib/mail.ts) – kept under its old name for callers that only check "is mail set up". */
export const mailer = () => smtpTransport();

export interface NotifyInput {
  event: NotifyEvent;
  title: string;
  message: string;
  /** relative app path, e.g. /bestand/12 */
  path?: string;
  data?: Record<string, unknown>;
  /** suppress repeats with the same key for this many hours */
  dedupeKey?: string;
  dedupeHours?: number;
  /** richer e-mail content (sections, rows …) on top of title + message; rendered in the shared mail layout */
  mail?: Partial<MailContent>;
  /** goes out even while the household is away (away mode keeps everything else quiet) */
  urgent?: boolean;
  /** Web Push only to this member's devices; `null` = to nobody (e.g. a guest without an account). Other channels are household-wide. */
  toUserId?: number | null;
  /** personal channels: everyone but these members (e.g. the person who is shopping) */
  exceptUserIds?: number[];
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function notify(input: NotifyInput): Promise<{ channels: string[]; skipped?: boolean; quiet?: boolean }> {
  // away mode: only urgent things while nobody is around to act on "milk is low"
  if (quietWhileAway(input.event, input.urgent)) return { channels: [], skipped: true, quiet: true };
  // "Was nutzen wir?" (modules.ts): a switched-off area tells nobody anything
  if (eventHidden(input.event, input.data)) return { channels: [], skipped: true };
  if (input.dedupeKey) {
    const hours = input.dedupeHours ?? 20;
    const recent = db
      .prepare(`SELECT 1 FROM notifications WHERE dedupe_key = ? AND created_at > datetime('now', ?) LIMIT 1`)
      .get(input.dedupeKey, `-${hours} hours`);
    if (recent) return { channels: [], skipped: true };
  }
  const s = notifySettings();
  const route = s.events[input.event] ?? { ha: true, webhook: true, ntfy: false, email: false };
  const url = input.path ? `${config.baseUrl}${input.path}` : config.baseUrl;
  const payload = {
    source: 'tohuus',
    event: input.event,
    title: input.title,
    message: input.message,
    url,
    data: input.data ?? {},
    at: new Date().toISOString(),
  };
  const jobs: Promise<[string, boolean]>[] = [];
  if (route.ha && s.haWebhookUrl) jobs.push(post(s.haWebhookUrl, payload).then((ok) => ['ha', ok]));
  if (route.webhook && s.webhookUrl) jobs.push(post(s.webhookUrl, payload).then((ok) => ['webhook', ok]));
  // personal events (list2, notify-prefs.ts): each member's own choice per event and channel, quiet hours,
  // "only at home", lock-screen preview – the household push column does not apply to them
  const pe = personEventOf(input.event, input.data);
  if (pe) {
    const aud = { toUserId: input.toUserId, exceptUserIds: input.exceptUserIds, urgent: input.urgent };
    const pushTo = recipients(pe, 'push', aud);
    const personal = pushTo.length && personalRouter ? personalRouter({ ...input, url }) : null;
    if (personal?.job) jobs.push(personal.job.then((ok): [string, boolean] => ['ha_app', ok]).catch((): [string, boolean] => ['ha_app', false]));
    const skip = new Set(personal?.skipPushUsers ?? []);
    for (const [ids, text] of byPreview(pushTo.filter((id) => !skip.has(id)), input))
      if (pushDeviceCount() > 0)
        jobs.push(
          sendPush({ title: text.title, body: text.body, url, event: input.event, tag: input.dedupeKey, actions: actionsFor(input.event, input.data), data: input.data }, { userIds: ids })
            .then((ok): [string, boolean] => ['push', ok])
            .catch((): [string, boolean] => ['push', false]),
        );
    for (const [ids, text] of byPreview(recipients(pe, 'apns', aud), input))
      jobs.push(
        sendApns(ids, { title: text.title, body: text.body, path: input.path, event: input.event, collapseId: input.dedupeKey, urgent: input.urgent })
          .then((n): [string, boolean] => ['apns', n > 0])
          .catch((): [string, boolean] => ['apns', false]),
      );
    const digestTo = recipients(pe, 'digest', aud);
    if (digestTo.length) queueDigest(digestTo, { event: input.event, title: input.title, body: input.message, path: input.path });
  } else {
    // Web Push (PWA): an event saved before the channel existed falls back to the default routing
    // ha2: members who chose "via Home Assistant" get the push through their HA companion app instead
    const pushOn = route.push ?? DEFAULT_NOTIFY.events[input.event]?.push;
    const personal = pushOn && personalRouter ? personalRouter({ ...input, url }) : null;
    if (personal?.job) jobs.push(personal.job.then((ok): [string, boolean] => ['ha_app', ok]).catch((): [string, boolean] => ['ha_app', false]));
    if (pushOn && pushDeviceCount() > 0 && input.toUserId !== null)
      jobs.push(
        sendPush({ title: input.title, body: input.message, url, event: input.event, tag: input.dedupeKey, actions: actionsFor(input.event, input.data), data: input.data }, { userId: input.toUserId, excludeUserIds: personal?.skipPushUsers })
          .then((ok): [string, boolean] => ['push', ok])
          .catch((): [string, boolean] => ['push', false]),
      );
    // the iPhone app gets what the browser gets (same audience)
    if (pushOn && input.toUserId !== null) {
      const skip = new Set([...(personal?.skipPushUsers ?? []), ...(input.exceptUserIds ?? [])]);
      const ids = input.toUserId
        ? [input.toUserId]
        : (db.prepare(`SELECT id FROM users WHERE COALESCE(kind, 'member') != 'guest'`).all() as { id: number }[]).map((r) => r.id).filter((id) => !skip.has(id));
      for (const [group, text] of byPreview(ids, input))
        jobs.push(
          sendApns(group, { title: text.title, body: text.body, path: input.path, event: input.event, collapseId: input.dedupeKey, urgent: input.urgent })
            .then((n): [string, boolean] => ['apns', n > 0])
            .catch((): [string, boolean] => ['apns', false]),
        );
    }
  }
  if (route.ntfy && s.ntfyUrl)
    jobs.push(
      post(s.ntfyUrl, input.message, { Title: encodeHeader(input.title), Click: url, Tags: 'house' }).then((ok) => ['ntfy', ok]),
    );
  for (const c of extraChannels.values())
    if (route[c.name] && c.ready())
      jobs.push(
        c
          .send({ ...input, url })
          .then((ok): [string, boolean] => [c.name, ok])
          .catch((e: Error): [string, boolean] => {
            console.warn(`[${c.name}]`, e.message);
            return [c.name, false];
          }),
      );
  if (route.email && canSendMail() && s.emailTo) {
    jobs.push(
      sendMail(s.emailTo, {
        subject: `${mailHousehold() || APP_NAME} · ${input.title}`,
        eyebrow: t(EVENT_EYEBROW[input.event] ?? 'Notification'),
        title: input.title,
        paragraphs: [input.message],
        button: { url, label: t('Open in ToHuus Hub') },
        reason: t('You get this because e-mail is switched on for this event under Settings › Notifications.'),
        ...input.mail,
      })
        .then((): [string, boolean] => ['email', true])
        .catch((e: Error): [string, boolean] => {
          console.warn('[mail]', e.message);
          return ['email', false];
        }),
    );
  }
  const results = await Promise.all(jobs);
  const channels = results.filter(([, ok]) => ok).map(([c]) => c);
  db.prepare('INSERT INTO notifications (event, title, body, payload, dedupe_key, channels) VALUES (?, ?, ?, ?, ?, ?)').run(
    input.event,
    input.title,
    input.message,
    JSON.stringify(payload),
    input.dedupeKey ?? null,
    JSON.stringify(results.map(([c, ok]) => ({ channel: c, ok }))),
  );
  emit('notifications');
  return { channels };
}

/** Members grouped by what their lock screen may show (full text or only "Neues in ToHuus"). */
function byPreview(ids: number[], input: NotifyInput): [number[], { title: string; body: string }][] {
  const groups = new Map<string, [number[], { title: string; body: string }]>();
  for (const id of ids) {
    const text = textFor(id, input.title, input.message);
    const key = `${text.title}\u0000${text.body}`;
    const g = groups.get(key) ?? [[], text];
    g[0].push(id);
    groups.set(key, g);
  }
  return [...groups.values()];
}

function encodeHeader(s: string) {
  // ntfy accepts RFC 2047 encoded headers for non-ASCII titles
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
}
