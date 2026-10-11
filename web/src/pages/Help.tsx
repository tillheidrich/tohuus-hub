/** In-app help (/hilfe): short how-tos for the things people ask about in week one. Area: onboard. */
import { ArrowRight, Receipt, BowlFood, CalendarCheck, CaretDown, ChatCircleDots, Confetti, DeviceMobile, House, Sparkle, Database, Lifebuoy, ShareNetwork, EyeSlash, Repeat, ChefHat, Suitcase, UsersThree, ForkKnife, CircleHalf, HandHeart } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useApi } from '../api';
import { t } from '../i18n';
import { ChangelogList } from './Onboarding';
import { TourHelpCard } from './Tour';

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
      id: 'appearance',
      icon: <CircleHalf size={20} />,
      title: t('Light or dark'),
      lead: t('One appearance for the whole household, or everyone picks their own.'),
      steps: [
        t('Settings › Household › Appearance: Light, Dark or “Like the device” (follows each phone’s setting).'),
        t('Switch on “Let everyone choose for themselves” and each member picks their own under My account.'),
        t('Kitchen displays follow the household setting.'),
      ],
      link: { label: t('Open household settings'), to: '/einstellungen?tab=home' },
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
      lead: t('A real integration: shopping list as a to-do list for Assist, meal plan and care tasks as calendars, sensors for dashboards, actions and events for automations.'),
      steps: [
        t('Install “ToHuus Hub” from HACS (custom repository github.com/tillheidrich/tohuus-hub-ha) and restart Home Assistant.'),
        t('Settings › Access & AI › New access › “Home Assistant” – copy the token.'),
        t('In Home Assistant add the ToHuus Hub integration and paste this address and the token.'),
        t('Without HACS: the same access also gives you a YAML package as a fallback.'),
        t('Already using Bring!, Mealie or the HA app for some of this? Settings › Home Assistant shows what Home Assistant already does and keeps it in step – take over the suggestions with one tap.'),
      ],
      link: { label: t('Open access settings'), to: '/einstellungen?tab=access' },
    },
    {
      id: 'treats',
      icon: <HandHeart size={20} />,
      title: t('Treats: doing each other a good turn'),
      lead: t('Stuck on the sofa, in bed or with bedtime? Ask for a little something – someone at home brings it.'),
      steps: [
        t('Treats › For me: tap a tile – something sweet, something to drink, from the fridge – or “Something else” for a free wish like tea with honey.'),
        t('“How would you like it?” is a note for the person bringing it. “Who brings it?” asks one person – or whoever can.'),
        t('The others get a push with “I’ll bring it” or “Can’t right now” and a short reason. You see “Coming right up – Lea is bringing it”.'),
        t('Once it’s there you can say thanks. Nobody keeps score – no points, no list of who brought what.'),
        t('Living alone? Then the page is just for guests and parties.'),
      ],
      link: { label: t('Open Treats'), to: '/bestellen' },
    },
    {
      id: 'guests',
      icon: <Confetti size={20} />,
      title: t('Guests, party & babysitter'),
      lead: t('Guests ask for what is really there – no app, no account.'),
      steps: [
        t('Treats › Party › “Start a party”: pick the menu, the party ends by itself.'),
        t('Show it on the TV: open {url}/party on the TV and type the 4-digit code from “Show on TV”.', { url: base.replace(/^https?:\/\//, '') }),
        t('Guests scan the QR code and order; you get a push and tap “Ready”. Stock is booked by itself.'),
        t('Visitors, the babysitter or grandparents: Treats › Guests – a link with what they may ask for, chosen places read-only and a note.'),
        t('Voice commands for the babysitter (lights, blinds, music – never locks or cameras): Settings › Home Assistant › Voice commands. They show on babysitter and house-sitter links; switch them off per link if you like.'),
      ],
      link: { label: t('Open guests'), to: '/bestellen?mode=guests' },
    },
    {
      id: 'karte',
      icon: <ForkKnife size={20} />,
      title: t('The menu: tea, ice cream, snacks'),
      lead: t('Everything people can ask for lives in one menu – things from your stock and things that are simply there, like tap water or tea.'),
      steps: [
        t('Treats › “Edit menu” (also in Settings › Household and in the party setup).'),
        t('“Add from stock”: crisps, cola, ice cream – they show “all gone” (or disappear) when they run out, and serving books them out.'),
        t('“Menu-only item”: tap water, coffee, cappuccino – never counted. Link up to three ingredients from stock (milk, coffee): when one runs low it says “maybe not”.'),
        t('Choices like size, milk or sugar: single or several, required or optional, with a preselected default.'),
        t('Who sees it: everyone, only at parties, only for family – or hidden for now. Templates get you started in one tap.'),
      ],
      link: { label: t('Open the menu'), to: '/bestellen/karte' },
    },
    {
      id: 'people',
      icon: <UsersThree size={20} />,
      title: t('People: pictures, children, permanent guests, favourites'),
      lead: t('Everyone in the household with a picture – children without a login, regular guests with just the access they need.'),
      steps: [
        t('Settings › Members › “Our household”: tap a person for a photo (crop it square, or take one), an animal or initials, and what they like, don’t like and are allergic to.'),
        t('“Add a child”: name, optional year of birth, allergies. Children never sign in; parents rate dishes for them, and kid mode uses the same profile.'),
        t('“Add a permanent guest” (grandma, a regular babysitter) and choose what they see: ordering & shopping list, + stock, + recipes & plan, or like family. Settings, spending, receipts, backups and care notes stay hidden.'),
        t('“For a while” changes it for a weekend or pauses it – it switches back by itself. “Send login link” mails a one-time link, or shows a link and QR code when e-mail is not set up.'),
        t('After cooking, one tap per person: not for me, okay, loved it. Allergies warn on dishes and are never planned automatically; ratings and dislikes nudge suggestions. Cook › Favourites shows the family favourites and each person’s.'),
      ],
      link: { label: t('Open members'), to: '/einstellungen?tab=members' },
    },
    {
      id: 'plan',
      icon: <CalendarCheck size={20} />,
      title: t('Week plan: rotation, votes, servings'),
      lead: t('Plan less often: let good weeks come back, let the family decide together, cook more just once.'),
      steps: [
        t('Rotation: plan a week you liked, then Cook › Plan templates › save it. Two or three saved weeks make a rotation; “Fill from the rotation” plans the coming weeks – or switch on automatic filling.'),
        t('Filling never overwrites anything. Tap a day to mark it “Eating out” or “Not at home” – it stays free. A dish you had recently is swapped for a fitting suggestion.'),
        t('Who wants what? Start a vote with a few dishes. Everyone swipes on their own phone (results stay hidden until all are done) – or together on one device, kids included. Then one tap puts the winner into the plan.'),
        t('More people just once: tap the planned meal and change “For … people”. The week’s shopping, “used up” after cooking and the recipe opened from the plan use that amount. A permanent change belongs in the recipe under “Our way”.'),
      ],
      link: { label: t('Open the week plan'), to: '/kochen' },
    },
    {
      id: 'reste',
      icon: <BowlFood size={20} />,
      title: t('Leftovers & freezer labels'),
      lead: t('Put leftovers or portions away in two taps – nobody has to remember what is in which container.'),
      steps: [
        t('After cooking: in “Cooked” say how many portions are left and where they go. Or use the plus button › Leftovers & freezing, “Leftovers” on a planned meal, or “Freeze & label” on a product.'),
        t('Name, date, who made it and an eat-by are filled in: cooked leftovers 3 days in the fridge, about 3 months in the freezer compartment, cooked rice only 1 day. You can change the date.'),
        t('Each container gets a label with a big name, the date, eat-by and a QR code – from the receipt printer, as a PDF for A4 sticker sheets (3 × 8 and more), or as an image. “No label” just keeps track.'),
        t('Scan the label with the phone camera: eaten, took one portion, thawed or thrown away – stock follows. Only household members who are logged in see what is inside.'),
        t('Leftovers come first in “What do we eat today?”, frozen portions that should go soon show up on Today, and the week plan offers “use the frozen bolognese” – with a reminder the day before to take it out.'),
      ],
      link: { label: t('Open labels'), to: '/etiketten?kind=boxes' },
    },
    {
      id: 'urlaub',
      icon: <Suitcase size={20} />,
      title: t('Trip / away'),
      lead: t('Enter the dates once – the rest happens around the trip, without a to-do list.'),
      steps: [
        t('Before: a few days ahead, meal ideas and the week plan prefer what would go off while you’re away, and fresh things stay off the shopping list. A short checklist comes from your home: fridge, bins, plants, care tasks that fall into the trip.'),
        t('Packing: start from a list (kids, beach, ski, city, baby, or your own) and add things from stock like snacks or sunscreen – they leave the stock count when you go and come back with one tap.'),
        t('While away: only urgent notifications; nothing lands on the list by itself if nobody is home. Someone stays home (grandparents)? Then everything carries on for them. Cooking at the holiday flat gets its own small plan and list.'),
        t('House sitter: a link like the babysitter link – where is what, plus notes on plants, post and bin days. It ends the day after you’re back.'),
        t('Back home: a welcome-home list with your usual fresh things and whatever expired, ready on the way back. Home Assistant can report that everyone is away – ToHuus Hub then only suggests away mode.'),
      ],
      link: { label: t('Plan a trip'), to: '/urlaub' },
    },
    {
      id: 'teilen',
      icon: <ShareNetwork size={20} />,
      title: t('Share into the app'),
      lead: t('A list in WhatsApp, a recipe link, a receipt photo: send it here instead of typing it.'),
      steps: [
        t('Android and computer: install the app once. Then pick it in any app’s share menu – a list goes to the shopping list in one tap, a recipe link to the recipes, a photo or PDF to the imports.'),
        t('Chat messages are cleaned up by themselves: times, names, bullets and check boxes disappear, “2 milk, bread and tape” becomes three items.'),
        t('iPhone: iOS doesn’t offer the share menu to web apps. Settings › My account › “Create a key for the iPhone shortcut” – the steps are shown right there.'),
        t('Copied a list? The paste button next to the input field on the shopping list takes it in one tap.'),
      ],
      link: { label: t('Set up sharing'), to: '/einstellungen?tab=account' },
    },
    {
      id: 'diskret',
      icon: <EyeSlash size={20} />,
      title: t('Discreet and private items'),
      lead: t('Some things don’t need an audience – a present, something from the pharmacy.'),
      steps: [
        t('Tap the eye next to the input field before adding: “Discreet” shows everyone a neutral placeholder like “Drugstore item”, “Only me” hides it from everyone else.'),
        t('Already on the list? Open it with “…” and change “Who sees it?”. You can let selected members see a private item.'),
        t('Discreet items can show their real name to whoever shops – the person with the store view open or who said “I’ll get it”.'),
        t('Real names never reach Home Assistant, Telegram, displays, printed lists, guest links or AI assistants.'),
      ],
      link: { label: t('Open the shopping list'), to: '/einkauf' },
    },
    {
      id: 'ausgehen',
      icon: <Repeat size={20} />,
      title: t('Only track what runs out'),
      lead: t('The calmest way to start: only the things that regularly run out are tracked.'),
      steps: [
        t('Settings › Household › “What should be tracked?” › “Only what runs out”, then tap your staples.'),
        t('Everything else is simply not counted – no warnings, no reminders. Receipts still come in as before.'),
        t('Bought something on two different days? Today suggests tracking it too.'),
        t('Switch to “Everything” at any time – nothing is deleted.'),
      ],
      link: { label: t('Open household settings'), to: '/einstellungen?tab=home' },
    },
    {
      id: 'bons',
      icon: <Receipt size={20} />,
      title: t('Receipts are read better over time'),
      lead: t('When you correct a receipt line while checking an import, ToHuus Hub remembers it for your household.'),
      steps: [
        t('Another product, a pack of 10 counted as one, “skip the carrier bag”: just correct it once in the review.'),
        t('Next time the same line is filled in on its own and marked “learned”.'),
        t('Imports › Recognition shows how many lines were recognised without a correction, per store, and lists the learned rules to change or forget.'),
        t('“Help improve recognition” in an import makes an anonymised test file for the project. Nothing is sent automatically – you download it or open a prefilled issue or e-mail yourself.'),
      ],
      link: { label: t('Open recognition'), to: '/import/quality' },
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
        t('“Remove demo data” deletes only what the demo added. “Start over” clears the areas you pick – after an automatic backup.'),
      ],
      link: { label: t('Open data & backups'), to: '/einstellungen?tab=data' },
    },
    {
      id: 'recipes-import',
      icon: <ChefHat size={20} />,
      title: t('Bring your recipes along'),
      lead: t('From Mealie, Tandoor, Paprika, Nextcloud Cookbook, KitchenOwl, a CSV list, any recipe website – or via any AI.'),
      steps: [
        t('Settings › Recipes › “Import from another app”: choose the export file, check the preview, import.'),
        t('Importing the same file again updates the recipes – your own way of cooking, favourites and ratings stay.'),
        t('No idea what to cook? Search the open recipe database; ingredients come over in your language and units.'),
        t('Without MCP: “Import with any AI” gives you a prompt for ChatGPT, Claude or Le Chat – paste the answer back.'),
        t('Cookidoo recipes keep their steps in Cookidoo – the recipe shows a link there.'),
      ],
      link: { label: t('Open recipe import'), to: '/einstellungen?tab=recipes' },
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
        <TourHelpCard />
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
