/**
 * The household assistant ("ToHuus" in the floating button on every tab): shopping and household helper, cook
 * planner, money helper. Short answers, no medical or nutrition advice, never "allergen-free".
 *
 *  - With a model (ai.ts, OpenRouter pinned to Mistral): tool calling over assistant-tools.ts, up to 4 rounds.
 *  - Without a model, over the monthly allowance or when the model fails: the deterministic reader
 *    (assistant-parse.ts) still turns "Milch, 2 Paprika und Brot" into list items and answers the common questions.
 *
 * Conversations are stored per person (assistant_conversations / assistant_messages), kept 30 days, deletable.
 * Usage is counted through limits-shim.ts before any model call.
 */
import crypto from 'node:crypto';
import { db, lang, migrate } from '../db.js';
import { t } from '../i18n.js';
import { addUsage, aiEnabled, AiError, chat, zeroUsage, type ChatMessage, type Usage } from './ai.js';
import { buildContext } from './assistant-context.js';
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
  TOOL_DEFS,
  type AssistantAction,
  type ToolCtx,
} from './assistant-tools.js';
import { consumeAssistant } from './limits-shim.js';
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

const PROMPT_DE = `Du bist ToHuus, der Einkaufs- und Haushaltsassistent dieses Haushalts. Du hilfst bei drei Dingen:
1. Einkauf: merkst dir, was fehlt, führst die gemeinsame Einkaufsliste, sagst, was vermutlich fällig ist.
2. Kochen: schlägst vor, was sich aus dem kochen lässt, was da ist, und planst die Woche, wenn jemand das möchte.
3. Geld: sagst, was Lebensmittel und Haushalt kosten, pro Laden und Kategorie, und gibst ruhige Spartipps aus den eigenen Bons.
Regeln:
- Antworte auf Deutsch, in der Du-Form, kurz und freundlich – meist ein bis drei Sätze. Kein Marketing, keine Emojis.
- Nutze die Werkzeuge für alles, was Liste, Vorrat, Plan, Geld oder Erinnerungen betrifft. Erfinde keine Daten.
- Schreibe nur, wenn die Person es will. Abgeleitete Dinge (Rhythmus) schlägst du vor und setzt sie erst nach einem Ja auf die Liste.
- "Merk dir …" → remember. Speichere sonst nichts über Personen.
- Keine medizinischen, Ernährungs- oder Gesundheitsratschläge. Behaupte nie, etwas sei "allergenfrei" oder für jemanden unbedenklich. Rezeptideen von ToHuus sind schon vorgefiltert; sag nicht, warum etwas fehlt.
- Wenn etwas nicht geht, sag es ehrlich und kurz.`;

const PROMPT_EN = `You are ToHuus, this household's shopping and household assistant. You help with three things:
1. Shopping: remember what is missing, keep the shared shopping list, say what is probably due.
2. Cooking: suggest what can be cooked from what is at home, plan the week when someone wants that.
3. Money: say what food and household cost, per shop and category, and give calm saving hints from the household's own receipts.
Rules:
- Answer in English, short and friendly – usually one to three sentences. No marketing, no emojis.
- Use the tools for anything about the list, stock, plan, money or things to remember. Never make up data.
- Only write when the person wants it. Derived things (rhythm) are suggestions; put them on the list only after a yes.
- "Remember …" → remember. Do not store anything else about people.
- No medical, nutrition or health advice. Never claim something is "allergen-free" or safe for someone. ToHuus already filters recipe ideas; do not say why something is left out.
- If something does not work, say so briefly and honestly.`;

export function systemPrompt(contextText: string) {
  return `${lang() === 'de' ? PROMPT_DE : PROMPT_EN}\n\n--- ${lang() === 'de' ? 'Lage im Haushalt' : 'Household right now'} ---\n${contextText}`;
}

// ------------------------------------------------------------------ chat

export async function chatOnce(input: { message: string; conversationId?: string | null; user: AssistantUser }): Promise<ChatOutput> {
  const message = input.message.trim().slice(0, 2000);
  if (!message) throw new AssistantError(t('Please write or say something.'));
  pruneConversations();
  const conversationId = openConversation(input.conversationId, input.user, message);
  const prior = history(conversationId);
  store(conversationId, 'user', message);
  const ctx: ToolCtx = { actor: input.user.name, userId: input.user.userId, actions: [] };

  let out: { reply: string; mode: 'ai' | 'basic'; usage?: Usage; remaining?: number | null };
  if (aiEnabled('text')) {
    const allowance = consumeAssistant();
    if (!allowance.ok) {
      const basic = basicReply(message, ctx);
      out = { reply: `${allowance.reason ?? t('The assistant messages for this month are used up.')} ${basic}`.trim(), mode: 'basic', remaining: allowance.remaining };
    } else {
      try {
        const r = await modelReply(message, prior, ctx, input.user);
        out = { ...r, mode: 'ai', remaining: allowance.remaining };
      } catch (e) {
        if (!(e instanceof AiError)) throw e;
        console.warn('[assistant] model failed, using the built-in reader:', e.code, e.detail ?? e.message);
        // writes the model already made stay (they are in actions); otherwise the built-in reader helps
        out = { reply: ctx.actions.length ? t('Done.') : basicReply(message, ctx), mode: 'basic', remaining: allowance.remaining };
      }
    }
  } else {
    out = { reply: basicReply(message, ctx), mode: 'basic' };
  }
  store(conversationId, 'assistant', out.reply, { actions: ctx.actions, mode: out.mode, tokens: out.usage?.total ?? 0 });
  return { conversationId, reply: out.reply, actions: ctx.actions, mode: out.mode, ...(out.usage ? { usage: out.usage } : {}), ...(out.remaining !== undefined ? { remaining: out.remaining } : {}) };
}

async function modelReply(message: string, prior: ChatMessage[], ctx: ToolCtx, user: AssistantUser) {
  const context = buildContext({ purpose: 'assistant', viewer: { userId: user.userId, name: user.name } });
  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt(context.text) }, ...prior, { role: 'user', content: message }];
  let usage = zeroUsage();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await chat({ kind: 'text', messages, tools: TOOL_DEFS, temperature: 0.3, maxTokens: 600 });
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
      const r = listAdd(ctx, quickItems(intent.items));
      const parts: string[] = [];
      if (r.added.length) parts.push(t('{items} – on the list.', { items: joinList(r.added) }));
      if (r.already_on_list.length) parts.push(t('{items} was already on it.', { items: joinList(r.already_on_list) }));
      return parts.join(' ');
    }
    case 'used_up': {
      const r = stockUsedUp(ctx, intent.item);
      const first = t('{item} is on the list.', { item: r.product ?? intent.item });
      return intent.rest ? `${first} ${t('For the rest I need a few more words, or the list.')}` : first;
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
      rememberTool(ctx, { text: intent.text });
      return t('Got it, ToHuus remembers that.');
    }
    case 'forget': {
      const r = forgetTool(ctx, { text: intent.text }) as any;
      return r.forgotten?.length ? t('Forgotten.') : t('Nothing matching was found.');
    }
    default:
      break;
  }
  return !aiEnabled('text')
    ? t('I understand short things like “milk, 2 peppers and bread”, “milk is out”, “do we still have eggs?” or “bought milk and bread at Aldi for 12.40”.')
    : t('I didn’t get that. Try something like “milk, 2 peppers and bread” or “what can we cook?”.');
}
