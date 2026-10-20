/**
 * "Bons": receipt-style tickets – preview, print on a thermal printer, share as an image, send as a digital
 * receipt (Telegram, Matrix, Gotify, e-mail), print from the browser; plus Settings › Connections & devices › Printers.
 */
import { Bluetooth, CalendarBlank, Check, DownloadSimple, Note, PaperPlaneTilt, PencilSimple, Plus, Printer, Receipt, ShareNetwork, ShoppingCart, Trash, Warning } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { del, invalidate, patch, post, put, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Empty, Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';

export type BonType = 'shopping' | 'order' | 'care' | 'wish' | 'recipe' | 'week' | 'note' | 'test';
export interface BonSpec {
  type: BonType;
  id?: number | null;
  store_id?: number | null;
  text?: string | null;
  title?: string | null;
  day?: string | null;
}
type Paper = 58 | 80;
type Channel = 'telegram' | 'matrix' | 'gotify' | 'email';

interface PrinterRow {
  id: number;
  name: string;
  host: string;
  port: number;
  paper: Paper;
  mode: 'raster' | 'text';
  codepage: 'cp858' | 'cp1252';
  cut: 'partial' | 'full' | 'none';
  darkness: number;
  feed_lines: number;
  auto_orders: 'off' | 'all';
  auto_care: boolean;
  is_default: boolean;
  last_ok_at: string | null;
  last_error: string | null;
}
interface PrintInfo {
  printers: PrinterRow[];
  settings: { paper: Paper; quietFrom: string; quietTo: string };
  channels: Record<Channel, boolean>;
  members: { id: number; name: string; color: string; has_email: boolean; has_telegram: boolean }[];
  jobs: { id: number; kind: BonType; ref: string | null; target: string; ok: number; error: string | null; actor: string | null; created_at: string; printer: string | null }[];
}

const CHANNELS: Channel[] = ['telegram', 'matrix', 'gotify', 'email'];
const channelLabel = (c: Channel | string) => ({ telegram: 'Telegram', matrix: 'Matrix', gotify: 'Gotify', email: t('E-mail'), printer: t('Printer') })[c] ?? c;
export const bonTypeLabel = (b: BonType) =>
  ({
    shopping: t('Shopping slip'),
    order: t('Kitchen ticket'),
    care: t('Care ticket'),
    wish: t('Wish ticket'),
    recipe: t('Recipe card'),
    week: t('Week plan'),
    note: t('Fridge note'),
    test: t('Test print'),
  })[b];

function query(spec: BonSpec, paper?: Paper) {
  const q = new URLSearchParams({ type: spec.type });
  for (const k of ['id', 'store_id', 'text', 'title', 'day'] as const) if (spec[k] != null && spec[k] !== '') q.set(k, String(spec[k]));
  if (paper) q.set('paper', String(paper));
  return q.toString();
}

async function fetchPng(spec: BonSpec, paper: Paper): Promise<Blob> {
  const r = await fetch(`/api/print/ticket.png?${query(spec, paper)}`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? t('Couldn’t create the ticket.'));
  return r.blob();
}

// ---------------------------------------------------------------- button + sheet

/** Opens the ticket sheet. Without `label` it is a round icon button. */
export function BonButton({ spec, label, className }: { spec: BonSpec; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className ?? (label ? 'btn sm' : 'icon-btn')}
        onClick={() => setOpen(true)}
        aria-label={label ?? t('Print or send as a ticket')}
        title={t('Print or send as a ticket')}
      >
        <Receipt size={label ? 16 : 18} />
        {label ? ` ${label}` : null}
      </button>
      {open && <BonSheet spec={spec} onClose={() => setOpen(false)} />}
    </>
  );
}

