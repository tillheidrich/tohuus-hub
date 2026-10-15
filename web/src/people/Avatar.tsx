/**
 * One <Avatar> for every person in the app (area: people).
 * Lists mostly only know a name and a colour – the avatar looks the name up in the household directory
 * and shows the person's photo, animal or initials. Pass `face` when the caller already knows it
 * (sign-in screen, people settings).
 */
import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../api';
// animal faces are drawings from kid mode – loaded only when someone actually has one (keeps the first load small)
const KidAnimal = lazy(() => import('../pages/KidArt').then((m) => ({ default: m.KidAnimal })));

export type Face = { type: 'initials' } | { type: 'animal'; animal: string } | { type: 'photo'; image: string };
export interface DirEntry {
  key: string;
  name: string;
  color: string;
  kind: 'member' | 'guest' | 'child';
  face: Face;
}

/** The directory is only fetched inside the signed-in app (public pages have no session). */
let directoryOn = false;
export function enablePeopleDirectory() {
  directoryOn = true;
}

export function usePeopleDirectory() {
  // always the same queryFn for this key (a disabled observer must never leave the query without one)
  const q = useQuery<DirEntry[]>({ queryKey: ['people-dir'], queryFn: () => get<DirEntry[]>('/people/directory'), enabled: directoryOn, staleTime: 60_000 });
  return q.data ?? [];
}

/** Find a person by name (members first – a child could share a name with an adult). */
export function lookup(dir: DirEntry[], name: string, key?: string | null) {
  if (key) {
    const k = dir.find((d) => d.key === key);
    if (k) return k;
  }
  const n = name.trim().toLowerCase();
  return dir.find((d) => d.kind !== 'child' && d.name.toLowerCase() === n) ?? dir.find((d) => d.name.toLowerCase() === n);
}

export function Avatar({
  name,
  color,
  size = 30,
  face,
  personKey,
  className = '',
}: {
  name: string;
  color?: string;
  size?: number;
  face?: Face | null;
  /** 'u3' / 'k2' – exact match instead of the name */
  personKey?: string | null;
  className?: string;
}) {
  const dir = usePeopleDirectory();
  const [broken, setBroken] = useState(false);
  const hit = face ? null : lookup(dir, name ?? '', personKey);
  const f: Face = face ?? hit?.face ?? { type: 'initials' };
  const c = personColor(color ?? hit?.color ?? '#3d5a80');
  if (f.type === 'photo' && !broken)
    return (
      <span className={`avatar avatar-photo ${className}`} style={{ width: size, height: size, background: c }}>
        <img src={f.image} alt="" loading="lazy" onError={() => setBroken(true)} />
      </span>
    );
  if (f.type === 'animal')
    return (
      <span className={`avatar avatar-animal ${className}`} style={{ width: size, height: size }}>
        <Suspense fallback={null}>
          <KidAnimal name={f.animal} size={size} color={c} />
        </Suspense>
      </span>
    );
  const initials = (name ?? '?')
    .trim()
    .split(/\s+/)
    .slice(0, size >= 40 ? 2 : 1)
    .map((w) => w.slice(0, 1).toUpperCase())
    .join('');
  return (
    <span className={`avatar ${className}`} style={{ background: c, width: size, height: size, fontSize: size * (initials.length > 1 ? 0.36 : 0.42) }}>
      {initials || '?'}
    </span>
  );
}

/** the earlier, more saturated person colours → their calmer twins (stored values stay as they are) */
const CALMER: Record<string, string> = {
  '#2f5bea': '#3d5a80',
  '#d0603a': '#b5553a',
  '#1d9a63': '#2f7d5b',
  '#8e44ad': '#7a4f8f',
  '#c2185b': '#a83f62',
  '#b97c0c': '#94660f',
  '#f2a33a': '#8a6a2a',
  '#0f8a8a': '#2c7a7b',
  '#e0622a': '#b5553a',
  '#8a4fd8': '#7a4f8f',
  '#d43f6f': '#a83f62',
  '#0f8a9d': '#2c7a7b',
};
export const personColor = (c: string) => CALMER[c.toLowerCase()] ?? c;
