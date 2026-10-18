/**
 * Haushaltswissen: import and export (docs/knowledge.md › Import und Export, server/lib/knowledge-io.ts).
 * Import in two steps: a file (Markdown, text, CSV, JSON – also Obsidian/Notion exports) or pasted text → preview
 * (new, changed, already there, refused) → take over the picked rows, with one undo. Export: Markdown, CSV or JSON as
 * a download, everything or what is shown. Same on the iPhone (KnowledgeView.swift › KnowledgeImportSheet/ExportSheet).
 */
import { DownloadSimple, FileText, Lock, UploadSimple } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { api, ApiError, invalidate, post } from '../api';
import { t } from '../i18n';
import { useHealthConsent } from '../people/HealthConsent';
import { Seg, Sheet, Toggle, useToast } from '../ui';

type Visibility = 'household' | 'me';
type Action = 'create' | 'update' | 'skip' | 'blocked';
interface PreviewItem {
  i: number;
  line: number;
  kind: 'card' | 'line';
  subject: string | null;
  subjectKnown: boolean;
  property: string | null;
  value: string | null;
  text: string | null;
  note: string | null;
  visibility: Visibility;
  sensitive: boolean;
  action: Action;
  before: string | null;
  reason: 'unchanged' | 'exists' | 'twice' | 'secret' | 'limit' | 'health' | null;
}
interface Preview {
  format: string;
  items: PreviewItem[];
  counts: Record<Action, number>;
  truncated: boolean;
  room: number;
  needsHealthConsent: boolean;
}

const ACCEPT = '.md,.markdown,.txt,.csv,.tsv,.json,text/markdown,text/plain,text/csv,application/json';
const MAX_KB = 512;

const reasonText = (x: PreviewItem) => {
  if (x.action === 'create') return t('new');
  if (x.action === 'update') return t('{old} → {new}', { old: x.before ?? '', new: x.value ?? '' });
  switch (x.reason) {
    case 'unchanged':
      return t('already there');
    case 'exists':
      return t('already there, stays as it is');
    case 'twice':
      return t('twice in the file');
    case 'secret':
      return t('codes belong in House info');
    case 'limit':
      return t('no room left');
    case 'health':
      return t('health, only in the app');
    default:
      return '';
  }
};

