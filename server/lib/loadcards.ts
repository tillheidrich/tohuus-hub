/**
 * Denkarbeit-Check (14 Oct 2026, docs/mental-load.md): a deck of cards for the invisible part of running a home –
 * noticing, planning, remembering. Each member answers privately per card: "mostly me", "we share it",
 * "mostly someone else" or "not our thing". Each card says how ToHuus can take that thing off someone's head.
 *
 * - Everyone always sees their own answers and summary.
 * - The household view (who said what per card, cards where everyone thinks someone else does it, cards two people
 *   both carry) appears only when every member switched on "compare" (the same opt-in as "Wer hat was im Blick").
 * - Names alphabetical, no scores, no ranking. Guests and guest links never see it.
 * Own wording – not taken from any other product.
 */
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { compareOptIn } from './blick.js';
import { emit } from './bus.js';
import { createCareTask, updateCareTask } from './care.js';

migrate(
  'loadcards-1',
  `CREATE TABLE load_answers (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     card_key TEXT NOT NULL,
     answer TEXT NOT NULL CHECK (answer IN ('me','shared','other','na')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     PRIMARY KEY (user_id, card_key)
   );`,
);

export const LOAD_ANSWERS = ['me', 'shared', 'other', 'na'] as const;
export type LoadAnswer = (typeof LOAD_ANSWERS)[number];
export const LOAD_AREAS = ['shop', 'cook', 'money', 'home', 'dates', 'kids', 'people'] as const;
export type LoadArea = (typeof LOAD_AREAS)[number];

interface Card {
  key: string;
  area: LoadArea;
  /** English source text; translated at request time */
  text: string;
  /** what ToHuus does about it, and where */
  help?: { text: string; path: string };
}

/** The deck. Keys are stable (answers are stored by key). */
export const DECK: Card[] = [
  { key: 'stock_low', area: 'shop', text: 'Noticing when something is running out', help: { text: 'ToHuus remembers what is at home and puts what runs out on the list.', path: '/bestand' } },
  { key: 'list_write', area: 'shop', text: 'Writing the shopping list', help: { text: 'Everyone adds to the same list – by voice, photo or one tap on the usuals.', path: '/einkauf' } },
  { key: 'toiletries', area: 'shop', text: 'Keeping an eye on toiletries and cleaning supplies', help: { text: 'The pantry counts the bathroom and the cleaning cupboard too.', path: '/bestand' } },
  { key: 'weekly_shop', area: 'shop', text: 'Planning the big weekly shop', help: { text: 'The list sorts itself by aisle and suggests what you usually buy.', path: '/einkauf' } },
  { key: 'who_likes', area: 'shop', text: 'Knowing who likes what', help: { text: 'Favourites and wishes are saved per person.', path: '/kochen' } },
  { key: 'dinner', area: 'cook', text: 'Deciding what is for dinner', help: { text: 'The week plan suggests dishes from what is already at home.', path: '/kochen' } },
  { key: 'use_up', area: 'cook', text: 'Remembering what has to be used up', help: { text: '“Eat me first” shows what has to go soon.', path: '/bestand' } },
  { key: 'diets', area: 'cook', text: 'Keeping allergies and diets in mind', help: { text: 'Recipes and suggestions respect what the household set.', path: '/kochen' } },
  { key: 'lunchbox', area: 'cook', text: 'Thinking of lunchboxes', help: { text: 'The lunchbox list fills itself once a week.', path: '/einkauf' } },
  { key: 'visitors_food', area: 'cook', text: 'Planning food for visitors and parties', help: { text: 'Party planning and “Bring mir was” collect what guests would like.', path: '/kochen' } },
  { key: 'budget', area: 'money', text: 'Keeping an eye on the food budget', help: { text: 'Receipts become an overview by themselves – no typing.', path: '/geld' } },
  { key: 'receipts', area: 'money', text: 'Collecting receipts and bills', help: { text: 'Photograph a receipt or forward the e-receipt – ToHuus reads it.', path: '/geld' } },
  { key: 'contracts', area: 'money', text: 'Keeping track of contracts and subscriptions', help: { text: 'Deadlines are tasks with a reminder – in Apple Reminders too.', path: '/aufgaben' } },
  { key: 'split_costs', area: 'money', text: 'Settling shared costs', help: { text: 'Money shows who paid what for the household.', path: '/geld' } },
  { key: 'cleaning_due', area: 'home', text: 'Knowing which cleaning is due', help: { text: 'Tasks repeat by themselves and say when they are due.', path: '/aufgaben' } },
  { key: 'bed_linen', area: 'home', text: 'Remembering fresh bed linen', help: { text: 'A task with its own rhythm – ToHuus learns how often you really do it.', path: '/aufgaben' } },
  { key: 'repairs', area: 'home', text: 'Noticing what needs repairing', help: { text: 'Note it once as a task, and someone can say “I keep it in mind”.', path: '/aufgaben' } },
  { key: 'maintenance', area: 'home', text: 'Water filter, smoke alarms, descaling', help: { text: 'Care tasks come with sensible intervals and a reminder.', path: '/aufgaben' } },
  { key: 'where_things', area: 'home', text: 'Knowing where things are', help: { text: '“Where is what?” finds things by place – for everyone, not only the one who put them away.', path: '/wo' } },
  { key: 'laundry', area: 'home', text: 'Keeping the laundry going', help: { text: 'Split it into small steps, with a timer if that helps.', path: '/aufgaben' } },
  { key: 'plants_pets', area: 'home', text: 'Looking after plants and pets', help: { text: 'Recurring tasks, taking turns if you like.', path: '/aufgaben' } },
  { key: 'doctor', area: 'dates', text: 'Making doctor’s appointments', help: { text: 'A task with a time goes into your own calendar.', path: '/aufgaben' } },
  { key: 'papers', area: 'dates', text: 'Passports, insurance and deadlines', help: { text: 'Fixed dates with an early reminder, private if you want.', path: '/aufgaben' } },
  { key: 'birthdays', area: 'dates', text: 'Remembering birthdays and presents', help: { text: 'Wish lists with hidden reservations – the surprise stays a surprise.', path: '/einkauf/wuensche' } },
  { key: 'trips', area: 'dates', text: 'Preparing trips and handing over the home', help: { text: 'Away mode with a handover for whoever looks after the home.', path: '/urlaub' } },
  { key: 'school', area: 'kids', text: 'School letters, forms and lists', help: { text: 'Note them as tasks with a date – the household sees what is due.', path: '/aufgaben' } },
  { key: 'clothes_size', area: 'kids', text: 'Noticing when clothes or shoes are too small', help: { text: 'A task “when needed” or a wish on the list.', path: '/aufgaben' } },
  { key: 'activities', area: 'kids', text: 'Organising activities and playdates' },
  { key: 'sitters', area: 'kids', text: 'Briefing babysitters and grandparents', help: { text: 'House info with a guest link: Wi-Fi, bedtimes, emergency numbers.', path: '/hausinfo' } },
  { key: 'guests_info', area: 'people', text: 'Explaining the Wi-Fi and how things work to guests', help: { text: 'House info – from the guest Wi-Fi to the coffee machine.', path: '/hausinfo' } },
  { key: 'family_contact', area: 'people', text: 'Keeping in touch with family' },
  { key: 'how_everyone', area: 'people', text: 'Noticing how everyone is doing' },
  { key: 'week_ahead', area: 'people', text: 'Thinking about the week ahead', help: { text: 'Today shows what is planned, due and missing – for everyone.', path: '/' } },
];

