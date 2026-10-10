import { ArrowsClockwise, Camera, ChefHat, Heart, Link as LinkIcon, MagnifyingGlass, Plus, TextAa, ThumbsDown, ThumbsUp } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Me } from '../App';
import { api, invalidate, post, useApi } from '../api';
import { Empty, Seg, Sheet, Skeleton, useToast } from '../ui';

export function Cook({ me }: { me: Me }) {
  const [tm, setTm] = useState<'all' | 'tm' | 'no'>('all');
  const sugg = useApi<any[]>(['suggest', tm], `/recipes/suggest?limit=20${tm === 'tm' ? '&thermomix=1' : tm === 'no' ? '&thermomix=0' : ''}`);
  const recipes = useApi<any[]>('recipes', '/recipes');
  const [idx, setIdx] = useState(0);
  const [q, setQ] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const nav = useNavigate();
  const deck = sugg.data ?? [];
  const cur = deck[idx % Math.max(1, deck.length)];
  const next = deck[(idx + 1) % Math.max(1, deck.length)];
  const list = useMemo(() => {
    const n = q.toLowerCase().trim();
    return (recipes.data ?? []).filter((r) => !n || `${r.title} ${r.tags.join(' ')}`.toLowerCase().includes(n));
  }, [recipes.data, q]);

  return (
    <div>
      <header className="page-head">
        <div>
          <div className="eyebrow">{recipes.data?.length ?? 0} Rezepte</div>
          <h1>Was kochen wir?</h1>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => setImportOpen(true)}>
            <Plus size={16} weight="bold" /> Rezept
          </button>
        </div>
      </header>

      <div className="row between wrap" style={{ marginBottom: 14 }}>
        <Seg value={tm} onChange={(v) => { setTm(v); setIdx(0); }} options={[['all', 'Alle'], ['tm', 'Thermomix'], ['no', 'Ohne']]} />
        {deck.length > 1 && (
          <button className="linkish row" onClick={() => setIdx(idx + 1)}>
            <ArrowsClockwise size={14} /> nächste Idee
          </button>
        )}
      </div>

      {sugg.isLoading ? (
        <div className="skel" style={{ height: 420, maxWidth: 420, margin: '0 auto', borderRadius: 26 }} />
      ) : !cur ? (
        <div className="card">
          <Empty icon={<ChefHat size={26} />} title="Noch keine Vorschläge">
            Füge ein paar Lieblingsrezepte hinzu – per Link, Foto (z. B. HelloFresh-Karte) oder über Claude/ChatGPT.
          </Empty>
        </div>
      ) : (
        <>
          <div className="deck">
            {next && next !== cur && <DeckCard s={next} behind />}
            <DeckCard key={`${cur.recipe.id}-${idx}`} s={cur} onSwipe={(dir) => (dir > 0 ? nav(`/rezepte/${cur.recipe.id}`) : setIdx(idx + 1))} />
          </div>
          <div className="deck-actions">
            <button className="round" onClick={() => setIdx(idx + 1)} aria-label="Lieber nicht">
              <ThumbsDown size={24} />
            </button>
            <button className="round yes" onClick={() => nav(`/rezepte/${cur.recipe.id}`)} aria-label="Das kochen wir">
              <ThumbsUp size={24} weight="fill" />
            </button>
          </div>
          <p className="small muted" style={{ textAlign: 'center', marginTop: 10 }}>
            Wischen oder tippen. Sortiert nach Vorrat, Ablaufdaten, Favoriten und wie lange es her ist.
          </p>
        </>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Rezeptsammlung</h2>
        </div>
        <div className="searchbar" style={{ marginBottom: 12 }}>
          <MagnifyingGlass size={18} />
          <input className="input" placeholder="Rezepte durchsuchen" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {recipes.isLoading ? (
          <Skeleton n={2} h={180} />
        ) : (
          <div className="rgrid">
            {list.map((r) => (
              <div key={r.id} className="rcard" onClick={() => nav(`/rezepte/${r.id}`)}>
                <div className="img">
                  {r.image_path ? <img src={r.image_path} alt="" loading="lazy" /> : <ChefHat size={30} />}
                  {r.thermomix && <span className="tmchip">TM</span>}
                  {r.favorite && <Heart className="fav" size={20} weight="fill" />}
                </div>
                <div className="body">
                  <b>{r.title}</b>
                  <span className="small muted">
                    {[r.time_min ? `${r.time_min} Min.` : null, r.cook_count ? `${r.cook_count}× gekocht` : 'noch nie gekocht'].filter(Boolean).join(' · ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <RecipeImport open={importOpen} onClose={() => setImportOpen(false)} vision={me.features.vision} />
    </div>
  );
}

function DeckCard({ s, behind = false, onSwipe }: { s: any; behind?: boolean; onSwipe?: (dir: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dx, setDx] = useState(0);
  const r = s.recipe;
  const onDown = (e: React.PointerEvent) => {
    if (behind) return;
    start.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    setDx(e.clientX - start.current.x);
  };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    if (Math.abs(dx) > 110) {
      const dir = Math.sign(dx);
      setDx(dir * 600);
      setTimeout(() => onSwipe?.(dir), 180);
    } else setDx(0);
  };
  const style: React.CSSProperties = behind
    ? { transform: 'scale(0.94) translateY(14px)', opacity: 0.7 }
    : { transform: `translateX(${dx}px) rotate(${dx / 22}deg)`, transition: start.current ? 'none' : undefined };
  return (
    <div ref={ref} className="dcard" style={style} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {r.image_path ? <img className="bg" src={r.image_path} alt="" draggable={false} /> : <div className="pattern" />}
      <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
        {r.thermomix && <span className="badge" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }}>Thermomix</span>}
        {r.time_min && <span className="badge" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }}>{r.time_min} Min.</span>}
        <span className="badge" style={{ background: s.missing.length ? 'rgba(255,255,255,.18)' : 'var(--accent)', color: '#fff' }}>
          {s.have}/{s.need} Zutaten da
        </span>
      </div>
      <h2>{r.title}</h2>
      <p style={{ margin: '8px 0 0', opacity: 0.85, fontSize: 14 }}>{s.reasons.join(' · ')}</p>
      {dx !== 0 && !behind && (
        <div
          style={{
            position: 'absolute',
            top: 20,
            [dx > 0 ? 'left' : 'right']: 20,
            padding: '6px 12px',
            borderRadius: 10,
            fontWeight: 800,
            letterSpacing: '.06em',
            border: '2px solid #fff',
            opacity: Math.min(1, Math.abs(dx) / 110),
          }}
        >
          {dx > 0 ? 'LECKER' : 'HEUTE NICHT'}
        </div>
      )}
    </div>
  );
}

export function RecipeImport({ open, onClose, vision }: { open: boolean; onClose: () => void; vision: boolean }) {
  const [mode, setMode] = useState<'url' | 'photo' | 'text' | 'new'>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const toast = useToast();
  const done = (id: number) => {
    invalidate('recipes', 'suggest');
    onClose();
    nav(`/rezepte/${id}`);
  };
  const run = async (fn: () => Promise<{ id: number }>) => {
    setBusy(true);
    try {
      done((await fn()).id);
    } catch (e) {
      toast({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Rezept hinzufügen">
      <div className="stack">
        <Seg value={mode} onChange={setMode} options={[['url', 'Link'], ['photo', 'Foto'], ['text', 'Text'], ['new', 'Leer']]} />
        {mode === 'url' && (
          <>
            <div className="field">
              <label>Link zum Rezept</label>
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cookidoo.de/recipes/… oder Chefkoch, HelloFresh …" inputMode="url" />
              <div className="help">Funktioniert mit fast allen Rezeptseiten. Bei Cookidoo kommen Zutaten und Bild mit, die Schritte nur mit Login.</div>
            </div>
            <button className="btn primary lg" disabled={!url || busy} onClick={() => run(() => post('/recipes/import/url', { url }))}>
              <LinkIcon size={18} /> {busy ? 'Lese Rezept …' : 'Importieren'}
            </button>
          </>
        )}
        {mode === 'photo' && (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              Ein oder mehrere Fotos derselben Karte (z. B. HelloFresh Vorder- und Rückseite). {vision ? '' : 'Hinweis: Auf diesem Server ist kein Vision-Modell eingerichtet. Schick das Foto stattdessen an Claude oder ChatGPT – mit der Stockwerk-Verbindung speichern die es direkt hier.'}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const files = e.target.files;
                if (!files?.length) return;
                const fd = new FormData();
                [...files].forEach((f) => fd.append('files', f));
                run(() => api('/recipes/import/photo', { form: fd }));
              }}
            />
            <button className="btn primary lg" disabled={busy || !vision} onClick={() => fileRef.current?.click()}>
              <Camera size={18} /> {busy ? 'Lese die Karte …' : 'Fotos wählen'}
            </button>
          </>
        )}
        {mode === 'text' && (
          <>
            <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Rezept hier einfügen – Titel, Zutaten, Schritte" />
            <button className="btn primary lg" disabled={text.length < 10 || busy} onClick={() => run(() => post('/recipes/import/text', { text }))}>
              <TextAa size={18} /> Übernehmen
            </button>
          </>
        )}
        {mode === 'new' && (
          <button className="btn primary lg" onClick={() => run(() => post('/recipes', { title: 'Neues Rezept', ingredients: [], steps: [] }))}>
            Leeres Rezept anlegen
          </button>
        )}
      </div>
    </Sheet>
  );
}
