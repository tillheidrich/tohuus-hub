/**
 * The household assistant ("ToHuus" in the floating button on every tab): shopping and household helper, cook
 * planner, money helper. Short answers, no medical or nutrition advice, never "allergen-free".
 *
 *  - With a model (ai.ts, OpenRouter pinned to Mistral): tool calling over assistant-tools.ts, up to 4 rounds.
 *  - Without a model, over the monthly allowance or when the model fails: the deterministic reader
 *    (assistant-parse.ts) still turns "Milch, 2 Paprika und Brot" into list items and answers the common questions.
 *
 * Conversations are stored per person (assistant_conversations / assistant_messages), kept 30 days, deletable.
 * Usage is counted through limits.ts before any model call.
 */
import crypto from 'node:crypto';
import { db, lang, migrate } from '../db.js';
import { fmtDay, t } from '../i18n.js';
import { findTask } from './assistant-tasks.js';
import { findEntries, lastPending } from './knowledge.js';
import { historyAnswer, importNote } from './knowledge-io.js';
import { healthShareAllowed } from './people-signals.js';
import { aiOffReason } from './ai-policy.js';
import { addUsage, aiConfigured, aiEnabled, AiError, chat, zeroUsage, type ChatMessage, type Usage } from './ai.js';
import { buildContext, topicsOf, type Topic } from './assistant-context.js';
import { CONTEXT_TOPICS, contextHint, type ScreenContext } from './assistant-areas.js';
import { looksLikeTask, parseIntent, taskWhen, type Intent } from './assistant-parse.js';
import { scopeCheck, SCOPE_DE, SCOPE_EN } from './assistant-scope.js';
import {
  cookIdeasTool,
  forgetTool,
  listAdd,
  listShow,
  logPurchase,
  moneySummary,
  quickItems,
  recallAnswer,
  record,
  rememberTool,
  rhythmDueTool,
  runTool,
  stockFind,
  stockUsedUp,
  TOOL_DEFS,
  toolsFor,
  type AssistantAction,
  type ToolCtx,
} from './assistant-tools.js';
import { aiPausedMessage, consumeAssistant, UsageLimitError, type ConsumeResult } from './limits.js';
import { aiPaused, limits } from './plans.js';

/** HTTP 402 for the apps when the monthly assistant messages are used up. */
export const assistantQuotaError = () =>
  aiPaused()
    ? new UsageLimitError(aiPausedMessage(), 402, 'quota.ai_paused', 0)
    : new UsageLimitError(
    limits().assistantPerMonth === 0
      ? t('The assistant with AI comes with Haushalt and Plus – try it free for 14 days. Simple things like “milk and bread” work without it.')
      : t('The assistant messages for this month are used up. Simple things like “milk and bread” still work.'),
    402,
    limits().assistantPerMonth === 0 ? 'plan.assistant' : 'quota.assistant',
    0,
  );
import { fmtMoney } from './money.js';
import { localDay } from './catalog.js';

migrate(
  'assistant-1',
  `CREATE TABLE IF NOT EXISTS assistant_conversations (
     id TEXT PRIMARY KEY,
     user_id INTEGER,
     user_name TEXT,
     title TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS assistant_conversations_user ON assistant_conversations(user_id, updated_at);
   CREATE TABLE IF NOT EXISTS assistant_messages (
     id INTEGER PRIMARY KEY,
     conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('user','assistant')),
     content TEXT NOT NULL,
     actions TEXT NOT NULL DEFAULT '[]',
     mode TEXT,
     tokens INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS assistant_messages_conv ON assistant_messages(conversation_id, id);`,
);

export const KEEP_DAYS = 30;
const MAX_ROUNDS = 4;
/** the whole answer (all tool rounds, retries and fallback models) – the iPhone app waits 90 s, people much less */
const ASSISTANT_BUDGET_MS = 45_000;
/** one model request – a recipe takes Mistral Small 5–15 s, longer means it is stuck */
const ASSISTANT_TRY_MS = 25_000;
const HISTORY = 12;

export interface AssistantUser {
  userId: number | null;
  name: string;
  /** the same rights as in the app (routes/assistant.ts userOf): admin, permanent guest */
  admin?: boolean;
  guest?: boolean;
  /** 'ios' = the iPhone app (X-ToHuus-Client / its web view), 'web' = a browser */
  platform?: 'ios' | 'web' | null;
}

export interface ChatOutput {
  conversationId: string;
  reply: string;
  actions: AssistantAction[];
  /** 'ai' = answered by the model, 'basic' = the built-in reader (no model, allowance used up, or model failed) */
  mode: 'ai' | 'basic';
  usage?: Usage;
  /** messages left this month (null = unlimited) */
  remaining?: number | null;
  /** Plus fair use: over the allowance, answered more briefly */
  throttled?: boolean;
  /** answered by the scope filter (assistant-scope.ts): 'role' or 'off_topic' */
  scope?: 'role' | 'off_topic';
}

