import SwiftUI

// Urlaub / unterwegs natively (web: pages/Away.tsx, server: routes/away.ts, lib/away.ts).
// Before: use it up, a generated checklist, packing (lists + things from stock). During: quiet notifications,
// holiday kitchen with its own list, house-sitter link. After: welcome-home list, what expired, booking stock back.

// MARK: - models

struct AwaySitter: Decodable, Sendable, Hashable {
    var name: String?
    var plants: String?
    var post: String?
    var bins: String?
    var other: String?
}

struct AwayTrip: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var place: String?
    var startDay: String
    var endDay: String
    var nights: Int?
    var travellers: [String]?
    var home: [String]?
    var everyoneAway: Bool?
    /// holiday · work · party · hospital · other (nil: not said)
    var kind: String?
    /// hospital: relief for the people at home – more may wait
    var relief: Bool?
    var useUpDays: Int?
    var quiet: Bool?
    var pauseAuto: Bool?
    var kitchen: Bool?
    var kitchenStore: String?
    var sitter: AwaySitter?
    var sitterLink: SitterLink?
    /// active | ended | cancelled
    var status: String?
    /// planned | before | during | after | done
    var phase: String?
    var daysToStart: Int?
    var daysToEnd: Int?
    var welcomeDone: Bool?
    var welcomeReady: Bool?

    struct SitterLink: Decodable, Sendable, Hashable {
        var id: Int
        var expiresAt: String?
        var lastSeenAt: String?
    }
}

/// GET /api/away → { summary, trips, members, templates }
struct AwayOverview: Decodable, Sendable {
    var summary: Summary
    @Lossy var trips: [AwayTrip]
    @Lossy var members: [Member]

    struct Summary: Decodable, Sendable {
        var trip: AwayTrip?
        var suggestion: Suggestion?
    }
    struct Suggestion: Decodable, Sendable { var since: String?; var hours: Int? }
}

/// GET /api/away/trips/:id
struct AwayDetail: Decodable, Sendable {
    var trip: AwayTrip
    @Lossy var useUp: [UseUp]
    @Lossy var recipes: [UseUpRecipe]
    @Lossy var checklist: [Check]
    @Lossy var packing: [Pack]
    @Lossy var templates: [Template]
    @Lossy var stockSuggestions: [StockSuggestion]
    @Lossy var meals: [Meal]
    @Lossy var kitchenList: [ShopItem]
    @Lossy var expired: [Expired]
    @Lossy var welcome: [Welcome]
    var days: [String]?

    struct UseUp: Decodable, Sendable, Identifiable, Hashable {
        var productId: Int
        var name: String
        var imagePath: String?
        var useBy: String
        var whileAway: Bool?
        var canFreeze: Bool?
        var id: Int { productId }
    }
    struct UseUpRecipe: Decodable, Sendable, Identifiable, Hashable {
        var recipeId: Int
        var title: String
        var imagePath: String?
        var uses: [String]?
        var missing: Int?
        var id: Int { recipeId }
    }
    struct Check: Decodable, Sendable, Identifiable, Hashable {
        var key: String
        var text: String
        var detail: String?
        var done: Bool
        /// use_up | packing | sitter | care
        var goto: String?
        var id: String { key }
    }
    struct Pack: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var text: String
        var who: String?
        var productId: Int?
        var qty: Double?
        var done: Bool
        var outQty: Double?
        var back: Bool?
        var imagePath: String?
        var inStock: Double?
    }
    struct Template: Decodable, Sendable, Identifiable, Hashable {
        var key: String
        var name: String
        var own: Bool?
        var count: Int?
        var id: String { key }
    }
    struct StockSuggestion: Decodable, Sendable, Identifiable, Hashable {
        var productId: Int
        var name: String
        var id: Int { productId }
    }
    struct Meal: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var day: String
        var slot: String?
        var title: String
        var recipeId: Int?
    }
    struct ShopItem: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var text: String
        var note: String?
        var done: Bool
    }
    struct Expired: Decodable, Sendable, Identifiable, Hashable {
        var productId: Int
        var name: String
        var imagePath: String?
        var useBy: String
        var dateKind: String?
        var id: Int { productId }
    }
    struct Welcome: Decodable, Sendable, Identifiable, Hashable {
        var key: String
        var productId: Int?
        var name: String
        var imagePath: String?
        /// usual | expired | basic
        var reason: String?
        var onList: Bool?
        var id: String { key }
    }
}

private struct AwayAdded: Decodable, Sendable { var added: Int?; var booked: Int? }
private struct AwayLinkURL: Decodable, Sendable { var url: String; var expiresAt: String? }

extension APIClient {
    func awayOverview() async throws -> AwayOverview { try await get("api/away") }
    func awayTrip(_ id: Int) async throws -> AwayDetail { try await get("api/away/trips/\(id)") }
    /// POST/PATCH and the small actions of the trip page – all answer JSON (ignored where nothing is needed)
    func awaySend(_ method: String, _ path: String, _ body: [String: Any]? = nil) async throws {
        _ = try await send(method, "api/away/\(path)", json: body, as: Ignored.self)
    }
}

// MARK: - labels

enum AwayText {
    static func day(_ s: String?) -> String {
        guard let d = ServerDate.parse(s) else { return s ?? "" }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
    }

    static func range(_ t: AwayTrip) -> String {
        let a = ServerDate.parse(t.startDay)?.formatted(.dateTime.day().month(.abbreviated)) ?? t.startDay
        let b = ServerDate.parse(t.endDay)?.formatted(.dateTime.day().month(.abbreviated).year()) ?? t.endDay
        return "\(a) – \(b)"
    }

    static func phaseLine(_ t: AwayTrip) -> String {
        let start = t.daysToStart ?? 0
        switch t.phase {
        case "planned": return start == 1 ? L("Starts tomorrow") : LF("Starts in %d days", start)
        case "before":
            return start == 0 ? L("Starts today") : start == 1 ? L("Use-it-up days · starts tomorrow") : LF("Use-it-up days · starts in %d days", start)
        case "during": return (t.daysToEnd ?? 0) == 0 ? L("Away · back today") : LF("Away · back on %@", day(t.endDay))
        case "after": return L("Welcome back")
        default: return L("Past trip")
        }
    }

    static func title(_ t: AwayTrip) -> String {
        if let p = t.place, !p.isEmpty, p != t.name { return "\(t.name) · \(p)" }
        return t.name
    }
}

// MARK: - page

/// Mehr › Urlaub / unterwegs: the current (or chosen) trip with its tabs, other trips, new trip.
struct AwayView: View {
    let store: ServerStore
    private var api: APIClient { store.api }
    @State private var overview: AwayOverview?
    @State private var detail: AwayDetail?
    @State private var openId: Int?
    @State private var tab: AwayTab?
    @State private var error: String?
    @State private var editing: AwayEditTarget?
    @State private var confirmStop = false
    @State private var confirmDelete = false
    @State private var toast: ToastMessage?
    @State private var meName: String?

    private var shownId: Int? { openId ?? overview?.summary.trip?.id }

