import SwiftUI

// Für wen ich da bin (server: lib/carefor.ts, docs/carefor.md).
// Looking after someone – at home, in their own flat, in a care home; visits, calls, doctor appointments,
// prescriptions. Work that rarely shows anywhere gets room here, and it gets seen. Private by default (health data,
// Art. 9 GDPR): sharing with the household is one tap. Never to the assistant, MCP, Home Assistant, widgets, exports
// or share cards with the name. ToHuus doesn't advise – it points to where advice is.

struct CareForData: Decodable, Sendable {
    struct Help: Decodable, Sendable, Hashable, Identifiable {
        var key: String
        var title: String
        var url: String
        var id: String { key }
    }
    @Lossy var people: [CareForPerson]
    @Lossy var help: [Help]
}

struct CareForPerson: Decodable, Sendable, Hashable, Identifiable {
    struct Log: Decodable, Sendable, Hashable, Identifiable {
        var id: Int
        var userId: Int?
        var by: String?
        var mine: Bool = false
        var day: String
        /// visit | call | appointment | errand | other
        var kind: String
        var note: String?
    }
    var id: Int
    var name: String
    var relation: String?
    /// home | own | care_home | other
    var place: String
    /// private | household
    var visibility: String
    /// I added them – only I can change or remove them
    var mine: Bool = false
    /// who added them
    var owner: String?
    @Lossy var tasks: [CareTask]
    @Lossy var recent: [Log]
    var thisWeek: Int?

    var isPrivate: Bool { visibility == "private" }
}

struct CareForHintState: Decodable, Sendable {
    var show: Bool
    /// form | words
    var why: String?
}

struct CareForCreated: Decodable, Sendable { var id: Int }
struct CareForLogged: Decodable, Sendable { var ok: Bool?; var message: String? }

extension APIClient {
    /// GET /api/carefor – the people I look after (and those shared with the household), their tasks, recent visits, help
    func careFor() async throws -> CareForData { try await get("api/carefor") }
    /// POST /api/carefor { name, relation, place, visibility } → { id }
    func careForAdd(_ body: [String: Any]) async throws -> CareForCreated { try await send("POST", "api/carefor", json: body) }
    /// PATCH /api/carefor/:id – the same fields plus archived (only the person who added them)
    func careForUpdate(_ id: Int, _ body: [String: Any]) async throws { _ = try await send("PATCH", "api/carefor/\(id)", json: body, as: Ignored.self) }
    func careForDelete(_ id: Int) async throws { _ = try await send("DELETE", "api/carefor/\(id)", as: Ignored.self) }
    /// POST /api/carefor/:id/log { kind, note } – "Heute da gewesen"
    func careForLog(_ id: Int, kind: String, note: String? = nil) async throws -> CareForLogged {
        var body: [String: Any] = ["kind": kind]
        if let note, !note.isEmpty { body["note"] = note }
        return try await send("POST", "api/carefor/\(id)/log", json: body)
    }
    /// DELETE /api/carefor/log/:id – my own entries
    func careForLogDelete(_ logId: Int) async throws { _ = try await send("DELETE", "api/carefor/log/\(logId)", as: Ignored.self) }
    /// POST /api/carefor/:id/tasks { name, interval_n, interval_unit, next_due } – private when the person is
    func careForAddTask(_ id: Int, _ body: [String: Any]) async throws { _ = try await send("POST", "api/carefor/\(id)/tasks", json: body, as: Ignored.self) }
    /// GET /api/carefor/hint – "Kümmerst du dich um jemanden?" (once, dismissible)
    func careForHint() async throws -> CareForHintState { try await get("api/carefor/hint") }
    func careForHintDismiss() async throws { _ = try await send("POST", "api/carefor/hint/dismiss", json: [:], as: Ignored.self) }
}

enum CareForLabels {
    static let places = ["home", "own", "care_home", "other"]
    static let kinds = ["visit", "call", "appointment", "errand", "other"]

