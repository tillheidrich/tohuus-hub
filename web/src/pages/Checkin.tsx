/**
 * "Was habt ihr heute gelöst?" (server: lib/checkin.ts, docs/checkin.md, iOS: CheckinViews.swift) – in the evening,
 * every other day at most. Tap what got done and who did it; the rest as a few words. Always positive: the answer is
 * "Heute habt ihr zusammen 6 Sachen gelöst", never who did less. Skipping is fine.
 * Plus "Fertig für heute": nothing due, nothing waiting – put the phone away.
 */
import { Check, Moon, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { invalidate, post, put, useApi } from '../api';
import { t } from '../i18n';
import { Toggle, useToast } from '../ui';

interface CheckinData {
  on: boolean;
  ask: boolean;
  question: string;
  chips: { task_id: number; name: string; done_today: boolean }[];
  members: { id: number; name: string; color: string; me: boolean }[];
  solved_today: number;
}

/** Who did it – the chips under a ticked task or a free entry. */
function Who({ members, value, onChange, label }: { members: CheckinData['members']; value: number; onChange: (id: number) => void; label: string }) {
  if (members.length < 2) return null;
  return (
    <div className="chips checkin-who" role="radiogroup" aria-label={label}>
      {members.map((m) => (
        <button key={m.id} type="button" role="radio" aria-checked={value === m.id} className={`chip sm ${value === m.id ? 'on' : ''}`} onClick={() => onChange(m.id)}>
          {m.me ? t('Me') : m.name}
        </button>
      ))}
    </div>
  );
}

export function CheckinCard({ guest }: { guest?: boolean }) {
  const q = useApi<CheckinData>(['checkin'], guest ? null : '/checkin');
  const toast = useToast();
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [extra, setExtra] = useState<{ text: string; who: number }[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const d = q.data;
  if (guest || !d?.ask) return null;
  const me = d.members.find((m) => m.me)?.id ?? 0;
  const toggle = (id: number) => setPicked((p) => (id in p ? Object.fromEntries(Object.entries(p).filter(([k]) => Number(k) !== id)) : { ...p, [id]: me }));
  const addText = () => {
    if (!text.trim()) return;
    setExtra((x) => [...x, { text: text.trim(), who: me }]);
    setText('');
  };
  const save = async () => {
    setBusy(true);
    try {
      const items = [...Object.entries(picked).map(([id, who]) => ({ task_id: Number(id), who })), ...extra.map((x) => ({ text: x.text, who: x.who }))];
      if (text.trim()) items.push({ text: text.trim(), who: me });
      const r = await post<{ message: string }>('/checkin', { items });
      toast({ text: r.message });
      invalidate('checkin', 'care', 'mind', 'today');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const skip = () => post('/checkin/skip').then(() => invalidate('checkin'));
  const off = () =>
    put('/checkin/settings', { on: false })
      .then(() => {
        invalidate('checkin');
        toast({ text: t('Okay – ToHuus won’t ask in the evening any more. You can switch it back on in your settings.') });
      })
      .catch((e: Error) => toast({ text: e.message, error: true }));
  const count = Object.keys(picked).length + extra.length + (text.trim() ? 1 : 0);
  return (
    <section className="hcard checkin-card" aria-labelledby="h-checkin">
      <div className="hcard-h">
        <h2 id="h-checkin">
          <span className="shape c" aria-hidden="true" />
          {d.question}
        </h2>
      </div>
      <p className="small muted" style={{ margin: '0 0 10px' }}>
        {t('A lot gets solved without an app. Two taps, so it gets seen – and ToHuus learns who does what.')}
      </p>
      {d.chips.length > 0 && (
        <div className="checkin-chips">
          {d.chips.map((c) => {
            const on = c.task_id in picked || c.done_today;
            return (
              <div key={c.task_id} className="checkin-chip">
                <button type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} disabled={c.done_today} onClick={() => toggle(c.task_id)}>
                  {on && <Check size={13} weight="bold" aria-hidden="true" />} {c.name}
                </button>
                {c.task_id in picked && (
                  <Who members={d.members} value={picked[c.task_id]} onChange={(id) => setPicked((p) => ({ ...p, [c.task_id]: id }))} label={t('Who did “{task}”?', { task: c.name })} />
                )}
              </div>
            );
          })}
        </div>
      )}
      {extra.length > 0 && (
        <ul className="checkin-extra">
          {extra.map((x, i) => (
            <li key={i} className="small">
              <Check size={13} aria-hidden="true" /> {x.text}
              {x.who !== me && ` · ${d.members.find((m) => m.id === x.who)?.name ?? ''}`}
              <Who members={d.members} value={x.who} onChange={(id) => setExtra((all) => all.map((y, j) => (j === i ? { ...y, who: id } : y)))} label={t('Who did it?')} />
            </li>
          ))}
        </ul>
      )}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <input
          className="input grow"
          value={text}
          maxLength={200}
          placeholder={t('Something else – e.g. took the dog out')}
          aria-label={t('Something else')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addText()}
        />
        <button type="button" className="btn" onClick={addText} disabled={!text.trim()} aria-label={t('Add')}>
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <button type="button" className="btn primary" disabled={busy || count === 0} onClick={save}>
          {t('Done')}
        </button>
        <button type="button" className="btn ghost" onClick={skip}>
          {t('Not today')}
        </button>
        <button type="button" className="linkish small" onClick={off}>
          {t('Don’t ask any more')}
        </button>
      </div>
    </section>
  );
}

/** "Fertig für heute": nothing due, nothing waiting. A quiet end to Heute – no feed below. */
export function CalmCard() {
  return (
    <div className="calm-card" role="status">
      <Moon size={22} aria-hidden="true" />
      <div>
        <b>{t('Everything important is done for today.')}</b>
        <div className="small muted">{t('Put the phone down – ToHuus will be here when you need it.')}</div>
      </div>
    </div>
  );
}

/** Settings › Konto: "Abends fragen, was ihr gelöst habt" – personal, on by default. */
export function CheckinSettingsCard() {
  const q = useApi<CheckinData>(['checkin'], '/checkin');
  const toast = useToast();
  if (!q.data) return null;
  const set = (on: boolean) =>
    put('/checkin/settings', { on })
      .then(() => invalidate('checkin'))
      .catch((e: Error) => toast({ text: e.message, error: true }));
  return (
    <div className="card pad row between" style={{ marginTop: 22, gap: 14 }}>
      <span className="grow">
        <b>{t('Ask in the evening what we solved')}</b>
        <span className="small muted" style={{ display: 'block' }}>
          {t('Every other evening at most, on Heute – never as a notification.')}
        </span>
      </span>
      <Toggle on={q.data.on} onChange={set} label={t('Ask in the evening what we solved')} />
    </div>
  );
}
