/**
 * Operator back office of ToHuus Cloud (/betrieb) – the parts beyond the overview. Mounted inside routes/operator.ts,
 * so the same rules apply: OPERATOR_EMAILS only (404 for everyone else), a fresh password check (10 minutes), every
 * change in the audit log. Contract: docs/cloud.md › "Operator back office".
 *
 *   GET    /api/operator/settings                       runtime settings (AI key only as last 4), effective AI setup
 *   PUT    /api/operator/settings { <key>: value|null }  store / remove (null or '') – lib/runtime-settings.ts
 *   POST   /api/operator/settings/ai-test { kind? }      one tiny model request with the effective setup
 *   GET    /api/operator/beta                            mode, codes, allowlist
 *   POST   /api/operator/beta/codes { count?, note?, maxUses?, expiresAt?, code? }
 *   DELETE /api/operator/beta/codes/:id                  revoke
 *   POST   /api/operator/beta/allowlist { emails, note? }
 *   DELETE /api/operator/beta/allowlist { email }
 *   GET    /api/operator/stats?days=56                usage statistics: events per week/platform, funnel, cohorts, plans, AI cost
 *   POST   /api/operator/stats/snapshot                 compute the nightly snapshot now
 *   GET    /api/operator/households/:id                  plan, trial, dates, storage, member count – no names
 *   GET    /api/operator/audit?before=<id>&limit=        the audit log, paged
 */
import { runAsAiActor } from '../lib/ai-policy.js';
import { Router } from 'express';
import { z } from 'zod';
import { accountsDb, getHousehold, isUuid } from '../lib/accounts.js';
import { DEFAULT_FALLBACKS, aiConfig, fallbackModels, pingModel, type ModelKind } from '../lib/ai.js';
import { addAllowlist, createBetaCode, listAllowlist, listBetaCodes, removeAllowlist, revokeBetaCode, signupMode, SIGNUP_MODES } from '../lib/beta.js';
import { betaGift, createPlanCode, listPlanCodes, revokePlanCode } from '../lib/gifts.js';
import { sendErrors } from './diag.js';
import { audit, auditLog } from '../lib/operator.js';
import { runStatsNightly, statsView } from '../lib/stats.js';
import multer from 'multer';
import { addCatalogRecipe, adminRecipe, catalogDb, draftRecipesWithAi, getCatalogRow, scheduleReviewed, storeCatalogImage, type CatalogRow } from '../lib/cloud-recipes.js';
import { looksLikeImage } from '../lib/images.js';
import { detectAny, detectAnyText, PACKAGE_LIMITS } from '../lib/recipe-package.js';
import { isZip, readZip } from '../lib/recipe-formats.js';
import { RUNTIME_KEYS, SECRET_KEYS, isRuntimeKey, lastFour, runtimeSetting, runtimeSettingsView, setRuntimeSetting, supportEmail, type RuntimeKey } from '../lib/runtime-settings.js';

