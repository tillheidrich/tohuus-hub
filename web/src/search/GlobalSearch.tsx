/**
 * Global search (UX benchmark 2.4, server: routes/search.ts, iOS: GlobalSearchView.swift): one field for every
 * function and setting (a static registry, with words people actually type) and for the household's things
 * (Vorrat, the list, recipes, tasks, Hausinfo, people – filtered by the server like each area).
 * Opens with ⌘K / Ctrl+K or "/" anywhere, and from the magnifier in the page head.
 */
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, invalidate } from '../api';
import { lang, t } from '../i18n';
import { PAGES, rowPath, visibleRows } from '../settings/registry';
import { fnTitle, foldText, functionsFor } from './functions';
import { guestAllows } from '../people/access';
import { useToast } from '../ui';

interface Hit {
  key: string;
  title: string;
  sub?: string;
  to?: string;
  run?: () => void;
}

interface ServerGroups {
  products?: { id: number; name: string; brand: string | null; in_stock: boolean | null }[];
  list?: { id: number; text: string; list: string }[];
  recipes?: { id: number; title: string; with: string | null }[];
  tasks?: { id: number; name: string; next_due: string | null; private: boolean }[];
  house?: { id: number; title: string }[];
  people?: { key: string; name: string }[];
  wishes?: { key: string; id: number; title: string; list_id: number; sub: string | null }[];
}

