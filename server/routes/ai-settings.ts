/**
 * AI on/off (ai-policy.ts). Contract: docs/assistant.md › "Switching AI off".
 *   GET   /api/ai/settings → { configured, household, mcp, mine, effective, reason, admin, kids? }
 *   PATCH /api/ai/settings { household?, mcp? (admins), mine? (the signed-in member, for themselves only) }
 * Children: PUT /api/kids/:id/ai { enabled } (routes/kids.ts).
 */
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { aiConfigured } from '../lib/ai.js';
import { aiOffReason, householdAiOn, mcpOn, personAiOn, setHouseholdAi, setMcpOn, setPersonAi } from '../lib/ai-policy.js';
import { requireAuth } from '../lib/auth.js';
import { emit } from '../lib/bus.js';

export const r = Router();

/** The effective AI state for the signed-in member (also used by /api/assistant/status). */
export function aiStateFor(userId: number | null | undefined) {
  const configured = { text: aiConfigured('text'), vision: aiConfigured('vision'), audio: aiConfigured('audio') };
  const reason = aiOffReason({ userId: userId ?? null });
  const any = configured.text || configured.vision || configured.audio;
  return {
    configured,
    household: householdAiOn(),
    mcp: mcpOn(),
    // personal: only ever returned to that person
    mine: personAiOn(userId),
    effective: any && reason === null,
    reason: reason ?? (any ? null : 'no_model'),
  };
}

r.get('/ai/settings', requireAuth, (req, res) => {
  const a = req.actor!;
  const admin = a.role === 'admin' && !a.houseGuest;
  const parent = a.kind === 'user' && !a.houseGuest;
  res.json({
    ...aiStateFor(a.userId),
    admin,
    ...(parent
      ? { kids: (db.prepare('SELECT id, name, ai_off FROM kid_profiles ORDER BY id').all() as { id: number; name: string; ai_off: number }[]).map((k) => ({ id: k.id, name: k.name, ai: !k.ai_off })) }
      : {}),
  });
});

r.patch('/ai/settings', requireAuth, (req, res) => {
  const b = z.object({ household: z.boolean().optional(), mcp: z.boolean().optional(), mine: z.boolean().optional() }).strict().parse(req.body);
  const a = req.actor!;
  const admin = a.role === 'admin' && !a.houseGuest && a.kind !== 'guest';
  if ((b.household !== undefined || b.mcp !== undefined) && !admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (b.mine !== undefined) {
    if (!a.userId) {
      res.status(400).json({ error: 'no person' });
      return;
    }
    setPersonAi(a.userId, b.mine);
  }
  if (b.household !== undefined) setHouseholdAi(b.household);
  if (b.mcp !== undefined) setMcpOn(b.mcp);
  emit('settings');
  res.json(aiStateFor(a.userId));
});
