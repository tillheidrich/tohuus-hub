/**
 * Haushaltswissen import/export (server/lib/knowledge-io.ts, docs/knowledge.md › Import und Export), the assistant
 * without a model (note import, history, share/private with a yes) and the MCP tools end to end (tools/list and
 * tools/call over HTTP: API token = household, OAuth = one member, mcp:read = read tools only, read-only household).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort } from './helpers/port';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-knowledge-io-'));
const PORT = await freePort();
const base = `http://localhost:${PORT}`;
process.env.DATA_DIR = dir;
process.env.BASE_URL = base;
process.env.LANGUAGE = 'de';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'VISION_BASE_URL', 'VISION_MODEL']) delete process.env[k];

let server: http.Server;
let db: typeof import('../server/db').db;
let io: typeof import('../server/lib/knowledge-io');
let kn: typeof import('../server/lib/knowledge');
let mcpToken = '';
let miraId = 0;
let samId = 0;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

class Client {
  cookie = '';
  async req(method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const isStr = typeof body === 'string';
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      headers: { ...(body === undefined || isForm ? {} : { 'content-type': isStr ? 'application/x-www-form-urlencoded' : 'application/json' }), cookie: this.cookie, origin: base, ...headers },
      body: body === undefined ? undefined : isForm || isStr ? (body as any) : JSON.stringify(body),
    });
    const sc = res.headers.getSetCookie();
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* a file */
    }
    return { status: res.status, json, text, headers: res.headers, location: res.headers.get('location'), www: res.headers.get('www-authenticate') };
  }
  chat = (message: string) => this.req('POST', '/api/assistant/chat', { message });
}
const mira = new Client(); // admin
const sam = new Client(); // member
const anon = new Client();

const fileForm = (name: string, content: string, type = 'text/markdown', extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.append('file', new Blob([content], { type }), name);
  for (const [k, v] of Object.entries(extra)) f.append(k, v);
  return f;
};

const mcp = (access: string | null, method = 'tools/list', params: unknown = {}) =>
  anon.req('POST', '/mcp', { jsonrpc: '2.0', id: 1, method, params }, { accept: 'application/json, text/event-stream', ...(access ? { authorization: `Bearer ${access}` } : {}) });
const toolNames = (r: any) => (r.json?.result?.tools ?? []).map((x: any) => x.name) as string[];
const callTool = async (access: string, name: string, args: unknown = {}) => {
  const r = await mcp(access, 'tools/call', { name, arguments: args });
  expect(r.status, r.text).toBe(200);
  const res = r.json.result;
  return { isError: Boolean(res.isError), data: JSON.parse(res.content[0].text) };
};

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
let clientId = '';
async function connect(c: Client, access: 'read' | 'write') {
  const p = pkce();
  const scope = 'mcp:read mcp:write';
  const page = await c.req('GET', `/oauth/authorize?${form({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: p.challenge, code_challenge_method: 'S256', state: 's', scope, resource: `${base}/mcp` })}`);
  expect(page.status, page.text.slice(0, 200)).toBe(200);
  const r = await c.req('POST', '/oauth/authorize', form({ client_id: clientId, redirect_uri: REDIRECT, state: 's', code_challenge: p.challenge, code_challenge_method: 'S256', response_type: 'code', scope, household: 'local', access, decision: 'allow' }));
  expect(r.status).toBe(302);
  const code = new URL(r.location!).searchParams.get('code')!;
  const t = await anon.req('POST', '/oauth/token', form({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: p.verifier }));
  expect(t.status, t.text).toBe(200);
  return t.json.access_token as string;
}

