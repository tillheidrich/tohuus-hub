/**
 * The operator page of ToHuus Cloud (/betrieb). Contract and the exact list of what is counted: docs/cloud.md ›
 * "Operator page (/betrieb)".
 *
 * Who: accounts whose e-mail is in OPERATOR_EMAILS (comma separated), after a fresh password check (10 minutes).
 * What: aggregates only – never household content (no names of households or people, no lists, no receipts) and
 * nothing per person. Households appear by id only (storage top list, actions).
 * Counted here and nowhere else:
 *   - AI usage per day and model (requests, prompt/completion tokens) – no household, no person (ai_usage_daily)
 *   - HTTP requests and 5xx answers per hour, in memory since the last start (error rate)
 *   - operator actions (operator_audit): who, what, which household id, when
 * Everything else is read from tables that exist anyway (households, accounts.created_at, storage_bytes).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { accountsDb } from './accounts.js';
import { aiUsageHook, type Usage } from './ai.js';
import { s3Config } from './cloud-backup.js';

export const operatorEmails = (env = process.env) =>
  (env.OPERATOR_EMAILS ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'));
export const isOperatorEmail = (email: string | null | undefined) => Boolean(email && operatorEmails().includes(email.trim().toLowerCase()));

let ready = false;
function adb() {
  const d = accountsDb();
  if (!ready) {
    d.exec(`CREATE TABLE IF NOT EXISTS ai_usage_daily (
        day TEXT NOT NULL,
        model TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, model)
      );
      CREATE TABLE IF NOT EXISTS operator_audit (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL DEFAULT (datetime('now')),
        operator TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        detail TEXT
      );`);
    ready = true;
  }
  return d;
}
export const resetOperatorCache = () => {
  ready = false;
};

// ------------------------------------------------------------------ AI usage (no household, no person)

export function recordAiUsage(model: string, u: Usage, day = new Date().toISOString().slice(0, 10)) {
  adb()
    .prepare(
      `INSERT INTO ai_usage_daily (day, model, requests, prompt_tokens, completion_tokens) VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(day, model) DO UPDATE SET requests = requests + 1, prompt_tokens = prompt_tokens + excluded.prompt_tokens, completion_tokens = completion_tokens + excluded.completion_tokens`,
    )
    .run(day, model.slice(0, 120), u.prompt, u.completion);
}
if (config.multiTenant)
  aiUsageHook.record = (model, u) => {
    try {
      recordAiUsage(model, u);
    } catch (e) {
      console.warn('[operator] ai usage', (e as Error).message);
    }
  };

/** Price per million tokens [input, output]: AI_PRICES (JSON { model: [in, out] }) or AI_PRICE_PER_MTOK ("in,out"). */
export function priceOf(model: string, env = process.env): [number, number] {
  try {
    const per = JSON.parse(env.AI_PRICES || '{}') as Record<string, [number, number]>;
    if (Array.isArray(per[model]) && per[model].length === 2) return [Number(per[model][0]) || 0, Number(per[model][1]) || 0];
  } catch {
    /* ignore a broken AI_PRICES */
  }
  const [i, o] = (env.AI_PRICE_PER_MTOK || '0.1,0.3').split(',').map((x) => Number(x.trim()));
  return [Number.isFinite(i) ? i : 0, Number.isFinite(o) ? o : 0];
}

// ------------------------------------------------------------------ error rate (memory, hourly)

const hours = new Map<string, { total: number; errors: number }>();
const hourKey = (d = new Date()) => d.toISOString().slice(0, 13);
export function countRequest(status: number) {
  const k = hourKey();
  const b = hours.get(k) ?? { total: 0, errors: 0 };
  b.total++;
  if (status >= 500) b.errors++;
  hours.set(k, b);
  if (hours.size > 72) hours.delete([...hours.keys()].sort()[0]);
}
/** Express middleware: counts every /api answer (status class only – no path, no person, no household). */
export function requestCounter(_req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => countRequest(res.statusCode));
  next();
}

// ------------------------------------------------------------------ audit

export function audit(operator: string, action: string, target: string | null, detail: Record<string, unknown> | null = null) {
  adb().prepare('INSERT INTO operator_audit (operator, action, target, detail) VALUES (?, ?, ?, ?)').run(operator, action, target, detail ? JSON.stringify(detail) : null);
}
export const auditLog = (limit = 100) =>
  (adb().prepare('SELECT id, at, operator, action, target, detail FROM operator_audit ORDER BY id DESC LIMIT ?').all(limit) as { detail: string | null }[]).map((r) => ({
    ...r,
    detail: r.detail ? JSON.parse(r.detail) : null,
  }));

// ------------------------------------------------------------------ overview

function readStamp(file: string): { at: string | null; ok?: boolean; day?: string; [count: string]: unknown } {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const st = fs.statSync(file);
    if (raw.startsWith('{')) return { at: st.mtime.toISOString(), ...JSON.parse(raw) };
    return { at: st.mtime.toISOString(), day: raw };
  } catch {
    return { at: null };
  }
}

function memoryLimit(): number | null {
  for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const v = fs.readFileSync(f, 'utf8').trim();
      const n = Number(v);
      if (Number.isFinite(n) && n > 0 && n < 2 ** 50) return n;
    } catch {
      /* not in a cgroup */
    }
  }
  return null;
}

