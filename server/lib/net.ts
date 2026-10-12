/**
 * Outbound fetch for URLs that come from users, web pages or assistants.
 * Blocks private/internal networks (checked at connect time → no DNS rebinding), limits redirects,
 * response size and time.
 */
import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as ufetch } from 'undici';
import { t } from '../i18n.js';

/** Errors with a user-facing reason (blocked address, too large …), passed through unchanged. */
class SafeFetchError extends Error {}

function v4ToInt(ip: string) {
  return ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
}
const V4_BLOCK: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
];

/**
 * IPv6 ranges that are local or can lead to an IPv4 address: unspecified/loopback/IPv4-compatible (::/96),
 * NAT64 (64:ff9b::/96, 64:ff9b:1::/48), 6to4 (2002::/16), unique local, link local, multicast.
 * IPv4-mapped addresses (::ffff:a.b.c.d – also in their hex form ::ffff:7f00:1, which is how `new URL()`
 * normalises them) are checked against the IPv4 list by net.BlockList itself.
 */
const V6_BLOCK: [string, number][] = [['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]];
const BLOCK = new net.BlockList();
for (const [base, bits] of V4_BLOCK) BLOCK.addSubnet(base, bits, 'ipv4');
for (const [base, bits] of V6_BLOCK) BLOCK.addSubnet(base, bits, 'ipv6');

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const n = v4ToInt(ip);
    return V4_BLOCK.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase().replace(/%.*$/, '');
    try {
      return BLOCK.check(l, 'ipv6');
    } catch {
      return true;
    }
  }
  return true;
}

/** Dispatcher that refuses private/internal addresses at connect time (ToHuus Cloud installs it globally). */
export const privateBlockingAgent = new Agent({
  connect: {
    lookup: (hostname: string, opts: any, cb: any) => {
      dns.lookup(hostname, { all: true }, (err, addrs) => {
        if (err) return cb(err);
        const list = addrs as dns.LookupAddress[];
        if (!list.length || list.some((a) => isPrivateIp(a.address))) return cb(new SafeFetchError(t('Address not allowed')));
        if (opts?.all) return cb(null, list);
        cb(null, list[0].address, list[0].family);
      });
    },
  },
});

export interface SafeResponse {
  status: number;
  ok: boolean;
  contentType: string;
  buf: Buffer;
  url: string;
}

export async function safeFetch(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number; headers?: Record<string, string>; maxRedirects?: number } = {},
): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  let current = url;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
      const u = new URL(current);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SafeFetchError(t('Only http(s) links'));
      if (u.port && !['80', '443'].includes(u.port)) throw new SafeFetchError(t('Port not allowed'));
      const host = u.hostname.replace(/^\[|\]$/g, '');
      if (net.isIP(host) && isPrivateIp(host)) throw new SafeFetchError(t('Address not allowed'));
      if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new SafeFetchError(t('Address not allowed'));
      const r = await ufetch(current, { dispatcher: privateBlockingAgent, redirect: 'manual', signal: ctrl.signal, headers: opts.headers });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        current = new URL(r.headers.get('location')!, current).toString();
        await r.body?.cancel();
        continue;
      }
      const len = Number(r.headers.get('content-length') ?? 0);
      if (len > maxBytes) {
        await r.body?.cancel();
        throw new SafeFetchError(t('File too large'));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      if (r.body) {
        for await (const chunk of r.body as any) {
          size += chunk.length;
          if (size > maxBytes) {
            ctrl.abort();
            throw new SafeFetchError(t('File too large'));
          }
          chunks.push(Buffer.from(chunk));
        }
      }
      return { status: r.status, ok: r.ok, contentType: r.headers.get('content-type') ?? '', buf: Buffer.concat(chunks), url: current };
    }
    throw new SafeFetchError(t('Too many redirects'));
  } catch (e) {
    if (e instanceof SafeFetchError || (e as { cause?: unknown })?.cause instanceof SafeFetchError) throw e instanceof SafeFetchError ? e : (e as { cause: SafeFetchError }).cause;
    // keep the low-level cause (DNS, refused, timeout …) for logs; the message stays user-facing
    throw new Error(t('Link not reachable'), { cause: e });
  } finally {
    clearTimeout(timer);
  }
}
