/**
 * Small drag & drop for lists and the week plan (list2, block H) – no library.
 *
 *  - Pointer events: a mouse drag starts after 6 px of movement, a finger after a long press (350 ms without moving).
 *  - The row lifts (a fixed copy follows the pointer), the source stays as a faint placeholder.
 *  - Drop targets are elements with `data-drop="<kind>:<key>"`; rows that can be dropped between carry
 *    `data-drop-row="<id>"` so the drop knows "before" / "after".
 *  - Auto-scroll near the top and bottom edge of the window, Escape cancels, reduced motion keeps it still.
 *  - Every drag has a menu alternative in the UI (same handlers), so nothing depends on dragging.
 */
import { type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, useEffect, useRef } from 'react';

export interface DropInfo {
  /** "section:produce", "list:3", "day:2026-10-14", "week:+1", "card:money" … */
  target: string;
  /** row under the pointer inside the target (data-drop-row), if any */
  row: string | null;
  /** pointer in the lower half of that row */
  after: boolean;
}

interface Session {
  id: string;
  payload: unknown;
  src: HTMLElement;
  ghost: HTMLElement | null;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  active: boolean;
  timer: number | null;
  over: HTMLElement | null;
  overRow: HTMLElement | null;
  pointerId: number;
  onDrop: (payload: unknown, drop: DropInfo) => void;
  onStart?: (payload: unknown) => void;
  onEnd?: () => void;
  onHover?: (target: string) => void;
  hoverSince: number;
  hoverTarget: string | null;
}

let s: Session | null = null;
let scrollRaf = 0;
let lastY = 0;

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function lift() {
  if (!s) return;
  s.active = true;
  const r = s.src.getBoundingClientRect();
  const g = s.src.cloneNode(true) as HTMLElement;
  g.classList.add('dnd-ghost');
  g.setAttribute('aria-hidden', 'true');
  Object.assign(g.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', zIndex: '200', pointerEvents: 'none' });
  document.body.appendChild(g);
  s.ghost = g;
  s.src.classList.add('dnd-src');
  document.documentElement.classList.add('dnd-dragging');
  navigator.vibrate?.(12);
  s.onStart?.(s.payload);
}

function findTarget(x: number, y: number) {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const target = el?.closest<HTMLElement>('[data-drop]') ?? null;
  const row = el?.closest<HTMLElement>('[data-drop-row]') ?? null;
  return { target, row: row && target?.contains(row) ? row : null };
}

function mark(target: HTMLElement | null, row: HTMLElement | null, y: number) {
  if (!s) return;
  if (s.over !== target) {
    s.over?.classList.remove('dnd-over');
    target?.classList.add('dnd-over');
    s.over = target;
  }
  if (s.overRow !== row) {
    s.overRow?.classList.remove('dnd-before', 'dnd-after');
    s.overRow = row;
  }
  if (row && row !== s.src) {
    const r = row.getBoundingClientRect();
    const after = y > r.top + r.height / 2;
    row.classList.toggle('dnd-after', after);
    row.classList.toggle('dnd-before', !after);
  }
  // hovering a target for a moment (e.g. "next week") lets the UI react
  const key = target?.dataset.drop ?? null;
  if (key !== s.hoverTarget) {
    s.hoverTarget = key;
    s.hoverSince = Date.now();
  } else if (key && s.onHover && Date.now() - s.hoverSince > 650) {
    s.hoverSince = Date.now() + 100_000;
    s.onHover(key);
  }
}

function autoscroll() {
  cancelAnimationFrame(scrollRaf);
  const step = () => {
    if (!s?.active) return;
    const edge = 70;
    const h = window.innerHeight;
    const v = lastY < edge ? -Math.ceil((edge - lastY) / 6) : lastY > h - edge - 70 ? Math.ceil((lastY - (h - edge - 70)) / 6) : 0;
    if (v) window.scrollBy(0, v);
    scrollRaf = requestAnimationFrame(step);
  };
  scrollRaf = requestAnimationFrame(step);
}

function onMove(e: PointerEvent) {
  if (!s || e.pointerId !== s.pointerId) return;
  s.dx = e.clientX - s.startX;
  s.dy = e.clientY - s.startY;
  lastY = e.clientY;
  if (!s.active) {
    const far = Math.hypot(s.dx, s.dy) > 8;
    if (e.pointerType === 'mouse' && Math.hypot(s.dx, s.dy) > 6) {
      lift();
      autoscroll();
    } else if (e.pointerType !== 'mouse' && far) {
      // the finger moved before the long press: that was a scroll
      end(false);
      return;
    }
    if (!s?.active) return;
  }
  e.preventDefault();
  if (s.ghost) s.ghost.style.transform = `translate(${s.dx}px, ${s.dy}px) ${reduced() ? '' : 'rotate(-1deg) scale(1.02)'}`;
  const { target, row } = findTarget(e.clientX, e.clientY);
  mark(target, row, e.clientY);
}

function onUp(e: PointerEvent) {
  if (!s || e.pointerId !== s.pointerId) return;
  end(s.active);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && s) end(false);
}

