/**
 * Voice commands for the babysitter / house-sitter page ("Where is what?"): which lights, blinds, scenes … the
 * sitter can switch by voice, with example phrases for the household's assistant (Alexa, Google, Siri, HA Assist).
 *
 * The list comes from Home Assistant (entities exposed to the assistant, reported by the integration) or is picked /
 * typed in by hand – it works without Home Assistant, too. A hard safety filter keeps out everything a sitter must
 * not control or see: locks, alarms, cameras, people, trackers, garage doors and gates – also when added by hand.
 * Scripts only appear when an admin adds them explicitly. Shown per guest link only when switched on for that link.
 */
import { db, getSetting, migrate, setSetting } from '../db.js';
import { t } from '../i18n.js';
import { capabilities, type CapVoice } from './ha2.js';
import { VOICE_SAFE_DOMAINS, isSafe } from './ha2-safety.js';

export { VOICE_SAFE_DOMAINS, isSafe };

migrate(
  'ha2-voice-1',
  `CREATE TABLE ha2_voice (
     id INTEGER PRIMARY KEY,
     entity_id TEXT UNIQUE,
     name TEXT NOT NULL,
     area TEXT,
     domain TEXT NOT NULL,
     phrases TEXT,
     hidden INTEGER NOT NULL DEFAULT 0,
     sort INTEGER NOT NULL DEFAULT 0,
     source TEXT NOT NULL DEFAULT 'manual',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE ha2_voice_links (
     guest_link_id INTEGER PRIMARY KEY REFERENCES guest_links(id) ON DELETE CASCADE
   );`,
);

export const ASSISTANTS = ['alexa', 'google', 'siri', 'assist'] as const;
export type Assistant = (typeof ASSISTANTS)[number];

export interface VoiceSettings {
  assistant: Assistant;
}
export const voiceSettings = (): VoiceSettings => ({ assistant: 'alexa', ...getSetting<Partial<VoiceSettings>>('ha2.voice', {}) });
export function setVoiceSettings(s: Partial<VoiceSettings>) {
  const next = { ...voiceSettings(), ...s };
  if (!ASSISTANTS.includes(next.assistant)) next.assistant = 'alexa';
  setSetting('ha2.voice', next);
  return next;
}

const WAKE: Record<Assistant, string> = { alexa: 'Alexa', google: 'Hey Google', siri: 'Hey Siri', assist: 'Okay Nabu' };
export const assistantName = (a: Assistant) => ({ alexa: 'Alexa', google: 'Google Assistant', siri: 'Siri', assist: t('Home Assistant Assist') })[a];

/** Example phrases per domain, in the household's language. */
export function autoPhrases(domain: string, name: string, assistant: Assistant): string[] {
  const v = { wake: WAKE[assistant], name };
  switch (domain) {
    case 'light':
      return [t('{wake}, turn on {name}', v), t('{wake}, turn off {name}', v), t('{wake}, dim {name} to 30 percent', v)];
    case 'switch':
    case 'fan':
      return [t('{wake}, turn on {name}', v), t('{wake}, turn off {name}', v)];
    case 'cover':
      return [t('{wake}, open {name}', v), t('{wake}, close {name}', v)];
    case 'climate':
      return [t('{wake}, set {name} to 21 degrees', v)];
    case 'media_player':
      return [t('{wake}, play music on {name}', v), t('{wake}, pause {name}', v)];
    case 'scene':
    case 'script':
      return [assistant === 'siri' ? t('{wake}, {name}', v) : assistant === 'alexa' ? t('{wake}, turn on {name}', v) : t('{wake}, activate {name}', v)];
    default:
      return [];
  }
}

interface VoiceRow {
  id: number;
  entity_id: string | null;
  name: string;
  area: string | null;
  domain: string;
  phrases: string | null;
  hidden: number;
  sort: number;
  source: string;
}

export interface VoiceItem {
  id: number;
  entity_id: string | null;
  name: string;
  area: string | null;
  domain: string;
  /** own phrases (null = generated) */
  custom: string[] | null;
  phrases: string[];
  hidden: boolean;
  source: string;
}

function view(r: VoiceRow, assistant: Assistant): VoiceItem {
  let custom: string[] | null = null;
  try {
    custom = r.phrases ? (JSON.parse(r.phrases) as string[]).filter((x) => typeof x === 'string' && x.trim()) : null;
  } catch {
    custom = null;
  }
  return {
    id: r.id,
    entity_id: r.entity_id,
    name: r.name,
    area: r.area,
    domain: r.domain,
    custom: custom?.length ? custom : null,
    phrases: custom?.length ? custom : autoPhrases(r.domain, r.name, assistant),
    hidden: Boolean(r.hidden),
    source: r.source,
  };
}

export function voiceItems(opts: { includeHidden?: boolean } = {}): VoiceItem[] {
  const a = voiceSettings().assistant;
  const rows = db.prepare(`SELECT * FROM ha2_voice ${opts.includeHidden ? '' : 'WHERE hidden = 0'} ORDER BY COALESCE(area, 'zzz'), sort, name`).all() as VoiceRow[];
  // the filter runs on read too: an entry that became unsafe (renamed) disappears from guest pages
  return rows.map((r) => view(r, a)).filter((v) => isSafe(v, { allowScripts: true }));
}

