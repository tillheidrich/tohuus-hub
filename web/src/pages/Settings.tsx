import { Bell, Copy, Key, Plug, Question, SignOut, Trash, UploadSimple } from '@phosphor-icons/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { Me } from '../App';
import { api, del, invalidate, patch, post, relTime, useApi } from '../api';
import { Seg, Skeleton, Toggle, useToast } from '../ui';
import { LANGUAGE_OPTIONS, lang, setLang, t } from '../i18n';
import { Backups, Members } from './DataSettings';
import { DataReset, TourButton } from './Tour';
import { MyAccount, SignInAdmin } from './AuthSettings';
import { HaTodoCard, PushCard } from '../shop/ShopSettings';
import { InboxSettingsCard } from './Retail';
import { KidsSettings } from './KidsSettings';
import { MyPerson, PeopleSection } from '../people/People';
import { ChannelsSettings, useChannelColumns } from './Channels';
import { Displays } from './Displays';
import { RegionCard } from './RegionSettings';
import { HaCreated, HaIntegrationCard } from './HaIntegration';
import { Ha2Settings } from './Ha2';
import { CookidooWays } from './CookidooStatus';
import { PrintSettings } from './Bons';
import { RecipeImportCenter } from './RecipeImports';
import { AwayEntryCard } from './Away';
import { ShareSetupCard, StartModeCard } from './Share';
import { MenuSettingsCard } from './Menu';
import { HouseholdAppearanceCard, MyAppearanceCard } from './AppearanceSettings';
import { CategorySettings, HouseholdFormCard, PlacesSettings } from './PlacesSettings';
import { useHousehold } from '../household';

type Tab = 'home' | 'account' | 'members' | 'places' | 'notify' | 'access' | 'ha' | 'displays' | 'print' | 'recipes' | 'data';

export function Settings({ me }: { me: Me }) {
  const TABS: Tab[] = ['home', 'account', 'members', 'places', 'notify', 'access', 'ha', 'displays', 'print', 'recipes', 'data'];
  const tabFrom = (search: string): Tab => {
    const q = new URLSearchParams(search).get('tab') as Tab | null;
    if (me.actor.houseGuest) return 'account';
    return q && TABS.includes(q) ? q : 'home';
  };
  const loc = useLocation();
  const [tab, setTab] = useState<Tab>(() => tabFrom(loc.search));
  // links to another tab while Settings is already open (demo banner, share card …) only change the URL
  useEffect(() => {
    if (new URLSearchParams(loc.search).get('tab')) setTab(tabFrom(loc.search));
  }, [loc.search]);
  const nav = useNavigate();
  const admin = me.actor.role === 'admin';
  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{me.household}</div>
          <h1>{t('Settings')}</h1>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => nav('/hilfe')}>
            <Question size={16} /> {t('Help')}
          </button>
          {!me.actor.houseGuest && <TourButton />}
          <button className="btn ghost" onClick={() => post('/auth/logout').then(() => invalidate('me'))}>
            <SignOut size={16} /> {t('Sign out')}
          </button>
        </div>
      </header>
      <div className="tabs-inline">
        {(
          [
            ['home', t('Household')],
            ['account', t('My account')],
            ['members', t('Members')],
            ['places', t('Places & categories')],
            ['notify', t('Notifications')],
            ['access', t('Access & AI')],
            ['ha', 'Home Assistant'],
            ['displays', t('Displays')],
            ['print', t('Printers & tickets')],
            ['recipes', t('Recipes')],
            ['data', t('Data & backups')],
          ] as [Tab, string][]
        )
          // permanent guests: only their own account (area: people)
          .filter(([k]) => !me.actor.houseGuest || k === 'account')
          .map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); nav({ search: `?tab=${k}` }, { replace: true }); }}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'home' && <Household me={me} admin={admin} />}
      {tab === 'home' && <AwayEntryCard />}
      {tab === 'home' && <MenuSettingsCard />}
      {tab === 'account' && <MyPerson me={me} />}
      {tab === 'account' && !me.actor.houseGuest && <MyAppearanceCard />}
      {tab === 'account' && <MyAccount me={me} />}
      {tab === 'account' && !me.actor.houseGuest && <ShareSetupCard me={me} />}
      {tab === 'members' && <PeopleSection me={me} admin={admin} />}
      {tab === 'members' && <Members me={me} admin={admin} />}
      {tab === 'members' && admin && <SignInAdmin me={me} />}
      {tab === 'members' && <KidsSection admin={admin} />}
      {tab === 'places' && <PlacesSettings admin={admin} />}
      {tab === 'places' && <CategorySettings admin={admin} />}
      {tab === 'notify' && <Notify admin={admin} />}
      {tab === 'access' && <Access admin={admin} />}
      {tab === 'ha' && <Ha2Settings admin={admin} />}
      {tab === 'displays' && <Displays admin={admin} />}
      {tab === 'print' && <PrintSettings admin={admin} />}
      {tab === 'recipes' && <RecipeImportCenter />}
      {tab === 'data' && <Data admin={admin} />}
    </div>
  );
}

