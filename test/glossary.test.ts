import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { de as webDe } from '../web/src/locales/de/index';
import { helpCopy } from '../site/src/help.mjs';

/**
 * Glossary (docs/glossary.md, UX audit 2026-10 Paket D): one word per thing, in German and English. Old words must
 * not come back in the texts people read – web (locales), iPhone (Localizable.xcstrings), server (locales, inline
 * German), help pages (site/src/help.mjs). Run `npx vitest run test/glossary.test.ts`; the failure names the text.
 * Exceptions are listed in ALLOWED (with the reason) – keep it short.
 */
const ROOT = path.join(__dirname, '..');

/** German words that are gone (left) – the right word in the comment */
const DE_BANNED: [RegExp, string][] = [
  [/\bBestand(s|es)?\b/, 'Vorrat'],
  [/Produkte im Haus/, 'Vorrat'],
  [/Was ToHuus sich merkt|Haushaltsgedächtnis|Gedächtnis/, 'Haushaltswissen'],
  [/[Ee]ins nach dem anderen|Eine Sache nach der anderen/, 'Nur eins'],
  [/Pflege & Hausinfo/, 'Hausinfo'],
  [/Geldliste/, 'Abrechnung'],
  [/Drucker & Bons/, 'Drucker'],
  [/Benachrichtigung/, 'Mitteilung'],
  [/Zugänge? & KI|Mit oder ohne KI/, 'KI / KI-Assistenten & Zugänge'],
  [/Plan & Speicher/, 'Abo & Speicher'],
  [/Einfach sprechen|„Sprechen“/, 'Assistent'],
  [/Was soll verfolgt werden/, 'Vorrat: was verfolgen?'],
  [/\bDinge?\b/, 'Sache/Sachen'],
  [/Einstellungen › Mein Konto|„Mein Konto“|unter Mein Konto/, 'Einstellungen › Ich › …'],
  [/› Mitglieder\b|unter Mitglieder\b/, 'Einstellungen › Haushalt › Wer wohnt hier?'],
  // old settings paths (web/src/settings/registry.ts has the six pages)
  [/Einstellungen [›→] (Abo\b(?! &)|Benachrichtigungen|Zugang|Zugänge|Orte\b|Rezepte\b|Daten(?!,| &)|Displays\b|Home Assistant|Drucker\b|Verbindungen(?! &)|Mitglieder|Tour starten)/, 'neuer Einstellungs-Pfad'],
  [/Einstellungen › Haushalt › (Einladen|Region(?! &)|Darstellung)/, 'neuer Einstellungs-Pfad'],
];

/** English words that are gone */
const EN_BANNED: [RegExp, string][] = [
  [/\bTreats\b/, 'Bring me something'],
  [/What ToHuus remembers|Your household memory/, 'Household knowledge'],
  [/One thing at a time|\bOne at a time\b/, 'Just one'],
  [/With or without AI|Access & AI/, 'AI / AI assistants & access'],
  [/Printers & tickets/, 'Printers'],
  [/\bmoney lists?\b/i, 'split'],
  [/“Sprechen”/, 'the assistant'],
  [
    /Settings [›→] (Access\b|With or without AI|Subscription\b|My account|Members|Printers|Plan & storage|Plan\b|Home Assistant|Displays\b|Notifications(?! &)|Data(?!,)|Places|Recipes\b|Connections(?! &)|Your bar|Start the tour)/,
    'new settings path',
  ],
  [/Settings › Household › (Invite|Region(?! &)|Appearance|“What should be tracked\?”)/, 'new settings path'],
  [/More › (QR labels|With or without AI|Remembers)/, 'new path'],
];

/** Texts that may keep an old word, with the reason */
const ALLOWED: RegExp[] = [
  // other apps' menus (Nextcloud, Element, Gmail, Apple) – not ours
  /Nextcloud: Settings|In Element: Settings|Gmail: Settings|Outlook: Settings|iCloud Mail \(web\): Settings|Settings › Apple ID|Settings › Apps ›|Einstellungen › Apple-ID|Einstellungen › Apps ›/,
  /Claude: Settings|In Claude: Settings|ChatGPT: Settings|Claude: Einstellungen|In Claude: Einstellungen|ChatGPT: Einstellungen/,
];

type Text = { where: string; text: string };

function walk(dir: string, ext: RegExp, skip: (p: string) => boolean = () => false): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (skip(p)) return [];
    if (e.isDirectory()) return walk(p, ext, skip);
    return ext.test(e.name) ? [p] : [];
  });
}

async function serverLocales(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of walk(path.join(ROOT, 'server', 'locales'), /\.ts$/)) {
    const m = (await import(f)) as Record<string, unknown>;
    for (const v of Object.values(m)) if (v && typeof v === 'object') Object.assign(out, v as Record<string, string>);
  }
  return out;
}

