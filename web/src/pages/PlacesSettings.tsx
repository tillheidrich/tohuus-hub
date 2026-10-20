/**
 * Settings › Areas & places › Places & categories (area: home): the places as a tree – order (arrows, drag on desktop), parent, climate,
 * icon, owner, archive – plus categories. And the household card: who lives here and how.
 * "As a list" is the full, always usable view; "as a home" hands the same data to the illustration
 * (HomeArt from the design system) with a simple room-by-room fallback.
 */
import { Archive, ArrowDown, ArrowUp, CaretRight, DotsThree, House, Plus, Trash } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { type Category, type Climate, type Location, del, invalidate, patch, post, put, useApi } from '../api';
import { HomeArt } from '../art';
import { FORM_HINT, FORM_LABEL, PRESET_LABEL, type HomePreset, type HouseholdForm, useHousehold } from '../household';
import { t } from '../i18n';
import { Empty, Seg, Sheet, Skeleton, useToast } from '../ui';
import { Ic } from '../placeicons';
import { KnowledgeFor } from './Knowledge';

/** English source texts for the three climates – the words the UI uses everywhere. */
export const CLIMATE_LABEL: Record<Climate, string> = { ambient: 'Room temperature', chilled: 'Chilled', frozen: 'Freezing' };
const CLIMATES: Climate[] = ['ambient', 'chilled', 'frozen'];

/** Icons that make sense for a place (the category icons stay out of the way). */
export const PLACE_ICONS = [
  'refrigerator', 'snowflake', 'chest-freezer', 'archive', 'shelf', 'box', 'drawer', 'wardrobe', 'lockers', 'jar', 'basket',
  'cooking-pot', 'bath', 'sparkles', 'washing-machine', 'toolbox', 'cellar', 'warehouse', 'garage', 'balcony', 'desk', 'couch', 'bed', 'door', 'house', 'package',
];

const VIEW_KEY = 'sw.places.view';
const readView = (): 'list' | 'home' => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'home' ? 'home' : 'list';
  } catch {
    return 'list';
  }
};

const refresh = () => invalidate('locations', 'overview', 'find', 'boxes', 'onboarding');

// ================================================================== household form & preset

export function HouseholdFormCard({ admin }: { admin: boolean }) {
  const home = useHousehold();
  const toast = useToast();
  const save = (body: { form?: HouseholdForm; preset?: HomePreset | null }) =>
    put('/home/setup', body)
      .then(() => {
        invalidate('me', 'onboarding', 'settings');
        toast({ text: t('Saved') });
      })
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  const forms: HouseholdForm[] = ['single', 'couple', 'family', 'shared'];
  const presets: HomePreset[] = ['flat', 'terraced', 'house', 'shared', 'other'];
  return (
    <div className="card pad stack" style={{ gap: 18 }}>
      <div className="field" style={{ margin: 0 }}>
        <label>{t('Who lives here?')}</label>
        <div className="onb-paths places-forms">
          {forms.map((f) => (
            <button key={f} type="button" className={`action ${home.form === f && home.form_chosen ? 'on' : ''}`} aria-pressed={home.form === f && home.form_chosen} disabled={!admin} onClick={() => save({ form: f })}>
              <b>{t(FORM_LABEL[f])}</b>
              <span>{t(FORM_HINT[f])}</span>
            </button>
          ))}
        </div>
        <div className="help">{t('This only changes what the app shows and suggests – nothing is locked, and you can switch any time.')}</div>
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>{t('How do you live?')}</label>
        <div className="chips">
          {presets.map((p) => (
            <button key={p} type="button" className={`chip ${home.preset === p ? 'on' : ''}`} aria-pressed={home.preset === p} disabled={!admin} onClick={() => save({ preset: home.preset === p ? null : p })}>
              {t(PRESET_LABEL[p])}
            </button>
          ))}
        </div>
        <div className="help">{t('Only for suggestions and the picture of your home – places are always your own.')}</div>
      </div>
    </div>
  );
}

// ================================================================== places

interface Member {
  id: number;
  name: string;
}

