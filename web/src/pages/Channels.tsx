/**
 * Settings › Notifications & calendar › For the whole household: Telegram (two-way, linked chats), Gotify and Matrix.
 * Routing per event stays in the "What goes where?" matrix; `useChannelColumns` adds the columns for channels in use.
 */
import { ArrowSquareOut, BellSimpleRinging, CaretDown, ChatsTeardrop, Copy, LinkSimple, PaperPlaneTilt, Trash, UsersThree } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { type ReactNode, useEffect, useState } from 'react';
import { del, invalidate, patch, post, put, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';

interface Chat {
  id: number;
  chat_id: string;
  kind: 'private' | 'group';
  title: string | null;
  user_id: number | null;
  user_name: string | null;
  notify: number;
  fails: number;
  last_error: string | null;
  created_at: string;
  last_seen_at: string | null;
}

interface ChannelsState {
  telegram: {
    enabled: boolean;
    configured: boolean;
    botToken: string;
    botName: string;
    mode: 'polling' | 'webhook';
    webhookAvailable: boolean;
    status: { running: boolean; mode: string; lastPollAt: string | null; lastError: string | null };
    chats: Chat[];
  };
  gotify: { enabled: boolean; url: string; appToken: string; priorities: Record<string, number>; ready: boolean };
  matrix: { enabled: boolean; homeserver: string; accessToken: string; roomId: string; ready: boolean };
  ready: { telegram: boolean; gotify: boolean; matrix: boolean };
}

const KEY = ['settings', 'channels'];
const useChannels = () => useApi<ChannelsState>(KEY, '/channels');
const errText = (e: unknown) => (e as Error).message;

/** Extra columns for the routing matrix: only channels that are switched on (keeps the table narrow on phones). */
export function useChannelColumns(): [string, string][] {
  const c = useChannels();
  const cols: [string, string][] = [];
  if (c.data?.telegram.enabled) cols.push(['telegram', 'Telegram']);
  if (c.data?.gotify.enabled) cols.push(['gotify', 'Gotify']);
  if (c.data?.matrix.enabled) cols.push(['matrix', 'Matrix']);
  return cols;
}

export function ChannelsSettings({ admin, eventLabels }: { admin: boolean; eventLabels: Record<string, string> }) {
  const c = useChannels();
  return (
    <section className="stack ch-section">
      <div>
        <h2 style={{ marginBottom: 4 }}>{t('Channels')}</h2>
        <div className="small muted">{t('Optional extra ways to reach the household. Each one is off until you set it up.')}</div>
      </div>
      {c.isLoading ? (
        <Skeleton n={3} h={72} />
      ) : c.error || !c.data ? (
        <div className="card pad small">
          {t('Channels could not be loaded.')}{' '}
          <button className="btn sm" onClick={() => c.refetch()}>
            {t('Try again')}
          </button>
        </div>
      ) : (
        <>
          <TelegramCard admin={admin} s={c.data.telegram} />
          <GotifyCard admin={admin} s={c.data.gotify} eventLabels={eventLabels} />
          <MatrixCard admin={admin} s={c.data.matrix} />
        </>
      )}
    </section>
  );
}

function CardHead({ icon, title, sub, right, open, onToggleOpen }: { icon: ReactNode; title: string; sub: ReactNode; right?: ReactNode; open?: boolean; onToggleOpen?: () => void }) {
  return (
    <div className="row between ch-head">
      <button type="button" className="ch-head-main" onClick={onToggleOpen} aria-expanded={open} disabled={!onToggleOpen}>
        <span className="ch-icon">{icon}</span>
        <span className="grow">
          <b>{title}</b>
          <span className="small muted ch-sub">{sub}</span>
        </span>
        {onToggleOpen && <CaretDown size={16} className={`ch-caret ${open ? 'open' : ''}`} />}
      </button>
      {right}
    </div>
  );
}

async function testChannel(name: string, toast: ReturnType<typeof useToast>, emptyHint?: string) {
  try {
    const r = await post<{ ok: boolean }>(`/channels/${name}/test`);
    toast(r.ok ? { text: t('Test sent') } : { text: emptyHint ?? t('The channel did not accept the message – check the settings'), error: true });
    invalidate('notifications');
  } catch (e) {
    toast({ text: errText(e), error: true });
  }
}

// ------------------------------------------------------------------ Telegram

function TelegramCard({ admin, s }: { admin: boolean; s: ChannelsState['telegram'] }) {
  const toast = useToast();
  const [open, setOpen] = useState(!s.configured);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState<{ link: string; kind: 'private' | 'group'; forName: string | null } | null>(null);
  const members = useApi<{ id: number; name: string }[]>(['settings', 'members-mini'], admin ? '/shop/members' : null);
  const [forUser, setForUser] = useState<string>('');

  const saveToken = async () => {
    setBusy(true);
    try {
      const r = await put<{ botName: string }>('/channels/telegram', { botToken: token.trim(), enabled: true });
      setToken('');
      invalidate('settings');
      toast({ text: t('Connected to @{name}', { name: r.botName }) });
    } catch (e) {
      toast({ text: errText(e), error: true });
    } finally {
      setBusy(false);
    }
  };
  const set = async (body: Record<string, unknown>) => {
    try {
      await put('/channels/telegram', body);
      invalidate('settings');
    } catch (e) {
      toast({ text: errText(e), error: true });
    }
  };
  const makeLink = async (opts: { group?: boolean; userId?: number; forName?: string | null }) => {
    try {
      const r = await post<{ link: string; kind: 'private' | 'group' }>('/channels/telegram/pair', { group: opts.group, user_id: opts.userId });
      setPair({ link: r.link, kind: r.kind, forName: opts.forName ?? null });
    } catch (e) {
      toast({ text: errText(e), error: true });
    }
  };
  const disconnect = async () => {
    if (!confirm(t('Disconnect the bot? Linked chats stay saved, but nothing is sent until you add a token again.'))) return;
    await set({ botToken: '' });
  };

  const sub = !s.configured
    ? t('Two-way: notifications with buttons, add to the list by chat, send receipts.')
    : s.enabled
      ? `@${s.botName} · ${s.chats.length === 1 ? t('1 linked chat') : t('{n} linked chats', { n: s.chats.length })}`
      : t('Off');

  return (
    <div className="card pad stack ch-card">
      <CardHead
        icon={<PaperPlaneTilt size={20} />}
        title="Telegram"
        sub={sub}
        open={open}
        onToggleOpen={() => setOpen((o) => !o)}
        right={admin && s.configured ? <Toggle on={s.enabled} onChange={(v) => set({ enabled: v })} label={t('Telegram on')} /> : undefined}
      />
      {open && !s.configured && (
        admin ? (
          <div className="stack ch-body">
            <ol className="ch-steps small">
              <li>{t('In Telegram, open @BotFather and send /newbot. Pick any name, e.g. “Our home”.')}</li>
              <li>{t('BotFather replies with a token like 123456:ABC… – paste it here.')}</li>
              <li>{t('Then link each person (and, if you like, a family group) with a one-time link.')}</li>
            </ol>
            <div className="field">
              <label htmlFor="tg-token">{t('Bot token')}</label>
              <input id="tg-token" className="input mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AA…" />
              <div className="help">{t('Stored in ToHuus Hub only and left out of exports. The server asks Telegram for new messages itself – no public address needed.')}</div>
            </div>
            <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy || token.trim().length < 20} onClick={saveToken}>
              {busy ? t('Checking …') : t('Connect bot')}
            </button>
          </div>
        ) : (
          <div className="small muted ch-body">{t('An admin can set up a Telegram bot here. Afterwards you can link your own Telegram.')}</div>
        )
      )}
      {open && s.configured && (
        <div className="stack ch-body">
          {s.status.lastError && s.enabled && (
            <div className="banner warn" style={{ cursor: 'default' }}>
              <div className="small">
                <b>{t('Telegram is not reachable right now')}</b>
                <div className="mono">{s.status.lastError}</div>
              </div>
            </div>
          )}
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn primary" onClick={() => makeLink({})} disabled={!s.enabled}>
              <LinkSimple size={16} /> {t('Link my Telegram')}
            </button>
            {admin && (
              <button className="btn" onClick={() => makeLink({ group: true })} disabled={!s.enabled}>
                <UsersThree size={16} /> {t('Link a family group')}
              </button>
            )}
          </div>
          {admin && (members.data ?? []).length > 1 && (
            <div className="row wrap" style={{ gap: 8 }}>
              <select className="input ch-select" value={forUser} onChange={(e) => setForUser(e.target.value)} aria-label={t('Link for someone else')}>
                <option value="">{t('Link for someone else …')}</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <button className="btn sm" disabled={!forUser || !s.enabled} onClick={() => makeLink({ userId: Number(forUser), forName: members.data?.find((m) => m.id === Number(forUser))?.name })}>
                {t('Create link')}
              </button>
            </div>
          )}
          <ChatList chats={s.chats} />
          {admin && (
            <details className="ch-more">
              <summary className="small">{t('More')}</summary>
              <div className="stack" style={{ marginTop: 10 }}>
                {s.webhookAvailable && (
                  <div className="field">
                    <label>{t('How messages arrive')}</label>
                    <Seg
                      value={s.mode}
                      onChange={(v) => set({ mode: v })}
                      options={[
                        ['polling', t('Server asks (works everywhere)')],
                        ['webhook', t('Webhook (https)')],
                      ]}
                    />
                  </div>
                )}
                <div className="small muted">
                  {s.status.mode === 'off'
                    ? t('Not receiving messages.')
                    : s.status.mode === 'webhook'
                      ? t('Receiving messages by webhook.')
                      : s.status.lastPollAt
                        ? t('Receiving messages – last check {when}.', { when: relTime(s.status.lastPollAt) })
                        : t('Starting …')}
                </div>
                <div className="small muted">{t('In groups, Telegram only passes commands to bots. Add things there with /kaufen.')}</div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <button className="btn sm" onClick={() => testChannel('telegram', toast, t('No linked chat answered – link a chat first'))} disabled={!s.enabled}>
                    <BellSimpleRinging size={15} /> {t('Send a test')}
                  </button>
                  <button className="btn sm ghost" onClick={disconnect}>
                    {t('Disconnect bot')}
                  </button>
                </div>
              </div>
            </details>
          )}
        </div>
      )}
      <PairSheet pair={pair} onClose={() => setPair(null)} chats={s.chats} />
    </div>
  );
}

