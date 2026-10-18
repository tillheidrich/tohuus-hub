/**
 * "Was ToHuus sich merkt" – Haushaltswissen (GET/POST/PATCH/DELETE /api/knowledge, docs/knowledge.md): cards grouped
 * by what they are about (a person, a room, a product or a free subject like "Rollo Erdgeschoss"), each with a
 * property and a value, a history of earlier values, "nur ich" or the whole household, optionally for guests.
 * On top: "Schreib es ToHuus" – one sentence, read without AI (POST /api/knowledge/say). Same screen on the iPhone
 * (KnowledgeView.swift). `KnowledgeFor` shows the cards of one person or place in their sheet.
 */
import { ArrowCounterClockwise, Brain, Camera, Eye, Lock, MagnifyingGlass, MapPin, Package, PaperPlaneRight, Plus, Tag, Trash, User, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Me } from '../App';
import { api, ApiError, del, invalidate, patch, post, relTime, useApi } from '../api';
import { t } from '../i18n';
import { useHealthConsent } from '../people/HealthConsent';
import { Empty, Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';
import './knowledge.css';

type Visibility = 'household' | 'me';
type SubjectKind = 'person' | 'place' | 'product' | 'free';
interface HistoryEntry {
  i: number;
  text: string;
  value?: string | null;
  until: string;
  at?: string;
  by?: string | null;
}
export interface Entry {
  id: number;
  subject: string | null;
  subjectRef: string | null;
  subjectKind: SubjectKind | null;
  property: string | null;
  value: string | null;
  text: string;
  note: string | null;
  photo: string | null;
  structured: boolean;
  visibility: Visibility;
  guests: boolean;
  sensitive: boolean;
  origin: string | null;
  author: string | null;
  mine: boolean;
  createdAt: string;
  updatedAt: string | null;
  updatedBy: string | null;
  history: HistoryEntry[];
  may: { edit: boolean; share: boolean; makePrivate: boolean };
}
interface Group {
  key: string;
  title: string | null;
  kind: SubjectKind | null;
  ref: string | null;
  entries: Entry[];
}
interface Subject {
  ref: string;
  name: string;
  kind: SubjectKind;
}
interface ListResponse {
  entries: Entry[];
  groups: Group[];
  subjects: Subject[];
}
type SayResult =
  | { kind: 'saved'; entry: Entry; updated: boolean; before: { text: string } | null; undo: string | null }
  | { kind: 'answer'; entries: Entry[] }
  | { kind: 'confirm'; action: 'delete' | 'share' | 'private'; entries: Entry[] }
  | { kind: 'form'; draft: { subject: string | null; subjectRef: string | null; property: string | null; value: string | null; text: string } };

/** examples for the empty state – a tap puts them into the field */
const EXAMPLES = () => [t('Mika shoe size 28'), t('Blind ground floor 120 x 160'), t('Cooker hood filter size 20 x 30'), t('Electricity meter number 1ESY1160'), t('Paediatrician 04181 12345')];

const ORIGIN: Record<string, string> = { app: 'in the app', web: 'in the app', assistant: 'via the assistant', telegram: 'via Telegram', share: 'shared', mcp: 'via MCP' };

export function KindIcon({ kind, size = 18 }: { kind: SubjectKind | null; size?: number }) {
  if (kind === 'person') return <User size={size} />;
  if (kind === 'place') return <MapPin size={size} />;
  if (kind === 'product') return <Package size={size} />;
  if (kind === 'free') return <Tag size={size} />;
  return <Brain size={size} />;
}

const undoAction = (undo: string | null | undefined) => (undo ? { label: t('Undo'), run: () => post(`/assistant/undo/${undo}`).then(() => invalidate('knowledge', 'memory')) } : undefined);

export function KnowledgePage({ me }: { me: Me }) {
  const [sp, setSp] = useSearchParams();
  const ref = sp.get('ref');
  const [query, setQuery] = useState('');
  const q = useApi<ListResponse>(['knowledge', ref ?? ''], `/knowledge${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
  const [text, setText] = useState('');
  const [onlyMe, setOnlyMe] = useState(false);
  const [touchedVis, setTouchedVis] = useState(false);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Partial<Entry> | null>(null);
  const [answer, setAnswer] = useState<Entry[] | null>(null);
  const [confirmBox, setConfirmBox] = useState<{ action: 'delete' | 'share' | 'private'; entries: Entry[] } | null>(null);
  const toast = useToast();
  const { withConsent, sheet } = useHealthConsent();
  const guest = Boolean(me.actor.houseGuest);

  const send = async () => {
    const s = text.trim();
    if (s.length < 2) return;
    setBusy(true);
    setAnswer(null);
    try {
      const body = { text: s, origin: 'web', ...(touchedVis ? { visibility: onlyMe ? 'me' : 'household' } : {}) };
      const r = await withConsent((consent) => post<SayResult>('/knowledge/say', consent ? { ...body, consent } : body));
      if (!r) return;
      if (r.kind === 'saved') {
        setText('');
        invalidate('knowledge', 'memory');
        toast({ text: r.before ? t('Changed: {text} (before: {old})', { text: r.entry.text, old: r.before.text }) : t('Noted: {text}', { text: r.entry.text }), action: undoAction(r.undo) });
      } else if (r.kind === 'answer') setAnswer(r.entries);
      else if (r.kind === 'confirm') {
        if (!r.entries.length) toast({ text: t('ToHuus found nothing that fits. Try the search.'), error: true });
        else setConfirmBox({ action: r.action, entries: r.entries });
      } else setEdit({ subject: r.draft.subject, subjectRef: r.draft.subjectRef, property: r.draft.property, value: r.draft.value, text: r.draft.text, visibility: onlyMe ? 'me' : 'household' });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const all = q.data?.groups ?? [];
    const f = query.trim().toLowerCase();
    if (!f) return all;
    return all
      .map((g) => ({ ...g, entries: g.entries.filter((e) => [g.title, e.property, e.value, e.text, e.note].some((x) => x?.toLowerCase().includes(f))) }))
      .filter((g) => g.entries.length);
  }, [q.data, query]);
  const filteredBy = ref ? (q.data?.groups[0]?.title ?? (q.data?.subjects ?? []).find((s) => s.ref === ref)?.name ?? null) : null;
  const total = q.data?.entries.length ?? 0;

  return (
    <div className="kn-page rise">
      {sheet}
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Your household memory')}</div>
          <h1>{t('What ToHuus remembers')}</h1>
          <p className="muted">{guest ? t('What the household shares with guests: sizes, numbers, how things work.') : t('Write it to ToHuus, then nobody has to ask you. And you don’t have to remember it yourself.')}</p>
        </div>
        {!guest && (
          <div className="actions">
            <button className="btn" onClick={() => setEdit({ visibility: 'household' })}>
              <Plus size={16} weight="bold" /> {t('Add yourself')}
            </button>
          </div>
        )}
      </header>

      {!guest && (
        <form
          className="kn-say card pad"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor="kn-say" className="kn-say-label">
            {t('Write it to ToHuus.')} <span className="muted">{t('ToHuus sorts it. Or just ask.')}</span>
          </label>
          <div className="kn-say-row">
            <input id="kn-say" className="input" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder={t('e.g. Mika shoe size 28')} autoComplete="off" />
            <button className="btn primary" disabled={busy || text.trim().length < 2} aria-label={t('Send')}>
              <PaperPlaneRight size={18} />
            </button>
          </div>
          <label className="row small kn-only-me">
            <input
              type="checkbox"
              checked={onlyMe}
              onChange={(e) => {
                setOnlyMe(e.target.checked);
                setTouchedVis(true);
              }}
            />
            {t('Only for me – the others don’t see it')}
          </label>
        </form>
      )}

      {answer && (
        <section className="card pad kn-answer" aria-live="polite">
          <div className="row between">
            <b>{answer.length ? t('This is what ToHuus knows:') : t('ToHuus doesn’t know that yet.')}</b>
            <button className="icon-btn plain" onClick={() => setAnswer(null)} aria-label={t('Close')}>
              <X size={16} />
            </button>
          </div>
          {answer.map((e) => (
            <EntryRow key={e.id} e={e} showSubject onOpen={() => setEdit(e)} />
          ))}
        </section>
      )}

      {ref && (
        <div className="row kn-filter">
          <span className="chip on">{filteredBy ?? ref}</span>
          <button className="btn sm ghost" onClick={() => setSp({})}>
            {t('Show everything')}
          </button>
        </div>
      )}

      {q.isLoading ? (
        <Skeleton n={3} h={64} />
      ) : total === 0 ? (
        <div className="card">
          <Empty icon={<Brain size={26} />} title={guest ? t('Nothing shared with guests yet') : t('What do you all know about your home?')}>
            {!guest && (
              <>
                <p style={{ margin: '0 0 10px' }}>{t('Sizes, measurements, numbers. Write a sentence above, ToHuus sorts it. For example:')}</p>
                <div className="kn-examples">
                  {EXAMPLES().map((x) => (
                    <button key={x} type="button" className="chip" onClick={() => setText(x)}>
                      {x}
                    </button>
                  ))}
                </div>
                <p className="small muted" style={{ margin: '10px 0 0' }}>{t('Doctors and other health things stay with you unless you share them.')}</p>
              </>
            )}
          </Empty>
        </div>
      ) : (
        <>
          {total > 4 && (
            <div className="kn-search">
              <MagnifyingGlass size={16} aria-hidden="true" />
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Search, e.g. shoe size')} aria-label={t('Search what ToHuus remembers')} />
            </div>
          )}
          {groups.length === 0 && <p className="muted">{t('Nothing found.')}</p>}
          <div className="kn-groups">
            {groups.map((g) => (
              <section key={g.key} className="hcard kn-group" aria-label={g.title ?? t('Other things')}>
                <div className="hcard-h">
                  <h2>
                    <KindIcon kind={g.kind} /> {g.title ?? t('Other things')}
                  </h2>
                  {!guest && g.title && (
                    <button className="btn sm ghost" onClick={() => setEdit({ subject: g.title, subjectRef: g.ref, visibility: 'household' })} aria-label={t('Add to {name}', { name: g.title ?? '' })}>
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                <ul className="hrows">
                  {g.entries.map((e) => (
                    <EntryRow key={e.id} e={e} onOpen={guest ? undefined : () => setEdit(e)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
      {!guest && (
        <p className="small muted kn-foot">
          {t('ToHuus is no notebook and no calendar: only what belongs to your home. Codes and passwords go into')} <Link to="/hausinfo">{t('House info')}</Link>.
        </p>
      )}
      {edit && <EntrySheet init={edit} subjects={q.data?.subjects ?? []} onClose={() => setEdit(null)} />}
      {confirmBox && <ConfirmSheet box={confirmBox} onClose={() => setConfirmBox(null)} />}
    </div>
  );
}

function EntryRow({ e, onOpen, showSubject = false }: { e: Entry; onOpen?: () => void; showSubject?: boolean }) {
  const label = e.structured || e.property ? `${showSubject && e.subject ? `${e.subject} · ` : ''}${e.property ?? ''}` : null;
  const body = (
    <>
      {e.photo && <img className="kn-photo-thumb" src={e.photo} alt="" loading="lazy" />}
      <span className="grow kn-row-text">
        {label ? (
          <>
            <span className="kn-prop">{label}</span>
            <b className="kn-value">{e.value}</b>
          </>
        ) : (
          <b>{e.text}</b>
        )}
        {e.note && <span className="meta kn-note">{e.note}</span>}
        <span className="meta">
          {[e.updatedBy ?? e.author, relTime(e.updatedAt ?? e.createdAt)].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="kn-badges">
        {e.visibility === 'me' && (
          <span className="kn-badge" title={t('Only for me')}>
            <Lock size={14} /> <span className="sr-only">{t('Only for me')}</span>
          </span>
        )}
        {e.guests && (
          <span className="kn-badge" title={t('Guests see it too')}>
            <Eye size={14} /> <span className="sr-only">{t('Guests see it too')}</span>
          </span>
        )}
      </span>
    </>
  );
  return <li className="hrow kn-row">{onOpen ? <button className="kn-open" onClick={onOpen}>{body}</button> : <div className="kn-open">{body}</div>}</li>;
}

/** what the "Schreib es ToHuus" field wants to delete, share or make private – done only after this yes */
function ConfirmSheet({ box, onClose }: { box: { action: 'delete' | 'share' | 'private'; entries: Entry[] }; onClose: () => void }) {
  const toast = useToast();
  const [ask, setAsk] = useState<Entry | null>(null);
  const run = async (e: Entry, consent?: boolean) => {
    try {
      if (box.action === 'delete') {
        const r = await del<{ undo: string }>(`/knowledge/${e.id}`);
        toast({ text: t('Deleted: {text}', { text: e.text }), action: undoAction(r.undo) });
      } else {
        const r = await patch<{ undo: string }>(`/knowledge/${e.id}`, { visibility: box.action === 'share' ? 'household' : 'me', ...(consent ? { consent } : {}) });
        toast({ text: box.action === 'share' ? t('Everyone in the household sees it now.') : t('Only you see it now.'), action: undoAction(r.undo) });
      }
      invalidate('knowledge', 'memory');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'health_share') return setAsk(e);
      toast({ text: (err as Error).message, error: true });
    }
  };
  const title = { delete: t('Delete this?'), share: t('Show it to the whole household?'), private: t('Only for you?') }[box.action];
  const verb = { delete: t('Delete'), share: t('Show to everyone'), private: t('Only for me') }[box.action];
  return (
    <Sheet open onClose={onClose} title={title}>
      <ul className="hrows">
        {box.entries.map((e) => (
          <li key={e.id} className="hrow">
            <span className="grow">
              <b>{e.text}</b>
            </span>
            <button className={`btn sm ${box.action === 'delete' ? 'danger' : 'primary'}`} onClick={() => run(e)}>
              {verb}
            </button>
          </li>
        ))}
      </ul>
      {ask && <HealthShareAsk onYes={() => run(ask, true).then(() => setAsk(null))} onNo={() => setAsk(null)} />}
    </Sheet>
  );
}

function HealthShareAsk({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  return (
    <div className="card pad kn-ask" role="alertdialog" aria-label={t('Share health information?')}>
      <b>{t('Share health information?')}</b>
      <p className="small" style={{ margin: '6px 0 10px' }}>{t('This looks like health information. Then everyone in the household sees it. It goes to the assistant only if you allowed that in the settings.')}</p>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onNo}>
          {t('Not now')}
        </button>
        <button className="btn primary" onClick={onYes}>
          {t('Share anyway')}
        </button>
      </div>
    </div>
  );
}

/** create or edit one card: subject, property, value, note, photo, who sees it, history, delete */
function EntrySheet({ init, subjects, onClose }: { init: Partial<Entry>; subjects: Subject[]; onClose: () => void }) {
  const isNew = !init.id;
  const live = useApi<Entry>(['knowledge', 'entry', init.id ?? 0], init.id ? `/knowledge/${init.id}` : null);
  const e = (live.data ?? init) as Partial<Entry>;
  const plain = Boolean(init.id && !init.structured && !init.property);
  const [subject, setSubject] = useState(init.subject ?? '');
  const [property, setProperty] = useState(init.property ?? '');
  const [value, setValue] = useState(init.value ?? '');
  const [text, setText] = useState(plain || isNew ? (init.text ?? '') : '');
  const [note, setNote] = useState(init.note ?? '');
  const [vis, setVis] = useState<Visibility>(init.visibility ?? 'household');
  // a new health entry stays private unless someone picks „Ganzer Haushalt“ on purpose (server default)
  const [visTouched, setVisTouched] = useState(false);
  const [guests, setGuests] = useState(Boolean(init.guests));
  const [busy, setBusy] = useState(false);
  const [askShare, setAskShare] = useState(false);
  const toast = useToast();
  const { withConsent, sheet } = useHealthConsent();
  useEffect(() => {
    if (live.data) setVis(live.data.visibility);
  }, [live.data?.visibility]); // eslint-disable-line react-hooks/exhaustive-deps

  const refFor = (name: string) => subjects.find((s) => s.name.toLowerCase() === name.trim().toLowerCase())?.ref ?? null;
  const done = (msg: string, undo?: string | null) => {
    invalidate('knowledge', 'memory');
    toast({ text: msg, action: undoAction(undo) });
  };

  const save = async (consent?: boolean) => {
    setBusy(true);
    try {
      if (isNew) {
        const structured = property.trim() && value.trim();
        const body = structured
          ? { subject: subject.trim(), subjectRef: refFor(subject), property: property.trim(), value: value.trim(), note: note.trim() || null, guests, origin: 'web' }
          : { text: (text || value).trim(), note: note.trim() || null, guests, origin: 'web' };
        if (visTouched || vis === 'me') Object.assign(body, { visibility: vis });
        const r = await withConsent((c) => post<{ entry: Entry; undo: string; before: { text: string } | null }>('/knowledge', c || consent ? { ...body, consent: true } : body));
        if (!r) return;
        done(r.before ? t('Changed: {text} (before: {old})', { text: r.entry.text, old: r.before.text }) : t('Noted: {text}', { text: r.entry.text }), r.undo);
        onClose();
        return;
      }
      const cur = live.data ?? (init as Entry);
      const body: Record<string, unknown> = {};
      if (plain && !property.trim()) {
        if (text.trim() !== cur.text) body.text = text.trim();
      } else {
        if (subject.trim() !== (cur.subject ?? '')) {
          body.subject = subject.trim();
          body.subjectRef = refFor(subject);
        }
        if (property.trim() !== (cur.property ?? '')) body.property = property.trim();
        if (value.trim() !== (cur.value ?? '')) body.value = value.trim();
      }
      if (note.trim() !== (cur.note ?? '')) body.note = note.trim() || null;
      if (vis !== cur.visibility) body.visibility = vis;
      if (guests !== cur.guests) body.guests = guests;
      if (!Object.keys(body).length) return onClose();
      const r = await withConsent((c) => patch<{ entry: Entry; undo: string }>(`/knowledge/${cur.id}`, c || consent ? { ...body, consent: true } : body));
      if (!r) return;
      done(t('Changed: {text}', { text: r.entry.text }), r.undo);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'health_share') setAskShare(true);
      else toast({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!init.id) return;
    try {
      const r = await del<{ undo: string }>(`/knowledge/${init.id}`);
      done(t('Deleted: {text}', { text: e.text ?? '' }), r.undo);
      onClose();
    } catch (err) {
      toast({ text: (err as Error).message, error: true });
    }
  };
  const historyDo = async (h: HistoryEntry, what: 'restore' | 'remove') => {
    try {
      const r = what === 'restore' ? await post<{ undo: string }>(`/knowledge/${init.id}/history/${h.i}/restore`) : await del<{ undo: string }>(`/knowledge/${init.id}/history/${h.i}`);
      done(what === 'restore' ? t('Earlier value is back.') : t('Removed from the history.'), r.undo);
      invalidate('knowledge');
      if (what === 'restore') onClose();
    } catch (err) {
      toast({ text: (err as Error).message, error: true });
    }
  };
  const photo = async (f: File | null) => {
    if (!f || !init.id) return;
    const fd = new FormData();
    fd.append('image', f);
    try {
      await api(`/knowledge/${init.id}/photo`, { method: 'POST', form: fd });
      invalidate('knowledge');
    } catch (err) {
      toast({ text: (err as Error).message, error: true });
    }
  };

  // who may flip it: the author shares a private card; the author (or an admin, for the author) makes one private
  const mayVis = isNew || (e.visibility === 'me' ? Boolean(e.may?.share) : Boolean(e.may?.makePrivate));
  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? t('Remember something') : (e.subject ?? t('Change'))}
      footer={
        <div className="row between" style={{ gap: 8 }}>
          {!isNew ? (
            <button className="btn ghost danger" onClick={remove}>
              <Trash size={16} /> {t('Delete')}
            </button>
          ) : (
            <span />
          )}
          <button className="btn primary" disabled={busy || (isNew ? !((property.trim() && value.trim() && subject.trim()) || (text || value).trim().length >= 2) : false)} onClick={() => save()}>
            {t('Save')}
          </button>
        </div>
      }
    >
      {sheet}
      <div className="stack kn-form" style={{ gap: 14 }}>
        {(plain || (isNew && init.text)) && (
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="kn-text">{t('What ToHuus remembers')}</label>
            <textarea id="kn-text" className="input" rows={2} maxLength={300} value={text} onChange={(ev) => setText(ev.target.value)} />
            {isNew && <div className="help">{t('Saved as a line, or fill in the fields below to make it a card.')}</div>}
          </div>
        )}
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="kn-subject">{t('Who or what?')}</label>
          <input id="kn-subject" className="input" list="kn-subjects" value={subject} maxLength={80} onChange={(ev) => setSubject(ev.target.value)} placeholder={t('e.g. Mika, living room, car')} />
          <datalist id="kn-subjects">
            {subjects.map((s) => (
              <option key={s.ref} value={s.name} />
            ))}
          </datalist>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="field grow" style={{ margin: 0, minWidth: 140 }}>
            <label htmlFor="kn-prop">{t('What exactly?')}</label>
            <input id="kn-prop" className="input" value={property} maxLength={60} onChange={(ev) => setProperty(ev.target.value)} placeholder={t('e.g. shoe size')} />
          </div>
          <div className="field grow" style={{ margin: 0, minWidth: 120 }}>
            <label htmlFor="kn-value">{t('Value')}</label>
            <input id="kn-value" className="input" value={value} maxLength={120} onChange={(ev) => setValue(ev.target.value)} placeholder={t('e.g. 28')} />
          </div>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="kn-note">{t('Note')}</label>
          <textarea id="kn-note" className="input" rows={2} maxLength={500} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder={t('e.g. inside measurement, without the box')} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>{t('Who sees it?')}</label>
          <Seg<Visibility>
            value={vis}
            onChange={(v) => {
              if (!mayVis) return;
              setVis(v);
              setVisTouched(true);
            }}
            label={t('Who sees it?')}
            options={[
              ['household', t('Whole household')],
              ['me', t('Only me')],
            ]}
          />
          {!mayVis && <div className="help">{e.visibility === 'me' ? t('Only the person who wrote it can share it.') : t('Only the person who wrote it can make it private.')}</div>}
          {!isNew && e.visibility === 'me' && vis === 'household' && <div className="help">{t('The others see what changes from now on. The earlier values stay with you.')}</div>}
        </div>
        {vis === 'household' && !e.sensitive && (
          <div className="row between" style={{ gap: 12 }}>
            <span>
              <b>{t('Guests see it too')}</b>
              <span className="help" style={{ display: 'block' }}>{t('Permanent guests like grandma, the way House info works.')}</span>
            </span>
            <Toggle on={guests} onChange={setGuests} label={t('Guests see it too')} />
          </div>
        )}
        {!isNew && (
          <div className="field" style={{ margin: 0 }}>
            <label>{t('Photo')}</label>
            <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
              {e.photo && <img className="kn-photo" src={e.photo} alt={t('Photo of {text}', { text: e.text ?? '' })} />}
              <label className="btn sm">
                <Camera size={16} /> {e.photo ? t('Other photo') : t('Add photo')}
                <input type="file" accept="image/*" hidden onChange={(ev) => photo(ev.target.files?.[0] ?? null)} />
              </label>
              {e.photo && (
                <button className="btn sm ghost" onClick={() => del(`/knowledge/${init.id}/photo`).then(() => invalidate('knowledge'))}>
                  {t('Remove photo')}
                </button>
              )}
            </div>
          </div>
        )}
        {!isNew && (e.history?.length ?? 0) > 0 && (
          <div className="field" style={{ margin: 0 }}>
            <label>{t('Before')}</label>
            <ul className="hrows kn-history">
              {e.history!.map((h) => (
                <li key={`${h.i}-${h.at ?? h.until}`} className="hrow">
                  <span className="grow">
                    <b>{h.value ?? h.text}</b>
                    <span className="meta">{[h.by, h.at ? relTime(h.at) : h.until].filter(Boolean).join(' · ')}</span>
                  </span>
                  <button className="btn sm ghost" onClick={() => historyDo(h, 'restore')} aria-label={t('Bring back {value}', { value: h.value ?? h.text })}>
                    <ArrowCounterClockwise size={15} /> {t('Bring back')}
                  </button>
                  <button className="icon-btn plain" onClick={() => historyDo(h, 'remove')} aria-label={t('Remove {value} from the history', { value: h.value ?? h.text })}>
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!isNew && (
          <p className="small muted" style={{ margin: 0 }}>
            {[e.author, e.origin ? t(ORIGIN[e.origin] ?? e.origin) : null, e.createdAt ? relTime(e.createdAt) : null].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      {askShare && (
        <HealthShareAsk
          onYes={() => {
            setAskShare(false);
            void save(true);
          }}
          onNo={() => setAskShare(false)}
        />
      )}
    </Sheet>
  );
}

/** The cards about one person or place – in their sheet (People, Places). Hidden when there is nothing and nobody may add. */
export function KnowledgeFor({ refKey, name, canAdd = true }: { refKey: string; name: string; canAdd?: boolean }): ReactNode {
  const q = useApi<ListResponse>(['knowledge', refKey], `/knowledge?ref=${encodeURIComponent(refKey)}`);
  const [edit, setEdit] = useState<Partial<Entry> | null>(null);
  const entries = q.data?.entries ?? [];
  if (q.isError || (!entries.length && !canAdd)) return null;
  return (
    <div className="field kn-for" style={{ margin: 0 }}>
      <label className="row between">
        <span className="row" style={{ gap: 6 }}>
          <Brain size={16} /> {t('What ToHuus remembers')}
        </span>
        <Link to={`/wissen?ref=${encodeURIComponent(refKey)}`} className="small">
          {t('Show all')}
        </Link>
      </label>
      {entries.length ? (
        <ul className="hrows">
          {entries.map((e) => (
            <EntryRow key={e.id} e={e} onOpen={canAdd ? () => setEdit(e) : undefined} />
          ))}
        </ul>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>{t('Nothing about {name} yet – e.g. sizes or measurements.', { name })}</p>
      )}
      {canAdd && (
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setEdit({ subject: name, subjectRef: refKey, visibility: 'household' })}>
          <Plus size={14} /> {t('Add')}
        </button>
      )}
      {edit && <EntrySheet init={edit} subjects={q.data?.subjects ?? []} onClose={() => setEdit(null)} />}
    </div>
  );
}

