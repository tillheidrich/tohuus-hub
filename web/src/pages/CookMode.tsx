/**
 * Cook mode: one step at a time, big text, the screen stays on. The household's own note ("So machen wir das",
 * the house version's note) is the first thing you read. Appliance settings (Thermomix or any other device) show
 * as chips under the step.
 */
import { ArrowLeft, ArrowRight, Check, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { Amounts } from '../RegionAmounts';
import { t } from '../i18n';

const SPEED_RE = /^(Stufe|Speed)\s*/i;

export interface DeviceSettings {
  time?: string | null;
  temp?: string | null;
  speed?: string | null;
  device?: string | null;
  mode?: string | null;
}

/** "Thermomix · 20 Min. · 100 °C · Stufe 1 · Linkslauf" as chips. */
export function DeviceChips({ tm }: { tm?: DeviceSettings | null }) {
  if (!tm || !(tm.time || tm.temp || tm.speed || tm.mode)) return null;
  return (
    <div className="tm">
      {tm.device && <span className="tm-device">{tm.device}</span>}
      {tm.time && <span>{tm.time}</span>}
      {tm.temp && <span>{tm.temp}</span>}
      {tm.speed && <span>{t('Speed {n}', { n: String(tm.speed).replace(SPEED_RE, '') })}</span>}
      {tm.mode && <span>{tm.mode}</span>}
    </div>
  );
}

export function CookMode({ r, houseNote, onClose, onDone }: { r: any; houseNote: string | null; onClose: () => void; onDone: () => void }) {
  const steps: { text: string; section?: string | null; tm?: DeviceSettings | null }[] = r.steps ?? [];
  const [i, setI] = useState(0);
  // keep the screen on while cooking (where the browser allows it)
  useEffect(() => {
    let lock: any = null;
    const nav = navigator as any;
    nav.wakeLock?.request?.('screen').then((l: any) => (lock = l)).catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => Math.min(steps.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      lock?.release?.().catch?.(() => {});
    };
  }, [steps.length, onClose]);
  const s = steps[i];
  const last = i === steps.length - 1;
  return (
    <div className="cookmode" role="dialog" aria-modal="true" aria-label={t('Cook mode')}>
      <div className="cookmode-head">
        <button className="icon-btn" onClick={onClose} aria-label={t('Close')}>
          <X size={18} />
        </button>
        <h2>{r.title}</h2>
      </div>
      <div className="cookmode-body" aria-live="polite">
        {houseNote && (
          <div className="cookmode-note">
            <div className="small" style={{ fontWeight: 700, marginBottom: 2 }}>{t('How we make it')}</div>
            {houseNote}
          </div>
        )}
        {s && (
          <>
            <div className="cookmode-count">
              {s.section ? `${s.section} · ` : ''}
              {t('Step {n} of {total}', { n: i + 1, total: steps.length })}
            </div>
            <div className="cookmode-step">
              <Amounts text={s.text} />
            </div>
            <DeviceChips tm={s.tm} />
          </>
        )}
      </div>
      <div className="cookmode-foot">
        <button className="btn lg" disabled={i === 0} onClick={() => setI(i - 1)}>
          <ArrowLeft size={18} /> {t('Back')}
        </button>
        {last ? (
          <button className="btn primary lg" onClick={onDone}>
            <Check size={18} weight="bold" /> {t('Cooked it!')}
          </button>
        ) : (
          <button className="btn primary lg" onClick={() => setI(i + 1)}>
            {t('Next')} <ArrowRight size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
