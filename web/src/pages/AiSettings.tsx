// Settings › Connections & devices › AI: the AI switches (household, me, children) and MCP for the household's own assistants.
// Server: server/routes/ai-settings.ts, server/lib/ai-policy.ts.
import { Copy, Lock, Plug, Trash } from '@phosphor-icons/react';
import { del, invalidate, patch, put, relTime, useApi } from '../api';
import { t } from '../i18n';
import { Toggle, useToast } from '../ui';

interface AiSettings {
  configured: { text: boolean; vision: boolean; audio: boolean };
  household: boolean;
  mcp: boolean;
  mine: boolean;
  effective: boolean;
  reason: 'no_model' | 'household' | 'person' | 'parents' | 'cloud' | 'consent' | null;
  /** ToHuus Cloud: AI only after the person agreed (server/lib/ai-policy.ts) */
  consent?: { required: boolean; given: boolean; household: boolean; processor: string; privacyUrl: string };
  admin: boolean;
  kids?: { id: number; name: string; ai: boolean }[];
}

function Row({ title, sub, on, onChange, disabled }: { title: string; sub: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="row between" style={{ gap: 16, alignItems: 'flex-start', opacity: disabled ? 0.6 : 1 }}>
      <div>
        <b>{title}</b>
        <div className="small muted">{sub}</div>
      </div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}

export function AiSwitchesCard() {
  const s = useApi<AiSettings>(['ai', 'settings'], '/ai/settings');
  const toast = useToast();
  const set = async (body: Record<string, boolean>) => {
    try {
      await patch('/ai/settings', body);
      invalidate('ai', 'assistant', 'instance');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const setKid = async (id: number, enabled: boolean) => {
    try {
      await put(`/kids/${id}/ai`, { enabled });
      invalidate('ai', 'kids');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  if (!s.data) return null;
  const d = s.data;
  const anyModel = d.configured.text || d.configured.vision || d.configured.audio;
  const adminOnly = () => toast({ text: t('Only an admin can change this.'), error: true });
  return (
    <section className="card pad stack" aria-labelledby="ai-switch-h" style={{ marginBottom: 16 }}>
      <h2 id="ai-switch-h" style={{ margin: 0 }}>{t('AI in this household')}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {anyModel
          ? t('When AI is off, ToHuus sends nothing to an AI model. The list, stock, receipts as PDF, barcodes and text recognition on the server keep working.')
          : t('No AI model is set up on this server. ToHuus works without one: the list, stock, receipts as PDF, barcodes and text recognition on the server.')}
      </p>
      {anyModel && d.consent?.required && (
        <div className="card pad stack" role="group" aria-labelledby="ai-consent-h" style={{ background: 'var(--surface-2, transparent)' }}>
          <h3 id="ai-consent-h" style={{ margin: 0 }}>{d.consent.given ? t('You agreed to AI') : t('Use AI? You decide.')}</h3>
          <p className="small" style={{ margin: 0 }}>
            {t('When you use AI (free sentences and voice messages to the assistant, receipt and fridge photos, recipe imports), ToHuus sends what you write, say or photograph to {processor} – together with what the answer needs from your household, such as the list, stock or recipes. Allergies and children’s details only if your household allows it separately. Nothing is used to train models. Without AI everything else keeps working.', { processor: d.consent.processor })}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {d.consent.given ? (
              <button className="btn" onClick={() => set({ consent: false })}>{t('Withdraw consent')}</button>
            ) : (
              <button className="btn primary" onClick={() => set({ consent: true })}>{t('Agree and use AI')}</button>
            )}
            <a className="btn ghost" href={d.consent.privacyUrl} target="_blank" rel="noreferrer">{t('Privacy')}</a>
          </div>
          {d.admin && !d.consent.household && d.consent.given && (
            <p className="small muted" style={{ margin: 0 }}>{t('Receipts by mail and children use AI only after an admin agreed.')}</p>
          )}
        </div>
      )}
      {anyModel && (
        <>
          <Row
            title={t('AI for the whole household')}
            sub={t('Assistant with AI, receipt photos, recipe and photo imports. Off means off for everyone.')}
            on={d.household}
            onChange={d.admin ? (v) => set({ household: v }) : adminOnly}
          />
          <Row
            title={t('AI for me')}
            sub={t('Only for you. The others do not see how you set this.')}
            on={d.mine && d.household}
            disabled={!d.household}
            onChange={(v) => (d.household ? set({ mine: v }) : adminOnly())}
          />
          {(d.kids ?? []).map((k) => (
            <Row
              key={k.id}
              title={t('AI for {name}', { name: k.name })}
              sub={t('Children cannot change this themselves.')}
              on={k.ai && d.household}
              disabled={!d.household}
              onChange={(v) => setKid(k.id, v)}
            />
          ))}
        </>
      )}
      <Row
        title={t('Your own assistants (MCP)')}
        sub={t('Claude, ChatGPT and co. may reach ToHuus with an access you create. This is separate from the built-in AI: ToHuus itself calls no model for it.')}
        on={d.mcp}
        onChange={d.admin ? (v) => set({ mcp: v }) : adminOnly}
      />
    </section>
  );
}

/** Kid tablet: AI is set by the parents – shown locked, never changeable here. */
export function KidAiLocked({ enabled }: { enabled: boolean }) {
  if (enabled) return null;
  return (
    <div className="small muted row" style={{ gap: 6, justifyContent: 'center' }}>
      <Lock size={14} aria-hidden /> {t('AI: switched off by your parents')}
    </div>
  );
}

interface Connection {
  id: number;
  client: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
}

/** "Mit Claude/ChatGPT verbinden": the MCP address (OAuth sign-in) and this person's connections. */
export function ConnectAssistantCard() {
  const c = useApi<{ connections: Connection[]; mcpUrl: string; mcp: boolean }>(['oauth', 'connections'], '/oauth/connections');
  const toast = useToast();
  if (!c.data) return null;
  const copy = () => navigator.clipboard.writeText(c.data!.mcpUrl).then(() => toast({ text: t('Copied') }));
  const scopeText = (s: string[]) =>
    [s.includes('mcp:write') ? t('Read and change') : t('Read'), ...(s.includes('mcp:health') ? [t('Allergies and children’s details')] : [])].join(' · ');
  const revoke = async (id: number) => {
    if (!confirm(t('End this connection?'))) return;
    await del(`/oauth/connections/${id}`);
    invalidate('oauth');
  };
  return (
    <section className="card pad stack" aria-labelledby="connect-h" style={{ marginBottom: 16 }}>
      <div className="row">
        <span className="thumb" style={{ width: 44, height: 44 }}><Plug size={22} /></span>
        <div className="grow">
          <h2 id="connect-h" style={{ margin: 0 }}>{t('Connect with Claude or ChatGPT')}</h2>
          <div className="small muted">{t('Your assistant can then see the list and what is at home, and put things on the list – in your name.')}</div>
        </div>
      </div>
      {!c.data.mcp && <div className="small muted">{t('MCP access is switched off for this household (above).')}</div>}
      <div className="field">
        <label htmlFor="mcp-url">{t('Address for the assistant')}</label>
        <div className="row">
          <input id="mcp-url" className="input mono" readOnly value={c.data.mcpUrl} />
          <button className="icon-btn" onClick={copy} aria-label={t('Copy')}><Copy size={16} /></button>
        </div>
      </div>
      <ol className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
        <li>{t('Claude: Settings › Connectors › Add custom connector. ChatGPT: Settings › Connectors › Create (developer mode).')}</li>
        <li>{t('Paste the address. Authentication: OAuth (Claude finds it by itself).')}</li>
        <li>{t('Sign in to ToHuus, choose what the assistant may do, confirm.')}</li>
      </ol>
      <div className="list">
        {c.data.connections.map((x) => (
          <div key={x.id} className="li">
            <div className="grow">
              <div className="title">{x.client}</div>
              <div className="sub">{scopeText(x.scopes)} · {x.last_used_at ? t('last used {when}', { when: relTime(x.last_used_at) }) : t('never used')}</div>
            </div>
            <button className="icon-btn plain" onClick={() => revoke(x.id)} aria-label={t('End connection')}><Trash size={16} /></button>
          </div>
        ))}
        {c.data.connections.length === 0 && <div className="li muted small">{t('No assistant connected yet.')}</div>}
      </div>
    </section>
  );
}