/** keep the page from scrolling under a finger that drags */
function onTouchMove(e: TouchEvent) {
  if (s?.active) e.preventDefault();
}

function end(drop: boolean) {
  const cur = s;
  if (!cur) return;
  s = null;
  if (cur.timer) window.clearTimeout(cur.timer);
  cancelAnimationFrame(scrollRaf);
  document.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerup', onUp);
  document.removeEventListener('pointercancel', onUp);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('touchmove', onTouchMove);
  cur.ghost?.remove();
  cur.src.classList.remove('dnd-src', 'dnd-pressing');
  cur.over?.classList.remove('dnd-over');
  cur.overRow?.classList.remove('dnd-before', 'dnd-after');
  document.documentElement.classList.remove('dnd-dragging');
  if (cur.active) {
    // a drag is not a click on the row underneath
    const stop = (ev: Event) => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 50);
  }
  cur.onEnd?.();
  if (drop && cur.active && cur.over?.dataset.drop) {
    const r = cur.overRow;
    const after = Boolean(r?.classList.contains('dnd-after') || (r && lastY > r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2));
    cur.onDrop(cur.payload, { target: cur.over.dataset.drop, row: r && r !== cur.src ? (r.dataset.dropRow ?? null) : null, after });
  }
}

export interface DragOptions {
  onDrop: (payload: unknown, drop: DropInfo) => void;
  onStart?: (payload: unknown) => void;
  onEnd?: () => void;
  /** pointer rested on a target for ~0.6 s (switch week, open a list) */
  onHover?: (target: string) => void;
  disabled?: boolean;
}

/**
 * `const drag = useDrag({ onDrop })` – then `<div {...drag(id, payload)}>`. The element should also carry
 * `data-drop-row={id}` when other rows can be dropped before / after it.
 */
export function useDrag(opts: DragOptions) {
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => () => end(false), []);
  return (id: string, payload: unknown) => ({
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (ref.current.disabled || s || e.button !== 0) return;
      // buttons and fields inside a row keep working
      if ((e.target as HTMLElement).closest('input, textarea, select, [data-no-drag]')) return;
      const src = e.currentTarget;
      s = {
        id,
        payload,
        src,
        ghost: null,
        startX: e.clientX,
        startY: e.clientY,
        dx: 0,
        dy: 0,
        active: false,
        timer: null,
        over: null,
        overRow: null,
        pointerId: e.pointerId,
        onDrop: (p, d) => ref.current.onDrop(p, d),
        onStart: (p) => ref.current.onStart?.(p),
        onEnd: () => ref.current.onEnd?.(),
        onHover: (k) => ref.current.onHover?.(k),
        hoverSince: 0,
        hoverTarget: null,
      };
      lastY = e.clientY;
      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
      document.addEventListener('keydown', onKey);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      if (e.pointerType !== 'mouse') {
        src.classList.add('dnd-pressing');
        s.timer = window.setTimeout(() => {
          if (!s || s.src !== src) return;
          lift();
          autoscroll();
        }, 350);
      }
    },
    onContextMenu: (e: RMouseEvent) => {
      // long press on iOS/Android would open the context menu
      if (s) e.preventDefault();
    },
  });
}

/** For tests and the menu alternative: same shape as a drop. */
export const dropInfo = (target: string, row: string | null = null, after = false): DropInfo => ({ target, row, after });
