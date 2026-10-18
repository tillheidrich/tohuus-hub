/**
 * Settings for the extra notification channels (Telegram, Gotify, Matrix), stored under the settings key
 * `channels`. Every credential sits in a field whose name matches /token|passw|secret/, so the JSON export
 * (lib/data.ts redactSecrets) drops it.
 */
import { getSetting, setSetting } from '../db.js';

export interface TelegramCfg {
  enabled: boolean;
  botToken: string;
  /** @username of the bot, from getMe */
  botName: string;
  botId: number | null;
  /** polling works behind NAT; webhook needs BASE_URL on https */
  mode: 'polling' | 'webhook';
  /** path segment + X-Telegram-Bot-Api-Secret-Token for webhook mode */
  webhookSecret: string;
}

export interface GotifyCfg {
  enabled: boolean;
  url: string;
  appToken: string;
  /** event → priority 0–10 (Gotify: ≥ 8 is shown as urgent on Android) */
  priorities: Record<string, number>;
}

export interface MatrixCfg {
  enabled: boolean;
  homeserver: string;
  accessToken: string;
  roomId: string;
}

export interface ChannelsCfg {
  telegram: TelegramCfg;
  gotify: GotifyCfg;
  matrix: MatrixCfg;
}

export const DEFAULT_PRIORITIES: Record<string, number> = {
  'stock.low': 4,
  'stock.empty': 5,
  'stock.expiring': 4,
  'import.review': 4,
  'order.new': 8,
  'order.status': 3,
  'shopping.added': 2,
  'digest.daily': 2,
  'care.due': 5,
  'kids.wish': 8,
  'budget.warning': 4,
  'plan.vote': 5,
  'plan.rotation': 2,
  test: 5,
};

export const DEFAULT_CHANNELS: ChannelsCfg = {
  telegram: { enabled: false, botToken: '', botName: '', botId: null, mode: 'polling', webhookSecret: '' },
  gotify: { enabled: false, url: '', appToken: '', priorities: {} },
  matrix: { enabled: false, homeserver: '', accessToken: '', roomId: '' },
};

export function channelsCfg(): ChannelsCfg {
  const s = getSetting<Partial<ChannelsCfg>>('channels', {});
  return {
    telegram: { ...DEFAULT_CHANNELS.telegram, ...(s.telegram ?? {}) },
    gotify: { ...DEFAULT_CHANNELS.gotify, ...(s.gotify ?? {}), priorities: { ...DEFAULT_PRIORITIES, ...(s.gotify?.priorities ?? {}) } },
    matrix: { ...DEFAULT_CHANNELS.matrix, ...(s.matrix ?? {}) },
  };
}

export function setChannelCfg<K extends keyof ChannelsCfg>(name: K, patch: Partial<ChannelsCfg[K]>) {
  const cur = getSetting<Partial<ChannelsCfg>>('channels', {});
  setSetting('channels', { ...cur, [name]: { ...channelsCfg()[name], ...patch } });
}

export const telegramReady = () => {
  const c = channelsCfg().telegram;
  return c.enabled && Boolean(c.botToken);
};
export const gotifyReady = () => {
  const c = channelsCfg().gotify;
  return c.enabled && Boolean(c.url && c.appToken);
};
export const matrixReady = () => {
  const c = channelsCfg().matrix;
  return c.enabled && Boolean(c.homeserver && c.accessToken && c.roomId);
};