function ChatList({ chats }: { chats: Chat[] }) {
  const toast = useToast();
  if (!chats.length) return <div className="small muted">{t('No chat linked yet.')}</div>;
  const setNotify = async (c: Chat, on: boolean) => {
    try {
      await patch(`/channels/telegram/chats/${c.id}`, { notify: on });
      invalidate('settings');
    } catch (e) {
      toast({ text: errText(e), error: true });
    }
  };
  const unlink = async (c: Chat) => {
    if (!confirm(t('Unlink this chat? It stops receiving messages and can no longer add things.'))) return;
    try {
      await del(`/channels/telegram/chats/${c.id}`);
      invalidate('settings');
      toast({ text: t('Chat unlinked') });
    } catch (e) {
      toast({ text: errText(e), error: true });
    }
  };
  return (
    <>
      <div className="list ch-chats">
      {chats.map((c) => (
        <div key={c.id} className="li">
          {c.kind === 'group' ? <UsersThree size={18} /> : <PaperPlaneTilt size={18} />}
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="title small">{c.kind === 'group' ? c.title || t('Group') : c.user_name || t('Former member')}</div>
            <div className="sub">
              {c.kind === 'group' ? t('Group') : c.title || t('Private chat')}
              {c.fails > 0 ? ` · ${t('last message failed')}` : ''}
            </div>
          </div>
          <Toggle on={Boolean(c.notify)} onChange={(v) => setNotify(c, v)} label={t('Notifications to this chat')} />
          <button className="icon-btn" onClick={() => unlink(c)} aria-label={t('Unlink')}>
            <Trash size={16} />
          </button>
        </div>
      ))}
      </div>
      <div className="small muted">{t('The switch decides whether a chat gets notifications. Adding to the list works either way.')}</div>
    </>
  );
}

