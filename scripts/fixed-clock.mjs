/**
 * A daytime clock for a local ToHuus server (21 Oct 2026, website screenshots showed "heute 02:22" when shot at night).
 *
 *   TOHUUS_CLOCK=10:30 node --import ./scripts/fixed-clock.mjs dist/server.mjs
 *
 * Moves the server's clock to today at that wall time in its timezone (TZ, default Europe/Berlin) and lets it keep
 * ticking from there: JavaScript's Date and SQLite's 'now' (datetime('now'), date('now'), julianday('now'), …, also in
 * column defaults), so stored times and the server's own logic (greeting, quiet hours, "today") agree. Only for
 * screenshots and local checks, never in production. scripts/site-shots.mjs --serve starts the server this way;
 * test/setup-env.ts uses it for TEST_CLOCK (TOHUUS_CLOCK_TZ = the zone of the wall time, TOHUUS_CLOCK_NEXT=1 = the next
 * time it is that late instead of today).
 */
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Milliseconds to add to the real clock so it reads `hhmm` today in `timeZone` – or, with `next`, at the next time
 * it is `hhmm` there (never backwards: certificates and tokens made by other tools with the real clock stay valid).
 */
export function clockOffset(hhmm, timeZone = 'Europe/Berlin', realNow = Date.now(), next = false) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`clock needs HH:MM, got "${hhmm}"`);
  const wall = (ms) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(ms))
        .map((x) => [x.type, Number(x.value)]),
    );
    return { p, asUtc: Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) };
  };
  const { p } = wall(realNow);
  let target = Date.UTC(p.year, p.month - 1, p.day, Number(m[1]), Number(m[2]));
  target -= wall(target).asUtc - target; // wall time in that zone → instant
  if (next && target <= realNow) {
    // same wall time a day later (recomputed, so a switch to or from summer time is respected)
    const t = wall(target + 36 * 3600_000).p;
    target = Date.UTC(t.year, t.month - 1, t.day, Number(m[1]), Number(m[2]));
    target -= wall(target).asUtc - target;
  }
  return target - realNow;
}

const CLOCK = process.env.TOHUUS_CLOCK;
if (CLOCK) {
  const RealDate = Date;
  const offset = clockOffset(CLOCK, process.env.TOHUUS_CLOCK_TZ || process.env.TZ || 'Europe/Berlin', Date.now(), process.env.TOHUUS_CLOCK_NEXT === '1');
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate;

  // SQLite's 'now' comes from the operating system, not from JavaScript: every connection gets its own date
  // functions that put the shifted time in for 'now' and let a plain in-memory connection do the rest.
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const Database = require('better-sqlite3');
  const prepare = Database.prototype.prepare;
  const exec = Database.prototype.exec;
  const aux = new Database(':memory:');
  const cache = new Map();
  const nowText = () => new RealDate(RealDate.now() + offset).toISOString().replace('T', ' ').replace('Z', '');
  const call = (name, args) => {
    const a = args.length === 0 ? [nowText()] : args.map((x) => (typeof x === 'string' && x.trim().toLowerCase() === 'now' ? nowText() : x));
    const key = `${name}/${a.length}`;
    if (!cache.has(key)) cache.set(key, prepare.call(aux, `SELECT ${name}(${a.map(() => '?').join(', ')})`).pluck());
    return cache.get(key).get(...a);
  };
  const ready = new WeakSet([aux]);
  const install = (db) => {
    if (ready.has(db)) return;
    ready.add(db);
    for (const name of ['datetime', 'date', 'time', 'julianday', 'unixepoch', 'strftime']) db.function(name, { varargs: true, deterministic: false }, (...args) => call(name, args));
  };
  Database.prototype.prepare = function (...args) {
    install(this);
    return prepare.apply(this, args);
  };
  Database.prototype.exec = function (...args) {
    install(this);
    return exec.apply(this, args);
  };
  if (process.env.TOHUUS_CLOCK_QUIET !== '1') console.log(`[fixed-clock] server clock at ${CLOCK} (${new ShiftedDate().toISOString()})`);
}
