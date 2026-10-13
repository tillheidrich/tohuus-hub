import { X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { t } from './i18n';
import { useDialog } from './ui';

/**
 * Full-screen photo viewer. Any <img data-zoom> in the app opens here on tap (recipe photos,
 * product pictures …). Tap the photo to zoom in 2.5× and drag/scroll around, tap again to zoom out;
 * close with ×, Escape, a tap on the backdrop or the back gesture.
 */
export function Lightbox() {
  const [img, setImg] = useState<{ src: string; alt: string } | null>(null);
  const [zoom, setZoom] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('img[data-zoom]') as HTMLImageElement | null;
      if (!el || !el.currentSrc) return;
      e.preventDefault();
      e.stopPropagation();
      setZoom(false);
      setImg({ src: el.dataset.zoom && el.dataset.zoom !== 'true' && el.dataset.zoom !== '' ? el.dataset.zoom : el.currentSrc, alt: el.alt || el.dataset.zoomTitle || '' });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    if (!img) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setImg(null);
    // the phone's back gesture closes the viewer instead of leaving the page
    history.pushState({ lightbox: true }, '');
    const onPop = () => setImg(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      document.body.style.overflow = prev;
      if (history.state?.lightbox) history.back();
    };
  }, [img]);
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, Boolean(img));

  if (!img) return null;
  const toggle = (e: React.MouseEvent<HTMLImageElement>) => {
    e.stopPropagation();
    const box = scroller.current;
    if (!zoom && box) {
      // keep the tapped spot under the finger
      const r = e.currentTarget.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      setZoom(true);
      requestAnimationFrame(() => {
        box.scrollLeft = fx * box.scrollWidth - box.clientWidth / 2;
        box.scrollTop = fy * box.scrollHeight - box.clientHeight / 2;
      });
    } else setZoom(false);
  };
  return (
    <div ref={box} className="lightbox" role="dialog" aria-modal="true" aria-label={img.alt || t('Photo')} tabIndex={-1} onClick={() => setImg(null)}>
      <div ref={scroller} className={`lb-scroll ${zoom ? 'zoomed' : ''}`}>
        <img src={img.src} alt={img.alt} onClick={toggle} draggable={false} />
      </div>
      {img.alt && <div className="lb-caption">{img.alt}</div>}
      <button className="lb-close" aria-label={t('Close')} onClick={(e) => { e.stopPropagation(); setImg(null); }}>
        <X size={22} weight="bold" />
      </button>
    </div>
  );
}
