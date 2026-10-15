/**
 * Share cards (docs/sharing.md "Design"): branded images in 4:5 (1080×1350, feed) and 9:16 (1080×1920, story),
 * drawn on a canvas with the app's own fonts – the same layout as iOS (ShareCardViews.swift) and the website
 * (scripts/share-cards.mjs). What's on a card is only what the person chose to share: no names, no household name,
 * nothing private, nothing about someone a member looks after.
 */
import { DownloadSimple, ImageSquare, ShareNetwork } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Seg, Sheet, useToast } from '../ui';
import { siteHost, useShareMeta } from './share';

export type CardArea = 'tasks' | 'shop' | 'cook' | 'pantry' | 'money' | 'fact';
export interface CardSpec {
  area: CardArea;
  eyebrow: string;
  value: string;
  title: string;
  text?: string | null;
  list?: string[];
  /** facts: "Quelle: …" instead of the website line */
  source?: string | null;
}
export type CardFormat = 'feed' | 'story';

const SIZE: Record<CardFormat, [number, number]> = { feed: [1080, 1350], story: [1080, 1920] };
/** text-free bands at the top and bottom (the platforms' own UI sits there) */
const SAFE: Record<CardFormat, [number, number]> = { feed: [72, 72], story: [260, 360] };
const THEME: Record<CardArea, { bg: string; fg: string; accent: string }> = {
  tasks: { bg: '#176b50', fg: '#fffdf9', accent: '#cfdcd1' },
  shop: { bg: '#176b50', fg: '#fffdf9', accent: '#cfdcd1' },
  cook: { bg: '#c56b4b', fg: '#fffdf9', accent: '#f6d9cc' },
  money: { bg: '#2f5e7a', fg: '#fffdf9', accent: '#d5e4ec' },
  pantry: { bg: '#e8b865', fg: '#181d1a', accent: '#5b4515' },
  fact: { bg: '#f7f5ef', fg: '#181d1a', accent: '#176b50' },
};
const SERIF = '"Hedvig Letters Serif", Georgia, serif';
const BRAND = '"Hedvig Letters Sans", "Familjen Grotesk Variable", system-ui, sans-serif';
const SANS = '"Familjen Grotesk Variable", "Familjen Grotesk", system-ui, sans-serif';

