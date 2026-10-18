/**
 * "Ich hab den Müll rausgebracht", "Spülmaschine ausgeräumt", "hab gestaubsaugt" without a model (18 Oct 2026):
 * the reader (assistant-parse.ts doneOf) gives what and the verb, this finds the open task it means.
 * One clear match → ticked off (with undo, like task_done); several → ask which; none → say so kindly.
 */
import { listCareTasks } from './care.js';
import { localDay } from './catalog.js';
import { norm } from './text.js';

type Task = ReturnType<typeof listCareTasks>[number];

// bins and rubbish: "Müll rausgebracht" is the Biotonne, the Gelbe Sack or the Restmüll – whichever is open
const WASTE = ['muell', 'abfall', 'tonne', 'tonnen', 'sack', 'papier', 'altpapier', 'glas', 'altglas', 'trash', 'garbage', 'bin', 'bins', 'rubbish', 'recycling', 'waste'];
const STOP = new Set(['den', 'die', 'das', 'der', 'dem', 'des', 'mal', 'noch', 'schon', 'auch', 'jetzt', 'ein', 'eine', 'einen', 'unsere', 'unseren', 'unser', 'meine', 'meinen', 'the', 'a', 'an', 'my', 'our', 'all', 'alle', 'out', 'raus']);

// irregular participles → the stem the task name usually has ("Müll rausbringen", "Blumen gießen")
const IRREGULAR: Record<string, string> = { bracht: 'bring', gossen: 'giess', waschen: 'wasch', zogen: 'bezieh', macht: 'mach' };
const PREFIXES = ['zusammen', 'runter', 'raus', 'rein', 'weg', 'aus', 'ein', 'auf', 'zu', 'ab', 'an', 'um'];
const EN: Record<string, string[]> = {
  'took out': ['muell', 'tonne', 'raus'],
  'taken out': ['muell', 'tonne', 'raus'],
  emptied: ['ausraeum', 'leer'],
  unloaded: ['ausraeum'],
  vacuumed: ['saug'],
  hoovered: ['saug'],
  cleaned: ['putz'],
  mopped: ['wisch'],
  watered: ['giess'],
  fed: ['fuetter'],
  changed: ['wechsel'],
  washed: ['wasch'],
};

/** "ausgeräumt" → ["ausraeum", "raeum"], "rausgebracht" → ["rausbring", "bring"], "gestaubsaugt" → ["staubsaug", "saug"]. Pure. */
export function verbStems(verb: string): string[] {
  if (EN[verb]) return EN[verb];
  const v = norm(verb).replace(/\s+/g, '');
  if (['erledigt', 'gemacht', 'fertig', 'done', 'raus', 'draussen', 'sauber', 'leer'].includes(v)) return v === 'raus' || v === 'draussen' ? ['raus'] : [];
  const prefix = PREFIXES.find((p) => v.startsWith(p) && v.length > p.length + 3) ?? '';
  let rest = v.slice(prefix.length);
  if (rest.startsWith('ge')) rest = rest.slice(2);
  rest = IRREGULAR[rest] ?? rest.replace(/(?:et|t|en)$/, '');
  const out = [prefix + rest, rest].filter((x) => x.length >= 3);
  if (prefix === 'raus') out.push('raus'); // "Biotonne raus"
  if (rest.startsWith('staub')) out.push(rest.slice(5)); // staubsaug → saug
  if (rest === 'saug') out.push('staubsaug');
  return [...new Set(out)];
}

/** "ausgeräumt" → { particle: "aus", roots: ["raeum"] }; null for "erledigt", "raus", English (no verb to check). Pure. */
export function splitVerb(verb: string): { particle: string; roots: string[] } | null {
  if (EN[verb]) return null;
  const v = norm(verb).replace(/\s+/g, '');
  if (['erledigt', 'gemacht', 'saubergemacht', 'fertig', 'done', 'raus', 'draussen', 'sauber', 'leer'].includes(v)) return null;
  const particle = PREFIXES.find((p) => v.startsWith(p) && v.length > p.length + 3) ?? '';
  let rest = v.slice(particle.length);
  if (rest.startsWith('ge')) rest = rest.slice(2);
  rest = IRREGULAR[rest] ?? rest.replace(/(?:et|t|en)$/, '');
  const roots = [rest, ...(rest.startsWith('staub') ? [rest.slice(5)] : [])].filter((x) => x.length >= 3);
  return roots.length ? { particle, roots } : null;
}

/**
 * The task's own verbs: lower-case words ending like an infinitive ("Spülmaschine ausräumen", "Blumen gießen").
 * "Staubsaugen" or "Biotonne raus" have none – then any verb may tick them off.
 */
