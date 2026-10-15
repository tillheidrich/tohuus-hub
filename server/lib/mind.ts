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
  return {
    id: row.id,
    text: row.text,
    kind: row.kind,
    mine,
    by: author ? { id: row.user_id, name: author.name, color: author.color } : null,
    visibility: row.visibility,
    // only the author sees whom it is hidden from
    hide_from: mine ? ids(row.hide_from) : [],
    nods: ids(row.nods)
      .filter((id) => people.has(id))
      .map((id) => ({ id, name: people.get(id)!.name })),
    nodded: ids(row.nods).includes(viewer),
    created_at: row.created_at,
    done_at: row.done_at,
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
}

export function addMind(viewer: number, input: MindInput) {
  const kind = input.kind === 'done' ? 'done' : 'open';
  const info = db
    .prepare(`INSERT INTO mind_items (user_id, text, kind, visibility, hide_from, done_at) VALUES (?, ?, ?, ?, ?, ${kind === 'done' ? "datetime('now')" : 'NULL'})`)
    .run(viewer, cleanText(input.text ?? ''), kind, input.visibility === 'private' ? 'private' : 'household', cleanHide(input.hide_from, viewer));
  emit('mind');
  return view(db.prepare('SELECT * FROM mind_items WHERE id = ?').get(Number(info.lastInsertRowid)) as Row, viewer);
}

/** Change text, privacy (either way, any time), whom it's hidden from, or tick a thought off (open → done) and back. */
export function updateMind(viewer: number, id: number, input: MindInput) {
  const row = own(id, viewer);
  const kind = input.kind ?? row.kind;
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
  return db.prepare(`SELECT text FROM mind_items WHERE user_id = ? AND kind = 'done' AND done_at BETWEEN ? AND ? ORDER BY done_at DESC`).all(viewer, `${from} 00:00:00`, `${to} 23:59:59`) as {
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
