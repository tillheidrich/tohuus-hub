/** Kid-tablet lock (area: kids) – kept out of Kids.tsx so the app shell can check it without loading kid mode. */
export const LOCK = 'sw.kidLock';
export function kidLock(): string | null {
  try {
    return localStorage.getItem(LOCK);
  } catch {
    return null;
  }
}
