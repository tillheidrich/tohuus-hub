/**
 * What ToHuus "merkt sich" about a household beyond lists and receipts: small facts, preferences and routines
 * ("Wir kaufen Brot beim Bäcker", "Samstags wird gegrillt", "Mira trinkt Hafermilch"). Written by people, by the
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
import { currentAiActor } from './ai-policy.js';

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

// "nur für mich": a row only its author (users.id) sees – in the app, in their assistant, in MCP as them – never other
// members and never the admin export (docs/guests-and-permissions.md › "Privacy inside a household")
migrate('memory-private-1', `ALTER TABLE ai_memory ADD COLUMN private_to INTEGER;`);

// "Mika hat Schuhgröße 28", later "Mika hat jetzt 29" (18 Oct 2026): a fact about a person or thing and one of its
// properties gets a key (fact_key "felix|schuhgrosse"), so a new value replaces the old row instead of adding a second
// one; the old texts stay in `history` (JSON [{ text, until }], newest last, at most 10).
migrate('memory-key-1', `ALTER TABLE ai_memory ADD COLUMN fact_key TEXT; ALTER TABLE ai_memory ADD COLUMN history TEXT;`);

// Haushaltswissen (18 Oct 2026, docs/knowledge.md): an entry hangs on something the household has – a person
// ('u3' / 'k2'), a place ('l5'), a product ('p7') or a free subject ("Rollo Erdgeschoss") – and holds one property with
// one value, an optional note and photo. `origin` = the way it came in (app, web, assistant, telegram, share, mcp),
// `author_id` = who wrote it first (users.id; decides who may make it private or share it), `guests` = permanent guests
// may read it (Hausinfo rule), `shared_at` = when a private entry was shared (older history stays with the author).
migrate(
  'knowledge-1',
  `ALTER TABLE ai_memory ADD COLUMN subject TEXT;
   ALTER TABLE ai_memory ADD COLUMN subject_ref TEXT;
   ALTER TABLE ai_memory ADD COLUMN property TEXT;
   ALTER TABLE ai_memory ADD COLUMN value TEXT;
   ALTER TABLE ai_memory ADD COLUMN note TEXT;
   ALTER TABLE ai_memory ADD COLUMN photo TEXT;
   ALTER TABLE ai_memory ADD COLUMN origin TEXT;
   ALTER TABLE ai_memory ADD COLUMN guests INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE ai_memory ADD COLUMN author_id INTEGER;
   ALTER TABLE ai_memory ADD COLUMN updated_at TEXT;
   ALTER TABLE ai_memory ADD COLUMN updated_by TEXT;
   ALTER TABLE ai_memory ADD COLUMN shared_at TEXT;`,
);

/** whose private rows the current request may see: the signed-in person (requireAuth / MCP OAuth), else nobody's */
const viewerNow = (): number | null => currentAiActor()?.userId ?? null;
const visibleTo = (viewer: number | null) => (r: { private_to?: number | null }) => r.private_to == null || (viewer != null && r.private_to === viewer);

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
  private_to?: number | null;
  fact_key?: string | null;
  history?: string | null;
  // Haushaltswissen (migration 'knowledge-1')
  subject?: string | null;
  subject_ref?: string | null;
  property?: string | null;
  value?: string | null;
  note?: string | null;
  photo?: string | null;
  origin?: string | null;
  guests?: number | null;
  author_id?: number | null;
  updated_at?: string | null;
  updated_by?: string | null;
  shared_at?: string | null;
}

/** One earlier value: the text, the value (structured entries), until when it held, who changed it. */
export interface HistoryEntry {
  text: string;
  until: string;
  value?: string | null;
  /** UTC "YYYY-MM-DD HH:MM:SS" of the change (older entries only have `until`, a day) */
  at?: string;
  by?: string | null;
}

/**
 * Word stems (German and English) for special categories of personal data: health, diet for medical reasons,
 * pregnancy, medication, religion, politics, sexuality, origin, union membership. Over-flagging is fine.
 */
