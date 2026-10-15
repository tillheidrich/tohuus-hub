/**
 * Plans, entitlements, usage counters and the storage quota (docs/plan-2026-10-12.md, "Plans").
 *
 * Stable API for other modules (assistant, rhythm, money …):
 *   currentPlan()                     → 'free' | 'trial' | 'haushalt' | 'plus' | 'selfhost'
 *   limits()                          → Limits of the current household (historyDays null = unlimited)
 *   entitlement(name)                 → boolean feature switch of the current plan
 *   consume(kind, n = 1)              → { ok, remaining, throttled? } – counts and enforces a monthly/daily allowance
 *   checkStorage(bytesToAdd)          → { ok, usedBytes, quotaBytes }
 *   assertStorage(bytesToAdd)         → throws QuotaError (HTTP 413) when the upload does not fit
 *   trackStorage(deltaBytes)          → keep the household's storage counter in step with file writes/deletes
 * Self-host: everything unlimited (optional STORAGE_QUOTA_MB), nothing is counted in accounts.db.
 * All of them work inside the current household context (request or job).
 */
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { selfhostDbFile } from '../db.js';
import { t } from '../i18n.js';
import * as accounts from './accounts.js';
import { betaGift } from './gifts.js';
import { currentHousehold } from './tenancy.js';

export type Plan = 'free' | 'trial' | 'haushalt' | 'plus' | 'selfhost';
export const PLANS: Plan[] = ['free', 'trial', 'haushalt', 'plus', 'selfhost'];
export type UsageKind = 'assistant' | 'upload' | 'receiptAi' | 'importAi';

export interface Limits {
  /** how far back rhythm, "Das habt ihr noch", spending … look (null = full history) */
  historyDays: number | null;
  /** assistant messages per calendar month (null = unlimited) */
  assistantPerMonth: number | null;
  /** over the allowance the assistant is slowed down instead of blocked (Plus fair use) */
  assistantThrottleOnly: boolean;
  /** uploads (photos, receipt files, imports) per day – a rate limit, not a product limit */
  uploadsPerDay: number | null;
  /** AI receipt reads per day (receipts stay unlimited, only rate-limited) */
  receiptAiPerDay: number | null;
  /** AI recipe/product imports per day (link, text, photo) */
  importAiPerDay: number | null;
  /** storage quota in bytes (null = unlimited) */
  storageBytes: number | null;
  features: {
    fullHistory: boolean;
    priceHistory: boolean;
    connectedHouseholds: boolean;
    mirrorLists: boolean;
    importQuota: boolean;
    weekPlanFromPantry: boolean;
    monthlyAnalysis: boolean;
    substituteFromStock: boolean;
    /** ToHuus-Rezepte marked Plus (catalogue tier 'plus') */
    plusRecipes: boolean;
  };
}

const MB = 1024 * 1024;
const base = { fullHistory: false, priceHistory: false, connectedHouseholds: false, mirrorLists: false, importQuota: false, weekPlanFromPantry: false, monthlyAnalysis: false, substituteFromStock: false, plusRecipes: false };
const haushaltFeatures = { ...base, fullHistory: true, priceHistory: true, connectedHouseholds: true, mirrorLists: true, importQuota: true };
const plusFeatures = { ...haushaltFeatures, weekPlanFromPantry: true, monthlyAnalysis: true, substituteFromStock: true, plusRecipes: true };

export const PLAN_LIMITS: Record<Plan, Limits> = {
  // Free (15 Oct 2026, docs/pricing.md): the minimum, without any AI – list, tasks, Im Kopf, week plan and recipes by
  // hand, sharing. The assistant still understands simple commands without AI ("Milch auf die Liste"). Costs almost
  // nothing to run; the 14-day trial (Plus) starts with every new household.
  free: { historyDays: 30, assistantPerMonth: 0, assistantThrottleOnly: false, uploadsPerDay: 20, receiptAiPerDay: 0, importAiPerDay: 0, storageBytes: 100 * MB, features: base },
  haushalt: { historyDays: null, assistantPerMonth: 100, assistantThrottleOnly: false, uploadsPerDay: 200, receiptAiPerDay: 40, importAiPerDay: 40, storageBytes: 2048 * MB, features: haushaltFeatures },
  plus: { historyDays: null, assistantPerMonth: 1500, assistantThrottleOnly: true, uploadsPerDay: 300, receiptAiPerDay: 60, importAiPerDay: 100, storageBytes: 5120 * MB, features: plusFeatures },
  // the 14-day trial is Plus
  trial: { historyDays: null, assistantPerMonth: 1500, assistantThrottleOnly: true, uploadsPerDay: 300, receiptAiPerDay: 60, importAiPerDay: 100, storageBytes: 5120 * MB, features: plusFeatures },
  selfhost: {
    historyDays: null,
    assistantPerMonth: null,
    assistantThrottleOnly: false,
    uploadsPerDay: null,
    receiptAiPerDay: null,
    importAiPerDay: null,
    storageBytes: null,
    features: { ...plusFeatures },
  },
};

