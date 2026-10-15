/**
 * Who may use AI right now (task "AI on/off everywhere", 12 Oct 2026).
 *
 * Four switches, checked centrally by server/lib/ai.ts before ANY request to a model leaves the server:
 *   - household  `ai.enabled`   (setting, admin; default on – only meaningful when a model is configured)
 *   - person     `ai.mine`      (user_prefs of the signed-in member; default on; only that member changes it)
 *   - child      `kid_profiles.ai_off` (set by parents/admins; the kid tablet can never change it)
 *   - MCP        `mcp.enabled`  (setting, admin; default on) – the household's OWN assistants (Claude, ChatGPT …)
 *                reaching ToHuus through MCP. Independent from the built-in AI: no model is called for MCP.
 *
 * ToHuus Cloud also asks for consent (App Store guideline 5.1.2(i): personal data goes to a third-party AI only with
 * explicit permission): `ai.consent` in user_prefs per person, and `ai.consent` as a household setting (given by an
 * admin) for children and background jobs (receipts by mail). Without it the reason is 'consent'. Self-hosted
 * households choose their own model, so the switches above are enough there.
 *
 * The person/child are known from a small AsyncLocalStorage store that requireAuth (members) and the kid-tablet
 * router (children) fill; background jobs run without one and only the household switch applies.
 *
 * Only depends on db.ts (ai.ts and auth.ts import this file).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db.js';
import { currentHousehold } from './tenancy.js';

export interface AiActor {
  userId?: number | null;
  kidId?: number | null;
  /** the operator's own work in /betrieb (catalogue drafts): no household or personal data in the request */
  operator?: boolean;
}

const als = new AsyncLocalStorage<AiActor>();

/** Run `fn` (and everything async it starts) as this person/child. */
export function runAsAiActor<T>(actor: AiActor, fn: () => T): T {
  return als.run(actor, fn);
}
export const currentAiActor = (): AiActor | undefined => als.getStore();

export type AiOffReason = 'household' | 'person' | 'parents' | 'cloud' | 'consent';

/** Who receives the data when AI is used in ToHuus Cloud – shown in the consent text (keep in sync with ai.ts pin). */
export const AI_PROCESSOR = 'Mistral AI (EU)';
/**
 * The consent text names everyone who receives the data (App Store guideline 5.1.2(i)): Mistral runs the model, OpenRouter
 * routes the request (ai.ts). Same wording as the privacy policy (site/src/legal.mjs › "Sprachmodelle").
 */
export const aiProcessorLabel = (lang: string) =>
  lang === 'de' ? 'Mistral AI (Frankreich), vermittelt über OpenRouter (USA)' : 'Mistral AI (France), routed through OpenRouter (USA)';

/**
 * ToHuus Cloud: the operator can pause AI for the whole cloud (`/betrieb` › Einstellungen, runtime-settings.ts sets
 * `off`). Checked before every household switch – no model request leaves the server while it is off.
 */
export const cloudAiSwitch: { off: () => boolean } = { off: () => false };

export const householdAiOn = () => getSetting<boolean>('ai.enabled', true) !== false;
export const mcpOn = () => getSetting<boolean>('mcp.enabled', true) !== false;
export const setHouseholdAi = (on: boolean) => setSetting('ai.enabled', on);
export const setMcpOn = (on: boolean) => setSetting('mcp.enabled', on);

export function personAiOn(userId: number | null | undefined): boolean {
  if (!userId) return true;
  try {
    const row = db.prepare(`SELECT value FROM user_prefs WHERE user_id = ? AND key = 'ai.mine'`).get(userId) as { value: string } | undefined;
    return row ? JSON.parse(row.value) !== false : true;
  } catch {
    return true; // user_prefs not there yet (very first start)
  }
}

export function setPersonAi(userId: number, on: boolean) {
  db.prepare(
    `INSERT INTO user_prefs (user_id, key, value, updated_at) VALUES (?, 'ai.mine', ?, datetime('now'))
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(userId, JSON.stringify(on));
}

/** Consent is asked in ToHuus Cloud only. */
export const aiConsentRequired = () => config.multiTenant;

export function personAiConsent(userId: number | null | undefined): boolean {
  if (!userId) return false;
  try {
    const row = db.prepare(`SELECT value FROM user_prefs WHERE user_id = ? AND key = 'ai.consent'`).get(userId) as { value: string } | undefined;
    return Boolean(row && JSON.parse(row.value));
  } catch {
    return false;
  }
}

/** The household's consent (an admin agreed): children and background jobs. */
export const householdAiConsent = () => Boolean(getSetting<string | null>('ai.consent', null));

/** Agree (date of agreement is kept) or withdraw. An admin agreeing also agrees for the household. */
export function setAiConsent(userId: number, on: boolean, opts: { admin?: boolean } = {}) {
  const value = on ? JSON.stringify(new Date().toISOString()) : 'false';
  db.prepare(
    `INSERT INTO user_prefs (user_id, key, value, updated_at) VALUES (?, 'ai.consent', ?, datetime('now'))
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(userId, value);
  if (opts.admin) setSetting('ai.consent', on ? new Date().toISOString() : null);
}

/** The household's consent alone (tests, tools). */
export const setHouseholdAiConsent = (on: boolean) => setSetting('ai.consent', on ? new Date().toISOString() : null);

export function kidAiOn(kidId: number | null | undefined): boolean {
  if (!kidId) return true;
  try {
    const row = db.prepare('SELECT ai_off FROM kid_profiles WHERE id = ?').get(kidId) as { ai_off: number } | undefined;
    return !row?.ai_off;
  } catch {
    return true;
  }
}

/** Why AI is off for the current request, or null when the switches allow it (a model may still be missing). */
export function aiOffReason(actor: AiActor | undefined = als.getStore()): AiOffReason | null {
  try {
    if (cloudAiSwitch.off()) return 'cloud';
  } catch {
    /* settings not readable: the household switches decide */
  }
  let household = true;
  try {
    household = householdAiOn();
  } catch {
    // no household context (cloud sign-in page): nothing household-specific can be asked of a model there anyway
    return null;
  }
  if (!household) return 'household';
  if (actor?.kidId && !kidAiOn(actor.kidId)) return 'parents';
  if (actor?.userId && !personAiOn(actor.userId)) return 'person';
  // outside a household, or the operator's catalogue drafts in /betrieb: no household or personal data is involved
  if (aiConsentRequired() && currentHousehold() && !actor?.operator) {
    if (actor?.userId ? !personAiConsent(actor.userId) : !householdAiConsent()) return 'consent';
  }
  return null;
}

export const aiAllowed = (actor?: AiActor) => aiOffReason(actor ?? als.getStore()) === null;

// ------------------------------------------------------------------ health data per MCP connection

const healthAls = new AsyncLocalStorage<{ allowed: boolean }>();
/**
 * Run an MCP request of an OAuth connection: without the scope "mcp:health" (Allergien und Kinderdaten) the
 * household's health-data switch counts as off for everything this request does (people-signals.ts).
 */
export function runWithHealthScope<T>(allowed: boolean, fn: () => T): T {
  return healthAls.run({ allowed }, fn);
}
/** false when the current MCP connection was not granted health data */
export const healthScopeAllows = () => healthAls.getStore()?.allowed !== false;
