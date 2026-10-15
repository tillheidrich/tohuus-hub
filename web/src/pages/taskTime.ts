/** Termine (docs/tasks.md): how a task's time and length read – shared by Aufgaben and Heute */
import { t } from '../i18n';

/** "10:00" → "10:00 Uhr" */
export const timeLabel = (hhmm: string) => t('{time} o’clock', { time: hhmm });

export const durationLabel = (min: number) => (min < 60 ? t('{n} min', { n: min }) : min % 60 ? t('{h} h {m} min', { h: Math.floor(min / 60), m: min % 60 }) : t('{n} h', { n: min / 60 }));
