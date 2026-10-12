// Settings › Access & AI: the AI switches (household, me, children) and MCP for the household's own assistants.
// Server: server/routes/ai-settings.ts, server/lib/ai-policy.ts.
import { Lock } from '@phosphor-icons/react';
import { invalidate, patch, put, useApi } from '../api';
import { t } from '../i18n';
import { Toggle, useToast } from '../ui';

interface AiSettings {
  configured: { text: boolean; vision: boolean; audio: boolean };
  household: boolean;
  mcp: boolean;
  mine: boolean;
  effective: boolean;
  reason: 'no_model' | 'household' | 'person' | 'parents' | null;
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