beforeAll(async () => {
  const dbm = await import('../server/db');
  db = dbm.db;
  const auth = await import('../server/lib/auth');
  (await import('../server/seed')).ensureBaseData();
  dbm.setSetting('language', 'de');
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  miraId = Number(db.prepare(`INSERT INTO users (name, role, password_hash, email, email_verified_at) VALUES ('Mira', 'admin', ?, 'mira@example.org', datetime('now'))`).run(auth.hashPassword('test1234')).lastInsertRowid);
  samId = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
  await import('../server/lib/kids');
  await import('../server/lib/people');
  db.prepare(`INSERT INTO kid_profiles (name) VALUES ('Mika')`).run();
  io = await import('../server/lib/knowledge-io');
  kn = await import('../server/lib/knowledge');
  const oauth = await import('../server/routes/oauth');
  const { handleMcp } = await import('../server/mcp/server');
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());
  app.use(oauth.pub);
  app.all('/mcp', handleMcp);
  app.use('/api', (await import('../server/routes/auth')).pub);
  app.use('/api', oauth.r);
  app.use('/api', (await import('../server/routes/core')).r);
  app.use('/api', (await import('../server/routes/assistant')).r);
  app.use('/api', (await import('../server/routes/knowledge')).r);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.name === 'ZodError' ? 400 : (err?.status ?? 500)).json({ error: String(err?.message ?? err) }));
  await new Promise<void>((r) => (server = app.listen(PORT, () => r())));
  for (const [c, n] of [
    [mira, 'Mira'],
    [sam, 'Sam'],
  ] as const)
    expect((await c.req('POST', '/api/auth/login', { name: n, password: 'test1234' })).status).toBe(200);
  mcpToken = auth.createApiToken('Assistent', 'mcp').token;
  const reg = await anon.req('POST', '/oauth/register', { client_name: 'Claude', redirect_uris: [REDIRECT] });
  expect(reg.status).toBe(201);
  clientId = reg.json.client_id;
});

