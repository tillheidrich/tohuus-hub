#!/usr/bin/env node
/**
 * Screenshot / App Review test data for a ToHuus Cloud household (local dev server or a test account – never a real one).
 *
 *   node scripts/seed-screenshots.mjs --base http://localhost:8097 --token <app token> --household <household id>
 *        [--mira-email mira@example.org] [--mira-password mira-test-1234] [--operator-password <pw>] [--skip-off]
 *
 * Token and household: what the app keeps after signing in (debug: `-debugToken`, `-debugHousehold`), or the
 * `token` / `household.id` of `POST /api/cloud/login { email, password, client: 'ios', device }`.
 *
 * What it adds (each step skips what is already there, so running it twice does no harm):
 *  - a second member „Mira“ (invitation + account; needs a confirmed address on the inviting account)
 *  - five receipts from different shops over the last weeks (device text lines → /api/imports/lines, then applied),
 *    so Geld, „wo war’s günstiger“ and the price history have data
 *  - a week plan (recipes of the household, one free-text evening)
 *  - wish lists „Weihnachten Mika“ (photos, links, prices, one reserved) and „Merkliste Kekse“
 *  - a money list „Pizzaabend“ split by four, one private shopping list
 *  - product pictures from Open Food Facts for products without a picture (server lookup; --skip-off to leave out)
 *  - four open recipes with photos (TheMealDB via /api/recipes/open/import)
 *  - a „Bring mir was“ request from Mira
 *  - with --operator-password (account listed in OPERATOR_EMAILS): three ToHuus-Rezepte published („Neu diese Woche“)
 * Names follow the house rules: Familie Berg, Sam, Mira, Mika, Ben.
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const BASE = String(args.base ?? 'http://localhost:8097').replace(/\/$/, '');
const TOKEN = args.token;
const HOUSEHOLD = args.household;
if (!TOKEN || !HOUSEHOLD) {
  console.error('usage: node scripts/seed-screenshots.mjs --base <url> --token <app token> --household <id> [--operator-password <pw>]');
  process.exit(2);
}
const MIRA_EMAIL = String(args['mira-email'] ?? 'mira@example.org');
const MIRA_PASSWORD = String(args['mira-password'] ?? 'mira-test-1234');

const log = (...m) => console.log('·', ...m);
const warn = (...m) => console.warn('!', ...m);

async function call(method, path, body, { token = TOKEN, form = false, ok404 = false } = {}) {
  const headers = { Accept: 'application/json', 'Accept-Language': 'de', 'X-Household': HOUSEHOLD, 'X-ToHuus-Client': 'ios' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    if (ok404 && res.status === 404) return null;
    throw new Error(`${method} ${path} → ${res.status} ${typeof json === 'string' ? json.slice(0, 200) : JSON.stringify(json).slice(0, 300)}`);
  }
  return json;
}
const get = (p, o) => call('GET', p, undefined, o);
const post = (p, b, o) => call('POST', p, b ?? {}, o);

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    warn(`${name}: ${e.message}`);
  }
}

async function download(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ToHuus-seed/1.0 (test data; tohuus@tillheidrich.de)' }, redirect: 'follow' });
    if (!r.ok) return null;
    const type = r.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    return new Blob([await r.arrayBuffer()], { type });
  } catch {
    return null;
  }
}

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const de = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
const money = (n) => n.toFixed(2).replace('.', ',');

// ---------------------------------------------------------------- receipts (synthetic, in the shapes the parsers know)

/** lines: [name, price, extra?] – the sum line is computed so it always matches */
function receipt(shop, d, items) {
  const sum = items.reduce((s, [, p]) => s + p, 0);
  const head = {
    aldi: ['ALDI GmbH & Co. KG', 'Musterhausen', 'Bahnhofstr. 1'],
    lidl: ['Lidl', 'Lidl Vertriebs-GmbH & Co. KG', 'Musterstrasse 12', '99999 Musterstadt', 'EUR'],
    edeka: ['E D E K A', 'Edeka Muster', 'Hauptstr. 5', '99999 Musterdorf', 'EUR'],
    rewe: ['R E W E', 'Musterstraße 1', '12345 Musterstadt', 'EUR'],
    dm: ['dm-drogerie markt', 'Musterstr. 7', '99999 Musterstadt', 'EUR'],
  }[shop];
  const body = items.flatMap(([n, p, extra]) => [`${n}  ${money(p)} ${shop === 'dm' ? ' 1' : 'A'}`, ...(extra ? [extra] : [])]);
  const t = `${String(9 + (d.getDate() % 9)).padStart(2, '0')}:${String((d.getDate() * 7) % 60).padStart(2, '0')}`;
  const foot = {
    aldi: [`SUMME  ${money(sum)}`, `Bar  ${money(Math.ceil(sum / 10) * 10)}`, `Rückgeld  ${money(Math.ceil(sum / 10) * 10 - sum)}`, `${de(d)} ${t}  Kasse 2  Bon-Nr. 1234`, 'www.aldi-nord.de'],
    lidl: ['------------------------------------------------', `zu zahlen  ${money(sum)}`, `Kartenzahlung  ${money(sum)}`, `${de(d).slice(0, 6)}${de(d).slice(8)}  ${t}   Filiale 1234  Kasse 3  Bon-Nr 4711`],
    edeka: ['----------------------------------------', `SUMME EUR  ${money(sum)}`, `Geg. EC-Cash EUR  ${money(sum)}`, `Datum: ${de(d)}  Uhrzeit: ${t}  Bon-Nr.: 555`],
    rewe: [' --------------------------------------', ` SUMME  EUR  ${money(sum)}`, ' ======================================', ` Geg. EC-Cash  EUR  ${money(sum)}`, `Datum:  ${de(d)}`, `Uhrzeit:  ${t}:08 Uhr`, `  ${de(d)}  ${t}  Bon-Nr.:1234`],
    dm: [`SUMME EUR  ${money(sum)}`, `EC-Karte  ${money(sum)}`, `${de(d)} ${t}  Filiale 1234  Bon-Nr. 9001`],
  }[shop];
  return { shop, lines: [...head, ...body, ...foot] };
}

