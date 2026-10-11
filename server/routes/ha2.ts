/** Home Assistant two-way logic ("what does HA already do for you?") and the voice command guide */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { t } from '../i18n.js';
import { guestFromToken, requireAdmin, requireAuth } from '../lib/auth.js';
import { isHouseGuest } from '../lib/people-policy.js';
import {
  TAG_ACTIONS,
  applyProposals,
  bridgeConfig,
  bridgeSync,
  deleteTag,
  everyoneAway,
  ha2Overview,
  handleTag,
  listTags,
  mapTag,
  presence,
  setHa2Settings,
  startHa2,
  syncNow,
  tagTargets,
} from '../lib/ha2.js';
import {
  ASSISTANTS,
  VOICE_SAFE_DOMAINS,
  VoiceError,
  addEntities,
  addManual,
  assistantName,
  deleteItem,
  guestVoice,
  importExposed,
  setVoiceLink,
  setVoiceSettings,
  updateItem,
  voiceCandidates,
  voiceItems,
  voiceLinks,
  voiceSettings,
} from '../lib/ha2-voice.js';

startHa2();

export const r = Router();
r.use(requireAuth);
// who is home, notification routing and HA's devices are household matters – never for permanent guests
r.use('/ha2', (req, res, next) => {
  if (isHouseGuest(req.actor as any)) return void res.status(403).json({ error: t('Not available for guests') });
  next();
});

const h =
  (fn: (req: Request, res: Response) => unknown | Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (e instanceof VoiceError) return void res.status(400).json({ error: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: t('Invalid input') });
      next(e);
    }
  };

// ================================================================== settings screen

r.get('/ha2', (_req, res) => res.json(ha2Overview()));

const mode = z.enum(['off', 'two_way', 'from_ha', 'to_ha']);
const entities = z.array(z.string().trim().max(120)).max(6);
r.patch(
  '/ha2/settings',
  requireAdmin,
  h((req) => {
    const b = z
      .object({
        transport: z.enum(['auto', 'integration', 'rest']).optional(),
        shopping: z.object({ mode, entities }).partial().optional(),
        meals: z.object({ mode, entities, days: z.number().int().min(3).max(60) }).partial().optional(),
        care: z.object({ mode, entities }).partial().optional(),
        presence: z.object({ enabled: z.boolean(), map: z.record(z.string().max(120), z.number().int().positive().nullable()) }).partial().optional(),
        notify: z.record(z.string().regex(/^\d+$/), z.string().regex(/^(notify\.)?[\w]+$/).max(120)).optional(),
        tags: z.object({ enabled: z.boolean() }).partial().optional(),
      })
      .parse(req.body);
    setHa2Settings(b as any);
    return ha2Overview();
  }),
);

r.post(
  '/ha2/apply-proposals',
  requireAdmin,
  h(() => {
    applyProposals();
    return ha2Overview();
  }),
);

/** Look again at Home Assistant (capabilities) and sync. */
r.post(
  '/ha2/detect',
  requireAdmin,
  h(async () => {
    const out = await syncNow({ capabilities: true });
    // the integration answers asynchronously – give it a moment
    if (out.transport === 'integration') await new Promise((ok) => setTimeout(ok, 1500));
    return { ...ha2Overview(), result: out };
  }),
);

r.post(
  '/ha2/sync',
  h(async () => ({ ...(await syncNow()), overview: ha2Overview() })),
);

r.get('/ha2/presence', (_req, res) => res.json({ people: presence(), away: everyoneAway() }));

// ---------------------------------------------------------------- NFC tags

r.get('/ha2/tags', (_req, res) => res.json({ tags: listTags(), targets: tagTargets() }));
r.patch(
  '/ha2/tags/:id',
  requireAdmin,
  h((req) => {
    const b = z.object({ name: z.string().max(60).nullable().optional(), code: z.string().max(40).nullable().optional(), action: z.enum(TAG_ACTIONS).nullable().optional() }).parse(req.body);
    return mapTag(String(req.params.id), b);
  }),
);
r.delete(
  '/ha2/tags/:id',
  requireAdmin,
  h((req) => ({ ok: deleteTag(String(req.params.id)) })),
);

// ---------------------------------------------------------------- voice commands

function voiceView() {
  const links = db.prepare('SELECT id, name, scopes, expires_at FROM guest_links WHERE revoked = 0 ORDER BY id DESC').all() as { id: number; name: string; scopes: string; expires_at: string | null }[];
  const on = new Set(voiceLinks());
  const s = voiceSettings();
  return {
    settings: s,
    assistant_name: assistantName(s.assistant),
    assistants: ASSISTANTS.map((a) => ({ id: a, name: assistantName(a) })),
    domains: VOICE_SAFE_DOMAINS,
    items: voiceItems({ includeHidden: true }),
    candidates: voiceCandidates(),
    links: links.map((l) => ({ id: l.id, name: l.name, scopes: JSON.parse(l.scopes) as string[], expires_at: l.expires_at, voice: on.has(l.id) })),
  };
}

