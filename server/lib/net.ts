/**
 * Outbound fetch for URLs that come from users, web pages or assistants.
 * Blocks private/internal networks (checked at connect time → no DNS rebinding), limits redirects,
 * response size and time.
 */
import dns from 'node:dns';
import net from 'node:net';
import { Agent, buildConnector, fetch as ufetch } from 'undici';
import { t, userError } from '../i18n.js';

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

/**
 * The server's own public addresses (env BLOCK_OWN_IPS, comma-separated IPs or CIDRs, e.g. "46.224.49.66,2a01:4f8::/64"):
 * reaching them from inside would hit other apps on the same host through their public names (review 18.10.2026 P2-7).
 */
const OWN = new net.BlockList();
export function setOwnIps(list: string | undefined) {
  const next = new net.BlockList();
  for (const raw of (list ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [addr, bits] = raw.split('/');
    const type = net.isIPv6(addr) ? 'ipv6' : net.isIPv4(addr) ? 'ipv4' : null;
    if (!type) {
      console.warn(`[net] BLOCK_OWN_IPS: "${raw}" is not an address – ignored`);
      continue;
    }
    if (bits) next.addSubnet(addr, Number(bits), type);
    else next.addAddress(addr, type);
  }
  ownList = next;
}
let ownList: net.BlockList = OWN;
setOwnIps(process.env.BLOCK_OWN_IPS);
const isOwnIp = (ip: string) => {
  try {
    return ownList.check(ip.toLowerCase().replace(/%.*$/, ''), net.isIPv6(ip) ? 'ipv6' : 'ipv4');
  } catch {
    return false;
  }
};

export function isPrivateIp(ip: string): boolean {
  if (isOwnIp(ip)) return true;
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

/**
 * Ports an outbound connection may use in ToHuus Cloud: 80 and 443, plus OUTBOUND_ALLOWED_PORTS (comma-separated)
 * for a deliberate exception. Webhooks, calendar feeds and chat servers on odd ports would otherwise reach services
 * that are only meant to be internal (review 18.10.2026 P2-7).
 */
export function portAllowed(port: string | number | undefined | null, extra = process.env.OUTBOUND_ALLOWED_PORTS): boolean {
  const p = String(port ?? '');
  if (p === '' || p === '80' || p === '443') return true;
  return (extra ?? '')
    .split(',')
    .map((s) => s.trim())
    .includes(p);
}

const lookupPublic = (hostname: string, opts: any, cb: any) => {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs as dns.LookupAddress[];
    if (!list.length || list.some((a) => isPrivateIp(a.address))) return cb(new SafeFetchError(t('Address not allowed')));
    if (opts?.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
};
const publicConnector = buildConnector({ lookup: lookupPublic } as any);

/**
 * Dispatcher that refuses private/internal addresses (and the server's own, BLOCK_OWN_IPS) at connect time and
 * ports other than 80/443 (ToHuus Cloud installs it globally).
 */
export const privateBlockingAgent = new Agent({
  connect: (opts: any, cb: any) => {
    const host = String(opts.hostname ?? '').replace(/^\[|\]$/g, '');
    if (!portAllowed(opts.port)) return cb(new SafeFetchError(t('Port not allowed')), null);
    if (net.isIP(host) && isPrivateIp(host)) return cb(new SafeFetchError(t('Address not allowed')), null);
    return publicConnector(opts, cb);
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
    throw Object.assign(new Error(t('Link not reachable'), { cause: e }), { expose: true });
  } finally {
    clearTimeout(timer);
  }
}
