import { ArrowRight } from '@phosphor-icons/react';
import { useState } from 'react';
import { invalidate, post, useApi } from '../api';
import { Avatar } from '../ui';
import { BRANDS, currentBrand } from '../brand';
import { t } from '../i18n';

export function Login() {
  const users = useApi<{ name: string; color: string }[]>('users-public', '/auth/users');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const b = BRANDS[currentBrand()];
  const fredi = currentBrand() === 'fredirando';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await post('/auth/login', { name: name || users.data?.[0]?.name, password: pw });
      invalidate('me');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="art">
        <div className="brand" style={{ padding: 0 }}>
          <img src={b.logo} alt="" /> {b.name}
        </div>
        <div>
          <div className="shelves">
            <i />
            <i />
            <i />
          </div>
          <div className="h1" style={{ fontSize: 46, maxWidth: 460 }}>
            {fredi ? (
              <>
                {t('Hungry?')}
                <br />
                {t('We deliver.')}
              </>
            ) : (
              <>
                {t('What’s in the house.')}
                <br />
                {t('At a glance.')}
              </>
            )}
          </div>
          <p style={{ opacity: 0.7, maxWidth: 420, marginTop: 14 }}>
            {fredi
              ? t('From cellar to couch in under three minutes. Backed by pantry, shopping list and recipes.')
              : t('Freezer, cellar, pantry and household – with a shopping list, recipes and a bar for guests.')}
          </p>
        </div>
        <div className="small" style={{ opacity: 0.6 }}>{fredi ? t('Family business · Delivery to our own house only') : t('Self-hosted · Open source')}</div>
      </div>
      <form className="form" onSubmit={submit}>
        <div className="brand only-mobile" style={{ padding: 0 }}>
          <img src={b.logo} alt="" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8, width: 30, height: 30, borderRadius: 8 }} />
          {b.name}
        </div>
        <div>
          <div className="eyebrow">{t('Welcome back')}</div>
          <h1>{t('Who are you?')}</h1>
        </div>
        <div className="who-pick">
          {(users.data ?? []).map((u) => (
            <button type="button" key={u.name} className={(name || users.data?.[0]?.name) === u.name ? 'on' : ''} onClick={() => setName(u.name)}>
              <Avatar name={u.name} color={u.color} />
              {u.name}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="pw">{t('Password')}</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          {err && <div className="small" style={{ color: 'var(--empty)' }}>{err}</div>}
        </div>
        <button className="btn primary lg" disabled={busy || !pw}>
          {fredi ? t('Let’s go') : t('Come on in')} <ArrowRight size={18} weight="bold" />
        </button>
        <p className="small muted">{t('You’ll stay signed in on this device.')}</p>
      </form>
    </div>
  );
}
