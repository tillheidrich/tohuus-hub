/**
 * Profile pictures (area: people): a photo, an illustrated animal or colour + initials.
 * db-only so the sign-in screen (routes/auth.ts) can use it without loading the rest of the app.
 */
import { db } from '../db.js';
import './people-policy.js';

/** Same keys as kid mode's animals (server/lib/kids.ts AVATARS – a test keeps them in sync). */
export const ANIMALS: readonly string[] = ['fox', 'bear', 'rabbit', 'cat', 'owl', 'frog', 'mouse', 'hedgehog'];

export type Face = { type: 'initials' } | { type: 'animal'; animal: string } | { type: 'photo'; image: string };

export function parseFace(json: string | null | undefined, fallback: Face = { type: 'initials' }): Face {
  if (!json) return fallback;
  try {
    const f = JSON.parse(json);
    if (f?.type === 'photo' && typeof f.image === 'string' && f.image.startsWith('/img/')) return { type: 'photo', image: f.image };
    if (f?.type === 'animal' && ANIMALS.includes(f.animal)) return { type: 'animal', animal: f.animal };
    if (f?.type === 'initials') return { type: 'initials' };
  } catch {
    /* fall through */
  }
  return fallback;
}

/** The sign-in screen: pictures for the names it shows. */
export function loginFaces(): Map<string, Face> {
  return new Map((db.prepare('SELECT name, avatar FROM users').all() as { name: string; avatar: string | null }[]).map((u) => [u.name, parseFace(u.avatar)]));
}
