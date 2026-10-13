// Runs before every test file (vitest.config.ts › setupFiles). ToHuus Cloud defaults to the beta gate
// (CLOUD_SIGNUP unset = 'invite', lib/beta.ts); tests sign up freely unless they set CLOUD_SIGNUP themselves.
process.env.CLOUD_SIGNUP ??= 'open';
// Tests compute expected days with UTC dates (toISOString). The server's day follows TZ (config.timezone, default
// Europe/Berlin), so between 22:00 and 24:00 UTC the two disagreed and date tests failed. Tests run on UTC (TEST_TZ overrides);
// a file may still set TZ itself after this.
process.env.TZ = process.env.TEST_TZ ?? 'UTC';
