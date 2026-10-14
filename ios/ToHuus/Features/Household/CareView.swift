import SwiftUI

// Pflege & Fristen natively (web: pages/Care.tsx, server: routes/home.ts /api/care, lib/care.ts).
// Water filter, smoke detectors, descaling, tyres, passports: one tap when done, the next date is set by the server.

/// GET /api/care → { tasks, templates, users, today }
struct CareData: Decodable, Sendable {
    @Lossy var tasks: [CareTask]
    @Lossy var templates: [CareTemplate]
    var today: String?
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

    var isDueNow: Bool { ["overdue", "today", "soon"].contains(state ?? "") }

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
    var id: String { key }
}

/// POST /api/care/:id/done → { task, consumed, on_shopping_list }
struct CareDoneResult: Decodable, Sendable {
    var task: CareTask
    var onShoppingList: Bool?
}

extension APIClient {
    func care() async throws -> CareData { try await get("api/care") }
    func careTask(_ id: Int) async throws -> CareTask { try await get("api/care/\(id)") }
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
    func careClaim(_ id: Int, _ claim: Bool) async throws { _ = try await send("POST", "api/care/\(id)/claim", json: ["claim": claim], as: Ignored.self) }
}

enum CareLabels {
    static let groups: [(String, String)] = [
        ("kitchen", L("Kitchen")), ("house", L("House")), ("safety", L("Safety")), ("car", L("Car & bike")), ("papers", L("Papers & contracts")),
    ]

