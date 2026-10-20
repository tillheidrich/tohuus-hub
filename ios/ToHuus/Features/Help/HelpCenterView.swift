import SwiftUI

/// Hilfe (web: pages/Help.tsx, /hilfe): the tour, short how-tos for the things people ask about in week one – natively,
/// in the app's words, adapted to the iPhone – and the longer articles on the website (Help.articles, help-slugs.md).
struct HelpCenterView: View {
    /// for "run the setup again" (admins); nil when opened without a household
    var store: ServerStore?
    @Environment(AppModel.self) private var app
    @State private var open: String?
    @State private var showTour = false
    @State private var showSetup = false
    @State private var query = ""

    struct Topic: Identifiable {
        let id: String
        let symbol: String
        let title: String
        let lead: String
        let steps: [String]
        var slug: String?
    }

    private var topics: [Topic] {
        var t: [Topic] = [
            Topic(id: "knowledge", symbol: "brain", title: L("Household knowledge: sizes, measurements, meter readings"),
                  lead: L("What only one person used to know – now everyone asks ToHuus. Nothing to maintain."),
                  steps: [
                      L("Knowledge (in More or in your bar): type a sentence like “Mika shoe size 31” or “Living room blind 120 x 160” – this works without AI too."),
                      L("Something changed? Just enter the new value. The old one stays in the history with its date."),
                      L("Already in a note? Menu “…” › Import: paste text from notes or emails, or pick a list (Excel, Numbers, Google Sheets as CSV, a text file). You see everything before it is saved."),
                      L("Export: everything or what the search shows, as Markdown, CSV or JSON – “Save to Files” keeps a copy."),
                      L("Codes and Wi-Fi belong in the house info. Health details stay private and only reach an AI if your household allows it."),
                  ], slug: "haushaltswissen"),
            Topic(id: "bar", symbol: "rectangle.bottomthird.inset.filled", title: L("Your bar"),
                  lead: L("Which areas sit at the bottom – everyone chooses their own."),
                  steps: [
                      L("Touch and hold the bar, or tap “Adjust the bar” in More."),
                      L("The green plus adds an area – Money, Knowledge, Bring me something, Wishes or House info. The red minus removes one."),
                      L("Drag the handles to reorder. “Back to the start” resets it. Today always stays first."),
                  ], slug: "deine-leiste"),
            Topic(id: "coming", symbol: "calendar.badge.clock", title: L("Coming up, the bin and undo"),
                  lead: L("What's next – right on Today, without opening a calendar."),
                  steps: [
                      L("“Coming up” on Today shows tomorrow and the next days, and who has taken something on."),
                      L("The bin appears the evening before with “tonight: put out” – from 5 pm at the very top. On Fridays and Saturdays it looks two days ahead."),
                      L("Collection dates can come from your calendar: Tasks › Read your existing calendar."),
                      L("Private tasks can go into a calendar of your own: Tasks › Read your existing calendar › “Your private tasks”."),
                      L("Ticked off by mistake? Tap “Undo” and it's back."),
                  ], slug: "aufgaben"),
            Topic(id: "iphone", symbol: "iphone", title: L("ToHuus on your iPhone"),
                  lead: L("Share sheet, widgets, Apple Watch and notifications – the shortcuts that save the most taps."),
                  steps: [
                      L("Share into ToHuus: in any app tap Share › ToHuus. A list goes on the shopping list, a recipe link to the recipes, a receipt to the imports."),
                      L("Widgets: touch and hold the home screen, tap Edit › Add Widget and pick ToHuus – the list on the home or lock screen."),
                      L("Apple Watch: install ToHuus on the watch; the list comes along by itself and works offline in the shop."),
                      L("Notifications: More › Notifications. You choose what reaches you; nothing is switched on without asking."),
                  ], slug: "benachrichtigungen"),
            Topic(id: "diskret", symbol: "eye.slash", title: L("Discreet and private items"),
                  lead: L("Some things don’t need an audience – a present, something from the pharmacy."),
                  steps: [
                      L("Tap the eye next to the input field before adding: “Discreet” shows everyone a neutral placeholder like “Drugstore item”, “Only me” hides it from everyone else."),
                      L("Already on the list? Open it with “…” and change “Who sees it?”. You can let selected members see a private item."),
                      L("Discreet items can show their real name to whoever shops – the person with the store view open or who said “I’ll get it”."),
                      L("Real names never reach Home Assistant, Telegram, displays, printed lists, guest links or AI assistants."),
                  ], slug: "wer-sieht-was"),
            Topic(id: "ausgehen", symbol: "repeat", title: L("Only track what runs out"),
                  lead: L("The calmest way to start: only the things that regularly run out are tracked."),
                  steps: [
                      L("Settings › Areas & places › Pantry: what to track? › “Only what runs out”, then tap your staples."),
                      L("Everything else is simply not counted – no warnings, no reminders. Receipts still come in as before."),
                      L("Bought something on two different days? Today suggests tracking it too."),
                      L("Switch to “Everything” at any time – nothing is deleted."),
                  ], slug: "vorrat"),
            Topic(id: "bons", symbol: "doc.text.magnifyingglass", title: L("Receipts are read better over time"),
                  lead: L("When you correct a receipt line while checking an import, ToHuus Hub remembers it for your household."),
                  steps: [
                      L("Another product, a pack of 10 counted as one, “skip the carrier bag”: just correct it once in the review."),
                      L("Next time the same line is filled in on its own and marked “learned”."),
                      L("Imports › Recognition shows how many lines were recognised without a correction, per store, and lists the learned rules to change or forget."),
                  ], slug: "kassenbons"),
        ]
        if app.moduleOn("cook") {
            t.append(Topic(id: "plan", symbol: "calendar", title: L("Week plan: rotation, votes, servings"),
                           lead: L("Plan less often: let good weeks come back, let the family decide together, cook more just once."),
                           steps: [
                               L("Rotation: plan a week you liked, then Cook › Plan templates › save it. Two or three saved weeks make a rotation; “Fill from the rotation” plans the coming weeks – or switch on automatic filling."),
                               L("Filling never overwrites anything. Tap a day to mark it “Eating out” or “Not at home” – it stays free. A dish you had recently is swapped for a fitting suggestion."),
                               L("Who wants what? Start a vote with a few dishes. Everyone swipes on their own phone (results stay hidden until all are done) – or together on one device, kids included. Then one tap puts the winner into the plan."),
                               L("More people just once: tap the planned meal and change “For … people”. The week’s shopping, “used up” after cooking and the recipe opened from the plan use that amount. A permanent change belongs in the recipe under “Our way”."),
                           ], slug: "kochen"))
            t.append(Topic(id: "reste", symbol: "takeoutbag.and.cup.and.straw", title: L("Leftovers & freezer labels"),
                           lead: L("Put leftovers or portions away in two taps – nobody has to remember what is in which container."),
                           steps: [
                               L("After cooking: in “Cooked” say how many portions are left and where they go. Or use the plus button › Leftovers & freezing, “Leftovers” on a planned meal, or “Freeze & label” on a product."),
                               L("Name, date, who made it and an eat-by are filled in: cooked leftovers 3 days in the fridge, about 3 months in the freezer compartment, cooked rice only 1 day. You can change the date."),
                               L("Scan the label with the phone camera: eaten, took one portion, thawed or thrown away – stock follows. Only household members who are logged in see what is inside."),
                           ]))
            t.append(Topic(id: "recipes-import", symbol: "book", title: L("Bring your recipes along"),
                           lead: L("From Mealie, Tandoor, Paprika, Nextcloud Cookbook, KitchenOwl, a CSV list, any recipe website – or via any AI."),
                           steps: [
                               L("Settings › Areas & places › Recipes & imports › “Import from another app”: choose the export file, check the preview, import."),
                               L("Importing the same file again updates the recipes – your own way of cooking, favourites and ratings stay."),
                               L("Cookidoo recipes keep their steps in Cookidoo – the recipe shows a link there."),
                           ], slug: "rezepte-importieren"))
        }
        if app.moduleOn("treats") && !app.singleHousehold {
            t.append(Topic(id: "treats", symbol: "heart", title: L("Bring me something: doing each other a good turn"),
                           lead: L("Stuck on the sofa, in bed or with bedtime? Ask for a little something – someone at home brings it."),
                           steps: [
                               L("Bring me something › For me: tap a tile – something sweet, something to drink, from the fridge – or “Something else” for a free wish like tea with honey."),
                               L("“How would you like it?” is a note for the person bringing it. “Who brings it?” asks one person – or whoever can."),
                               L("The others get a push with “I’ll bring it” or “Can’t right now” and a short reason. You see “Coming right up – Mira is bringing it”."),
                               L("Once it’s there you can say thanks. Nobody keeps score – no points, no list of who brought what."),
                               L("Guests too: “Invite guests” shares a link or QR code. Guests wish for something without an app, and it lands in the same list as “Guest: name”, with the same buttons."),
                           ]))
        }
        if app.moduleOn("guests") {
            t.append(Topic(id: "guests", symbol: "person.badge.key", title: L("Guests & babysitter"),
                           lead: L("Visitors, the babysitter or grandparents get a link – no app, no account."),
                           steps: [
                               L("Guests › new link: pick a template – Visitors, Babysitter or Grandparents – and choose what they see, for example the house info, chosen places read-only and a note."),
                               L("Share the link or show the QR code. Give it an end date or revoke it at any time."),
                               L("Someone who is here often gets a permanent guest account with a level that decides what they see."),
                               L("Wishes from guests are answered in “Bring me something” – the link for that is shared there under “Invite guests”."),
                           ], slug: "gaeste"))
        }
        t.append(Topic(id: "people", symbol: "person.3", title: L("People: pictures, children, permanent guests, favourites"),
                       lead: L("Everyone in the household with a picture – children without a login, regular guests with just the access they need."),
                       steps: [
                           L("“Add a child”: name, optional year of birth, allergies. Children never sign in; parents rate dishes for them, and kid mode uses the same profile."),
                           L("“Add a permanent guest” (grandma, a regular babysitter) and choose what they see: ordering & shopping list, + stock, + recipes & plan, or like family. Settings, spending, receipts, backups and care notes stay hidden."),
                           L("After cooking, one tap per person: not for me, okay, loved it. Allergies warn on dishes and are never planned automatically; ratings and dislikes nudge suggestions. Cook › Favourites shows the family favourites and each person’s."),
                       ], slug: "haushalt-teilen"))
        t.append(Topic(id: "urlaub", symbol: "suitcase", title: L("Trip / away"),
                       lead: L("Enter the dates once – the rest happens around the trip, without a to-do list."),
                       steps: [
                           L("Before: a few days ahead, meal ideas and the week plan prefer what would go off while you’re away, and fresh things stay off the shopping list. A short checklist comes from your home: fridge, bins, plants, care tasks that fall into the trip."),
                           L("While away: only urgent notifications; nothing lands on the list by itself if nobody is home. Someone stays home (grandparents)? Then everything carries on for them. Cooking at the holiday flat gets its own small plan and list."),
                           L("Back home: a welcome-home list with your usual fresh things and whatever expired, ready on the way back. Home Assistant can report that everyone is away – ToHuus Hub then only suggests away mode."),
                       ]))
        t.append(Topic(id: "mcp", symbol: "bubble.left.and.text.bubble.right", title: L("Claude, ChatGPT & co. (MCP)"),
                       lead: L("Your AI assistant can read and update the household – e.g. a receipt photo: “put this into the household app”."),
                       steps: [
                           L("Claude: Settings › Connectors › “Add custom connector”. ChatGPT: Settings › Connectors (developer mode on some plans)."),
                           L("Paste the MCP address from the help page below. On your own server it is your server's address with /mcp at the end."),
                           L("Sign in with your ToHuus account, pick the household and whether the assistant may only read or also change things."),
                           L("It sees the list, tasks, recipes and household knowledge by the same rules as you – never house info codes. Settings › Connections & devices › AI assistants & access lists every connection; end one there and it stops at once."),
                           L("Your own assistant uses its own AI – it doesn't use up the messages of the ToHuus assistant."),
                       ], slug: "claude-chatgpt"))
        if app.moduleOn("ha") {
            t.append(Topic(id: "ha", symbol: "house.circle", title: L("Home Assistant"),
                           lead: L("A real integration: shopping list as a to-do list for Assist, meal plan and care tasks as calendars, sensors for dashboards, actions and events for automations."),
                           steps: [
                               L("Install “ToHuus Hub” from HACS (custom repository github.com/tillheidrich/tohuus-hub-ha) and restart Home Assistant."),
                               L("Settings › Connections & devices › AI assistants & access › “Home Assistant” – copy the token."),
                               L("In Home Assistant add the ToHuus Hub integration and paste this address and the token."),
                           ], slug: "home-assistant"))
        }
        if app.isCloud {
            t.append(Topic(id: "ailimits", symbol: "gauge.with.dots.needle.33percent", title: L("Fair AI limits"),
                           lead: L("Plus and the trial: 800 full-length messages a month. Everything else keeps working when AI pauses."),
                           steps: [
                               L("After 800 messages replies get shorter; from 1,500 AI pauses until the month ends. Household: 100 messages a month."),
                               L("A cost cap per household can pause AI earlier – for example after a great many receipt photos."),
                               L("During a pause the list, tasks, stock, money, knowledge and short sentences to the assistant keep working; receipt photos are read by text recognition. Nothing is charged extra."),
                           ], slug: "ki-grenzen"))
        }
        if !app.isCloud {
            t.append(Topic(id: "backups", symbol: "externaldrive", title: L("Backups & your data"),
                           lead: L("Everything lives in one file on your server. No cloud, no tracking."),
                           steps: [
                               L("A snapshot is made every night automatically; the last ones are kept."),
                               L("Settings › Data, plan & account › Data & backups: download a backup, or restore one with a tap."),
                               L("Off-site copy: add a WebDAV folder (e.g. Nextcloud) – use an app password."),
                               L("Export as JSON whenever you like. Passwords and access keys are never included."),
                           ], slug: "selbst-hosten"))
        } else {
            t.append(Topic(id: "data", symbol: "square.and.arrow.down", title: L("Your data"),
                           lead: L("Your household’s data is yours: export it any time, take it to your own server if you like."),
                           steps: [
                               L("Settings › Data, plan & account › Data & reset: download everything as a file."),
                               L("Moving to your own server: the same file brings the household along."),
                           ], slug: "daten-export"))
        }
        return t
    }