function lines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width > max && cur) {
      out.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/** The value as large as fits on one line (a word like "Dienstag" needs to shrink). */
function fitSize(ctx: CanvasRenderingContext2D, text: string, start: number, max: number) {
  let size = start;
  for (; size > 80; size -= 8) {
    ctx.font = `${size}px ${SERIF}`;
    if (ctx.measureText(text).width <= max) break;
  }
  return size;
}

export async function drawCard(canvas: HTMLCanvasElement, spec: CardSpec, format: CardFormat, site: string) {
  const [w, h] = SIZE[format];
  const [top, bottom] = SAFE[format];
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  try {
    await Promise.all([document.fonts.load(`300px ${SERIF}`), document.fonts.load(`46px ${BRAND}`), document.fonts.load(`600 60px ${SANS}`)]);
  } catch {
    /* fall back to system fonts */
  }
  const th = THEME[spec.area];
  const pad = 88;
  const max = w - pad * 2;
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, w, h);
  // the door of the brand mark as a big, quiet arch at the bottom right
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = th.fg;
  const aw = w * 0.62;
  const ax = w - aw * 0.7;
  const ay = h - (format === 'story' ? 820 : 600);
  ctx.beginPath();
  ctx.moveTo(ax, h);
  ctx.lineTo(ax, ay + aw / 2);
  ctx.arc(ax + aw / 2, ay + aw / 2, aw / 2, Math.PI, 0);
  ctx.lineTo(ax + aw, h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // brand mark + name
  let y = top + (format === 'story' ? 0 : 16);
  const s = 64 / 32;
  ctx.save();
  ctx.translate(pad, y);
  ctx.scale(s, s);
  ctx.fillStyle = th.fg;
  ctx.fill(new Path2D('M4 28V14L16 4l12 10v14z'));
  ctx.fillStyle = th.bg;
  ctx.fill(new Path2D('M12.5 28v-6.5a3.5 3.5 0 0 1 7 0V28z'));
  ctx.restore();
  ctx.fillStyle = th.fg;
  ctx.font = `46px ${BRAND}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('ToHuus', pad + 84, y + 50);
  y += 64 + (format === 'story' ? 120 : 84);

  // eyebrow
  ctx.globalAlpha = 0.8;
  ctx.font = `600 30px ${SANS}`;
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '2.4px';
  for (const l of lines(ctx, spec.eyebrow.toUpperCase(), max).slice(0, 2)) {
    ctx.fillText(l, pad, y);
    y += 42;
  }
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px';
  ctx.globalAlpha = 1;

  // the one big value
  const vs = fitSize(ctx, spec.value, format === 'story' ? 300 : 240, max);
  y += vs * 0.92;
  ctx.font = `${vs}px ${SERIF}`;
  ctx.fillText(spec.value, pad - vs * 0.03, y);
  y += format === 'story' ? 90 : 70;

  // title
  ctx.font = `600 60px ${SANS}`;
  for (const l of lines(ctx, spec.title, max).slice(0, 3)) {
    ctx.fillText(l, pad, y);
    y += 72;
  }
  const limit = h - bottom - 90;
  if (spec.text) {
    y += 18;
    ctx.globalAlpha = 0.85;
    ctx.font = `40px ${SANS}`;
    for (const l of lines(ctx, spec.text, max).slice(0, 4)) {
      if (y > limit) break;
      ctx.fillText(l, pad, y);
      y += 54;
    }
    ctx.globalAlpha = 1;
  }
  if (spec.list?.length) {
    y += 22;
    ctx.font = `38px ${SANS}`;
    // a list the person picked themselves (erledigte Aufgaben) may be longer when there is no text
    for (const item of spec.list.slice(0, spec.text ? 3 : 6)) {
      if (y > limit) break;
      ctx.fillText(`·  ${lines(ctx, item, max - 40)[0]}`, pad, y);
      y += 54;
    }
  }

  // the line at the bottom: where it's from
  ctx.globalAlpha = 0.7;
  ctx.font = `28px ${SANS}`;
  const foot = spec.source ? `${t('Source')}: ${spec.source}` : `${t('Made with ToHuus')} · ${siteHost(site)}`;
  const fl = lines(ctx, foot, max);
  let fy = h - bottom - (fl.length - 1) * 38;
  for (const l of fl.slice(0, 2)) {
    ctx.fillText(l, pad, fy);
    fy += 38;
  }
  ctx.globalAlpha = 1;
}

/** "Als Bild teilen": format choice, live preview, then the share sheet with the image (or a download). */
export function ShareCardButton({ spec, className = 'btn sm ghost', label }: { spec: CardSpec; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={label ?? t('Share as image')}>
        <ImageSquare size={16} aria-hidden="true" /> {label ?? t('Share as image')}
      </button>
      {open && <ShareCardSheet spec={spec} onClose={() => setOpen(false)} />}
    </>
  );
}

/** `children` sits above the preview – e.g. the picker for which tasks go on the card. */
export function ShareCardSheet({ spec, onClose, title, children }: { spec: CardSpec; onClose: () => void; title?: string; children?: React.ReactNode }) {
  const meta = useShareMeta();
  const toast = useToast();
  const [format, setFormat] = useState<CardFormat>('story');
  const [url, setUrl] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let alive = true;
    const c = (canvas.current ??= document.createElement('canvas'));
    drawCard(c, spec, format, meta.site).then(() => alive && setUrl(c.toDataURL('image/png')));
    return () => {
      alive = false;
    };
  }, [format, spec, meta.site]);
  const blob = () => new Promise<Blob>((res, rej) => canvas.current!.toBlob((b) => (b ? res(b) : rej(new Error('no image'))), 'image/png'));
  const name = `tohuus-${format === 'story' ? '9x16' : '4x5'}.png`;
  const share = async () => {
    try {
      const file = new File([await blob()], name, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: spec.title });
        onClose();
        return;
      }
      download();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast({ text: (e as Error).message, error: true });
    }
  };
  const download = () => {
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  };
  return (
    <Sheet open onClose={onClose} title={title ?? t('Share as image')}>
      {children}
      <Seg
        value={format}
        onChange={setFormat}
        full
        label={t('Format')}
        options={[
          ['story', t('Story 9:16')],
          ['feed', t('Feed 4:5')],
        ]}
      />
      <div className={`share-card-preview ${format}`}>{url ? <img src={url} alt={`${spec.value} ${spec.title}`} /> : <div className="share-card-wait" />}</div>
      <p className="small muted">{t('Only what you see here is on the picture – no names, nothing private.')}</p>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn primary grow" onClick={share} disabled={!url}>
          <ShareNetwork size={18} aria-hidden="true" /> {t('Share')}
        </button>
        <button type="button" className="btn" onClick={download} disabled={!url} aria-label={t('Save picture')}>
          <DownloadSimple size={18} aria-hidden="true" />
        </button>
      </div>
    </Sheet>
  );
}
