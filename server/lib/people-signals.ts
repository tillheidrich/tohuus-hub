/**
 * People → meal suggestions (area: people): per-person ratings, likes/dislikes and allergies, read gently
 * by `suggest()` (what-to-eat, autofill, "tonight"). Only depends on db/text/i18n so recipes.ts can import it.
 *
 *  - ratings: the latest rating per person, mean mapped to −1…+1 → at most ±0.12 on the score
 *  - dislikes: −0.06 per person who dislikes an ingredient (max −0.15), likes +0.03 (max +0.06)
 *  - allergies: a warning on the dish and −1 on the score (autofill never plans it)
 */
import { db, getSetting } from '../db.js';
import { t } from '../i18n.js';
import { norm } from './text.js';
import './people-policy.js';
import { healthScopeAllows } from './ai-policy.js';

export interface PersonPrefs {
  likes: string[];
  dislikes: string[];
  allergies: string[];
}

const parseList = (s: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()) : [];
  } catch {
    return [];
  }
};

export function prefsOf(person: string): PersonPrefs {
  const r = db.prepare('SELECT likes, dislikes, allergies FROM people_prefs WHERE person = ?').get(person) as { likes: string; dislikes: string; allergies: string } | undefined;
  return { likes: parseList(r?.likes), dislikes: parseList(r?.dislikes), allergies: parseList(r?.allergies) };
}

// ---------------------------------------------------------------- allergens

/**
 * Common allergen groups (DE / EN / SV). Typing "Nüsse", "nuts" or "Laktose" expands to the usual ingredients;
 * anything else is matched as typed. Over-warning is fine here, missing one is not.
 */
const GROUPS: { names: string[]; terms: string[]; except?: string[] }[] = [
  {
    names: ['nuss', 'nusse', 'nusse', 'nut', 'nuts', 'baumnuss', 'baumnusse', 'schalenfruchte', 'tree nuts', 'not', 'notter'],
    terms: ['nuss', 'nusse', 'nut', 'nuts', 'haselnuss', 'walnuss', 'mandel', 'mandeln', 'almond', 'almonds', 'cashew', 'pistazie', 'pistachio', 'pecan', 'macadamia', 'paranuss', 'hazelnut', 'walnut', 'not', 'notter', 'mandel', 'mandlar', 'nutella', 'marzipan'],
  },
  { names: ['erdnuss', 'erdnusse', 'peanut', 'peanuts', 'jordnot', 'jordnotter'], terms: ['erdnuss', 'erdnusse', 'erdnussbutter', 'peanut', 'peanuts', 'jordnot', 'jordnotter'] },
  {
    names: ['milch', 'laktose', 'lactose', 'milk', 'dairy', 'milchprodukte', 'mjolk', 'laktos', 'kuhmilch'],
    terms: ['milch', 'milk', 'sahne', 'cream', 'kase', 'cheese', 'butter', 'joghurt', 'yoghurt', 'yogurt', 'quark', 'mjolk', 'gradde', 'ost', 'smor', 'mozzarella', 'parmesan', 'feta', 'schmand', 'creme', 'frischkase', 'mascarpone', 'ricotta', 'buttermilch', 'skyr', 'kvarg', 'filmjolk'],
    // plant drinks and nut butters are not dairy
    except: ['kokosmilch', 'hafermilch', 'sojamilch', 'mandelmilch', 'reismilch', 'kokos', 'coconut', 'oat', 'soy', 'almond', 'havremjolk', 'kokosmjolk', 'sojamjolk', 'erdnussbutter', 'kakaobutter', 'vegan', 'vegane', 'veganer', 'veganem', 'pflanzlich', 'pflanzliche', 'plant', 'havre', 'kokosgradde'],
  },
  { names: ['ei', 'eier', 'egg', 'eggs', 'agg', 'hühnerei', 'huhnerei'], terms: ['ei', 'eier', 'egg', 'eggs', 'agg', 'eigelb', 'eiweiss', 'mayonnaise', 'mayo', 'aggula'] },
  {
    names: ['gluten', 'weizen', 'wheat', 'vete', 'zoliakie', 'celiac', 'gluten free'],
    terms: ['weizen', 'wheat', 'mehl', 'flour', 'nudel', 'nudeln', 'pasta', 'spaghetti', 'penne', 'brot', 'bread', 'dinkel', 'roggen', 'gerste', 'couscous', 'bulgur', 'vete', 'mjol', 'paniermehl', 'semmelbrosel', 'breadcrumbs', 'lasagne', 'tortellini', 'gnocchi', 'toast', 'brotchen', 'baguette', 'pizzateig', 'blatterteig'],
  },
  { names: ['fisch', 'fish', 'fisk'], terms: ['fisch', 'fish', 'lachs', 'salmon', 'thunfisch', 'tuna', 'kabeljau', 'cod', 'fisk', 'lax', 'seelachs', 'forelle', 'hering', 'sardelle', 'anchovy', 'anchovies'] },
  { names: ['krebstiere', 'meeresfruchte', 'shellfish', 'seafood', 'skaldjur'], terms: ['garnele', 'garnelen', 'shrimp', 'shrimps', 'krabbe', 'krabben', 'prawn', 'prawns', 'muschel', 'muscheln', 'scampi', 'rakor', 'hummer', 'lobster', 'mussels', 'tintenfisch', 'squid'] },
  { names: ['soja', 'soy', 'soya'], terms: ['soja', 'soy', 'soya', 'tofu', 'edamame', 'sojasosse', 'sojasauce'] },
  { names: ['sesam', 'sesame'], terms: ['sesam', 'sesame', 'tahini', 'tahin'] },
  { names: ['sellerie', 'celery', 'selleri'], terms: ['sellerie', 'celery', 'selleri', 'staudensellerie'] },
  { names: ['senf', 'mustard', 'senap'], terms: ['senf', 'mustard', 'senap'] },
];

