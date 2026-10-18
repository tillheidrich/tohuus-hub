/**
 * MCP tools: Haushaltswissen (knowledge.ts, knowledge-io.ts) plus the Build-15 task tools the assistant already had
 * (take back a "done", Heute › Demnächst). docs/mcp.md.
 *
 * Who is asking: an OAuth connection acts as its member (private entries: only that member's own); an API token acts
 * for the household (household entries only – it never sees, writes or creates private ones, and health-related
 * entries are refused because there is no person to keep them private for). Read tools are readOnlyHint, so an
 * mcp:read connection and a read-only cloud household get them, and nothing else (server.ts).
 * Health-related entries go out only when the household shares health data with AI and the connection has mcp:health.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { currentAiActor } from '../lib/ai-policy.js';
import { taskWhen } from '../lib/assistant-parse.js';
import { addTask, runTaskTool } from '../lib/assistant-tasks.js';
import { localDay } from '../lib/catalog.js';
import { deleteEntry, getEntry, KnowledgeError, createEntry, updateEntry, type KViewer } from '../lib/knowledge.js';
import { EXPORT_FORMATS, exportKnowledge, findForAi, importNote } from '../lib/knowledge-io.js';
import { healthShareAllowed } from '../lib/people-signals.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const fail = (msg: string) => ({ ...text({ error: msg }), isError: true });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DEL = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

/** the member behind an OAuth connection, else the household (API token) */
export function mcpViewer(actorName: string): KViewer {
  const uid = currentAiActor()?.userId ?? null;
  const u = uid ? (db.prepare('SELECT id, name, role, IFNULL(kind, \'user\') AS kind FROM users WHERE id = ?').get(uid) as { id: number; name: string; role: string; kind: string } | undefined) : undefined;
  if (u) return { userId: u.id, name: u.name, admin: u.role === 'admin', guest: u.kind === 'guest' };
  return { userId: null, name: actorName, service: true };
}

function failOf(e: unknown) {
  if (e instanceof KnowledgeError || (e as { code?: string })?.code === 'health_consent') return fail((e as Error).message);
  throw e;
}

