/**
 * The one client for language, vision and audio models (plan 12 Oct 2026, decision 6).
 *
 * OpenAI-compatible chat completions; OpenRouter is the default. Every request that goes to OpenRouter is pinned to
 * Mistral (EU) with `provider: { order: ['mistral'], allow_fallbacks: false, data_collection: 'deny' }`, so a
 * household's text never lands at a provider that trains on it or sits outside the EU.
 *
 * Configuration (environment, read on every call so tests and restarts see changes; in ToHuus Cloud the operator's
 * runtime settings – `/betrieb` › Einstellungen, server/lib/runtime-settings.ts – override the same names):
 *   AI_BASE_URL          default https://openrouter.ai/api/v1 (when AI_API_KEY is set)
 *   AI_API_KEY
 *   AI_MODEL_TEXT        default mistralai/mistral-small-2603
 *   AI_MODEL_VISION      default mistralai/mistral-small-2603
 *   AI_MODEL_VISION_HARD default mistralai/mistral-large-4-0 (second try for receipts that do not add up)
 *   AI_MODEL_AUDIO       default mistralai/voxtral-small-24b-2507
 * Older installs: VISION_BASE_URL / VISION_API_KEY / VISION_MODEL keep working when no AI_* is set.
 *
 * Nothing here knows about households, privacy or plans: callers redact (people-signals.ts) and count
 * (limits.ts) before they call. Tests replace the network with setAiFetch().
 */
import crypto from 'node:crypto';
import { t } from '../i18n.js';
import { aiOffReason, type AiOffReason } from './ai-policy.js';

export const OPENROUTER = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODELS = {
  text: 'mistralai/mistral-small-2603',
  vision: 'mistralai/mistral-small-2603',
  visionHard: 'mistralai/mistral-large-4-0',
  audio: 'mistralai/voxtral-small-24b-2507',
} as const;

export type ModelKind = 'text' | 'vision' | 'visionHard' | 'audio';

/**
 * Other Mistral models tried in turn when the configured one is rate-limited or down upstream (OpenRouter shares
 * Mistral's limits between all its customers, so a busy evening can answer 429 for minutes). Still Mistral, still
 * pinned to the EU provider. `AI_MODEL_FALLBACKS` (comma-separated, `-` = none) overrides the list for text and vision;
 * only used with the default OpenRouter setup or when set explicitly.
 */
export const DEFAULT_FALLBACKS: Record<ModelKind, string[]> = {
  text: ['mistralai/mistral-medium-3.1', 'mistralai/mistral-large-2512'],
  vision: ['mistralai/mistral-medium-3.1', 'mistralai/mistral-large-4-0'],
  visionHard: ['mistralai/mistral-medium-3.1'],
  audio: [],
};

/**
 * Cloud: runtime settings from the operator back office (runtime-settings.ts registers `overrides`, cached there and
 * dropped on every change). They use the environment variable names and win over the environment.
 */
export const aiRuntime: { overrides?: () => Record<string, string> } = {};

/** The environment with the operator's runtime settings on top (only for the real process environment). */
export function effectiveEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env !== process.env || !aiRuntime.overrides) return env;
  let o: Record<string, string> = {};
  try {
    o = aiRuntime.overrides();
  } catch {
    o = {};
  }
  return Object.keys(o).length ? { ...env, ...o } : env;
}

export function fallbackModels(kind: ModelKind, primary: string, envIn: NodeJS.ProcessEnv = process.env): string[] {
  const env = effectiveEnv(envIn);
  const raw = (env.AI_MODEL_FALLBACKS ?? '').trim();
  const cfg = aiConfig(envIn);
  let list: string[];
  if (raw === '-') list = [];
  else if (raw) list = kind === 'audio' ? [] : raw.split(',').map((x) => x.trim()).filter(Boolean);
  else list = cfg?.openrouter ? DEFAULT_FALLBACKS[kind] : [];
  return list.filter((m) => m !== primary);
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  openrouter: boolean;
  models: Record<ModelKind, string | null>;
  /** where the configuration came from (for the settings page and logs) */
  source: 'ai' | 'vision';
}