const stem = (w: string) => w.replace(/(en|n|e|s|es|er)$/, '');
/** norm() spells umlauts ae/oe/ue – fold them to plain vowels so "Nüsse", "Nuesse" and "Nusse" are one word */
const fold = (s: string) => norm(s).replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');

export interface TermSet {
  terms: string[];
  /** words that make a line NOT count (coconut milk for a dairy allergy) */
  except: string[];
}

/** All search terms for one allergy / dislike as typed by a parent. */
export function expandTerm(term: string, groups = true): TermSet {
  const n = fold(term);
  if (!n) return { terms: [], except: [] };
  const out = new Set([n]);
  const except = new Set<string>();
  if (groups)
    for (const g of GROUPS)
      if (g.names.some((x) => fold(x) === n || fold(x) === stem(n))) {
        g.terms.forEach((x) => out.add(x));
        g.except?.forEach((x) => except.add(x));
      }
  return { terms: [...out], except: [...except] };
}

/** Does this ingredient line contain the term? Compound-aware (Hasel|nuss, Ei|gelb), plural-tolerant. */
export function lineHas(line: string, term: string): boolean {
  const tm = fold(term);
  if (!tm) return false;
  const words = tm.split(' ');
  const toks = fold(line).split(' ').filter(Boolean);
  if (words.length > 1) return ` ${toks.join(' ')} `.includes(` ${tm} `) || ` ${toks.map(stem).join(' ')} `.includes(` ${words.map(stem).join(' ')} `);
  return toks.some((tok) => {
    if (tok === tm || stem(tok) === stem(tm)) return true;
    if (tm.length < 4) return false;
    const st = stem(tm);
    return tok.startsWith(tm) || tok.endsWith(tm) || (st.length >= 4 && stem(tok).endsWith(st));
  });
}

