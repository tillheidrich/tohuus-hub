/**
 * Settings › Home Assistant: "What does Home Assistant already do for you?" – per topic HA leads, ToHuus leads or
 * both ways; presence, notifications through the HA app, NFC tags. Plus the voice-command guide for the
 * babysitter page (admin side) and the guest-page section (GuestVoice).
 */
import {
  ArrowsClockwise,
  ArrowsDownUp,
  Bell,
  Broom,
  CalendarBlank,
  CheckCircle,
  Fan,
  House,
  Lightbulb,
  MagnifyingGlass,
  Microphone,
  MusicNotes,
  PencilSimple,
  Plus,
  ShoppingCart,
  Sparkle,
  Tag,
  Thermometer,
  ToggleRight,
  Trash,
  UsersThree,
  Warning,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { del, invalidate, patch, post, put, qc, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Empty, Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';
import { HaIntegrationCard } from './HaIntegration';

type Mode = 'off' | 'two_way' | 'from_ha' | 'to_ha';
type TopicKey = 'shopping' | 'meals' | 'care';

const when = (iso: string | null | undefined) => (iso ? relTime(iso.replace('T', ' ').slice(0, 19)) : '');

const MODE_LABEL = (): Record<Mode, string> => ({ off: t('Off'), two_way: t('Both ways'), from_ha: t('Home Assistant leads'), to_ha: t('ToHuus leads') });

const MODE_HELP = (): Record<TopicKey, Partial<Record<Mode, string>>> => ({
  shopping: {
    off: t('The lists stay separate.'),
    two_way: t('New items, ticks and changes travel both ways. If both sides change the same thing, the later change wins. Duplicates are merged by name.'),
    from_ha: t('What is added in Home Assistant (Alexa, Bring!, Assist …) comes here; ticks travel both ways. What you add here stays here.'),
    to_ha: t('Your list is copied into Home Assistant; ticking off there ticks off here. What is added there stays there.'),
  },
  meals: {
    off: t('ToHuus Hub’s meal plan is in Home Assistant as calendar.tohuus_hub_meal_plan anyway.'),
    from_ha: t('Dishes in the calendar come into the meal plan (matched to your recipes by name).'),
    to_ha: t('Your meal plan is written into the calendar. Moving or removing entries there needs the integration.'),
    two_way: t('Both: dishes come in, your plan goes out. Our own entries carry a marker, so nothing bounces back and forth.'),
  },
  care: {
    off: t('Care tasks are in Home Assistant as calendar.tohuus_hub_care_tasks anyway.'),
    to_ha: t('Due care tasks appear on the to-do list; ticking one off there marks it done here and plans the next time.'),
  },
});

const TOPIC_META = (): Record<TopicKey, { icon: ReactNode; title: string; lead: string }> => ({
  shopping: { icon: <ShoppingCart size={20} />, title: t('Shopping list'), lead: t('Home Assistant to-do lists: shopping list, Bring!, Todoist, Local To-do, Cookidoo') },
  meals: { icon: <CalendarBlank size={20} />, title: t('Meal plan'), lead: t('Home Assistant calendars: Mealie, Local Calendar, a family calendar') },
  care: { icon: <Broom size={20} />, title: t('Care tasks'), lead: t('Optional: due tasks on a Home Assistant to-do list') },
});

export function Ha2Settings({ admin }: { admin: boolean }) {
  const o = useApi<any>('ha2', '/ha2');
  const settings = useApi<any>('settings', '/settings');
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (r && r.settings) qc.setQueryData(['ha2'], r.overview ?? r);
      invalidate('ha2', 'shopping', 'plan');
      if (ok) toast({ text: ok(r) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(null);
    }
  };
  if (o.isLoading) return <Skeleton n={3} h={120} />;
  if (o.error || !o.data)
    return (
      <div className="card">
        <Empty icon={<Warning size={26} />} title={t('Could not load')} action={{ label: t('Try again'), onClick: () => o.refetch() }} />
      </div>
    );
  const d = o.data;
  const save = (body: any) => run('save', () => patch('/ha2/settings', body), () => t('Saved'));
  const connected = Boolean(d.transport);
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="card pad stack ha2-head">
        <div className="row" style={{ gap: 12 }}>
          <span className="thumb" style={{ width: 44, height: 44 }}><House size={22} /></span>
          <div className="grow">
            <b>{t('What does Home Assistant already do for you?')}</b>
            <div className="small muted">{t('If parts of this already run in Home Assistant, nothing needs doing twice: ToHuus Hub takes it over and plays changes back.')}</div>
          </div>
        </div>
        <div className={`ha2-conn ${connected ? 'on' : ''}`}>
          <span className="sdot" />
          <span className="small">
            {d.transport === 'integration'
              ? t('Connected through the ToHuus Hub integration{v} · last contact {when}', { v: d.integration.version ? ` ${d.integration.version}` : '', when: when(d.integration.seen) })
              : d.transport === 'rest'
                ? t('Connected with the Home Assistant address and token (Access & AI)')
                : t('Not connected yet – install the integration (recommended) or enter the Home Assistant address and token under Access & AI.')}
          </span>
        </div>
        {admin && (
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn" disabled={Boolean(busy) || !connected} onClick={() => run('detect', () => post('/ha2/detect'), () => t('Home Assistant checked'))}>
              <MagnifyingGlass size={15} /> {busy === 'detect' ? t('Looking …') : t('Look again')}
            </button>
            <button className="btn" disabled={Boolean(busy) || !connected} onClick={() => run('sync', () => post('/ha2/sync'), (r) => (r.error ? r.error : t('Synced')))}>
              <ArrowsClockwise size={15} /> {t('Sync now')}
            </button>
          </div>
        )}
        {d.pending_ops > 0 && <div className="small muted">{t('{n} changes waiting for Home Assistant', { n: d.pending_ops })}</div>}
      </div>

      {!connected && <HaIntegrationCard base={settings.data?.baseUrl ?? location.origin} />}

      {d.proposals.length > 0 && <Proposals d={d} admin={admin} busy={Boolean(busy)} onApply={() => run('apply', () => post('/ha2/apply-proposals'), () => t('Suggestions taken over'))} />}

      {(['shopping', 'meals', 'care'] as TopicKey[]).map((k) => (
        <TopicCard key={k} topic={k} d={d} admin={admin} onSave={save} />
      ))}

      <PresenceCard d={d} admin={admin} onSave={save} />
      <NotifyCard d={d} admin={admin} onSave={save} />
      <TagsCard d={d} admin={admin} onSave={save} />
      <VoiceCard admin={admin} />
    </div>
  );
}

function Proposals({ d, admin, busy, onApply }: { d: any; admin: boolean; busy: boolean; onApply: () => void }) {
  const label = (p: any) =>
    ({ shopping: t('Shopping list'), meals: t('Meal plan'), care: t('Care tasks'), presence: t('Who is home'), notify: t('Notifications'), tags: t('NFC tags'), voice: t('Voice commands') })[p.topic as string] ?? p.topic;
  const modeText = (p: any) => (p.mode === 'on' ? t('use it') : p.mode === 'off' ? t('nothing to do') : MODE_LABEL()[p.mode as Mode]);
  return (
    <div className="card pad stack">
      <div>
        <div className="eyebrow">{t('Found in Home Assistant')}{d.capabilities?.at ? ` · ${when(d.capabilities.at)}` : ''}</div>
        <b>{t('Our suggestion')}</b>
      </div>
      <div className="list ha2-props">
        {d.proposals.map((p: any) => (
          <div key={p.topic} className="li" style={{ display: 'block', padding: '10px 14px' }}>
            <div className="row between" style={{ gap: 8 }}>
              <b className="small">{label(p)}</b>
              <span className={`badge ${p.mode === 'off' ? '' : 'ha2-on'}`}>{modeText(p)}</span>
            </div>
            <div className="small muted" style={{ marginTop: 2 }}>{p.reason}</div>
            {p.found.length > 0 && (
              <div className="chips ha2-chips">
                {p.found.slice(0, 8).map((f: any) => (
                  <span key={f.entity_id} className="chip" title={f.entity_id}>
                    {f.name}
                    {f.note ? <span className="muted"> · {f.note}</span> : null}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {admin && (
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={onApply}>
          <CheckCircle size={16} /> {t('Take over the suggestions')}
        </button>
      )}
    </div>
  );
}

function TopicCard({ topic, d, admin, onSave }: { topic: TopicKey; d: any; admin: boolean; onSave: (b: any) => void }) {
  const tp = d.topics.find((x: any) => x.topic === topic);
  const meta = TOPIC_META()[topic];
  const [mode, setMode] = useState<Mode>(tp.mode);
  const [ents, setEnts] = useState<string[]>(tp.entities.map((e: any) => e.entity_id));
  const [typed, setTyped] = useState('');
  useEffect(() => {
    setMode(tp.mode);
    setEnts(tp.entities.map((e: any) => e.entity_id));
  }, [tp.mode, tp.entities.map((e: any) => e.entity_id).join(',')]);
  const domain = topic === 'meals' ? 'calendar' : 'todo';
  const available: any[] = (d.capabilities?.[domain] ?? []).filter((e: any) => !/^(todo|calendar)\.tohuus_hub/.test(e.entity_id) && !(topic === 'meals' && /cookidoo/.test(e.entity_id)));
  const single = topic === 'care';
  const toggle = (id: string) => setEnts((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : single ? [id] : [...cur, id]));
  const dirty = mode !== tp.mode || ents.join(',') !== tp.entities.map((e: any) => e.entity_id).join(',');
  const opts = (tp.modes as Mode[]).map((m) => [m, MODE_LABEL()[m]]) as [Mode, string][];
  const help = MODE_HELP()[topic][mode];
  const extra = ents.filter((e) => !available.some((a) => a.entity_id === e));
  return (
    <div className="card pad stack">
      <div className="row" style={{ gap: 12 }}>
        <span className="thumb" style={{ width: 40, height: 40 }}>{meta.icon}</span>
        <div className="grow">
          <b>{meta.title}</b>
          <div className="small muted">{meta.lead}</div>
        </div>
      </div>
      {admin ? (
        <div className="chips ha2-chips ha2-modes" role="radiogroup" aria-label={meta.title}>
          {opts.map(([m, l]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={`chip ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
              {l}
            </button>
          ))}
        </div>
      ) : (
        <div className="small"><b>{MODE_LABEL()[mode]}</b></div>
      )}
      {help && <div className="small muted">{help}</div>}
      {mode !== 'off' && (
        <div className="field">
          <label>{single ? t('Which list') : topic === 'meals' ? t('Which calendars') : t('Which lists')}</label>
          {available.length === 0 && extra.length === 0 && <div className="small muted">{t('Nothing found yet – tap “Look again” above, or type the entity below.')}</div>}
          <div className="chips ha2-chips">
            {[...available.map((a) => ({ id: a.entity_id, name: a.name, note: topic === 'meals' && mode !== 'from_ha' && a.writable === false ? t('read-only') : a.platform })), ...extra.map((x) => ({ id: x, name: x, note: null }))].map((a) => (
              <button key={a.id} type="button" disabled={!admin} className={`chip ${ents.includes(a.id) ? 'on' : ''}`} onClick={() => toggle(a.id)} title={a.id}>
                {a.name}
                {a.note ? <span className="muted"> · {a.note}</span> : null}
              </button>
            ))}
          </div>
          {admin && (
            <div className="row" style={{ marginTop: 8 }}>
              <input className="input mono sm" value={typed} onChange={(e) => setTyped(e.target.value.trim())} placeholder={`${domain}.…`} aria-label={t('Entity')} />
              <button
                className="btn sm"
                disabled={!new RegExp(`^${domain}\\.[a-z0-9_]+$`).test(typed)}
                onClick={() => {
                  toggle(typed);
                  setTyped('');
                }}
              >
                <Plus size={14} /> {t('Add')}
              </button>
            </div>
          )}
        </div>
      )}
      {tp.entities.map((e: any) => (
        <div key={e.entity_id} className={`small ${e.status.error ? 'ha2-err' : 'muted'}`}>
          <span className="mono">{e.entity_id}</span>:{' '}
          {e.status.error
            ? t('problem {when}: {error}', { when: when(e.status.at), error: e.status.error })
            : e.status.at
              ? t('synced {when} · {n} linked', { when: when(e.status.at), n: e.status.linked })
              : t('waiting for the first sync')}
          {e.status.conflicts > 0 && ` · ${t('{n} conflicts resolved', { n: e.status.conflicts })}`}
        </div>
      ))}
      {topic === 'shopping' && d.legacy_todo && <div className="small ha2-warn">{t('The older “Shopping list in Home Assistant” sync is on. It is switched off and taken over when you save here.')}</div>}
      {admin && dirty && (
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={mode !== 'off' && ents.length === 0} onClick={() => onSave({ [topic]: { mode, entities: ents } })}>
          {t('Save')}
        </button>
      )}
    </div>
  );
}

function PresenceCard({ d, admin, onSave }: { d: any; admin: boolean; onSave: (b: any) => void }) {
  const persons: any[] = d.capabilities?.person ?? [];
  const s = d.settings.presence;
  const live = new Map<string, any>((d.presence ?? []).map((p: any) => [p.entity_id, p]));
  return (
    <div className="card pad stack">
      <div className="row between" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="thumb" style={{ width: 40, height: 40 }}><UsersThree size={20} /></span>
          <div>
            <b>{t('Who is home')}</b>
            <div className="small muted">{t('From the people in Home Assistant. Used for “who gets it” and for away mode – never shown to guests.')}</div>
          </div>
        </div>
        {admin && <Toggle on={s.enabled} onChange={(v) => onSave({ presence: { enabled: v } })} label={t('Who is home')} />}
      </div>
      {s.enabled && persons.length === 0 && <div className="small muted">{t('No people found in Home Assistant yet.')}</div>}
      {s.enabled && persons.length > 0 && (
        <div className="list">
          {persons.map((p) => {
            const l = live.get(p.entity_id);
            return (
              <div key={p.entity_id} className="li" style={{ minHeight: 52 }}>
                <span className={`sdot ${l?.home ? '' : 'ha2-off'}`} />
                <div className="grow">
                  <div className="title">{p.name}</div>
                  <div className="sub">{l ? (l.home ? t('home') : t('away')) + (l.since ? ` · ${t('since {when}', { when: when(l.since) })}` : '') : p.state}</div>
                </div>
                <select
                  className="input sm"
                  style={{ width: 'auto' }}
                  disabled={!admin}
                  value={s.map[p.entity_id] ?? ''}
                  aria-label={t('Member')}
                  onChange={(e) => onSave({ presence: { map: { ...s.map, [p.entity_id]: e.target.value ? Number(e.target.value) : null } } })}
                >
                  <option value="">{t('not a member')}</option>
                  {d.users.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}
      {s.enabled && d.away?.away && <div className="small ha2-warn">{t('Everyone has been away since {when}. Going on a trip? Away mode keeps things quiet.', { when: when(d.away.since) })}</div>}
    </div>
  );
}

function NotifyCard({ d, admin, onSave }: { d: any; admin: boolean; onSave: (b: any) => void }) {
  const services: string[] = (d.capabilities?.notify ?? []).filter((n: string) => n.startsWith('mobile_app_'));
  const map: Record<string, string> = d.settings.notify ?? {};
  return (
    <div className="card pad stack">
      <div className="row" style={{ gap: 12 }}>
        <span className="thumb" style={{ width: 40, height: 40 }}><Bell size={20} /></span>
        <div className="grow">
          <b>{t('Notifications through the Home Assistant app')}</b>
          <div className="small muted">{t('If your household already gets its messages from the Home Assistant app, ToHuus Hub can use it instead of the browser push – per person.')}</div>
        </div>
      </div>
      {services.length === 0 ? (
        <div className="small muted">{t('No Home Assistant app found. Install the companion app on a phone, then tap “Look again”.')}</div>
      ) : (
        <div className="list">
          {d.users.map((u: any) => (
            <div key={u.id} className="li" style={{ minHeight: 52 }}>
              <div className="grow title">{u.name}</div>
              <select
                className="input sm"
                style={{ width: 'auto', maxWidth: '60%' }}
                disabled={!admin}
                value={map[String(u.id)] ?? ''}
                aria-label={t('Channel for {name}', { name: u.name })}
                onChange={(e) => {
                  const next = { ...map };
                  if (e.target.value) next[String(u.id)] = e.target.value;
                  else delete next[String(u.id)];
                  onSave({ notify: next });
                }}
              >
                <option value="">{t('Push in the browser app')}</option>
                {services.map((s) => (
                  <option key={s} value={s}>{t('HA app: {device}', { device: s.replace(/^mobile_app_/, '').replace(/_/g, ' ') })}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      <div className="help">{t('Which messages go out at all is still set under Notifications.')}</div>
    </div>
  );
}

function TagsCard({ d, admin, onSave }: { d: any; admin: boolean; onSave: (b: any) => void }) {
  const q = useApi<any>(['ha2', 'tags'], '/ha2/tags');
  const toast = useToast();
  const enabled = d.settings.tags.enabled;
  const actionLabel = (a: string) => ({ take: t('one taken'), list: t('onto the shopping list'), opened: t('opened'), done: t('done') })[a] ?? a;
  const setTag = async (id: string, body: any) => {
    try {
      await patch(`/ha2/tags/${encodeURIComponent(id)}`, body);
      invalidate('ha2');
      toast({ text: t('Saved') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const tags: any[] = q.data?.tags ?? [];
  const targets: any[] = q.data?.targets ?? [];
  return (
    <div className="card pad stack">
      <div className="row between" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="thumb" style={{ width: 40, height: 40 }}><Tag size={20} /></span>
          <div>
            <b>{t('NFC tags')}</b>
            <div className="small muted">{t('Scan a tag with the Home Assistant app once – it shows up here. Then choose what a scan does, like a QR label.')}</div>
          </div>
        </div>
        {admin && <Toggle on={enabled} onChange={(v) => onSave({ tags: { enabled: v } })} label={t('NFC tags')} />}
      </div>
      {enabled && q.isLoading && <div className="skel" style={{ height: 60 }} />}
      {enabled && !q.isLoading && tags.length === 0 && <div className="small muted">{d.transport === 'integration' ? t('No tag scanned yet.') : t('Needs the ToHuus Hub integration in Home Assistant.')}</div>}
      {enabled && tags.length > 0 && (
        <div className="list">
          {tags.map((tg) => (
            <div key={tg.tag_id} className="li" style={{ display: 'block', padding: '10px 14px' }}>
              <div className="row between" style={{ gap: 8 }}>
                <div className="grow">
                  <div className="title">{tg.name || tg.tag_id}</div>
                  <div className="sub">{t('{n} scans · last {when}', { n: tg.scans, when: when(tg.last_seen_at) })}{tg.last_device ? ` · ${tg.last_device}` : ''}</div>
                </div>
                {admin && (
                  <button className="icon-btn" aria-label={t('Remove')} onClick={() => del(`/ha2/tags/${encodeURIComponent(tg.tag_id)}`).then(() => invalidate('ha2'))}>
                    <Trash size={16} />
                  </button>
                )}
              </div>
              <select
                className="input sm"
                style={{ marginTop: 8 }}
                disabled={!admin}
                value={tg.code && tg.action ? `${tg.code}|${tg.action}` : ''}
                aria-label={t('What a scan does')}
                onChange={(e) => {
                  const [code, action] = e.target.value ? e.target.value.split('|') : [null, null];
                  void setTag(tg.tag_id, { code, action });
                }}
              >
                <option value="">{t('Nothing yet')}</option>
                {targets.flatMap((tt) =>
                  tt.actions.map((a: string) => (
                    <option key={`${tt.code}|${a}`} value={`${tt.code}|${a}`}>
                      {tt.name} – {actionLabel(a)}
                    </option>
                  )),
                )}
              </select>
            </div>
          ))}
        </div>
      )}
      {enabled && tags.length > 0 && targets.length === 0 && <div className="help">{t('Print a QR label for a product or care task first (More › QR labels) – tags use the same actions.')}</div>}
    </div>
  );
}

// ================================================================== voice commands (admin)

const DOMAIN_ICON: Record<string, ReactNode> = {
  light: <Lightbulb size={18} />,
  switch: <ToggleRight size={18} />,
  cover: <ArrowsDownUp size={18} />,
  climate: <Thermometer size={18} />,
  fan: <Fan size={18} />,
  media_player: <MusicNotes size={18} />,
  scene: <Sparkle size={18} />,
  script: <Sparkle size={18} />,
};
const DOMAIN_LABEL = (): Record<string, string> => ({
  light: t('Lamp'),
  switch: t('Plug / switch'),
  cover: t('Blinds'),
  climate: t('Heating'),
  fan: t('Fan'),
  media_player: t('Music & TV'),
  scene: t('Scene'),
  script: t('Routine'),
});

export function VoiceCard({ admin }: { admin: boolean }) {
  const v = useApi<any>(['ha2', 'voice'], '/ha2/voice');
  const toast = useToast();
  const [edit, setEdit] = useState<any>(null);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const call = async (fn: () => Promise<any>, ok?: (r: any) => string) => {
    try {
      const r = await fn();
      qc.setQueryData(['ha2', 'voice'], r);
      if (ok) toast({ text: ok(r) });
      return r;
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      return null;
    }
  };
  if (v.isLoading) return <Skeleton n={1} h={140} />;
  if (v.error || !v.data) return <div className="card"><Empty icon={<Warning size={24} />} title={t('Could not load')} action={{ label: t('Try again'), onClick: () => v.refetch() }} /></div>;
  const d = v.data;
  const exposedCount = d.candidates.filter((c: any) => c.exposed_here && !c.added && c.domain !== 'script').length;
  const sitterLinks = d.links.filter((l: any) => l.scopes.includes('stock'));
  return (
    <div className="card pad stack">
      <div className="row" style={{ gap: 12 }}>
        <span className="thumb" style={{ width: 40, height: 40 }}><Microphone size={20} /></span>
        <div className="grow">
          <b>{t('Voice commands for the babysitter page')}</b>
          <div className="small muted">{t('Shows babysitters and house-sitters what they can switch by voice – lights, blinds, heating, music, scenes. Locks, alarms, cameras, garage doors and people never appear.')}</div>
        </div>
      </div>
      <div className="field">
        <label>{t('Your voice assistant')}</label>
        <Seg value={d.settings.assistant} onChange={(a) => admin && call(() => put('/ha2/voice/settings', { assistant: a }))} options={d.assistants.map((a: any) => [a.id, a.name])} />
      </div>
      {d.items.length === 0 ? (
        <div className="small muted">{t('Nothing listed yet. Take devices over from Home Assistant or add them by hand – it works without Home Assistant, too.')}</div>
      ) : (
        <div className="list">
          {d.items.map((it: any) => (
            <div key={it.id} className={`li ha2-voice-li ${it.hidden ? 'ha2-hidden' : ''}`} style={{ display: 'flex', alignItems: 'flex-start', padding: '10px 14px' }}>
              <span className="ha2-vic">{DOMAIN_ICON[it.domain]}</span>
              <div className="grow">
                <div className="title">
                  {it.name}
                  {it.area ? <span className="muted small"> · {it.area}</span> : null}
                  {it.hidden ? <span className="muted small"> · {t('hidden')}</span> : null}
                </div>
                {it.phrases.map((p: string) => (
                  <div key={p} className="small ha2-phrase">{t('“{p}”', { p })}</div>
                ))}
              </div>
              {admin && (
                <button className="icon-btn" aria-label={t('Edit')} onClick={() => setEdit({ ...it, text: (it.custom ?? it.phrases).join('\n') })}>
                  <PencilSimple size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {admin && (
        <div className="row wrap" style={{ gap: 8 }}>
          {exposedCount > 0 && (
            <button className="btn primary" onClick={() => call(() => post('/ha2/voice/import-exposed'), (r) => t('{n} added', { n: r.added }))}>
              <CheckCircle size={15} /> {t('Take over what {assistant} can reach ({n})', { assistant: d.assistant_name, n: exposedCount })}
            </button>
          )}
          {d.candidates.length > 0 && (
            <button className="btn" onClick={() => setPicking(true)}>
              <House size={15} /> {t('Choose from Home Assistant')}
            </button>
          )}
          <button className="btn" onClick={() => setAdding(true)}>
            <Plus size={15} /> {t('Add by hand')}
          </button>
        </div>
      )}
      <div className="field">
        <label>{t('Shown on these guest links')}</label>
        {sitterLinks.length === 0 ? (
          <div className="small muted">{t('No babysitter link yet. Create one under Guests & Bar › Guest links with “Where is what?”.')}</div>
        ) : (
          <div className="list">
            {sitterLinks.map((l: any) => (
              <div key={l.id} className="li" style={{ minHeight: 48 }}>
                <div className="grow title">{l.name}</div>
                <Toggle on={l.voice} onChange={(on) => admin && call(() => put(`/ha2/voice/links/${l.id}`, { on }))} label={t('Voice commands on “{name}”', { name: l.name })} />
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.name}>
        {edit && (
          <div className="stack">
            <div className="field">
              <label>{t('Name as you say it')}</label>
              <input className="input" value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <div className="field">
              <label>{t('Room')}</label>
              <input className="input" value={edit.area ?? ''} maxLength={60} onChange={(e) => setEdit({ ...edit, area: e.target.value })} placeholder={t('e.g. Living room')} />
            </div>
            <div className="field">
              <label>{t('Phrases (one per line)')}</label>
              <textarea className="input" rows={4} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
              <div className="help">{t('Leave empty to use the suggested phrases for your assistant.')}</div>
            </div>
            <div className="row between">
              <span className="small">{t('Hide on guest pages')}</span>
              <Toggle on={Boolean(edit.hidden)} onChange={(h) => setEdit({ ...edit, hidden: h })} label={t('Hide on guest pages')} />
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <button
                className="btn primary"
                onClick={async () => {
                  const lines = String(edit.text).split('\n').map((x: string) => x.trim()).filter(Boolean);
                  const auto = edit.custom === null && lines.join('\n') === edit.phrases.join('\n');
                  const r = await call(() => patch(`/ha2/voice/items/${edit.id}`, { name: edit.name, area: edit.area || null, phrases: auto || !lines.length ? null : lines, hidden: Boolean(edit.hidden) }), () => t('Saved'));
                  if (r) setEdit(null);
                }}
              >
                {t('Save')}
              </button>
              <button className="btn ghost" onClick={async () => (await call(() => del(`/ha2/voice/items/${edit.id}`))) && setEdit(null)}>
                <Trash size={15} /> {t('Remove')}
              </button>
            </div>
          </div>
        )}
      </Sheet>
      <PickSheet open={picking} onClose={() => setPicking(false)} candidates={d.candidates} assistant={d.assistant_name} onAdd={(ids) => call(() => post('/ha2/voice/entities', { ids }), (r) => t('{n} added', { n: r.added })).then((r) => r && setPicking(false))} />
      <ManualSheet open={adding} onClose={() => setAdding(false)} domains={d.domains} onAdd={(b) => call(() => post('/ha2/voice/items', b), () => t('Added')).then((r) => r && setAdding(false))} />
    </div>
  );
}

function PickSheet({ open, onClose, candidates, assistant, onAdd }: { open: boolean; onClose: () => void; candidates: any[]; assistant: string; onAdd: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => setSel([]), [open]);
  const n = q.trim().toLowerCase();
  const list = candidates.filter((c) => !c.added && (!n || `${c.name} ${c.area ?? ''} ${c.entity_id}`.toLowerCase().includes(n)));
  return (
    <Sheet open={open} onClose={onClose} title={t('Choose from Home Assistant')}>
      <div className="stack">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search')} aria-label={t('Search')} />
        <div className="small muted">{t('Marked “{assistant}” = already reachable by {assistant}. Scripts only if they are safe for guests.', { assistant })}</div>
        {list.length === 0 ? (
          <div className="small muted">{t('Nothing left to add.')}</div>
        ) : (
          <div className="list" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            {list.map((c) => (
              <label key={c.entity_id} className="li clickable" style={{ minHeight: 48, cursor: 'pointer' }}>
                <input type="checkbox" checked={sel.includes(c.entity_id)} onChange={() => setSel((s) => (s.includes(c.entity_id) ? s.filter((x) => x !== c.entity_id) : [...s, c.entity_id]))} />
                <span className="ha2-vic">{DOMAIN_ICON[c.domain]}</span>
                <span className="grow">
                  <span className="title" style={{ display: 'block' }}>{c.name}</span>
                  <span className="sub">{[c.area, DOMAIN_LABEL()[c.domain], c.exposed_here ? assistant : null].filter(Boolean).join(' · ')}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <button className="btn primary" disabled={!sel.length} onClick={() => onAdd(sel)}>
          <Plus size={15} /> {t('Add {n}', { n: sel.length })}
        </button>
      </div>
    </Sheet>
  );
}

function ManualSheet({ open, onClose, domains, onAdd }: { open: boolean; onClose: () => void; domains: string[]; onAdd: (b: any) => void }) {
  const [f, setF] = useState({ name: '', area: '', domain: 'light', text: '' });
  useEffect(() => setF({ name: '', area: '', domain: 'light', text: '' }), [open]);
  return (
    <Sheet open={open} onClose={onClose} title={t('Add by hand')}>
      <div className="stack">
        <div className="field">
          <label>{t('Name as you say it')}</label>
          <input className="input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('e.g. the reading lamp')} />
        </div>
        <div className="field">
          <label>{t('Kind')}</label>
          <select className="input" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })}>
            {domains.map((dm) => (
              <option key={dm} value={dm}>{DOMAIN_LABEL()[dm] ?? dm}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t('Room')}</label>
          <input className="input" value={f.area} maxLength={60} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder={t('e.g. Living room')} />
        </div>
        <div className="field">
          <label>{t('Phrases (one per line)')}</label>
          <textarea className="input" rows={3} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          <div className="help">{t('Leave empty to use the suggested phrases for your assistant.')}</div>
        </div>
        <button
          className="btn primary"
          disabled={!f.name.trim()}
          onClick={() => onAdd({ name: f.name, domain: f.domain, area: f.area || null, phrases: f.text.split('\n').map((x) => x.trim()).filter(Boolean) })}
        >
          <Plus size={15} /> {t('Add')}
        </button>
      </div>
    </Sheet>
  );
}

// ================================================================== guest page section

/** "Voice commands" on the babysitter / where-is-what page – only when switched on for this link. */
export function GuestVoice({ token }: { token: string }) {
  const q = useQuery({
    queryKey: ['stock', 'guest-voice', token],
    queryFn: async () => {
      const r = await fetch(`/api/guest/${token}/voice`);
      if (!r.ok) throw new Error(t('Could not load'));
      return r.json();
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
  if (q.isLoading || q.error || !q.data?.items?.length) return null;
  const groups = new Map<string, any[]>();
  for (const it of q.data.items) {
    const k = it.area ?? '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  return (
    <section className="ha2-guest">
      <div className="row" style={{ gap: 10, marginBottom: 6 }}>
        <Microphone size={20} />
        <h2 style={{ margin: 0, fontSize: 20 }}>{t('Voice commands')}</h2>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>{t('Say it to {assistant} – these are the things you may switch here.', { assistant: q.data.assistant_name })}</p>
      {[...groups.entries()].map(([area, items]) => (
        <div key={area || '-'} style={{ marginBottom: 14 }}>
          {area && <h3 style={{ margin: '8px 0 6px' }}>{area}</h3>}
          <div className="list">
            {items.map((it) => (
              <div key={it.id} className="li" style={{ display: 'flex', alignItems: 'flex-start', padding: '10px 14px' }}>
                <span className="ha2-vic">{DOMAIN_ICON[it.domain]}</span>
                <div className="grow">
                  <div className="title">{it.name}</div>
                  {it.phrases.map((p: string) => (
                    <div key={p} className="ha2-phrase">{t('“{p}”', { p })}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="small muted">{t('If something doesn’t react, the normal switch still works.')}</p>
    </section>
  );
}