export class AssistantError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ conversations

export function pruneConversations() {
  db.prepare(`DELETE FROM assistant_conversations WHERE updated_at < datetime('now', ?)`).run(`-${KEEP_DAYS} days`);
}

function ownConversation(id: string, user: AssistantUser) {
  const c = db.prepare('SELECT * FROM assistant_conversations WHERE id = ?').get(id) as { id: string; user_id: number | null; user_name: string | null } | undefined;
  if (!c) return null;
  const mine = user.userId != null ? c.user_id === user.userId : c.user_id == null && c.user_name === user.name;
  return mine ? c : null;
}

function openConversation(id: string | null | undefined, user: AssistantUser, firstMessage: string) {
  if (id) {
    const c = ownConversation(id, user);
    if (!c) throw new AssistantError(t('Conversation not found'), 404);
    return c.id;
  }
  const nid = crypto.randomUUID();
  db.prepare('INSERT INTO assistant_conversations (id, user_id, user_name, title) VALUES (?, ?, ?, ?)').run(nid, user.userId, user.name, firstMessage.slice(0, 80));
  return nid;
}

function history(conversationId: string): ChatMessage[] {
  const rows = db
    .prepare('SELECT role, content FROM assistant_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?')
    .all(conversationId, HISTORY) as { role: 'user' | 'assistant'; content: string }[];
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

function store(conversationId: string, role: 'user' | 'assistant', content: string, extra: { actions?: AssistantAction[]; mode?: string; tokens?: number } = {}) {
  db.prepare('INSERT INTO assistant_messages (conversation_id, role, content, actions, mode, tokens) VALUES (?, ?, ?, ?, ?, ?)').run(
    conversationId,
    role,
    content,
    JSON.stringify(extra.actions ?? []),
    extra.mode ?? null,
    extra.tokens ?? 0,
  );
  db.prepare(`UPDATE assistant_conversations SET updated_at = datetime('now') WHERE id = ?`).run(conversationId);
}

export function listConversations(user: AssistantUser) {
  pruneConversations();
  return db
    .prepare(
      `SELECT c.id, c.title, c.created_at, c.updated_at, (SELECT COUNT(*) FROM assistant_messages m WHERE m.conversation_id = c.id) AS messages
       FROM assistant_conversations c WHERE ${user.userId != null ? 'c.user_id = ?' : 'c.user_id IS NULL AND c.user_name = ?'} ORDER BY c.updated_at DESC LIMIT 50`,
    )
    .all(user.userId ?? user.name);
}

export function getConversation(id: string, user: AssistantUser) {
  const c = ownConversation(id, user);
  if (!c) throw new AssistantError(t('Conversation not found'), 404);
  const messages = (db.prepare('SELECT id, role, content, actions, mode, created_at FROM assistant_messages WHERE conversation_id = ? ORDER BY id').all(id) as any[]).map((m) => ({
    ...m,
    actions: JSON.parse(m.actions || '[]'),
  }));
  return { id, messages };
}

export function deleteConversation(id: string, user: AssistantUser) {
  if (!ownConversation(id, user)) throw new AssistantError(t('Conversation not found'), 404);
  db.prepare('DELETE FROM assistant_conversations WHERE id = ?').run(id);
}

export function deleteAllConversations(user: AssistantUser) {
  return db.prepare(`DELETE FROM assistant_conversations WHERE ${user.userId != null ? 'user_id = ?' : 'user_id IS NULL AND user_name = ?'}`).run(user.userId ?? user.name).changes;
}

// ------------------------------------------------------------------ the prompt

const PROMPT_DE = `Du bist ToHuus, der Einkaufs- und Haushaltsassistent dieses Haushalts: Einkaufsliste, was zu Hause ist, was ihr kochen könnt, was es kostet.
- Antworte auf Deutsch, Du-Form, kurz und warm (1–3 Sätze, Listen nur für Vorschläge und Rezepte). Keine Emojis, kein Marketing.
- Daten (Liste, Vorrat, Preise, Pläne) nur aus den Werkzeugen, nie erfinden.
- Wer "wir brauchen was für X" sagt (z. B. Pfannkuchen-Abend): überleg dir die üblichen Zutaten, prüf sie mit check_at_home und setz nur, was vermutlich fehlt, mit list_add auf die Liste. Sag kurz, was du draufgesetzt hast und was du als vorhanden angenommen hast.
- Kochideen: erst cook_ideas. Ist nichts da oder der Vorrat leer, schlag trotzdem 2–3 einfache, günstige Alltagsgerichte vor. Kosten nur aus known_prices; sonst sag, dass es eine grobe Schätzung ist, ohne genaue Zahlen vorzutäuschen. Biete an, die Zutaten auf die Liste zu setzen.
- Wer ein Rezept will ("ein Rezept für Kinder", "was Schnelles mit Hähnchen"): schreib selbst ein einfaches, alltagstaugliches Rezept – Titel, Portionen, Zutatenliste mit Mengen, kurze nummerierte Schritte; hier darf die Antwort länger sein. Nutze, was zu Hause ist (check_at_home), wenn es passt. Danach anbieten: als Rezept speichern (recipe_save_adapted erst nach Ja, ohne "from") oder fehlende Zutaten auf die Liste. Auf "Ja" das Angebot sofort ausführen.
- Vorschläge aus dem Kaufrhythmus erst nach einem Ja auf die Liste. "Merk dir …" → remember, sonst nichts über Personen speichern.
- Keine medizinischen oder Ernährungsratschläge, nie "allergenfrei" behaupten. Rezepte von ToHuus sind schon gefiltert; sag nicht, warum etwas fehlt.`;

const PROMPT_EN = `You are ToHuus, this household's shopping and household assistant: shopping list, what is at home, what to cook, what it costs.
- Answer in English, short and warm (1–3 sentences, lists only for suggestions and recipes). No emojis, no marketing.
- Data (list, stock, prices, plans) only from the tools, never made up.
- "We need something for X" (e.g. a pancake evening): think of the usual ingredients, check them with check_at_home and put only what is probably missing on the list with list_add. Say briefly what you added and what you assumed is at home.
- Cooking ideas: first cook_ideas. If there is nothing or the pantry is empty, still suggest 2–3 simple, cheap everyday meals. Costs only from known_prices; otherwise say it is a rough estimate without pretending precision. Offer to put the ingredients on the list.
- Someone wants a recipe ("a recipe for kids", "something quick with chicken"): write a simple everyday recipe yourself – title, servings, ingredient list with amounts, short numbered steps; the answer may be longer here. Use what is at home (check_at_home) where it fits. Then offer: save it as a recipe (recipe_save_adapted only after a yes, without "from") or put missing ingredients on the list. On "yes", do it at once.
- Rhythm suggestions go on the list only after a yes. "Remember …" → remember; store nothing else about people.
- No medical or nutrition advice, never claim "allergen-free". ToHuus already filters recipes; do not say why something is left out.`;

export function systemPrompt(contextText: string) {
  const de = lang() === 'de';
  return `${de ? PROMPT_DE : PROMPT_EN}\n${de ? SCOPE_DE : SCOPE_EN}\n\n${contextText}`;
}

// ------------------------------------------------------------------ chat

export async function chatOnce(input: {
  message: string;
  conversationId?: string | null;
  user: AssistantUser;
  /** already counted (voice: the recording counts as the message) */
  allowance?: ConsumeResult;
  /** the screen the person is on (assistant-areas.ts): its context lines and tools come along */
  context?: ScreenContext | null;
}): Promise<ChatOutput> {
  const message = input.message.trim().slice(0, 2000);
  if (!message) throw new AssistantError(t('Please write or say something.'));
  pruneConversations();
  if (input.conversationId && !ownConversation(input.conversationId, input.user)) throw new AssistantError(t('Conversation not found'), 404);
  // not about the household, or an attempt to change the assistant's role: a friendly answer, no model, nothing
  // counted (assistant-scope.ts)
  const scope = scopeCheck(message);
  if (!scope.ok) {
    const cid = openConversation(input.conversationId, input.user, message);
    store(cid, 'user', message);
    store(cid, 'assistant', scope.reply, { actions: [], mode: 'basic', tokens: 0 });
    return { conversationId: cid, reply: scope.reply, actions: [], mode: 'basic', scope: scope.kind, ...(input.allowance ? { remaining: input.allowance.remaining } : {}) };
  }
  // count before anything is stored: over the allowance, what the built-in reader understands still works (it costs
  // no model call); anything else answers HTTP 402 { code: 'quota.assistant' }
  // what the built-in reader fully understands (lists, "ist alle", a told purchase, "merk dir") is answered without a
  // model and without counting; everything else – questions, cooking, vague parts – goes to the model when there is one
  // "Fenster putzen", "Oma anrufen", anything typed on the tasks screen: a task, not a list item (audit 17.10.)
  const parsed = parseIntent(message);
  const taskLike = parsed.kind === 'add' && looksLikeTask(message, input.context ?? null);
  const intent: Intent = taskLike ? { kind: 'unknown' } : parsed;
  const ctx: ToolCtx = { actor: input.user.name, userId: input.user.userId, actions: [], admin: input.user.admin === true, guest: input.user.guest === true, platform: input.user.platform ?? null, turnStart: Date.now() };
  // "Welche Schuhgröße hat Mika?" – answered from what ToHuus remembers, without a model, when it is there
  // a plain "ja" to the reader's own question about a knowledge card (share, make private, delete) – no model needed
  const knowledgeYes = intent.kind === 'reply' && intent.answer === 'yes' && lastPending(ctx.userId) != null;
  const simple = fullyUnderstood(intent) || knowledgeYes || (intent.kind === 'recall' && recallAnswer(ctx, intent.subject, intent.property) != null);
  // a bare list of products ("Bananen und Haferflocken") means "put these on the list" – also when it was spoken:
  // the recording already counted (input.allowance), but the answer still comes from the built-in reader
  const allowance = aiEnabled('text') && !simple ? (input.allowance ?? consumeAssistant()) : null;
  const overQuota = Boolean(allowance && !allowance.ok);
  const needsModel = intent.kind === 'unknown' || (intent.kind === 'reply' && !knowledgeYes && (intent.answer === 'yes' || intent.answer === 'command'));
  if (overQuota && needsModel) throw assistantQuotaError();
  const conversationId = openConversation(input.conversationId, input.user, message);
  const prior = history(conversationId);
  store(conversationId, 'user', message);

  let out: { reply: string; mode: 'ai' | 'basic'; usage?: Usage; remaining?: number | null; throttled?: boolean };
  if (knowledgeYes) {
    out = { reply: basicReply(message, ctx, intent, input.context ?? null), mode: 'basic', ...(input.allowance ? { remaining: input.allowance.remaining } : {}) };
  } else if (allowance && !(simple && overQuota)) {
    if (overQuota) {
      out = { reply: taskLike ? basicTask(message, ctx) : basicReply(message, ctx, intent, input.context ?? null), mode: 'basic', remaining: 0 };
    } else {
      try {
        // Plus fair use over the allowance: still answered, just shorter
        // a recipe is longer than a list answer
        const long = /rezept|recipe/i.test(message) || (intent.kind === 'reply' && /rezept|recipe|zutat|ingredient/i.test(String(prior[prior.length - 1]?.content ?? '')));
        const r = await modelReply(message, prior, ctx, input.user, allowance.throttled ? 250 : long ? 1000 : 600, input.context ?? null);
        out = { ...r, mode: 'ai', remaining: allowance.remaining, ...(allowance.throttled ? { throttled: true } : {}) };
      } catch (e) {
        if (!(e instanceof AiError)) throw e;
        console.warn('[assistant] model failed, using the built-in reader:', e.code, e.detail ?? e.message);
        // writes the model already made stay (they are in actions); otherwise the built-in reader helps
        // a question the built-in reader cannot answer ("ein Rezept für Kinder") gets an honest "busy, try again"
        // instead of "I did not understand"
        const busy = e.code === 'rate_limited' || e.code === 'upstream' || e.code === 'timeout';
        const reply = ctx.actions.length ? t('Done.') : busy && needsModel ? t('The assistant is busy right now. Please try again in a moment.') : taskLike ? basicTask(message, ctx) : basicReply(message, ctx, intent, input.context ?? null);
        out = { reply, mode: 'basic', remaining: allowance.remaining };
      }
    }
  } else {
    out = { reply: taskLike ? basicTask(message, ctx) : basicReply(message, ctx, intent, input.context ?? null), mode: 'basic', ...(input.allowance ? { remaining: input.allowance.remaining } : {}) };
  }
  store(conversationId, 'assistant', out.reply, { actions: ctx.actions, mode: out.mode, tokens: out.usage?.total ?? 0 });
  return {
    conversationId,
    reply: out.reply,
    actions: ctx.actions,
    mode: out.mode,
    ...(out.usage ? { usage: out.usage } : {}),
    ...(out.remaining !== undefined ? { remaining: out.remaining } : {}),
    ...(out.throttled ? { throttled: true } : {}),
  };
}

/** Sentences the built-in reader handles completely – no model needed. */
export function fullyUnderstood(intent: Intent): boolean {
  if (intent.kind === 'add') return intent.vague.length === 0;
  // "danke", "nein" need no model; "ja" and "speicher das Rezept" do (they refer to the last answer)
  if (intent.kind === 'reply') return intent.answer === 'thanks' || intent.answer === 'no';
  // "Mika hat jetzt 29": a corrected value of something remembered (memory.ts) – no model needed
  return ['purchase', 'remember', 'forget', 'list', 'fact', 'note_import', 'knowledge_history', 'knowledge_visibility'].includes(intent.kind);
}

/** The prompt for one message: only the context lines and tools its topics need (plus the screen's). Exported for tests. */
export function promptFor(message: string, user: AssistantUser, context: ScreenContext | null = null) {
  const fromText = topicsOf(message);
  const topics = [...new Set([...(context ? CONTEXT_TOPICS[context] : []), ...(context && fromText.length === 3 ? [] : fromText)])] as Topic[];
  const ctxText = buildContext({ purpose: 'assistant', viewer: { userId: user.userId, name: user.name }, topics });
  const hint = contextHint(context, lang() === 'de');
  const tools = toolsFor(topics, Boolean(context));
  // "ein Rezept für Kinder": the model writes the recipe itself and may save it after a yes
  if (/rezept|recipe/i.test(message) && !tools.some((d) => d.function.name === 'recipe_save_adapted')) {
    tools.push(...TOOL_DEFS.filter((d) => d.function.name === 'recipe_save_adapted'));
  }
  return { system: systemPrompt(hint ? `${ctxText.text}\n${hint}` : ctxText.text), tools, topics };
}

async function modelReply(message: string, prior: ChatMessage[], ctx: ToolCtx, user: AssistantUser, maxTokens = 600, context: ScreenContext | null = null) {
  // the topics (context lines, tools) also follow the last answer: "Ja" after a recipe needs the recipe tools
  const lastAnswer = [...prior].reverse().find((m) => m.role === 'assistant');
  const p = promptFor([...prior.filter((m) => m.role === 'user').slice(-2).map((m) => String(m.content)), String(lastAnswer?.content ?? '').slice(0, 600), message].join(' '), user, context);
  const messages: ChatMessage[] = [{ role: 'system', content: p.system }, ...prior, { role: 'user', content: message }];
  let usage = zeroUsage();
  // a person is waiting: one overall budget instead of 60 s per try with retries and fallback models (minutes)
  const deadline = Date.now() + ASSISTANT_BUDGET_MS;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await chat({ kind: 'text', messages, tools: p.tools, temperature: 0.3, maxTokens, timeoutMs: ASSISTANT_TRY_MS, retries: 1, deadline });
    usage = addUsage(usage, res.usage);
    if (!res.toolCalls.length) return { reply: res.content.trim() || t('Done.'), usage };
    messages.push({ role: 'assistant', content: res.content || null, tool_calls: res.toolCalls });
    for (const call of res.toolCalls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      let result: unknown;
      try {
        result = runTool(ctx, call.function.name, args);
      } catch (e) {
        result = { error: (e as Error).message };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result).slice(0, 8000) });
    }
  }
  // still calling tools after four rounds: summarise what was done
  return { reply: ctx.actions.length ? ctx.actions.map((a) => a.summary).join('. ') + '.' : t('Done.'), usage };
}

