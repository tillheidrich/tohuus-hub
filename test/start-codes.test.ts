/**
 * Start pages (18 Oct 2026, tester feedback): every code or link field recognises what was pasted
 * (web/src/startCodes.ts – the iPhone app has the same rules in JoinInviteView.swift), and the web app's
 * link preview says "ToHuus" with the current claim (server/lib/page-meta.ts).
 */
import { describe, expect, it } from 'vitest';
import { claim, withPageMeta } from '../server/lib/page-meta';
import { classifyStartCode, normStartCode } from '../web/src/startCodes';

describe('classifyStartCode', () => {
  it('access codes in every spelling, also inside a message', () => {
    expect(classifyStartCode('TOHU-82BM-3EYT')).toEqual({ kind: 'access', code: 'TOHU-82BM-3EYT' });
    expect(classifyStartCode(' tohu 82bm 3eyt ')).toEqual({ kind: 'access', code: 'TOHU-82BM-3EYT' });
    expect(classifyStartCode('TOHU82BM3EYT')).toEqual({ kind: 'access', code: 'TOHU-82BM-3EYT' });
    expect(classifyStartCode('Dein Zugangscode: „TOHU-82BM-3EYT“. Viel Spaß!')).toEqual({ kind: 'access', code: 'TOHU-82BM-3EYT' });
    expect(classifyStartCode('https://cloud.tohuus.heidrich-digital.de/signup?code=TOHU-82BM-3EYT')).toEqual({ kind: 'access', code: 'TOHU-82BM-3EYT' });
    // a code the operator typed himself (lib/beta.ts createBetaCode accepts any)
    expect(classifyStartCode('familie2026')).toEqual({ kind: 'access', code: 'FAMILIE2026' });
  });

  it('gift codes are not access codes', () => {
    expect(classifyStartCode('GIFT-AB2C-D3EF')).toEqual({ kind: 'gift', code: 'GIFT-AB2C-D3EF' });
    expect(classifyStartCode('gift ab2c d3ef')).toEqual({ kind: 'gift', code: 'GIFT-AB2C-D3EF' });
  });

  it('invitation links (with prefix and inside text) and bare tokens', () => {
    const tok = 'h3k_Qw8xZ1aB2cD3eF4gH5iJ6kL7mN8oP9qR';
    expect(classifyStartCode(`https://cloud.tohuus.heidrich-digital.de/einladung/${tok}`)).toEqual({ kind: 'invite', token: tok, base: 'https://cloud.tohuus.heidrich-digital.de' });
    expect(classifyStartCode(`Komm dazu: https://haus.example.org/tohuus/einladung/${tok} – bis bald`)).toEqual({ kind: 'invite', token: tok, base: 'https://haus.example.org/tohuus' });
    expect(classifyStartCode(tok)).toEqual({ kind: 'invite', token: tok });
    // a token that happens to contain "TOHU" stays an invitation
    expect(classifyStartCode(`https://x.example.org/einladung/TOHU-ABCD-EFGH-${tok}`).kind).toBe('invite');
  });

  it('app connect links, bare addresses and nonsense', () => {
    expect(classifyStartCode('tohuus://connect?server=https%3A%2F%2Fx.example.org&code=ABCD1234')).toEqual({ kind: 'connect', url: 'tohuus://connect?server=https%3A%2F%2Fx.example.org&code=ABCD1234' });
    expect(classifyStartCode('https://cloud.tohuus.heidrich-digital.de')).toEqual({ kind: 'address', url: 'https://cloud.tohuus.heidrich-digital.de' });
    expect(classifyStartCode('hallo')).toEqual({ kind: 'unknown' });
    expect(classifyStartCode('   ')).toEqual({ kind: 'empty' });
  });

  it('normalises like the server (lib/beta.ts normCode)', () => {
    expect(normStartCode(' tohu_82bm 3eyt ')).toBe('TOHU-82BM-3EYT');
  });
});

describe('page meta (link preview)', () => {
  const html = `<html lang="de"><head>
    <meta name="apple-mobile-web-app-title" content="ToHuus Hub" />
    <meta name="description" content="Weniger im Kopf. Mehr Zuhause." />
    <title>ToHuus Hub</title>
  </head><body></body></html>`;

  it('German: ToHuus with the current claim, image and url', () => {
    const out = withPageMeta(html, { lang: 'de', path: '/', baseUrl: 'https://cloud.tohuus.heidrich-digital.de/' });
    expect(out).toContain('<title>ToHuus</title>');
    expect(out).toContain('<meta property="og:title" content="ToHuus · Merkt sich, was zu Hause fehlt" />');
    expect(out).toContain('<meta property="og:url" content="https://cloud.tohuus.heidrich-digital.de/" />');
    expect(out).toContain('og-de.png');
    expect(out).toContain('<meta name="apple-mobile-web-app-title" content="ToHuus" />');
    expect(out).not.toMatch(/Weniger im Kopf|ToHuus Hub/);
  });

  it('English and invitations (no token in the preview)', () => {
    expect(withPageMeta(html, { lang: 'en', path: '/' })).toContain('content="ToHuus · Remembers what your home is missing"');
    const inv = withPageMeta(html, { lang: 'de', path: '/einladung/h3k_secret', baseUrl: 'https://c.example.org' });
    expect(inv).toContain('<meta property="og:title" content="Einladung zu ToHuus" />');
    expect(inv).not.toContain('h3k_secret');
    expect(claim('de')).toBe('ToHuus merkt sich, was zu Hause fehlt.');
  });
});
