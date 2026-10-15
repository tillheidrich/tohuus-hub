/**
 * Für wen ich da bin (15 Oct 2026, docs/carefor.md): looking after a relative – at home, in their own flat, in a care
 * home; visits, doctor appointments, prescriptions, paperwork. In Germany most people in need of care are looked after
 * at home, largely by relatives – work that rarely shows anywhere. Here it gets room, and it gets seen:
 *
 * - a person I look after (name, how we're related, where they live), private or for the household;
 * - their tasks (care tasks linked to them – visits, appointments, prescriptions) and "Heute da gewesen" in one tap;
 * - the weekly review says "3 Mal für Oma Inge da gewesen – das ist Arbeit, und sie zählt." (only to the person);
 * - help that's due to them (Pflegestützpunkt, Entlastungsbetrag …) in plain words, with sources (docs/carefor.md).
 *
 * Health data (Art. 9 GDPR): never to the assistant, MCP, Home Assistant, notifications beyond the task reminder,
 * widgets or exports. Tasks created here are private when the person is private.
 */
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { localDay } from './catalog.js';
import { canSeeTask, createCareTask, listCareTasks } from './care.js';
import { getUserPref, setUserPref } from './onboard.js';
import { householdForm } from './places.js';

migrate(
  'carefor-1',
  `CREATE TABLE cared_for (
     id INTEGER PRIMARY KEY,
     owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     relation TEXT,
     place TEXT NOT NULL DEFAULT 'own' CHECK (place IN ('home','own','care_home','other')),
     visibility TEXT NOT NULL DEFAULT 'household' CHECK (visibility IN ('private','household')),
     archived INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE cared_for_log (
     id INTEGER PRIMARY KEY,
     cared_for_id INTEGER NOT NULL REFERENCES cared_for(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     day TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'visit' CHECK (kind IN ('visit','call','appointment','errand','other')),
     note TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX cared_for_log_day ON cared_for_log(cared_for_id, day);
   ALTER TABLE care_tasks ADD COLUMN cared_for_id INTEGER REFERENCES cared_for(id) ON DELETE SET NULL;`,
);

export class CareForError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type Place = 'home' | 'own' | 'care_home' | 'other';
export type LogKind = 'visit' | 'call' | 'appointment' | 'errand' | 'other';
interface Row {
  id: number;
  owner_user_id: number;
  name: string;
  relation: string | null;
  place: Place;
  visibility: 'private' | 'household';
  archived: number;
  created_at: string;
}

export const canSeeCareFor = (r: Pick<Row, 'owner_user_id' | 'visibility'>, viewer: number) => r.owner_user_id === viewer || r.visibility === 'household';

function get(id: number, viewer: number) {
  const r = db.prepare('SELECT * FROM cared_for WHERE id = ?').get(id) as Row | undefined;
  if (!r || !canSeeCareFor(r, viewer)) throw new CareForError(t('Not found'), 404);
  return r;
}

/** Task ids linked to someone I look after – kept out of the assistant and MCP (health data). */
export function careForTaskIds(): Set<number> {
  try {
    return new Set((db.prepare('SELECT id FROM care_tasks WHERE cared_for_id IS NOT NULL').all() as { id: number }[]).map((r) => r.id));
  } catch {
    return new Set();
  }
}

export function careForList(viewer: number) {
  const rows = (db.prepare('SELECT * FROM cared_for WHERE archived = 0 ORDER BY name COLLATE NOCASE').all() as Row[]).filter((r) => canSeeCareFor(r, viewer));
  const users = new Map((db.prepare('SELECT id, name FROM users').all() as { id: number; name: string }[]).map((u) => [u.id, u.name]));
  const tasks = listCareTasks({ viewer }).filter((x) => canSeeTask(x, viewer));
  const linked = new Map((db.prepare('SELECT id, cared_for_id FROM care_tasks WHERE cared_for_id IS NOT NULL').all() as { id: number; cared_for_id: number }[]).map((r) => [r.id, r.cared_for_id]));
  const weekAgo = localDay(-6);
  return {
    people: rows.map((r) => {
      const log = db.prepare('SELECT id, user_id, day, kind, note FROM cared_for_log WHERE cared_for_id = ? ORDER BY day DESC, id DESC LIMIT 12').all(r.id) as {
        id: number;
        user_id: number;
        day: string;
        kind: LogKind;
        note: string | null;
      }[];
      return {
        id: r.id,
        name: r.name,
        relation: r.relation,
        place: r.place,
        visibility: r.visibility,
        mine: r.owner_user_id === viewer,
        owner: users.get(r.owner_user_id) ?? null,
        tasks: tasks.filter((x) => linked.get(x.id) === r.id),
        recent: log.map((l) => ({ ...l, by: users.get(l.user_id) ?? null, mine: l.user_id === viewer })),
        this_week: log.filter((l) => l.day >= weekAgo).length,
      };
    }),
    help: helpLinks(),
  };
}

