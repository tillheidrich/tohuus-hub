/** Receipt recognition: learned rules, recognition report per import, household statistics, anonymised fixtures. */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import {
  QualityError,
  UNITS,
  buildFixture,
  deleteRule,
  importReport,
  listRules,
  recognitionStats,
  setImportStore,
  updateRule,
} from '../lib/quality.js';

export const r = Router();
r.use(requireAuth);
const actorName = (req: any) => req.actor?.name ?? 'unbekannt';
const id = (v: unknown) => z.coerce.number().int().positive().parse(v);

function guard(fn: (req: any, res: any) => unknown) {
  return (req: any, res: any) => {
    try {
      const out = fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (e) {
      if (e instanceof QualityError) res.status(e.message.includes('not found') || /nicht gefunden|hittades inte/i.test(e.message) ? 404 : 400).json({ error: e.message });
      else if (e instanceof z.ZodError) res.status(400).json({ error: e.issues.map((i) => i.message).join(', ') });
      else throw e;
    }
  };
}

r.get('/quality/rules', guard(() => ({ rules: listRules(), units: UNITS })));

r.patch(
  '/quality/rules/:id',
  guard((req) => {
    const b = z
      .object({
        product_id: z.number().int().positive().nullable().optional(),
        qty_factor: z.number().positive().max(1000).nullable().optional(),
        unit: z.string().max(12).nullable().optional(),
        ignore: z.boolean().optional(),
        all_stores: z.boolean().optional(),
        store_name: z.string().max(60).optional(),
      })
      .parse(req.body ?? {});
    return updateRule(id(req.params.id), b);
  }),
);

r.delete('/quality/rules/:id', guard((req) => deleteRule(id(req.params.id))));

r.get('/quality/stats', guard((req) => recognitionStats(Number(req.query.limit ?? 20) || 20)));

r.get('/quality/imports/:id', guard((req) => importReport(id(req.params.id))));

r.patch(
  '/quality/imports/:id/store',
  guard((req) => {
    const { shop } = z.object({ shop: z.string().min(1).max(60) }).parse(req.body ?? {});
    return setImportStore(id(req.params.id), shop, actorName(req));
  }),
);

/** Anonymised fixture – built on request, returned to the person; nothing is sent anywhere. */
r.get(
  '/quality/imports/:id/fixture',
  guard((req) => buildFixture(id(req.params.id), { names: req.query.names !== '0' })),
);

r.get(
  '/quality/imports/:id/fixture.txt',
  guard((req, res) => {
    const f = buildFixture(id(req.params.id), { names: req.query.names !== '0' });
    res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
    res.type('text/plain; charset=utf-8').send(f.text);
    return undefined;
  }),
);
