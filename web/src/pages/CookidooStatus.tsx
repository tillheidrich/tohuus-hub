/** Settings › Access & AI › Cookidoo: which way the Cookidoo week arrives, and when it last did. */
import { CheckCircle, Info } from '@phosphor-icons/react';
import { relTime, useApi } from '../api';
import { t } from '../i18n';

interface Status {
  push: { at: string; by?: string; events: number; added: number; updated: number; removed: number } | null;
  pull: boolean;
  calendar: string;
}

export function CookidooWays() {
  const s = useApi<Status>(['settings', 'cookidoo'], '/cook2/cookidoo/status');
  const push = s.data?.push;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="cdo-way">
        <span className="cdo-n">1</span>
        <div className="grow">
          <b>{t('Recommended: the ToHuus Hub integration in Home Assistant')}</b>
          <div className="small muted">
            {t('With the HACS integration set up, Home Assistant sends the Cookidoo week by itself – every three hours and whenever it changes. Nothing to enter here. Options in Home Assistant: “Send the Cookidoo week to ToHuus Hub” and the calendar.')}
          </div>
          {push ? (
            <div className="small cdo-ok">
              <CheckCircle size={14} weight="fill" />{' '}
              {t('Last received {when}: {events} dishes, {added} new, {removed} removed', { when: relTime(push.at.replace('T', ' ').slice(0, 19)), events: push.events, added: push.added, removed: push.removed })}
            </div>
          ) : (
            !s.isLoading && (
              <div className="small muted cdo-wait">
                <Info size={14} /> {t('Nothing received from Home Assistant yet.')}
              </div>
            )
          )}
        </div>
      </div>
      <div className="cdo-way">
        <span className="cdo-n">2</span>
        <div className="grow">
          <b>{t('Alternative: ToHuus Hub fetches it with a Home Assistant token')}</b>
          <div className="small muted">{t('Without the integration: enter your Home Assistant address and a long-lived token below.')}</div>
        </div>
      </div>
    </div>
  );
}