afterAll(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ reading files (pure apart from known subjects)

const cards = (p: { drafts: any[] }) => p.drafts.map((d) => (d.text ? `line:${d.text}` : `${d.subject}|${d.property}|${d.value}${d.note ? `|${d.note}` : ''}${d.visibility ? `|${d.visibility}` : ''}`));

describe('reading Markdown, text, CSV and JSON', () => {
  it('Obsidian Markdown: front matter, headings, inline fields, notes, links, tags, no HTML', () => {
    const md = [
      '---',
      'tags: [haus]',
      'created: 2026-10-01',
      '---',
      '# Haushalt',
      '## Mika',
      '- Schuhgröße: 28',
      '- Kleidergröße:: 116',
      '  passt bis Frühling',
      '## Rollo Bad',
      'Maß: 65 x 140',
      'Gekauft bei [[Baumarkt Nord|dem Baumarkt]], siehe [Rechnung](https://example.org/r.pdf). <script>alert(1)</script> **wichtig** <b>fett</b>',
      '```',
      'code: ignoriert',
      '```',
      '## Notizen',
      '- Wir kaufen Brot beim Bäcker #einkauf',
      '- [ ] Treffen um 10:30 Uhr',
    ].join('\n');
    const p = io.parseImport(md, 'md');
    expect(cards(p)).toEqual([
      'Mika|Schuhgröße|28',
      'Mika|Kleidergröße|116|passt bis Frühling',
      'Rollo Bad|Maß|65 x 140',
      'line:Rollo Bad: Gekauft bei dem Baumarkt, siehe Rechnung. wichtig fett',
      'line:Wir kaufen Brot beim Bäcker einkauf',
      'line:Treffen um 10:30 Uhr',
    ]);
    expect(p.skipped).toEqual([{ line: 13, reason: 'code' }]);
    expect(JSON.stringify(p)).not.toMatch(/script|<b>|alert/);
  });

  it('Notion Markdown: page ids in headings, tables like CSV, setext headings', () => {
    const md = ['Sam 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d', '===', '', '| Eintrag | Wert |', '|---|---|', '| Schuhgröße | 41 |', '', '# Strom', '| Thema | Eintrag | Wert |', '| --- | --- | --- |', '| Gas | Zählernummer | 7GAS1 |'].join('\n');
    expect(cards(io.parseImport(md, 'md'))).toEqual(['Sam|Schuhgröße|41', 'Gas|Zählernummer|7GAS1']);
  });

  it('plain text: "Mika:" is a heading, sentences stay lines, the reader finds cards', () => {
    const txt = 'Mika:\nSchuhgröße: 28\nMützengröße 52\n\nRollo Erdgeschoss 120 x 160\nWir kaufen Brot beim Bäcker.';
    expect(cards(io.parseImport(txt, 'txt'))).toEqual(['Mika|Schuhgröße|28', 'Mika|Mützengröße|52', 'Rollo Erdgeschoss|Maß|120 × 160', 'line:Wir kaufen Brot beim Bäcker.']);
  });

  it('CSV: delimiter, quotes, German headers, formula guard, visibility; without header by position', () => {
    const csv = '\uFEFFThema;Eintrag;Wert;Notiz;Sichtbarkeit\r\nMika;Schuhgröße;28;"Winter; Stiefel ""weit""";Haushalt\r\nStrom;Zählernummer;\'=1ESY;;Nur ich\r\n;;;;\r\n';
    expect(cards(io.parseImport(csv, 'csv'))).toEqual(['Mika|Schuhgröße|28|Winter; Stiefel "weit"|household', 'Strom|Zählernummer|=1ESY|me']);
    expect(io.detectDelimiter('a\tb\tc')).toBe('\t');
    expect(cards(io.parseImport('Sam,Hosengröße,32\nWir kaufen Brot beim Bäcker\n', 'csv'))).toEqual(['Sam|Hosengröße|32', 'line:Wir kaufen Brot beim Bäcker']);
    expect(cards(io.parseImport('subject,property,value,text\nSam,Shoe size,41,\n,,,Bins go out on Sunday\n', 'csv'))).toEqual(['Sam|Shoe size|41', 'line:Bins go out on Sunday']);
  });

  it('JSON: our export format and plain lists; broken JSON is a clear error', () => {
    const j = JSON.stringify({ format: 'tohuus-knowledge', version: 1, entries: [{ subject: 'Mika', property: 'Schuhgröße', value: '28', visibility: 'me' }, { text: 'Wir kaufen Brot beim Bäcker', note: '<i>seit 2025</i>' }, 42] });
    const p = io.parseImport(j, 'json');
    expect(cards(p)).toEqual(['Mika|Schuhgröße|28|me', 'line:Wir kaufen Brot beim Bäcker']);
    expect(p.drafts[1].note).toBe('seit 2025');
    expect(p.skipped).toEqual([{ line: 3, reason: 'empty' }]);
    expect(cards(io.parseImport('["Mika Schuhgröße 28"]', 'json'))).toEqual(['Mika|Schuhgröße|28']);
    expect(() => io.parseImport('{nope', 'json')).toThrow(/JSON/);
  });

  it('limits: entries, lines, long values go into the note', () => {
    const many = Array.from({ length: 250 }, (_, i) => `- Ding ${i}: ${i}`).join('\n');
    const p = io.parseImport(`# Keller\n${many}`, 'md');
    expect(p.drafts.length).toBe(io.IMPORT_LIMITS.entries);
    expect(p.truncated).toBe(true);
    expect(() => io.parseImport('x\n'.repeat(io.IMPORT_LIMITS.lines + 5), 'txt')).toThrow(/zu viele Zeilen/);
    const long = io.parseImport(`# Mika\n- Wunsch: ${'a'.repeat(150)}`, 'md').drafts[0];
    expect(long.value!.length).toBe(120);
    expect(long.note!.length).toBe(30);
  });
});

describe('upload rules (bytes, type, size, encoding)', () => {
  const err = (f: () => unknown) => {
    try {
      f();
    } catch (e: any) {
      return { status: e.status, code: e.code };
    }
    return null;
  };
  it('refuses binary files by their bytes, whatever the name says', () => {
    expect(err(() => io.decodeUpload(Buffer.from('%PDF-1.7 …'), 'wissen.md', 'text/markdown'))).toEqual({ status: 415, code: 'type' });
    expect(err(() => io.decodeUpload(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'wissen.csv', 'text/csv'))).toEqual({ status: 415, code: 'type' });
    expect(err(() => io.decodeUpload(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), 'a.txt', 'text/plain'))).toEqual({ status: 415, code: 'type' });
    expect(err(() => io.decodeUpload(Buffer.from('abc\u0000def'), 'a.txt', 'text/plain'))).toEqual({ status: 415, code: 'type' });
    expect(err(() => io.decodeUpload(Buffer.from('# hi'), 'a.docx', null))).toEqual({ status: 415, code: 'type' });
    expect(err(() => io.decodeUpload(Buffer.from('# hi'), 'a.md', 'image/png'))).toEqual({ status: 415, code: 'type' });
    expect(err(() => io.decodeUpload(Buffer.alloc(io.IMPORT_LIMITS.bytes + 1, 0x61), 'a.txt', 'text/plain'))).toEqual({ status: 413, code: 'too_large' });
    expect(err(() => io.decodeUpload(Buffer.alloc(0), 'a.txt', 'text/plain'))).toEqual({ status: 400, code: 'empty' });
  });
  it('reads UTF-8 (with BOM), UTF-16 and Windows-1252 (Excel)', () => {
    expect(io.decodeUpload(Buffer.from('\uFEFFMika;Größe;28', 'utf8'), 'a.csv', 'text/csv')).toEqual({ text: 'Mika;Größe;28', format: 'csv' });
    expect(io.decodeUpload(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Mika: Größe', 'utf16le')]), 'a.txt', '').text).toBe('Mika: Größe');
    expect(io.decodeUpload(Buffer.from('Mika;Größe;28', 'latin1'), 'a.csv', 'application/vnd.ms-excel').text).toBe('Mika;Größe;28');
  });
});

// ------------------------------------------------------------------ preview, apply, undo, export over HTTP

describe('import and export over HTTP', () => {
  let samPrivate = 0;
  it('preview: what is new, what changes, what is there already – nothing written yet', async () => {
    const a = await mira.req('POST', '/api/knowledge', { subject: 'Mika', property: 'Schuhgröße', value: '27' });
    expect(a.status, a.text).toBe(200);
    await mira.req('POST', '/api/knowledge', { subject: 'Mika', property: 'Kleidergröße', value: '116' });
    const s = await sam.req('POST', '/api/knowledge', { subject: 'Sam', property: 'Hosengröße', value: '32', visibility: 'me' });
    samPrivate = s.json.entry.id;
    const before = (db.prepare('SELECT COUNT(*) n FROM ai_memory').get() as any).n;
    const md = '# Mika\n- Schuhgröße: 28\n- Kleidergröße: 116\n- Schuhgröße: 29\n# Haus\n- Alarmcode: 1234\n- Rollo Bad: 65 x 140\n';
    const p = await mira.req('POST', '/api/knowledge/import/preview', fileForm('wissen.md', md));
    expect(p.status, p.text).toBe(200);
    expect(p.json.items.map((x: any) => [x.action, x.reason])).toEqual([
      ['update', null],
      ['skip', 'unchanged'],
      ['skip', 'twice'],
      ['blocked', 'secret'],
      ['create', null],
    ]);
    expect(p.json.items[0]).toMatchObject({ subject: 'Mika', subjectKnown: true, before: '27', value: '28' });
    expect(p.json.counts).toEqual({ create: 1, update: 1, skip: 2, blocked: 1 });
    expect((db.prepare('SELECT COUNT(*) n FROM ai_memory').get() as any).n).toBe(before);
    // keep the old values instead
    const k = await mira.req('POST', '/api/knowledge/import/preview', fileForm('wissen.md', md, 'text/markdown', { onDuplicate: 'skip' }));
    expect(k.json.items[0]).toMatchObject({ action: 'skip', reason: 'exists' });
    // Sam's private card does not count as a duplicate for Mira – and never shows up in her preview
    const sp = await mira.req('POST', '/api/knowledge/import/preview', { text: '# Sam\n- Hosengröße: 32', format: 'md' });
    expect(sp.json.items[0]).toMatchObject({ action: 'create', entryId: null, before: null });
  });

  it('apply: only the picked rows, private when wanted, one undo for all of it', async () => {
    const md = '# Mika\n- Schuhgröße: 28\n# Haus\n- Rollo Bad: 65 x 140\n- Rollo Küche: 80 x 120\n';
    const r = await mira.req('POST', '/api/knowledge/import', fileForm('wissen.md', md, 'text/markdown', { pick: '[0,1]', target: 'me' }));
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ created: 1, updated: 1, skipped: 1, failed: [] });
    const list = (await mira.req('GET', '/api/knowledge?q=rollo')).json.entries;
    expect(list.map((e: any) => [e.subject, e.property, e.value, e.visibility, e.origin])).toEqual([['Haus', 'Rollo Bad', '65 x 140', 'me', 'app']]);
    // the update kept Mika's card where it was (household) and its history
    const mika = (await sam.req('GET', '/api/knowledge?subject=Mika&property=Schuhgröße')).json.entries[0];
    expect(mika).toMatchObject({ value: '28', visibility: 'household' });
    expect(mika.history[0]).toMatchObject({ value: '27' });
    expect((await sam.req('GET', '/api/knowledge?q=rollo')).json.entries).toEqual([]);
    // undo: the new card goes, the old value comes back
    const u = await mira.req('POST', `/api/assistant/undo/${r.json.undo}`);
    expect(u.json.ok).toBe(true);
    expect((await mira.req('GET', '/api/knowledge?q=rollo')).json.entries).toEqual([]);
    expect((await mira.req('GET', '/api/knowledge?subject=Mika&property=Schuhgröße')).json.entries[0].value).toBe('27');
  });

  it('health lines: consent first, then private – never shared by an import', async () => {
    const txt = 'Mika:\nAllergie: Erdnüsse\n';
    const p = await mira.req('POST', '/api/knowledge/import/preview', { text: txt, format: 'txt', target: 'household' });
    expect(p.json).toMatchObject({ needsHealthConsent: true, items: [{ sensitive: true, visibility: 'me', action: 'create' }] });
    const no = await mira.req('POST', '/api/knowledge/import', { text: txt, format: 'txt' });
    expect(no.status).toBe(409);
    expect(no.json.code).toBe('health_consent');
    const yes = await mira.req('POST', '/api/knowledge/import', { text: txt, format: 'txt', consent: true });
    expect(yes.json).toMatchObject({ created: 1 });
    expect((await mira.req('GET', '/api/knowledge?q=allergie')).json.entries[0]).toMatchObject({ visibility: 'me', sensitive: true });
    expect((await sam.req('GET', '/api/knowledge?q=allergie')).json.entries).toEqual([]);
  });

  it('bad uploads get clear answers', async () => {
    const pdf = await mira.req('POST', '/api/knowledge/import/preview', fileForm('wissen.md', '%PDF-1.4 x', 'application/pdf'));
    expect(pdf.status).toBe(415);
    const big = await mira.req('POST', '/api/knowledge/import/preview', fileForm('wissen.txt', 'a'.repeat(io.IMPORT_LIMITS.bytes + 10), 'text/plain'));
    expect(big.status).toBe(413);
    expect(big.json.code).toBe('too_large');
    expect((await mira.req('POST', '/api/knowledge/import/preview', { text: '   ' })).status).toBe(400);
    expect((await mira.req('POST', '/api/knowledge/import/preview', fileForm('w.docx', '# x', 'application/octet-stream'))).status).toBe(415);
  });

  it('export: Markdown, CSV, JSON – only what this person sees, importable again', async () => {
    await mira.req('POST', '/api/knowledge', { subject: 'Strom', property: 'Zählernummer', value: '=1ESY1160', note: 'Keller links' });
    await mira.req('POST', '/api/knowledge', { text: 'Wir kaufen Brot beim Bäcker' });
    const md = await mira.req('GET', '/api/knowledge/export?format=md');
    expect(md.status).toBe(200);
    expect(md.headers.get('content-type')).toMatch(/text\/markdown/);
    expect(md.headers.get('content-disposition')).toMatch(/attachment; filename="tohuus-wissen-\d{4}-\d\d-\d\d\.md"/);
    expect(md.text).toContain('## Mika\n\n- Allergie: Erdnüsse _(nur für mich)_\n- Kleidergröße: 116\n- Schuhgröße: 27');
    expect(md.text).toContain('- Zählernummer: =1ESY1160\n  Keller links');
    expect(md.text).toContain('## Notizen\n\n- Wir kaufen Brot beim Bäcker');
    expect(md.text).toMatch(/Allergie: Erdnüsse _\(nur für mich\)_/);
    expect(md.text).not.toContain('Hosengröße'); // Sam's private card
    // Sam: his own private card, not Mira's
    const sm = await sam.req('GET', '/api/knowledge/export?format=md');
    expect(sm.text).toContain('Hosengröße: 32 _(nur für mich)_');
    expect(sm.text).not.toContain('Erdnüsse');
    // CSV: Excel-friendly, formulas guarded
    const csv = await mira.req('GET', '/api/knowledge/export?format=csv');
    expect(csv.text.replace(/^\uFEFF/, '').startsWith('Thema;Eintrag;Wert;Text;Notiz;Sichtbar für;Für Gäste;Geändert')).toBe(true);
    expect(csv.text).toContain("Strom;Zählernummer;'=1ESY1160;;Keller links;Haushalt;;");
    // JSON with the history, and a selection by id
    const ids = (await mira.req('GET', '/api/knowledge?subject=Mika')).json.entries.map((e: any) => e.id);
    const js = await mira.req('GET', `/api/knowledge/export?format=json&ids=${ids.join(',')},${samPrivate}`);
    expect(js.json).toMatchObject({ format: 'tohuus-knowledge', version: 1 });
    expect(js.json.entries.map((e: any) => e.property).sort()).toEqual(['Allergie', 'Kleidergröße', 'Schuhgröße']);
    // round trip: everything is already there
    for (const [name, body] of [
      ['w.md', md.text],
      ['w.csv', csv.text],
      ['w.json', JSON.stringify(js.json)],
    ]) {
      const p = await mira.req('POST', '/api/knowledge/import/preview', fileForm(name, body, 'text/plain'));
      expect(p.status, `${name} ${p.text}`).toBe(200);
      expect(p.json.counts, name).toMatchObject({ create: 0, update: 0 });
    }
  });
});

