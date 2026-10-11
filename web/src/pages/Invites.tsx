/**
 * Settings › Members › "Invite someone" (wave 6): name and e-mail optional, member / admin or a guest level,
 * an optional note. With SMTP the branded invitation mail goes out; without (or additionally) the link can be
 * copied, shown as QR code or shared (share sheet, WhatsApp). Open invitations can be sent again, renewed or
 * withdrawn. Works the same for one person, a couple, a family or a shared flat.
 */
import { ArrowsClockwise, Copy, EnvelopeSimple, PaperPlaneTilt, ShareNetwork, UserPlus, WhatsappLogo, X } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { del, invalidate, post, useApi } from '../api';
import { locale, t } from '../i18n';
import { Avatar, Seg, Sheet, Toggle, useToast } from '../ui';

export type InviteStatus = 'pending' | 'used' | 'expired' | 'revoked';
export interface InviteItem {
  id: number;
  name: string;
  email: string | null;
  role: 'admin' | 'member';
  kind: 'member' | 'guest';
  guest_level: string | null;
  color: string;
  message: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  sent_at: string | null;
  send_count: number;
  used_at: string | null;
  used_by_name: string | null;
  status: InviteStatus;
}
export interface InviteLink {
  name: string;
  url: string;
  expires_at: string;
  sent: boolean;
  email: string | null;
}

type Access = 'member' | 'admin' | 'guest';
const LEVELS = () =>
  [
    ['order', t('Treats & shopping list')],
    ['stock', t('+ Stock')],
    ['recipes', t('+ Recipes')],
    ['family', t('Like family')],
  ] as [string, string][];
const LEVEL_HELP: Record<string, string> = {
  order: 'Can ask for treats from the menu and add to the shopping list.',
  stock: 'Also sees the stock and where things are.',
  recipes: 'Also sees recipes, the week plan and votes.',
  family: 'Everything day to day – but no settings, spending or backups.',
};

const toDate = (s: string) => new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
const fmtDay = (s: string) => toDate(s).toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const accessLabel = (i: Pick<InviteItem, 'kind' | 'role' | 'guest_level'>) =>
  i.kind === 'guest' ? `${t('Guest')} · ${LEVELS().find(([k]) => k === i.guest_level)?.[1] ?? LEVELS()[0][1]}` : i.role === 'admin' ? t('Admin') : t('Member');

export function InviteSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (r: InviteLink) => void }) {
  const opts = useApi<{ mail: boolean; days: number }>('invites-options', open ? '/invites/options' : null);
  const [f, setF] = useState({ name: '', email: '', access: 'member' as Access, level: 'order', message: '', send: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (open) {
      setF({ name: '', email: '', access: 'member', level: 'order', message: '', send: true });
      setErr('');
    }
  }, [open]);
  const mail = Boolean(opts.data?.mail);
  const emailOk = EMAIL_RE.test(f.email.trim());
  const emailBad = f.email.trim().length > 0 && !emailOk;
  const willMail = mail && emailOk && f.send;
  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await post('/invites', {
        name: f.name.trim() || null,
        email: f.email.trim() || null,
        role: f.access === 'admin' ? 'admin' : 'member',
        kind: f.access === 'guest' ? 'guest' : 'member',
        guest_level: f.access === 'guest' ? f.level : null,
        message: f.message.trim() || null,
        send: willMail,
      });
      invalidate('invites');
      onCreated({ name: f.name.trim() || f.email.trim(), url: r.url, expires_at: r.expires_at, sent: r.sent, email: r.email });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('Invite someone')}
      footer={
        <button className="btn primary lg block" disabled={busy || emailBad} onClick={create}>
          {willMail ? <PaperPlaneTilt size={18} /> : <UserPlus size={18} />} {busy ? t('Creating …') : willMail ? t('Send invitation') : t('Create invitation link')}
        </button>
      }
    >
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('They get a personal link and choose how to sign in themselves – passkey, password or e-mail link. The link works once and for {days} days.', { days: opts.data?.days ?? 7 })}
        </p>
        <div className="field">
          <label htmlFor="inv-name">{t('Name (optional)')}</label>
          <input id="inv-name" className="input" value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('e.g. Jonas')} autoFocus />
          <div className="help">{t('Leave it empty and they type their own name.')}</div>
        </div>
        <div className="field">
          <label htmlFor="inv-mail">{t('E-mail (optional)')}</label>
          <input id="inv-mail" className="input" type="email" inputMode="email" autoComplete="off" value={f.email} maxLength={254} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder={t('name@example.org')} />
          {emailBad ? (
            <div className="help" style={{ color: 'var(--empty)' }}>{t('That doesn’t look like an e-mail address.')}</div>
          ) : !mail ? (
            <div className="help">{t('This server can’t send e-mail (no SMTP). You get a link and a QR code to pass on instead.')}</div>
          ) : null}
        </div>
        {mail && emailOk && (
          <div className="row between" style={{ gap: 12 }}>
            <span className="small">{t('Send the invitation by e-mail now')}</span>
            <Toggle on={f.send} onChange={(v) => setF({ ...f, send: v })} label={t('Send the invitation by e-mail now')} />
          </div>
        )}
        <div className="field">
          <label>{t('Access')}</label>
          <Seg
            value={f.access}
            onChange={(v) => setF({ ...f, access: v })}
            options={[
              ['member', t('Member')],
              ['admin', t('Admin')],
              ['guest', t('Guest')],
            ]}
          />
          <div className="help">
            {f.access === 'admin'
              ? t('Admins can also change settings, members and backups.')
              : f.access === 'guest'
                ? t('For the aunt, the babysitter or a flatmate’s partner: sees only what you allow.')
                : t('Members can use everything day to day, but not change settings.')}
          </div>
        </div>
        {f.access === 'guest' && (
          <div className="field">
            <label>{t('What may they see?')}</label>
            <div className="chips" style={{ flexWrap: 'wrap', margin: 0, padding: 0 }}>
              {LEVELS().map(([k, label]) => (
                <button key={k} type="button" className={`chip ${f.level === k ? 'on' : ''}`} aria-pressed={f.level === k} onClick={() => setF({ ...f, level: k })}>
                  {label}
                </button>
              ))}
            </div>
            <div className="help">{t(LEVEL_HELP[f.level] ?? LEVEL_HELP.order)}</div>
          </div>
        )}
        <div className="field">
          <label htmlFor="inv-msg">{t('A few words (optional)')}</label>
          <textarea id="inv-msg" className="input" rows={2} maxLength={500} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder={t('e.g. Here’s our shopping list app – see you on Sunday!')} />
        </div>
        {err && <div className="small" style={{ color: 'var(--empty)' }} role="alert">{err}</div>}
      </div>
    </Sheet>
  );
}

