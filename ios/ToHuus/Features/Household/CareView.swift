import SwiftUI

// Aufgaben natively (web: pages/Care.tsx, server: routes/home.ts /api/care, lib/care.ts, docs/tasks.md).
// Household chores and care & deadlines, once, recurring or when needed, for everyone or only for me: one tap when
// done, the next date is set by the server. No points, no ranking.

/// GET /api/care → { tasks, templates, users, today }
struct CareData: Decodable, Sendable {
    @Lossy var tasks: [CareTask]
    @Lossy var templates: [CareTemplate]
    var today: String?
    /** the signed-in member (filter "Für mich") */
    var me: Int?
}

struct CareTask: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var template: String?
    var intervalN: Int?
    /// day | week | month | year
    var intervalUnit: String?
    var nextDue: String?
    var lastDone: String?
    var leadDays: Int?
    var locationId: Int?
    var productId: Int?
    var consumeQty: Double?
    var assigneeUserId: Int?
    var note: String?
    /// none | ok | soon | today | overdue
    var state: String?
    var days: Int?
    var product: CareProduct?
    var location: CareLocation?
    var assignee: CareAssignee?
    var log: [CareLogEntry]?
    /// house (household chore) | care (care & deadlines)
    var category: String?
    /// household | private ("nur für mich" – only its owner sees it)
    var visibility: String?
    var ownerUserId: Int?
    /// done (next time counts from the day it was done) | due (keeps its days, "every Monday")
    var anchor: String?
    var asNeeded: Bool?
    var checklist: [CheckItem]?
    var doerKey: String?
    var doer: Doer?
    /// taking turns: person keys in order – "done" passes it to the next one
    var rotation: [String]?
    /// detail only: the rhythm the household actually keeps
    var learnedEveryDays: Int?
    /// Termin: with a time (HH:MM) the task is a calendar entry, `durationMin` long, at `place`
    var dueTime: String?
    var durationMin: Int?
    var place: String?
    /// "Mach ich": who promised it for which day (server: care.ts promiseCareTask)
    var promise: Promise?
    /// follows collection dates from the household's calendar (server: calsync.ts)
    var extKind: String?
    /// learned: who did it at least 3 of the last 6 times (server: care.ts usualDoer)
    var usual: Usual?
    /// the person this task leans on is away today (server: care.ts awayOf)
    var away: AwayNote?
    struct AwayNote: Decodable, Sendable, Hashable { var name: String; var until: String }
    /// "Abgeben an …": asked and not answered yet
    var offer: Offer?
    struct Usual: Decodable, Sendable, Hashable { var userId: Int; var name: String; var color: String? }
    struct Offer: Decodable, Sendable, Hashable {
        struct Who: Decodable, Sendable, Hashable { var id: Int; var name: String }
        var to: Who
        var by: Who?
    }

    struct Promise: Decodable, Sendable, Hashable { var userId: Int; var name: String; var color: String?; var day: String; var passed: Bool? }

    var isDueNow: Bool { ["overdue", "today", "soon"].contains(state ?? "") }
    var isPrivate: Bool { visibility == "private" }
    var isHouse: Bool { category == "house" }

    struct CheckItem: Decodable, Sendable, Hashable { var text: String; var done: Bool }
    struct Doer: Decodable, Sendable, Hashable { var key: String; var name: String; var color: String? }

    struct CareProduct: Decodable, Sendable, Hashable { var id: Int; var name: String; var stock: Double? }
    struct CareLocation: Decodable, Sendable, Hashable { var id: Int; var name: String }
    struct CareAssignee: Decodable, Sendable, Hashable { var id: Int; var name: String; var color: String? }
    struct CareLogEntry: Decodable, Sendable, Hashable, Identifiable {
        var id: Int
        var doneOn: String
        var actor: String?
        var note: String?
    }
}

struct CareTemplate: Decodable, Sendable, Identifiable, Hashable {
    var key: String
    var name: String
    var n: Int?
    var unit: String?
    var group: String?
    var added: Bool?
    var category: String?
    var asNeeded: Bool?
    var id: String { key }
}

/// GET /api/care/recent – done lately, with who did it
struct CareRecent: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var taskId: Int
    var doneOn: String
    var actor: String?
    var name: String
}

/// POST /api/care/:id/done → { task, consumed, on_shopping_list }
struct CareDoneResult: Decodable, Sendable {
    var task: CareTask
    var onShoppingList: Bool?
}

extension APIClient {
    func care() async throws -> CareData { try await get("api/care") }
    func careTask(_ id: Int) async throws -> CareTask { try await get("api/care/\(id)") }
    func careRecent() async throws -> [CareRecent] { try await get("api/care/recent", as: Lossy<CareRecent>.self).wrappedValue }
    func addCareTemplate(_ key: String) async throws { _ = try await send("POST", "api/care", json: ["template": key], as: Ignored.self) }
    func saveCareTask(id: Int?, _ body: [String: Any]) async throws {
        if let id { _ = try await send("PATCH", "api/care/\(id)", json: body, as: Ignored.self) }
        else { _ = try await send("POST", "api/care", json: body, as: Ignored.self) }
    }
    func deleteCareTask(_ id: Int) async throws { _ = try await send("DELETE", "api/care/\(id)", as: Ignored.self) }
    /// `nextDue` for tasks with a fixed date (passport): the new date, or nil for none
    func careDone(_ id: Int, nextDue: String? = nil) async throws -> CareDoneResult {
        var body: [String: Any] = [:]
        if let nextDue { body["next_due"] = nextDue }
        return try await send("POST", "api/care/\(id)/done", json: body)
    }
    func careUndo(_ id: Int) async throws { _ = try await send("POST", "api/care/\(id)/undo", as: Ignored.self) }
    /// "Ich kümmere mich" – or let go again. No points, no ranking.
    /// "Mach ich": today | tomorrow | weekend | YYYY-MM-DD; nil takes it back
    func carePromise(_ id: Int, _ when: String?) async throws {
        _ = try await send("POST", "api/care/\(id)/promise", json: ["when": when.map { $0 as Any } ?? NSNull()], as: Ignored.self)
    }
    func careClaim(_ id: Int, _ claim: Bool) async throws { _ = try await send("POST", "api/care/\(id)/claim", json: ["claim": claim], as: Ignored.self) }
}

