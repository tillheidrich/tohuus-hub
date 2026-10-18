/**
 * Haushaltswissen – "Was ToHuus sich merkt" as cards (18 Oct 2026, docs/knowledge.md, Wiki "Idee nach dem Start:
 * Alles reinschicken, ToHuus sortiert"). No second table: an entry is a row of `ai_memory` (memory.ts) with
 *   subject (+ subject_ref: a person 'u3'/'k2', a place 'l5', a product 'p7', or none = a free subject like
 *   "Rollo Erdgeschoss"), property, value, note, photo, visibility (household | only me via private_to), guests flag,
 *   author, origin and the history of earlier values (who, when).
 * Older plain lines ("Wir kaufen Brot beim Bäcker") stay plain lines and can be edited and deleted the same way.
 *
 * Rights: household entries – every member reads and changes them; private ones – only the author (other members get
 * 404, never a hint); permanent guests read only entries an adult marked "für Gäste" (never private or health ones)
 * and change nothing. Health-related entries (isSensitive) need the household's consent once, are private unless the
 * author shares them, and sharing one asks again (code `health_share`).
 * Sharing a private entry keeps its history, but other members only see what changed after it was shared.
 *
 * Works fully without AI: `say()` reads simple sentences ("Mira Schuhgröße 28", "Rollo Wohnzimmer 120 x 160",
 * "Welche Schuhgröße hat Mira?", "Lösch Miras Schuhgröße", "Korrigier: Rollo ist 125 breit"); the assistant tool
 * `knowledge_change` does the same with the model.
 */
import { db } from '../db.js';
import { t } from '../i18n.js';
import type { ToolDef } from './ai.js';
import { emit } from './bus.js';
import { requireHealthConsent } from './health-consent.js';
import { deleteImage, looksLikeImage, saveImage } from './images.js';
import { entryText, stamp, factKey, factOf, getMemory, historyOf, isSensitive, MemoryError, remember, setEntryValue, updateFactValue, valueOnlyOf, type HistoryEntry, type MemoryRow } from './memory.js';
import { norm } from './text.js';
import { perHousehold } from './tenancy.js';

export const ORIGINS = ['app', 'web', 'assistant', 'telegram', 'share', 'mcp'] as const;
export type Origin = (typeof ORIGINS)[number];
export type SubjectKind = 'person' | 'place' | 'product' | 'free';
export type Visibility = 'household' | 'me';

export interface KViewer {
  userId: number | null;
  name: string;
  admin?: boolean;
  /** permanent guest or guest link: reads entries marked for guests, writes nothing */
  guest?: boolean;
}

export class KnowledgeError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: string,
  ) {
    super(message);
  }
}

const fold = (s: string) => norm(s).replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const MAX_ROWS = 300;

// ------------------------------------------------------------------ subjects: people, places, products, free

export interface Subject {
  ref: string | null;
  name: string;
  kind: SubjectKind;
}

function rowsOr<T>(sqls: string[]): T[] {
  for (const sql of sqls) {
    try {
      return db.prepare(sql).all() as T[];
    } catch {
      /* column or table not there in this install – try the simpler query */
    }
  }
  return [];
}

/** People (members and children, no guests) and places (rooms, "Wo ist was?") – the picker's subjects. */
export function knownSubjects(opts: { products?: boolean } = {}): Subject[] {
  const users = rowsOr<{ id: number; name: string }>([`SELECT id, name FROM users WHERE IFNULL(kind, 'user') != 'guest' ORDER BY id`, 'SELECT id, name FROM users ORDER BY id']);
  const kids = rowsOr<{ id: number; name: string }>(['SELECT id, name FROM kid_profiles ORDER BY id']);
  const places = rowsOr<{ id: number; name: string }>(['SELECT id, name FROM locations WHERE IFNULL(archived, 0) = 0 ORDER BY sort, name', 'SELECT id, name FROM locations ORDER BY sort, name']);
  const products = opts.products ? rowsOr<{ id: number; name: string }>(['SELECT id, name FROM products WHERE archived = 0 ORDER BY name']) : [];
  return [
    ...users.map((u) => ({ ref: `u${u.id}`, name: u.name, kind: 'person' as const })),
    ...kids.map((k) => ({ ref: `k${k.id}`, name: k.name, kind: 'person' as const })),
    ...places.map((l) => ({ ref: `l${l.id}`, name: l.name, kind: 'place' as const })),
    ...products.map((p) => ({ ref: `p${p.id}`, name: p.name, kind: 'product' as const })),
  ];
}

const REF = /^([uklp])(\d+)$/;
export const kindOfRef = (ref: string | null | undefined): SubjectKind => {
  const m = ref ? REF.exec(ref) : null;
  return !m ? 'free' : m[1] === 'l' ? 'place' : m[1] === 'p' ? 'product' : 'person';
};

/** the current name of a linked subject (a renamed person or room follows), null when it is gone */
export function nameOfRef(ref: string | null | undefined): string | null {
  const m = ref ? REF.exec(ref) : null;
  if (!m) return null;
  const table = { u: 'users', k: 'kid_profiles', l: 'locations', p: 'products' }[m[1] as 'u' | 'k' | 'l' | 'p'];
  try {
    return (db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(Number(m[2])) as { name: string } | undefined)?.name ?? null;
  } catch {
    return null;
  }
}

