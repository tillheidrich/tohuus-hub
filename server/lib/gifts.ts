/**
 * Plans as a gift (ToHuus Cloud, docs/cloud.md › "Gifts: beta plan and plan codes"). Cloud only.
 *
 * Two ways, both without any purchase:
 *
 * 1. **Beta gift** – runtime setting `beta.gift` = 'haushalt' | 'plus' (back office › Einstellungen). While it is set,
 *    every cloud household gets at least that plan (`planOf` in plans.ts). Switching it off falls back to what each
 *    household has on its own (trial, code, App Store, Free) – nothing is deleted.
 * 2. **Plan codes** – the operator creates codes in the back office (plan Haushalt or Plus, for N days or for good,
 *    optional number of uses and last day). An admin of a household redeems one **on the web** (Settings › Abo ›
 *    "Code einlösen"). App Store Review Guideline 3.1.1 does not allow an iOS app to unlock features with its own
 *    codes, so the iPhone app has no field for it – it only shows the plan the household has (3.1.3(b)).
 *
 * Tables in accounts.db (created on first use):
 *   plan_codes             (id, code UNIQUE, plan, days NULL = for good, note, max_uses NULL = unlimited, uses,
 *                           expires_at, revoked_at, created_at, created_by)
 *   plan_code_redemptions  (code_id, household_id, at) – one redemption per code and household
 * A redeemed code sets the household's plan with plan_source 'code' (an App Store subscription that is still running
 * is never overwritten).
 */
import { config } from '../config.js';
import type { DB } from '../db.js';
import { t } from '../i18n.js';
import { accountsDb, getHousehold } from './accounts.js';
import { newCodeText, normCode } from './beta.js';
import { runtimeSetting } from './runtime-settings.js';

export type GiftPlan = 'haushalt' | 'plus';
export const GIFT_PLANS: GiftPlan[] = ['haushalt', 'plus'];

/** The plan every household gets during the beta, or null. */
export function betaGift(): GiftPlan | null {
  if (!config.multiTenant) return null;
  // back office first; the environment (BETA_GIFT) is the fallback so a fresh deploy can start with the gift on
  const v = runtimeSetting('beta.gift') ?? (process.env.BETA_GIFT ?? '').trim().toLowerCase();
  return v === 'haushalt' || v === 'plus' ? v : null;
}