enum CareLabels {
    static let groups: [(String, String)] = [
        ("chores", L("Household")), ("kitchen", L("Kitchen")), ("house", L("House")), ("safety", L("Safety")), ("car", L("Car & bike")), ("papers", L("Papers & contracts")),
    ]

    /// template names come in English from the server (server/lib/care.ts CARE_TEMPLATES) – literal here so the
    /// string catalogue has them
    static func templateName(_ name: String) -> String {
        let known: [String: String] = [
            "Clean the bathroom": L("Clean the bathroom"),
            "Vacuum": L("Vacuum"),
            "Mop the floors": L("Mop the floors"),
            "Dust": L("Dust"),
            "Change the bed linen": L("Change the bed linen"),
            "Change towels": L("Change towels"),
            "Take out the bins": L("Take out the bins"),
            "Take glass and paper away": L("Take glass and paper away"),
            "Wipe out the fridge": L("Wipe out the fridge"),
            "Clean the oven": L("Clean the oven"),
            "Clean the windows": L("Clean the windows"),
            "Water the plants": L("Water the plants"),
            "Change water filter": L("Change water filter"),
            "Descale coffee machine": L("Descale coffee machine"),
            "Descale Thermomix": L("Descale Thermomix"),
            "Descale kettle": L("Descale kettle"),
            "Clean dishwasher filter": L("Clean dishwasher filter"),
            "Clean extractor hood filter": L("Clean extractor hood filter"),
            "Washing machine hot cycle (90 °C)": L("Washing machine hot cycle (90 °C)"),
            "Change heating / AC filter": L("Change heating / AC filter"),
            "Test smoke detectors": L("Test smoke detectors"),
            "Replace smoke detector batteries": L("Replace smoke detector batteries"),
            "Check fire extinguisher": L("Check fire extinguisher"),
            "Check first-aid kit": L("Check first-aid kit"),
            "Check medicine cabinet for expired items": L("Check medicine cabinet for expired items"),
            "Change car tyres (summer / winter)": L("Change car tyres (summer / winter)"),
            "Check bike tyres and brakes": L("Check bike tyres and brakes"),
            "Passport / ID card expires": L("Passport / ID card expires"),
            "Insurance / contract renewal": L("Insurance / contract renewal"),
        ]
        return known[name] ?? name
    }

    static func icon(_ template: String?, category: String? = nil) -> String {
        switch template ?? "" {
        case "clean-bathroom": return "bathtub"
        case "vacuum", "mop", "dust": return "sparkles"
        case "bed-linen", "towels": return "bed.double"
        case "bins", "glass-paper": return "trash"
        case "plants": return "leaf"
        case "water-filter", "dishwasher-filter": return "drop"
        case "descale-coffee", "descale-thermomix", "descale-kettle": return "cup.and.saucer"
        case "hood-filter", "hvac-filter": return "fan"
        case "washer-hot": return "flame"
        case "smoke-test", "smoke-battery": return "checkmark.shield"
        case "extinguisher": return "fire.extinguisher"
        case "first-aid", "medicine": return "cross.case"
        case "car-tyres": return "car"
        case "bike-tyres": return "bicycle"
        case "passport", "contract": return "person.text.rectangle"
        default: return category == "house" ? "checklist" : "wrench.and.screwdriver"
        }
    }

    static func interval(_ n: Int?, _ unit: String?, asNeeded: Bool = false) -> String {
        if asNeeded { return L("when needed") }
        guard let n, n > 0, let unit else { return L("fixed date") }
        if n == 1 {
            switch unit {
            case "day": return L("every day")
            case "week": return L("every week")
            case "year": return L("every year")
            default: return L("every month")
            }
        }
        switch unit {
        case "day": return LF("every %d days", n)
        case "week": return LF("every %d weeks", n)
        case "year": return LF("every %d years", n)
        default: return LF("every %d months", n)
        }
    }

    static func due(_ t: CareTask) -> String {
        if t.asNeeded == true && t.nextDue == nil { return L("when needed") }
        guard t.state != "none", let next = t.nextDue else { return L("no date") }
        let d = t.days ?? 0
        switch t.state {
        // gentle mode (FocusViews.swift): no counting of days late
        case "overdue": return FocusFlags.gentle ? L("could be done") : d == -1 ? L("1 day overdue") : LF("%d days overdue", -d)
        case "today": return L("due today")
        default:
            if d == 1 { return L("due tomorrow") }
            if t.state == "soon" { return LF("due in %d days", d) }
            guard let date = ServerDate.parse(next) else { return next }
            let s = d > 300 ? date.formatted(.dateTime.month(.abbreviated).year()) : date.formatted(.dateTime.day().month(.abbreviated))
            return LF("next: %@", s)
        }
    }

