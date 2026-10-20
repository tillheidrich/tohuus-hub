/**
 * "Wir können uns das gerade nicht leisten" (15 Oct 2026, docs/pricing.md › Härtefall): a short form on the website.
 * The request lands in the back office (/betrieb › Härtefälle) and as an e-mail to the operators (OPERATOR_EMAILS) –
 * the operators' address is never shown. With one click the operator gifts a plan code (gifts.ts), which goes to the
 * person by e-mail; they redeem it on the web (Einstellungen › Abo › Code einlösen). Subscriptions pay for it, and
 * the website says so.
 *
 * Privacy: only what the person types (e-mail, optional name, household, a few words), in accounts.db (encrypted),
 * deleted 180 days after it was answered. No household data, no tracking. Cloud only.
 */
import { config } from '../config.js';
import type { DB } from '../db.js';
import { accountsDb } from './accounts.js';
import { createPlanCode, type GiftPlan } from './gifts.js';
import { sendMail } from './mail.js';
import { operatorEmails } from './operator.js';

export class HardshipError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const prepared = new WeakSet<DB>();
function hdb(): DB {
  const d = accountsDb();
  if (!prepared.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS hardship_requests (
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT,
        people TEXT,
        message TEXT,
        lang TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','granted','declined')),
        code_id INTEGER,
        answered_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );`);
    // answered requests leave after half a year
    d.prepare(`DELETE FROM hardship_requests WHERE answered_at IS NOT NULL AND answered_at < datetime('now', '-180 days')`).run();
    prepared.add(d);
  }
  return d;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const de = (lang: string | null | undefined) => (lang ?? 'de') !== 'en';

/** The website form. `website` is a honeypot – people never fill it, bots do. */
export async function requestHardship(input: { email: string; name?: string | null; people?: string | null; message?: string | null; lang?: string | null; website?: string | null }) {
  if (!config.multiTenant) throw new HardshipError('only in ToHuus Cloud', 404);
  const lang = input.lang === 'en' ? 'en' : 'de';
  // bots get the same friendly answer and nothing is stored
  if (input.website?.trim()) return { ok: true };
  const email = String(input.email ?? '').trim().toLowerCase().slice(0, 254);
  if (!EMAIL.test(email)) throw new HardshipError(de(lang) ? 'Das sieht nicht nach einer E-Mail-Adresse aus.' : 'That doesn’t look like an e-mail address.');
  const d = hdb();
  // one open request per address is enough
  const open = d.prepare(`SELECT id FROM hardship_requests WHERE email = ? AND status = 'open'`).get(email);
  if (!open) {
    d.prepare('INSERT INTO hardship_requests (email, name, people, message, lang) VALUES (?, ?, ?, ?, ?)').run(
      email,
      input.name?.trim().slice(0, 80) || null,
      input.people?.trim().slice(0, 40) || null,
      input.message?.trim().slice(0, 1000) || null,
      lang,
    );
    const to = operatorEmails();
    for (const op of to)
      void sendMail(op, {
        subject: 'ToHuus: neue Anfrage „Wir können uns das nicht leisten“',
        title: 'Neue Härtefall-Anfrage',
        eyebrow: 'Back office',
        paragraphs: ['Jemand fragt nach einer Lizenz. Beantworten im Back office unter Härtefälle.', input.message?.trim().slice(0, 1000) || '(ohne Nachricht)'],
        rows: [
          { label: 'Name', value: input.name?.trim().slice(0, 80) || '–' },
          { label: 'Haushalt', value: input.people?.trim().slice(0, 40) || '–' },
        ],
        button: { label: 'Back office öffnen', url: `${config.baseUrl}/betrieb` },
      }).catch((e) => console.warn('[hardship mail]', (e as Error).message));
  }
  return { ok: true };
}

export function listHardship() {
  return hdb().prepare(`SELECT id, email, name, people, message, lang, status, code_id, answered_at, created_at FROM hardship_requests ORDER BY status = 'open' DESC, created_at DESC LIMIT 200`).all();
}

/** Gift a plan code and send it to the person (redeemed on the web). */
export async function grantHardship(id: number, plan: GiftPlan, days: number | null, by: string | null) {
  const d = hdb();
  const row = d.prepare('SELECT * FROM hardship_requests WHERE id = ?').get(id) as { id: number; email: string; name: string | null; lang: string | null; status: string } | undefined;
  if (!row) throw new HardshipError('not found', 404);
  if (row.status !== 'open') throw new HardshipError('already answered', 409);
  const code = createPlanCode({ plan, days, note: `Härtefall #${id}`, maxUses: 1 }, by);
  d.prepare(`UPDATE hardship_requests SET status = 'granted', code_id = ?, answered_at = datetime('now') WHERE id = ?`).run(code.id, id);
  const g = de(row.lang);
  // without mail (self-test, SMTP down) the code still exists – the back office shows it to pass on by hand
  let mailed = true;
  await sendMail(row.email, {
    subject: g ? 'Deine ToHuus-Lizenz' : 'Your ToHuus licence',
    title: g ? 'Für euch – von ToHuus' : 'For you – from ToHuus',
    eyebrow: 'ToHuus',
    paragraphs: g
      ? [
          `${row.name ? `Hallo ${row.name}, ` : ''}schön, dass ihr ToHuus nutzen wollt. Hier ist euer Code – bezahlt von Menschen mit einem Abo.`,
          `Einlösen: auf ${config.baseUrl.replace(/^https?:\/\//, '')} im Browser anmelden, dann Einstellungen › Daten, Abo & Konto › Abo & Speicher › „Code einlösen“.`,
        ]
      : [`${row.name ? `Hi ${row.name}, ` : ''}we’re glad you want to use ToHuus. Here is your code – paid for by people with a subscription.`, 'Redeem it on the web: sign in, then Settings › Data, plan & account › Plan & storage › “Redeem code”.'],
    rows: [
      { label: g ? 'Code' : 'Code', value: code.code },
      { label: g ? 'Plan' : 'Plan', value: plan === 'plus' ? 'Plus' : 'Haushalt' },
      { label: g ? 'Gültig' : 'Valid', value: days ? (g ? `${days} Tage` : `${days} days`) : g ? 'unbefristet' : 'for good' },
    ],
    button: { label: g ? 'ToHuus öffnen' : 'Open ToHuus', url: `${config.baseUrl}/einstellungen/daten/abo` },
  }).catch((e) => {
    mailed = false;
    console.warn('[hardship mail]', (e as Error).message);
  });
  return { ok: true, code: code.code, mailed };
}

export function declineHardship(id: number) {
  const r = hdb().prepare(`UPDATE hardship_requests SET status = 'declined', answered_at = datetime('now') WHERE id = ? AND status = 'open'`).run(id);
  if (!r.changes) throw new HardshipError('not found', 404);
  return { ok: true };
}