const SENSITIVE_STEMS = [
  // health and body
  'allerg', 'unvertr', 'intoler', 'vertragt kein', 'vertraegt kein', 'vertraegt nicht', 'vertragt nicht', 'laktose', 'lactose', 'krank', 'diabet', 'zucker krank', 'zoeliak', 'zöliak', 'celiac', 'coeliac', 'laktoseintol', 'lactose intol',
  'histamin', 'fructose', 'fruktose', 'gluten', 'nuss allerg', 'anaphyl', 'epipen', 'asthma', 'neurodermit', 'ekzem', 'eczema',
  'migraen', 'migrän', 'migrain', 'depress', 'angststoer', 'angststör', 'anxiety', 'adhs', 'adhd', 'autis', 'demenz', 'dementia',
  'krebs', 'cancer', 'tumor', 'chemo', 'herzkrank', 'herzinfarkt', 'herzfehler', 'heart disease', 'blutdruck', 'blood pressure', 'cholester', 'schwanger', 'pregnan', 'stillen', 'breastfeed',
  // doctors inside a word ("Kinderärztin", "Zahnarztpraxis") – the short stem "ärzt" only matches at the start
  'kinderarzt', 'kinderärzt', 'hausarzt', 'hausärzt', 'zahnarzt', 'zahnärzt', 'frauenarzt', 'frauenärzt', 'augenarzt', 'augenärzt', 'hautarzt', 'hautärzt', 'hebamme', 'apothek', 'impfpass', 'impfung',
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
  /** "nur für mich": only this member (users.id) sees the row */
  privateTo?: number | null;
  /** who wrote it (users.id) – may later share it or make it private */
  authorId?: number | null;
  /** app | web | assistant | telegram | share | mcp */
  origin?: string | null;
}

// ------------------------------------------------------------------ facts with a key ("Mika hat Schuhgröße 28")

export interface Fact {
  subject: string;
  property: string;
  value: string;
  /** fold(subject)|fold(property) */
  key: string;
}

const NAME = String.raw`(\p{Lu}[\p{L}-]*)`;
/** a value worth keying: a number or a clothing size ("28", "110/116", "XL") – plain sentences stay plain text */
const VALUE_LIKE = /\d|^(?:xxs|xs|s|m|l|xl|xxl|xxxl)$/i;
export const factKey = (subject: string, property: string) => `${fold(subject)}|${fold(property)}`;

/**
 * "Mika hat Schuhgröße 28", "Mika trägt Größe 110", "Mikas Schuhgröße ist 28", "Miras Schuhgröße ist 30",
 * "Die Schuhgröße von Mika ist 28", "Mika's shoe size is 12" → subject, property, value. Only for values that are
 * numbers or sizes; everything else ("Mira trinkt Hafermilch") stays a plain remembered sentence. Pure.
 */
export function factOf(text: string): Fact | null {
  const s = text.replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  let m: RegExpMatchArray | null;
  let f: { subject: string; property: string; value: string } | null = null;
  if ((m = s.match(new RegExp(String.raw`^${NAME}\s+(?:hat|trägt|traegt|braucht|has|wears|needs)\s+(?:jetzt\s+|now\s+)?(?:(?:die|den|das|eine?n?|a|an)\s+)?(?!(?:jetzt|now|inzwischen|noch|immer)\b)([\p{L}][\p{L}-]*(?:\s+size)?)\s+(?:von\s+|of\s+)?(.+)$`, 'u'))))
    f = { subject: m[1], property: m[2], value: m[3] };
  else if ((m = s.match(new RegExp(String.raw`^(?:die|der|das|the)\s+([\p{L}][\p{L}-]*(?:\s+size)?)\s+(?:von|of)\s+${NAME}\s+(?:ist|is)\s+(?:jetzt\s+|now\s+)?(.+)$`, 'iu'))))
    f = { subject: m[2], property: m[1], value: m[3] };
  else if ((m = s.match(new RegExp(String.raw`^${NAME}(?:['’]s?|s)\s+([\p{L}][\p{L}-]*(?:\s+size)?)\s+(?:ist|is)\s+(?:jetzt\s+|now\s+)?(.+)$`, 'u'))))
    f = { subject: m[1], property: m[2], value: m[3] };
  if (!f || !VALUE_LIKE.test(f.value.trim()) || f.value.split(' ').length > 3) return null;
  return { ...f, value: f.value.trim(), key: factKey(f.subject, f.property) };
}

/** "Mika hat jetzt 29", "Mika trägt jetzt 116" – a new value without the property → { subject, value }. Pure. */
export function valueOnlyOf(text: string): { subject: string; value: string } | null {
  const m = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]+$/, '')
    .match(new RegExp(String.raw`^${NAME}\s+(?:hat|trägt|traegt|braucht|ist|has|wears|is)\s+(?:jetzt\s+|now\s+|inzwischen\s+)?(?:größe\s+|groesse\s+|size\s+)?(\d[\d.,/-]*|xxs|xs|s|m|l|xl|xxl|xxxl)$`, 'iu'));
  return m ? { subject: m[1], value: m[2] } : null;
}

/** the key of a row (older rows have none yet: worked out from the text) */
const keyOfRow = (r: MemoryRow) => r.fact_key ?? (r.subject && r.property ? factKey(r.subject, r.property) : null) ?? factOf(r.text)?.key ?? null;

