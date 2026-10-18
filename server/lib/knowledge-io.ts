/**
 * Haushaltswissen – import and export (18 Oct 2026, docs/knowledge.md › Import und Export).
 *
 * Import, fully without AI: Markdown (headings = subject, "- Key: Value" = one card, plain text = a note line;
 * Obsidian/Notion exports: front matter dropped, [[Links]] and [text](url) become text, #tags lose the #, Notion ids go,
 * tables read like CSV), plain text, CSV (delimiter detected; columns Thema/Eintrag/Wert/… in German or English, or
 * by position) and our own JSON export (round trip). Raw HTML never comes through (tags dropped, entities decoded to
 * plain text), and uploads are checked by their bytes (no binary/office/zip/image files, UTF-8 or UTF-16 or
 * Windows-1252, size and line limits).
 *
 * Two steps, stateless: previewImport (what would be created, updated, skipped – duplicates against the cards this
 * person sees and inside the file) and applyImport (the same file again, plus target, duplicate rule and the picked
 * rows). Health entries always stay private (never shared by an import), codes/passwords are refused like everywhere.
 *
 * Export: Markdown (readable, grouped by subject, importable again), CSV (Excel-friendly: BOM, ";" in German,
 * formula cells guarded) and JSON (with the history this person may see). Only what this person sees – never someone
 * else's private entries; guests only the entries marked for guests.
 */
import { db, lang } from '../db.js';
import { t } from '../i18n.js';
import { healthConsent, requireHealthConsent } from './health-consent.js';
import { isSensitive, type MemoryRow } from './memory.js';
import {
  createEntry,
  fold,
  updateEntry,
  groupEntries,
  KnowledgeError,
  listKnowledge,
  MAX_ROWS,
  parseStatement,
  resolveSubject,
  SECRET,
  type Entry,
  type KViewer,
  type Origin,
  type Visibility,
} from './knowledge.js';

export const IMPORT_LIMITS = { bytes: 512 * 1024, lines: 5000, entries: 200 } as const;
export const IMPORT_FORMATS = ['md', 'txt', 'csv', 'json'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];
export const EXPORT_FORMATS = ['md', 'csv', 'json'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ImportDraft {
  /** line in the file (1-based; JSON: position in the list) */
  line: number;
  subject: string | null;
  property: string | null;
  value: string | null;
  /** a plain line instead of subject/property/value */
  text: string | null;
  note: string | null;
  visibility?: Visibility;
  guests?: boolean;
}

export interface ParsedImport {
  format: ImportFormat;
  drafts: ImportDraft[];
  /** lines that were left out on purpose (code blocks, empty table rows …) */
  skipped: { line: number; reason: string }[];
  /** more than IMPORT_LIMITS.entries – the rest was cut */
  truncated: boolean;
}

const clip = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// ------------------------------------------------------------------ bytes → text (upload rules, SECURITY.md)

const EXT: Record<string, ImportFormat> = { md: 'md', markdown: 'md', mdown: 'md', mkd: 'md', txt: 'txt', text: 'txt', csv: 'csv', tsv: 'csv', json: 'json' };
const MIME_OK = /^(?:text\/[\w.+-]+|application\/(?:json|csv|x-csv|markdown|x-markdown|octet-stream|vnd\.ms-excel)|)$/i;

/** known binary signatures: PDF, ZIP/Office/Numbers, PNG, JPEG, GIF, WebP/RIFF, gzip, RTF, exe, ELF, bplist, SQLite, HEIC */
const MAGIC: (number[] | string)[] = ['%PDF', [0x50, 0x4b, 0x03, 0x04], [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], 'GIF8', 'RIFF', [0x1f, 0x8b], '{\\rtf', 'MZ', [0x7f, 0x45, 0x4c, 0x46], 'bplist', 'SQLite format', [0xd0, 0xcf, 0x11, 0xe0]];
const startsWith = (b: Buffer, sig: number[] | string) => {
  const bytes = typeof sig === 'string' ? [...Buffer.from(sig, 'latin1')] : sig;
  return b.length >= bytes.length && bytes.every((x, i) => b[i] === x);
};

/** the format by file name (or a sniff of pasted text); 415 for anything we do not read */
export function formatOf(name: string | null | undefined, sample = '', hint?: string | null): ImportFormat {
  if (hint && (IMPORT_FORMATS as readonly string[]).includes(hint)) return hint as ImportFormat;
  const ext = name?.toLowerCase().match(/\.([a-z]{2,8})$/)?.[1];
  if (ext) {
    const f = EXT[ext];
    if (!f) throw new KnowledgeError(t('ToHuus reads Markdown, text, CSV and JSON files.'), 415, 'type');
    return f;
  }
  const s = sample.trimStart();
  if (/^[[{]/.test(s)) return 'json';
  if (/^(?:---\s*$|#{1,6}\s|\s*[-*+]\s)/m.test(s)) return 'md';
  return 'txt';
}

/** A file's bytes → text: size, type, signature and encoding checked; never binary. */
export function decodeUpload(buf: Buffer, name?: string | null, mime?: string | null): { text: string; format: ImportFormat } {
  if (!buf.length) throw new KnowledgeError(t('The file is empty.'), 400, 'empty');
  if (buf.length > IMPORT_LIMITS.bytes) throw new KnowledgeError(t('The file is too big (at most {n} KB).', { n: IMPORT_LIMITS.bytes / 1024 }), 413, 'too_large');
  if (mime && !MIME_OK.test(mime.split(';')[0].trim())) throw new KnowledgeError(t('ToHuus reads Markdown, text, CSV and JSON files.'), 415, 'type');
  if (MAGIC.some((sig) => startsWith(buf, sig))) throw new KnowledgeError(t('ToHuus reads Markdown, text, CSV and JSON files.'), 415, 'type');
  let text: string;
  if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le');
  else if (buf[0] === 0xfe && buf[1] === 0xff) {
    const sw = Buffer.from(buf.subarray(2));
    sw.swap16();
    text = sw.toString('utf16le');
  } else {
    const body = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
    if (body.includes(0)) throw new KnowledgeError(t('ToHuus reads Markdown, text, CSV and JSON files.'), 415, 'type');
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      // Excel on Windows still writes CSV in Windows-1252
      text = new TextDecoder('windows-1252').decode(body);
    }
  }
  if (text.includes('\u0000')) throw new KnowledgeError(t('ToHuus reads Markdown, text, CSV and JSON files.'), 415, 'type');
  return { text, format: formatOf(name, text.slice(0, 400)) };
}

/** pasted or decoded text: control characters out, line limit */
export function checkText(text: string): string {
  const s = text.replace(/^\uFEFF/, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (!s.trim()) throw new KnowledgeError(t('The file is empty.'), 400, 'empty');
  if (Buffer.byteLength(s) > IMPORT_LIMITS.bytes) throw new KnowledgeError(t('The file is too big (at most {n} KB).', { n: IMPORT_LIMITS.bytes / 1024 }), 413, 'too_large');
  if (s.split(/\r\n|\r|\n/).length > IMPORT_LIMITS.lines) throw new KnowledgeError(t('That is too many lines (at most {n}).', { n: IMPORT_LIMITS.lines }), 413, 'too_many_lines');
  return s;
}

// ------------------------------------------------------------------ text → drafts

/** no raw HTML: comments, script/style blocks and tags go, entities become plain characters */
export function stripHtml(s: string): string {
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** inline Markdown (incl. Obsidian/Notion) → plain text */
export function inline(s: string): string {
  return stripHtml(s)
    .replace(/!\[\[[^\]]*\]\]/g, '') // Obsidian embeds
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => (b ?? a).trim())
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/\[\^[^\]]+\]/g, '') // footnotes
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=$|[\s).,;:!?])/g, '$1$2')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu, '$1$2') // #tags
    .replace(/\s+[0-9a-f]{32}$/i, '') // Notion page ids
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** headings that hold loose notes, not a subject ("Weiteres", "Notizen" – our own Markdown export uses them) */
const LOOSE = new Set(['weiteres', 'sonstiges', 'notizen', 'notiz', 'allgemein', 'inbox', 'notes', 'other', 'misc', 'general', 'haushaltswissen', 'household knowledge', 'was tohuus sich merkt', 'what tohuus remembers']);
const isLoose = (h: string) => LOOSE.has(fold(h));