    static func place(_ p: String) -> String {
        switch p {
        case "home": return L("lives with us")
        case "care_home": return L("care home")
        case "other": return L("elsewhere")
        default: return L("own flat")
        }
    }

    static func kind(_ k: String) -> String {
        switch k {
        case "call": return L("Called")
        case "appointment": return L("Appointment")
        case "errand": return L("Errand")
        case "other": return L("Something else")
        default: return L("Visit")
        }
    }

    static func kindIcon(_ k: String) -> String {
        switch k {
        case "call": return "phone"
        case "appointment": return "stethoscope"
        case "errand": return "bag"
        case "other": return "ellipsis.circle"
        default: return "figure.walk"
        }
    }
}

/// Aufgaben › "Für wen ich da bin"
struct CareForView: View {
    let api: APIClient
    @State private var data: CareForData?
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var edit: CareForEditTarget?
    @State private var newTask: CareForPerson?

    var body: some View {
        List {
            Section {
                Text(L("Visits, calls, the GP appointment, the prescription: being there for someone is work – and it counts. Here it gets room."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let error { Section { ErrorBanner(message: error) { Task { await load() } } }.listRowBackground(Color.clear) }
            if let d = data {
                if d.people.isEmpty {
                    EmptyStateView(systemImage: "heart", title: L("Nobody here yet"),
                                   message: L("Add someone you look after – a parent, a grandparent, a neighbour. Only you see them unless you share them."),
                                   actionTitle: L("Add someone")) { edit = CareForEditTarget(person: nil) }
                        .listRowBackground(Color.clear)
                }
                ForEach(d.people) { p in personSection(p) }
                if !d.help.isEmpty {
                    Section {
                        ForEach(d.help) { h in
                            if let url = URL(string: h.url) {
                                Link(destination: url) {
                                    HStack(alignment: .top, spacing: Theme.Space.s3) {
                                        Image(systemName: "arrow.up.right.square").foregroundStyle(Theme.primaryText).accessibilityHidden(true)
                                        Text(h.title).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                                    }
                                    .frame(minHeight: 44, alignment: .leading)
                                }
                            }
                        }
                    } header: {
                        Text(L("Help you’re entitled to"))
                    } footer: {
                        Text(L("Links to official pages. ToHuus doesn’t advise – it shows where to get advice."))
                    }
                }
                FactCard(api: api, topic: "care", inList: true)
                Section {} footer: {
                    Text(L("Never to the assistant, Home Assistant, widgets or exports. Private people and their tasks are only for you."))
                }
            } else if error == nil {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            }
        }
        .themedList()
        .navigationTitle(L("Who I’m there for"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { edit = CareForEditTarget(person: nil) } label: { Image(systemName: "plus") }
                    .accessibilityLabel(L("Add someone"))
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $edit) { e in
            CareForEditSheet(api: api, person: e.person) { msg in
                if let msg { toast = ToastMessage(text: msg) }
                Task { await load() }
            }
        }
        .sheet(item: $newTask) { p in
            CareForTaskSheet(api: api, person: p) { msg in
                toast = ToastMessage(text: msg)
                Task { await load() }
            }
        }
        .toast($toast)
    }

    @ViewBuilder private func personSection(_ p: CareForPerson) -> some View {
        Section {
            HStack(alignment: .top, spacing: Theme.Space.s3) {
                Image(systemName: "heart.circle").font(.title2).foregroundStyle(Theme.clay).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.name).font(.headline).foregroundStyle(Theme.ink)
                    Text(([p.relation].compactMap { $0 }.filter { !$0.isEmpty } + [CareForLabels.place(p.place)]).joined(separator: " · "))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                    Label(p.isPrivate ? L("Only for you") : L("Shared with the household"), systemImage: p.isPrivate ? "lock.fill" : "person.2")
                        .font(.caption).foregroundStyle(Theme.ink3)
                    if !p.mine, let owner = p.owner { Text(LF("added by %@", owner)).font(.caption).foregroundStyle(Theme.ink3) }
                }
                Spacer(minLength: 0)
                if p.mine {
                    Button { edit = CareForEditTarget(person: p) } label: { Image(systemName: "pencil").tapTarget() }
                        .buttonStyle(.plain)
                        .foregroundStyle(Theme.primaryText)
                        .accessibilityLabel(LF("Edit %@", p.name))
                }
            }
            .accessibilityElement(children: .contain)
            if let n = p.thisWeek, n > 0 {
                Text(n == 1 ? L("There once this week – that’s work, and it counts.") : LF("There %d times this week – that’s work, and it counts.", n))
                    .font(.footnote.weight(.semibold)).foregroundStyle(Theme.primaryText)
            }
            Menu {
                ForEach(CareForLabels.kinds, id: \.self) { k in
                    Button(CareForLabels.kind(k), systemImage: CareForLabels.kindIcon(k)) { Task { await log(p, kind: k) } }
                }
            } label: {
                Label(L("Was there today"), systemImage: "checkmark.circle")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .foregroundStyle(Theme.primaryText)
            .accessibilityHint(L("Pick what it was: visit, call, appointment, errand or something else."))
            ForEach(p.tasks) { t in taskRow(t) }
            Button { newTask = p } label: {
                Label(LF("Task for %@", p.name), systemImage: "plus")
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .foregroundStyle(Theme.primaryText)
            if !p.recent.isEmpty {
                ForEach(p.recent.prefix(5)) { l in logRow(l) }
            }
        } header: {
            Text(p.name)
        }
    }

    private func taskRow(_ t: CareTask) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: CareLabels.icon(t.template, category: t.category)).foregroundStyle(CareLabels.color(t.state))
                .frame(width: 28).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(t.name).foregroundStyle(Theme.ink)
                Text([CareLabels.due(t), t.asNeeded == true ? nil : CareLabels.interval(t.intervalN, t.intervalUnit)].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(CareLabels.color(t.state))
            }
            Spacer(minLength: 4)
            Button { Task { await done(t) } } label: {
                Label(L("Done"), systemImage: "checkmark").font(.caption.weight(.semibold)).frame(minHeight: 32)
            }
            .buttonStyle(.bordered)
            .tint(t.isDueNow ? Theme.primary : Theme.ink2)
            .accessibilityLabel(LF("“%@” done", t.name))
        }
        .padding(.vertical, 2)
    }

    private func logRow(_ l: CareForPerson.Log) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            Image(systemName: CareForLabels.kindIcon(l.kind)).foregroundStyle(Theme.ink3).frame(width: 28).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text([CareLabels.day(l.day), CareForLabels.kind(l.kind)].joined(separator: " · ")).font(.subheadline).foregroundStyle(Theme.ink2)
                Text([l.note, l.mine ? nil : l.by].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
        }
        .accessibilityElement(children: .combine)
        .swipeActions {
            if l.mine {
                Button(role: .destructive) { Task { await deleteLog(l) } } label: { Label(L("Delete"), systemImage: "trash") }
            }
        }
    }

