/**
 * Settings › Members (invites, login screen privacy) and Settings › Data & backups
 * (snapshots, restore, off-site copy). Area: data.
 */
import {
  ArrowCounterClockwise,
  CheckCircle,
  CloudArrowUp,
  Copy,
  Database,
  DownloadSimple,
  ShareNetwork,
  Trash,
  UploadSimple,
  UserPlus,
  Warning,
} from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import type { Me } from '../App';
import { api, del, invalidate, patch, post, put, useApi } from '../api';
import { Avatar, Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';
import { locale, t } from '../i18n';

const COLORS = ['#2f5bea', '#d0603a', '#1d9a63', '#8e44ad', '#c2185b', '#b97c0c'];

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) or ISO → Date */
const toDate = (s: string) => new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
const fmtWhen = (s: string) => toDate(s).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDay = (s: string) => toDate(s).toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
function fmtSize(b: number) {
  if (b < 1024 * 1024) return t('{n} KB', { n: Math.max(1, Math.round(b / 1024)) });
  return t('{n} MB', { n: (b / 1024 / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 }) });
}

// ================================================================== members

interface Invite {
  id: number;
  name: string;
  role: 'admin' | 'member';
  color: string;
  created_by: string | null;
  created_at: string;
  expires_at: string;
}

export function Members({ me, admin }: { me: Me; admin: boolean }) {
  const users = useApi<any[]>('users', admin ? '/users' : null);
  const invites = useApi<Invite[]>('invites', admin ? '/invites' : null);
  const ds = useApi<{ showNames: boolean }>('data-settings', '/data/settings');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [link, setLink] = useState<{ name: string; url: string; expires_at: string } | null>(null);
  const toast = useToast();

  if (!admin)
    return (
      <div className="card pad small muted">{t('Only admins can invite people or change who belongs to the household.')}</div>
    );

  return (
    <div className="stack" style={{ gap: 22 }}>
      <section>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{t('Members')}</h2>
          <button className="btn primary" onClick={() => setInviteOpen(true)}>
            <UserPlus size={16} /> {t('Invite someone')}
          </button>
        </div>
        {/* everybody (members, guests, children) is listed and edited in "Our household" above (area: people) */}
        <p className="small muted" style={{ margin: 0 }}>
          {users.error ? (users.error as Error).message : t('Family members get a personal link and choose their own password, passkey or e-mail sign-in.')}
        </p>
      </section>

      {(invites.data ?? []).length > 0 && (
        <section>
          <h2 style={{ marginBottom: 6 }}>{t('Waiting for a reply')}</h2>
          <p className="small muted" style={{ marginTop: 0 }}>{t('For safety, an invitation link is only shown once. Lost it? Withdraw it and invite again.')}</p>
          <div className="list">
            {(invites.data ?? []).map((i) => (
              <div key={i.id} className="li">
                <Avatar name={i.name} color={i.color} />
                <div className="grow">
                  <div className="title">{i.name}</div>
                  <div className="sub">
                    {i.role === 'admin' ? t('Admin') : t('Member')} · {t('valid until {date}', { date: fmtDay(i.expires_at) })}
                  </div>
                </div>
                <button className="btn sm ghost" onClick={() => del(`/invites/${i.id}`).then(() => invalidate('invites'))}>
                  {t('Withdraw')}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="card pad stack">
        <div className="row between" style={{ alignItems: 'flex-start', gap: 14 }}>
          <div>
            <b>{t('Show names on the sign-in screen')}</b>
            <div className="small muted">
              {t('Handy at home: tap your name, type your password. Turn it off if the app is reachable from the internet – then everyone types their name.')}
            </div>
          </div>
          {ds.data ? (
            <Toggle
              on={ds.data.showNames}
              onChange={(v) => patch('/data/settings', { showNames: v }).then(() => { invalidate('data-settings', 'users-public'); toast({ text: t('Saved') }); })}
            />
          ) : null}
        </div>
      </div>

      <AddWithPassword />

      <InviteSheet
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={(r) => {
          setInviteOpen(false);
          setLink(r);
          invalidate('invites');
        }}
      />
      <LinkSheet item={link} onClose={() => setLink(null)} />
    </div>
  );
}

function InviteSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (r: { name: string; url: string; expires_at: string }) => void }) {
  const [f, setF] = useState({ name: '', role: 'member' as 'member' | 'admin', color: COLORS[1] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (open) {
      setF({ name: '', role: 'member', color: COLORS[Math.floor(Math.random() * COLORS.length)] });
      setErr('');
    }
  }, [open]);
  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await post('/invites', f);
      onCreated({ name: f.name, url: r.url, expires_at: r.expires_at });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Invite someone')}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('You get a personal link. Whoever opens it picks their own password – nobody has to pass passwords around. The link works once and for 7 days.')}
        </p>
        <div className="field">
          <label htmlFor="inv-name">{t('Name')}</label>
          <input id="inv-name" className="input" value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('e.g. Lea')} autoFocus />
        </div>
        <div className="field">
          <label>{t('Role')}</label>
          <Seg value={f.role} onChange={(v) => setF({ ...f, role: v })} options={[['member', t('Member')], ['admin', t('Admin')]]} />
          <div className="help">{f.role === 'admin' ? t('Admins can also change settings, members and backups.') : t('Members can use everything day to day, but not change settings.')}</div>
        </div>
        <div className="field">
          <label>{t('Colour')}</label>
          <div className="row" style={{ gap: 10 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`data-swatch ${f.color === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => setF({ ...f, color: c })}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        {err && <div className="small" style={{ color: 'var(--empty)' }}>{err}</div>}
        <button className="btn primary lg" disabled={busy || !f.name.trim()} onClick={create}>
          {busy ? t('Creating …') : t('Create invitation')}
        </button>
      </div>
    </Sheet>
  );
}

function LinkSheet({ item, onClose }: { item: { name: string; url: string; expires_at: string } | null; onClose: () => void }) {
  const [svg, setSvg] = useState('');
  const toast = useToast();
  useEffect(() => {
    setSvg('');
    if (item?.url) QRCode.toString(item.url, { type: 'svg', margin: 1, color: { dark: '#17181a', light: '#ffffff' } }).then(setSvg);
  }, [item?.url]);
  if (!item) return null;
  const share = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <Sheet open onClose={onClose} title={t('Invitation for {name}', { name: item.name })}>
      <div className="stack" style={{ alignItems: 'stretch' }}>
        <div className="data-qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="small muted mono" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{item.url}</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn grow" onClick={() => navigator.clipboard.writeText(item.url).then(() => toast({ text: t('Link copied') }))}>
            <Copy size={16} /> {t('Copy link')}
          </button>
          {share && (
            <button
              className="btn primary grow"
              onClick={() => navigator.share({ title: t('Invitation'), text: t('Join our household app – set your own password here:'), url: item.url }).catch(() => {})}
            >
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

function AddWithPassword() {
  const [nu, setNu] = useState({ name: '', password: '', role: 'member', color: COLORS[1] });
  const toast = useToast();
  return (
    <details className="card pad data-details">
      <summary>
        <div>
          <b>{t('Add with a password instead')}</b>
          <div className="small muted">{t('e.g. for a shared kitchen tablet')}</div>
        </div>
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="grid-2">
          <input className="input" placeholder={t('Name')} value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
          <input className="input" placeholder={t('Password (at least 8 characters)')} type="password" autoComplete="new-password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
        </div>
        <div className="row between wrap" style={{ gap: 10 }}>
          <Seg value={nu.role} onChange={(v) => setNu({ ...nu, role: v })} options={[['member', t('Member')], ['admin', t('Admin')]]} />
          <button
            className="btn"
            disabled={!nu.name || nu.password.length < 8}
            onClick={() =>
              post('/users', nu)
                .then(() => {
                  setNu({ ...nu, name: '', password: '' });
                  invalidate('users', 'users-public');
                  toast({ text: t('Saved') });
                })
                .catch((e) => toast({ text: e.message, error: true }))
            }
          >
            {t('Create')}
          </button>
        </div>
      </div>
    </details>
  );
}

// ================================================================== backups

interface BackupItem {
  name: string;
  kind: 'nightly' | 'manual' | 'pre-restore';
  day: string;
  size: number;
  created_at: string;
}
interface BackupStatus {
  items: BackupItem[];
  total_size: number;
  last: BackupItem | null;
  schedule: { hour: number; keep: { daily: number; weekly: number; manual: number; preRestore: number } };
  webdav: { url: string; user: string; password: string };
  offsite_last: { at: string; ok: boolean; error?: string; remote?: string } | null;
  restore_pending: boolean;
  last_restore: { source?: string; by?: string; applied_at?: string } | null;
}

const KIND_LABEL: Record<BackupItem['kind'], string> = {
  nightly: 'nightly',
  manual: 'by hand',
  'pre-restore': 'before a restore',
};

export function Backups({ admin }: { admin: boolean }) {
  const st = useApi<BackupStatus>('backups', admin ? '/backups' : null);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<{ kind: 'file'; file: File } | { kind: 'backup'; item: BackupItem } | null>(null);
  const [restarting, setRestarting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  if (!admin) return null;
  if (st.isLoading) return <Skeleton n={3} />;
  if (st.error || !st.data) return <div className="card pad small" style={{ color: 'var(--empty)' }}>{(st.error as Error)?.message ?? t('Error')}</div>;
  const s = st.data;
  const items = all ? s.items : s.items.slice(0, 5);
  const fresh = s.last && Date.now() - new Date(s.last.created_at).getTime() < 36 * 3600_000;

  const backupNow = async () => {
    setBusy(true);
    try {
      const r = await post('/backups');
      invalidate('backups');
      if (r.offsite && !r.offsite.ok) toast({ text: t('Backed up here, but the off-site copy failed: {error}', { error: r.offsite.error }), error: true });
      else toast({ text: r.offsite?.ok ? t('Backed up – also copied off-site') : t('Backed up') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    if (!confirmRestore) return;
    setBusy(true);
    try {
      if (confirmRestore.kind === 'file') {
        const fd = new FormData();
        fd.append('file', confirmRestore.file);
        await api('/restore', { form: fd });
      } else {
        await post(`/backups/${encodeURIComponent(confirmRestore.item.name)}/restore`, { confirm: true });
      }
      setConfirmRestore(null);
      setRestarting(true);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card pad stack">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className={`thumb data-status ${fresh ? 'ok' : 'warn'}`} style={{ width: 44, height: 44 }}>
            {fresh ? <CheckCircle size={22} weight="fill" /> : <Warning size={22} weight="fill" />}
          </span>
          <div className="grow">
            <b>{s.last ? t('Last backup: {when}', { when: fmtWhen(s.last.created_at) }) : t('No backup yet')}</b>
            <div className="small muted">
              {t('Automatically every night at {hour}:00. Keeps the last {daily} days and {weekly} weeks.', { hour: s.schedule.hour, daily: s.schedule.keep.daily, weekly: s.schedule.keep.weekly })}
            </div>
            {s.webdav.url && s.offsite_last && (
              <div className="small" style={{ color: s.offsite_last.ok ? 'var(--accent-ink)' : 'var(--empty)', marginTop: 4 }}>
                {s.offsite_last.ok
                  ? t('Off-site copy: {when}', { when: fmtWhen(s.offsite_last.at) })
                  : t('Off-site copy failed {when}: {error}', { when: fmtWhen(s.offsite_last.at), error: s.offsite_last.error ?? '' })}
              </div>
            )}
          </div>
        </div>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={backupNow}>
          <Database size={16} /> {busy ? t('Backing up …') : t('Back up now')}
        </button>
      </div>

      {s.last_restore?.applied_at && (
        <div className="card pad small muted">
          {t('Restored on {when} from “{source}”. The database it replaced is kept in the backups folder.', { when: fmtWhen(s.last_restore.applied_at), source: s.last_restore.source ?? '?' })}
        </div>
      )}

      <section>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{t('Backups')}</h2>
          {s.items.length > 0 && <span className="small muted">{t('{n} backups · {size}', { n: s.items.length, size: fmtSize(s.total_size) })}</span>}
        </div>
        <div className="list">
          {items.map((b) => (
            <div key={b.name} className="li">
              <div className="grow">
                <div className="title">{fmtWhen(b.created_at)}</div>
                <div className="sub">{t(KIND_LABEL[b.kind])} · {fmtSize(b.size)}</div>
              </div>
              <a className="icon-btn" href={`/api/backups/${encodeURIComponent(b.name)}/download`} download aria-label={t('Download')} title={t('Download')}>
                <DownloadSimple size={18} />
              </a>
              <button className="icon-btn" onClick={() => setConfirmRestore({ kind: 'backup', item: b })} aria-label={t('Restore')} title={t('Restore')}>
                <ArrowCounterClockwise size={18} />
              </button>
            </div>
          ))}
          {s.items.length === 0 && <div className="li muted small">{t('The first backup is made tonight – or right now with “Back up now”.')}</div>}
        </div>
        {s.items.length > 5 && (
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>
            {all ? t('Show fewer') : t('Show all {n}', { n: s.items.length })}
          </button>
        )}
      </section>

      <div className="card pad stack">
        <b>{t('Restore from a file')}</b>
        <div className="small muted">{t('A backup file (.db) from here or another ToHuus Hub, or an export (.json). Everything currently stored is replaced – a safety backup is made first.')}</div>
        <input
          ref={fileRef}
          type="file"
          accept=".db,.sqlite,.sqlite3,.json,application/json,application/octet-stream"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setConfirmRestore({ kind: 'file', file: f });
          }}
        />
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => fileRef.current?.click()}>
          <UploadSimple size={16} /> {t('Choose file')}
        </button>
      </div>

      <Offsite initial={s.webdav} />

      <Sheet open={Boolean(confirmRestore)} onClose={() => !busy && setConfirmRestore(null)} title={t('Restore this backup?')}>
        {confirmRestore && (
          <div className="stack">
            <div className="card pad stack data-warn">
              <b>{confirmRestore.kind === 'file' ? confirmRestore.file.name : fmtWhen(confirmRestore.item.created_at)}</b>
              <div className="small">
                {t('Everything stored right now is replaced by this backup. Changes since then are lost – a safety backup of the current state is made first, so you can go back.')}
              </div>
            </div>
            <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>{t('The file is checked.')}</li>
              <li>{t('ToHuus Hub restarts and swaps the database (a few seconds).')}</li>
              <li>{t('The page reloads by itself. You may need to sign in again.')}</li>
            </ol>
            <button className="btn danger lg" disabled={busy} onClick={doRestore}>
              <ArrowCounterClockwise size={18} /> {busy ? t('Checking …') : t('Replace and restart')}
            </button>
          </div>
        )}
      </Sheet>
      {restarting && <Restarting />}
    </div>
  );
}

function Restarting() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let down = false;
    let stop = false;
    const started = Date.now();
    const poll = async () => {
      if (stop) return;
      try {
        const r = await fetch('/health', { cache: 'no-store' });
        if (r.ok && (down || Date.now() - started > 6000)) {
          location.href = '/';
          return;
        }
        if (!r.ok) down = true;
      } catch {
        down = true;
      }
      if (Date.now() - started > 45_000) setSlow(true);
      setTimeout(poll, 1500);
    };
    setTimeout(poll, 1500);
    return () => {
      stop = true;
    };
  }, []);
  return (
    <div className="overlay data-restart" role="alertdialog" aria-live="polite">
      <div className="card pad stack" style={{ maxWidth: 360, textAlign: 'center', alignItems: 'center' }}>
        <div className="data-spinner" aria-hidden />
        <b>{t('Restoring …')}</b>
        <div className="small muted">{t('ToHuus Hub is restarting with the backup. This page reloads by itself.')}</div>
        {slow && <div className="small" style={{ color: 'var(--low)' }}>{t('Taking longer than usual. If nothing happens, restart the container (e.g. “docker compose restart”).')}</div>}
      </div>
    </div>
  );
}

function Offsite({ initial }: { initial: BackupStatus['webdav'] }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => setF(initial), [initial.url, initial.user, initial.password]);
  const save = async (test: boolean) => {
    setBusy(true);
    try {
      await put('/backups/webdav', f);
      invalidate('backups');
      if (test && f.url) {
        const r = await post('/backups/webdav/test');
        toast(r.ok ? { text: t('Connection works') } : { text: r.error, error: true });
      } else toast({ text: t('Saved') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="card pad data-details" open={Boolean(initial.url)}>
      <summary>
        <CloudArrowUp size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        <b>{t('Off-site copy (optional)')}</b>
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <div className="small muted">
          {t('If the server breaks, backups on the same disk break with it. ToHuus Hub can put a copy into a WebDAV folder every night, e.g. Nextcloud. One file per weekday – the folder always holds the last seven nights.')}
        </div>
        <div className="field">
          <label htmlFor="dav-url">{t('WebDAV folder address')}</label>
          <input id="dav-url" className="input mono" inputMode="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://cloud.example.de/remote.php/dav/files/till/Backups" />
          <div className="help">{t('Nextcloud: Files › Settings (bottom left) › WebDAV, then add the folder name.')}</div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="dav-user">{t('User')}</label>
            <input id="dav-user" className="input" autoComplete="off" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="dav-pw">{t('App password')}</label>
            <input id="dav-pw" className="input mono" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </div>
        </div>
        <div className="help">{t('Use an app password (Nextcloud: Settings › Security), not your main password.')}</div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" disabled={busy} onClick={() => save(false)}>{t('Save')}</button>
          <button className="btn primary" disabled={busy || !f.url} onClick={() => save(true)}>{t('Save & test')}</button>
          {initial.url && (
            <button className="btn ghost" disabled={busy} onClick={() => { setF({ url: '', user: '', password: '' }); put('/backups/webdav', { url: '', user: '', password: '' }).then(() => invalidate('backups')); }}>
              {t('Turn off')}
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
