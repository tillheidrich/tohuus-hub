import { ArrowRight } from '@phosphor-icons/react';
import { useState } from 'react';
import { invalidate, post, useApi } from '../api';
import { Avatar } from '../ui';

export function Login() {
  const users = useApi<{ name: string; color: string }[]>('users-public', '/auth/users');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
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
          <img src="/icon.svg" alt="" /> Stockwerk
        </div>
        <div>
          <div className="shelves">
            <i />
            <i />
            <i />
          </div>
          <div className="h1" style={{ fontSize: 46, maxWidth: 460 }}>
            Was im Haus ist.
            <br />
            Auf einen Blick.
          </div>
          <p style={{ opacity: 0.7, maxWidth: 420, marginTop: 14 }}>
            Gefrierschrank, Keller, Vorrat und Haushalt – mit Einkaufsliste, Rezepten und einer Bar für Gäste.
          </p>
        </div>
        <div className="small" style={{ opacity: 0.5 }}>Selbst gehostet · Open Source</div>
      </div>
      <form className="form" onSubmit={submit}>
        <div className="brand only-mobile" style={{ padding: 0 }}>
          <img src="/icon.svg" alt="" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
          Stockwerk
        </div>
        <div>
          <div className="eyebrow">Willkommen zurück</div>
          <h1>Wer bist du?</h1>
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
          <label htmlFor="pw">Passwort</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          {err && <div className="small" style={{ color: 'var(--empty)' }}>{err}</div>}
        </div>
        <button className="btn primary lg" disabled={busy || !pw}>
          Rein ins Haus <ArrowRight size={18} weight="bold" />
        </button>
        <p className="small muted">Du bleibst auf diesem Gerät angemeldet.</p>
      </form>
    </div>
  );
}