const prepared = new WeakSet<DB>();
function gdb(): DB {
  const d = accountsDb();
  if (!prepared.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS plan_codes (
        id INTEGER PRIMARY KEY,
        code TEXT NOT NULL UNIQUE COLLATE NOCASE,
        plan TEXT NOT NULL CHECK (plan IN ('haushalt','plus')),
        days INTEGER,
        note TEXT,
        max_uses INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        revoked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_by TEXT
      );
      CREATE TABLE IF NOT EXISTS plan_code_redemptions (
        code_id INTEGER NOT NULL,
        household_id TEXT NOT NULL,
        at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (code_id, household_id)
      );`);
    prepared.add(d);
  }
  return d;
}

export interface PlanCode {
  id: number;
  code: string;
  plan: GiftPlan;
  /** null = for good ("lifetime") */
  days: number | null;
  note: string | null;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by: string | null;
}

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function createPlanCode(input: { plan: GiftPlan; days: number | null; note?: string | null; maxUses?: number | null; expiresAt?: string | null; code?: string | null }, by: string | null): PlanCode {
  // "GIFT-…" so nobody mixes them up with the beta access codes ("TOHU-…")
  const code = input.code ? normCode(input.code) : newCodeText().replace(/^TOHU-/, 'GIFT-');
  if (code.length < 6) throw new Error('code too short');
  const id = Number(
    gdb()
      .prepare('INSERT INTO plan_codes (code, plan, days, note, max_uses, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(code, input.plan, input.days, input.note?.trim() || null, input.maxUses ?? null, input.expiresAt ? `${input.expiresAt.slice(0, 10)} 23:59:59` : null, by).lastInsertRowid,
  );
  return gdb().prepare('SELECT * FROM plan_codes WHERE id = ?').get(id) as PlanCode;
}

export const listPlanCodes = () => gdb().prepare('SELECT * FROM plan_codes ORDER BY id DESC').all() as PlanCode[];
export const revokePlanCode = (id: number) => gdb().prepare(`UPDATE plan_codes SET revoked_at = COALESCE(revoked_at, datetime('now')) WHERE id = ?`).run(id).changes > 0;

export class GiftError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

const addDays = (from: string, days: number) => {
  const d = new Date(`${from.replace(' ', 'T')}Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().replace('T', ' ').slice(0, 19);
};

/**
 * Redeem a code for a household. Returns the new plan and until when (null = for good).
 * A household that already has the same or a longer gift keeps the longer one; the code is used either way.
 */
export function redeemPlanCode(householdId: string, raw: string): { plan: GiftPlan; until: string | null } {
  const code = normCode(raw);
  const c = gdb().prepare('SELECT * FROM plan_codes WHERE code = ?').get(code) as PlanCode | undefined;
  const n = now();
  if (!c || c.revoked_at || (c.expires_at && c.expires_at <= n)) throw new GiftError(404, t('This code doesn’t work (anymore). Check it or ask for a new one.'), 'gift.invalid');
  if (c.max_uses !== null && c.uses >= c.max_uses) throw new GiftError(410, t('This code has been used up.'), 'gift.used_up');
  if (gdb().prepare('SELECT 1 FROM plan_code_redemptions WHERE code_id = ? AND household_id = ?').get(c.id, householdId))
    throw new GiftError(409, t('Your household has already redeemed this code.'), 'gift.already');
  const h = getHousehold(householdId);
  if (!h) throw new GiftError(404, t('Household not found'), 'gift.household');
  const appleActive = h.plan_source === 'apple' && (h.plan === 'haushalt' || h.plan === 'plus') && (!h.plan_expires_at || h.plan_expires_at > n);
  if (appleActive)
    throw new GiftError(409, t('Your household has a subscription in the App Store. Cancel it there first (Settings › Apple ID › Subscriptions), then redeem the code.'), 'gift.apple');
  // the better of what the household already has as a gift and what the code gives
  const hasGift = (h.plan_source === 'code' || h.plan_source === 'operator') && (h.plan === 'haushalt' || h.plan === 'plus') && (!h.plan_expires_at || h.plan_expires_at > n);
  const rank = (p: string) => (p === 'plus' ? 2 : p === 'haushalt' ? 1 : 0);
  const plan: GiftPlan = hasGift && rank(h.plan) > rank(c.plan) ? (h.plan as GiftPlan) : c.plan;
  let until: string | null = c.days === null ? null : addDays(hasGift && h.plan_expires_at && h.plan_expires_at > n ? h.plan_expires_at : n, c.days);
  if (hasGift && h.plan_expires_at === null) until = null;
  const tx = gdb().transaction(() => {
    const used = gdb().prepare('UPDATE plan_codes SET uses = uses + 1 WHERE id = ? AND (max_uses IS NULL OR uses < max_uses)').run(c.id).changes;
    if (!used) throw new GiftError(410, t('This code has been used up.'), 'gift.used_up');
    gdb().prepare('INSERT INTO plan_code_redemptions (code_id, household_id) VALUES (?, ?)').run(c.id, householdId);
    gdb().prepare(`UPDATE households SET plan = ?, plan_source = 'code', plan_expires_at = ?, plan_product = NULL WHERE id = ?`).run(plan, until, householdId);
  });
  tx();
  return { plan, until };
}

/** What the household has as a gift right now (for /api/billing/status). */
export function giftOf(householdId: string): { kind: 'beta' | 'code' | 'operator'; plan: GiftPlan; until: string | null } | null {
  const h = getHousehold(householdId);
  const n = now();
  if (h && (h.plan_source === 'code' || h.plan_source === 'operator') && (h.plan === 'haushalt' || h.plan === 'plus') && (!h.plan_expires_at || h.plan_expires_at > n))
    return { kind: h.plan_source as 'code' | 'operator', plan: h.plan as GiftPlan, until: h.plan_expires_at };
  const b = betaGift();
  return b ? { kind: 'beta', plan: b, until: null } : null;
}
