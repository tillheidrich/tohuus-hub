/**
 * Share area (web): the share landing page (/teilen), the iPhone shortcut setup, discreet/private item controls
 * for the shopping list and the start mode "only what runs out" (picker, Settings card, Today hint).
 */
import {
  ArrowLeft,
  ArrowRight,
  Basket,
  Check,
  ChefHat,
  ClipboardText,
  Copy,
  DeviceMobile,
  EyeSlash,
  FilePdf,
  Key,
  LinkSimple,
  ListChecks,
  LockSimple,
  Plus,
  Receipt,
  ShareNetwork,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Me } from '../App';
import { ApiError, api, del, get, invalidate, patch, post, put, relTime, useApi } from '../api';
import { t } from '../i18n';
import type { ShopItem } from '../shop/sections';
import { Avatar, Empty, Seg, Sheet, Skeleton, Thumb, Toggle, useToast } from '../ui';

// ================================================================== shared types

export type Visibility = 'all' | 'discreet' | 'private';
export interface ShareInfo {
  visibility: 'private' | 'discreet';
  mine: boolean;
  owner: string | null;
  revealed: boolean;
  share_with: number[];
  reveal: boolean;
  placeholder: string;
  /** on a private list – its privacy follows the list */
  list?: boolean;
}
interface Row {
  name: string;
  qty: number | null;
  unit: string | null;
  amount: string | null;
  product: { id: number; name: string; brand: string | null; image_path: string | null } | null;
  confident: boolean;
  on_list: boolean;
  include?: boolean;
  link?: boolean;
}
interface Parsed {
  text: string;
  urls: { url: string; recipe: boolean; receipt: boolean }[];
  items: Row[];
}
interface Payload {
  title: string;
  text: string;
  url: string;
  files: File[];
  /** where it came from, to clean up afterwards */
  source: { kind: 'cache' | 'inbox'; id: string } | null;
}

const SHARE_CACHE = 'tohuus-share';
const appName = (me?: Me) => (me?.brand === 'fredirando' ? 'Fredirando' : 'ToHuus Hub');
const visOptions = (): [Visibility, string][] => [
  ['all', t('Everyone')],
  ['discreet', t('Discreet')],
  ['private', t('Only me')],
];
const lineText = (r: Row) => [r.amount ?? (r.qty ? `${r.qty}${r.unit ? ` ${r.unit}` : ''}` : ''), r.name].filter(Boolean).join(' ');

/** Read the clipboard; null when the browser refuses (permission, insecure context). */
export async function readClipboard(): Promise<string | null> {
  try {
    const txt = await navigator.clipboard.readText();
    return txt?.trim() ? txt : '';
  } catch {
    return null;
  }
}

// ================================================================== share landing (/teilen)

async function loadPayload(sp: URLSearchParams): Promise<Payload> {
  const base: Payload = { title: sp.get('title') ?? '', text: sp.get('text') ?? '', url: sp.get('url') ?? '', files: [], source: null };
  const cacheId = sp.get('share');
  if (cacheId && /^[a-z0-9]+$/.test(cacheId) && 'caches' in window) {
    const cache = await caches.open(SHARE_CACHE);
    const metaRes = await cache.match(`/__share/${cacheId}/meta`);
    if (!metaRes) throw new Error(t('This share has expired. Please share it again.'));
    const meta = (await metaRes.json()) as { title: string; text: string; url: string; files: { n: number; name: string; type: string }[] };
    const files: File[] = [];
    for (const f of meta.files) {
      const r = await cache.match(`/__share/${cacheId}/${f.n}`);
      if (r) files.push(new File([await r.blob()], f.name, { type: f.type }));
    }
    return { title: meta.title, text: meta.text, url: meta.url, files, source: { kind: 'cache', id: cacheId } };
  }
  const inboxId = sp.get('inbox');
  if (inboxId) {
    const meta = await get<{ title: string; text: string; url: string; files: { n: number; name: string; type: string }[] }>(`/share/inbox/${encodeURIComponent(inboxId)}`);
    const files: File[] = [];
    for (const f of meta.files) {
      const r = await fetch(`/api/share/inbox/${encodeURIComponent(inboxId)}/${f.n}`, { credentials: 'same-origin' });
      if (r.ok) files.push(new File([await r.blob()], f.name, { type: f.type }));
    }
    return { title: meta.title || base.title, text: meta.text || base.text, url: meta.url || base.url, files, source: { kind: 'inbox', id: inboxId } };
  }
  return base;
}

async function forget(p: Payload | null) {
  if (!p?.source) return;
  try {
    if (p.source.kind === 'cache' && 'caches' in window) {
      const cache = await caches.open(SHARE_CACHE);
      const keys = await cache.keys();
      await Promise.all(keys.filter((k) => new URL(k.url).pathname.startsWith(`/__share/${p.source!.id}/`)).map((k) => cache.delete(k)));
    } else if (p.source.kind === 'inbox') await del(`/share/inbox/${encodeURIComponent(p.source.id)}`);
  } catch {
    /* nothing to clean */
  }
}

