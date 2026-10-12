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

export function assistantAvailable(): boolean {
  const i = qc.getQueryData<Instance>(['instance']);
  return Boolean(i?.features?.assistant) && !isMissing('/assistant/chat');
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
  const available = Boolean(inst.data?.features?.assistant) && !isMissing('/assistant/chat');
  if (!available && !open) return null;
  return (
    <>
      {available && (
        <button
          className="assist-fab"
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
          <span>{t('Say it')}</span>
        </button>
      )}
      {open && (
        <Suspense fallback={null}>
          <AssistantSheet open={open} onClose={() => setOpen(false)} seed={seed} voice={inst.data?.features?.voice !== false} />
        </Suspense>
      )}
    </>
  );
}
