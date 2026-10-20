/** Types for the tests (test/glossary.test.ts, test/functions-registry.test.ts) – help.mjs itself stays plain JS. */
export interface HelpArticle {
  slug: string;
  pair?: string;
  group: string;
  title: string;
  desc?: string;
  sections?: [string, string][];
  related?: string[];
  [key: string]: unknown;
}
export interface HelpLang {
  lang: string;
  articles: HelpArticle[];
  [key: string]: unknown;
}
export function helpCopy(k: { code: (...a: string[]) => string; CLOUD: string; GH: string; MAIL: string; APP_DE: string; APP_EN: string }): { de: HelpLang; en: HelpLang };