    /// "Sam macht’s morgen" – and kindly, once the day is over: "Sam hatte es für Mo., 13. Okt. vor"
    static func promise(_ p: CareTask.Promise) -> String {
        let date = ServerDate.parse(p.day)?.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)) ?? p.day
        if p.passed == true { return LF("%@ had planned it for %@", p.name, date) }
        if p.day == ServerDate.day() { return LF("%@ does it today", p.name) }
        if p.day == ServerDate.day(Date().addingTimeInterval(86_400)) { return LF("%@ does it tomorrow", p.name) }
        return LF("%@ does it on %@", p.name, date)
    }

    static func color(_ state: String?) -> Color {
        if FocusFlags.gentle, state == "overdue" || state == "today" { return Theme.ink2 }
        switch state {
        case "overdue": return Theme.empty
        case "today": return Theme.warning
        case "soon": return Theme.low
        default: return Theme.ink3
        }
    }

    static func day(_ s: String?, long: Bool = false) -> String {
        guard let d = ServerDate.parse(s) else { return "—" }
        return long ? d.formatted(.dateTime.weekday(.abbreviated).day().month(.wide).year()) : d.formatted(.dateTime.day().month(.abbreviated).year())
    }
}

/// Alle · Haushalt · Pflege & Fristen · Für mich (web: Care.tsx taskMatches)
enum TaskFilter: String, CaseIterable, Identifiable {
    case all, house, care, mine
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return L("All")
        case .house: return L("Household")
        case .care: return L("Care & deadlines")
        case .mine: return L("For me")
        }
    }

    func matches(_ t: CareTask, me: Int?) -> Bool {
        switch self {
        case .all: return true
        case .mine: return t.isPrivate || (me != nil && (t.doerKey == "u\(me!)" || t.assigneeUserId == me))
        case .house: return t.isHouse
        case .care: return !t.isHouse
        }
    }
}

/// Mehr › Aufgaben (web: /aufgaben): due and later tasks with the web's filters, one-tap templates, detail with
/// sub-items, history and "Ich hab's im Blick", editing. Labels and the printable ticket stay in the web app.
struct CareView: View {
    let api: APIClient
    var initialFilter: TaskFilter = .all
    @Environment(AppModel.self) private var app
    @State private var data: CareData?
    @State private var error: String?
    @State private var showTemplates = false
    @State private var form: CareFormTarget?
    @State private var detail: CareTask?
    @State private var askDate: CareTask?
    @State private var toast: ToastMessage?
    @State private var me: MeLite?
    @State private var filter: TaskFilter?
    @State private var recent: [CareRecent] = []
    @State private var allRecent = false
    /// the initials circle grows with Dynamic Type
    @ScaledMetric(relativeTo: .caption) private var initial: CGFloat = 24
    @State private var reloads = 0

    private var current: TaskFilter { filter ?? initialFilter }

