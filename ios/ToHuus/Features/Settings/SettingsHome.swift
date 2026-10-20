import StoreKit
import SwiftUI

// Einstellungen in six pages (UX audit 2026-10, Paket C; web: web/src/settings/registry.ts, pages/Settings.tsx).
// Mehr › Einstellungen → Ich · Haushalt · Bereiche & Orte · Mitteilungen & Kalender · Verbindungen & Geräte ·
// Daten, Abo & Konto. Page and row ids are the same as on the web (test/settings-registry.test.ts compares them),
// so a push for /einstellungen/<page>/<row> lands on the same place: tohuus://more/settings/<page>/<row>.

enum SettingsPage: String, CaseIterable, Identifiable, Hashable {
    case ich = "ich"
    case haushalt = "haushalt"
    case bereiche = "bereiche"
    case mitteilungen = "mitteilungen"
    case verbindungen = "verbindungen"
    case daten = "daten"

    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .ich: "Me"
        case .haushalt: "Household"
        case .bereiche: "Areas & places"
        case .mitteilungen: "Notifications & calendar"
        case .verbindungen: "Connections & devices"
        case .daten: "Data, plan & account"
        }
    }

    var hintKey: String {
        switch self {
        case .ich: "Calm & focus, your bar, how it looks, signing in"
        case .haushalt: "Name, language, who lives here, how you cook"
        case .bereiche: "What you use, places, pantry, recipes"
        case .mitteilungen: "What reaches you, and your calendar"
        case .verbindungen: "AI, Home Assistant, displays, printers"
        case .daten: "Plan, backups, export, reset"
        }
    }

    var icon: String {
        switch self {
        case .ich: "person.crop.circle"
        case .haushalt: "house"
        case .bereiche: "square.grid.2x2"
        case .mitteilungen: "bell"
        case .verbindungen: "point.3.connected.trianglepath.dotted"
        case .daten: "externaldrive"
        }
    }
}

/// Where Mehr's navigation goes inside Einstellungen (also used by the deep link tohuus://more/settings/…).
enum SettingsRoute: Hashable {
    case home
    case page(SettingsPage)
    case more(SettingsPage)
    case row(String)
}

enum SettingsRegistry {
    struct Row: Identifiable, Hashable, Sendable {
        let id: String
        let page: SettingsPage
        let titleKey: String
        let icon: String
        let words: String
        var hintKey: String?
        /// on the page itself (Ruhe & Fokus) – the others open their own screen
        var inline = false
        /// behind "Mehr Optionen"
        var more = false
        /// permanent guests see it
        var guest = false
        var admin = false
        /// true = only ToHuus Cloud
        var cloud: Bool?
        /// "Was nutzt ihr?" area
        var module: String?
        /// small heading over a group of rows
        var group: String?

        init(_ id: String, _ page: SettingsPage, _ titleKey: String, icon: String, words: String, hint: String? = nil, inline: Bool = false,
             more: Bool = false, guest: Bool = false, admin: Bool = false, cloud: Bool? = nil, module: String? = nil, group: String? = nil) {
            self.id = id
            self.page = page
            self.titleKey = titleKey
            self.icon = icon
            self.words = words
            self.hintKey = hint
            self.inline = inline
            self.more = more
            self.guest = guest
            self.admin = admin
            self.cloud = cloud
            self.module = module
            self.group = group
        }

        var title: String { L(titleKey) }
        var hint: String? { hintKey.map { L($0) } }
    }