/** "Schuhgröße: 28", "Schuhgröße:: 28" (Obsidian inline field), "Schuhgröße = 28", "Schuhgröße<TAB>28" */
function keyValue(s: string): { k: string; v: string } | null {
  const m = s.match(/^([^:=\t]{1,60}?)\s*(?:::?|=|\t)\s*(.+)$/);
  if (!m) return null;
  const k = m[1].trim();
  const v = m[2].trim();
  // not a time ("um 10:30"), a link or a sentence
  if (!k || !v || /^(?:https?|ftp|mailto|tel)$/i.test(k) || k.split(' ').length > 6 || /[.!?]$/.test(k) || (/\d$/.test(k) && /^\d/.test(v))) return null;
  return { k, v };
}

/** our own markers in a Markdown export: "_(nur für mich)_", "_(auch für Gäste)_" */
const MARK_ME = /\s*_?\((?:nur für mich|nur fuer mich|privat|only for me|private)\)_?\s*$/i;
const MARK_GUESTS = /\s*_?\((?:auch )?(?:für gäste|fuer gaeste|for guests(?: too)?)\)_?\s*$/i;
function marks(s: string) {
  let x = s;
  let visibility: Visibility | undefined;
  let guests: boolean | undefined;
  for (let i = 0; i < 2; i++) {
    if (MARK_ME.test(x)) {
      visibility = 'me';
      x = x.replace(MARK_ME, '');
    }
    if (MARK_GUESTS.test(x)) {
      guests = true;
      x = x.replace(MARK_GUESTS, '');
    }
  }
  return { s: x.trim(), visibility, guests };
}

/** one statement under an optional subject → a card or a plain line */
function draftOf(raw: string, subject: string | null, line: number): ImportDraft | null {
  const { s, visibility, guests } = marks(raw);
  if (s.length < 2) return null;
  const base = { line, note: null, ...(visibility ? { visibility } : {}), ...(guests ? { guests } : {}) };
  // our card text "Mika · Schuhgröße: 28"
  let m = s.match(/^(.{1,80}?)\s+·\s+(.{1,60}?):\s*(.+)$/);
  if (m) return { ...base, subject: m[1], property: m[2], value: m[3], text: null };
  const kv = keyValue(s);
  if (kv && subject) return { ...base, subject, property: kv.k, value: kv.v, text: null };
  if (subject) {
    // "Schuhgröße 28" under "## Mika"
    const d = parseStatement(`${subject} ${s}`);
    if (d?.subject && d.property && d.value && fold(d.subject) === fold(resolveSubject(subject)?.name ?? subject)) return { ...base, subject: d.subject, property: d.property, value: d.value, text: null };
    return { ...base, subject: null, property: null, value: null, text: `${subject}: ${s}` };
  }
  const d = parseStatement(s);
  if (d?.subject && d.property && d.value && !kv) return { ...base, subject: d.subject, property: d.property, value: d.value, text: null };
  if (kv) {
    // "Mika Schuhgröße: 28" – a known subject in front of the key
    const d2 = parseStatement(`${kv.k} ${kv.v}`);
    if (d2?.subject && d2.property && d2.value) return { ...base, subject: d2.subject, property: d2.property, value: d2.value, text: null };
  }
  return { ...base, subject: null, property: null, value: null, text: s };
}