r.get('/ha2/voice', (_req, res) => res.json(voiceView()));
r.put(
  '/ha2/voice/settings',
  requireAdmin,
  h((req) => {
    setVoiceSettings(z.object({ assistant: z.enum(ASSISTANTS), sitter_default: z.boolean() }).partial().parse(req.body));
    return voiceView();
  }),
);
r.post(
  '/ha2/voice/entities',
  requireAdmin,
  h((req) => ({ added: addEntities(z.object({ ids: z.array(z.string().max(120)).max(200) }).parse(req.body).ids), ...voiceView() })),
);
r.post(
  '/ha2/voice/import-exposed',
  requireAdmin,
  h(() => ({ added: importExposed(), ...voiceView() })),
);
const phrases = z.array(z.string().max(160)).max(5).nullable();
r.post(
  '/ha2/voice/items',
  requireAdmin,
  h((req) => {
    const b = z.object({ name: z.string().max(80), domain: z.enum(VOICE_SAFE_DOMAINS), area: z.string().max(60).nullable().optional(), phrases: phrases.optional() }).parse(req.body);
    return { id: addManual(b), ...voiceView() };
  }),
);
r.patch(
  '/ha2/voice/items/:id',
  requireAdmin,
  h((req) => {
    const b = z
      .object({ name: z.string().max(80).optional(), area: z.string().max(60).nullable().optional(), phrases: phrases.optional(), hidden: z.boolean().optional(), domain: z.enum(VOICE_SAFE_DOMAINS).optional() })
      .parse(req.body);
    updateItem(Number(req.params.id), b);
    return voiceView();
  }),
);
r.delete(
  '/ha2/voice/items/:id',
  requireAdmin,
  h((req) => {
    deleteItem(Number(req.params.id));
    return voiceView();
  }),
);
r.put(
  '/ha2/voice/links/:id',
  requireAdmin,
  h((req) => {
    setVoiceLink(Number(req.params.id), z.object({ on: z.boolean() }).parse(req.body).on);
    return voiceView();
  }),
);

// ================================================================== bridge for the HACS integration (HA token)

const rawItem = z.object({
  uid: z.string().max(200).nullable().optional(),
  summary: z.string().max(500).default(''),
  status: z.string().max(30).optional(),
  description: z.string().max(2000).nullable().optional(),
  start: z.union([z.string().max(60), z.object({ date: z.string().optional(), dateTime: z.string().optional() })]).nullable().optional(),
});
const snapshot = z.record(z.string().max(120), z.object({ items: z.array(rawItem).max(1000), last_updated: z.string().max(60).nullable().optional() }));
const capEntity = z.object({ entity_id: z.string().max(120), name: z.string().max(120).default(''), platform: z.string().max(60).nullable().optional(), writable: z.boolean().optional(), area: z.string().max(80).nullable().optional() });
const person = z.object({ entity_id: z.string().max(120), name: z.string().max(120).default(''), state: z.string().max(80).default('unknown'), user_id: z.string().max(80).nullable().optional() });

r.get('/ha/v1/bridge/config', (_req, res) => res.json(bridgeConfig()));

r.post(
  '/ha/v1/bridge/sync',
  h((req) => {
    const b = z
      .object({
        version: z.string().max(20).nullable().optional(),
        capabilities: z
          .object({
            todo: z.array(capEntity).max(200).default([]),
            calendar: z.array(capEntity).max(200).default([]),
            person: z.array(person).max(50).default([]),
            notify: z.array(z.string().max(120)).max(100).default([]),
            voice: z
              .array(
                z.object({
                  entity_id: z.string().max(120),
                  name: z.string().max(120).default(''),
                  domain: z.string().max(40),
                  area: z.string().max(80).nullable().optional(),
                  device_class: z.string().max(40).nullable().optional(),
                  exposed: z.object({ assist: z.boolean().optional(), alexa: z.boolean().optional(), google: z.boolean().optional() }).optional(),
                }),
              )
              .max(1000)
              .default([]),
            tags: z.boolean().default(true),
          })
          .nullable()
          .optional(),
        todo: snapshot.optional(),
        calendar: snapshot.optional(),
        persons: z.array(person).max(50).optional(),
        acks: z.array(z.object({ id: z.number().int(), ok: z.boolean(), uid: z.string().max(200).nullable().optional(), error: z.string().max(500).nullable().optional() })).max(500).optional(),
      })
      .parse(req.body ?? {});
    return bridgeSync(b as any);
  }),
);

r.post(
  '/ha/v1/bridge/tag',
  h((req) => {
    const b = z.object({ tag_id: z.string().min(1).max(120), name: z.string().max(80).nullable().optional(), device: z.string().max(80).nullable().optional(), user: z.string().max(80).nullable().optional() }).parse(req.body);
    return handleTag(b);
  }),
);

// ================================================================== public: voice section on a guest link

export const ha2Guest = Router();
ha2Guest.get('/:token/voice', (req, res) => {
  const a = guestFromToken(req.params.token);
  if (!a) {
    res.status(404).json({ error: t('This link has expired or is invalid.') });
    return;
  }
  res.json(guestVoice(a.guestLinkId!) ?? { items: [] });
});
