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
import { t } from '../i18n.js';
import { aiOffReason } from './ai-policy.js';
import { addUsage, aiConfigured, aiEnabled, AiError, chat, zeroUsage, type ChatMessage, type Usage } from './ai.js';
import { buildContext, topicsOf } from './assistant-context.js';
import { parseIntent, type Intent } from './assistant-parse.js';
import {
  cookIdeasTool,
  forgetTool,
  listAdd,
  listShow,
  logPurchase,
  moneySummary,
  quickItems,
  rememberTool,
  rhythmDueTool,
  runTool,
  stockFind,
  stockUsedUp,
  toolsFor,
  type AssistantAction,
  type ToolCtx,
} from './assistant-tools.js';
import { consumeAssistant, UsageLimitError, type ConsumeResult } from './limits.js';

/** HTTP 402 for the apps when the monthly assistant messages are used up. */
export const assistantQuotaError = () =>
  new UsageLimitError(t('The assistant messages for this month are used up. Simple things like “milk and bread” still work.'), 402, 'quota.assistant', 0);
import { fmtMoney } from './money.js';

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
const HISTORY = 12;

export interface AssistantUser {
  userId: number | null;
  name: string;
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
- Antworte auf Deutsch, Du-Form, kurz und warm (1–3 Sätze, Listen nur für Vorschläge). Keine Emojis, kein Marketing.
- Daten (Liste, Vorrat, Preise, Pläne) nur aus den Werkzeugen, nie erfinden.
- Wer "wir brauchen was für X" sagt (z. B. Pfannkuchen-Abend): überleg dir die üblichen Zutaten, prüf sie mit check_at_home und setz nur, was vermutlich fehlt, mit list_add auf die Liste. Sag kurz, was du draufgesetzt hast und was du als vorhanden angenommen hast.
- Kochideen: erst cook_ideas. Ist nichts da oder der Vorrat leer, schlag trotzdem 2–3 einfache, günstige Alltagsgerichte vor. Kosten nur aus known_prices; sonst sag, dass es eine grobe Schätzung ist, ohne genaue Zahlen vorzutäuschen. Biete an, die Zutaten auf die Liste zu setzen.
- Vorschläge aus dem Kaufrhythmus erst nach einem Ja auf die Liste. "Merk dir …" → remember, sonst nichts über Personen speichern.
- Keine medizinischen oder Ernährungsratschläge, nie "allergenfrei" behaupten. Rezepte von ToHuus sind schon gefiltert; sag nicht, warum etwas fehlt.`;

const PROMPT_EN = `You are ToHuus, this household's shopping and household assistant: shopping list, what is at home, what to cook, what it costs.
- Answer in English, short and warm (1–3 sentences, lists only for suggestions). No emojis, no marketing.
- Data (list, stock, prices, plans) only from the tools, never made up.
- "We need something for X" (e.g. a pancake evening): think of the usual ingredients, check them with check_at_home and put only what is probably missing on the list with list_add. Say briefly what you added and what you assumed is at home.
- Cooking ideas: first cook_ideas. If there is nothing or the pantry is empty, still suggest 2–3 simple, cheap everyday meals. Costs only from known_prices; otherwise say it is a rough estimate without pretending precision. Offer to put the ingredients on the list.
- Rhythm suggestions go on the list only after a yes. "Remember …" → remember; store nothing else about people.
- No medical or nutrition advice, never claim "allergen-free". ToHuus already filters recipes; do not say why something is left out.`;

export function systemPrompt(contextText: string) {
  return `${lang() === 'de' ? PROMPT_DE : PROMPT_EN}\n\n${contextText}`;
}

// ------------------------------------------------------------------ chat

export async function chatOnce(input: {
  message: string;
  conversationId?: string | null;
  user: AssistantUser;
  /** already counted (voice: the recording counts as the message) */
  allowance?: ConsumeResult;
}): Promise<ChatOutput> {
  const message = input.message.trim().slice(0, 2000);
  if (!message) throw new AssistantError(t('Please write or say something.'));
  pruneConversations();
  if (input.conversationId && !ownConversation(input.conversationId, input.user)) throw new AssistantError(t('Conversation not found'), 404);
  // count before anything is stored: over the allowance, what the built-in reader understands still works (it costs
  // no model call); anything else answers HTTP 402 { code: 'quota.assistant' }
  // what the built-in reader fully understands (lists, "ist alle", a told purchase, "merk dir") is answered without a
  // model and without counting; everything else – questions, cooking, vague parts – goes to the model when there is one
  const intent = parseIntent(message);
  const simple = fullyUnderstood(intent);
  // a bare list of products ("Bananen und Haferflocken") means "put these on the list" – also when it was spoken:
  // the recording already counted (input.allowance), but the answer still comes from the built-in reader
  const allowance = aiEnabled('text') && !simple ? (input.allowance ?? consumeAssistant()) : null;
  const overQuota = Boolean(allowance && !allowance.ok);
  if (overQuota && intent.kind === 'unknown') throw assistantQuotaError();
  const conversationId = openConversation(input.conversationId, input.user, message);
  const prior = history(conversationId);
  store(conversationId, 'user', message);
  const ctx: ToolCtx = { actor: input.user.name, userId: input.user.userId, actions: [] };

  let out: { reply: string; mode: 'ai' | 'basic'; usage?: Usage; remaining?: number | null; throttled?: boolean };
  if (allowance && !(simple && overQuota)) {
    if (overQuota) {
      out = { reply: basicReply(message, ctx), mode: 'basic', remaining: 0 };
    } else {
      try {
        // Plus fair use over the allowance: still answered, just shorter
        const r = await modelReply(message, prior, ctx, input.user, allowance.throttled ? 250 : 600);
        out = { ...r, mode: 'ai', remaining: allowance.remaining, ...(allowance.throttled ? { throttled: true } : {}) };
      } catch (e) {
        if (!(e instanceof AiError)) throw e;
        console.warn('[assistant] model failed, using the built-in reader:', e.code, e.detail ?? e.message);
        // writes the model already made stay (they are in actions); otherwise the built-in reader helps
        out = { reply: ctx.actions.length ? t('Done.') : basicReply(message, ctx), mode: 'basic', remaining: allowance.remaining };
      }
    }
  } else {
    out = { reply: basicReply(message, ctx), mode: 'basic', ...(input.allowance ? { remaining: input.allowance.remaining } : {}) };
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
  return ['purchase', 'remember', 'forget', 'list'].includes(intent.kind);
}

/** The prompt for one message: only the context lines and tools its topics need. Exported for tests. */
export function promptFor(message: string, user: AssistantUser) {
  const topics = topicsOf(message);
  const context = buildContext({ purpose: 'assistant', viewer: { userId: user.userId, name: user.name }, topics });
  return { system: systemPrompt(context.text), tools: toolsFor(topics), topics };
}

async function modelReply(message: string, prior: ChatMessage[], ctx: ToolCtx, user: AssistantUser, maxTokens = 600) {
  const p = promptFor([...prior.filter((m) => m.role === 'user').slice(-2).map((m) => String(m.content)), message].join(' '), user);
  const messages: ChatMessage[] = [{ role: 'system', content: p.system }, ...prior, { role: 'user', content: message }];
  let usage = zeroUsage();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await chat({ kind: 'text', messages, tools: p.tools, temperature: 0.3, maxTokens });
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
export function basicReply(message: string, ctx: ToolCtx, intent: Intent = parseIntent(message)): string {
  switch (intent.kind) {
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
      const m = moneySummary({});
      return m.budget ? t('This month so far {total}, {left} left of the budget.', { total: m.total, left: m.budget.left }) : t('This month so far {total}.', { total: m.total });
    }
    case 'remember': {
      const res = rememberTool(ctx, { text: intent.text });
      if (!res.ok) return res.hint ?? '';
      return t('Got it, ToHuus remembers that.');
    }
    case 'forget': {
      const r = forgetTool(ctx, { text: intent.text }) as any;
      return r.forgotten?.length ? t('Forgotten.') : t('Nothing matching was found.');
    }
    default:
      break;
  }
  // AI switched off (household, person, child) while a model exists: say so plainly
  if (aiConfigured('text') && aiOffReason()) return t('AI is off – I understand simple sentences like “milk is out and 2 peppers”.');
  return !aiEnabled('text')
    ? t('I understand short things like “milk, 2 peppers and bread”, “milk is out”, “do we still have eggs?” or “bought milk and bread at Aldi for 12.40”.')
    : t('I didn’t get that. Try something like “milk, 2 peppers and bread” or “what can we cook?”.');
}
