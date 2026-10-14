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
        if let tab = f.tab {
            Button { openTab(tab) } label: { row(f.title, nil, f.icon) }
        } else {
            NavigationLink { SearchRegistry.destination(f.target, store: store) } label: { row(f.title, nil, f.icon) }
        }
    }

    private func openTab(_ tab: String) {
        if tab == "tasks" || tab == "stock" { app.homeSegment = tab; app.requestedTab = "home" } else { app.requestedTab = tab }
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
}

private struct SearchAnswer: Decodable, Sendable { var groups: SearchGroups }

extension APIClient {
    func search(_ q: String) async throws -> SearchGroups {
        let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q
        return try await get("api/search?q=\(enc)", as: SearchAnswer.self).groups
    }
}

/// Every function and setting of the app, with the words people search for (web: GlobalSearch.tsx registry).
enum SearchRegistry {
    enum Target: String {
        case account, household, people, invite, places, notifications, connections, data, ai, calendar, labels, help
        case servers, devices, guests, treats, memory, wishes, receipts, spending, favourites, houseInfo, away, listLook, focus
    }

    struct Entry: Identifiable {
        var title: String
        var words: String
        var icon: String
        var target: Target = .help
        /// a tab instead of a screen
        var tab: String?
        var adminOrMember = true
        var id: String { title + (tab ?? target.rawValue) }
    }

    static func all(app: AppModel) -> [Entry] {
        var out: [Entry] = [
            Entry(title: L("Today"), words: "heute start übersicht", icon: "sun.max", tab: "today"),
            Entry(title: L("Shopping"), words: "einkauf liste einkaufen laden", icon: "cart", tab: "shopping"),
            Entry(title: L("Tasks"), words: "aufgaben putzen haushalt termine fristen pflege", icon: "checklist", tab: "tasks"),
            Entry(title: L("Pantry"), words: "vorrat bestand zu hause kühlschrank", icon: "cabinet", tab: "stock"),
            Entry(title: L("Cooking"), words: "kochen rezepte wochenplan essen", icon: "fork.knife", tab: "cooking"),
            Entry(title: L("Money"), words: "geld ausgaben budget bons", icon: "eurosign.circle", tab: "money"),
            Entry(title: L("My account"), words: "konto passwort e-mail name passkey zwei-schritt sicherheit", icon: "person.crop.circle", target: .account),
            Entry(title: L("Help"), words: "hilfe frage support anleitung tour", icon: "questionmark.circle", target: .help),
            Entry(title: L("Servers & households"), words: "server haushalt wechseln eigener server verbinden", icon: "server.rack", target: .servers),
            Entry(title: L("Notifications"), words: "benachrichtigungen push mitteilungen ruhezeiten", icon: "bell", target: .notifications),
            Entry(title: L("With or without AI"), words: "ki assistent datenschutz claude chatgpt", icon: "sparkles", target: .ai),
            Entry(title: L("How the list looks"), words: "liste schrift größe ansicht", icon: "textformat.size", target: .listLook),
        ]
        if !app.isGuest {
            out += [
                Entry(title: L("Household settings"), words: "haushalt name sprache region darstellung was nutzt ihr module", icon: "house", target: .household),
                Entry(title: L("People"), words: "personen mitglieder kinder gäste rolle", icon: "person.2", target: .people),
                Entry(title: L("Invite someone"), words: "einladen mitglied link", icon: "person.badge.plus", target: .invite),
                Entry(title: L("Places & categories"), words: "orte räume kategorien regal schrank", icon: "square.grid.2x2", target: .places),
                Entry(title: L("Connections"), words: "home assistant display bildschirm drucker telegram matrix cookidoo mail", icon: "point.3.connected.trianglepath.dotted", target: .connections),
                Entry(title: L("Data & backups"), words: "daten export sicherung backup import umzug", icon: "externaldrive", target: .data),
                Entry(title: L("Reminders & Calendar"), words: "apple erinnerungen kalender caldav google outlook abo termine", icon: "checklist.checked", target: .calendar),
                Entry(title: L("QR labels"), words: "etiketten qr drucken aufkleber", icon: "qrcode", target: .labels),
                Entry(title: L("Signed-in devices"), words: "geräte abmelden sitzungen", icon: "laptopcomputer.and.iphone", target: .devices),
                Entry(title: L("Guests & party"), words: "gäste party bar gastlink", icon: "wineglass", target: .guests),
                Entry(title: L("What ToHuus remembers"), words: "gedächtnis merkt sich", icon: "text.book.closed", target: .memory),
                Entry(title: L("Wishes & Merkliste"), words: "wünsche geschenke merkliste", icon: "gift", target: .wishes),
                Entry(title: L("Receipts & imports"), words: "bons kassenbon rechnung import", icon: "doc.text", target: .receipts),
                Entry(title: L("Spending in detail"), words: "ausgaben diagramm export", icon: "chart.bar", target: .spending),
                Entry(title: L("Favourites"), words: "lieblinge lieblingsessen", icon: "heart", target: .favourites),
                Entry(title: L("Trip / away"), words: "urlaub verreist übergabe packen", icon: "suitcase", target: .away),
                Entry(title: L("One thing at a time"), words: "fokus konzentration adhs ads timer eins nach dem anderen anfangen", icon: "scope", target: .focus),
                Entry(title: L("Calm & focus"), words: "sanfter modus ruhig adhs ads autismus weniger überfordert erinnerungen bündeln", icon: "leaf", target: .account),
                Entry(title: L("Extras in the weekly shop"), words: "extras kontingent luxus naschen süßes spaß budget woche", icon: "sparkles", target: .household),
            ]
            if !app.singleHousehold { out.append(Entry(title: L("Treats"), words: "bring mir was bestellen karte", icon: "hand.raised", target: .treats)) }
        }
        out.append(Entry(title: L("House info"), words: "hausinfo wlan sicherung heizung codes", icon: "info.circle", target: .houseInfo))
        return out
    }

    static func matches(_ q: String, app: AppModel) -> [Entry] {
        let n = q.lowercased()
        return Array(all(app: app).filter { "\($0.title) \($0.words)".lowercased().contains(n) }.prefix(6))
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
        case .guests: GuestsPartyView(store: store)
        case .treats: TreatsView(api: api)
        case .memory: MemoryView(api: api)
        case .wishes: WishesView(api: api)
        case .receipts: ImportsListView(store: store)
        case .spending: SpendView(store: store)
        case .favourites: FavouritesView(store: store)
        case .houseInfo: HouseGuideView()
        case .away: AwayView(store: store)
        case .listLook: ListDisplaySettingsView()
        case .focus: FocusView(api: api)
        }
    }
}