const RECEIPTS = [
  receipt('aldi', day(-24), [
    ['Vollmilch 3,5% 1l', 0.99],
    ['Butter 250g', 1.99],
    ['Bananen', 1.29, '   0,750 kg x  1,72 EUR/kg'],
    ['Toastbrot', 1.19],
    ['Gouda jung Scheiben', 1.79],
    ['Spaghetti 500g', 0.79],
  ]),
  receipt('lidl', day(-17), [
    ['Vollmilch 3,5% 1l', 1.05],
    ['Butter 250g', 2.19],
    ['Eier Freiland 10 St', 2.69],
    ['Tomaten passiert', 0.65],
    ['Mineralwasser 1,5l', 0.29],
    ['Haferflocken 500g', 0.89],
    ['Paprika rot', 1.49],
  ]),
  receipt('edeka', day(-11), [
    ['GOUDA JUNG SCHEIBEN', 1.99],
    ['VOLLMILCH 3,5% 1L', 1.15],
    ['KAFFEE GEMAHLEN 500G', 6.49],
    ['MOZZARELLA 125G', 0.99],
    ['RUCOLA 100G', 1.49],
    ['SPAGHETTI N.5 500G', 1.29],
  ]),
  receipt('dm', day(-8), [
    ['Balea Duschgel Creme 300ml', 0.95],
    ['Zahnpasta Kamille 75ml', 1.45],
    ['Feuchttücher Sensitive', 1.7],
    ['Spülmittel 500ml', 0.85],
    ['Haferflocken 500g', 0.89],
  ]),
  receipt('rewe', day(-3), [
    ['BUTTER 250G', 2.29],
    ['VOLLMILCH 3,5% 1L', 1.19],
    ['BANANE', 1.99, '          1,000 kg x    1,99 EUR/kg'],
    ['EIER FREILAND 10ST', 2.99],
    ['PIZZATEIG FRISCH', 1.89],
    ['TOMATEN PASSIERT', 0.89],
    ['SCHOKOKEKSE', 1.79],
  ]),
];

// ---------------------------------------------------------------- the steps

