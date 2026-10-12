/**
 * Settings › Benachrichtigungen, "Für mich" (list2, block D): one clear matrix – what reaches me on which of my
 * channels – plus quiet hours, "only when I'm home", what the lock screen may show and my shopping-trip privacy.
 * The household channels for self-hosters follow below in Settings (admin).
 */
import { Bell, DeviceMobile, EnvelopeSimple, House, Monitor } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { invalidate, put, useApi } from '../api';
import { t } from '../i18n';
import { TripPrivacyRow } from '../shop/together';
import { Seg, Skeleton, Toggle, useToast } from '../ui';
import './notify-mine.css';

interface Row {
  key: string;
  label: string;
  apns: boolean;
  push: boolean;
  digest: boolean;
  homeOnly: boolean;
}
interface Prefs {
  events: Row[];
  quiet: { from: string; to: string } | null;
  preview: 'full' | 'generic';
  channels: { apns: { configured: boolean; devices: number }; push: { devices: number }; digest: { email: boolean } };
  presence: boolean | null;
}

const COLS: { key: 'apns' | 'push' | 'digest'; label: string; icon: typeof Bell }[] = [
  { key: 'apns', label: 'iPhone', icon: DeviceMobile },
  { key: 'push', label: 'Browser', icon: Monitor },
  { key: 'digest', label: 'E-mail', icon: EnvelopeSimple },
];

export function NotifyMine() {
  const q = useApi<Prefs>(['settings', 'notify-mine'], '/notify/prefs');
  const [p, setP] = useState<Prefs | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (q.data) setP(q.data);
  }, [q.data]);
  if (q.error) return null; // shared device / account without a member row
  if (!p) return <Skeleton n={3} />;

  const save = async (body: Record<string, unknown>, next: Prefs) => {
    setP(next);
    try {
      await put('/notify/prefs', body);
      invalidate('settings');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      void q.refetch();
    }
  };
  const flip = (row: Row, col: 'apns' | 'push' | 'digest') => {
    const v = !row[col];
    void save({ events: { [row.key]: { [col]: v } } }, { ...p, events: p.events.map((r) => (r.key === row.key ? { ...r, [col]: v } : r)) });
  };
  const flipHome = (row: Row) => {
    const homeOnly = p.events.filter((r) => (r.key === row.key ? !r.homeOnly : r.homeOnly)).map((r) => r.key);
    void save({ homeOnly }, { ...p, events: p.events.map((r) => (r.key === row.key ? { ...r, homeOnly: !r.homeOnly } : r)) });
  };
  const hint = (c: 'apns' | 'push' | 'digest') =>
    c === 'apns'
      ? !p.channels.apns.configured
        ? t('not set up on this server')
        : p.channels.apns.devices
          ? null
          : t('open the iPhone app once')
      : c === 'push'
        ? p.channels.push.devices
          ? null
          : t('switch on below')
        : p.channels.digest.email
          ? t('summary once a day')
          : t('summary – needs a confirmed address');

  return (
    <section className="card pad stack notify-mine" aria-labelledby="nm-h">
      <div>
        <h2 id="nm-h" style={{ margin: 0 }}>
          {t('For me')}
        </h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {t('Only you decide what reaches you. Few things are on to start with.')}
        </p>
      </div>
      <div className="nm-grid" role="table" aria-label={t('What reaches me where')}>
        <div className="nm-row nm-head" role="row">
          <span role="columnheader" className="nm-ev" />
          {COLS.map((c) => (
            <span key={c.key} role="columnheader" className="nm-col">
              <c.icon size={18} aria-hidden />
              <span>{t(c.label)}</span>
              {hint(c.key) && <small>{hint(c.key)}</small>}
            </span>
          ))}
          <span role="columnheader" className="nm-col">
            <House size={18} aria-hidden />
            <span>{t('Only at home')}</span>
          </span>
        </div>
        {p.events.map((r) => (
          <div key={r.key} className="nm-row" role="row">
            <span role="rowheader" className="nm-ev">
              {r.label}
            </span>
            {COLS.map((c) => (
              <span key={c.key} role="cell" className="nm-cell">
                <button className={`nm-tog ${r[c.key] ? 'on' : ''}`} aria-pressed={r[c.key]} aria-label={`${r.label}: ${t(c.label)}`} onClick={() => flip(r, c.key)}>
                  <span aria-hidden />
                </button>
              </span>
            ))}
            <span role="cell" className="nm-cell">
              <button className={`nm-tog home ${r.homeOnly ? 'on' : ''}`} aria-pressed={r.homeOnly} aria-label={`${r.label}: ${t('Only at home')}`} onClick={() => flipHome(r)}>
                <span aria-hidden />
              </button>
            </span>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {t('“Only at home” needs the iPhone app or Home Assistant to know where you are; until then everything comes.')}
      </p>

      <div className="row between">
        <div>
          <b>{t('Quiet hours')}</b>
          <div className="small muted">{t('No phone or browser messages – the summary waits anyway.')}</div>
        </div>
        <Toggle on={Boolean(p.quiet)} onChange={(v) => save({ quiet: v ? { from: '22:00', to: '07:00' } : null }, { ...p, quiet: v ? { from: '22:00', to: '07:00' } : null })} label={t('Quiet hours')} />
      </div>
      {p.quiet && (
        <div className="row nm-quiet">
          <label className="field">
            <span className="eyebrow">{t('From')}</span>
            <input className="input" type="time" value={p.quiet.from} onChange={(e) => e.target.value && save({ quiet: { ...p.quiet!, from: e.target.value } }, { ...p, quiet: { ...p.quiet!, from: e.target.value } })} />
          </label>
          <label className="field">
            <span className="eyebrow">{t('Until')}</span>
            <input className="input" type="time" value={p.quiet.to} onChange={(e) => e.target.value && save({ quiet: { ...p.quiet!, to: e.target.value } }, { ...p, quiet: { ...p.quiet!, to: e.target.value } })} />
          </label>
        </div>
      )}
      <div className="field">
        <span className="eyebrow">{t('On the lock screen')}</span>
        <Seg<'full' | 'generic'>
          value={p.preview}
          onChange={(v) => save({ preview: v }, { ...p, preview: v })}
          options={[
            ['full', t('Show the text')],
            ['generic', t('Only “Something new”')],
          ]}
          label={t('On the lock screen')}
        />
      </div>
      <TripPrivacyRow />
    </section>
  );
}
