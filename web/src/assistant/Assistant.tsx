/**
 * Assistant sheet (plan 2026-10-12, API: POST /api/assistant/chat, /voice, /undo/:token).
 * Chat bubbles, a text field, a microphone (MediaRecorder → /assistant/voice as multipart `audio`), every write
 * reported as a small receipt with "Undo", suggestion chips for a first question. When the month's messages are
 * used up (GET /api/billing/status), a calm note explains what happens next – no hard sell.
 */
import { ArrowCounterClockwise, Check, Microphone, PaperPlaneRight, Stop } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, invalidate, post } from '../api';
import { assistantLeft, markMissing, missing, useBilling } from '../data';
import { t } from '../i18n';
import { Sheet } from '../ui';
import { screenContext } from './areas';

interface Action {
  kind: string;
  summary: string;
  undo?: string | null;
  undone?: boolean;
}
interface Msg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  actions?: Action[];
  pending?: boolean;
  error?: boolean;
  throttled?: boolean;
}
interface ChatAnswer {
  conversationId: string;
  reply: string;
  actions?: Action[];
  text?: string;
  transcript?: string;
  mode?: 'ai' | 'basic';
  /** messages left this month (null = unlimited) */
  remaining?: number | null;
  /** Plus fair use: answered, but shorter */
  throttled?: boolean;
}

let nextId = 1;
// the conversation survives closing the sheet (but not a reload)
let memory: { conversationId?: string; msgs: Msg[] } = { msgs: [] };

const SUGGESTIONS = ['What’s missing?', 'What shall I cook today?', 'What did we spend this month?', 'Milk is out'];

