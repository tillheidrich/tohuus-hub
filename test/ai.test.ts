/**
 * AI client (server/lib/ai.ts) and vision through it: configuration from AI_* and the old VISION_* variables,
 * the OpenRouter provider pin (Mistral, no fallbacks, no data collection), retries, error mapping, tool calls,
 * token usage, audio as `input_audio`, the startup model check, and the second try for receipts that don't add up.
 * No network: every request goes to a fake fetch.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tohuus-ai-'));
process.env.LANGUAGE = 'en';
for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL_TEXT', 'AI_MODEL_VISION', 'AI_MODEL_VISION_HARD', 'AI_MODEL_AUDIO', 'VISION_BASE_URL', 'VISION_API_KEY', 'VISION_MODEL']) delete process.env[k];

let ai: typeof import('../server/lib/ai');
let vision: typeof import('../server/lib/vision');

interface Call {
  url: string;
  body: any;
  headers: Record<string, string>;
}
const calls: Call[] = [];
function fake(responses: ((body: any) => { status?: number; json?: unknown; text?: string } | Error)[]) {
  let i = 0;
  ai.setAiFetch(async (url, init) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, headers: init.headers as Record<string, string> });
    const r = responses[Math.min(i++, responses.length - 1)](body);
    if (r instanceof Error) throw r;
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
}
const answer = (content: string, extra: Record<string, unknown> = {}) => () => ({
  json: { model: 'm', choices: [{ message: { role: 'assistant', content, ...extra } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
});

beforeAll(async () => {
  ai = await import('../server/lib/ai');
  vision = await import('../server/lib/vision');
});

afterEach(() => {
  calls.length = 0;
  ai.setAiFetch(null);
  for (const k of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL_TEXT', 'AI_MODEL_VISION', 'AI_MODEL_VISION_HARD', 'AI_MODEL_AUDIO', 'VISION_BASE_URL', 'VISION_API_KEY', 'VISION_MODEL']) delete process.env[k];
});

describe('configuration', () => {
  it('is off without any key', () => {
    expect(ai.aiConfig()).toBeNull();
    expect(ai.aiEnabled('text')).toBe(false);
    expect(vision.visionAvailable()).toBe(false);
  });

  it('AI_API_KEY alone means OpenRouter with the Mistral defaults', () => {
    process.env.AI_API_KEY = 'sk-or-test';
    const c = ai.aiConfig()!;
    expect(c.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(c.openrouter).toBe(true);
    expect(c.models).toEqual({
      text: 'mistralai/mistral-small-2603',
      vision: 'mistralai/mistral-small-2603',
      visionHard: 'mistralai/mistral-large-4-0',
      audio: 'mistralai/voxtral-small-24b-2507',
    });
    expect(vision.visionAvailable()).toBe(true);
    expect(vision.visionModel()).toBe('mistralai/mistral-small-2603');
  });

  it('the old VISION_* variables keep working', () => {
    process.env.VISION_BASE_URL = 'https://api.mistral.ai/v1/';
    process.env.VISION_MODEL = 'pixtral-12b';
    process.env.VISION_API_KEY = 'k';
    const c = ai.aiConfig()!;
    expect(c.source).toBe('vision');
    expect(c.baseUrl).toBe('https://api.mistral.ai/v1');
    expect(c.models.vision).toBe('pixtral-12b');
    expect(c.models.text).toBe('pixtral-12b');
    expect(c.models.audio).toBeNull();
    expect(ai.aiEnabled('audio')).toBe(false);
  });

  it('pins the provider only for OpenRouter', () => {
    expect(ai.providerPin('https://openrouter.ai/api/v1')).toEqual({ provider: { order: ['mistral'], allow_fallbacks: false, data_collection: 'deny' } });
    expect(ai.providerPin('https://api.mistral.ai/v1')).toEqual({});
    expect(ai.providerPin('http://localhost:11434/v1')).toEqual({});
    expect(ai.isOpenRouter('https://evil.example/openrouter.ai')).toBe(false);
  });
});

describe('chat', () => {
  it('sends the provider pin, the key and returns text and usage', async () => {
    process.env.AI_API_KEY = 'sk-or-test';
    fake([answer('Hallo')]);
    const r = await ai.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.content).toBe('Hallo');
    expect(r.usage).toEqual({ prompt: 10, completion: 5, total: 15 });
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0].body.provider).toEqual({ order: ['mistral'], allow_fallbacks: false, data_collection: 'deny' });
    expect(calls[0].body.model).toBe('mistralai/mistral-small-2603');
    expect(calls[0].headers.Authorization).toBe('Bearer sk-or-test');
  });

  it('no provider pin for another endpoint', async () => {
    process.env.AI_BASE_URL = 'http://ollama.local:11434/v1';
    process.env.AI_MODEL_TEXT = 'mistral-small';
    fake([answer('ok')]);
    await ai.chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0].body.provider).toBeUndefined();
    expect(calls[0].body.model).toBe('mistral-small');
  });

  it('retries 429 and 5xx with backoff, then succeeds', async () => {
    process.env.AI_API_KEY = 'k';
    fake([() => ({ status: 429, text: 'slow down' }), () => ({ status: 502, text: 'bad gateway' }), answer('third time')]);
    const r = await ai.chat({ messages: [{ role: 'user', content: 'x' }], backoffMs: 1 });
    expect(r.content).toBe('third time');
    expect(calls).toHaveLength(3);
  });

  it('maps errors cleanly and does not retry a bad key', async () => {
    process.env.AI_API_KEY = 'k';
    fake([() => ({ status: 401, text: 'no' })]);
    await expect(ai.chat({ messages: [{ role: 'user', content: 'x' }], backoffMs: 1 })).rejects.toMatchObject({ code: 'auth', status: 502 });
    expect(calls).toHaveLength(1);
    fake([() => ({ status: 503, text: 'down' })]);
    await expect(ai.chat({ messages: [{ role: 'user', content: 'x' }], retries: 1, backoffMs: 1 })).rejects.toMatchObject({ code: 'upstream' });
    fake([() => ({ json: { error: { code: 429, message: 'Provider rate limited' } } })]);
    await expect(ai.chat({ messages: [{ role: 'user', content: 'x' }], retries: 0 })).rejects.toMatchObject({ code: 'rate_limited' });
    fake([() => ({ text: 'not json' })]);
    await expect(ai.chat({ messages: [{ role: 'user', content: 'x' }], retries: 0 })).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('times out', async () => {
    process.env.AI_API_KEY = 'k';
    ai.setAiFetch((_url, init) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    await expect(ai.chat({ messages: [{ role: 'user', content: 'x' }], timeoutMs: 20, retries: 0 })).rejects.toMatchObject({ code: 'timeout', status: 504 });
  });

  it('not configured → 503', async () => {
    await expect(ai.chat({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({ code: 'not_configured', status: 503 });
  });

  it('passes tools and reads tool calls', async () => {
    process.env.AI_API_KEY = 'k';
    fake([answer('', { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_add', arguments: '{"items":[{"name":"Milch"}]}' } }] })]);
    const r = await ai.chat({ messages: [{ role: 'user', content: 'Milch' }], tools: [{ type: 'function', function: { name: 'list_add', description: 'd', parameters: { type: 'object', properties: {} } } }] });
    expect(calls[0].body.tools[0].function.name).toBe('list_add');
    expect(calls[0].body.tool_choice).toBe('auto');
    expect(r.toolCalls).toEqual([{ id: 'c1', type: 'function', function: { name: 'list_add', arguments: '{"items":[{"name":"Milch"}]}' } }]);
  });
});

describe('audio', () => {
  it('maps formats', () => {
    expect(ai.audioFormat('audio/mp4')).toBe('m4a');
    expect(ai.audioFormat('audio/x-m4a')).toBe('m4a');
    expect(ai.audioFormat('audio/webm;codecs=opus')).toBe('webm');
    expect(ai.audioFormat('application/octet-stream', 'memo.m4a')).toBe('m4a');
    expect(ai.audioFormat('application/octet-stream', 'memo.caf')).toBe('m4a');
    expect(ai.audioFormat('application/pdf', 'x.pdf')).toBeNull();
  });

  it('transcribes with Voxtral through an input_audio part', async () => {
    process.env.AI_API_KEY = 'k';
    fake([answer('Milch ist alle')]);
    const r = await ai.transcribe(Buffer.from('RIFFxxxx'), 'wav', 'de');
    expect(r.text).toBe('Milch ist alle');
    const body = calls[0].body;
    expect(body.model).toBe('mistralai/voxtral-small-24b-2507');
    expect(body.provider.order).toEqual(['mistral']);
    const part = body.messages[0].content.find((c: any) => c.type === 'input_audio');
    expect(part.input_audio).toEqual({ data: Buffer.from('RIFFxxxx').toString('base64'), format: 'wav' });
  });
});

describe('startup check of the vision model', () => {
  it('warns when the model does not take images', async () => {
    process.env.AI_API_KEY = 'k';
    process.env.AI_MODEL_VISION = 'mistralai/text-only';
    fake([() => ({ json: { data: [{ id: 'mistralai/text-only', architecture: { input_modalities: ['text'] } }] } })]);
    const w = await ai.checkVisionModel();
    expect(w).toMatch(/does not accept images/);
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/models');
  });
  it('is quiet when it does', async () => {
    process.env.AI_API_KEY = 'k';
    fake([() => ({ json: { data: [{ id: 'mistralai/mistral-small-2603', architecture: { input_modalities: ['text', 'image'] } }] } })]);
    expect(await ai.checkVisionModel()).toBeNull();
  });
});

describe('vision through the client', () => {
  it('a receipt that does not add up gets a second try with the stronger model', async () => {
    process.env.AI_API_KEY = 'k';
    const bad = { shop: 'Aldi', total: 12.4, lines: [{ name: 'Milch', qty: 1, price: 1.1 }] };
    const good = { shop: 'Aldi', total: 12.4, lines: [{ name: 'Milch', qty: 1, price: 1.1 }, { name: 'Kaffee', qty: 1, price: 11.3 }] };
    fake([answer(JSON.stringify(bad)), answer('```json\n' + JSON.stringify(good) + '\n```')]);
    const j = await vision.runVision('receipt', { images: ['data:image/jpeg;base64,AAAA'] });
    expect(j.lines).toHaveLength(2);
    expect(calls.map((c) => c.body.model)).toEqual(['mistralai/mistral-small-2603', 'mistralai/mistral-large-4-0']);
    expect(calls.every((c) => c.body.provider?.data_collection === 'deny')).toBe(true);
  });

  it('a receipt that adds up is taken at once', async () => {
    process.env.AI_API_KEY = 'k';
    fake([answer(JSON.stringify({ total: 3, lines: [{ name: 'Brot', qty: 1, price: 3 }] }))]);
    await vision.runVision('receipt', { images: ['data:image/jpeg;base64,AAAA'] });
    expect(calls).toHaveLength(1);
  });

  it('receipt text goes out without card and loyalty numbers', async () => {
    process.env.AI_API_KEY = 'k';
    fake([answer('{"lines":[]}')]);
    await vision.runVision('text-items', { text: 'LIDL\nMilch 1,09 A\nKartennr. ************1234\nPAYBACK Karte 3081 1234 5678 90\nSumme 1,09' });
    const sent = calls[0].body.messages[0].content[0].text as string;
    expect(sent).toContain('Milch');
    expect(sent).not.toContain('3081 1234 5678 90');
  });

  it('receiptLooksRight', () => {
    expect(vision.receiptLooksRight({ lines: [] })).toBe(false);
    expect(vision.receiptLooksRight({ lines: [{ name: 'a', price: 1 }] })).toBe(true);
    expect(vision.receiptLooksRight({ total: 10, lines: [{ name: 'a', price: 9.95 }] })).toBe(true);
    expect(vision.receiptLooksRight({ total: 10, lines: [{ name: 'a', price: 5 }] })).toBe(false);
  });
});