function PairSheet({ pair, onClose, chats }: { pair: { link: string; kind: 'private' | 'group'; forName: string | null } | null; onClose: () => void; chats: Chat[] }) {
  const toast = useToast();
  const [svg, setSvg] = useState('');
  const [startCount, setStartCount] = useState(0);
  useEffect(() => {
    if (!pair) return;
    setStartCount(chats.length);
    QRCode.toString(pair.link, { type: 'svg', margin: 1, color: { dark: '#17181a', light: '#ffffff' } }).then(setSvg).catch(() => setSvg(''));
  }, [pair]);
  // the server announces a new link via the event stream → the list grows → done
  useEffect(() => {
    if (pair && chats.length > startCount) {
      toast({ text: t('Linked') });
      onClose();
    }
  }, [chats.length]);
  if (!pair) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pair.link);
      toast({ text: t('Link copied') });
    } catch {
      toast({ text: pair.link });
    }
  };
  return (
    <Sheet open onClose={onClose} title={pair.kind === 'group' ? t('Link a family group') : pair.forName ? t('Link Telegram for {name}', { name: pair.forName }) : t('Link my Telegram')}>
      <div className="stack">
        <p className="small" style={{ margin: 0 }}>
          {pair.kind === 'group'
            ? t('Open the link, choose the family group and add the bot. That’s it.')
            : pair.forName
              ? t('Send this link to {name}. Opening it and tapping “Start” links their Telegram.', { name: pair.forName })
              : t('Open the link on your phone and tap “Start” in Telegram.')}
        </p>
        <a className="btn primary" href={pair.link} target="_blank" rel="noreferrer" style={{ alignSelf: 'flex-start' }}>
          <ArrowSquareOut size={16} /> {t('Open Telegram')}
        </a>
        {svg && <div className="ch-qr" aria-label={t('QR code of the link')} dangerouslySetInnerHTML={{ __html: svg }} />}
        <div className="row" style={{ gap: 8 }}>
          <code className="codebox grow ch-link">{pair.link}</code>
          <button className="icon-btn" onClick={copy} aria-label={t('Copy link')}>
            <Copy size={16} />
          </button>
        </div>
        <div className="small muted">{t('The link works once and expires in 15 minutes.')}</div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ Gotify

const PRIO: [string, string][] = [
  ['2', 'Quiet'],
  ['5', 'Normal'],
  ['8', 'Important'],
];

function GotifyCard({ admin, s, eventLabels }: { admin: boolean; s: ChannelsState['gotify']; eventLabels: Record<string, string> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(s);
  useEffect(() => setF(s), [s]);
  const save = async (next = f) => {
    try {
      await put('/channels/gotify', { enabled: next.enabled, url: next.url, appToken: next.appToken, priorities: next.priorities });
      invalidate('settings');
      toast({ text: t('Saved') });
    } catch (e) {
      toast({ text: errText(e), error: true });
    }
  };
  const nearest = (n: number) => (n <= 3 ? '2' : n >= 7 ? '8' : '5');
  return (
    <div className="card pad stack ch-card">
      <CardHead
        icon={<BellSimpleRinging size={20} />}
        title="Gotify"
        sub={s.enabled ? (s.ready ? s.url.replace(/^https?:\/\//, '') : t('On, but not complete')) : t('Self-hosted push to the Gotify app.')}
        open={open}
        onToggleOpen={() => setOpen((o) => !o)}
        right={admin ? <Toggle on={s.enabled} onChange={(v) => save({ ...f, enabled: v })} label={t('Gotify on')} /> : undefined}
      />
      {open && (
        <div className="stack ch-body">
          <div className="field">
            <label htmlFor="gotify-url">{t('Server address')}</label>
            <input id="gotify-url" className="input" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://gotify.example.de" disabled={!admin} />
          </div>
          <div className="field">
            <label htmlFor="gotify-token">{t('App token')}</label>
            <input id="gotify-token" className="input mono" type="password" autoComplete="off" value={f.appToken} onChange={(e) => setF({ ...f, appToken: e.target.value })} placeholder="A…" disabled={!admin} />
            <div className="help">{t('In Gotify: Apps › Create application, then copy its token.')}</div>
          </div>
          <div className="field">
            <label>{t('Priority per event')}</label>
            <div className="list ch-prio">
              {Object.keys(eventLabels).map((ev) => (
                <div key={ev} className="li">
                  <span className="grow small">{t(eventLabels[ev])}</span>
                  <select
                    className="input ch-select sm"
                    value={nearest(f.priorities[ev] ?? 5)}
                    disabled={!admin}
                    onChange={(e) => setF({ ...f, priorities: { ...f.priorities, [ev]: Number(e.target.value) } })}
                    aria-label={t('Priority for “{event}”', { event: t(eventLabels[ev]) })}
                  >
                    {PRIO.map(([v, l]) => (
                      <option key={v} value={v}>
                        {t(l)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="help">{t('“Important” pops up on screen in the Gotify Android app.')}</div>
          </div>
          {admin && (
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn primary" onClick={() => save()}>
                {t('Save')}
              </button>
              <button className="btn" disabled={!s.ready} onClick={() => testChannel('gotify', toast)}>
                {t('Send a test')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Matrix

function MatrixCard({ admin, s }: { admin: boolean; s: ChannelsState['matrix'] }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(s);
  useEffect(() => setF(s), [s]);
  const save = async (next = f) => {
    try {
      await put('/channels/matrix', { enabled: next.enabled, homeserver: next.homeserver, accessToken: next.accessToken, roomId: next.roomId });
      invalidate('settings');
      toast({ text: t('Saved') });
    } catch (e) {
      toast({ text: errText(e), error: true });
    }
  };
  return (
    <div className="card pad stack ch-card">
      <CardHead
        icon={<ChatsTeardrop size={20} />}
        title="Matrix"
        sub={s.enabled ? (s.ready ? s.roomId : t('On, but not complete')) : t('Messages into a Matrix room (Element and others).')}
        open={open}
        onToggleOpen={() => setOpen((o) => !o)}
        right={admin ? <Toggle on={s.enabled} onChange={(v) => save({ ...f, enabled: v })} label={t('Matrix on')} /> : undefined}
      />
      {open && (
        <div className="stack ch-body">
          <div className="field">
            <label htmlFor="mx-hs">{t('Homeserver')}</label>
            <input id="mx-hs" className="input" value={f.homeserver} onChange={(e) => setF({ ...f, homeserver: e.target.value })} placeholder="https://matrix.example.org" disabled={!admin} />
          </div>
          <div className="field">
            <label htmlFor="mx-token">{t('Access token')}</label>
            <input id="mx-token" className="input mono" type="password" autoComplete="off" value={f.accessToken} onChange={(e) => setF({ ...f, accessToken: e.target.value })} placeholder="syt_…" disabled={!admin} />
            <div className="help">{t('Best a separate account for the house. In Element: Settings › Help & About › Access token. Invite that account to the room.')}</div>
          </div>
          <div className="field">
            <label htmlFor="mx-room">{t('Room')}</label>
            <input id="mx-room" className="input mono" value={f.roomId} onChange={(e) => setF({ ...f, roomId: e.target.value })} placeholder="!abc123:example.org / #family:example.org" disabled={!admin} />
          </div>
          <div className="small muted">{t('Matrix only sends. Answers in the room are not read.')}</div>
          {admin && (
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn primary" onClick={() => save()}>
                {t('Save')}
              </button>
              <button className="btn" disabled={!s.ready} onClick={() => testChannel('matrix', toast)}>
                {t('Send a test')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
