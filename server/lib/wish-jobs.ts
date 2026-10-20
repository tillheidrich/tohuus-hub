/**
 * Gift reminders (20 Oct 2026, docs/wishes.md › Erinnerungen), run once per household round by the scheduler
 * (scheduler.ts householdJobs), like the list2 jobs:
 *  - `wish.reminder`: a reminder someone set for a gift they reserved, or for a wish of their own they want to buy
 *    themselves – on its day, from 9 o'clock, once. Skipped when the wish was bought, released or archived meanwhile.
 *  - `wish.occasion`: one automatic hint per occasion and person, 7 days before a list's date, when the person
 *    reserved something there that is not bought yet ("Linas Geburtstag in 7 Tagen – 2 Geschenke noch nicht besorgt").
 * Both are personal notifications (notify-prefs.ts: each person switches them off themselves), always `personalOnly`
 * to the one person – never the household channels, never the owner of a surprise list (statusHidden is checked again
 * at send time), never the person the wishes are for.
 */
import { config } from '../config.js';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { notify } from './notify.js';
import { householdJobs } from './scheduler.js';
import { maySeeWishList, statusHidden, type WishListAccess } from './wish-policy.js';
import { daysBetween, dueReminders, localDay } from './wishes.js';

const OCCASION_DAYS = 7;

const localHour = (nowMs: number) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hour12: false }).format(new Date(nowMs))) % 24;

type ListRow = WishListAccess & { id: number; name: string; for_name: string | null; event_date: string | null; archived: number };

const listOf = (id: number) => db.prepare('SELECT * FROM wish_lists WHERE id = ?').get(id) as ListRow | undefined;
const userName = (id: number | null) => (id ? ((db.prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? null) : null);
const forNameOf = (l: ListRow) => (l.for_user_id ? (userName(l.for_user_id) ?? l.for_name) : l.for_name);

/** Due personal reminders → one notification each, to the person who set it. Returns how many went out. */
export async function wishReminderJob(nowMs = Date.now()) {
  if (localHour(nowMs) < 9) return 0;
  const today = localDay(nowMs);
  let sent = 0;
  for (const r of dueReminders(today)) {
    const l = listOf(r.list_id);
    const done = () => db.prepare(`UPDATE wish_reminders SET sent_at = datetime('now') WHERE id = ?`).run(r.id);
    // gone, archived, no longer visible, already bought: nothing to remind of
    if (!l || l.archived || r.archived || r.status === 'bought' || !maySeeWishList(l, r.user_id)) {
      done();
      continue;
    }
    const reservedByMe = r.status === 'reserved' && r.status_user_id === r.user_id && !statusHidden(l, r.user_id);
    // a list for nobody in particular is the owner's own: the gift is for them
    const forName = forNameOf(l) ?? userName(l.owner_id);
    const gift = reservedByMe && forName;
    done();
    await notify({
      event: 'wish.reminder',
      title: gift ? t('Get the gift for {name}', { name: forName }) : t('Your wish: {title}', { title: r.title }),
      message: gift ? `${r.title} · ${l.name}` : t('You wanted to be reminded today.'),
      path: reservedByMe ? '/einkauf/wuensche/schenken' : `/einkauf/wuensche/${l.id}`,
      toUserId: r.user_id,
      personalOnly: true,
      dedupeKey: `wish-rem:${r.id}:${r.remind_on}`,
      dedupeHours: 24 * 400,
      data: { wish_id: r.item_id },
    });
    sent++;
  }
  return sent;
}

/**
 * One hint per occasion and person a week before the date: what they reserved there and have not bought yet.
 * Returns the number of people told.
 */
export async function wishOccasionJob(nowMs = Date.now()) {
  if (localHour(nowMs) < 9) return 0;
  const today = localDay(nowMs);
  const lists = db.prepare(`SELECT * FROM wish_lists WHERE archived = 0 AND event_date IS NOT NULL AND event_date > ?`).all(today) as ListRow[];
  let told = 0;
  for (const l of lists) {
    const days = daysBetween(today, l.event_date!);
    if (days > OCCASION_DAYS || days < 1) continue;
    const rows = db
      .prepare(`SELECT status_user_id AS uid, COUNT(*) n FROM wish_items WHERE list_id = ? AND archived = 0 AND status = 'reserved' AND status_user_id IS NOT NULL GROUP BY status_user_id`)
      .all(l.id) as { uid: number; n: number }[];
    for (const { uid, n } of rows) {
      // the owner of a surprise list (or the person it is for) never hears about reservations
      if (!maySeeWishList(l, uid) || statusHidden(l, uid)) continue;
      const occasion = forNameOf(l) ? t('{list} for {name}', { list: l.name, name: forNameOf(l)! }) : l.name;
      const r = await notify({
        event: 'wish.occasion',
        title: days === 1 ? t('{occasion} is tomorrow', { occasion }) : t('{occasion} in {n} days', { occasion, n: days }),
        message: n === 1 ? t('1 gift not bought yet') : t('{n} gifts not bought yet', { n }),
        path: '/einkauf/wuensche/schenken',
        toUserId: uid,
        personalOnly: true,
        // at most one per occasion (list + date) and person
        dedupeKey: `wish-occ:${l.id}:${l.event_date}:${uid}`,
        dedupeHours: 24 * 400,
      });
      if (!r.skipped) told++;
    }
  }
  return told;
}

householdJobs.push({ name: 'wish.reminder', run: () => wishReminderJob() }, { name: 'wish.occasion', run: () => wishOccasionJob() });
