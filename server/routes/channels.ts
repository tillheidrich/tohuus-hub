/** More notification channels: Telegram (two-way), Gotify, Matrix */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAdmin, requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';
import { channelsCfg, setChannelCfg } from '../lib/channels-config.js';
import { READY, resolveMatrixRoom, testChannel } from '../lib/channels.js';
import {
  acceptWebhook,
  connectBot,
  createPairing,
  getChat,
  handleUpdate,
  listChats,
  setChatNotify,
  startTelegram,
  stopTelegram,
  telegramStatus,
  unlinkChat,
  webhookAvailable,
} from '../lib/telegram.js';
import { t } from '../i18n.js';

export const r = Router();
r.use(requireAuth);

/** Public: Telegram webhook (only used in webhook mode; secret in path and header). */
export const pub = Router();
pub.post('/telegram/hook/:secret', (req, res) => {
  if (!acceptWebhook(String(req.params.secret), req.get('x-telegram-bot-api-secret-token'))) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({ ok: true });
  if (req.body && typeof req.body.update_id === 'number') void handleUpdate(req.body);
});

// polling starts with the server (no-op until a bot is set up)
setTimeout(() => startTelegram(), 2000).unref?.();

const MASK = '••••';
const mask = (s: string) => (s ? MASK : '');
const userId = (req: any): number | null => req.actor?.userId ?? null;
const isAdmin = (req: any) => req.actor?.role === 'admin';
const fail = (res: any, e: unknown) => res.status((e as any).status ?? 400).json({ error: (e as Error).message });

r.get('/channels', (req, res) => {
  const c = channelsCfg();
  res.json({
    telegram: {
      enabled: c.telegram.enabled,
      configured: Boolean(c.telegram.botToken),
      botToken: mask(c.telegram.botToken),
      botName: c.telegram.botName,
      mode: c.telegram.mode,
      webhookAvailable: webhookAvailable(),
      status: telegramStatus(),
      chats: listChats(isAdmin(req) ? undefined : (userId(req) ?? -1)),
    },
    gotify: { enabled: c.gotify.enabled, url: c.gotify.url, appToken: mask(c.gotify.appToken), priorities: c.gotify.priorities, ready: READY.gotify() },
    matrix: { enabled: c.matrix.enabled, homeserver: c.matrix.homeserver, accessToken: mask(c.matrix.accessToken), roomId: c.matrix.roomId, ready: READY.matrix() },
    ready: { telegram: READY.telegram(), gotify: READY.gotify(), matrix: READY.matrix() },
  });
});

const keep = (v: string | undefined) => (v === undefined || v === MASK ? undefined : v.trim());

r.put('/channels/telegram', requireAdmin, async (req, res) => {
  const b = z.object({ enabled: z.boolean().optional(), botToken: z.string().max(200).optional(), mode: z.enum(['polling', 'webhook']).optional() }).parse(req.body);
  const token = keep(b.botToken);
  try {
    if (token !== undefined) {
      if (token === '') {
        stopTelegram();
        setChannelCfg('telegram', { botToken: '', botName: '', botId: null, enabled: false });
      } else {
        if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw Object.assign(new Error(t('This doesn’t look like a bot token from @BotFather.')), { status: 400 });
        const me = await connectBot(token).catch((e) => {
          throw Object.assign(new Error(t('Telegram didn’t accept the token: {error}', { error: (e as Error).message })), { status: 400 });
        });
        setChannelCfg('telegram', { botToken: token, botName: me.username, botId: me.id, enabled: b.enabled ?? true });
      }
    }
    if (b.enabled !== undefined && token === undefined) setChannelCfg('telegram', { enabled: b.enabled });
    if (b.mode) setChannelCfg('telegram', { mode: b.mode });
    startTelegram();
    emit('settings');
    res.json({ ok: true, botName: channelsCfg().telegram.botName });
  } catch (e) {
    fail(res, e);
  }
});