/** mp4 (Safari, iPhone) and ogg/opus first – the transcription takes both directly; webm only as the last resort */
function pickMime() {
  const types = ['audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
  for (const m of types) if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  return '';
}

export function AssistantSheet({ open, onClose, seed, voice }: { open: boolean; onClose: () => void; seed: { text?: string; send?: boolean }; voice: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>(memory.msgs);
  const [text, setText] = useState(seed.text && !seed.send ? seed.text : '');
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState<{ started: number } | null>(null);
  const [secs, setSecs] = useState(0);
  const [quotaHit, setQuotaHit] = useState(false);
  const [leftNow, setLeftNow] = useState<number | null | undefined>(undefined);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const billing = useBilling(open);
  const left = leftNow !== undefined ? leftNow : assistantLeft(billing.data);
  const exhausted = quotaHit || left === 0;
  const canRecord = voice && typeof window !== 'undefined' && 'MediaRecorder' in window && Boolean(navigator.mediaDevices?.getUserMedia);

  useEffect(() => {
    memory.msgs = msgs;
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);
  useEffect(() => {
    if (seed.text && seed.send) void send(seed.text);
    else setTimeout(() => input.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!rec) return;
    const id = setInterval(() => setSecs(Math.round((Date.now() - rec.started) / 1000)), 250);
    return () => clearInterval(id);
  }, [rec]);
  // never leave the microphone on when the sheet closes
  useEffect(
    () => () => {
      chunks.current = []; // closing the sheet discards the recording
      if (recorder.current?.state === 'recording') recorder.current.stop();
    },
    [],
  );

  const push = (m: Omit<Msg, 'id'>) => {
    const id = nextId++;
    setMsgs((l) => [...l, { ...m, id }]);
    return id;
  };
  const update = (id: number, m: Partial<Msg>) => setMsgs((l) => l.map((x) => (x.id === id ? { ...x, ...m } : x)));

  const handle = (a: ChatAnswer, pendingId: number, userId?: number) => {
    memory.conversationId = a.conversationId ?? memory.conversationId;
    const heard = a.text ?? a.transcript;
    if (userId && heard) update(userId, { text: heard, pending: false });
    update(pendingId, { text: a.reply, actions: a.actions ?? [], pending: false, throttled: Boolean(a.throttled) });
    if (a.remaining !== undefined) setLeftNow(a.remaining);
    if (a.actions?.length) invalidate('today', 'shopping', 'overview', 'products', 'rhythm', 'plan');
    invalidate('billing');
  };
  const fail = (e: unknown, pendingId: number) => {
    if (missing(e)) {
      markMissing('/assistant/chat');
      window.dispatchEvent(new Event('tohuus:assistant-gone'));
      update(pendingId, { text: t('The assistant isn’t available on this server.'), pending: false, error: true });
      return;
    }
    // 402 quota.assistant: this month's messages are used up (simple list sentences keep working, see docs/assistant.md)
    if (e instanceof ApiError && (e.code === 'quota.assistant' || e.status === 402)) {
      setQuotaHit(true);
      update(pendingId, { text: t('I can only do the simple things this month: lists, “… is out”, what you bought. Everything else again from the 1st.'), pending: false });
      return;
    }
    if (e instanceof ApiError && e.status === 429) {
      update(pendingId, { text: t('A lot going on right now – please try again in a moment.'), pending: false, error: true });
      return;
    }
    update(pendingId, { text: (e as Error).message || t('Something went wrong. Try again.'), pending: false, error: true });
  };

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || busy) return;
    setText('');
    push({ role: 'user', text: message });
    const pid = push({ role: 'assistant', text: '', pending: true });
    setBusy(true);
    try {
      // the screen the person is on brings its context and tools (server/lib/assistant-areas.ts)
      handle(await post<ChatAnswer>('/assistant/chat', { message, conversationId: memory.conversationId, context: screenContext(window.location.pathname) }), pid);
    } catch (e) {
      fail(e, pid);
    } finally {
      setBusy(false);
    }
  }

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (ev) => ev.data.size && chunks.current.push(ev.data);
      r.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        void sendVoice(new Blob(chunks.current, { type: r.mimeType || 'audio/webm' }));
      };
      recorder.current = r;
      r.start();
      setSecs(0);
      setRec({ started: Date.now() });
    } catch {
      push({ role: 'assistant', text: t('The microphone is blocked. Allow it in the browser settings – or just type.'), error: true });
    }
  };
  const stopRec = () => {
    recorder.current?.stop();
    setRec(null);
  };
  async function sendVoice(blob: Blob) {
    if (blob.size < 800) return; // a tap, not a sentence
    const uid = push({ role: 'user', text: t('Voice message …'), pending: true });
    const pid = push({ role: 'assistant', text: '', pending: true });
    setBusy(true);
    const form = new FormData();
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    form.append('audio', blob, `voice.${ext}`);
    if (memory.conversationId) form.append('conversationId', memory.conversationId);
    const sc = screenContext(window.location.pathname);
    if (sc) form.append('context', sc);
    try {
      handle(await api<ChatAnswer>('/assistant/voice', { method: 'POST', form }), pid, uid);
      update(uid, { pending: false });
    } catch (e) {
      update(uid, { text: t('Voice message'), pending: false });
      fail(e, pid);
    } finally {
      setBusy(false);
    }
  }

  const undo = async (msgId: number, idx: number, token: string) => {
    try {
      await post(`/assistant/undo/${encodeURIComponent(token)}`);
      setMsgs((l) => l.map((m) => (m.id === msgId ? { ...m, actions: m.actions?.map((a, i) => (i === idx ? { ...a, undone: true } : a)) } : m)));
      invalidate('today', 'shopping', 'overview', 'products', 'rhythm', 'plan');
    } catch (e) {
      push({ role: 'assistant', text: (e as Error).message, error: true });
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('Assistant')}>
      <div className="assist">
        <div className="assist-log" ref={list} role="log" aria-live="polite" aria-label={t('Conversation')}>
          {msgs.length === 0 && (
            <div className="assist-hello">
              <p>{t('Tell me what’s missing, what you’d like to cook or what you want to know about your shopping. ToHuus remembers the rest.')}</p>
            </div>
          )}
          {msgs.map((m) => (
            <div key={m.id} className={`bubble ${m.role} ${m.error ? 'error' : ''}`}>
              {m.pending && !m.text ? (
                <span className="typing" aria-label={t('Thinking …')}>
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <p>{m.text}</p>
              )}
              {m.throttled && <small className="bubble-note">{t('A bit shorter today – it’s been a busy month.')}</small>}
              {m.actions && m.actions.length > 0 && (
                <ul className="receipts">
                  {m.actions.map((a, i) => (
                    <li key={i} className={a.undone ? 'undone' : ''}>
                      <Check size={14} weight="bold" aria-hidden="true" />
                      <span className="grow">{a.undone ? t('Undone: {what}', { what: a.summary }) : a.summary}</span>
                      {a.undo && !a.undone && (
                        <button className="btn sm ghost" onClick={() => undo(m.id, i, a.undo!)}>
                          <ArrowCounterClockwise size={14} /> {t('Undo')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {exhausted && (
          <div className="assist-quota" role="status">
            <b>{t('This month’s assistant messages are used up.')}</b>
            <p>
              {t('Lists and “… is out” keep working, everything else again from the 1st. “Haushalt” has 100 messages a month, “Plus” is meant for everyday use. For now you can subscribe in the iPhone app.')}
            </p>
          </div>
        )}
        {(
          <>
            {msgs.length === 0 && (
              <div className="chips assist-chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip" onClick={() => send(t(s))}>
                    {t(s)}
                  </button>
                ))}
              </div>
            )}
            <form
              className="assist-input"
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
            >
              {rec ? (
                <div className="rec-state" role="status">
                  <span className="rec-dot" aria-hidden="true" />
                  {t('Listening … {s} s', { s: secs })}
                </div>
              ) : (
                <textarea
                  ref={input}
                  className="input"
                  rows={1}
                  value={text}
                  placeholder={t('e.g. “Milk is out”')}
                  aria-label={t('Message')}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(text);
                    }
                  }}
                />
              )}
              {canRecord && !text.trim() ? (
                <button type="button" className={`icon-btn mic ${rec ? 'on' : ''}`} onClick={rec ? stopRec : startRec} disabled={busy} aria-label={rec ? t('Stop and send') : t('Speak')} aria-pressed={Boolean(rec)}>
                  {rec ? <Stop size={20} weight="fill" /> : <Microphone size={20} weight="fill" />}
                </button>
              ) : (
                <button type="submit" className="icon-btn send" disabled={busy || !text.trim()} aria-label={t('Send')}>
                  <PaperPlaneRight size={20} weight="fill" />
                </button>
              )}
            </form>
            {left != null && left <= 5 && <p className="assist-left">{left === 1 ? t('1 message left this month') : t('{n} messages left this month', { n: left })}</p>}
          </>
        )}
      </div>
    </Sheet>
  );
}