export function PlacesSettings({ admin }: { admin: boolean }) {
  const locs = useApi<Location[]>(['locations', 'all'], '/locations?all=1');
  const home = useHousehold();
  const [view, setViewState] = useState<'list' | 'home'>(readView);
  const [edit, setEdit] = useState<Location | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const toast = useToast();
  const setView = (v: 'list' | 'home') => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const all = locs.data ?? [];
  const active = all.filter((l) => !l.archived || l.system);
  const archived = all.filter((l) => l.archived && !l.system);

  /** Siblings of a place in the visible tree (same parent), in order. */
  const siblingsOf = (l: Location) => active.filter((x) => !x.system && (x.parent_id ?? null) === (l.parent_id ?? null) && active.some((y) => y.id === x.id));
  const move = async (l: Location, dir: -1 | 1) => {
    const sib = siblingsOf(l);
    const i = sib.findIndex((x) => x.id === l.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sib.length) return;
    const ids = sib.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await put('/locations/order', { ids }).then(refresh).catch((e) => toast({ text: (e as Error).message, error: true }));
  };
  const dropOn = async (target: Location) => {
    const from = all.find((x) => x.id === dragId);
    setDragId(null);
    if (!from || from.id === target.id || (from.parent_id ?? null) !== (target.parent_id ?? null)) return;
    const ids = siblingsOf(target).map((x) => x.id).filter((x) => x !== from.id);
    ids.splice(ids.indexOf(target.id), 0, from.id);
    await put('/locations/order', { ids }).then(refresh).catch((e) => toast({ text: (e as Error).message, error: true }));
  };

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{t('Places')}</h2>
          <p className="small muted" style={{ margin: 0 }}>{t('Rooms, shelves and devices where things are kept – only the ones you really have.')}</p>
        </div>
        <Seg<'list' | 'home'>
          value={view}
          onChange={setView}
          label={t('View')}
          options={[
            ['list', t('As a list')],
            ['home', t('As a home')],
          ]}
        />
      </div>

      {locs.isLoading ? (
        <Skeleton n={4} h={56} />
      ) : locs.error ? (
        <div className="card pad small" style={{ color: 'var(--empty)' }}>
          {(locs.error as Error).message}{' '}
          <button className="linkish" onClick={() => locs.refetch()}>{t('Try again')}</button>
        </div>
      ) : active.length === 0 ? (
        <Empty icon={<House size={26} />} title={t('No places yet')}>
          {t('That is fine – things you add without a place show up under “not assigned yet”. Add a place whenever it helps.')}
        </Empty>
      ) : view === 'home' ? (
        <HomeView places={active} preset={home.preset} onOpen={(l) => admin && !l.system && setEdit(l)} />
      ) : (
        <div className="list places-tree" role="tree" aria-label={t('Places')}>
          {active.map((l) => {
            const sib = l.system ? [] : siblingsOf(l);
            const i = sib.findIndex((x) => x.id === l.id);
            return (
              <div
                key={l.id}
                role="treeitem"
                aria-level={(l.depth ?? 0) + 1}
                className={`li places-row ${dragId === l.id ? 'dragging' : ''}`}
                style={{ paddingLeft: 12 + (l.depth ?? 0) * 22 }}
                draggable={admin && !l.system}
                onDragStart={() => setDragId(l.id)}
                onDragOver={(e) => dragId && e.preventDefault()}
                onDrop={() => dropOn(l)}
                onDragEnd={() => setDragId(null)}
              >
                {(l.depth ?? 0) > 0 && <CaretRight size={12} className="muted" aria-hidden />}
                <span className="thumb" style={{ width: 36, height: 36 }}>
                  <Ic name={l.icon} size={18} />
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title">{l.name}</div>
                  <div className="sub small muted">
                    {[l.system ? t('Things without a place') : t(CLIMATE_LABEL[l.climate ?? 'ambient']), l.owner_name ? t('belongs to {name}', { name: l.owner_name }) : null, l.hint || null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <span className="small muted mono" style={{ minWidth: 24, textAlign: 'right' }} title={t('Things stored here')}>
                  {l.product_count ?? 0}
                </span>
                {admin && !l.system && (
                  <>
                    <button className="icon-btn plain" disabled={i <= 0} onClick={() => move(l, -1)} aria-label={t('Move up')}>
                      <ArrowUp size={16} />
                    </button>
                    <button className="icon-btn plain" disabled={i < 0 || i >= sib.length - 1} onClick={() => move(l, 1)} aria-label={t('Move down')}>
                      <ArrowDown size={16} />
                    </button>
                    <button className="icon-btn plain" onClick={() => setEdit(l)} aria-label={t('Edit {name}', { name: l.name })}>
                      <DotsThree size={18} weight="bold" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {admin && <AddPlace places={active.filter((l) => !l.system)} personal={home.ui.personal_places} />}

      {archived.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <button className="linkish" style={{ alignSelf: 'flex-start' }} onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
            <Archive size={14} /> {archived.length === 1 ? t('1 archived place') : t('{n} archived places', { n: archived.length })}
          </button>
          {showArchived && (
            <div className="list">
              {archived.map((l) => (
                <div key={l.id} className="li">
                  <span className="thumb" style={{ width: 36, height: 36 }}>
                    <Ic name={l.icon} size={18} />
                  </span>
                  <div className="grow">
                    <div className="title">{l.path ?? l.name}</div>
                    <div className="sub small muted">{(l.product_count ?? 0) > 0 ? t('{n} things are still stored here', { n: l.product_count ?? 0 }) : t('Empty')}</div>
                  </div>
                  {admin && (
                    <button className="btn sm" onClick={() => patch(`/locations/${l.id}`, { archived: false }).then(refresh).catch((e) => toast({ text: (e as Error).message, error: true }))}>
                      {t('Bring back')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <PlaceSheet place={edit} places={all} personal={home.ui.personal_places} onClose={() => setEdit(null)} />
    </section>
  );
}

/** The same places, room by room – the data for the illustrated home (the design system draws the picture). */
function HomeView({ places, preset, onOpen }: { places: Location[]; preset: HomePreset | null; onOpen: (l: Location) => void }) {
  const roots = places.filter((l) => (l.depth ?? 0) === 0);
  const inside = (id: number) => places.filter((l) => l.parent_id === id);
  return (
    <div className="stack places-home" style={{ gap: 12 }}>
      <HomeArt preset={preset} className="places-home-art" />
      <div className="places-home-rooms">
        {roots.map((r) => (
          <button key={r.id} type="button" className="card pad places-room" onClick={() => onOpen(r)}>
            <div className="row" style={{ gap: 8 }}>
              <Ic name={r.icon} size={20} />
              <b className="grow">{r.name}</b>
              <span className="small muted">{r.product_count ?? 0}</span>
            </div>
            {inside(r.id).length > 0 && (
              <div className="chips" style={{ marginTop: 8 }}>
                {inside(r.id).map((c) => (
                  <span key={c.id} className="chip">
                    <Ic name={c.icon} size={14} /> {c.name}
                  </span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Parent options: every place except itself and its own children (the server checks too). */
function parentOptions(places: Location[], self: Location | null) {
  const blocked = new Set<number>();
  if (self) {
    blocked.add(self.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of places) if (l.parent_id && blocked.has(l.parent_id) && !blocked.has(l.id)) (blocked.add(l.id), (grew = true));
    }
  }
  return places.filter((l) => !l.system && !l.archived && !blocked.has(l.id));
}

function AddPlace({ places, personal }: { places: Location[]; personal: boolean }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState<number | ''>('');
  const [climate, setClimate] = useState<Climate | ''>('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await post('/locations', { name: name.trim(), parent_id: parent || null, climate: climate || null });
      setName('');
      setClimate('');
      refresh();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <input
          className="input grow"
          style={{ minWidth: 180 }}
          placeholder={personal ? t('New place, e.g. Jonas’ shelf, shared fridge') : t('New place, e.g. hallway cupboard, shelf above the fridge')}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn" disabled={!name.trim() || busy} onClick={add}>
          <Plus size={16} /> {t('Add')}
        </button>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <label className="small muted row" style={{ gap: 6 }}>
          {t('Inside')}
          <select className="input sm" style={{ width: 'auto' }} value={parent} onChange={(e) => setParent(e.target.value ? Number(e.target.value) : '')}>
            <option value="">{t('nowhere (top level)')}</option>
            {places.map((l) => (
              <option key={l.id} value={l.id}>{l.path ?? l.name}</option>
            ))}
          </select>
        </label>
        <label className="small muted row" style={{ gap: 6 }}>
          {t('Climate')}
          <select className="input sm" style={{ width: 'auto' }} value={climate} onChange={(e) => setClimate(e.target.value as Climate | '')}>
            <option value="">{t('detect from the name')}</option>
            {CLIMATES.map((c) => (
              <option key={c} value={c}>{t(CLIMATE_LABEL[c])}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function PlaceSheet({ place, places, personal, onClose }: { place: Location | null; places: Location[]; personal: boolean; onClose: () => void }) {
  const members = useApi<Member[]>(['shopping', 'members'], place ? '/shop/members' : null);
  const [iconOpen, setIconOpen] = useState(false);
  const toast = useToast();
  const options = useMemo(() => parentOptions(places, place), [places, place]);
  if (!place) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const save = (body: Record<string, unknown>) =>
    patch(`/locations/${place.id}`, body)
      .then(refresh)
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  const remove = () =>
    del(`/locations/${place.id}`)
      .then(() => {
        refresh();
        onClose();
      })
      .catch((e) => toast({ text: (e as Error).message, error: true }));
  const current = places.find((l) => l.id === place.id) ?? place;
  return (
    <Sheet open onClose={onClose} title={current.name}>
      <div className="stack" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <button className="thumb" style={{ width: 52, height: 52, border: 0, cursor: 'pointer' }} onClick={() => setIconOpen((v) => !v)} aria-label={t('Choose icon')}>
            <Ic name={current.icon} size={26} />
          </button>
          <div className="field grow" style={{ margin: 0 }}>
            <label htmlFor="pl-name">{t('Name')}</label>
            <input id="pl-name" className="input" defaultValue={current.name} maxLength={60} onBlur={(e) => e.target.value.trim() && e.target.value !== current.name && save({ name: e.target.value })} />
          </div>
        </div>
        {iconOpen && (
          <div className="row wrap" style={{ gap: 6 }}>
            {PLACE_ICONS.map((i) => (
              <button key={i} className={`icon-btn ${current.icon === i ? 'on' : ''}`} style={{ width: 46, height: 46 }} onClick={() => save({ icon: i }).then(() => setIconOpen(false))} aria-label={i}>
                <Ic name={i} size={22} />
              </button>
            ))}
          </div>
        )}
        <div className="field" style={{ margin: 0 }}>
          <label>{t('Climate')}</label>
          <Seg<Climate> value={current.climate ?? 'ambient'} onChange={(c) => save({ climate: c })} options={CLIMATES.map((c) => [c, t(CLIMATE_LABEL[c])] as [Climate, string])} />
          <div className="help">{t('“Frozen” places are offered for freezing, “chilled” ones for leftovers. Nothing else depends on the name.')}</div>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="pl-parent">{t('Inside')}</label>
          <select id="pl-parent" className="input" value={current.parent_id ?? ''} onChange={(e) => save({ parent_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{t('nowhere (top level)')}</option>
            {options.map((l) => (
              <option key={l.id} value={l.id}>{l.path ?? l.name}</option>
            ))}
          </select>
        </div>
        {(personal || current.owner_user_id) && (
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="pl-owner">{t('Belongs to')}</label>
            <select id="pl-owner" className="input" value={current.owner_user_id ?? ''} onChange={(e) => save({ owner_user_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{t('everyone (shared)')}</option>
              {(members.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
        )}
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="pl-hint">{t('Directions')}</label>
          <input id="pl-hint" className="input" defaultValue={current.hint ?? ''} maxLength={200} placeholder={t('Directions, e.g. in the hallway, second door on the right')} onBlur={(e) => e.target.value !== (current.hint ?? '') && save({ hint: e.target.value })} />
        </div>
        {/* Haushaltswissen: measurements and numbers of this room (pages/Knowledge.tsx) */}
        <KnowledgeFor refKey={`l${current.id}`} name={current.name} />
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" onClick={() => save({ archived: true }).then(onClose)}>
            <Archive size={16} /> {t('Archive')}
          </button>
          <button className="btn ghost" disabled={(current.product_count ?? 0) > 0} onClick={remove} title={(current.product_count ?? 0) > 0 ? t('There is still something stored at this location.') : undefined}>
            <Trash size={16} /> {t('Delete')}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {(current.children ?? 0) > 0
            ? t('Archived places disappear from the pickers; what is stored stays visible. Deleting moves the places inside one level up.')
            : t('Archived places disappear from the pickers; what is stored stays visible.')}
        </p>
      </div>
    </Sheet>
  );
}

// ================================================================== categories (unchanged behaviour)

export function CategorySettings({ admin }: { admin: boolean }) {
  const locations = useApi<Location[]>('locations', '/locations');
  const categories = useApi<Category[]>('categories', '/categories');
  const pick = (locations.data ?? []).filter((l) => !l.archived && !l.system);
  return (
    <section>
      <h2 style={{ marginBottom: 6 }}>{t('Categories')}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>{t('Decide where new products go and how precisely they’re counted.')}</p>
      <div className="list">
        {(categories.data ?? []).map((c) => (
          <div key={c.id} className="li wrap" style={{ flexWrap: 'wrap' }}>
            <span className="thumb" style={{ width: 40, height: 40 }}><Ic name={c.icon} /></span>
            <div className="grow" style={{ minWidth: 120 }}>
              <div className="title">{c.name}</div>
            </div>
            <select className="input" aria-label={t('Place for new products: {name}', { name: c.name })} style={{ width: 'auto', height: 34, fontSize: 13 }} value={c.default_location_id ?? ''} disabled={!admin} onChange={(e) => patch(`/categories/${c.id}`, { default_location_id: e.target.value ? Number(e.target.value) : null }).then(() => invalidate('categories'))}>
              <option value="">{t('no place')}</option>
              {pick.map((l) => (
                <option key={l.id} value={l.id}>{l.path ?? l.name}</option>
              ))}
            </select>
            <select className="input" aria-label={t('How to count: {name}', { name: c.name })} style={{ width: 'auto', height: 34, fontSize: 13 }} value={c.track_mode} disabled={!admin} onChange={(e) => patch(`/categories/${c.id}`, { track_mode: e.target.value }).then(() => invalidate('categories'))}>
              <option value="count">{t('Pieces')}</option>
              <option value="level">{t('Fill level')}</option>
              <option value="none">{t('don’t count')}</option>
            </select>
          </div>
        ))}
      </div>
    </section>
  );
}
