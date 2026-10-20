import SwiftUI

/// One search for everything (UX benchmark 2.4, web: search/GlobalSearch.tsx, server: routes/search.ts):
/// functions and settings from a registry with the words people type, plus the household's things – Vorrat, the
/// list, recipes, tasks, Hausinfo, people – filtered by the server like each area. Nothing found: put it on the list
/// or make it a task.
struct GlobalSearchView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let store: ServerStore
    @State private var query = ""
    @State private var groups = SearchGroups()
    @State private var toast: ToastMessage?
    /// "Wo ist was?" from the search: its own sheet, a product opens on top of the search
    @State private var showFind = false
    @State private var findProduct: Int?

    var body: some View {
        NavigationStack {
            List {
                let q = query.trimmingCharacters(in: .whitespaces)
                if q.isEmpty {
                    Section {
                        Text(L("Find a function, a setting or anything in your household.")).foregroundStyle(Theme.ink3)
                    }
                } else {
                    let fns = SearchRegistry.matches(q, app: app)
                    if !fns.isEmpty {
                        Section(L("Functions & settings")) { ForEach(fns) { f in functionRow(f) } }
                    }
                    if let l = groups.list, !l.isEmpty {
                        Section(L("Found on the list")) {
                            ForEach(l) { x in
                                Button { openTab("shopping") } label: { row(x.text, x.list, "cart") }
                            }
                        }
                    }
                    if let p = groups.products, !p.isEmpty {
                        Section(L("Pantry")) {
                            ForEach(p) { x in
                                NavigationLink { ProductDetailView(productId: x.id, store: store) } label: {
                                    row(x.name, x.inStock == false ? L("not at home") : x.brand, "cabinet")
                                }
                            }
                        }
                    }
                    if let t = groups.tasks, !t.isEmpty {
                        Section(L("Tasks")) {
                            ForEach(t) { x in
                                NavigationLink { CareView(api: store.api) } label: {
                                    row(x.name, x.nextDue.map { CareLabels.day($0) }, x.private == true ? "lock" : "checklist")
                                }
                            }
                        }
                    }
                    if let r = groups.recipes, !r.isEmpty {
                        Section(L("Recipes")) {
                            ForEach(r) { x in
                                NavigationLink { RecipeDetailView(recipeId: x.id, store: store) } label: {
                                    row(x.title, x.with.map { LF("with %@", $0) }, "fork.knife")
                                }
                            }
                        }
                    }
                    if let h = groups.house, !h.isEmpty {
                        Section(L("House info")) {
                            ForEach(h) { x in NavigationLink { HouseGuideView() } label: { row(x.title, nil, "info.circle") } }
                        }
                    }
                    if let w = groups.wishes, !w.isEmpty {
                        Section(L("Wishes")) {
                            ForEach(w) { x in
                                NavigationLink { WishListDetailView(api: store.api, listId: x.listId) } label: { row(x.title, x.sub, "gift") }
                            }
                        }
                    }
                    if let p = groups.people, !p.isEmpty {
                        Section(L("People")) {
                            ForEach(p) { x in
                                NavigationLink { HouseholdView(api: store.api) } label: {
                                    HStack(spacing: Theme.Space.s3) {
                                        PersonAvatar(name: x.name, key: x.key, size: 28, api: store.api)
                                        Text(x.name)
                                    }
                                }
                            }
                        }
                    }
                    Section(L("Add")) {
                        Button { Task { await addToList(q) } } label: { Label(LF("Put “%@” on the list", q), systemImage: "cart.badge.plus") }
                        if !app.isGuest {
                            Button { Task { await addTask(q) } } label: { Label(LF("New task “%@”", q), systemImage: "plus.circle") }
                        }
                    }
                }
            }
            .themedList()
            .navigationTitle(L("Search"))
            .settingsRoutes(store: store)
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L("Milk, bathroom, password …"))
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .task(id: query) {
                let q = query.trimmingCharacters(in: .whitespaces)
                guard q.count >= 2 else { groups = SearchGroups(); return }
                try? await Task.sleep(nanoseconds: 200_000_000)
                if Task.isCancelled { return }
                groups = (try? await store.api.search(q)) ?? SearchGroups()
            }
            .toast($toast)
            .sheet(isPresented: $showFind) { FindView(store: store) { id in showFind = false; findProduct = id } }
            .navigationDestination(item: $findProduct) { id in ProductDetailView(productId: id, store: store) }
        }
    }

    private func row(_ title: String, _ sub: String?, _ icon: String) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: icon).foregroundStyle(Theme.ink3).frame(width: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(Theme.ink)
                if let sub, !sub.isEmpty { Text(sub).font(.caption).foregroundStyle(Theme.ink3) }
            }
        }
    }

    @ViewBuilder
    private func functionRow(_ f: SearchRegistry.Entry) -> some View {
        if f.tab == nil, f.settingsRow == nil, f.target == .find {
            Button { showFind = true } label: { row(f.title, nil, f.icon) }
        } else if f.tab == nil, f.settingsRow == nil, f.target == .kitchen {
            Button { app.showKitchen = true; dismiss() } label: { row(f.title, nil, f.icon) }
        } else if let tab = f.tab {
            Button { openTab(tab) } label: { row(f.title, nil, f.icon) }
        } else if let r = f.settingsRow {
            NavigationLink { SettingsRegistry.destination(r, store: store) } label: { row(f.title, f.sub, f.icon) }
        } else {
            NavigationLink { SearchRegistry.destination(f.target, store: store) } label: { row(f.title, nil, f.icon) }
        }
    }

    private func openTab(_ tab: String) {
        // Aufgaben and Vorrat are tabs of their own (AppArea.from)
        app.requestedTab = tab
        dismiss()
    }

    private func addToList(_ text: String) async {
        do {
            _ = try await store.api.send("POST", "api/shopping", json: ["text": String(text.prefix(200))], as: Ignored.self)
            toast = ToastMessage(text: LF("“%@” is on the list", text))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func addTask(_ text: String) async {
        do {
            _ = try await store.api.send("POST", "api/care", json: ["name": String(text.prefix(120)), "category": "house", "as_needed": true], as: Ignored.self)
            toast = ToastMessage(text: LF("Task “%@” added", text))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// GET /api/search?q= → { q, groups }
struct SearchGroups: Decodable, Sendable {
    struct Product: Decodable, Sendable, Identifiable { var id: Int; var name: String; var brand: String?; var inStock: Bool? }
    struct ListRow: Decodable, Sendable, Identifiable { var id: Int; var text: String; var list: String? }
    struct Recipe: Decodable, Sendable, Identifiable { var id: Int; var title: String; var with: String? }
    struct TaskHit: Decodable, Sendable, Identifiable { var id: Int; var name: String; var nextDue: String?; var `private`: Bool? }
    struct House: Decodable, Sendable, Identifiable { var id: Int; var title: String }
    struct PersonHit: Decodable, Sendable, Identifiable { var key: String; var name: String; var id: String { key } }
    var products: [Product]?
    var list: [ListRow]?
    var recipes: [Recipe]?
    var tasks: [TaskHit]?
    var house: [House]?
    var people: [PersonHit]?
    /// wish lists and wishes this person may see (never reservation states)
    struct WishHit: Decodable, Sendable, Identifiable { var key: String; var title: String; var listId: Int; var sub: String?; var id: String { key } }
    var wishes: [WishHit]?
}

private struct SearchAnswer: Decodable, Sendable { var groups: SearchGroups }

extension APIClient {
    func search(_ q: String) async throws -> SearchGroups {
        // as a query item: "M&M" or "1+1" must not split the query (code review 14 Oct 2026)
        return try await get("api/search", query: [URLQueryItem(name: "q", value: q)], as: SearchAnswer.self).groups
    }
}

/// The shared function register (shared/functions.json, Paket D, docs/glossary.md), copied into the app bundle by
/// project.yml. The web search reads the same file (web/src/search/functions.ts) with the same rules, so both find the
/// same functions (test/functions-registry.test.ts checks the file, the targets and this filter).
struct FunctionRegister: Decodable, Sendable {
    struct Text: Decodable, Sendable { var de: String; var en: String }
    struct Icon: Decodable, Sendable { var web: String; var ios: String }
    struct Fn: Decodable, Sendable, Identifiable {
        var id: String
        var group: String
        var title: Text
        /// a longer row title in Mehr (Wünsche: „Wunschlisten & Geschenke“)
        var more: Text?
        var words: Text
        var web: String?
        var ios: String?
        var help: String?
        var icon: Icon
        var platforms: [String]
        var roles: [String]
        var module: String?
    }
    var functions: [Fn]
    /// the group titles (Mehr, Alle Funktionen)
    struct GroupTitle: Decodable, Sendable { var id: String; var de: String; var en: String }
    var groups: [GroupTitle]?
    /// Mehr: groups, their rows, the most rows a group shows (MoreMenu.swift; web: moreMenu in search/functions.ts)
    struct MoreSpec: Decodable, Sendable {
        struct G: Decodable, Sendable { var id: String; var rows: [String]; var whenNotInBar: String? }
        var groups: [G]
        var max: Int
    }
    var more: MoreSpec?

    static let shared: FunctionRegister = {
        guard let url = Bundle.main.url(forResource: "functions", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let r = try? JSONDecoder().decode(FunctionRegister.self, from: data) else { return FunctionRegister(functions: [], groups: nil, more: nil) }
        return r
    }()

    /// same rules as functionsFor() in web/src/search/functions.ts: platform, role, switched-off areas
    @MainActor static func visible(app: AppModel) -> [Fn] {
        let role = app.isGuest ? "guest" : (app.isAdmin ? "admin" : "member")
        return shared.functions.filter { f in
            f.platforms.contains("ios") && f.roles.contains(role) && (f.module.map { app.moduleOn($0) } ?? true)
        }
    }

    static var german: Bool { Bundle.main.preferredLocalizations.first?.hasPrefix("de") == true }
}

/// Every function and setting of the app: the functions from the shared register, the rows of Einstellungen.
enum SearchRegistry {
    enum Target: String {
        case account, household, people, invite, places, notifications, connections, data, ai, calendar, labels, help
        case servers, devices, guests, treats, knowledge, wishes, giving, receipts, spending, favourites, houseInfo, away, listLook, focus, loadCards
        case find, kitchen, careFor, mind, week, settings, howItWorks, goodToKnow, handover
    }

    struct Entry: Identifiable {
        var title: String
        var words: String
        var icon: String
        var target: Target = .help
        /// a tab instead of a screen
        var tab: String?
        var adminOrMember = true
        /// a row of Einstellungen (SettingsHome.swift) – opens that screen
        var settingsRow: String?
        /// the settings page it sits on
        var sub: String?
        var id: String { title + (settingsRow ?? tab ?? target.rawValue) }
    }

    /// "tab:<area>" → a tab; "settings" → the settings list; otherwise a screen
    static func entry(_ f: FunctionRegister.Fn) -> Entry? {
        guard let ios = f.ios else { return nil }
        let title = FunctionRegister.german ? f.title.de : f.title.en
        let words = "\(f.title.de) \(f.title.en) \(f.words.de) \(f.words.en)"
        if ios.hasPrefix("tab:") { return Entry(title: title, words: words, icon: f.icon.ios, tab: String(ios.dropFirst(4))) }
        if ios == "settings" { return Entry(title: title, words: words, icon: f.icon.ios, settingsRow: "home") }
        guard let t = Target(rawValue: ios) else { return nil }
        return Entry(title: title, words: words, icon: f.icon.ios, target: t)
    }

    @MainActor static func all(app: AppModel) -> [Entry] {
        var out = FunctionRegister.visible(app: app).compactMap(entry)
        // every row of Einstellungen, with its page (Paket C – the same rows and words as the web)
        out += SettingsRegistry.visible(app).map { r in
            Entry(title: r.title, words: "\(r.titleKey) \(r.words) \(r.hint ?? "") \(L(r.page.titleKey))", icon: r.icon, settingsRow: r.id, sub: L(r.page.titleKey))
        }
        return out
    }

    /// lower case, no accents, ß → ss (the web's foldText)
    static func fold(_ s: String) -> String {
        s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased().replacingOccurrences(of: "ß", with: "ss")
    }

    /// every typed word in the title or the words, German or English (web: GlobalSearch.tsx)
    @MainActor static func matches(_ q: String, app: AppModel) -> [Entry] {
        let terms = fold(q).split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard !terms.isEmpty else { return [] }
        return Array(all(app: app).filter { e in
            let hay = fold("\(e.title) \(e.words)")
            return terms.allSatisfy { hay.contains($0) }
        }.prefix(8))
    }

    @MainActor @ViewBuilder
    static func destination(_ t: Target, store: ServerStore) -> some View {
        let api = store.api
        switch t {
        case .account: MyAccountView(api: api)
        case .household: HouseholdBasicsView(api: api)
        case .people: HouseholdView(api: api)
        case .invite: InvitesView(api: api)
        case .places: PlacesSettingsView(api: api)
        case .notifications: NotificationSettingsView()
        case .connections: IntegrationsHubView(api: api)
        case .data: DataSettingsView(api: api)
        case .ai: AISettingsView()
        case .calendar: CalDavView(api: api)
        case .labels: LabelsView(api: api)
        case .help: HelpCenterView(store: store)
        case .servers: ConnectionsView()
        case .devices: SignedInDevicesView(api: api)
        case .guests: GuestLinksView(api: api, guestsArea: true)
        case .treats: TreatsView(api: api)
        case .knowledge: KnowledgeView(api: api)
        case .wishes: WishesView(api: api)
        case .giving: GivingView(api: api)
        case .receipts: ImportsListView(store: store)
        case .spending: SpendView(store: store)
        case .favourites: FavouritesView(store: store)
        case .houseInfo: HouseGuideView()
        case .away: AwayView(store: store)
        case .listLook: ListDisplaySettingsView()
        case .focus: FocusView(api: api)
        case .loadCards: LoadCardsView(api: api)
        case .careFor: CareForView(api: api)
        case .mind: MindView(api: api)
        case .week: WeekReviewView(api: api)
        case .howItWorks: HowItWorksView()
        case .goodToKnow: FactsView()
        case .handover: HandoverGuestView(api: api)
        // shown as a sheet / full screen by GlobalSearchView.functionRow
        case .find, .kitchen, .settings: HelpCenterView(store: store)
        }
    }
}
