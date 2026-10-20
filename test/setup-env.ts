// Runs before every test file (vitest.config.ts › setupFiles). ToHuus Cloud defaults to the beta gate
// (CLOUD_SIGNUP unset = 'invite', lib/beta.ts); tests sign up freely unless they set CLOUD_SIGNUP themselves.
process.env.CLOUD_SIGNUP ??= 'open';
// Tests compute expected days with UTC dates (toISOString). The server's day follows TZ (config.timezone, default
// Europe/Berlin), so between 22:00 and 24:00 UTC the two disagreed and date tests failed. Tests run on UTC (TEST_TZ overrides);
// a file may still set TZ itself after this.
process.env.TZ = process.env.TEST_TZ ?? 'UTC';
// sharp/libvips starts one thread per core in every worker; with several workers that oversubscribes the CPU
// (vitest.config.ts). One thread per worker is plenty for the small test images.
process.env.VIPS_CONCURRENCY ??= '1';

// No internet in tests (20 Oct 2026, test stability): under load the full suite lost 4–14 tests to timeouts in
// assistant-new, cloud-ops, data-wipe-cloud, import-origin, mail-inbound, recipe-ai-import and recipes2. They
// were not slow themselves – the server code under test reached out to the internet (Open Food Facts search,
// TheMealDB, TikTok/Pinterest/YouTube pictures, product images) and waited 1.5–2.5 s per call, much longer on a
// busy machine or a slow network. Every host that is not this machine now fails at once (ENOTFOUND), exactly like
// an offline server, so the code takes its offline path and the tests no longer depend on the network. A test that
// needs the real network sets TEST_NETWORK=1.
import dns from 'node:dns';

const LOCAL = /^(localhost|.*\.localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/i;
if (process.env.TEST_NETWORK !== '1') {
  const offline = (host: string) => Object.assign(new Error(`getaddrinfo ENOTFOUND ${host} (tests run offline, test/setup-env.ts)`), { code: 'ENOTFOUND', errno: -3008, syscall: 'getaddrinfo', hostname: host });
  const lookup = dns.lookup;
  dns.lookup = function (host: string, options: unknown, callback?: unknown) {
    const cb = (typeof options === 'function' ? options : callback) as (err: Error | null, ...rest: unknown[]) => void;
    if (host && !LOCAL.test(host)) {
      process.nextTick(() => cb(offline(host)));
      return;
    }
    (lookup as (...a: unknown[]) => unknown).call(dns, host, options, callback);
  } as typeof dns.lookup;
  const plookup = dns.promises.lookup;
  dns.promises.lookup = (async (host: string, options?: unknown) => {
    if (host && !LOCAL.test(host)) throw offline(host);
    return (plookup as (...a: unknown[]) => Promise<unknown>).call(dns.promises, host, options);
  }) as typeof dns.promises.lookup;
}