/** A name (and maybe a picked ref) → the subject: a known person, place or product, else a free one. */
export function resolveSubject(name: string | null | undefined, ref?: string | null): Subject | null {
  if (ref) {
    const n = nameOfRef(ref);
    if (!n) throw new KnowledgeError(t('This no longer exists.'), 404);
    return { ref, name: n, kind: kindOfRef(ref) };
  }
  const n = clean(name, 80);
  if (!n) return null;
  const f = fold(n);
  const forms = f.endsWith('s') && f.length > 3 ? [f, f.slice(0, -1)] : [f];
  const hit = knownSubjects({ products: true }).find((s) => forms.includes(fold(s.name)));
  return hit ?? { ref: null, name: n, kind: 'free' };
}

// ------------------------------------------------------------------ who sees what

/** the author of a row: author_id, or – rows from before 18 Oct 2026 – the member whose name is in created_by */
export function authorOf(r: MemoryRow): number | null {
  if (r.author_id != null) return r.author_id;
  if (r.private_to != null) return r.private_to;
  if (!r.created_by) return null;
  return (db.prepare('SELECT id FROM users WHERE name = ?').get(r.created_by) as { id: number } | undefined)?.id ?? null;
}

const canSee = (r: MemoryRow, v: KViewer) => (v.guest ? r.private_to == null && Boolean(r.guests) && !r.sensitive : r.private_to == null || (v.userId != null && r.private_to === v.userId));

function rowsFor(v: KViewer): MemoryRow[] {
  return (db.prepare('SELECT * FROM ai_memory ORDER BY id').all() as MemoryRow[]).filter((r) => canSee(r, v));
}

/** A row this person may see (404 otherwise – a private entry of someone else looks like a missing one). */
function mustSee(id: number, v: KViewer, write = false): MemoryRow {
  const r = Number.isInteger(id) ? getMemory(id) : undefined;
  if (!r || !canSee(r, v)) throw new KnowledgeError(t('Not found'), 404);
  if (write && (v.guest || v.userId == null)) throw new KnowledgeError(t('Only people who live here can change this.'), 403);
  return r;
}

// ------------------------------------------------------------------ the card the apps show

export interface Entry {
  id: number;
  subject: string | null;
  subjectRef: string | null;
  subjectKind: SubjectKind | null;
  property: string | null;
  value: string | null;
  text: string;
  note: string | null;
  photo: string | null;
  /** a card with subject/property/value (else a plain line) */
  structured: boolean;
  visibility: Visibility;
  guests: boolean;
  sensitive: boolean;
  origin: string | null;
  author: string | null;
  mine: boolean;
  createdAt: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** newest first; `i` = position for restore / remove */
  history: (HistoryEntry & { i: number })[];
  may: { edit: boolean; share: boolean; makePrivate: boolean };
}

export function view(r: MemoryRow, v: KViewer): Entry {
  const f = r.subject && r.property ? null : factOf(r.text);
  const subject = (r.subject_ref ? nameOfRef(r.subject_ref) : null) ?? r.subject ?? f?.subject ?? null;
  const author = authorOf(r);
  const mineNow = v.userId != null && author === v.userId;
  const history = v.guest
    ? []
    : historyOf(r)
        .map((h, i) => ({ ...h, i }))
        .filter((h) => !r.shared_at || mineNow || (h.at ?? h.until) > r.shared_at)
        .reverse();
  return {
    id: r.id,
    subject,
    subjectRef: r.subject_ref ?? null,
    subjectKind: subject ? kindOfRef(r.subject_ref) : null,
    property: r.property ?? f?.property ?? null,
    value: r.value ?? f?.value ?? null,
    text: r.text,
    note: r.note ?? null,
    photo: r.photo ?? null,
    structured: Boolean(r.subject && r.property),
    visibility: r.private_to != null ? 'me' : 'household',
    guests: Boolean(r.guests),
    sensitive: Boolean(r.sensitive),
    origin: r.origin ?? (r.source === 'assistant' ? 'assistant' : null),
    author: r.created_by,
    mine: mineNow,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? null,
    updatedBy: r.updated_by ?? null,
    history,
    may: {
      edit: !v.guest && v.userId != null,
      share: r.private_to != null && r.private_to === v.userId,
      makePrivate: r.private_to == null && !v.guest && v.userId != null && author != null && (author === v.userId || Boolean(v.admin)),
    },
  };
}

// ------------------------------------------------------------------ list and search

