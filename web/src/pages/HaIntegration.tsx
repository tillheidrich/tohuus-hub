/** Settings › Connections & devices › AI: Home Assistant – the HACS integration first (paired by code), the YAML package as fallback. */
import { ArrowSquareOut, CheckCircle, Copy, House, Link } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { api, post } from '../api';
import { useInstance } from '../data';
import { useToast } from '../ui';
import { t } from '../i18n';

export const HA_REPO = 'https://github.com/tillheidrich/tohuus-hub-ha';

function useCopy() {
  const toast = useToast();
  return (v: string) =>
    navigator.clipboard
      .writeText(v)
      .then(() => toast({ text: t('Copied') }))
      .catch(() => toast({ text: t('Could not copy – select the text and copy it by hand.') }));
}

export { CLOUD_URL } from '../urls';

interface PairStart {
  code: string;
  expires_at: string;
}
interface PairStatus {
  state: 'none' | 'pending' | 'claimed';
  device?: string | null;
}

/**
 * "Connect Home Assistant": a short code (10 minutes, single use) that the integration exchanges for its own
 * access (POST /api/ha/pair/start → Home Assistant calls /api/ha/pair/claim). Polls the status to show the tick.
 */
export function HaPairBlock() {
  const toast = useToast();
  const [code, setCode] = useState<PairStart | null>(null);
  const [status, setStatus] = useState<PairStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!code || status?.state === 'claimed') return;
    const timer = setInterval(() => {
      setNow(Date.now());
      api<PairStatus>('/ha/pair/status')
        .then((s) => {
          setStatus(s);
          if (s.state === 'none') setCode(null);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [code, status?.state]);

  const start = () => {
    setBusy(true);
    setStatus(null);
    post<PairStart>('/ha/pair/start')
      .then((c) => {
        setCode(c);
        setNow(Date.now());
      })
      .catch((e: Error) => toast({ text: e.message }))
      .finally(() => setBusy(false));
  };

  if (status?.state === 'claimed')
    return (
      <div className="ha-pair ha-pair-done" role="status">
        <CheckCircle size={22} weight="fill" />
        <div className="grow">
          <b>{t('Home Assistant is connected')}</b>
          {status.device && <div className="small muted">{status.device}</div>}
        </div>
      </div>
    );

  const left = code ? Math.max(0, Math.round((Date.parse(code.expires_at) - now) / 1000)) : 0;
  if (code && left > 0)
    return (
      <div className="ha-pair" aria-live="polite">
        <div className="small muted">{t('Enter this code in Home Assistant when you add the ToHuus Hub integration:')}</div>
        <div className="ha-pair-code mono" aria-label={t('Code for Home Assistant')}>{code.code}</div>
        <div className="small muted">
          {t('Valid for {min}:{sec} more. Use it once; it gives Home Assistant its own access, which you can revoke under Settings › Connections & devices › AI assistants & access.', {
            min: String(Math.floor(left / 60)),
            sec: String(left % 60).padStart(2, '0'),
          })}
        </div>
        <button className="btn sm" onClick={start} disabled={busy}>{t('New code')}</button>
      </div>
    );

  return (
    <button className="btn primary ha-pair-start" onClick={start} disabled={busy}>
      <Link size={16} /> {t('Connect Home Assistant')}
    </button>
  );
}

/** Explains the recommended way: install the ToHuus Hub integration via HACS and connect it with a code. */
export function HaIntegrationCard({ base }: { base: string }) {
  const copy = useCopy();
  const inst = useInstance();
  const cloud = inst.data?.mode === 'cloud';
  return (
    <div className="card pad stack ha-card">
      <div className="row">
        <span className="thumb" style={{ width: 44, height: 44 }}><House size={22} /></span>
        <div className="grow">
          <b>Home Assistant</b>
          <div className="small muted">
            {t('The ToHuus Hub integration puts your shopping list, meal plan and care tasks into Home Assistant: a to-do list for Assist and voice, calendars, sensors for dashboards, actions and events for automations.')}
          </div>
        </div>
      </div>
      <div className="ha-recommended small">{t('Recommended')}</div>
      <ol className="small ha-steps">
        <li>{t('In Home Assistant open HACS › ⋮ › Custom repositories, add the address below as type “Integration”, then download “ToHuus Hub” and restart Home Assistant.')}</li>
        <li>{t('Tap “Connect Home Assistant” below. You get a short code.')}</li>
        <li>
          {cloud
            ? t('In Home Assistant: Settings › Devices & services › Add integration › ToHuus Hub › “ToHuus Cloud”, then enter the code.')
            : t('In Home Assistant: Settings › Devices & services › Add integration › ToHuus Hub › “Own server”, enter the address below and the code.')}
        </li>
      </ol>
      <HaPairBlock />
      <div className="small muted">{t('Home Assistant only connects out to ToHuus (HTTPS and live updates). Nothing in your home has to be reachable from the internet.')}</div>
      <div className="field">
        <label>{t('Integration repository (HACS)')}</label>
        <div className="row">
          <input className="input mono" readOnly value={HA_REPO} aria-label={t('Integration repository (HACS)')} />
          <button className="icon-btn" onClick={() => copy(HA_REPO)} aria-label={t('Copy')}><Copy size={16} /></button>
        </div>
      </div>
      {!cloud && <div className="field">
        <label>{t('Address of this ToHuus Hub')}</label>
        <div className="row">
          <input className="input mono" readOnly value={base} aria-label={t('Address of this ToHuus Hub')} />
          <button className="icon-btn" onClick={() => copy(base)} aria-label={t('Copy')}><Copy size={16} /></button>
        </div>
        <div className="help">{t('Use the address Home Assistant can reach. Inside Docker, “localhost” means the container itself.')}</div>
      </div>}
      <div className="small muted">
        {t('With the integration, leave “Shopping list in Home Assistant” below switched off – its to-do list talks to ToHuus Hub directly.')}
      </div>
      <a className="btn sm ha-link" href={HA_REPO} target="_blank" rel="noreferrer">
        <ArrowSquareOut size={14} /> {t('Entities, actions and ready-made dashboards')}
      </a>
    </div>
  );
}

/** Shown once after creating a "Home Assistant" access. */
export function HaCreated({ base, yaml }: { base: string; yaml: string }) {
  const copy = useCopy();
  return (
    <>
      <div className="field">
        <label>{t('Address for the integration')}</label>
        <div className="row">
          <input className="input mono" readOnly value={base} aria-label={t('Address for the integration')} />
          <button className="icon-btn" onClick={() => copy(base)} aria-label={t('Copy')}><Copy size={16} /></button>
        </div>
        <div className="help">{t('Paste address and token into Home Assistant › Add integration › ToHuus Hub.')}</div>
      </div>
      <details className="ha-fallback">
        <summary>{t('Without the integration: YAML package (fallback)')}</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <div className="small muted">
            {t('For setups without HACS: REST sensors, a rest_command and an actionable phone push. Save it as packages/tohuus.yaml in Home Assistant and restart.')}
          </div>
          {yaml ? (
            <>
              <div className="codebox">{yaml}</div>
              <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => copy(yaml)}><Copy size={14} /> {t('Copy YAML')}</button>
              <div className="help">{t('Adjust the webhook ID and notify service in the YAML, and enter the same webhook URL under “Notifications & calendar”.')}</div>
            </>
          ) : (
            <div className="small muted">{t('Loading…')}</div>
          )}
        </div>
      </details>
    </>
  );
}
