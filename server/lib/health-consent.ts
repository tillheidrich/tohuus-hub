/**
 * Allergies and other health notes are special categories of personal data (Art. 9 GDPR). Before the first one of a
 * household is stored, someone in the household confirms it once (the web/app sheet; the API answers 409 with
 * `code: "health_consent"` and the client repeats the save with `consent: true`). Kept in the household's settings
 * as `health.consent` = { at, by } (UTC time, "Name (#userId)").
 */
import { getSetting, now, setSetting } from '../db.js';
import { t } from '../i18n.js';

/** Thrown when health data would be stored before the household confirmed it; the apps show a short sheet and retry. */
export const healthConsentError = () =>
  Object.assign(new Error(t('Allergies are health data. Please confirm first that ToHuus may store them.')), { status: 409, code: 'health_consent' });

/**
 * Explicit consent (Art. 9 GDPR) before the first allergy or other health entry of a household is stored.
 * Kept once per household in the settings: when and by whom (name and user id). Asked again only if it is missing.
 */
export function healthConsent(): { at: string; by: string } | null {
  const c = getSetting<{ at?: string; by?: string } | null>('health.consent', null);
  return c?.at ? { at: c.at, by: c.by ?? '?' } : null;
}

export interface ConsentInput {
  /** the person saving confirmed the health-data sheet */
  consent?: boolean;
  /** who confirmed it (name and user id) */
  by?: string;
}

/** Throws 409 `health_consent` unless the household already consented or this call carries the confirmation (then it is recorded). */
export function requireHealthConsent(c: ConsentInput = {}) {
  if (healthConsent()) return;
  if (c.consent !== true) throw healthConsentError();
  setSetting('health.consent', { at: now(), by: (c.by ?? '?').slice(0, 80) });
}

