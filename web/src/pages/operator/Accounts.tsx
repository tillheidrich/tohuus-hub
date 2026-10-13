// /betrieb › Konten: who has an account, and pause / sign out / remove (server/routes/operator-accounts.ts).
// Account data only – never anything from inside a household.
import { useState } from 'react';
import { api, post, useApi } from '../../api';
import { t } from '../../i18n';
import { Seg, Sheet, Skeleton, Toggle } from '../../ui';
import { Section, day, useRun, when } from './shared';

interface Account {
  id: number;
  email: string;
  name: string | null;
  lang: string | null;
  created_at: string;
  verified_at: string | null;
  last_login_at: string | null;
  last_seen_at: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  devices: number;
  apple: boolean;
  password: boolean;
  passkeys: number;
  households: { id: string; name: string; role: string; plan: string }[];
}
type Filter = 'all' | 'blocked' | 'unconfirmed';
const PAGE = 50;

const roleName = (r: string) => (r === 'admin' ? t('Admin') : r === 'guest' ? t('Guest') : t('Member'));
const ways = (a: Account) => [a.password && t('password'), a.apple && 'Apple', a.passkeys > 0 && t('passkey')].filter(Boolean).join(', ') || t('e-mail code');

export function OperatorAccounts() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [offset, setOffset] = useState(0);
  const [sel, setSel] = useState<Account | null>(null);
  const qs = new URLSearchParams({ q: search, filter, offset: String(offset), limit: String(PAGE) }).toString();
  const list = useApi<{ total: number; accounts: Account[] }>(['operator', 'accounts', qs], `/operator/accounts?${qs}`);
  const d = list.data;
  return (
    <div className="stack op-gap">
      <div className="card pad op-banner" role="note">
        {t('Account data only: address, name, when it was created and last used, devices, households and roles – never anything from inside a household. Every action lands in the log.')}
      </div>
      <Section title={t('Accounts')} aside={d ? <span className="small muted">{t('{n} accounts', { n: d.total })}</span> : undefined}>
        <form
          className="row op-wrap"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            setOffset(0);
            setSearch(q.trim());
          }}
        >
          <input className="input grow" type="search" aria-label={t('Search by address or name')} placeholder={t('Search by address or name')} value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn">{t('Search')}</button>
        </form>
        <Seg<Filter>
          label={t('Show')}
          value={filter}
          options={[
            ['all', t('All')],
            ['blocked', t('Paused')],
            ['unconfirmed', t('Not confirmed')],
          ]}
          onChange={(v) => {
            setOffset(0);
            setFilter(v);
          }}
        />
        {!d ? (
          <Skeleton n={4} h={44} />
        ) : (
          <div className="op-scroll">
            <table className="table op-table">
              <thead>
                <tr>
                  <th>{t('Account')}</th>
                  <th className="op-hide-sm">{t('Since')}</th>
                  <th>{t('Last used')}</th>
                  <th className="op-hide-sm">{t('Households')}</th>
                  <th>{t('Status')}</th>
                </tr>
              </thead>
              <tbody>
                {d.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <button className="linkish op-acc" onClick={() => setSel(a)} aria-label={t('Open {email}', { email: a.email })}>
                        <span className="mono">{a.email}</span>
                        {a.name && <span className="op-acc-name small muted">{a.name}</span>}
                      </button>
                    </td>
                    <td className="op-hide-sm op-nowrap">{day(a.created_at)}</td>
                    <td className="op-nowrap">{a.last_seen_at || a.last_login_at ? day(a.last_seen_at || a.last_login_at) : '–'}</td>
                    <td className="op-hide-sm">{a.households.map((h) => `${h.name} (${roleName(h.role)})`).join(', ') || '–'}</td>
                    <td className={a.blocked_at ? 'op-bad' : a.verified_at ? 'op-ok' : 'muted'}>{a.blocked_at ? t('paused') : a.verified_at ? t('active') : t('not confirmed')}</td>
                  </tr>
                ))}
                {!d.accounts.length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      {t('No accounts found.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {d && d.total > PAGE && (
          <div className="row between">
            <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              {t('Back')}
            </button>
            <span className="small muted">{t('{from}–{to} of {n}', { from: offset + 1, to: Math.min(d.total, offset + PAGE), n: d.total })}</span>
            <button className="btn sm" disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>
              {t('Next')}
            </button>
          </div>
        )}
      </Section>
      {sel && <AccountSheet a={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function AccountSheet({ a, onClose }: { a: Account; onClose: () => void }) {
  const run = useRun();
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [confirm, setConfirm] = useState('');
  return (
    <Sheet open onClose={onClose} title={a.email}>
      <div className="stack">
        <dl className="plan-facts">
          <dt>{t('Name')}</dt>
          <dd>{a.name ?? '–'}</dd>
          <dt>{t('Created')}</dt>
          <dd>{when(a.created_at)}</dd>
          <dt>{t('Address confirmed')}</dt>
          <dd>{a.verified_at ? when(a.verified_at) : t('no')}</dd>
          <dt>{t('Last used')}</dt>
          <dd>{when(a.last_seen_at || a.last_login_at)}</dd>
          <dt>{t('Signs in with')}</dt>
          <dd>{ways(a)}</dd>
          <dt>{t('App devices')}</dt>
          <dd>{a.devices}</dd>
          <dt>{t('Households')}</dt>
          <dd>
            {a.households.length
              ? a.households.map((h) => (
                  <div key={h.id}>
                    {h.name} · {roleName(h.role)} · {h.plan} <span className="mono small muted">{h.id.slice(0, 8)}</span>
                  </div>
                ))
              : '–'}
          </dd>
          {a.blocked_at && (
            <>
              <dt>{t('Paused since')}</dt>
              <dd>
                {when(a.blocked_at)} – {a.blocked_reason}
              </dd>
            </>
          )}
        </dl>

        <label className="row" style={{ gap: 10 }}>
          <Toggle on={notify} onChange={setNotify} label={t('Tell the person by e-mail')} />
          <span className="small">{t('Tell the person by e-mail')}</span>
        </label>

        {a.blocked_at ? (
          <button className="btn primary" onClick={() => run(() => post(`/operator/accounts/${a.id}/unblock`, { notify }), t('Account works again')).then(onClose)}>
            {t('End the pause')}
          </button>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <div className="field">
              <label htmlFor="acc-reason">{t('Reason for the pause (the person reads it)')}</label>
              <input id="acc-reason" className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. spam, abuse of the beta access')} />
            </div>
            <button className="btn" disabled={reason.trim().length < 3} onClick={() => run(() => post(`/operator/accounts/${a.id}/block`, { reason: reason.trim(), notify }), t('Account paused')).then(onClose)}>
              {t('Pause account')}
            </button>
            <p className="small muted" style={{ margin: 0 }}>
              {t('Signs the person out on every device and stops new sign-ins. Households and their data stay; others in a shared household keep using it.')}
            </p>
          </div>
        )}

        <button className="btn ghost" onClick={() => run(() => post(`/operator/accounts/${a.id}/signout`, {}), t('Signed out everywhere'))}>
          {t('Sign out on every device')}
        </button>

        <details className="op-danger">
          <summary>{t('Remove the account for good')}</summary>
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <p className="small" style={{ margin: 0 }}>
              {t('Like deleting it in the app: households where nobody else is left are deleted with everything in them; in shared ones the person leaves. Cannot be undone.')}
            </p>
            <div className="field">
              <label htmlFor="acc-confirm">{t('Type the address to confirm')}</label>
              <input id="acc-confirm" className="input mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </div>
            <button
              className="btn danger"
              disabled={confirm.trim().toLowerCase() !== a.email.toLowerCase()}
              onClick={() => run(() => api(`/operator/accounts/${a.id}`, { method: 'DELETE', body: { confirm: confirm.trim() } }), t('Account removed')).then(onClose)}
            >
              {t('Remove for good')}
            </button>
          </div>
        </details>
      </div>
    </Sheet>
  );
}