const clean = (s: string | undefined) => (s ?? '').trim();

/** Current configuration, or null when no model is set up at all. */
export function aiConfig(envIn: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const env = effectiveEnv(envIn);
  const aiBase = clean(env.AI_BASE_URL).replace(/\/$/, '');
  const aiKey = clean(env.AI_API_KEY);
  if (aiBase || aiKey) {
    const baseUrl = aiBase || OPENROUTER;
    return {
      baseUrl,
      apiKey: aiKey,
      openrouter: isOpenRouter(baseUrl),
      source: 'ai',
      models: {
        text: clean(env.AI_MODEL_TEXT) || DEFAULT_MODELS.text,
        vision: clean(env.AI_MODEL_VISION) || DEFAULT_MODELS.vision,
        visionHard: clean(env.AI_MODEL_VISION_HARD) || DEFAULT_MODELS.visionHard,
        audio: clean(env.AI_MODEL_AUDIO) || DEFAULT_MODELS.audio,
      },
    };
  }
  const vBase = clean(env.VISION_BASE_URL).replace(/\/$/, '');
  const vModel = clean(env.VISION_MODEL);
  if (vBase && vModel) {
    return {
      baseUrl: vBase,
      apiKey: clean(env.VISION_API_KEY),
      openrouter: isOpenRouter(vBase),
      source: 'vision',
      models: {
        text: clean(env.AI_MODEL_TEXT) || vModel,
        vision: vModel,
        visionHard: clean(env.AI_MODEL_VISION_HARD) || null,
        audio: clean(env.AI_MODEL_AUDIO) || null,
      },
    };
  }
  return null;
}

export const isOpenRouter = (baseUrl: string) => /(^|\/\/)([a-z0-9-]+\.)*openrouter\.ai(\/|$|:)/i.test(baseUrl);

/** Is a model of this kind configured (environment only, whatever the household chose)? */
export function aiConfigured(kind: ModelKind = 'text'): boolean {
  return Boolean(aiConfig()?.models[kind]);
}

/**
 * May a model of this kind be used for the current request? Configured AND the household, the person and – on a
 * kid tablet – the parents allow it (ai-policy.ts). Every caller that offers an AI path asks this first.
 */
export function aiEnabled(kind: ModelKind = 'text'): boolean {
  return aiConfigured(kind) && aiOffReason() === null;
}

/** The error every model call answers with while AI is switched off (household, person or child). */
export function aiDisabledError(reason: AiOffReason): AiError {
  const msg =
    reason === 'parents'
      ? t('AI was switched off by your parents.')
      : reason === 'person'
        ? t('You switched AI off for yourself (Settings › Access & AI).')
        : reason === 'consent'
          ? t('Before ToHuus uses AI for you, please agree once (Settings › Access & AI).')
          : reason === 'cloud'
          ? t('AI is paused in ToHuus Cloud right now. Everything else works as usual.')
          : t('AI is switched off for this household (Settings › Access & AI).');
  return new AiError(msg, 'ai.disabled', 403, reason);
}

/** Throws `ai.disabled` when a switch is off – the central gate in front of every model request. */
export function assertAiAllowed() {
  const off = aiOffReason();
  if (off) throw aiDisabledError(off);
}

/** The provider pin for OpenRouter (EU / Mistral only, no training on the data). Empty for other endpoints. */
export function providerPin(baseUrl: string): Record<string, unknown> {
  return isOpenRouter(baseUrl) ? { provider: { order: ['mistral'], allow_fallbacks: false, data_collection: 'deny' } } : {};
}

// ------------------------------------------------------------------ transport (replaceable in tests)

/** Cloud operator statistics (operator.ts): tokens per day and model – no household, no person. */
export const aiUsageHook: { record?: (model: string, usage: Usage) => void } = {};

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike | null = null;
/** Tests: answer requests without the network. Pass null to restore the real fetch. */
export function setAiFetch(f: FetchLike | null) {
  fetchImpl = f;
}
const doFetch: FetchLike = (url, init) => (fetchImpl ?? fetch)(url, init);

