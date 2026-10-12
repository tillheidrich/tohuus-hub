/**
 * ToHuus Cloud: the household database (`users.role`, `kind`, `guest_level`) is the source of truth for what a person
 * may do in a household; `memberships` in accounts.db only mirrors it for the household switcher. Everything that
 * changes a person's role or kind calls `syncMembership()`, and account-level routes (delete household, export,
 * account deletion) read the household row through `householdPerson()` instead of trusting the mirror.
 */
import { config } from '../config.js';
import { db } from '../db.js';
import * as accounts from './accounts.js';
import { currentHousehold, runInHousehold } from './tenancy.js';

export interface HouseholdPerson {
  role: 'admin' | 'member';
  kind: 'member' | 'guest';
  guest_level: string | null;
}

const rowOf = (userId: number) => db.prepare('SELECT role, kind, guest_level FROM users WHERE id = ?').get(userId) as HouseholdPerson | undefined;

/** The person's row inside a household (null when gone). */
export function householdPerson(householdId: string, userId: number): HouseholdPerson | null {
  return runInHousehold({ id: householdId, via: 'membership' }, () => rowOf(userId) ?? null);
}

/** A full admin of the household: admin role and not a permanent guest. */
export const isHouseholdAdmin = (p: HouseholdPerson | null) => Boolean(p && p.role === 'admin' && p.kind !== 'guest');

export const membershipRole = (p: HouseholdPerson): 'admin' | 'member' | 'guest' => (p.kind === 'guest' ? 'guest' : p.role === 'admin' ? 'admin' : 'member');

/** Mirror a changed role/kind/guest level into accounts.db (cloud only; inside the household's context). */
export function syncMembership(userId: number) {
  if (!config.multiTenant) return;
  const h = currentHousehold();
  if (!h) return;
  const p = rowOf(userId);
  if (!p) return;
  accounts
    .accountsDb()
    .prepare('UPDATE memberships SET role = ?, guest_level = ? WHERE household_id = ? AND user_id = ?')
    .run(membershipRole(p), p.kind === 'guest' ? p.guest_level : null, h.id, userId);
}