// ------------------------------------------------------------------ without a model

const names = (xs: { name?: string; text?: string }[]) => xs.map((x) => x.name ?? x.text ?? '').filter(Boolean);
const joinList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${t('and')} ${xs[xs.length - 1]}`);

/** The built-in reader: deterministic, no network. Exported for tests. */
/** Without a model: a task sentence becomes one task, due today – the details come in Aufgaben. */
export function basicTask(message: string, ctx: ToolCtx): string {
  // "Zahnarzt Dienstag um 10" → "Zahnarzt", next Tuesday, 10:00 (an appointment); otherwise due today
  const w = taskWhen(message, localDay(0));
  const name = w.name.slice(0, 120);
  const r = runTool(ctx, 'task_add', { name, due: w.day ?? localDay(0), ...(w.time ? { time: w.time } : {}) }) as { ok?: boolean; error?: string } | undefined;
  if (!r?.ok) return r?.error ?? t('Done.');
  if (w.time) return t('“{name}” is in Tasks for {day} at {time}.', { name, day: fmtDay(w.day ?? localDay(0)), time: w.time });
  if (w.day && w.day !== localDay(0)) return t('“{name}” is in Tasks for {day}.', { name, day: fmtDay(w.day) });
  return t('“{name}” is now in Tasks, due today. Tap it there to set how often and who.', { name });
}

type Coming = { name: string; when: 'tonight' | 'tomorrow' | 'later'; day: string; put_out_evening_before?: boolean };
const comingItems = (ctx: ToolCtx) => ((runTool(ctx, 'tasks_coming_up', {}) as { items?: Coming[] } | undefined)?.items ?? []);

/** "Was muss heute Abend raus?", "Was kommt demnächst?" – Heute › Demnächst, without a model. */
export function basicOutlook(ctx: ToolCtx, message = ''): string {
  const xs = comingItems(ctx);
  const tonight = xs.filter((x) => x.when === 'tonight').map((x) => x.name);
  const tomorrow = xs.filter((x) => x.when === 'tomorrow').map((x) => x.name);
  const later = xs.filter((x) => x.when === 'later').slice(0, 3).map((x) => `${x.name} (${fmtDay(x.day)})`);
  const parts: string[] = [];
  if (tonight.length) parts.push(t('Tonight: {items}.', { items: joinList(tonight) }));
  else if (/abend|tonight|raus|tonne/i.test(message)) parts.push(t('Nothing has to go out tonight.'));
  if (tomorrow.length) parts.push(t('Tomorrow: {items}.', { items: joinList(tomorrow) }));
  if (later.length) parts.push(t('Coming up: {items}.', { items: joinList(later) }));
  return parts.length ? parts.join(' ') : t('Nothing coming up in the next days.');
}

/** "Die Biotonne war doch noch nicht raus" without a model: the last "done" of that task back (the app's rules). */
export function basicUndoDone(ctx: ToolCtx, task: string): string {
  const found = findTask(task);
  if (!found) return t('I can’t find a task “{name}”.', { name: task });
  const r = runTool(ctx, 'task_undo_done', { task: found.id }) as { ok?: boolean; error?: string; done_by?: string | null } | undefined;
  if (r?.ok) return t('Okay, “{name}” is open again.', { name: found.name });
  return r?.error ?? t('Nothing to undo');
}

/** One task in a spoken answer: "Zahnarzt um 10:00 (Lea)". */
type TaskBit = { name: string; when?: string; time?: string; does_it?: string | null };
const taskBit = (x: TaskBit) => {
  const n = x.time ? t('{name} at {time}', { name: x.name, time: x.time }) : x.name;
  return x.does_it ? `${n} (${x.does_it})` : n;
};

/** "Was steht heute an?" / "Was ist morgen?" / "Was ist fällig?" on the tasks screen – from tasks_list, without a model. */
export function basicTasks(ctx: ToolCtx, day: 'today' | 'tomorrow'): string {
  if (day === 'tomorrow') {
    const r = runTool(ctx, 'tasks_list', { filter: 'all', on: localDay(1) }) as { tasks?: TaskBit[] } | undefined;
    const xs = r?.tasks ?? [];
    return xs.length ? t('Tomorrow: {items}.', { items: joinList(xs.map(taskBit)) }) : t('Nothing on for tomorrow.');
  }
  const r = runTool(ctx, 'tasks_list', { filter: 'due' }) as { tasks?: TaskBit[] } | undefined;
  const xs = r?.tasks ?? [];
  const today = xs.filter((x) => x.when === 'due today');
  const overdue = xs.filter((x) => x.when === 'overdue');
  const soon = xs.filter((x) => x.when === 'due soon').slice(0, 3);
  const parts: string[] = [];
  parts.push(today.length ? t('Today: {items}.', { items: joinList(today.map(taskBit)) }) : t('Nothing on for today.'));
  if (overdue.length) parts.push(t('Still open: {items}.', { items: joinList(overdue.map(taskBit)) }));
  // bins for tomorrow's collection go out this evening (Heute › Demnächst)
  const tonight = comingItems(ctx).filter((x) => x.when === 'tonight').map((x) => x.name);
  if (tonight.length) parts.push(t('Tonight: {items}.', { items: joinList(tonight) }));
  if (!today.length && !overdue.length && soon.length) parts.push(t('Coming up: {items}.', { items: joinList(soon.map(taskBit)) }));
  return parts.join(' ');
}

/** "Nimm diese Notiz auf: …" without a model: everything that reads as cards or note lines, one undo */
export function basicNoteImport(ctx: ToolCtx, text: string): string {
  if (!ctx.userId || ctx.guest) return t('Only people who live here can change this.');
  try {
    const r = importNote({ userId: ctx.userId, name: ctx.actor, admin: ctx.admin }, text, { origin: 'assistant' }, (kind, summary, undo) => record(ctx, kind, summary, undo as any));
    if (!r.ok) return t('I didn’t find anything to take over in it.');
    const parts = [t('Taken over: {n} new, {m} updated.', { n: r.created, m: r.updated })];
    if (r.skipped) parts.push(t('{n} were already there.', { n: r.skipped }));
    if (r.blocked.some((b) => b.why === 'secret')) parts.push(t('Codes and passwords belong in House info › Codes – they are kept safe there.'));
    return parts.join(' ');
  } catch (e) {
    return (e as Error).message;
  }
}

/** "Mach Miras Schuhgröße für alle sichtbar" without a model: ask first (knowledge_change), the "ja" comes next */
export function basicKnowledgeVisibility(ctx: ToolCtx, action: 'share' | 'private', what: string): string {
  if (!ctx.userId || ctx.guest) return t('Only people who live here can change this.');
  const v = { userId: ctx.userId, name: ctx.actor, admin: ctx.admin };
  const hits = findEntries(what, v).filter((e) => (action === 'share' ? e.may.share : e.may.makePrivate));
  if (!hits.length) return t('I can’t find “{what}” in what ToHuus remembers.', { what });
  if (hits.length > 1) return t('Which one do you mean: {items}?', { items: joinList(hits.slice(0, 4).map((e) => e.text)) });
  const r = runTool(ctx, 'knowledge_change', { action, id: hits[0].id }) as { needs_yes?: boolean; error?: string };
  if (!r?.needs_yes) return r?.error ?? t('Done.');
  return action === 'share' ? t('Make “{text}” visible to the whole household? Say yes.', { text: hits[0].text }) : t('Make “{text}” visible only to you? Say yes.', { text: hits[0].text });
}

/** the "ja" to that question */
export function basicKnowledgeConfirm(ctx: ToolCtx, p: { id: number; action: 'delete' | 'share' | 'private' }): string {
  const r = runTool(ctx, 'knowledge_change', { action: p.action, id: p.id, confirm: true }) as { ok?: boolean; error?: string; deleted?: string };
  if (!r?.ok) return r?.error ?? t('Nothing to undo');
  return ctx.actions[ctx.actions.length - 1]?.summary ?? t('Done.');
}

export function basicReply(message: string, ctx: ToolCtx, intent: Intent = parseIntent(message), context: ScreenContext | null = null): string {
  switch (intent.kind) {
    case 'tasks':
      return basicTasks(ctx, intent.day);
    case 'outlook':
      return basicOutlook(ctx, message);
    case 'undo_done':
      return basicUndoDone(ctx, intent.task);
    case 'recall': {
      const a = recallAnswer(ctx, intent.subject, intent.property);
      if (a) return a;
      break;
    }
    case 'note_import':
      return basicNoteImport(ctx, intent.text);
    case 'knowledge_history':
      return historyAnswer({ userId: ctx.userId, name: ctx.actor, admin: ctx.admin, guest: ctx.guest }, intent.what, healthShareAllowed());
    case 'knowledge_visibility':
      return basicKnowledgeVisibility(ctx, intent.action, intent.what);
    case 'fact': {
      const res = rememberTool(ctx, { text: intent.text }) as { ok: boolean; hint?: string; updated_from?: string; now?: string };
      if (!res.ok) return res.hint ?? '';
      return res.updated_from ? t('Updated: {text} (before: {old}).', { text: res.now ?? intent.text, old: res.updated_from }) : t('Got it, ToHuus remembers that.');
    }
    case 'add': {
      if (!intent.items.length) break;
      const added: string[] = [];
      const already: string[] = [];
      // "ist alle": stock to zero and onto the list; everything else just onto the list
      for (const it of intent.items.filter((i) => i.usedUp)) added.push(stockUsedUp(ctx, it.name).product ?? it.name);
      const rest = intent.items.filter((i) => !i.usedUp);
      if (rest.length) {
        const r = listAdd(ctx, quickItems(rest));
        added.push(...r.added);
        already.push(...r.already_on_list);
      }
      const parts: string[] = [];
      if (added.length) parts.push(t('{items} – on the list.', { items: joinList(added) }));
      if (already.length) parts.push(t('{items} was already on it.', { items: joinList(already) }));
      for (const v of intent.vague) {
        const m = v.match(/\b(?:für|fuer|for)\s+(.+)$/i);
        parts.push(m ? t('What do you need for {what}?', { what: m[1] }) : t('What else do you need?'));
      }
      return parts.join(' ');
    }
    case 'find': {
      const f = stockFind(intent.query) as any;
      if (!f.found) return t('I don’t know “{q}” yet. Shall I put it on the list?', { q: intent.query });
      const bits: string[] = [];
      if (f.last_bought) bits.push(f.last_bought.from === 'receipt' ? t('Bought {day} according to the receipt', { day: f.last_bought.weekday }) : t('Ticked off the list {day}', { day: f.last_bought.weekday }));
      if (f.stock?.kept_up_to_date) bits.push(t('In stock: {amount}', { amount: f.stock.amount }));
      if (f.rhythm) bits.push(f.rhythm.probably_at_home ? t('probably still there (you buy it every ~{n} days)', { n: f.rhythm.every_days }) : t('probably due again (every ~{n} days)', { n: f.rhythm.every_days }));
      if (f.on_list) bits.push(t('it is on the list'));
      return bits.length ? `${f.name}: ${bits.join(', ')}.` : t('{name}: I can’t tell from receipts or the list yet.', { name: f.name });
    }
    case 'purchase': {
      const r = logPurchase(ctx, { shop: intent.shop, total: intent.total, date: intent.when === 'yesterday' ? 'gestern' : 'heute', items: intent.items.map((i) => ({ name: i.name, qty: i.qty })) }) as any;
      if (r.error) return r.error;
      return intent.total
        ? t('Noted: {items} at {shop} for {total}.', { items: joinList(names(intent.items)), shop: intent.shop ?? '–', total: fmtMoney(intent.total) })
        : t('Noted: {items} at {shop}.', { items: joinList(names(intent.items)), shop: intent.shop ?? '–' });
    }
    case 'due': {
      // on the tasks screen "Was ist fällig?" means tasks, not shopping
      if (context === 'tasks') return basicTasks(ctx, 'today');
      const due = rhythmDueTool();
      return due.length ? t('Probably due: {items}. Shall I put them on the list?', { items: joinList(due.map((d) => d.name)) }) : t('Nothing seems due right now.');
    }
    case 'list': {
      const l = listShow();
      return l.length ? t('On the list: {items}.', { items: joinList(l.map((i) => (i.qty && i.qty !== 1 ? `${i.qty}× ${i.text}` : i.text))) }) : t('The list is empty.');
    }
    case 'cook': {
      const c = cookIdeasTool();
      const ready = c.ready_now.slice(0, 3).map((r) => r.title);
      if (ready.length) return t('Works with what is at home: {list}.', { list: joinList(ready) });
      const almost = c.one_or_two_missing.slice(0, 2).map((r) => `${r.title} (${t('missing: {list}', { list: r.missing.join(', ') })})`);
      return almost.length ? t('Almost: {list}.', { list: almost.join('; ') }) : t('No recipe fits what is at home yet.');
    }
    case 'money': {
      if (intent.shop) {
        // "Was hab ich bei Lidl ausgegeben?" – this month, from the receipts and expenses
        const s = moneySummary({ shop: intent.shop });
        const hit = s.by_shop[0];
        return hit ? t('At {shop} this month so far: {total}.', { shop: hit.name, total: hit.total }) : t('Nothing spent at {shop} this month so far.', { shop: intent.shop });
      }
      const m = moneySummary({});
      return m.budget ? t('This month so far {total}, {left} left of the budget.', { total: m.total, left: m.budget.left }) : t('This month so far {total}.', { total: m.total });
    }
    case 'remember': {
      const res = rememberTool(ctx, { text: intent.text }) as { ok: boolean; hint?: string; updated_from?: string; now?: string };
      if (!res.ok) return res.hint ?? '';
      // "Merk dir, Mika hat Schuhgröße 29" when 28 was remembered: the old value is replaced, not doubled
      if (res.updated_from) return t('Updated: {text} (before: {old}).', { text: res.now ?? intent.text, old: res.updated_from });
      return t('Got it, ToHuus remembers that.');
    }
    case 'reply': {
      if (intent.answer === 'thanks') return t('Gladly.');
      if (intent.answer === 'yes') {
        const p = lastPending(ctx.userId);
        if (p) return basicKnowledgeConfirm(ctx, p);
      }
      if (intent.answer === 'no') return t('All right.');
      // "Ja" / "speicher das Rezept" refer to the last answer – only the model can follow up, never the list
      if (aiConfigured('text') && aiOffReason()) return t('AI is off – I understand simple sentences like “milk is out and 2 peppers”.');
      return aiEnabled('text') ? t('The assistant is busy right now. Please try again in a moment.') : t('I can’t do that without the AI assistant. Simple sentences like “milk, 2 peppers and bread” always work.');
    }
    case 'hello': {
      if (aiConfigured('text') && aiOffReason() === 'consent')
        return t('Hi! I’m the ToHuus assistant. AI is not switched on yet – you can allow it under Settings › With or without AI. Until then I understand short things like “milk, 2 peppers and bread” or “do we still have eggs?”.');
      return t('Hi! I’m the ToHuus assistant. Tell me what is missing (“milk, 2 peppers and bread”), ask “do we still have eggs?” or “what can we cook?”.');
    }
    case 'forget': {
      const r = forgetTool(ctx, { text: intent.text }) as any;
      return r.forgotten?.length ? t('Forgotten.') : t('Nothing matching was found.');
    }
    default:
      break;
  }
  // AI switched off (household, person, child) while a model exists: say so plainly
  if (aiConfigured('text') && aiOffReason() === 'consent')
    return t('For that I need AI, and it is not switched on yet – you can allow it under Settings › With or without AI. Short things like “milk, 2 peppers and bread” always work.');
  if (aiConfigured('text') && aiOffReason()) return t('AI is off – I understand simple sentences like “milk is out and 2 peppers”.');
  return !aiEnabled('text')
    ? t('I understand short things like “milk, 2 peppers and bread”, “milk is out”, “do we still have eggs?” or “bought milk and bread at Aldi for 12.40”.')
    : t('I didn’t get that. Try something like “milk, 2 peppers and bread” or “what can we cook?”.');
}
