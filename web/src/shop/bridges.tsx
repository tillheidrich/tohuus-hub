/**
 * Bridges (list2, block E): the list in Apple Reminders / Nextcloud Tasks via CalDAV, and a one-off import from
 * another list app (Bring!, AnyList, Google Keep, a shared text or CSV).
 */
import { ArrowSquareIn, Copy, Trash } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { api, del, invalidate, post, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Sheet, useToast } from '../ui';
import './list2.css';

interface Pw {
  id: number;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

/** Settings › My account: "Liste in der Erinnerungen-App". */
export function CalDavCard() {
  const q = useApi<Pw[]>(['settings', 'caldav'], '/caldav/passwords');
  const [made, setMade] = useState<{ username: string; password: string; url: string; server: string } | null>(null);
  const [label, setLabel] = useState('iPhone');
  const toast = useToast();
  const create = async () => {
    try {
      setMade(await post('/caldav/passwords', { label: label.trim() || 'iPhone' }));
      invalidate('settings');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast({ text: t('Copied') }));
  return (
    <section className="card pad stack" aria-labelledby="cd-h">
      <div>
        <h2 id="cd-h" style={{ margin: 0 }}>
          {t('ToHuus in Apple Reminders and Calendar')}
        </h2>
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {t('Apple Reminders, Nextcloud Tasks or Thunderbird show your shopping lists and your tasks (“ToHuus · Aufgaben”, “ToHuus · Nur für mich”) and can tick and add. Apple Calendar shows what is due in “ToHuus · Fällig”. One password for both.')}
        </p>
      </div>
      {made ? (
        <div className="stack caldav-made">
          <p className="small">
            <b>{t('Shown only now – copy it into the iPhone settings:')}</b>
          </p>
          {[
            [t('Server'), made.server],
            [t('User name'), made.username],
            [t('Password'), made.password],
          ].map(([k, v]) => (
            <div key={k} className="row caldav-field">
              <span className="eyebrow">{k}</span>
              <code className="grow">{v}</code>
              <button className="icon-btn plain" onClick={() => copy(v)} aria-label={t('Copy {what}', { what: k })}>
                <Copy size={16} />
              </button>
            </div>
          ))}
          <ol className="small caldav-steps">
            <li>{t('On the iPhone: Settings › Apps › Reminders › Reminders Accounts › Add Account › Other.')}</li>
            <li>{t('“Add CalDAV Account”, then enter server, user name and password from above.')}</li>
            <li>{t('Open Reminders – your ToHuus lists appear under the new account.')}</li>
            <li>{t('For the calendar: Settings › Apps › Calendar › Calendar Accounts › Add Account › Other › “Add CalDAV Account”, with the same details.')}</li>
          </ol>
          <p className="small muted">{t('Nextcloud Tasks / DAVx⁵: use the full address {url}', { url: made.url })}</p>
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setMade(null)}>
            {t('Done')}
          </button>
        </div>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} aria-label={t('Device name')} />
          <button className="btn primary" onClick={create}>
            {t('Create password')}
          </button>
        </div>
      )}
      {(q.data ?? []).length > 0 && (
        <div className="list">
          {(q.data ?? []).map((p) => (
            <div key={p.id} className="li" style={{ minHeight: 52 }}>
              <div className="grow">
                <div className="title small">{p.label}</div>
                <div className="sub">{p.last_used_at ? t('last used {when}', { when: relTime(p.last_used_at) }) : t('not used yet')}</div>
              </div>
              <button
                className="icon-btn plain"
                aria-label={t('Revoke {name}', { name: p.label })}
                onClick={async () => {
                  await del(`/caldav/passwords/${p.id}`);
                  invalidate('settings');
                }}
              >
                <Trash size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface Row {
  name: string;
  qty: number | null;
  note: string | null;
}

/** "Aus einer anderen App übernehmen" – paste a shared list or pick an export file. */
export function ImportListSheet({ open, listId, onClose }: { open: boolean; listId: number; onClose: () => void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const send = async (dry: boolean) => {
    setBusy(true);
    try {
      const fd = new FormData();
      if (file) fd.append('file', file);
      else fd.append('text', text);
      fd.append('list_id', String(listId));
      fd.append('dry_run', dry ? '1' : '0');
      const r = await api('/list/import', { form: fd });
      if (dry) setRows(r.items);
      else {
        invalidate('shopping', 'today');
        toast({ text: r.added === 1 ? t('1 thing taken over') : t('{n} things taken over', { n: r.added }) });
        setRows(null);
        setText('');
        setFile(null);
        onClose();
      }
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('Take over a list from another app')}
      footer={
        <div className="shop-foot">
          {rows ? (
            <button className="btn primary block" disabled={busy || rows.length === 0} onClick={() => send(false)}>
              {rows.length === 1 ? t('Add 1 item') : t('Add {n} items', { n: rows.length })}
            </button>
          ) : (
            <button className="btn primary block" disabled={busy || (!text.trim() && !file)} onClick={() => send(true)}>
              {t('Show what comes over')}
            </button>
          )}
        </div>
      }
    >
      {rows ? (
        <div className="list">
          {rows.map((r, i) => (
            <div key={i} className="li" style={{ minHeight: 44 }}>
              <div className="grow small">
                {r.qty ? `${r.qty}× ` : ''}
                {r.name}
                {r.note ? <span className="muted"> · {r.note}</span> : null}
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="li small muted">{t('No open items found.')}</div>}
        </div>
      ) : (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            {t('Bring!, AnyList, Notes, WhatsApp: share the list as text and paste it here. Google Keep: the Takeout file of the note. Ticked items stay out.')}
          </p>
          <textarea className="input" rows={7} value={text} disabled={Boolean(file)} placeholder={t('Paste the list here …')} onChange={(e) => setText(e.target.value)} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost sm" onClick={() => ref.current?.click()}>
              <ArrowSquareIn size={16} /> {file ? file.name : t('Choose a file (JSON, CSV, TXT)')}
            </button>
            {file && (
              <button className="btn ghost sm" onClick={() => setFile(null)}>
                {t('Remove')}
              </button>
            )}
          </div>
          <input ref={ref} type="file" hidden accept=".json,.csv,.txt,application/json,text/csv,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      )}
    </Sheet>
  );
}
