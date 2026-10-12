/**
 * "Was ToHuus sich merkt" (GET/POST/DELETE /api/memory, docs/assistant.md): facts, preferences and routines the
 * household asked ToHuus to remember – a plain list where everyone can add a line or delete one. Outward the app
 * says "merkt sich", never "Gedächtnis". Plus the consent card for health data (Settings › Access & AI).
 */
import { Notebook, Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { del, invalidate, patch, post, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Empty, Skeleton, Toggle, useToast } from '../ui';
import { useHealthConsent } from '../people/HealthConsent';

interface MemoryRow {
  id: number;
  scope: 'household' | 'person';
  person: string | null;
  kind: 'fact' | 'preference' | 'routine';
  text: string;
  source: 'user' | 'assistant' | 'derived';
  sensitive: boolean;
  created_by: string | null;
  created_at: string;
}

const KIND: Record<MemoryRow['kind'], string> = { fact: 'Fact', preference: 'Preference', routine: 'Habit' };

export function MemoryPage() {
  const q = useApi<MemoryRow[]>('memory', '/memory');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { withConsent, sheet } = useHealthConsent();
  const add = async () => {
    if (text.trim().length < 2) return;
    setBusy(true);
    try {
      const body = { text: text.trim() };
      const saved = await withConsent((consent) => post('/memory', consent ? { ...body, consent } : body));
      if (saved === null) return;
      setText('');
      invalidate('memory');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (m: MemoryRow) => {
    try {
      await del(`/memory/${m.id}`);
      invalidate('memory');
      toast({ text: t('Forgotten: {text}', { text: m.text }), action: { label: t('Undo'), run: () => post('/memory', { text: m.text, kind: m.kind, person: m.person }).then(() => invalidate('memory')) } });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const rows = q.data ?? [];
  return (
    <div className="memory-page">
      {sheet}
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Assistant')}</div>
          <h1>{t('What ToHuus remembers')}</h1>
          <p className="muted">{t('Things you asked ToHuus to remember – for example “we don’t eat pork” or “Mira shops on Saturdays”. Delete anything at any time.')}</p>
        </div>
      </header>
      <form
        className="memory-add"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="input" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder={t('e.g. We shop at Aldi on Saturdays')} aria-label={t('Remember something new')} />
        <button className="btn primary" disabled={busy || text.trim().length < 2}>
          <Plus size={16} weight="bold" /> {t('Remember')}
        </button>
      </form>
      {q.isLoading ? (
        <Skeleton n={3} h={56} />
      ) : rows.length === 0 ? (
        <div className="hcard">
          <Empty icon={<Notebook size={26} />} title={t('Nothing yet')}>
            {t('Tell the assistant “remember that …” or add a line above.')}
          </Empty>
        </div>
      ) : (
        <ul className="hcard hrows memory-list">
          {rows.map((m) => (
            <li key={m.id} className="hrow">
              <div className="grow">
                <b>{m.text}</b>
                <span className="meta">
                  {[t(KIND[m.kind] ?? m.kind), m.sensitive ? t('sensitive – stays with you unless allowed') : null, m.created_by, relTime(m.created_at)].filter(Boolean).join(' · ')}
                </span>
              </div>
              <button className="icon-btn plain" onClick={() => remove(m)} aria-label={t('Forget “{text}”', { text: m.text })} title={t('Forget')}>
                <Trash size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Settings › Access & AI: consent for health data (ai.healthShare, Art. 9 GDPR) – off by default. */
export function AssistantPrivacyCard({ admin }: { admin: boolean }) {
  const s = useApi<{ healthShare: boolean }>(['assistant', 'settings'], '/assistant/settings');
  const toast = useToast();
  const set = async (v: boolean) => {
    try {
      await patch('/assistant/settings', { healthShare: v });
      invalidate('assistant', 'settings');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  if (s.isError) return null;
  return (
    <section className="card pad stack" aria-labelledby="ai-privacy-h" style={{ marginBottom: 16 }}>
      <h2 id="ai-privacy-h" style={{ margin: 0 }}>
        {t('Assistant & privacy')}
      </h2>
      <p className="small muted" style={{ margin: 0 }}>
        {t('The assistant knows your list, what you buy and your recipes. Allergies, children’s ages and anything health-related stay at home – unless you switch this on.')}
      </p>
      <div className="row between" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div>
          <b>{t('Share allergies and children’s details with the assistant')}</b>
          <div className="small muted">
            {t('Then it can take them into account when it suggests dishes. Off: unsuitable dishes are still left out, without saying why.')}{' '}
            {t('This applies to everyone in the household. Off by default.')}
          </div>
        </div>
        {s.data ? <Toggle on={s.data.healthShare} onChange={admin ? set : () => toast({ text: t('Only an admin can change this.'), error: true })} label={t('Share allergies and children’s details with the assistant')} /> : null}
      </div>
    </section>
  );
}