const cleanName = (s: unknown) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!v) throw new CareForError(t('Please enter a name.'));
  return v;
};
const PLACES: Place[] = ['home', 'own', 'care_home', 'other'];

export function addCareFor(viewer: number, input: { name?: string; relation?: string | null; place?: Place; visibility?: 'private' | 'household' }) {
  const info = db
    .prepare('INSERT INTO cared_for (owner_user_id, name, relation, place, visibility) VALUES (?, ?, ?, ?, ?)')
    // private by default (health data, docs/research/2026-10-15-care-single-parents.md) – sharing is one tap
    .run(viewer, cleanName(input.name), input.relation?.trim().slice(0, 40) || null, PLACES.includes(input.place as Place) ? input.place : 'own', input.visibility === 'household' ? 'household' : 'private');
  setUserPref(viewer, 'carefor.hint', 'done');
  emit('care');
  return { id: Number(info.lastInsertRowid) };
}

/** Only the person who added them changes or removes them; switching private ↔ household goes for their tasks too. */
export function updateCareFor(viewer: number, id: number, input: { name?: string; relation?: string | null; place?: Place; visibility?: 'private' | 'household'; archived?: boolean }) {
  const r = get(id, viewer);
  if (r.owner_user_id !== viewer) throw new CareForError(t('Only the person who added them can change this.'), 403);
  const vis = input.visibility ?? r.visibility;
  db.prepare('UPDATE cared_for SET name = ?, relation = ?, place = ?, visibility = ?, archived = ? WHERE id = ?').run(
    input.name !== undefined ? cleanName(input.name) : r.name,
    input.relation !== undefined ? input.relation?.trim().slice(0, 40) || null : r.relation,
    input.place && PLACES.includes(input.place) ? input.place : r.place,
    vis,
    input.archived !== undefined ? (input.archived ? 1 : 0) : r.archived,
    id,
  );
  if (vis !== r.visibility)
    db.prepare(`UPDATE care_tasks SET visibility = ?, owner_user_id = CASE WHEN ? = 'private' THEN ? ELSE owner_user_id END WHERE cared_for_id = ?`).run(vis, vis, viewer, id);
  emit('care');
  return { ok: true };
}

export function deleteCareFor(viewer: number, id: number) {
  const r = get(id, viewer);
  if (r.owner_user_id !== viewer) throw new CareForError(t('Not found'), 404);
  db.prepare('DELETE FROM cared_for WHERE id = ?').run(id);
  emit('care');
  return { ok: true };
}

/** "Heute da gewesen" (or called, an appointment, an errand) – one tap, a note if you like. */
export function logCareFor(viewer: number, id: number, input: { kind?: LogKind; note?: string | null; day?: string | null }) {
  get(id, viewer);
  const day = input.day && /^\d{4}-\d\d-\d\d$/.test(input.day) && input.day <= localDay(0) ? input.day : localDay(0);
  const kind: LogKind = ['visit', 'call', 'appointment', 'errand', 'other'].includes(input.kind as string) ? (input.kind as LogKind) : 'visit';
  db.prepare('INSERT INTO cared_for_log (cared_for_id, user_id, day, kind, note) VALUES (?, ?, ?, ?, ?)').run(id, viewer, day, kind, input.note?.trim().slice(0, 200) || null);
  emit('care');
  return { ok: true, message: t('Seen. That’s work – and it counts.') };
}

export function deleteCareForLog(viewer: number, logId: number) {
  const r = db.prepare('SELECT user_id FROM cared_for_log WHERE id = ?').get(logId) as { user_id: number } | undefined;
  if (!r || r.user_id !== viewer) throw new CareForError(t('Not found'), 404);
  db.prepare('DELETE FROM cared_for_log WHERE id = ?').run(logId);
  emit('care');
  return { ok: true };
}

