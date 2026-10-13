// Runs before every test file (vitest.config.ts › setupFiles). ToHuus Cloud defaults to the beta gate
// (CLOUD_SIGNUP unset = 'invite', lib/beta.ts); tests sign up freely unless they set CLOUD_SIGNUP themselves.
process.env.CLOUD_SIGNUP ??= 'open';
