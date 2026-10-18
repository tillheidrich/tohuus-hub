/**
 * What one assistant call sends to the model (18 Oct 2026, "KI-Kosten senken"): system prompt plus tool definitions,
 * measured for typical messages with a household that remembers a lot. Prints the sizes (chars, ≈ tokens at 4 chars)
 * and keeps them below fixed limits, so a new tool or context line can't quietly make every call more expensive.
 * Numbers before/after: docs/pricing.md › KI-Kosten.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-cost-'));
process.env.LANGUAGE = 'de';

let assistant: typeof import('../server/lib/assistant');
let ctxm: typeof import('../server/lib/assistant-context');
const user = { userId: 1, name: 'Till' };

const CASES: { msg: string; context: any }[] = [
  { msg: 'Haben wir noch Kaffee?', context: null },
  { msg: 'Was kochen wir heute?', context: 'cook' },
  { msg: 'Was steht diese Woche an?', context: 'tasks' },
  { msg: 'Leg Bad putzen auf Samstag', context: 'tasks' },
  { msg: 'Mach eine Aufgabe Fenster putzen jeden Monat', context: 'tasks' },
  { msg: 'Wer ist diese Woche mit dem Müll dran?', context: 'tasks' },
  { msg: 'Welche Schuhgröße hat Mika?', context: 'knowledge' },
];

beforeAll(async () => {
  const dbm = await import('../server/db');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  const auth = await import('../server/lib/auth');
  dbm.db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('test1234'));
  // a household that has told ToHuus a lot: 80 remembered things
  const memory = await import('../server/lib/memory');
  const kids = ['Mika', 'Mira', 'Sam', 'Jona'];
  const props = ['Schuhgröße', 'Jackengröße', 'Hosengröße', 'Mützengröße', 'Handschuhgröße'];
  let n = 0;
  for (const k of kids) for (const p of props) memory.remember({ text: `${k} hat ${p} ${28 + n++}`, scope: 'household' } as any);
  for (let i = 0; i < 60; i++) memory.remember({ text: `Notiz ${i}: Der Filter der Dunstabzugshaube ist ${20 + i} x 30 cm groß`, scope: 'household' } as any);
  assistant = await import('../server/lib/assistant');
  ctxm = await import('../server/lib/assistant-context');
}, 60_000);

describe('what one assistant call sends', () => {
  it('stays small per message and screen', () => {
    const rows: string[] = [];
    const checks: [string, number, number][] = [];
    for (const c of CASES) {
      const p = assistant.promptFor(c.msg, user, c.context);
      const toolChars = JSON.stringify(p.tools).length;
      const total = p.system.length + toolChars;
      rows.push(`${(c.context ?? '-').padEnd(9)} ${c.msg.padEnd(46)} system ${String(p.system.length).padStart(5)}  tools ${String(p.tools.length).padStart(2)} / ${String(toolChars).padStart(5)} chars  total ≈ ${Math.round(total / 4)} tokens`);
      checks.push([c.msg, p.tools.length, total]);
    }
    console.log(`\n${rows.join('\n')}\n`);
    for (const [msg, tools, total] of checks) {
      // before 18 Oct 2026: up to 14 tools and ~14 900 characters (≈ 3 700 tokens) on the tasks screen
      expect(tools, msg).toBeLessThanOrEqual(10);
      expect(total, msg).toBeLessThan(8000);
    }
  });

  it('the remembered line has a cap, the entries that fit the message first', () => {
    const p = assistant.promptFor('Welche Schuhgröße hat Mika?', user, 'knowledge');
    const line = p.system.split('\n').find((l) => l.startsWith('Remembered:')) ?? '';
    expect(line.length).toBeLessThanOrEqual(ctxm.MEMORY_LINE_MAX + 40);
    expect(line).toMatch(/Mika hat Schuhgröße/);
    expect(line).toMatch(/more remembered/);
  });
});