/** a long paragraph → lines of at most 300 characters, cut at sentence ends */
function chunks(s: string, max = 300): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let cur = '';
  for (const sentence of s.split(/(?<=[.!?])\s+/)) {
    if ((cur + ' ' + sentence).trim().length > max && cur) {
      out.push(cur.trim());
      cur = '';
    }
    cur = `${cur} ${sentence}`.trim();
    while (cur.length > max) {
      out.push(cur.slice(0, max));
      cur = cur.slice(max).trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ------------------------------------------------------------------ CSV (and Markdown tables)

/** the delimiter with the most hits in the first line, outside quotes */
export function detectDelimiter(firstLine: string): string {
  let best = ',';
  let max = 0;
  for (const d of [';', ',', '\t', '|']) {
    let n = 0;
    let q = false;
    for (const c of firstLine) {
      if (c === '"') q = !q;
      else if (c === d && !q) n++;
    }
    if (n > max) {
      max = n;
      best = d;
    }
  }
  return best;
}

/** RFC 4180: quotes, doubled quotes, line breaks inside quotes */
export function splitCsv(text: string, delim: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  let line = 1;
  let start = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else {
        if (c === '\n') line++;
        cell += c;
      }
    } else if (c === '"' && cell.trim() === '') {
      q = true;
      cell = '';
    } else if (c === delim) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push({ cells: row, line: start });
      row = [];
      cell = '';
      line++;
      start = line;
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push({ cells: row, line: start });
  }
  return rows.filter((r) => r.cells.some((c) => c.trim()));
}