/** The first matching ingredient for the term set, or null. */
export function firstHit(lines: string[], set: TermSet): string | null {
  for (const l of lines) {
    if (set.except.length && set.except.some((x) => lineHas(l, x))) continue;
    for (const tm of set.terms) if (lineHas(l, tm)) return l;
  }
  return null;
}

// ---------------------------------------------------------------- household snapshot

export interface PersonLite {
  key: string;
  name: string;
}

/** Everybody in the household (members, permanent guests, children) with their likes/dislikes/allergies. */
function peopleWithPrefs(): (PersonLite & PersonPrefs)[] {
  const users = db.prepare('SELECT id, name FROM users ORDER BY id').all() as { id: number; name: string }[];
  let kids: { id: number; name: string }[] = [];
  try {
    kids = db.prepare('SELECT id, name FROM kid_profiles ORDER BY id').all() as { id: number; name: string }[];
  } catch {
    /* kid mode not loaded (tests) */
  }
  const prefs = new Map((db.prepare('SELECT person, likes, dislikes, allergies FROM people_prefs').all() as any[]).map((r) => [r.person, r]));
  return [...users.map((u) => ({ key: `u${u.id}`, name: u.name })), ...kids.map((k) => ({ key: `k${k.id}`, name: k.name }))].map((p) => {
    const r = prefs.get(p.key);
    return { ...p, likes: parseList(r?.likes), dislikes: parseList(r?.dislikes), allergies: parseList(r?.allergies) };
  });
}

export interface RecipeSignal {
  boost: number;
  reasons: string[];
  warnings: string[];
}

export interface PeopleSignals {
  forRecipe(recipeId: number, ingredientLines: string[]): RecipeSignal;
}

const NONE: RecipeSignal = { boost: 0, reasons: [], warnings: [] };

/** Computed once per suggest() run. Never throws – suggestions must work without this area. */
export function peopleSignals(): PeopleSignals {
  try {
    const people = peopleWithPrefs();
    const names = new Map(people.map((p) => [p.key, p.name]));
    const ratings = new Map<number, { person: string; value: number }[]>();
    for (const r of db.prepare('SELECT recipe_id, person, value FROM recipe_ratings').all() as { recipe_id: number; person: string; value: number }[]) {
      if (!names.has(r.person)) continue;
      const arr = ratings.get(r.recipe_id) ?? [];
      arr.push({ person: r.person, value: r.value });
      ratings.set(r.recipe_id, arr);
    }
    const prepared = people.map((p) => ({
      ...p,
      allergyTerms: p.allergies.map((a) => ({ label: a, set: expandTerm(a, true) })),
      dislikeTerms: p.dislikes.map((d) => ({ label: d, set: expandTerm(d, false) })),
      likeTerms: p.likes.map((d) => ({ label: d, set: expandTerm(d, false) })),
    }));
    if (!ratings.size && !prepared.some((p) => p.allergies.length || p.dislikes.length || p.likes.length)) return { forRecipe: () => NONE };
    return {
      forRecipe(recipeId, lines) {
        let boost = 0;
        const reasons: string[] = [];
        const warnings: string[] = [];
        const rs = ratings.get(recipeId) ?? [];
        if (rs.length) {
          const mean = rs.reduce((s, r) => s + (r.value - 3) / 2, 0) / rs.length;
          boost += 0.12 * mean;
          const loved = rs.filter((r) => r.value >= 5).map((r) => names.get(r.person)!);
          if (rs.length >= 2 && rs.every((r) => r.value >= 4)) reasons.push(t('everyone liked it'));
          else if (loved.length) reasons.push(t('loved by {names}', { names: loved.slice(0, 2).join(' & ') }));
        }
        let dis = 0;
        let like = 0;
        for (const p of prepared) {
          for (const a of p.allergyTerms) {
            if (firstHit(lines, a.set)) {
              warnings.push(t('{name} is allergic: {allergen}', { name: p.name, allergen: a.label }));
              break;
            }
          }
          const d = p.dislikeTerms.find((x) => firstHit(lines, x.set));
          if (d) {
            dis++;
            if (dis === 1) reasons.push(t('{name} doesn’t like {item}', { name: p.name, item: d.label }));
          }
          if (p.likeTerms.some((x) => firstHit(lines, x.set))) like++;
        }
        boost -= Math.min(0.15, dis * 0.06);
        boost += Math.min(0.06, like * 0.03);
        if (warnings.length) boost -= 1;
        return { boost: Math.round(boost * 100) / 100, reasons, warnings };
      },
    };
  } catch (e) {
    console.warn('[people] signals', (e as Error).message);
    return { forRecipe: () => NONE };
  }
}

