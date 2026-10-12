/**
 * "Daraus könnt ihr heute kochen": recipes that work with what is at home now, or with one or two things missing.
 *
 * "At home" is the pantry (stock) plus what the purchase rhythm says is probably still there (bought within its
 * usual interval) – households that never keep stock still get ideas. Dishes with an allergen for anyone in the
 * household are left out here, on the server, without saying who or what (people-signals.ts).
 */
import { t } from '../i18n.js';
import { suggest, type Suggestion } from './recipes.js';
import { redactForAssistant } from './people-signals.js';
import { rhythmList } from './rhythm.js';

export interface CookIdea {
  recipeId: number;
  title: string;
  image: string | null;
  timeMin: number | null;
  thermomix: boolean;
  /** ingredients still to buy (at most 2) */
  missing: { text: string; productId: number | null }[];
  /** ingredients counted as "probably at home" from the purchase rhythm (no stock booked) */
  probablyHave: string[];
  /** uses something that should be eaten soon */
  usesExpiring: string[];
  why: string[];
}

/** Products bought within their usual interval – probably still at home. */
export function probablyAtHome(list = rhythmList()): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of list) if (r.dueInDays > 0) out.set(r.productId, r.name);
  return out;
}

function toIdea(s: Suggestion, likely: Map<number, string>): CookIdea {
  const probablyHave: string[] = [];
  const missing: CookIdea['missing'] = [];
  for (const m of s.missingItems) {
    if (m.product_id && likely.has(m.product_id)) probablyHave.push(likely.get(m.product_id)!);
    else missing.push({ text: m.text, productId: m.product_id });
  }
  return {
    recipeId: s.recipe.id,
    title: s.recipe.title,
    image: s.recipe.image_path ?? null,
    timeMin: s.time_min ?? s.recipe.time_min ?? null,
    thermomix: Boolean(s.recipe.thermomix),
    missing,
    probablyHave,
    usesExpiring: s.usesExpiring,
    why: [],
  };
}

/** Ready now and almost ready (1–2 missing), allergy-safe, best first. */
export function cookIdeas(opts: { limit?: number; thermomix?: boolean | null; likely?: Map<number, string> } = {}) {
  const limit = opts.limit ?? 6;
  const likely = opts.likely ?? probablyAtHome();
  const red = redactForAssistant(false);
  const all = suggest({ thermomix: opts.thermomix ?? null, limit: 200 })
    // never suggest a dish someone in the household must not eat – and never say why
    .filter((s) => !s.warnings?.length);
  const ideas = all.map((s) => {
    const idea = toIdea(s, likely);
    // "missing: …" is shown as data; the rest of the reasons without names or health details
    const missingLine = t('missing: {list}', { list: s.missing.slice(0, 3).join(', ') });
    idea.why = red.reasons(s.reasons.filter((r) => r !== missingLine)).slice(0, 3);
    return { idea, score: s.score + idea.probablyHave.length * 0.05 };
  });
  const ready = ideas.filter((x) => x.idea.missing.length === 0).sort((a, b) => b.score - a.score);
  const almost = ideas.filter((x) => x.idea.missing.length > 0 && x.idea.missing.length <= 2).sort((a, b) => a.idea.missing.length - b.idea.missing.length || b.score - a.score);
  return {
    ready: ready.slice(0, limit).map((x) => x.idea),
    almost: almost.slice(0, limit).map((x) => x.idea),
    probablyAtHome: [...likely.values()].slice(0, 30),
  };
}

/** One idea for today's card: planned first is handled by the caller; else the best ready, else the best almost. */
export function cookToday(likely?: Map<number, string>) {
  const ideas = cookIdeas({ limit: 1, likely });
  const idea = ideas.ready[0] ?? ideas.almost[0] ?? null;
  return idea ? { ...idea, kind: ideas.ready[0] ? ('ready' as const) : ('almost' as const) } : null;
}
