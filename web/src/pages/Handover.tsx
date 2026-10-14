/**
 * Holiday handover ("Übergabe", server/lib/handover.ts, docs/handover.md): what the people looking after the home
 * do while we are away – feed the cat, water the plants – with instructions, photos and short videos.
 *
 * - HandoverTab: on the trip page (household): items, who sees them, what was ticked per day, templates.
 * - GuestHandover: on the guest / house-sitter link page – today first, tick if you like, all instructions below.
 * - MyHandover: the same for permanent guests chosen for a trip (route /uebergabe).
 */
import { CalendarBlank, Check, Copy, PawPrint, Plant, Plus, Trash, TrashSimple, Envelope, House, Info, NotePencil } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { api, del, fmtDate, get, invalidate, patch, post, put, useApi } from '../api';
import { t } from '../i18n';

const fmtDay = (d: string) => fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' });
import { Empty, Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';

// ------------------------------------------------------------------ types (API: docs/handover.md)

type Kind = 'pet' | 'plants' | 'post' | 'bins' | 'home' | 'other';
type Rhythm = 'daily' | 'days' | 'once' | 'asneeded';
type Slot = 'morning' | 'noon' | 'evening';
interface Media {
  id: number;
  kind: 'photo' | 'video';
  url: string;
  caption: string | null;
}
export interface Item {
  id: number;
  kind: Kind;
  title: string;
  instructions: string;
  rhythm: Rhythm;
  weekdays: number[];
  day: string | null;
  slots: Slot[];
  media: Media[];
}
interface Tick {
  slot: string;
  done: { by: string | null; at: string } | null;
}
type PlanItem = Item & { ticks: Tick[] };
interface Overview {
  items: Item[];
  access: { links: { id: number; until?: string | null }[]; guests: number[]; sitterLinkId: number | null };
  days: { day: string; plan: PlanItem[] }[];
}
interface ViewerTrip {
  trip: { id: number; name: string; start_day: string; end_day: string };
  day: string;
  today: PlanItem[];
  items: Item[];
}

const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
const KIND_ICON: Record<Kind, ReactNode> = { pet: <PawPrint size={18} />, plants: <Plant size={18} />, post: <Envelope size={18} />, bins: <TrashSimple size={18} />, home: <House size={18} />, other: <Info size={18} /> };
const kindName = (k: Kind) => ({ pet: t('Animals'), plants: t('Plants'), post: t('Post'), bins: t('Bins'), home: t('Flat'), other: t('Other') })[k];
const slotName = (s: string) => ({ morning: t('morning'), noon: t('midday'), evening: t('evening') })[s] ?? t('once that day');
const WEEKDAYS = () => [t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')];

/** "every day, morning and evening" · "Mon and Thu" · "on 14 Oct" · "when needed" */
export function rhythmText(i: Pick<Item, 'rhythm' | 'weekdays' | 'day' | 'slots'>) {
  const when = i.slots.length ? i.slots.map(slotName).join(t(' and ')) : '';
  const base =
    i.rhythm === 'daily'
      ? t('every day')
      : i.rhythm === 'days'
        ? i.weekdays.map((d) => WEEKDAYS()[d - 1]).join(', ')
        : i.rhythm === 'once'
          ? t('on {date}', { date: i.day ? fmtDay(i.day) : '?' })
          : t('when needed');
  return when && i.rhythm !== 'asneeded' ? `${base}, ${when}` : base;
}

function MediaView({ media, title }: { media: Media[]; title: string }) {
  if (!media.length) return null;
  return (
    <div className="hg-media">
      {media.map((m) => (
        <figure key={m.id} className={`hg-media-item ${m.kind}`}>
          {m.kind === 'photo' ? <img src={m.url} alt={m.caption || title} loading="lazy" data-zoom /> : <video src={m.url} controls playsInline preload="metadata" aria-label={m.caption || title} />}
          {m.caption && <figcaption className="small muted">{m.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ guest side (link or permanent guest)

function DayList({ v, tick, busy }: { v: ViewerTrip; tick: (itemId: number, day: string, slot: string, done: boolean) => void; busy: boolean }) {
  const due = v.today.filter((i) => i.ticks.length);
  const asNeeded = v.today.filter((i) => !i.ticks.length);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card pad stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{t('Today, {date}', { date: fmtDay(v.day) })}</h2>
          <span className="small muted">{v.trip.name}</span>
        </div>
        {!due.length && <p className="muted" style={{ margin: 0 }}>{t('Nothing planned for today.')}</p>}
        <ul className="ho-today">
          {due.flatMap((i) =>
            i.ticks.map((tk) => (
              <li key={`${i.id}-${tk.slot}`} className={tk.done ? 'done' : ''}>
                <button className="ho-check" disabled={busy} aria-pressed={Boolean(tk.done)} onClick={() => tick(i.id, v.day, tk.slot, !tk.done)}>
                  <span className="ho-box" aria-hidden="true">{tk.done && <Check size={16} weight="bold" />}</span>
                  <span className="grow">
                    <b>{i.title}</b>
                    <span className="small muted"> · {slotName(tk.slot)}</span>
                    {tk.done && <span className="small muted"> · {t('done by {name}', { name: tk.done.by ?? '?' })}</span>}
                  </span>
                </button>
              </li>
            )),
          )}
        </ul>
        {asNeeded.length > 0 && <p className="small muted" style={{ margin: 0 }}>{t('When needed: {list}', { list: asNeeded.map((i) => i.title).join(', ') })}</p>}
        <p className="small muted" style={{ margin: 0 }}>{t('Ticking is optional – it just lets the household see that all is well.')}</p>
      </section>
      <section className="stack" style={{ gap: 10 }}>
        <h2 style={{ margin: 0 }}>{t('How it works')}</h2>
        {v.items.map((i) => (
          <article key={i.id} className="hg-card">
            <div className="hg-card-head">
              <span className="hg-ic" aria-hidden="true">{KIND_ICON[i.kind]}</span>
              <b className="grow">{i.title}</b>
              <span className="badge">{rhythmText(i)}</span>
            </div>
            {i.instructions && <p className="hg-body" style={{ whiteSpace: 'pre-line' }}>{i.instructions}</p>}
            <MediaView media={i.media} title={i.title} />
          </article>
        ))}
      </section>
    </div>
  );
}

/** On the guest / house-sitter link page. */
export function GuestHandover({ token }: { token: string }) {
  const q = useQuery({ queryKey: ['handover', 'guest', token], queryFn: () => get<ViewerTrip[]>(`/guest/${token}/handover`) });
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const tick = async (itemId: number, day: string, slot: string, done: boolean) => {
    setBusy(true);
    try {
      await post(`/guest/${token}/handover/done`, { itemId, day, slot, done });
      await q.refetch();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  if (q.isLoading) return <Skeleton n={3} h={70} />;
  if (!q.data?.length) return <Empty icon={<PawPrint size={26} />} title={t('No handover right now')}>{t('It shows here while the trip is on.')}</Empty>;
  return (
    <div className="stack" style={{ gap: 24 }}>
      {q.data.map((v) => <DayList key={v.trip.id} v={v} tick={tick} busy={busy} />)}
    </div>
  );
}

/** /uebergabe – permanent guests chosen for a trip. */
export function MyHandover() {
  const q = useApi<ViewerTrip[]>(['handover', 'mine'], '/handover/mine');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const tick = async (itemId: number, day: string, slot: string, done: boolean) => {
    setBusy(true);
    try {
      await post('/handover/done', { itemId, day, slot, done });
      invalidate('handover');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('While the household is away')}</div>
          <h1>{t('Handover')}</h1>
        </div>
      </header>
      {q.isLoading ? <Skeleton n={3} h={70} /> : !q.data?.length ? <Empty icon={<PawPrint size={26} />} title={t('No handover right now')}>{t('It shows here while the trip is on.')}</Empty> : q.data.map((v) => <DayList key={v.trip.id} v={v} tick={tick} busy={busy} />)}
    </div>
  );
}

// ------------------------------------------------------------------ household side (trip page)

interface GuestLink {
  id: number;
  name: string;
  expires_at: string | null;
  revoked?: number | boolean;
}

export function HandoverTab({ tripId }: { tripId: number }) {
  const q = useApi<Overview>(['away', 'handover', tripId], `/away/trips/${tripId}/handover`);
  const [edit, setEdit] = useState<Item | 'new' | null>(null);
  const [reuse, setReuse] = useState(false);
  const toast = useToast();
  const d = q.data;
  if (!d) return <Skeleton n={3} h={70} />;
  const saveTemplate = async () => {
    const name = prompt(t('Name of the template'), t('Our handover'));
    if (!name) return;
    try {
      await post(`/away/trips/${tripId}/handover/template`, { name });
      toast({ text: t('Saved as a template – take it over for the next trip.') });
      invalidate('away');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <div className="stack" style={{ gap: 18 }}>
      <p className="small muted" style={{ margin: 0 }}>
        {t('What the people looking after your home should do – feed the cat, water the plants – with how it works, photos and short videos. Only the people you choose see it; they can tick what they did.')}
      </p>
      <section className="card pad stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>{t('What to do')}</h2>
          <button className="btn sm primary" onClick={() => setEdit('new')}>
            <Plus size={16} /> {t('Handover item')}
          </button>
        </div>
        {!d.items.length && <p className="muted" style={{ margin: 0 }}>{t('Nothing yet. Start with a template or an earlier trip, or add the first item.')}</p>}
        <ul className="list">
          {d.items.map((i) => (
            <li key={i.id} className="li">
              <span className="hg-ic" aria-hidden="true">{KIND_ICON[i.kind]}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="title">{i.title}</div>
                <div className="small muted">
                  {rhythmText(i)}
                  {i.media.length ? ` · ${t('{n} photos/videos', { n: i.media.length })}` : ''}
                </div>
              </div>
              <button className="icon-btn sm" onClick={() => setEdit(i)} aria-label={t('Edit {name}', { name: i.title })}>
                <NotePencil size={16} />
              </button>
            </li>
          ))}
        </ul>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => setReuse(true)}>
            <Copy size={16} /> {t('Take over …')}
          </button>
          {d.items.length > 0 && (
            <button className="btn sm ghost" onClick={saveTemplate}>
              {t('Save as template')}
            </button>
          )}
        </div>
      </section>

      <AccessCard tripId={tripId} access={d.access} />

      {d.items.length > 0 && <Progress days={d.days} />}

      {edit && <ItemSheet tripId={tripId} item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {reuse && <ReuseSheet tripId={tripId} onClose={() => setReuse(false)} />}
    </div>
  );
}

function AccessCard({ tripId, access }: { tripId: number; access: Overview['access'] }) {
  const links = useApi<GuestLink[]>('guest-links', '/guest-links');
  const people = useApi<{ key: string; name: string; kind: string }[]>(['people', 'directory'], '/people/directory');
  const toast = useToast();
  const chosenLinks = new Map(access.links.map((l) => [l.id, l]));
  const chosenGuests = new Set(access.guests);
  const guests = (people.data ?? []).filter((p) => p.kind === 'guest' && /^u\d+$/.test(p.key));
  const save = async (next: { links: { id: number; until?: string | null }[]; guests: number[] }) => {
    try {
      await put(`/away/trips/${tripId}/handover/access`, next);
      invalidate('away');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const otherLinks = (links.data ?? []).filter((l) => !l.revoked && l.id !== access.sitterLinkId);
  return (
    <section className="card pad stack">
      <h2 style={{ margin: 0 }}>{t('Who sees the handover')}</h2>
      <p className="small muted" style={{ margin: 0 }}>{access.sitterLinkId ? t('The house-sitter link of this trip always sees it.') : t('Create the house-sitter link in the tab “House sitter” – it sees the handover automatically.')}</p>
      {otherLinks.map((l) => (
        <label key={l.id} className="row between" style={{ gap: 12 }}>
          <span>
            {l.name} <span className="small muted">· {t('guest link')}</span>
          </span>
          <Toggle
            on={chosenLinks.has(l.id)}
            label={l.name}
            onChange={(on) => save({ links: on ? [...access.links, { id: l.id, until: null }] : access.links.filter((x) => x.id !== l.id), guests: access.guests })}
          />
        </label>
      ))}
      {guests.map((g) => {
        const uid = Number(g.key.slice(1));
        return (
          <label key={g.key} className="row between" style={{ gap: 12 }}>
            <span>
              {g.name} <span className="small muted">· {t('permanent guest')}</span>
            </span>
            <Toggle on={chosenGuests.has(uid)} label={g.name} onChange={(on) => save({ links: access.links, guests: on ? [...access.guests, uid] : access.guests.filter((x) => x !== uid) })} />
          </label>
        );
      })}
      {!otherLinks.length && !guests.length && <p className="small muted" style={{ margin: 0 }}>{t('Other guest links and permanent guests appear here to choose from.')}</p>}
    </section>
  );
}

function Progress({ days }: { days: Overview['days'] }) {
  return (
    <section className="card pad stack">
      <h2 style={{ margin: 0 }}>{t('What was ticked')}</h2>
      <ul className="ho-progress">
        {days.map((d) => {
          const ticks = d.plan.flatMap((i) => i.ticks.map((tk) => ({ i, tk })));
          const done = ticks.filter((x) => x.tk.done).length;
          return (
            <li key={d.day}>
              <span className="ho-day">
                <CalendarBlank size={14} /> {fmtDay(d.day)}
              </span>
              <span className="small">{ticks.length ? t('{done} of {n}', { done, n: ticks.length }) : t('nothing planned')}</span>
              <span className="small muted ho-who">{[...new Set(ticks.filter((x) => x.tk.done).map((x) => x.tk.done!.by))].filter(Boolean).join(', ')}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ItemSheet({ tripId, item, onClose }: { tripId: number; item: Item | null; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    kind: item?.kind ?? ('pet' as Kind),
    title: item?.title ?? '',
    instructions: item?.instructions ?? '',
    rhythm: item?.rhythm ?? ('daily' as Rhythm),
    weekdays: item?.weekdays ?? [],
    day: item?.day ?? '',
    slots: item?.slots ?? (['morning'] as Slot[]),
  });
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const live = useApi<Overview>(['away', 'handover', tripId], `/away/trips/${tripId}/handover`).data?.items.find((i) => i.id === item?.id);
  const media = live?.media ?? item?.media ?? [];
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const pick = (files: FileList | null) => {
    const ok: File[] = [];
    for (const file of [...(files ?? [])]) {
      if (file.size > MEDIA_MAX_BYTES)
        toast({ text: t('“{name}” is {mb} MB – videos can be up to 100 MB. Shorten it, or add it in the iPhone app: it makes videos smaller first (about 5 minutes fit).', { name: file.name, mb: Math.round(file.size / 1048576) }), error: true });
      else ok.push(file);
    }
    setPending([...pending, ...ok]);
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, day: f.rhythm === 'once' ? f.day || null : null };
      const id = item ? (await patch<Item>(`/away/handover/items/${item.id}`, body)).id : (await post<Item>(`/away/trips/${tripId}/handover/items`, body)).id;
      for (const file of pending) {
        const form = new FormData();
        form.append('file', file, file.name);
        await api(`/away/handover/items/${id}/media`, { method: 'POST', form });
      }
      invalidate('away');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!item || !confirm(t('Delete this item?'))) return;
    await del(`/away/handover/items/${item.id}`);
    invalidate('away');
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={item ? t('Edit item') : t('New item')}>
      <div className="stack">
        <div className="chips wrap" role="group" aria-label={t('Kind')}>
          {(['pet', 'plants', 'post', 'bins', 'home', 'other'] as Kind[]).map((k) => (
            <button key={k} type="button" className={`chip ${f.kind === k ? 'on' : ''}`} aria-pressed={f.kind === k} onClick={() => setF({ ...f, kind: k })}>
              {KIND_ICON[k]} {kindName(k)}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="ho-title">{t('What')}</label>
          <input id="ho-title" className="input" value={f.title} maxLength={100} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t('e.g. Feed the cat')} />
        </div>
        <div className="field">
          <label htmlFor="ho-ins">{t('How it works')}</label>
          <textarea id="ho-ins" className="input" rows={4} value={f.instructions} maxLength={2000} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder={t('e.g. Half a tin, fresh water. The food is in the left cupboard.')} />
        </div>
        <div className="field">
          <span className="label">{t('How often')}</span>
          <Seg<Rhythm> label={t('How often')} value={f.rhythm} onChange={(rhythm) => setF({ ...f, rhythm })} options={[['daily', t('Every day')], ['days', t('On days')], ['once', t('Once')], ['asneeded', t('When needed')]]} />
        </div>
        {f.rhythm === 'days' && (
          <div className="chips wrap" role="group" aria-label={t('Weekdays')}>
            {WEEKDAYS().map((w, i) => (
              <button key={w} type="button" className={`chip ${f.weekdays.includes(i + 1) ? 'on' : ''}`} aria-pressed={f.weekdays.includes(i + 1)} onClick={() => setF({ ...f, weekdays: toggle(f.weekdays, i + 1) })}>
                {w}
              </button>
            ))}
          </div>
        )}
        {f.rhythm === 'once' && (
          <div className="field">
            <label htmlFor="ho-day">{t('Day')}</label>
            <input id="ho-day" className="input" type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />
          </div>
        )}
        {f.rhythm !== 'asneeded' && (
          <div className="chips wrap" role="group" aria-label={t('When')}>
            {(['morning', 'noon', 'evening'] as Slot[]).map((s) => (
              <button key={s} type="button" className={`chip ${f.slots.includes(s) ? 'on' : ''}`} aria-pressed={f.slots.includes(s)} onClick={() => setF({ ...f, slots: toggle(f.slots, s) })}>
                {slotName(s)}
              </button>
            ))}
          </div>
        )}
        <div className="field">
          <span className="label">{t('Photos and videos')}</span>
          {(media.length > 0 || pending.length > 0) && (
            <ul className="hg-media-edit">
              {media.map((m) => (
                <li key={m.id}>
                  {m.kind === 'photo' ? <img src={m.url} alt="" /> : <video src={m.url} preload="metadata" muted playsInline aria-hidden="true" />}
                  <button type="button" className="icon-btn sm" aria-label={t('Remove')} onClick={() => item && del(`/away/handover/items/${item.id}/media/${m.id}`).then(() => invalidate('away'))}>
                    <Trash size={14} />
                  </button>
                </li>
              ))}
              {pending.map((p, i) => (
                <li key={`p${i}`} className="pending">
                  <span className="small">{p.name}</span>
                  <button type="button" className="icon-btn sm" aria-label={t('Remove')} onClick={() => setPending(pending.filter((_, j) => j !== i))}>
                    <Trash size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="btn" style={{ alignSelf: 'flex-start' }}>
            <Plus size={16} /> {t('Add a photo or video')}
            <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />
          </label>
          <span className="small muted">{t('Photos, and videos up to 100 MB each (in the iPhone app about 5 minutes – it makes them smaller first).')}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {item && (
            <button className="btn ghost" onClick={remove}>
              <Trash size={16} /> {t('Delete')}
            </button>
          )}
          <button className="btn primary grow" disabled={busy || !f.title.trim() || (f.rhythm === 'days' && !f.weekdays.length) || (f.rhythm === 'once' && !f.day)} onClick={save}>
            {busy ? t('Saving …') : pending.length ? t('Save and upload') : t('Save')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function ReuseSheet({ tripId, onClose }: { tripId: number; onClose: () => void }) {
  const q = useApi<{ templates: { id: number; name: string; count: number; titles: string[] }[]; trips: { id: number; name: string; start_day: string; count: number }[] }>(
    ['away', 'handover', 'sources', tripId],
    `/away/trips/${tripId}/handover/sources`,
  );
  const toast = useToast();
  const apply = async (b: { templateId?: number; tripId?: number }) => {
    try {
      const r = await post<{ added: number }>(`/away/trips/${tripId}/handover/apply`, b);
      toast({ text: t('{n} items taken over', { n: r.added }) });
      invalidate('away');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const removeTemplate = async (id: number) => {
    if (!confirm(t('Delete this template?'))) return;
    await del(`/away/handover/templates/${id}`);
    invalidate('away');
  };
  return (
    <Sheet open onClose={onClose} title={t('Take over a handover')}>
      {!q.data ? (
        <Skeleton n={3} h={50} />
      ) : (
        <div className="stack">
          <h3 style={{ margin: 0 }}>{t('Templates')}</h3>
          {!q.data.templates.length && <p className="small muted" style={{ margin: 0 }}>{t('No templates yet – “Save as template” on a trip makes one.')}</p>}
          <ul className="list">
            {q.data.templates.map((x) => (
              <li key={x.id} className="li">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title">{x.name}</div>
                  <div className="small muted">{x.titles.join(', ')}</div>
                </div>
                <button className="btn sm" onClick={() => apply({ templateId: x.id })}>{t('Take over')}</button>
                <button className="icon-btn sm" onClick={() => removeTemplate(x.id)} aria-label={t('Delete {name}', { name: x.name })}>
                  <Trash size={14} />
                </button>
              </li>
            ))}
          </ul>
          <h3 style={{ margin: 0 }}>{t('Earlier trips')}</h3>
          {!q.data.trips.length && <p className="small muted" style={{ margin: 0 }}>{t('No earlier trip with a handover yet.')}</p>}
          <ul className="list">
            {q.data.trips.map((x) => (
              <li key={x.id} className="li">
                <div className="grow">
                  <div className="title">{x.name}</div>
                  <div className="small muted">{fmtDay(x.start_day)} · {t('{n} items', { n: x.count })}</div>
                </div>
                <button className="btn sm" onClick={() => apply({ tripId: x.id })}>{t('Take over')}</button>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ margin: 0 }}>{t('Taking over adds the items with their photos and videos – nothing already there is replaced.')}</p>
        </div>
      )}
    </Sheet>
  );
}
