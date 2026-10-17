/**
 * Heute › Demnächst (17 Oct 2026, docs/tasks.md): a calm look ahead at what is coming in the next day or two, so
 * nothing surprises the household – above all the bins, which go out the evening before the collection.
 *
 * Heute shows only what is due today or overdue. A Monday collection with "put it out the evening before" is due on
 * Sunday, so on Saturday it was nowhere to be seen. The outlook lists:
 *  - tasks due tomorrow (Friday and Saturday: the next two days, so the weekend and Monday morning are covered),
 *  - tasks whose own lead time (`lead_days`) has started, at most a week ahead,
 *  - bins by the evening they go out: "heute Abend rausstellen", "morgen Abend rausstellen".
 * From 17:00 a bin that goes out tonight is marked `now` (shown first, a little more visible – never red).
 *
 * Pure selection from the task views the viewer may see; no new data, no notifications.
 */
import { config } from '../config.js';
import { binKindOf, calsyncSettings, type BinOffset } from './calsync.js';
import { addInterval, daysBetween, type DueState } from './care.js';

/** the fields the outlook needs from a task view (lib/care.ts careView) */
export interface OutlookTask {
  id: number;
  name: string;
  template: string | null;
  next_due: string | null;
  lead_days: number;
  state: DueState;
  as_needed: boolean;
  ext_kind?: string | null;
  waits?: { until: string } | null;
}

export interface OutlookItem {
  id: number;
  /** tonight = goes out this evening (bins), tomorrow, later = the day after or within the task's lead time */
  when: 'tonight' | 'tomorrow' | 'later';
  /** the day something is to be done: the evening for a bin, else the due day */
  day: string;
  /** a bin: put out the evening before the collection */
  evening: boolean;
  /** bins: the collection day */
  pickup: string | null;
  /** from 17:00 on the evening it goes out */
  now: boolean;
}

/** from this hour the bins for tomorrow are "heute Abend" in earnest */
export const EVENING_HOUR = 17;
/** lead time never reaches further than this on Heute (care tasks have 7 days by default, passports 90) */
const LEAD_CAP = 7;

/** Is this a bin task? Calendar bins (ext_kind), the "Take out the bins" template, or a title like "Restmüll raus". */
export function isBinTask(x: Pick<OutlookTask, 'ext_kind' | 'template' | 'name'>) {
  return Boolean(x.ext_kind) || x.template === 'bins' || binKindOf(x.name) !== null || /\bm[üu]ll\b|tonne|abfuhr/i.test(x.name);
}

/**
 * How many days ahead plainly count as "coming up": 1, on Friday and Saturday 2 (Saturday sees Monday's
 * collection, which goes out on Sunday evening).
 */
export function horizonDays(today: string) {
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  return dow === 5 || dow === 6 ? 2 : 1;
}

export function taskOutlook(tasks: OutlookTask[], today: string, hour: number, offset: BinOffset = 'evening'): OutlookItem[] {
  const horizon = horizonDays(today);
  const out: OutlookItem[] = [];
  for (const x of tasks) {
    if (!x.next_due || x.as_needed || x.waits) continue;
    // already on Heute
    if (x.state === 'today' || x.state === 'overdue') continue;
    const bin = isBinTask(x);
    if (bin) {
      // calendar bins with "the evening before" already carry the evening as their date; everything else is the
      // collection day itself and goes out the evening before
      const onEvening = Boolean(x.ext_kind) && offset === 'evening';
      const evening = onEvening ? x.next_due : addInterval(x.next_due, -1, 'day');
      const pickup = onEvening ? addInterval(x.next_due, 1, 'day') : x.next_due;
      const d = daysBetween(today, evening);
      if (d < 0 || d > Math.max(horizon, Math.min(x.lead_days, LEAD_CAP))) continue;
      out.push({ id: x.id, when: d === 0 ? 'tonight' : d === 1 ? 'tomorrow' : 'later', day: evening, evening: true, pickup, now: d === 0 && hour >= EVENING_HOUR });
      continue;
    }
    const d = daysBetween(today, x.next_due);
    if (d < 1 || d > Math.max(horizon, Math.min(x.lead_days, LEAD_CAP))) continue;
    out.push({ id: x.id, when: d === 1 ? 'tomorrow' : 'later', day: x.next_due, evening: false, pickup: null, now: false });
  }
  const rank = { tonight: 0, tomorrow: 1, later: 2 } as const;
  const name = new Map(tasks.map((x) => [x.id, x.name]));
  return out.sort((a, b) => Number(b.now) - Number(a.now) || rank[a.when] - rank[b.when] || a.day.localeCompare(b.day) || (name.get(a.id) ?? '').localeCompare(name.get(b.id) ?? ''));
}

const hourFmts = new Map<string, Intl.DateTimeFormat>();
/** the hour of the day in the household's time zone (config.timezone, Europe/Berlin by default) */
export function localHour(now = new Date(), timeZone = config.timezone) {
  let f = hourFmts.get(timeZone);
  if (!f) hourFmts.set(timeZone, (f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })));
  return Number(f.format(now)) % 24;
}

/** For GET /api/care: the outlook of the tasks this viewer sees, with the household's bin setting. */
export function outlookFor(tasks: OutlookTask[], today: string, now = new Date()) {
  return taskOutlook(tasks, today, localHour(now), calsyncSettings().offset);
}
