/**
 * What ToHuus "merkt sich" about a household beyond lists and receipts: small facts, preferences and routines
 * ("Wir kaufen Brot beim Bäcker", "Samstags wird gegrillt", "Lea trinkt Hafermilch"). Written by people, by the
 * assistant when someone asks it to remember something, or derived. Every row can be read and deleted
 * (GET/DELETE /api/memory); the word "Gedächtnis" stays internal.
 *
 * Rows that touch health, religion, politics and similar (Art. 9 GDPR) are flagged `sensitive` by a word list and
 * never go to a model unless the household switched on `ai.health_share`.
 *
 * Table (migration 'memory-1'): ai_memory.
 */
import { db, migrate } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { norm } from './text.js';

migrate(
  'memory-1',
  `CREATE TABLE IF NOT EXISTS ai_memory (
     id INTEGER PRIMARY KEY,
     scope TEXT NOT NULL DEFAULT 'household' CHECK (scope IN ('household','person')),
     person TEXT,
     kind TEXT NOT NULL DEFAULT 'fact' CHECK (kind IN ('fact','preference','routine')),
     text TEXT NOT NULL,
     source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','assistant','derived')),
     sensitive INTEGER NOT NULL DEFAULT 0,
     created_by TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     confirmed_at TEXT
   );
   CREATE INDEX IF NOT EXISTS ai_memory_scope ON ai_memory(scope, person);`,
);

export type MemoryScope = 'household' | 'person';
export type MemoryKind = 'fact' | 'preference' | 'routine';
export type MemorySource = 'user' | 'assistant' | 'derived';

export interface MemoryRow {
  id: number;
  scope: MemoryScope;
  person: string | null;
  kind: MemoryKind;
  text: string;
  source: MemorySource;
  sensitive: number;
  created_by: string | null;
  created_at: string;
  confirmed_at: string | null;
}

/**
 * Word stems (German and English) for special categories of personal data: health, diet for medical reasons,
 * pregnancy, medication, religion, politics, sexuality, origin, union membership. Over-flagging is fine.
 */
const SENSITIVE_STEMS = [
  // health and body
  'allerg', 'unvertr', 'intoler', 'krank', 'diabet', 'zucker krank', 'zoeliak', 'zöliak', 'celiac', 'coeliac', 'laktoseintol', 'lactose intol',
  'histamin', 'fructose', 'fruktose', 'gluten', 'nuss allerg', 'anaphyl', 'epipen', 'asthma', 'neurodermit', 'ekzem', 'eczema',
  'migraen', 'migrän', 'migrain', 'depress', 'angststoer', 'angststör', 'anxiety', 'adhs', 'adhd', 'autis', 'demenz', 'dementia',
  'krebs', 'cancer', 'tumor', 'chemo', 'herzkrank', 'herzinfarkt', 'herzfehler', 'heart disease', 'blutdruck', 'blood pressure', 'cholester', 'schwanger', 'pregnan', 'stillen', 'breastfeed',
  'medikament', 'tablette', 'medication', 'medicine', 'insulin', 'arzt', 'aerzt', 'ärzt', 'doctor', 'therap', 'klinik', 'clinic', 'hospital', 'krankenhaus',
  'diagnos', 'symptom', 'behinder', 'disabil', 'rollstuhl', 'wheelchair', 'essstoer', 'essstör', 'eating disorder', 'magersucht', 'bulimi', 'abnehm', 'diät', 'diaet',
  'sucht', 'addict', 'alkoholi', 'entzug', 'rehab', 'gicht', 'gout', 'niere', 'kidney', 'leber', 'liver', 'schilddrues', 'schilddrüs', 'thyroid', 'morbus', 'crohn', 'colitis', 'reizdarm', 'ibs',
  // religion and belief
  'halal', 'koscher', 'kosher', 'ramadan', 'fasten', 'religi', 'glaube', 'muslim', 'islam', 'jued', 'jüd', 'jewish', 'christlich', 'christen', 'kirche', 'church', 'moschee', 'mosque', 'synagog', 'hindu', 'buddh',
  // politics, unions, sexuality, origin
  'partei', 'party member', 'politi', 'gewerkschaft', 'union member', 'schwul', 'lesb', 'gay', 'queer', 'transgender', 'transsex', 'sexu', 'herkunft', 'ethni', 'migrations', 'asyl', 'asylum',
];

const fold = (s: string) => norm(s).replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
const STEMS = SENSITIVE_STEMS.map((x) => fold(x)).filter(Boolean);

