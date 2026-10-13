/**
 * Hausinfo (Mehr › Hausinfo, server/lib/house-guide.ts): how things work in this home – for babysitters, guests and
 * everyone who lives here. Voice commands, routines, tips and important numbers as cards, grouped by room or kind;
 * the Home Assistant voice list when there is one; codes (door PIN, alarm, Wi-Fi …) masked, tap to show (logged).
 *
 * The same view renders on the guest/sitter page (GuestHouse), readable offline once opened (cards only – a code
 * value is never stored on the device), and as a printable A4 sheet "Für den Babysitter".
 */
import { ArrowLeft, Copy, Eye, EyeSlash, Key, LinkSimple, Lock, Microphone, NotePencil, Phone, Plus, Printer, Sparkle, Trash, WifiHigh, Wrench } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Me } from '../App';
import { api, del, get, invalidate, patch, post, put, useApi } from '../api';
import { HowTo } from '../help';
import { t } from '../i18n';
import { Empty, Seg, Sheet, Skeleton, Toggle, useToast } from '../ui';

// ------------------------------------------------------------------ types (API: docs/house-guide.md)

export type CardType = 'voice' | 'routine' | 'tip' | 'contact';
export interface Visibility {
  members: boolean;
  guest_level: 'order' | 'stock' | 'recipes' | 'family' | null;
  sitters: boolean;
  links: { id: number; until?: string | null; name?: string }[];
}
export interface Card {
  id: number;
  type: CardType;
  topic: string;
  area: string | null;
  title: string;
  body: string;
  detail: string | null;
  assistant: string | null;
  hint?: string | null;
  draft?: boolean;
  visibility?: Visibility;
  /** photos and short videos (same visibility as the card) */
  media?: Media[];
}
export interface Media {
  id: number;
  kind: 'photo' | 'video';
  url: string;
  caption: string | null;
}
/** the server's limit per file (server/lib/images.ts VIDEO_MAX_BYTES) – said before anyone picks a file */
const MEDIA_MAX_BYTES = 100 * 1024 * 1024;
const MEDIA_PER_CARD = 8;
export interface Code {
  id: number;
  kind: 'door' | 'alarm' | 'garage' | 'wifi' | 'safe' | 'other';
  label: string;
  area: string | null;
  note: string | null;
  has_value: boolean;
  masked: string;
  wifi: { ssid: string | null; security: string; hidden: boolean } | null;
  visibility?: Visibility;
  last_views?: { viewer: string; via: string; at: string }[];
}
export interface VoiceGroup {
  area: string | null;
  items: { id: number; name: string; area: string | null; domain: string; phrases: string[]; kind: 'device' | 'routine' }[];
}
export interface Guide {
  cards: Card[];
  codes: Code[];
  ha_voice: { assistant: string; assistant_name: string; groups?: VoiceGroup[]; items: VoiceGroup['items'] } | null;
  areas: string[];
  can_edit?: boolean;
}
export interface Revealed {
  id: number;
  value: string;
  wifi: { ssid: string; security: string; hidden: boolean; qr: string } | null;
}

const TYPE_LABEL = (): Record<CardType, string> => ({ voice: t('Voice commands'), routine: t('Routines'), tip: t('Tips'), contact: t('Important numbers') });
const TYPE_ICON: Record<CardType, React.ReactNode> = { voice: <Microphone size={16} />, routine: <Sparkle size={16} />, tip: <Wrench size={16} />, contact: <Phone size={16} /> };
const TYPE_ORDER: CardType[] = ['contact', 'tip', 'voice', 'routine'];
const KIND_LABEL = (): Record<Code['kind'], string> => ({ door: t('Front door'), alarm: t('Alarm system'), garage: t('Garage door'), wifi: t('Guest Wi-Fi'), safe: t('Key safe'), other: t('Other code') });
const KIND_ICON: Record<Code['kind'], React.ReactNode> = { door: <Key size={18} />, alarm: <Lock size={18} />, garage: <Key size={18} />, wifi: <WifiHigh size={18} />, safe: <Lock size={18} />, other: <Key size={18} /> };
const everywhere = () => t('Everywhere');

// ------------------------------------------------------------------ shared view

type Group = 'area' | 'type';