    var body: some View {
        List {
            Section {
                Text(L("Bathroom, bed linen, water filter, smoke detectors, passports: what has to be done at home, once or again and again – for everyone or only for you. One tap when done – the next date is set automatically."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
                Picker(L("Show"), selection: Binding(get: { current }, set: { filter = $0 })) {
                    ForEach(TaskFilter.allCases) { f in Text(f.title).tag(f) }
                }
                .pickerStyle(.segmented)
                if let data {
                    let overdue = data.tasks.filter { $0.state == "overdue" }.count
                    NavigationLink { FocusView(api: api) } label: { Label(L("One thing at a time"), systemImage: "scope") }
                    FreshStartButton(api: api, overdue: overdue) { text in
                        toast = ToastMessage(text: text)
                        Task { await load() }
                    }
                    // household tasks nobody has in mind yet – counted kindly, never as blame
                    let loose = data.tasks.filter { !$0.isPrivate && $0.assigneeUserId == nil && $0.doerKey == nil && ($0.state == "today" || $0.state == "overdue" || $0.state == "soon") }.count
                    if loose > 0 && (me?.claimsOn ?? true) {
                        Text(loose == 1 ? L("1 due task has nobody keeping it in mind yet – tap it and say “I keep it in mind”.")
                                        : LF("%d due tasks have nobody keeping them in mind yet – tap one and say “I keep it in mind”.", loose))
                            .font(.footnote).foregroundStyle(Theme.ink3)
                    }
                }
            }
            if let error { Section { ErrorBanner(message: error) { Task { await load() } } }.listRowBackground(Color.clear) }
            if let data {
                if data.tasks.contains(where: { $0.offer?.to.id == data.me && data.me != nil }) {
                    Section { OfferAsks(api: api, tasks: data.tasks, me: data.me) { Task { await load() } } }
                }
                let shown = data.tasks.filter { current.matches($0, me: data.me) }
                let due = shown.filter(\.isDueNow)
                let later = shown.filter { !$0.isDueNow }
                if shown.isEmpty {
                    EmptyStateView(systemImage: "checklist", title: L("No tasks yet"),
                                   message: L("Pick a few from the suggestions below – one tap each. You can adjust the interval later."), art: .calendar)
                        .listRowBackground(Color.clear)
                }
                if !due.isEmpty { Section(L("Due")) { ForEach(due) { row($0) } } }
                if !later.isEmpty { Section(L("Later")) { ForEach(later) { row($0) } } }
                WhoDoesWhatSection(api: api, refresh: data.tasks.count + recent.count, onChanged: { Task { await load() } })
                if !recent.isEmpty {
                    Section {
                        ForEach(allRecent ? recent : Array(recent.prefix(5))) { r in
                            HStack(spacing: Theme.Space.s3) {
                                Image(systemName: "checkmark").foregroundStyle(Theme.primaryText).accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(r.name)
                                    Text([CareLabels.day(r.doneOn), r.actor].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink3)
                                }
                            }
                        }
                        if recent.count > 5 {
                            Button(allRecent ? L("Show less") : LF("Show all %d", recent.count)) { withAnimation { allRecent.toggle() } }
                        }
                    } header: { Text(L("Recently done")) }
                }
                BlickSection(api: api, refresh: reloads) { id in detail = data.tasks.first { $0.id == id } }
                if data.me != nil { WeekReviewLink(api: api) }
                RatgeberSection(api: api, areas: ["aufgaben", "kopf"])
                templates(data)
            } else if error == nil {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            }
            Section {
                NavigationLink { CalendarSyncView(api: api, household: app.store?.householdKey ?? "default") } label: { Label(L("Read your existing calendar"), systemImage: "calendar.badge.checkmark") }
                NavigationLink { CalDavView(api: api) } label: { Label(L("Reminders & Calendar"), systemImage: "checklist.checked") }
                NavigationLink { LabelsView(api: api, kind: .care) } label: { Label(L("Labels"), systemImage: "qrcode") }
            } footer: {
                Text(L("Your tasks in Apple Reminders, your appointments in your calendar."))
            }
        }
        .themedList()
        .navigationTitle(L("Tasks"))
        .onAppear { app.screenContext = "tasks" }
        .onDisappear { if app.screenContext == "tasks" { app.screenContext = nil } }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    form = CareFormTarget(task: nil, template: nil, name: nil, category: current == .care ? "care" : "house", privateTask: current == .mine)
                } label: { Image(systemName: "plus") }
                    .accessibilityLabel(L("New task"))
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $form) { f in CareTaskForm(api: api, target: f) { Task { await load() } } }
        .sheet(item: $detail) { t in
            CareDetailSheet(api: api, task: t, me: me,
                            onEdit: { x in detail = nil; Task { try? await Task.sleep(nanoseconds: 450_000_000); form = CareFormTarget(task: x, template: nil, name: nil) } },
                            onDone: { x in detail = nil; done(x) },
                            onChanged: { Task { await load() } })
        }
        .sheet(item: $askDate) { t in
            CareNewDateSheet(task: t) { next in
                askDate = nil
                Task { await finish(t, nextDue: next) }
            }
        }
        .toast($toast)
        .onAppear {
            #if DEBUG
            if UserDefaults.standard.string(forKey: "debugMore") == "care-new" { form = CareFormTarget(task: nil, template: nil, name: nil) }
            #endif
        }
    }

    private func row(_ t: CareTask) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: CareLabels.icon(t.template, category: t.category))
                .foregroundStyle(CareLabels.color(t.state))
                .frame(width: 32, height: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    if t.isPrivate { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(Theme.ink3).accessibilityLabel(L("Only for me")) }
                    Text(t.name).foregroundStyle(Theme.ink)
                }
                let items = t.checklist ?? []
                let sub = [t.promise.map { CareLabels.promise($0) },
                           t.extKind == nil ? nil : L("from the calendar"),
                           t.away.map { LF("%@ is away until %@", $0.name, AwayText.day($0.until)) },
                           t.away == nil && t.doer == nil && (t.rotation ?? []).isEmpty ? t.usual.map { LF("usually %@", $0.name) } : nil,
                           t.asNeeded == true ? nil : CareLabels.interval(t.intervalN, t.intervalUnit),
                           items.isEmpty ? nil : LF("%d of %d", items.filter(\.done).count, items.count),
                           t.product.map { LF("%@: %@ in stock", $0.name, Self.qty($0.stock ?? 0)) },
                           t.location?.name].compactMap { $0 }
                (Text(CareLabels.due(t) + (t.nextDue != nil ? t.dueTime.map { ", " + TaskTime.label($0) } ?? "" : "")).foregroundStyle(CareLabels.color(t.state))
                    + Text((sub.isEmpty && t.place == nil ? "" : " · ") + ([t.place].compactMap { $0 } + sub).joined(separator: " · ")).foregroundStyle(Theme.ink3))
                    .font(.caption)
            }
            Spacer(minLength: 4)
            if let d = t.doer {
                Text(String(d.name.prefix(1))).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink)
                    .frame(width: initial, height: initial).background(Theme.lowSoft, in: Circle())
                    .overlay(Circle().stroke(Theme.clay, lineWidth: 1))
                    .accessibilityLabel(LF("%@ does it", d.name))
            } else if let a = t.assignee {
                Text(String(a.name.prefix(1))).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink)
                    .frame(width: initial, height: initial).background(Theme.sand, in: Circle())
                    .overlay(Circle().stroke(Theme.sage, lineWidth: 1))
                    .accessibilityLabel(LF("%@ keeps it in mind", a.name))
            }
            Button { done(t) } label: {
                Label(L("Done"), systemImage: "checkmark").labelStyle(.titleAndIcon).font(.caption.weight(.semibold))
                    .frame(minHeight: 32)
            }
                .buttonStyle(.bordered)
                .tint(t.state == "overdue" || t.state == "today" ? Theme.primary : Theme.ink2)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
        }
        .contentShape(Rectangle())
        .onTapGesture { detail = t }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { detail = t }
        .accessibilityAction(named: L("Details")) { detail = t }
    }

    @ViewBuilder
    private func templates(_ data: CareData) -> some View {
        let free = data.templates.filter { x in
            x.added != true && (current == .all || current == .mine || (x.category ?? "care") == (current == .house ? "house" : "care"))
        }
        if !free.isEmpty {
            Section {
                if data.tasks.isEmpty || showTemplates {
                    ForEach(CareLabels.groups.indices, id: \.self) { gi in
                        let g = CareLabels.groups[gi]
                        let list = free.filter { $0.group == g.0 }
                        if !list.isEmpty {
                            Text(g.1).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3).textCase(.uppercase)
                            ForEach(list) { x in
                                Button { Task { await add(x) } } label: {
                                    HStack {
                                        Image(systemName: CareLabels.icon(x.key, category: x.category)).frame(width: 28).accessibilityHidden(true)
                                        VStack(alignment: .leading) {
                                            Text(CareLabels.templateName(x.name)).foregroundStyle(Theme.ink)
                                            Text(CareLabels.interval(x.n, x.unit, asNeeded: x.asNeeded == true)).font(.caption).foregroundStyle(Theme.ink3)
                                        }
                                        Spacer()
                                        Image(systemName: "plus").foregroundStyle(Theme.primaryText)
                                    }
                                }
                            }
                        }
                    }
                }
                if !data.tasks.isEmpty {
                    Button(showTemplates ? L("Hide") : L("Show suggestions")) { withAnimation { showTemplates.toggle() } }
                }
            } header: { Text(L("Add in one tap")) }
        }
    }

    static func qty(_ v: Double) -> String { v == v.rounded() ? String(Int(v)) : String(format: "%.1f", v) }

    private func load() async {
        do {
            data = try await api.care()
            error = nil
            recent = (try? await api.careRecent()) ?? []
            reloads += 1
        } catch APIError.notFound {
            error = L("Your server doesn't have this section yet.")
        } catch { self.error = APIError.from(error).localizedDescription }
        if me == nil { me = try? await api.meLite() }
        if let p = try? await api.focusPrefs() { FocusFlags.apply(p) }
    }

    private func add(_ x: CareTemplate) async {
        // a template without interval (passport) needs its date first
        guard x.n != nil || x.asNeeded == true else {
            form = CareFormTarget(task: nil, template: x.key, name: CareLabels.templateName(x.name), category: x.category ?? "care")
            return
        }
        do {
            try await api.addCareTemplate(x.key)
            toast = ToastMessage(text: LF("“%@” added", CareLabels.templateName(x.name)))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    /// one tap with undo; a fixed-date task (passport) asks first – one-offs and "when needed" are simply done
    private func done(_ t: CareTask) {
        if t.intervalN == nil && t.asNeeded != true && !t.isHouse { askDate = t } else { Task { await finish(t, nextDue: nil) } }
    }

    private func finish(_ t: CareTask, nextDue: String?) async {
        do {
            let r = try await api.careDone(t.id, nextDue: nextDue)
            var text = r.task.nextDue.map { LF("Done. Next time: %@", CareLabels.day($0)) } ?? L("Done.")
            if r.onShoppingList == true, let p = r.task.product { text += " " + LF("%@ is on the shopping list.", p.name) }
            toast = ToastMessage(text: text, actionTitle: L("Undo"), action: {
                Task {
                    try? await api.careUndo(t.id)
                    await load()
                }
            })
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

struct CareFormTarget: Identifiable {
    var task: CareTask?
    var template: String?
    var name: String?
    /// new task: house | care, and "only for me"
    var category: String = "care"
    var privateTask = false
    let id = UUID()
}

private struct CareDetailSheet: View {
    let api: APIClient
    let task: CareTask
    let me: MeLite?
    let onEdit: (CareTask) -> Void
    let onDone: (CareTask) -> Void
    let onChanged: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var full: CareTask?
    @State private var mine = false
    @State private var error: String?
    @State private var items: [CareTask.CheckItem] = []
    @State private var addToCalendar = false
    @State private var splitting = false
    @State private var promise: CareTask.Promise?
    @State private var promiseDate = Date().addingTimeInterval(2 * 86_400)

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent(L("Status")) { Text(CareLabels.due(task)).foregroundStyle(CareLabels.color(task.state)) }
                    LabeledContent(L("Repeats"), value: CareLabels.interval(task.intervalN, task.intervalUnit, asNeeded: task.asNeeded == true))
                    LabeledContent(L("Area"), value: task.isHouse ? L("Household") : L("Care & deadlines"))
                    if task.isPrivate { Label(L("Only for me"), systemImage: "lock.fill").foregroundStyle(Theme.ink2) }
                    if let d = task.doer {
                        LabeledContent(L("Who does it"), value: (task.rotation?.count ?? 0) > 1 ? "\(d.name) · \(L("taking turns"))" : d.name)
                    }
                    if let n = full?.learnedEveryDays { LabeledContent(L("Your rhythm"), value: LF("You do it about every %d days", n)) }
                    if let l = task.location { LabeledContent(L("Where"), value: l.name) }
                    LabeledContent(L("Next due"), value: CareLabels.day(task.nextDue, long: true))
                    if task.nextDue != nil, let time = task.dueTime {
                        LabeledContent(L("Time"), value: "\(TaskTime.label(time)) · \(TaskTime.duration(task.durationMin ?? 60))")
                    }
                    if let p = task.place, !p.isEmpty { LabeledContent(L("Place"), value: p) }
                    LabeledContent(L("Last done"), value: task.lastDone == nil ? L("unknown") : CareLabels.day(task.lastDone))
                    LabeledContent(L("Reminder"), value: lead(task.leadDays ?? 0))
                    if let n = task.note, !n.isEmpty { LabeledContent(L("Note"), value: n) }
                }
                if let p = task.product {
                    Section {
                        VStack(alignment: .leading) {
                            Text(p.name)
                            Text(LF("Uses %@ each time · %@ in stock", CareView.qty(task.consumeQty ?? 1), CareView.qty(p.stock ?? 0)))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
                if !items.isEmpty {
                    Section(L("Sub-items")) {
                        ForEach(items.indices, id: \.self) { i in
                            Toggle(items[i].text, isOn: Binding(get: { items[i].done }, set: { v in Task { await tick(i, v) } }))
                        }
                    }
                }
                if me?.isMember ?? true, let uid = me?.userId {
                    Section {
                        if let p = promise { Text(CareLabels.promise(p)).font(.subheadline).foregroundStyle(Theme.ink2) }
                        HStack {
                            Button(L("Today")) { Task { await promiseFor("today") } }
                            Button(L("Tomorrow")) { Task { await promiseFor("tomorrow") } }
                            Button(L("At the weekend")) { Task { await promiseFor("weekend") } }
                        }
                        .buttonStyle(.bordered)
                        DatePicker(L("Pick a day"), selection: $promiseDate, in: Date()..., displayedComponents: .date)
                        Button(L("Promise for this day")) { Task { await promiseFor(ServerDate.day(promiseDate)) } }
                        if promise?.userId == uid {
                            Button(L("Take it back"), role: .destructive) { Task { await promiseFor(nil) } }
                        }
                    } header: {
                        Text(L("I’ll do it"))
                    }
                }
                if me?.isMember ?? true, let uid = me?.userId {
                    OfferSection(api: api, task: full ?? task, me: uid, onChanged: onChanged)
                }
                if me?.claimsOn ?? true, me?.isMember ?? true, !task.isPrivate {
                    Section {
                        Toggle(isOn: Binding(get: { mine }, set: { v in Task { await claim(v) } })) {
                            VStack(alignment: .leading) {
                                Text(L("I keep it in mind"))
                                Text(task.assignee != nil && !mine ? LF("%@ keeps it in mind", task.assignee?.name ?? "") : L("So nobody else has to keep it in mind."))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                }
                if let log = full?.log, !log.isEmpty {
                    Section(L("History")) {
                        ForEach(log) { l in
                            Text([CareLabels.day(l.doneOn), l.actor, l.note].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.subheadline)
                        }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                Section {
                    Button { onDone(task) } label: { Label(L("Done"), systemImage: "checkmark") }
                    if task.nextDue != nil {
                        Button { addToCalendar = true } label: { Label(L("Add to calendar"), systemImage: "calendar.badge.plus") }
                    }
                    Button { onEdit(task) } label: { Label(L("Edit"), systemImage: "pencil") }
                    Button { Task { await split() } } label: {
                        Label(splitting ? L("Thinking …") : items.isEmpty ? L("Split into small steps") : L("Smaller steps"), systemImage: "sparkles")
                    }
                    .disabled(splitting)
                    NavigationLink { FocusView(api: api, taskId: task.id) } label: { Label(L("Focus on this"), systemImage: "scope") }
                    NavigationLink { LabelsView(api: api, kind: .care, preselect: task.id) } label: { Label(L("Label"), systemImage: "qrcode") }
                }
            }
            .themedList()
            .navigationTitle(task.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Close")) { dismiss() } } }
            .sheet(isPresented: $addToCalendar) { AddToCalendarView(task: full ?? task).ignoresSafeArea() }
            .task {
                mine = me?.userId != nil && task.assigneeUserId == me?.userId
                items = task.checklist ?? []
                promise = task.promise
                full = try? await api.careTask(task.id)
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func lead(_ n: Int) -> String {
        n == 0 ? L("on the day") : n == 1 ? L("1 day before") : LF("%d days before", n)
    }

    /// a sub-item ticked or unticked – the whole list goes back (web: same PATCH)
    /// "In kleine Schritte teilen" – AI if allowed, else built-in steps; saved as sub-items (focus.ts)
    private func split() async {
        splitting = true
        defer { splitting = false }
        do {
            let r = try await api.suggestSteps(taskId: task.id)
            let next = mergeSteps(items, r.steps)
            try await api.saveCareTask(id: task.id, ["checklist": next.map { ["text": $0.text, "done": $0.done] as [String: Any] }])
            items = next
            error = nil
            onChanged()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    /// "Mach ich – heute / morgen / am Wochenende / am …"; nil takes it back
    private func promiseFor(_ when: String?) async {
        do {
            try await api.carePromise(task.id, when)
            promise = (try? await api.careTask(task.id))?.promise
            error = nil
            Haptics.tick()
            onChanged()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func tick(_ i: Int, _ v: Bool) async {
        guard items.indices.contains(i) else { return }
        items[i].done = v
        do {
            try await api.saveCareTask(id: task.id, ["checklist": items.map { ["text": $0.text, "done": $0.done] as [String: Any] }])
            onChanged()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func claim(_ v: Bool) async {
        do {
            try await api.careClaim(task.id, v)
            mine = v
            onChanged()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// New or edit a task (web: Care.tsx TaskForm). Choosing a product to use up stays in the web app for now;
/// a product already set is shown and can be removed.
private struct CareTaskForm: View {
    let api: APIClient
    let target: CareFormTarget
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    /// interval | fixed | needed
    @State private var mode = "interval"
    @State private var category = "care"
    @State private var anchor = "done"
    @State private var privateTask = false
    @State private var doerKey: String?
    @State private var rotation: [String] = []
    @State private var people: [PersonDirEntry] = []
    @State private var items: [CareTask.CheckItem] = []
    @State private var newItem = ""
    @State private var n = 1
    @State private var unit = "month"
    @State private var lastDone: Date?
    @State private var nextDue: Date?
    /// Termin: a time makes it a calendar entry
    @State private var time: Date?
    @State private var duration = 60
    @State private var place = ""
    @State private var lead: Int?
    @State private var placeId: Int?
    @State private var productId: Int?
    @State private var note = ""
    @State private var places: [Place] = []
    @State private var busy = false
    @State private var error: String?
    @State private var confirmDelete = false

    private var isNew: Bool { target.task == nil }

    var body: some View {
        NavigationStack {
            Form {
                Section(L("What?")) {
                    TextField(L("e.g. Change water filter"), text: $name)
                }
                Section {
                    Picker(L("Area"), selection: $category) {
                        Text(L("Household")).tag("house")
                        Text(L("Care & deadlines")).tag("care")
                    }
                    .pickerStyle(.segmented)
                    Picker(L("How often"), selection: $mode) {
                        Text(L("Repeats")).tag("interval")
                        Text(L("Once / fixed date")).tag("fixed")
                        Text(L("When needed")).tag("needed")
                    }
                    .pickerStyle(.segmented)
                    if mode == "interval" {
                        Stepper(value: $n, in: 1...1000) { Text(LF("Every %d", n)) }
                        Picker(L("Unit"), selection: $unit) {
                            Text(L("days")).tag("day")
                            Text(L("weeks")).tag("week")
                            Text(L("months")).tag("month")
                            Text(L("years")).tag("year")
                        }
                        Picker(L("The next time counts from"), selection: $anchor) {
                            Text(L("when it was done")).tag("done")
                            Text(L("the planned day")).tag("due")
                        }
                        OptionalDate(title: L("Last done"), date: $lastDone)
                    }
                    if mode != "needed" {
                        OptionalDate(title: mode == "fixed" ? L("Date (e.g. expiry)") : L("Next due"), date: $nextDue)
                    }
                } footer: {
                    if mode == "fixed" { Text(L("Remind me before this date.")) }
                    else if mode == "interval" { Text(L("Leave empty if you don’t know – it starts from today.")) }
                }
                if mode != "needed" {
                    Section {
                        if let t = time {
                            HStack {
                                DatePicker(L("Time (optional)"), selection: Binding(get: { t }, set: { time = $0 }), displayedComponents: .hourAndMinute)
                                Button { time = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.ink3) }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(L("Remove"))
                            }
                            Picker(L("How long"), selection: $duration) {
                                ForEach(TaskTime.durations, id: \.self) { m in Text(TaskTime.duration(m)).tag(m) }
                            }
                        } else {
                            Button { time = Calendar.current.date(bySettingHour: 10, minute: 0, second: 0, of: Date()) } label: { LabeledContent(L("Time (optional)"), value: L("not set")) }
                                .foregroundStyle(Theme.ink)
                        }
                        TextField(L("Place (optional)"), text: $place, prompt: Text(L("e.g. basement, school, dentist")))
                    } footer: {
                        Text(nextDue == nil && time != nil ? L("Pick a date first.") : L("With a time it is an appointment and shows in your calendar."))
                    }
                }
                Section {
                    Toggle(isOn: $privateTask) {
                        VStack(alignment: .leading) {
                            Text(L("Only for me"))
                            Text(L("Nobody else sees it – not the household, not the assistant for others, not displays."))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    if !privateTask && people.count > 1 {
                        Toggle(isOn: Binding(get: { rotation.count > 1 }, set: { on in rotation = on ? people.prefix(2).map(\.key) : [] })) {
                            VStack(alignment: .leading) {
                                Text(L("Take turns"))
                                Text(L("“Done” passes it to the next one.")).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        if rotation.count > 1 {
                            FlowLayout(spacing: 6) {
                                ForEach(people) { p in
                                    ChoiceChip(title: p.name, on: rotation.contains(p.key)) {
                                        if rotation.contains(p.key) { rotation.removeAll { $0 == p.key } } else { rotation.append(p.key) }
                                    }
                                }
                            }
                            .padding(.vertical, 4)
                            .accessibilityLabel(L("Who takes turns"))
                        } else {
                            Picker(L("Who does it (optional)"), selection: $doerKey) {
                                Text(L("Whoever has time")).tag(String?.none)
                                ForEach(people) { p in Text(p.name).tag(String?.some(p.key)) }
                            }
                        }
                    }
                }
                Section(L("Sub-items (optional)")) {
                    ForEach(items.indices, id: \.self) { i in
                        Text(items[i].text)
                            .swipeActions { Button(role: .destructive) { items.remove(at: i) } label: { Label(L("Remove"), systemImage: "trash") } }
                    }
                    if !name.trimmingCharacters(in: .whitespaces).isEmpty {
                        Button {
                            Task {
                                if let r = try? await api.suggestSteps(name: name, note: note.isEmpty ? nil : note) { items = mergeSteps(items, r.steps) }
                            }
                        } label: { Label(L("Split into small steps"), systemImage: "sparkles") }
                    }
                    HStack {
                        TextField(L("e.g. sink, mirror, floor"), text: $newItem).submitLabel(.done).onSubmit { addItem() }
                        Button { addItem() } label: { Image(systemName: "plus.circle.fill") }
                            .disabled(newItem.trimmingCharacters(in: .whitespaces).isEmpty)
                            .accessibilityLabel(L("Add"))
                    }
                }
                Section {
                    Stepper(value: Binding(get: { lead ?? 0 }, set: { lead = $0 }), in: 0...365) {
                        LabeledContent(L("Remind me … days before"), value: lead.map { "\($0)" } ?? L("automatic"))
                    }
                    Picker(L("Where (optional)"), selection: $placeId) {
                        Text("—").tag(Int?.none)
                        ForEach(places.filter { $0.system != true }) { p in Text(p.path ?? p.name).tag(Int?.some(p.id)) }
                    }
                    TextField(L("e.g. contract number, notice period, filter type"), text: $note)
                }
                if let p = target.task?.product, productId != nil {
                    Section {
                        HStack {
                            Text(p.name)
                            Spacer()
                            Button(L("Remove"), role: .destructive) { productId = nil }
                        }
                    } header: { Text(L("Uses up a product (optional)")) } footer: {
                        Text(L("“Done” takes it from stock and puts it on the shopping list when none is left for next time."))
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                if !isNew { Section { Button(L("Delete"), role: .destructive) { confirmDelete = true } } }
            }
            .themedList()
            .navigationTitle(isNew ? L("New task") : L("Edit task"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || (mode == "fixed" && nextDue == nil && category != "house"))
                }
            }
            .confirmationDialog(LF("Delete “%@”?", name), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Delete"), role: .destructive) { Task { await remove() } }
            }
            .task {
                places = (try? await api.places()) ?? []
                people = ((try? await api.peopleDirectory()) ?? []).filter { $0.kind != "guest" }
            }
            .onAppear {
                if let t = target.task {
                    name = t.name
                    mode = t.asNeeded == true ? "needed" : t.intervalN == nil ? "fixed" : "interval"
                    category = t.category ?? "care"
                    anchor = t.anchor ?? "done"
                    privateTask = t.isPrivate
                    doerKey = t.doerKey
                    rotation = t.rotation ?? []
                    items = t.checklist ?? []
                    n = t.intervalN ?? 1
                    unit = t.intervalUnit ?? "month"
                    lastDone = ServerDate.parse(t.lastDone)
                    nextDue = ServerDate.parse(t.nextDue)
                    time = t.dueTime.flatMap { hhmm in
                        let p = hhmm.split(separator: ":").compactMap { Int($0) }
                        return p.count == 2 ? Calendar.current.date(bySettingHour: p[0], minute: p[1], second: 0, of: Date()) : nil
                    }
                    duration = t.durationMin ?? 60
                    place = t.place ?? ""
                    lead = t.leadDays
                    placeId = t.locationId
                    productId = t.productId
                    note = t.note ?? ""
                } else {
                    name = target.name ?? ""
                    category = target.category
                    privateTask = target.privateTask
                    mode = target.template != nil ? "fixed" : "interval"
                    if target.template == nil && category == "house" { unit = "week" }
                }
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var body: [String: Any] = [
            "name": String(name.trimmingCharacters(in: .whitespaces).prefix(120)),
            "interval_n": nul(mode == "interval" ? n : nil),
            "interval_unit": nul(mode == "interval" ? unit : nil),
            "as_needed": mode == "needed",
            "anchor": anchor,
            "category": category,
            "visibility": privateTask ? "private" : "household",
            // taking turns keeps whose turn it is; otherwise the chosen person
            "doer_key": nul(privateTask ? nil : rotation.count > 1 ? (rotation.contains(doerKey ?? "") ? doerKey : nil) : doerKey),
            "rotation": privateTask || rotation.count < 2 ? [String]() : rotation,
            "checklist": items.map { ["text": $0.text, "done": $0.done] as [String: Any] },
            "location_id": nul(placeId),
            "product_id": nul(productId),
            "note": nul(note.isEmpty ? nil : String(note.prefix(500))),
            "due_time": nul(mode != "needed" && nextDue != nil ? time.map { TaskTime.hhmm($0) } : nil),
            "duration_min": nul(mode != "needed" && nextDue != nil && time != nil ? duration : nil),
            "place": nul(place.trimmingCharacters(in: .whitespaces).isEmpty ? nil : String(place.trimmingCharacters(in: .whitespaces).prefix(120))),
        ]
        if let lead { body["lead_days"] = lead }
        let next = (mode == "needed" ? nil : nextDue).map { ServerDate.day($0) }
        let last = (mode == "interval" ? lastDone : nil).map { ServerDate.day($0) }
        if let t = target.task {
            // keep the dates unless they changed – the server recomputes the due date when the interval changes
            if next != t.nextDue.map({ String($0.prefix(10)) }) { body["next_due"] = nul(next) }
            if last != t.lastDone.map({ String($0.prefix(10)) }) { body["last_done"] = nul(last) }
        } else {
            body["template"] = nul(target.template)
            body["next_due"] = nul(next)
            body["last_done"] = nul(last)
        }
        do {
            try await api.saveCareTask(id: target.task?.id, body)
            onDone()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func addItem() {
        let s = newItem.trimmingCharacters(in: .whitespaces)
        guard !s.isEmpty, items.count < 30 else { return }
        items.append(.init(text: String(s.prefix(120)), done: false))
        newItem = ""
    }

    private func remove() async {
        guard let id = target.task?.id else { return }
        do {
            try await api.deleteCareTask(id)
            onDone()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// A date that may be empty: "–" with a button, or a DatePicker with "remove".
private struct OptionalDate: View {
    let title: String
    @Binding var date: Date?

    var body: some View {
        if let d = date {
            HStack {
                DatePicker(title, selection: Binding(get: { d }, set: { date = $0 }), displayedComponents: .date)
                Button { date = nil } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.ink3) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L("Remove"))
            }
        } else {
            Button { date = Date() } label: { LabeledContent(title, value: L("not set")) }
                .foregroundStyle(Theme.ink)
        }
    }
}

/// A task with a fixed date (passport): what is the new date? (web: Care.tsx NewDateSheet)
private struct CareNewDateSheet: View {
    let task: CareTask
    let onSave: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    DatePicker(L("New date"), selection: $date, displayedComponents: .date)
                } footer: {
                    Text(L("This one has a fixed date. What is the new date – e.g. the expiry date of the new passport?"))
                }
                Section {
                    Button(L("No new date")) { onSave(nil) }
                }
            }
            .themedList()
            .navigationTitle(task.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { onSave(ServerDate.day(date)) } }
            }
        }
        .presentationDetents([.medium])
    }
}

/// a JSON value or null
private func nul(_ v: Any?) -> Any { v ?? NSNull() }
