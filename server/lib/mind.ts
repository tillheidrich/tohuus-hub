/**
 * Im Kopf (15 Oct 2026, docs/mind.md): what a person carries around without it being a task – "Was essen wir Samstag,
 * wenn Mira abends weg ist?", "Was schenke ich Oma zu Weihnachten?" – and what they did on the side without ever
 * writing it down ("Kinderarzt angerufen", "an Omas Geburtstag gedacht"). So it gets seen.
 *
 * - kind `open` (im Kopf) or `done` (nebenbei erledigt / dran gedacht); an open thought can be ticked off → done.
 * - private (only the author) or household; household entries can be hidden from single members (a present for them).
 *   Switch either way at any time.
 * - Others can nod: "Ich denk mit" on a thought, "Danke" on something done. Names, never counts or rankings.
 * - Never to the assistant, MCP, Home Assistant, notifications, widgets or exports – it is people's heads.
 * - Done entries fade from the lists after 14 days (it's a moment, not an archive) and count in the weekly review.
 */
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';

migrate(
  'mind-1',
  `CREATE TABLE mind_items (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     text TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'open' CHECK (kind IN ('open','done')),
     visibility TEXT NOT NULL DEFAULT 'household' CHECK (visibility IN ('private','household')),
     hide_from TEXT NOT NULL DEFAULT '[]',
     nods TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     done_at TEXT
   );
   CREATE INDEX mind_items_user ON mind_items(user_id, kind);`,
);
// "Mira hat heute den Geschirrspüler ausgeräumt" – written down by someone else (the evening question, checkin.ts)
migrate('mind-2', `ALTER TABLE mind_items ADD COLUMN done_by INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
// "irgendwann – aber bis Weihnachten" (a soft date, no reminder) and when the person last said "noch wichtig"
migrate('mind-3', `ALTER TABLE mind_items ADD COLUMN due_on TEXT; ALTER TABLE mind_items ADD COLUMN reviewed_at TEXT;`);

export class MindError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

interface Row {
  id: number;
  user_id: number;
  text: string;
  kind: 'open' | 'done';
  visibility: 'private' | 'household';
  hide_from: string;
  nods: string;
  created_at: string;
  done_at: string | null;
  done_by?: number | null;
  due_on?: string | null;
  reviewed_at?: string | null;
}

const ids = (raw: string): number[] => {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch {
    return [];
  }
};

/** Can this member see the entry? The author always; others only household entries not hidden from them. */
export function canSeeMind(row: Pick<Row, 'user_id' | 'visibility' | 'hide_from'>, viewer: number) {
  if (row.user_id === viewer) return true;
  return row.visibility === 'household' && !ids(row.hide_from).includes(viewer);
}

const names = () => new Map((db.prepare('SELECT id, name, color FROM users').all() as { id: number; name: string; color: string }[]).map((u) => [u.id, u]));

function view(row: Row, viewer: number, people = names()) {
  const mine = row.user_id === viewer;
  const author = people.get(row.user_id);
  const doer = row.done_by && row.done_by !== row.user_id ? people.get(row.done_by) : undefined;
  return {
    id: row.id,
    text: row.text,
    kind: row.kind,
    mine,
    by: author ? { id: row.user_id, name: author.name, color: author.color } : null,
    /** someone else did it, the author wrote it down ("Danke, Mira!") */
    done_by: doer ? { id: row.done_by!, name: doer.name, color: doer.color } : null,
    about_me: row.done_by === viewer && row.user_id !== viewer,
    visibility: row.visibility,
    // only the author sees whom it is hidden from
    hide_from: mine ? ids(row.hide_from) : [],
    nods: ids(row.nods)
      .filter((id) => people.has(id))
      .map((id) => ({ id, name: people.get(id)!.name })),
    nodded: ids(row.nods).includes(viewer),
    created_at: row.created_at,
    done_at: row.done_at,
    /** a soft "bis wann" – no reminder, just there (null = irgendwann) */
    due_on: row.due_on ?? null,
  };
}
export type MindView = ReturnType<typeof view>;

const DONE_DAYS = 14;

/** My heads-up list and what the others shared: open thoughts (any age) and what got done in the last two weeks. */
export function mindList(viewer: number) {
  const rows = db
    .prepare(`SELECT * FROM mind_items WHERE kind = 'open' OR done_at >= datetime('now', ?) ORDER BY COALESCE(done_at, created_at) DESC, id DESC LIMIT 400`)
    .all(`-${DONE_DAYS} days`) as Row[];
  const people = names();
  const seen = rows.filter((r) => canSeeMind(r, viewer)).map((r) => view(r, viewer, people));
  return {
    /** how many of my older thoughts could use a look ("Was davon ist noch wichtig?") */
    review: mindReview(viewer).items.length,
    mine: { open: seen.filter((x) => x.mine && x.kind === 'open'), done: seen.filter((x) => x.mine && x.kind === 'done') },
    others: { open: seen.filter((x) => !x.mine && x.kind === 'open'), done: seen.filter((x) => !x.mine && x.kind === 'done') },
    members: [...people.values()].filter((p) => p.id !== viewer).map((p) => ({ id: p.id, name: p.name })),
  };
}

function own(id: number, viewer: number) {
  const row = db.prepare('SELECT * FROM mind_items WHERE id = ?').get(id) as Row | undefined;
  if (!row || row.user_id !== viewer) throw new MindError(t('Not found'), 404);
  return row;
}

const cleanText = (s: string) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!v) throw new MindError(t('Write a few words first.'));
  return v;
};

const cleanHide = (list: number[] | undefined, viewer: number) => {
  const members = new Set((db.prepare(`SELECT id FROM users WHERE COALESCE(kind, 'member') != 'guest'`).all() as { id: number }[]).map((u) => u.id));
  return JSON.stringify([...new Set((list ?? []).filter((id) => id !== viewer && members.has(id)))].slice(0, 20));
};

export interface MindInput {
  text?: string;
  kind?: 'open' | 'done';
  visibility?: 'private' | 'household';
  hide_from?: number[];
  /** done by another member (only for `done`; such an entry is always for the household – it's about them) */
  done_by?: number | null;
  /** a soft date, YYYY-MM-DD (null = irgendwann) */
  due_on?: string | null;
}

const cleanDay = (d: string | null | undefined) => (d && /^\d{4}-\d\d-\d\d$/.test(d) ? d : null);

/** Brain dump: several thoughts at once – one per line ("- ", "• ", "1." are dropped). At most 20. */
export function addMindMany(viewer: number, input: MindInput) {
  const lines = String(input.text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-–•*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 20);
  if (!lines.length) throw new MindError(t('Write a few words first.'));
  return lines.map((text) => addMind(viewer, { ...input, text }));
}

export function addMind(viewer: number, input: MindInput) {
  const kind = input.kind === 'done' ? 'done' : 'open';
  const other =
    kind === 'done' && input.done_by && input.done_by !== viewer && db.prepare(`SELECT 1 FROM users WHERE id = ? AND COALESCE(kind, 'member') != 'guest'`).get(input.done_by) ? input.done_by : null;
  const info = db
    .prepare(`INSERT INTO mind_items (user_id, text, kind, visibility, hide_from, done_at, done_by, due_on) VALUES (?, ?, ?, ?, ?, ${kind === 'done' ? "datetime('now')" : 'NULL'}, ?, ?)`)
    .run(viewer, cleanText(input.text ?? ''), kind, other || input.visibility !== 'private' ? 'household' : 'private', other ? '[]' : cleanHide(input.hide_from, viewer), other, kind === 'open' ? cleanDay(input.due_on) : null);
  emit('mind');
  return view(db.prepare('SELECT * FROM mind_items WHERE id = ?').get(Number(info.lastInsertRowid)) as Row, viewer);
}

/** Change text, privacy (either way, any time), whom it's hidden from, or tick a thought off (open → done) and back. */
export function updateMind(viewer: number, id: number, input: MindInput) {
  const row = own(id, viewer);
  const kind = input.kind ?? row.kind;
  if (input.due_on !== undefined) db.prepare('UPDATE mind_items SET due_on = ? WHERE id = ?').run(cleanDay(input.due_on), id);
  db.prepare(`UPDATE mind_items SET text = ?, kind = ?, visibility = ?, hide_from = ?, done_at = ? WHERE id = ?`).run(
    input.text !== undefined ? cleanText(input.text) : row.text,
    kind,
    input.visibility ?? row.visibility,
    input.hide_from !== undefined ? cleanHide(input.hide_from, viewer) : row.hide_from,
    kind === 'done' ? (row.done_at ?? new Date().toISOString().slice(0, 19).replace('T', ' ')) : null,
    id,
  );
  emit('mind');
  return view(db.prepare('SELECT * FROM mind_items WHERE id = ?').get(id) as Row, viewer);
}

/**
 * "Was davon ist noch wichtig?" – my open thoughts older than a week that I haven't looked at for two weeks, at most
 * ten, oldest first. One at a time, swipe: still important (keep), done, or let go. Letting go is allowed.
 */
export function mindReview(viewer: number) {
  const rows = db
    .prepare(
      `SELECT * FROM mind_items WHERE user_id = ? AND kind = 'open' AND created_at <= datetime('now', '-7 days')
       AND (reviewed_at IS NULL OR reviewed_at <= datetime('now', '-14 days')) ORDER BY created_at LIMIT 10`,
    )
    .all(viewer) as Row[];
  const people = names();
  return { items: rows.map((r) => view(r, viewer, people)) };
}

/** "Noch wichtig" – stays, and won't be asked about again for two weeks. */
export function keepMind(viewer: number, id: number) {
  own(id, viewer);
  db.prepare(`UPDATE mind_items SET reviewed_at = datetime('now') WHERE id = ?`).run(id);
  return { ok: true };
}

export function deleteMind(viewer: number, id: number) {
  own(id, viewer);
  db.prepare('DELETE FROM mind_items WHERE id = ?').run(id);
  emit('mind');
  return { ok: true };
}

/** "Ich denk mit" / "Danke" – on someone else's entry the viewer can see; tap again to take it back. */
export function nodMind(viewer: number, id: number) {
  const row = db.prepare('SELECT * FROM mind_items WHERE id = ?').get(id) as Row | undefined;
  if (!row || !canSeeMind(row, viewer) || row.user_id === viewer) throw new MindError(t('Not found'), 404);
  const list = ids(row.nods);
  const next = list.includes(viewer) ? list.filter((x) => x !== viewer) : [...list, viewer];
  db.prepare('UPDATE mind_items SET nods = ? WHERE id = ?').run(JSON.stringify(next), id);
  emit('mind');
  return view({ ...row, nods: JSON.stringify(next) }, viewer);
}

/** Weekly review: what this person did on the side or thought of (their private ones too – that part is only for them). */
export function mindDoneBy(viewer: number, from: string, to: string) {
  // what I did – also when someone else wrote it down for me ("Mira hat den Geschirrspüler ausgeräumt")
  return db
    .prepare(`SELECT text FROM mind_items WHERE COALESCE(done_by, user_id) = ? AND kind = 'done' AND done_at BETWEEN ? AND ? AND (user_id = ? OR visibility = 'household') ORDER BY done_at DESC`)
    .all(viewer, `${from} 00:00:00`, `${to} 23:59:59`, viewer) as {
    text: string;
  }[];
}

/** Weekly review, household part: how many shared things got done on the side – a number, no names, no texts. */
export function mindDoneShared(from: string, to: string) {
  return (
    db.prepare(`SELECT COUNT(*) n FROM mind_items WHERE kind = 'done' AND visibility = 'household' AND hide_from = '[]' AND done_at BETWEEN ? AND ?`).get(`${from} 00:00:00`, `${to} 23:59:59`) as {
      n: number;
    }
  ).n;
}
