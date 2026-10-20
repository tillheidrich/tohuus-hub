/**
 * People (area: people): the household at a glance in Settings › Household › Who lives here?, one sheet per person
 * (picture, likes/dislikes/allergies, guest access, login link), the picture editor with square crop,
 * and "my picture & taste" in My account.
 */
import {
  ArrowCounterClockwise,
  Camera,
  Clock,
  Copy,
  EnvelopeSimple,
  Heart,
  ImageSquare,
  LinkSimple,
  PauseCircle,
  Plus,
  ShareNetwork,
  Trash,
  User,
  UserPlus,
  Users,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Me } from '../App';
import { useQuery } from '@tanstack/react-query';
import { api, del, get, invalidate, patch, post, put, useApi } from '../api';
import { householdWord, useHousehold } from '../household';
import { locale, t } from '../i18n';
import { ANIMAL_KEYS } from '../pages/KidArt';
import { Seg, Sheet, Skeleton, useToast } from '../ui';
import { Avatar, type Face } from './Avatar';
import { PersonProfileSheet } from './Ratings';
import { useHealthConsent } from './HealthConsent';
import { KnowledgeFor } from '../pages/Knowledge';

export type GuestLevel = 'order' | 'stock' | 'recipes' | 'family';
export type EffectiveLevel = GuestLevel | 'paused';

export interface Person {
  key: string;
  id: number;
  kind: 'member' | 'guest' | 'child';
  role: 'admin' | 'member' | null;
  name: string;
  color: string;
  face: Face;
  birth_year: number | null;
  prefs: { likes: string[]; dislikes: string[]; allergies: string[] } | null;
  guest: { base: GuestLevel; level: EffectiveLevel; override: { level: EffectiveLevel; until: string; set_by?: string | null } | null; areas: string[] } | null;
  email?: string | null;
  email_confirmed?: boolean;
}

// earthy, all readable with light initials (design review 15 Oct 2026) – no saturated blue
export const PERSON_COLORS = ['#3d5a80', '#b5553a', '#2f7d5b', '#7a4f8f', '#a83f62', '#94660f', '#8a6a2a', '#2c7a7b'];

/** English source text; shown via t() */
export const LEVELS: { key: GuestLevel; title: string; text: string }[] = [
  { key: 'order', title: 'Bring me something & shopping list', text: 'Can ask for treats from the menu and use the shopping list. Sees nothing else.' },
  { key: 'stock', title: '+ Stock & where is what', text: 'Also sees what is in the house and where things are, and can take things out.' },
  { key: 'recipes', title: '+ Recipes & week plan', text: 'Also sees recipes, the week plan and what to eat, and can rate dishes.' },
  { key: 'family', title: 'Like family', text: 'Everything day to day – but no settings, members, spending or receipts.' },
];
export const levelTitle = (l: EffectiveLevel) => (l === 'paused' ? t('Paused') : t(LEVELS.find((x) => x.key === l)!.title));
const ALWAYS_HIDDEN = 'Never visible for guests: settings and members, spending and receipts, imports, backups and access tokens, home & care notes, discreet items.';

/** SQLite UTC "YYYY-MM-DD HH:MM:SS" → Date */
export const fromSql = (s: string) => new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
export const fmtUntil = (s: string) => fromSql(s).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const kindLabel = (p: Person) =>
  p.kind === 'child' ? (p.birth_year ? t('Child · born {year}', { year: p.birth_year }) : t('Child')) : p.kind === 'guest' ? t('Guest · {level}', { level: levelTitle(p.guest!.level) }) : p.role === 'admin' ? t('Admin') : t('Member');

export const editBase = (p: Pick<Person, 'key'>, me: Me) => (p.key === `u${me.actor.userId}` ? '/people/me' : `/people/person/${p.key}`);

// ================================================================== the household grid

