/**
 * Error log (docs/error-log.md): server errors (every 500 with its reference code) and errors the apps report
 * (web crash card, uncaught errors, iPhone/Watch API and decoding errors) in one place, so a "Referenz 219017d1"
 * from a screenshot can be looked up – back office › Fehler (cloud) or Settings › Daten (self-hosted admins),
 * also as a download.
 *
 * Privacy: no request bodies, no list or receipt content. Messages and stacks are cut short and scrubbed of e-mail
 * addresses, tokens and long numbers; paths lose their query string and numeric ids become `:id`. The household is
 * kept as its id only (cloud). Entries are kept 30 days. The same error at the same place within an hour is one row
 * with a count.
 *
 * Storage: accounts.db in the cloud (encrypted), the household database when self-hosted.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db, type DB } from '../db.js';
import { accountsDb } from './accounts.js';
import { currentHousehold } from './tenancy.js';

export const SOURCES = ['server', 'web', 'ios', 'watch'] as const;
export type Source = (typeof SOURCES)[number];
const KEEP_DAYS = 30;

const prepared = new WeakSet<object>();
function ldb(): DB {
  const d = (config.multiTenant ? accountsDb() : db) as DB;
  if (!prepared.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS error_log (
        id INTEGER PRIMARY KEY,
        first_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_at TEXT NOT NULL DEFAULT (datetime('now')),
        count INTEGER NOT NULL DEFAULT 1,
        ref TEXT,
        source TEXT NOT NULL,
        kind TEXT,
        message TEXT NOT NULL,
        stack TEXT,
        route TEXT,
        status INTEGER,
        household_id TEXT,
        app_version TEXT,
        platform TEXT,
        fingerprint TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS error_log_last ON error_log(last_at);
      CREATE INDEX IF NOT EXISTS error_log_fp ON error_log(fingerprint, last_at);
      CREATE INDEX IF NOT EXISTS error_log_ref ON error_log(ref);`);
    prepared.add(d);
  }
  return d;
}

/** E-mail addresses, bearer/app tokens, long hex/base64 runs and long digit runs (card numbers, phone) go. */
export function scrub(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  return (
    String(s)
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
      .replace(/\b(sw_app_|sw_|sk-[a-z]*-?|Bearer\s+)[A-Za-z0-9_\-.]{8,}/g, '$1<token>')
      .replace(/\b[A-Fa-f0-9]{32,}\b/g, '<hex>')
      .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<token>')
      .replace(/\b\d{9,}\b/g, '<number>')
      .slice(0, max) || null
  );
}

/** "/api/recipes/12/image?x=1" → "/api/recipes/:id/image"; tokens in guest paths go too. */
export function cleanRoute(p: string | null | undefined): string | null {
  if (!p) return null;
  return (
    p
      .split('?')[0]
      .replace(/\/(g|guest|einladung|kids|mcp|q)\/[^/]+/g, '/$1/:token')
      .replace(/\/\d+(?=\/|$)/g, '/:id')
      .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, '/:uuid')
      .slice(0, 200) || null
  );
}

export interface ErrorInput {
  source: Source;
  message: string;
  stack?: string | null;
  kind?: string | null;
  route?: string | null;
  status?: number | null;
  ref?: string | null;
  appVersion?: string | null;
  platform?: string | null;
  householdId?: string | null;
}

let lastPrune = 0;

/** Store one error (never throws – logging must not break the request that failed). */
export function logError(e: ErrorInput): string | null {
  try {
    const d = ldb();
    const message = scrub(e.message, 500) ?? '(no message)';
    const route = cleanRoute(e.route);
    const stack = scrub(e.stack, 4000);
    const hh = e.householdId ?? (config.multiTenant ? (currentHousehold()?.id ?? null) : null);
    // same error at the same place = one row (the first line of the stack tells places apart)
    const fingerprint = crypto
      .createHash('sha1')
      .update([e.source, e.kind ?? '', message.replace(/\d+/g, '#'), route ?? '', (stack ?? '').split('\n')[1] ?? ''].join('|'))
      .digest('hex')
      .slice(0, 16);
    const same = d.prepare(`SELECT id FROM error_log WHERE fingerprint = ? AND last_at > datetime('now', '-1 hour') ORDER BY id DESC LIMIT 1`).get(fingerprint) as { id: number } | undefined;
    if (same && !e.ref) {
      d.prepare(`UPDATE error_log SET count = count + 1, last_at = datetime('now') WHERE id = ?`).run(same.id);
    } else {
      d.prepare(
        `INSERT INTO error_log (ref, source, kind, message, stack, route, status, household_id, app_version, platform, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(e.ref ?? null, e.source, scrub(e.kind, 60), message, stack, route, e.status ?? null, hh, scrub(e.appVersion, 40), scrub(e.platform, 80), fingerprint);
    }
    if (Date.now() - lastPrune > 3600_000) {
      lastPrune = Date.now();
      d.prepare(`DELETE FROM error_log WHERE last_at < datetime('now', ?)`).run(`-${KEEP_DAYS} days`);
    }
    return fingerprint;
  } catch (err) {
    console.error('[errorlog] could not store an error:', (err as Error).message);
    return null;
  }
}

export interface ErrorRow {
  id: number;
  first_at: string;
  last_at: string;
  count: number;
  ref: string | null;
  source: Source;
  kind: string | null;
  message: string;
  stack: string | null;
  route: string | null;
  status: number | null;
  household_id: string | null;
  app_version: string | null;
  platform: string | null;
}

export function listErrors(opts: { source?: string; q?: string; days?: number; limit?: number; householdId?: string | null } = {}) {
  const where: string[] = [`last_at > datetime('now', ?)`];
  const args: unknown[] = [`-${Math.min(KEEP_DAYS, Math.max(1, opts.days ?? 7))} days`];
  if (opts.source && (SOURCES as readonly string[]).includes(opts.source)) {
    where.push('source = ?');
    args.push(opts.source);
  }
  if (opts.q?.trim()) {
    const q = opts.q.trim().replace(/[%_]/g, '');
    where.push('(ref = ? OR message LIKE ? OR route LIKE ? OR household_id = ?)');
    args.push(q.toLowerCase(), `%${q}%`, `%${q}%`, q);
  }
  if (opts.householdId !== undefined) {
    where.push('household_id IS ?');
    args.push(opts.householdId);
  }
  const rows = ldb()
    .prepare(`SELECT id, first_at, last_at, count, ref, source, kind, message, stack, route, status, household_id, app_version, platform FROM error_log WHERE ${where.join(' AND ')} ORDER BY last_at DESC LIMIT ?`)
    .all(...args, Math.min(2000, Math.max(1, opts.limit ?? 200))) as ErrorRow[];
  const totals = ldb()
    .prepare(`SELECT source, SUM(count) AS n FROM error_log WHERE last_at > datetime('now', '-1 day') GROUP BY source`)
    .all() as { source: string; n: number }[];
  return { rows, last24h: Object.fromEntries(totals.map((t) => [t.source, t.n])) };
}

/** CSV for the download (Excel-safe: a leading = + - @ is quoted away). */
export function errorsCsv(rows: ErrorRow[]): string {
  const cols: (keyof ErrorRow)[] = ['last_at', 'first_at', 'count', 'source', 'ref', 'status', 'kind', 'route', 'message', 'app_version', 'platform', 'household_id', 'stack'];
  const cell = (v: unknown) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\r\n');
}