// ------------------------------------------------------------------ the assistant without a model

describe('assistant without AI: take over a note, history, share and make private', () => {
  it('"Nimm diese Notiz auf:" with pasted lines – cards, one undo', async () => {
    const r = await sam.chat('Nimm diese Notiz auf:\n## Sam\n- Jackengröße: L\n- Handschuhgröße: 9\nWir gießen die Pflanzen sonntags.');
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ mode: 'basic', reply: 'Übernommen: 3 neu, 0 aktualisiert.' });
    const e = (await sam.req('GET', '/api/knowledge?subject=Sam&property=Jackengröße')).json.entries[0];
    expect(e).toMatchObject({ value: 'L', origin: 'assistant', visibility: 'household' });
    expect((await sam.req('POST', `/api/assistant/undo/${r.json.actions[0].undo}`)).json.ok).toBe(true);
    expect((await sam.req('GET', '/api/knowledge?subject=Sam&property=Jackengröße')).json.entries).toEqual([]);
  });

  it('"Was war … vorher?" names the earlier values', async () => {
    await mira.req('POST', '/api/knowledge', { subject: 'Mika', property: 'Mützengröße', value: '50' });
    await mira.req('POST', '/api/knowledge', { subject: 'Mika', property: 'Mützengröße', value: '52' });
    const r = await mira.chat('Was war Mikas Mützengröße vorher?');
    expect(r.json.reply).toMatch(/^Mika · Mützengröße: 52\. Vorher: 50 \(bis \d{4}-\d\d-\d\d\)\.$/);
    expect((await mira.chat('Verlauf von Mikas Kleidergröße')).json.reply).toBe('Mika · Kleidergröße: 116. Einen früheren Wert gibt es nicht.');
  });

  it('"Mach … nur für mich" asks, the "ja" does it – and only for the person who wrote it', async () => {
    const q = await mira.chat('Mach Mikas Mützengröße nur für mich');
    expect(q.json.reply).toBe('„Mika · Mützengröße: 52“ nur noch für dich sichtbar machen? Sag einfach ja.');
    expect((await mira.req('GET', '/api/knowledge?subject=Mika&property=Mützengröße')).json.entries[0].visibility).toBe('household');
    const y = await mira.chat('Ja');
    expect(y.json).toMatchObject({ mode: 'basic', reply: 'Jetzt nur für dich: Mika · Mützengröße: 52' });
    expect((await sam.req('GET', '/api/knowledge?subject=Mika&property=Mützengröße')).json.entries).toEqual([]);
    // Sam cannot share it (he does not even find it)
    expect((await sam.chat('Mach Mikas Mützengröße für alle sichtbar')).json.reply).toMatch(/finde ich in eurem Haushaltswissen nicht/);
    const s = await mira.chat('Mach Mikas Mützengröße für alle sichtbar');
    expect(s.json.reply).toMatch(/für den ganzen Haushalt sichtbar machen\?/);
    expect((await mira.chat('ja')).json.reply).toBe('Für den ganzen Haushalt sichtbar: Mika · Mützengröße: 52');
    expect((await sam.req('GET', '/api/knowledge?subject=Mika&property=Mützengröße')).json.entries.length).toBe(1);
  });
});