    /// template names come in English from the server (server/lib/care.ts CARE_TEMPLATES) – literal here so the
    /// string catalogue has them
    static func templateName(_ name: String) -> String {
        let known: [String: String] = [
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

    static func icon(_ template: String?) -> String {
        switch template ?? "" {
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
        default: return "wrench.and.screwdriver"
        }
    }

    static func interval(_ n: Int?, _ unit: String?) -> String {
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
        guard t.state != "none", let next = t.nextDue else { return L("no date") }
        let d = t.days ?? 0
        switch t.state {
        case "overdue": return d == -1 ? L("1 day overdue") : LF("%d days overdue", -d)
        case "today": return L("due today")
        default:
            if d == 1 { return L("due tomorrow") }
            if t.state == "soon" { return LF("due in %d days", d) }
            guard let date = ServerDate.parse(next) else { return next }
            let s = d > 300 ? date.formatted(.dateTime.month(.abbreviated).year()) : date.formatted(.dateTime.day().month(.abbreviated))
            return LF("next: %@", s)
        }
    }

    static func color(_ state: String?) -> Color {
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

/// Mehr › Pflege & Fristen: due and later tasks, one-tap templates, detail with history and "Ich kümmere mich",
/// editing. Labels and the printable ticket stay in the web app (QR labels page).
struct CareView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var data: CareData?
    @State private var error: String?
    @State private var showTemplates = false
    @State private var form: CareFormTarget?
    @State private var detail: CareTask?
    @State private var askDate: CareTask?
    @State private var toast: ToastMessage?
    @State private var me: MeLite?

    var body: some View {
        List {
            Section {
                Text(L("Water filter, smoke detectors, descaling, tyres, passports: the things nobody keeps in their head. One tap when done – the next date is set automatically."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let error { Section { ErrorBanner(message: error) { Task { await load() } } }.listRowBackground(Color.clear) }
            if let data {
                let due = data.tasks.filter(\.isDueNow)
                let later = data.tasks.filter { !$0.isDueNow }
                if data.tasks.isEmpty {
                    EmptyStateView(systemImage: "wrench.and.screwdriver", title: L("No tasks yet"),
                                   message: L("Pick a few from the suggestions below – one tap each. You can adjust the interval later."), art: .calendar)
                        .listRowBackground(Color.clear)
                }
                if !due.isEmpty { Section(L("Due")) { ForEach(due) { row($0) } } }
                if !later.isEmpty { Section(L("Later")) { ForEach(later) { row($0) } } }
                templates(data)
            } else if error == nil {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            }
            Section {
                NavigationLink { WebPageView(api: api, path: "/etiketten?kind=care", title: L("Labels")) } label: { Label(L("Labels"), systemImage: "qrcode") }
            }
        }
        .themedList()
        .navigationTitle(L("Home & care"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { form = CareFormTarget(task: nil, template: nil, name: nil) } label: { Image(systemName: "plus") }
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
            Image(systemName: CareLabels.icon(t.template))
                .foregroundStyle(CareLabels.color(t.state))
                .frame(width: 32, height: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(t.name).foregroundStyle(Theme.ink)
                let sub = [CareLabels.interval(t.intervalN, t.intervalUnit),
                           t.product.map { LF("%@: %@ in stock", $0.name, Self.qty($0.stock ?? 0)) },
                           t.location?.name].compactMap { $0 }
                (Text(CareLabels.due(t)).foregroundStyle(CareLabels.color(t.state)) + Text(" · " + sub.joined(separator: " · ")).foregroundStyle(Theme.ink3))
                    .font(.caption)
            }
            Spacer(minLength: 4)
            if let a = t.assignee {
                Text(String(a.name.prefix(1))).font(.caption.weight(.semibold)).foregroundStyle(Theme.onPrimary)
                    .frame(width: 24, height: 24).background(Theme.sage, in: Circle())
                    .accessibilityLabel(LF("%@ takes care of it", a.name))
            }
            Button { done(t) } label: { Label(L("Done"), systemImage: "checkmark").labelStyle(.titleAndIcon).font(.caption.weight(.semibold)) }
                .buttonStyle(.bordered)
                .tint(t.state == "overdue" || t.state == "today" ? Theme.primary : Theme.ink2)
                .frame(minHeight: 44)
        }
        .contentShape(Rectangle())
        .onTapGesture { detail = t }
        .accessibilityAction(named: L("Details")) { detail = t }
    }

    @ViewBuilder
    private func templates(_ data: CareData) -> some View {
        let free = data.templates.filter { $0.added != true }
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
                                        Image(systemName: CareLabels.icon(x.key)).frame(width: 28).accessibilityHidden(true)
                                        VStack(alignment: .leading) {
                                            Text(CareLabels.templateName(x.name)).foregroundStyle(Theme.ink)
                                            Text(CareLabels.interval(x.n, x.unit)).font(.caption).foregroundStyle(Theme.ink3)
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
        } catch APIError.notFound {
            error = L("Your server doesn't have this section yet.")
        } catch { self.error = APIError.from(error).localizedDescription }
        if me == nil { me = try? await api.meLite() }
    }

    private func add(_ x: CareTemplate) async {
        // a template without interval (passport) needs its date first
        guard x.n != nil else {
            form = CareFormTarget(task: nil, template: x.key, name: CareLabels.templateName(x.name))
            return
        }
        do {
            try await api.addCareTemplate(x.key)
            toast = ToastMessage(text: LF("“%@” added", CareLabels.templateName(x.name)))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    /// one tap with undo; a fixed-date task (passport) asks first
    private func done(_ t: CareTask) {
        if t.intervalN == nil { askDate = t } else { Task { await finish(t, nextDue: nil) } }
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

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent(L("Status")) { Text(CareLabels.due(task)).foregroundStyle(CareLabels.color(task.state)) }
                    LabeledContent(L("Repeats"), value: CareLabels.interval(task.intervalN, task.intervalUnit))
                    if let l = task.location { LabeledContent(L("Where"), value: l.name) }
                    LabeledContent(L("Next due"), value: CareLabels.day(task.nextDue, long: true))
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
                if me?.claimsOn ?? true, me?.isMember ?? true {
                    Section {
                        Toggle(isOn: Binding(get: { mine }, set: { v in Task { await claim(v) } })) {
                            VStack(alignment: .leading) {
                                Text(L("I’ll take care of it"))
                                Text(task.assignee != nil && !mine ? LF("%@ takes care of it", task.assignee?.name ?? "") : L("So nobody else has to keep it in mind."))
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
                    Button { onEdit(task) } label: { Label(L("Edit"), systemImage: "pencil") }
                    NavigationLink { WebPageView(api: api, path: "/etiketten?kind=care&id=\(task.id)", title: L("Label")) } label: { Label(L("Label"), systemImage: "qrcode") }
                }
            }
            .themedList()
            .navigationTitle(task.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Close")) { dismiss() } } }
            .task {
                mine = me?.userId != nil && task.assigneeUserId == me?.userId
                full = try? await api.careTask(task.id)
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func lead(_ n: Int) -> String {
        n == 0 ? L("on the day") : n == 1 ? L("1 day before") : LF("%d days before", n)
    }

    private func claim(_ v: Bool) async {
        do {
            try await api.careClaim(task.id, v)
            mine = v
            onChanged()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// New or edit a care task (web: Care.tsx TaskForm). Choosing a product to use up stays in the web app for now;
/// a product already set is shown and can be removed.
private struct CareTaskForm: View {
    let api: APIClient
    let target: CareFormTarget
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var fixed = false
    @State private var n = 1
    @State private var unit = "month"
    @State private var lastDone: Date?
    @State private var nextDue: Date?
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
                    Picker(L("Kind"), selection: $fixed) {
                        Text(L("Repeats")).tag(false)
                        Text(L("Fixed date")).tag(true)
                    }
                    .pickerStyle(.segmented)
                    if !fixed {
                        Stepper(value: $n, in: 1...1000) { Text(LF("Every %d", n)) }
                        Picker(L("Unit"), selection: $unit) {
                            Text(L("days")).tag("day")
                            Text(L("weeks")).tag("week")
                            Text(L("months")).tag("month")
                            Text(L("years")).tag("year")
                        }
                        OptionalDate(title: L("Last done"), date: $lastDone)
                    }
                    OptionalDate(title: fixed ? L("Date (e.g. expiry)") : L("Next due"), date: $nextDue)
                } footer: {
                    Text(fixed ? L("Remind me before this date.") : L("Leave empty if you don’t know – it starts from today."))
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
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || (fixed && nextDue == nil))
                }
            }
            .confirmationDialog(LF("Delete “%@”?", name), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Delete"), role: .destructive) { Task { await remove() } }
            }
            .task {
                places = (try? await api.places()) ?? []
            }
            .onAppear {
                if let t = target.task {
                    name = t.name
                    fixed = t.intervalN == nil
                    n = t.intervalN ?? 1
                    unit = t.intervalUnit ?? "month"
                    lastDone = ServerDate.parse(t.lastDone)
                    nextDue = ServerDate.parse(t.nextDue)
                    lead = t.leadDays
                    placeId = t.locationId
                    productId = t.productId
                    note = t.note ?? ""
                } else {
                    name = target.name ?? ""
                    fixed = target.template != nil
                }
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var body: [String: Any] = [
            "name": String(name.trimmingCharacters(in: .whitespaces).prefix(120)),
            "interval_n": nul(fixed ? nil : n),
            "interval_unit": nul(fixed ? nil : unit),
            "location_id": nul(placeId),
            "product_id": nul(productId),
            "note": nul(note.isEmpty ? nil : String(note.prefix(500))),
        ]
        if let lead { body["lead_days"] = lead }
        let next = nextDue.map { ServerDate.day($0) }
        let last = (fixed ? nil : lastDone).map { ServerDate.day($0) }
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