export function KnowledgeImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [target, setTarget] = useState<Visibility>('household');
  const [update, setUpdate] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { withConsent, sheet } = useHealthConsent();

  const reset = () => {
    setFile(null);
    setText('');
    setPreview(null);
    setPicked(new Set());
    setError(null);
    if (input.current) input.current.value = '';
  };
  const close = () => {
    reset();
    onClose();
  };

  /** the same body for preview and apply: the file as multipart, pasted text as JSON */
  const send = <T,>(path: string, extra: Record<string, unknown> = {}) => {
    const fields: Record<string, unknown> = { target, onDuplicate: update ? 'update' : 'skip', ...extra };
    if (file) {
      const f = new FormData();
      f.append('file', file, file.name);
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.append(k, typeof v === 'string' ? v : JSON.stringify(v));
      return api<T>(path, { method: 'POST', form: f });
    }
    return post<T>(path, { text, ...fields });
  };

  const showPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const p = await send<Preview>('/knowledge/import/preview');
      setPreview(p);
      setPicked(new Set(p.items.filter((x) => x.action === 'create' || x.action === 'update').map((x) => x.i)));
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const r = await withConsent((consent) =>
        send<{ created: number; updated: number; failed: unknown[]; undo: string | null }>('/knowledge/import', { pick: [...picked], ...(consent ? { consent: true } : {}) }),
      );
      if (!r) return;
      invalidate('knowledge', 'memory');
      toast({
        text: t('Taken over: {n} new, {m} updated.', { n: r.created, m: r.updated }),
        action: r.undo ? { label: t('Undo'), run: () => post(`/assistant/undo/${r.undo}`).then(() => invalidate('knowledge', 'memory')) } : undefined,
      });
      close();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const ready = Boolean(file) || text.trim().length >= 2;
  const toggle = (i: number) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    return n;
  });

  return (
    <>
      {sheet}
      <Sheet
        open={open}
        onClose={close}
        title={t('Import')}
        wide
        footer={
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            {preview ? (
              <>
                <button className="btn" onClick={() => setPreview(null)} disabled={busy}>
                  {t('Back')}
                </button>
                <button className="btn primary" onClick={() => void apply()} disabled={busy || picked.size === 0}>
                  {t('Take over {n}', { n: picked.size })}
                </button>
              </>
            ) : (
              <button className="btn primary" onClick={() => void showPreview()} disabled={busy || !ready}>
                {t('Show preview')}
              </button>
            )}
          </div>
        }
      >
        {!preview ? (
          <div className="kn-io">
            {/* pasting first – most notes live in Notes, a mail or a few cells (Till 18 Oct 2026); a file second */}
            <p className="muted" style={{ marginTop: 0 }}>
              {t('Paste text, from Notes, an e-mail or cells from Excel or Numbers. Or choose a file (CSV, text, Markdown). You see everything before it is saved.')}
            </p>
            {!file && (
              <>
                <label className="small muted" htmlFor="kn-io-text">
                  {t('Paste text')}
                </label>
                <textarea id="kn-io-text" className="input kn-io-text" rows={6} value={text} maxLength={MAX_KB * 1024} onChange={(e) => setText(e.target.value)} placeholder={t('## Mika\n- Shoe size: 28\n- Clothing size: 116')} />
              </>
            )}
            <input
              ref={input}
              type="file"
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setError(f && f.size > MAX_KB * 1024 ? t('The file is too big (at most {n} KB).', { n: MAX_KB }) : null);
                setFile(f && f.size <= MAX_KB * 1024 ? f : null);
              }}
            />
            {!file && <span className="small muted">{t('Or choose a file')}</span>}
            <button type="button" className="btn kn-io-file" onClick={() => input.current?.click()}>
              <UploadSimple size={18} /> {file ? file.name : t('Choose file')}
            </button>
            <p className="small muted" style={{ margin: 0 }}>{t('Exports from Obsidian or Notion (Markdown) work too.')}</p>
            <div className="field">
              <span className="small muted">{t('Who sees the new entries?')}</span>
              <Seg value={target} options={[['household', t('Whole household')], ['me', t('Only me')]]} onChange={setTarget} full />
            </div>
            <label className="row between">
              <span>{t('Update values that are already there')}</span>
              <Toggle on={update} onChange={setUpdate} />
            </label>
            <p className="small muted">{t('Health things stay private. Codes and passwords are left out.')}</p>
            {error && (
              <p className="small" role="alert" style={{ color: 'var(--danger)' }}>
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="kn-io">
            <p style={{ marginTop: 0 }}>
              <b>{t('{n} new, {m} changed, {k} already there', { n: preview.counts.create, m: preview.counts.update, k: preview.counts.skip })}</b>
              {preview.counts.blocked > 0 && <span className="muted"> · {t('{n} left out', { n: preview.counts.blocked })}</span>}
            </p>
            {preview.truncated && <p className="small muted">{t('Only the first {n} entries are read.', { n: preview.items.length })}</p>}
            {preview.items.length === 0 && <p className="muted">{t('ToHuus found nothing to take over in it.')}</p>}
            <ul className="kn-io-list">
              {preview.items.map((x) => {
                const can = x.action === 'create' || x.action === 'update';
                return (
                  <li key={x.i} className={`kn-io-item ${can ? '' : 'off'}`}>
                    <label className="row">
                      <input type="checkbox" disabled={!can} checked={can && picked.has(x.i)} onChange={() => toggle(x.i)} />
                      <span className="kn-io-main">
                        {x.kind === 'card' ? (
                          <>
                            <b>{x.subject}</b> · {x.property}: {x.value}
                          </>
                        ) : (
                          x.text
                        )}
                        {x.note && <span className="small muted"> – {x.note}</span>}
                      </span>
                      <span className={`chip sm ${x.action === 'create' ? 'on' : ''}`}>{reasonText(x)}</span>
                      {x.visibility === 'me' && (
                        <span className="small muted kn-io-lock" title={x.sensitive ? t('Health things stay private.') : t('Only for you')}>
                          <Lock size={14} />
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Sheet>
    </>
  );
}

type Format = 'md' | 'csv' | 'json';

/** Download: GET /api/knowledge/export, saved with the server's file name */
async function download(format: Format, ids?: number[]) {
  const qs = new URLSearchParams({ format, ...(ids?.length ? { ids: ids.join(',') } : {}) });
  const r = await fetch(`/api/knowledge/export?${qs}`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(t('That did not work. Please try again.'));
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `tohuus-knowledge.${format}`;
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function KnowledgeExport({ open, onClose, total, shownIds }: { open: boolean; onClose: () => void; total: number; shownIds: number[] | null }) {
  const [format, setFormat] = useState<Format>('md');
  const [scope, setScope] = useState<'all' | 'shown'>('all');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const partial = shownIds != null && shownIds.length > 0 && shownIds.length < total;
  const hint = format === 'md' ? t('Easy to read, grouped by topic. Opens in any notes app.') : format === 'csv' ? t('For Excel or Numbers.') : t('Everything incl. earlier values. To move or import again.');
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('Export')}
      footer={
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button
            className="btn primary"
            disabled={busy || total === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await download(format, partial && scope === 'shown' ? shownIds! : undefined);
                onClose();
              } catch (e) {
                toast({ text: (e as Error).message, error: true });
              } finally {
                setBusy(false);
              }
            }}
          >
            <DownloadSimple size={16} /> {t('Download')}
          </button>
        </div>
      }
    >
      <div className="kn-io">
        <p className="muted" style={{ marginTop: 0 }}>
          {t('Only what you can see. Private entries of the others never.')}
        </p>
        <Seg value={format} options={[['md', 'Markdown'], ['csv', 'CSV'], ['json', 'JSON']]} onChange={setFormat} full label={t('Format')} />
        <p className="small muted">
          <FileText size={14} /> {hint}
        </p>
        {partial && (
          <Seg
            value={scope}
            options={[
              ['all', t('Everything ({n})', { n: total })],
              ['shown', t('What is shown ({n})', { n: shownIds!.length })],
            ]}
            onChange={setScope}
            full
          />
        )}
      </div>
    </Sheet>
  );
}
