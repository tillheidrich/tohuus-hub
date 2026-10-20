/**
 * Kochen, Startansicht (20.10.2026): has the week plan at least one entry for the running week (today and the next
 * six days, what „Woche“ shows), Kochen opens on „Woche“, otherwise on „Was kochen wir?“. A view the person picks
 * by hand stays for the rest of the session (web: sessionStorage, iPhone: in memory, `CookStart` in
 * CookingView.swift mirrors this function).
 */
export type CookView = 'ideas' | 'week' | 'recipes';

export const isCookView = (v: unknown): v is CookView => v === 'ideas' || v === 'week' || v === 'recipes';

/** `weekEntries` null = the plan is not loaded yet (no decision yet, the caller waits). */
export function cookStartView(o: { chosen?: string | null; weekEntries: number | null | undefined }): CookView | null {
  if (isCookView(o.chosen)) return o.chosen;
  if (o.weekEntries == null) return null;
  return o.weekEntries > 0 ? 'week' : 'ideas';
}

const KEY = 'tohuus.cook.view';

export function sessionCookView(): CookView | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return isCookView(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberCookView(v: CookView) {
  try {
    sessionStorage.setItem(KEY, v);
  } catch {
    /* private mode: the choice lasts as long as the page */
  }
}
