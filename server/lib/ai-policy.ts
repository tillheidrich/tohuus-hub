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
 * The person/child are known from a small AsyncLocalStorage store that requireAuth (members) and the kid-tablet
 * router (children) fill; background jobs run without one and only the household switch applies.
 *
 * Only depends on db.ts (ai.ts and auth.ts import this file).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { db, getSetting, setSetting } from '../db.js';

export interface AiActor {
  userId?: number | null;
  kidId?: number | null;
}

const als = new AsyncLocalStorage<AiActor>();

/** Run `fn` (and everything async it starts) as this person/child. */
export function runAsAiActor<T>(actor: AiActor, fn: () => T): T {
  return als.run(actor, fn);
}
export const currentAiActor = (): AiActor | undefined => als.getStore();

export type AiOffReason = 'household' | 'person' | 'parents';

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
  return null;
}

export const aiAllowed = (actor?: AiActor) => aiOffReason(actor ?? als.getStore()) === null;
