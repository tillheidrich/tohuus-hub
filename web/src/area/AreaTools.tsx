/**
 * Bereichsseiten (UX audit 2026-10, Paket E): one main action stays visible in the head, everything rarer sits in
 * one labelled menu „Werkzeuge“ – never a bare „…“. Same pattern on Einkauf, Kochen, Aufgaben, Zuhause and Geld, and
 * on the iPhone (`AreaToolsMenu` in Design/AreaTools.swift). Empty states: icon, one sentence, one button (`AreaEmpty`).
 */
import { CaretRight, Toolbox } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { Empty, Sheet, Toggle } from '../ui';
import './area.css';

export interface AreaTool {
  key: string;
  label: string;
  /** one short line under the label */
  sub?: string;
  icon: ReactNode;
  /** a route, or … */
  to?: string;
  /** … an action (the menu closes first) */
  onClick?: () => void;
  /** a switch instead of a row */
  toggle?: { on: boolean; onChange: (on: boolean) => void };
  hidden?: boolean;
}

export function AreaTools({ tools, label }: { tools: AreaTool[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const shown = tools.filter((x) => !x.hidden);
  if (!shown.length) return null;
  const title = label ?? t('Tools');
  return (
    <>
      <button type="button" className="btn sm area-tools-btn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        <Toolbox size={16} aria-hidden="true" /> {title}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div className="stack area-tools" style={{ gap: 8 }}>
          {shown.map((x) =>
            x.toggle ? (
              <div key={x.key} className="li nav-row area-tool">
                <span className="area-tool-icon" aria-hidden="true">{x.icon}</span>
                <span className="grow">
                  <span className="title">{x.label}</span>
                  {x.sub && <span className="sub">{x.sub}</span>}
                </span>
                <Toggle on={x.toggle.on} onChange={x.toggle.onChange} label={x.label} />
              </div>
            ) : (
              <button
                key={x.key}
                type="button"
                className="li clickable card nav-row area-tool"
                onClick={() => {
                  setOpen(false);
                  if (x.to) nav(x.to);
                  else x.onClick?.();
                }}
              >
                <span className="area-tool-icon" aria-hidden="true">{x.icon}</span>
                <span className="grow">
                  <span className="title">{x.label}</span>
                  {x.sub && <span className="sub">{x.sub}</span>}
                </span>
                <CaretRight size={16} aria-hidden="true" />
              </button>
            ),
          )}
        </div>
      </Sheet>
    </>
  );
}

/** The one empty state of the area pages: icon, one sentence, one button. */
export function AreaEmpty({ icon, text, action, card = true }: { icon: ReactNode; text: string; action?: { label: string; onClick: () => void; icon?: ReactNode }; card?: boolean }) {
  const body = <Empty icon={icon} title={text} action={action} />;
  return card ? <div className="card area-empty">{body}</div> : <div className="area-empty">{body}</div>;
}

/** Labelled tiles under a list (Aufgaben › Kopf & Fairness): icon + word, two per row on the phone. */
export function AreaTiles({ title, tiles }: { title: string; tiles: AreaTool[] }) {
  const nav = useNavigate();
  const shown = tiles.filter((x) => !x.hidden);
  if (!shown.length) return null;
  return (
    <section className="section area-tiles-sec" aria-label={title}>
      <div className="section-head">
        <h2>{title}</h2>
      </div>
      <div className="area-tiles">
        {shown.map((x) => (
          <button key={x.key} type="button" className="area-tile" onClick={() => (x.to ? nav(x.to) : x.onClick?.())}>
            <span className="area-tool-icon" aria-hidden="true">{x.icon}</span>
            <span className="area-tile-label">{x.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