function Household({ me, admin }: { me: Me; admin: boolean }) {
  const s = useApi<any>('settings', '/settings');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const toast = useToast();
  useEffect(() => setName(s.data?.household ?? ''), [s.data]);
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="card pad stack">
        <div className="field">
          <label>{t('Household name')}</label>
          <div className="row">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!admin} />
            {admin && <button className="btn" onClick={() => patch('/settings', { household: name }).then(() => { invalidate('me', 'settings', 'overview'); toast({ text: t('Saved') }); })}>{t('Save')}</button>}
          </div>
        </div>
        <HouseholdAppearanceCard admin={admin} />
        <div className="field">
          <label>{t('Language')}</label>
          <Seg
            value={(s.data?.language ?? lang()) as string}
            onChange={(v) => {
              if (!admin) return;
              patch('/settings', { language: v }).then(() => {
                setLang(v);
                location.reload();
              });
            }}
            options={LANGUAGE_OPTIONS}
          />
        </div>
        <div className="field">
          <label>{t('Change my password')}</label>
          <div className="row">
            <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('New password (at least 8 characters)')} autoComplete="new-password" minLength={8} />
            <button className="btn" disabled={pw.length < 8} onClick={() => patch(`/users/${me.actor.userId}`, { password: pw }).then(() => { setPw(''); toast({ text: t('Password changed') }); }).catch((e) => toast({ text: e.message, error: true }))}>{t('Change')}</button>
          </div>
        </div>
      </div>
      <HouseholdFormCard admin={admin} />
      <RegionCard admin={admin} />
      <StartModeCard admin={admin} />
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  'stock.low': 'Something is running low',
  'stock.empty': 'Something has run out',
  'stock.expiring': 'Best-before date coming up',
  'import.review': 'Import waiting for review',
  'order.new': 'Someone would love something (home, guests, party)',
  'order.status': 'Answer to your wish (only to you)',
  'shopping.added': 'New item on the shopping list',
  'digest.daily': 'Daily digest (once a day)',
  'care.due': 'Home care task due',
  'kids.wish': 'A kid wishes for something',
  'auth.new_device': 'New sign-in on another device (only to that member)',
  'budget.warning': 'Spending budget at 80 % or reached',
  'plan.vote': 'Family food vote started or decided',
  'plan.rotation': 'Next week filled from the rotation',
};

