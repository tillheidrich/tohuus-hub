/** Safety filter for the voice-command guide on guest pages (shared by ha2.ts and ha2-voice.ts). */

export const VOICE_SAFE_DOMAINS = ['light', 'switch', 'cover', 'climate', 'fan', 'media_player', 'scene', 'script'] as const;
export type VoiceDomain = (typeof VOICE_SAFE_DOMAINS)[number];

/** Never on a guest page, whatever HA exposes or someone types. */
const NEVER_DOMAINS = new Set(['lock', 'alarm_control_panel', 'camera', 'person', 'device_tracker', 'siren', 'valve', 'button', 'input_boolean', 'automation', 'vacuum', 'lawn_mower', 'water_heater', 'update']);
const UNSAFE_CLASSES = new Set(['garage', 'gate', 'door', 'window_lock']);
const UNSAFE_WORDS =
  /garage|garagen|carport|\btor\b|einfahrt|gate|lock|schloss|verriegel|alarm|siren|sirene|kamera|camera|\bcam\b|tresor|\bsafe\b|haustür|haustuer|front ?door|door ?lock|security|sicherheit|überwachung|ueberwachung|tracker|ortung|\bgrind\b|\blås|\blarm\b|\bport\b/i;

/** The safety filter – also applied to hand-made entries (by domain and name). */
export function isSafe(v: { domain: string; name: string; entity_id?: string | null; device_class?: string | null }, opts: { allowScripts?: boolean } = {}) {
  const domain = v.domain || (v.entity_id ?? '').split('.')[0];
  if (NEVER_DOMAINS.has(domain)) return false;
  if (!(VOICE_SAFE_DOMAINS as readonly string[]).includes(domain)) return false;
  if (domain === 'script' && !opts.allowScripts) return false;
  if (v.device_class && UNSAFE_CLASSES.has(v.device_class)) return false;
  if (UNSAFE_WORDS.test(`${v.name} ${v.entity_id ?? ''}`)) return false;
  return true;
}