// ------------------------------------------------------------------ MCP end to end

describe('MCP: knowledge and task tools', () => {
  it('API token (household): tools/list, read and write household cards; private and health ones never', async () => {
    const names = toolNames(await mcp(mcpToken));
    for (const n of ['knowledge_search', 'knowledge_get', 'knowledge_export', 'knowledge_set', 'knowledge_delete', 'knowledge_visibility', 'knowledge_import', 'tasks_coming_up', 'undo_task_done', 'remember']) expect(names).toContain(n);
    const found = await callTool(mcpToken, 'knowledge_search', { query: 'Größe' });
    const texts = JSON.stringify(found.data);
    expect(texts).toContain('Kleidergröße');
    expect(texts).not.toContain('Hosengröße'); // Sam's private card
    expect(texts).not.toContain('Erdnüsse'); // Mira's private health card
    const set = await callTool(mcpToken, 'knowledge_set', { subject: 'Heizung', property: 'Filtergröße', value: '16 x 20' });
    expect(set).toMatchObject({ isError: false, data: { ok: true, visible_to: 'household' } });
    expect((await mira.req('GET', '/api/knowledge?q=Filtergröße')).json.entries[0]).toMatchObject({ origin: 'mcp', value: '16 x 20' });
    expect((await callTool(mcpToken, 'knowledge_set', { subject: 'Heizung', property: 'Modell', value: 'X1', only_me: true })).isError).toBe(true);
    expect((await callTool(mcpToken, 'knowledge_set', { subject: 'Sam', property: 'Allergie', value: 'Nüsse' })).isError).toBe(true);
    expect((await callTool(mcpToken, 'knowledge_get', { id: samPrivateId() })).isError).toBe(true);
    const imp = await callTool(mcpToken, 'knowledge_import', { text: '# Auto\n- Reifengröße: 205/55 R16\n- Kennzeichen: HH-AB 123' });
    expect(imp.data).toMatchObject({ ok: true, created: 2 });
    const ex = await callTool(mcpToken, 'knowledge_export', { format: 'md' });
    expect(ex.data.content).toContain('## Auto');
    expect(ex.data.content).not.toMatch(/Hosengröße|Erdnüsse/);
    const coming = await callTool(mcpToken, 'tasks_coming_up');
    expect(coming.data).toHaveProperty('items');
  });

  it('OAuth member: the own private cards too, never someone else’s; mcp:read only gets read tools', async () => {
    const rw = await connect(mira, 'write');
    const mine = await callTool(rw, 'knowledge_search', { query: 'Erdnüsse' });
    // health data leaves only with health sharing and the mcp:health scope – here neither
    expect(mine.data).toMatchObject({ entries: [], hidden_health_entries: 1 });
    const p = await callTool(rw, 'knowledge_set', { subject: 'Mira', property: 'Ringgröße', value: '54', only_me: true });
    expect(p.data).toMatchObject({ ok: true, visible_to: 'only you' });
    expect((await mira.req('GET', '/api/knowledge?q=Ringgröße')).json.entries[0]).toMatchObject({ visibility: 'me', origin: 'mcp' });
    expect((await sam.req('GET', '/api/knowledge?q=Ringgröße')).json.entries).toEqual([]);
    expect(JSON.stringify((await callTool(rw, 'knowledge_search', { query: 'Hosengröße' })).data)).not.toContain('32');
    expect((await callTool(rw, 'knowledge_visibility', { id: samPrivateId(), to: 'household' })).isError).toBe(true);
    const share = await callTool(rw, 'knowledge_visibility', { id: p.data.id, to: 'household' });
    expect(share.data).toMatchObject({ ok: true, visible_to: 'household' });
    const del = await callTool(rw, 'knowledge_delete', { id: p.data.id });
    expect(del.data).toMatchObject({ ok: true });

    const ro = await connect(sam, 'read');
    const names = toolNames(await mcp(ro));
    for (const n of ['knowledge_search', 'knowledge_get', 'knowledge_export', 'tasks_coming_up']) expect(names).toContain(n);
    for (const n of ['knowledge_set', 'knowledge_delete', 'knowledge_visibility', 'knowledge_import', 'undo_task_done', 'remember']) expect(names).not.toContain(n);
    // Sam's read connection sees his own private card
    expect(JSON.stringify((await callTool(ro, 'knowledge_search', { query: 'Hosengröße' })).data)).toMatch(/"value": ?"32"/);
    // a write tool is not even there
    const w = await mcp(ro, 'tools/call', { name: 'knowledge_set', arguments: { subject: 'X', property: 'Y', value: 'Z' } });
    expect(JSON.stringify(w.json)).toMatch(/not found|isError|-32602/i);
  });

  it('a read-only household (cloud without a plan) gets the same read-only tool set', async () => {
    const { buildMcpServer } = await import('../server/mcp/server');
    const names = Object.keys((buildMcpServer('Test', { readOnly: true }) as any)._registeredTools);
    expect(names).toContain('knowledge_search');
    expect(names).toContain('tasks_coming_up');
    expect(names.filter((n) => /^knowledge_(set|delete|visibility|import)$|^undo_task_done$/.test(n))).toEqual([]);
  });

  it('task undo over MCP follows the app rules', async () => {
    const care = await import('../server/lib/care');
    const task = care.createCareTask({ name: 'Biotonne raus', interval_n: 2, interval_unit: 'week', next_due: new Date().toISOString().slice(0, 10) } as any);
    care.completeCareTask(task.id, 'Sam', { actorUserId: samId });
    // a household token has no person: taking back somebody's tick needs a member
    expect((await callTool(mcpToken, 'undo_task_done', { task: 'Biotonne' })).isError).toBe(true);
    const rw = await connect(mira, 'write'); // admin: may take back Sam's tick, like in the app
    const r = await callTool(rw, 'undo_task_done', { task: 'Biotonne' });
    expect(r).toMatchObject({ isError: false, data: { ok: true, task: 'Biotonne raus', taken_back: { by: 'Sam' } } });
    expect((await callTool(rw, 'undo_task_done', { task: 'Biotonne' })).isError).toBe(true);
  });

  it('no token: 401 with WWW-Authenticate and the metadata', async () => {
    const r = await mcp(null);
    expect(r.status).toBe(401);
    expect(r.www).toContain('resource_metadata=');
    expect((await anon.req('GET', '/.well-known/oauth-protected-resource')).json).toMatchObject({ resource: `${base}/mcp` });
  });
});

function samPrivateId(): number {
  return (db.prepare(`SELECT id FROM ai_memory WHERE property = 'Hosengröße' AND private_to = ?`).get(samId) as { id: number }).id;
}
void miraId;
