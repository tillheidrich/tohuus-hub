/**
 * Im Kopf (server: lib/mind.ts, docs/mind.md, iOS: MindViews.swift).
 * What a person carries around without it being a task ("Was essen wir Samstag, wenn Sam abends weg ist?") and what
 * they did on the side without writing it down – so it gets seen. Private or for everyone, switchable any time;
 * a household entry can be hidden from single members (a present for them). "Ich denk mit" / "Danke" show names,
 * never counts. Never to the assistant, MCP, Home Assistant, notifications or exports.
 */
import { ArrowRight, Brain, Check, CheckCircle, Eye, EyeSlash, HandHeart, ListChecks, Lock, Trash, UsersThree } from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { del, invalidate, patch, post, useApi } from '../api';
import { t } from '../i18n';
import { Seg, useToast } from '../ui';
import { ShareTextButton } from '../share/share';

export interface MindItem {
  id: number;
  text: string;
  kind: 'open' | 'done';
  mine: boolean;
  by: { id: number; name: string; color: string } | null;
  visibility: 'private' | 'household';
  hide_from: number[];
  nods: { id: number; name: string }[];
  nodded: boolean;
  created_at: string;
  done_at: string | null;
  /** someone else did it – the author wrote it down */
  done_by?: { id: number; name: string; color: string } | null;
  about_me?: boolean;
}
interface MindData {
  mine: { open: MindItem[]; done: MindItem[] };
  others: { open: MindItem[]; done: MindItem[] };
  members: { id: number; name: string }[];
}

const useMind = (enabled = true) => useApi<MindData>('mind', enabled ? '/mind' : null);

function useAct() {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      invalidate('mind');
      if (done) toast({ text: done });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
}

/** Write down what's on your mind – or what you just did on the side. */
function Composer({ members, compact = false }: { members: MindData['members']; compact?: boolean }) {
  const act = useAct();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'open' | 'done'>('open');
  const [priv, setPriv] = useState(false);
  const [hide, setHide] = useState<number[]>([]);
  const [doneBy, setDoneBy] = useState<number | null>(null);
  const send = () => {
    if (!text.trim()) return;
    const other = kind === 'done' ? doneBy : null;
    const body = { text: text.trim(), kind, visibility: priv && !other ? 'private' : 'household', hide_from: priv || other ? [] : hide, done_by: other };
    act(
      () => post('/mind', body),
      other ? t('Noted – they’ll see your thanks.') : kind === 'done' ? t('Seen – nice that you did it.') : priv ? t('Noted – only for you.') : t('Noted – the others can see it.'),
    ).then(() => {
      setText('');
      setHide([]);
      setDoneBy(null);
    });
  };
  return (
    <div className="mind-compose stack" style={{ gap: 10 }}>
      <Seg
        value={kind}
        onChange={setKind}
        label={t('What is it?')}
        full={compact}
        options={[
          ['open', t('On my mind')],
          ['done', t('Done on the side')],
        ]}
      />
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input grow"
          value={text}
          maxLength={200}
          aria-label={kind === 'done' ? t('What did you do?') : t('What’s on your mind?')}
          placeholder={kind === 'done' ? t('e.g. Called the paediatrician, thought of Grandma’s birthday') : t('e.g. What do we eat on Saturday when Sam is out?')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button className="btn primary" disabled={!text.trim()} onClick={send}>
          {t('Add')}
        </button>
      </div>
      {kind === 'done' && members.length > 0 && (
        <div className="row wrap mind-who" role="radiogroup" aria-label={t('Who did it?')} style={{ gap: 6 }}>
          <span className="small muted">{t('Who did it?')}</span>
          <button type="button" role="radio" aria-checked={doneBy == null} className={`chip sm ${doneBy == null ? 'on' : ''}`} onClick={() => setDoneBy(null)}>
            {t('Me')}
          </button>
          {members.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={doneBy === m.id} className={`chip sm ${doneBy === m.id ? 'on' : ''}`} onClick={() => setDoneBy(m.id)}>
              {m.name}
            </button>
          ))}
        </div>
      )}
      {!(kind === 'done' && doneBy != null) && <div className="row wrap mind-who" style={{ gap: 6 }}>
        <button type="button" className={`chip sm ${!priv ? 'on' : ''}`} aria-pressed={!priv} onClick={() => setPriv(false)}>
          <UsersThree size={14} aria-hidden="true" /> {t('For everyone')}
        </button>
        <button type="button" className={`chip sm ${priv ? 'on' : ''}`} aria-pressed={priv} onClick={() => setPriv(true)}>
          <Lock size={14} aria-hidden="true" /> {t('Only for me')}
        </button>
        {!priv &&
          members.length > 1 &&
          members.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`chip sm ${hide.includes(m.id) ? 'on' : ''}`}
              aria-pressed={hide.includes(m.id)}
              onClick={() => setHide((h) => (h.includes(m.id) ? h.filter((x) => x !== m.id) : [...h, m.id]))}
            >
              <EyeSlash size={14} aria-hidden="true" /> {t('Not for {name}', { name: m.name })}
            </button>
          ))}
      </div>}
    </div>
  );
}

