// /betrieb › Einstellungen: runtime settings stored encrypted in accounts.db (server/lib/runtime-settings.ts).
// The AI key is write-only: the page only ever sees its last 4 characters.
import { useEffect, useState } from 'react';
import { api, post, useApi } from '../../api';
import { t } from '../../i18n';
import { Seg, Skeleton, Toggle } from '../../ui';
import { Section, day, useRun } from './shared';

type Kind = 'text' | 'vision' | 'visionHard' | 'audio';
interface SettingRow {
  value: string | null;
  source: 'settings' | 'env' | 'default';
  secret: boolean;
  updatedAt: string | null;
}
interface SettingsView {
  pointsOn?: boolean;
  settings: Record<string, SettingRow>;
  ai: { configured: boolean; baseUrl: string | null; openrouter: boolean; apiKey: string | null; models: Record<Kind, string | null> | null; fallbacks: Record<Kind, string[]>; cloudOn: boolean };
  signupMode: 'open' | 'invite' | 'closed';
  supportEmail: string;
}

const MODEL_KEYS: [string, Kind, string][] = [
  ['AI_MODEL_TEXT', 'text', 'Text (assistant, imports)'],
  ['AI_MODEL_VISION', 'vision', 'Images (receipts, photos)'],
  ['AI_MODEL_VISION_HARD', 'visionHard', 'Images, second try'],
  ['AI_MODEL_AUDIO', 'audio', 'Speech'],
];

function SourceNote({ row }: { row?: SettingRow }) {
  if (!row) return null;
  const src = row.source === 'settings' ? t('set here on {date}', { date: day(row.updatedAt) }) : row.source === 'env' ? t('from the environment') : t('default');
  return <span className="small muted">{src}</span>;
}