    /// Same order, ids and pages as web/src/settings/registry.ts ROWS (without the web-only "teilen": the iPhone has
    /// the system share sheet). Words: German and English, what people type.
    static let rows: [Row] = [
        // Ich – Ruhe & Fokus first: the switches for days without strength
        Row("fokus", .ich, "Calm & focus", icon: "leaf", words: "ruhe fokus sanfter modus nur eins adhs ads autismus überfordert weniger timer erinnerungen bündeln abends fragen check-in gentle just one calm focus", hint: "Gentle mode, Just one, how much Today shows", inline: true),
        Row("profil", .ich, "Name, picture & taste", icon: "face.smiling", words: "name bild foto avatar tier geschmack allergien unverträglichkeit vegetarisch profil picture taste allergy", hint: "How the others see you, what you like, allergies", guest: true),
        Row("leiste", .ich, "Your bar", icon: "dock.rectangle", words: "leiste deine leiste tabs unten reiter anpassen bereiche tauschen bar", hint: "Which areas sit at the bottom"),
        Row("darstellung", .ich, "Appearance & readability", icon: "circle.lefthalf.filled", words: "darstellung hell dunkel dark mode farbe schrift größe lesbarkeit liste ansicht kompakt appearance theme", hint: "Light or dark, text size, how the list looks"),
        Row("anmeldung", .ich, "Sign-in & security", icon: "key", words: "anmelden anmeldung passwort passkey e-mail mail zwei-schritt 2fa sso pin geräte sitzungen abmelden sicherheit konto password security", hint: "Password, passkeys, e-mail, devices", guest: true),
        // Haushalt
        Row("name", .haushalt, "Name & language", icon: "house", words: "haushalt name sprache deutsch englisch language household"),
        Row("leute", .haushalt, "Who lives here?", icon: "person.2", words: "leute mitglieder personen kinder gäste einladen rolle admin familie wg wer wohnt hier people members invite", hint: "People, children, guests, invitations"),
        Row("anmeldewege", .haushalt, "Ways to sign in", icon: "person.badge.key", words: "anmeldewege anmeldung passkeys passwort sso openid single sign-on zwei-schritt pin login mitglieder anmelden sign in", hint: "Passkeys, e-mail links, passwords, single sign-on", more: true, admin: true),
        Row("region", .haushalt, "Region & currency", icon: "globe.europe.africa", words: "region land währung euro franken läden region currency"),
        Row("kochstil", .haushalt, "How do you cook?", icon: "frying.pan", words: "kochen kochstil thermomix zeit vegetarisch wie kocht ihr cook style", hint: "Thermomix, how much time, what you avoid", module: "cook"),
        Row("extras", .haushalt, "Extras in the weekly shop", icon: "birthday.cake", words: "extras kontingent luxus naschen süßes spaß budget woche weekly treats allowance"),
        Row("brotdose", .haushalt, "Lunchbox", icon: "takeoutbag.and.cup.and.straw", words: "brotdose schule kita pausenbrot lunchbox"),
        Row("wochenfrage", .haushalt, "Question of the week", icon: "bubble.left", words: "wochenfrage umfrage frage der woche puls pulse question", more: true),
        Row("sterne", .haushalt, "Stars", icon: "star", words: "sterne punkte belohnung kinder stars", more: true),
        Row("teilen-zeile", .haushalt, "Line under shared lists", icon: "square.and.arrow.up", words: "geteilt aus tohuus zeile fußzeile teilen liste footer shared", more: true),
        // Bereiche & Orte – "Was nutzt ihr?" first
        Row("module", .bereiche, "What do you use?", icon: "switch.2", words: "was nutzt ihr bereiche module ausschalten einschalten weniger überfordert areas modules", hint: "Switch off what you don’t need"),
        Row("orte", .bereiche, "Places & categories", icon: "mappin.and.ellipse", words: "orte räume kategorien regal schrank kühlschrank keller places categories", hint: "Fridge, cellar, shelves"),
        Row("vorrat", .bereiche, "Pantry: what to track?", icon: "cabinet", words: "vorrat bestand verfolgen was verfolgen nur was ausgeht alles tracking pantry track", hint: "Everything, or only what runs out", module: "stock"),
        Row("rezepte", .bereiche, "Recipes & imports", icon: "book", words: "rezepte import cookidoo chefkoch webseite übernehmen recipes", hint: "From websites, apps and Cookidoo", module: "cook"),
        Row("karte", .bereiche, "Bring me something: menu", icon: "hand.raised", words: "bring mir was karte speisekarte bestellen getränke treats menu", module: "treats"),
        Row("urlaub", .bereiche, "Trip & handover", icon: "suitcase", words: "urlaub verreist unterwegs übergabe haushüter trip away handover"),
        // Mitteilungen & Kalender
        Row("meine", .mitteilungen, "What reaches you", icon: "bell", words: "mitteilungen benachrichtigungen push ruhezeiten nur für mich notifications", hint: "On this phone or browser, only for you"),
        Row("haushalt-kanaele", .mitteilungen, "For the whole household", icon: "dot.radiowaves.left.and.right", words: "kanäle haushalt e-mail ntfy webhook telegram matrix tagesübersicht mhd warnung push channels digest", hint: "Home Assistant, ntfy, e-mail, Telegram"),
        Row("kalender-lesen", .mitteilungen, "Read your calendar", icon: "calendar", words: "kalender lesen müll abfuhr termine google outlook ics calendar read", hint: "Bin dates and appointments from your calendar", group: "Calendar"),
        Row("caldav", .mitteilungen, "Reminders & calendar", icon: "checklist.checked", words: "apple erinnerungen caldav kalender aufgaben termine reminders", hint: "Tasks in Apple Reminders or your calendar app", group: "Calendar"),
        Row("kalender-abo", .mitteilungen, "Calendar subscription", icon: "link", words: "kalender abo abonnieren ics link feed subscription", hint: "A link your calendar app can subscribe to", group: "Calendar"),
        Row("laden", .mitteilungen, "Hint in the shop", icon: "location", words: "laden ort standort geofence hinweis im laden supermarkt shop location"),
        // Verbindungen & Geräte
        Row("ki", .verbindungen, "AI", icon: "sparkles", words: "ki künstliche intelligenz assistent datenschutz mit ohne ki gedächtnis ai privacy", hint: "On or off, and what it may see"),
        Row("assistent", .verbindungen, "AI assistants & access", icon: "key", words: "mcp claude chatgpt token zugang zugriff api schlüssel skript access", hint: "Claude, ChatGPT, scripts (MCP)"),
        Row("home-assistant", .verbindungen, "Home Assistant", icon: "house.circle", words: "home assistant smart home hacs alexa sprachassistent cookidoo to-do", module: "ha"),
        Row("displays", .verbindungen, "Displays & family tablet", icon: "display", words: "display bildschirm tablet kiosk familien-tablet küche wand displays"),
        Row("drucker", .verbindungen, "Printers", icon: "printer", words: "drucker bondrucker ausdruck zettel ticket printer print", hint: "Print lists and notes on a receipt printer"),
        Row("etiketten", .verbindungen, "QR labels", icon: "qrcode", words: "etiketten qr drucken aufkleber labels"),
        Row("mail", .verbindungen, "Receipts by e-mail", icon: "envelope", words: "e-mail postfach bon mail kassenbon weiterleiten imap inbox", more: true, admin: true),
        Row("server", .verbindungen, "Servers & households", icon: "server.rack", words: "server haushalt wechseln eigener server verbinden cloud"),
        // Daten, Abo & Konto
        Row("abo", .daten, "Plan & storage", icon: "creditcard", words: "abo plan speicher bezahlen preis kündigen rechnung subscription storage", hint: "Your plan, the assistant this month, storage"),
        Row("sicherung", .daten, "Data & backups", icon: "externaldrive", words: "daten export sicherung backup import umzug csv kaufhistorie fehlerprotokoll data backups", hint: "Export, backups, move, purchase history"),
        Row("zuruecksetzen", .daten, "Data & reset", icon: "arrow.counterclockwise", words: "zurücksetzen löschen leeren beispieldaten demo neu anfangen wiederherstellen reset clear sample", hint: "Sample data, clear areas, start over"),
        Row("konto", .daten, "Your data & account", icon: "trash", words: "konto löschen account löschen deine daten herunterladen dsgvo auskunft delete account your data", hint: "Download everything, or delete the account", cloud: true),
        // Platz für den Wunschlisten-Bereich: eine Zeile „Geschenk-Erinnerungen“ (Mitteilungen & Kalender) kommt hier
        // dazu, sobald die Wunschlisten fertig sind – gleiche Id wie auf dem Web (registry.ts) eintragen.
    ]

