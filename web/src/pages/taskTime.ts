/** Termine (docs/tasks.md): how a task's time and length read – shared by Aufgaben and Heute */
import { t } from '../i18n';

/** "10:00" → "10:00 Uhr" */
export const timeLabel = (hhmm: string) => t('{time} o’clock', { time: hhmm });

export const durationLabel = (min: number) => (min < 60 ? t('{n} min', { n: min }) : min % 60 ? t('{h} h {m} min', { h: Math.floor(min / 60), m: min % 60 }) : t('{n} h', { n: min / 60 }));

/** the device's own day, YYYY-MM-DD */
const localToday = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Over already: an appointment of today whose time (plus its length) has passed, or a day that is gone. Lists show it
 * dimmed – still there to tick off, but it no longer pulls at the eye (20 Oct 2026, docs/now.md).
 */
export function isPast(x: { next_due?: string | null; due_time?: string | null; duration_min?: number | null }, now = new Date()) {
  if (!x.next_due || !x.due_time) return false;
  const today = localToday(now);
  if (x.next_due < today) return true;
  if (x.next_due > today) return false;
  const [h, m] = x.due_time.split(':').map(Number);
  return h * 60 + m + (x.duration_min ?? 60) <= now.getHours() * 60 + now.getMinutes();
}