// ---------------------------------------------------------------- what an assistant may see (Art. 9 GDPR)

/**
 * Health data (allergies, children's birth years, anything flagged sensitive) only goes to a language model – the
 * built-in assistant or an MCP client – when the household switched on `ai.health_share` (default off).
 */
export function healthShareAllowed(): boolean {
  // an MCP connection without the scope "Allergien und Kinderdaten" never gets them (oauth.ts)
  if (!healthScopeAllows()) return false;
  return getSetting<boolean>('ai.health_share', false) === true;
}

export interface AssistantRedactor {
  /** the household agreed to share health data with the assistant */
  consent: boolean;
  /** neutral wording for per-person suggestion reasons (allergy warnings, "loved by Mika", "Ben doesn't like …") */
  text(s: string): string;
  /** the same for every string inside a JSON-like value */
  deep<T>(v: T): T;
  /** a person for the assistant: allergies and birth year only with consent */
  person<P extends { birth_year?: number | null; prefs?: PersonPrefs | null; allergies?: string[] }>(p: P): P;
  /** suggestion reasons without names or health details */
  reasons(reasons: string[], warnings?: string[]): string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** template "{name} is allergic: {allergen}" → a regex that finds it inside longer text (also inside JSON strings) */
function templateRe(tpl: string) {
  const body = esc(tpl).replace(/\\\{(\w+)\\\}/g, '[^"·\\n]+?');
  return new RegExp(`(?<=^|["\\n]|· |, )${body}(?=$|["\\n]| · |, )`, 'g');
}

/**
 * The filter every assistant surface uses (MCP tools, the in-app assistant's context). Per-person reasons are
 * replaced by neutral ones in every case – names of children and who-likes-what stay at home; allergy warnings
 * become "not suitable for at least one person" unless the household consented.
 */
export function redactForAssistant(consent = healthShareAllowed()): AssistantRedactor {
  const both = (en: string) => [...new Set([en, t(en)])];
  const allergyRes = both('{name} is allergic: {allergen}').map(templateRe);
  const lovedRes = both('loved by {names}').map(templateRe);
  const dislikeRes = both('{name} doesn’t like {item}').map(templateRe);
  const unsuitable = t('not suitable for at least one person');
  const text = (s: string) => {
    let out = s;
    if (!consent) for (const re of allergyRes) out = out.replace(re, unsuitable);
    for (const re of lovedRes) out = out.replace(re, t('a favourite at home'));
    for (const re of dislikeRes) out = out.replace(re, t('not everyone likes it'));
    return out;
  };
  const deep = <T,>(v: T): T => {
    if (typeof v === 'string') return text(v) as T;
    if (Array.isArray(v)) return v.map((x) => deep(x)) as T;
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) as T;
    return v;
  };
  return {
    consent,
    text,
    deep,
    person(p) {
      if (consent) return p;
      const { birth_year: _b, allergies: _a, ...rest } = p as any;
      if (rest.prefs) rest.prefs = { ...rest.prefs, allergies: [] };
      return rest;
    },
    reasons(reasons, warnings = []) {
      const warn = new Set(warnings);
      const out = reasons.filter((r) => consent || !warn.has(r)).map(text);
      if (!consent && warnings.length && !out.includes(unsuitable)) out.unshift(unsuitable);
      return [...new Set(out)];
    },
  };
}