export type AiErrorCode = 'ai.disabled' | 'not_configured' | 'timeout' | 'rate_limited' | 'auth' | 'bad_request' | 'upstream' | 'bad_response';

export class AiError extends Error {
  constructor(
    message: string,
    public code: AiErrorCode,
    /** HTTP status the API should answer with */
    public status: number,
    public detail?: string,
  ) {
    super(message);
  }
}

function errorFor(status: number, body: string): AiError {
  const detail = body.slice(0, 300);
  if (status === 401 || status === 403) return new AiError(t('The AI service did not accept the key. Please check AI_API_KEY.'), 'auth', 502, detail);
  if (status === 429) return new AiError(t('The AI service is busy right now. Please try again in a moment.'), 'rate_limited', 503, detail);
  if (status === 400 || status === 404 || status === 422) return new AiError(t('The AI service could not handle this request.'), 'bad_request', 502, detail);
  return new AiError(t('The AI service is not reachable right now.'), 'upstream', 502, detail);
}

const retryable = (e: unknown) => e instanceof AiError && (e.code === 'rate_limited' || e.code === 'upstream' || e.code === 'timeout');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ chat

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Usage {
  prompt: number;
  completion: number;
  total: number;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
  model: string;
}

export interface ChatOptions {
  kind?: ModelKind;
  /** overrides the configured model of `kind` */
  model?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  /** per attempt, default 60 s (vision 120 s) */
  timeoutMs?: number;
  /** extra attempts after the first for 429/5xx/timeouts, default 2 */
  retries?: number;
  /** absolute time (ms since epoch) after which no further attempt starts; each attempt's timeout is cut to it */
  deadline?: number;
  /** base backoff, default 600 ms (doubles per attempt) */
  backoffMs?: number;
  json?: boolean;
}

const zeroUsage = (): Usage => ({ prompt: 0, completion: 0, total: 0 });

/**
 * Mistral only takes tool-call ids of exactly nine letters/digits and no `null` content next to tool calls; other
 * providers in between (OpenRouter) may hand out longer ids. Ids are mapped deterministically, so the assistant's
 * call and the tool's answer still match.
 */