const STOP = new Set(['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'von', 'vom', 'im', 'in', 'am', 'an', 'ist', 'hat', 'welche', 'welcher', 'welches', 'was', 'wie', 'wo', 'wann', 'unser', 'unsere', 'unseres', 'the', 'of', 'is', 'what', 'which', 'how', 'our']);
const words = (q: string) => fold(q).split(' ').filter((w) => w.length >= 2 && !STOP.has(w));

function matches(e: Entry, q: string) {
  const hay = fold([e.subject, e.property, e.value, e.text, e.note].filter(Boolean).join(' '));
  const ws = words(q);
  return ws.length > 0 && ws.every((w) => hay.includes(w) || (w.length > 3 && w.endsWith('s') && hay.includes(w.slice(0, -1))));
}

export interface Group {
  key: string;
  title: string | null;
  kind: SubjectKind | null;
  ref: string | null;
  entries: Entry[];
}

const KIND_ORDER: Record<string, number> = { person: 0, place: 1, product: 2, free: 3 };

export function groupEntries(entries: Entry[]): Group[] {
  const map = new Map<string, Group>();
  for (const e of entries) {
    const key = e.subjectRef ?? (e.subject ? `free:${fold(e.subject)}` : 'other');
    if (!map.has(key)) map.set(key, { key, title: e.subject, kind: e.subjectKind, ref: e.subjectRef, entries: [] });
    map.get(key)!.entries.push(e);
  }
  return [...map.values()]
    .map((g) => ({ ...g, entries: g.entries.sort((a, b) => (a.property ?? a.text).localeCompare(b.property ?? b.text, 'de')) }))
    .sort((a, b) => (a.key === 'other' ? 1 : b.key === 'other' ? -1 : (KIND_ORDER[a.kind ?? 'free'] - KIND_ORDER[b.kind ?? 'free']) || (a.title ?? '').localeCompare(b.title ?? '', 'de')));
}

export function listKnowledge(v: KViewer, f: { q?: string; ref?: string; subject?: string; property?: string } = {}) {
  let entries = rowsFor(v).map((r) => view(r, v));
  if (f.ref) entries = entries.filter((e) => e.subjectRef === f.ref);
  if (f.subject) entries = entries.filter((e) => e.subject && fold(e.subject) === fold(f.subject!));
  if (f.property) entries = entries.filter((e) => e.property && fold(e.property) === fold(f.property!));
  if (f.q?.trim()) entries = entries.filter((e) => matches(e, f.q!));
  return { entries, groups: groupEntries(entries), subjects: v.guest ? [] : knownSubjects() };
}

export const getEntry = (id: number, v: KViewer) => view(mustSee(id, v), v);

// ------------------------------------------------------------------ write

/** codes and passwords belong in Hausinfo › Codes (encrypted, never to the AI) – never into an entry */
const SECRET = /\b(pin|passwort|password|kennwort|passcode|zugangscode|türcode|tuercode|alarmcode|garagencode|tresor)\w*/i;
function noSecrets(...xs: (string | null | undefined)[]) {
  if (xs.some((x) => x && SECRET.test(x))) throw new KnowledgeError(t('Codes and passwords belong in House info › Codes – they are kept safe there.'), 400, 'secret');
}

const keyOf = (r: MemoryRow) => {
  if (r.subject && r.property) return factKey(nameOfRef(r.subject_ref) ?? r.subject, r.property);
  return r.fact_key ?? factOf(r.text)?.key ?? null;
};

export interface CreateInput {
  subject?: string | null;
  subjectRef?: string | null;
  property?: string | null;
  value?: string | null;
  /** a plain line instead of subject/property/value */
  text?: string | null;
  note?: string | null;
  visibility?: Visibility;
  guests?: boolean;
  consent?: boolean;
  origin?: Origin;
}

function consentFor(v: KViewer, consent?: boolean) {
  requireHealthConsent({ consent, by: `${v.name} (#${v.userId ?? '?'})` });
}

/**
 * New entry – or, when this person already sees one with the same subject and property (and the same visibility),
 * its new value (the old one goes into the history). Returns the entry and the row before (for undo).
 */
export function createEntry(input: CreateInput, v: KViewer): { entry: Entry; updated: boolean; before: MemoryRow | null } {
  if (v.guest || v.userId == null) throw new KnowledgeError(t('Only people who live here can change this.'), 403);
  const property = clean(input.property, 60);
  const value = clean(input.value, 120);
  const note = clean(input.note, 500) || null;
  const origin = input.origin ?? 'app';
  if (!property || !value) {
    // a plain line, like "Was ToHuus sich merkt" always had
    const text = clean(input.text ?? input.value, 300);
    if (text.length < 2) throw new KnowledgeError(t('What should ToHuus remember?'));
    noSecrets(text, note);
    const sens = isSensitive(`${text} ${note ?? ''}`);
    if (sens) consentFor(v, input.consent);
    const priv = input.visibility === 'me' || (input.visibility === undefined && sens);
    const row = remember({ text, source: 'user', createdBy: v.name, privateTo: priv ? v.userId : null, authorId: v.userId, origin, confirmed: true });
    if (note || (input.guests && !priv && !sens)) db.prepare('UPDATE ai_memory SET note = COALESCE(?, note), guests = ? WHERE id = ?').run(note, input.guests && !priv && !sens ? 1 : 0, row.id);
    return { entry: view(getMemory(row.id)!, v), updated: Boolean(row.replaced), before: row.replaced ?? null };
  }
  const s = resolveSubject(input.subject, input.subjectRef);
  if (!s) throw new KnowledgeError(t('Who or what is it about?'));
  noSecrets(property, value, note);
  const sens = isSensitive([s.name, property, value, note].filter(Boolean).join(' '));
  if (sens) consentFor(v, input.consent);
  const priv = input.visibility === 'me' || (input.visibility === undefined && sens);
  const privateTo = priv ? v.userId : null;
  const key = factKey(s.name, property);
  const same = rowsFor(v).find(
    (r) => (r.private_to ?? null) === privateTo && ((s.ref && r.subject_ref === s.ref && r.property && fold(r.property) === fold(property)) || keyOf(r) === key),
  );
  if (same) {
    const before = { ...same };
    db.transaction(() => {
      // an older sentence row becomes a card on the way
      if (!(same.subject && same.property)) db.prepare('UPDATE ai_memory SET subject = ?, subject_ref = ?, property = ?, fact_key = ? WHERE id = ?').run(s.name, s.ref, property, key, same.id);
      if (note) db.prepare('UPDATE ai_memory SET note = ? WHERE id = ?').run(note, same.id);
      setEntryValue(getMemory(same.id)!, value, { by: v.name, origin });
    })();
    emit('settings');
    return { entry: view(getMemory(same.id)!, v), updated: true, before };
  }
  const count = (db.prepare('SELECT COUNT(*) n FROM ai_memory').get() as { n: number }).n;
  if (count >= MAX_ROWS) throw new MemoryError(t('ToHuus already remembers a lot. Please delete something first.'));
  const text = entryText(s.name, property, value);
  const id = Number(
    db
      .prepare(
        `INSERT INTO ai_memory (scope, kind, text, source, sensitive, created_by, private_to, fact_key, subject, subject_ref, property, value, note, origin, guests, author_id, confirmed_at)
         VALUES ('household', 'fact', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(text, origin === 'assistant' ? 'assistant' : 'user', sens ? 1 : 0, v.name, privateTo, key, s.name, s.ref, property, value, note, origin, input.guests && !priv && !sens ? 1 : 0, v.userId).lastInsertRowid,
  );
  emit('settings');
  return { entry: view(getMemory(id)!, v), updated: false, before: null };
}

export interface PatchInput {
  subject?: string | null;
  subjectRef?: string | null;
  property?: string | null;
  value?: string | null;
  /** the text of a plain line */
  text?: string | null;
  note?: string | null;
  visibility?: Visibility;
  guests?: boolean;
  consent?: boolean;
}

/** Share a private entry with the household, or make a household entry private (see the rules on top). */
function setVisibility(r: MemoryRow, to: Visibility, v: KViewer, consent?: boolean) {
  if (to === (r.private_to != null ? 'me' : 'household')) return;
  if (to === 'household') {
    if (r.private_to !== v.userId) throw new KnowledgeError(t('Only the person who wrote it can share it.'), 403);
    if (r.sensitive) {
      // health information: shared only after an explicit yes for this entry
      if (consent !== true) throw new KnowledgeError(t('This looks like health information. Share it with everyone in the household anyway?'), 409, 'health_share');
      consentFor(v, true);
    }
    db.prepare(`UPDATE ai_memory SET private_to = NULL, shared_at = ?, author_id = COALESCE(author_id, ?), updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(stamp(), v.userId, v.name, r.id);
    return;
  }
  const author = authorOf(r);
  // like Aufgaben: it becomes private – for the person who wrote it, also when an admin flips it
  if (author == null || !(author === v.userId || v.admin)) throw new KnowledgeError(t('Only the person who wrote it can make it private.'), 403);
  db.prepare(`UPDATE ai_memory SET private_to = ?, author_id = ?, guests = 0, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(author, author, v.name, r.id);
}

export function updateEntry(id: number, p: PatchInput, v: KViewer): { entry: Entry; before: MemoryRow } {
  const r = mustSee(id, v, true);
  const before = { ...r };
  const cur = view(r, v);
  noSecrets(p.subject, p.property, p.value, p.text, p.note);
  const nextText = [p.subject ?? cur.subject, p.property ?? cur.property, p.value ?? cur.value, p.text ?? (cur.structured ? '' : cur.text), p.note !== undefined ? p.note : cur.note].filter(Boolean).join(' ');
  // newly health-related (and visible to the household): the household's consent first
  if (!r.sensitive && isSensitive(nextText)) consentFor(v, p.consent);
  db.transaction(() => {
    if (p.visibility) setVisibility(getMemory(id)!, p.visibility, v, p.consent);
    const renamed = p.subject !== undefined || p.subjectRef !== undefined || p.property !== undefined;
    if (renamed) {
      const s = p.subjectRef !== undefined || p.subject !== undefined ? resolveSubject(p.subject ?? null, p.subjectRef ?? null) : resolveSubject(cur.subject, r.subject_ref);
      const prop = clean(p.property ?? cur.property, 60);
      if (!s || !prop) throw new KnowledgeError(t('Who or what is it about?'));
      const val = clean(p.value ?? cur.value ?? cur.text, 120);
      db.prepare(`UPDATE ai_memory SET subject = ?, subject_ref = ?, property = ?, value = ?, text = ?, fact_key = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(
        s.name,
        s.ref,
        prop,
        val,
        entryText(s.name, prop, val),
        factKey(s.name, prop),
        v.name,
        id,
      );
    }
    if (p.value != null && !renamed) setEntryValue(getMemory(id)!, clean(p.value, 120), { by: v.name });
    if (p.text != null && !cur.structured && !renamed) setEntryValue(getMemory(id)!, clean(p.text, 300), { by: v.name });
    if (p.note !== undefined) db.prepare(`UPDATE ai_memory SET note = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(clean(p.note, 500) || null, v.name, id);
    const now2 = getMemory(id)!;
    const sens = isSensitive(`${now2.text} ${now2.note ?? ''}`);
    const guests = p.guests !== undefined ? p.guests : Boolean(now2.guests);
    db.prepare('UPDATE ai_memory SET sensitive = ?, guests = ? WHERE id = ?').run(sens ? 1 : 0, guests && now2.private_to == null && !sens ? 1 : 0, id);
  })();
  emit('settings');
  return { entry: view(getMemory(id)!, v), before };
}

/** Put an earlier value back (the current one goes into the history, so this can be undone the same way). */
export function restoreFromHistory(id: number, i: number, v: KViewer): { entry: Entry; before: MemoryRow } {
  const r = mustSee(id, v, true);
  const h = view(r, v).history.find((x) => x.i === i);
  if (!h) throw new KnowledgeError(t('Not found'), 404);
  const before = { ...r };
  const isFact = Boolean((r.subject && r.property) || factOf(r.text));
  const value = h.value ?? factOf(h.text)?.value ?? null;
  if (isFact && value) setEntryValue(r, value, { by: v.name });
  else {
    db.prepare(`UPDATE ai_memory SET text = ?, history = ?, sensitive = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(
      h.text,
      JSON.stringify([...historyOf(r), { text: r.text, value: r.value ?? null, until: stamp().slice(0, 10), at: stamp(), by: v.name }].slice(-10)),
      isSensitive(h.text) ? 1 : 0,
      v.name,
      id,
    );
    emit('settings');
  }
  return { entry: view(getMemory(id)!, v), before };
}

/** Remove one earlier value from the history (a typo nobody needs to see again). */
export function removeHistoryEntry(id: number, i: number, v: KViewer): { entry: Entry; before: MemoryRow } {
  const r = mustSee(id, v, true);
  if (!view(r, v).history.some((x) => x.i === i)) throw new KnowledgeError(t('Not found'), 404);
  const h = historyOf(r);
  h.splice(i, 1);
  db.prepare('UPDATE ai_memory SET history = ? WHERE id = ?').run(JSON.stringify(h), id);
  emit('settings');
  return { entry: view(getMemory(id)!, v), before: { ...r } };
}

/** Delete an entry; the row comes back for the undo (the photo stays until the entry is really gone). */
export function deleteEntry(id: number, v: KViewer): MemoryRow {
  const r = mustSee(id, v, true);
  db.prepare('DELETE FROM ai_memory WHERE id = ?').run(id);
  emit('settings');
  return r;
}

export async function setPhoto(id: number, buf: Buffer, v: KViewer) {
  const r = mustSee(id, v, true);
  if (!looksLikeImage(buf)) throw new KnowledgeError(t('This is not a photo.'), 415);
  const path = await saveImage(buf, `m${id}`, 1400);
  db.prepare(`UPDATE ai_memory SET photo = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(path, v.name, id);
  if (r.photo && r.photo !== path) deleteImage(r.photo);
  emit('settings');
  return view(getMemory(id)!, v);
}

export function removePhoto(id: number, v: KViewer) {
  const r = mustSee(id, v, true);
  if (r.photo) deleteImage(r.photo);
  db.prepare(`UPDATE ai_memory SET photo = NULL, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(v.name, id);
  emit('settings');
  return view(getMemory(id)!, v);
}

// ------------------------------------------------------------------ "Schreib es ToHuus" without AI

/** properties people write about – to tell "Zählernummer Strom" (property first) from "Rollo Wohnzimmer" (no property) */
const PROPS = [
  'Schuhgröße', 'Kleidergröße', 'Konfektionsgröße', 'Hosengröße', 'Mützengröße', 'Handschuhgröße', 'Ringgröße', 'Körpergröße', 'Größe', 'Gewicht',
  'Maß', 'Maße', 'Breite', 'Höhe', 'Länge', 'Tiefe', 'Filtergröße', 'Filter', 'Zählernummer', 'Zählerstand', 'Seriennummer', 'Kundennummer', 'Vertragsnummer',
  'Modell', 'Typ', 'Telefon', 'Telefonnummer', 'Handynummer', 'Nummer', 'E-Mail', 'Adresse', 'Farbe', 'Farbton', 'Leuchtmittel', 'Glühbirne', 'Batterie', 'Akku',
  'Reifengröße', 'Reifen', 'Kennzeichen', 'Lieblingsfarbe',
  'shoe size', 'size', 'width', 'height', 'length', 'phone', 'model', 'serial number', 'meter number',
];
const PROP_FOLD = new Map(PROPS.map((p) => [fold(p), p]));
const ADJ: Record<string, string> = { breit: 'Breite', hoch: 'Höhe', lang: 'Länge', tief: 'Tiefe', gross: 'Größe', groß: 'Größe', schwer: 'Gewicht', wide: 'Width', high: 'Height', long: 'Length' };

const niceValue = (v: string) => v.replace(/(\d)\s*[xX*]\s*(\d)/g, '$1 × $2').trim();
export function guessProperty(value: string): string | null {
  if (/\d\s*(?:[×xX*])\s*\d/.test(value) || /\d\s*(?:cm|mm|m)\b/i.test(value)) return t('Measurements');
  if (/^(?:\+|0)[\d\s/()-]{5,}$/.test(value.trim())) return t('Phone');
  return null;
}

const valueToken = (w: string) => /\d/.test(w) || /^(?:xxs|xs|s|m|l|xl|xxl|xxxl)$/i.test(w) || /^\+\d/.test(w);
const FILLER = /^(?:die|der|das|den|dem|vom|von|im|in|am|beim|bei|für|fuer|unser|unsere|unseres|unseren|of|the|for|in)$/i;
const trimFiller = (ws: string[]) => {
  const out = [...ws];
  while (out.length && FILLER.test(out[0])) out.shift();
  while (out.length && FILLER.test(out[out.length - 1])) out.pop();
  return out;
};

export interface Draft {
  subject: string | null;
  subjectRef: string | null;
  property: string | null;
  value: string | null;
}

/** "Mira Schuhgröße 28", "Rollo Wohnzimmer 120 x 160", "Zählernummer Strom 1ESY123", "Rollo ist 125 breit" → a draft. Pure apart from the known subjects. */
export function parseStatement(input: string, subjects: Subject[] = knownSubjects({ products: true })): Draft | null {
  const s = input
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:bitte\s+)?(?:merk(?:e)?\s+dir|notier(?:e)?(?:\s+dir)?|schreib(?:e)?(?:\s+auf)?|remember(?:\s+that)?|note)[:,]?\s+/i, '')
    .replace(/[.!]+$/, '');
  if (!s) return null;
  const subjectOf = (name: string): { name: string; ref: string | null } => {
    const f = fold(name);
    const forms = f.endsWith('s') && f.length > 3 ? [f, f.slice(0, -1)] : [f];
    const hit = subjects.find((x) => forms.includes(fold(x.name)));
    return hit ? { name: hit.name, ref: hit.ref } : { name, ref: null };
  };
  const draft = (subject: string, property: string | null, value: string | null): Draft => {
    const sub = subjectOf(subject);
    return { subject: sub.name, subjectRef: sub.ref, property: property ? (PROP_FOLD.get(fold(property)) ?? property) : null, value: value ? niceValue(value) : null };
  };
  const f = factOf(s);
  if (f) return draft(f.subject, f.property, f.value);
  // "Rollo ist 125 breit", "Das Sofa ist 2,10 m lang"
  let m = s.match(/^(.+?)\s+(?:ist|sind|is|are)\s+(?:jetzt\s+|now\s+)?(\d[\d.,]*(?:\s*(?:cm|mm|m))?)\s+(breit|hoch|lang|tief|groß|gross|schwer|wide|high|long)$/i);
  if (m) return draft(trimFiller(m[1].split(' ')).join(' '), ADJ[m[3].toLowerCase()] ?? m[3], m[2]);
  // "Rollo Wohnzimmer: 120 x 160"
  let head: string[];
  let value: string;
  if ((m = s.match(/^(.+?)\s*[:=]\s*(.+)$/))) {
    head = m[1].split(' ');
    value = m[2];
  } else {
    const ws = s.split(' ');
    const i = ws.findIndex((w, k) => k > 0 && valueToken(w));
    if (i < 1) return null;
    head = ws.slice(0, i);
    value = ws.slice(i).join(' ');
  }
  head = trimFiller(head);
  if (!head.length || value.split(' ').length > 6) return null;
  // a known person, room or product at the start or the end; the rest is the property
  const names = subjects.map((x) => ({ x, ws: fold(x.name).split(' ') })).sort((a, b) => b.ws.length - a.ws.length);
  const fh = head.map(fold);
  const formsOf = (w: string) => (w.endsWith('s') && w.length > 3 ? [w, w.slice(0, -1)] : [w]);
  for (const { x, ws } of names) {
    const atStart = ws.every((w, k) => fh[k] !== undefined && (k < ws.length - 1 ? fh[k] === w : formsOf(fh[k]).includes(w)));
    const off = fh.length - ws.length;
    const atEnd = off >= 0 && ws.every((w, k) => fh[off + k] === w);
    if (atStart || atEnd) {
      const rest = trimFiller(atStart ? head.slice(ws.length) : head.slice(0, off));
      const prop = rest.join(' ') || guessProperty(value);
      return { subject: x.name, subjectRef: x.ref, property: prop ? (PROP_FOLD.get(fold(prop)) ?? prop) : null, value: niceValue(value) };
    }
  }
  // a property word in front ("Zählernummer Strom 1ESY…") or behind ("Heizung Filtergröße 16 x 20")
  const pi = fh.findIndex((w) => PROP_FOLD.has(w));
  if (pi >= 0 && head.length > 1) {
    const rest = trimFiller([...head.slice(0, pi), ...head.slice(pi + 1)]);
    if (rest.length) return draft(rest.join(' '), head[pi], value);
  }
  const guess = guessProperty(value);
  return draft(head.join(' '), guess, value);
}

const QUESTION = /\?$|^(?:welche[rsn]?|was|wie|wo|wann|wer|hat|haben|gibt|which|what|how|where|when|who|does|do)\b/i;
const DELETE = /^(?:bitte\s+)?(?:lösch(?:e|en)?|loesch(?:e|en)?|entfern(?:e|en)?|vergiss|delete|remove|forget)\s+(?:bitte\s+)?(.+)$/i;
const CORRECT = /^(?:bitte\s+)?(?:korrigier(?:e|en)?|korrektur|berichtig(?:e|en)?|änder(?:e|n)?|aender(?:e|n)?|correct|change)[:,]?\s+(.+)$/i;
const SHARE = /^(?:bitte\s+)?(?:mach\w*\s+)?(.+?)\s+(?:für alle|fuer alle|für den haushalt|fuer den haushalt|for everyone)(?:\s+sichtbar)?(?:\s+machen)?$/i;
const SHARE2 = /^(?:bitte\s+)?(?:teil\w*|share)\s+(.+?)(?:\s+mit (?:allen|dem haushalt)|\s+with everyone)?$/i;
const PRIVATE = /^(?:bitte\s+)?(?:mach\w*\s+)?(.+?)\s+(?:nur für mich|nur fuer mich|privat|only for me|private)(?:\s+machen)?$/i;

/** the visible entries a few words point to ("Miras Schuhgröße", "das Rollo-Maß") */
export function findEntries(text: string, v: KViewer, limit = 5): Entry[] {
  const q = text.replace(/[-–]/g, ' ').replace(/['’]s?\b/g, '');
  const all = rowsFor(v).map((r) => view(r, v));
  const ws = words(q).filter((w) => !/^(?:mass|masse|bitte|alle|sichtbar|wert|eintrag|entry|value)$/.test(w));
  if (!ws.length) return [];
  const score = (e: Entry) => {
    const hay = fold([e.subject, e.property, e.value, e.text].filter(Boolean).join(' '));
    return ws.filter((w) => hay.includes(w) || (w.length > 3 && w.endsWith('s') && hay.includes(w.slice(0, -1)))).length;
  };
  const scored = all.map((e) => ({ e, s: score(e) })).filter((x) => x.s > 0);
  const best = Math.max(0, ...scored.map((x) => x.s));
  return scored.filter((x) => x.s === best).slice(0, limit).map((x) => x.e);
}

export type SayResult =
  | { kind: 'saved'; entry: Entry; updated: boolean; before: MemoryRow | null }
  | { kind: 'answer'; entries: Entry[] }
  | { kind: 'confirm'; action: 'delete' | 'share' | 'private'; entries: Entry[] }
  | { kind: 'form'; draft: Draft & { text: string } };

/** One sentence from the "Schreib es ToHuus" field – understood without AI, or handed back as a form to fill in. */
export function say(text: string, v: KViewer, opts: { visibility?: Visibility; consent?: boolean; origin?: Origin } = {}): SayResult {
  const s = clean(text, 300).replace(/[.!]+$/, '');
  if (s.length < 2) throw new KnowledgeError(t('What should ToHuus remember?'));
  let m: RegExpMatchArray | null;
  if ((m = s.match(DELETE))) return { kind: 'confirm', action: 'delete', entries: findEntries(m[1], v) };
  if ((m = s.match(PRIVATE))) return { kind: 'confirm', action: 'private', entries: findEntries(m[1], v).filter((e) => e.may.makePrivate) };
  if ((m = s.match(SHARE) ?? s.match(SHARE2))) return { kind: 'confirm', action: 'share', entries: findEntries(m[1], v).filter((e) => e.may.share) };
  if (QUESTION.test(s)) return { kind: 'answer', entries: findEntries(s.replace(/\?$/, ''), v, 8) };
  const correct = s.match(CORRECT);
  const body = correct ? correct[1] : s;
  // "Mira hat jetzt 29": the one fact about Mira with a number gets the new value
  const vo = valueOnlyOf(body);
  if (vo) {
    const u = updateFactValue(vo.subject, vo.value, { viewer: v.userId, createdBy: v.name, includeSensitive: true });
    if (u && !('ambiguous' in u)) return { kind: 'saved', entry: view(u.row, v), updated: true, before: u.replaced };
  }
  const d = parseStatement(body);
  if (d?.subject && d.property && d.value) {
    if (correct) {
      // "Korrigier: Rollo ist 125 breit" – the entry that is meant, also when its subject is longer ("Rollo Erdgeschoss")
      const hits = rowsFor(v)
        .map((r) => view(r, v))
        .filter((e) => e.subject && e.property && fold(e.subject).includes(fold(d.subject!)) && fold(e.property) === fold(d.property!));
      if (hits.length === 1) {
        const { entry, before } = updateEntry(hits[0].id, { value: d.value }, v);
        return { kind: 'saved', entry, updated: true, before };
      }
    }
    const out = createEntry({ subject: d.subject, subjectRef: d.subjectRef, property: d.property, value: d.value, visibility: opts.visibility, consent: opts.consent, origin: opts.origin }, v);
    return { kind: 'saved', ...out };
  }
  return { kind: 'form', draft: { subject: d?.subject ?? null, subjectRef: d?.subjectRef ?? null, property: d?.property ?? null, value: d?.value ?? null, text: s } };
}

// ------------------------------------------------------------------ assistant tool (assistant-tools.ts runs it)

type Rec = (kind: string, summary: string, undo: unknown) => void;
type Ctx = { actor: string; userId: number | null; admin?: boolean; guest?: boolean; turnStart?: number };

export const KNOWLEDGE_TOOL_DEFS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'knowledge_change',
      description:
        'Household knowledge cards (subject · property: value). set: new or corrected value. delete, share (private → whole household), private (→ only the author): first call without confirm, ask, then confirm=true after the yes. Find the card by id or subject+property.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['set', 'delete', 'share', 'private'] },
          id: { type: 'integer' },
          subject: { type: 'string' },
          property: { type: 'string' },
          value: { type: 'string' },
          confirm: { type: 'boolean' },
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
  },
];
export const KNOWLEDGE_TOOLS = KNOWLEDGE_TOOL_DEFS.map((d) => d.function.name);

const pending = perHousehold(() => new Map<string, number>());
const PENDING_MS = 30 * 60_000;

function knowledgeChange(ctx: Ctx, a: any, record: Rec) {
  if (!ctx.userId || ctx.guest) return { error: 'Only household members can change this.' };
  const v: KViewer = { userId: ctx.userId, name: ctx.actor, admin: ctx.admin };
  const action = ['set', 'delete', 'share', 'private'].includes(a.action) ? (a.action as 'set' | 'delete' | 'share' | 'private') : null;
  if (!action) return { error: 'action: set, delete, share or private' };
  const subject = clean(a.subject, 80);
  const property = clean(a.property, 60);
  let target: Entry | undefined;
  if (Number.isInteger(a.id)) {
    try {
      target = getEntry(a.id, v);
    } catch {
      return { error: `No card ${a.id}.` };
    }
  } else if (subject) {
    const hits = findEntries(`${subject} ${property}`, v).filter((e) => !property || (e.property && fold(e.property) === fold(property)) || !e.property);
    if (hits.length > 1) return { ambiguous: hits.map((e) => ({ id: e.id, text: e.text })) };
    target = hits[0];
  }
  if (action === 'set') {
    const value = clean(a.value, 120);
    if (!value) return { error: 'value missing' };
    try {
      if (target) {
        const { entry, before } = updateEntry(target.id, target.structured || target.property ? { value } : { text: value }, v);
        record('remember', t('Updated: {text} (before: {old})', { text: entry.text, old: before.text }), { kind: 'restore_memory', rows: [before] });
        return { ok: true, id: entry.id, now: entry.text, before: before.text };
      }
      if (!subject || !property) return { error: 'Give subject and property for a new card.' };
      const out = createEntry({ subject, property, value, origin: 'assistant' }, v);
      record('remember', t('Remembered: {text}', { text: out.entry.text }), out.before ? { kind: 'restore_memory', rows: [out.before] } : { kind: 'forget', id: out.entry.id });
      return { ok: true, id: out.entry.id, now: out.entry.text, private: out.entry.visibility === 'me' };
    } catch (e) {
      const x = e as { code?: string; message?: string };
      if (x.code === 'health_consent') return { ok: false, hint: t('That sounds like health information. Please add it in the app under What ToHuus remembers; ToHuus asks there once whether it may store it.') };
      return { error: x.message ?? String(e) };
    }
  }
  if (!target) return { error: 'No matching card. Ask which one is meant.' };
  if (action === 'share' && !target.may.share) return { error: 'Only the person who wrote it can share it.' };
  if (action === 'private' && !target.may.makePrivate) return { error: 'Only the person who wrote it can make it private.' };
  if (action === 'share' && target.sensitive) return { error: 'Health information is shared only in the app, after a confirmation there.' };
  const key = `${ctx.userId}:${target.id}:${action}`;
  const asked = pending().get(key);
  const nowMs = Date.now();
  const turn = ctx.turnStart ?? nowMs;
  if (!(a.confirm === true && asked && asked < turn && nowMs - asked < PENDING_MS)) {
    pending().set(key, nowMs);
    return { needs_yes: true, would: action, card: { id: target.id, text: target.text, visible_to: target.visibility === 'me' ? 'only the author' : 'household' }, ask: 'Say what happens in one sentence and ask. Only after the yes in the next message call again with confirm=true.' };
  }
  pending().delete(key);
  if (action === 'delete') {
    const row = deleteEntry(target.id, v);
    record('forget', t('Forgotten: {text}', { text: row.text }), { kind: 'restore_memory', rows: [row] });
    return { ok: true, deleted: row.text };
  }
  const { entry, before } = updateEntry(target.id, { visibility: action === 'share' ? 'household' : 'me' }, v);
  record('remember', action === 'share' ? t('Visible to the whole household: {text}', { text: entry.text }) : t('Only for you now: {text}', { text: entry.text }), { kind: 'restore_memory', rows: [before] });
  return { ok: true, id: entry.id, visible_to: entry.visibility === 'me' ? 'only the author' : 'household' };
}

export function runKnowledgeTool(ctx: Ctx, name: string, a: any, record: Rec): unknown {
  if (name !== 'knowledge_change') return undefined;
  return knowledgeChange(ctx, a ?? {}, record);
}

/** test hook */
export const _resetKnowledgePending = () => pending().clear();
