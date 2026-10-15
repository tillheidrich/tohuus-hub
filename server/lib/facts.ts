/**
 * "Gut zu wissen" (area: explain): short, sourced facts around the app's topics – food waste, best-before vs use-by,
 * shopping lists, mental load, tasks, ADHD-friendly habits, guest Wi-Fi, stockpiling, unit prices, food prices – and what ToHuus does about each.
 * The data is server/data/facts.json (one place for web and iOS); every number there has a primary source with
 * link and retrieval date (docs/facts.md). Nothing household-specific, nothing personal.
 */
import FACTS from '../data/facts.json';
import { config } from '../config.js';

export type FactLang = 'de' | 'en';

interface RawFact {
  id: string;
  topic: string;
  title: Record<FactLang, string>;
  text: Record<FactLang, string>;
  tohuus: Record<FactLang, string>;
  sources: { title: string; publisher: string; url: string; retrieved: string; note?: string }[];
}

export const TOPICS = ['food-waste', 'dates', 'shopping-list', 'mental-load', 'tasks', 'focus', 'house-info', 'stockpiling', 'unit-prices', 'prices'] as const;

export function facts(lang: FactLang = 'de') {
  return {
    version: FACTS.version,
    retrieved: FACTS.retrieved,
    help: `${config.siteUrl}/hilfe/gut-zu-wissen.html`,
    facts: (FACTS.facts as RawFact[]).map((f) => ({
      id: f.id,
      topic: f.topic,
      title: f.title[lang] ?? f.title.de,
      text: f.text[lang] ?? f.text.de,
      tohuus: f.tohuus[lang] ?? f.tohuus.de,
      sources: f.sources,
    })),
  };
}

export const rawFacts = () => FACTS.facts as RawFact[];