const AREA_TITLE: Record<LoadArea, string> = {
  shop: 'Shopping',
  cook: 'Cooking',
  money: 'Money',
  home: 'Home',
  dates: 'Dates & deadlines',
  kids: 'Children',
  people: 'People',
};

function members() {
  return db.prepare(`SELECT id, name FROM users WHERE COALESCE(kind, 'member') != 'guest' ORDER BY name COLLATE NOCASE`).all() as { id: number; name: string }[];
}

function answersOf(userId: number): Map<string, LoadAnswer> {
  const rows = db.prepare('SELECT card_key, answer FROM load_answers WHERE user_id = ?').all(userId) as { card_key: string; answer: LoadAnswer }[];
  return new Map(rows.map((r) => [r.card_key, r.answer]));
}

export function setLoadAnswer(userId: number, key: string, answer: LoadAnswer | null) {
  if (!DECK.some((c) => c.key === key)) throw Object.assign(new Error(t('Card not found')), { status: 404 });
  if (answer == null) db.prepare('DELETE FROM load_answers WHERE user_id = ? AND card_key = ?').run(userId, key);
  else
    db.prepare(
      `INSERT INTO load_answers (user_id, card_key, answer, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, card_key) DO UPDATE SET answer = excluded.answer, updated_at = excluded.updated_at`,
    ).run(userId, key, answer);
  emit('care');
}

/** The deck with my answers; the household view only when everyone agreed to compare. */
export function loadCards(viewer: number) {
  const mine = answersOf(viewer);
  const people = members();
  const compare = people.length >= 2 && people.every((p) => compareOptIn(p.id));
  const all = compare ? new Map(people.map((p) => [p.id, answersOf(p.id)])) : null;
  const cards = DECK.map((c) => {
    const who = all
      ? Object.fromEntries(LOAD_ANSWERS.map((a) => [a, people.filter((p) => all.get(p.id)?.get(c.key) === a).map((p) => p.name)]))
      : null;
    const answered = who ? LOAD_ANSWERS.reduce((n, a) => n + who[a].length, 0) : 0;
    return {
      key: c.key,
      area: c.area,
      text: t(c.text),
      help: c.help ? { text: t(c.help.text), path: c.help.path } : null,
      mine: mine.get(c.key) ?? null,
      // household view: who answered what (names alphabetical) and two gentle hints
      household: who
        ? {
            who,
            // everyone who answered thinks someone else does it
            nobody: answered >= 2 && who.other.length === answered,
            // two or more say "mostly me" – worth talking about
            both: who.me.length >= 2,
          }
        : null,
    };
  });
  const count = (a: LoadAnswer) => cards.filter((c) => c.mine === a).length;
  return {
    areas: LOAD_AREAS.map((a) => ({ key: a, title: t(AREA_TITLE[a]) })),
    cards,
    summary: { total: cards.length, answered: mine.size, me: count('me'), shared: count('shared'), other: count('other'), na: count('na') },
    compare,
    me_compare: compareOptIn(viewer),
    members: people.length,
  };
}

/** "Daraus eine Aufgabe machen": a household task "when needed" that I keep in mind. */
export function taskFromCard(viewer: number, key: string) {
  const c = DECK.find((x) => x.key === key);
  if (!c) throw Object.assign(new Error(t('Card not found')), { status: 404 });
  const task = createCareTask({ name: t(c.text), category: 'house', as_needed: true } as never, viewer) as { id: number };
  updateCareTask(task.id, { assignee_user_id: viewer } as never);
  return { id: task.id };
}