export function OperatorSettings() {
  const q = useApi<SettingsView>(['operator', 'settings'], '/operator/settings');
  const run = useRun();
  const [key, setKey] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const d = q.data;
  useEffect(() => {
    if (!d) return;
    const f: Record<string, string> = {};
    for (const k of ['AI_BASE_URL', 'AI_MODEL_TEXT', 'AI_MODEL_VISION', 'AI_MODEL_VISION_HARD', 'AI_MODEL_AUDIO', 'AI_MODEL_FALLBACKS', 'support.email'])
      f[k] = d.settings[k]?.source === 'settings' ? (d.settings[k].value ?? '') : '';
    setForm(f);
  }, [d]);
  if (!d) return <Skeleton n={3} h={80} />;
  const save = (patch: Record<string, string | null>, done = t('Saved')) => run(() => api('/operator/settings', { method: 'PUT', body: patch }), done);
  const runTest = async (kind: Kind) => {
    setTesting(true);
    setTest(null);
    const r = await run(() => post<{ ok: boolean; model?: string; ms?: number; error?: string; code?: string }>('/operator/settings/ai-test', { kind }));
    setTesting(false);
    if (r) setTest({ ok: r.ok, text: r.ok ? t('Works: {model} answered in {ms} ms.', { model: r.model ?? '', ms: r.ms ?? 0 }) : `${r.error ?? ''} (${r.code ?? ''})` });
  };
  const field = (k: string, label: string, placeholder: string | null | undefined, help?: string) => (
    <div className="field" key={k}>
      <label htmlFor={`op-${k}`}>{label}</label>
      <input id={`op-${k}`} className="input mono" value={form[k] ?? ''} placeholder={placeholder ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
      <div className="help row op-help">
        <SourceNote row={d.settings[k]} />
        {help && <span className="small muted">{help}</span>}
      </div>
    </div>
  );
  const dirty = (k: string) => (form[k] ?? '') !== (d.settings[k]?.source === 'settings' ? (d.settings[k].value ?? '') : '');
  const changed = Object.keys(form).filter(dirty);
  return (
    <div className="stack op-gap">
      <Section title={t('Stars for households')} aside={<Toggle on={Boolean(d.pointsOn)} label={t('Stars for households')} onChange={(on) => save({ points: on ? 'on' : 'off' }, on ? t('Households may switch on stars') : t('Stars are off for everyone'))} />}>
        <p className="small muted op-p">{t('Off by default. When on, an admin of each household decides whether to count stars and for which areas – no rankings, no streaks.')}</p>
      </Section>
      <Section title={t('AI for the whole cloud')} aside={<Toggle on={d.ai.cloudOn} label={t('AI for the whole cloud')} onChange={(on) => save({ 'ai.cloud': on ? 'on' : 'off' }, on ? t('AI is on again') : t('AI paused for everyone'))} />}>
        <p className="small muted op-p">
          {d.ai.cloudOn
            ? t('On: households use AI as their own switches allow.')
            : t('Paused: no request goes to a model. Lists, receipts as PDF and everything else keep working.')}
        </p>
      </Section>

      <Section title={t('AI key')}>
        <div className="row op-wrap">
          <span className="mono op-key">{d.ai.apiKey ?? t('none')}</span>
          <SourceNote row={d.settings.AI_API_KEY} />
        </div>
        <form
          className="row op-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) void save({ AI_API_KEY: key.trim() }, t('Key saved')).then(() => setKey(''));
          }}
        >
          <label className="sr-only" htmlFor="op-key">
            {t('New key')}
          </label>
          <input id="op-key" className="input mono op-grow" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('New key (sk-or-…)')} />
          <button className="btn primary" disabled={!key.trim()}>
            {t('Save key')}
          </button>
          {d.settings.AI_API_KEY?.source === 'settings' && (
            <button type="button" className="btn" onClick={() => save({ AI_API_KEY: null }, t('Back to the key from the environment'))}>
              {t('Use environment')}
            </button>
          )}
        </form>
        <div className="row op-wrap">
          <button className="btn" disabled={testing} onClick={() => runTest('text')}>
            {testing ? t('One moment …') : t('Test')}
          </button>
          <button className="btn ghost" disabled={testing} onClick={() => runTest('vision')}>
            {t('Test image model')}
          </button>
          {test && (
            <span className={`small ${test.ok ? 'op-ok' : 'op-bad'}`} role="status">
              {test.text}
            </span>
          )}
        </div>
        <p className="small muted op-p">{t('The key is stored encrypted and never shown again – only its last 4 characters. The test sends one word to the model, no household data.')}</p>
      </Section>

      <Section title={t('Models')}>
        {field('AI_BASE_URL', t('Base URL'), d.ai.baseUrl, d.ai.openrouter ? t('OpenRouter: every request is pinned to Mistral (EU).') : undefined)}
        {MODEL_KEYS.map(([k, kind, label]) => field(k, t(label), d.ai.models?.[kind] ?? null))}
        {field('AI_MODEL_FALLBACKS', t('Fallback models'), (d.ai.fallbacks.text ?? []).join(', ') || '-', t('Comma-separated, tried in turn when the model is busy. "-" = none.'))}
        <div className="row op-wrap">
          <button className="btn primary" disabled={!changed.length} onClick={() => save(Object.fromEntries(changed.map((k) => [k, form[k].trim() || null])))}>
            {t('Save')}
          </button>
          <span className="small muted">{t('Empty field = back to the environment / default.')}</span>
        </div>
      </Section>

      <Section title={t('Sign-ups')}>
        <Seg
          label={t('Sign-ups')}
          value={d.signupMode}
          options={[
            ['open', t('Open for everyone')],
            ['invite', t('With access code')],
            ['closed', t('Closed')],
          ]}
          onChange={(v) => save({ 'signup.mode': v }, t('Saved'))}
        />
        <div className="row op-wrap">
          <SourceNote row={d.settings['signup.mode']} />
          {d.settings['signup.mode']?.source === 'settings' && (
            <button className="btn ghost sm" onClick={() => save({ 'signup.mode': null })}>
              {t('Use environment')}
            </button>
          )}
        </div>
        {field('support.email', t('Support address'), d.supportEmail, t('Shown where people are asked to write for an access code.'))}
        {dirty('support.email') && (
          <button className="btn primary" onClick={() => save({ 'support.email': form['support.email'].trim() || null })}>
            {t('Save')}
          </button>
        )}
      </Section>
    </div>
  );
}
