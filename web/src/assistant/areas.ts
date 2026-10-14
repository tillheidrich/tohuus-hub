/**
 * Which screen the assistant is opened from (server/lib/assistant-areas.ts `context`) and what it can help with
 * there. Tiny on purpose – part of the shell.
 */
export type ScreenContext = 'shopping' | 'stock' | 'cook' | 'money' | 'house' | 'guests' | 'tasks';

export function screenContext(path: string): ScreenContext | null {
  if (path.startsWith('/einkauf')) return 'shopping';
  if (path.startsWith('/bestand') || path.startsWith('/abgleich') || path.startsWith('/wo')) return 'stock';
  if (path.startsWith('/kochen') || path.startsWith('/rezepte')) return 'cook';
  if (path.startsWith('/geld') || path.startsWith('/ausgaben')) return 'money';
  if (path.startsWith('/hausinfo')) return 'house';
  if (path.startsWith('/bar') || path.startsWith('/bestellen')) return 'guests';
  if (path.startsWith('/aufgaben') || path.startsWith('/pflege')) return 'tasks';
  return null;
}