/**
 * Apple product ids → plan. Subscriptions in the group "ToHuus"; `plus.lifetime` is an optional non-consumable (Plus for
 * good, no expiry). It only shows up in the app once it exists in App Store Connect – nothing breaks without it.
 * Offer codes (beta testers) work for all of them: the redeemed purchase arrives as an ordinary transaction.
 */
export const LIFETIME_PRODUCT = 'de.heidrichdigital.tohuus.plus.lifetime';
export const APPLE_PRODUCTS: Record<string, { plan: 'haushalt' | 'plus'; period: 'monthly' | 'yearly' | 'lifetime'; price: string }> = {
  'de.heidrichdigital.tohuus.haushalt.monthly': { plan: 'haushalt', period: 'monthly', price: '3,99 €' },
  'de.heidrichdigital.tohuus.haushalt.yearly': { plan: 'haushalt', period: 'yearly', price: '34,99 €' },
  'de.heidrichdigital.tohuus.plus.monthly': { plan: 'plus', period: 'monthly', price: '5,99 €' },
  'de.heidrichdigital.tohuus.plus.yearly': { plan: 'plus', period: 'yearly', price: '59,99 €' },
  // price set in App Store Connect; the apps show the App Store price
  [LIFETIME_PRODUCT]: { plan: 'plus', period: 'lifetime', price: '' },
};

const cloud = () => config.multiTenant;
// accounts.ts opens accounts.db only in cloud mode; importing it in self-host is harmless
const acc = () => accounts;
const hid = () => {
  const c = currentHousehold();
  if (!c) throw Object.assign(new Error('no household context for plans'), { status: 401 });
  return c.id;
};

const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** The effective plan of the current household (expired trials and subscriptions fall back to Free). */
export function currentPlan(): Plan {
  if (!cloud()) return 'selfhost';
  return planOf(hid());
}

export function planOf(householdId: string): Plan {
  if (!cloud()) return 'selfhost';
  const h = acc().getHousehold(householdId);
  if (!h) return 'free';
  const own = ownPlan(h);
  // the beta gift (gifts.ts): at least that plan for everyone while it is switched on
  const gift = betaGift(householdId);
  return gift && PLAN_RANK[gift] > PLAN_RANK[own] ? gift : own;
}

/** trial counts like Plus (same limits); a gift of Plus during the beta replaces it */
const PLAN_RANK: Record<Plan, number> = { free: 0, haushalt: 1, trial: 2, plus: 3, selfhost: 4 };

function ownPlan(h: { plan: string; trial_ends_at: string | null; plan_expires_at: string | null }): Plan {
  const now = nowSql();
  if (h.plan === 'trial') return h.trial_ends_at && h.trial_ends_at > now ? 'trial' : 'free';
  if (h.plan === 'haushalt' || h.plan === 'plus') return !h.plan_expires_at || h.plan_expires_at > now ? h.plan : 'free';
  return 'free';
}

export function limits(): Limits {
  const p = currentPlan();
  const l = PLAN_LIMITS[p];
  if (p === 'selfhost' && config.storageQuotaMb > 0) return { ...l, storageBytes: config.storageQuotaMb * MB };
  return l;
}

export function entitlement(name: keyof Limits['features']): boolean {
  return Boolean(limits().features[name]);
}

const periodOf = (kind: UsageKind, d = new Date()) => (kind === 'assistant' ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10));
const allowance = (kind: UsageKind, l: Limits) =>
  kind === 'assistant' ? l.assistantPerMonth : kind === 'upload' ? l.uploadsPerDay : kind === 'importAi' ? l.importAiPerDay : l.receiptAiPerDay;

export interface ConsumeResult {
  ok: boolean;
  /** what is left in this period (Infinity = unlimited) */
  remaining: number;
  /** Plus fair use: over the allowance – allowed, but slow down */
  throttled?: boolean;
}

/** Count `n` uses of `kind` for the current household; refuses (ok: false) when the allowance is used up. */
export function consume(kind: UsageKind, n = 1): ConsumeResult {
  const l = limits();
  const max = allowance(kind, l);
  if (!cloud() || max === null) return { ok: true, remaining: Number.POSITIVE_INFINITY };
  const id = hid();
  const period = periodOf(kind);
  const used = acc().usageCount(id, kind, period);
  if (used + n <= max) {
    acc().usageAdd(id, kind, period, n);
    return { ok: true, remaining: max - used - n };
  }
  if (kind === 'assistant' && l.assistantThrottleOnly) {
    acc().usageAdd(id, kind, period, n);
    return { ok: true, remaining: 0, throttled: true };
  }
  return { ok: false, remaining: Math.max(0, max - used) };
}

/** Uses of `kind` in the current period (0 in self-host). */
export function usage(kind: UsageKind): number {
  if (!cloud()) return 0;
  return acc().usageCount(hid(), kind, periodOf(kind));
}

// ---------------------------------------------------------------- storage quota

