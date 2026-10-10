import { Bell, Copy, House, Key, Plug, SignOut, Trash, UploadSimple } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import type { Me } from '../App';
import { type Category, type Location, api, del, invalidate, patch, post, relTime, useApi } from '../api';
import { Avatar, ICON_CHOICES, Ic, Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';

type Tab = 'home' | 'places' | 'notify' | 'access' | 'data';

export function Settings({ me }: { me: Me }) {
  const [tab, setTab] = useState<Tab>('home');
  const admin = me.actor.role === 'admin';
  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{me.household}</div>
          <h1>Einstellungen</h1>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => post('/auth/logout').then(() => invalidate('me'))}>
            <SignOut size={16} /> Abmelden
          </button>
        </div>
      </header>
      <div className="tabs-inline">
        {(
          [
            ['home', 'Haushalt'],
            ['places', 'Orte & Kategorien'],
            ['notify', 'Benachrichtigungen'],
            ['access', 'Zugänge & KI'],
            ['data', 'Daten'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'home' && <Household me={me} admin={admin} />}
      {tab === 'places' && <Places admin={admin} />}
      {tab === 'notify' && <Notify admin={admin} />}
      {tab === 'access' && <Access admin={admin} />}
      {tab === 'data' && <Data admin={admin} />}
    </div>
  );
}

function Household({ me, admin }: { me: Me; admin: boolean }) {
  const s = useApi<any>('settings', '/settings');
  const users = useApi<any[]>('users', admin ? '/users' : null);
  const [name, setName] = useState('');
  const [nu, setNu] = useState({ name: '', password: '', role: 'member', color: '#d0603a' });
  const [pw, setPw] = useState('');
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('sw.theme') ?? 'auto';
    } catch {
      return 'auto';
    }
  });
  const toast = useToast();
  useEffect(() => setName(s.data?.household ?? ''), [s.data]);
  const applyTheme = (t: string) => {
    setTheme(t);
    try {
      if (t === 'auto') {
        localStorage.removeItem('sw.theme');
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem('sw.theme', t);
        document.documentElement.dataset.theme = t;
      }
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="card pad stack">
        <div className="field">
          <label>Name des Haushalts</label>
          <div className="row">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!admin} />
            {admin && <button className="btn" onClick={() => patch('/settings', { household: name }).then(() => { invalidate('me', 'settings', 'overview'); toast({ text: 'Gespeichert' }); })}>Speichern</button>}
          </div>
        </div>
        <div className="field">
          <label>Marke</label>
          <div className="row wrap" style={{ gap: 10 }}>
            {(['stockwerk', 'fredirando'] as const).map((k) => (
              <button
                key={k}
                type="button"
                disabled={!admin}
                className={`who-pick-btn ${s.data?.brand === k ? 'on' : ''}`}
                onClick={() => patch('/settings', { brand: k }).then(() => { invalidate('me', 'settings'); toast({ text: k === 'fredirando' ? 'Fredirando liefert ab jetzt' : 'Zurück zu Stockwerk' }); })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 8px', borderRadius: 14, border: `1px solid ${s.data?.brand === k ? 'var(--ink)' : 'var(--line-strong)'}`, background: 'var(--surface)', cursor: 'pointer', fontWeight: 600 }}
              >
                <img src={k === 'fredirando' ? '/fredirando.svg' : '/stockwerk-logo.svg'} alt="" style={{ width: 34, height: 34, borderRadius: 10 }} />
                {k === 'fredirando' ? 'Fredirando' : 'Stockwerk'}
              </button>
            ))}
          </div>
          <div className="help">Fredirando ist das Lieferdienst-Thema für euer Zuhause: Orange, Gäste-Bar als Restaurant, Bestellstatus mit „Fahrer unterwegs“. App-Symbol auf dem Homescreen danach einmal neu hinzufügen.</div>
        </div>
        <div className="field">
          <label>Darstellung</label>
          <Seg value={theme} onChange={applyTheme} options={[['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']]} />
        </div>
        <div className="field">
          <label>Mein Passwort ändern</label>
          <div className="row">
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="neues Passwort" />
            <button className="btn" disabled={pw.length < 4} onClick={() => patch(`/users/${me.actor.userId}`, { password: pw }).then(() => { setPw(''); toast({ text: 'Passwort geändert' }); })}>Ändern</button>
          </div>
        </div>
      </div>
      {admin && (
        <section>
          <h2 style={{ marginBottom: 10 }}>Mitglieder</h2>
          <div className="list">
            {(users.data ?? []).map((u) => (
              <div key={u.id} className="li">
                <Avatar name={u.name} color={u.color} />
                <div className="grow">
                  <div className="title">{u.name}</div>
                  <div className="sub">{u.role === 'admin' ? 'Admin' : 'Mitglied'}</div>
                </div>
                {u.id !== me.actor.userId && (
                  <button className="icon-btn plain" onClick={() => confirm(`${u.name} entfernen?`) && del(`/users/${u.id}`).then(() => invalidate('users'))} aria-label="Entfernen">
                    <Trash size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="card pad stack" style={{ marginTop: 10 }}>
            <b>Jemanden hinzufügen</b>
            <div className="grid-2">
              <input className="input" placeholder="Name" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
              <input className="input" placeholder="Passwort" type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
            </div>
            <div className="row between wrap">
              <Seg value={nu.role} onChange={(v) => setNu({ ...nu, role: v })} options={[['member', 'Mitglied'], ['admin', 'Admin']]} />
              <input type="color" value={nu.color} onChange={(e) => setNu({ ...nu, color: e.target.value })} style={{ width: 44, height: 36, border: 0, background: 'none' }} aria-label="Farbe" />
              <button className="btn primary" disabled={!nu.name || nu.password.length < 4} onClick={() => post('/users', nu).then(() => { setNu({ ...nu, name: '', password: '' }); invalidate('users', 'users-public'); })}>Anlegen</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function Places({ admin }: { admin: boolean }) {
  const locations = useApi<Location[]>('locations', '/locations');
  const categories = useApi<Category[]>('categories', '/categories');
  const [newLoc, setNewLoc] = useState('');
  const [iconFor, setIconFor] = useState<Location | null>(null);
  const toast = useToast();
  return (
    <div className="stack" style={{ gap: 22 }}>
      <section>
        <h2 style={{ marginBottom: 6 }}>Orte</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Die „Stockwerke“ deines Hauses: wo Dinge stehen.</p>
        <div className="list">
          {(locations.data ?? []).map((l) => (
            <div key={l.id} className="li">
              <button className="thumb" style={{ width: 40, height: 40, cursor: admin ? 'pointer' : 'default', border: 0 }} onClick={() => admin && setIconFor(l)}>
                <Ic name={l.icon} />
              </button>
              <input className="input grow" defaultValue={l.name} disabled={!admin} onBlur={(e) => e.target.value !== l.name && patch(`/locations/${l.id}`, { name: e.target.value }).then(() => invalidate('locations', 'overview'))} />
              <span className="small muted mono" style={{ width: 30, textAlign: 'right' }}>{l.product_count}</span>
              {admin && (
                <button className="icon-btn plain" onClick={() => del(`/locations/${l.id}`).then(() => invalidate('locations')).catch((e) => toast({ text: e.message, error: true }))} aria-label="Löschen">
                  <Trash size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
        {admin && (
          <div className="row" style={{ marginTop: 10 }}>
            <input className="input" placeholder="Neuer Ort, z. B. Garage, Truhe im Keller" value={newLoc} onChange={(e) => setNewLoc(e.target.value)} />
            <button className="btn" disabled={!newLoc} onClick={() => post('/locations', { name: newLoc }).then(() => { setNewLoc(''); invalidate('locations', 'overview'); })}>Hinzu</button>
          </div>
        )}
      </section>
      <section>
        <h2 style={{ marginBottom: 6 }}>Kategorien</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Bestimmen, wo neue Produkte landen und wie genau gezählt wird.</p>
        <div className="list">
          {(categories.data ?? []).map((c) => (
            <div key={c.id} className="li wrap" style={{ flexWrap: 'wrap' }}>
              <span className="thumb" style={{ width: 40, height: 40 }}><Ic name={c.icon} /></span>
              <div className="grow" style={{ minWidth: 120 }}>
                <div className="title">{c.name}</div>
              </div>
              <select className="input" style={{ width: 'auto', height: 34, fontSize: 13 }} value={c.default_location_id ?? ''} disabled={!admin} onChange={(e) => patch(`/categories/${c.id}`, { default_location_id: e.target.value ? Number(e.target.value) : null }).then(() => invalidate('categories'))}>
                <option value="">kein Ort</option>
                {(locations.data ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
              <select className="input" style={{ width: 'auto', height: 34, fontSize: 13 }} value={c.track_mode} disabled={!admin} onChange={(e) => patch(`/categories/${c.id}`, { track_mode: e.target.value }).then(() => invalidate('categories'))}>
                <option value="count">Stück</option>
                <option value="level">Füllstand</option>
                <option value="none">nicht zählen</option>
              </select>
            </div>
          ))}
        </div>
      </section>
      <Sheet open={Boolean(iconFor)} onClose={() => setIconFor(null)} title="Symbol wählen">
        <div className="row wrap" style={{ gap: 8 }}>
          {ICON_CHOICES.map((i) => (
            <button key={i} className="icon-btn" style={{ width: 52, height: 52 }} onClick={() => patch(`/locations/${iconFor!.id}`, { icon: i }).then(() => { setIconFor(null); invalidate('locations', 'overview'); })}>
              <Ic name={i} size={24} />
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  'stock.low': 'Etwas wird knapp',
  'stock.empty': 'Etwas ist alle',
  'stock.expiring': 'MHD läuft ab',
  'import.review': 'Import wartet auf Prüfung',
  'order.new': 'Neue Gäste-Bestellung',
  'order.status': 'Bestellstatus geändert',
  'shopping.added': 'Neuer Eintrag auf der Einkaufsliste',
  'digest.daily': 'Tagesblick (einmal täglich)',
};

function Notify({ admin }: { admin: boolean }) {
  const s = useApi<any>('settings', '/settings');
  const log = useApi<any[]>('notifications', '/notifications');
  const [n, setN] = useState<any>(null);
  const toast = useToast();
  useEffect(() => s.data && setN(s.data.notify), [s.data]);
  if (!n) return <Skeleton n={4} />;
  const save = async (next = n) => {
    await patch('/settings', { notify: next });
    invalidate('settings');
    toast({ text: 'Gespeichert' });
  };
  const setEv = (ev: string, ch: string, v: boolean) => setN((x: any) => ({ ...x, events: { ...x.events, [ev]: { ...x.events[ev], [ch]: v } } }));
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="card pad stack">
        <div className="field">
          <label>Home Assistant – Webhook-URL</label>
          <input className="input" value={n.haWebhookUrl} onChange={(e) => setN({ ...n, haWebhookUrl: e.target.value })} placeholder="https://ha.example.de/api/webhook/stockwerk_…" disabled={!admin} />
          <div className="help">Stockwerk schickt Ereignisse als JSON (title, message, url, data). Eine fertige Automation gibt es unter „Zugänge & KI“.</div>
        </div>
        <div className="field">
          <label>ntfy-Topic (optional)</label>
          <input className="input" value={n.ntfyUrl} onChange={(e) => setN({ ...n, ntfyUrl: e.target.value })} placeholder="https://ntfy.sh/mein-geheimes-topic" disabled={!admin} />
        </div>
        <div className="field">
          <label>Weiterer Webhook (n8n, Node-RED …)</label>
          <input className="input" value={n.webhookUrl} onChange={(e) => setN({ ...n, webhookUrl: e.target.value })} placeholder="https://…" disabled={!admin} />
        </div>
        <div className="field">
          <label>E-Mail an</label>
          <input className="input" value={n.emailTo} onChange={(e) => setN({ ...n, emailTo: e.target.value })} placeholder="wir@example.de, zweite@example.de" disabled={!admin} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Tagesblick um</label>
            <select className="input" value={n.digestHour} onChange={(e) => setN({ ...n, digestHour: Number(e.target.value) })} disabled={!admin}>
              <option value={-1}>aus</option>
              {Array.from({ length: 24 }).map((_, h) => (
                <option key={h} value={h}>{h}:00 Uhr</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>MHD-Warnung</label>
            <select className="input" value={n.expiryWarnDays} onChange={(e) => setN({ ...n, expiryWarnDays: Number(e.target.value) })} disabled={!admin}>
              {[1, 2, 3, 5, 7].map((d) => (
                <option key={d} value={d}>{d} Tag{d > 1 ? 'e' : ''} vorher</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row between">
          <div>
            <b>Knappes automatisch auf die Einkaufsliste</b>
            <div className="small muted">sobald die Mindestmenge unterschritten ist</div>
          </div>
          <Toggle on={n.autoShoppingList} onChange={(v) => setN({ ...n, autoShoppingList: v })} />
        </div>
      </div>
      <section>
        <h2 style={{ marginBottom: 10 }}>Was wohin?</h2>
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Ereignis</th>
                <th>Home Assistant</th>
                <th>ntfy</th>
                <th>Webhook</th>
                <th>E-Mail</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(EVENT_LABEL).map((ev) => (
                <tr key={ev}>
                  <td>{EVENT_LABEL[ev]}</td>
                  {['ha', 'ntfy', 'webhook', 'email'].map((ch) => (
                    <td key={ch}>
                      <input type="checkbox" checked={Boolean(n.events[ev]?.[ch])} onChange={(e) => setEv(ev, ch, e.target.checked)} disabled={!admin} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {admin && (
        <div className="row">
          <button className="btn" onClick={async () => { await save(); const r = await post('/settings/test-notification'); toast({ text: r.channels.length ? `Test gesendet: ${r.channels.join(', ')}` : 'Kein Kanal hat geantwortet – URLs prüfen' }); invalidate('notifications'); }}>
            <Bell size={16} /> Testen
          </button>
          <div className="grow" />
          <button className="btn primary" onClick={() => save()}>Speichern</button>
        </div>
      )}
      <section>
        <h2 style={{ marginBottom: 10 }}>Zuletzt gesendet</h2>
        <div className="list">
          {(log.data ?? []).slice(0, 12).map((x) => {
            const ch = JSON.parse(x.channels || '[]') as { channel: string; ok: boolean }[];
            return (
              <div key={x.id} className="li" style={{ minHeight: 52 }}>
                <div className="grow">
                  <div className="title small">{x.title}</div>
                  <div className="sub">{ch.length ? ch.map((c) => `${c.channel} ${c.ok ? '✓' : '✗'}`).join(' · ') : 'nur in der App'}</div>
                </div>
                <span className="small muted">{relTime(x.created_at)}</span>
              </div>
            );
          })}
          {(log.data ?? []).length === 0 && <div className="li muted small">Noch nichts.</div>}
        </div>
      </section>
    </div>
  );
}

function Access({ admin }: { admin: boolean }) {
  const s = useApi<any>('settings', '/settings');
  const tokens = useApi<any[]>('tokens', admin ? '/tokens' : null);
  const [created, setCreated] = useState<{ name: string; token: string; scope: string } | null>(null);
  const [name, setName] = useState('Claude');
  const [scope, setScope] = useState<'mcp' | 'ha' | 'full'>('mcp');
  const [yaml, setYaml] = useState('');
  const toast = useToast();
  const base = s.data?.baseUrl ?? location.origin;
  const create = async () => {
    const r = await post('/tokens', { name, scope });
    setCreated({ name, token: r.token, scope });
    invalidate('tokens');
    if (scope === 'ha') setYaml(await post('/ha/package.yaml', { token: r.token }));
  };
  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast({ text: 'Kopiert' }));
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="card pad stack">
        <div className="row">
          <span className="thumb" style={{ width: 44, height: 44 }}><Plug size={22} /></span>
          <div className="grow">
            <b>Claude, ChatGPT & Co. (MCP)</b>
            <div className="small muted">Fotos von Bons, Gefrierschrank oder HelloFresh-Karten an den Assistenten schicken – er trägt es hier ein.</div>
          </div>
        </div>
        <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Unten einen Zugang „KI-Assistent“ erzeugen.</li>
          <li>In Claude: Einstellungen › Connectors › Eigenen Connector hinzufügen. In ChatGPT: Einstellungen › Connectors (Entwicklermodus).</li>
          <li>Als URL die angezeigte MCP-Adresse eintragen, Authentifizierung: keine.</li>
        </ol>
      </div>
      <div className="card pad stack">
        <div className="row">
          <span className="thumb" style={{ width: 44, height: 44 }}><House size={22} /></span>
          <div className="grow">
            <b>Home Assistant</b>
            <div className="small muted">Sensoren fürs Dashboard (knapp, MHD, Einkaufsliste, Kochidee), Push aufs Handy mit Knopf „Auf die Liste“.</div>
          </div>
        </div>
        <div className="small muted">Zugang „Home Assistant“ erzeugen – dann bekommst du ein fertiges Package zum Einfügen.</div>
      </div>
      {admin && (
        <div className="card pad stack">
          <b>Neuer Zugang</b>
          <div className="grid-2">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, z. B. Claude Till" />
            <Seg value={scope} onChange={(v) => { setScope(v); setName(v === 'ha' ? 'Home Assistant' : v === 'mcp' ? 'Claude' : 'Skript'); }} options={[['mcp', 'KI-Assistent'], ['ha', 'Home Assistant'], ['full', 'Voller API-Zugriff']]} />
          </div>
          <button className="btn primary" onClick={create}>
            <Key size={16} /> Erzeugen
          </button>
        </div>
      )}
      {created && (
        <div className="card pad stack" style={{ borderColor: 'var(--accent)' }}>
          <b>{created.name}: jetzt kopieren – wird nur einmal angezeigt</b>
          {created.scope !== 'ha' && (
            <div className="field">
              <label>MCP-Adresse (URL für Claude / ChatGPT)</label>
              <div className="row">
                <input className="input mono" readOnly value={`${base}/mcp/${created.token}`} />
                <button className="icon-btn" onClick={() => copy(`${base}/mcp/${created.token}`)}><Copy size={16} /></button>
              </div>
            </div>
          )}
          <div className="field">
            <label>Token (für Authorization: Bearer …)</label>
            <div className="row">
              <input className="input mono" readOnly value={created.token} />
              <button className="icon-btn" onClick={() => copy(created.token)}><Copy size={16} /></button>
            </div>
          </div>
          {yaml && (
            <div className="field">
              <label>Home-Assistant-Package (packages/stockwerk.yaml)</label>
              <div className="codebox">{yaml}</div>
              <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => copy(yaml)}><Copy size={14} /> YAML kopieren</button>
              <div className="help">Webhook-ID und notify-Dienst im YAML anpassen und dieselbe Webhook-URL unter „Benachrichtigungen“ eintragen.</div>
            </div>
          )}
        </div>
      )}
      {admin && (
        <section>
          <h2 style={{ marginBottom: 10 }}>Aktive Zugänge</h2>
          <div className="list">
            {(tokens.data ?? []).map((t) => (
              <div key={t.id} className="li">
                <div className="grow">
                  <div className="title">{t.name}</div>
                  <div className="sub mono">{t.prefix}… · {({ mcp: 'KI-Assistent', ha: 'Home Assistant', full: 'API' } as any)[t.scope]} · {t.last_used_at ? `zuletzt ${relTime(t.last_used_at)}` : 'nie benutzt'}</div>
                </div>
                <button className="icon-btn plain" onClick={() => confirm('Zugang widerrufen?') && del(`/tokens/${t.id}`).then(() => invalidate('tokens'))} aria-label="Widerrufen">
                  <Trash size={16} />
                </button>
              </div>
            ))}
            {(tokens.data ?? []).length === 0 && <div className="li muted small">Noch keine Zugänge.</div>}
          </div>
        </section>
      )}
      <div className="card pad small muted">
        Bilderkennung auf dem Server: {s.data?.features?.vision ? `aktiv (${s.data.features.visionModel})` : 'nicht eingerichtet – Fotos laufen dann über deinen KI-Assistenten'} · E-Mail: {s.data?.features?.email ? 'aktiv' : 'nicht eingerichtet'}
      </div>
    </div>
  );
}

function Data({ admin }: { admin: boolean }) {
  const s = useApi<any>('settings', '/settings');
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const importCsv = async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('min_count', '3');
      const r = await api('/imports/catalog-csv', { form: fd });
      toast({ text: `${r.created} Produkte angelegt, ${r.linked} verknüpft (aus ${r.distinct} Artikeln)` });
      invalidate('products', 'overview');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card pad stack">
        <div className="row between wrap">
          <div>
            <b>Import ohne Rückfrage</b>
            <div className="small muted">Bons, bei denen alles sicher erkannt wurde, direkt einbuchen. Ersatzartikel und Neues werden trotzdem vorgelegt.</div>
          </div>
          <Toggle on={Boolean(s.data?.importAutoApply)} onChange={(v) => patch('/settings', { importAutoApply: v }).then(() => invalidate('settings'))} />
        </div>
      </div>
      <div className="card pad stack">
        <b>Kaufhistorie importieren (CSV)</b>
        <div className="small muted">
          Zum Beispiel aus dem REWE-Datenexport (DSGVO-Auskunft): Artikel, die du mindestens dreimal gekauft hast, werden als Produkte angelegt – inklusive der Bon-Abkürzungen, damit künftige eBons sofort erkannt werden. Es wird kein Bestand gebucht.
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!admin || busy} onClick={() => fileRef.current?.click()}>
          <UploadSimple size={16} /> {busy ? 'Importiere …' : 'CSV wählen'}
        </button>
      </div>
      <div className="card pad stack">
        <b>Export</b>
        <div className="small muted">Alles als JSON – deine Daten gehören dir.</div>
        <a className="btn" style={{ alignSelf: 'flex-start' }} href="/api/export.json">Export herunterladen</a>
      </div>
      {admin && (
        <div className="card pad stack">
          <b>Neu anfangen</b>
          <div className="small muted">Löscht Produkte, Bestand, Rezepte, Importe und Bestellungen (z. B. die Demo-Daten). Orte, Kategorien, Mitglieder und Zugänge bleiben.</div>
          <button className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={() => confirm('Wirklich alles löschen?') && post('/demo/reset').then(() => { invalidate('overview', 'products', 'recipes', 'shopping', 'imports'); toast({ text: 'Alles leer – los geht’s' }); })}>
            <Trash size={16} /> Daten leeren
          </button>
        </div>
      )}
      <p className="small muted">
        Stockwerk ist Open Source (AGPL-3.0). Produktdaten und -bilder teilweise von Open Food Facts (ODbL / CC BY-SA). Nicht mit REWE, Thermomix/Vorwerk oder HelloFresh verbunden.
      </p>
    </div>
  );
}