/** the fact of a row: its columns (Haushaltswissen) or – older rows – parsed from the text */
const factOfRow = (r: MemoryRow): Fact | null =>
  r.subject && r.property && r.value != null ? { subject: r.subject, property: r.property, value: r.value, key: factKey(r.subject, r.property) } : factOf(r.text);

/** The text a structured entry shows wherever plain rows are listed (assistant context, old clients): "Mira · Schuhgröße: 28". */
export const entryText = (subject: string, property: string, value: string) => `${subject} · ${property}: ${value}`.slice(0, 300);

/** UTC with milliseconds – compared with `shared_at` (same format), so a change in the second of sharing stays apart */
export const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 23);

export function pushHistory(row: Pick<MemoryRow, 'history' | 'text' | 'value'>, by?: string | null): string {
  const h = historyOf(row);
  const at = stamp();
  h.push({ text: row.text, value: row.value ?? null, until: at.slice(0, 10), at, by: by ?? null });
  return JSON.stringify(h.slice(-10));
}

export function historyOf(row: Pick<MemoryRow, 'history'>): HistoryEntry[] {
  try {
    const h = JSON.parse(row.history || '[]');
    return Array.isArray(h) ? h : [];
  } catch {
    return [];
  }
}

/**
 * The history a viewer may see: an entry that was private and later shared keeps its older values with the author –
 * everyone else sees only what changed after it was shared (no question needed, nothing private leaks).
 */
export function visibleHistory(row: Pick<MemoryRow, 'history' | 'shared_at' | 'author_id'>, viewer: number | null): HistoryEntry[] {
  const h = historyOf(row);
  if (!row.shared_at || (viewer != null && row.author_id === viewer)) return h;
  return h.filter((x) => (x.at ?? x.until) > row.shared_at!);
}

/**
 * Change the value of an entry: the old text/value goes into the history (who, when), the text follows the value.
 * Structured entries get their text rebuilt; plain sentences have the old value replaced in place.
 */
export function setEntryValue(row: MemoryRow, value: string, opts: { by?: string | null; source?: MemorySource; origin?: string | null } = {}): MemoryRow {
  const f = factOfRow(row);
  const v = value.replace(/\s+/g, ' ').trim().slice(0, f ? 120 : 300);
  if (v.length < 1) throw new MemoryError(t('What should ToHuus remember?'));
  // a text built from the columns is built again; a sentence ("Mira hat Schuhgröße 28") keeps its words
  const built = row.subject && row.property && row.value != null && row.text === entryText(row.subject, row.property, row.value);
  const text = built ? entryText(row.subject!, row.property!, v) : f && row.text.includes(f.value) ? row.text.replace(f.value, v) : f ? entryText(f.subject, f.property, v) : v;
  if (text === row.text && (!f || v === f.value)) return row;
  db.prepare(
    `UPDATE ai_memory SET text = ?, value = ?, sensitive = ?, history = ?, source = ?, origin = COALESCE(?, origin), updated_at = datetime('now'), updated_by = ?, confirmed_at = datetime('now') WHERE id = ?`,
  ).run(text, f ? v : null, isSensitive(`${text} ${row.note ?? ''}`) ? 1 : 0, pushHistory(row, opts.by), opts.source ?? row.source, opts.origin ?? null, opts.by ?? null, row.id);
  emit('settings');
  return getMemory(row.id)!;
}

