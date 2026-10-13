/**
 * Inbound-only SMTP listener for the receipt addresses (docs/mail-inbox.md). Runs inside the cloud app when
 * MAIL_SMTP_PORT and MAIL_INBOUND_DOMAIN are set; Coolify maps port 25 to it.
 *
 * No AUTH, no relay: RCPT TO is accepted only for an existing household address (everything else is refused in the
 * dialogue, so no bounces and nothing stored), 15 MB per mail, at most 5 recipients, a small rate limit per sending
 * IP. STARTTLS with MAIL_TLS_CERT_FILE / MAIL_TLS_KEY_FILE when given.
 */
import fs from 'node:fs';
import { SMTPServer } from 'smtp-server';
import { config } from '../config.js';
import { handleInbound, householdForAddress, MAX_MAIL_BYTES, mailInboundDomain, mailInboundOn } from './mail-inbound.js';

const PER_IP_PER_10_MIN = 60;
const seen = new Map<string, { n: number; at: number }>();
function ipLimited(ip: string) {
  const now = Date.now();
  const e = seen.get(ip);
  if (!e || now - e.at > 10 * 60_000) {
    seen.set(ip, { n: 1, at: now });
    return false;
  }
  e.n++;
  return e.n > PER_IP_PER_10_MIN;
}

export function startSmtpInbound(opts: { port?: number; host?: string } = {}): SMTPServer | null {
  const port = opts.port ?? Number(process.env.MAIL_SMTP_PORT ?? 0);
  if (!config.multiTenant || !mailInboundOn() || !port) return null;
  const cert = process.env.MAIL_TLS_CERT_FILE;
  const key = process.env.MAIL_TLS_KEY_FILE;
  const tls = cert && key && fs.existsSync(cert) && fs.existsSync(key) ? { cert: fs.readFileSync(cert), key: fs.readFileSync(key) } : null;
  const server = new SMTPServer({
    name: `mail.${mailInboundDomain().replace(/^bons\./, '')}`,
    banner: 'ToHuus receipts',
    authOptional: true,
    disabledCommands: tls ? ['AUTH'] : ['AUTH', 'STARTTLS'],
    ...(tls ? { key: tls.key, cert: tls.cert } : {}),
    size: MAX_MAIL_BYTES,
    maxClients: 50,
    logger: false,
    onConnect(session, cb) {
      if (ipLimited(session.remoteAddress)) return cb(Object.assign(new Error('Too many mails, try later'), { responseCode: 421 }));
      cb();
    },
    onRcptTo(address, session, cb) {
      if (session.envelope.rcptTo.length >= 5) return cb(Object.assign(new Error('Too many recipients'), { responseCode: 452 }));
      if (!householdForAddress(address.address)) return cb(Object.assign(new Error('No such address'), { responseCode: 550 }));
      cb();
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (c: Buffer) => {
        size += c.length;
        if (size <= MAX_MAIL_BYTES) chunks.push(c);
      });
      stream.on('end', () => {
        if ((stream as { sizeExceeded?: boolean }).sizeExceeded) return cb(Object.assign(new Error('Message too big'), { responseCode: 552 }));
        const raw = Buffer.concat(chunks);
        // the envelope is reset once the mail is accepted – take the recipients first
        const rcpts = session.envelope.rcptTo.map((r) => r.address);
        // accept right away; recognition runs afterwards (a slow PDF must not hold the sender's connection)
        cb();
        for (const a of rcpts) void handleInbound(raw, a).catch((e) => console.warn('[mail] inbound failed:', (e as Error).message));
      });
    },
  });
  server.on('error', (e) => console.warn('[mail] smtp:', e.message));
  server.listen(port, opts.host ?? '0.0.0.0', () => console.log(`[mail] receipt addresses @${mailInboundDomain()} on port ${port}${tls ? ' (STARTTLS)' : ''}`));
  return server;
}