/** Entities Home Assistant offers for the guide (safe ones only), with exposure per assistant. */
export function voiceCandidates() {
  const caps = capabilities();
  const added = new Set((db.prepare('SELECT entity_id FROM ha2_voice WHERE entity_id IS NOT NULL').all() as { entity_id: string }[]).map((r) => r.entity_id));
  const a = voiceSettings().assistant;
  return (caps?.voice ?? [])
    .filter((v) => isSafe(v, { allowScripts: true }))
    .map((v) => ({ ...v, added: added.has(v.entity_id), exposed_here: exposedFor(v, a) }))
    .sort((x, y) => Number(y.exposed_here) - Number(x.exposed_here) || (x.area ?? 'zzz').localeCompare(y.area ?? 'zzz') || x.name.localeCompare(y.name));
}

const exposedFor = (v: CapVoice, a: Assistant) => Boolean(a === 'alexa' ? v.exposed?.alexa : a === 'google' ? v.exposed?.google : a === 'assist' ? v.exposed?.assist : v.exposed?.assist || v.exposed?.alexa || v.exposed?.google);

/** Add HA entities to the guide (by id, from the last capabilities report). */
export function addEntities(ids: string[]) {
  const caps = capabilities();
  const byId = new Map((caps?.voice ?? []).map((v) => [v.entity_id, v]));
  let added = 0;
  const ins = db.prepare(`INSERT INTO ha2_voice (entity_id, name, area, domain, source, sort) VALUES (?, ?, ?, ?, 'ha', ?) ON CONFLICT(entity_id) DO UPDATE SET hidden = 0`);
  for (const id of ids) {
    const v = byId.get(id);
    if (!v || !isSafe(v, { allowScripts: true })) continue;
    added += ins.run(v.entity_id, v.name.slice(0, 80), v.area?.slice(0, 60) ?? null, v.domain, added).changes;
  }
  return added;
}

/** "Take over what's exposed": every safe entity exposed to the chosen assistant (scripts excluded). */
export function importExposed() {
  const a = voiceSettings().assistant;
  const ids = (capabilities()?.voice ?? []).filter((v) => exposedFor(v, a) && isSafe(v)).map((v) => v.entity_id);
  return addEntities(ids);
}

export class VoiceError extends Error {}

export function addManual(input: { name: string; domain: string; area?: string | null; phrases?: string[] | null }) {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new VoiceError(t('Name is missing'));
  if (!isSafe({ domain: input.domain, name }, { allowScripts: true })) throw new VoiceError(t('Locks, alarms, cameras, garage doors and people never appear on the guest page.'));
  const phrases = (input.phrases ?? []).map((p) => p.trim().slice(0, 160)).filter(Boolean).slice(0, 5);
  const info = db
    .prepare(`INSERT INTO ha2_voice (name, area, domain, phrases, source, sort) VALUES (?, ?, ?, ?, 'manual', (SELECT COALESCE(MAX(sort), 0) + 1 FROM ha2_voice))`)
    .run(name, input.area?.trim().slice(0, 60) || null, input.domain, phrases.length ? JSON.stringify(phrases) : null);
  return Number(info.lastInsertRowid);
}

export function updateItem(id: number, input: { name?: string; area?: string | null; phrases?: string[] | null; hidden?: boolean; domain?: string }) {
  const r = db.prepare('SELECT * FROM ha2_voice WHERE id = ?').get(id) as VoiceRow | undefined;
  if (!r) throw new VoiceError(t('Not found'));
  const name = input.name !== undefined ? input.name.trim().slice(0, 80) : r.name;
  const domain = input.domain ?? r.domain;
  if (!name) throw new VoiceError(t('Name is missing'));
  if (!isSafe({ domain, name, entity_id: r.entity_id }, { allowScripts: true })) throw new VoiceError(t('Locks, alarms, cameras, garage doors and people never appear on the guest page.'));
  const phrases = input.phrases === undefined ? r.phrases : input.phrases === null ? null : JSON.stringify(input.phrases.map((p) => p.trim().slice(0, 160)).filter(Boolean).slice(0, 5));
  db.prepare('UPDATE ha2_voice SET name = ?, area = ?, domain = ?, phrases = ?, hidden = ? WHERE id = ?').run(
    name,
    input.area !== undefined ? input.area?.trim().slice(0, 60) || null : r.area,
    domain,
    phrases === '[]' ? null : phrases,
    input.hidden !== undefined ? (input.hidden ? 1 : 0) : r.hidden,
    id,
  );
  return voiceItems({ includeHidden: true }).find((x) => x.id === id) ?? null;
}

export const deleteItem = (id: number) => db.prepare('DELETE FROM ha2_voice WHERE id = ?').run(id).changes > 0;

// ---------------------------------------------------------------- per guest link

export const voiceLinks = () => (db.prepare('SELECT guest_link_id FROM ha2_voice_links').all() as { guest_link_id: number }[]).map((r) => r.guest_link_id);
export function setVoiceLink(linkId: number, on: boolean) {
  if (!db.prepare('SELECT 1 FROM guest_links WHERE id = ?').get(linkId)) throw new VoiceError(t('Not found'));
  if (on) db.prepare('INSERT OR IGNORE INTO ha2_voice_links (guest_link_id) VALUES (?)').run(linkId);
  else db.prepare('DELETE FROM ha2_voice_links WHERE guest_link_id = ?').run(linkId);
  return on;
}

/** What a guest link shows – null when the section is off for this link or empty. */
export function guestVoice(linkId: number) {
  if (!db.prepare('SELECT 1 FROM ha2_voice_links WHERE guest_link_id = ?').get(linkId)) return null;
  const a = voiceSettings().assistant;
  const items = voiceItems().map(({ id, name, area, domain, phrases }) => ({ id, name, area, domain, phrases }));
  if (!items.length) return null;
  return { assistant: a, assistant_name: assistantName(a), items };
}
