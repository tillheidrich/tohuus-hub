/**
 * The assistant's floating button (plan 2026-10-12): microphone + text, on every tab. Tiny on purpose – the sheet
 * itself is a separate chunk that loads on the first tap. Hidden when the server has no assistant
 * (`/api/instance` → features.assistant, or a 404 from the chat endpoint).
 */
import { Microphone } from '@phosphor-icons/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { qc } from '../api';
import { type Instance, isMissing, useInstance } from '../data';
import { t } from '../i18n';

const AssistantSheet = lazy(() => import('./Assistant').then((m) => ({ default: m.AssistantSheet })));

/** Open the assistant from anywhere; `text` pre-fills (or sends) a message. */
export function openAssistant(text?: string, send = false) {
  window.dispatchEvent(new CustomEvent('tohuus:assistant', { detail: { text, send } }));
}

/**
 * The assistant exists on every server that has /api/instance: without an AI key it still understands the common
 * sentences ("Milch, 2 Paprika und Brot", "Milch ist alle") in basic mode (docs/assistant.md).
 */
const hasAssistant = (i: Instance | undefined) => Boolean(i && (i.known || i.features?.assistant)) && !isMissing('/assistant/chat');
export function assistantAvailable(): boolean {
  return hasAssistant(qc.getQueryData<Instance>(['instance']));
}

export function AssistantFab() {
  const inst = useInstance();
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<{ text?: string; send?: boolean }>({});
  const [, force] = useState(0);
  useEffect(() => {
    const on = (e: Event) => {
      setSeed((e as CustomEvent).detail ?? {});
      setOpen(true);
    };
    const gone = () => force((n) => n + 1);
    window.addEventListener('tohuus:assistant', on);
    window.addEventListener('tohuus:assistant-gone', gone);
    return () => {
      window.removeEventListener('tohuus:assistant', on);
      window.removeEventListener('tohuus:assistant-gone', gone);
    };
  }, []);
  // compact round mic once the page is scrolled – the label "Sagen" only at the top
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const on = () => setCompact(window.scrollY > 48);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const available = hasAssistant(inst.data);
  if (!available && !open) return null;
  return (
    <>
      {available && (
        <button
          className={compact ? 'assist-fab compact' : 'assist-fab'}
          onClick={() => {
            setSeed({});
            setOpen(true);
          }}
          onMouseEnter={() => import('./Assistant')}
          onTouchStart={() => import('./Assistant')}
          aria-label={t('Assistant: say or type what’s missing')}
          aria-haspopup="dialog"
        >
          <Microphone size={22} weight="fill" />
          {!compact && <span>{t('Say it')}</span>}
        </button>
      )}
      {open && (
        <Suspense fallback={null}>
          <AssistantSheet open={open} onClose={() => setOpen(false)} seed={seed} voice={Boolean(inst.data?.features?.voice)} />
        </Suspense>
      )}
    </>
  );
}
