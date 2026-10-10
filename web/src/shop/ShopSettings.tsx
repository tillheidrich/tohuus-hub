/** Settings cards for the shopping area: Web Push on this device, Home Assistant to-do sync. */
import { ArrowsClockwise, BellRinging, DeviceMobile, Trash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { del, get, invalidate, post, put, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Skeleton, Toggle, useToast } from '../ui';

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : t('Device');
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ');
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

/** Web Push for this device + list of subscribed devices. */
export function PushCard() {
  const devices = useApi<any[]>(['settings', 'push-devices'], '/push/devices');
  const [sub, setSub] = useState<PushSubscription | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const supported = pushSupported();
  const iosNeedsInstall = isIos() && !isStandalone();

  useEffect(() => {
    if (!supported) return setSub(null);
    navigator.serviceWorker
      .getRegistration('/')
      .then((r) => r?.pushManager.getSubscription() ?? null)
      .then((s) => setSub(s))
      .catch(() => setSub(null));
  }, [supported]);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error(t('Notifications are blocked for this site. Allow them in the browser settings.'));
      const reg = await registration();
      const { publicKey } = await get<{ publicKey: string }>('/push/key');
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const json = s.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys, label: deviceLabel() });
      setSub(s);
      invalidate('settings');
      toast({ text: t('Push is on for this device') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    setBusy(true);
    try {
      if (sub) {
        await post('/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe().catch(() => null);
      }
      setSub(null);
      invalidate('settings');
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    const r = await post<{ ok: boolean }>('/push/test');
    toast(r.ok ? { text: t('Test sent – it should pop up in a moment') } : { text: t('No device answered'), error: true });
  };

  return (
    <div className="card pad stack">
      <div className="row between" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <BellRinging size={20} style={{ flex: 'none', marginTop: 2 }} />
          <div>
            <b>{t('Push on this device')}</b>
            <div className="small muted">{t('Notifications straight from ToHuus Hub, no extra app. Buttons like “Add to list” or “Accept” work right from the notification.')}</div>
          </div>
        </div>
        {supported && !iosNeedsInstall && sub !== undefined && <Toggle on={Boolean(sub)} onChange={(v) => (busy ? null : v ? enable() : disable())} label={t('Push on this device')} />}
      </div>
      {iosNeedsInstall && (
        <div className="banner warn" style={{ cursor: 'default' }}>
          <span className="ic"><DeviceMobile size={18} /></span>
          <div className="small">
            <b>{t('On iPhone and iPad: install the app first')}</b>
            <div>{t('Open ToHuus Hub in Safari, tap Share › “Add to Home Screen”, open it from the home screen and switch push on here. Apple only allows push for installed web apps (iOS 16.4 or newer).')}</div>
          </div>
        </div>
      )}
      {!supported && !iosNeedsInstall && <div className="small muted">{t('This browser can’t receive push notifications.')}</div>}
      {sub && (
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={test}>
          <BellRinging size={15} /> {t('Send a test')}
        </button>
      )}
      {devices.isLoading ? (
        <Skeleton n={1} h={52} />
      ) : (devices.data ?? []).length > 0 ? (
        <div className="list push-devices">
          {(devices.data ?? []).map((d) => (
            <div key={d.id} className="li">
              <DeviceMobile size={18} />
              <div className="grow">
                <div className="title small">{d.label || t('Device')}{d.user_name ? ` · ${d.user_name}` : ''}</div>
                <div className="sub">{d.last_ok_at ? t('last delivered {when}', { when: relTime(d.last_ok_at) }) : t('added {when}', { when: relTime(d.created_at) })}</div>
              </div>
              <button className="icon-btn plain" aria-label={t('Remove')} onClick={() => del(`/push/devices/${d.id}`).then(() => invalidate('settings'))}>
                <Trash size={16} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Two-way sync of the shopping list with a Home Assistant to-do entity (Assist, Siri, Alexa via HA). */
export function HaTodoCard() {
  const s = useApi<any>(['settings', 'ha-todo'], '/shop/ha-todo');
  const [entity, setEntity] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => s.data && setEntity(s.data.entity), [s.data]);
  if (!s.data) return <Skeleton n={1} h={120} />;
  const save = async (next: { enabled?: boolean; entity?: string }) => {
    setBusy(true);
    try {
      await put('/shop/ha-todo', next);
      invalidate('settings');
      toast({ text: t('Saved') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const r = await post('/shop/ha-todo/sync');
      if (r.error) throw new Error(r.error);
      toast({ text: t('Synced: {here} new here, {there} new in Home Assistant', { here: r.added_here, there: r.added_there }) });
      invalidate('settings', 'shopping');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const st = s.data.status ?? {};
  return (
    <div className="card pad stack">
      <div className="row between" style={{ gap: 10 }}>
        <div>
          <b>{t('Shopping list in Home Assistant')}</b>
          <div className="small muted">
            {t('Keeps the list in step with a Home Assistant to-do list, both ways. Then “Hey Siri / Alexa / Assist, put milk on the shopping list” lands here too.')}
          </div>
        </div>
        <Toggle on={Boolean(s.data.enabled)} onChange={(v) => save({ enabled: v, entity })} label={t('Shopping list in Home Assistant')} />
      </div>
      {!s.data.connected && <div className="small" style={{ color: 'var(--low)' }}>{t('Enter the Home Assistant address and token above first.')}</div>}
      <div className="field">
        <label>{t('To-do entity')}</label>
        <input className="input mono" value={entity} onChange={(e) => setEntity(e.target.value.trim())} placeholder="todo.shopping_list" />
        <div className="help">{t('The built-in list is {entity}. Any to-do entity works (e.g. Local To-do).', { entity: 'todo.shopping_list' })}</div>
      </div>
      {st.at && (
        <div className="small muted">
          {st.error ? t('Last attempt {when}: {error}', { when: relTime(st.at.replace('T', ' ').slice(0, 19)), error: st.error }) : t('Last synced {when} · {n} entries in Home Assistant', { when: relTime(st.at.replace('T', ' ').slice(0, 19)), n: st.items })}
        </div>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn" disabled={busy || !/^todo\.[a-z0-9_]+$/.test(entity)} onClick={() => save({ entity })}>{t('Save')}</button>
        <button className="btn" disabled={busy || !s.data.enabled || !s.data.connected} onClick={sync}>
          <ArrowsClockwise size={15} /> {t('Sync now')}
        </button>
      </div>
    </div>
  );
}