    @MainActor static func visible(_ app: AppModel, page: SettingsPage? = nil) -> [Row] {
        rows.filter { r in
            if let page, r.page != page { return false }
            if app.isGuest && !r.guest { return false }
            if r.admin && !app.isAdmin { return false }
            if let c = r.cloud, c != app.isCloud { return false }
            if let m = r.module, app.modules[m] == false { return false }
            return true
        }
    }

    @MainActor static func pages(_ app: AppModel) -> [SettingsPage] {
        SettingsPage.allCases.filter { !visible(app, page: $0).isEmpty }
    }

    static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).replacingOccurrences(of: "ß", with: "ss")
    }

    /// Every typed word must appear in the title (both languages), hint, words or page name – like the web.
    @MainActor static func search(_ q: String, app: AppModel) -> [Row] {
        let terms = fold(q).split(whereSeparator: \.isWhitespace).map(String.init)
        guard !terms.isEmpty else { return [] }
        return visible(app).filter { r in
            let hay = fold([r.titleKey, r.title, r.hintKey ?? "", r.hint ?? "", r.words, r.page.titleKey, L(r.page.titleKey)].joined(separator: " "))
            return terms.allSatisfy { hay.contains($0) }
        }
    }

    /// The screen behind a row (inline rows open their page).
    @MainActor static func destination(_ id: String, store: ServerStore) -> some View {
        SettingsRowScreen(id: id, store: store)
    }

    @MainActor @ViewBuilder
    static func view(for route: SettingsRoute, store: ServerStore) -> some View {
        switch route {
        case .home: SettingsHomeView(store: store)
        case .page(let p): SettingsPageView(page: p, store: store)
        case .more(let p): SettingsMoreView(page: p, store: store)
        case .row(let id): destination(id, store: store)
        }
    }

    /// "ich/darstellung" (deep link path after /settings/) → the screens to push
    static func routes(for path: String) -> [SettingsRoute] {
        let parts = path.split(separator: "/").map(String.init)
        var out: [SettingsRoute] = [.home]
        guard let first = parts.first, let page = SettingsPage(rawValue: first) else { return out }
        out.append(.page(page))
        if parts.count > 1 {
            if parts[1] == "mehr" { out.append(.more(page)) }
            else if let r = rows.first(where: { $0.id == parts[1] && $0.page == page }), !r.inline {
                if r.more { out.append(.more(page)) }
                out.append(.row(r.id))
            }
        }
        return out
    }
}