function Notify({ admin }: { admin: boolean }) {
  const s = useApi<any>('settings', '/settings');
  const log = useApi<any[]>('notifications', '/notifications');
  const [n, setN] = useState<any>(null);
  const toast = useToast();
  const extraCols = useChannelColumns();
  useEffect(() => s.data && setN(s.data.notify), [s.data]);
  if (!n) return <Skeleton n={4} />;
  const save = async (next = n) => {
    await patch('/settings', { notify: next });
    invalidate('settings');
    toast({ text: t('Saved') });
  };
  const setEv = (ev: string, ch: string, v: boolean) => setN((x: any) => ({ ...x, events: { ...x.events, [ev]: { ...x.events[ev], [ch]: v } } }));
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="card pad stack">
        <div className="field">
          <label>{t('Home Assistant – webhook URL')}</label>
          <input className="input" value={n.haWebhookUrl} onChange={(e) => setN({ ...n, haWebhookUrl: e.target.value })} placeholder="https://ha.example.de/api/webhook/tohuus_…" disabled={!admin} />
          <div className="help">{t('ToHuus Hub sends events as JSON (title, message, url, data). You’ll find a ready-made automation under “Access & AI”.')}</div>
        </div>
        <div className="field">
          <label>{t('ntfy topic (optional)')}</label>
          <input className="input" value={n.ntfyUrl} onChange={(e) => setN({ ...n, ntfyUrl: e.target.value })} placeholder={t('https://ntfy.sh/my-secret-topic')} disabled={!admin} />
        </div>
        <div className="field">
          <label>{t('Another webhook (n8n, Node-RED …)')}</label>
          <input className="input" value={n.webhookUrl} onChange={(e) => setN({ ...n, webhookUrl: e.target.value })} placeholder="https://…" disabled={!admin} />
        </div>
        <div className="field">
          <label>{t('Email to')}</label>
          <input className="input" value={n.emailTo} onChange={(e) => setN({ ...n, emailTo: e.target.value })} placeholder={t('us@example.com, second@example.com')} disabled={!admin} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>{t('Daily digest at')}</label>
            <select className="input" value={n.digestHour} onChange={(e) => setN({ ...n, digestHour: Number(e.target.value) })} disabled={!admin}>
              <option value={-1}>{t('off')}</option>
              {Array.from({ length: 24 }).map((_, h) => (
                <option key={h} value={h}>{t('{h}:00', { h })}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t('Best-before warning')}</label>
            <select className="input" value={n.expiryWarnDays} onChange={(e) => setN({ ...n, expiryWarnDays: Number(e.target.value) })} disabled={!admin}>
              {[1, 2, 3, 5, 7].map((d) => (
                <option key={d} value={d}>{t(d === 1 ? '{n} day before' : '{n} days before', { n: d })}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row between">
          <div>
            <b>{t('Add low items to the shopping list automatically')}</b>
            <div className="small muted">{t('as soon as they drop below the minimum')}</div>
          </div>
          <Toggle on={n.autoShoppingList} onChange={(v) => setN({ ...n, autoShoppingList: v })} />
        </div>
      </div>
      <PushCard />
      <ChannelsSettings admin={admin} eventLabels={EVENT_LABEL} />
      <section>
        <h2 style={{ marginBottom: 10 }}>{t('What goes where?')}</h2>
        <div className="card notify-matrix-wrap" style={{ overflowX: 'auto' }}>
          <table className="table notify-matrix">
            <thead>
              <tr>
                <th>{t('Event')}</th>
                <th>Home Assistant</th>
                <th>ntfy</th>
                <th>Webhook</th>
                <th>{t('Email')}</th>
                <th>{t('Push')}</th>
                {extraCols.map(([k, l]) => (
                  <th key={k}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(EVENT_LABEL).map((ev) => (
                <tr key={ev}>
                  <td>{t(EVENT_LABEL[ev])}</td>
                  {['ha', 'ntfy', 'webhook', 'email', 'push', ...extraCols.map(([k]) => k)].map((ch) => (
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
          <button className="btn" onClick={async () => { await save(); const r = await post('/settings/test-notification'); toast({ text: r.channels.length ? t('Test sent: {channels}', { channels: r.channels.join(', ') }) : t('No channel responded – check the URLs') }); invalidate('notifications'); }}>
            <Bell size={16} /> {t('Test')}
          </button>
          <div className="grow" />
          <button className="btn primary" onClick={() => save()}>{t('Save')}</button>
        </div>
      )}
      <section>
        <h2 style={{ marginBottom: 10 }}>{t('Recently sent')}</h2>
        <div className="list">
          {(log.data ?? []).slice(0, 12).map((x) => {
            const ch = JSON.parse(x.channels || '[]') as { channel: string; ok: boolean }[];
            return (
              <div key={x.id} className="li" style={{ minHeight: 52 }}>
                <div className="grow">
                  <div className="title small">{x.title}</div>
                  <div className="sub">{ch.length ? ch.map((c) => `${c.channel} ${c.ok ? '✓' : '✗'}`).join(' · ') : t('in the app only')}</div>
                </div>
                <span className="small muted">{relTime(x.created_at)}</span>
              </div>
            );
          })}
          {(log.data ?? []).length === 0 && <div className="li muted small">{t('Nothing yet.')}</div>}
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
    setYaml('');
    if (scope === 'ha') setYaml(await post('/ha/package.yaml', { token: r.token }));
  };
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast({ text: t('Copied') }));
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="card pad stack">
        <div className="row">
          <span className="thumb" style={{ width: 44, height: 44 }}><Plug size={22} /></span>
          <div className="grow">
            <b>{t('Claude, ChatGPT & co. (MCP)')}</b>
            <div className="small muted">{t('Send photos of receipts, your freezer or HelloFresh cards to your assistant – it adds everything here.')}</div>
          </div>
        </div>
        <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>{t('Create an “AI assistant” access below.')}</li>
          <li>{t('In Claude: Settings › Connectors › Add custom connector. In ChatGPT: Settings › Connectors (developer mode).')}</li>
          <li>{t('Enter the MCP address shown as the URL, authentication: none.')}</li>
        </ol>
      </div>
      <HaIntegrationCard base={base} />
      {admin && s.data && <HaConnection initial={s.data.ha} />}
      {admin && s.data && <HaTodoCard />}
      {admin && <InboxSettingsCard />}
      {admin && (
        <div className="card pad stack">
          <b>{t('New access')}</b>
          <div className="grid-2">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Name, e.g. Claude Till')} />
            <Seg value={scope} onChange={(v) => { setScope(v); setName(v === 'ha' ? 'Home Assistant' : v === 'mcp' ? 'Claude' : t('Script')); }} options={[['mcp', t('AI assistant')], ['ha', 'Home Assistant'], ['full', t('Full API access')]]} />
          </div>
          <button className="btn primary" onClick={create}>
            <Key size={16} /> {t('Generate')}
          </button>
        </div>
      )}
      {created && (
        <div className="card pad stack" style={{ borderColor: 'var(--accent)' }}>
          <b>{t('{name}: copy it now – shown only once', { name: created.name })}</b>
          {created.scope !== 'ha' && (
            <div className="field">
              <label>{t('MCP address (URL for Claude / ChatGPT)')}</label>
              <div className="row">
                <input className="input mono" readOnly value={`${base}/mcp/${created.token}`} />
                <button className="icon-btn" onClick={() => copy(`${base}/mcp/${created.token}`)}><Copy size={16} /></button>
              </div>
            </div>
          )}
          <div className="field">
            <label>{t('Token (for Authorization: Bearer …)')}</label>
            <div className="row">
              <input className="input mono" readOnly value={created.token} />
              <button className="icon-btn" onClick={() => copy(created.token)}><Copy size={16} /></button>
            </div>
          </div>
          {created.scope === 'ha' && <HaCreated base={base} yaml={yaml} />}
        </div>
      )}
      {admin && (
        <section>
          <h2 style={{ marginBottom: 10 }}>{t('Active access')}</h2>
          <div className="list">
            {(tokens.data ?? []).map((tk) => (
              <div key={tk.id} className="li">
                <div className="grow">
                  <div className="title">{tk.name}</div>
                  <div className="sub mono">{tk.prefix}… · {({ mcp: t('AI assistant'), ha: 'Home Assistant', full: 'API' } as any)[tk.scope]} · {tk.last_used_at ? t('last used {when}', { when: relTime(tk.last_used_at) }) : t('never used')}</div>
                </div>
                <button className="icon-btn plain" onClick={() => confirm(t('Revoke access?')) && del(`/tokens/${tk.id}`).then(() => invalidate('tokens'))} aria-label={t('Revoke')}>
                  <Trash size={16} />
                </button>
              </div>
            ))}
            {(tokens.data ?? []).length === 0 && <div className="li muted small">{t('No access yet.')}</div>}
          </div>
        </section>
      )}
      <div className="card pad small muted">
        {t('Image recognition on the server:')} {s.data?.features?.vision ? t('active ({model})', { model: s.data.features.visionModel }) : t('not set up – photos then go through your AI assistant')} · {t('Email:')} {s.data?.features?.email ? t('active') : t('not set up')}
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
      toast({ text: t('{created} products created, {linked} linked (from {distinct} items)', { created: r.created, linked: r.linked, distinct: r.distinct }) });
      invalidate('products', 'overview');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Backups admin={admin} />
      <div className="card pad stack">
        <div className="row between wrap">
          <div>
            <b>{t('Import without asking')}</b>
            <div className="small muted">{t('Book receipts straight in when everything was recognised with confidence. Substitutes and new items are still shown for review.')}</div>
          </div>
          <Toggle on={Boolean(s.data?.importAutoApply)} onChange={(v) => patch('/settings', { importAutoApply: v }).then(() => invalidate('settings'))} />
        </div>
      </div>
      <div className="card pad stack">
        <b>{t('Import purchase history (CSV)')}</b>
        <div className="small muted">
          {t('For example from the REWE data export (GDPR request): items you’ve bought at least three times are created as products – including the receipt abbreviations, so future e-receipts are recognised right away. No stock is booked.')}
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!admin || busy} onClick={() => fileRef.current?.click()}>
          <UploadSimple size={16} /> {busy ? t('Importing …') : t('Choose CSV')}
        </button>
      </div>
      <div className="card pad stack">
        <b>{t('Export')}</b>
        <div className="small muted">{t('Everything as JSON – your data belongs to you. Passwords and access keys are never included.')}</div>
        <a className="btn" style={{ alignSelf: 'flex-start' }} href="/api/export.json">{t('Download export')}</a>
      </div>
      <DataReset admin={admin} />
      <p className="small muted">
        {t('ToHuus Hub is open source (AGPL-3.0). Some product data and images from Open Food Facts (ODbL / CC BY-SA). Not affiliated with REWE, Thermomix/Vorwerk or HelloFresh.')}
      </p>
    </div>
  );
}

function HaConnection({ initial }: { initial: { url: string; token: string; cookidooCalendar: string } }) {
  const [h, setH] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async (sync: boolean) => {
    setBusy(true);
    try {
      await patch('/settings', { ha: h });
      invalidate('settings');
      if (sync) {
        const r = await post('/plan/cookidoo-sync', {});
        if (r.error) throw new Error(r.error);
        toast({ text: t('Cookidoo: {events} entries read, {added} new in the meal plan', { events: r.events, added: r.added }) });
      } else toast({ text: t('Saved') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card pad stack">
      <div>
        <b>{t('Cookidoo meal plan via Home Assistant')}</b>
        <div className="small muted">
          {t('Cookidoo has no open API, but the Home Assistant “Cookidoo” integration shows “My week” as a calendar. There are two ways to get the planned dishes into the meal plan:')}
        </div>
      </div>
      <CookidooWays />
      <div className="field">
        <label>{t('Home Assistant address')}</label>
        <input className="input" value={h.url} onChange={(e) => setH({ ...h, url: e.target.value })} placeholder="https://ha.example.de" inputMode="url" />
      </div>
      <div className="field">
        <label>{t('Long-lived access token')}</label>
        <input className="input mono" type="password" value={h.token} onChange={(e) => setH({ ...h, token: e.target.value })} placeholder={t('In HA: Profile › Security › Create token')} />
      </div>
      <div className="field">
        <label>{t('Calendar entity')}</label>
        <input className="input mono" value={h.cookidooCalendar} onChange={(e) => setH({ ...h, cookidooCalendar: e.target.value })} />
        <div className="help">{t('Integration default: {entity}', { entity: 'calendar.cookidoo_speiseplan' })}</div>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn" disabled={busy} onClick={() => save(false)}>{t('Save')}</button>
        <button className="btn primary" disabled={busy || !h.url || !h.token} onClick={() => save(true)}>{t('Save & sync')}</button>
      </div>
    </div>
  );
}

/** Kids only where the household form says so (area: home) – one tap shows it anyway, nothing is locked. */
function KidsSection({ admin }: { admin: boolean }) {
  const home = useHousehold();
  const [show, setShow] = useState(false);
  if (home.ui.kids || show) return <KidsSettings admin={admin} />;
  return (
    <button className="linkish" style={{ marginTop: 12 }} onClick={() => setShow(true)}>
      {t('Children in the household? Show the kids section')}
    </button>
  );
}
