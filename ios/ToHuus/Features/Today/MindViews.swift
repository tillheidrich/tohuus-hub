import SwiftUI

// Im Kopf (server: lib/mind.ts, docs/mind.md, web: pages/Mind.tsx).
// What a person carries around without it being a task, and what they did on the side without writing it down –
// so it gets seen. Private or for everyone, switchable any time; a household entry can be hidden from single members
// (a present for them). "Ich denk mit" / "Danke" show names, never counts. Never to the assistant, MCP, Home Assistant,
// notifications, widgets or exports.

struct MindItem: Decodable, Sendable, Identifiable, Hashable {
    struct Person: Decodable, Sendable, Hashable { var id: Int; var name: String; var color: String? }
    struct Nod: Decodable, Sendable, Hashable { var id: Int; var name: String }
    var id: Int
    var text: String
    /// open (im Kopf) | done (nebenbei erledigt)
    var kind: String
    var mine: Bool = false
    var by: Person?
    /// someone else did it, the author wrote it down ("Danke, Mira!")
    var doneBy: Person?
    /// it's about me: someone wrote down that I did it
    var aboutMe: Bool = false
    /// private | household
    var visibility: String
    var hideFrom: [Int] = []
    @Lossy var nods: [Nod]
    var nodded: Bool = false
    var doneAt: String?
    var createdAt: String?
    /// "bis wann?" (YYYY-MM-DD) – only shown, never a reminder
    var dueOn: String?
}

struct MindData: Decodable, Sendable {
    struct Part: Decodable, Sendable { @Lossy var open: [MindItem]; @Lossy var done: [MindItem] }
    struct Member: Decodable, Sendable, Hashable, Identifiable { var id: Int; var name: String }
    var mine: Part
    var others: Part
    @Lossy var members: [Member]
    /// how many of my older thoughts "Was davon ist noch wichtig?" would ask about
    var review: Int?
}

/// GET /api/mind/review – my open thoughts older than a week, not looked at for two weeks (at most ten, oldest first)
struct MindReview: Decodable, Sendable {
    @Lossy var items: [MindItem]
}

extension APIClient {
    /// GET /api/mind – mine (open + done in the last two weeks) and what the others shared with me
    func mind() async throws -> MindData { try await get("api/mind") }
    /// POST /api/mind { text, kind, visibility, hide_from, done_by } – done_by: a member who did it (only for done)
    /// many: one thought per line (brain dump, at most 20); dueOn: "bis wann?" for open thoughts (YYYY-MM-DD)
    func mindAdd(text: String, kind: String, isPrivate: Bool, hideFrom: [Int], doneBy: Int? = nil, many: Bool = false, dueOn: String? = nil) async throws {
        var body: [String: Any] = ["text": text, "kind": kind, "visibility": isPrivate ? "private" : "household", "hide_from": isPrivate ? [] : hideFrom]
        if kind == "done", let doneBy { body["done_by"] = doneBy }
        if many { body["many"] = true }
        if kind == "open", let dueOn { body["due_on"] = dueOn }
        _ = try await send("POST", "api/mind", json: body, as: Ignored.self)
    }
    /// GET /api/mind/review – "Was davon ist noch wichtig?"
    func mindReview() async throws -> MindReview { try await get("api/mind/review") }
    /// POST /api/mind/:id/keep – "Noch wichtig": stays, not asked about again for two weeks
    func mindKeep(_ id: Int) async throws { _ = try await send("POST", "api/mind/\(id)/keep", json: [:], as: Ignored.self) }
    /// PATCH /api/mind/:id – kind (open → done), visibility (either way), hide_from
    func mindUpdate(_ id: Int, _ body: [String: Any]) async throws {
        _ = try await send("PATCH", "api/mind/\(id)", json: body, as: Ignored.self)
    }
    func mindDelete(_ id: Int) async throws { _ = try await send("DELETE", "api/mind/\(id)", as: Ignored.self) }
    /// POST /api/mind/:id/nod – "Ich denk mit" / "Danke" (tap again to take it back)
    func mindNod(_ id: Int) async throws { _ = try await send("POST", "api/mind/\(id)/nod", json: [:], as: Ignored.self) }
    /// POST /api/mind/:id/task – a thought becomes a task (private stays private)
    func mindToTask(_ id: Int) async throws { _ = try await send("POST", "api/mind/\(id)/task", json: [:], as: Ignored.self) }
}