/// The screen behind one row – same ids as the web (pages/Settings.tsx rowViews).
struct SettingsRowScreen: View {
    let id: String
    let store: ServerStore
    @Environment(AppModel.self) private var app

    var body: some View {
        let api = store.api
        switch id {
        case "fokus": SettingsPageView(page: .ich, store: store)
        case "profil": MyProfileView(api: api)
        case "leiste": NavBarSettingsView()
        case "darstellung": AppearanceAndListView(api: api)
        case "anmeldung": MyAccountView(api: api)
        case "name": HouseholdBasicsView(api: api)
        case "leute": HouseholdView(api: api)
        case "anmeldewege": SignInAdminScreen(api: api)
        case "region": RegionSettingsView(api: api)
        case "kochstil": CookStyleSettingsView(api: api)
        case "extras": SectionScreen(title: L("Extras in the weekly shop")) { ExtrasSettingsSection(api: api, admin: app.isAdmin) }
        case "brotdose": LunchboxSettingsView(api: api)
        case "wochenfrage": SectionScreen(title: L("Question of the week")) { PulseSettingsSection(api: api, admin: app.isAdmin) }
        case "sterne": SectionScreen(title: L("Stars")) { StarsSettingsSection(api: api, admin: app.isAdmin) }
        case "teilen-zeile": ShareFooterSettingsView(api: api)
        case "module": ModulesView(api: api)
        case "orte": PlacesSettingsView(api: api)
        case "vorrat": StartModeView(api: api, isAdmin: app.isAdmin)
        case "rezepte": RecipeImportSheet(store: store)
        case "karte": MenuEditorView(store: store)
        case "urlaub": AwayView(store: store)
        case "meine": NotificationSettingsView()
        case "haushalt-kanaele": HouseholdChannelsView(api: api)
        case "kalender-lesen": CalendarSyncView(api: api, household: app.store?.householdKey ?? "default")
        case "caldav", "kalender-abo": CalDavView(api: api)
        case "laden": StoreArrivalView(store: store)
        case "ki": AISettingsView()
        case "assistent": AssistantAccessHubView(api: api)
        case "home-assistant": HomeAssistantHubView(api: api)
        case "displays": DisplaysView(api: api)
        case "drucker": PrintersView(api: api)
        case "etiketten": LabelsView(api: api)
        case "mail": MailInboxView(api: api)
        case "server": ConnectionsView()
        case "abo": PlanStorageView()
        case "sicherung": DataSettingsView(api: api)
        case "zuruecksetzen": DataWipeView(api: api)
        case "konto": AccountDataView()
        default: SettingsHomeView(store: store)
        }
    }
}

