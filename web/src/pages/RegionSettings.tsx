/**
 * Settings › Household › Region: where the household shops. Decides currency, number format, units,
 * first day of the week, Open Food Facts country, store-mode presets and which receipts are read.
 * Separate from the UI language.
 */
import { Globe, Storefront } from '@phosphor-icons/react';
import { useState } from 'react';
import { patch, post, qc, useApi } from '../api';
import { t } from '../i18n';
import { money, setRegion } from '../region';
import { Seg, Skeleton, useToast } from '../ui';

interface RegionOption {
  code: string;
  name: string;
  currency: string;
  locale: string;
  units: 'metric' | 'us';
  week_start_day: 0 | 1;
  typical_stores: string[];
  receipts: string | null;
}
interface RegionResp {
  code: string;
  name: string;
  currency: string;
  currency_symbol: string;
  locale: string;
  units: 'metric' | 'us';
  week_start_day: 0 | 1;
  typical_stores: string[];
  receipt_grammar: string | null;
  customised: boolean;
  options: { regions: RegionOption[]; currencies: string[]; locales: string[] };
}

// country names are translated in the UI (the server sends English names)
const countryName = (name: string) => t(name);

const RECEIPTS: Record<string, string> = {
  de: 'German till receipts and REWE documents',
  uk: 'UK till receipts (Clubcard, Nectar, multibuy savings)',
  us: 'US till receipts (sales tax, coupons, bottle deposits, lb weights)',
  se: 'Swedish till receipts (moms, pant, Stammis and member prices)',
};

function sample(locale: string, currency: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(1234.5);
  } catch {
    return `1234.50 ${currency}`;
  }
}

export function RegionCard({ admin }: { admin: boolean }) {
  const q = useApi<RegionResp>(['settings', 'region'], '/region');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  if (q.isLoading) return <Skeleton h={120} n={1} />;
  if (q.error || !q.data) {
    return (
      <div className="card pad small muted">
        {t('Region settings could not be loaded.')}{' '}
        <button className="linkish" onClick={() => q.refetch()}>{t('Try again')}</button>
      </div>
    );
  }
  const r = q.data;

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await patch<RegionResp & { stores_added?: string[] }>('/region', body);
      setRegion(res);
      // amounts, dates and units are formatted on render – refetch so every page picks the new region up
      qc.invalidateQueries();
      toast({
        text: res.stores_added?.length
          ? t('Region saved. Added to store mode: {stores}', { stores: res.stores_added.join(', ') })
          : t('Region saved'),
      });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const addStores = async () => {
    setBusy(true);
    try {
      const res = await post<{ added: string[] }>('/region/stores');
      qc.invalidateQueries({ queryKey: ['shopping'] });
      toast({ text: res.added.length ? t('Added to store mode: {stores}', { stores: res.added.join(', ') }) : t('All typical stores are already there') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card pad stack rg-card">
      <div className="field">
        <label htmlFor="rg-country">{t('Region')}</label>
        <div className="rg-select">
          <Globe size={18} aria-hidden />
          <select id="rg-country" className="input" value={r.code} disabled={!admin || busy} onChange={(e) => save({ code: e.target.value })}>
            {r.options.regions.map((o) => (
              <option key={o.code} value={o.code}>{countryName(o.name)}</option>
            ))}
          </select>
        </div>
        <div className="help">{t('Where you shop – separate from the app language. Sets currency, number format, units and which receipts are read.')}</div>
      </div>

      <dl className="rg-facts small">
        <div><dt>{t('Prices')}</dt><dd className="num">{sample(r.locale, r.currency)}</dd></div>
        <div><dt>{t('Units')}</dt><dd>{r.units === 'us' ? t('US customary (oz, lb, cups)') : t('Metric (g, kg, ml)')}</dd></div>
        <div><dt>{t('Week starts')}</dt><dd>{r.week_start_day === 0 ? t('Sunday') : t('Monday')}</dd></div>
        <div><dt>{t('Receipts')}</dt><dd>{r.receipt_grammar ? t(RECEIPTS[r.receipt_grammar]) : t('Photos and PDFs via the vision model')}</dd></div>
      </dl>

      {admin && (
        <button className="linkish small" style={{ alignSelf: 'flex-start' }} onClick={() => setMore((v) => !v)} aria-expanded={more}>
          {more ? t('Hide details') : r.customised ? t('Adjusted – show details') : t('Adjust currency, format and units')}
        </button>
      )}

      {admin && more && (
        <div className="stack rg-more">
          <div className="field">
            <label htmlFor="rg-currency">{t('Currency')}</label>
            <select id="rg-currency" className="input" value={r.currency} disabled={busy} onChange={(e) => save({ currency: e.target.value })}>
              {Array.from(new Set([r.currency, ...r.options.currencies])).map((c) => (
                <option key={c} value={c}>{c} · {money(3.49, { currency: c })}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rg-locale">{t('Number and date format')}</label>
            <select id="rg-locale" className="input" value={r.locale} disabled={busy} onChange={(e) => save({ locale: e.target.value })}>
              {Array.from(new Set([r.locale, ...r.options.locales])).map((l) => (
                <option key={l} value={l}>{sample(l, r.currency)} · {new Date(2026, 9, 31).toLocaleDateString(l)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('Units in recipes')}</label>
            <Seg value={r.units} onChange={(v) => save({ units: v })} options={[['metric', t('Metric')], ['us', t('US customary')]]} />
            <div className="help">{t('Only changes how amounts are shown. Saved recipes stay as they are.')}</div>
          </div>
          <div className="field">
            <label>{t('First day of the week')}</label>
            <Seg value={String(r.week_start_day) as '0' | '1'} onChange={(v) => save({ weekStart: Number(v) })} options={[['1', t('Monday')], ['0', t('Sunday')]]} />
          </div>
        </div>
      )}

      {admin && r.typical_stores.length > 0 && (
        <div className="rg-stores">
          <div className="small muted">{t('Typical stores here: {stores}', { stores: r.typical_stores.join(', ') })}</div>
          <button className="btn sm" disabled={busy} onClick={addStores}>
            <Storefront size={16} /> {t('Add to store mode')}
          </button>
        </div>
      )}
    </div>
  );
}