const taskVerbs = (taskName: string) =>
  taskName
    .split(/\s+/)
    .filter((w) => /^[a-zäöüß]/.test(w) && /(?:en|ern|eln)$/.test(w) && w.length >= 5)
    .map((w) => norm(w).replace(/\s+/g, ''))
    .filter((w) => !STOP.has(w));

/**
 * Does what was said fit the task's verb? Stem and particle both: "ausgeräumt" never ticks off "einräumen", "aufgeräumt"
 * never "ausräumen" (18 Oct 2026). A task without a verb, or a word without one ("erledigt"), always fits. Pure.
 */
export function verbFits(taskName: string, verb: string): boolean {
  const said = splitVerb(verb);
  const vs = taskVerbs(taskName);
  if (!said || !vs.length) return true;
  return vs.some((w) =>
    said.roots.some((root) => {
      const at = w.indexOf(root);
      if (at < 0) return false;
      const before = w.slice(0, at);
      const particle = PREFIXES.includes(before) ? before : '';
      return !said.particle || !particle || particle === said.particle;
    }),
  );
}

const words = (s: string) => norm(s).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
const isWaste = (w: string) => WASTE.some((x) => w === x || w.endsWith(x) || (x.length >= 4 && w.startsWith(x)));

/**
 * How well a task fits: `obj` 2 per object word in the name (1 when only part of a word or only "it's a bin"),
 * `verb` 1 when the verb fits exactly ("ausräumen"), 0.5 when only its root does ("einräumen"). Pure.
 */
export function doneScore(taskName: string, what: string, verb: string): { obj: number; verb: number; total: number } {
  // the verb has to fit before anything else counts – being due only decides between fitting tasks
  if (!verbFits(taskName, verb)) return { obj: 0, verb: 0, total: 0 };
  const name = norm(taskName);
  const tw = name.split(' ').filter(Boolean);
  const ow = words(what);
  let obj = 0;
  for (const w of ow) {
    if (tw.some((x) => x === w || x.includes(w))) obj += 2;
    else if (tw.some((x) => (x.length >= 4 && w.includes(x)) || (x.length >= 5 && w.length >= 5 && x.slice(0, 5) === w.slice(0, 5)))) obj += 1.5;
    else if (isWaste(w) && tw.some(isWaste)) obj += 1;
  }
  const stems = verbStems(verb);
  const flat = name.replace(/\s+/g, '');
  const v = stems.length && flat.includes(stems[0]) ? 1 : stems.slice(1).some((st) => flat.includes(st)) ? 0.5 : 0;
  if (ow.length) return obj ? { obj, verb: v, total: obj + v } : { obj: 0, verb: 0, total: 0 };
  // no object ("hab gestaubsaugt"): the verb has to fit; "rausgebracht" alone means the bins
  if (v) return { obj: 0, verb: v, total: v };
  return stems.includes('rausbring') && tw.some(isWaste) ? { obj: 0, verb: 0.5, total: 0.5 } : { obj: 0, verb: 0, total: 0 };
}

const DUE = new Set(['overdue', 'today', 'soon']);

export type DoneMatch = { kind: 'one'; task: Task } | { kind: 'already'; task: Task } | { kind: 'several'; tasks: Task[] } | { kind: 'none' };

/**
 * Which open task "Müll rausgebracht" means. Private tasks of others and care tasks for someone never come in (outside).
 * Close fits (object at most one step behind the best) – the due ones first, then the best fit; a tie asks.
 */
export function matchDone(what: string, verb: string, tasks: Task[] = listCareTasks({ outside: true })): DoneMatch {
  const scored = tasks.map((task) => ({ task, ...doneScore(task.name, what, verb) })).filter((x) => x.total > 0);
  if (!scored.length) return { kind: 'none' };
  const bestObj = Math.max(...scored.map((x) => x.obj));
  let top = scored.filter((x) => x.obj >= bestObj - 1);
  const today = localDay(0);
  const open = top.filter((x) => x.task.last_done !== today);
  if (!open.length) return { kind: 'already', task: top.sort((a, b) => b.total - a.total)[0].task };
  top = open;
  const due = top.filter((x) => DUE.has(x.task.state));
  if (due.length) top = due;
  const best = Math.max(...top.map((x) => x.total));
  top = top.filter((x) => x.total === best);
  if (top.length === 1) return { kind: 'one', task: top[0].task };
  return { kind: 'several', tasks: top.slice(0, 4).map((x) => x.task) };
}