export function ShareLanding({ me }: { me: Me }) {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [vis, setVis] = useState<Visibility>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    let alive = true;
    loadPayload(sp)
      .then((p) => alive && setPayload(p))
      .catch((e) => {
        if (!alive) return;
        setLoadError((e as Error).message);
        setPayload({ title: '', text: '', url: '', files: [], source: null });
      });
    return () => {
      alive = false;
    };
  }, [sp]);

  const parse = async (p: { text: string; title?: string; url?: string }) => {
    if (!p.text.trim() && !p.url?.trim()) {
      setParsed({ text: '', urls: [], items: [] });
      setRows([]);
      return;
    }
    try {
      const r = await post<Parsed>('/share/parse', { text: p.text, title: p.title ?? null, url: p.url ?? null });
      setParsed(r);
      setDraft(r.text);
      setRows(r.items.map((x) => ({ ...x, include: !x.on_list || Boolean(x.qty), link: x.confident })));
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
      setParsed({ text: p.text, urls: [], items: [] });
    }
  };

  useEffect(() => {
    if (payload) void parse(payload);
  }, [payload]);

  const done = async (to: string) => {
    await forget(payload);
    nav(to, { replace: true });
  };

  const paste = async () => {
    const txt = await readClipboard();
    if (txt === null) return toast({ text: t('The browser didn’t allow reading the clipboard. Long-press the field and paste instead.'), error: true });
    if (!txt) return toast({ text: t('The clipboard is empty.'), error: true });
    await forget(payload);
    setPayload({ title: '', text: txt, url: '', files: [], source: null });
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast({ text: e instanceof ApiError || e instanceof Error ? e.message : t('Something went wrong'), error: true });
    } finally {
      setBusy(null);
    }
  };

  const images = (payload?.files ?? []).filter((f) => f.type.startsWith('image/'));
  const pdfs = (payload?.files ?? []).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
  const textFiles = (payload?.files ?? []).filter((f) => f.type.startsWith('text/'));

  // a shared .txt (e.g. an exported chat) is read like shared text
  useEffect(() => {
    if (!payload || !textFiles.length || payload.text) return;
    void textFiles[0].text().then((txt) => setPayload((p) => (p ? { ...p, text: txt.slice(0, 20000) } : p)));
  }, [payload, textFiles.length]);

  const importReceipt = () =>
    run('receipt', async () => {
      const form = new FormData();
      [...pdfs, ...images].forEach((f) => form.append('files', f, f.name));
      form.append('mode', 'receipt');
      const r = await api<{ results: { id?: number; error?: string }[] }>('/imports/upload', { form });
      const ok = r.results.find((x) => x.id);
      invalidate('imports', 'overview');
      if (ok?.id) return done(`/import/${ok.id}`);
      throw new Error(r.results.find((x) => x.error)?.error ?? t('Nothing could be read from it.'));
    });

  const importRecipePhoto = () =>
    run('recipe-photo', async () => {
      const form = new FormData();
      images.slice(0, 6).forEach((f) => form.append('files', f, f.name));
      const r = await api<{ id: number }>('/recipes/import/photo', { form });
      invalidate('recipes');
      await done(`/rezepte/${r.id}`);
    });

  const importRecipeUrl = (url: string) =>
    run(`recipe:${url}`, async () => {
      // the caption that came along with an Instagram/TikTok/… share is the recipe text (recipe-ai-import.ts)
      const r = await post<{ id: number; incomplete?: boolean }>('/recipes/import/url', { url, text: payload?.text ?? null }).catch(async (e) => {
        if ((e as { code?: string }).code !== 'cookidoo_confirm') throw e;
        // ToHuus Cloud: Cookidoo recipes are confirmed by hand in the cook screen
        await done(`/kochen?add=1&cookidoo=${encodeURIComponent(url)}`);
        return null;
      });
      if (!r) return;
      invalidate('recipes');
      toast({ text: r.incomplete ? t('The post had no recipe text – the link and photo are saved. Add the ingredients, or a photo of the recipe.') : t('Recipe saved') });
      await done(`/rezepte/${r.id}`);
    });

  const importReceiptUrl = (url: string) =>
    run(`receipt:${url}`, async () => {
      const r = await post<{ id: number }>('/imports/url', { url });
      invalidate('imports', 'overview');
      await done(`/import/${r.id}`);
    });

  const chosen = rows.filter((r) => r.include);
  const addToList = () =>
    run('list', async () => {
      if (vis === 'all') {
        const r = await post<{ added: { created: boolean }[] }>('/shop/quick-add', {
          items: chosen.map((x) => ({ name: x.name, qty: x.qty, unit: x.unit, amount: x.amount, product_id: x.link && x.product ? x.product.id : null })),
        });
        const n = r.added.filter((a) => a.created).length;
        toast({ text: n === 1 ? t('1 item added') : t('{n} items added', { n }) });
      } else {
        const r = await post<{ added: unknown[] }>('/share/items', { text: chosen.map(lineText).join('\n'), visibility: vis });
        toast({ text: vis === 'private' ? t('Added – only you can see it') : r.added.length === 1 ? t('Added discreetly') : t('{n} added discreetly', { n: r.added.length }) });
      }
      invalidate('shopping', 'overview');
      await done('/einkauf');
    });

  const set = (idx: number, p: Partial<Row>) => setRows((l) => l.map((x, i) => (i === idx ? { ...x, ...p } : x)));
  const hasSomething = Boolean(payload && (payload.files.length || payload.text.trim() || payload.url.trim()));

  return (
    <div className="share-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Shared with {app}', { app: appName(me) })}</div>
          <h1>{hasSomething ? t('Where should it go?') : t('Share something')}</h1>
        </div>
        <div className="actions">
          <button className="btn" onClick={paste}>
            <ClipboardText size={16} /> {t('Paste')}
          </button>
        </div>
      </header>

      {loadError && <div className="banner warn small" style={{ marginBottom: 14 }}>{loadError}</div>}
      {sp.get('error') === 'signin' && <div className="banner warn small" style={{ marginBottom: 14 }}>{t('You were signed out, so the files couldn’t be kept. Please share them again.')}</div>}

      {!payload || (hasSomething && !parsed) ? (
        <Skeleton n={3} h={72} />
      ) : !hasSomething ? (
        <div className="card">
          <Empty icon={<ShareNetwork size={26} />} title={t('Nothing was shared')} action={{ label: t('Paste from clipboard'), onClick: paste, icon: <ClipboardText size={15} /> }}>
            {t('Share a WhatsApp list, a recipe link or a receipt photo from another app – or copy a list and paste it here.')}
          </Empty>
        </div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {payload.files.length > 0 && (
            <section className="card pad stack" style={{ gap: 12 }}>
              <div className="share-files">
                {payload.files.map((f, i) => (
                  <FilePreview key={i} f={f} />
                ))}
              </div>
              {(pdfs.length > 0 || images.length > 0) && (
                <div className="share-actions">
                  <button className="btn primary" disabled={busy !== null || (!pdfs.length && !me.features.vision)} onClick={importReceipt}>
                    <Receipt size={16} /> {busy === 'receipt' ? t('Reading …') : t('Import as receipt')}
                  </button>
                  {images.length > 0 && (
                    <button className="btn" disabled={busy !== null || !me.features.vision} onClick={importRecipePhoto}>
                      <ChefHat size={16} /> {busy === 'recipe-photo' ? t('Reading …') : t('Save as recipe')}
                    </button>
                  )}
                </div>
              )}
              {images.length > 0 && !me.features.vision && (
                <div className="small muted">{t('Reading photos needs a vision model (Settings → Access & AI). PDFs from REWE and most supermarkets work without one.')}</div>
              )}
            </section>
          )}

          {parsed && (rows.length > 0 || parsed.text || editing) && (
            <section className="card pad stack" style={{ gap: 12 }}>
              <div className="row between">
                <div className="eyebrow row" style={{ gap: 6 }}>
                  <Basket size={14} /> {t('To the shopping list')}
                </div>
                <button className="linkish" onClick={() => setEditing((v) => !v)}>
                  {editing ? t('Done') : t('Edit text')}
                </button>
              </div>
              {editing && (
                <textarea
                  className="input"
                  rows={5}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => parse({ text: draft })}
                  aria-label={t('Shared text')}
                />
              )}
              {rows.length === 0 ? (
                <div className="small muted">{t('No list items found in the text. Edit it above, or pick one of the other options.')}</div>
              ) : (
                <div className="list">
                  {rows.map((r, idx) => (
                    <div key={idx} className={`qa-row ${r.include ? '' : 'off'}`}>
                      <button className={`check ${r.include ? 'on' : ''}`} onClick={() => set(idx, { include: !r.include })} aria-label={r.include ? t('Leave out') : t('Include')}>
                        <Check size={15} weight="bold" />
                      </button>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="title">
                          {r.qty ? <span className="qa-qty">{String(r.qty).replace('.', ',')}{r.unit ? ` ${r.unit}` : '×'}</span> : null}
                          {r.amount ? <span className="qa-qty">{r.amount}</span> : null}
                          {r.name}
                        </div>
                        {r.product && (
                          <button className={`qa-link ${r.link ? 'on' : ''}`} onClick={() => set(idx, { link: !r.link })}>
                            {r.product.image_path && <Thumb p={r.product} size={20} />}
                            {r.link ? t('as {product}', { product: [r.product.brand, r.product.name].filter(Boolean).join(' ') }) : t('Use {product}?', { product: r.product.name })}
                          </button>
                        )}
                        {r.on_list && <div className="sub">{t('already on the list')}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {rows.length > 0 && (
                <>
                  <div className="share-vis">
                    <span className="small muted">{t('Who sees it?')}</span>
                    <Seg value={vis} onChange={setVis} options={visOptions()} />
                  </div>
                  <button className="btn primary block" disabled={busy !== null || chosen.length === 0} onClick={addToList}>
                    <Plus size={16} /> {chosen.length === 1 ? t('Add 1 item') : t('Add {n} items', { n: chosen.length })}
                  </button>
                </>
              )}
            </section>
          )}

          {parsed && parsed.urls.length > 0 && (
            <section className="stack" style={{ gap: 10 }}>
              {parsed.urls.map((u) => (
                <div key={u.url} className="card pad share-link">
                  <span className="thumb" style={{ width: 40, height: 40 }}>
                    {u.recipe ? <ChefHat size={20} /> : <LinkSimple size={20} />}
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b>{u.recipe ? t('Recipe link') : t('Link')}</b>
                    <div className="small muted share-url">{hostOf(u.url)}</div>
                  </div>
                  <div className="share-actions">
                    <button className={`btn ${u.recipe || !u.receipt ? 'primary' : ''}`} disabled={busy !== null} onClick={() => importRecipeUrl(u.url)}>
                      <ChefHat size={16} /> {busy === `recipe:${u.url}` ? t('Importing …') : t('Import recipe')}
                    </button>
                    {!u.recipe && (
                      <button className={`btn ${u.receipt ? 'primary' : ''}`} disabled={busy !== null} onClick={() => importReceiptUrl(u.url)}>
                        <Receipt size={16} /> {busy === `receipt:${u.url}` ? t('Importing …') : t('Digital receipt')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}

          <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => done('/')}>
            <X size={16} /> {t('Discard')}
          </button>
        </div>
      )}
    </div>
  );
}

function hostOf(url: string) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname : '');
  } catch {
    return url;
  }
}

function FilePreview({ f }: { f: File }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!f.type.startsWith('image/')) return;
    const u = URL.createObjectURL(f);
    setSrc(u);
    return () => URL.revokeObjectURL(u);
  }, [f]);
  return (
    <div className="share-file" title={f.name}>
      {src ? <img src={src} alt="" /> : <span className="ic">{f.type.startsWith('text/') ? <ClipboardText size={22} /> : <FilePdf size={22} />}</span>}
      <span className="nm">{f.name}</span>
    </div>
  );
}

// ================================================================== shopping list: discreet / private

/** Small marker + sub-line for a discreet/private row. */
export function shareSubline(s: ShareInfo | undefined): string | null {
  if (!s) return null;
  if (s.mine) {
    if (s.visibility === 'private') return s.share_with.length ? t('Only you and {n} more', { n: s.share_with.length }) : t('Only you');
    return t('Others see “{placeholder}”', { placeholder: s.placeholder });
  }
  if (s.revealed) return t('Shown to you because you’re shopping');
  if (s.visibility === 'private') return s.owner ? t('Shared with you by {name}', { name: s.owner }) : t('Private');
  return t('Discreet');
}

export function ShareMark({ s, size = 14 }: { s?: ShareInfo; size?: number }) {
  if (!s) return null;
  const I = s.visibility === 'private' ? LockSimple : EyeSlash;
  return (
    <span className="share-mark" aria-label={s.visibility === 'private' ? t('Private') : t('Discreet')}>
      <I size={size} weight="bold" />
    </span>
  );
}

/** Visibility toggle in the shopping-list composer: the next add goes in discreetly / privately. */
export function ComposerVisibility({ value, open, onToggle }: { value: Visibility; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`icon-btn plain share-vis-btn ${value !== 'all' ? 'on' : ''}`}
      aria-label={t('Who sees it?')}
      aria-expanded={open}
      aria-pressed={value !== 'all'}
      onClick={onToggle}
    >
      {value === 'private' ? <LockSimple size={18} /> : <EyeSlash size={18} />}
    </button>
  );
}

/** The choice itself, shown right under the composer while open. */
export function VisibilityPanel({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  return (
    <div className="card pad share-vis-panel">
      <Seg value={value} onChange={onChange} options={visOptions()} />
      <div className="small muted">
        {value === 'private'
          ? t('Only you see the next item. It never shows up in Home Assistant, Telegram, displays or printed lists.')
          : value === 'discreet'
            ? t('Everyone sees a neutral placeholder like “Drugstore item”. Only you see the real name.')
            : t('Make the next item discreet or private.')}
      </div>
    </div>
  );
}

/** Add text discreetly/privately (composer). */
export async function addHiddenText(text: string, visibility: Exclude<Visibility, 'all'>) {
  return post<{ added: { id: number; text: string; placeholder: string }[] }>('/share/items', { text, visibility });
}

/** "Who sees it?" in the item sheet. */
export function ItemPrivacy({ item, me, members, onDone }: { item: ShopItem & { share?: ShareInfo }; me?: Me; members: { id: number; name: string; color: string }[]; onDone: () => void }) {
  const s = item.share;
  const toast = useToast();
  const [vis, setVis] = useState<Visibility>(s?.visibility ?? 'all');
  const [shareWith, setShareWith] = useState<number[]>(s?.share_with ?? []);
  const [reveal, setReveal] = useState(Boolean(s?.reveal));
  const [placeholder, setPlaceholder] = useState(s?.placeholder ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setVis(s?.visibility ?? 'all');
    setShareWith(s?.share_with ?? []);
    setReveal(Boolean(s?.reveal));
    setPlaceholder(s?.placeholder ?? '');
  }, [item.id]);
  if (me?.actor.kind !== 'user') return null;
  // a row on a private list follows the list (13 Oct 2026) – change who sees the list instead
  if (s?.list)
    return (
      <div className="share-note small">
        <ShareMark s={s} />
        <span>{t('This is on a private list. Who sees it is set for the whole list.')}</span>
      </div>
    );
  if (s && !s.mine && s.owner)
    return (
      <div className="share-note small">
        <ShareMark s={s} />
        <span>
          {s.visibility === 'private'
            ? t('{name} shared this with you. Only {name} can change who sees it.', { name: s.owner })
            : s.revealed
              ? t('{name} added this discreetly and lets whoever shops see it. Please keep it to yourself.', { name: s.owner })
              : s.reveal
                ? t('Added discreetly. Tap “Me” above or open the store view to see what it is.')
                : t('Added discreetly. You can still tick it off when it’s bought.')}
        </span>
      </div>
    );
  const dirty =
    vis !== (s?.visibility ?? 'all') ||
    (vis === 'private' && JSON.stringify([...shareWith].sort()) !== JSON.stringify([...(s?.share_with ?? [])].sort())) ||
    (vis === 'discreet' && (reveal !== Boolean(s?.reveal) || (placeholder.trim() !== '' && placeholder.trim() !== (s?.placeholder ?? ''))));
  const save = async () => {
    setBusy(true);
    try {
      await patch(`/share/items/${item.id}`, { visibility: vis, share_with: shareWith, reveal, placeholder: placeholder.trim() || null });
      invalidate('shopping', 'overview');
      toast({ text: vis === 'all' ? t('Visible to everyone again') : vis === 'private' ? t('Only you can see it now') : t('Now discreet') });
      onDone();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const others = members.filter((m) => m.id !== me.actor.userId);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="eyebrow row" style={{ gap: 6 }}>
        <EyeSlash size={14} /> {t('Who sees it?')}
      </div>
      <Seg value={vis} onChange={setVis} options={visOptions()} />
      {vis === 'private' && others.length > 0 && (
        <>
          <div className="small muted">{t('Also visible to (optional):')}</div>
          <div className="share-chips">
            {others.map((m) => {
              const on = shareWith.includes(m.id);
              return (
                <button key={m.id} className={`chip ${on ? 'on' : ''}`} onClick={() => setShareWith(on ? shareWith.filter((x) => x !== m.id) : [...shareWith, m.id])}>
                  <Avatar name={m.name} color={m.color} size={20} /> {m.name}
                </button>
              );
            })}
          </div>
        </>
      )}
      {vis === 'discreet' && (
        <>
          <input className="input" value={placeholder} maxLength={60} onChange={(e) => setPlaceholder(e.target.value)} placeholder={t('What others see, e.g. “Drugstore item”')} aria-label={t('What others see')} />
          <label className="row between small" style={{ gap: 12 }}>
            <span>
              <b>{t('Show to whoever shops')}</b>
              <div className="muted">{t('The person with the store view open, or who said “I’ll get it”, sees the real name.')}</div>
            </span>
            <Toggle on={reveal} onChange={setReveal} label={t('Show to whoever shops')} />
          </label>
        </>
      )}
      {vis !== 'all' && <div className="small muted">{t('Never shown in Home Assistant, Telegram, displays, printed lists, guest links or to assistants.')}</div>}
      {dirty && (
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={save}>
          {t('Save')}
        </button>
      )}
    </div>
  );
}

// ================================================================== iPhone shortcut / share setup (Settings → My account)

interface TokenRow {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export function ShareSetupCard({ me }: { me: Me }) {
  const tokens = useApi<TokenRow[]>(['share', 'tokens'], '/share/tokens', { enabled: me.actor.kind === 'user' });
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (me.actor.kind !== 'user') return null;
  const endpoint = `${location.origin}/api/share/text`;
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast({ text: t('Copied') });
    } catch {
      toast({ text: t('Copying isn’t allowed here – select the text and copy it by hand.'), error: true });
    }
  };
  const create = async () => {
    setBusy(true);
    try {
      const r = await post<{ token: string }>('/share/tokens', { name: 'iPhone' });
      setFresh(r.token);
      invalidate('share');
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: number) => {
    await del(`/share/tokens/${id}`);
    invalidate('share');
    toast({ text: t('Key removed – the shortcut stops working') });
  };
  return (
    <section className="card pad stack" style={{ gap: 14, marginTop: 22 }}>
      <div>
        <h2 style={{ margin: 0 }}>{t('Share into {app} from other apps', { app: appName(me) })}</h2>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          {t('Send a WhatsApp list, a recipe link or a receipt photo straight to the shopping list or the imports.')}
        </p>
      </div>
      <div className="share-howto">
        <span className="thumb" style={{ width: 36, height: 36 }}><ShareNetwork size={18} /></span>
        <div className="small">
          <b>{t('Android and computer')}</b>
          <div className="muted">{t('Install the app (browser menu → “Add to home screen” or “Install”). After that, {app} shows up in the share menu of every app.', { app: appName(me) })}</div>
        </div>
      </div>
      <div className="share-howto">
        <span className="thumb" style={{ width: 36, height: 36 }}><DeviceMobile size={18} /></span>
        <div className="small grow">
          <b>{t('iPhone and iPad')}</b>
          <div className="muted">{t('iOS doesn’t offer the share menu to web apps. A shortcut with your personal key does the job – it can only put things on the shopping list.')}</div>
        </div>
      </div>
      {fresh ? (
        <div className="share-key stack" style={{ gap: 10 }}>
          <div className="small"><b>{t('Your key (shown only once)')}</b></div>
          <div className="share-copy">
            <code>{fresh}</code>
            <button className="icon-btn" onClick={() => copy(fresh)} aria-label={t('Copy')}><Copy size={16} /></button>
          </div>
          <ol className="share-steps small">
            <li>{t('Open the Shortcuts app → “+” → name it “To the list”.')}</li>
            <li>{t('Tap the “i” (details) → turn on “Show in Share Sheet”, accept Text and URLs.')}</li>
            <li>
              {t('Add the action “Get Contents of URL” with this address:')}
              <div className="share-copy">
                <code>{endpoint}</code>
                <button className="icon-btn" onClick={() => copy(endpoint)} aria-label={t('Copy')}><Copy size={16} /></button>
              </div>
            </li>
            <li>{t('Method: POST. Headers: “Authorization” = “Bearer ” followed by your key. Request body: JSON with a text field “text” = Shortcut Input.')}</li>
            <li>{t('Optional: add “Show Notification” with the result – it tells you what was added.')}</li>
            <li>{t('Done: in WhatsApp, select a message → Share → “To the list”.')}</li>
          </ol>
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setFresh(null)}>{t('I’ve copied it')}</button>
        </div>
      ) : (
        <button className="btn share-wrap-btn" disabled={busy} onClick={create}>
          <Key size={16} /> {t('Create a key for the iPhone shortcut')}
        </button>
      )}
      {tokens.isLoading ? (
        <Skeleton n={1} h={44} />
      ) : tokens.error ? (
        <div className="small" style={{ color: 'var(--empty)' }}>{(tokens.error as Error).message}</div>
      ) : (tokens.data ?? []).length > 0 ? (
        <div className="list">
          {tokens.data!.map((k) => (
            <div key={k.id} className="li">
              <Key size={16} />
              <div className="grow small">
                <b>{k.name}</b> <span className="muted">{k.prefix}…</span>
                <div className="muted">{k.last_used_at ? t('last used {when}', { when: relTime(k.last_used_at) }) : t('not used yet')}</div>
              </div>
              <button className="icon-btn plain" onClick={() => revoke(k.id)} aria-label={t('Remove key')}><Trash size={16} /></button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="small muted">{t('Tip: copied a list? The shopping list has a paste button next to the input field.')}</div>
    </section>
  );
}

// ================================================================== start mode "only what runs out"

interface Picker {
  mode: 'full' | 'staples';
  groups: { key: string; label: string; items: { key: string; name: string; product_id: number | null; on: boolean }[] }[];
  own: { id: number; name: string; brand: string | null; image_path: string | null }[];
  suggestions: { id: number; name: string; brand: string | null; image_path: string | null; times: number }[];
  count: number;
}

/** One screen: tap what regularly runs out at home. Everything else simply isn't tracked. */
export function StaplesPicker({ onSaved, onCancel, switchMode = false }: { onSaved: () => void; onCancel?: () => void; switchMode?: boolean }) {
  const q = useApi<Picker>(['share', 'staples'], '/share/staples');
  const [keys, setKeys] = useState<Set<string> | null>(null);
  const [ids, setIds] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!q.data || keys) return;
    setKeys(new Set(q.data.groups.flatMap((g) => g.items.filter((i) => i.on).map((i) => i.key))));
    setIds(new Set(q.data.own.map((o) => o.id)));
  }, [q.data]);
  if (q.isLoading || (q.data && !keys)) return <Skeleton n={4} h={56} />;
  if (q.error || !q.data)
    return (
      <div className="card">
        <Empty icon={<ListChecks size={26} />} title={t('The list couldn’t be loaded')} action={{ label: t('Try again'), onClick: () => q.refetch() }} />
      </div>
    );
  const k = keys!;
  const n = k.size + ids.size;
  const toggleKey = (key: string) => setKeys((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const toggleId = (id: number) => setIds((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const save = async () => {
    setBusy(true);
    try {
      const r = await put<{ count: number; created: number }>('/share/staples', { keys: [...k], product_ids: [...ids], mode: switchMode ? 'staples' : undefined });
      invalidate('products', 'overview', 'share', 'fresh', 'onboarding', 'shopping');
      toast({ text: r.count === 1 ? t('1 thing is tracked') : t('{n} things are tracked', { n: r.count }) });
      onSaved();
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      <p className="small muted" style={{ margin: 0 }}>
        {t('Tap what regularly runs out at your place. Only these are tracked – no counting, no warnings for anything else. We assume you have them now; tap “low” when one runs low and it lands on the shopping list.')}
      </p>
      {q.data.suggestions.length > 0 && (
        <section>
          <div className="eyebrow" style={{ marginBottom: 8 }}>{t('Bought more than once')}</div>
          <div className="share-chips">
            {q.data.suggestions.map((s) => (
              <button key={s.id} className={`chip ${ids.has(s.id) ? 'on' : ''}`} onClick={() => toggleId(s.id)} aria-pressed={ids.has(s.id)}>
                {ids.has(s.id) ? <Check size={13} weight="bold" /> : <Plus size={13} />} {s.name}
              </button>
            ))}
          </div>
        </section>
      )}
      {q.data.own.length > 0 && (
        <section>
          <div className="eyebrow" style={{ marginBottom: 8 }}>{t('Your own')}</div>
          <div className="share-chips">
            {q.data.own.map((o) => (
              <button key={o.id} className={`chip ${ids.has(o.id) ? 'on' : ''}`} onClick={() => toggleId(o.id)} aria-pressed={ids.has(o.id)}>
                {ids.has(o.id) && <Check size={13} weight="bold" />} {o.name}
              </button>
            ))}
          </div>
        </section>
      )}
      {q.data.groups.map((g) => (
        <section key={g.key}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>{g.label}</div>
          <div className="share-chips">
            {g.items.map((i) => (
              <button key={i.key} className={`chip ${k.has(i.key) ? 'on' : ''}`} onClick={() => toggleKey(i.key)} aria-pressed={k.has(i.key)}>
                {k.has(i.key) && <Check size={13} weight="bold" />} {i.name}
              </button>
            ))}
          </div>
        </section>
      ))}
      <div className="small muted">{t('Missing something? Mark any product as “runs out regularly” on its page – Today also suggests what you bought more than once.')}</div>
      <div className="onb-foot sticky">
        {onCancel ? (
          <button className="btn ghost" onClick={onCancel}>
            <ArrowLeft size={16} /> {t('Back')}
          </button>
        ) : (
          <span />
        )}
        <button className="btn primary lg" disabled={busy || n === 0} onClick={save}>
          {n === 1 ? t('Track this 1 thing') : t('Track these {n} things', { n })}
        </button>
      </div>
    </div>
  );
}

interface ModeInfo {
  mode: 'full' | 'staples';
  staples: number;
  products: number;
}

/** Settings → Household: switch between "everything" and "only what runs out" (no data is lost either way). */
export function StartModeCard({ admin }: { admin: boolean }) {
  const q = useApi<ModeInfo>(['share', 'mode'], '/share/start-mode');
  const [picker, setPicker] = useState(false);
  // switching to the start mode with nothing picked yet: pick first, the mode follows on save
  const [switching, setSwitching] = useState(false);
  const toast = useToast();
  const setMode = async (mode: 'full' | 'staples') => {
    if (mode === 'staples' && !q.data?.staples) {
      setSwitching(true);
      return setPicker(true);
    }
    try {
      await put('/share/start-mode', { mode });
      invalidate('share', 'overview', 'products', 'fresh');
      toast({ text: mode === 'full' ? t('Everything is tracked again – nothing was lost') : t('Only what runs out is tracked now') });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section className="card pad stack" style={{ gap: 12 }}>
      <div>
        <h2 style={{ margin: 0 }}>{t('What should be tracked?')}</h2>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          {t('Starting small helps: track only the things that regularly run out. You can switch to everything at any time – nothing is deleted.')}
        </p>
      </div>
      {q.isLoading ? (
        <Skeleton n={1} h={40} />
      ) : q.error || !q.data ? (
        <div className="small" style={{ color: 'var(--empty)' }}>{t('Couldn’t load the setting.')}</div>
      ) : (
        <>
          <Seg
            value={q.data.mode}
            onChange={(v) => (admin ? setMode(v) : toast({ text: t('Only admins can change this.'), error: true }))}
            options={[
              ['staples', t('Only what runs out')],
              ['full', t('Everything')],
            ]}
          />
          <div className="small muted">
            {q.data.mode === 'staples'
              ? t('{n} things are tracked. Everything else is simply not counted and never warned about.', { n: q.data.staples })
              : t('Everything in stock is tracked, with warnings when it runs low or should be used.')}
          </div>
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setPicker(true)}>
            <ListChecks size={16} /> {t('Choose what runs out')}
          </button>
        </>
      )}
      <Sheet open={picker} onClose={() => { setPicker(false); setSwitching(false); }} title={t('What runs out at your place?')} wide>
        {picker && <StaplesPicker switchMode={admin && switching} onSaved={() => { setPicker(false); setSwitching(false); }} />}
        {picker && admin && q.data?.mode === 'full' && !switching && (
          <div className="small muted" style={{ marginTop: 10 }}>{t('Saving the list doesn’t change the mode. Switch to “Only what runs out” above when you’re ready.')}</div>
        )}
      </Sheet>
    </section>
  );
}

/** Today: in the start mode, a quiet hint with receipt suggestions ("you bought this twice – track it?"). */
export function StartModeHint() {
  const nav = useNavigate();
  const toast = useToast();
  const info = useApi<ModeInfo>(['share', 'mode'], '/share/start-mode');
  const picker = useApi<Picker>(['share', 'staples'], '/share/staples', { enabled: info.data?.mode === 'staples' });
  const [hidden, setHidden] = useState<number[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('sw.share.hideSuggest') ?? '[]');
    } catch {
      return [];
    }
  });
  const sugg = useMemo(() => (picker.data?.suggestions ?? []).filter((s) => !hidden.includes(s.id)).slice(0, 4), [picker.data, hidden]);
  if (info.data?.mode !== 'staples') return null;
  const hide = (id: number) => {
    const next = [...hidden, id].slice(-200);
    setHidden(next);
    try {
      localStorage.setItem('sw.share.hideSuggest', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const track = async (id: number, name: string) => {
    try {
      await post(`/share/staples/${id}`, { on: true });
      invalidate('share', 'overview', 'products');
      toast({ text: t('{name} is tracked now', { name }) });
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    }
  };
  return (
    <section className="card pad share-hint" style={{ marginTop: 14 }}>
      <div className="row between" style={{ gap: 10 }}>
        <div className="small">
          <b>{t('Only what runs out')}</b>
          <div className="muted">{info.data.staples === 1 ? t('1 thing is tracked.') : t('{n} things are tracked.', { n: info.data.staples })}</div>
        </div>
        <button className="btn sm ghost" onClick={() => nav('/einstellungen?tab=home')}>
          {t('Change')} <ArrowRight size={14} />
        </button>
      </div>
      {sugg.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="small muted" style={{ marginBottom: 6 }}>{t('Bought more than once – track it too?')}</div>
          <div className="share-chips">
            {sugg.map((s) => (
              <span key={s.id} className="share-sugg">
                <button className="chip" onClick={() => track(s.id, s.name)}>
                  <Plus size={13} /> {s.name}
                </button>
                <button className="icon-btn plain sm" onClick={() => hide(s.id)} aria-label={t('Not this one')}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/** Product page: "runs out regularly" – the products tracked in the start mode. */
export function RunsOutRow({ p }: { p: { id: number; track_mode: string; kind?: string | null; runs_out?: number | boolean | null } }) {
  const mode = useApi<ModeInfo>(['share', 'mode'], '/share/start-mode');
  const toast = useToast();
  const [on, setOn] = useState(Boolean(p.runs_out));
  useEffect(() => setOn(Boolean(p.runs_out)), [p.id, p.runs_out]);
  if (p.track_mode === 'none' || p.kind === 'leftover') return null;
  const change = async (v: boolean) => {
    setOn(v);
    try {
      await post(`/share/staples/${p.id}`, { on: v });
      invalidate('product', 'products', 'overview', 'share');
    } catch (e) {
      setOn(!v);
      toast({ text: (e as Error).message, error: true });
    }
  };
  const staples = mode.data?.mode === 'staples';
  return (
    <div className="card pad row between" style={{ gap: 12 }}>
      <div className="small">
        <b>{t('Runs out regularly')}</b>
        <div className="muted">
          {staples
            ? on
              ? t('Tracked – you’ll be reminded when it runs low.')
              : t('Not tracked right now: your household only tracks what runs out.')
            : t('Used by the start mode “only what runs out”.')}
        </div>
      </div>
      <Toggle on={on} onChange={change} label={t('Runs out regularly')} />
    </div>
  );
}
