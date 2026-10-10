import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db.js';
import { fmtQty, listProducts } from './catalog.js';
import { enqueueMissingImages } from './enrich.js';
import { emailHtml, notify, notifySettings } from './notify.js';
import { suggest } from './recipes.js';
import { haSettings, syncCookidoo } from './plan.js';

function localHour() {
  return Number(new Intl.DateTimeFormat('de-DE', { hour: 'numeric', hour12: false, timeZone: config.timezone }).format(new Date()));
}
function localDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date());
}

async function checkExpiry() {
  const products = listProducts().filter((p) => p.status === 'expiring' || p.status === 'expired');
  for (const p of products) {
    await notify({
      event: 'stock.expiring',
      title: p.status === 'expired' ? `${p.name}: MHD überschritten` : `${p.name} bald verbrauchen`,
      message: `${[p.brand, p.name].filter(Boolean).join(' ')} – MHD ${new Date(p.nextExpiry!).toLocaleDateString('de-DE')} (${fmtQty(p, p.total)} da).`,
      path: `/bestand/${p.id}`,
      data: { product_id: p.id, name: p.name, best_before: p.nextExpiry, status: p.status },
      dedupeKey: `exp:${p.id}:${p.nextExpiry}`,
      dedupeHours: 30,
    });
  }
}

export async function sendDigest(force = false) {
  const s = notifySettings();
  const today = localDate();
  if (!force && (s.digestHour < 0 || localHour() !== s.digestHour || getSetting('digest.last', '') === today)) return;
  setSetting('digest.last', today);
  const products = listProducts();
  const low = products.filter((p) => (p.min_qty > 0 || p.track_mode === 'level') && ['low', 'empty'].includes(p.status));
  const exp = products.filter((p) => ['expiring', 'expired'].includes(p.status));
  const shopping = db.prepare('SELECT text FROM shopping_items WHERE checked_at IS NULL').all() as { text: string }[];
  const idea = suggest({ limit: 1 })[0];
  if (!force && low.length === 0 && exp.length === 0 && shopping.length === 0) return;
  const parts: string[] = [];
  if (exp.length) parts.push(`Bald verbrauchen: ${exp.map((p) => p.name).join(', ')}`);
  if (low.length) parts.push(`Knapp oder alle: ${low.map((p) => p.name).join(', ')}`);
  if (shopping.length) parts.push(`Einkaufsliste (${shopping.length}): ${shopping.slice(0, 12).map((x) => x.text).join(', ')}`);
  if (idea) parts.push(`Kochidee: ${idea.recipe.title} – ${idea.reasons.join(', ')}`);
  const list = (title: string, items: string[]) =>
    items.length ? `<h3 style="font-size:14px;margin:16px 0 6px">${title}</h3><ul style="margin:0;padding-left:18px;line-height:1.6">${items.map((i) => `<li>${i.replace(/[<>&]/g, '')}</li>`).join('')}</ul>` : '';
  const extra =
    list('Bald verbrauchen', exp.map((p) => `${p.name} (MHD ${new Date(p.nextExpiry!).toLocaleDateString('de-DE')})`)) +
    list('Knapp oder alle', low.map((p) => `${p.name} – ${fmtQty(p, p.total)}`)) +
    list('Einkaufsliste', shopping.map((x) => x.text)) +
    (idea ? list('Kochidee für heute', [`${idea.recipe.title} – ${idea.reasons.join(', ')}`]) : '');
  await notify({
    event: 'digest.daily',
    title: 'Tagesblick',
    message: parts.join('\n'),
    path: '/',
    data: { low: low.length, expiring: exp.length, shopping: shopping.length, idea: idea?.recipe.title ?? null },
    html: emailHtml('Tagesblick', 'Das Wichtigste aus dem Haus auf einen Blick.', config.baseUrl, extra),
  });
}

export function startScheduler() {
  const tick = async () => {
    try {
      await checkExpiry();
      await sendDigest();
    } catch (e) {
      console.warn('[scheduler]', (e as Error).message);
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 15 * 60_000);
  setTimeout(() => enqueueMissingImages(), 10_000);
  const cookidoo = () => {
    const h = haSettings();
    if (h.url && h.token) syncCookidoo().then((r) => r.added && console.log('[cookidoo]', r)).catch((e) => console.warn('[cookidoo]', e.message));
  };
  setTimeout(cookidoo, 60_000);
  setInterval(cookidoo, 3 * 3600_000);
  setInterval(() => enqueueMissingImages(), 6 * 3600_000);
}