/// Write down what's on your mind – or what you just did on the side.
struct MindComposer: View {
    let api: APIClient
    let members: [MindData.Member]
    var onSaved: (String) -> Void = { _ in }
    @State private var text = ""
    @State private var kind = "open"
    @State private var isPrivate = false
    @State private var hide: Set<Int> = []
    /// "Wer hat's gemacht?" – nil = me
    @State private var doneBy: Int?
    @State private var busy = false
    @State private var error: String?
    /// "Mehrere auf einmal": one thought per line (brain dump)
    @State private var many = false
    /// "Bis wann?" – off = "Irgendwann"
    @State private var hasDue = false
    @State private var due = Date().addingTimeInterval(86_400)

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Picker(L("What is it?"), selection: $kind) {
                Text(L("On my mind")).tag("open")
                Text(L("Done on the side")).tag("done")
            }
            .pickerStyle(.segmented)
            if many {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    ZStack(alignment: .topLeading) {
                        if text.isEmpty {
                            Text(L("One thought per line"))
                                .foregroundStyle(Theme.ink3)
                                .padding(.horizontal, 5).padding(.vertical, 8)
                                .accessibilityHidden(true)
                        }
                        TextEditor(text: $text)
                            .frame(minHeight: 110)
                            .scrollContentBackground(.hidden)
                            .accessibilityLabel(L("One thought per line"))
                    }
                    .padding(4)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
                    Button(lineCount > 1 ? LF("Add %d", lineCount) : L("Add")) { Task { await save() } }
                        .buttonStyle(.borderedProminent).tint(Theme.primary)
                        .frame(minHeight: 44)
                        .disabled(busy || lineCount == 0)
                }
            } else {
                HStack(spacing: Theme.Space.s2) {
                    TextField(kind == "done" ? L("e.g. Called the paediatrician, thought of Grandma’s birthday") : L("e.g. What do we eat on Saturday when Sam is out?"), text: $text, axis: .vertical)
                        .lineLimit(1...3)
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.done)
                        .onSubmit { Task { await save() } }
                    Button(L("Add")) { Task { await save() } }
                        .buttonStyle(.borderedProminent).tint(Theme.primary)
                        .disabled(busy || text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            Toggle(isOn: $many) {
                Text(L("Several at once")).font(.subheadline)
            }
            .tint(Theme.primary)
            if kind == "open" {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("By when?")).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                    FlowLayout(spacing: 6) {
                        ChoiceChip(title: L("Sometime"), systemImage: "infinity", on: !hasDue) { hasDue = false }
                        ChoiceChip(title: L("Pick a day"), systemImage: "calendar", on: hasDue) { hasDue = true }
                    }
                    if hasDue {
                        DatePicker(L("By when?"), selection: $due, in: Date()..., displayedComponents: .date)
                            .font(.subheadline)
                    }
                }
                .accessibilityElement(children: .contain)
            }
            if kind == "done" && !members.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("Who did it?")).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3)
                    FlowLayout(spacing: 6) {
                        ChoiceChip(title: L("Me"), systemImage: "person", on: doneBy == nil) { doneBy = nil }
                        ForEach(members) { m in
                            ChoiceChip(title: m.name, on: doneBy == m.id) {
                                doneBy = m.id
                                // someone else did it: it's for the household, so they see it and can get a "Danke"
                                isPrivate = false
                                hide.remove(m.id)
                            }
                        }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(L("Who did it?"))
            }
            FlowLayout(spacing: 6) {
                ChoiceChip(title: L("For everyone"), systemImage: "person.3", on: !isPrivate) { isPrivate = false }
                ChoiceChip(title: L("Only for me"), systemImage: "lock", on: isPrivate) { isPrivate = true }
                if !isPrivate && members.count > 1 {
                    ForEach(members) { m in
                        ChoiceChip(title: LF("Not for %@", m.name), systemImage: "eye.slash", on: hide.contains(m.id)) {
                            if hide.contains(m.id) { hide.remove(m.id) } else { hide.insert(m.id) }
                        }
                    }
                }
            }
            if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
        }
    }

    /// lines with something on them (the server takes at most 20)
    private var lineCount: Int {
        min(20, text.split(whereSeparator: \.isNewline).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.count)
    }

    private func save() async {
        let v = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !v.isEmpty, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let other = kind == "done" ? doneBy : nil
            let several = many && lineCount > 1
            try await api.mindAdd(text: String(v.prefix(several ? 400 : 200)), kind: kind, isPrivate: other == nil ? isPrivate : false, hideFrom: Array(hide), doneBy: other,
                                  many: several, dueOn: kind == "open" && hasDue ? ServerDate.day(due) : nil)
            let name = other.flatMap { id in members.first { $0.id == id }?.name }
            let msg = several ? LF("%d noted – one per line.", lineCount)
                : kind == "done" ? (name.map { LF("Seen – %@ gets a thank-you.", $0) } ?? L("Seen – nice that you did it."))
                : (isPrivate ? L("Noted – only for you.") : L("Noted – the others can see it."))
            text = ""
            hide = []
            doneBy = nil
            hasDue = false
            error = nil
            onSaved(msg)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// One entry: mine with actions (done, private ↔ everyone, make it a task, delete), others' with "Ich denk mit" / "Danke".
struct MindRow: View {
    let api: APIClient
    let item: MindItem
    let members: [MindData.Member]
    var onChanged: (String?) -> Void = { _ in }
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack(alignment: .top, spacing: Theme.Space.s3) {
                Image(systemName: item.kind == "done" ? "checkmark.circle.fill" : "brain")
                    .foregroundStyle(item.kind == "done" ? Theme.sage : Theme.ink2)
                    .frame(width: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.text).foregroundStyle(Theme.ink)
                    if item.aboutMe {
                        Label(L("That was you – thank you!"), systemImage: "heart.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Theme.primaryText)
                    }
                    if !sub.isEmpty { Text(sub).font(.caption).foregroundStyle(Theme.ink3) }
                }
                Spacer(minLength: 0)
                if !item.mine {
                    Button { act(nil) { try await api.mindNod(item.id) } } label: {
                        Label(item.kind == "done" ? L("Thanks") : L("I’ll think along"), systemImage: item.nodded ? "hand.thumbsup.fill" : "hand.thumbsup")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.bordered)
                    .tint(item.nodded ? Theme.primary : nil)
                    .frame(minHeight: 44)
                }
            }
            .accessibilityElement(children: .combine)
            if item.mine {
                FlowLayout(spacing: 6) {
                    if item.kind == "open" {
                        ChoiceChip(title: L("Done"), systemImage: "checkmark", on: false) { act(L("Done – and seen.")) { try await api.mindUpdate(item.id, ["kind": "done"]) } }
                    }
                    ChoiceChip(title: item.visibility == "private" ? L("Show everyone") : L("Only for me"), systemImage: item.visibility == "private" ? "eye" : "lock", on: false) {
                        act(nil) { try await api.mindUpdate(item.id, ["visibility": item.visibility == "private" ? "household" : "private"]) }
                    }
                    if item.kind == "open" {
                        ChoiceChip(title: L("Make it a task"), systemImage: "checklist", on: false) { act(L("It’s a task now")) { try await api.mindToTask(item.id) } }
                    }
                    ChoiceChip(title: L("Delete"), systemImage: "trash", on: false) { act(nil) { try await api.mindDelete(item.id) } }
                }
                .padding(.leading, 36)
            }
            if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
        }
        .padding(.vertical, 4)
    }

    private var sub: String {
        let hidden = item.hideFrom.compactMap { id in members.first { $0.id == id }?.name }
        let nods = item.nods.map(\.name).joined(separator: ", ")
        let author: String? = {
            guard !item.mine, let by = item.by else { return nil }
            if item.aboutMe { return LF("%@ wrote it down: you did it", by.name) }
            if let doer = item.doneBy { return LF("%@ wrote it down: %@ did it", by.name, doer.name) }
            return item.kind == "done" ? LF("%@ did it", by.name) : LF("%@ has it on their mind", by.name)
        }()
        return [
            author,
            item.kind == "open" ? item.dueOn.map { LF("by %@", ServerDate.shortDay($0) ?? $0) } : nil,
            item.mine ? item.doneBy.map { LF("%@ did it", $0.name) } : nil,
            item.mine && item.visibility == "private" ? L("only for you") : nil,
            item.mine && !hidden.isEmpty ? LF("not for %@", hidden.joined(separator: ", ")) : nil,
            nods.isEmpty ? nil : (item.kind == "done" ? LF("Thanks from %@", nods) : LF("%@ thinks along", nods)),
        ].compactMap { $0 }.joined(separator: " · ")
    }

    private func act(_ done: String?, _ fn: @escaping () async throws -> Void) {
        Task {
            do {
                try await fn()
                error = nil
                onChanged(done)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

/// "Im Kopf" – the page (Heute card and Aufgaben link lead here)
struct MindView: View {
    let api: APIClient
    @State private var data: MindData?
    @State private var error: String?
    @State private var toast: ToastMessage?

    var body: some View {
        List {
            Section {
                Text(L("Things too small for a list – and still work: what you carry around, what you did on the side. So it gets seen. Only for you or for everyone, switch any time."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
                MindComposer(api: api, members: data?.members ?? []) { msg in toast = ToastMessage(text: msg); Task { await load() } }
            }
            if let error { Section { ErrorBanner(message: error) { Task { await load() } } } }
            if let d = data {
                if let n = d.review, n > 0 {
                    Section { MindReviewLink(api: api, count: n) { Task { await load() } } }
                }
                Section(L("On your mind")) {
                    if d.mine.open.isEmpty { Text(L("Nothing right now – or nothing written down.")).font(.subheadline).foregroundStyle(Theme.ink3) }
                    ForEach(d.mine.open) { row($0, d) }
                }
                let others = d.others.open + d.others.done
                if !others.isEmpty { Section(L("With the others")) { ForEach(others) { row($0, d) } } }
                if !d.mine.done.isEmpty { Section(L("Done on the side")) { ForEach(d.mine.done) { row($0, d) } } }
                FactCard(api: api, topic: "mental-load", inList: true)
                Section {} footer: {
                    Text(L("Never to the assistant, Home Assistant or notifications. Done things stay here two weeks and count in your weekly review."))
                }
            }
        }
        .themedList()
        .navigationTitle(L("On my mind"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let d = data, !(d.mine.open.isEmpty && d.mine.done.isEmpty) {
                ToolbarItem(placement: .primaryAction) {
                    // only my own entries – to Notes, Mail or a message, as plain text
                    ShareLink(item: ShareText.make(title: L("On my mind"),
                                                   lines: d.mine.open.map { "☐ " + $0.text } + d.mine.done.map { "✓ " + $0.text },
                                                   medium: "mind"),
                              subject: Text(L("On my mind"))) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel(L("Share what’s on my mind"))
                }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
    }

    private func row(_ x: MindItem, _ d: MindData) -> some View {
        MindRow(api: api, item: x, members: d.members) { msg in
            if let msg { toast = ToastMessage(text: msg) }
            Task { await load() }
        }
    }

    private func load() async {
        do {
            data = try await api.mind()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Heute: write something down in passing, and see what the others carry (a few, newest first).
struct MindTodayCard: View {
    let api: APIClient
    let refresh: Int
    @State private var data: MindData?
    @State private var toast: ToastMessage?

    var body: some View {
        Group {
            if let d = data {
                Card(title: L("On my mind"), systemImage: "brain") {
                    VStack(alignment: .leading, spacing: Theme.Space.s3) {
                        MindComposer(api: api, members: d.members) { msg in toast = ToastMessage(text: msg); Task { await load() } }
                        ForEach(Array((d.others.open + d.others.done).prefix(3))) { x in
                            MindRow(api: api, item: x, members: d.members) { _ in Task { await load() } }
                        }
                        if let n = d.review, n > 0 {
                            MindReviewLink(api: api, count: n) { Task { await load() } }
                        }
                        NavigationLink { MindView(api: api) } label: {
                            HStack {
                                Text(d.mine.open.isEmpty ? L("Open") : LF("%d on your mind", d.mine.open.count)).font(.subheadline.weight(.semibold))
                                Spacer()
                                Image(systemName: "chevron.right").font(.caption).accessibilityHidden(true)
                            }
                            .foregroundStyle(Theme.primaryText)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .toast($toast)
            }
        }
        .task(id: refresh) { await load() }
    }

    private func load() async { data = try? await api.mind() }
}
