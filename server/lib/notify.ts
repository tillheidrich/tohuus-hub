import { config } from '../config.js';
import { APP_NAME, canSendMail, mailHousehold, sendMail, smtpTransport, type MailContent } from './mail.js';
import { db, getSetting } from '../db.js';
import { emit } from './bus.js';
import { t } from '../i18n.js';
import { actionsFor, pushDeviceCount, sendPush } from './webpush.js';
import { quietWhileAway } from './away-state.js';

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
  'order.new': 'Order',
  'order.status': 'Order',
  'shopping.added': 'Shopping list',
  'digest.daily': 'Daily overview',
  'care.due': 'Care',
  'party.ending': 'Party',
  'kids.wish': 'Wish',
  'auth.new_device': 'Security',
  'budget.warning': 'Budget',
  'plan.vote': 'Meal plan',
  'plan.rotation': 'Meal plan',
  test: 'Test',
};

export const DEFAULT_NOTIFY: NotifySettings = {
  haWebhookUrl: '',
  webhookUrl: '',
  ntfyUrl: '',
  emailTo: '',
  digestHour: 17,
  expiryWarnDays: 3,
  autoShoppingList: true,
  events: {
    'stock.low': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    'stock.empty': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    'stock.expiring': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    'import.review': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    'order.new': { ha: true, webhook: true, ntfy: true, email: false, push: true },
    'order.status': { ha: false, webhook: true, ntfy: false, email: false, push: false },
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
  // Web Push (PWA): an event saved before the channel existed falls back to the default routing
  // ha2: members who chose "via Home Assistant" get the push through their HA companion app instead
  const personal = (route.push ?? DEFAULT_NOTIFY.events[input.event]?.push) && personalRouter ? personalRouter({ ...input, url }) : null;
  if (personal?.job) jobs.push(personal.job.then((ok): [string, boolean] => ['ha_app', ok]).catch((): [string, boolean] => ['ha_app', false]));
  if ((route.push ?? DEFAULT_NOTIFY.events[input.event]?.push) && pushDeviceCount() > 0)
    jobs.push(
      sendPush({ title: input.title, body: input.message, url, event: input.event, tag: input.dedupeKey, actions: actionsFor(input.event, input.data), data: input.data }, { excludeUserIds: personal?.skipPushUsers })
        .then((ok): [string, boolean] => ['push', ok])
        .catch((): [string, boolean] => ['push', false]),
    );
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

function encodeHeader(s: string) {
  // ntfy accepts RFC 2047 encoded headers for non-ASCII titles
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
}