export function overview() {
  const d = adb();
  const one = <T>(sql: string, ...a: unknown[]) => d.prepare(sql).get(...a) as T;
  const all = <T>(sql: string, ...a: unknown[]) => d.prepare(sql).all(...a) as T[];
  const live = `deleted_at IS NULL`;
  const households = {
    total: one<{ n: number }>(`SELECT COUNT(*) n FROM households WHERE ${live}`).n,
    active7d: one<{ n: number }>(`SELECT COUNT(*) n FROM households WHERE ${live} AND last_active_at > datetime('now','-7 days')`).n,
    active30d: one<{ n: number }>(`SELECT COUNT(*) n FROM households WHERE ${live} AND last_active_at > datetime('now','-30 days')`).n,
    deletedTotal: one<{ n: number }>(`SELECT COUNT(*) n FROM households WHERE deleted_at IS NOT NULL`).n,
  };
  const accounts = one<{ n: number }>('SELECT COUNT(*) n FROM accounts').n;
  // ISO-ish week of the creation date, last 12 weeks
  const week = (col: string, table: string, extra = '') =>
    all<{ week: string; n: number }>(`SELECT strftime('%Y-W%W', ${col}) week, COUNT(*) n FROM ${table} WHERE ${col} > datetime('now','-84 days') ${extra} GROUP BY week ORDER BY week`);
  const signups = { accountsPerWeek: week('created_at', 'accounts'), householdsPerWeek: week('created_at', 'households') };
  const plans = all<{ plan: string; n: number }>(
    `SELECT CASE
       WHEN plan = 'trial' AND trial_ends_at > datetime('now') THEN 'trial'
       WHEN plan IN ('haushalt','plus') AND (plan_expires_at IS NULL OR plan_expires_at > datetime('now')) THEN plan
       ELSE 'free' END AS plan, COUNT(*) n
     FROM households WHERE ${live} GROUP BY 1 ORDER BY 1`,
  );
  const bySource = all<{ source: string; n: number }>(`SELECT plan_source source, COUNT(*) n FROM households WHERE ${live} AND plan IN ('haushalt','plus') GROUP BY 1`);
  const storage = {
    totalBytes: one<{ n: number | null }>(`SELECT SUM(storage_bytes) n FROM households WHERE ${live}`).n ?? 0,
    top: all<{ id: string; bytes: number }>(`SELECT id, storage_bytes bytes FROM households WHERE ${live} ORDER BY storage_bytes DESC LIMIT 10`),
  };
  const cost = (r: { model: string; prompt_tokens: number; completion_tokens: number }) => {
    const [pi, po] = priceOf(r.model);
    return (r.prompt_tokens * pi + r.completion_tokens * po) / 1e6;
  };
  const rows = all<{ day: string; model: string; requests: number; prompt_tokens: number; completion_tokens: number }>(
    `SELECT day, model, requests, prompt_tokens, completion_tokens FROM ai_usage_daily WHERE day >= date('now','-62 days') ORDER BY day`,
  );
  const perDay = new Map<string, { day: string; requests: number; tokens: number; cost: number }>();
  const perMonth = new Map<string, { month: string; requests: number; tokens: number; cost: number }>();
  for (const r of rows) {
    const dd = perDay.get(r.day) ?? { day: r.day, requests: 0, tokens: 0, cost: 0 };
    dd.requests += r.requests;
    dd.tokens += r.prompt_tokens + r.completion_tokens;
    dd.cost += cost(r);
    perDay.set(r.day, dd);
    const m = r.day.slice(0, 7);
    const mm = perMonth.get(m) ?? { month: m, requests: 0, tokens: 0, cost: 0 };
    mm.requests += r.requests;
    mm.tokens += r.prompt_tokens + r.completion_tokens;
    mm.cost += cost(r);
    perMonth.set(m, mm);
  }
  const round = <T extends { cost: number }>(x: T) => ({ ...x, cost: Math.round(x.cost * 10000) / 10000 });
  const hourly = [...hours.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hour, b]) => ({ hour, ...b }));
  const last24 = hourly.filter((h) => h.hour >= hourKey(new Date(Date.now() - 24 * 3600_000)));
  const sum = last24.reduce((a, h) => ({ total: a.total + h.total, errors: a.errors + h.errors }), { total: 0, errors: 0 });
  let disk: { totalBytes: number; freeBytes: number } | null = null;
  try {
    const st = fs.statfsSync(config.dataDir);
    disk = { totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize };
  } catch {
    disk = null;
  }
  const backupsDir = path.join(config.dataDir, 'backups');
  return {
    generatedAt: new Date().toISOString(),
    households,
    accounts,
    signups,
    plans,
    paidBySource: bySource,
    storage,
    ai: { currency: process.env.AI_PRICE_CURRENCY || 'USD', perDay: [...perDay.values()].map(round), perMonth: [...perMonth.values()].map(round) },
    errors: { last24h: { ...sum, rate: sum.total ? Math.round((sum.errors / sum.total) * 10000) / 100 : 0 }, hourly: last24, since: hourly[0]?.hour ?? null },
    backups: {
      lastNightly: readStamp(path.join(backupsDir, '.last-nightly')),
      lastRestoreCheck: readStamp(path.join(backupsDir, '.last-restore-check')),
      // images and receipt files to S3: counts only (households, uploaded, deleted, bytes, pending, errors)
      lastFileSync: readStamp(path.join(backupsDir, '.last-file-sync')),
      s3: Boolean(s3Config()),
    },
    system: {
      memory: { rssBytes: process.memoryUsage().rss, totalBytes: os.totalmem(), freeBytes: os.freemem(), limitBytes: memoryLimit() },
      disk,
      load: os.loadavg(),
      uptimeS: Math.round(process.uptime()),
      node: process.version,
    },
  };
}