export function mistralSafe(messages: ChatMessage[]): ChatMessage[] {
  const fix = (id: string) => (/^[A-Za-z0-9]{9}$/.test(id) ? id : crypto.createHash('sha256').update(id).digest('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 9).padEnd(9, '0'));
  return messages.map((m) => ({
    ...m,
    ...(m.tool_calls ? { content: m.content ?? '', tool_calls: m.tool_calls.map((c) => ({ ...c, id: fix(c.id) })) } : {}),
    ...(m.tool_call_id ? { tool_call_id: fix(m.tool_call_id) } : {}),
  }));
}

/** One chat completion with timeout, retries with backoff and clean errors. */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  // AI switched off (household, person, child): not a single request leaves the server
  assertAiAllowed();
  const cfg = aiConfig();
  const kind = opts.kind ?? 'text';
  const model = opts.model ?? cfg?.models[kind] ?? null;
  if (!cfg || !model) throw new AiError(t('No AI model is set up (AI_API_KEY / AI_MODEL_*).'), 'not_configured', 503);
  const body: Record<string, unknown> = {
    model,
    messages: /mistral|voxtral|pixtral|ministral|codestral/i.test(model) ? mistralSafe(opts.messages) : opts.messages,
    temperature: opts.temperature ?? 0.2,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
    ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    ...providerPin(cfg.baseUrl),
  };
  const timeoutMs = opts.timeoutMs ?? (kind === 'vision' || kind === 'visionHard' ? 120_000 : 60_000);
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? 600;
  // an explicitly chosen model (opts.model) is not swapped; otherwise other Mistral models step in when it is busy
  const chain = [model, ...(opts.model ? [] : fallbackModels(kind, model))];
  let last: unknown;
  for (const [i, m] of chain.entries()) {
    const b = m === model ? body : { ...body, model: m };
    // the first model gets the full retries; a fallback one try plus one retry, so the person is not kept waiting
    const tries = i === 0 ? retries : Math.min(1, retries);
    for (let attempt = 0; attempt <= tries; attempt++) {
      if (attempt > 0) await sleep(backoff * 2 ** (attempt - 1));
      const left = opts.deadline ? opts.deadline - Date.now() : Infinity;
      if (left < 2000) {
        last ??= new AiError(t('The AI service took too long to answer.'), 'timeout', 504);
        break;
      }
      try {
        const res = await once(cfg, b, Math.min(timeoutMs, left));
        aiUsageHook.record?.(res.model, res.usage);
        return res;
      } catch (e) {
        last = e;
        if (!retryable(e) || attempt === tries) break;
      }
    }
    // only "busy / down / slow" moves on to the next model; a wrong request or key would fail there too
    if (!retryable(last)) break;
    if (opts.deadline && opts.deadline - Date.now() < 2000) break;
    if (i < chain.length - 1) console.warn(`[ai] ${m} unavailable (${(last as AiError).code}), trying ${chain[i + 1]}`);
  }
  throw last instanceof AiError ? last : new AiError(t('The AI service is not reachable right now.'), 'upstream', 502, String((last as Error)?.message ?? last));
}

async function once(cfg: AiConfig, body: Record<string, unknown>, timeoutMs: number): Promise<ChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let r: Response;
  try {
    r = await doFetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        'HTTP-Referer': (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
        'X-Title': 'ToHuus Hub',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' || ctrl.signal.aborted) throw new AiError(t('The AI service took too long to answer.'), 'timeout', 504);
    throw new AiError(t('The AI service is not reachable right now.'), 'upstream', 502, (e as Error)?.message);
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw errorFor(r.status, await r.text().catch(() => ''));
  let j: any;
  try {
    j = await r.json();
  } catch {
    throw new AiError(t('The AI service sent an answer that could not be read.'), 'bad_response', 502);
  }
  // OpenRouter reports provider errors inside a 200 sometimes
  if (j?.error) throw errorFor(Number(j.error.code) || 502, JSON.stringify(j.error));
  const msg = j?.choices?.[0]?.message;
  if (!msg) throw new AiError(t('The AI service sent an answer that could not be read.'), 'bad_response', 502);
  const content = Array.isArray(msg.content) ? msg.content.map((c: any) => c?.text ?? '').join('') : String(msg.content ?? '');
  const toolCalls: ToolCall[] = Array.isArray(msg.tool_calls)
    ? msg.tool_calls
        .filter((c: any) => c?.function?.name)
        .map((c: any, i: number) => ({
          id: String(c.id ?? `call_${i}`),
          type: 'function' as const,
          function: { name: String(c.function.name), arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}) },
        }))
    : [];
  const u = j.usage ?? {};
  const usage: Usage = {
    prompt: Number(u.prompt_tokens) || 0,
    completion: Number(u.completion_tokens) || 0,
    total: Number(u.total_tokens) || (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0),
  };
  return { content, toolCalls, usage, model: String(j.model ?? body.model) };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return { prompt: a.prompt + b.prompt, completion: a.completion + b.completion, total: a.total + b.total };
}
export { zeroUsage };

/** Pull the first JSON object out of a model answer (code fences and chatter around it are fine). */
export function extractJson(s: string): any {
  const cleaned = s.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new AiError(t('No JSON answer from the model'), 'bad_response', 502);
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new AiError(t('No JSON answer from the model'), 'bad_response', 502);
  }
}

/**
 * Operator back office: one tiny request to the configured model of `kind` (no household data, no policy switch –
 * it checks the key, the base URL and the model). Counted like any other request.
 */