/** A task for them (a visit every Sunday, the GP appointment, picking up the prescription) – private if they are. */
export function addCareForTask(viewer: number, id: number, input: { name?: string; interval_n?: number | null; interval_unit?: 'day' | 'week' | 'month' | 'year' | null; next_due?: string | null; due_time?: string | null }) {
  const r = get(id, viewer);
  const task = createCareTask(
    {
      name: cleanName(input.name),
      category: 'care',
      visibility: r.visibility === 'private' ? 'private' : 'household',
      interval_n: input.interval_n ?? null,
      interval_unit: input.interval_unit ?? null,
      next_due: input.next_due ?? null,
      due_time: input.due_time ?? null,
    } as Parameters<typeof createCareTask>[0],
    viewer,
  ) as { id: number };
  db.prepare('UPDATE care_tasks SET cared_for_id = ? WHERE id = ?').run(id, task.id);
  emit('care');
  return task;
}

// ------------------------------------------------------------------ recognise it, gently

const CARE_WORDS = /\b(oma|opa|mama|papa|mutter|vater|schwieger\w*|pflege\w*|heim|altenheim|tagespflege|pflegedienst|pflegegrad|reha|hausarzt|rezept|grandma|grandpa|care home|nursing home)\b/i;

/**
 * Should Aufgaben/Heute ask "Kümmerst du dich um jemanden?" – once, dismissible. Yes when the household form says so
 * (carer) or the person's own tasks/thoughts mention it (Oma, Pflegeheim, Rezept …). Nothing is created by itself.
 */
export function careForHint(viewer: number) {
  if (getUserPref<string>(viewer, 'carefor.hint', '') !== '') return { show: false };
  const has = db.prepare('SELECT 1 FROM cared_for WHERE owner_user_id = ? LIMIT 1').get(viewer);
  if (has) return { show: false };
  if (householdForm() === 'carer') return { show: true, why: 'form' as const };
  const texts = [
    // the viewer's own household tasks – not the ones already linked to someone a member looks after
    ...listCareTasks({ viewer, outside: true })
      .filter((x) => canSeeTask(x, viewer))
      .map((x) => x.name),
    ...((): string[] => {
      try {
        return (db.prepare('SELECT text FROM mind_items WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(viewer) as { text: string }[]).map((r) => r.text);
      } catch {
        return [];
      }
    })(),
  ];
  return texts.some((x) => CARE_WORDS.test(x)) ? { show: true, why: 'words' as const } : { show: false };
}

export function dismissCareForHint(viewer: number) {
  setUserPref(viewer, 'carefor.hint', 'dismissed');
  return { ok: true };
}

/** Weekly review (only for the person): how often they were there for someone – visits, calls, their tasks. */
export function careForWeek(viewer: number, from: string, to: string) {
  const logs = db
    .prepare(`SELECT c.name FROM cared_for_log l JOIN cared_for c ON c.id = l.cared_for_id WHERE l.user_id = ? AND l.day BETWEEN ? AND ?`)
    .all(viewer, from, to) as { name: string }[];
  const tasks = db
    .prepare(`SELECT c.name FROM care_log g JOIN care_tasks k ON k.id = g.task_id JOIN cared_for c ON c.id = k.cared_for_id WHERE g.actor_user_id = ? AND g.done_on BETWEEN ? AND ?`)
    .all(viewer, from, to) as { name: string }[];
  const all = [...logs, ...tasks];
  return { count: all.length, names: [...new Set(all.map((x) => x.name))] };
}

/**
 * Help that's due to people who look after someone (Germany) – where to ask, never advice and never amounts in the code:
 * the care reform (PNOG, cabinet 30 Sep 2026) will change them. Sources: docs/research/2026-10-15-care-single-parents.md.
 */
export function helpLinks() {
  return [
    { key: 'telefon', title: t('Pflegetelefon of the federal ministry: 030 20179131 (Mon–Thu 9–18, free advice, also in a crisis)'), url: 'https://www.bmbfsfj.bund.de/bmbfsfj/themen/aeltere-menschen/hilfe-und-pflege/servicetelefon-pflege-und-informationsportal-wege-zur-pflege' },
    { key: 'entlastung', title: t('Relief you are entitled to: Entlastungsbetrag – most people never claim it'), url: 'https://www.bundesgesundheitsministerium.de/service/begriffe-von-a-z/e/entlastungsbetrag.html' },
    { key: 'verhinderung', title: t('A break for you: respite and short-term care'), url: 'https://www.bundesgesundheitsministerium.de/verhinderungspflege' },
    { key: 'wege', title: t('Time off work for care, advice near you: wege-zur-pflege.de'), url: 'https://www.wege-zur-pflege.de' },
  ];
}
