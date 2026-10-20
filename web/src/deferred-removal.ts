/**
 * Delete with "Undo" instead of a confirmation (Till, 20.10.2026: delete a purchase or receipt right in the list).
 * The row disappears at once, the toast offers "Undo" for as long as it is shown; only then the server hears about it
 * (the existing delete/discard endpoints, bookings are taken back as before). Leaving the page does it right away.
 * Same behaviour as the iPhone (ios/ToHuus/Design/SwipeToDelete.swift › PendingRemovals).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Me } from './App';
import { t } from './i18n';
import { kidLock } from './kidlock';
import { useToast } from './ui';

/** a little longer than a toast with an action stays (ui.tsx: 5500 ms) */
export const UNDO_MS = 5600;

/** guests, children and kid tablets only look – no delete buttons in the lists */
export function canRemove(me: Me | undefined): boolean {
  if (!me) return false;
  const a = me.actor;
  return a.kind === 'user' && !a.houseGuest && !['child', 'kid', 'guest'].includes(a.role) && !kidLock();
}

export function useDeferredRemoval() {
  const toast = useToast();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const pending = useRef(new Map<string, { timer: number; run: () => Promise<void> }>());
  const show = useCallback((key: string) => setHidden((h) => {
    const n = new Set(h);
    n.delete(key);
    return n;
  }), []);

  // the page goes away: everything still waiting is done now
  useEffect(() => {
    const map = pending.current;
    return () => {
      for (const p of map.values()) {
        clearTimeout(p.timer);
        void p.run();
      }
      map.clear();
    };
  }, []);

  const remove = useCallback(
    (key: string, text: string, commit: () => Promise<unknown>) => {
      if (pending.current.has(key)) return;
      setHidden((h) => new Set(h).add(key));
      const run = async () => {
        pending.current.delete(key);
        try {
          await commit();
        } catch (e) {
          show(key);
          toast({ text: (e as Error).message, error: true });
        }
      };
      pending.current.set(key, { timer: window.setTimeout(run, UNDO_MS), run });
      toast({
        text,
        action: {
          label: t('Undo'),
          run: () => {
            const p = pending.current.get(key);
            if (p) clearTimeout(p.timer);
            pending.current.delete(key);
            show(key);
          },
        },
      });
    },
    [show, toast],
  );

  return { isHidden: (key: string) => hidden.has(key), remove };
}