extension View {
    /// The pushes inside Einstellungen (value links): every NavigationStack that can show a settings page needs it.
    func settingsRoutes(store: ServerStore) -> some View {
        navigationDestination(for: SettingsRoute.self) { r in SettingsRegistry.view(for: r, store: store) }
    }
}

/// Mehr › Einstellungen: the six pages, and the search over every row of every page.
struct SettingsHomeView: View {
    let store: ServerStore
    @Environment(AppModel.self) private var app
    @State private var query = ""

    var body: some View {
        List {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                Section {
                    ForEach(SettingsRegistry.pages(app)) { p in
                        NavigationLink(value: SettingsRoute.page(p)) {
                            SettingsRowLabel(title: L(p.titleKey), hint: L(p.hintKey), icon: p.icon)
                        }
                    }
                }
            } else {
                let hits = SettingsRegistry.search(query, app: app)
                Section {
                    ForEach(hits) { r in
                        NavigationLink(value: r.inline ? SettingsRoute.page(r.page) : SettingsRoute.row(r.id)) {
                            SettingsRowLabel(title: r.title, hint: L(r.page.titleKey), icon: r.icon)
                        }
                    }
                    if hits.isEmpty {
                        Text(L("Nothing found. Try another word, or ask the assistant.")).font(.footnote).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
        .themedList()
        .navigationTitle(L("Settings"))
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L("Find a setting"))
    }
}

/// One page: Ruhe & Fokus on the page itself, the rest as rows; rarely needed ones behind "Mehr Optionen".
struct SettingsPageView: View {
    let page: SettingsPage
    let store: ServerStore
    @Environment(AppModel.self) private var app

    var body: some View {
        let rows = SettingsRegistry.visible(app, page: page)
        let main = rows.filter { !$0.more && !$0.inline }
        let more = rows.filter(\.more)
        let groups = Array(Set(main.map { $0.group ?? "" })).sorted { a, b in
            (main.firstIndex { ($0.group ?? "") == a } ?? 0) < (main.firstIndex { ($0.group ?? "") == b } ?? 0)
        }
        List {
            if rows.contains(where: { $0.id == "fokus" }) {
                FocusSettingsSection(api: store.api)
                CheckinSettingSection(api: store.api)
            }
            ForEach(groups, id: \.self) { g in
                Section {
                    ForEach(main.filter { ($0.group ?? "") == g }) { r in
                        NavigationLink(value: SettingsRoute.row(r.id)) {
                            SettingsRowLabel(title: r.title, hint: r.hint, icon: r.icon)
                        }
                    }
                } header: {
                    if !g.isEmpty { Text(L(g)) }
                }
            }
            if !more.isEmpty {
                Section {
                    NavigationLink(value: SettingsRoute.more(page)) {
                        SettingsRowLabel(title: L("More options"), hint: more.map(\.title).joined(separator: " · "), icon: "ellipsis.circle")
                    }
                }
            }
        }
        .themedList()
        .navigationTitle(L(page.titleKey))
    }
}

struct SettingsMoreView: View {
    let page: SettingsPage
    let store: ServerStore
    @Environment(AppModel.self) private var app

    var body: some View {
        List {
            ForEach(SettingsRegistry.visible(app, page: page).filter(\.more)) { r in
                NavigationLink(value: SettingsRoute.row(r.id)) { SettingsRowLabel(title: r.title, hint: r.hint, icon: r.icon) }
            }
        }
        .themedList()
        .navigationTitle(L("More options"))
    }
}

struct SettingsRowLabel: View {
    let title: String
    var hint: String?
    let icon: String

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let hint { Text(hint).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2) }
            }
        } icon: {
            Image(systemName: icon).foregroundStyle(Theme.primaryText)
        }
        .frame(minHeight: 44)
    }
}

