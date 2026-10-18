/**
 * Settings › Displays: read-only kitchen / hallway screens and e-ink frames.
 * The display link is shown once (with QR); afterwards only "last seen" and a new link.
 */
import { ArrowsClockwise, Copy, Image as ImageIcon, Monitor, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { del, invalidate, patch, post, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Empty, Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';

type Layout = 'kitchen' | 'hallway' | 'minimal';
type Widget = 'clock' | 'meals' | 'eat_first' | 'low' | 'shopping' | 'care';

interface Display {
  id: number;
  name: string;
  layout: Layout;
  widgets: Widget[];
  prefix: string;
  night_from: string | null;
  night_to: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_seen_via: 'screen' | 'image' | 'json' | null;
}
interface ListResp {
  displays: Display[];
  layouts: Record<Layout, Widget[]>;
  widgets: Widget[];
}
interface Created {
  display: Display;
  token: string;
  url: string;
  path: string;
  image_url: string;
}

const layoutLabel = (l: Layout) => ({ kitchen: t('Kitchen'), hallway: t('Hallway'), minimal: t('Minimal') })[l];
const layoutHint = (l: Layout) =>
  ({
    kitchen: t('Meal plan, eat first, low & out and the shopping list.'),
    hallway: t('Today’s meal, what’s due at home and the shopping list.'),
    minimal: t('Date, meals and the shopping list – calm, also for e-ink.'),
  })[l];
const widgetLabel = (w: Widget) =>
  ({
    clock: t('Clock, date & greeting'),
    meals: t('Meal plan (today & tomorrow)'),
    eat_first: t('Eat first'),
    low: t('Low & out'),
    shopping: t('Shopping list (count & top items)'),
    care: t('Due at home'),
  })[w];
const seenVia = (v: Display['last_seen_via']) => (v === 'image' ? t('as image') : v === 'json' ? t('as data') : t('as page'));

function useQrSvg(url: string | null) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    if (!url) return setSvg('');
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#17181a', light: '#ffffff' } }).then(setSvg).catch(() => setSvg(''));
  }, [url]);
  return svg;
}