export function GlobalSearch({ guest, admin, cloud, modules, onClose }: { guest?: string; admin: boolean; cloud: boolean; modules?: Record<string, boolean>; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [server, setServer] = useState<ServerGroups>({});
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const n = q.trim();
    if (n.length < 2) return setServer({});
    // a late answer for an older query must not overwrite the newer one
    let live = true;
    const timer = setTimeout(() => {
      get<{ groups: ServerGroups }>(`/search?q=${encodeURIComponent(n)}`)
        .then((r) => live && setServer(r.groups))
        .catch(() => live && setServer({}));
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const functions = useMemo(() => {
    const all = [
      // the shared function register (shared/functions.json) – the iPhone search reads the same file
      ...functionsFor({ guest: Boolean(guest), admin, modules, platform: 'web' })
        .filter((f) => f.web && guestAllows(guest as never, f.web.split('?')[0]))
        .map((f) => ({ label: fnTitle(f, lang()), to: f.web!, words: `${f.title.de} ${f.title.en} ${f.words.de} ${f.words.en}` })),
      // every row of Einstellungen (Ich, Haushalt, Bereiche & Orte, Mitteilungen & Kalender, Verbindungen & Geräte, Daten, Abo & Konto)
      ...(guestAllows(guest as never, '/einstellungen')
        ? visibleRows({ guest: Boolean(guest), user: !guest, admin, cloud, modules }).map((r) => ({
            label: t(r.title),
            to: rowPath(r),
            words: `${r.words} ${r.hint ? t(r.hint) : ''} ${t(PAGES.find((p) => p.id === r.page)!.title)}`,
          }))
        : []),
    ];
    const seen = new Set<string>();
    return all.filter((x) => (seen.has(x.label) ? false : (seen.add(x.label), true)));
  }, [guest, admin, cloud, modules]);

  const groups = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [] as { title: string; hits: Hit[] }[];
    const out: { title: string; hits: Hit[] }[] = [];
    // every typed word in the title or the words, German or English, umlauts folded (same as the iPhone)
    const terms = foldText(n).split(/\s+/).filter(Boolean);
    const fn = functions.filter((x) => { const hay = foldText(`${x.label} ${x.words}`); return terms.every((w) => hay.includes(w)); }).slice(0, 6);
    if (fn.length) out.push({ title: t('Functions & settings'), hits: fn.map((x) => ({ key: `f${x.to}${x.label}`, title: x.label, to: x.to })) });
    if (server.list?.length) out.push({ title: t('On the list'), hits: server.list.map((x) => ({ key: `l${x.id}`, title: x.text, sub: x.list, to: '/einkauf' })) });
    if (server.products?.length)
      out.push({ title: t('Pantry'), hits: server.products.map((x) => ({ key: `p${x.id}`, title: x.name, sub: x.in_stock === false ? t('not at home') : x.brand ?? undefined, to: `/bestand/${x.id}` })) });
    if (server.tasks?.length) out.push({ title: t('Tasks'), hits: server.tasks.map((x) => ({ key: `t${x.id}`, title: x.name, sub: x.next_due ?? undefined, to: `/aufgaben?task=${x.id}` })) });
    if (server.recipes?.length)
      out.push({ title: t('Recipes'), hits: server.recipes.map((x) => ({ key: `r${x.id}`, title: x.title, sub: x.with ? t('with {what}', { what: x.with }) : undefined, to: `/rezepte/${x.id}` })) });
    if (server.house?.length) out.push({ title: t('House info'), hits: server.house.map((x) => ({ key: `h${x.id}`, title: x.title, to: '/hausinfo' })) });
    if (server.wishes?.length) out.push({ title: t('Wishes'), hits: server.wishes.map((x) => ({ key: `w${x.key}`, title: x.title, sub: x.sub ?? undefined, to: `/einkauf/wuensche/${x.list_id}` })) });
    if (server.people?.length) out.push({ title: t('People'), hits: server.people.map((x) => ({ key: `u${x.key}`, title: x.name, to: '/einstellungen/haushalt/leute' })) });
    // nothing to open? offer to add it
    const text = q.trim();
    out.push({
      title: t('Add'),
      hits: [
        {
          key: 'add-list',
          title: t('Put “{text}” on the list', { text }),
          run: () =>
            post('/shopping', { text })
              .then(() => {
                invalidate('shopping');
                toast({ text: t('“{text}” is on the list', { text }) });
              })
              .catch((e) => toast({ text: (e as Error).message, error: true })),
        },
        ...(guest ? [] : [{ key: 'add-task', title: t('New task “{text}”', { text }), to: `/aufgaben?new=${encodeURIComponent(text)}` }]),
      ],
    });
    return out;
  }, [q, functions, server, guest, toast]);

  const flat = groups.flatMap((g) => g.hits);
  const open = (h: Hit) => {
    onClose();
    if (h.run) h.run();
    else if (h.to) nav(h.to);
  };

  return (
    <div className="gsearch-backdrop" onClick={onClose}>
      <div className="gsearch card" role="dialog" aria-modal="true" aria-label={t('Search')} onClick={(e) => e.stopPropagation()}>
        <div className="gsearch-field">
          <MagnifyingGlass size={20} aria-hidden="true" />
          <input
            ref={input}
            className="grow"
            value={q}
            placeholder={t('Search everything: milk, bathroom, password …')}
            aria-label={t('Search')}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((v) => Math.min(flat.length - 1, v + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((v) => Math.max(0, v - 1)); }
              else if (e.key === 'Enter' && flat[sel]) open(flat[sel]);
            }}
          />
          <button className="icon-btn plain" onClick={onClose} aria-label={t('Close')}>
            <X size={18} />
          </button>
        </div>
        <div className="gsearch-results">
          {!q.trim() && <p className="muted small" style={{ padding: '8px 4px' }}>{t('Find a function, a setting or anything in your household.')}</p>}
          {groups.map((g) => (
            <div key={g.title}>
              <div className="eyebrow" style={{ margin: '10px 4px 4px' }}>{g.title}</div>
              {g.hits.map((h) => {
                const i = flat.indexOf(h);
                return (
                  <button key={h.key} className={`li gsearch-hit ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => open(h)}>
                    <span className="grow">
                      <span className="title">{h.title}</span>
                      {h.sub && <span className="sub">{h.sub}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** ⌘K / Ctrl+K / "/" opens the search (not while typing somewhere else) */
export function useSearchHotkey(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}