    private func load() async {
        do {
            data = try await api.careFor()
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func log(_ p: CareForPerson, kind: String) async {
        do {
            let r = try await api.careForLog(p.id, kind: kind)
            Haptics.success()
            toast = ToastMessage(text: r.message ?? L("Seen. That’s work – and it counts."))
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func deleteLog(_ l: CareForPerson.Log) async {
        do {
            try await api.careForLogDelete(l.id)
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func done(_ t: CareTask) async {
        do {
            let r = try await api.careDone(t.id)
            toast = ToastMessage(text: r.task.nextDue.map { LF("Done. Next time: %@", CareLabels.day($0)) } ?? L("Done."), actionTitle: L("Undo")) {
                Task {
                    try? await api.careUndo(t.id)
                    await load()
                }
            }
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

struct CareForEditTarget: Identifiable {
    var person: CareForPerson?
    let id = UUID()
}

/// Add or change someone I look after. Private by default; only the person who added them can change them.
struct CareForEditSheet: View {
    let api: APIClient
    let person: CareForPerson?
    var onSaved: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var relation = ""
    @State private var place = "own"
    @State private var shared = false
    @State private var busy = false
    @State private var error: String?
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("Name, e.g. Grandma or Mr Berg"), text: $name)
                        .textContentType(.name)
                    TextField(L("How you’re related (optional), e.g. my mother"), text: $relation)
                } footer: {
                    Text(L("A first name or what you call them is enough."))
                }
                Section(L("Where do they live?")) {
                    Picker(L("Where do they live?"), selection: $place) {
                        ForEach(CareForLabels.places, id: \.self) { p in Text(CareForLabels.place(p)).tag(p) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section {
                    Toggle(L("Share with the household"), isOn: $shared).tint(Theme.primary)
                } footer: {
                    Text(shared ? L("Everyone at home sees them, their tasks and the visits – so you can share the work.")
                                : L("Only you see them and their tasks. This is health data – it stays private unless you share it."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                if person != nil {
                    Section {
                        Button(L("Remove"), role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .navigationTitle(person == nil ? L("Add someone") : L("Edit"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog(LF("Remove %@?", person?.name ?? ""), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Remove"), role: .destructive) { Task { await remove() } }
            } message: {
                Text(L("Their visits are removed too. Their tasks stay as normal tasks."))
            }
            .onAppear {
                if let p = person {
                    name = p.name
                    relation = p.relation ?? ""
                    place = p.place
                    shared = !p.isPrivate
                }
            }
        }
    }

    private var payload: [String: Any] {
        let rel = relation.trimmingCharacters(in: .whitespacesAndNewlines)
        return ["name": name.trimmingCharacters(in: .whitespacesAndNewlines),
                "relation": rel.isEmpty ? NSNull() as Any : rel as Any,
                "place": place,
                "visibility": shared ? "household" : "private"]
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            if let p = person {
                try await api.careForUpdate(p.id, payload)
                onSaved(L("Saved"))
            } else {
                _ = try await api.careForAdd(payload)
                onSaved(LF("%@ is here now. Thank you for being there.", name.trimmingCharacters(in: .whitespacesAndNewlines)))
            }
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func remove() async {
        guard let p = person else { return }
        do {
            try await api.careForDelete(p.id)
            onSaved(nil)
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// "Aufgabe für Oma Ilse": a visit every Sunday, the GP appointment, picking up the prescription. Private if they are.
struct CareForTaskSheet: View {
    let api: APIClient
    let person: CareForPerson
    var onSaved: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var repeats = false
    @State private var n = 1
    @State private var unit = "week"
    @State private var date = Date()
    @State private var busy = false
    @State private var error: String?

    private let units: [(String, String)] = [("day", L("days")), ("week", L("weeks")), ("month", L("months")), ("year", L("years"))]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("e.g. Visit, GP appointment, pick up prescription"), text: $name)
                }
                Section {
                    Toggle(L("Repeats"), isOn: $repeats).tint(Theme.primary)
                    if repeats {
                        Stepper(value: $n, in: 1...365) { Text(LF("every %d", n)) }
                        Picker(L("Unit"), selection: $unit) {
                            ForEach(units.indices, id: \.self) { i in Text(units[i].1).tag(units[i].0) }
                        }
                        .pickerStyle(.segmented)
                        DatePicker(L("First time"), selection: $date, displayedComponents: .date)
                    } else {
                        DatePicker(L("On"), selection: $date, displayedComponents: .date)
                    }
                } footer: {
                    Text(person.isPrivate ? L("Only for you, like the person it’s for.") : L("For the household, like the person it’s for."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .navigationTitle(LF("Task for %@", person.name))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Add")) { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var body: [String: Any] = ["name": String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120)), "next_due": ServerDate.day(date)]
        if repeats {
            body["interval_n"] = n
            body["interval_unit"] = unit
        }
        do {
            try await api.careForAddTask(person.id, body)
            onSaved(LF("“%@” added", name.trimmingCharacters(in: .whitespacesAndNewlines)))
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// Aufgaben and Heute: "Kümmerst du dich um jemanden?" – once, when the household form or the person's own tasks and
/// thoughts suggest it. Nothing is created by itself.
struct CareForHintCard: View {
    let api: APIClient
    var refresh: Int = 0
    /// inside a List (Aufgaben) or on Heute's scroll view
    var inList = false
    var onAdded: (String) -> Void = { _ in }
    @State private var show = false
    @State private var adding = false
    @State private var error: String?

    var body: some View {
        Group {
            if show {
                if inList { Section { content } } else { Card { content } }
            }
        }
        .task(id: refresh) { show = (try? await api.careForHint())?.show ?? false }
        .sheet(isPresented: $adding) {
            CareForEditSheet(api: api, person: nil) { msg in
                show = false
                if let msg { onAdded(msg) }
            }
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            HStack(alignment: .top, spacing: Theme.Space.s3) {
                Image(systemName: "heart.circle").font(.title2).foregroundStyle(Theme.clay).accessibilityHidden(true)
                Text(L("Are you looking after someone? That’s work – give it room here."))
                    .font(.subheadline).foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: Theme.Space.s3) {
                Button { adding = true } label: { Text(L("Yes, add them")).frame(minHeight: 32) }
                    .buttonStyle(.borderedProminent).tint(Theme.primary)
                Button { Task { await dismissHint() } } label: { Text(L("No thanks")).frame(minHeight: 32) }
                    .buttonStyle(.bordered)
            }
            if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
        }
        .padding(.vertical, inList ? 4 : 0)
    }

    private func dismissHint() async {
        do {
            try await api.careForHintDismiss()
            show = false
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// Aufgaben › a row to "Für wen ich da bin"
struct CareForLink: View {
    let api: APIClient
    var body: some View {
        NavigationLink { CareForView(api: api) } label: {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Who I’m there for"))
                    Text(L("Looking after someone – visits, appointments, prescriptions. It’s work, and it counts.")).font(.caption).foregroundStyle(Theme.ink3)
                }
            } icon: { Image(systemName: "heart.circle").foregroundStyle(Theme.clay) }
        }
    }
}

/// "Du machst das seit Wochen" – only the person who did a task the last 6 times sees it: first a thank-you, then the
/// offer to hand it over. One tap dismisses it for good. Never shown to the others, never a comparison.
struct CarryingSection: View {
    let api: APIClient
    let refresh: Int
    /// opens the task's detail, where "Abgeben an …" lives
    var onHandOver: (Int) -> Void
    @State private var items: [WhoDoesWhatData.Carrying] = []
    @State private var error: String?

    var body: some View {
        Group {
            if !items.isEmpty {
                Section {
                    ForEach(items) { c in
                        VStack(alignment: .leading, spacing: Theme.Space.s2) {
                            HStack(alignment: .top, spacing: Theme.Space.s3) {
                                Image(systemName: "heart").foregroundStyle(Theme.clay).accessibilityHidden(true)
                                Text(LF("You’ve been doing “%@” for weeks – thank you! Would you like to hand it over for a while?", c.name))
                                    .font(.subheadline).foregroundStyle(Theme.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            HStack(spacing: Theme.Space.s3) {
                                Button { onHandOver(c.taskId) } label: { Text(L("Hand over …")).frame(minHeight: 32) }
                                    .buttonStyle(.borderedProminent).tint(Theme.primary)
                                Button { Task { await dismiss(c) } } label: { Text(L("It’s fine")).frame(minHeight: 32) }
                                    .buttonStyle(.bordered)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
                } footer: {
                    Text(L("Only you see this."))
                }
            }
        }
        .task(id: refresh) { items = (try? await api.whoDoesWhat())?.carrying ?? [] }
    }

    private func dismiss(_ c: WhoDoesWhatData.Carrying) async {
        do {
            try await api.habitCarryingDismiss(c.taskId)
            items.removeAll { $0.taskId == c.taskId }
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