    var body: some View {
        List {
            if let error { Section { ErrorBanner(message: error) { Task { await load() } } }.listRowBackground(Color.clear) }
            if let o = overview {
                if let s = o.summary.suggestion, o.summary.trip?.phase != "during" { suggestionSection(s) }
                if let d = detail, d.trip.id == shownId {
                    hero(d.trip)
                    tabPicker(d.trip)
                    tabContent(d)
                } else if shownId == nil {
                    EmptyStateView(systemImage: "airplane", title: L("Going away?"),
                                   message: L("Enter the dates once. In the days before, ToHuus Hub suggests meals that use up what would go off and stops putting fresh things on the list. While you’re away, only urgent notifications come through. On the way back, a welcome-home list is ready."),
                                   art: .suitcase, actionTitle: L("Plan a trip"), action: { editing = AwayEditTarget(trip: nil) })
                        .listRowBackground(Color.clear)
                    if let me = meName {
                        Section {
                            Button { editing = AwayEditTarget(trip: nil, only: me) } label: { Label(L("Only I’m away"), systemImage: "person") }
                                .frame(minHeight: 44)
                        } footer: {
                            Text(L("Only one of you is away – a business trip, a course? Enter just that person: the house runs on, their tasks and turns go to whoever is at home."))
                        }
                    }
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                }
                let others = o.trips.filter { $0.id != shownId }
                if !others.isEmpty {
                    Section(L("Other trips")) {
                        ForEach(others) { t in
                            Button { openId = t.id; tab = nil; Task { await loadDetail() } } label: {
                                HStack {
                                    Image(systemName: "suitcase").foregroundStyle(Theme.primaryText).frame(width: 28).accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(AwayText.title(t)).foregroundStyle(Theme.ink)
                                        Text("\(AwayText.range(t)) · \(AwayText.phaseLine(t))").font(.caption).foregroundStyle(Theme.ink3)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3)
                                }
                            }
                        }
                    }
                }
            } else if error == nil {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            }
        }
        .themedList()
        .navigationTitle(L("Trip / away"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button { editing = AwayEditTarget(trip: nil) } label: { Label(L("New trip"), systemImage: "suitcase") }
                    if let me = meName {
                        Button { editing = AwayEditTarget(trip: nil, only: me) } label: { Label(L("Only I’m away"), systemImage: "person") }
                    }
                } label: { Image(systemName: "plus") }
                    .accessibilityLabel(L("New trip"))
            }
        }
        .task { await load() }
        .task { meName = (try? await api.me())?.name }
        .refreshable { await load() }
        .sheet(item: $editing) { e in
            AwayTripForm(api: api, trip: e.trip, only: e.only, members: overview?.members ?? []) { id, isNew in
                if isNew { toast = ToastMessage(text: L("Trip saved")) }
                openId = id == overview?.summary.trip?.id ? nil : id
                tab = nil
                Task { await load() }
            }
        }
        .confirmationDialog(stopQuestion, isPresented: $confirmStop, titleVisibility: .visible) {
            Button(stopTitle, role: .destructive) { Task { await stop() } }
        }
        .confirmationDialog(L("Delete this trip with its lists?"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(L("Delete"), role: .destructive) { Task { await remove() } }
        }
        .toast($toast)
    }

    // MARK: pieces

    private func suggestionSection(_ s: AwayOverview.Suggestion) -> some View {
        Section {
            VStack(alignment: .leading, spacing: Theme.Space.s2) {
                Label(L("Looks like everyone is away"), systemImage: "airplane").font(.headline)
                Text(LF("Home Assistant hasn’t seen anyone at home for %d hours. Start away mode?", s.hours ?? 24))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
                HStack {
                    Button(L("Start away mode")) { Task { await act("POST", "suggestion/start", nil, done: L("Away mode is on")) } }
                        .buttonStyle(.borderedProminent).tint(Theme.primary)
                    Button(L("Not now")) { Task { await act("POST", "suggestion/dismiss", nil) } }
                        .buttonStyle(.bordered)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func hero(_ t: AwayTrip) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text(AwayText.phaseLine(t)).font(.caption.weight(.semibold)).foregroundStyle(Theme.primaryText).textCase(.uppercase)
                Text(AwayText.title(t)).font(.title3.weight(.semibold))
                Text("\(AwayText.range(t)) · \((t.nights ?? 0) == 1 ? L("1 night") : LF("%d nights", t.nights ?? 0))")
                    .font(.subheadline).foregroundStyle(Theme.ink2)
                if !(t.travellers ?? []).isEmpty {
                    Text("\(t.everyoneAway == false ? L("Away") : L("Travelling")): \((t.travellers ?? []).joined(separator: ", "))").font(.caption).foregroundStyle(Theme.ink2)
                }
                if !(t.home ?? []).isEmpty {
                    Text("\(L("Staying home")): \((t.home ?? []).joined(separator: ", "))").font(.caption).foregroundStyle(Theme.ink2)
                }
                if t.phase == "during" || t.phase == "before" {
                    if t.quiet == true {
                        Label(t.phase == "during" ? L("Only urgent notifications") : LF("Notifications go quiet from %@", AwayText.day(t.startDay)), systemImage: "bell.slash")
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                    if t.pauseAuto == true && t.everyoneAway == true {
                        Label(t.phase == "during" ? L("Automatic list suggestions paused") : L("No fresh things on the list until you’re back"), systemImage: "basket")
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
            }
            .padding(.vertical, 4)
            Button { editing = AwayEditTarget(trip: t) } label: { Label(L("Edit"), systemImage: "pencil") }
            if t.status == "active" && t.phase != "done" && t.phase != "after" {
                Button { confirmStop = true } label: {
                    Label(t.phase == "during" ? (t.everyoneAway == false ? L("Back again") : L("We’re back")) : L("Cancel trip"), systemImage: t.phase == "during" ? "house" : "xmark")
                }
            }
            Button(role: .destructive) { confirmDelete = true } label: { Label(L("Delete"), systemImage: "trash") }
        }
    }

    private func tabPicker(_ t: AwayTrip) -> some View {
        let current = tab ?? AwayTab.defaultTab(t)
        return Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(AwayTab.tabs(t)) { x in
                        ChoiceChip(title: x.title, on: current == x) { withAnimation { tab = x } }
                    }
                }
                .padding(.horizontal, Theme.Space.s4)
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
    }

    @ViewBuilder
    private func tabContent(_ d: AwayDetail) -> some View {
        let id = d.trip.id
        switch tab ?? AwayTab.defaultTab(d.trip) {
        case .before: AwayBeforeTab(store: store, d: d, act: { m, p, b, msg in await act(m, "trips/\(id)/\(p)", b, done: msg) })
        case .pack: AwayPackTab(store: store, d: d, act: { m, p, b, msg in await act(m, p, b, done: msg) }, toast: $toast)
        case .kitchen: AwayKitchenTab(store: store, d: d, act: { m, p, b, msg in await act(m, p, b, done: msg) }, rename: { editing = AwayEditTarget(trip: d.trip) }, toast: $toast)
        case .sitter: AwaySitterTab(store: store, d: d, act: { m, p, b, msg in await act(m, p, b, done: msg) }, toast: $toast)
        case .handover:
            Section {
                NavigationLink { HandoverView(api: api, tripId: id) } label: { Label(L("Handover"), systemImage: "suitcase") }
            } footer: {
                Text(L("What the people at home or the house sitter should know – with a rhythm, ticks and photos."))
            }
        case .home: AwayHomeTab(store: store, d: d, act: { m, p, b, msg in await act(m, p, b, done: msg) }, toast: $toast)
        }
    }

    private var stopQuestion: String {
        let p = detail?.trip.phase
        return p == "planned" || p == "before" ? L("Cancel this trip?") : L("End the trip today?")
    }

    private var stopTitle: String {
        let p = detail?.trip.phase
        return p == "planned" || p == "before" ? L("Cancel trip") : (detail?.trip.everyoneAway == false ? L("Back again") : L("We’re back"))
    }

    // MARK: actions

    private func load() async {
        do {
            overview = try await api.awayOverview()
            error = nil
        } catch APIError.notFound {
            error = L("Your server doesn't have this section yet.")
        } catch { self.error = APIError.from(error).localizedDescription }
        await loadDetail()
    }

    private func loadDetail() async {
        guard let id = shownId else { detail = nil; return }
        do { detail = try await api.awayTrip(id) } catch { self.error = APIError.from(error).localizedDescription }
    }

    /// one server action, then reload; `path` is below /api/away/
    private func act(_ method: String, _ path: String, _ body: [String: Any]?, done: String? = nil) async {
        do {
            try await api.awaySend(method, path, body)
            if let done { toast = ToastMessage(text: done) }
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func stop() async {
        guard let t = detail?.trip else { return }
        let before = t.phase == "planned" || t.phase == "before"
        await act("POST", "trips/\(t.id)/stop", nil, done: before ? L("Trip cancelled") : L("Welcome back! The welcome-home list is ready."))
    }

    private func remove() async {
        guard let t = detail?.trip else { return }
        do {
            try await api.awaySend("DELETE", "trips/\(t.id)")
            openId = nil
            detail = nil
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// method, path below /api/away/, JSON body, toast text on success
typealias AwayAct = @MainActor (String, String, [String: Any]?, String?) async -> Void

/// GET /api/away/trips/:id/home – "Was passiert zu Hause?"
struct AwayHomePlan: Decodable, Sendable {
    struct Taker: Decodable, Sendable, Hashable, Identifiable {
        var key: String
        var name: String
        /// a permanent guest who can help too (Oma waters the plants)
        var guest: Bool?
        var id: String { key }
        /// "Oma (Gast)"
        var label: String { guest == true ? LF("%@ (guest)", name) : name }
    }
    struct Choice: Decodable, Sendable, Hashable { var mode: String; var key: String? }
    struct Item: Decodable, Sendable, Hashable, Identifiable {
        var taskId: Int
        var name: String
        var due: String?
        var person: String?
        var personAway: Bool = false
        var canWait: Bool = false
        /// take | wait | usual
        var suggestion: String
        var suggestKey: String?
        var choice: Choice?
        var id: Int { taskId }
    }
    var relief: Bool = false
    @Lossy var takers: [Taker]
    @Lossy var items: [Item]
}

enum AwayKinds {
    static let all: [(String, String)] = [
        ("holiday", L("Holiday")), ("work", L("Business trip")), ("party", L("Celebrating & time off")), ("hospital", L("Hospital & rehab")), ("other", L("Something else")),
    ]
}

/// "Zu Hause, solange … weg ist": who takes what, what may wait until they're back (server: away.ts homePlan).
private struct AwayHomePlanSection: View {
    let api: APIClient
    let trip: AwayTrip
    @State private var plan: AwayHomePlan?
    @State private var error: String?

    var body: some View {
        Group {
            if let p = plan, !p.items.isEmpty || p.relief {
                Section {
                    if p.items.isEmpty { Text(L("Nothing falls due in these days.")).font(.subheadline).foregroundStyle(Theme.ink3) }
                    ForEach(p.items) { x in
                        VStack(alignment: .leading, spacing: Theme.Space.s2) {
                            Text(x.name)
                            Text(sub(x, p)).font(.caption).foregroundStyle(Theme.ink3)
                            FlowLayout(spacing: 6) {
                                ForEach(p.takers) { k in
                                    ChoiceChip(title: LF("%@ takes it", k.label), on: x.choice?.mode == "take" && x.choice?.key == k.key) { set(x, "take", k.key) }
                                }
                                ChoiceChip(title: L("May wait"), on: x.choice?.mode == "wait") { set(x, "wait", nil) }
                                if x.choice != nil { ChoiceChip(title: L("As usual"), on: false) { set(x, "usual", nil) } }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
                } header: {
                    Text(LF("At home while %@ is away", (trip.travellers ?? []).joined(separator: ", ")))
                } footer: {
                    Text(p.relief ? L("Hospital and rehab weigh on everyone. More may wait now – the house doesn’t have to be perfect.")
                                  : L("Who takes what – and what may simply wait until they’re back. Suggestions only, you decide."))
                }
            }
        }
        .task(id: trip.id) { await load() }
    }

    private func sub(_ x: AwayHomePlan.Item, _ p: AwayHomePlan) -> String {
        [
            x.due.map { AwayText.day($0) },
            x.person.map { x.personAway ? LF("usually %@ – away", $0) : LF("usually %@", $0) },
            x.choice == nil ? (x.suggestion == "wait" ? L("Suggestion: may wait")
                               : x.suggestion == "take" ? p.takers.first { $0.key == x.suggestKey }.map { LF("Suggestion: %@ takes it", $0.label) } : nil) : nil,
        ].compactMap { $0 }.joined(separator: " · ")
    }

    private func set(_ x: AwayHomePlan.Item, _ mode: String, _ key: String?) {
        Task {
            do {
                plan = try await api.send("PUT", "api/away/trips/\(trip.id)/home/\(x.taskId)", json: ["mode": mode, "key": key.map { $0 as Any } ?? NSNull()], as: AwayHomePlan.self)
                error = nil
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func load() async {
        do {
            plan = try await api.get("api/away/trips/\(trip.id)/home")
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

enum AwayTab: String, CaseIterable, Identifiable {
    case before, pack, kitchen, sitter, handover, home
    var id: String { rawValue }

    var title: String {
        switch self {
        case .before: return L("Before")
        case .pack: return L("Packing")
        case .kitchen: return L("Kitchen")
        case .sitter: return L("House sitter")
        case .handover: return L("Handover")
        case .home: return L("Back home")
        }
    }

    /// only some are away: no holiday kitchen, house sitter or welcome-home list – the house runs on
    static func tabs(_ t: AwayTrip) -> [AwayTab] {
        t.everyoneAway == false ? allCases.filter { $0 != .kitchen && $0 != .sitter && $0 != .home } : allCases
    }

    static func defaultTab(_ t: AwayTrip) -> AwayTab {
        if t.everyoneAway == false { return .before }
        if t.welcomeReady == true || t.phase == "after" || t.phase == "done" { return .home }
        if t.phase == "during" { return t.kitchen == true ? .kitchen : .sitter }
        return .before
    }
}

struct AwayEditTarget: Identifiable {
    var trip: AwayTrip?
    /// "Nur ich bin weg": a new absence of just this person
    var only: String? = nil
    let id = UUID()
}

// MARK: - before

private struct AwayBeforeTab: View {
    let store: ServerStore
    let d: AwayDetail
    /// method, path below /api/away/trips/:id/, body, toast
    let act: AwayAct

    var body: some View {
        let t = d.trip
        let house = t.everyoneAway != false
        if t.phase != "after" && t.phase != "done" { AwayHomePlanSection(api: store.api, trip: t) }
        if house, t.phase == "planned", let start = ServerDate.parse(t.startDay) {
            let from = Calendar.current.date(byAdding: .day, value: -(t.useUpDays ?? 4), to: start) ?? start
            Section {
                Text(LF("From %@, meal ideas and the week plan prefer what would otherwise go off, and fresh things stay off the shopping list.", AwayText.day(ServerDate.day(from))))
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
        }
        if house { Section(L("Use up first")) {
            if d.useUp.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Nothing would go off")).font(.headline)
                    Text(L("Nothing in the house expires before you’re back – nice.")).font(.subheadline).foregroundStyle(Theme.ink2)
                }
            }
            ForEach(d.useUp) { x in
                HStack(spacing: Theme.Space.s3) {
                    NavigationLink { ProductDetailView(productId: x.productId, store: store) } label: {
                        HStack(spacing: Theme.Space.s3) {
                            ProductThumb(path: x.imagePath, api: store.api, size: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(x.name)
                                Text(x.whileAway == true ? LF("would go off while you’re away (%@)", AwayText.day(x.useBy)) : LF("use by %@", AwayText.day(x.useBy)))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                    if x.canFreeze == true {
                        Button { Task { await act("POST", "freeze", ["product_id": x.productId], LF("%@ is in the freezer now", x.name)) } } label: {
                            Label(L("Freeze"), systemImage: "snowflake").font(.caption.weight(.semibold))
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
        } }
        if !d.recipes.isEmpty {
            Section(L("Cook these before you leave")) {
                ForEach(d.recipes) { r in
                    NavigationLink { RecipeDetailView(recipeId: r.recipeId, store: store) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.title)
                            let missing = r.missing ?? 0
                            Text([LF("uses %@", (r.uses ?? []).joined(separator: ", ")),
                                  missing == 0 ? L("everything is in the house") : missing == 1 ? L("1 thing missing") : LF("%d things missing", missing)]
                                .joined(separator: " · "))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
            }
        }
        Section {
            ForEach(d.checklist) { c in
                Button { Task { await act("POST", "checklist", ["key": c.key, "on": !c.done], nil) } } label: {
                    HStack(alignment: .top, spacing: Theme.Space.s3) {
                        Image(systemName: c.done ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(c.done ? Theme.primary : Theme.ink3).font(.title3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.text).foregroundStyle(c.done ? Theme.ink3 : Theme.ink).strikethrough(c.done)
                            if let det = c.detail, !det.isEmpty { Text(det).font(.caption).foregroundStyle(Theme.ink3) }
                        }
                    }
                }
                .accessibilityAddTraits(c.done ? .isSelected : [])
            }
        } header: {
            HStack {
                Text(L("Before you leave"))
                Spacer()
                Text(LF("%d of %d", d.checklist.filter(\.done).count, d.checklist.count))
            }
        } footer: {
            Text(L("Generated from your home – nothing to maintain. Tick off what’s done, ignore the rest."))
        }
    }
}

// MARK: - packing

private struct AwayPackTab: View {
    let store: ServerStore
    let d: AwayDetail
    /// method, path below /api/away/, body, toast
    let act: AwayAct
    @Binding var toast: ToastMessage?
    @State private var text = ""
    @State private var picker = false
    @State private var saving = false
    @State private var tplName = ""
    @State private var manage = false

    var body: some View {
        let id = d.trip.id
        let items = d.packing
        let toBook = items.filter { $0.productId != nil && $0.done && ($0.outQty ?? 0) == 0 }
        let open = items.filter { !$0.done }.count
        Section(L("Start from a list")) {
            FlowLayout(spacing: 6) {
                ForEach(d.templates) { tp in
                    ChoiceChip(title: tp.name, systemImage: "plus", on: false) {
                        Task { await applyTemplate(tp) }
                    }
                }
                if d.templates.contains(where: { $0.own == true }) {
                    ChoiceChip(title: L("Edit lists"), on: false) { manage = true }
                }
            }
            .padding(.vertical, 4)
        }
        Section {
            HStack {
                TextField(L("Add something to pack …"), text: $text)
                    .submitLabel(.done)
                    .onSubmit { add() }
                Button { add() } label: { Image(systemName: "plus.circle.fill").font(.title3).tapTarget() }
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityLabel(L("Add"))
            }
            Button { picker = true } label: { Label(L("From stock"), systemImage: "shippingbox") }
            if !d.stockSuggestions.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(L("From your stock")).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3).textCase(.uppercase)
                    FlowLayout(spacing: 6) {
                        ForEach(d.stockSuggestions) { s in
                            ChoiceChip(title: s.name, systemImage: "plus", on: false) {
                                Task { await act("POST", "trips/\(id)/pack", ["product_id": s.productId, "qty": 1], nil) }
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
        Section {
            if items.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Nothing on the packing list yet")).font(.headline)
                    Text(L("Start from a list above – kids, beach, ski, city, baby – or add things one by one. Things from stock are taken out of the count when you leave and booked back when you’re home."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
            }
            ForEach(items) { i in row(i) }
            if !toBook.isEmpty && d.trip.phase != "after" && d.trip.phase != "done" {
                Button {
                    Task { await act("POST", "trips/\(id)/book-out", nil, toBook.count == 1 ? L("1 thing booked out of stock") : LF("%d things booked out of stock", toBook.count)) }
                } label: {
                    Label(toBook.count == 1 ? L("Take 1 packed thing out of stock") : LF("Take %d packed things out of stock", toBook.count), systemImage: "shippingbox")
                }
            }
            if !items.isEmpty {
                Button(L("Save as a list for next time")) { tplName = d.trip.name; saving = true }
            }
        } header: {
            HStack {
                Text(L("Packing list"))
                Spacer()
                if !items.isEmpty { Text(open == 0 ? L("all packed") : LF("%d still to pack", open)) }
            }
        }
        .sheet(isPresented: $picker) {
            AwayProductPicker(api: store.api) { p in
                picker = false
                Task { await act("POST", "trips/\(id)/pack", ["product_id": p.id, "qty": 1], nil) }
            }
        }
        .alert(L("Save as a list"), isPresented: $saving) {
            TextField(L("e.g. Summer with the kids"), text: $tplName)
            Button(L("Cancel"), role: .cancel) {}
            Button(L("Save")) {
                let n = tplName.trimmingCharacters(in: .whitespaces)
                guard !n.isEmpty else { return }
                Task { await act("POST", "trips/\(id)/templates", ["name": n], L("Saved")) }
            }
        } message: {
            Text(L("Next time it’s one tap under “Start from a list”. Same name = updated."))
        }
        .sheet(isPresented: $manage) {
            NavigationStack {
                List {
                    ForEach(d.templates.filter { $0.own == true }) { tp in
                        VStack(alignment: .leading) {
                            Text(tp.name)
                            Text((tp.count ?? 0) == 1 ? L("1 thing") : LF("%d things", tp.count ?? 0)).font(.caption).foregroundStyle(Theme.ink3)
                        }
                        .swipeActions {
                            Button(role: .destructive) { Task { await act("DELETE", "templates/\(tp.key)", nil, nil) } } label: { Label(L("Delete"), systemImage: "trash") }
                        }
                    }
                }
                .themedList()
                .navigationTitle(L("Your lists"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { manage = false } } }
            }
        }
    }

    private func row(_ i: AwayDetail.Pack) -> some View {
        let out = i.outQty ?? 0
        let sub: String? = i.productId != nil
            ? (out > 0 ? (i.back == true ? L("booked back") : LF("%@ taken out of stock", AwayNum.s(out))) : LF("from stock · %@ at home", AwayNum.s(i.inStock ?? 0)))
            : i.who
        return HStack(spacing: Theme.Space.s3) {
            Button { Task { await act("PATCH", "items/\(i.id)", ["done": !i.done], nil) } } label: {
                Image(systemName: i.done ? "checkmark.circle.fill" : "circle").font(.title3)
                    .foregroundStyle(i.done ? Theme.primary : Theme.ink3)
                    .tapTarget()
            }
            .buttonStyle(.plain)
            .accessibilityLabel(i.text)
            .accessibilityAddTraits(i.done ? .isSelected : [])
            if i.productId != nil { ProductThumb(path: i.imagePath, api: store.api, size: 36) }
            VStack(alignment: .leading, spacing: 2) {
                Text(i.text).foregroundStyle(i.done ? Theme.ink3 : Theme.ink).strikethrough(i.done)
                if let sub, !sub.isEmpty { Text(sub).font(.caption).foregroundStyle(Theme.ink3) }
            }
            Spacer(minLength: 4)
            if i.productId != nil && out == 0 {
                Stepper(value: Binding(get: { Int(i.qty ?? 1) }, set: { v in Task { await act("PATCH", "items/\(i.id)", ["qty": max(1, v)], nil) } }), in: 1...999) {
                    Text("\(Int(i.qty ?? 1))×").font(.subheadline.monospacedDigit())
                }
                .fixedSize()
            }
        }
        .swipeActions {
            if !(out > 0 && i.back != true) {
                Button(role: .destructive) { Task { await act("DELETE", "items/\(i.id)", nil, nil) } } label: { Label(L("Remove"), systemImage: "trash") }
            }
        }
    }

    private func add() {
        let s = text.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty else { return }
        text = ""
        Task { await act("POST", "trips/\(d.trip.id)/pack", ["text": String(s.prefix(100))], nil) }
    }

    private func applyTemplate(_ tp: AwayDetail.Template) async {
        do {
            let r = try await store.api.send("POST", "api/away/trips/\(d.trip.id)/pack/template", json: ["template": tp.key], as: AwayAdded.self)
            let n = r.added ?? 0
            await act("GET", "trips/\(d.trip.id)", nil, n > 0 ? LF("%d things from “%@” added", n, tp.name) : LF("Everything from “%@” is already on the list", tp.name))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

enum AwayNum {
    static func s(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }
}

/// Pick a product from stock to pack (web: ProductPicker).
private struct AwayProductPicker: View {
    let api: APIClient
    let onPick: (ProductInfo) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var products: [ProductInfo] = []
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                let q = query.trimmingCharacters(in: .whitespaces).lowercased()
                ForEach(products.filter { q.isEmpty || "\($0.name) \($0.brand ?? "")".lowercased().contains(q) }.prefix(80)) { p in
                    Button { onPick(p) } label: {
                        HStack {
                            ProductThumb(path: p.imagePath, api: api, size: 36)
                            VStack(alignment: .leading) {
                                Text(p.name).foregroundStyle(Theme.ink)
                                if let b = p.brand, !b.isEmpty { Text(b).font(.caption).foregroundStyle(Theme.ink3) }
                            }
                        }
                    }
                }
            }
            .themedList()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle(L("From stock"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .task { products = (try? await api.products()) ?? [] }
        }
    }
}

// MARK: - holiday kitchen

private struct AwayKitchenTab: View {
    let store: ServerStore
    let d: AwayDetail
    let act: AwayAct
    let rename: () -> Void
    @Binding var toast: ToastMessage?
    @State private var addDay: AwayDayKey?
    @State private var item = ""
    @State private var shareText: String?

    var body: some View {
        let t = d.trip
        let id = t.id
        Section {
            Label {
                Text((t.home ?? []).isEmpty
                     ? L("Nobody is at home – the week plan leaves these evenings empty, no ideas for an empty kitchen.")
                     : LF("%@ stay at home – the normal week plan keeps going for them.", (t.home ?? []).joined(separator: ", ")))
                    .font(.footnote)
            } icon: { Image(systemName: "house") }
        }
        if t.kitchen != true {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("Cooking at the holiday flat?")).font(.headline)
                    Text(L("A small meal plan for the trip days with its own shopping list – for the shop near the holiday flat, not your usual one."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
                Button(L("Plan the holiday kitchen")) { Task { await act("PATCH", "trips/\(id)", ["kitchen": true], nil) } }
            }
        } else {
            Section(L("Holiday kitchen")) {
                ForEach(d.days ?? [], id: \.self) { day in
                    let here = d.meals.filter { $0.day == day }
                    HStack(alignment: .top) {
                        // grows with Dynamic Type instead of cutting the date off
                        Text(AwayText.day(day)).font(.subheadline.weight(.semibold)).fixedSize().frame(minWidth: 96, alignment: .leading)
                        VStack(alignment: .leading, spacing: 4) {
                            if here.isEmpty { Text(L("nothing planned")).font(.subheadline).foregroundStyle(Theme.ink3) }
                            ForEach(here) { m in
                                HStack {
                                    Text(m.title).font(.subheadline)
                                    Button { Task { await act("DELETE", "meals/\(m.id)", nil, nil) } } label: {
                                        Image(systemName: "xmark.circle").foregroundStyle(Theme.ink3).tapTarget()
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(L("Remove"))
                                }
                            }
                        }
                        Spacer()
                        Button { addDay = AwayDayKey(day: day) } label: { Image(systemName: "plus").frame(minWidth: 30, minHeight: 30) }
                            .buttonStyle(.bordered)
                            .accessibilityLabel(L("Add a meal"))
                    }
                }
            }
            Section {
                Button {
                    Task {
                        do {
                            let r = try await store.api.send("POST", "api/away/trips/\(id)/kitchen-list/generate", as: AwayAdded.self)
                            let n = r.added ?? 0
                            await act("GET", "trips/\(id)", nil, n == 1 ? L("1 ingredient added") : LF("%d ingredients added", n))
                        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
                    }
                } label: { Label(L("Ingredients from the meals"), systemImage: "frying.pan") }
                .disabled(!d.meals.contains { $0.recipeId != nil })
                if !d.kitchenList.isEmpty, let shareText {
                    ShareLink(item: shareText) { Label(L("Share list"), systemImage: "square.and.arrow.up") }
                }
                HStack {
                    TextField(L("Add to the holiday list …"), text: $item).submitLabel(.done).onSubmit { addItem() }
                    Button { addItem() } label: { Image(systemName: "plus.circle.fill").font(.title3).tapTarget() }
                        .disabled(item.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityLabel(L("Add"))
                }
                if d.kitchenList.isEmpty {
                    Text(L("Empty for now. Plan a few meals with recipes and the ingredients come over in one tap – nothing you pack ends up on it."))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                }
                ForEach(d.kitchenList) { i in
                    Button { Task { await act("PATCH", "items/\(i.id)", ["done": !i.done], nil) } } label: {
                        HStack(spacing: Theme.Space.s3) {
                            Image(systemName: i.done ? "checkmark.circle.fill" : "circle").font(.title3).foregroundStyle(i.done ? Theme.primary : Theme.ink3)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(i.text).foregroundStyle(i.done ? Theme.ink3 : Theme.ink).strikethrough(i.done)
                                if let n = i.note, !n.isEmpty { Text(n).font(.caption).foregroundStyle(Theme.ink3) }
                            }
                        }
                    }
                    .swipeActions {
                        Button(role: .destructive) { Task { await act("DELETE", "items/\(i.id)", nil, nil) } } label: { Label(L("Remove"), systemImage: "trash") }
                    }
                }
            } header: {
                HStack {
                    Text(LF("List for %@", t.kitchenStore ?? L("Holiday flat")))
                    Spacer()
                    Button(L("Rename"), action: rename).font(.caption)
                }
            }
            .task(id: d.kitchenList.map(\.id)) {
                if let data = try? await store.api.getData("api/away/trips/\(id)/kitchen-list.txt") {
                    shareText = String(decoding: data, as: UTF8.self)
                }
            }
            .sheet(item: $addDay) { k in AwayMealSheet(api: store.api, tripId: id, day: k.day) { Task { await act("GET", "trips/\(id)", nil, nil) } } }
        }
    }

    private func addItem() {
        let s = item.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty else { return }
        item = ""
        Task { await act("POST", "trips/\(d.trip.id)/kitchen-list", ["text": String(s.prefix(100))], nil) }
    }
}

private struct AwayDayKey: Identifiable { let day: String; var id: String { day } }

private struct AwayMealSheet: View {
    let api: APIClient
    let tripId: Int
    let day: String
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var slot = "abend"
    @State private var recipes: [Recipe]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker(L("Meal"), selection: $slot) {
                        Text(L("Lunch")).tag("mittag")
                        Text(L("Dinner")).tag("abend")
                    }
                    .pickerStyle(.segmented)
                    HStack {
                        TextField(L("e.g. Pasta, BBQ, eating out"), text: $title).submitLabel(.done).onSubmit { addTitle() }
                        Button(L("Add")) { addTitle() }.disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                let q = title.trimmingCharacters(in: .whitespaces).lowercased()
                let matches = (recipes ?? []).filter { q.isEmpty || $0.title.lowercased().contains(q) }.prefix(8)
                if recipes == nil {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                } else if !matches.isEmpty {
                    Section(L("From your recipes")) {
                        ForEach(Array(matches)) { r in
                            Button { Task { await save(["recipe_id": r.id]) } } label: {
                                HStack {
                                    Image(systemName: "frying.pan").foregroundStyle(Theme.primaryText)
                                    Text(r.title).foregroundStyle(Theme.ink)
                                    Spacer()
                                    Image(systemName: "plus").foregroundStyle(Theme.primaryText)
                                }
                            }
                        }
                    }
                }
            }
            .themedList()
            .navigationTitle(AwayText.day(day))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .task { recipes = (try? await api.recipes()) ?? [] }
        }
    }

    private func addTitle() {
        let s = title.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty else { return }
        Task { await save(["title": String(s.prefix(100))]) }
    }

    private func save(_ extra: [String: Any]) async {
        var body: [String: Any] = ["day": day, "slot": slot]
        for (k, v) in extra { body[k] = v }
        do {
            try await api.awaySend("POST", "trips/\(tripId)/meals", body)
            onDone()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - house sitter

private struct AwaySitterTab: View {
    let store: ServerStore
    let d: AwayDetail
    let act: AwayAct
    @Binding var toast: ToastMessage?
    @State private var name = ""
    @State private var plants = ""
    @State private var post = ""
    @State private var bins = ""
    @State private var other = ""
    @State private var loadedFor: Int?
    @State private var url: String?
    @State private var busy = false
    @State private var houseInfoLink: GuestLink?

    private var dirty: Bool {
        let s = d.trip.sitter
        return name != (s?.name ?? "") || plants != (s?.plants ?? "") || post != (s?.post ?? "") || bins != (s?.bins ?? "") || other != (s?.other ?? "")
    }

    var body: some View {
        let t = d.trip
        let careSoon = d.checklist.filter { $0.key.hasPrefix("care:") }
        Section {
            TextField(L("e.g. Jonas from next door"), text: $name)
        } header: { Text(L("Who looks after the house?")) } footer: {
            Text(L("Someone looks after plants, post or the bins? They get a link like the babysitter link: where is what in the house (no quantities), plus your notes. It ends the day after you’re back."))
        }
        .onAppear { fill() }
        Section(L("Plants")) { TextField(L("e.g. Water the herbs on the windowsill every two days"), text: $plants, axis: .vertical).lineLimit(1...4) }
        Section(L("Post")) { TextField(L("e.g. Mailbox key hangs on the hook by the door"), text: $post, axis: .vertical).lineLimit(1...4) }
        Section(L("Bin days")) { TextField(L("e.g. Paper on Thursday, put it out the evening before"), text: $bins, axis: .vertical).lineLimit(1...4) }
        Section {
            TextField(L("e.g. Emergency numbers, where the fuse box is"), text: $other, axis: .vertical).lineLimit(2...6)
            Button(L("Save notes")) { Task { await save() } }.disabled(!dirty)
        } header: { Text(L("Anything else")) } footer: {
            if !careSoon.isEmpty {
                Text(LF("Due while you’re away (added to the note automatically): %@",
                        careSoon.map { String($0.text.components(separatedBy: " – ").first ?? $0.text) }.joined(separator: ", ")))
            }
        }
        Section {
            if let url {
                Text(LF("Link for %@", name.isEmpty ? L("the house sitter") : name)).font(.headline)
                Text(url).font(.footnote.monospaced()).textSelection(.enabled)
                Text(LF("Shown only now. Valid until %@.", AwayText.day(ServerDate.parse(t.endDay).flatMap { Calendar.current.date(byAdding: .day, value: 1, to: $0) }.map { ServerDate.day($0) } ?? t.endDay)))
                    .font(.caption).foregroundStyle(Theme.ink3)
                if let u = URL(string: url) {
                    ShareLink(item: u, subject: Text(L("Our home – where is what"))) { Label(L("Share"), systemImage: "square.and.arrow.up") }
                }
                Button { UIPasteboard.general.string = url; toast = ToastMessage(text: L("Link copied")) } label: { Label(L("Copy"), systemImage: "doc.on.doc") }
            } else if let link = t.sitterLink {
                Text(L("House-sitter link is active")).font(.headline)
                Text([link.expiresAt.map { LF("until %@", AwayText.day(String($0.prefix(10)))) },
                      link.lastSeenAt.flatMap { ServerDate.parse($0) }.map { LF("last opened %@", $0.formatted(date: .abbreviated, time: .shortened)) } ?? L("not opened yet")]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Theme.ink3)
                Button { houseInfoLink = GuestLink(id: link.id, name: name.isEmpty ? L("House sitter") : LF("House sitter: %@", name), scopes: ["stock"]) } label: {
                    Label(L("House info for this link"), systemImage: "info.circle")
                }
                Button { Task { await create() } } label: { Label(L("New link"), systemImage: "arrow.counterclockwise") }.disabled(busy)
                Button(L("End link"), role: .destructive) { Task { await act("DELETE", "trips/\(t.id)/sitter-link", nil, nil) } }
            } else {
                Text(L("No link yet")).font(.headline)
                Text(L("Create it when the notes are done – you can change the notes later, the link stays the same."))
                    .font(.caption).foregroundStyle(Theme.ink3)
                Button(L("Create link")) { Task { await create() } }.disabled(busy)
            }
        }
        .sheet(item: $houseInfoLink) { l in
            HouseLinkSelectionSheet(api: store.api, link: l) { msg in toast = ToastMessage(text: msg) }
        }
    }

    private func fill() {
        guard loadedFor != d.trip.id else { return }
        loadedFor = d.trip.id
        let s = d.trip.sitter
        name = s?.name ?? ""
        plants = s?.plants ?? ""
        post = s?.post ?? ""
        bins = s?.bins ?? ""
        other = s?.other ?? ""
    }

    private var sitterBody: [String: Any] {
        ["sitter": ["name": String(name.prefix(60)), "plants": String(plants.prefix(600)), "post": String(post.prefix(600)),
                    "bins": String(bins.prefix(600)), "other": String(other.prefix(600))]]
    }

    private func save() async {
        await act("PATCH", "trips/\(d.trip.id)", sitterBody, d.trip.sitterLink != nil ? L("Saved – the link shows the new notes") : L("Saved"))
    }

    private func create() async {
        busy = true
        defer { busy = false }
        do {
            if dirty { try await store.api.awaySend("PATCH", "trips/\(d.trip.id)", sitterBody) }
            let r = try await store.api.send("POST", "api/away/trips/\(d.trip.id)/sitter-link", as: AwayLinkURL.self)
            url = r.url
            await act("GET", "trips/\(d.trip.id)", nil, nil)
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

// MARK: - back home

private struct AwayHomeTab: View {
    let store: ServerStore
    let d: AwayDetail
    let act: AwayAct
    @Binding var toast: ToastMessage?
    @State private var off: Set<String> = []
    @State private var backQty: [Int: Int] = [:]

    var body: some View {
        let t = d.trip
        let id = t.id
        let outstanding = d.packing.filter { ($0.outQty ?? 0) > 0 && $0.back != true }
        let pick = d.welcome.filter { $0.onList != true && !off.contains($0.key) }
        if t.welcomeReady != true && t.phase != "done" {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("Ready on the way back")).font(.headline)
                    Text(L("From the last day of the trip, a welcome-home list (milk, bread, the fresh things you usually buy) and a check of what expired show up here."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
            }
        } else {
            Section(L("Welcome-home list")) {
                if d.welcome.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L("Nothing needed")).font(.headline)
                        Text(L("Everything you usually buy fresh is still good at home.")).font(.subheadline).foregroundStyle(Theme.ink2)
                    }
                }
                ForEach(d.welcome) { w in
                    let on = w.onList != true && !off.contains(w.key)
                    Button {
                        if off.contains(w.key) { off.remove(w.key) } else { off.insert(w.key) }
                    } label: {
                        HStack(spacing: Theme.Space.s3) {
                            Image(systemName: on || w.onList == true ? "checkmark.circle.fill" : "circle").font(.title3)
                                .foregroundStyle(w.onList == true ? Theme.ink3 : on ? Theme.primary : Theme.ink3)
                            if w.imagePath != nil { ProductThumb(path: w.imagePath, api: store.api, size: 36) }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(w.name).foregroundStyle(Theme.ink)
                                Text(w.onList == true ? L("on the shopping list") : w.reason == "expired" ? L("expired while you were away") : w.reason == "usual" ? L("you usually buy it") : L("a fresh basic"))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                    .disabled(w.onList == true)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
                if !pick.isEmpty {
                    Button {
                        Task {
                            do {
                                let r = try await store.api.send("POST", "api/away/trips/\(id)/welcome", json: ["keys": pick.map(\.key)], as: AwayAdded.self)
                                let n = r.added ?? 0
                                await act("GET", "trips/\(id)", nil, n == 1 ? L("1 thing is on the shopping list") : LF("%d things are on the shopping list", n))
                            } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
                        }
                    } label: {
                        Label(pick.count == 1 ? L("Put 1 thing on the shopping list") : LF("Put %d things on the shopping list", pick.count), systemImage: "basket")
                    }
                }
            }
            if !d.expired.isEmpty {
                Section(L("Expired while you were away")) {
                    ForEach(d.expired) { x in
                        HStack(spacing: Theme.Space.s3) {
                            ProductThumb(path: x.imagePath, api: store.api, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(x.name)
                                Text(x.dateKind == "use_by" ? LF("use by %@ – better not eat it", AwayText.day(x.useBy)) : LF("best before %@ – look, smell, taste", AwayText.day(x.useBy)))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                            Spacer(minLength: 4)
                            Button { Task { await act("POST", "trips/\(id)/expired", ["product_id": x.productId, "action": "toss"], nil) } } label: {
                                Image(systemName: "trash").frame(minWidth: 30, minHeight: 30)
                            }
                            .buttonStyle(.bordered)
                            .accessibilityLabel(L("Toss"))
                            Button { Task { await act("POST", "trips/\(id)/expired", ["product_id": x.productId, "action": "keep"], nil) } } label: {
                                Image(systemName: "checkmark").frame(minWidth: 30, minHeight: 30)
                            }
                            .buttonStyle(.bordered)
                            .accessibilityLabel(L("Still good"))
                        }
                    }
                }
            }
            if !outstanding.isEmpty {
                Section(L("What came back?")) {
                    ForEach(outstanding) { i in
                        let out = Int(i.outQty ?? 0)
                        HStack(spacing: Theme.Space.s3) {
                            ProductThumb(path: i.imagePath, api: store.api, size: 36)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(i.text)
                                Text(LF("%@ taken along", AwayNum.s(i.outQty ?? 0))).font(.caption).foregroundStyle(Theme.ink3)
                            }
                            Spacer()
                            Stepper(value: Binding(get: { backQty[i.id] ?? out }, set: { backQty[i.id] = min(out, max(0, $0)) }), in: 0...max(out, 0)) {
                                Text("\(backQty[i.id] ?? out)").font(.subheadline.monospacedDigit())
                            }
                            .fixedSize()
                        }
                    }
                    Button {
                        let lines: [[String: Any]] = outstanding.map { ["id": $0.id, "qty": backQty[$0.id] ?? Int($0.outQty ?? 0)] }
                        Task { await act("POST", "trips/\(id)/book-back", ["lines": lines], L("Back in stock")) }
                    } label: { Label(L("Book back into stock"), systemImage: "arrow.counterclockwise") }
                }
            }
            if t.welcomeDone != true && t.phase == "after" {
                Section {
                    Button(L("All settled – we’re home")) { Task { await act("POST", "trips/\(id)/welcome-done", nil, nil) } }
                }
            }
        }
    }
}

// MARK: - create / edit

private struct AwayTripForm: View {
    let api: APIClient
    let trip: AwayTrip?
    var only: String? = nil
    let members: [Member]
    let onSaved: (Int, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var place = ""
    @State private var start = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
    @State private var end = Calendar.current.date(byAdding: .day, value: 14, to: Date()) ?? Date()
    @State private var travellers: [String] = []
    @State private var home: [String] = []
    @State private var extra = ""
    @State private var useUpDays = 4
    @State private var quiet = true
    @State private var pauseAuto = true
    @State private var kitchen = false
    @State private var kitchenStore = ""
    @State private var kind: String? = "holiday"
    @State private var busy = false
    @State private var error: String?

    private var memberNames: [String] { members.map(\.name) }
    private var memberHome: [String] { memberNames.filter { !travellers.contains($0) } }
    /// only some are away: no fridge, holiday kitchen or paused list – the house runs on
    private var partial: Bool { memberHome.count + home.count > 0 }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    FlowLayout(spacing: 6) {
                        ForEach(AwayKinds.all, id: \.0) { k in
                            ChoiceChip(title: k.1, on: kind == k.0) { kind = kind == k.0 ? nil : k.0 }
                        }
                    }
                    .padding(.vertical, 4)
                } header: { Text(L("What for?")) } footer: {
                    Text(kind == "hospital" ? L("Stays in the household: the assistant, Home Assistant and notifications only ever say “away”.")
                                            : L("It changes what happens at home – e.g. what may wait."))
                }
                Section {
                    TextField(L("e.g. Autumn holidays"), text: $name)
                    TextField(L("e.g. Baltic Sea"), text: $place)
                } header: { Text("\(L("Name")) · \(L("Where to"))") }
                Section {
                    DatePicker(L("From"), selection: $start, displayedComponents: .date)
                        .onChange(of: start) { _, v in if end < v { end = v } }
                    DatePicker(L("Back on"), selection: $end, in: start..., displayedComponents: .date)
                }
                Section {
                    FlowLayout(spacing: 6) {
                        ForEach(memberNames, id: \.self) { n in
                            ChoiceChip(title: n, on: travellers.contains(n)) { toggle(n) }
                        }
                        ForEach(travellers.filter { !memberNames.contains($0) }, id: \.self) { n in
                            ChoiceChip(title: n, on: true) { toggle(n) }
                        }
                    }
                    .padding(.vertical, 4)
                } header: { Text(L("Who is away?")) } footer: {
                    Text(L("Not everyone has to come along. Kids or guests without an account: add them below."))
                }
                Section {
                    TextField(L("e.g. Mika, Oma Inge"), text: $extra)
                    HStack {
                        Button(L("travels")) { addExtra(travels: true) }.buttonStyle(.bordered)
                        Button(L("stays")) { addExtra(travels: false) }.buttonStyle(.bordered)
                    }
                    .disabled(extra.trimmingCharacters(in: .whitespaces).isEmpty)
                    if !memberHome.isEmpty || !home.isEmpty {
                        FlowLayout(spacing: 6) {
                            ForEach(memberHome, id: \.self) { n in ChoiceChip(title: n, on: false) {} }
                            ForEach(home, id: \.self) { n in ChoiceChip(title: n, systemImage: "xmark", on: false) { home.removeAll { $0 == n } } }
                        }
                        .padding(.vertical, 4)
                    }
                } header: { Text(L("Also travelling or staying at home")) } footer: {
                    Text(memberHome.count + home.count > 0 ? L("Someone stays home: the week plan and the shopping list carry on for them.")
                                                           : L("Nobody stays home: the week plan leaves the trip days empty."))
                }
                if !partial { Section(L("Start using things up")) {
                    Picker(L("Start using things up"), selection: $useUpDays) {
                        Text(L("off")).tag(0)
                        Text(L("2 days before")).tag(2)
                        Text(L("4 days before")).tag(4)
                        Text(L("a week before")).tag(7)
                    }
                    .pickerStyle(.segmented)
                } }
                Section {
                    Toggle(isOn: $quiet) {
                        VStack(alignment: .leading) {
                            Text(L("Only urgent notifications"))
                            Text(partial ? L("For those away only – the people at home still get them.")
                                         : L("No “milk is low”, digest or reminders while you’re away – sign-in alerts still come through.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    if !partial { Toggle(isOn: $pauseAuto) {
                        VStack(alignment: .leading) {
                            Text(L("Pause automatic suggestions"))
                            Text(L("Nothing lands on the shopping list by itself while nobody is home.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    Toggle(isOn: $kitchen) {
                        VStack(alignment: .leading) {
                            Text(L("Holiday kitchen"))
                            Text(L("Cooking at the holiday flat: a small meal plan with its own shopping list.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    if kitchen {
                        TextField(L("Holiday flat"), text: $kitchenStore)
                    } }
                } footer: {
                    if kitchen && !partial { Text(L("Shop for the holiday list")) }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(trip == nil ? (only != nil ? L("Only I’m away") : L("New trip")) : L("Edit trip"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(trip == nil ? L("Save trip") : L("Save")) { Task { await save() } }.disabled(busy)
                }
            }
            .onAppear { fill() }
        }
    }

    private func fill() {
        guard let t = trip else {
            if let only {
                kind = "work"
                travellers = [only]
                start = Date()
                end = Calendar.current.date(byAdding: .day, value: 3, to: Date()) ?? Date()
            } else {
                travellers = memberNames
            }
            return
        }
        name = t.name
        place = t.place ?? ""
        start = ServerDate.parse(t.startDay) ?? start
        end = ServerDate.parse(t.endDay) ?? end
        travellers = t.travellers ?? []
        home = (t.home ?? []).filter { !memberNames.contains($0) }
        useUpDays = t.useUpDays ?? 4
        quiet = t.quiet ?? true
        pauseAuto = t.pauseAuto ?? true
        kitchen = t.kitchen ?? false
        kitchenStore = t.kitchenStore ?? ""
        kind = t.kind
    }

    private func toggle(_ n: String) {
        if travellers.contains(n) { travellers.removeAll { $0 == n } } else { travellers.append(n) }
    }

    private func addExtra(travels: Bool) {
        let n = String(extra.trimmingCharacters(in: .whitespaces).prefix(40))
        guard !n.isEmpty else { return }
        if travels { if !travellers.contains(n) { travellers.append(n) } } else if !home.contains(n) { home.append(n) }
        extra = ""
    }

    private func save() async {
        guard end >= start else { error = L("The trip cannot end before it starts."); return }
        busy = true
        defer { busy = false }
        let p = place.trimmingCharacters(in: .whitespaces)
        let n = name.trimmingCharacters(in: .whitespaces)
        let ks = kitchenStore.trimmingCharacters(in: .whitespaces)
        let body: [String: Any] = [
            "name": String((n.isEmpty ? (p.isEmpty ? (partial ? L("Away") : L("Trip")) : p) : n).prefix(80)),
            "place": awayNul(p.isEmpty ? nil : String(p.prefix(80))),
            "start_day": ServerDate.day(start),
            "end_day": ServerDate.day(end),
            "travellers": Array(travellers.prefix(20)),
            "home": Array((memberHome + home).prefix(20)),
            "use_up_days": useUpDays,
            "quiet": quiet,
            "pause_auto": pauseAuto,
            "kitchen": kitchen && !partial,
            "kind": awayNul(kind),
            "kitchen_store": awayNul(ks.isEmpty ? nil : String(ks.prefix(60))),
        ]
        do {
            if let t = trip {
                try await api.awaySend("PATCH", "trips/\(t.id)", body)
                onSaved(t.id, false)
            } else {
                let r = try await api.send("POST", "api/away/trips", json: body, as: CreatedID.self)
                onSaved(r.id, true)
            }
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// a JSON value or null
private func awayNul(_ v: Any?) -> Any { v ?? NSNull() }
