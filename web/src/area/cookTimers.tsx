/**
 * Koch-Timer im Web (Paket E, wie `CookTimers` in ios/ToHuus/Features/Cooking/CookModeView.swift): times found in the
 * step text („10 Min.“, „1–2 Std.“, „30 Sek.“) and the appliance time become timer buttons. Timers keep running when
 * you go to the next step; the end is soft (a short tone, a vibration where the device has one, no alarm).
 */
import { Bell, Pause, Play, Plus, Timer, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

export { fmtTimer, stepDurations } from './durations';
import { fmtTimer, stepDurations } from './durations';

export interface CookTimer {
  id: number;
  label: string;
  total: number;
  /** when it ends (ms), or null while paused */
  endsAt: number | null;
  /** seconds left while paused */
  left: number;
  done: boolean;
}

function softTone() {
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) {
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 1);
      setTimeout(() => ctx.close().catch(() => {}), 1500);
    }
  } catch {
    /* no audio */
  }
  try {
    navigator.vibrate?.([120, 80, 120]);
  } catch {
    /* no vibration */
  }
}

let nextId = 1;

export function useCookTimers() {
  const [items, setItems] = useState<CookTimer[]>([]);
  const [, tick] = useState(0);
  const ref = useRef(items);
  ref.current = items;
  useEffect(() => {
    if (!items.some((x) => x.endsAt && !x.done)) return;
    const h = setInterval(() => {
      const now = Date.now();
      let finished = false;
      const next = ref.current.map((x) => {
        if (x.endsAt && !x.done && x.endsAt <= now) {
          finished = true;
          return { ...x, done: true, endsAt: null, left: 0 };
        }
        return x;
      });
      if (finished) {
        softTone();
        setItems(next);
      } else tick((n) => n + 1);
    }, 500);
    return () => clearInterval(h);
  }, [items]);
  const leftOf = (x: CookTimer) => (x.done ? 0 : x.endsAt ? (x.endsAt - Date.now()) / 1000 : x.left);
  return {
    items,
    running: items.filter((x) => !x.done),
    leftOf,
    start: (label: string, seconds: number) => setItems((xs) => [...xs, { id: nextId++, label, total: seconds, endsAt: Date.now() + seconds * 1000, left: seconds, done: false }]),
    toggle: (id: number) =>
      setItems((xs) => xs.map((x) => (x.id !== id || x.done ? x : x.endsAt ? { ...x, left: (x.endsAt - Date.now()) / 1000, endsAt: null } : { ...x, endsAt: Date.now() + x.left * 1000 }))),
    add: (id: number, seconds: number) =>
      setItems((xs) => xs.map((x) => (x.id !== id ? x : x.done ? { ...x, done: false, endsAt: Date.now() + seconds * 1000, left: seconds } : x.endsAt ? { ...x, endsAt: x.endsAt + seconds * 1000 } : { ...x, left: x.left + seconds }))),
    cancel: (id: number) => setItems((xs) => xs.filter((x) => x.id !== id)),
    cancelAll: () => setItems([]),
  };
}
export type CookTimersApi = ReturnType<typeof useCookTimers>;

/** buttons „Timer 10:00“ for the times in one step */
export function StepTimerButtons({ text, deviceTime, label, timers }: { text: string; deviceTime?: string | null; label: string; timers: CookTimersApi }) {
  const found = stepDurations(text, deviceTime);
  if (!found.length) return null;
  return (
    <div className="ktimers" style={{ marginTop: 12 }}>
      {found.map((secs) => (
        <button key={secs} type="button" className="ktimer ktimer-start" onClick={() => timers.start(label, secs)} title={t('Starts a timer that keeps running when you go on.')}>
          <Timer size={18} aria-hidden="true" /> {t('Timer {time}', { time: fmtTimer(secs) })}
        </button>
      ))}
    </div>
  );
}

/** the running timers: tap pauses, „+1“ adds a minute, × stops */
export function TimerBar({ timers }: { timers: CookTimersApi }) {
  if (!timers.items.length) return null;
  return (
    <div className="ktimers" role="group" aria-label={t('Timers')}>
      {timers.items.map((x) => {
        const left = timers.leftOf(x);
        return (
          <span key={x.id} className={`ktimer${x.done ? ' done' : ''}`} aria-live={x.done ? 'assertive' : 'off'}>
            <button type="button" className="icon-btn plain" onClick={() => timers.toggle(x.id)} aria-label={x.done ? t('Done!') : x.endsAt ? t('Pause') : t('Continue')}>
              {x.done ? <Bell size={16} /> : x.endsAt ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <span title={x.label}>{x.done ? t('Done!') : fmtTimer(left)}</span>
            <button type="button" className="icon-btn plain" onClick={() => timers.add(x.id, 60)} aria-label={t('1 minute more')}>
              <Plus size={14} />
            </button>
            <button type="button" className="icon-btn plain" onClick={() => timers.cancel(x.id)} aria-label={x.done ? t('Remove') : t('Stop')}>
              <X size={14} />
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** keeps the screen on while `on` (Screen Wake Lock API, where the browser has it); taken again after a tab switch */
export function useWakeLock(on: boolean): boolean {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  useEffect(() => {
    if (!on || !supported) return;
    let lock: { release: () => Promise<void> } | null = null;
    let alive = true;
    const take = () =>
      (navigator as unknown as { wakeLock: { request: (k: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
        .request('screen')
        .then((l) => {
          if (alive) lock = l;
          else l.release().catch(() => {});
        })
        .catch(() => {});
    void take();
    const onVis = () => document.visibilityState === 'visible' && take();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, [on, supported]);
  return supported;
}
