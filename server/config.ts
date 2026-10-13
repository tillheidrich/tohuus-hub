import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8080),
  dataDir: path.resolve(env.DATA_DIR ?? './data'),
  baseUrl: (env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  /** the public website (help pages, legal texts, Ratgeber) – one place for the domain (docs/domain.md) */
  siteUrl: (env.SITE_URL ?? 'https://tohuus.heidrich-digital.de').replace(/\/$/, ''),
  /** Secret used to sign nothing critical — sessions are random tokens stored hashed. Kept for future use. */
  appSecret: env.APP_SECRET ?? '',
  /** First admin is created on boot when the users table is empty. */
  adminName: env.ADMIN_NAME ?? 'Admin',
  adminPassword: env.ADMIN_PASSWORD ?? '',
  /** Seed demo household (Fredirando drinks bar, pantry, recipes) on first boot. */
  seedDemo: (env.SEED_DEMO ?? 'false') === 'true',
  /** Optional secret path segment for the MCP endpoint: /mcp/<MCP_PATH_SECRET>. Bearer tokens always work too. */
  mcpPathSecret: env.MCP_PATH_SECRET ?? '',
  vision: {
    baseUrl: (env.VISION_BASE_URL ?? '').replace(/\/$/, ''),
    apiKey: env.VISION_API_KEY ?? '',
    model: env.VISION_MODEL ?? '',
  },
  smtp: {
    host: env.SMTP_HOST ?? '',
    port: Number(env.SMTP_PORT ?? 587),
    secure: (env.SMTP_SECURE ?? 'false') === 'true',
    user: env.SMTP_USER ?? '',
    password: env.SMTP_PASSWORD ?? '',
    from: env.SMTP_FROM ?? '',
  },
  off: {
    userAgent: env.OFF_USER_AGENT ?? 'ToHuusHub/0.1 (https://github.com/tillheidrich/tohuus-hub)',
    enabled: (env.OFF_ENABLED ?? 'true') === 'true',
  },
  timezone: env.TZ ?? 'Europe/Berlin',
  /** default look on first start: tohuus | fredirando */
  brand: env.BRAND ?? 'tohuus',
  /** UI and notification language on first start: en | de (changeable in settings) */
  language: env.LANGUAGE ?? 'en',
  /** ToHuus Cloud: many households, one encrypted database each (docs/cloud.md). Off = self-hosted, one household. */
  multiTenant: (env.MULTI_TENANT ?? 'false') === 'true',
  /** cloud: open household databases kept in memory (LRU); idle ones close after `poolIdleMin` minutes */
  poolMax: Math.max(2, Number(env.HOUSEHOLD_POOL_MAX ?? 64)),
  poolIdleMin: Math.max(1, Number(env.HOUSEHOLD_POOL_IDLE_MIN ?? 10)),
  /** self-host storage quota in MB (0 = unlimited); cloud quotas follow the plan */
  storageQuotaMb: Number(env.STORAGE_QUOTA_MB ?? 0),
  /** deprecated – the beta gate (lib/beta.ts: signupMode()) decides; kept for older imports */
  signupOpen: (env.CLOUD_SIGNUP ?? 'true') !== 'false',
};

export const visionEnabled = () => Boolean(config.vision.baseUrl && config.vision.model);
export const smtpEnabled = () => Boolean(config.smtp.host && config.smtp.from);
