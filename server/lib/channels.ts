/**
 * Extra notification channels: Telegram (two-way, see lib/telegram.ts), Gotify and Matrix (outgoing).
 * Importing this module registers the three channels with lib/notify.ts; the routing matrix decides per event.
 */
import { config } from '../config.js';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { emit } from './bus.js';
import { channelsCfg, gotifyReady, matrixReady, telegramReady } from './channels-config.js';
import { type ChannelMessage, type ExtraChannelName, registerNotifyChannel } from './notify.js';
import { esc, sendTelegramNotification, sendTelegramText } from './telegram.js';

async function request(url: string, init: RequestInit & { timeoutMs?: number }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 8000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ Gotify

export async function sendGotify(msg: { title: string; message: string; url?: string; event: string; priority?: number }): Promise<boolean> {
  const c = channelsCfg().gotify;
  if (!c.url || !c.appToken) return false;
  const priority = Math.max(0, Math.min(10, Math.round(msg.priority ?? c.priorities[msg.event] ?? 5)));
  try {
    const r = await request(`${c.url.replace(/\/+$/, '')}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gotify-Key': c.appToken },
      body: JSON.stringify({
        title: msg.title,
        message: msg.message || msg.title,
        priority,
        extras: { 'client::display': { contentType: 'text/plain' }, ...(msg.url ? { 'client::notification': { click: { url: msg.url } } } : {}) },
      }),
    });
    return r.ok;
  } catch (e) {
    console.warn('[gotify]', (e as Error).message);
    return false;
  }
}

// ------------------------------------------------------------------ Matrix

let txn = 0;
export async function sendMatrix(msg: { title: string; message: string; url?: string }): Promise<boolean> {
  const c = channelsCfg().matrix;
  if (!c.homeserver || !c.accessToken || !c.roomId) return false;
  const plain = [msg.title, msg.message, msg.url].filter(Boolean).join('\n');
  const html = [`<b>${esc(msg.title)}</b>`, msg.message ? esc(msg.message).replace(/\n/g, '<br>') : '', msg.url ? `<a href="${esc(msg.url)}">${esc(t('Open in ToHuus Hub'))}</a>` : '']
    .filter(Boolean)
    .join('<br>');
  const id = `tohuus.${Date.now()}.${++txn}`;
  try {
    const r = await request(`${c.homeserver.replace(/\/+$/, '')}/_matrix/client/v3/rooms/${encodeURIComponent(c.roomId)}/send/m.room.message/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.accessToken}` },
      body: JSON.stringify({ msgtype: 'm.text', body: plain, format: 'org.matrix.custom.html', formatted_body: html }),
    });
    return r.ok;
  } catch (e) {
    console.warn('[matrix]', (e as Error).message);
    return false;
  }
}

/** "#family:example.org" → "!abc:example.org"; room ids pass through. */
export async function resolveMatrixRoom(homeserver: string, accessToken: string, room: string): Promise<string> {
  if (!room.startsWith('#')) return room;
  const r = await request(`${homeserver.replace(/\/+$/, '')}/_matrix/client/v3/directory/room/${encodeURIComponent(room)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = (await r.json().catch(() => ({}))) as { room_id?: string; error?: string };
  if (!r.ok || !j.room_id) throw Object.assign(new Error(j.error ?? t('Room not found')), { status: 400 });
  return j.room_id;
}

// ------------------------------------------------------------------ registration

registerNotifyChannel({ name: 'telegram', ready: telegramReady, send: sendTelegramNotification });
registerNotifyChannel({ name: 'gotify', ready: gotifyReady, send: (m: ChannelMessage) => sendGotify(m) });
registerNotifyChannel({ name: 'matrix', ready: matrixReady, send: (m: ChannelMessage) => sendMatrix(m) });

export const READY: Record<ExtraChannelName, () => boolean> = { telegram: telegramReady, gotify: gotifyReady, matrix: matrixReady };

/** Test message on exactly one channel. */
export async function testChannel(name: ExtraChannelName): Promise<boolean> {
  const msg: ChannelMessage = {
    event: 'test',
    title: t('Test from ToHuus Hub'),
    message: t('If you can read this, notifications are working.'),
    url: config.baseUrl,
  };
  if (name === 'telegram') return sendTelegramNotification(msg);
  if (name === 'gotify') return sendGotify(msg);
  return sendMatrix(msg);
}

// ------------------------------------------------------------------ household message (MCP)

export function configuredChannels(): ExtraChannelName[] {
  return (Object.keys(READY) as ExtraChannelName[]).filter((c) => READY[c]());
}

/**
 * A short text to the household's own configured channels (never to arbitrary recipients).
 * `member` limits Telegram to that member's linked private chat(s).
 */
export async function sendHouseholdMessage(input: { text: string; from: string; channels?: ExtraChannelName[]; memberId?: number }) {
  const ready = configuredChannels().filter((c) => !input.channels?.length || input.channels.includes(c));
  if (!ready.length) throw Object.assign(new Error(t('No household channel (Telegram, Gotify, Matrix) is set up.')), { status: 409 });
  const title = t('Message from {name}', { name: input.from });
  const text = input.text.trim().slice(0, 2000);
  const results = await Promise.all(
    ready.map(async (c): Promise<[ExtraChannelName, boolean]> => {
      if (c === 'telegram') return [c, await sendTelegramText(`<b>${esc(title)}</b>\n${esc(text)}`, { userId: input.memberId })];
      if (input.memberId) return [c, false]; // Gotify / Matrix go to everyone – skip when a single member was asked for
      if (c === 'gotify') return [c, await sendGotify({ title, message: text, event: 'message', priority: 5 })];
      return [c, await sendMatrix({ title, message: text })];
    }),
  );
  const relevant = input.memberId ? results.filter(([c]) => c === 'telegram') : results;
  db.prepare('INSERT INTO notifications (event, title, body, payload, channels) VALUES (?, ?, ?, ?, ?)').run(
    'household.message',
    title,
    text,
    JSON.stringify({ source: 'tohuus', event: 'household.message', title, message: text, at: new Date().toISOString() }),
    JSON.stringify(relevant.map(([channel, ok]) => ({ channel, ok }))),
  );
  emit('notifications');
  return { sent: relevant.filter(([, ok]) => ok).map(([c]) => c), failed: relevant.filter(([, ok]) => !ok).map(([c]) => c) };
}