/** One-time link. Members link themselves; admins can create links for anyone and for a group. */
r.post('/channels/telegram/pair', (req, res) => {
  const b = z.object({ user_id: z.number().int().optional(), group: z.boolean().optional() }).parse(req.body ?? {});
  const me = userId(req);
  if (!me) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if ((b.group || (b.user_id && b.user_id !== me)) && !isAdmin(req)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const target = b.group ? me : (b.user_id ?? me);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(target)) {
    res.status(404).json({ error: t('Member not found') });
    return;
  }
  try {
    res.json(createPairing({ userId: target, kind: b.group ? 'group' : 'private', createdBy: req.actor?.name }));
  } catch (e) {
    fail(res, e);
  }
});

r.get('/channels/telegram/chats', (req, res) => res.json(listChats(isAdmin(req) ? undefined : (userId(req) ?? -1))));

const mayTouch = (req: any, id: number) => {
  const c = getChat(id);
  return c && (isAdmin(req) || (c.user_id != null && c.user_id === userId(req))) ? c : null;
};

r.patch('/channels/telegram/chats/:id', (req, res) => {
  const b = z.object({ notify: z.boolean() }).parse(req.body);
  if (!mayTouch(req, Number(req.params.id))) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  setChatNotify(Number(req.params.id), b.notify);
  res.json({ ok: true });
});

r.delete('/channels/telegram/chats/:id', (req, res) => {
  if (!mayTouch(req, Number(req.params.id))) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  unlinkChat(Number(req.params.id));
  res.json({ ok: true });
});

const httpUrl = z.string().trim().max(500).refine((s) => s === '' || /^https?:\/\/[^\s]+$/i.test(s), { message: 'http(s) URL expected' });

r.put('/channels/gotify', requireAdmin, (req, res) => {
  const b = z
    .object({
      enabled: z.boolean().optional(),
      url: httpUrl.optional(),
      appToken: z.string().max(200).optional(),
      priorities: z.record(z.string().max(40), z.number().int().min(0).max(10)).optional(),
    })
    .parse(req.body);
  const token = keep(b.appToken);
  setChannelCfg('gotify', {
    ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
    ...(b.url !== undefined ? { url: b.url.replace(/\/+$/, '') } : {}),
    ...(token !== undefined ? { appToken: token } : {}),
    ...(b.priorities ? { priorities: { ...channelsCfg().gotify.priorities, ...b.priorities } } : {}),
  });
  emit('settings');
  res.json({ ok: true });
});

r.put('/channels/matrix', requireAdmin, async (req, res) => {
  const b = z
    .object({ enabled: z.boolean().optional(), homeserver: httpUrl.optional(), accessToken: z.string().max(500).optional(), roomId: z.string().trim().max(255).optional() })
    .parse(req.body);
  const token = keep(b.accessToken);
  const cur = channelsCfg().matrix;
  const hs = b.homeserver !== undefined ? b.homeserver.replace(/\/+$/, '') : cur.homeserver;
  try {
    let room = b.roomId;
    if (room !== undefined && room && !/^[!#][^:\s]+:[^\s]+$/.test(room)) throw Object.assign(new Error(t('Room id like !abc123:example.org or alias like #family:example.org')), { status: 400 });
    if (room?.startsWith('#') && hs) room = await resolveMatrixRoom(hs, token ?? cur.accessToken, room);
    setChannelCfg('matrix', {
      ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
      ...(b.homeserver !== undefined ? { homeserver: hs } : {}),
      ...(token !== undefined ? { accessToken: token } : {}),
      ...(room !== undefined ? { roomId: room } : {}),
    });
    emit('settings');
    res.json({ ok: true, roomId: channelsCfg().matrix.roomId });
  } catch (e) {
    fail(res, e);
  }
});

r.post('/channels/:name/test', requireAdmin, async (req, res) => {
  const name = z.enum(['telegram', 'gotify', 'matrix']).parse(req.params.name);
  if (!READY[name]()) {
    res.status(409).json({ error: t('Switch the channel on and fill in all fields first.') });
    return;
  }
  res.json({ ok: await testChannel(name) });
});