export function operatorAdmin(fresh: import('express').RequestHandler) {
  const r = Router();
  const who = (req: import('express').Request) => req.operator!.email;

  // ---------------------------------------------------------------- settings

  const KINDS: ModelKind[] = ['text', 'vision', 'visionHard', 'audio'];
  const effective = () => {
    const cfg = aiConfig();
    return {
      configured: Boolean(cfg),
      baseUrl: cfg?.baseUrl ?? null,
      openrouter: cfg?.openrouter ?? false,
      apiKey: lastFour(cfg?.apiKey),
      models: cfg?.models ?? null,
      fallbacks: Object.fromEntries(KINDS.map((k) => [k, cfg?.models[k] ? fallbackModels(k, cfg.models[k]!) : []])),
      defaultFallbacks: DEFAULT_FALLBACKS,
      cloudOn: runtimeSetting('ai.cloud') !== 'off',
    };
  };

  r.get('/operator/settings', fresh, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ settings: runtimeSettingsView(), ai: effective(), signupMode: signupMode(), supportEmail: supportEmail(), pointsOn: runtimeSetting('points') === 'on', keys: RUNTIME_KEYS });
  });

  const MODEL = z.string().trim().max(120).regex(/^[\w.:/@+-]+$/, 'model id');
  const validators: Record<RuntimeKey, z.ZodType<string>> = {
    AI_API_KEY: z.string().trim().min(8).max(400).regex(/^\S+$/, 'no spaces'),
    AI_BASE_URL: z.string().trim().max(300).url().refine((u) => /^https:\/\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u), 'https only'),
    AI_MODEL_TEXT: MODEL,
    AI_MODEL_VISION: MODEL,
    AI_MODEL_VISION_HARD: MODEL,
    AI_MODEL_AUDIO: MODEL,
    AI_MODEL_FALLBACKS: z.string().trim().max(600).regex(/^(-|[\w.:/@+-]+(\s*,\s*[\w.:/@+-]+)*)$/, 'comma-separated model ids or -'),
    'ai.cloud': z.enum(['on', 'off']),
    'signup.mode': z.enum(SIGNUP_MODES as [string, ...string[]]),
    'support.email': z.string().trim().max(254).email(),
    'beta.gift': z.enum(['haushalt', 'plus']),
    points: z.enum(['on', 'off']),
  };

  r.put('/operator/settings', fresh, (req, res) => {
    const body = z.record(z.string(), z.union([z.string(), z.null()])).parse(req.body ?? {});
    const changes: { key: RuntimeKey; value: string | null }[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (!isRuntimeKey(k)) return void res.status(400).json({ error: `unknown setting ${k}` });
      if (v === null || v.trim() === '') changes.push({ key: k, value: null });
      else {
        const p = validators[k].safeParse(v);
        if (!p.success) return void res.status(400).json({ error: `${k}: ${p.error.issues[0]?.message ?? 'invalid'}`, key: k });
        changes.push({ key: k, value: p.data });
      }
    }
    const changed: string[] = [];
    for (const c of changes) {
      if (!setRuntimeSetting(c.key, c.value, who(req))) continue;
      changed.push(c.key);
      // the secret never goes into the log – only that it changed (and its last 4 characters)
      audit(who(req), c.value === null ? 'settings.reset' : 'settings.set', c.key, SECRET_KEYS.includes(c.key) ? { last4: lastFour(c.value) } : { value: c.value });
    }
    res.json({ ok: true, changed, settings: runtimeSettingsView(), ai: effective(), signupMode: signupMode() });
  });

  r.post('/operator/settings/ai-test', fresh, async (req, res) => {
    const { kind } = z.object({ kind: z.enum(['text', 'vision', 'visionHard', 'audio']).default('text') }).parse(req.body ?? {});
    const out = await pingModel(kind);
    audit(who(req), 'settings.ai-test', kind, { ok: out.ok, ...(out.ok ? { model: out.model } : { code: out.code }) });
    res.json(out);
  });

  // ---------------------------------------------------------------- error log (errorlog.ts) – also as a download

  r.get('/operator/errors', fresh, (req, res) => sendErrors(req, res));

  // ---------------------------------------------------------------- gifts: beta plan and plan codes (gifts.ts)

  r.get('/operator/gifts', fresh, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ betaGift: betaGift(), codes: listPlanCodes() });
  });

  r.post('/operator/gifts/codes', fresh, (req, res) => {
    const b = z
      .object({
        plan: z.enum(['haushalt', 'plus']),
        /** null = for good ("lifetime") */
        days: z.number().int().min(1).max(3650).nullable(),
        count: z.number().int().min(1).max(50).default(1),
        note: z.string().trim().max(120).nullable().optional(),
        maxUses: z.number().int().min(1).max(10_000).nullable().optional(),
        expiresAt: z.string().regex(/^\d{4}-\d\d-\d\d$/).nullable().optional(),
        code: z.string().trim().min(6).max(40).regex(/^[A-Za-z0-9 _-]+$/).optional(),
      })
      .parse(req.body ?? {});
    if (b.code && b.count > 1) return void res.status(400).json({ error: 'a fixed code can only be created once' });
    try {
      const codes = Array.from({ length: b.count }, () => createPlanCode({ plan: b.plan, days: b.days, note: b.note, maxUses: b.maxUses ?? 1, expiresAt: b.expiresAt ?? null, code: b.code }, who(req)));
      audit(who(req), 'gifts.codes.create', codes.map((c) => c.id).join(','), { plan: b.plan, days: b.days, count: codes.length, note: b.note ?? null });
      res.json({ codes });
    } catch (e) {
      if (/UNIQUE/.test((e as Error).message)) return void res.status(409).json({ error: 'this code exists already' });
      throw e;
    }
  });

  r.delete('/operator/gifts/codes/:id', fresh, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !revokePlanCode(id)) return void res.status(404).json({ error: 'not found' });
    audit(who(req), 'gifts.codes.revoke', String(id));
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- beta gate

  r.get('/operator/beta', fresh, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ mode: signupMode(), supportEmail: supportEmail(), codes: listBetaCodes(), allowlist: listAllowlist() });
  });

  r.post('/operator/beta/codes', fresh, (req, res) => {
    const b = z
      .object({
        count: z.number().int().min(1).max(50).default(1),
        note: z.string().trim().max(120).nullable().optional(),
        maxUses: z.number().int().min(1).max(10_000).nullable().optional(),
        expiresAt: z.string().regex(/^\d{4}-\d\d-\d\d$/).nullable().optional(),
        code: z.string().trim().min(6).max(40).regex(/^[A-Za-z0-9 _-]+$/).optional(),
      })
      .parse(req.body ?? {});
    if (b.code && b.count > 1) return void res.status(400).json({ error: 'a fixed code can only be created once' });
    try {
      const codes = Array.from({ length: b.count }, () => createBetaCode({ note: b.note, maxUses: b.maxUses ?? null, expiresAt: b.expiresAt ?? null, code: b.code }, who(req)));
      audit(who(req), 'beta.codes.create', codes.map((c) => c.id).join(','), { count: codes.length, note: b.note ?? null, maxUses: b.maxUses ?? null, expiresAt: b.expiresAt ?? null });
      res.json({ codes });
    } catch (e) {
      if (/UNIQUE/.test((e as Error).message)) return void res.status(409).json({ error: 'this code exists already' });
      throw e;
    }
  });

  r.delete('/operator/beta/codes/:id', fresh, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || !revokeBetaCode(id)) return void res.status(404).json({ error: 'not found' });
    audit(who(req), 'beta.codes.revoke', String(id));
    res.json({ ok: true });
  });

  r.post('/operator/beta/allowlist', fresh, (req, res) => {
    const b = z.object({ emails: z.union([z.string().max(20_000), z.array(z.string().max(254)).max(500)]), note: z.string().trim().max(120).nullable().optional() }).parse(req.body ?? {});
    const list = (Array.isArray(b.emails) ? b.emails : b.emails.split(/[\s,;]+/)).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const bad = list.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad.length) return void res.status(400).json({ error: `not an e-mail address: ${bad.slice(0, 3).join(', ')}` });
    const added = addAllowlist(list, b.note ?? null, who(req));
    // the log counts – addresses stay in the allowlist only
    audit(who(req), 'beta.allowlist.add', null, { added, note: b.note ?? null });
    res.json({ ok: true, added, allowlist: listAllowlist() });
  });

  r.delete('/operator/beta/allowlist', fresh, (req, res) => {
    const { email } = z.object({ email: z.string().trim().max(254) }).parse(req.body ?? {});
    if (!removeAllowlist(email)) return void res.status(404).json({ error: 'not found' });
    audit(who(req), 'beta.allowlist.remove', null);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- usage statistics (counts only, lib/stats.ts)

  r.get('/operator/stats', fresh, (req, res) => {
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(400).default(56) }).parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(statsView(days));
  });
  r.post('/operator/stats/snapshot', fresh, async (req, res) => {
    const snap = await runStatsNightly();
    audit(who(req), 'stats.snapshot', snap.day);
    res.json(snap);
  });

  // ---------------------------------------------------------------- ToHuus-Rezepte (lib/cloud-recipes.ts)

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PACKAGE_LIMITS.maxUploadBytes, files: 1, fields: 10 } });
  const rowOr404 = (req: import('express').Request, res: import('express').Response) => {
    const row = getCatalogRow(Number(req.params.id));
    if (!row) res.status(404).json({ error: 'not found' });
    return row;
  };

  r.get('/operator/recipes', fresh, (_req, res) => {
    const rows = catalogDb().prepare(`SELECT * FROM catalog_recipes ORDER BY CASE state WHEN 'scheduled' THEN 0 WHEN 'draft' THEN 1 WHEN 'published' THEN 2 ELSE 3 END, COALESCE(publish_at, published_at, created_at) DESC, id DESC`).all() as CatalogRow[];
    const counts = Object.fromEntries((catalogDb().prepare('SELECT state, COUNT(*) n FROM catalog_recipes GROUP BY state').all() as { state: string; n: number }[]).map((x) => [x.state, x.n]));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ counts, recipes: rows.map(adminRecipe) });
  });

  r.get('/operator/recipes/:id', fresh, (req, res) => {
    const row = rowOr404(req, res);
    if (row) res.json(adminRecipe(row));
  });

  /** A ToHuus recipe package (zip with rezepte.json + bilder/, or the JSON) → drafts. */
  r.post('/operator/recipes/upload', fresh, upload.single('file'), async (req, res) => {
    const b = z
      .object({
        aiAssisted: z.enum(['true', 'false']).default('false'),
        imageKind: z.enum(['photo', 'ai']).default('photo'),
        license: z.string().trim().max(80).optional(),
        sourceAuthors: z.string().trim().max(300).optional(),
        text: z.string().max(20_000_000).optional(),
      })
      .parse(req.body ?? {});
    let d;
    try {
      d = req.file ? detectAny(req.file.buffer, req.file.originalname) : detectAnyText(b.text ?? '');
    } catch (e) {
      return void res.status(422).json({ error: (e as Error).message });
    }
    const ids: number[] = [];
    for (const rec of d.recipes)
      ids.push(await addCatalogRecipe({ recipe: rec, origin: 'package', aiAssisted: b.aiAssisted === 'true', imageKind: b.imageKind, license: b.license || 'ToHuus', sourceAuthors: b.sourceAuthors || null, by: who(req) }));
    audit(who(req), 'recipes.upload', null, { created: ids.length, errors: d.errors.length, file: req.file?.originalname?.slice(0, 80) ?? null });
    res.json({ created: ids.length, ids, errors: d.errors, warnings: d.warnings ?? [] });
  });

  r.patch('/operator/recipes/:id', fresh, (req, res) => {
    const row = rowOr404(req, res);
    if (!row) return;
    const b = z
      .object({
        reviewState: z.enum(['draft', 'reviewed', 'cooked']).optional(),
        publishAt: z.string().regex(/^\d{4}-\d\d-\d\d( \d\d:\d\d(:\d\d)?)?$/).nullable().optional(),
        tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        aiAssisted: z.boolean().optional(),
        imageKind: z.enum(['none', 'photo', 'ai']).optional(),
        /** Plus recipe: households without Plus see the card with a lock */
        tier: z.enum(['all', 'plus']).optional(),
      })
      .parse(req.body ?? {});
    const d = catalogDb();
    if (b.publishAt !== undefined && b.publishAt !== null && row.review_state === 'draft' && b.reviewState !== 'reviewed' && b.reviewState !== 'cooked')
      return void res.status(409).json({ error: 'read and mark the recipe as reviewed first' });
    d.transaction(() => {
      if (b.reviewState) d.prepare(`UPDATE catalog_recipes SET review_state = ? WHERE id = ?`).run(b.reviewState, row.id);
      if (b.tags) d.prepare(`UPDATE catalog_recipes SET tags = ? WHERE id = ?`).run(JSON.stringify(b.tags), row.id);
      if (b.tier) d.prepare(`UPDATE catalog_recipes SET tier = ? WHERE id = ?`).run(b.tier, row.id);
      if (b.aiAssisted !== undefined) d.prepare(`UPDATE catalog_recipes SET ai_assisted = ? WHERE id = ?`).run(b.aiAssisted ? 1 : 0, row.id);
      if (b.imageKind) d.prepare(`UPDATE catalog_recipes SET image_kind = CASE WHEN image IS NULL THEN 'none' ELSE ? END WHERE id = ?`).run(b.imageKind === 'none' ? 'photo' : b.imageKind, row.id);
      if (b.publishAt !== undefined) {
        if (b.publishAt === null) d.prepare(`UPDATE catalog_recipes SET state = CASE WHEN state = 'scheduled' THEN 'draft' ELSE state END, publish_at = NULL WHERE id = ?`).run(row.id);
        else d.prepare(`UPDATE catalog_recipes SET state = 'scheduled', publish_at = ? WHERE id = ? AND state != 'published'`).run(b.publishAt.length === 10 ? `${b.publishAt} 06:00:00` : b.publishAt.padEnd(19, ':00').slice(0, 19), row.id);
      }
      d.prepare(`UPDATE catalog_recipes SET updated_at = datetime('now') WHERE id = ?`).run(row.id);
    })();
    audit(who(req), 'recipes.update', `recipe:${row.id}`, b);
    res.json(adminRecipe(getCatalogRow(row.id)!));
  });

  r.post('/operator/recipes/:id/photo', fresh, upload.single('file'), async (req, res) => {
    const row = rowOr404(req, res);
    if (!row) return;
    if (!req.file || !looksLikeImage(req.file.buffer)) return void res.status(400).json({ error: 'not a photo' });
    const kind = req.body?.kind === 'ai' ? 'ai' : 'photo';
    const name = await storeCatalogImage(req.file.buffer);
    catalogDb().prepare(`UPDATE catalog_recipes SET image = ?, image_kind = ?, updated_at = datetime('now') WHERE id = ?`).run(name, kind, row.id);
    audit(who(req), 'recipes.photo', `recipe:${row.id}`, { kind });
    res.json(adminRecipe(getCatalogRow(row.id)!));
  });

  /**
   * Preview cards from Canva in one go: the ZIP Canva exports from the preview-card design ("1.png", "2.png" …, also
   * inside a folder). Page N goes to the recipe with `image_page = N`; a recipe with a photographer (image_credit)
   * becomes a photo, the others an AI picture. Pages without a recipe are reported, nothing else changes.
   */
  r.post('/operator/recipes/preview-zip', fresh, upload.single('file'), async (req, res) => {
    if (!req.file || !isZip(req.file.buffer)) return void res.status(400).json({ error: 'not a zip' });
    let entries;
    try {
      entries = readZip(req.file.buffer);
    } catch (e) {
      return void res.status(422).json({ error: (e as Error).message });
    }
    // a ZIP of part of the design (e.g. the baking cards 33–38 as pages 1–6) says where it starts
    const start = Math.max(1, Math.min(999, Math.trunc(Number(req.body?.start) || 1)));
    const byPage = new Map((catalogDb().prepare('SELECT * FROM catalog_recipes WHERE image_page IS NOT NULL').all() as CatalogRow[]).map((r) => [r.image_page!, r]));
    const set = catalogDb().prepare(`UPDATE catalog_recipes SET image = ?, image_kind = ?, updated_at = datetime('now') WHERE id = ?`);
    const done: { page: number; id: number; title: string }[] = [];
    const skipped: string[] = [];
    for (const e of entries) {
      const m = /(?:^|[^0-9])(\d{1,3})\.(png|jpe?g|webp)$/i.exec(e.name);
      const page = m ? Number(m[1]) + start - 1 : 0;
      const row = m ? byPage.get(page) : undefined;
      if (!m || !row) {
        if (!e.name.endsWith('/')) skipped.push(e.name.slice(0, 80));
        continue;
      }
      const buf = e.data();
      if (!looksLikeImage(buf)) {
        skipped.push(e.name.slice(0, 80));
        continue;
      }
      set.run(await storeCatalogImage(buf), row.image_credit ? 'photo' : 'ai', row.id);
      done.push({ page, id: row.id, title: row.title });
    }
    audit(who(req), 'recipes.preview-zip', null, { pages: done.length, skipped: skipped.length });
    res.json({ updated: done.length, recipes: done, skipped: skipped.slice(0, 20) });
  });

  r.post('/operator/recipes/:id/publish', fresh, (req, res) => {
    const row = rowOr404(req, res);
    if (!row) return;
    if (row.review_state === 'draft') return void res.status(409).json({ error: 'read and mark the recipe as reviewed first' });
    catalogDb().prepare(`UPDATE catalog_recipes SET state = 'published', published_at = datetime('now'), publish_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(row.id);
    audit(who(req), 'recipes.publish', `recipe:${row.id}`);
    res.json(adminRecipe(getCatalogRow(row.id)!));
  });

  r.post('/operator/recipes/:id/unpublish', fresh, (req, res) => {
    const row = rowOr404(req, res);
    if (!row) return;
    catalogDb().prepare(`UPDATE catalog_recipes SET state = 'unpublished', publish_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(row.id);
    audit(who(req), 'recipes.unpublish', `recipe:${row.id}`);
    res.json(adminRecipe(getCatalogRow(row.id)!));
  });

  r.delete('/operator/recipes/:id', fresh, (req, res) => {
    const row = rowOr404(req, res);
    if (!row) return;
    if (row.state === 'published') return void res.status(409).json({ error: 'unpublish it first' });
    catalogDb().prepare('DELETE FROM catalog_recipes WHERE id = ?').run(row.id);
    audit(who(req), 'recipes.delete', `recipe:${row.id}`, { title: row.title });
    res.json({ ok: true });
  });

  /** Publication dates for reviewed drafts: `perWeek` on fixed weekdays (3 → Mon, Wed, Fri, 06:00 UTC). */
  r.post('/operator/recipes/schedule', fresh, (req, res) => {
    const b = z.object({ ids: z.array(z.number().int()).max(500).optional(), perWeek: z.number().int().min(1).max(7).default(3), start: z.string().regex(/^\d{4}-\d\d-\d\d$/).nullable().optional() }).parse(req.body ?? {});
    const plan = scheduleReviewed(b);
    audit(who(req), 'recipes.schedule', null, { count: plan.length, perWeek: b.perWeek });
    res.json({ plan });
  });

  /** "Entwürfe mit KI erstellen": Mistral drafts from dish names – into the queue as drafts, never published. */
  r.post('/operator/recipes/ai-drafts', fresh, async (req, res) => {
    const b = z.object({ dishes: z.array(z.string().trim().min(2).max(80)).min(1).max(5) }).parse(req.body ?? {});
    try {
      const out = await runAsAiActor({ operator: true }, () => draftRecipesWithAi(b.dishes, who(req)));
      audit(who(req), 'recipes.ai-drafts', null, { requested: b.dishes.length, created: out.ids.length });
      res.json(out);
    } catch (e) {
      const err = e as { status?: number; message: string; code?: string };
      res.status(err.status && err.status >= 400 ? err.status : 502).json({ error: err.message, code: err.code });
    }
  });

  // ---------------------------------------------------------------- households (id only, no names)

  r.get('/operator/households/:id', fresh, (req, res) => {
    const id = String(req.params.id);
    const h = isUuid(id) ? getHousehold(id) : undefined;
    if (!h) return void res.status(404).json({ error: 'not found' });
    const members = (accountsDb().prepare('SELECT role, COUNT(*) n FROM memberships WHERE household_id = ? GROUP BY role').all(id) as { role: string; n: number }[]).reduce<Record<string, number>>(
      (a, r2) => ((a[r2.role] = r2.n), a),
      {},
    );
    const x = h as unknown as Record<string, unknown>;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      id: h.id,
      plan: x.plan,
      planSource: x.plan_source,
      planExpiresAt: x.plan_expires_at ?? null,
      trialEndsAt: x.trial_ends_at ?? null,
      createdDay: String(x.created_at ?? '').slice(0, 10),
      lastActiveDay: String(x.last_active_at ?? '').slice(0, 10),
      storageBytes: x.storage_bytes,
      members,
    });
  });

  r.get('/operator/audit', fresh, (req, res) => {
    const q = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(auditLog(q.limit, q.before));
  });

  return r;
}
