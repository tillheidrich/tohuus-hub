/**
 * Which screen the assistant is opened from (server/lib/assistant-areas.ts `context`) and what it can help with
 * there. Tiny on purpose – part of the shell.
 */
export type ScreenContext = 'shopping' | 'stock' | 'cook' | 'money' | 'house' | 'guests' | 'tasks' | 'wishes' | 'knowledge';

/** a path or one of its sub-pages ("/wo" is not "/woche") */
const under = (path: string, ...roots: string[]) => roots.some((r) => path === r || path.startsWith(`${r}/`));

export function screenContext(path: string): ScreenContext | null {
  // "Für wen ich da bin" holds health information: deliberately no screen context
  if (under(path, '/fuer-wen')) return null;
  if (under(path, '/einkauf/wuensche')) return 'wishes';
  if (under(path, '/einkauf')) return 'shopping';
  if (under(path, '/bestand', '/abgleich', '/wo')) return 'stock';
  if (under(path, '/kochen', '/rezepte')) return 'cook';
  if (under(path, '/geld', '/ausgaben')) return 'money';
  if (under(path, '/hausinfo')) return 'house';
  if (under(path, '/wissen', '/merkt-sich')) return 'knowledge';
  if (under(path, '/bar', '/bestellen')) return 'guests';
  // Heute, Aufgaben and what belongs to them: Im Kopf, Rückblick, Wochenrückblick, Urlaub, Fokus, Denkarbeit
  if (path === '/' || under(path, '/aufgaben', '/pflege', '/kopf', '/rueckblick', '/woche', '/urlaub', '/fokus', '/denkarbeit')) return 'tasks';
  return null;
}