/** Store one thing; the same text again only refreshes it, a new value of a known fact replaces the old one. */
export function remember(input: RememberInput): MemoryRow & { replaced?: MemoryRow } {
  const text = input.text.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (text.length < 2) throw new MemoryError(t('What should ToHuus remember?'));
  const scope: MemoryScope = input.scope ?? (input.person ? 'person' : 'household');
  const person = scope === 'person' ? (input.person ?? null) : null;
  const privateTo = input.privateTo ?? null;
  const same = db.prepare('SELECT * FROM ai_memory WHERE scope = ? AND IFNULL(person, \'\') = IFNULL(?, \'\') AND IFNULL(private_to, 0) = IFNULL(?, 0)').all(scope, person, privateTo) as MemoryRow[];
  const existing = same.find((r) => fold(r.text) === fold(text));
  const confirmed = input.confirmed ?? input.source !== 'derived';
  if (existing) {
    if (confirmed && !existing.confirmed_at) db.prepare(`UPDATE ai_memory SET confirmed_at = datetime('now') WHERE id = ?`).run(existing.id);
    return getMemory(existing.id)!;
  }
  // the same person/thing and property: a new value replaces the old one (kept in history), never a second row
  const fact = factOf(text);
  const key = fact?.key ?? null;
  const old = key ? same.find((r) => keyOfRow(r) === key) : undefined;
  if (old) {
    // an entry with its own subject/property (Haushaltswissen) keeps them – only the value changes
    if (old.subject && old.property && fact) return { ...setEntryValue(old, fact.value, { by: input.createdBy ?? null, source: input.source ?? 'user', origin: input.origin ?? null }), replaced: old };
    db.prepare(
      `UPDATE ai_memory SET text = ?, sensitive = ?, fact_key = ?, history = ?, source = ?, created_by = ?, value = ?, origin = COALESCE(?, origin), updated_at = datetime('now'), updated_by = ?, confirmed_at = ${confirmed ? "datetime('now')" : 'confirmed_at'} WHERE id = ?`,
    ).run(
      text,
      isSensitive(text) ? 1 : 0,
      key,
      pushHistory(old, input.createdBy ?? null),
      input.source ?? 'user',
      input.createdBy ?? old.created_by,
      fact?.value ?? null,
      input.origin ?? null,
      input.createdBy ?? null,
      old.id,
    );
    emit('settings');
    return { ...getMemory(old.id)!, replaced: old };
  }
  const count = (db.prepare('SELECT COUNT(*) n FROM ai_memory').get() as { n: number }).n;
  if (count >= MAX_ROWS) throw new MemoryError(t('ToHuus already remembers a lot. Please delete something first.'));
  const id = Number(
    db
      .prepare(
        `INSERT INTO ai_memory (scope, person, kind, text, source, sensitive, created_by, private_to, fact_key, author_id, origin, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${confirmed ? "datetime('now')" : 'NULL'})`,
      )
      .run(scope, person, input.kind ?? 'fact', text, input.source ?? 'user', isSensitive(text) ? 1 : 0, input.createdBy ?? null, privateTo, key, input.authorId ?? privateTo ?? null, input.origin ?? null).lastInsertRowid,
  );
  emit('settings');
  return getMemory(id)!;
}

/** Forget by id or by text (best match). Returns the removed rows so they can be restored. */
export function forget(ref: number | string, viewer: number | null = viewerNow()): MemoryRow[] {
  let rows: MemoryRow[] = [];
  const may = visibleTo(viewer);
  if (typeof ref === 'number') {
    const r = getMemory(ref);
    if (r && may(r)) rows = [r];
  } else {
    const q = fold(ref);
    if (q.length < 2) return [];
    const all = (db.prepare('SELECT * FROM ai_memory').all() as MemoryRow[]).filter(may);
    const exact = all.filter((r) => fold(r.text) === q);
    rows = exact.length ? exact : all.filter((r) => fold(r.text).includes(q) || q.includes(fold(r.text)));
    // "vergiss das mit der Hafermilch": the telling words of the request (5+ letters, not filler) are enough
    if (!rows.length) {
      const words = q.split(' ').filter((w) => w.length >= 5 && !/^(bitte|nicht|immer|wieder|please|about|thing)$/.test(w));
      if (words.length) rows = all.filter((r) => fold(r.text).split(' ').some((x) => x.length >= 5 && words.some((w) => x.startsWith(w) || w.startsWith(x))));
    }
    if (rows.length > 3) rows = []; // too vague – ask instead of wiping half the list
  }
  for (const r of rows) db.prepare('DELETE FROM ai_memory WHERE id = ?').run(r.id);
  if (rows.length) emit('settings');
  return rows;
}

/** Put removed rows back, or a replaced value back to what it was (undo). */
export function restoreMemory(rows: MemoryRow[]) {
  // every column the table has (Haushaltswissen added subject, value, note, photo …) – what the row carries goes back
  const cols = (db.prepare('PRAGMA table_info(ai_memory)').all() as { name: string }[]).map((c) => c.name);
  for (const r of rows) {
    const rec = r as unknown as Record<string, unknown>;
    const use = cols.filter((c) => c in rec);
    const v = (c: string) => {
      const x = rec[c];
      return typeof x === 'boolean' ? (x ? 1 : 0) : (x ?? null);
    };
    db.prepare(`INSERT OR REPLACE INTO ai_memory (${use.join(', ')}) VALUES (${use.map(() => '?').join(', ')})`).run(...(use.map(v) as any[]));
  }
  emit('settings');
}

/** fold(subject) and – for a genitive like "Miras" – without the trailing s */
const subjectKeys = (subject: string) => {
  const f = fold(subject);
  return f.endsWith('s') && f.length > 3 ? [f, f.slice(0, -1)] : [f];
};

