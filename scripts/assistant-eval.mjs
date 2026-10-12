// Runs the assistant eval prompts (scripts/assistant-eval-cases.mjs) against a REAL configured model and prints
// each reply, the tools the model called and the actions – for reading by hand. Nothing leaves this machine except
// the model calls themselves; the household is a throw-away demo in a temp folder.
//
//   AI_API_KEY=sk-or-… npm run assistant-eval                         (OpenRouter → Mistral, the defaults)
//   AI_API_KEY=… AI_MODEL_TEXT=mistralai/mistral-small-2603 npm run assistant-eval -- pancake-evening
//
// Optional: LANGUAGE=en for English answers; pass case ids to run only those.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.AI_API_KEY && !process.env.AI_BASE_URL) {
  console.error('Set AI_API_KEY (and optionally AI_BASE_URL / AI_MODEL_TEXT) first.');
  process.exit(1);
}
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-eval-real-'));
process.env.LANGUAGE ??= 'de';

const { CASES } = await import('./assistant-eval-cases.mjs');
const dbm = await import('../server/db.ts');
const routes = path.join(path.dirname(new URL(import.meta.url).pathname), '../server/routes');
for (const f of fs.readdirSync(routes).filter((x) => x.endsWith('.ts'))) await import(path.join(routes, f));
const seed = await import('../server/seed.ts');
seed.ensureBaseData({ places: true });
dbm.setSetting('language', process.env.LANGUAGE);
seed.seedDemo({ force: true });
const auth = await import('../server/lib/auth.ts');
if (!dbm.db.prepare('SELECT 1 FROM users').get()) dbm.db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Till', 'admin', ?)`).run(auth.hashPassword('eval-pass-123'));
const user = dbm.db.prepare('SELECT id, name FROM users ORDER BY id LIMIT 1').get();

const ai = await import('../server/lib/ai.ts');
const assistant = await import('../server/lib/assistant.ts');
const only = new Set(process.argv.slice(2));
let calls = [];
// pass every request through, but note the tools the model called and the prompt size
ai.setAiFetch(async (url, init) => {
  const body = JSON.parse(String(init.body));
  const res = await fetch(url, init);
  const copy = res.clone();
  try {
    const j = await copy.json();
    for (const c of j.choices?.[0]?.message?.tool_calls ?? []) calls.push(`${c.function.name}(${c.function.arguments})`);
    calls.push(`· prompt ${j.usage?.prompt_tokens ?? '?'} tok, ${body.tools?.length ?? 0} tools`);
  } catch {
    /* not json */
  }
  return res;
});

for (const c of CASES) {
  if (only.size && !only.has(c.id)) continue;
  calls = [];
  const t0 = Date.now();
  try {
    const out = await assistant.chatOnce({ message: c.prompt, user: { userId: user.id, name: user.name } });
    console.log(`\n■ ${c.id} (${out.mode}, expected ${c.mode}, ${Date.now() - t0} ms)\n  > ${c.prompt}\n  < ${out.reply}`);
    for (const x of calls) console.log(`    ${x}`);
    for (const a of out.actions) console.log(`    ✓ ${a.kind}: ${a.summary}`);
  } catch (e) {
    console.log(`\n■ ${c.id} FAILED: ${e.message}`);
  }
}
