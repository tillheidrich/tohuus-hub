/**
 * Settings › Areas & places › Recipes & imports: state of the recipe photos (area: recipes2, photos).
 * Shows how many photos are stored, waiting or failed (with the reason), retries them on the server, and –
 * when the server cannot reach the image host – loads them through this browser and sends them to the server.
 *
 * The browser path keeps `connect-src 'self'`: photos are loaded as <img crossOrigin="anonymous"> (allowed by
 * `img-src https:`), drawn on a canvas and uploaded as JPEG. It needs the image host to send
 * Access-Control-Allow-Origin (Cloudinary/Cookidoo does: `*`); otherwise that photo counts as failed.
 */
import { ArrowClockwise, Browser, Image as ImageIcon, WarningCircle } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, get, invalidate, post } from '../api';
import { t } from '../i18n';
import { useToast } from '../ui';

interface PhotoStatus {
  pending: number;
  total: number;
  loaded: number;
  waiting: number;
  failed_total: number;
  reasons: { reason: string; n: number }[];
}
interface Missing {
  id: number;
  title: string;
  urls: string[];
}

const MAX_PX = 1600;

function loadImage(url: string, timeoutMs = 30000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    const timer = setTimeout(() => {
      img.src = '';
      reject(new Error('timeout'));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('load'));
    };
    img.src = url;
  });
}

/** Load a remote photo in the browser and turn it into a JPEG blob (long side ≤ 1600 px). */
async function photoBlob(urls: string[]): Promise<Blob> {
  let last: unknown = null;
  for (const url of urls) {
    try {
      const img = await loadImage(url);
      const k = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      // throws (tainted canvas) when the host does not allow CORS
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.86));
      if (blob) return blob;
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error('load');
}

export function RecipePhotosCard() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [browser, setBrowser] = useState<{ total: number; done: number; failed: number; running: boolean } | null>(null);
  const stop = useRef(false);
  const q = useQuery<PhotoStatus>({
    queryKey: ['recipe-photos'],
    queryFn: () => get<PhotoStatus>('/recipes/import/images'),
    // live while the server is still downloading
    refetchInterval: (query) => ((query.state.data?.pending ?? 0) > 0 ? 2500 : false),
  });
  const s = q.data;
  if (q.isLoading) return null;
  if (q.isError)
    return (
      <div className="card pad row small muted" style={{ gap: 8 }}>
        <WarningCircle size={18} /> {t('Photo status could not be loaded.')}
      </div>
    );
  if (!s || s.total === 0) return null;

  const missing = s.total - s.loaded;
  const retry = async () => {
    setBusy(true);
    try {
      const r = await post<{ queued: number }>('/recipes/import/images/retry');
      toast({ text: r.queued ? t('{n} photos are being loaded again', { n: r.queued }) : t('All photos are there') });
      await q.refetch();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const viaBrowser = async () => {
    stop.current = false;
    let list: Missing[];
    try {
      list = (await get<Missing[]>('/recipes/import/images/missing')).filter((m) => m.urls.length);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      return;
    }
    if (!list.length) {
      toast({ text: t('All photos are there') });
      return;
    }
    const st = { total: list.length, done: 0, failed: 0, running: true };
    setBrowser({ ...st });
    let next = 0;
    const worker = async () => {
      while (!stop.current && next < list.length) {
        const m = list[next++];
        try {
          const blob = await photoBlob(m.urls);
          const form = new FormData();
          form.append('image', blob, `recipe-${m.id}.jpg`);
          await api(`/recipes/import/images/${m.id}`, { form });
        } catch {
          st.failed++;
        }
        st.done++;
        setBrowser({ ...st });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    st.running = false;
    setBrowser({ ...st });
    invalidate('recipes');
    await q.refetch();
    toast({ text: st.failed ? t('{ok} photos loaded, {n} not possible', { ok: st.done - st.failed, n: st.failed }) : t('{n} photos loaded', { n: st.done }), error: st.failed > 0 && st.failed === st.done });
  };

  const pct = s.total ? Math.round((s.loaded / s.total) * 100) : 0;
  const bpct = browser ? Math.round((browser.done / Math.max(1, browser.total)) * 100) : 0;
  return (
    <div className="card pad stack recipe-photos">
      <div className="row" style={{ gap: 10 }}>
        <ImageIcon size={20} />
        <b>{t('Recipe photos')}</b>
      </div>
      <div className="small">{t('Photos: {loaded} loaded, {waiting} waiting, {failed} failed', { loaded: s.loaded, waiting: s.waiting, failed: s.failed_total })}</div>
      <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 8 }}>
        <i style={{ width: `${pct}%`, background: 'var(--accent)', transition: 'width .3s' }} />
      </div>
      {s.pending > 0 && <div className="small muted">{t('Downloading in the background – {n} to go.', { n: s.pending })}</div>}
      {missing > 0 && <div className="small muted">{t('Until a photo is stored here, the recipe shows it from the original website.')}</div>}
      {s.reasons.length > 0 && missing > 0 && (
        <ul className="small muted recipe-photos-why">
          {s.reasons.map((r) => (
            <li key={r.reason}>
              {r.reason} · {r.n}
            </li>
          ))}
        </ul>
      )}
      {missing > 0 && (
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" onClick={retry} disabled={busy || Boolean(browser?.running)}>
            <ArrowClockwise size={16} /> {t('Load missing photos')}
          </button>
          {browser?.running ? (
            <button className="btn ghost" onClick={() => (stop.current = true)}>
              {t('Stop')}
            </button>
          ) : (
            <button className="btn ghost" onClick={viaBrowser} disabled={busy}>
              <Browser size={16} /> {t('Load photos through this browser')}
            </button>
          )}
        </div>
      )}
      {browser && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="meter" role="progressbar" aria-valuenow={bpct} aria-valuemin={0} aria-valuemax={100} style={{ height: 8 }}>
            <i style={{ width: `${bpct}%`, background: 'var(--accent)', transition: 'width .2s' }} />
          </div>
          <div className="small muted">
            {t('{done} of {total} through this browser', { done: browser.done, total: browser.total })}
            {browser.failed > 0 ? ` · ${t('{n} not possible', { n: browser.failed })}` : ''}
          </div>
        </div>
      )}
      {missing > 0 && !browser && <div className="small muted">{t('If the server cannot reach the photo website, this browser can load the photos and hand them to the server. Keep the page open until it is done.')}</div>}
    </div>
  );
}