function xcstrings(): { en: Text[]; de: Text[] } {
  const p = path.join(ROOT, 'ios', 'ToHuus', 'Resources', 'Localizable.xcstrings');
  const d = JSON.parse(fs.readFileSync(p, 'utf8')) as { strings: Record<string, { localizations?: Record<string, { stringUnit?: { value: string } }> }> };
  const en: Text[] = [];
  const de: Text[] = [];
  for (const [k, e] of Object.entries(d.strings)) {
    en.push({ where: `xcstrings key ${k.slice(0, 60)}`, text: k });
    const v = e.localizations?.de?.stringUnit?.value;
    if (v) de.push({ where: `xcstrings de ${k.slice(0, 60)}`, text: v });
  }
  return { en, de };
}

function helpTexts(): { en: Text[]; de: Text[] } {
  const kit = { code: () => '', CLOUD: 'https://cloud.example', GH: 'https://github.example', MAIL: 'mail@example.org', APP_DE: 'https://apps.example', APP_EN: 'https://apps.example' };
  const h = helpCopy(kit) as { de: unknown; en: unknown };
  const flat = (o: unknown, where: string, out: Text[]) => {
    if (typeof o === 'string') out.push({ where, text: o.replace(/<[^>]+>/g, '') });
    else if (Array.isArray(o)) o.forEach((x, i) => flat(x, `${where}[${i}]`, out));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (k !== 'slug' && k !== 'pair' && k !== 'related') flat(v, `${where}.${k}`, out);
  };
  const de: Text[] = [];
  const en: Text[] = [];
  flat(h.de, 'help.de', de);
  flat(h.en, 'help.en', en);
  return { de, en };
}

/** German literals in server code (assistant answers, mails written in German) */
function serverInlineGerman(): Text[] {
  const out: Text[] = [];
  for (const f of walk(path.join(ROOT, 'server'), /\.ts$/, (p) => p.includes(`${path.sep}locales`))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) if (/[äöüß„“]/.test(m[2])) out.push({ where: path.relative(ROOT, f), text: m[2] });
  }
  return out;
}

function violations(texts: Text[], banned: [RegExp, string][]): string[] {
  const out: string[] = [];
  for (const { where, text } of texts) {
    if (ALLOWED.some((a) => a.test(text))) continue;
    for (const [rx, instead] of banned) if (rx.test(text)) out.push(`${where}: „${text.slice(0, 120)}“ → ${instead}`);
  }
  return out;
}

describe('glossary (docs/glossary.md)', () => {
  it('German texts use the glossary words', async () => {
    const server = await serverLocales();
    const texts: Text[] = [
      ...Object.entries(webDe).map(([k, v]) => ({ where: `web de ${k.slice(0, 60)}`, text: v })),
      ...Object.entries(server).map(([k, v]) => ({ where: `server de ${k.slice(0, 60)}`, text: v })),
      ...xcstrings().de,
      ...helpTexts().de,
      ...serverInlineGerman(),
    ];
    expect(texts.length).toBeGreaterThan(3000);
    expect(violations(texts, DE_BANNED)).toEqual([]);
  });

  it('English texts use the glossary words', async () => {
    const server = await serverLocales();
    const texts: Text[] = [
      ...Object.keys(webDe).map((k) => ({ where: 'web en', text: k })),
      ...Object.keys(server).map((k) => ({ where: 'server en', text: k })),
      ...xcstrings().en,
      ...helpTexts().en,
    ];
    expect(violations(texts, EN_BANNED)).toEqual([]);
  });

  it('the tab bar names: Kochen is “Cooking”, the purchase rhythm on Heute is “Needed again soon”', () => {
    const nav = fs.readFileSync(path.join(ROOT, 'web', 'src', 'nav.tsx'), 'utf8');
    expect(nav).toContain("label: () => t('Cooking')");
    expect(nav).not.toMatch(/t\('Cook'\)/);
    expect(webDe['Needed again soon']).toBe('Bald wieder nötig');
    expect(fs.readFileSync(path.join(ROOT, 'web', 'src', 'pages', 'Today.tsx'), 'utf8')).toContain("t('Needed again soon')");
    expect(fs.readFileSync(path.join(ROOT, 'ios', 'ToHuus', 'Features', 'Today', 'TodayExtras.swift'), 'utf8')).toContain('case .rhythm: return L("Needed again soon")');
    expect(webDe['Just one']).toBe('Nur eins');
    expect(webDe['Household knowledge']).toBe('Haushaltswissen');
    expect(webDe['Knowledge']).toBe('Wissen');
  });
});
