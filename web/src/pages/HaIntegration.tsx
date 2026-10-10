/** Settings › Access & AI: Home Assistant – the HACS integration first, the YAML package as fallback. */
import { ArrowSquareOut, Copy, House } from '@phosphor-icons/react';
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

/** Explains the recommended way: install the ToHuus Hub integration via HACS and paste address + token. */
export function HaIntegrationCard({ base }: { base: string }) {
  const copy = useCopy();
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
        <li>{t('Create a “Home Assistant” access below and copy the token.')}</li>
        <li>{t('In Home Assistant: Settings › Devices & services › Add integration › ToHuus Hub. Enter this ToHuus Hub address and the token.')}</li>
      </ol>
      <div className="field">
        <label>{t('Integration repository (HACS)')}</label>
        <div className="row">
          <input className="input mono" readOnly value={HA_REPO} aria-label={t('Integration repository (HACS)')} />
          <button className="icon-btn" onClick={() => copy(HA_REPO)} aria-label={t('Copy')}><Copy size={16} /></button>
        </div>
      </div>
      <div className="field">
        <label>{t('Address of this ToHuus Hub')}</label>
        <div className="row">
          <input className="input mono" readOnly value={base} aria-label={t('Address of this ToHuus Hub')} />
          <button className="icon-btn" onClick={() => copy(base)} aria-label={t('Copy')}><Copy size={16} /></button>
        </div>
        <div className="help">{t('Use the address Home Assistant can reach. Inside Docker, “localhost” means the container itself.')}</div>
      </div>
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
              <div className="help">{t('Adjust the webhook ID and notify service in the YAML, and enter the same webhook URL under “Notifications”.')}</div>
            </>
          ) : (
            <div className="small muted">{t('Loading…')}</div>
          )}
        </div>
      </details>
    </>
  );
}