export function register(s: McpServer, actorName: string) {
  s.registerTool(
    'knowledge_search',
    {
      title: 'Household knowledge',
      description:
        'What the household wrote down: sizes, measurements, meter and model numbers, phone numbers, notes – as cards "subject · property: value". ' +
        'Without query: everything (up to limit). Each card says who sees it (household or only the asking member) and its earlier values (history).',
      inputSchema: { query: z.string().max(120).optional().describe('words, e.g. "Mika Schuhgröße", "Rollo", "Zählernummer"'), limit: z.number().int().min(1).max(100).default(30) },
      annotations: RO,
    },
    async ({ query, limit }) => text(findForAi(mcpViewer(actorName), { q: query, healthOk: healthShareAllowed(), limit })),
  );

  s.registerTool(
    'knowledge_get',
    { title: 'One knowledge card', description: 'One card by id with its full visible history (newest first).', inputSchema: { id: z.number().int() }, annotations: RO },
    async ({ id }) => {
      const out = findForAi(mcpViewer(actorName), { id, healthOk: healthShareAllowed() });
      return out.entries.length ? text(out.entries[0]) : fail('No such card.');
    },
  );

  s.registerTool(
    'knowledge_export',
    {
      title: 'Export household knowledge',
      description: 'The knowledge as one file text: md (readable, grouped by subject), csv or json. Only what this connection may see; health-related cards only with health sharing.',
      inputSchema: { format: z.enum(EXPORT_FORMATS).default('md'), query: z.string().max(120).optional() },
      annotations: RO,
    },
    async ({ format, query }) => {
      const v = mcpViewer(actorName);
      // health-related cards leave only like everywhere else in MCP
      const allowed = healthShareAllowed() ? undefined : findForAi(v, { q: query, healthOk: false, limit: 10_000 }).entries.map((e) => e.id);
      const out = exportKnowledge(v, format, { q: query, ids: allowed && allowed.length ? allowed : undefined });
      if (allowed && !allowed.length) return text({ filename: out.filename, count: 0, content: '' });
      return text({ filename: out.filename, count: out.count, content: out.body.replace(/^﻿/, '') });
    },
  );

  s.registerTool(
    'knowledge_set',
    {
      title: 'Write down / correct',
      description:
        'Write a card down or correct its value – only when the person asks for it. subject + property + value ("Mika", "Schuhgröße", "29"); the same subject and property gets the new value, the old one stays in the history. ' +
        'Or id + value (or text for a plain line). only_me=true: a new card only the asking member sees (needs a member connection). Never codes or passwords.',
      inputSchema: {
        id: z.number().int().optional(),
        subject: z.string().max(80).optional(),
        property: z.string().max(60).optional(),
        value: z.string().max(120).optional(),
        text: z.string().max(300).optional().describe('a plain line instead of subject/property/value'),
        note: z.string().max(500).optional(),
        only_me: z.boolean().optional(),
      },
      annotations: RW,
    },
    async (a) => {
      const v = mcpViewer(actorName);
      try {
        if (a.id) {
          const cur = getEntry(a.id, v);
          const out = updateEntry(a.id, { ...(a.value ? (cur.property ? { value: a.value } : { text: a.value }) : {}), ...(a.text ? { text: a.text } : {}), ...(a.note !== undefined ? { note: a.note } : {}) }, v);
          return text({ ok: true, id: out.entry.id, now: out.entry.text, before: out.before.text });
        }
        const out = createEntry({ subject: a.subject, property: a.property, value: a.value, text: a.text, note: a.note, visibility: a.only_me ? 'me' : undefined, origin: 'mcp' }, v);
        return text({ ok: true, id: out.entry.id, now: out.entry.text, updated: out.updated, before: out.before?.text, visible_to: out.entry.visibility === 'me' ? 'only you' : 'household' });
      } catch (e) {
        return failOf(e);
      }
    },
  );

  s.registerTool(
    'knowledge_delete',
    { title: 'Delete a card', description: 'Deletes one card by id – only after the person said yes. Undo in the app is not possible from here.', inputSchema: { id: z.number().int() }, annotations: DEL },
    async ({ id }) => {
      try {
        const row = deleteEntry(id, mcpViewer(actorName));
        return text({ ok: true, deleted: row.text });
      } catch (e) {
        return failOf(e);
      }
    },
  );

  s.registerTool(
    'knowledge_visibility',
    {
      title: 'Share or make private',
      description:
        'to=household: a private card of the asking member becomes visible to everyone; to=me: a household card becomes private for the person who wrote it. Only after the person said yes. Health-related cards are shared only in the app.',
      inputSchema: { id: z.number().int(), to: z.enum(['household', 'me']) },
      annotations: RW,
    },
    async ({ id, to }) => {
      const v = mcpViewer(actorName);
      if (v.userId == null) return fail('A household token has no person – connect as a member (OAuth) for this.');
      try {
        const cur = getEntry(id, v);
        if (to === 'household' && cur.sensitive) return fail('Health information is shared only in the app, after a confirmation there.');
        const out = updateEntry(id, { visibility: to }, v);
        return text({ ok: true, id, visible_to: out.entry.visibility === 'me' ? 'only the author' : 'household' });
      } catch (e) {
        return failOf(e);
      }
    },
  );

  s.registerTool(
    'knowledge_import',
    {
      title: 'Take over a note',
      description:
        'Takes over a note or list the person pasted (Markdown, plain text, CSV or our JSON export): headings become subjects, "Key: Value" lines cards, other text note lines. Same subject and property: the value is updated. ' +
        'Only when the person asks for it. only_me=true: only the asking member sees them. Health-related lines stay private; codes and passwords are refused.',
      inputSchema: { text: z.string().min(2).max(100_000), only_me: z.boolean().optional() },
      annotations: RW,
    },
    async ({ text: body, only_me }) => {
      const v = mcpViewer(actorName);
      if (only_me && v.userId == null) return fail('A household token has no person – connect as a member (OAuth) for only_me.');
      try {
        const out = importNote(v, body, { onlyMe: only_me, origin: 'mcp' });
        return out.ok ? text(out) : fail(out.error);
      } catch (e) {
        return failOf(e);
      }
    },
  );

  // ------------------------------------------------------------------ Aufgaben (Build 15): what the assistant could, MCP now too

  const taskCtx = () => {
    const v = mcpViewer(actorName);
    return { actor: actorName, userId: v.userId, admin: v.userId == null ? false : Boolean(v.admin) };
  };

  s.registerTool(
    'tasks_coming_up',
    {
      title: 'Coming up (Heute › Demnächst)',
      description: 'What is coming in the next day or two: bins by the evening they go out (tonight / tomorrow), tasks due tomorrow (Fri/Sat: two days), tasks whose lead time started. Shared tasks only.',
      inputSchema: {},
      annotations: RO,
    },
    async () => text(runTaskTool(taskCtx(), 'tasks_coming_up', {}, () => {})),
  );

  s.registerTool(
    'undo_task_done',
    {
      title: 'Take back "done"',
      description:
        'A task was ticked off by mistake ("Biotonne war doch noch nicht raus"): the newest "done" goes back, the date and whose turn it is too. Own ticks; somebody else\'s only an admin member.',
      inputSchema: { task: z.union([z.number(), z.string()]).describe('task id or name') },
      annotations: RW,
    },
    async ({ task }) => {
      const out = runTaskTool(taskCtx(), 'task_undo_done', { task }, () => {}) as { error?: string };
      return out?.error ? fail(out.error) : text(out);
    },
  );

  s.registerTool(
    'add_task',
    {
      title: 'Add a task or appointment',
      description:
        'Creates a household task (area house: chores like vacuuming, bins, bathroom) or a care task / deadline (area care) – the same way the ToHuus assistant does. ' +
        'With a date and a time it is an appointment and shows up in the calendar (Termine). The name may carry the day and time in German or English ("Zahnarzt Dienstag um 10", ' +
        '"Elternabend am 24.10. um 19 Uhr") when date/time are not passed. Without date and rhythm it is due today. Rhythm: every + unit. ' +
        'only_me makes it private (only for a member connection).',
      inputSchema: {
        name: z.string().min(1).max(160).describe('What to do, e.g. "Bad putzen", or with day/time "Zahnarzt Dienstag um 10"'),
        date: z.string().regex(/^\d{4}-\d\d-\d\d$/).optional().describe('YYYY-MM-DD – first or only date'),
        time: z.string().regex(/^\d{1,2}:\d{2}$/).optional().describe('HH:MM – makes it an appointment (calendar entry)'),
        minutes: z.number().int().min(5).max(1440).optional().describe('How long the appointment takes'),
        place: z.string().max(120).optional().describe('Where the appointment is'),
        area: z.enum(['house', 'care']).optional().describe('house = household chore (default), care = care & deadlines'),
        every: z.number().int().min(1).max(1000).optional().describe('Rhythm number, e.g. 2'),
        unit: z.enum(['day', 'week', 'month', 'year']).optional().describe('Rhythm unit'),
        as_needed: z.boolean().optional().describe('No date, done when needed'),
        doer: z.string().max(60).optional().describe('Who does it (a member or a household guest)'),
        take_turns: z.array(z.string().max(60)).max(10).optional().describe('Names, in order, who take turns'),
        steps: z.array(z.string().max(120)).max(30).optional().describe('Sub-items, e.g. sink, mirror, floor'),
        only_me: z.boolean().optional(),
      },
      annotations: RW,
    },
    async (a) => {
      const today = localDay(0);
      let name = a.name.trim();
      let date = a.date ?? null;
      let time = a.time ?? null;
      // "Zahnarzt Dienstag um 10" – the assistant's reader takes day and time out of the name
      if (!date && !time && !a.every && !a.as_needed) {
        const w = taskWhen(name, today);
        name = w.name;
        date = w.day;
        time = w.time;
      }
      if (time && !date) date = today;
      if (!date && !a.every && !a.as_needed) date = today;
      const out = addTask(taskCtx(), {
        name,
        due: date,
        time,
        minutes: a.minutes,
        place: a.place,
        area: a.area ?? 'house',
        every_n: a.every,
        every_unit: a.unit ?? (a.every ? 'week' : undefined),
        as_needed: a.as_needed,
        doer: a.doer,
        take_turns: a.take_turns,
        steps: a.steps,
        only_me: a.only_me,
      }, () => {}) as { ok?: boolean; error?: string; task?: unknown };
      if (out?.error) return fail(out.error);
      return text({ ...out, appointment: Boolean(time), in_calendar: Boolean(time) });
    },
  );
}
