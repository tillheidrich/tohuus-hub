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
import { Router } from 'express';
import { z } from 'zod';
import { accountsDb, getHousehold, isUuid } from '../lib/accounts.js';
import { DEFAULT_FALLBACKS, aiConfig, fallbackModels, pingModel, type ModelKind } from '../lib/ai.js';
import { addAllowlist, createBetaCode, listAllowlist, listBetaCodes, removeAllowlist, revokeBetaCode, signupMode, SIGNUP_MODES } from '../lib/beta.js';
import { audit, auditLog } from '../lib/operator.js';
import { runStatsNightly, statsView } from '../lib/stats.js';
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
    res.json({ settings: runtimeSettingsView(), ai: effective(), signupMode: signupMode(), supportEmail: supportEmail(), keys: RUNTIME_KEYS });
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
