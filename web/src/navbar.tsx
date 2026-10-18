/**
 * "Deine Leiste" (18 Oct 2026, docs/navigation.md): which areas sit in the bar at the bottom (phone) and on top of the
 * sidebar (desktop). Heute stays first; up to four more, in the person's own order; everything else under "Mehr".
 *
 * Stored per person on the server (PUT /api/nav, GET /api/me → nav.tabs) so the iPhone and the web look the same.
 * Offline it is kept in localStorage and sent as soon as /api/me answers again (useNavSync). Same as the iPhone's
 * NavBarSettingsView (ios/ToHuus/App/NavBarSettings.swift).
 */
import { ArrowDown, ArrowUp, DotsSixVertical, Lock, Minus, Plus } from '@phosphor-icons/react';
import { type MouseEvent, type PointerEvent, useEffect, useMemo, useState } from 'react';
import type { Me } from './App';
import { put, qc } from './api';
import { useDrag } from './dnd';
import './dnd.css';
import './navbar.css';
import { t } from './i18n';
import { NAV_SLOTS, type NavArea, cleanNav, defaultNavTabs, pickableAreas } from './nav';

const LS = 'tohuus.nav';
const PENDING = 'tohuus.nav.pending';

type MeNav = Me & { nav?: { tabs: unknown } };