export function Displays({ admin }: { admin: boolean }) {
  const q = useApi<ListResp>('displays', '/displays');
  const [editing, setEditing] = useState<Display | 'new' | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const toast = useToast();
  const list = q.data?.displays ?? [];

  const rotate = async (d: Display) => {
    if (!confirm(t('Create a new link for “{name}”? The old link stops working right away.', { name: d.name }))) return;
    try {
      setCreated(await post<Created>(`/displays/${d.id}/rotate`));
      invalidate('displays');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const remove = async (d: Display) => {
    if (!confirm(t('Revoke “{name}”? The screen shows an error from then on.', { name: d.name }))) return;
    await del(`/displays/${d.id}`).catch((e) => toast({ text: (e as Error).message, error: true }));
    invalidate('displays');
    toast({ text: t('Display revoked') });
  };

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="card pad stack">
        <div className="row">
          <span className="thumb" style={{ width: 44, height: 44 }}><Monitor size={22} /></span>
          <div className="grow">
            <b>{t('Displays for kitchen and hallway')}</b>
            <div className="small muted">
              {t('An old tablet on the fridge or by the door shows what’s for dinner, what to eat first and the shopping list – read-only, no login, updates by itself.')}
            </div>
          </div>
        </div>
        {admin && (
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing('new')}>
            <Plus size={16} /> {t('New display')}
          </button>
        )}
      </div>

      {created && <CreatedCard c={created} onClose={() => setCreated(null)} />}

      <section>
        <h2 style={{ marginBottom: 10 }}>{t('Your displays')}</h2>
        {q.isLoading ? (
          <Skeleton h={60} n={2} />
        ) : q.error ? (
          <div className="card pad small" role="alert">
            {t('Couldn’t load the displays.')} <button className="btn sm" onClick={() => q.refetch()}>{t('Try again')}</button>
          </div>
        ) : list.length === 0 ? (
          <Empty icon={<Monitor size={28} />} title={t('No displays yet')}>
            {admin ? t('Create one and open the link on the tablet.') : t('An admin can set one up here.')}
          </Empty>
        ) : (
          <div className="list">
            {list.map((d) => (
              <div key={d.id} className="li">
                <span className="thumb" style={{ width: 40, height: 40 }}><Monitor size={20} /></span>
                <div className="grow">
                  <div className="title">{d.name}</div>
                  <div className="sub" style={{ whiteSpace: 'normal' }}>
                    {layoutLabel(d.layout)} · {d.last_seen_at ? t('last seen {when} ({via})', { when: relTime(d.last_seen_at), via: seenVia(d.last_seen_via) }) : t('not opened yet')}
                    {d.night_from && d.night_to ? ` · ${t('dims {from}–{to}', { from: d.night_from, to: d.night_to })}` : ''}
                  </div>
                </div>
                {admin && (
                  <div className="row" style={{ gap: 4 }}>
                    <button className="icon-btn plain" onClick={() => setEditing(d)} aria-label={t('Edit')} title={t('Edit')}><PencilSimple size={16} /></button>
                    <button className="icon-btn plain" onClick={() => rotate(d)} aria-label={t('New link')} title={t('New link')}><ArrowsClockwise size={16} /></button>
                    <button className="icon-btn plain" onClick={() => remove(d)} aria-label={t('Revoke')} title={t('Revoke')}><Trash size={16} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <HaHelp />

      {editing && q.data && (
        <DisplaySheet
          d={editing === 'new' ? null : editing}
          layouts={q.data.layouts}
          all={q.data.widgets}
          onClose={() => setEditing(null)}
          onCreated={(c) => {
            setEditing(null);
            setCreated(c);
          }}
        />
      )}
    </div>
  );
}

function DisplaySheet({ d, layouts, all, onClose, onCreated }: { d: Display | null; layouts: Record<Layout, Widget[]>; all: Widget[]; onClose: () => void; onCreated: (c: Created) => void }) {
  const [name, setName] = useState(d?.name ?? t('Kitchen'));
  const [layout, setLayout] = useState<Layout>(d?.layout ?? 'kitchen');
  const [widgets, setWidgets] = useState<Widget[]>(d?.widgets ?? layouts.kitchen);
  const [night, setNight] = useState(d ? Boolean(d.night_from && d.night_to) : true);
  const [from, setFrom] = useState(d?.night_from ?? '22:00');
  const [to, setTo] = useState(d?.night_to ?? '06:00');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const pickLayout = (l: Layout) => {
    setLayout(l);
    setWidgets(layouts[l]);
    if (name === layoutLabel(layout)) setName(layoutLabel(l));
  };
  const toggle = (w: Widget, on: boolean) => setWidgets((ws) => (on ? [...ws, w] : ws.filter((x) => x !== w)));
  const save = async () => {
    setBusy(true);
    const body = { name: name.trim(), layout, widgets, night_from: night ? from : null, night_to: night ? to : null };
    try {
      if (d) {
        await patch(`/displays/${d.id}`, body);
        toast({ text: t('Saved – the screen updates by itself.') });
        onClose();
      } else onCreated(await post<Created>('/displays', body));
      invalidate('displays');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={d ? t('Edit display') : t('New display')}
      footer={
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary grow" disabled={busy || !name.trim()} onClick={save}>{d ? t('Save') : t('Create display')}</button>
        </div>
      }
    >
      <div className="stack">
        <div className="field">
          <label>{t('Name')}</label>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Kitchen tablet')} />
        </div>
        <div className="field">
          <label>{t('Layout')}</label>
          <Seg value={layout} onChange={pickLayout} options={[['kitchen', layoutLabel('kitchen')], ['hallway', layoutLabel('hallway')], ['minimal', layoutLabel('minimal')]]} />
          <div className="help">{layoutHint(layout)}</div>
        </div>
        <div className="field">
          <label>{t('What it shows')}</label>
          <div className="stack" style={{ gap: 10 }}>
            {all.map((w) => (
              <div key={w} className="row between">
                <span>{widgetLabel(w)}</span>
                <Toggle on={widgets.includes(w)} onChange={(v) => toggle(w, v)} label={widgetLabel(w)} />
              </div>
            ))}
          </div>
          <div className="help">{t('Never shown: guest names, notes, spending. Member names only if names are shown on the sign-in screen.')}</div>
        </div>
        <div className="field">
          <div className="row between">
            <label style={{ margin: 0 }}>{t('Dim at night')}</label>
            <Toggle on={night} onChange={setNight} label={t('Dim at night')} />
          </div>
          {night && (
            <div className="row" style={{ gap: 10 }}>
              <input className="input" type="time" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={t('from')} />
              <span className="muted">–</span>
              <input className="input" type="time" value={to} onChange={(e) => setTo(e.target.value)} aria-label={t('until')} />
            </div>
          )}
          <div className="help">{t('The screen gets darker in these hours; a tap brightens it for 30 seconds.')}</div>
        </div>
      </div>
    </Sheet>
  );
}

function CreatedCard({ c, onClose }: { c: Created; onClose: () => void }) {
  const svg = useQrSvg(c.url);
  const toast = useToast();
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast({ text: t('Copied') }), () => toast({ text: t('Couldn’t copy – select the text instead.'), error: true }));
  const yaml = haYaml(c.image_url.replace('mode=gray', 'mode=color'));
  return (
    <div className="card pad stack" style={{ borderColor: 'var(--accent)' }}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <b>{t('{name}: open this link on the tablet – shown only once', { name: c.display.name })}</b>
        <button className="btn sm ghost" style={{ flex: 'none' }} onClick={onClose}>{t('Close')}</button>
      </div>
      <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div className="qr" style={{ width: 160, height: 160, flex: 'none', background: '#fff', borderRadius: 12, padding: 6 }} dangerouslySetInnerHTML={{ __html: svg }} aria-label={t('QR code of the display link')} />
        <div className="stack grow" style={{ minWidth: 220 }}>
          <div className="field">
            <label>{t('Display link')}</label>
            <div className="row">
              <input className="input mono" readOnly value={c.url} onFocus={(e) => e.target.select()} />
              <button className="icon-btn" onClick={() => copy(c.url)} aria-label={t('Copy')}><Copy size={16} /></button>
            </div>
          </div>
          <div className="field">
            <label>{t('Image for e-ink frames and Home Assistant')}</label>
            <div className="row">
              <input className="input mono" readOnly value={c.image_url} onFocus={(e) => e.target.select()} />
              <button className="icon-btn" onClick={() => copy(c.image_url)} aria-label={t('Copy')}><Copy size={16} /></button>
            </div>
            <div className="help">{t('Change w and h to your screen size; mode=bw for black-and-white e-ink, gray for greyscale, color for Home Assistant.')}</div>
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <a className="btn sm" href={c.path} target="_blank" rel="noreferrer"><Monitor size={14} /> {t('Open display')}</a>
            <a className="btn sm" href={c.image_url} target="_blank" rel="noreferrer"><ImageIcon size={14} /> {t('Preview image')}</a>
          </div>
        </div>
      </div>
      <div className="field">
        <label>{t('Home Assistant (configuration.yaml)')}</label>
        <div className="codebox">{yaml}</div>
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => copy(yaml)}><Copy size={14} /> {t('Copy YAML')}</button>
      </div>
      <div className="small muted">{t('Tip for tablets: add the page to the home screen, switch auto-lock off and keep the charger plugged in.')}</div>
    </div>
  );
}

function haYaml(imageUrl: string) {
  return `# ${t('Image entity – shows up as image.tohuus_display')}
template:
  - image:
      - name: "ToHuus display"
        url: "${imageUrl}"

# ${t('Or as a dashboard card (no YAML file needed):')}
# type: picture
# image: "${imageUrl}"

# ESPHome e-paper (${t('replace w/h with your panel size')}):
# online_image:
#   - id: tohuus_display
#     url: "${imageUrl.replace(/w=\d+&h=\d+&mode=\w+/, 'w=800&h=480&mode=bw')}"
#     format: PNG
#     type: BINARY
#     update_interval: 15min`;
}

function HaHelp() {
  return (
    <details className="card pad">
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('E-ink frames and Home Assistant')}</summary>
      <div className="stack small" style={{ marginTop: 12 }}>
        <p style={{ margin: 0 }}>
          {t('Every display also exists as a PNG image: /api/display/<link>/image.png?w=800&h=480&mode=bw. It works with TRMNL (image plugin), Inkplate, ESPHome e-paper and Home Assistant.')}
        </p>
        <div className="codebox">{haYaml('https://your-host/api/display/<display-link>/image.png?w=800&h=480&mode=color')}</div>
        <p className="muted" style={{ margin: 0 }}>{t('The link is shown only once. Lost it? Use “New link” next to the display.')}</p>
      </div>
    </details>
  );
}