export class QuotaError extends Error {
  status = 413;
  key = 'storage.full';
  constructor(
    public usedBytes: number,
    public quotaBytes: number,
  ) {
    super(t('The storage of this household is full ({used} of {quota} MB). Delete old photos or receipts, or choose a larger plan.', {
      used: Math.ceil(usedBytes / MB),
      quota: Math.round(quotaBytes / MB),
    }));
  }
  toJSON() {
    return { error: this.message, key: this.key, usedBytes: this.usedBytes, quotaBytes: this.quotaBytes };
  }
}

function dirBytes(dir: string): number {
  let n = 0;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) n += dirBytes(p);
    else if (e.isFile()) {
      try {
        n += fs.statSync(p).size;
      } catch {
        /* vanished */
      }
    }
  }
  return n;
}
const fileBytes = (f: string) => {
  try {
    return fs.statSync(f).size + (fs.existsSync(`${f}-wal`) ? fs.statSync(`${f}-wal`).size : 0);
  } catch {
    return 0;
  }
};

/** Bytes a household occupies on disk right now: database, images, receipt files (not backups). */
export function measureHouseholdBytes(householdId?: string): number {
  if (!cloud()) return fileBytes(selfhostDbFile()) + dirBytes(path.join(config.dataDir, 'images')) + dirBytes(path.join(config.dataDir, 'imports'));
  const dir = acc().householdDir(householdId ?? hid());
  return dirBytes(dir);
}

let selfhostUsed: { at: number; n: number } | null = null;
function usedBytes(): number {
  if (!cloud()) {
    if (!selfhostUsed || selfhostUsed.at < Date.now() - 60_000) selfhostUsed = { at: Date.now(), n: measureHouseholdBytes() };
    return selfhostUsed.n;
  }
  const id = hid();
  // files are counted on every write/delete; the database grows by itself and is measured
  return acc().storageBytes(id) + fileBytes(path.join(acc().householdDir(id), 'tohuus.db'));
}

export function checkStorage(bytesToAdd = 0): { ok: boolean; usedBytes: number; quotaBytes: number | null } {
  const quota = limits().storageBytes;
  if (quota === null) return { ok: true, usedBytes: cloud() ? usedBytes() : 0, quotaBytes: null };
  const used = usedBytes();
  return { ok: used + Math.max(0, bytesToAdd) <= quota, usedBytes: used, quotaBytes: quota };
}

/** Throws QuotaError (413) when `bytesToAdd` does not fit any more. Never deletes anything. */
export function assertStorage(bytesToAdd: number) {
  const s = checkStorage(bytesToAdd);
  if (!s.ok) throw new QuotaError(s.usedBytes, s.quotaBytes!);
}

/** Keep the household's file counter in step (call with +size after a write, -size after a delete). */
export function trackStorage(deltaBytes: number) {
  if (!deltaBytes) return;
  if (!cloud()) {
    if (selfhostUsed) selfhostUsed.n = Math.max(0, selfhostUsed.n + deltaBytes);
    return;
  }
  const c = currentHousehold();
  if (c) acc().addStorageBytes(c.id, deltaBytes);
}

/** Recount a household's files from disk (nightly; corrects drift). */
export function recountStorage(householdId: string) {
  if (!cloud()) return;
  const dir = acc().householdDir(householdId);
  const files = dirBytes(path.join(dir, 'images')) + dirBytes(path.join(dir, 'imports'));
  acc().setStorageBytes(householdId, files);
}

/**
 * The database counts as well (it is measured on every check): large JSON writes (bulk recipe imports, restores of
 * lists …) are refused with 413 when they would not fit any more. Small everyday writes (ticking, adding one item)
 * always go through, so a full household can still use its list and delete things.
 */
export function bodyQuota(req: Request, res: Response, next: NextFunction) {
  try {
    const len = Number(req.headers['content-length'] ?? 0);
    if (!['POST', 'PUT', 'PATCH'].includes(req.method) || !(len > 64 * 1024) || /multipart\/form-data/.test(String(req.headers['content-type'] ?? ''))) return next();
    if (cloud() && !currentHousehold()) return next();
    const s = checkStorage(len);
    if (!s.ok) return void res.status(413).json(new QuotaError(s.usedBytes, s.quotaBytes!).toJSON());
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * Middleware for every upload route (after multer): 413 when the files do not fit into the storage quota,
 * 429 when the daily upload allowance is used up. Self-host: only STORAGE_QUOTA_MB (if set) applies.
 */
export function uploadQuota(req: Request, res: Response, next: NextFunction) {
  try {
    const many = req.files ? (Array.isArray(req.files) ? req.files : Object.values(req.files).flat()) : [];
    const files = [...many, ...(req.file ? [req.file] : [])];
    // nothing can be stored without a household; the route itself answers the unauthenticated request
    if (!files.length || (cloud() && !currentHousehold())) return next();
    const bytes = files.reduce((a, f) => a + (f.size ?? f.buffer?.length ?? 0), 0);
    const s = checkStorage(bytes);
    if (!s.ok) return void res.status(413).json(new QuotaError(s.usedBytes, s.quotaBytes!).toJSON());
    if (!consume('upload', files.length).ok) return void res.status(429).json({ error: t('Too many uploads today – please try again tomorrow.'), key: 'uploads.daily' });
    next();
  } catch (e) {
    next(e);
  }
}
