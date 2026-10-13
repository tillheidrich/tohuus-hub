/**
 * Retail: receipt inbox (status card on Imports, settings card under Access & AI), the best-before /
 * use-by choice in the product form, and the estimated value line in the monthly waste card.
 */
import { ArrowClockwise, CheckCircle, Copy, EnvelopeSimple, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { type DateKind, fmtDate, invalidate, post, put, relTime, useApi } from '../api';
import { num, t } from '../i18n';
import { money } from '../region';
import { Seg, Skeleton, Toggle, useDebounced, useToast } from '../ui';

interface InboxStatus {
  at: string;
  ok: boolean;
  message: string;
  checked: number;
  imported: number;
  imports: number[];
}
interface InboxSettings {
  enabled: boolean;
  host: string;
  port: number;
  tls: boolean;
  user: string;
  folder: string;
  allowFrom: string[];
  moveTo: string | null;
  has_password: boolean;
  configured: boolean;
}
interface InboxInfo {
  /** false in ToHuus Cloud (no mailbox polling there) */
  available?: boolean;
  configured: boolean;
  enabled: boolean;
  forward_to: string | null;
  folder: string;
  status: InboxStatus | null;
  settings: InboxSettings | null;
  recent: { message_id: string; subject: string | null; from_addr: string | null; created_at: string; result: { imports: { id: number; duplicate?: boolean }[]; note?: string } }[];
}

const INBOX_KEY = ['settings', 'retail-inbox'];

function useCheckNow() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const s = await post<InboxStatus>('/retail/inbox/check', {});
      toast({ text: s.message, error: !s.ok });
      invalidate('settings', 'imports', 'overview');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function StatusLine({ s }: { s: InboxStatus | null }) {
  if (!s) return <div className="small muted">{t('Not checked yet.')}</div>;
  return (
    <div className={`rt-status ${s.ok ? 'ok' : 'warn'}`} role="status">
      <span className="ic">{s.ok ? <CheckCircle size={18} weight="fill" /> : <WarningCircle size={18} weight="fill" />}</span>
      <div className="grow">
        <div className="small">{s.message}</div>
        <div className="small muted">{t('Last check {when}', { when: relTime(s.at) })}</div>
      </div>
    </div>
  );
}

/** Imports page: does the inbox work, where to send receipts, check now. */
export function InboxStatusCard({ admin }: { admin: boolean }) {
  const q = useApi<InboxInfo>(INBOX_KEY, '/retail/inbox');
  const check = useCheckNow();
  const toast = useToast();
  if (q.isLoading) return <Skeleton h={72} n={1} />;
  if (q.isError || !q.data || q.data.available === false) return null;
  const d = q.data;
  if (!d.configured) {
    if (!admin) return null;
    return (
      <div className="card pad rt-inbox">
        <div className="row">
          <span className="thumb" style={{ width: 40, height: 40 }}><EnvelopeSimple size={20} /></span>
          <div className="grow">
            <b>{t('Receipts by e-mail')}</b>
            <div className="small muted">{t('Connect a mailbox once – eBons and pickup notices then arrive here by themselves. Settings › Access & AI › Receipt inbox.')}</div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="card pad stack rt-inbox">
      <div className="row">
        <span className="thumb" style={{ width: 40, height: 40 }}><EnvelopeSimple size={20} /></span>
        <div className="grow">
          <b>{t('Receipt inbox')}</b>
          <div className="small muted">{d.enabled ? t('Checked every 10 minutes.') : t('Switched off – only “Check now” reads it.')}</div>
        </div>
        <button className="btn sm" disabled={check.busy} onClick={check.run}>
          <ArrowClockwise size={15} /> {check.busy ? t('Checking …') : t('Check now')}
        </button>
      </div>
      <StatusLine s={d.status} />
      {d.forward_to && (
        <div className="rt-forward">
          <div className="small">{t('Forward receipts to:')}</div>
          <div className="row" style={{ gap: 6 }}>
            <code className="mono rt-addr">{d.forward_to}</code>
            <button
              className="icon-btn plain"
              aria-label={t('Copy address')}
              onClick={() => navigator.clipboard.writeText(d.forward_to!).then(() => toast({ text: t('Copied') }))}
            >
              <Copy size={16} />
            </button>
          </div>
          <div className="help">{t('Tip: in the REWE, Lidl Plus or dm app you can have the eBon sent by e-mail. Use this address, or forward the mail – PDF attachments and receipt mails both work.')}</div>
        </div>
      )}
    </div>
  );
}

const PRESETS: [string, string][] = [
  ['GMX', 'imap.gmx.net'],
  ['web.de', 'imap.web.de'],
  ['Gmail', 'imap.gmail.com'],
  ['Outlook', 'outlook.office365.com'],
  ['mailbox.org', 'imap.mailbox.org'],
  ['Posteo', 'posteo.de'],
];

/** Settings › Access & AI (admins). */
export function InboxSettingsCard() {
  const q = useApi<InboxInfo>(INBOX_KEY, '/retail/inbox');
  const toast = useToast();
  const check = useCheckNow();
  const [f, setF] = useState({ enabled: false, host: '', port: '993', tls: true, user: '', password: '', folder: 'INBOX', allowFrom: '', moveTo: '' });
  const [busy, setBusy] = useState(false);
  const s = q.data?.settings;
  useEffect(() => {
    if (!s) return;
    setF({ enabled: s.enabled, host: s.host, port: String(s.port), tls: s.tls, user: s.user, password: '', folder: s.folder, allowFrom: s.allowFrom.join(', '), moveTo: s.moveTo ?? '' });
  }, [s?.host, s?.user, s?.folder, s?.enabled, s?.port, s?.tls, s?.moveTo, s?.allowFrom.join(',')]);
  if (q.isLoading) return <Skeleton h={120} n={1} />;
  if (q.isError) return <div className="card pad small muted">{t('The inbox settings could not be loaded.')}</div>;
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const save = async (thenCheck: boolean) => {
    setBusy(true);
    try {
      await put('/retail/inbox', {
        enabled: f.enabled,
        host: f.host.trim(),
        port: Number(f.port) || 993,
        tls: f.tls,
        user: f.user.trim(),
        ...(f.password ? { password: f.password } : {}),
        folder: f.folder.trim() || 'INBOX',
        allowFrom: f.allowFrom.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean),
        moveTo: f.moveTo.trim() || null,
      });
      setF((x) => ({ ...x, password: '' }));
      invalidate('settings');
      if (thenCheck) await check.run();
      else toast({ text: t('Saved') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const complete = Boolean(f.host.trim() && f.user.trim() && (f.password || s?.has_password));
  if (q.data?.available === false) return null;
  return (
    <div className="card pad stack rt-settings">
      <div className="row">
        <span className="thumb" style={{ width: 44, height: 44 }}><EnvelopeSimple size={22} /></span>
        <div className="grow">
          <b>{t('Receipt inbox (e-mail)')}</b>
          <div className="small muted">{t('ToHuus Hub reads a mailbox or folder every 10 minutes and turns PDF receipts and receipt mails into imports for review. Mails are never deleted.')}</div>
        </div>
      </div>
      <Toggle on={f.enabled} onChange={(v) => set('enabled', v)} label={t('Check automatically every 10 minutes')} />
      <div className="field">
        <label>{t('Mail server (IMAP)')}</label>
        <input className="input" value={f.host} onChange={(e) => set('host', e.target.value)} placeholder="imap.example.org" inputMode="url" autoCapitalize="off" spellCheck={false} />
        <div className="chips" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
          {PRESETS.map(([label, host]) => (
            <button key={host} type="button" className={`chip ${f.host === host ? 'on' : ''}`} onClick={() => setF((x) => ({ ...x, host, port: '993', tls: true }))}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>{t('Port')}</label>
          <input className="input" value={f.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
        </div>
        <div className="field">
          <label>{t('Encryption')}</label>
          <Toggle on={f.tls} onChange={(v) => set('tls', v)} label={t('TLS (recommended)')} />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>{t('User name / e-mail address')}</label>
          <input className="input" value={f.user} onChange={(e) => set('user', e.target.value)} autoCapitalize="off" autoComplete="off" spellCheck={false} />
        </div>
        <div className="field">
          <label>{t('Password')}</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={f.password}
            onChange={(e) => set('password', e.target.value)}
            placeholder={s?.has_password ? t('saved – leave empty to keep') : t('app password recommended')}
          />
        </div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label>{t('Folder')}</label>
          <input className="input" value={f.folder} onChange={(e) => set('folder', e.target.value)} placeholder="INBOX" />
          <div className="help">{t('A filter rule in your mail program can sort receipts into their own folder, e.g. “ToHuus”.')}</div>
        </div>
        <div className="field">
          <label>{t('Afterwards move to (optional)')}</label>
          <input className="input" value={f.moveTo} onChange={(e) => set('moveTo', e.target.value)} placeholder={t('e.g. ToHuus/Done')} />
        </div>
      </div>
      <div className="field">
        <label>{t('Only from these senders (optional)')}</label>
        <input className="input" value={f.allowFrom} onChange={(e) => set('allowFrom', e.target.value)} placeholder="rewe.de, lidl.de, dm.de" autoCapitalize="off" spellCheck={false} />
        <div className="help">{t('Addresses or domains, separated by commas. If you forward receipts yourself, add your own address too.')}</div>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn" disabled={busy} onClick={() => save(false)}>{t('Save')}</button>
        <button className="btn primary" disabled={busy || check.busy || !complete} onClick={() => save(true)}>
          {check.busy ? t('Checking …') : t('Save & check now')}
        </button>
      </div>
      <StatusLine s={q.data?.status ?? null} />
      {(q.data?.recent.length ?? 0) > 0 && (
        <div className="list rt-recent">
          {q.data!.recent.map((m) => (
            <div key={m.message_id} className="li">
              <div className="grow">
                <div className="title">{m.subject || t('(no subject)')}</div>
                <div className="sub">
                  {[m.from_addr, fmtDate(m.created_at)].filter(Boolean).join(' · ')} ·{' '}
                  {m.result.imports.length
                    ? m.result.imports.some((i) => !i.duplicate)
                      ? t('imported')
                      : t('already imported')
                    : m.result.note ?? t('nothing found')}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ product form: best-before vs use-by

export function DateKindField({ value, onChange, name }: { value: DateKind | null; onChange: (v: DateKind | null) => void; name: string }) {
  const dn = useDebounced(name.trim(), 400);
  const auto = useApi<{ kind: DateKind }>(['retail-date-kind', dn], dn ? `/retail/date-kind?name=${encodeURIComponent(dn)}` : null);
  const autoLabel = auto.data?.kind === 'use_by' ? t('use-by') : t('best-before');
  return (
    <div className="field">
      <label>{t('Date on the pack')}</label>
      <Seg
        value={value ?? 'auto'}
        onChange={(v) => onChange(v === 'auto' ? null : (v as DateKind))}
        options={[
          ['auto', t('Automatic')],
          ['best_before', t('Best before')],
          ['use_by', t('Use by')],
        ]}
      />
      <div className="help">
        {value === null && dn ? t('Automatic: {kind}.', { kind: autoLabel }) + ' ' : ''}
        {(value ?? auto.data?.kind) === 'use_by'
          ? t('Use by (minced meat, fresh fish, poultry, raw milk): after the date, don’t eat it anymore.')
          : t('Best before: after the date it is usually still fine – look, smell, taste.')}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ waste card: estimated value

export function WasteValueLine({ month }: { month: string }) {
  const q = useApi<{ value: number; rounded: number; priced: number; unpriced: number }>(['fresh', 'waste-value', month], `/retail/waste-value?month=${month}`);
  if (!q.data || q.data.priced === 0) return null;
  const monthName = fmtDate(month + '-15', { month: 'long' });
  const v = q.data.value;
  return (
    <p className="small rt-waste-value">
      {v < 1
        ? t('Worth less than {amount} in {month}.', { amount: money(1, { digits: 0 }), month: monthName })
        : t('Roughly {value} in {month}.', { value: v < 10 ? money(v) : money(q.data.rounded, { digits: 0 }), month: monthName })}{' '}
      <span className="muted">
        {q.data.unpriced > 0 ? t('Estimated from receipt prices; {n} item(s) without a known price.', { n: q.data.unpriced }) : t('Estimated from receipt prices.')}
      </span>
    </p>
  );
}
