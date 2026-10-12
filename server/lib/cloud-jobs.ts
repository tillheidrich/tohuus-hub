/**
 * Background jobs across households (ToHuus Cloud). Self-host: the job simply runs once (one household).
 *
 * Cloud: every job runs once per household, inside that household's context, one after the other with a small
 * random pause (jitter) so a thousand households don't hit the disk in the same second. A failing household is
 * logged (without data) and skipped.
 */
import { config } from '../config.js';
import { openHouseholdIds } from '../db.js';
import { activeHouseholds } from './accounts.js';
import { runInHousehold } from './tenancy.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ForEachOptions {
  /** 'open': only households whose database is open right now (minute ticks); 'active': used in the last `days` days */
  scope?: 'open' | 'active';
  days?: number;
  /** max pause between two households (ms) */
  jitterMs?: number;
  label?: string;
}

export async function forEachHousehold(fn: () => unknown, opts: ForEachOptions = {}): Promise<number> {
  if (!config.multiTenant) {
    await fn();
    return 1;
  }
  const ids = opts.scope === 'open' ? openHouseholdIds() : activeHouseholds(opts.days ?? 14).map((h) => h.id);
  let n = 0;
  for (const id of ids) {
    try {
      await runInHousehold({ id, via: `job:${opts.label ?? 'job'}` }, async () => fn());
      n++;
    } catch (e) {
      console.warn(`[${opts.label ?? 'job'}] household ${id.slice(0, 8)}: ${(e as Error).message}`);
    }
    const j = opts.jitterMs ?? (process.env.VITEST ? 0 : 250);
    if (j > 0) await sleep(Math.floor(Math.random() * j));
  }
  return n;
}