function readLocal(): NavArea[] | null | undefined {
  try {
    const raw = localStorage.getItem(LS);
    if (raw === null) return undefined;
    return cleanNav(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
function writeLocal(v: NavArea[] | null, pending: boolean) {
  try {
    localStorage.setItem(LS, JSON.stringify(v));
    if (pending) localStorage.setItem(PENDING, '1');
    else localStorage.removeItem(PENDING);
  } catch {
    /* private mode – the server copy still counts */
  }
}
const isPending = () => {
  try {
    return localStorage.getItem(PENDING) === '1';
  } catch {
    return false;
  }
};

/** the person's choice: an unsent local change first, then the server's, then the last one seen on this device */
export function navPrefOf(me: Me): NavArea[] | null {
  const local = readLocal();
  if (isPending() && local !== undefined) return local;
  const m = me as MeNav;
  if (m.nav && 'tabs' in m.nav) return cleanNav(m.nav.tabs);
  return local ?? null;
}

/** keeps the local copy in step with the server and sends a change made offline once the server answers again */
export function useNavSync(me: Me) {
  const m = me as MeNav;
  useEffect(() => {
    if (!m.nav || !me.actor.userId) return;
    if (isPending()) {
      const local = readLocal();
      put('/nav', { tabs: local ?? null })
        .then(() => {
          writeLocal(local ?? null, false);
          qc.invalidateQueries({ queryKey: ['me'] });
        })
        .catch(() => {});
    } else writeLocal(cleanNav(m.nav.tabs), false);
  }, [m.nav, me.actor.userId]);
}

/** save: right away on this device (the bar changes at once), then on the server – offline it waits for useNavSync */
export async function saveNav(tabs: NavArea[] | null): Promise<boolean> {
  writeLocal(tabs, true);
  qc.setQueryData<MeNav>(['me'], (m) => (m ? { ...m, nav: { ...(m.nav ?? {}), tabs } } : m));
  try {
    await put('/nav', { tabs });
    writeLocal(tabs, false);
    return true;
  } catch {
    return false;
  }
}

/** the editor: Einstellungen › Mein Konto, the /leiste page (Mehr › "Deine Leiste") and a long press on the bar */
export function NavBarCard({ me }: { me: Me }) {
  const gl = me.actor.houseGuest?.level;
  const pick = useMemo(() => pickableAreas(gl, me.modules), [gl, me.modules]);
  const stored = navPrefOf(me);
  const [mine, setMine] = useState<NavArea[]>(() => (stored ?? defaultNavTabs(gl, me.modules)).filter((a) => pick.some((p) => p.id === a)));
  const [offline, setOffline] = useState(false);
  const [full, setFull] = useState(false);
  const tabOf = (a: NavArea) => pick.find((p) => p.id === a)!.tab;
  const rest = pick.filter((p) => !mine.includes(p.id));

  const commit = async (next: NavArea[] | null) => {
    setFull(false);
    setMine(next ?? defaultNavTabs(gl, me.modules));
    setOffline(!(await saveNav(next)));
  };
  const move = (a: NavArea, to: number) => {
    const next = mine.filter((x) => x !== a);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, a);
    void commit(next);
  };
  const add = (a: NavArea) => (mine.length >= NAV_SLOTS ? setFull(true) : void commit([...mine, a]));
  const remove = (a: NavArea) => void commit(mine.filter((x) => x !== a));

  const drag = useDrag({
    onDrop: (payload, d) => {
      const a = payload as NavArea;
      if (d.target !== 'navbar' || !d.row || d.row === a) return;
      const without = mine.filter((x) => x !== a);
      const at = without.indexOf(d.row as NavArea);
      if (at < 0) return;
      move(a, d.after ? at + 1 : at);
    },
  });

  if (!me.actor.userId || gl) return null;
  return (
    <div className="card pad stack navbar-card" id="leiste">
      <div className="row between">
        <h2>{t('Your bar')}</h2>
        {stored && (
          <button className="linkish" onClick={() => void commit(null)}>
            {t('Back to the start')}
          </button>
        )}
      </div>
      <p className="small muted">{t('Today stays first. Pick up to four more, in your order. Everything else is under More.')}</p>

      <div className="eyebrow">{t('In the bar')}</div>
      <ol className="navbar-list" data-drop="navbar" aria-label={t('In the bar')}>
        <li className="navbar-row fixed">
          <span className="navbar-ic" aria-hidden="true">
            <Lock size={16} />
          </span>
          <b className="grow">{t('Today')}</b>
          <span className="small muted">{t('Always first')}</span>
        </li>
        {mine.map((a, i) => {
          const l = tabOf(a);
          return (
            <li key={a} className="navbar-row" data-drop-row={a} {...drag(a, a)}>
              <span className="navbar-ic grip" aria-hidden="true">
                <DotsSixVertical size={18} />
              </span>
              <l.icon size={20} aria-hidden="true" />
              <b className="grow">{l.label()}</b>
              <span className="navbar-acts" data-no-drag>
                <button className="icon-btn" disabled={i === 0} onClick={() => move(a, i - 1)} aria-label={`${l.label()}: ${t('Move up')}`}>
                  <ArrowUp size={16} />
                </button>
                <button className="icon-btn" disabled={i === mine.length - 1} onClick={() => move(a, i + 1)} aria-label={`${l.label()}: ${t('Move down')}`}>
                  <ArrowDown size={16} />
                </button>
                <button className="icon-btn" onClick={() => remove(a)} aria-label={t('Take {name} out of the bar', { name: l.label() })}>
                  <Minus size={16} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      {mine.length > 1 && <div className="small muted">{t('Hold and drag to sort.')}</div>}

      {rest.length > 0 && (
        <>
          <div className="eyebrow">{t('Under More')}</div>
          <ul className="navbar-list">
            {rest.map(({ id, tab: l }) => (
              <li key={id} className="navbar-row">
                <span className="navbar-ic" aria-hidden="true" />
                <l.icon size={20} aria-hidden="true" />
                <span className="grow">{l.label()}</span>
                <button className="icon-btn" onClick={() => add(id)} aria-label={t('Put {name} into the bar', { name: l.label() })}>
                  <Plus size={16} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {full && (
        <div className="small" role="status">
          {t('The bar is full. Take one out first.')}
        </div>
      )}
      <div className="small muted" role="status">
        {offline ? t('Saved on this device. It goes to your other devices once you’re online.') : t('Same on all your devices.')}
      </div>
    </div>
  );
}

/** /leiste – the editor on its own page (Mehr › Deine Leiste, long press on the bar) */
export function NavBarPage({ me }: { me: Me }) {
  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Settings')}</div>
          <h1>{t('Your bar')}</h1>
        </div>
      </header>
      <NavBarCard me={me} />
    </div>
  );
}

/**
 * Long press on the bar (phone) or right click on the sidebar's areas (desktop) opens the editor – like holding an
 * app icon. Returns handlers for the <nav>; the tap that ends a long press doesn't also open the tab.
 */
export function useBarLongPress(open: () => void) {
  return useMemo(() => {
    let timer: number | null = null;
    let fired = false;
    let x = 0;
    let y = 0;
    const cancel = () => {
      if (timer) window.clearTimeout(timer);
      timer = null;
    };
    return {
      onPointerDown: (e: PointerEvent) => {
        if (e.pointerType === 'mouse') return;
        fired = false;
        x = e.clientX;
        y = e.clientY;
        cancel();
        timer = window.setTimeout(() => {
          fired = true;
          navigator.vibrate?.(10);
          open();
        }, 600);
      },
      onPointerMove: (e: PointerEvent) => {
        if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onClickCapture: (e: MouseEvent) => {
        if (fired) {
          e.preventDefault();
          e.stopPropagation();
          fired = false;
        }
      },
      onContextMenu: (e: MouseEvent) => {
        e.preventDefault();
        cancel();
        open();
      },
    };
  }, [open]);
}
