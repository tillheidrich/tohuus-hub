/** MCP tools: rotating meal plans, family food votes and one-off servings per plan entry */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { db } from '../db.js';
import { localDay } from '../lib/catalog.js';
import { getPlan } from '../lib/plan.js';
import {
  applyRotation,
  applyTemplate,
  applyVote,
  candidateIdeas,
  castBallots,
  closeVote,
  createVote,
  dayMarks,
  getVote,
  listMembers,
  listTemplates,
  listVotes,
  rotationView,
  saveRotation,
  saveTemplate,
  saveWeekAsTemplate,
  setDayMark,
  setEntryServings,
} from '../lib/plan2.js';
import { nameScore } from '../lib/text.js';

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 1) }] });
const fail = (msg: string) => ({ content: [{ type: 'text' as const, text: msg }], isError: true });
const RO = { readOnlyHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function resolveRecipe(ref: string | number): { id: number; title: string } | null {
  const rows = db.prepare('SELECT id, title FROM recipes').all() as { id: number; title: string }[];
  if (typeof ref === 'number' || /^#?\d+$/.test(String(ref).trim())) return rows.find((r) => r.id === Number(String(ref).replace('#', ''))) ?? null;
  const q = String(ref).trim().toLowerCase();
  const exact = rows.find((r) => r.title.toLowerCase() === q);
  if (exact) return exact;
  const best = rows.map((r) => ({ r, s: nameScore(String(ref), r.title) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s >= 0.75 ? best.r : null;
}

const slimVote = (v: NonNullable<ReturnType<typeof getVote>>) => ({
  id: v.id,
  title: v.title,
  days: v.day_from === v.day_to ? v.day_from : `${v.day_from} – ${v.day_to}`,
  mode: v.mode,
  status: v.status,
  results_visible: v.revealed,
  dishes: v.candidates.map((c) => ({ candidate_id: c.id, title: c.title, recipe_id: c.recipe_id, in_plan: Boolean(c.planned_entry_id) })),
  voters: v.voters.map((x) => ({ name: x.name, done: x.done, has_login: x.login })),
  results: v.results?.map((r) => ({ title: r.title, yes: r.yes, super: r.super, no: r.no, everyone_wants_it: r.match })) ?? 'hidden until everyone voted or the vote is closed',
});

export function register(s: McpServer, actorName: string) {
  const actor = () => {
    const u = db.prepare('SELECT id, role FROM users WHERE lower(name) = lower(?)').get(actorName) as { id: number; role: string } | undefined;
    return { userId: u?.id, role: u?.role, name: actorName };
  };
  const findVote = (vid?: number | null) => {
    if (vid) return getVote(vid, actor());
    return listVotes(actor())[0] ?? null;
  };

  // ------------------------------------------------------------ votes

  s.registerTool(
    'list_food_votes',
    {
      title: 'Family food votes',
      description:
        'Open family food votes ("who wants what for dinner?") and the ones closed in the last 3 days: dishes, who has voted (never what), and – once everyone voted or the vote is closed – how many said no / yes / super per dish and which dishes everyone wants. Also returns the members who can vote and candidate ideas (pantry suggestions, favourites, Cookidoo week) for a new vote.',
      inputSchema: { include_ideas: z.boolean().optional() },
      annotations: RO,
    },
    async (a) =>
      text({
        votes: listVotes(actor(), { includeClosed: true }).map(slimVote),
        members: listMembers().map((m) => ({ key: m.key, name: m.name, has_login: m.login })),
        ...(a.include_ideas ? { ideas: candidateIdeas() } : {}),
      }),
  );

  s.registerTool(
    'start_food_vote',
    {
      title: 'Start a family food vote',
      description:
        'Start a vote for one day or a range of days. Dishes are recipe titles/ids from the collection or free text ("Pizza bestellen"), 2–20. mode "secret": every member with a login swipes on their own phone, results stay hidden until everyone voted (members get a notification). mode "together": one device is passed around (kids without login vote there). voters = member names or keys (default: everyone with a login for secret, everyone for together).',
      inputSchema: {
        day: z.string().regex(DAY).optional().describe('first day (YYYY-MM-DD), default today'),
        until: z.string().regex(DAY).optional().describe('last day for a week vote'),
        dishes: z.array(z.string().min(1).max(120)).min(2).max(20),
        mode: z.enum(['secret', 'together']).default('secret'),
        title: z.string().max(80).optional(),
        voters: z.array(z.string()).optional(),
      },
      annotations: RW,
    },
    async (a) => {
      try {
        const members = listMembers();
        const voters = a.voters?.map((v) => members.find((m) => m.key === v || m.name.toLowerCase() === v.toLowerCase())?.key).filter((x): x is string => Boolean(x));
        const candidates = a.dishes.map((d) => {
          const r = resolveRecipe(d);
          return r ? { recipe_id: r.id, title: r.title, source: 'recipe' } : { title: d, source: 'free' };
        });
        const v = createVote({ title: a.title, day_from: a.day ?? localDay(0), day_to: a.until, mode: a.mode, candidates, voters }, actor());
        return text(slimVote(v));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  s.registerTool(
    'cast_food_vote',
    {
      title: 'Vote in a family food vote',
      description:
        'Record one member\'s choices: per dish "no", "yes" or "super". In a secret vote you can vote only for the signed-in member or for members without a login (kids); in a together vote for anyone. Unmentioned dishes stay open. When everyone has voted the vote closes and the result is announced.',
      inputSchema: {
        vote_id: z.number().int().positive().optional().describe('default: the newest open vote'),
        voter: z.string().optional().describe('member name or key; default the signed-in member'),
        choices: z.array(z.object({ dish: z.string().min(1), choice: z.enum(['no', 'yes', 'super']) })).min(1).max(20),
      },
      annotations: RW,
    },
    async (a) => {
      try {
        const v = findVote(a.vote_id);
        if (!v) return fail('No open vote.');
        const me = actor();
        const members = listMembers();
        const voter = a.voter ? members.find((m) => m.key === a.voter || m.name.toLowerCase() === a.voter!.toLowerCase())?.key : me.userId ? `u:${me.userId}` : undefined;
        if (!voter) return fail(`Unknown member. Members: ${members.map((m) => m.name).join(', ')}`);
        const ballots = a.choices.map((c) => {
          const cand =
            v.candidates.find((x) => x.title.toLowerCase() === c.dish.toLowerCase()) ??
            v.candidates.map((x) => ({ x, s: nameScore(c.dish, x.title) })).sort((p, q) => q.s - p.s).find((p) => p.s >= 0.6)?.x;
          if (!cand) throw new Error(`"${c.dish}" is not part of this vote. Dishes: ${v.candidates.map((x) => x.title).join(', ')}`);
          return { candidate_id: cand.id, value: (c.choice === 'no' ? -1 : c.choice === 'yes' ? 1 : 2) as -1 | 1 | 2 };
        });
        return text(slimVote(await castBallots(v.id, voter, ballots, me)));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  s.registerTool(
    'finish_food_vote',
    {
      title: 'Close a food vote / put the winner into the plan',
      description:
        'Close a vote early (reveals the result) and optionally put dishes into the week plan: by default the dishes everyone wants, else the one with the most yes votes. A one-day vote plans on that day; a week vote fills the free evenings in its range (days marked away / eating out are skipped).',
      inputSchema: {
        vote_id: z.number().int().positive().optional(),
        put_into_plan: z.boolean().default(true),
        dishes: z.array(z.string()).optional().describe('which dishes to plan (titles); default the matches'),
        day: z.string().regex(DAY).optional().describe('only with one dish: plan on this day'),
      },
      annotations: RW,
    },
    async (a) => {
      try {
        const v = findVote(a.vote_id);
        if (!v) return fail('No open vote.');
        let out = await closeVote(v.id, actor());
        let placed: unknown = [];
        if (a.put_into_plan) {
          const ids = a.dishes?.map((d) => out.candidates.find((c) => c.title.toLowerCase() === d.toLowerCase())?.id).filter((x): x is number => Boolean(x));
          const res = applyVote(v.id, { candidate_ids: ids?.length ? ids : null, day: a.day ?? null }, actor());
          placed = res.placed;
          out = res.vote!;
        }
        return text({ ...slimVote(out), placed });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  // ------------------------------------------------------------ templates & rotation

  s.registerTool(
    'plan_rotation',
    {
      title: 'Plan templates and rotation',
      description:
        'Saved plan weeks ("Herbst-Rotation A") with their dishes per weekday (0 = Monday … 6 = Sunday), the rotation (order of template weeks, which template the next weeks use, auto-fill on/off, avoid dishes cooked within N days) and days marked away / eating out in the next 4 weeks.',
      inputSchema: {},
      annotations: RO,
    },
    async () =>
      text({
        templates: listTemplates().map((t) => ({ id: t.id, name: t.name, items: t.items.map((i) => ({ weekday: i.weekday, slot: i.slot, title: i.title, recipe_id: i.recipe_id, servings: i.servings })) })),
        rotation: rotationView(),
        marked_days: dayMarks(localDay(0), localDay(28)),
      }),
  );

  s.registerTool(
    'save_plan_template',
    {
      title: 'Save a plan template',
      description:
        'Save a week as a reusable plan template. Either copy the 7 planned days starting at from_day ("save this week as Herbst-Rotation A"), or pass items (weekday 0 = Monday … 6 = Sunday, dish = recipe title/id or free text). Passing template_id replaces that template.',
      inputSchema: {
        name: z.string().min(1).max(80),
        from_day: z.string().regex(DAY).optional(),
        template_id: z.number().int().positive().optional(),
        items: z
          .array(z.object({ weekday: z.number().int().min(0).max(6), dish: z.string().min(1).max(120), slot: z.enum(['abend', 'mittag']).optional(), servings: z.number().int().min(1).max(60).optional() }))
          .max(30)
          .optional(),
      },
      annotations: RW,
    },
    async (a) => {
      try {
        if (a.items?.length) {
          const items = a.items.map((i) => {
            const r = resolveRecipe(i.dish);
            return { weekday: i.weekday, slot: i.slot ?? 'abend', recipe_id: r?.id ?? null, title: r?.title ?? i.dish, note: null, servings: i.servings ?? null };
          });
          return text(saveTemplate({ id: a.template_id, name: a.name, items }, actorName));
        }
        return text(saveWeekAsTemplate({ name: a.name, from: a.from_day ?? localDay(0), template_id: a.template_id }, actorName));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  s.registerTool(
    'set_plan_rotation',
    {
      title: 'Set up the plan rotation',
      description:
        'Define the rotation: 1–6 template names/ids in order (week A, B, …), which of them next week uses (0-based), whether the coming week is filled automatically once a week (quiet notification), and how many days a dish must not repeat.',
      inputSchema: {
        templates: z.array(z.union([z.string(), z.number()])).max(6).optional(),
        next_week_uses: z.number().int().min(0).max(5).optional(),
        auto: z.boolean().optional(),
        avoid_days: z.number().int().min(0).max(60).optional(),
      },
      annotations: RW,
    },
    async (a) => {
      try {
        const all = listTemplates();
        const ids = a.templates?.map((x) => {
          const hit = typeof x === 'number' ? all.find((t) => t.id === x) : all.find((t) => t.name.toLowerCase() === x.toLowerCase()) ?? all.find((t) => nameScore(x, t.name) >= 0.7);
          if (!hit) throw new Error(`Unknown template "${x}". Templates: ${all.map((t) => t.name).join(', ') || 'none yet'}`);
          return hit.id;
        });
        return text(saveRotation({ template_ids: ids, next_index: a.next_week_uses ?? null, auto: a.auto, avoid_days: a.avoid_days }));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  s.registerTool(
    'apply_plan_rotation',
    {
      title: 'Fill upcoming weeks from the rotation',
      description:
        'Fill the plan from the rotation (or from one template with template_id) for 1–6 weeks starting at from_day (default today). Never overwrites: filled slots, past days and days marked away / eating out are skipped; a dish cooked or planned recently is swapped for a fitting suggestion.',
      inputSchema: {
        from_day: z.string().regex(DAY).optional(),
        weeks: z.number().int().min(1).max(6).optional(),
        template_id: z.number().int().positive().optional(),
      },
      annotations: RW,
    },
    async (a) => {
      try {
        return text(a.template_id ? applyTemplate(a.template_id, a.from_day ?? localDay(0)) : applyRotation({ from: a.from_day, weeks: a.weeks ?? 2 }));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  s.registerTool(
    'mark_plan_day',
    {
      title: 'Mark a day as away / eating out',
      description: 'Mark a day so rotations, votes and auto-fill leave it free: kind "away" (not at home) or "out" (eating out); null removes the mark.',
      inputSchema: { day: z.string().regex(DAY), kind: z.enum(['away', 'out']).nullable(), note: z.string().max(120).optional() },
      annotations: RW,
    },
    async (a) => text({ mark: setDayMark(a.day, a.kind, a.note ?? null, actorName) }),
  );

  // ------------------------------------------------------------ servings

  s.registerTool(
    'set_plan_servings',
    {
      title: 'One-off servings for a planned meal',
      description:
        'Cook a planned meal for a different number of people just this once ("Bolognese for 6 instead of 4, the grandparents visit"). Identify the entry by entry_id, or by day + dish. The week shopping list, "used up" after cooking and the recipe opened from the plan scale with it. servings null = back to the usual amount. A permanent change belongs in the household recipe variant (set_recipe_variant).',
      inputSchema: {
        entry_id: z.number().int().positive().optional(),
        day: z.string().regex(DAY).optional(),
        dish: z.string().optional(),
        servings: z.number().int().min(1).max(60).nullable(),
      },
      annotations: RW,
    },
    async (a) => {
      try {
        let id = a.entry_id ?? null;
        if (!id) {
          const day = a.day ?? localDay(0);
          const entries = getPlan(day, day);
          const hit = a.dish ? entries.find((e) => e.title.toLowerCase() === a.dish!.toLowerCase()) ?? entries.find((e) => nameScore(a.dish!, e.title) >= 0.6) : entries.length === 1 ? entries[0] : null;
          if (!hit) return fail(entries.length ? `Which one? Planned on ${day}: ${entries.map((e) => `${e.title} (#${e.id})`).join(', ')}` : `Nothing planned on ${day}.`);
          id = hit.id;
        }
        const e = setEntryServings(id, a.servings);
        return text({ entry_id: e.id, day: e.day, title: e.title, servings: e.servings, usual_servings: e.base_servings, factor: Math.round(e.factor * 100) / 100, hint: e.base_servings ? undefined : 'The recipe has no servings set, so amounts cannot be scaled yet.' });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );
}