export function PeopleSection({ me, admin }: { me: Me; admin: boolean }) {
  const q = useApi<{ people: Person[] }>('people', '/people');
  const [open, setOpen] = useState<string | null>(null);
  const [add, setAdd] = useState<'child' | 'guest' | null>(null);
  const people = q.data?.people ?? [];
  // area: home – "Family" only where it is one (WG: Flat share, otherwise Household)
  const home = useHousehold();
  const groups: [string, Person[]][] = [
    [householdWord(home.form), people.filter((p) => p.kind === 'member')],
    [t('Children'), people.filter((p) => p.kind === 'child')],
    [t('Permanent guests'), people.filter((p) => p.kind === 'guest')],
  ];
  return (
    <section className="people-section">
      <div className="row between wrap" style={{ marginBottom: 10, gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('Our household')}</h2>
          <div className="small muted">{t('Tap a person for their picture, what they like and what they can see.')}</div>
        </div>
        {admin && (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => setAdd('child')}>
              <Plus size={15} /> {t('Add a child')}
            </button>
            <button className="btn sm" onClick={() => setAdd('guest')}>
              <UserPlus size={15} /> {t('Add a permanent guest')}
            </button>
          </div>
        )}
      </div>
      {q.isLoading ? (
        <Skeleton n={2} h={72} />
      ) : q.error ? (
        <div className="card pad small" style={{ color: 'var(--empty)' }}>{(q.error as Error).message}</div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {groups
            .filter(([, list]) => list.length)
            .map(([title, list]) => (
              <div key={title}>
                <div className="eyebrow" style={{ marginBottom: 6 }}>{title}</div>
                <div className="people-grid">
                  {list.map((p) => (
                    <button key={p.key} className="person-card" onClick={() => setOpen(p.key)}>
                      <Avatar name={p.name} color={p.color} face={p.face} size={52} />
                      <b>
                        {p.name}
                        {p.key === `u${me.actor.userId}` ? ` · ${t('you')}` : ''}
                      </b>
                      <span className="small muted">{kindLabel(p)}</span>
                      {p.guest?.override && (
                        <span className="badge info" style={{ marginTop: 2 }}>
                          <Clock size={11} /> {t('until {when}', { when: fmtUntil(p.guest.override.until) })}
                        </span>
                      )}
                      {(p.prefs?.allergies.length ?? 0) > 0 && (
                        <span className="badge low" style={{ marginTop: 2 }}>
                          <WarningCircle size={11} /> {p.prefs!.allergies.slice(0, 2).join(', ')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          {!people.some((p) => p.kind === 'child') && admin && (
            <p className="small muted" style={{ margin: 0 }}>
              {t('Children get a profile without a login: a picture, what they like and their allergies. Parents rate dishes for them, and kid mode uses the same profile.')}
            </p>
          )}
        </div>
      )}
      <PersonSheet personKey={open} me={me} admin={admin} people={people} onClose={() => setOpen(null)} />
      <AddChildSheet open={add === 'child'} onClose={() => setAdd(null)} onCreated={(k) => { setAdd(null); setOpen(k); }} />
      <AddGuestSheet open={add === 'guest'} onClose={() => setAdd(null)} onCreated={(k) => { setAdd(null); setOpen(k); }} />
    </section>
  );
}

// ================================================================== one person

function PersonSheet({ personKey, me, admin, people, onClose }: { personKey: string | null; me: Me; admin: boolean; people: Person[]; onClose: () => void }) {
  const p = people.find((x) => x.key === personKey) ?? null;
  const [profile, setProfile] = useState(false);
  const toast = useToast();
  if (!p) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const self = p.key === `u${me.actor.userId}`;
  const guestViewer = Boolean(me.actor.houseGuest);
  const canEdit = self || (!guestViewer && (p.kind === 'child' || admin));
  const remove = async () => {
    if (!confirm(t('Remove {name}?', { name: p.name }))) return;
    try {
      if (p.kind === 'child') await del(`/people/children/${p.id}`);
      else await del(`/users/${p.id}`);
      invalidate('people', 'people-dir', 'users', 'users-public', 'kids');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <Sheet open onClose={onClose} title={p.name}>
      <div className="stack" style={{ gap: 18 }}>
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={p.name} color={p.color} face={p.face} size={64} />
          <div className="grow">
            <b style={{ fontSize: 18 }}>{p.name}</b>
            <div className="small muted">{kindLabel(p)}</div>
          </div>
          <button className="btn sm ghost" onClick={() => setProfile(true)}>
            <Heart size={15} /> {t('Likes')}
          </button>
        </div>
        {canEdit && <FaceEditor person={p} base={editBase(p, me)} />}
        {p.kind === 'child' && admin && <ChildDetails p={p} />}
        {canEdit && p.prefs && <PrefsEditor person={p} base={editBase(p, me)} />}
        {!canEdit && p.prefs && (p.prefs.allergies.length > 0 || p.prefs.dislikes.length > 0) && (
          <div className="small">
            {p.prefs.allergies.length > 0 && <div><b>{t('Allergies')}:</b> {p.prefs.allergies.join(', ')}</div>}
            {p.prefs.dislikes.length > 0 && <div className="muted">{t('Doesn’t like')}: {p.prefs.dislikes.join(', ')}</div>}
          </div>
        )}
        {/* Haushaltswissen: sizes and other things about this person (pages/Knowledge.tsx) */}
        {p.kind !== 'guest' && me.modules?.knowledge !== false && <KnowledgeFor refKey={p.key} name={p.name} canAdd={!guestViewer} />}
        {admin && p.kind === 'guest' && <GuestAccess p={p} />}
        {admin && p.kind !== 'child' && !self && <SignInFor p={p} />}
        {admin && p.kind !== 'child' && !self && <KindSwitch p={p} />}
        {admin && !self && (
          <button className="btn ghost danger" onClick={remove} style={{ alignSelf: 'flex-start' }}>
            <Trash size={16} /> {t('Remove {name}', { name: p.name })}
          </button>
        )}
      </div>
      <PersonProfileSheet personKey={profile ? p.key : null} onClose={() => setProfile(false)} />
    </Sheet>
  );
}

// ---------------------------------------------------------------- picture

export function FaceEditor({ person, base }: { person: Pick<Person, 'key' | 'name' | 'color' | 'face' | 'kind'>; base: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [crop, setCrop] = useState<File | null>(null);
  const toast = useToast();
  const done = () => invalidate('people', 'people-dir', 'kids', 'me');
  const setFace = (face: Face) =>
    put(`${base}/face`, face)
      .then(done)
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  const setColor = (color: string) =>
    put(`${base}/color`, { color })
      .then(() => invalidate('people', 'people-dir', 'kids', 'users', 'users-public'))
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  const pick = (f: File | undefined) => f && setCrop(f);
  return (
    <div className="field">
      <label>{t('Picture')}</label>
      <div className="face-options">
        <button type="button" className="face-opt" onClick={() => fileRef.current?.click()}>
          <ImageSquare size={22} />
          <span>{t('Photo')}</span>
        </button>
        <button type="button" className="face-opt" onClick={() => camRef.current?.click()}>
          <Camera size={22} />
          <span>{t('Take photo')}</span>
        </button>
        <button type="button" className={`face-opt ${person.face.type === 'initials' ? 'on' : ''}`} onClick={() => setFace({ type: 'initials' })} aria-label={t('Initials')}>
          <Avatar name={person.name} color={person.color} face={{ type: 'initials' }} size={34} />
          <span>{t('Initials')}</span>
        </button>
        {ANIMAL_KEYS.map((a) => (
          <button
            key={a}
            type="button"
            className={`face-opt ${person.face.type === 'animal' && person.face.animal === a ? 'on' : ''}`}
            onClick={() => setFace({ type: 'animal', animal: a })}
            aria-label={a}
          >
            <Avatar name={person.name} color={person.color} face={{ type: 'animal', animal: a }} size={34} />
          </button>
        ))}
      </div>
      {person.face.type === 'photo' && (
        <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => del(`${base}/photo`).then(done)}>
          <X size={14} /> {t('Remove photo')}
        </button>
      )}
      <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
        {PERSON_COLORS.map((c) => (
          <button key={c} type="button" className={`data-swatch ${person.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
        ))}
      </div>
      <input ref={fileRef} hidden type="file" accept="image/*" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={camRef} hidden type="file" accept="image/*" capture="user" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      <CropSheet file={crop} onClose={() => setCrop(null)} base={base} onDone={done} />
    </div>
  );
}

const OUT = 512;
const VIEW = 260;

/** Square crop: drag to move, slider to zoom; downscaled to 512 px in the browser before upload. */
function CropSheet({ file, onClose, base, onDone }: { file: File | null; onClose: () => void; base: string; onDone: () => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const toast = useToast();
  useEffect(() => {
    setImg(null);
    setErr('');
    setZoom(1);
    if (!file) return;
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => {
      setImg(i);
      const s = VIEW / Math.min(i.naturalWidth, i.naturalHeight);
      setOff({ x: (VIEW - i.naturalWidth * s) / 2, y: (VIEW - i.naturalHeight * s) / 2 });
    };
    i.onerror = () => setErr(t('This image could not be opened.'));
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const scale = img ? (VIEW / Math.min(img.naturalWidth, img.naturalHeight)) * zoom : 1;
  const clamp = (o: { x: number; y: number }, s = scale) =>
    img ? { x: Math.min(0, Math.max(VIEW - img.naturalWidth * s, o.x)), y: Math.min(0, Math.max(VIEW - img.naturalHeight * s, o.y)) } : o;
  const setZoomAround = (z: number) => {
    if (!img) return;
    const s0 = VIEW / Math.min(img.naturalWidth, img.naturalHeight);
    const before = s0 * zoom;
    const after = s0 * z;
    // keep the centre of the square where it is
    const cx = (VIEW / 2 - off.x) / before;
    const cy = (VIEW / 2 - off.y) / before;
    setZoom(z);
    setOff(clamp({ x: VIEW / 2 - cx * after, y: VIEW / 2 - cy * after }, after));
  };
  const save = async () => {
    if (!img) return;
    setBusy(true);
    try {
      const c = document.createElement('canvas');
      c.width = OUT;
      c.height = OUT;
      const ctx = c.getContext('2d')!;
      const size = VIEW / scale;
      ctx.drawImage(img, -off.x / scale, -off.y / scale, size, size, 0, 0, OUT, OUT);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', 0.88));
      if (!blob) throw new Error(t('This image could not be opened.'));
      const fd = new FormData();
      fd.append('image', blob, 'face.jpg');
      await api(`${base}/photo`, { form: fd });
      onDone();
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={Boolean(file)} onClose={onClose} title={t('Choose the picture')}>
      <div className="stack" style={{ alignItems: 'center', gap: 14 }}>
        {err ? (
          <div className="small" style={{ color: 'var(--empty)' }}>{err}</div>
        ) : !img ? (
          <div className="crop-box" style={{ width: VIEW, height: VIEW }} />
        ) : (
          <div
            className="crop-box"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) setOff(clamp({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <img src={img.src} alt="" draggable={false} style={{ width: img.naturalWidth * scale, height: img.naturalHeight * scale, transform: `translate(${off.x}px, ${off.y}px)` }} />
            <div className="crop-ring" />
          </div>
        )}
        <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoomAround(Number(e.target.value))} aria-label={t('Zoom')} style={{ width: VIEW }} disabled={!img} />
        <div className="small muted">{t('Drag to move, slide to zoom.')}</div>
        <button className="btn primary lg block" disabled={!img || busy} onClick={save}>
          {busy ? t('Saving …') : t('Use this picture')}
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- likes, dislikes, allergies

export function PrefsEditor({ person, base }: { person: Pick<Person, 'key' | 'name' | 'prefs' | 'kind'>; base: string }) {
  const toast = useToast();
  const { withConsent, sheet } = useHealthConsent();
  const save = (patchBody: Partial<NonNullable<Person['prefs']>>) =>
    withConsent((consent) => put(`${base}/prefs`, consent ? { ...patchBody, consent } : patchBody))
      .then(() => invalidate('people', 'suggest', 'what-to-eat', 'wte', 'overview'))
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  const p = person.prefs ?? { likes: [], dislikes: [], allergies: [] };
  return (
    <div className="stack" style={{ gap: 12 }}>
      {sheet}
      <TagField
        label={t('Allergies')}
        help={t('Dishes with these get a warning and are never planned automatically. “Nuts”, “milk”, “egg” or “gluten” also cover the usual ingredients.')}
        values={p.allergies}
        placeholder={t('e.g. nuts')}
        tone="low"
        onChange={(v) => save({ allergies: v })}
      />
      <TagField label={t('Doesn’t like')} help={t('Suggestions with these come a little later.')} values={p.dislikes} placeholder={t('e.g. mushrooms')} onChange={(v) => save({ dislikes: v })} />
      <TagField label={t('Likes')} values={p.likes} placeholder={t('e.g. pasta')} tone="good" onChange={(v) => save({ likes: v })} />
    </div>
  );
}

function TagField({ label, help, values, placeholder, tone, onChange }: { label: string; help?: string; values: string[]; placeholder: string; tone?: 'low' | 'good'; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    const parts = text.split(',').map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...values, ...parts])]);
    setText('');
  };
  return (
    <div className="field">
      <label>{label}</label>
      <div className="tag-field">
        {values.map((v) => (
          <span key={v} className={`badge ${tone ?? ''}`}>
            {v}
            <button type="button" aria-label={t('Remove {name}', { name: v })} onClick={() => onChange(values.filter((x) => x !== v))}>
              <X size={11} weight="bold" />
            </button>
          </span>
        ))}
        <input
          className="tag-input"
          value={text}
          placeholder={placeholder}
          maxLength={40}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </div>
      {help && <div className="help">{help}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- child details

function ChildDetails({ p }: { p: Person }) {
  const [name, setName] = useState(p.name);
  const [year, setYear] = useState(p.birth_year ? String(p.birth_year) : '');
  const toast = useToast();
  useEffect(() => {
    setName(p.name);
    setYear(p.birth_year ? String(p.birth_year) : '');
  }, [p.key, p.name, p.birth_year]);
  const save = (b: Record<string, unknown>) =>
    patch(`/people/children/${p.id}`, b)
      .then(() => invalidate('people', 'people-dir', 'kids'))
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  return (
    <div className="grid-2">
      <div className="field">
        <label htmlFor="child-name">{t('Name')}</label>
        <input id="child-name" className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== p.name && save({ name: name.trim() })} />
      </div>
      <div className="field">
        <label htmlFor="child-year">{t('Year of birth (optional)')}</label>
        <input
          id="child-year"
          className="input"
          inputMode="numeric"
          value={year}
          placeholder="2021"
          onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
          onBlur={() => (year === '' ? p.birth_year !== null && save({ birth_year: null }) : Number(year) !== p.birth_year && save({ birth_year: Number(year) }))}
        />
      </div>
    </div>
  );
}

function AddChildSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (key: string) => void }) {
  const [f, setF] = useState({ name: '', year: '', allergies: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { withConsent, sheet } = useHealthConsent();
  useEffect(() => {
    if (open) {
      setF({ name: '', year: '', allergies: '' });
      setErr('');
    }
  }, [open]);
  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const body = {
        name: f.name.trim(),
        birth_year: f.year ? Number(f.year) : null,
        color: PERSON_COLORS[Math.floor(Math.random() * PERSON_COLORS.length)],
        allergies: f.allergies.split(',').map((x) => x.trim()).filter(Boolean),
      };
      const p = await withConsent((consent) => post<Person>('/people/children', consent ? { ...body, consent } : body));
      if (!p) return;
      invalidate('people', 'people-dir', 'kids');
      onCreated(p.key);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Add a child')}>
      {sheet}
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('Children never get a login. You rate dishes for them and choose their picture; kid mode uses the same profile.')}
        </p>
        <div className="field">
          <label htmlFor="add-child-name">{t('Name')}</label>
          <input id="add-child-name" className="input" value={f.name} maxLength={30} autoFocus placeholder={t('e.g. Mika')} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="add-child-year">{t('Year of birth (optional)')}</label>
          <input id="add-child-year" className="input" inputMode="numeric" value={f.year} placeholder="2021" onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
        </div>
        <div className="field">
          <label htmlFor="add-child-allergies">{t('Allergies (optional)')}</label>
          <input id="add-child-allergies" className="input" value={f.allergies} placeholder={t('e.g. nuts, milk')} onChange={(e) => setF({ ...f, allergies: e.target.value })} />
          <div className="help">{t('Separate with commas. You can add likes and dislikes afterwards.')}</div>
        </div>
        {err && <div className="small" style={{ color: 'var(--empty)' }}>{err}</div>}
        <button className="btn primary lg" disabled={busy || !f.name.trim()} onClick={create}>
          {t('Add')}
        </button>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- permanent guests

export function LevelPicker({ value, onChange }: { value: GuestLevel; onChange: (l: GuestLevel) => void }) {
  return (
    <div className="level-pick" role="radiogroup">
      {LEVELS.map((l) => (
        <button key={l.key} type="button" role="radio" aria-checked={value === l.key} className={value === l.key ? 'on' : ''} onClick={() => onChange(l.key)}>
          <b>{t(l.title)}</b>
          <span>{t(l.text)}</span>
        </button>
      ))}
      <div className="small muted" style={{ padding: '2px 4px' }}>{t(ALWAYS_HIDDEN)}</div>
    </div>
  );
}

function AddGuestSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (key: string) => void }) {
  const [f, setF] = useState({ name: '', email: '', level: 'order' as GuestLevel });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (open) {
      setF({ name: '', email: '', level: 'order' });
      setErr('');
    }
  }, [open]);
  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const p = await post<Person>('/people/guests', { name: f.name.trim(), email: f.email.trim() || null, level: f.level, color: PERSON_COLORS[5] });
      invalidate('people', 'people-dir', 'users');
      onCreated(p.key);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Add a permanent guest')}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          {t('For someone who is often here – grandparents, a regular babysitter. They sign in with a link (and later a passkey or PIN) and only see what you allow.')}
        </p>
        <div className="field">
          <label htmlFor="guest-name">{t('Name')}</label>
          <input id="guest-name" className="input" value={f.name} maxLength={40} autoFocus placeholder={t('e.g. Oma Inge')} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="guest-mail">{t('E-mail (optional)')}</label>
          <input id="guest-mail" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <div className="help">{t('For sign-in links. Without it, you hand over a link or QR code.')}</div>
        </div>
        <div className="field">
          <label>{t('What they can see')}</label>
          <LevelPicker value={f.level} onChange={(level) => setF({ ...f, level })} />
        </div>
        {err && <div className="small" style={{ color: 'var(--empty)' }}>{err}</div>}
        <button className="btn primary lg" disabled={busy || !f.name.trim()} onClick={create}>
          {t('Add')}
        </button>
      </div>
    </Sheet>
  );
}

/** Next Sunday (today if it is Sunday and not yet that late) at hh:mm local time. */
function nextSunday(h: number, m: number) {
  const d = new Date();
  const add = (7 - d.getDay()) % 7;
  d.setDate(d.getDate() + add);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 7);
  return d;
}
const tonight = () => {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d;
};
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function GuestAccess({ p }: { p: Person }) {
  const toast = useToast();
  const [custom, setCustom] = useState(false);
  const [cl, setCl] = useState<EffectiveLevel>('family');
  const [cu, setCu] = useState(toLocalInput(nextSunday(20, 0)));
  const g = p.guest!;
  const send = (body: unknown, msg: string) =>
    patch(`/people/guests/${p.id}`, body)
      .then(() => {
        invalidate('people', 'people-dir');
        toast({ text: msg });
        setCustom(false);
      })
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  const presets: { label: string; level: EffectiveLevel; until: Date }[] = [
    { label: t('Full access until Sunday evening'), level: 'family', until: nextSunday(20, 0) },
    { label: t('Only ordering this weekend'), level: 'order', until: nextSunday(23, 59) },
    { label: t('Pause until tonight'), level: 'paused', until: tonight() },
  ];
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="field">
        <label>{t('What {name} can see', { name: p.name })}</label>
        <LevelPicker value={g.base} onChange={(level) => send({ level }, t('Saved'))} />
      </div>
      <div className="card pad stack" style={{ gap: 10, background: 'var(--surface-2)' }}>
        <div className="row" style={{ gap: 8 }}>
          <Clock size={18} />
          <b className="grow">{t('For a while')}</b>
        </div>
        {g.override ? (
          <>
            <div className="small">
              {t('{level} until {when}, then back to “{base}” by itself.', { level: levelTitle(g.override.level), when: fmtUntil(g.override.until), base: levelTitle(g.base) })}
            </div>
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => send({ override: null }, t('Back to normal'))}>
              <ArrowCounterClockwise size={15} /> {t('End now')}
            </button>
          </>
        ) : (
          <div className="small muted">{t('Changes for a weekend or a holiday end by themselves – nobody has to remember to switch back.')}</div>
        )}
        <div className="row wrap" style={{ gap: 6 }}>
          {presets.map((x) => (
            <button key={x.label} className="chip" onClick={() => send({ override: { level: x.level, until: x.until.toISOString() } }, t('Saved'))}>
              {x.level === 'paused' ? <PauseCircle size={14} /> : null} {x.label}
            </button>
          ))}
          <button className={`chip ${custom ? 'on' : ''}`} onClick={() => setCustom((c) => !c)}>
            {t('Other …')}
          </button>
        </div>
        {custom && (
          <div className="stack" style={{ gap: 8 }}>
            <select className="input" value={cl} onChange={(e) => setCl(e.target.value as EffectiveLevel)} aria-label={t('Level')}>
              {LEVELS.map((l) => (
                <option key={l.key} value={l.key}>{t(l.title)}</option>
              ))}
              <option value="paused">{t('Paused')}</option>
            </select>
            <input className="input" type="datetime-local" value={cu} onChange={(e) => setCu(e.target.value)} aria-label={t('Until')} />
            <button className="btn primary" disabled={!cu} onClick={() => send({ override: { level: cl, until: new Date(cu).toISOString() } }, t('Saved'))}>
              {t('Set until {when}', { when: cu ? new Date(cu).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '' })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function KindSwitch({ p }: { p: Person }) {
  const toast = useToast();
  const to = p.kind === 'guest' ? 'member' : 'guest';
  const go = () => {
    if (!confirm(to === 'guest' ? t('Make {name} a permanent guest? They keep their sign-in, but only see what you allow.', { name: p.name }) : t('Make {name} a family member? They can then use everything day to day.', { name: p.name }))) return;
    put(`/people/users/${p.id}/kind`, { kind: to, level: 'family' })
      .then(() => invalidate('people', 'people-dir', 'users'))
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  };
  return (
    <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={go}>
      {to === 'guest' ? <User size={15} /> : <Users size={15} />} {to === 'guest' ? t('Make permanent guest') : t('Make family member')}
    </button>
  );
}

// ---------------------------------------------------------------- send login link

function SignInFor({ p }: { p: Person }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        <LinkSimple size={16} /> {t('Send login link')}
      </button>
      <LoginLinkSheet p={open ? p : null} onClose={() => setOpen(false)} />
    </>
  );
}

function LoginLinkSheet({ p, onClose }: { p: Person | null; onClose: () => void }) {
  const me = useQuery<{ mail: boolean }>({ queryKey: ['auth-me'], queryFn: () => get<{ mail: boolean }>('/auth/me'), enabled: Boolean(p) });
  const [email, setEmail] = useState('');
  const [res, setRes] = useState<{ url?: string; sent: boolean; email?: string | null; expires_hours: number } | null>(null);
  const [svg, setSvg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => {
    setRes(null);
    setErr('');
    setEmail(p?.email ?? '');
  }, [p?.key, p?.email]);
  useEffect(() => {
    setSvg('');
    if (res?.url) QRCode.toString(res.url, { type: 'svg', margin: 1, color: { dark: '#17181a', light: '#ffffff' } }).then(setSvg);
  }, [res?.url]);
  if (!p) return null;
  const mail = me.data?.mail ?? false;
  const go = async (deliver: 'email' | 'link') => {
    setBusy(true);
    setErr('');
    try {
      const r = await post(`/people/users/${p.id}/login-link`, { deliver, email: deliver === 'email' ? email.trim() : undefined });
      setRes(r);
      if (r.sent) invalidate('people');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const share = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <Sheet open onClose={onClose} title={t('Sign-in link for {name}', { name: p.name })}>
      <div className="stack">
        {!res && (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              {t('{name} opens the link and is signed in on that device – no password. It works once and for 3 days.', { name: p.name })}
            </p>
            {mail && (
              <div className="field">
                <label htmlFor="ll-mail">{t('E-mail')}</label>
                <input id="ll-mail" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <button className="btn primary" disabled={busy || !email.trim()} onClick={() => go('email')}>
                  <EnvelopeSimple size={16} /> {t('Send by e-mail')}
                </button>
              </div>
            )}
            {!mail && <div className="small muted">{t('E-mail is not set up on this server – show the QR code or send the link yourself.')}</div>}
            <button className={`btn ${mail ? '' : 'primary'}`} disabled={busy} onClick={() => go('link')}>
              <LinkSimple size={16} /> {t('Show link & QR code')}
            </button>
            {err && <div className="small" style={{ color: 'var(--empty)' }}>{err}</div>}
          </>
        )}
        {res?.sent && (
          <div className="stack" style={{ gap: 8 }}>
            <b>{t('Sent to {email}.', { email: res.email ?? '' })}</b>
            <div className="small muted">{t('Once {name} opens it, the address is confirmed and they can ask for new links themselves.', { name: p.name })}</div>
          </div>
        )}
        {res?.url && (
          <div className="stack" style={{ alignItems: 'stretch' }}>
            <div className="data-qr" dangerouslySetInnerHTML={{ __html: svg }} />
            <div className="small muted mono" style={{ wordBreak: 'break-all', textAlign: 'center' }}>{res.url}</div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn grow" onClick={() => navigator.clipboard.writeText(res.url!).then(() => toast({ text: t('Link copied') }))}>
                <Copy size={16} /> {t('Copy link')}
              </button>
              {share && (
                <button className="btn primary grow" onClick={() => navigator.share({ title: t('Sign in'), url: res.url! }).catch(() => {})}>
                  <ShareNetwork size={16} /> {t('Share')}
                </button>
              )}
            </div>
            <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>{t('Scan it with {name}’s phone. Works once, for 3 days. It is shown only now.', { name: p.name })}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ================================================================== my picture & taste (My account)

export function MyPerson({ me }: { me: Me }) {
  const q = useApi<{ person: Person | null; guest: Person['guest'] }>('people-me', '/people/me');
  const p = q.data?.person;
  if (q.isLoading) return <Skeleton n={1} h={90} />;
  if (!p) return null;
  return (
    <section className="card pad stack" style={{ gap: 14, marginBottom: 18 }}>
      <div className="row" style={{ gap: 12 }}>
        <Avatar name={p.name} color={p.color} face={p.face} size={52} />
        <div className="grow">
          <b>{t('Your picture & taste')}</b>
          <div className="small muted">{t('Shows next to your name everywhere – shopping, orders, the week plan.')}</div>
        </div>
      </div>
      <FaceEditor person={p} base="/people/me" />
      {p.prefs && <PrefsEditor person={p} base="/people/me" />}
      {q.data?.guest && <GuestNote g={q.data.guest} me={me} />}
    </section>
  );
}

function GuestNote({ g }: { g: NonNullable<Person['guest']>; me: Me }) {
  return (
    <div className="small muted">
      {t('You are a guest here and can see: {level}.', { level: levelTitle(g.level) })}
      {g.override ? ` ${t('Until {when}.', { when: fmtUntil(g.override.until) })}` : ''}
    </div>
  );
}

/** Shown to a paused guest instead of the app. */
export function PausedScreen({ me }: { me: Me }) {
  const until = me.actor.houseGuest?.override?.until;
  return (
    <div className="empty-state" style={{ minHeight: '60dvh' }}>
      <div className="art">
        <PauseCircle size={44} />
      </div>
      <h2>{t('Your access is paused')}</h2>
      <p className="muted">{until ? t('It opens again on {when} by itself.', { when: fmtUntil(until) }) : t('Someone from the household can open it again.')}</p>
      <button className="btn" onClick={() => post('/auth/logout').then(() => invalidate('me'))}>
        {t('Sign out')}
      </button>
    </div>
  );
}

export { guestAllows } from './access';

/** A tiny line for guests at the top of their home screen. */
export function GuestBanner({ me }: { me: Me }): ReactNode {
  const g = me.actor.houseGuest;
  const text = useMemo(() => (g ? `${t('Guest access')}: ${levelTitle(g.level)}${g.override ? ` · ${t('until {when}', { when: fmtUntil(g.override.until) })}` : ''}` : ''), [g]);
  if (!g) return null;
  return <div className="guest-banner small">{text}</div>;
}
