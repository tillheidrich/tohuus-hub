/** In-app help (/hilfe): short how-tos for the things people ask about in week one. Area: onboard. */
import { ArrowRight, CaretDown, ChatCircleDots, Confetti, DeviceMobile, House, Sparkle, Database, Lifebuoy } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../api';
import { t } from '../i18n';
import { ChangelogList } from './Onboarding';

interface Topic {
  id: string;
  icon: ReactNode;
  title: string;
  lead: string;
  steps: string[];
  link?: { label: string; to: string };
  extra?: ReactNode;
}

export function Help() {
  const loc = useLocation();
  const nav = useNavigate();
  const settings = useApi<any>('settings', '/settings');
  const base = settings.data?.baseUrl ?? location.origin;
  const [open, setOpen] = useState<string | null>(() => loc.hash.slice(1) || null);
  useEffect(() => {
    const id = loc.hash.slice(1);
    if (!id) return;
    setOpen(id);
    setTimeout(() => document.getElementById(`help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [loc.hash]);

  const topics: Topic[] = [
    {
      id: 'phone',
      icon: <DeviceMobile size={20} />,
      title: t('On your phone, with push'),
      lead: t('The app works best from the home screen – then it opens like an app and can send you pushes.'),
      steps: [
        t('iPhone: open {url} in Safari, tap Share, then “Add to Home Screen”.', { url: base.replace(/^https?:\/\//, '') }),
        t('Android: open it in Chrome, menu, “Install app”.'),
        t('Open the app from the new icon and sign in once.'),
        t('Settings › Notifications › “Push on this device”. On iPhone this only works from the home-screen icon.'),
      ],
      link: { label: t('Open notification settings'), to: '/einstellungen?tab=notify' },
    },
    {
      id: 'mcp',
      icon: <ChatCircleDots size={20} />,
      title: t('Claude, ChatGPT & co. (MCP)'),
      lead: t('Your AI assistant can read and update the household – e.g. a receipt photo: “put this into the household app”.'),
      steps: [
        t('Settings › Access & AI › New access › “AI assistant”.'),
        t('Copy the MCP link that is shown.'),
        t('Claude: Settings › Connectors › “Add custom connector”, paste the link. ChatGPT: Settings › Connectors (developer mode).'),
        t('Treat the link like a password. If it leaks, delete the access in the app – it stops working at once.'),
      ],
      link: { label: t('Open access settings'), to: '/einstellungen?tab=access' },
    },
    {
      id: 'ha',
      icon: <House size={20} />,
      title: t('Home Assistant'),
      lead: t('Sensors for your dashboard, actions for automations and pushes with an “add to list” button.'),
      steps: [
        t('Settings › Access & AI › New access › “Home Assistant” – it generates a ready package.'),
        t('Save it as a file in config/packages of Home Assistant and restart.'),
        t('Put the webhook URL into Settings › Notifications so HA hears about low stock and orders.'),
        t('Optional: sync the shopping list with an HA to-do list, so Assist or Siri can add items.'),
      ],
      link: { label: t('Open access settings'), to: '/einstellungen?tab=access' },
    },
    {
      id: 'guests',
      icon: <Confetti size={20} />,
      title: t('Guests, party & babysitter'),
      lead: t('Guests order from what is really there – no app, no account.'),
      steps: [
        t('Guests & Bar › “Start a party”: pick the menu, the party ends by itself.'),
        t('Show it on the TV: open {url}/party on the TV and type the 4-digit code from “Show on TV”.', { url: base.replace(/^https?:\/\//, '') }),
        t('Guests scan the QR code and order; you get a push and tap “Ready”. Stock is booked by itself.'),
        t('For the babysitter: Guests & Bar › Guest links – share chosen places read-only, with a note.'),
      ],
      link: { label: t('Open guests & bar'), to: '/bar' },
    },
    {
      id: 'backups',
      icon: <Database size={20} />,
      title: t('Backups & your data'),
      lead: t('Everything lives in one file on your server. No cloud, no tracking.'),
      steps: [
        t('A snapshot is made every night automatically; the last ones are kept.'),
        t('Settings › Data & backups: download a backup, or restore one with a tap.'),
        t('Off-site copy: add a WebDAV folder (e.g. Nextcloud) – use an app password.'),
        t('Export as JSON whenever you like. Passwords and access keys are never included.'),
      ],
      link: { label: t('Open data & backups'), to: '/einstellungen?tab=data' },
    },
    {
      id: 'neu',
      icon: <Sparkle size={20} />,
      title: t('What’s new'),
      lead: t('Recent changes in plain words.'),
      steps: [],
      extra: <ChangelogList />,
    },
  ];

  return (
    <div className="rise">
      <header className="page-head">
        <div>
          <div className="eyebrow">{t('Help')}</div>
          <h1>{t('How does … work?')}</h1>
          <p className="muted" style={{ margin: '8px 0 0', maxWidth: 520 }}>{t('Short answers for the first week. Tap a topic.')}</p>
        </div>
      </header>
      <div className="stack" style={{ gap: 10 }}>
        {topics.map((x) => {
          const isOpen = open === x.id;
          return (
            <section key={x.id} id={`help-${x.id}`} className="card help-topic">
              <button className="help-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : x.id)}>
                <span className="ic">{x.icon}</span>
                <span className="grow">
                  <b>{x.title}</b>
                  <span className="small muted">{x.lead}</span>
                </span>
                <CaretDown size={16} style={{ transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform .2s', flex: 'none' }} />
              </button>
              {isOpen && (
                <div className="help-body">
                  {x.steps.length > 0 && (
                    <ol>
                      {x.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ol>
                  )}
                  {x.extra}
                  {x.link && (
                    <button className="btn sm" onClick={() => nav(x.link!.to)}>
                      {x.link.label} <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <p className="small muted row" style={{ gap: 8, marginTop: 22 }}>
        <Lifebuoy size={16} /> {t('Still stuck? Ask your AI assistant – it can call “getting_started_status” to see what is set up.')}
      </p>
    </div>
  );
}
