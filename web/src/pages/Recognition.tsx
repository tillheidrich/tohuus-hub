/**
 * Receipt recognition for the household (/import/quality): how well receipts are read, per store, and the
 * rules learned from corrections (edit / delete). Calm numbers – no scores, nothing per person. Area: quality.
 */
import { ArrowLeft, Receipt, Sparkle, Storefront, Trash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, fmtDate, invalidate, patch, useApi } from '../api';
import { t } from '../i18n';
import { Empty, ProductPicker, Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';
import { UNITS, unitLabel } from './QualityReport';

interface Stats {
  imports: number;
  lines: number;
  share: number | null;
  learned: number;
  corrected: number;
  unknown?: number;
  stores: { store: string | null; imports: number; lines: number; share: number | null; learned: number; corrected: number }[];
  recent: { id: number; shop: string | null; created_at: string; lines: number; share: number | null }[];
  rules: number;
}

interface Rule {
  id: number;
  kind: 'line' | 'store';
  store: string | null;
  example: string;
  product_id: number | null;
  product_name: string | null;
  qty_factor: number | null;
  unit: string | null;
  ignore: boolean;
  store_name: string | null;
  hits: number;
  updated_at: string;
  last_used_at: string | null;
}

const pct = (n: number | null) => (n == null ? '–' : `${Math.round(n * 100)} %`);

export function Recognition() {
  const nav = useNavigate();
  const stats = useApi<Stats>(['quality', 'stats'], '/quality/stats?limit=20');
  const rules = useApi<{ rules: Rule[] }>(['quality', 'rules'], '/quality/rules');
  const [edit, setEdit] = useState<Rule | null>(null);

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="icon-btn" onClick={() => nav('/import')} aria-label={t('Back')}>
          <ArrowLeft size={18} />
        </button>
      </div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Imports')}</div>
          <h1>{t('Receipt recognition')}</h1>
        </div>
      </header>

      {stats.isLoading ? (
        <Skeleton n={2} h={90} />
      ) : stats.isError ? (
        <div className="card pad small">
          {t('Could not load the numbers.')}{' '}
          <button className="linkish" onClick={() => stats.refetch()}>{t('Try again')}</button>
        </div>
      ) : !stats.data || stats.data.imports === 0 ? (
        <div className="card">
          <Empty icon={<Receipt size={26} />} title={t('No receipts yet')} action={{ label: t('Import a receipt'), onClick: () => nav('/import') }}>
            {t('Once a few receipts are in, you see here how many lines were recognised without anybody having to correct them.')}
          </Empty>
        </div>
      ) : (
        <>
          <div className="card pad stack q-overview">
            <div className="q-big">{pct(stats.data.share)}</div>
            <div className="small">
              {t('of the lines on the last {n} receipts were recognised without a correction.', { n: stats.data.imports })}
            </div>
            <div className="meter q-meter"><i style={{ width: pct(stats.data.share).replace(' ', ''), background: 'var(--accent)' }} /></div>
            <div className="small muted">
              {[
                stats.data.learned ? t('{n} lines came from rules you taught', { n: stats.data.learned }) : null,
                stats.data.corrected ? t('{n} lines were corrected', { n: stats.data.corrected }) : null,
                stats.data.unknown ? t('{n} lines were new or not recognised', { n: stats.data.unknown }) : null,
              ]
                .filter(Boolean)
                .join(' · ') || t('Nothing had to be corrected.')}
            </div>
            {stats.data.recent.length > 2 && (
              <div className="q-spark" aria-label={t('Recent receipts')}>
                {stats.data.recent.map((r) => (
                  <button
                    key={r.id}
                    className="q-spark-bar"
                    title={`${r.shop ?? t('Store unknown')} · ${fmtDate(r.created_at)} · ${pct(r.share)}`}
                    onClick={() => nav(`/import/${r.id}`)}
                    style={{ height: `${Math.max(8, Math.round((r.share ?? 0) * 100))}%` }}
                  />
                ))}
              </div>
            )}
          </div>

          <section className="section">
            <div className="section-head">
              <h2>{t('By store')}</h2>
            </div>
            <div className="list">
              {stats.data.stores.map((s) => (
                <div key={s.store ?? '-'} className="li">
                  <span className="thumb" style={{ width: 40, height: 40 }}><Storefront size={20} /></span>
                  <div className="grow">
                    <div className="title">{s.store ?? t('Store unknown')}</div>
                    <div className="meter q-meter" style={{ marginTop: 6 }}><i style={{ width: pct(s.share).replace(' ', ''), background: 'var(--accent)' }} /></div>
                    <div className="sub">
                      {[s.imports === 1 ? t('1 receipt') : t('{n} receipts', { n: s.imports }), s.lines === 1 ? t('1 line') : t('{n} lines', { n: s.lines })].join(' · ')}
                    </div>
                  </div>
                  <span className="mono small">{pct(s.share)}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="section">
        <div className="section-head">
          <h2>{t('Learned from your corrections')}</h2>
          {rules.data && <span className="small muted">{rules.data.rules.length === 1 ? t('1 rule') : t('{n} rules', { n: rules.data.rules.length })}</span>}
        </div>
        {rules.isLoading ? (
          <Skeleton n={3} />
        ) : rules.isError ? (
          <div className="card pad small">
            {t('Could not load the rules.')}{' '}
            <button className="linkish" onClick={() => rules.refetch()}>{t('Try again')}</button>
          </div>
        ) : !rules.data?.rules.length ? (
          <div className="card">
            <Empty icon={<Sparkle size={26} />} title={t('Nothing learned yet')}>
              {t('When you correct a line while checking an import – another product, a pack of 10, “skip the carrier bag” – ToHuus Hub remembers it for this household and does it on its own next time.')}
            </Empty>
          </div>
        ) : (
          <div className="list">
            {rules.data.rules.map((r) => (
              <div key={r.id} className="li clickable" onClick={() => setEdit(r)}>
                <span className="thumb" style={{ width: 40, height: 40 }}>{r.kind === 'store' ? <Storefront size={20} /> : <Receipt size={20} />}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title mono q-rule-example">{r.example}</div>
                  <div className="sub">{ruleText(r)}</div>
                </div>
                {r.hits > 0 && <span className="small muted">{t('used {n}×', { n: r.hits })}</span>}
              </div>
            ))}
          </div>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>
          {t('Rules stay in this household. Nothing is shared – unless you send an anonymised receipt yourself via “Help improve recognition” in an import.')}
        </p>
      </section>

      <RuleSheet rule={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function ruleText(r: Rule) {
  if (r.kind === 'store') return t('is {store}', { store: r.store_name ?? '' });
  const parts: string[] = [];
  if (r.ignore) parts.push(t('skipped'));
  if (r.product_name) parts.push(`→ ${r.product_name}`);
  if (r.qty_factor) parts.push(t('counts as {n}', { n: r.qty_factor }));
  if (r.unit) parts.push(unitLabel(r.unit));
  parts.push(r.store ? t('only at {store}', { store: r.store }) : t('at every store'));
  return parts.join(' · ');
}

function RuleSheet({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const toast = useToast();
  const [pick, setPick] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [pack, setPack] = useState('');
  useEffect(() => {
    if (!rule) return;
    setStoreName(rule.store_name ?? '');
    setPack(rule.qty_factor ? String(rule.qty_factor) : '');
  }, [rule]);
  const save = async (body: Record<string, unknown>) => {
    if (!rule) return;
    try {
      await patch(`/quality/rules/${rule.id}`, body);
      invalidate('quality');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const remove = async () => {
    if (!rule) return;
    try {
      await del(`/quality/rules/${rule.id}`);
      toast({ text: t('Forgotten. The next receipts are read without this rule.') });
      invalidate('quality', 'import');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <>
      <Sheet open={Boolean(rule) && !pick} onClose={onClose} title={t('Learned rule')}>
        {rule && (
          <div className="stack">
            <div className="mono small q-rule-example">{rule.example}</div>
            {rule.kind === 'store' ? (
              <div className="field">
                <label>{t('Store name')}</label>
                <input className="input" value={storeName} maxLength={60} onChange={(e) => setStoreName(e.target.value)} />
                <button className="btn primary" style={{ marginTop: 10 }} disabled={!storeName.trim()} onClick={() => save({ store_name: storeName.trim() })}>
                  {t('Save')}
                </button>
              </div>
            ) : (
              <>
                <div className="q-row">
                  <div className="grow small">
                    <b>{t('Skip this line')}</b>
                    <div className="muted">{t('For carrier bags, vouchers and things that never go into stock.')}</div>
                  </div>
                  <Toggle on={rule.ignore} onChange={(v) => save({ ignore: v })} label={t('Skip this line')} />
                </div>
                {!rule.ignore && (
                  <>
                    <div className="field">
                      <label>{t('Product')}</label>
                      <button className="btn" onClick={() => setPick(true)}>{rule.product_name ?? t('Choose product')}</button>
                    </div>
                    <div className="field">
                      <label>{t('One receipt line counts as')}</label>
                      <div className="row">
                        <input className="input" inputMode="numeric" value={pack} placeholder="1" onChange={(e) => setPack(e.target.value.replace(/[^\d]/g, ''))} />
                        <button className="btn" onClick={() => save({ qty_factor: pack ? Number(pack) : null })}>{t('Save')}</button>
                      </div>
                    </div>
                    <div className="field">
                      <label>{t('Unit')}</label>
                      <Seg value={rule.unit ?? 'Stk'} onChange={(u) => save({ unit: u === 'Stk' ? null : u })} options={UNITS.map((u) => [u, unitLabel(u)] as [string, string])} />
                    </div>
                  </>
                )}
                <div className="q-row">
                  <div className="grow small">
                    <b>{t('At every store')}</b>
                    <div className="muted">{rule.store ? t('Learned at {store}.', { store: rule.store }) : t('Applies everywhere.')}</div>
                  </div>
                  <Toggle on={!rule.store} onChange={(v) => v && save({ all_stores: true })} label={t('At every store')} />
                </div>
              </>
            )}
            <div className="small muted">
              {rule.last_used_at ? t('Last used {date}.', { date: fmtDate(rule.last_used_at) }) : t('Not used yet.')}
            </div>
            <button className="btn ghost q-danger" onClick={remove}>
              <Trash size={16} /> {t('Forget this rule')}
            </button>
          </div>
        )}
      </Sheet>
      <ProductPicker
        open={pick}
        onClose={() => setPick(false)}
        initial={rule?.product_name ?? ''}
        onPick={(p) => {
          setPick(false);
          save({ product_id: p.id, ignore: false });
        }}
      />
    </>
  );
}
