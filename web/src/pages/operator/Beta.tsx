// /betrieb › Beta-Zugang: access codes and the allowlist of the beta gate (server/lib/beta.ts).
import { useState } from 'react';
import { api, post, useApi } from '../../api';
import { t } from '../../i18n';
import { Skeleton, useToast } from '../../ui';
import { Section, day, useRun } from './shared';

interface Code {
  id: number;
  code: string;
  note: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
interface BetaView {
  mode: 'open' | 'invite' | 'closed';
  supportEmail: string;
  codes: Code[];
  allowlist: { email: string; note: string | null; created_at: string }[];
}

function state(c: Code): [string, string] {
  if (c.revoked_at) return [t('revoked'), 'op-bad'];
  if (c.expires_at && c.expires_at < new Date().toISOString().replace('T', ' ')) return [t('expired'), 'op-bad'];
  if (c.max_uses !== null && c.uses >= c.max_uses) return [t('used up'), 'muted'];
  return [t('active'), 'op-ok'];
}

export function OperatorBeta() {
  const q = useApi<BetaView>(['operator', 'beta'], '/operator/beta');
  const run = useRun();
  const toast = useToast();
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const [maxUses, setMaxUses] = useState('1');
  const [expires, setExpires] = useState('');
  const [emails, setEmails] = useState('');
  const [fresh, setFresh] = useState<string[]>([]);
  const d = q.data;
  if (!d) return <Skeleton n={3} h={80} />;
  const modeText = d.mode === 'invite' ? t('Sign-up needs an access code or an address on the list.') : d.mode === 'open' ? t('Anyone can sign up right now.') : t('Nobody new can sign up right now. Invitations to a household still work.');
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast({ text: t('Copied') }));
  return (
    <div className="stack op-gap">
      <div className="card pad op-banner" role="status">
        <strong>{d.mode === 'invite' ? t('With access code') : d.mode === 'open' ? t('Open for everyone') : t('Closed')}</strong> · {modeText}{' '}
        <span className="small muted">{t('Change it under Settings.')}</span>
      </div>

      <Section title={t('New access codes')}>
        <form
          className="op-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(
              () => post<{ codes: Code[] }>('/operator/beta/codes', { count, note: note.trim() || null, maxUses: maxUses ? Number(maxUses) : null, expiresAt: expires || null }),
              t('{n} codes created', { n: count }),
            );
            if (r) {
              setFresh(r.codes.map((c) => c.code));
              setNote('');
            }
          }}
        >
          <div className="field">
            <label htmlFor="op-n">{t('How many')}</label>
            <input id="op-n" className="input" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          </div>
          <div className="field">
            <label htmlFor="op-uses">{t('Uses per code')}</label>
            <input id="op-uses" className="input" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder={t('unlimited')} />
          </div>
          <div className="field">
            <label htmlFor="op-exp">{t('Valid until')}</label>
            <input id="op-exp" className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          </div>
          <div className="field op-span">
            <label htmlFor="op-note">{t('Note (for you)')}</label>
            <input id="op-note" className="input" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. TestFlight group 1')} />
          </div>
          <button className="btn primary op-span">{t('Create codes')}</button>
        </form>
        {fresh.length > 0 && (
          <div className="op-fresh">
            <pre className="codebox">{fresh.join('\n')}</pre>
            <button className="btn sm" onClick={() => copy(fresh.join('\n'))}>
              {t('Copy all')}
            </button>
          </div>
        )}
      </Section>

      <Section title={t('Access codes')}>
        <div className="op-scroll">
          <table className="table op-table">
            <thead>
              <tr>
                <th>{t('Code')}</th>
                <th>{t('Used')}</th>
                <th className="op-hide-sm">{t('Valid until')}</th>
                <th className="op-hide-sm">{t('Note')}</th>
                <th>{t('Status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.codes.map((c) => {
                const [s, cls] = state(c);
                return (
                  <tr key={c.id}>
                    <td>
                      <button className="linkish mono op-nowrap" onClick={() => copy(c.code)} aria-label={t('Copy {code}', { code: c.code })}>
                        {c.code}
                      </button>
                    </td>
                    <td className="op-num">{c.max_uses === null ? `${c.uses} / ∞` : `${c.uses} / ${c.max_uses}`}</td>
                    <td className="op-hide-sm">{c.expires_at ? day(c.expires_at) : '–'}</td>
                    <td className="op-note op-hide-sm">{c.note ?? ''}</td>
                    <td className={cls}>{s}</td>
                    <td>
                      {!c.revoked_at && (
                        <button className="btn ghost sm" onClick={() => run(() => api(`/operator/beta/codes/${c.id}`, { method: 'DELETE' }), t('Code revoked'))}>
                          {t('Revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!d.codes.length && (
                <tr>
                  <td colSpan={6} className="muted">
                    {t('No codes yet.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t('Addresses that may sign up without a code')}>
        <form
          className="row op-wrap"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => post<{ added: number }>('/operator/beta/allowlist', { emails }));
            if (r) {
              toast({ text: t('{n} added', { n: r.added }) });
              setEmails('');
            }
          }}
        >
          <label className="sr-only" htmlFor="op-emails">
            {t('E-mail addresses')}
          </label>
          <input id="op-emails" className="input op-grow" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={t('one or more addresses, separated by commas')} />
          <button className="btn" disabled={!emails.trim()}>
            {t('Add')}
          </button>
        </form>
        <div className="list">
          {d.allowlist.map((a) => (
            <div className="li" key={a.email}>
              <div className="grow small mono">{a.email}</div>
              <div className="small muted">{a.note ?? ''}</div>
              <button className="btn ghost sm" onClick={() => run(() => api('/operator/beta/allowlist', { method: 'DELETE', body: { email: a.email } }), t('Removed'))}>
                {t('Remove')}
              </button>
            </div>
          ))}
          {!d.allowlist.length && <div className="li small muted">{t('Nobody on the list.')}</div>}
        </div>
      </Section>
    </div>
  );
}
