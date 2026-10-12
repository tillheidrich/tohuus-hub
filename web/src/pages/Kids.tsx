/**
 * Kid mode on a paired tablet: big picture tiles, "I'd like …" wishes that a parent approves,
 * a friendly picture status, quiet hours with a moon, and an optional "Where is …?" grid.
 * The tablet stays here (see `kidLock`) until a parent enters the PIN or removes the tablet.
 * No points, no stars, no ranking.
 */
import { KidAiLocked } from './AiSettings';
import { CaretLeft, Check, Clock, CloudSun, Hourglass, Lock, MagnifyingGlass, Moon, Smiley, SpeakerHigh, SpeakerSlash, SunHorizon, ThumbsUp, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { connectEvents, invalidate } from '../api';
import { applyBrand } from '../brand';
import { locale, setLang, t } from '../i18n';
import { Ic } from '../placeicons';
import { KidAnimal, KidArt, KidPicture } from './KidArt';

// ------------------------------------------------------------------ device lock

import { LOCK, kidLock } from '../kidlock';
export { kidLock };
function setKidLock(token: string | null) {
  try {
    if (token) localStorage.setItem(LOCK, token);
    else localStorage.removeItem(LOCK);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------ api & speech

class KidError extends Error {
  status: number;
  state?: string;
  until?: string;
  constructor(status: number, d: any) {
    super(d?.error ?? 'error');
    this.status = status;
    this.state = d?.state;
    this.until = d?.until;
  }
}

async function kapi(token: string, path: string, body?: unknown) {
  const r = await fetch(`/api/kid/${token}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new KidError(r.status, d);
  return d;
}

function useSpeech(enabledByParent: boolean) {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [on, setOn] = useState(() => {
    try {
      const v = localStorage.getItem('sw.kidSpeak');
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  });
  const active = supported && enabledByParent && on;
  const say = (text: string) => {
    if (!active) return;
    try {
      const s = window.speechSynthesis;
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = locale();
      u.rate = 0.92;
      u.pitch = 1.05;
      s.speak(u);
    } catch {
      /* ignore */
    }
  };
  const toggle = () =>
    setOn((v) => {
      try {
        localStorage.setItem('sw.kidSpeak', v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });
  return { supported: supported && enabledByParent, on: active, say, toggle };
}

interface Tile {
  id: number;
  name: string;
  image_path: string | null;
  art: string;
  category: string | null;
  state: 'ok' | 'quiet' | 'later' | 'enough' | 'busy';
  until: string | null;
}
interface Wish {
  id: number;
  name: string;
  image_path: string | null;
  art: string;
  view: 'waiting' | 'coming' | 'here' | 'later';
}

const VIEW = () => ({
  waiting: { icon: Hourglass, cls: 'wait', text: t('Asked – waiting for a grown-up') },
  coming: { icon: ThumbsUp, cls: 'yes', text: t('Yes! It’s coming') },
  here: { icon: Smiley, cls: 'here', text: t('Here you go!') },
  later: { icon: CloudSun, cls: 'later', text: t('Maybe later') },
});

function stateText(tile: Pick<Tile, 'state' | 'until' | 'name'>) {
  if (tile.state === 'later') return tile.until ? t('Not yet – from {time}', { time: tile.until }) : t('Not right now');
  if (tile.state === 'enough') return t('That’s it for today – tomorrow again');
  if (tile.state === 'busy') return t('Wait a little – a grown-up is still answering');
  if (tile.state === 'quiet') return t('Sleepy time');
  return tile.name;
}

// ------------------------------------------------------------------ page

export function KidMode() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const home = useQuery({ queryKey: ['orders', 'kid', token], queryFn: () => kapi(token, ''), retry: (n, e) => (e as KidError).status !== 404 && n < 2, refetchInterval: 20_000 });
  const d = home.data;
  const gone = (home.error as KidError | null)?.status === 404;
  const speech = useSpeech(Boolean(d?.kid?.speak));
  const [tab, setTab] = useState<'wish' | 'find'>('wish');
  const [pick, setPick] = useState<Tile | null>(null);
  const [sent, setSent] = useState<Tile | null>(null);
  const [nope, setNope] = useState<{ id: number; text: string } | null>(null);
  const [exit, setExit] = useState(false);

  useEffect(() => connectEvents(`/api/kid/${token}/events`), [token]);
  // once the link works, this device stays in kid mode
  useEffect(() => {
    if (d) setKidLock(token);
  }, [d, token]);
  useEffect(() => {
    if (gone && kidLock() === token) setKidLock(null);
  }, [gone, token]);
  useEffect(() => {
    if (!d) return;
    applyBrand(d.brand);
    document.title = d.kid.name;
  }, [d]);
  if (d) setLang(d.language);

  if (home.isLoading) return <div className="kid kid-loading"><div className="kid-spinner" /></div>;
  if (gone)
    return (
      <div className="kid kid-center">
        <div className="kid-big-ic later"><Lock size={64} weight="duotone" /></div>
        <h1>{t('This tablet is no longer in kid mode')}</h1>
        <p className="muted">{t('A grown-up can pair it again in the app.')}</p>
        <button className="btn primary" onClick={() => nav('/')}>{t('Open ToHuus Hub')}</button>
      </div>
    );
  if (!d)
    return (
      <div className="kid kid-center">
        <div className="kid-big-ic later"><CloudSun size={64} weight="duotone" /></div>
        <h1>{t('Hmm, no connection')}</h1>
        <button className="btn" onClick={() => home.refetch()}>{t('Try again')}</button>
      </div>
    );

  const kid = d.kid as { name: string; color: string; avatar: string; age_band: 'pre' | 'reads'; has_pin: boolean };
  const tiles: Tile[] = d.tiles ?? [];
  const wishes: Wish[] = d.wishes ?? [];
  const reads = kid.age_band === 'reads';

  const tap = (tile: Tile) => {
    if (tile.state !== 'ok') {
      const text = stateText(tile);
      setNope({ id: tile.id, text });
      speech.say(text);
      setTimeout(() => setNope((n) => (n?.id === tile.id ? null : n)), 2200);
      return;
    }
    setPick(tile);
    speech.say(t('I’d like {item}', { item: tile.name }));
  };

  const send = async () => {
    if (!pick) return;
    const tile = pick;
    setPick(null);
    try {
      await kapi(token, '/wish', { product_id: tile.id });
      setSent(tile);
      speech.say(t('Asked! A grown-up will answer soon.'));
      setTimeout(() => setSent((s) => (s?.id === tile.id ? null : s)), 3500);
    } catch (e) {
      const err = e as KidError;
      const text = err.state ? stateText({ state: err.state as Tile['state'], until: err.until ?? null, name: tile.name }) : t('That didn’t work – try again');
      setNope({ id: tile.id, text });
      speech.say(text);
      setTimeout(() => setNope(null), 2500);
    }
    invalidate('orders');
  };

  return (
    <div className="kid" style={{ ['--kid' as any]: kid.color }}>
      <header className="kid-top">
        <KidAnimal name={kid.avatar} size={52} color={kid.color} />
        <div className="kid-name">{kid.name}</div>
        <div className="grow" />
        {speech.supported && (
          <button className="kid-round" aria-label={speech.on ? t('Read aloud: on') : t('Read aloud: off')} onClick={speech.toggle}>
            {speech.on ? <SpeakerHigh size={26} weight="bold" /> : <SpeakerSlash size={26} weight="bold" />}
          </button>
        )}
        <button className="kid-round faint" aria-label={t('For grown-ups')} onClick={() => setExit(true)}>
          <Lock size={20} />
        </button>
      </header>

      {wishes.length > 0 && (
        <div className="kid-wishes" aria-live="polite">
          {wishes.slice(0, 4).map((w) => {
            const v = VIEW()[w.view];
            return (
              <button key={w.id} className={`kid-wish ${v.cls}`} onClick={() => speech.say(`${w.name}: ${v.text}`)} aria-label={`${w.name}: ${v.text}`}>
                <span className="pic"><KidPicture item={w} /></span>
                <span className="st"><v.icon size={26} weight="fill" /></span>
                {reads && <span className="lbl">{v.text}</span>}
              </button>
            );
          })}
        </div>
      )}

      {d.find?.length > 0 && !d.quiet && (
        <div className="kid-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'wish'} className={tab === 'wish' ? 'on' : ''} onClick={() => { setTab('wish'); speech.say(t('I’d like …')); }}>
            <span className="kid-tab-ic"><KidArt art="apple" /></span>
            {t('I’d like …')}
          </button>
          <button role="tab" aria-selected={tab === 'find'} className={tab === 'find' ? 'on' : ''} onClick={() => { setTab('find'); speech.say(t('Where is …?')); }}>
            <span className="kid-tab-ic"><MagnifyingGlass size={30} weight="bold" /></span>
            {t('Where is …?')}
          </button>
        </div>
      )}

      {d.quiet ? (
        <div className="kid-quiet" onClick={() => speech.say(t('Sleepy time. Wishes again from {time}.', { time: d.quiet.until }))}>
          <div className="moon"><Moon size={120} weight="fill" /></div>
          <div className="stars" aria-hidden><i /><i /><i /><i /><i /></div>
          <h1>{t('Sleepy time')}</h1>
          <p>{t('Wishes again from {time}', { time: d.quiet.until })}</p>
        </div>
      ) : tab === 'find' ? (
        <div className="kid-grid">
          {d.find.map((f: any) => (
            <button key={f.id} className="kid-tile find" onClick={() => speech.say([f.name, f.place?.name, f.spot].filter(Boolean).join('. '))}>
              <span className="pic place">
                {f.place?.photo ? <img src={f.place.photo} alt="" /> : <span className="place-ic"><Ic name={f.place?.icon ?? 'box'} size={64} /></span>}
                <span className="thing"><KidPicture item={{ ...f, art: 'plate' }} /></span>
              </span>
              <span className="lbl">{f.name}</span>
              {f.place && <span className="sub">{f.place.name}{reads && f.spot ? ` · ${f.spot}` : ''}</span>}
            </button>
          ))}
        </div>
      ) : tiles.length === 0 ? (
        <div className="kid-center small-pad">
          <div className="kid-big-ic later"><CloudSun size={64} weight="duotone" /></div>
          <h2>{t('Nothing here right now')}</h2>
          <p className="muted">{t('Ask a grown-up.')}</p>
        </div>
      ) : (
        <div className="kid-grid">
          {tiles.map((tile) => (
            <button key={tile.id} className={`kid-tile ${tile.state !== 'ok' ? 'off' : ''} ${nope?.id === tile.id ? 'wiggle' : ''}`} onClick={() => tap(tile)} aria-label={stateText(tile)}>
              <span className="pic"><KidPicture item={tile} /></span>
              <span className={`lbl ${reads ? '' : 'quiet'}`}>{tile.name}</span>
              {tile.state !== 'ok' && (
                <span className="lock">
                  {tile.state === 'later' ? <Clock size={30} weight="fill" /> : tile.state === 'enough' ? <SunHorizon size={30} weight="fill" /> : <Hourglass size={30} weight="fill" />}
                  {tile.state === 'later' && tile.until && <b>{tile.until}</b>}
                </span>
              )}
              {nope?.id === tile.id && <span className="bubble">{nope.text}</span>}
            </button>
          ))}
        </div>
      )}

      {pick && (
        <div className="kid-overlay" onMouseDown={(e) => e.target === e.currentTarget && setPick(null)}>
          <div className="kid-confirm" role="dialog" aria-modal="true" aria-label={t('I’d like {item}', { item: pick.name })}>
            <div className="pic"><KidPicture item={pick} /></div>
            <div className="q">{t('I’d like {item}', { item: pick.name })}</div>
            <div className="kid-yesno">
              <button className="no" aria-label={t('No')} onClick={() => setPick(null)}><X size={44} weight="bold" /></button>
              <button className="yes" aria-label={t('Yes, please')} onClick={send}><Check size={52} weight="bold" /></button>
            </div>
          </div>
        </div>
      )}

      {sent && (
        <div className="kid-overlay" onClick={() => setSent(null)}>
          <div className="kid-confirm sent" role="status">
            <div className="kid-big-ic wait"><Hourglass size={72} weight="fill" /></div>
            <div className="pic small"><KidPicture item={sent} /></div>
            <div className="q">{t('Asked!')}</div>
            <p>{t('A grown-up will answer soon.')}</p>
          </div>
        </div>
      )}

      <KidAiLocked enabled={(d as any).ai?.enabled !== false} />
      {exit && <ExitPad token={token} hasPin={kid.has_pin} onClose={() => setExit(false)} onDone={() => { setKidLock(null); nav('/'); }} />}
    </div>
  );
}

function ExitPad({ token, hasPin, onClose, onDone }: { token: string; hasPin: boolean; onClose: () => void; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const check = async () => {
    setBusy(true);
    try {
      await kapi(token, '/exit', { pin });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kid-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="kid-confirm exit" role="dialog" aria-modal="true" aria-label={t('For grown-ups')} tabIndex={-1} ref={ref} onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (/^\d$/.test(e.key) && pin.length < 8) setPin(pin + e.key);
        if (e.key === 'Backspace') setPin(pin.slice(0, -1));
        if (e.key === 'Enter' && pin.length >= 4) check();
      }}>
        <div className="row between" style={{ width: '100%' }}>
          <b>{t('For grown-ups')}</b>
          <button className="icon-btn plain" onClick={onClose} aria-label={t('Close')}><X size={20} /></button>
        </div>
        {hasPin ? (
          <>
            <p className="small muted" style={{ margin: 0 }}>{t('Enter the PIN to leave kid mode on this tablet.')}</p>
            <div className="kid-pin-dots" aria-label={t('{n} digits entered', { n: pin.length })}>
              {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
            </div>
            {err && <div className="small" style={{ color: 'var(--empty)' }}>{err}</div>}
            <div className="kid-pinpad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
                <button key={n} onClick={() => pin.length < 8 && setPin(pin + n)}>{n}</button>
              ))}
              <button aria-label={t('Delete')} onClick={() => setPin(pin.slice(0, -1))}><CaretLeft size={22} /></button>
              <button onClick={() => pin.length < 8 && setPin(pin + '0')}>0</button>
              <button className="ok" disabled={pin.length < 4 || busy} onClick={check} aria-label={t('OK')}><Check size={24} weight="bold" /></button>
            </div>
          </>
        ) : (
          <p className="small" style={{ margin: 0 }}>{t('No PIN is set for this profile. To end kid mode, remove this tablet in the app under Settings › Members › Kids.')}</p>
        )}
      </div>
    </div>
  );
}