type Col = 'subject' | 'property' | 'value' | 'text' | 'note' | 'visibility' | 'guests';
const COLS: Record<string, Col> = {
  thema: 'subject', gegenstand: 'subject', subject: 'subject', bereich: 'subject', person: 'subject', wer: 'subject', topic: 'subject', kategorie: 'subject', category: 'subject', ort: 'subject', raum: 'subject',
  eintrag: 'property', eigenschaft: 'property', property: 'property', key: 'property', schlussel: 'property', feld: 'property', field: 'property', was: 'property', entry: 'property', name: 'property', bezeichnung: 'property',
  wert: 'value', value: 'value', inhalt: 'value', angabe: 'value',
  text: 'text', zeile: 'text', line: 'text', satz: 'text',
  notiz: 'note', note: 'note', notes: 'note', anmerkung: 'note', kommentar: 'note', comment: 'note', hinweis: 'note', beschreibung: 'note', description: 'note',
  sichtbarkeit: 'visibility', visibility: 'visibility', sichtbar: 'visibility', 'sichtbar fur': 'visibility', 'visible to': 'visibility',
  gaste: 'guests', guests: 'guests', 'fur gaste': 'guests', 'for guests': 'guests',
};
const headKey = (h: string) => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const colOf = (h: string) => COLS[headKey(h)] ?? null;
/** our export guards formula cells with a leading ' – take it off again */
const unguard = (s: string) => s.replace(/^'(?=[=+\-@\t\r])/, '').trim();
const yes = (s: string) => /^(?:ja|yes|true|wahr|1|x|✓)$/i.test(s.trim());
const visOf = (s: string): Visibility | undefined =>
  /^(?:nur ich|nur für mich|nur fuer mich|privat|private|me|only me|only for me)$/i.test(s.trim()) ? 'me' : /^(?:haushalt|household|alle|everyone|ganzer haushalt|geteilt|shared)$/i.test(s.trim()) ? 'household' : undefined;

function rowsToDrafts(rows: { cells: string[]; line: number }[], subjectAbove: string | null, out: ImportDraft[], skipped: ParsedImport['skipped']) {
  if (!rows.length) return;
  const head = rows[0].cells.map(colOf);
  const hasHeader = head.some((c) => c === 'subject' || c === 'property' || c === 'value' || c === 'text');
  const body = hasHeader ? rows.slice(1) : rows;
  for (const r of body) {
    const cells = r.cells.map((c) => inline(unguard(c)));
    const get = (c: Col) => {
      const i = head.indexOf(c);
      return hasHeader && i >= 0 ? (cells[i] ?? '') : '';
    };
    let subject = '';
    let property = '';
    let value = '';
    let text = '';
    let note = '';
    if (hasHeader) {
      subject = get('subject');
      property = get('property');
      value = get('value');
      text = get('text');
      note = get('note');
    } else if (cells.length >= 3) [subject, property, value, note = ''] = cells;
    else if (cells.length === 2) [property, value] = cells;
    else text = cells[0] ?? '';
    const vis = hasHeader ? visOf(get('visibility')) : undefined;
    const guests = hasHeader && yes(get('guests')) ? true : undefined;
    subject ||= subjectAbove ?? '';
    let d: ImportDraft | null;
    if (subject && property && value) d = { line: r.line, subject, property, value, text: null, note: note || null };
    else if (text) d = draftOf(text, subject || null, r.line);
    else if (property && value) d = draftOf(`${property}: ${value}`, subject || null, r.line);
    else if (subject && value) d = draftOf(`${subject} ${value}`, null, r.line);
    else d = null;
    if (!d) {
      skipped.push({ line: r.line, reason: 'empty' });
      continue;
    }
    if (note && !d.note) d.note = note;
    if (vis) d.visibility = vis;
    if (guests) d.guests = true;
    out.push(d);
  }
}

// ------------------------------------------------------------------ Markdown / text

function parseMarkdown(text: string, markdown: boolean): Omit<ParsedImport, 'format' | 'truncated'> {
  const lines = text.split(/\r\n|\r|\n/);
  const drafts: ImportDraft[] = [];
  const skipped: ParsedImport['skipped'] = [];
  let i0 = 0;
  // front matter (YAML --- or TOML +++) at the very top: metadata, not knowledge
  const fm = lines[0]?.trim();
  if (markdown && (fm === '---' || fm === '+++')) {
    const end = lines.findIndex((l, k) => k > 0 && k < 200 && (l.trim() === fm || (fm === '---' && l.trim() === '...')));
    if (end > 0) i0 = end + 1;
  }
  const heads: string[] = [];
  const subject = () => {
    const h = [...heads].reverse().find(Boolean) ?? null;
    return h && !isLoose(h) ? h : null;
  };
  let para: { s: string; line: number }[] = [];
  let last: ImportDraft | null = null;
  let table: { cells: string[]; line: number }[] = [];
  let code = false;
  const flushPara = () => {
    if (!para.length) return;
    const line = para[0].line;
    const s = inline(para.map((p) => p.s).join(' '));
    para = [];
    // the first line of our own Markdown export
    if (!s || /^(?:aus tohuus exportiert am|exported from tohuus on) \d{4}-\d\d-\d\d\.?$/i.test(s)) return;
    const sub = subject();
    // a single "Key: Value" line is a card, a paragraph is a note line
    if (keyValue(s) && s.length <= 200) {
      const d = draftOf(s, sub, line);
      if (d) drafts.push((last = d));
      return;
    }
    for (const c of chunks(sub ? `${sub}: ${s}` : s)) drafts.push((last = { line, subject: null, property: null, value: null, text: c, note: null }));
    last = null;
  };
  const flushTable = () => {
    if (!table.length) return;
    rowsToDrafts(table, subject(), drafts, skipped);
    table = [];
    last = null;
  };
  for (let i = i0; i < lines.length; i++) {
    const raw = lines[i];
    const line = i + 1;
    const tr = raw.trim();
    if (markdown && /^(```|~~~)/.test(tr)) {
      flushPara();
      flushTable();
      if (!code) skipped.push({ line, reason: 'code' });
      code = !code;
      continue;
    }
    if (code) continue;
    if (!tr) {
      flushPara();
      flushTable();
      // in a text file a "Mika:" heading lasts until the next empty line
      if (!markdown) heads.length = 0;
      continue;
    }
    let m: RegExpMatchArray | null;
    if (markdown && (m = tr.match(/^(#{1,6})\s+(.*?)\s*#*$/))) {
      flushPara();
      flushTable();
      const level = m[1].length;
      heads.length = level - 1;
      heads[level - 1] = inline(m[2]);
      last = null;
      continue;
    }
    // setext heading ("Mika" underlined with === or ---)
    if (markdown && /^(=+|-+)$/.test(tr) && para.length === 1) {
      const h = inline(para[0].s);
      para = [];
      const level = tr[0] === '=' ? 1 : 2;
      heads.length = level - 1;
      heads[level - 1] = h;
      continue;
    }
    if (/^([-*_])(?:\s*\1){2,}$/.test(tr)) {
      flushPara();
      flushTable();
      continue;
    }
    if (markdown && tr.startsWith('|')) {
      flushPara();
      const cells = tr.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) table.push({ cells, line });
      continue;
    }
    flushTable();
    // a text file: "Mika:" alone on a line is a heading
    if (!markdown && (m = tr.match(/^([^:]{1,60}):$/))) {
      flushPara();
      heads.length = 0;
      heads[0] = m[1].trim();
      continue;
    }
    const quote = tr.replace(/^(?:>\s?)+/, '').replace(/^\[![\w-]+\][+-]?\s*/, '');
    const li = raw.match(/^(\s*)(?:[-*+•]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (li) {
      const indent = li[1].replace(/\t/g, '  ').length;
      if (indent >= 2 && last) {
        // a nested point under a card: its note
        const n = inline(li[2]);
        if (n) last.note = clip(`${last.note ? `${last.note} ` : ''}${n}`, 500);
        continue;
      }
      flushPara();
      const d = draftOf(inline(li[2]), subject(), line);
      if (d) drafts.push((last = d));
      continue;
    }
    if (/^\s{2,}\S/.test(raw) && last && !para.length) {
      // indented line under a list point (our export puts the note there)
      const n = inline(tr);
      if (n) last.note = clip(`${last.note ? `${last.note} ` : ''}${n}`, 500);
      continue;
    }
    if (!quote) continue;
    // a short "Key: Value" line stands for itself (a card), also right before or after a paragraph
    const iq = inline(quote);
    const kvl = keyValue(iq);
    // a text file: every line stands for itself (a card or a note line)
    if ((kvl && kvl.v.length <= 120 && iq.length <= 160) || (!markdown && iq)) {
      flushPara();
      const d = draftOf(iq, subject(), line);
      if (d) drafts.push((last = d));
      continue;
    }
    para.push({ s: quote, line });
    last = null;
  }
  flushPara();
  flushTable();
  return { drafts, skipped };
}

// ------------------------------------------------------------------ JSON (our export, or a plain list)

function parseJson(text: string): Omit<ParsedImport, 'format' | 'truncated'> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new KnowledgeError(t('This JSON file cannot be read.'), 400, 'json');
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { entries?: unknown }).entries) ? (data as { entries: unknown[] }).entries : null;
  if (!list) throw new KnowledgeError(t('This JSON file cannot be read.'), 400, 'json');
  const drafts: ImportDraft[] = [];
  const skipped: ParsedImport['skipped'] = [];
  list.slice(0, IMPORT_LIMITS.lines).forEach((x, k) => {
    const line = k + 1;
    if (typeof x === 'string') {
      const d = draftOf(inline(x), null, line);
      return void (d ? drafts.push(d) : skipped.push({ line, reason: 'empty' }));
    }
    if (!x || typeof x !== 'object') return void skipped.push({ line, reason: 'empty' });
    const o = x as Record<string, unknown>;
    const s = (k2: string, max: number) => inline(clip(o[k2], max * 2)).slice(0, max);
    const subject = s('subject', 80) || s('thema', 80);
    const property = s('property', 60) || s('eintrag', 60);
    const value = s('value', 120) || s('wert', 120);
    const note = s('note', 500) || s('notiz', 500) || null;
    const vis = typeof o.visibility === 'string' ? (o.visibility === 'me' ? 'me' : o.visibility === 'household' ? 'household' : visOf(o.visibility)) : undefined;
    const guests = o.guests === true ? true : undefined;
    let d: ImportDraft | null;
    if (subject && property && value) d = { line, subject, property, value, text: null, note };
    else {
      const txt = s('text', 300);
      d = txt ? draftOf(txt, null, line) : null;
      if (d && note) d.note = note;
    }
    if (!d) return void skipped.push({ line, reason: 'empty' });
    if (vis) d.visibility = vis;
    if (guests) d.guests = true;
    drafts.push(d);
  });
  return { drafts, skipped };
}

/** text of a file (or pasted) → drafts */
export function parseImport(text: string, format: ImportFormat): ParsedImport {
  const s = checkText(text);
  let out: Omit<ParsedImport, 'format' | 'truncated'>;
  if (format === 'json') out = parseJson(s);
  else if (format === 'csv') {
    const firstLine = s.split(/\r\n|\r|\n/, 1)[0] ?? '';
    const drafts: ImportDraft[] = [];
    const skipped: ParsedImport['skipped'] = [];
    rowsToDrafts(splitCsv(s, detectDelimiter(firstLine)), null, drafts, skipped);
    out = { drafts, skipped };
  } else out = parseMarkdown(s, format === 'md');
  // value longer than a card holds: the rest goes into the note
  for (const d of out.drafts) {
    d.subject = d.subject ? clip(d.subject, 80) : null;
    d.property = d.property ? clip(d.property, 60) : null;
    if (d.value && d.value.length > 120) {
      d.note = clip(`${d.value.slice(120)}${d.note ? ` ${d.note}` : ''}`, 500);
      d.value = d.value.slice(0, 120).trim();
    }
    d.text = d.text ? clip(d.text, 300) : null;
  }
  const truncated = out.drafts.length > IMPORT_LIMITS.entries;
  return { format, drafts: out.drafts.slice(0, IMPORT_LIMITS.entries), skipped: out.skipped.slice(0, 50), truncated };
}

// ------------------------------------------------------------------ preview and apply

export type ImportAction = 'create' | 'update' | 'skip' | 'blocked';
export type DuplicateRule = 'update' | 'skip';

export interface PreviewItem {
  i: number;
  line: number;
  kind: 'card' | 'line';
  subject: string | null;
  /** the subject is a person, room or product the household already has */
  subjectKnown: boolean;
  property: string | null;
  value: string | null;
  text: string | null;
  note: string | null;
  visibility: Visibility;
  guests: boolean;
  sensitive: boolean;
  action: ImportAction;
  /** the value now (update) */
  before: string | null;
  /** existing entry (update / skip) */
  entryId: number | null;
  reason: 'unchanged' | 'exists' | 'twice' | 'secret' | 'limit' | 'health' | null;
}

export interface ImportPreview {
  format: ImportFormat;
  items: PreviewItem[];
  counts: Record<ImportAction, number>;
  skipped: ParsedImport['skipped'];
  truncated: boolean;
  /** how many new entries still fit (300 per household) */
  room: number;
  /** health-related lines: the household's consent is still missing (apply with consent=true) */
  needsHealthConsent: boolean;
}

export interface ImportOptions {
  target?: Visibility;
  onDuplicate?: DuplicateRule;
  consent?: boolean;
}

const cardKey = (subject: string, property: string) => `${fold(subject)}|${fold(property)}`;

export function previewImport(parsed: ParsedImport, v: KViewer, opts: ImportOptions = {}): ImportPreview {
  if (v.guest || (v.userId == null && !v.service)) throw new KnowledgeError(t('Only people who live here can change this.'), 403);
  const target: Visibility = v.userId == null ? 'household' : (opts.target ?? 'household');
  const rule: DuplicateRule = opts.onDuplicate ?? 'update';
  const existing = listKnowledge(v).entries;
  // the same subject and property (or the same line) is a duplicate whoever sees it – the one with the same visibility first
  const byKey = new Map<string, Entry[]>();
  const add = (k: string, e: Entry) => byKey.set(k, [...(byKey.get(k) ?? []), e]);
  for (const e of existing) {
    if (e.subject && e.property) add(cardKey(e.subject, e.property), e);
    add(`line:${fold(e.text)}`, e);
  }
  const hitFor = (k: string, vis: Visibility) => {
    const xs = byKey.get(k) ?? [];
    return xs.find((e) => e.visibility === vis) ?? xs[0];
  };
  let room = Math.max(0, MAX_ROWS - (db.prepare('SELECT COUNT(*) n FROM ai_memory').get() as { n: number }).n);
  const consented = Boolean(healthConsent()) || opts.consent === true;
  const seen = new Set<string>();
  let needsHealthConsent = false;
  const items: PreviewItem[] = parsed.drafts.map((d, i) => {
    const card = Boolean(d.subject && d.property && d.value);
    const s = card ? resolveSubject(d.subject) : null;
    const subject = s?.name ?? d.subject;
    const all = [subject, d.property, d.value, d.text, d.note].filter(Boolean).join(' ');
    const sensitive = isSensitive(all);
    // health information never becomes visible to everyone through an import
    const visibility: Visibility = v.userId == null ? 'household' : sensitive ? 'me' : (d.visibility ?? target);
    const item: PreviewItem = {
      i,
      line: d.line,
      kind: card ? 'card' : 'line',
      subject: card ? subject : null,
      subjectKnown: Boolean(s?.ref),
      property: card ? d.property : null,
      value: card ? d.value : null,
      text: card ? null : d.text,
      note: d.note,
      visibility,
      guests: Boolean(d.guests) && visibility === 'household' && !sensitive,
      sensitive,
      action: 'create',
      before: null,
      entryId: null,
      reason: null,
    };
    if (SECRET.test(all)) return { ...item, action: 'blocked', reason: 'secret' };
    if (sensitive && v.userId == null) return { ...item, action: 'blocked', reason: 'health' };
    if (sensitive && !consented) needsHealthConsent = true;
    const key = card ? cardKey(subject!, d.property!) : `line:${fold(d.text ?? '')}`;
    if (seen.has(key)) return { ...item, action: 'skip', reason: 'twice' };
    seen.add(key);
    const hit = hitFor(key, visibility);
    if (hit) {
      const same = card ? fold(hit.value ?? '') === fold(d.value ?? '') : true;
      if (same) return { ...item, action: 'skip', reason: 'unchanged', entryId: hit.id, before: hit.value ?? hit.text };
      // an update changes the card where it is (its visibility stays)
      return rule === 'update' ? { ...item, action: 'update', entryId: hit.id, before: hit.value, visibility: hit.visibility } : { ...item, action: 'skip', reason: 'exists', entryId: hit.id, before: hit.value };
    }
    if (room <= 0) return { ...item, action: 'blocked', reason: 'limit' };
    room--;
    return item;
  });
  const counts = { create: 0, update: 0, skip: 0, blocked: 0 } as Record<ImportAction, number>;
  for (const x of items) counts[x.action]++;
  return { format: parsed.format, items, counts, skipped: parsed.skipped, truncated: parsed.truncated, room: Math.max(0, room), needsHealthConsent };
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: { i: number; line: number; error: string }[];
  /** for the undo: new rows go, changed rows come back */
  createdIds: number[];
  before: MemoryRow[];
}

/**
 * Takes over what the preview shows (only the picked rows, when `pick` is given). Health-related rows without the
 * household's consent: `health: 'ask'` (apps) answers 409 health_consent like every other save, so the apps show their
 * consent sheet and send it again with consent=true; `skip` (assistant, MCP) leaves them out.
 */
export function applyImport(parsed: ParsedImport, v: KViewer, opts: ImportOptions & { pick?: number[]; origin?: Origin; health?: 'ask' | 'skip' } = {}): ImportResult & { preview: ImportPreview } {
  const preview = previewImport(parsed, v, opts);
  const pick = opts.pick ? new Set(opts.pick) : null;
  const wanted = (x: PreviewItem) => (x.action === 'create' || x.action === 'update') && (!pick || pick.has(x.i));
  if ((opts.health ?? 'ask') === 'ask' && opts.consent !== true && !healthConsent() && preview.items.some((x) => wanted(x) && x.sensitive)) requireHealthConsent({ by: `${v.name} (#${v.userId ?? '?'})` });
  const res: ImportResult = { created: 0, updated: 0, skipped: 0, failed: [], createdIds: [], before: [] };
  db.transaction(() => {
    for (const x of preview.items) {
      if ((x.action !== 'create' && x.action !== 'update') || (pick && !pick.has(x.i))) {
        res.skipped++;
        continue;
      }
      if (x.sensitive && !healthConsent() && opts.consent !== true) {
        res.failed.push({ i: x.i, line: x.line, error: t('That sounds like health information.') });
        continue;
      }
      try {
        if (x.action === 'update' && x.entryId != null) {
          const u = updateEntry(x.entryId, { value: x.value, ...(x.note ? { note: x.note } : {}), consent: x.sensitive ? true : undefined }, v);
          res.before.push(u.before);
          res.updated++;
          continue;
        }
        const out = createEntry(
          x.kind === 'card'
            ? { subject: x.subject, property: x.property, value: x.value, note: x.note, visibility: x.visibility, guests: x.guests, consent: x.sensitive ? true : undefined, origin: opts.origin ?? 'app' }
            : { text: x.text, note: x.note, visibility: x.visibility, guests: x.guests, consent: x.sensitive ? true : undefined, origin: opts.origin ?? 'app' },
          v,
        );
        if (out.before) {
          res.before.push(out.before);
          res.updated++;
        } else if (out.updated) res.skipped++;
        else {
          res.createdIds.push(out.entry.id);
          res.created++;
        }
      } catch (e) {
        res.failed.push({ i: x.i, line: x.line, error: (e as Error).message });
      }
    }
  })();
  return { ...res, preview };
}

// ------------------------------------------------------------------ export

const isCard = (e: Entry) => Boolean(e.subject && e.property && e.value);
const today = () => new Date().toISOString().slice(0, 10);

/** the entries to export: what this person sees, optionally only some ids or a search */
export function exportEntries(v: KViewer, f: { ids?: number[]; q?: string } = {}) {
  let entries = listKnowledge(v, { q: f.q }).entries;
  if (f.ids?.length) {
    const ids = new Set(f.ids);
    entries = entries.filter((e) => ids.has(e.id));
  }
  return entries;
}

const mdText = (s: string) => s.replace(/\s+/g, ' ').replace(/^([#>|])/, '\\$1').trim();

export function toMarkdown(entries: Entry[]): string {
  const out = [`# ${t('Household knowledge')}`, '', `_${t('Exported from ToHuus on {date}.', { date: today() })}_`, ''];
  const mark = (e: Entry) => `${e.visibility === 'me' ? ` _(${t('only for me')})_` : ''}${e.guests ? ` _(${t('for guests too')})_` : ''}`;
  const loose: Entry[] = [];
  for (const g of groupEntries(entries)) {
    const cards = g.entries.filter((e) => isCard(e) && g.title);
    loose.push(...g.entries.filter((e) => !(isCard(e) && g.title)));
    if (!cards.length) continue;
    out.push(`## ${mdText(g.title!)}`, '');
    for (const e of cards) {
      out.push(`- ${mdText(e.property!)}: ${mdText(e.value!)}${mark(e)}`);
      if (e.note) out.push(`  ${mdText(e.note)}`);
    }
    out.push('');
  }
  if (loose.length) {
    out.push(`## ${t('Notes')}`, '');
    for (const e of loose) {
      out.push(`- ${mdText(e.text)}${mark(e)}`);
      if (e.note) out.push(`  ${mdText(e.note)}`);
    }
    out.push('');
  }
  return out.join('\n');
}

/** a cell for Excel & co.: quoted when needed, formulas guarded (=, +, -, @ at the start) */
const csvCell = (s: string | null | undefined, delim: string) => {
  let x = (s ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@\t\r]/.test(x)) x = `'${x}`;
  return x.includes(delim) || x.includes('"') || /^\s|\s$/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
};

export function toCsv(entries: Entry[]): string {
  const delim = lang() === 'de' ? ';' : ',';
  const head = [t('Topic'), t('Entry'), t('Value'), 'Text', t('Note'), t('Visible to'), t('For guests'), t('Changed')];
  const rows = entries.map((e) => {
    const card = isCard(e);
    return [
      card ? e.subject : '',
      card ? e.property : '',
      card ? e.value : '',
      card ? '' : e.text,
      e.note ?? '',
      e.visibility === 'me' ? t('Only me') : t('Household'),
      e.guests ? t('yes') : '',
      (e.updatedAt ?? e.createdAt ?? '').slice(0, 10),
    ];
  });
  return '\uFEFF' + [head, ...rows].map((r) => r.map((c) => csvCell(c, delim)).join(delim)).join('\r\n') + '\r\n';
}

export function toJson(entries: Entry[]): string {
  return JSON.stringify(
    {
      format: 'tohuus-knowledge',
      version: 1,
      exported_at: new Date().toISOString(),
      entries: entries.map((e) => ({
        subject: isCard(e) ? e.subject : null,
        subject_kind: isCard(e) ? e.subjectKind : null,
        property: isCard(e) ? e.property : null,
        value: isCard(e) ? e.value : null,
        text: isCard(e) ? null : e.text,
        note: e.note,
        visibility: e.visibility,
        guests: e.guests,
        photo: Boolean(e.photo),
        created_at: e.createdAt,
        updated_at: e.updatedAt,
        // only the earlier values this person may see (a shared entry: from when it was shared)
        history: e.history.map((h) => ({ value: h.value ?? null, text: h.text, at: h.at ?? h.until, by: h.by ?? null })),
      })),
    },
    null,
    2,
  );
}

export function exportKnowledge(v: KViewer, format: ExportFormat, f: { ids?: number[]; q?: string } = {}) {
  const entries = exportEntries(v, f);
  const base = `${t('tohuus-knowledge')}-${today()}`;
  if (format === 'csv') return { filename: `${base}.csv`, mime: 'text/csv; charset=utf-8', body: toCsv(entries), count: entries.length };
  if (format === 'json') return { filename: `${base}.json`, mime: 'application/json; charset=utf-8', body: toJson(entries), count: entries.length };
  return { filename: `${base}.md`, mime: 'text/markdown; charset=utf-8', body: toMarkdown(entries), count: entries.length };
}

// ------------------------------------------------------------------ assistant and MCP: find, history, import a pasted note

type Rec = (kind: string, summary: string, undo: unknown) => void;
type Ctx = { actor: string; userId: number | null; admin?: boolean; guest?: boolean };

/** what the AI may read: health-related cards only when the household allowed sharing health data with AI */
export function findForAi(v: KViewer, f: { q?: string; id?: number; healthOk: boolean; limit?: number }) {
  let entries = f.id ? listKnowledge(v).entries.filter((e) => e.id === f.id) : listKnowledge(v, { q: f.q }).entries;
  const hidden = f.healthOk ? 0 : entries.filter((e) => e.sensitive).length;
  if (!f.healthOk) entries = entries.filter((e) => !e.sensitive);
  return {
    hidden_health_entries: hidden || undefined,
    entries: entries.slice(0, f.limit ?? 20).map((e) => ({
      id: e.id,
      subject: e.subject,
      property: e.property,
      value: e.value,
      text: isCard(e) ? undefined : e.text,
      note: e.note ?? undefined,
      visible_to: e.visibility === 'me' ? 'only the author' : 'household',
      for_guests: e.guests || undefined,
      changed: (e.updatedAt ?? e.createdAt)?.slice(0, 10),
      changed_by: e.updatedBy ?? e.author ?? undefined,
      // earlier values, newest first (a shared entry: only from when it was shared, unless it is your own)
      history: e.history.slice(0, 5).map((h) => ({ value: h.value ?? h.text, until: (h.at ?? h.until)?.slice(0, 10), by: h.by ?? undefined })),
    })),
  };
}

export const KNOWLEDGE_IO_TOOL_DEFS = [
  {
    type: 'function' as const,
    function: {
      name: 'knowledge_find',
      description:
        'Read household knowledge cards (sizes, measurements, numbers, notes): search by words or id. Each card comes with who sees it and its earlier values (history, newest first) – for "Was war … vorher?".',
      parameters: { type: 'object', properties: { query: { type: 'string' }, id: { type: 'integer' } }, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'knowledge_import',
      description:
        'Take over a pasted note or list into household knowledge – only when the person asks for it in this message ("nimm diese Notiz auf: …"). Headings become subjects, "Key: Value" lines cards, other text note lines. Duplicates are skipped or updated. only_me=true: only the person sees them.',
      parameters: { type: 'object', properties: { text: { type: 'string' }, only_me: { type: 'boolean' } }, required: ['text'], additionalProperties: false },
    },
  },
];
export const KNOWLEDGE_IO_TOOLS = KNOWLEDGE_IO_TOOL_DEFS.map((d) => d.function.name);

/** a pasted note → knowledge, with one undo for everything (assistant, MCP) */
export function importNote(v: KViewer, text: string, opts: { onlyMe?: boolean; origin: Origin }, record?: Rec) {
  const parsed = parseImport(text, formatOf(null, text.slice(0, 400)));
  if (!parsed.drafts.length) return { ok: false as const, error: 'Nothing to take over in this text.' };
  const out = applyImport(parsed, v, { target: opts.onlyMe ? 'me' : 'household', onDuplicate: 'update', origin: opts.origin, health: 'skip' });
  if ((out.created || out.updated) && record)
    record('remember', t('Imported: {n} new, {m} updated', { n: out.created, m: out.updated }), { kind: 'knowledge_import', created: out.createdIds, rows: out.before });
  const taken = out.preview.items.filter((x) => x.action === 'create' || x.action === 'update');
  return {
    ok: true as const,
    created: out.created,
    updated: out.updated,
    skipped: out.skipped,
    blocked: out.preview.items.filter((x) => x.action === 'blocked').map((x) => ({ line: x.line, why: x.reason })),
    failed: out.failed.length ? out.failed : undefined,
    examples: taken.slice(0, 5).map((x) => (x.kind === 'card' ? `${x.subject} · ${x.property}: ${x.value}` : x.text)),
    visible_to: opts.onlyMe ? 'only the author' : 'household (health-related lines stay private)',
  };
}

export function runKnowledgeIoTool(ctx: Ctx, name: string, a: any, record: Rec, healthOk: boolean): unknown {
  if (!KNOWLEDGE_IO_TOOLS.includes(name)) return undefined;
  const v: KViewer = { userId: ctx.userId, name: ctx.actor, admin: ctx.admin, guest: ctx.guest };
  if (name === 'knowledge_find') return findForAi(v, { q: typeof a?.query === 'string' ? a.query.slice(0, 120) : undefined, id: Number.isInteger(a?.id) ? a.id : undefined, healthOk });
  if (!ctx.userId || ctx.guest) return { error: 'Only household members can change this.' };
  const text = typeof a?.text === 'string' ? a.text : '';
  if (text.trim().length < 2) return { error: 'text missing' };
  try {
    return importNote(v, text.slice(0, 20_000), { onlyMe: a?.only_me === true, origin: 'assistant' }, record);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** "Was war Miras Schuhgröße vorher?" without a model */
export function historyAnswer(v: KViewer, what: string, healthOk: boolean): string {
  const found = findForAi(v, { q: what, healthOk, limit: 3 }).entries;
  // findEntries-like fallback: one word is often enough ("Rollo")
  const hits = found.length ? found : findForAi(v, { q: what.split(' ').sort((a, b) => b.length - a.length)[0], healthOk, limit: 3 }).entries;
  if (!hits.length) return t('I can’t find “{what}” in what ToHuus remembers.', { what });
  const e = hits[0];
  const now = e.subject && e.property ? `${e.subject} · ${e.property}: ${e.value}` : (e.text ?? '');
  if (!e.history.length) return t('{now} – no earlier value.', { now });
  const earlier = e.history.map((h) => (h.until ? t('{value} (until {day})', { value: h.value ?? '', day: h.until }) : (h.value ?? ''))).join(', ');
  return t('{now}. Before: {earlier}.', { now, earlier });
}
