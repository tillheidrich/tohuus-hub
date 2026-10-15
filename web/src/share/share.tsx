/**
 * Teilen (docs/sharing.md): lists, ideas and cards leave the app – to Apple Notes, Mail, Messages, WhatsApp.
 * Text: Web Share where the browser has it, else Mail / Kopieren / Als Datei. The last line is the household's
 * choice: "— geteilt aus ToHuus · <site>" with a lowercase UTM link (no ids). Cards: branded images in 4:5 and 9:16.
 */
import { Copy, DownloadSimple, EnvelopeSimple, ShareNetwork } from '@phosphor-icons/react';
import { useState } from 'react';
import { invalidate, put, useApi } from '../api';
import { t } from '../i18n';
import { Sheet, Toggle, useToast } from '../ui';

export type ShareMedium = 'list' | 'mind' | 'tasks' | 'plan' | 'card' | 'wishes';

interface MeShare {
  site_url?: string;
  share_footer?: boolean;
}

/** The website and whether the household wants the footer (from /api/me, already cached by the shell). */
export function useShareMeta() {
  const me = useApi<MeShare>('me', '/me');
  const site = (me.data?.site_url ?? 'https://tohuus.heidrich-digital.de').replace(/\/$/, '');
  return { site, footer: me.data?.share_footer !== false };
}

export const siteHost = (site: string) => site.replace(/^https?:\/\//, '');

/** Title, lines, and – if the household keeps it on – one line saying where it comes from. */
export function shareText(title: string, lines: string[], medium: ShareMedium, meta: { site: string; footer: boolean }) {
  const body = [title, '', ...lines].join('\n').trim();
  if (!meta.footer) return body;
  return `${body}\n\n— ${t('shared from ToHuus')} · ${meta.site}/?utm_source=share&utm_medium=${medium}&utm_campaign=app`;
}

const MAILTO_MAX = 1800;

/** A "Teilen" button for text. `lines` may be computed late (e.g. fetched). */
export function ShareTextButton({
  title,
  lines,
  medium,
  label,
  className = 'btn sm ghost',
}: {
  title: string;
  lines: () => string[] | Promise<string[]>;
  medium: ShareMedium;
  label?: string;
  className?: string;
}) {
  const meta = useShareMeta();
  const toast = useToast();
  const [text, setText] = useState<string | null>(null);
  const open = async () => {
    const txt = shareText(title, await lines(), medium, meta);
    if (navigator.share) {
      try {
        await navigator.share({ title, text: txt });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    setText(txt);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text ?? '');
      toast({ text: t('Copied – paste it into Notes or a message.') });
      setText(null);
    } catch {
      toast({ text: t('Couldn’t copy.'), error: true });
    }
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text ?? ''], { type: 'text/plain;charset=utf-8' }));
    a.download = `${title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'tohuus'}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setText(null);
  };
  const body = text && text.length > MAILTO_MAX ? `${text.slice(0, MAILTO_MAX)}\n…` : (text ?? '');
  return (
    <>
      <button type="button" className={className} onClick={open} aria-label={label ?? t('Share')}>
        <ShareNetwork size={16} aria-hidden="true" /> {label ?? t('Share')}
      </button>
      <Sheet open={text !== null} onClose={() => setText(null)} title={t('Share')}>
        <p className="small muted" style={{ marginTop: 0 }}>
          {t('To Apple Notes, Mail or a message – as plain text.')}
        </p>
        <pre className="share-preview">{text}</pre>
        <div className="stack" style={{ gap: 8 }}>
          <a className="btn block" href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`} onClick={() => setText(null)}>
            <EnvelopeSimple size={18} aria-hidden="true" /> {t('E-mail')}
          </a>
          <button type="button" className="btn block" onClick={copy}>
            <Copy size={18} aria-hidden="true" /> {t('Copy')}
          </button>
          <button type="button" className="btn ghost block" onClick={download}>
            <DownloadSimple size={18} aria-hidden="true" /> {t('As a file (.txt)')}
          </button>
        </div>
      </Sheet>
    </>
  );
}

/** Settings › Haushalt: the "geteilt aus ToHuus" line under shared lists (admins; on by default). */
export function ShareFooterCard({ admin }: { admin: boolean }) {
  const meta = useShareMeta();
  const toast = useToast();
  const set = (footer: boolean) =>
    put('/share/settings', { footer })
      .then(() => invalidate('me'))
      .catch((e: Error) => toast({ text: e.message, error: true }));
  return (
    <div className="card pad row between share-footer-card" style={{ marginTop: 22, gap: 14 }}>
      <span className="grow">
        <b>{t('“Shared from ToHuus” under shared lists')}</b>
        <span className="small muted" style={{ display: 'block' }}>
          {t('One line with the link, so others know where the list comes from. Nothing is ever sent without you tapping Share.')}
        </span>
      </span>
      <Toggle on={meta.footer} onChange={set} disabled={!admin} label={t('“Shared from ToHuus” under shared lists')} />
    </div>
  );
}