/** The visible keyed rows about a subject (the shared ones, plus the viewer's own private ones). */
function factsAbout(subject: string, viewer: number | null, includeSensitive: boolean) {
  const subs = subjectKeys(subject);
  return (db.prepare('SELECT * FROM ai_memory ORDER BY id').all() as MemoryRow[])
    .filter(visibleTo(viewer))
    .filter((r) => includeSensitive || !r.sensitive)
    .map((r) => ({ r, f: factOfRow(r), key: keyOfRow(r) }))
    .filter((x) => x.key && subs.includes(x.key.split('|')[0]));
}

/**
 * "Mika hat jetzt 29": the one fact about Mika with a number (or size) gets the new value. Several candidates →
 * `ambiguous` with their properties (ask which one); none → null.
 */
export function updateFactValue(
  subject: string,
  value: string,
  opts: { viewer?: number | null; createdBy?: string | null; source?: MemorySource; includeSensitive?: boolean } = {},
): { row: MemoryRow; replaced: MemoryRow; text: string } | { ambiguous: string[] } | null {
  const viewer = opts.viewer !== undefined ? opts.viewer : viewerNow();
  const sizeLike = !/\d/.test(value);
  const xs = factsAbout(subject, viewer, Boolean(opts.includeSensitive)).filter((x) => x.f && (sizeLike ? !/\d/.test(x.f.value) : /\d/.test(x.f.value)));
  if (!xs.length) return null;
  if (xs.length > 1) return { ambiguous: xs.map((x) => x.f!.property) };
  const { r, f } = xs[0];
  if (f!.value === value) return null;
  // the history keeps who changed it and the old value; the row and its id stay
  const row = setEntryValue(r, value, { by: opts.createdBy ?? null, source: opts.source ?? 'user' });
  return { row, replaced: r, text: row.text };
}

/**
 * "Welche Schuhgröße hat Mika?" → the remembered fact (and what it was before), or null. Sensitive rows only when
 * `includeSensitive` (the household's health consent).
 */
export function recallFact(subject: string, property: string, opts: { viewer?: number | null; includeSensitive?: boolean } = {}) {
  const viewer = opts.viewer !== undefined ? opts.viewer : viewerNow();
  const prop = fold(property);
  const all = factsAbout(subject, viewer, Boolean(opts.includeSensitive));
  // "Größe" also finds "Schuhgröße" when it is the only size about this person
  const hit = all.find((x) => x.key!.split('|')[1] === prop) ?? (() => {
    const loose = all.filter((x) => x.key!.split('|')[1].includes(prop) || prop.includes(x.key!.split('|')[1]));
    return loose.length === 1 ? loose[0] : undefined;
  })();
  if (hit) return { text: hit.r.text, value: hit.f?.value ?? null, history: visibleHistory(hit.r, viewer), id: hit.r.id };
  // plain sentences that mention both ("Mika: Schuhgröße 28")
  const subs = subjectKeys(subject);
  const rows = (db.prepare('SELECT * FROM ai_memory ORDER BY id DESC').all() as MemoryRow[])
    .filter(visibleTo(viewer))
    .filter((r) => opts.includeSensitive || !r.sensitive)
    .filter((r) => {
      const words = fold(r.text).split(' ');
      return subs.some((s) => words.includes(s)) && fold(r.text).includes(prop);
    });
  return rows[0] ? { text: rows[0].text, value: null, history: visibleHistory(rows[0], viewer), id: rows[0].id } : null;
}

export function listMemory(opts: { includeSensitive?: boolean; viewer?: number | null } = {}) {
  const viewer = opts.viewer !== undefined ? opts.viewer : viewerNow();
  const rows = (db.prepare('SELECT * FROM ai_memory ORDER BY scope, kind, id').all() as MemoryRow[]).filter(visibleTo(viewer));
  return (opts.includeSensitive ? rows : rows.filter((r) => !r.sensitive)).map((r) => ({
    ...r,
    // what was before an entry was shared stays with its author
    history: r.shared_at ? JSON.stringify(visibleHistory(r, viewer)) : (r.history ?? null),
    sensitive: Boolean(r.sensitive),
    onlyMe: r.private_to != null,
  }));
}

export function deleteMemory(id: number, viewer: number | null = viewerNow()) {
  const r = getMemory(id);
  if (!r || !visibleTo(viewer)(r)) throw new MemoryError(t('Not found'), 404);
  db.prepare('DELETE FROM ai_memory WHERE id = ?').run(id);
  emit('settings');
  return r;
}

export function clearMemory() {
  const n = db.prepare('DELETE FROM ai_memory').run().changes;
  emit('settings');
  return n;
}
