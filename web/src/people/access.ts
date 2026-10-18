/** Guest access rules for app paths – tiny on purpose, it is part of the first load (shell + Heute). */
export type EffectiveLevel = 'order' | 'stock' | 'recipes' | 'family' | 'paused';

/** Which app paths a permanent guest may open (mirrors server/lib/people-policy.ts). */
export function guestAllows(level: EffectiveLevel | undefined, path: string) {
  if (!level) return true;
  if (level === 'paused') return false;
  // wish lists are never for guests (server: people-policy NEVER "wishes")
  if (path === '/einkauf/wuensche' || path.startsWith('/einkauf/wuensche/')) return false;
  const ORDER = ['/bestellen', '/einkauf', '/einstellungen', '/hilfe', '/hausinfo', '/uebergabe', '/so-funktioniert-tohuus', '/gut-zu-wissen', '/wissen'];
  const STOCK = ['/', '/bestand', '/wo', '/abgleich', '/scan', '/q/'];
  const RECIPES = ['/kochen', '/rezepte', '/lieblinge'];
  const FAMILY_DENY = ['/import', '/ausgaben', '/geld', '/merkt-sich', '/pflege', '/aufgaben', '/etiketten', '/willkommen', '/urlaub'];
  const starts = (list: string[]) => list.some((p) => (p === '/' ? path === '/' : p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)));
  if (level === 'family') return !starts(FAMILY_DENY);
  if (starts(ORDER)) return true;
  if ((level === 'stock' || level === 'recipes') && starts(STOCK)) return true;
  if (level === 'recipes' && starts(RECIPES)) return true;
  return false;
}

