/**
 * "Bons per E-Mail" in ToHuus Cloud (docs/mail-inbox.md): the household's own receipt address with copy button,
 * how to forward by sender, the counters (never contents) and – for admins – a new address.
 * Invisible until the cloud has a receipt domain (MAIL_INBOUND_DOMAIN).
 */
import { ArrowsClockwise, Copy, EnvelopeSimple } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { invalidate, post, useApi } from '../api';
import { t } from '../i18n';
import { useToast } from '../ui';

interface MailAddress {
  available: boolean;
  allowed?: boolean;
  address?: string;
  stats?: { days: number; received: number; imported: number; ignored: Record<string, number> };
}

export function MailAddressCard({ admin }: { admin: boolean }) {
  const q = useApi<MailAddress>(['settings', 'mail-address'], '/mail/address');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const d = q.data;
  if (!d?.available) return null;
  if (!d.allowed)
    return (
      <div className="card pad row" style={{ gap: 12 }}>
        <span className="thumb" style={{ width: 40, height: 40 }}><EnvelopeSimple size={20} /></span>
        <div className="grow">
          <b>{t('Receipts by e-mail')}</b>
          <div className="small muted">{t('With Plus your household gets its own address: forward receipts, order and pickup confirmations, and ToHuus books them.')}</div>
        </div>
        <Link className="btn sm" to="/einstellungen?tab=plan">{t('See plans')}</Link>
      </div>
    );
  const copy = () => navigator.clipboard?.writeText(d.address!).then(() => toast({ text: t('Copied') }));
  const rotate = async () => {
    if (!confirm(t('Create a new address? The old one stops working at once – update your forwarding rules.'))) return;
    setBusy(true);
    try {
      await post('/mail/address/rotate', {});
      invalidate('settings');
      await q.refetch();
      toast({ text: t('New address created') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const s = d.stats;
  const ignored = s ? Object.values(s.ignored).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 12 }}>
        <span className="thumb" style={{ width: 40, height: 40 }}><EnvelopeSimple size={20} /></span>
        <div className="grow">
          <b>{t('Receipts by e-mail')}</b>
          <div className="small muted">{t('Forward receipts, order and pickup confirmations to this address. Everything else is discarded at once, without being stored.')}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <code className="grow" style={{ wordBreak: 'break-all', fontSize: 15 }}>{d.address}</code>
        <button className="btn sm" onClick={copy}><Copy size={16} /> {t('Copy')}</button>
      </div>
      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>{t('Forward automatically, only from shops')}</summary>
        <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          <li>{t('Gmail: Settings › Filters › “From” e.g. rewe.de OR lidl.de › Forward to this address (confirm the address once).')}</li>
          <li>{t('Outlook: Settings › Rules › “From” contains the shop › Forward to this address.')}</li>
          <li>{t('iCloud Mail (web): Settings › Rules › “From” contains the shop › Forward to this address.')}</li>
          <li>{t('Filter by sender, so one-time codes and other mails never leave your mailbox.')}</li>
        </ul>
      </details>
      {s && (
        <div className="small muted">
          {t('Last {days} days: {received} received, {imported} became receipts, {ignored} discarded', { days: s.days, received: s.received, imported: s.imported, ignored })}
        </div>
      )}
      {admin && (
        <div>
          <button className="btn sm ghost" disabled={busy} onClick={rotate}><ArrowsClockwise size={16} /> {t('New address')}</button>
        </div>
      )}
    </div>
  );
}