export async function pingModel(kind: ModelKind = 'text'): Promise<{ ok: true; model: string; ms: number } | { ok: false; code: AiErrorCode; error: string; detail?: string }> {
  const cfg = aiConfig();
  const model = cfg?.models[kind] ?? null;
  if (!cfg || !model) return { ok: false, code: 'not_configured', error: t('No AI model is set up (AI_API_KEY / AI_MODEL_*).') };
  const started = Date.now();
  try {
    const res = await once(cfg, { model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], temperature: 0, max_tokens: 3, ...providerPin(cfg.baseUrl) }, 20_000);
    aiUsageHook.record?.(res.model, res.usage);
    return { ok: true, model: res.model, ms: Date.now() - started };
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError(String((e as Error)?.message ?? e), 'upstream', 502);
    return { ok: false, code: err.code, error: err.message, detail: err.detail?.slice(0, 200) };
  }
}

// ------------------------------------------------------------------ audio

/** Audio formats the chat endpoint takes as `input_audio` (OpenRouter docs, Oct 2026), by MIME type or file ending. */
const AUDIO_FORMATS: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  // browsers (Chrome, Firefox) record WebM/Opus; passed through as-is, Voxtral reads it via ffmpeg on the provider side
  'audio/webm': 'webm',
  'video/webm': 'webm',
};
const AUDIO_EXT = ['wav', 'mp3', 'aiff', 'aac', 'ogg', 'flac', 'm4a', 'webm'];

export function audioFormat(mime: string | undefined, filename?: string): string | null {
  const m = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (AUDIO_FORMATS[m]) return AUDIO_FORMATS[m];
  const ext = (filename ?? '').toLowerCase().split('.').pop() ?? '';
  if (ext === 'mp4' || ext === 'caf') return 'm4a';
  return AUDIO_EXT.includes(ext) ? ext : null;
}

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', de: 'German' };

/** Speech to text with the audio model (Voxtral): an `input_audio` content part in a chat completion. */
export async function transcribe(audio: Buffer, format: string, language = 'de'): Promise<{ text: string; usage: Usage; model: string }> {
  assertAiAllowed();
  if (!aiEnabled('audio')) throw new AiError(t('No speech model is set up (AI_MODEL_AUDIO).'), 'not_configured', 503);
  if (!audio.length) throw new AiError(t('The recording is empty.'), 'bad_request', 400);
  const res = await chat({
    kind: 'audio',
    temperature: 0,
    timeoutMs: 90_000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Transcribe this recording word for word. The speaker most likely talks ${LANGUAGE_NAMES[language] ?? 'German'}. Return only the transcript, nothing else.`,
          },
          { type: 'input_audio', input_audio: { data: audio.toString('base64'), format } },
        ],
      },
    ],
  });
  return { text: res.content.trim().replace(/^"|"$/g, ''), usage: res.usage, model: res.model };
}

// ------------------------------------------------------------------ startup check

/**
 * Warn in the log when the configured vision model does not take images (OpenRouter `/models`,
 * architecture.input_modalities). Never throws; returns the warning for tests.
 */
export async function checkVisionModel(): Promise<string | null> {
  const cfg = aiConfig();
  const model = cfg?.models.vision;
  if (!cfg || !model || !cfg.openrouter) return null;
  // self-host with AI switched off: not even the model list is fetched
  if (aiOffReason() === 'household') return null;
  try {
    const r = await doFetch(`${cfg.baseUrl}/models`, { method: 'GET', headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {} });
    if (!r.ok) return null;
    const j: any = await r.json();
    const m = (j?.data ?? []).find((x: any) => x?.id === model);
    let warning: string | null = null;
    if (!m) warning = `[ai] vision model ${model} is not listed by OpenRouter – check AI_MODEL_VISION`;
    else {
      const inputs: string[] = m.architecture?.input_modalities ?? [];
      if (!inputs.includes('image')) warning = `[ai] vision model ${model} does not accept images (inputs: ${inputs.join(', ') || 'unknown'}) – receipt photos will fail`;
    }
    if (warning) console.warn(warning);
    return warning;
  } catch {
    return null;
  }
}