/** Link to pass on: copy, QR code, share sheet, WhatsApp. Shown right after creating or renewing. */
export function InviteLinkSheet({ item, onClose }: { item: InviteLink | null; onClose: () => void }) {
  const [svg, setSvg] = useState('');
  const toast = useToast();
  useEffect(() => {
    setSvg('');
    if (item?.url) QRCode.toString(item.url, { type: 'svg', margin: 1, color: { dark: '#181D1A', light: '#FFFDF9' } }).then(setSvg);
  }, [item?.url]);
  if (!item) return null;
  const share = typeof navigator !== 'undefined' && 'share' in navigator;
  const text = t('Join our household app – pick how you want to sign in here:');
  return (
    <Sheet open onClose={onClose} title={item.name ? t('Invitation for {name}', { name: item.name }) : t('Invitation')}>
      <div className="stack" style={{ alignItems: 'stretch' }}>
        {item.sent && item.email && (
          <div className="note-card small" role="status">
            <EnvelopeSimple size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            {t('The invitation is on its way to {email}. You can also pass on the link yourself:', { email: item.email })}
          </div>
        )}
        <div className="data-qr" dangerouslySetInnerHTML={{ __html: svg }} aria-label={t('QR code of the invitation link')} />
        <div className="small muted mono" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{item.url}</div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn grow" onClick={() => navigator.clipboard.writeText(item.url).then(() => toast({ text: t('Link copied') }))}>
            <Copy size={16} /> {t('Copy link')}
          </button>
          <a className="btn grow" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${item.url}`)}`} target="_blank" rel="noreferrer">
            <WhatsappLogo size={16} /> WhatsApp
          </a>
          {share && (
            <button className="btn primary grow" onClick={() => navigator.share({ title: t('Invitation'), text, url: item.url }).catch(() => {})}>
              <ShareNetwork size={16} /> {t('Share')}
            </button>
          )}
        </div>
        <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>
          {t('Scan with the phone, or send the link. Valid until {date}, works once. It is shown only now.', { date: fmtDay(item.expires_at) })}
        </p>
      </div>
    </Sheet>
  );
}

/** Invitations with their status: waiting, joined, expired, withdrawn. */
export function InviteList({ items, mail, onLink }: { items: InviteItem[]; mail: boolean; onLink: (l: InviteLink) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);
  const run = async (id: number, fn: () => Promise<void>) => {
    setBusy(id);
    try {
      await fn();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  const renew = (i: InviteItem, deliver: 'email' | 'link') =>
    run(i.id, async () => {
      const r = await post(`/invites/${i.id}/resend`, { deliver });
      invalidate('invites');
      if (deliver === 'email') toast({ text: t('Sent again to {email}', { email: r.email }) });
      else onLink({ name: i.name || i.email || '', url: r.url, expires_at: r.expires_at, sent: false, email: r.email });
    });
  if (!items.length) return null;
  return (
    <div className="list">
      {items.map((i) => {
        const who = i.name || i.email || t('Someone new');
        const status =
          i.status === 'used'
            ? t('Joined as {name}', { name: i.used_by_name ?? i.name })
            : i.status === 'revoked'
              ? t('Withdrawn')
              : i.status === 'expired'
                ? t('Expired on {date}', { date: fmtDay(i.expires_at) })
                : i.sent_at
                  ? t('E-mail sent · valid until {date}', { date: fmtDay(i.expires_at) })
                  : t('Waiting · valid until {date}', { date: fmtDay(i.expires_at) });
        const open = i.status === 'pending' || i.status === 'expired';
        return (
          <div key={i.id} className="li" style={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 8 }}>
            <Avatar name={who} color={i.color} />
            <div className="grow" style={{ minWidth: 160 }}>
              <div className="title">{who}</div>
              <div className="sub">
                {accessLabel(i)} · {status}
              </div>
              {i.email && i.name && <div className="sub">{i.email}</div>}
            </div>
            {open && (
              <div className="row wrap" style={{ gap: 6 }}>
                {mail && i.email && (
                  <button className="btn sm" disabled={busy === i.id} onClick={() => renew(i, 'email')}>
                    <PaperPlaneTilt size={14} /> {t('Send again')}
                  </button>
                )}
                <button className="btn sm" disabled={busy === i.id} onClick={() => renew(i, 'link')}>
                  <ArrowsClockwise size={14} /> {t('New link')}
                </button>
                {i.status === 'pending' && (
                  <button className="btn sm ghost" disabled={busy === i.id} onClick={() => run(i.id, async () => { await del(`/invites/${i.id}`); invalidate('invites'); })}>
                    <X size={14} /> {t('Withdraw')}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