/// A settings section that has no screen of its own yet (Extras, Wochenfrage, Sterne).
struct SectionScreen<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        Form { content }
            .themedList()
            .navigationTitle(title)
    }
}

/// Ich › Name, Bild & Geschmack: your own person card (picture, likes, allergies).
struct MyProfileView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var userId: Int?
    @State private var failed = false

    var body: some View {
        Group {
            if let userId {
                PersonProfileView(api: api, personKey: "u\(userId)", name: app.userName ?? "")
            } else if failed {
                MyAccountView(api: api)
            } else {
                ProgressView()
            }
        }
        .task {
            userId = (try? await api.me())?.actor?["userId"]?.int
            failed = userId == nil
        }
    }
}

/// Haushalt › Mehr Optionen › Anmeldewege (admins): how members may sign in – knows who "you" are.
struct SignInAdminScreen: View {
    let api: APIClient
    @State private var userId: Int?
    @State private var loaded = false

    var body: some View {
        Group {
            if loaded { SignInAdminView(api: api, myUserId: userId) } else { ProgressView() }
        }
        .task {
            userId = (try? await api.me())?.actor?["userId"]?.int
            loaded = true
        }
    }
}

/// Ich › Darstellung & Lesbarkeit: light/dark (household and own) and how the list looks.
struct AppearanceAndListView: View {
    let api: APIClient

    var body: some View {
        List {
            NavigationLink { AppearanceSettingsView(api: api) } label: { Label(L("Appearance"), systemImage: "circle.lefthalf.filled") }
            NavigationLink { ListDisplaySettingsView() } label: { Label(L("How the list looks"), systemImage: "textformat.size") }
        }
        .themedList()
        .navigationTitle(L("Appearance & readability"))
    }
}

/// Mitteilungen & Kalender › Für den ganzen Haushalt: shared channels.
struct HouseholdChannelsView: View {
    let api: APIClient

    var body: some View {
        List {
            NavigationLink { HouseholdNotifyView(api: api) } label: { Label(L("Webhooks, ntfy & e-mail"), systemImage: "point.3.connected.trianglepath.dotted") }
            NavigationLink { ChannelsView(api: api) } label: { Label(L("Telegram, Gotify & Matrix"), systemImage: "paperplane") }
        }
        .themedList()
        .navigationTitle(L("For the whole household"))
    }
}

/// Verbindungen › Home Assistant (with Cookidoo via HA, like the web page).
struct HomeAssistantHubView: View {
    let api: APIClient

    var body: some View {
        List {
            NavigationLink { HomeAssistantView(api: api) } label: { Label("Home Assistant", systemImage: "house") }
            NavigationLink { CookidooView(api: api) } label: { Label("Cookidoo", systemImage: "fork.knife") }
        }
        .themedList()
        .navigationTitle("Home Assistant")
    }
}

/// Verbindungen › KI-Assistenten & Zugänge: connected assistants (OAuth) and access keys.
struct AssistantAccessHubView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app

    var body: some View {
        List {
            NavigationLink { ConnectAssistantView(api: api) } label: { Label(L("AI assistants & access"), systemImage: "sparkles") }
            if app.isAdmin {
                NavigationLink { AccessTokensView(api: api) } label: { Label(L("Access keys"), systemImage: "key") }
            }
        }
        .themedList()
        .navigationTitle(L("AI assistants & access"))
    }
}