/** Pure word-list classifier: does this text touch special categories of personal data? */
export function isSensitive(text: string): boolean {
  const f = ` ${fold(text)} `;
  return STEMS.some((stem) => (stem.includes(' ') ? f.includes(stem) : f.split(' ').some((w) => w.startsWith(stem) || (stem.length >= 6 && w.includes(stem)))));
}

export class MemoryError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const MAX_ROWS = 300;

export function getMemory(id: number) {
  return db.prepare('SELECT * FROM ai_memory WHERE id = ?').get(id) as MemoryRow | undefined;
}

export interface RememberInput {
  text: string;
  kind?: MemoryKind;
  scope?: MemoryScope;
  person?: string | null;
  source?: MemorySource;
  createdBy?: string | null;
  /** a person said it themselves (or confirmed what the assistant proposed) */
  confirmed?: boolean;
}

/** Store one thing; the same text again only refreshes it. */
export function remember(input: RememberInput): MemoryRow {
  const text = input.text.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (text.length < 2) throw new MemoryError(t('What should ToHuus remember?'));
  const scope: MemoryScope = input.scope ?? (input.person ? 'person' : 'household');
  const person = scope === 'person' ? (input.person ?? null) : null;
  const existing = (db.prepare('SELECT * FROM ai_memory WHERE scope = ? AND IFNULL(person, \'\') = IFNULL(?, \'\')').all(scope, person) as MemoryRow[]).find(
    (r) => fold(r.text) === fold(text),
  );
  const confirmed = input.confirmed ?? input.source !== 'derived';
  if (existing) {
    if (confirmed && !existing.confirmed_at) db.prepare(`UPDATE ai_memory SET confirmed_at = datetime('now') WHERE id = ?`).run(existing.id);
    return getMemory(existing.id)!;
  }
  const count = (db.prepare('SELECT COUNT(*) n FROM ai_memory').get() as { n: number }).n;
  if (count >= MAX_ROWS) throw new MemoryError(t('ToHuus already remembers a lot. Please delete something first.'));
  const id = Number(
    db
      .prepare(
        `INSERT INTO ai_memory (scope, person, kind, text, source, sensitive, created_by, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ${confirmed ? "datetime('now')" : 'NULL'})`,
      )
      .run(scope, person, input.kind ?? 'fact', text, input.source ?? 'user', isSensitive(text) ? 1 : 0, input.createdBy ?? null).lastInsertRowid,
  );
  emit('settings');
  return getMemory(id)!;
}

/** Forget by id or by text (best match). Returns the removed rows so they can be restored. */
export function forget(ref: number | string): MemoryRow[] {
  let rows: MemoryRow[] = [];
  if (typeof ref === 'number') {
    const r = getMemory(ref);
    if (r) rows = [r];
  } else {
    const q = fold(ref);
    if (q.length < 2) return [];
    const all = db.prepare('SELECT * FROM ai_memory').all() as MemoryRow[];
    const exact = all.filter((r) => fold(r.text) === q);
    rows = exact.length ? exact : all.filter((r) => fold(r.text).includes(q) || q.includes(fold(r.text)));
    if (rows.length > 3) rows = []; // too vague – ask instead of wiping half the list
  }
  for (const r of rows) db.prepare('DELETE FROM ai_memory WHERE id = ?').run(r.id);
  if (rows.length) emit('settings');
  return rows;
}

/** Put removed rows back (undo). */
export function restoreMemory(rows: MemoryRow[]) {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO ai_memory (id, scope, person, kind, text, source, sensitive, created_by, created_at, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const r of rows) ins.run(r.id, r.scope, r.person, r.kind, r.text, r.source, r.sensitive, r.created_by, r.created_at, r.confirmed_at);
  emit('settings');
}

export function listMemory(opts: { includeSensitive?: boolean } = {}) {
  const rows = db.prepare('SELECT * FROM ai_memory ORDER BY scope, kind, id').all() as MemoryRow[];
  return (opts.includeSensitive ? rows : rows.filter((r) => !r.sensitive)).map((r) => ({ ...r, sensitive: Boolean(r.sensitive) }));
}

export function deleteMemory(id: number) {
  const r = getMemory(id);
  if (!r) throw new MemoryError(t('Not found'), 404);
  db.prepare('DELETE FROM ai_memory WHERE id = ?').run(id);
  emit('settings');
  return r;
}

export function clearMemory() {
  const n = db.prepare('DELETE FROM ai_memory').run().changes;
  emit('settings');
  return n;
}
