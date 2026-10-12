import { config } from '../config.js';
import { db, getSetting, setSetting } from '../db.js';
import { fmtQty, listProducts } from './catalog.js';
import { enqueueMissingImages } from './enrich.js';
import { notify, notifySettings } from './notify.js';
import { suggest } from './recipes.js';
import { haSettings, syncCookidoo } from './plan.js';
import { fmtDay, t } from '../i18n.js';
import { checkCareDue } from './care.js';
import { checkBudgets } from './spend2.js';
import { startPartyScheduler } from './party.js';
import { startPeopleScheduler } from './people.js';
import { startInboxPoller } from './retail-inbox.js';
import { notPrivate } from './share-core.js';
import { rotationTick } from './plan2.js';
import { forEachHousehold } from './cloud-jobs.js';
import { featureOff } from './tenancy.js';

function localHour() {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: config.timezone }).format(new Date()));
}
function localDate() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date());
}

async function checkExpiry() {
  const products = listProducts().filter((p) => p.status === 'expiring' || p.status === 'expired');
  for (const p of products) {
    await notify({
      event: 'stock.expiring',
      title:
        p.status === 'expired'
          ? p.dateKind === 'use_by'
            ? t('{name}: use-by date passed – please don’t eat it anymore', { name: p.name })
            : t('{name}: past best-before – look, smell, taste; often still fine', { name: p.name })
          : t('Use up {name} soon', { name: p.name }),
      message: t(p.dateKind === 'use_by' ? '{product} – use by {date} ({qty} left).' : '{product} – best before {date} ({qty} left).', {
        product: [p.brand, p.name].filter(Boolean).join(' '),
        date: fmtDay(p.nextExpiry!),
        qty: fmtQty(p, p.total),
      }),
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
  const shopping = db.prepare(`SELECT text FROM shopping_items WHERE checked_at IS NULL AND ${notPrivate()}`).all() as { text: string }[];
  const idea = suggest({ limit: 1 })[0];
  if (!force && low.length === 0 && exp.length === 0 && shopping.length === 0) return;
  const parts: string[] = [];
  if (exp.length) parts.push(t('Use soon: {list}', { list: exp.map((p) => p.name).join(', ') }));
  if (low.length) parts.push(t('Running low or out: {list}', { list: low.map((p) => p.name).join(', ') }));
  if (shopping.length) parts.push(t('Shopping list ({count}): {list}', { count: shopping.length, list: shopping.slice(0, 12).map((x) => x.text).join(', ') }));
  if (idea) parts.push(t('Cooking idea: {title} – {reasons}', { title: idea.recipe.title, reasons: idea.reasons.join(', ') }));
  // e-mail: the same content as short checklists in the shared mail layout
  const sections = [
    { title: t('Use soon'), items: exp.map((p) => t('{name} (best before {date})', { name: p.name, date: fmtDay(p.nextExpiry!) })) },
    { title: t('Running low or out'), items: low.map((p) => `${p.name} – ${fmtQty(p, p.total)}`) },
    { title: t('Shopping list'), items: shopping.map((x) => x.text) },
    ...(idea ? [{ title: t('Cooking idea for today'), items: [`${idea.recipe.title} – ${idea.reasons.join(', ')}`] }] : []),
  ];
  await notify({
    event: 'digest.daily',
    title: t('Daily overview'),
    message: parts.join('\n'),
    path: '/',
    data: { low: low.length, expiring: exp.length, shopping: shopping.length, idea: idea?.recipe.title ?? null },
    mail: { paragraphs: [t('The most important things at home at a glance.')], sections },
  });
}

/** Extra jobs per household round, registered by area modules (list2: personal digests, rhythm due, week plan). */
export const householdJobs: { name: string; run: () => Promise<unknown> | unknown }[] = [];

/** One scheduler round for the current household (expiry, care, budgets, rotation, daily digest). */
export async function householdTick() {
  for (const j of householdJobs) {
    try {
      await j.run();
    } catch (e) {
      console.warn(`[${j.name}]`, (e as Error).message);
    }
  }
  try {
    await checkExpiry();
    await checkCareDue().catch((e) => console.warn('[care]', (e as Error).message));
    await checkBudgets().catch((e) => console.warn('[budgets]', (e as Error).message));
    await rotationTick().catch((e) => console.warn('[rotation]', (e as Error).message));
    await sendDigest();
  } catch (e) {
    console.warn('[scheduler]', (e as Error).message);
  }
}

/**
 * Self-host: the one household. Cloud: every household used in the last 14 days, one after the other with jitter,
 * each inside its own context (lib/cloud-jobs.ts).
 */
export function startScheduler() {
  startPeopleScheduler();
  startPartyScheduler();
  startInboxPoller();
  let busy = false;
  const tick = async () => {
    if (busy) return; // a cloud round over many households may take longer than the interval
    busy = true;
    try {
      await forEachHousehold(householdTick, { scope: 'active', label: 'scheduler' });
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 15 * 60_000);
  const images = () => void forEachHousehold(() => enqueueMissingImages(), { scope: 'active', days: 3, label: 'images' });
  setTimeout(images, 10_000);
  // Cookidoo goes through the household's Home Assistant – self-host only
  if (!featureOff('cookidoo')) {
    const cookidoo = () => {
      const h = haSettings();
      if (h.url && h.token) syncCookidoo().then((r) => r.added && console.log('[cookidoo]', r)).catch((e) => console.warn('[cookidoo]', e.message));
    };
    setTimeout(cookidoo, 60_000);
    setInterval(cookidoo, 3 * 3600_000);
  }
  setInterval(images, 6 * 3600_000);
}