function Row({ x, members }: { x: MindItem; members: MindData['members'] }) {
  const act = useAct();
  const nav = useNavigate();
  const hidden = x.hide_from.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);
  const nods = x.nods.map((n) => n.name).join(', ');
  return (
    <li className={`li mind-li ${x.kind}`}>
      <span className="mind-ic" aria-hidden="true">
        {x.kind === 'done' ? <CheckCircle size={20} weight="fill" /> : <Brain size={20} />}
      </span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title">{x.text}</div>
        <div className="sub">
          {[
            x.done_by && x.about_me && x.by ? t('{name} noticed you did this – thank you!', { name: x.by.name }) : null,
            x.done_by && !x.about_me && x.by ? (x.mine ? t('done by {name}', { name: x.done_by.name }) : t('{by} noticed: {name} did it', { by: x.by.name, name: x.done_by.name })) : null,
            !x.done_by && !x.mine && x.by ? (x.kind === 'done' ? t('{name} did it', { name: x.by.name }) : t('{name} has it on their mind', { name: x.by.name })) : null,
            x.mine && x.visibility === 'private' ? t('only for you') : null,
            x.mine && hidden.length ? t('not for {names}', { names: hidden.join(', ') }) : null,
            nods ? (x.kind === 'done' ? t('Thanks from {names}', { names: nods }) : t('{names} thinks along', { names: nods })) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {x.mine && (
          <div className="row wrap mind-actions" style={{ gap: 6, marginTop: 6 }}>
            {x.kind === 'open' && (
              <button className="chip sm" onClick={() => act(() => patch(`/mind/${x.id}`, { kind: 'done' }), t('Done – and seen.'))}>
                <Check size={14} aria-hidden="true" /> {t('Done')}
              </button>
            )}
            <button className="chip sm" onClick={() => act(() => patch(`/mind/${x.id}`, { visibility: x.visibility === 'private' ? 'household' : 'private' }))}>
              {x.visibility === 'private' ? <Eye size={14} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}{' '}
              {x.visibility === 'private' ? t('Show everyone') : t('Only for me')}
            </button>
            {x.kind === 'open' && (
              <button
                className="chip sm"
                onClick={() =>
                  act(async () => {
                    await post(`/mind/${x.id}/task`);
                    invalidate('care');
                    nav('/aufgaben');
                  }, t('It’s a task now'))
                }
              >
                <ListChecks size={14} aria-hidden="true" /> {t('Make it a task')}
              </button>
            )}
            <button className="chip sm" aria-label={t('Delete')} onClick={() => act(() => del(`/mind/${x.id}`))}>
              <Trash size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {!x.mine && (
        <button className={`btn sm ${x.nodded ? 'primary' : 'ghost'}`} aria-pressed={x.nodded} onClick={() => act(() => post(`/mind/${x.id}/nod`))}>
          <HandHeart size={15} aria-hidden="true" /> {x.kind === 'done' ? t('Thanks') : t('I’ll think along')}
        </button>
      )}
    </li>
  );
}

function List({ title, items, members, empty }: { title: string; items: MindItem[]; members: MindData['members']; empty?: string }) {
  if (!items.length && !empty) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
      </div>
      {items.length ? (
        <ul className="list mind-list">
          {items.map((x) => (
            <Row key={x.id} x={x} members={members} />
          ))}
        </ul>
      ) : (
        <p className="small muted">{empty}</p>
      )}
    </section>
  );
}

export function MindPage() {
  const q = useMind();
  const d = q.data;
  return (
    <div className="rise mind-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Seen')}</div>
          <h1>{t('On my mind')}</h1>
        </div>
        {d && d.mine.open.length + d.mine.done.length > 0 && (
          <div className="actions">
            <ShareTextButton
              title={t('On my mind')}
              medium="mind"
              className="btn"
              lines={() => [...d.mine.open.map((x) => `☐ ${x.text}`), ...d.mine.done.map((x) => `✓ ${x.text}`)]}
            />
          </div>
        )}
      </header>
      <p className="muted" style={{ marginTop: 0 }}>
        {t('Things too small for a list – and still work: what you carry around, what you did on the side. So it gets seen. Only for you or for everyone, switch any time.')}
      </p>
      <div className="card pad">{d && <Composer members={d.members} />}</div>
      {d && (
        <>
          <List title={t('On your mind')} items={d.mine.open} members={d.members} empty={t('Nothing right now – or nothing written down.')} />
          <List title={t('With the others')} items={[...d.others.open, ...d.others.done]} members={d.members} />
          <List title={t('Done on the side')} items={d.mine.done} members={d.members} />
          <p className="small muted">{t('Never to the assistant, Home Assistant or notifications. Done things stay here two weeks and count in your weekly review.')}</p>
        </>
      )}
    </div>
  );
}

/** Heute: write something down in passing, and see what the others carry (a few, newest first). */
export function MindTodayCard({ guest }: { guest?: boolean }) {
  const q = useMind(!guest);
  const nav = useNavigate();
  if (guest || !q.data) return null;
  const d = q.data;
  const others = [...d.others.open, ...d.others.done].slice(0, 3);
  return (
    <section className="hcard mind-card" aria-labelledby="h-mind">
      <div className="hcard-h">
        <h2 id="h-mind">
          <span className="shape t" aria-hidden="true" />
          {t('On my mind')}
        </h2>
        <button className="linkish" onClick={() => nav('/kopf')}>
          {d.mine.open.length ? t('{n} on your mind', { n: d.mine.open.length }) : t('Open')} <ArrowRight size={14} />
        </button>
      </div>
      <Composer members={d.members} compact />
      {others.length > 0 && (
        <ul className="list mind-list" style={{ marginTop: 10 }}>
          {others.map((x) => (
            <Row key={x.id} x={x} members={d.members} />
          ))}
        </ul>
      )}
    </section>
  );
}
