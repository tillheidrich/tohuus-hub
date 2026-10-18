/**
 * Settings › "Abo & Speicher" (ToHuus Cloud only, plan 2026-10-12): plan, trial end, storage used vs quota,
 * assistant usage – from GET /api/billing/status. Honest about where to subscribe (the iPhone app for now).
 * Plus export (GET /api/cloud/export) and deleting the account (DELETE /api/cloud/account) with confirmation.
 * Self-hosted servers never show any of this (Settings hides the tab).
 */
import { DownloadSimple, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { api, invalidate, patch, post, useApi } from '../api';
import { type Billing, useBilling } from '../data';
import { locale, t } from '../i18n';
import { Sheet, Skeleton, Toggle, useToast } from '../ui';

const PLAN_LABEL: Record<Billing['plan'], string> = {
  free: 'Free',
  trial: 'Trial (everything included)',
  haushalt: 'Haushalt',
  plus: 'Plus',
  selfhost: 'Self-hosted',
  readonly: 'Read-only – the trial is over',
};

const fmtDay = (d?: string | null) => (d ? new Date(d.length <= 10 ? `${d}T12:00:00` : d).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const mb = (n: number) => (n >= 1024 ? `${(n / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 })} GB` : `${Math.round(n).toLocaleString(locale())} MB`);

export function BillingCard() {
  const b = useBilling();
  if (b.isLoading) return <Skeleton n={1} h={160} />;
  const s = b.data;
  if (!s) return <div className="card pad small muted">{t('The plan details aren’t available on this server yet.')}</div>;
  const usedMb = s.usage?.storageBytes != null ? s.usage.storageBytes / 1048576 : null;
  const quotaMb = s.limits?.storageBytes != null ? s.limits.storageBytes / 1048576 : null;
  // a sliver stays visible as soon as anything is stored
  const pct = usedMb != null && quotaMb ? Math.min(100, Math.max(usedMb > 0 ? 1 : 0, Math.round((usedMb / quotaMb) * 100))) : null;
  const msgs = s.limits?.assistantPerMonth;
  return (
    <section className="card pad stack" aria-labelledby="plan-h" style={{ marginBottom: 16 }}>
      <h2 id="plan-h" style={{ margin: 0 }}>
        {t('Plan & storage')}
      </h2>
      {(s.plan === 'trial' || s.readonly) && <TrialLookBack />}
      {s.readonly && (
        <p style={{ margin: 0 }}>
          {t('Your trial is over. With Haushalt or Plus you can carry on – or run ToHuus on your own server. Everything stays visible and you can export it.')}
        </p>
      )}
      <dl className="plan-facts">
        <dt>{t('Plan')}</dt>
        <dd>{s.lifetime ? t('Plus – for good') : t(PLAN_LABEL[s.plan] ?? s.plan)}</dd>
        {s.gift && (
          <>
            <dt>{t('Gift')}</dt>
            <dd>
              {s.gift.kind === 'beta'
                ? t('A gift for every household')
                : s.gift.forever
                  ? t('For good')
                  : s.gift.until
                    ? t('Until {date}', { date: fmtDay(s.gift.until) })
                    : t('Gift')}
            </dd>
          </>
        )}
        {s.plan === 'trial' && s.trialEndsAt && (
          <>
            <dt>{t('Trial ends')}</dt>
            <dd>{fmtDay(s.trialEndsAt)}</dd>
          </>
        )}
        {s.renewsAt && (
          <>
            <dt>{t('Renews')}</dt>
            <dd>{s.period === 'yearly' ? t('{date} (yearly)', { date: fmtDay(s.renewsAt) }) : s.period === 'monthly' ? t('{date} (monthly)', { date: fmtDay(s.renewsAt) }) : fmtDay(s.renewsAt)}</dd>
          </>
        )}
        {!s.renewsAt && s.autoRenew === false && s.expiresAt && (
          <>
            <dt>{t('Ends')}</dt>
            <dd>{t('{date} – will not renew', { date: fmtDay(s.expiresAt) })}</dd>
          </>
        )}
        {msgs != null && (
          <>
            <dt>{t('Assistant')}</dt>
            <dd>{t('{used} of {max} messages this month', { used: s.usage?.assistantThisMonth ?? 0, max: msgs })}</dd>
          </>
        )}
        {s.limits?.receiptAiPerDay != null && (
          <>
            <dt>{t('Receipt photos')}</dt>
            <dd>{t('{used} of {max} today', { used: s.usage?.receiptAiToday ?? 0, max: s.limits.receiptAiPerDay })}</dd>
          </>
        )}
        {s.limits?.historyDays != null && (
          <>
            <dt>{t('Remembers')}</dt>
            <dd>{t('{n} days back', { n: s.limits.historyDays })}</dd>
          </>
        )}
      </dl>
      {usedMb != null && (
        <div className="storage stack" style={{ gap: 6 }}>
          <div className="row between">
            <b>{t('Storage')}</b>
            <span className="small muted">{quotaMb ? t('{used} of {quota}', { used: mb(usedMb), quota: mb(quotaMb) }) : mb(usedMb)}</span>
          </div>
          {pct != null && (
            <div className={`bar ${pct >= 95 ? 'full' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('Storage used')}>
              <i style={{ width: `${pct}%` }} />
            </div>
          )}
          {pct != null && pct >= 95 && <p className="small" style={{ margin: 0 }}>{t('Storage is full: new photos and receipt files can’t be saved. Nothing gets deleted.')}</p>}
        </div>
      )}
      {s.manageUrl && (
        <div className="stack" style={{ gap: 10 }}>
          <a className="btn" style={{ alignSelf: 'flex-start' }} href={s.manageUrl} target="_blank" rel="noopener noreferrer">
            {t('Manage subscription')}
          </a>
          <div className="row between" style={{ gap: 16, alignItems: 'flex-start' }}>
            <div>
              <b>{t('Reminder before the yearly renewal')}</b>
              <div className="small muted">{t('An e-mail 3 days before Apple charges the next year.')}</div>
            </div>
            <Toggle on={s.reminder !== false} onChange={(v) => patch('/billing/reminder', { enabled: v }).then(() => invalidate('billing'))} label={t('Reminder before the yearly renewal')} />
          </div>
        </div>
      )}
      <RedeemCode />
      <p className="small muted" style={{ margin: 0 }}>
        {s.gift?.kind === 'beta'
          ? t('A gift from us – nothing is charged. When it ends, every household keeps what it has on its own – nothing is deleted.')
          : s.gift
            ? t('A gift from us – nothing is charged.')
            : t('You subscribe in the ToHuus app on the iPhone: 14 days of everything for free, then from 3,99 € a month. One plan covers the whole household. Without a plan the household is read-only, nothing is deleted and the export always works.')}
      </p>
    </section>
  );
}

interface TrialSummary {
  state: 'running' | 'ended' | 'none';
  endsAt: string | null;
  daysLeft: number | null;
  counts: Record<'receipts' | 'receiptsTotal' | 'listTicks' | 'trips' | 'tasksDone' | 'recipesCooked' | 'assistant' | 'products', number> | null;
  show: boolean;
}

/**
 * "Was ToHuus in den 14 Tagen für euch gemerkt hat" (F1, server/lib/trial-end.ts): counts of the own household only,
 * from its own database. Shown here while the trial runs and after it ended.
 */
function TrialLookBack() {
  const q = useApi<TrialSummary>(['billing', 'trial-summary'], '/billing/trial-summary');
  const c = q.data?.counts;
  if (!c || q.data?.state === 'none') return null;
  const money = (n: number) => n.toLocaleString(locale(), { style: 'currency', currency: 'EUR' });
  const lines = [
    c.listTicks > 0 && t('{n} times ticked off the list', { n: c.listTicks }),
    c.trips > 0 && t('{n} shopping trips done', { n: c.trips }),
    c.receipts > 0 && (c.receiptsTotal > 0 ? t('{n} receipts kept, {sum} in total', { n: c.receipts, sum: money(c.receiptsTotal) }) : t('{n} receipts kept', { n: c.receipts })),
    c.tasksDone > 0 && t('{n} tasks done', { n: c.tasksDone }),
    c.recipesCooked > 0 && t('{n} times cooked from a recipe', { n: c.recipesCooked }),
    c.assistant > 0 && t('{n} questions to the assistant', { n: c.assistant }),
    c.products > 0 && t('{n} things ToHuus remembers for you', { n: c.products }),
  ].filter(Boolean) as string[];
  if (lines.length < 2) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <b>{q.data?.state === 'running' ? t('What ToHuus has remembered for you so far') : t('What ToHuus remembered for you in the 14 days')}</b>
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * "Code einlösen": a gift code from us (server/lib/gifts.ts) – admins only, web only (the iPhone app may not unlock
 * features with own codes, App Store Review Guideline 3.1.1).
 */
function RedeemCode() {
  const me = useApi<{ actor: { role: string } }>('me', '/me');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  if (me.data?.actor?.role !== 'admin') return null;
  // inside the iPhone app's web view (WebSettingsView.swift): no codes, App Store guideline 3.1.1
  if (/ToHuusApp/.test(navigator.userAgent)) return null;
  if (!open)
    return (
      <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        {t('Redeem a code')}
      </button>
    );
  return (
    <form
      className="row wrap"
      style={{ gap: 8, alignItems: 'flex-end' }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!code.trim()) return;
        setBusy(true);
        try {
          const r = await post<{ plan: string; until: string | null }>('/billing/redeem', { code: code.trim() });
          toast({ text: r.until ? t('Redeemed – {plan} until {date}.', { plan: t(PLAN_LABEL[r.plan as Billing['plan']] ?? r.plan), date: fmtDay(r.until) }) : t('Redeemed – {plan} for good. Thank you!', { plan: t(PLAN_LABEL[r.plan as Billing['plan']] ?? r.plan) }) });
          setCode('');
          setOpen(false);
          invalidate('billing');
        } catch (err) {
          toast({ text: (err as Error).message, error: true });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="field grow" style={{ minWidth: 200 }}>
        <label htmlFor="gift-code">{t('Gift code')}</label>
        <input id="gift-code" className="input mono" autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="GIFT-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} />
      </div>
      <button className="btn primary" disabled={busy || !code.trim()}>
        {t('Redeem')}
      </button>
    </form>
  );
}

export function CloudAccountCard() {
  const me = useApi<{ actor: { role: string } }>('me', '/me');
  const admin = me.data?.actor?.role === 'admin';
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const word = t('DELETE');
  const remove = async () => {
    setBusy(true);
    try {
      // the server asks for the password; accounts without one get a confirmation link by e-mail first
      await api('/cloud/account', { method: 'DELETE', body: { password } });
      invalidate('me');
      location.href = '/';
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      setBusy(false);
    }
  };
  return (
    <section className="card pad stack" aria-labelledby="acc-h">
      <h2 id="acc-h" style={{ margin: 0 }}>
        {t('Your data')}
      </h2>
      <p className="small muted" style={{ margin: 0 }}>{t('Download everything ToHuus has stored for your household – lists, products, recipes, receipts – as a file.')}</p>
      {admin ? (
        <a className="btn" href="/api/cloud/export" download>
          <DownloadSimple size={16} /> {t('Export data')}
        </a>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>{t('An admin of the household can export its data.')}</p>
      )}
      <div style={{ borderTop: "1px solid var(--line)" }} />
      <p className="small muted" style={{ margin: 0 }}>
        {t('Deleting your account removes your access. If you are the last member of a household, the household and all its data are deleted for good.')}
      </p>
      <button className="btn danger" onClick={() => setConfirm(true)}>
        <Trash size={16} /> {t('Delete account')}
      </button>
      <Sheet open={confirm} onClose={() => setConfirm(false)} title={t('Delete account?')}>
        <div className="stack">
          <p style={{ margin: 0 }}>{t('This can’t be undone. Export your data first if you want to keep it.')}</p>
          <label className="field">
            <span>{t('Type {word} to confirm', { word })}</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
          <label className="field">
            <span>{t('Your password')}</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <span className="help">{t('Signed in without a password? Leave it empty – you get a confirmation link by e-mail.')}</span>
          </label>
          <button className="btn danger lg" disabled={busy || typed.trim().toUpperCase() !== word.toUpperCase()} onClick={remove}>
            <Trash size={16} /> {busy ? t('Deleting …') : t('Delete account for good')}
          </button>
        </div>
      </Sheet>
    </section>
  );
}
