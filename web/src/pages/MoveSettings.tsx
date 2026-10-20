// "Umzug in die ToHuus Cloud": self-host builds the move file, the cloud imports it into a new household.
// Server: server/routes/move.ts, docs/cloud.md › "Moving a self-hosted household in".
import { DownloadSimple, UploadSimple } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { api, invalidate, useApi } from '../api';
import { t } from '../i18n';
import { useToast } from '../ui';

/** Self-host: download the move file. */
export function MoveOutCard({ admin }: { admin: boolean }) {
  const info = useApi<{ parts: { key: string; sensitive: boolean }[] }>(['move', 'info'], admin ? '/move/info' : null);
  const [secrets, setSecrets] = useState(false);
  if (!admin) return null;
  const sensitive = (info.data?.parts ?? []).some((p) => p.sensitive);
  return (
    <section className="card pad stack" aria-labelledby="move-out-h">
      <h2 id="move-out-h" style={{ margin: 0 }}>{t('Move to ToHuus Cloud')}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {t('One file with everything of your household – list, stock, recipes, receipts, photos. Create a new household in ToHuus Cloud and import the file there. Sign-ins, devices, tokens and links stay here; conversations with the assistant and what others marked “only for me” as well.')}
      </p>
      {sensitive && (
        <label className="row small" style={{ gap: 8, minHeight: 44 }}>
          <input type="checkbox" checked={secrets} onChange={(e) => setSecrets(e.target.checked)} style={{ width: 20, height: 20 }} />
          {t('Take the codes from the house info along (door, alarm, Wi-Fi)')}
        </label>
      )}
      <a className="btn" style={{ alignSelf: 'flex-start' }} href={`/api/move/file?secrets=${secrets ? 1 : 0}`} download>
        <DownloadSimple size={16} /> {t('Download move file')}
      </a>
    </section>
  );
}

interface Job {
  state: 'idle' | 'running' | 'done' | 'failed';
  progress: number;
  empty?: boolean;
  error?: string;
  summary?: { rows: number; images: number; files: number; people: { mapped: number; created: number } };
}

/** Cloud: import a move file into this (new, empty) household. */
export function MoveInCard({ admin }: { admin: boolean }) {
  const job = useApi<Job>(['move', 'job'], admin ? '/cloud/import' : null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const running = job.data?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => invalidate('move'), 1500);
    return () => window.clearInterval(id);
  }, [running]);
  useEffect(() => {
    if (job.data?.state === 'done') invalidate('products', 'overview', 'today', 'recipes', 'settings', 'me');
  }, [job.data?.state]);
  if (!admin || !job.data) return null;
  const d = job.data;
  if (d.state === 'idle' && d.empty === false) return null;
  const start = async (f: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('password', pw);
      await api('/cloud/import', { form: fd });
      invalidate('move');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card pad stack" aria-labelledby="move-in-h">
      <h2 id="move-in-h" style={{ margin: 0 }}>{t('Bring a household from your own server')}</h2>
      {d.state === 'done' && d.summary ? (
        <p className="small" style={{ margin: 0 }}>
          {t('Done: {rows} entries, {images} photos, {files} receipt files. {people} people without a sign-in yet – invite them under Settings › Household › Who lives here?', { rows: d.summary.rows, images: d.summary.images, files: d.summary.files, people: d.summary.people.created })}
        </p>
      ) : running ? (
        <p className="small" role="status" style={{ margin: 0 }}>{t('Moving in … {p} %', { p: Math.round(d.progress * 100) })}</p>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {t('On your own server: Settings › Data, plan & account › Data & backups › Move to ToHuus Cloud. Then choose the file here. This works in a new, empty household.')}
          </p>
          {d.state === 'failed' && <p className="small" style={{ margin: 0, color: 'var(--danger)' }}>{d.error}</p>}
          <div className="field">
            <label htmlFor="move-pw">{t('Your password')}</label>
            <input id="move-pw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <input ref={ref} type="file" accept=".zip,application/zip" hidden onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy || !pw} onClick={() => ref.current?.click()}>
            <UploadSimple size={16} /> {t('Choose move file')}
          </button>
        </>
      )}
    </section>
  );
}