/** Cards grouped by room or by kind; codes masked with tap-to-show; the HA voice list. Used at home and on guest links. */
export function GuideView({ g, reveal, group, onEditCard, onEditCode, query = '' }: { g: Guide; reveal: (id: number) => Promise<Revealed>; group: Group; onEditCard?: (c: Card) => void; onEditCode?: (c: Code) => void; query?: string }) {
  const q = query.trim().toLowerCase();
  const cards = g.cards.filter((c) => !q || `${c.title} ${c.body} ${c.detail ?? ''} ${c.area ?? ''}`.toLowerCase().includes(q));
  const codes = g.codes.filter((c) => !q || `${c.label} ${c.area ?? ''} ${KIND_LABEL()[c.kind]}`.toLowerCase().includes(q));
  const sections = useMemo(() => {
    if (group === 'type') return TYPE_ORDER.map((ty) => ({ key: ty, title: TYPE_LABEL()[ty], icon: TYPE_ICON[ty], cards: cards.filter((c) => c.type === ty) })).filter((s) => s.cards.length);
    const by = new Map<string, Card[]>();
    for (const c of cards) by.set(c.area ?? '', [...(by.get(c.area ?? '') ?? []), c]);
    return [...by.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([area, list]) => ({ key: area || '_', title: area || everywhere(), icon: null as React.ReactNode, cards: [...list].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)) }));
  }, [cards, group]);
  const voice = g.ha_voice?.groups?.map((vg) => ({ ...vg, items: vg.items.filter((i) => !q || `${i.name} ${i.phrases.join(' ')} ${i.area ?? ''}`.toLowerCase().includes(q)) })).filter((vg) => vg.items.length) ?? [];
  if (!cards.length && !codes.length && !voice.length) return <div className="card"><Empty icon={<NotePencil size={24} />} title={q ? t('Nothing matches “{q}”.', { q: query }) : t('Nothing here yet')} /></div>;
  return (
    <div className="hg">
      {codes.length > 0 && (
        <section className="hg-section" aria-labelledby="hg-codes">
          <h2 id="hg-codes" className="hg-title">
            <Lock size={18} /> {t('Codes')}
          </h2>
          <div className="hg-codes">
            {codes.map((c) => (
              <CodeCard key={c.id} c={c} reveal={reveal} onEdit={onEditCode} />
            ))}
          </div>
        </section>
      )}
      {sections.map((s) => (
        <section key={s.key} className="hg-section" aria-label={s.title}>
          <h2 className="hg-title">
            {s.icon} {s.title}
          </h2>
          <div className="hg-cards">
            {s.cards.map((c) => (
              <GuideCard key={c.id} c={c} showArea={group === 'type'} onEdit={onEditCard} />
            ))}
          </div>
        </section>
      ))}
      {voice.length > 0 && (
        <section className="hg-section" aria-labelledby="hg-voice">
          <h2 id="hg-voice" className="hg-title">
            <Microphone size={18} /> {t('Say it to {assistant}', { assistant: g.ha_voice!.assistant_name })}
          </h2>
          {voice.map((vg) => (
            <div key={vg.area ?? '_'} className="hg-voice-group">
              <div className="eyebrow">{vg.area ?? everywhere()}</div>
              <ul className="hg-voice">
                {vg.items.map((i) => (
                  <li key={i.id}>
                    <b>{i.name}</b>
                    {i.kind === 'routine' && <span className="badge">{t('Routine')}</span>}
                    <span className="hg-say">„{i.phrases[0]}“</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function GuideCard({ c, showArea, onEdit }: { c: Card; showArea: boolean; onEdit?: (c: Card) => void }) {
  const say = c.type === 'voice' || c.type === 'routine';
  return (
    <article className={`hg-card t-${c.type} ${c.draft ? 'draft' : ''}`}>
      <div className="hg-card-head">
        <span className="hg-ic" aria-hidden="true">{TYPE_ICON[c.type]}</span>
        <b className="grow">{c.title}</b>
        {showArea && c.area && <span className="badge">{c.area}</span>}
        {c.draft && <span className="badge maybe">{t('to fill in')}</span>}
        {onEdit && (
          <button className="icon-btn sm" onClick={() => onEdit(c)} aria-label={t('Edit {name}', { name: c.title })}>
            <NotePencil size={16} />
          </button>
        )}
      </div>
      {c.body ? (
        c.type === 'contact' && /^[+\d][\d\s/()-]{2,}$/.test(c.body.trim()) ? (
          <a className="hg-phone" href={`tel:${c.body.replace(/[^\d+]/g, '')}`}>{c.body}</a>
        ) : (
          <p className={say ? 'hg-say' : 'hg-body'}>{say ? `„${c.body}“` : c.body}</p>
        )
      ) : (
        c.hint && <p className="small muted">{c.hint}</p>
      )}
      {c.detail && <p className="small muted hg-detail">{c.type === 'routine' ? `${t('What happens:')} ${c.detail}` : c.detail}</p>}
      {!!c.media?.length && <MediaStrip media={c.media} title={c.title} />}
    </article>
  );
}

/** Photos (tap to zoom) and short videos of a card. */
function MediaStrip({ media, title }: { media: Media[]; title: string }) {
  return (
    <div className="hg-media">
      {media.map((m) => (
        <figure key={m.id} className={`hg-media-item ${m.kind}`}>
          {m.kind === 'photo' ? (
            <img src={m.url} alt={m.caption || title} loading="lazy" data-zoom />
          ) : (
            <video src={m.url} controls playsInline preload="metadata" aria-label={m.caption || title} />
          )}
          {m.caption && <figcaption className="small muted">{m.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

/** Too big for the server? Said before uploading, in plain words. */
function tooBig(f: File): string | null {
  if (f.size <= MEDIA_MAX_BYTES) return null;
  return f.type.startsWith('video/')
    ? t('“{name}” is {mb} MB – videos can be up to 100 MB. Shorten it, or add it in the iPhone app: it makes videos smaller first (about 5 minutes fit).', { name: f.name, mb: Math.round(f.size / 1048576) })
    : t('“{name}” is larger than 100 MB.', { name: f.name });
}

async function uploadMedia(cardId: number, f: File) {
  const form = new FormData();
  form.append('file', f, f.name);
  return api<Media>(`/house-guide/cards/${cardId}/media`, { method: 'POST', form });
}

/** In the card editor: what is there, add more, remove. New cards collect files and upload them after saving. */
function MediaEditor({ cardId, media, pending, setPending }: { cardId?: number; media: Media[]; pending: File[]; setPending: (f: File[]) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const count = media.length + pending.length;
  const pick = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    const ok: File[] = [];
    for (const f of list) {
      const big = tooBig(f);
      if (big) toast({ text: big, error: true });
      else ok.push(f);
    }
    const room = MEDIA_PER_CARD - count;
    if (ok.length > room) toast({ text: t('Up to {n} photos or videos per card.', { n: MEDIA_PER_CARD }), error: true });
    const take = ok.slice(0, Math.max(0, room));
    if (!take.length) return;
    if (!cardId) return setPending([...pending, ...take]);
    setBusy(true);
    try {
      for (const f of take) await uploadMedia(cardId, f);
      invalidate('house-guide');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (m: Media) => {
    if (!cardId) return;
    await del(`/house-guide/cards/${cardId}/media/${m.id}`);
    invalidate('house-guide');
  };
  return (
    <div className="field">
      <span className="label">{t('Photos and videos')}</span>
      {(media.length > 0 || pending.length > 0) && (
        <ul className="hg-media-edit">
          {media.map((m) => (
            <li key={m.id}>
              {m.kind === 'photo' ? <img src={m.url} alt="" /> : <video src={m.url} preload="metadata" muted playsInline aria-hidden="true" />}
              <button type="button" className="icon-btn sm" onClick={() => remove(m)} aria-label={t('Remove')}>
                <Trash size={14} />
              </button>
            </li>
          ))}
          {pending.map((f, i) => (
            <li key={`p${i}`} className="pending">
              <span className="small">{f.name}</span>
              <button type="button" className="icon-btn sm" onClick={() => setPending(pending.filter((_, j) => j !== i))} aria-label={t('Remove')}>
                <Trash size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {count < MEDIA_PER_CARD && (
        <label className={`btn ${busy ? 'disabled' : ''}`} style={{ alignSelf: 'flex-start' }}>
          <Plus size={16} /> {busy ? t('Uploading …') : t('Add a photo or video')}
          <input type="file" accept="image/*,video/*" multiple hidden disabled={busy} onChange={(e) => (pick(e.target.files), (e.target.value = ''))} />
        </label>
      )}
      <span className="small muted">{t('Photos, and videos up to 100 MB each (in the iPhone app about 5 minutes – it makes them smaller first). Up to {n} per card. Who sees the card sees them too.', { n: MEDIA_PER_CARD })}</span>
    </div>
  );
}

function CodeCard({ c, reveal, onEdit }: { c: Code; reveal: (id: number) => Promise<Revealed>; onEdit?: (c: Code) => void }) {
  const [shown, setShown] = useState<Revealed | null>(null);
  const [qr, setQr] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // shown values disappear again after a minute (nobody leaves a door code on an unlocked phone)
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => {
      setShown(null);
      setQr('');
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, [shown]);
  const toggle = async () => {
    if (shown) {
      setShown(null);
      setQr('');
      return;
    }
    setBusy(true);
    try {
      const r = await reveal(c.id);
      setShown(r);
      if (r.wifi?.qr) setQr(await QRCode.toString(r.wifi.qr, { type: 'svg', margin: 1, color: { dark: '#181D1A', light: '#FFFDF9' } }));
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="hg-code">
      <span className="hg-code-ic" aria-hidden="true">{KIND_ICON[c.kind]}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <b>{c.label}</b>
        <div className="small muted">{[c.area, c.wifi?.ssid ? t('Network: {ssid}', { ssid: c.wifi.ssid }) : null, c.note].filter(Boolean).join(' · ')}</div>
        {c.has_value && (
          <div className="hg-secret" aria-live="polite">
            {shown ? <code>{shown.value}</code> : <span aria-label={t('hidden')}>{c.masked}</span>}
          </div>
        )}
        {qr && (
          <div className="hg-qr">
            <span dangerouslySetInnerHTML={{ __html: qr }} />
            <span className="small muted">{t('Scan with the phone camera to join the Wi-Fi.')}</span>
          </div>
        )}
        {c.last_views && c.last_views.length > 0 && <div className="small muted">{t('Last shown to {name}, {when}', { name: c.last_views[0].viewer, when: c.last_views[0].at.slice(0, 16).replace('T', ' ') })}</div>}
      </div>
      <div className="hg-code-actions">
        {c.has_value && (
          <button className="btn sm" onClick={toggle} disabled={busy} aria-pressed={Boolean(shown)}>
            {shown ? <EyeSlash size={16} /> : <Eye size={16} />} {shown ? t('Hide') : t('Show')}
          </button>
        )}
        {shown && (
          <button className="icon-btn sm" aria-label={t('Copy')} onClick={() => navigator.clipboard.writeText(shown.value).then(() => toast({ text: t('Copied') }))}>
            <Copy size={16} />
          </button>
        )}
        {onEdit && (
          <button className="icon-btn sm" onClick={() => onEdit(c)} aria-label={t('Edit {name}', { name: c.label })}>
            <NotePencil size={16} />
          </button>
        )}
      </div>
    </article>
  );
}

// ------------------------------------------------------------------ print (A4 "Für den Babysitter")

/** A4 sheet: cards by room, numbers first; codes only when asked (each one is revealed, and so logged). */
export function PrintSheet({ g, household, reveal, onClose, allowCodes }: { g: Guide; household: string; reveal: (id: number) => Promise<Revealed>; onClose: () => void; allowCodes: boolean }) {
  const [withCodes, setWithCodes] = useState(false);
  const [values, setValues] = useState<Record<number, string>>({});
  const [ready, setReady] = useState(true);
  useEffect(() => {
    if (!withCodes) return setValues({});
    setReady(false);
    Promise.all(g.codes.filter((c) => c.has_value).map((c) => reveal(c.id).then((r) => [c.id, r.value] as const).catch(() => [c.id, ''] as const)))
      .then((xs) => setValues(Object.fromEntries(xs)))
      .finally(() => setReady(true));
  }, [withCodes]); // eslint-disable-line react-hooks/exhaustive-deps
  const numbers = g.cards.filter((c) => c.type === 'contact');
  const rest = g.cards.filter((c) => c.type !== 'contact');
  const byArea = new Map<string, Card[]>();
  for (const c of rest) byArea.set(c.area ?? '', [...(byArea.get(c.area ?? '') ?? []), c]);
  return (
    <div className="hg-print-wrap">
      <div className="hg-print-bar no-print">
        <button className="btn" onClick={onClose}>
          <ArrowLeft size={16} /> {t('Back')}
        </button>
        {allowCodes && g.codes.some((c) => c.has_value) && (
          <label className="row small" style={{ gap: 8 }}>
            <Toggle on={withCodes} onChange={setWithCodes} label={t('Print codes too')} /> {t('Print codes too')}
          </label>
        )}
        <button className="btn primary" disabled={!ready} onClick={() => window.print()}>
          <Printer size={16} /> {t('Print')}
        </button>
      </div>
      <article className="hg-print" aria-label={t('For the babysitter')}>
        <header>
          <div className="eyebrow">{household}</div>
          <h1>{t('For the babysitter')}</h1>
        </header>
        {numbers.length > 0 && (
          <section className="hg-print-numbers">
            <h2>{t('Important numbers')}</h2>
            <dl>
              {numbers.map((c) => (
                <div key={c.id}>
                  <dt>{c.title}</dt>
                  <dd>{c.body}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {g.codes.length > 0 && (
          <section>
            <h2>{t('Codes')}</h2>
            <dl>
              {g.codes.map((c) => (
                <div key={c.id}>
                  <dt>{c.label}{c.wifi?.ssid ? ` (${c.wifi.ssid})` : ''}</dt>
                  <dd>{withCodes ? values[c.id] || '—' : t('ask us')}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {[...byArea.entries()].map(([area, list]) => (
          <section key={area || '_'}>
            <h2>{area || everywhere()}</h2>
            <ul>
              {list.map((c) => (
                <li key={c.id}>
                  <b>{c.title}:</b> {c.type === 'voice' || c.type === 'routine' ? `„${c.body}“` : c.body}
                  {c.detail ? ` – ${c.detail}` : ''}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {g.ha_voice?.groups?.length ? (
          <section>
            <h2>{t('Say it to {assistant}', { assistant: g.ha_voice.assistant_name })}</h2>
            <ul>
              {g.ha_voice.groups.flatMap((vg) => vg.items.map((i) => <li key={i.id}>„{i.phrases[0]}“{vg.area ? ` (${vg.area})` : ''}</li>))}
            </ul>
          </section>
        ) : null}
      </article>
    </div>
  );
}

// ------------------------------------------------------------------ page: Mehr › Hausinfo

export function HouseGuidePage({ me }: { me: Me }) {
  const q = useApi<Guide>('house-guide', '/house-guide');
  const [group, setGroup] = useState<Group>(() => {
    try {
      return localStorage.getItem('tohuus.hg.group') === 'type' ? 'type' : 'area';
    } catch {
      return 'area';
    }
  });
  const [query, setQuery] = useState('');
  const [card, setCard] = useState<Partial<Card> | null>(null);
  const [code, setCode] = useState<Partial<Code> | null>(null);
  const [tpl, setTpl] = useState(false);
  const [log, setLog] = useState(false);
  const [print, setPrint] = useState(false);
  const [sp, setSp] = useSearchParams();
  const linkId = Number(sp.get('link')) || null;
  const admin = Boolean(q.data?.can_edit);
  const setG = (v: Group) => {
    setGroup(v);
    try {
      localStorage.setItem('tohuus.hg.group', v);
    } catch {
      /* ignore */
    }
  };
  const reveal = (id: number) => post<Revealed>(`/house-guide/codes/${id}/reveal`);
  if (q.isLoading || !q.data) return <Skeleton h={120} n={3} />;
  if (print) return <PrintSheet g={{ ...q.data, cards: q.data.cards.filter((c) => !c.draft) }} household={me.household} reveal={reveal} onClose={() => setPrint(false)} allowCodes={admin} />;
  const empty = !q.data.cards.length && !q.data.codes.length && !q.data.ha_voice;
  return (
    <div className="rise hg-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('For babysitters, guests and everyone at home')}</div>
          <h1>{t('House info')}</h1>
        </div>
        <div className="actions">
          {!empty && (
            <button className="btn ghost" onClick={() => setPrint(true)}>
              <Printer size={16} /> {t('Print')}
            </button>
          )}
          {admin && (
            <button className="btn" onClick={() => setCard({ type: 'tip' })}>
              <Plus size={16} weight="bold" /> {t('Card')}
            </button>
          )}
        </div>
      </header>
      {empty ? (
        <div className="card">
          <Empty icon={<NotePencil size={26} />} title={t('How do things work here?')} action={admin ? { label: t('Start with a template'), onClick: () => setTpl(true), icon: <Sparkle size={14} /> } : undefined}>
            {t('Write down what a babysitter or guest needs: “Alexa, gute Nacht” and what it does, how the heating works, where the fuse box is, important numbers. Codes stay hidden until someone taps them.')}
          </Empty>
        </div>
      ) : (
        <>
          <div className="row between wrap hg-tools">
            <Seg value={group} onChange={setG} label={t('Group by')} options={[['area', t('By room')], ['type', t('By kind')]]} />
            <input className="input hg-search" placeholder={t('Search, e.g. heating')} aria-label={t('Search house info')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <GuideView g={q.data} reveal={reveal} group={group} query={query} onEditCard={admin ? (c) => setCard(c) : undefined} onEditCode={admin ? (c) => setCode(c) : undefined} />
        </>
      )}
      {admin && (
        <div className="card pad stack hg-admin">
          <b>{t('Manage')}</b>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn" onClick={() => setCode({ kind: 'door' })}>
              <Key size={16} /> {t('Add code')}
            </button>
            <button className="btn" onClick={() => setTpl(true)}>
              <Sparkle size={16} /> {t('Templates')}
            </button>
            <button className="btn ghost" onClick={() => setLog(true)}>
              <Eye size={16} /> {t('Who looked at codes')}
            </button>
          </div>
          <LinksCard onPick={(id) => setSp({ link: String(id) })} />
          <p className="small muted" style={{ margin: 0 }}>{t('Codes are never sent to the assistant, AI, Home Assistant, displays or notifications, and they stay out of the export unless you tick them.')}</p>
        </div>
      )}
      <HowTo slug="hausinfo" />
      {card && <CardEditor init={card} areas={q.data.areas} onClose={() => setCard(null)} />}
      {code && <CodeEditor init={code} areas={q.data.areas} onClose={() => setCode(null)} />}
      <TemplatesSheet open={tpl} onClose={() => setTpl(false)} />
      <LogSheet open={log} onClose={() => setLog(false)} />
      {linkId && <LinkSelectionSheet id={linkId} onClose={() => setSp({})} />}
    </div>
  );
}

// ------------------------------------------------------------------ admin: editors

const LEVELS = (): [string, string][] => [
  ['', t('No permanent guests')],
  ['order', t('All permanent guests')],
  ['stock', t('Guests from “stock”')],
  ['recipes', t('Guests from “recipes”')],
  ['family', t('Only guests at “family”')],
];

interface GuestLink {
  id: number;
  name: string;
  scopes: string[];
  expires_at: string | null;
}

function VisibilityEditor({ v, onChange, code }: { v: Visibility; onChange: (v: Visibility) => void; code?: boolean }) {
  const links = useApi<GuestLink[]>('guest-links', '/guest-links');
  const set = (p: Partial<Visibility>) => onChange({ ...v, ...p });
  const linked = new Map(v.links.map((l) => [l.id, l]));
  return (
    <fieldset className="hg-vis">
      <legend>{t('Who sees this?')}</legend>
      <label className="row between">
        <span>{t('Everyone who lives here')}</span>
        <Toggle on={v.members} onChange={(x) => set({ members: x })} label={t('Everyone who lives here')} />
      </label>
      <label className="field">
        <span>{t('Permanent guests')}</span>
        <select className="input" value={v.guest_level ?? ''} onChange={(e) => set({ guest_level: (e.target.value || null) as Visibility['guest_level'] })}>
          {LEVELS().map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </label>
      <label className="row between">
        <span>{t('All babysitter and house-sitter links')}</span>
        <Toggle on={v.sitters} onChange={(x) => set({ sitters: x })} label={t('All babysitter and house-sitter links')} />
      </label>
      {(links.data?.length ?? 0) > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small muted">{code ? t('Or only for these links, until a date:') : t('Or only for these links:')}</span>
          {links.data!.map((l) => {
            const on = linked.get(l.id);
            return (
              <div key={l.id} className="row wrap" style={{ gap: 8 }}>
                <label className="row grow" style={{ gap: 8 }}>
                  <input type="checkbox" checked={Boolean(on)} onChange={(e) => set({ links: e.target.checked ? [...v.links, { id: l.id, until: null }] : v.links.filter((x) => x.id !== l.id) })} />
                  <LinkSimple size={14} /> {l.name}
                </label>
                {on && code && (
                  <input
                    type="date"
                    className="input"
                    style={{ maxWidth: 170 }}
                    aria-label={t('Until')}
                    value={on.until?.slice(0, 10) ?? ''}
                    onChange={(e) => set({ links: v.links.map((x) => (x.id === l.id ? { ...x, until: e.target.value || null } : x)) })}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

const DEFAULT_CARD_VIS: Visibility = { members: true, guest_level: 'order', sitters: true, links: [] };
const DEFAULT_CODE_VIS: Visibility = { members: true, guest_level: null, sitters: false, links: [] };

function CardEditor({ init, areas, onClose }: { init: Partial<Card>; areas: string[]; onClose: () => void }) {
  const [f, setF] = useState({ type: init.type ?? 'tip', topic: init.topic ?? 'other', area: init.area ?? '', title: init.title ?? '', body: init.body ?? '', detail: init.detail ?? '', visibility: init.visibility ?? DEFAULT_CARD_VIS });
  const toast = useToast();
  const [pending, setPending] = useState<File[]>([]);
  // the card as it is now (new photos appear while the editor is open)
  const live = useApi<Guide>('house-guide', '/house-guide').data?.cards.find((c) => c.id === init.id);
  const save = async () => {
    try {
      const body = { ...f, area: f.area.trim() || null, detail: f.detail.trim() || null };
      let id = init.id;
      if (id) await patch(`/house-guide/cards/${id}`, body);
      else id = (await post<Card>('/house-guide/cards', body)).id;
      for (const file of pending) await uploadMedia(id!, file);
      invalidate('house-guide');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const remove = async () => {
    if (!init.id || !confirm(t('Delete this card?'))) return;
    await del(`/house-guide/cards/${init.id}`);
    invalidate('house-guide');
    onClose();
  };
  const say = f.type === 'voice' || f.type === 'routine';
  return (
    <Sheet open onClose={onClose} title={init.id ? t('Edit card') : t('New card')}>
      <div className="stack">
        <Seg value={f.type} onChange={(type) => setF({ ...f, type })} options={[['tip', t('Tip')], ['voice', t('Command')], ['routine', t('Routine')], ['contact', t('Number')]]} label={t('Kind')} />
        <div className="field">
          <label htmlFor="hg-title">{t('Title')}</label>
          <input id="hg-title" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={say ? t('e.g. Good night') : f.type === 'contact' ? t('e.g. Our neighbours') : t('e.g. Heating')} />
        </div>
        <div className="field">
          <label htmlFor="hg-body">{say ? t('What you say') : f.type === 'contact' ? t('Number') : t('How it works')}</label>
          <textarea id="hg-body" className="input" rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={say ? 'Alexa, gute Nacht' : init.hint ?? ''} />
        </div>
        <div className="field">
          <label htmlFor="hg-detail">{f.type === 'routine' ? t('What happens') : t('More (optional)')}</label>
          <textarea id="hg-detail" className="input" rows={2} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} placeholder={f.type === 'routine' ? t('e.g. all lights off, blinds down, night light in the kids’ room on') : ''} />
        </div>
        <div className="field">
          <label htmlFor="hg-area">{t('Room or area (optional)')}</label>
          <input id="hg-area" className="input" list="hg-areas" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder={t('e.g. Living room')} />
          <datalist id="hg-areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
        <MediaEditor cardId={init.id} media={live?.media ?? init.media ?? []} pending={pending} setPending={setPending} />
        <VisibilityEditor v={f.visibility} onChange={(visibility) => setF({ ...f, visibility })} />
        <p className="small muted" style={{ margin: 0 }}>{t('Cards are not secret – codes and passwords belong under Codes.')}</p>
        <div className="row" style={{ gap: 8 }}>
          {init.id && (
            <button className="btn ghost" onClick={remove}>
              <Trash size={16} /> {t('Delete')}
            </button>
          )}
          <button className="btn primary grow" disabled={!f.title.trim()} onClick={save}>{pending.length ? t('Save and upload') : t('Save')}</button>
        </div>
      </div>
    </Sheet>
  );
}

function CodeEditor({ init, areas, onClose }: { init: Partial<Code>; areas: string[]; onClose: () => void }) {
  const [f, setF] = useState({ kind: init.kind ?? 'door', label: init.label ?? '', area: init.area ?? '', note: init.note ?? '', value: '', ssid: init.wifi?.ssid ?? '', security: init.wifi?.security ?? 'WPA', visibility: init.visibility ?? DEFAULT_CODE_VIS });
  const toast = useToast();
  const save = async () => {
    try {
      const body: any = { kind: f.kind, label: f.label.trim() || KIND_LABEL()[f.kind], area: f.area.trim() || null, note: f.note.trim() || null, visibility: f.visibility };
      // an empty field keeps the stored value (it is never sent to the page)
      if (f.value) body.value = f.value;
      if (f.kind === 'wifi') body.wifi = { ssid: f.ssid.trim() || null, security: f.security };
      if (init.id) await patch(`/house-guide/codes/${init.id}`, body);
      else await post('/house-guide/codes', body);
      invalidate('house-guide');
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const remove = async () => {
    if (!init.id || !confirm(t('Delete this code?'))) return;
    await del(`/house-guide/codes/${init.id}`);
    invalidate('house-guide');
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={init.id ? t('Edit code') : t('New code')}>
      <div className="stack">
        <div className="field">
          <label htmlFor="hc-kind">{t('Kind')}</label>
          <select id="hc-kind" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Code['kind'] })}>
            {Object.entries(KIND_LABEL()).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="hc-label">{t('Name')}</label>
          <input id="hc-label" className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder={KIND_LABEL()[f.kind]} />
        </div>
        {f.kind === 'wifi' && (
          <div className="field">
            <label htmlFor="hc-ssid">{t('Network name')}</label>
            <input id="hc-ssid" className="input" value={f.ssid} onChange={(e) => setF({ ...f, ssid: e.target.value })} autoComplete="off" />
          </div>
        )}
        <div className="field">
          <label htmlFor="hc-value">{f.kind === 'wifi' ? t('Password') : t('Code')}</label>
          <input id="hc-value" className="input" type="password" autoComplete="new-password" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder={init.has_value ? t('unchanged – type to replace') : ''} />
        </div>
        <div className="field">
          <label htmlFor="hc-area">{t('Room or area (optional)')}</label>
          <input id="hc-area" className="input" list="hc-areas" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} />
          <datalist id="hc-areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
        </div>
        <div className="field">
          <label htmlFor="hc-note">{t('Note (optional, not secret)')}</label>
          <input id="hc-note" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t('e.g. press # afterwards')} />
        </div>
        <VisibilityEditor v={f.visibility} onChange={(visibility) => setF({ ...f, visibility })} code />
        <div className="row" style={{ gap: 8 }}>
          {init.id && (
            <button className="btn ghost" onClick={remove}>
              <Trash size={16} /> {t('Delete')}
            </button>
          )}
          <button className="btn primary grow" onClick={save}>{t('Save')}</button>
        </div>
      </div>
    </Sheet>
  );
}

function TemplatesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tpls = useApi<{ key: string; name: string; description: string; cards: unknown[] }[]>('house-guide-templates', open ? '/house-guide/templates' : null);
  const toast = useToast();
  const apply = async (key: string) => {
    const r = await post<{ added: number }>(`/house-guide/templates/${key}`, {});
    invalidate('house-guide');
    toast({ text: r.added ? t('{n} cards added – fill in what applies, delete the rest.', { n: r.added }) : t('These cards are already there.') });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('Templates')}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t('Starter cards for your voice assistant and typical tips. Nothing assumes your home – change or delete what does not fit.')}</p>
        {tpls.data?.map((x) => (
          <button key={x.key} className="card pad hg-tpl" onClick={() => apply(x.key)}>
            <b>{x.name}</b>
            <span className="small muted">{x.description}</span>
          </button>
        )) ?? <Skeleton n={3} h={60} />}
      </div>
    </Sheet>
  );
}

function LogSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const log = useApi<{ code_id: number; label: string; viewer: string; via: string; at: string }[]>('house-guide-log', open ? '/house-guide/log' : null);
  return (
    <Sheet open={open} onClose={onClose} title={t('Who looked at codes')}>
      {log.data?.length ? (
        <div className="list">
          {log.data.map((l, i) => (
            <div key={i} className="li">
              <div className="grow">
                <div className="title">{l.label}</div>
                <div className="sub">{[l.viewer, l.via === 'link' ? t('via link') : null, l.at.slice(0, 16)].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="small muted">{t('Nobody has looked at a code yet.')}</p>
      )}
    </Sheet>
  );
}

function LinksCard({ onPick }: { onPick: (id: number) => void }) {
  const links = useApi<GuestLink[]>('guest-links', '/guest-links');
  const sitters = (links.data ?? []).filter((l) => l.scopes.includes('stock'));
  if (!sitters.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="small muted">{t('What a babysitter link shows:')}</span>
      {sitters.map((l) => (
        <button key={l.id} className="linkish" onClick={() => onPick(l.id)}>
          <LinkSimple size={14} /> {l.name}
        </button>
      ))}
    </div>
  );
}

interface Selection {
  link: { id: number; name: string; custom: boolean; expires_at: string | null };
  cards: { id: number; title: string; area: string | null; shown: boolean }[];
  codes: { id: number; label: string; shown: boolean; until: string | null }[];
}

/** What one guest/sitter link shows – from the Away page ("Hausinfo für den Babysitter") or the list above. */
export function LinkSelectionSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const [sel, setSel] = useState<Selection | null>(null);
  const toast = useToast();
  useEffect(() => {
    get<Selection>(`/house-guide/links/${id}`).then(setSel).catch((e) => toast({ text: (e as Error).message, error: true }));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sel) return null;
  const save = async () => {
    try {
      setSel(await put<Selection>(`/house-guide/links/${id}`, { cards: sel.cards.filter((c) => c.shown).map((c) => c.id), codes: sel.codes.filter((c) => c.shown).map((c) => ({ id: c.id, until: c.until ?? sel.link.expires_at })) }));
      invalidate('house-guide');
      toast({ text: t('Saved – the link shows exactly this now.') });
      onClose();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  const reset = async () => {
    setSel(await del<Selection>(`/house-guide/links/${id}`));
    invalidate('house-guide');
  };
  return (
    <Sheet open onClose={onClose} title={t('House info for {name}', { name: sel.link.name })}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{sel.link.custom ? t('This link shows only what is ticked.') : t('Right now this link shows every card meant for babysitter links. Tick to choose exactly.')}</p>
        <b>{t('Cards')}</b>
        {sel.cards.map((c) => (
          <label key={c.id} className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={c.shown} onChange={(e) => setSel({ ...sel, cards: sel.cards.map((x) => (x.id === c.id ? { ...x, shown: e.target.checked } : x)) })} />
            {c.title}
            {c.area && <span className="small muted">· {c.area}</span>}
          </label>
        ))}
        {sel.codes.length > 0 && <b>{t('Codes')}</b>}
        {sel.codes.map((c) => (
          <label key={c.id} className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={c.shown} onChange={(e) => setSel({ ...sel, codes: sel.codes.map((x) => (x.id === c.id ? { ...x, shown: e.target.checked } : x)) })} />
            {c.label}
            <span className="small muted">· {t('until the link ends')}</span>
          </label>
        ))}
        <div className="row" style={{ gap: 8 }}>
          {sel.link.custom && <button className="btn ghost" onClick={reset}>{t('Back to default')}</button>}
          <button className="btn primary grow" onClick={save}>{t('Save')}</button>
        </div>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ guest / sitter page

const CACHE_KEY = (token: string) => `tohuus.house.${token.slice(-16)}`;

/** The Hausinfo tab on a guest link: cached on the device after the first visit (cards only – never code values). */
export function GuestHouse({ token, household }: { token: string; household: string }) {
  const [g, setG] = useState<Guide | null>(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY(token));
      return raw ? (JSON.parse(raw) as Guide) : null;
    } catch {
      return null;
    }
  });
  const [offline, setOffline] = useState(false);
  const [group, setGroup] = useState<Group>('area');
  const [query, setQuery] = useState('');
  const [print, setPrint] = useState(false);
  useEffect(() => {
    fetch(`/api/guest/${token}/house`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Guide) => {
        setG(d);
        setOffline(false);
        try {
          // masked codes only – the value is never part of this answer
          localStorage.setItem(CACHE_KEY(token), JSON.stringify(d));
        } catch {
          /* private mode */
        }
      })
      .catch(() => setOffline(true));
  }, [token]);
  const reveal = async (id: number): Promise<Revealed> => {
    const r = await fetch(`/api/guest/${token}/house/codes/${id}/reveal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error ?? t('Codes can only be shown with a connection.'));
    return d as Revealed;
  };
  if (!g) return <Skeleton h={120} n={2} />;
  if (print) return <PrintSheet g={g} household={household} reveal={reveal} onClose={() => setPrint(false)} allowCodes={false} />;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {offline && <div className="banner small">{t('No connection – you see the last saved version. Codes need a connection.')}</div>}
      <div className="row between wrap hg-tools">
        <Seg value={group} onChange={setGroup} label={t('Group by')} options={[['area', t('By room')], ['type', t('By kind')]]} />
        <button className="btn sm ghost" onClick={() => setPrint(true)}>
          <Printer size={16} /> {t('Print')}
        </button>
      </div>
      <input className="input" placeholder={t('Search, e.g. heating')} aria-label={t('Search house info')} value={query} onChange={(e) => setQuery(e.target.value)} />
      <GuideView g={g} reveal={reveal} group={group} query={query} />
    </div>
  );
}