async function main() {
  const me = await get('/api/auth/me');
  log(`signed in as ${me.name} (${me.role})`);
  const peopleOf = async () => (await get('/api/people')).people ?? [];
  let people = await peopleOf();
  const sam = people.find((p) => p.kind === 'member' && p.name === me.name);
  let mira = people.find((p) => p.kind === 'member' && p.name === 'Mira');
  let miraToken = null;

  await step('Mira', async () => {
    if (mira) {
      log('Mira is already a member');
    } else {
      const inv = await post('/api/invites', { name: 'Mira', email: MIRA_EMAIL, role: 'admin', kind: 'member', send: false });
      const token = inv.token ?? String(inv.url ?? '').split(/[#/]/).pop();
      const out = await call('POST', `/api/invite/${token}`, { name: 'Mira', email: MIRA_EMAIL, password: MIRA_PASSWORD, client: 'ios', device: 'Seed' }, { token: null });
      miraToken = out.token ?? null;
      log('Mira joined the household');
      people = await peopleOf();
      mira = people.find((p) => p.kind === 'member' && p.name === 'Mira');
    }
    if (!miraToken) {
      const out = await call('POST', '/api/cloud/login', { email: MIRA_EMAIL, password: MIRA_PASSWORD, client: 'ios', device: 'Seed' }, { token: null });
      miraToken = out.token ?? null;
    }
  });

  // receipts → imports (review) → applied
  await step('receipts', async () => {
    const existing = await get('/api/imports');
    if ((existing ?? []).filter((i) => i.kind === 'receipt' || i.type === 'receipt' || i.store).length >= RECEIPTS.length) {
      log('receipts already there');
      return;
    }
    for (const r of RECEIPTS) {
      const out = await post('/api/imports/lines', { lines: r.lines, source: 'ocr-device', mode: 'receipt', confidence: 0.92 });
      if (out.kind !== 'receipt') {
        warn(`${r.shop}: not read as a receipt`);
        continue;
      }
      await step(`apply ${r.shop}`, () => post(`/api/imports/${out.id}/apply`));
      log(`receipt ${r.shop}: import ${out.id}${out.sumMatches ? '' : ' (sum differs)'}`);
    }
  });

  // pictures for products without one (Open Food Facts via the server)
  if (!args['skip-off'])
    await step('product pictures', async () => {
      const products = await get('/api/products');
      const bare = products.filter((p) => !p.image_path && !p.image_url && !p.archived).slice(0, 30);
      let n = 0;
      for (const p of bare) {
        const ok = await post(`/api/products/${p.id}/enrich`).catch(() => null);
        if (ok?.ok) n++;
      }
      log(`product pictures: ${n} of ${bare.length} found on Open Food Facts`);
    });

  // open recipes with photos
  const recipeIds = [];
  await step('open recipes', async () => {
    const have = await get('/api/recipes');
    const titles = new Set((have ?? []).map((r) => String(r.title).toLowerCase()));
    if ((have ?? []).filter((r) => JSON.stringify(r).toLowerCase().includes('themealdb')).length >= 4) {
      log('open recipes already there');
      return;
    }
    for (const q of ['lasagne', 'pancakes', 'risotto', 'curry']) {
      const res = await get(`/api/recipes/open/search?q=${encodeURIComponent(q)}`);
      const hit = (res.results ?? []).find((m) => !titles.has(String(m.title ?? m.name ?? '').toLowerCase()));
      if (!hit) continue;
      const out = await post('/api/recipes/open/import', { id: String(hit.id) });
      recipeIds.push(out.id);
      log(`open recipe: ${hit.title ?? hit.name} → ${out.id}${out.created ? '' : ' (was there)'}`);
    }
  });

  // week plan: dinners for the next seven days
  await step('week plan', async () => {
    const from = iso(day(0));
    const plan = await get(`/api/plan?from=${from}&days=7`);
    const filled = JSON.stringify(plan).match(/"recipe_id":\d+/g)?.length ?? 0;
    if (filled >= 4) {
      log('week plan already filled');
      return;
    }
    const recipes = (await get('/api/recipes')).filter((r) => !r.archived);
    const pick = [...recipeIds, ...recipes.map((r) => r.id)].filter((v, i, a) => a.indexOf(v) === i);
    for (let i = 0; i < 7; i++) {
      const d = iso(day(i));
      if (i === 4) await post('/api/plan2/entries', { day: d, slot: 'abend', title: 'Pizzaabend' });
      else if (pick[i % Math.max(1, pick.length)]) await post('/api/plan2/entries', { day: d, slot: 'abend', recipe_id: pick[i % pick.length] });
    }
    log('week plan: 7 evenings');
  });

  // wish lists
  await step('wishes', async () => {
    const lists = await get('/api/wishes/lists');
    const all = Array.isArray(lists) ? lists : (lists.lists ?? []);
    const kid = people.find((p) => p.kind === 'child');
    if (!all.some((l) => l.name === 'Weihnachten Mika')) {
      const l = await post('/api/wishes/lists', { name: 'Weihnachten Mika', note: 'Ideen für Mika – Oma und Opa fragen schon.', for_name: kid?.name ?? 'Mika', visibility: 'household' });
      const wishes = [
        {
          title: 'Holzeisenbahn mit Brücke',
          price: 49.9,
          priority: 1,
          note: 'Passt zu den Schienen, die schon da sind.',
          links: [
            { label: 'Spielwarenladen', url: 'https://example.org/holzeisenbahn', price: 49.9 },
            { label: 'Preisvergleich', url: 'https://example.org/preisvergleich/holzeisenbahn', price: 44.99 },
          ],
          photo: 'https://commons.wikimedia.org/wiki/Special:FilePath/Toy_train_3.jpg?width=640',
          reserve: true,
        },
        {
          title: 'Weichen-Set für die Schienen',
          price: 14.99,
          priority: 2,
          links: [{ label: 'Shop', url: 'https://example.org/weichen', price: 14.99 }],
          photo: 'https://commons.wikimedia.org/wiki/Special:FilePath/Brio_train_tracks_%E2%80%A2_2.jpg?width=640',
        },
        { title: 'Puzzle mit 100 Teilen (Tiere)', price: 12.99, priority: 2, links: [{ label: 'Shop', url: 'https://example.org/puzzle-tiere', price: 12.99 }] },
        { title: 'Bilderbuch über den Winter', price: 15, priority: 3, note: 'Gern gebraucht.' },
      ];
      for (const w of wishes) {
        const item = await post(`/api/wishes/lists/${l.id}/items`, { title: w.title, price: w.price, priority: w.priority, note: w.note ?? null, links: w.links ?? [] });
        const id = item.id ?? item.item?.id;
        if (w.photo && id) {
          const blob = await download(w.photo);
          if (blob) {
            const f = new FormData();
            f.append('image', blob, 'wish.jpg');
            await step('wish photo', () => call('POST', `/api/wishes/items/${id}/photo`, f, { form: true }));
          }
        }
        if (w.reserve && id) await step('reserve', () => post(`/api/wishes/items/${id}/status`, { status: 'reserved', by_name: 'Oma' }));
      }
      log('wish list „Weihnachten Mika“');
    }
    if (!all.some((l) => l.name === 'Merkliste Kekse')) {
      const l = await post('/api/wishes/lists', { name: 'Merkliste Kekse', note: 'Neue Kekse zum Probieren', visibility: 'household' });
      const kekse = [
        { title: 'Haferkekse mit Schokostückchen', price: 2.49, q: 'Haferkekse Schokolade' },
        { title: 'Butterkekse Vollkorn', price: 1.29, q: 'Butterkeks Vollkorn' },
        { title: 'Dinkel-Zimtsterne', price: 2.99, q: 'Zimtsterne' },
      ];
      for (const k of kekse) {
        const item = await post(`/api/wishes/lists/${l.id}/items`, {
          title: k.title,
          price: k.price,
          note: 'Im Artikel über neue Kekse gesehen.',
          links: [{ label: 'Artikel', url: 'https://example.org/neue-kekse' }],
        });
        const id = item.id ?? item.item?.id;
        if (!id || args['skip-off']) continue;
        const hits = await get(`/api/lookup/search?q=${encodeURIComponent(k.q)}`).catch(() => []);
        const img = (hits ?? []).find((h) => h.image)?.image;
        const blob = img ? await download(img) : null;
        if (blob) {
          const f = new FormData();
          f.append('image', blob, 'kekse.jpg');
          await step('keks photo', () => call('POST', `/api/wishes/items/${id}/photo`, f, { form: true }));
        }
      }
      log('wish list „Merkliste Kekse“');
    }
  });

  // money list „Pizzaabend“ split by four
  await step('money list', async () => {
    const lists = await get('/api/money/lists');
    if ((lists ?? []).some((l) => l.title === 'Pizzaabend')) {
      log('money list already there');
      return;
    }
    const ppl = [{ user_id: sam?.id, name: sam?.name ?? 'Sam' }, mira ? { user_id: mira.id, name: 'Mira' } : { name: 'Mira' }, { name: 'Ben' }, { name: 'Jo' }];
    const l = await post('/api/money/lists', {
      title: 'Pizzaabend',
      note: 'Freitag bei uns',
      mode: 'equal',
      visibility: 'household',
      people: ppl,
      items: [
        { name: 'Pizzateig und Tomaten', amount: 6.4 },
        { name: 'Mozzarella und Rucola', amount: 7.95 },
        { name: 'Getränke', amount: 12.5 },
        { name: 'Eis zum Nachtisch', amount: 5.49 },
      ],
    });
    const full = await get(`/api/money/lists/${l.id}`);
    const [p1, p2, p3] = full.people;
    const payers = [p1, p1, p2, p3];
    for (const [i, it] of full.items.entries()) await call('PATCH', `/api/money/lists/${l.id}/items/${it.id}`, { paid_by: payers[i]?.id ?? p1.id });
    log('money list „Pizzaabend“, four people');
  });

  // a private shopping list
  await step('private list', async () => {
    const lists = await get('/api/list/lists');
    if ((lists ?? []).some((l) => l.name === 'Geburtstagskuchen')) {
      log('private list already there');
      return;
    }
    const l = await post('/api/list/lists', { name: 'Geburtstagskuchen', kind: 'other', note: 'Überraschung – nur für mich', visibility: 'private' }).catch(() =>
      post('/api/list/lists', { name: 'Geburtstagskuchen', note: 'Überraschung – nur für mich', visibility: 'private' }),
    );
    for (const text of ['Mehl', 'Zucker', 'Kakao', 'Sahne', 'Kerzen', 'Erdbeeren']) await post('/api/shopping', { text, list_id: l.id });
    log('private list „Geburtstagskuchen“');
  });

  // a few things on the main list (so Einkauf is not empty)
  await step('main list', async () => {
    const open = await get('/api/shopping');
    if ((open ?? []).filter((i) => !i.checked_at).length >= 6) return;
    for (const text of ['Milch', 'Bananen', 'Butter', 'Eier', 'Haferflocken', 'Spülmittel', 'Rucola']) await post('/api/shopping', { text });
    log('main list: 7 things');
  });

  // „Bring mir was“: Mira asks Sam for something from the menu
  await step('Bring mir was', async () => {
    if (!miraToken) return;
    const mine = await get('/api/bar/my-orders', { token: miraToken });
    if ((mine ?? []).length) return;
    const menu = await get('/api/bar/menu', { token: miraToken });
    const pick = (menu ?? []).slice(0, 1);
    if (!pick.length) {
      log('Bring mir was: nothing on the menu yet');
      return;
    }
    await post('/api/bar/orders', { note: 'Wenn du eh noch losgehst', bring_by: sam?.id ?? null, lines: pick.map((p) => ({ product_id: p.product_id ?? p.id, qty: 1, options: [] })) }, { token: miraToken });
    log(`Bring mir was: Mira asks for ${pick[0].name}`);
  });

  // ToHuus-Rezepte: publish three drafts (operator only)
  if (args['operator-password'])
    await step('ToHuus-Rezepte', async () => {
      await post('/api/operator/unlock', { password: String(args['operator-password']) });
      const { recipes = [] } = await get('/api/operator/recipes');
      const published = recipes.filter((r) => r.state === 'published');
      if (published.length >= 3) {
        log('ToHuus-Rezepte: already published');
        return;
      }
      // prefer drafts with a photo – they are what „Neu diese Woche“ shows first
      const drafts = recipes
        .filter((r) => r.state !== 'published')
        .sort((a, b) => Number(Boolean(b.image)) - Number(Boolean(a.image)))
        .slice(0, 3 - published.length);
      for (const r of drafts) {
        await step(`publish ${r.id}`, async () => {
          await call('PATCH', `/api/operator/recipes/${r.id}`, { reviewState: 'reviewed' });
          await post(`/api/operator/recipes/${r.id}/publish`);
        });
      }
      log(`ToHuus-Rezepte: ${drafts.length} published`);
    });

  log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