    private var filtered: [Topic] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return topics }
        return topics.filter { ($0.title + " " + $0.lead + " " + $0.steps.joined(separator: " ")).lowercased().contains(q) }
    }

    var body: some View {
        List {
            if query.isEmpty {
                Section {
                    Button { showTour = true } label: {
                        HStack(spacing: Theme.Space.s3) {
                            Image(systemName: "map").font(.title3).foregroundStyle(Theme.primaryText)
                                .frame(width: 40, height: 40)
                                .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Take the tour")).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                                Text(L("A few short pages through the app. Takes about two minutes.")).font(.caption).foregroundStyle(Theme.ink2)
                            }
                        }
                    }
                    if store != nil && app.isAdmin {
                        Button { showSetup = true } label: { Label(L("Run the setup again"), systemImage: "wand.and.stars") }
                    }
                } footer: {
                    Text(L("Short answers for the first week. Tap a topic."))
                }
            }
            Section(L("How does … work?")) {
                ForEach(filtered) { t in
                    DisclosureGroup(isExpanded: Binding(get: { open == t.id || !query.isEmpty }, set: { open = $0 ? t.id : nil })) {
                        VStack(alignment: .leading, spacing: Theme.Space.s3) {
                            ForEach(Array(t.steps.enumerated()), id: \.offset) { i, s in
                                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
                                    Text("\(i + 1).").font(.subheadline.monospacedDigit().weight(.semibold)).foregroundStyle(Theme.primaryText)
                                    Text(s).font(.subheadline).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            if let slug = t.slug {
                                Link(destination: Help.url(slug)) {
                                    Label(L("More on the website"), systemImage: "arrow.up.right").font(.subheadline.weight(.semibold))
                                }
                            }
                        }
                        .padding(.vertical, Theme.Space.s2)
                    } label: {
                        HStack(spacing: Theme.Space.s3) {
                            Image(systemName: t.symbol).foregroundStyle(Theme.primaryText).frame(width: 28).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                                Text(t.lead).font(.caption).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
                if filtered.isEmpty {
                    Text(L("Nothing found. The articles below go deeper.")).foregroundStyle(Theme.ink3)
                }
            }
            Section {
                ForEach(Help.articles.filter { query.isEmpty || $0.title.lowercased().contains(query.lowercased()) }, id: \.slug) { a in
                    HelpLink(slug: a.slug, title: a.title)
                }
            } header: {
                Text(L("Articles"))
            } footer: {
                Text(LF("The help pages open on %@.", SharedConfig.siteURL.host() ?? ""))
            }
            if query.isEmpty, let api = store?.api { RatgeberSection(api: api, max: 6) }
            if let url = FeedbackMail.url(instance: app.instance, household: app.session?.householdId) {
                Section {
                    Link(destination: url) { Label(L("Still stuck? Write to us"), systemImage: "lifepreserver") }
                }
            }
        }
        .themedList()
        .searchable(text: $query, prompt: L("Search help"))
        .navigationTitle(L("Help"))
        .sheet(isPresented: $showTour) { AppTourView() }
        .fullScreenCover(isPresented: $showSetup) {
            if let store { FirstRunView(store: store) }
        }
    }
}