/// Haushalt › Mehr Optionen › Zeile unter geteilten Listen (PUT /api/share/settings { footer }, admins).
struct ShareFooterSettingsView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var on = ShareFooter.on
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Toggle(isOn: Binding(get: { on }, set: { v in Task { await set(v) } })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("“Shared from ToHuus” under shared lists"))
                        Text(L("One line with the link, so others know where the list comes from. Nothing is ever sent without you tapping Share."))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                .tint(Theme.primary)
                .disabled(!app.isAdmin)
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
            } footer: {
                if !app.isAdmin { Text(L("Only admins can change this.")) }
            }
        }
        .themedList()
        .navigationTitle(L("Line under shared lists"))
    }

    private func set(_ v: Bool) async {
        let old = on
        on = v
        do {
            _ = try await api.send("PUT", "api/share/settings", json: ["footer": v], as: Ignored.self)
            ShareFooter.adopt(site: nil, on: v)
            error = nil
        } catch {
            on = old
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// Daten, Abo & Konto › Abo & Speicher (was a section in Mehr). Own server: "everything included".
struct PlanStorageView: View {
    @Environment(AppModel.self) private var app
    @State private var manageSubscriptions = false

    var body: some View {
        Form {
            Section {
                LabeledContent(L("Current plan"), value: app.billing?.planLabel ?? (app.isCloud ? L("Free – without AI") : L("Own server – everything included")))
                if let b = app.billing, b.isPaid {
                    if let r = ServerDate.parse(b.renewsAt) {
                        LabeledContent(L("Renews on"), value: r.formatted(date: .abbreviated, time: .omitted))
                    } else if let e = ServerDate.parse(b.expiresAt) {
                        LabeledContent(L("Ends on"), value: e.formatted(date: .abbreviated, time: .omitted))
                    }
                    if b.period == "yearly" {
                        Toggle(L("E-mail me 3 days before it renews"), isOn: Binding(
                            get: { b.reminder?.bool ?? b.reminder?["enabled"]?.bool ?? false },
                            set: { on in Task { _ = try? await app.api?.send("PATCH", "api/billing/reminder", json: ["enabled": on], as: Ignored.self); await app.refreshBilling() } }))
                    }
                }
                if let used = app.billing?.assistantUsed {
                    LabeledContent(L("Assistant this month"), value: app.billing?.assistantLimit.map { "\(used) / \($0)" } ?? "\(used)")
                }
                if let used = app.billing?.storageUsedBytes {
                    let limit = app.billing?.storageLimitBytes
                    VStack(alignment: .leading) {
                        LabeledContent(L("Storage"), value: limit.map { "\(bytes(used)) / \(bytes($0))" } ?? bytes(used))
                        if let limit, limit > 0 { ProgressView(value: min(used / limit, 1)).tint(used > limit * 0.9 ? Theme.low : Theme.primary) }
                    }
                }
                if app.purchasesAvailable {
                    Button(app.billing?.isPaid == true ? L("Manage plan") : L("See plans")) { app.openPaywall("settings") }
                    if app.billing?.source == "apple" || app.billing?.isPaid == true {
                        Button(L("Manage subscription")) {
                            if UIApplication.shared.connectedScenes.first is UIWindowScene { manageSubscriptions = true }
                            else if let u = URL(string: app.billing?.manageUrl ?? "https://apps.apple.com/account/subscriptions") { UIApplication.shared.open(u) }
                        }
                    }
                }
            } footer: {
                if !app.isCloud { Text(L("Your household runs on your own server. Every function is there, nothing to pay.")) }
            }
        }
        .themedList()
        .navigationTitle(L("Plan & storage"))
        .task { await app.refreshBilling() }
        .manageSubscriptionsSheet(isPresented: $manageSubscriptions)
    }

    private func bytes(_ b: Double) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(b), countStyle: .file)
    }
}

/// Daten, Abo & Konto › Deine Daten & Konto (ToHuus Cloud): delete the account (was at the end of Mehr).
struct AccountDataView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false
    @State private var hasPassword = true
    @State private var appleLinked = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Text(L("Deleting your account removes your access. If you are the last member of a household, the household and all its data are deleted for good."))
                    .font(.footnote).foregroundStyle(Theme.ink2)
                Button(L("Delete account"), role: .destructive) { confirmDelete = true }
            } footer: {
                Text(L("Want a copy first? Data & backups › Export."))
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(L("Your data & account"))
        .task {
            if let me = try? await app.api?.cloudMe() {
                hasPassword = me.hasPassword
                appleLinked = me.appleLinked
            }
        }
        .accountDeletion(isPresented: $confirmDelete, hasPassword: hasPassword, appleLinked: appleLinked,
                         onError: { error = $0 }, onDeleted: { app.showMore = false })
    }
}
