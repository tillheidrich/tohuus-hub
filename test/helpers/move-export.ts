/**
 * Child process for test/move.test.ts: a SELF-HOSTED household (MULTI_TENANT unset) with some data, built into a
 * move file (and <out>-codes.zip with the Hausinfo codes). Usage: tsx test/helpers/move-export.ts <dataDir> <out.zip>
 */
import fs from 'node:fs';
import sharp from 'sharp';

const [dataDir, out] = process.argv.slice(2);
process.env.DATA_DIR = dataDir;
process.env.LANGUAGE = 'de';
delete process.env.MULTI_TENANT;

const dbm = await import('../../server/db.js');
const { db } = dbm;
const auth = await import('../../server/lib/auth.js');
(await import('../../server/seed.js')).ensureBaseData();
const catalog = await import('../../server/lib/catalog.js');
const recipes = await import('../../server/lib/recipes.js');
const memory = await import('../../server/lib/memory.js');
const images = await import('../../server/lib/images.js');
const move = await import('../../server/lib/move.js');
const house = await import('../../server/lib/house-guide.js');
await import('../../server/lib/onboard.js');

dbm.setSetting('language', 'de');
dbm.setSetting('household.name', 'Familie Berg');
const mira = Number(db.prepare(`INSERT INTO users (name, role, password_hash, email, email_verified_at) VALUES ('Mira', 'admin', ?, 'mira@example.org', datetime('now'))`).run(auth.hashPassword('test1234')).lastInsertRowid);
const sam = Number(db.prepare(`INSERT INTO users (name, role, password_hash) VALUES ('Sam', 'member', ?)`).run(auth.hashPassword('test1234')).lastInsertRowid);
auth.createSession(mira);
auth.createApiToken('Claude', 'mcp');
const pid = catalog.createProduct({ name: 'Hafermilch Umzug' });
catalog.addToShopping({ productId: pid, text: 'Hafermilch Umzug' } as any);
recipes.saveRecipe({ title: 'Pfannkuchen Umzug', ingredients: [{ text: '200 g Mehl' }], steps: [{ text: 'Rühren' }] } as any);
memory.remember({ text: 'Wir kaufen Brot beim Bäcker', createdBy: 'Mira' });
memory.remember({ text: 'Sams Geheimnis Lakritz', createdBy: 'Sam', privateTo: sam });
db.prepare(`INSERT INTO people_prefs (person, likes) VALUES (?, '["Nudeln"]')`).run(`u${sam}`);
const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#3a7' } }).png().toBuffer();
const img = await images.saveImage(png, `p${pid}`);
db.prepare('UPDATE products SET image_path = ? WHERE id = ?').run(img, pid);
house.createCode({ kind: 'door', label: 'Haustür Umzug', value: '4711-geheim' }, 'Mira');
const zip = move.buildMoveFile({ viewer: mira, includeSecrets: false });
fs.writeFileSync(out, zip);
// the same household with "Codes mitnehmen" ticked
fs.writeFileSync(out.replace(/\.zip$/, '-codes.zip'), move.buildMoveFile({ viewer: mira, includeSecrets: true }));
console.log(JSON.stringify({ ok: true, image: img, bytes: zip.length }));
process.exit(0);