export function BonSheet({ spec, onClose }: { spec: BonSpec; onClose: () => void }) {
  const info = useApi<PrintInfo>('print-info', '/print/info');
  const printers = info.data?.printers ?? [];
  const [printerId, setPrinterId] = useState<number | null>(null);
  const printer = printers.find((p) => p.id === printerId) ?? printers[0] ?? null;
  const [paper, setPaper] = useState<Paper | null>(null);
  const effPaper: Paper = paper ?? printer?.paper ?? info.data?.settings.paper ?? 58;
  const [img, setImg] = useState<{ state: 'loading' | 'ok' | 'error'; w: number; h: number; error?: string }>({ state: 'loading', w: 0, h: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const [member, setMember] = useState<number | null>(null);
  const toast = useToast();
  const src = useMemo(() => `/api/print/ticket.png?${query(spec, effPaper)}`, [spec, effPaper]);
  useEffect(() => setImg({ state: 'loading', w: 0, h: 0 }), [src]);
  const title = spec.type === 'note' && spec.title ? spec.title : bonTypeLabel(spec.type);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const msg = await fn();
      if (msg) toast({ text: msg });
      invalidate('print-info');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };

  const doPrint = () =>
    run('print', async () => {
      const r = await post<{ printer: string }>('/print/print', { ...spec, printer_id: printer?.id });
      return t('Printing on {name}', { name: r.printer });
    });

  const share = () =>
    run('share', async () => {
      const blob = await fetchPng(spec, effPaper);
      const file = new File([blob], `${spec.type}.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title });
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${spec.type}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return t('Saved as image');
    });

  const send = (channel: Channel) =>
    run(channel, async () => {
      await post('/print/send', { ...spec, channel, member_id: member, paper: effPaper });
      return t('Sent via {channel}', { channel: channelLabel(channel) });
    });

  const ble = () => run('ble', async () => (await printBluetooth(spec, effPaper)) ?? undefined);

  const memberOk = (c: Channel) => {
    if (!member) return true;
    const m = info.data?.members.find((x) => x.id === member);
    return c === 'telegram' ? Boolean(m?.has_telegram) : c === 'email' ? Boolean(m?.has_email) : false;
  };
  const channels = CHANNELS.filter((c) => info.data?.channels[c]);
  const hasBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="stack bon-sheet">
        <div className="row between" style={{ gap: 10 }}>
          <Seg value={String(effPaper) as '58' | '80'} onChange={(v) => setPaper(Number(v) as Paper)} options={[['58', '58 mm'], ['80', '80 mm']]} />
          <span className="small muted">{t('No prices – not a till receipt')}</span>
        </div>

        <div className="bon-preview" aria-busy={img.state === 'loading'}>
          {img.state === 'error' ? (
            <div className="bon-preview-error">
              <Warning size={22} />
              <span>{img.error ?? t('Couldn’t create the ticket.')}</span>
            </div>
          ) : (
            <img
              key={src}
              src={src}
              alt={title}
              className={img.state === 'ok' ? 'on' : ''}
              onLoad={(e) => setImg({ state: 'ok', w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              onError={() => fetchPng(spec, effPaper).then(() => setImg({ state: 'error', w: 0, h: 0 }), (e: Error) => setImg({ state: 'error', w: 0, h: 0, error: e.message }))}
            />
          )}
          {img.state === 'loading' && <div className="bon-preview-loading" />}
        </div>

        {info.isLoading ? (
          <Skeleton h={48} n={2} />
        ) : (
          <>
            {printers.length > 0 ? (
              <div className="stack" style={{ gap: 8 }}>
                {printers.length > 1 && (
                  <div className="bon-chips" role="radiogroup" aria-label={t('Printer')}>
                    {printers.map((p) => (
                      <button key={p.id} type="button" role="radio" aria-checked={printer?.id === p.id} className={printer?.id === p.id ? 'on' : ''} onClick={() => setPrinterId(p.id)}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
                <button className="btn primary block lg" disabled={!!busy || img.state === 'error'} onClick={doPrint}>
                  <Printer size={18} /> {busy === 'print' ? t('Printing …') : t('Print on {name}', { name: printer!.name })}
                </button>
              </div>
            ) : (
              <p className="small muted bon-hint">
                <Printer size={16} />
                <span>
                  {t('Got a receipt printer? Add it under Settings › Connections & devices › Printers – until then, share or print from the browser.')}{' '}
                  <Link to="/einstellungen/verbindungen/drucker" onClick={onClose}>{t('Set up a printer')}</Link>
                </span>
              </p>
            )}

            <div className="bon-actions">
              <button className="btn" disabled={!!busy || img.state !== 'ok'} onClick={share}>
                <ShareNetwork size={16} /> {t('Share image')}
              </button>
              <button className="btn" disabled={img.state !== 'ok'} onClick={() => window.print()}>
                <DownloadSimple size={16} /> {t('Browser print / PDF')}
              </button>
              {hasBluetooth && (
                <button className="btn ghost" disabled={!!busy} onClick={ble} title={t('Experimental: small Bluetooth printers in Chrome/Edge')}>
                  <Bluetooth size={16} /> {busy === 'ble' ? t('Connecting …') : t('Bluetooth (experimental)')}
                </button>
              )}
            </div>

            {channels.length > 0 && (
              <div className="bon-send">
                <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <b className="small">{t('Send as digital receipt')}</b>
                  <select className="input bon-to" value={member ?? ''} onChange={(e) => setMember(e.target.value ? Number(e.target.value) : null)} aria-label={t('To')}>
                    <option value="">{t('to the household')}</option>
                    {info.data!.members
                      .filter((m) => m.has_telegram || m.has_email)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {t('only to {name}', { name: m.name })}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="bon-actions">
                  {channels.map((c) => (
                    <button key={c} className="btn sm" disabled={!!busy || !memberOk(c)} onClick={() => send(c)}>
                      <PaperPlaneTilt size={14} /> {busy === c ? t('Sending …') : channelLabel(c)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {img.state === 'ok' && <PrintPortal src={src} paper={effPaper} w={img.w} h={img.h} />}
    </Sheet>
  );
}

/** Print-only copy of the ticket, sized to the paper (the printable width of 58 mm paper is 48 mm, of 80 mm 72 mm). */
function PrintPortal({ src, paper, w, h }: { src: string; paper: Paper; w: number; h: number }) {
  const printW = paper === 58 ? 48 : 72;
  const pageH = Math.ceil((printW * h) / Math.max(1, w)) + 6;
  return createPortal(
    <div className="bon-print-root">
      <style>{`@media print { @page { size: ${paper}mm ${pageH}mm; margin: 0 } }`}</style>
      <img src={src} alt="" style={{ width: `${printW}mm` }} />
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- Web Bluetooth (experimental)

/** Common BLE services of cheap ESC/POS printers (Goojprt, PeriPage-style, Xprinter, MTP …). */
const BLE_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb'];

async function printBluetooth(spec: BonSpec, paper: Paper): Promise<string> {
  const bt = (navigator as any).bluetooth;
  if (!bt) throw new Error(t('This browser can’t use Bluetooth.'));
  const r = await fetch(`/api/print/ticket.escpos?${query(spec, paper)}`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(t('Couldn’t create the ticket.'));
  const bytes = new Uint8Array(await r.arrayBuffer());
  const device = await bt.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  const server = await device.gatt.connect();
  try {
    let ch: any = null;
    for (const s of await server.getPrimaryServices()) {
      for (const c of await s.getCharacteristics()) if (c.properties.writeWithoutResponse || c.properties.write) ch ??= c;
      if (ch) break;
    }
    if (!ch) throw new Error(t('No writable printer channel found on this device.'));
    const chunk = 180;
    for (let i = 0; i < bytes.length; i += chunk) {
      const part = bytes.slice(i, i + chunk);
      if (ch.properties.writeWithoutResponse) {
        await ch.writeValueWithoutResponse(part);
        await new Promise((res) => setTimeout(res, 12));
      } else await ch.writeValue(part);
    }
    return t('Sent to {name}', { name: device.name ?? t('the printer') });
  } finally {
    setTimeout(() => server.disconnect(), 1500);
  }
}

// ---------------------------------------------------------------- Settings › Connections & devices › Printers

const darknessLabel = (d: number) => ({ '-2': t('very light'), '-1': t('lighter'), '0': t('normal'), '1': t('darker'), '2': t('very dark') })[String(d)] ?? t('normal');
const autoOrdersLabel = (a: PrinterRow['auto_orders']) => ({ off: t('off'), all: t('always') })[a] ?? t('off');

export function PrintSettings({ admin }: { admin: boolean }) {
  const q = useApi<PrintInfo>('print-info', '/print/info');
  const [editing, setEditing] = useState<PrinterRow | 'new' | null>(null);
  const [bon, setBon] = useState<BonSpec | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const toast = useToast();
  const printers = q.data?.printers ?? [];

  const test = async (p: PrinterRow) => {
    setBusy(p.id);
    try {
      await post(`/print/printers/${p.id}/test`);
      toast({ text: t('Test page sent to {name}', { name: p.name }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
      invalidate('print-info');
    }
  };
  const remove = async (p: PrinterRow) => {
    if (!confirm(t('Remove “{name}”?', { name: p.name }))) return;
    await del(`/print/printers/${p.id}`).catch((e) => toast({ text: (e as Error).message, error: true }));
    invalidate('print-info');
  };

  return (
    <div className="stack" style={{ gap: 22 }}>
      <section>
        <h2 style={{ marginBottom: 6 }}>{t('Make a ticket')}</h2>
        <p className="small muted" style={{ marginBottom: 10 }}>{t('Receipt-style slips for the fridge, the kitchen or the phone. Print buttons also sit on the shopping list, orders, care tasks, recipes and the week plan.')}</p>
        <div className="bon-tiles">
          <button className="card pad bon-tile" onClick={() => setBon({ type: 'shopping' })}>
            <ShoppingCart size={22} />
            <b>{t('Shopping slip')}</b>
            <span className="small muted">{t('Sorted by aisle, with boxes to tick')}</span>
          </button>
          <button className="card pad bon-tile" onClick={() => setBon({ type: 'week' })}>
            <CalendarBlank size={22} />
            <b>{t('Week plan')}</b>
            <span className="small muted">{t('Seven days for the fridge door')}</span>
          </button>
        </div>
        <div className="card pad stack" style={{ marginTop: 10 }}>
          <label className="row" style={{ gap: 8, fontWeight: 600 }} htmlFor="bon-note">
            <Note size={18} /> {t('Fridge note')}
          </label>
          <textarea id="bon-note" className="input" rows={3} maxLength={1200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. Back at six – soup is in the fridge')} />
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!note.trim()} onClick={() => setBon({ type: 'note', text: note.trim() })}>
            <Receipt size={16} /> {t('Preview ticket')}
          </button>
        </div>
      </section>

      <section>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2>{t('Printers')}</h2>
          {admin && printers.length > 0 && (
            <button className="btn sm" onClick={() => setEditing('new')}>
              <Plus size={14} /> {t('Add printer')}
            </button>
          )}
        </div>
        {q.isLoading ? (
          <Skeleton h={72} n={1} />
        ) : q.error ? (
          <div className="card pad row between">
            <span>{t('Couldn’t load the printers.')}</span>
            <button className="btn sm" onClick={() => q.refetch()}>{t('Try again')}</button>
          </div>
        ) : printers.length === 0 ? (
          <Empty
            icon={<Printer size={28} />}
            title={t('No printer yet')}
            action={admin ? { label: t('Add printer'), onClick: () => setEditing('new'), icon: <Plus size={16} /> } : undefined}
          >
            {t('Any network thermal printer that speaks ESC/POS works – Epson TM, Star in ESC/POS mode, most 58/80 mm Wi-Fi printers. Usually on port 9100.')}
          </Empty>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {printers.map((p) => (
              <div key={p.id} className="card pad stack" style={{ gap: 8 }}>
                <div className="row between" style={{ gap: 10, alignItems: 'flex-start' }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <b>{p.name}</b>
                      {p.is_default && <span className="badge info">{t('default')}</span>}
                    </div>
                    <div className="small muted bon-ellipsis">
                      {p.host}:{p.port} · {p.paper} mm · {p.mode === 'raster' ? t('image') : t('text')}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 4, flex: 'none' }}>
                    {admin && (
                      <button className="icon-btn plain" onClick={() => setEditing(p)} aria-label={t('Edit')} title={t('Edit')}>
                        <PencilSimple size={16} />
                      </button>
                    )}
                    {admin && (
                      <button className="icon-btn plain" onClick={() => remove(p)} aria-label={t('Remove')} title={t('Remove')}>
                        <Trash size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="small">
                  {p.last_error ? (
                    <span className="bon-status bad">
                      <Warning size={14} /> {p.last_error}
                    </span>
                  ) : p.last_ok_at ? (
                    <span className="bon-status ok">
                      <Check size={14} weight="bold" /> {t('Last print {when}', { when: relTime(p.last_ok_at) })}
                    </span>
                  ) : (
                    <span className="muted">{t('Not used yet – try a test page.')}</span>
                  )}
                </div>
                <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <span className="small muted">
                    {t('Orders: {mode}', { mode: autoOrdersLabel(p.auto_orders) })} · {t('Care tasks: {mode}', { mode: p.auto_care ? t('when due') : t('off') })}
                  </span>
                  <button className="btn sm" disabled={busy === p.id} onClick={() => test(p)}>
                    <Printer size={14} /> {busy === p.id ? t('Printing …') : t('Test page')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {q.data && admin && <PrintDefaults s={q.data.settings} />}

      {q.data && q.data.jobs.length > 0 && (
        <section>
          <h2 style={{ marginBottom: 10 }}>{t('Recently printed & sent')}</h2>
          <div className="card">
            {q.data.jobs.map((j) => (
              <div key={j.id} className="row between bon-job">
                <span className="bon-ellipsis">
                  {bonTypeLabel(j.kind)} · {j.target === 'printer' ? (j.printer ?? t('Printer')) : channelLabel(j.target)}
                  {j.actor === 'auto' ? ` · ${t('automatic')}` : ''}
                </span>
                <span className={`small ${j.ok ? 'muted' : 'bon-status bad'}`} title={j.error ?? undefined}>
                  {j.ok ? relTime(j.created_at) : t('failed')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="card pad small muted stack" style={{ gap: 6 }}>
        <b style={{ color: 'var(--ink)' }}>{t('Good to know')}</b>
        <span>{t('Image mode prints the ticket as a picture: umlauts, Swedish letters and the QR code always come out right. Text mode is faster on old printers and uses code page CP858 or Windows-1252.')}</span>
        <span>{t('Bluetooth: small BLE printers can print straight from Chrome or Edge on Android and desktop (not on iPhone). Experimental – not every model works.')}</span>
        <span>{t('Home Assistant / ESPHome: an ESP32 with a serial thermal printer can print via ESPHome’s thermal printer component. Trigger it from a Home Assistant automation on the tohuus_hub_event (e.g. order.new). For a network printer, ToHuus Hub’s own auto-print is simpler.')}</span>
      </div>

      {editing && <PrinterSheet p={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {bon && <BonSheet spec={bon} onClose={() => setBon(null)} />}
    </div>
  );
}

function PrintDefaults({ s }: { s: PrintInfo['settings'] }) {
  const toast = useToast();
  const save = async (patchBody: Partial<PrintInfo['settings']>) => {
    try {
      await put('/print/settings', patchBody);
      invalidate('print-info');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section>
      <h2 style={{ marginBottom: 10 }}>{t('Defaults')}</h2>
      <div className="card pad stack">
        <div className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span>{t('Paper for sharing & previews')}</span>
          <Seg value={String(s.paper) as '58' | '80'} onChange={(v) => save({ paper: Number(v) as Paper })} options={[['58', '58 mm'], ['80', '80 mm']]} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>{t('Quiet hours for automatic printing')}</label>
          <div className="row" style={{ gap: 10 }}>
            <input className="input" type="time" defaultValue={s.quietFrom} onBlur={(e) => e.target.value && e.target.value !== s.quietFrom && save({ quietFrom: e.target.value })} aria-label={t('from')} />
            <span className="muted">–</span>
            <input className="input" type="time" defaultValue={s.quietTo} onBlur={(e) => e.target.value && e.target.value !== s.quietTo && save({ quietTo: e.target.value })} aria-label={t('until')} />
          </div>
          <div className="help">{t('Due care tasks are not printed in these hours. Orders always print – somebody is waiting for them.')}</div>
        </div>
      </div>
    </section>
  );
}

function PrinterSheet({ p, onClose }: { p: PrinterRow | null; onClose: () => void }) {
  const [f, setF] = useState({
    name: p?.name ?? t('Kitchen printer'),
    host: p?.host ?? '',
    port: p?.port ?? 9100,
    paper: (p?.paper ?? 80) as Paper,
    mode: p?.mode ?? 'raster',
    codepage: p?.codepage ?? 'cp858',
    cut: p?.cut ?? 'partial',
    darkness: p?.darkness ?? 0,
    feed_lines: p?.feed_lines ?? 4,
    auto_orders: p?.auto_orders ?? 'off',
    auto_care: p?.auto_care ?? false,
    is_default: p?.is_default ?? false,
  });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, port: Number(f.port) || 9100 };
      if (p) await patch(`/print/printers/${p.id}`, body);
      else await post('/print/printers', body);
      invalidate('print-info');
      toast({ text: t('Saved') });
      onClose();
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
      title={p ? t('Edit printer') : t('Add printer')}
      footer={
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn primary grow" disabled={busy || !f.host.trim()} onClick={save}>{t('Save')}</button>
        </div>
      }
    >
      <div className="stack">
        <div className="field">
          <label htmlFor="pr-name">{t('Name')}</label>
          <input id="pr-name" className="input" value={f.name} maxLength={40} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="field grow" style={{ margin: 0 }}>
            <label htmlFor="pr-host">{t('IP address or host name')}</label>
            <input id="pr-host" className="input" value={f.host} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="192.168.1.50" onChange={(e) => set('host', e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0, width: 96 }}>
            <label htmlFor="pr-port">{t('Port')}</label>
            <input id="pr-port" className="input" type="number" inputMode="numeric" value={f.port} onChange={(e) => set('port', Number(e.target.value))} />
          </div>
        </div>
        <div className="help" style={{ marginTop: -6 }}>{t('Most printers print their address when you hold the feed button while switching them on.')}</div>
        <div className="field">
          <label>{t('Paper width')}</label>
          <Seg value={String(f.paper) as '58' | '80'} onChange={(v) => set('paper', Number(v) as Paper)} options={[['58', '58 mm'], ['80', '80 mm']]} />
        </div>
        <div className="field">
          <label>{t('Print as')}</label>
          <Seg value={f.mode} onChange={(v) => set('mode', v)} options={[['raster', t('Image (recommended)')], ['text', t('Text')]]} />
          {f.mode === 'text' && (
            <div style={{ marginTop: 8 }}>
              <Seg value={f.codepage} onChange={(v) => set('codepage', v)} options={[['cp858', 'CP858'], ['cp1252', 'Windows-1252']]} />
            </div>
          )}
        </div>
        <div className="field">
          <label>{t('Cutter')}</label>
          <Seg value={f.cut} onChange={(v) => set('cut', v)} options={[['partial', t('partial cut')], ['full', t('full cut')], ['none', t('no cutter')]]} />
        </div>
        <div className="field">
          <label>{t('Darkness: {level}', { level: darknessLabel(f.darkness) })}</label>
          <input type="range" min={-2} max={2} step={1} value={f.darkness} onChange={(e) => set('darkness', Number(e.target.value))} aria-label={t('Darkness')} style={{ width: '100%' }} />
        </div>
        <div className="field">
          <label htmlFor="pr-feed">{t('Blank lines before cutting')}</label>
          <input id="pr-feed" className="input" type="number" min={0} max={12} value={f.feed_lines} onChange={(e) => set('feed_lines', Math.max(0, Math.min(12, Number(e.target.value))))} style={{ width: 96 }} />
        </div>
        <div className="field">
          <label>{t('Print new orders automatically')}</label>
          <Seg value={f.auto_orders} onChange={(v) => set('auto_orders', v)} options={[['off', t('off')], ['all', t('always')]]} />
          <div className="help">{t('A kitchen ticket for every new sofa or guest order – only orders that come in after you switch this on.')}</div>
        </div>
        <div className="row between">
          <span>{t('Print care tasks when they are due')}</span>
          <Toggle on={f.auto_care} onChange={(v) => set('auto_care', v)} label={t('Print care tasks when they are due')} />
        </div>
        <div className="row between">
          <span>{t('Default printer')}</span>
          <Toggle on={f.is_default} onChange={(v) => set('is_default', v)} label={t('Default printer')} />
        </div>
      </div>
    </Sheet>
  );
}
