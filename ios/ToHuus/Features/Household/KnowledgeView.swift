import PhotosUI
import SwiftUI

/// "Was ToHuus sich merkt" – Haushaltswissen (GET/POST/PATCH/DELETE /api/knowledge, docs/knowledge.md). Same as the web
/// (web/src/pages/Knowledge.tsx): "Schreib es ToHuus" on top (read without AI), cards grouped by person, room, product
/// or a free subject, search, a card opens the editor (value, subject, property, note, photo, who sees it, history,
/// delete). `KnowledgeSection` shows the cards of one person or place in their screens.
struct KnowledgeView: View {
    let api: APIClient
    /// only the cards about this person or place ('k2', 'l5')
    var ref: String?
    @Environment(AppModel.self) private var app
    @State private var list: KnowledgeList?
    @State private var text = ""
    @State private var onlyMe = false
    @State private var touchedVisibility = false
    @State private var busy = false
    @State private var search = ""
    @State private var editing: KnowledgeDraft?
    @State private var answer: [KnowledgeEntry]?
    @State private var confirm: KnowledgeConfirm?
    @State private var askConsent = false
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var importing = false
    @State private var exporting = false

    private var guest: Bool { app.isGuest }
    private var groups: [KnowledgeGroup] {
        let all = list?.groups ?? []
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return all }
        return all.compactMap { g in
            var g2 = g
            g2.entries = g.entries.filter { e in [g.title, e.property, e.value, e.text, e.note].compactMap { $0?.lowercased() }.contains { $0.contains(q) } }
            return g2.entries.isEmpty ? nil : g2
        }
    }

    /// examples for the empty state – a tap puts them into the field
    private var examples: [String] {
        [L("Mika shoe size 28"), L("Blind ground floor 120 x 160"), L("Cooker hood filter size 20 x 30"), L("Electricity meter number 1ESY1160"), L("Paediatrician 04181 12345")]
    }

    var body: some View {
        List {
            Section {
                Text(guest ? L("What the household shares with guests: sizes, numbers, how things work.")
                           : L("Write it to ToHuus, then nobody has to ask you. And you don’t have to remember it yourself."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            } header: { Text(L("Your household memory")) }
            if !guest { sayField }
            if let answer { answerSection(answer) }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            if let list {
                if list.entries.isEmpty {
                    emptySection
                } else {
                    ForEach(groups) { g in
                        Section {
                            ForEach(g.entries) { e in
                                KnowledgeRow(entry: e, api: api)
                                    .contentShape(Rectangle())
                                    .onTapGesture { if !guest { editing = KnowledgeDraft(entry: e) } }
                                    .accessibilityAddTraits(guest ? [] : .isButton)
                                    .swipeActions {
                                        if !guest {
                                            Button(role: .destructive) { Task { await delete(e) } } label: { Label(L("Delete"), systemImage: "trash") }
                                        }
                                    }
                            }
                        } header: {
                            HStack {
                                Label(g.title ?? L("Other things"), systemImage: KnowledgeRow.icon(g.kind))
                                Spacer()
                                if !guest, let title = g.title {
                                    Button { editing = KnowledgeDraft(subject: title, subjectRef: g.ref) } label: { Image(systemName: "plus") }
                                        .accessibilityLabel(LF("Add to %@", title))
                                }
                            }
                        }
                    }
                    if groups.isEmpty { Text(L("Nothing found.")).foregroundStyle(Theme.ink3) }
                }
            } else {
                HStack { Spacer(); ProgressView(); Spacer() }
            }
            if !guest {
                Section {} footer: { Text(L("ToHuus is no notebook and no calendar: only what belongs to your home. Codes and passwords go into House info › Codes.")) }
            }
        }
        .themedList()
        .searchable(text: $search, prompt: L("Search, e.g. shoe size"))
        .navigationTitle(L("What ToHuus remembers"))
        .toolbar {
            if !guest {
                ToolbarItem(placement: .primaryAction) {
                    Button { editing = KnowledgeDraft() } label: { Image(systemName: "plus") }
                        .accessibilityLabel(L("Add yourself"))
                }
            }
            ToolbarItem(placement: .secondaryAction) {
                Menu {
                    if !guest { Button { importing = true } label: { Label(L("Import"), systemImage: "square.and.arrow.down") } }
                    Button { exporting = true } label: { Label(L("Export"), systemImage: "square.and.arrow.up") }
                        .disabled((list?.entries.isEmpty ?? true))
                } label: { Image(systemName: "ellipsis.circle") }
                .accessibilityLabel(L("Import and export"))
            }
        }
        .sheet(isPresented: $importing) { KnowledgeImportSheet(api: api) { msg, undo in done(msg, undo) } }
        .sheet(isPresented: $exporting) {
            KnowledgeExportSheet(api: api, total: list?.entries.count ?? 0,
                                 shownIds: search.trimmingCharacters(in: .whitespaces).isEmpty && ref == nil ? nil : groups.flatMap { $0.entries.map(\.id) },
                                 onlyThese: ref != nil)
        }
        .task { await load() }
        .refreshable { await load() }
        .assistantScreen("knowledge")
        .sheet(item: $editing) { d in
            KnowledgeEditor(api: api, draft: d, subjects: list?.subjects ?? []) { msg, undo in done(msg, undo) }
        }
        .sheet(item: $confirm) { c in KnowledgeConfirmSheet(api: api, box: c) { msg, undo in done(msg, undo) } }
        .alert(L("Save health information?"), isPresented: $askConsent) {
            Button(L("Not now"), role: .cancel) {}
            Button(L("Save")) { Task { await send(consent: true) } }
        } message: {
            Text(L("Allergies are health data. ToHuus stores them encrypted in your household and only uses them for warnings on recipes. They only go to the assistant if you allow that in the settings."))
        }
        .toast($toast)
    }

    private var sayField: some View {
        Section {
            TextField(L("e.g. Mika shoe size 28"), text: $text, axis: .vertical)
                .lineLimit(1...3)
                .submitLabel(.send)
                .onSubmit { Task { await send(consent: false) } }
            Toggle(L("Only for me – the others don’t see it"), isOn: Binding(get: { onlyMe }, set: { onlyMe = $0; touchedVisibility = true }))
            Button {
                Task { await send(consent: false) }
            } label: {
                HStack { Label(L("Send"), systemImage: "paperplane"); if busy { Spacer(); ProgressView() } }
            }
            .disabled(busy || text.trimmingCharacters(in: .whitespaces).count < 2)
        } header: { Text(L("Write it to ToHuus.")) } footer: { Text(L("ToHuus sorts it. Or just ask.")) }
    }

    private func answerSection(_ xs: [KnowledgeEntry]) -> some View {
        Section {
            if xs.isEmpty { Text(L("ToHuus doesn’t know that yet.")).foregroundStyle(Theme.ink2) }
            ForEach(xs) { e in
                KnowledgeRow(entry: e, api: api, showSubject: true)
                    .contentShape(Rectangle())
                    .onTapGesture { editing = KnowledgeDraft(entry: e) }
            }
            Button(L("Close")) { answer = nil }
        } header: { Text(xs.isEmpty ? "" : L("This is what ToHuus knows:")) }
    }

    private var emptySection: some View {
        Section {
            EmptyStateView(systemImage: "brain", title: guest ? L("Nothing shared with guests yet") : L("What do you all know about your home?"),
                           message: guest ? nil : L("Sizes, measurements, numbers. Write a sentence above, ToHuus sorts it. For example:"))
                .listRowBackground(Color.clear)
            if !guest {
                FlowLayout(spacing: 8) {
                    ForEach(examples, id: \.self) { x in
                        Button(x) { text = x }
                            .buttonStyle(.bordered)
                            .tint(Theme.primary)
                    }
                }
                Text(L("Doctors and other health things stay with you unless you share them.")).font(.caption).foregroundStyle(Theme.ink3)
            }
        }
    }

    private func load() async {
        do { list = try await api.knowledge(ref: ref); error = nil }
        catch { self.error = APIError.from(error).localizedDescription }
    }

    private func done(_ message: String?, _ undo: String?) {
        Task { await load() }
        guard let message else { return }
        if let undo {
            toast = ToastMessage(text: message, actionTitle: L("Undo")) {
                Task { try? await api.undo(undo); await load() }
            }
        } else { toast = ToastMessage(text: message) }
    }

    private func send(consent: Bool) async {
        let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard s.count >= 2 else { return }
        busy = true
        defer { busy = false }
        answer = nil
        do {
            let r = try await api.knowledgeSay(s, visibility: touchedVisibility ? (onlyMe ? "me" : "household") : nil, consent: consent)
            switch r {
            case .needsConsent: askConsent = true
            case let .saved(entry, before, undo):
                text = ""
                Haptics.success()
                done(before.map { LF("Changed: %@ (before: %@)", entry.text, $0) } ?? LF("Noted: %@", entry.text), undo)
            case let .answer(xs): answer = xs
            case let .confirm(action, xs):
                if xs.isEmpty { toast = ToastMessage(text: L("ToHuus found nothing that fits. Try the search."), isError: true) }
                else { confirm = KnowledgeConfirm(action: action, entries: xs) }
            case let .form(subject, subjectRef, property, value, t):
                editing = KnowledgeDraft(subject: subject, subjectRef: subjectRef, property: property, value: value, text: t, onlyMe: onlyMe)
            }
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func delete(_ e: KnowledgeEntry) async {
        do {
            let undo = try await api.knowledgeDelete(e.id)
            done(LF("Deleted: %@", e.text), undo)
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// one card: property and value (or the plain line), note, who changed it when; lock = only me, eye = guests see it
struct KnowledgeRow: View {
    let entry: KnowledgeEntry
    let api: APIClient
    var showSubject = false

    static func icon(_ kind: String?) -> String {
        switch kind {
        case "person": return "person"
        case "place": return "mappin.and.ellipse"
        case "product": return "shippingbox"
        case "free": return "tag"
        default: return "brain"
        }
    }

    var body: some View {
        HStack(spacing: Theme.Space.s3) {
            if let p = entry.photo {
                RemoteImage(url: api.imageURL(p), api: api).frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: 8)).accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                if entry.isCard {
                    Text([showSubject ? entry.subject : nil, entry.property].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink2)
                    Text(entry.value ?? "").font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                } else {
                    Text(entry.text).font(.body).foregroundStyle(Theme.ink)
                }
                if let n = entry.note, !n.isEmpty { Text(n).font(.caption).foregroundStyle(Theme.ink2) }
                Text([entry.updatedBy ?? entry.author, ServerDate.relative(entry.updatedAt ?? entry.createdAt)].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 0)
            if entry.onlyMe { Image(systemName: "lock").foregroundStyle(Theme.ink3).accessibilityLabel(L("Only for me")) }
            if entry.guests == true { Image(systemName: "eye").foregroundStyle(Theme.ink3).accessibilityLabel(L("Guests see it too")) }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }
}

/// what the editor starts from: a card, or a new one (maybe prefilled by "Schreib es ToHuus")
struct KnowledgeDraft: Identifiable {
    let id = UUID()
    var entry: KnowledgeEntry?
    var subject: String?
    var subjectRef: String?
    var property: String?
    var value: String?
    var text: String?
    var onlyMe = false
}

struct KnowledgeConfirm: Identifiable {
    let id = UUID()
    let action: String
    let entries: [KnowledgeEntry]
}

/// delete / share / make private what the sentence pointed to – only after this yes
struct KnowledgeConfirmSheet: View {
    let api: APIClient
    let box: KnowledgeConfirm
    let done: (String?, String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var askShare: KnowledgeEntry?
    @State private var error: String?

    private var title: String {
        switch box.action {
        case "share": return L("Show it to the whole household?")
        case "private": return L("Only for you?")
        default: return L("Delete this?")
        }
    }
    private var verb: String {
        switch box.action {
        case "share": return L("Show to everyone")
        case "private": return L("Only for me")
        default: return L("Delete")
        }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(box.entries) { e in
                    HStack {
                        Text(e.text)
                        Spacer()
                        Button(verb, role: box.action == "delete" ? .destructive : nil) { Task { await run(e, consent: false) } }
                            .buttonStyle(.bordered)
                    }
                    .frame(minHeight: 44)
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .themedList()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .alert(L("Share health information?"), isPresented: Binding(get: { askShare != nil }, set: { if !$0 { askShare = nil } })) {
                Button(L("Not now"), role: .cancel) {}
                Button(L("Share anyway")) { if let e = askShare { Task { await run(e, consent: true) } } }
            } message: {
                Text(L("This looks like health information. Then everyone in the household sees it. It goes to the assistant only if you allowed that in the settings."))
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func run(_ e: KnowledgeEntry, consent: Bool) async {
        do {
            if box.action == "delete" {
                let undo = try await api.knowledgeDelete(e.id)
                done(LF("Deleted: %@", e.text), undo)
                dismiss()
                return
            }
            var body: [String: Any] = ["visibility": box.action == "share" ? "household" : "me"]
            if consent { body["consent"] = true }
            switch try await api.knowledgeUpdate(e.id, body) {
            case .needsShareConsent, .needsConsent: askShare = e
            case let .done(_, _, undo):
                done(box.action == "share" ? L("Everyone in the household sees it now.") : L("Only you see it now."), undo)
                dismiss()
            }
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// create or change one card: subject, property, value, note, photo, who sees it, guests, history, delete
struct KnowledgeEditor: View {
    let api: APIClient
    let draft: KnowledgeDraft
    let subjects: [KnowledgeSubject]
    let done: (String?, String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var entry: KnowledgeEntry?
    @State private var subject = ""
    @State private var subjectRef: String?
    @State private var property = ""
    @State private var value = ""
    @State private var text = ""
    @State private var note = ""
    @State private var visibility = "household"
    @State private var guests = false
    /// a new health entry stays private unless someone picks „Ganzer Haushalt“ on purpose (server default)
    @State private var visibilityTouched = false
    @State private var busy = false
    @State private var error: String?
    @State private var askConsent = false
    @State private var askShare = false
    @State private var confirmDelete = false
    @State private var photoItem: PhotosPickerItem?

    init(api: APIClient, draft: KnowledgeDraft, subjects: [KnowledgeSubject], done: @escaping (String?, String?) -> Void) {
        self.api = api
        self.draft = draft
        self.subjects = subjects
        self.done = done
        let e = draft.entry
        _entry = State(initialValue: e)
        _subject = State(initialValue: e?.subject ?? draft.subject ?? "")
        _subjectRef = State(initialValue: e?.subjectRef ?? draft.subjectRef)
        _property = State(initialValue: e?.property ?? draft.property ?? "")
        _value = State(initialValue: e?.value ?? draft.value ?? "")
        _text = State(initialValue: e.map { $0.isCard ? "" : $0.text } ?? draft.text ?? "")
        _note = State(initialValue: e?.note ?? "")
        _visibility = State(initialValue: e?.visibility ?? (draft.onlyMe ? "me" : "household"))
        _guests = State(initialValue: e?.guests ?? false)
    }

    private var isNew: Bool { entry == nil }
    private var plain: Bool { entry.map { !$0.isCard } ?? (draft.text != nil) }
    /// the author shares a private card; the author (or an admin, for the author) makes one private
    private var mayFlip: Bool { guard let e = entry else { return true }; return e.onlyMe ? (e.may?.share ?? false) : (e.may?.makePrivate ?? false) }
    private var canSave: Bool {
        let card = !subject.trimmed.isEmpty && !property.trimmed.isEmpty && !value.trimmed.isEmpty
        return isNew ? card || (text.trimmed.isEmpty ? value.trimmed : text.trimmed).count >= 2 : true
    }

    var body: some View {
        NavigationStack {
            Form {
                if plain {
                    Section {
                        TextField(L("What ToHuus remembers"), text: $text, axis: .vertical).lineLimit(1...4)
                    } footer: { if isNew { Text(L("Saved as a line, or fill in the fields below to make it a card.")) } }
                }
                Section {
                    HStack {
                        TextField(L("Who or what?"), text: Binding(get: { subject }, set: { subject = $0; subjectRef = subjects.first { $0.name.lowercased() == subject.trimmed.lowercased() }?.ref }))
                        if !subjects.isEmpty {
                            Menu {
                                ForEach(subjects) { s in
                                    Button { subject = s.name; subjectRef = s.ref } label: { Label(s.name, systemImage: KnowledgeRow.icon(s.kind)) }
                                }
                            } label: { Image(systemName: "person.2.circle") }
                                .accessibilityLabel(L("Choose a person or place"))
                        }
                    }
                    TextField(L("What exactly? e.g. shoe size"), text: $property)
                    TextField(L("Value, e.g. 28"), text: $value)
                } footer: { Text(L("e.g. Mika, living room, car")) }
                Section(L("Note")) {
                    TextField(L("e.g. inside measurement, without the box"), text: $note, axis: .vertical).lineLimit(1...4)
                }
                Section {
                    Picker(L("Who sees it?"), selection: Binding(get: { visibility }, set: { visibility = $0; visibilityTouched = true })) {
                        Text(L("Whole household")).tag("household")
                        Text(L("Only me")).tag("me")
                    }
                    .pickerStyle(.segmented)
                    .disabled(!mayFlip)
                    if visibility == "household" && entry?.sensitive != true {
                        Toggle(L("Guests see it too"), isOn: $guests)
                    }
                } header: { Text(L("Who sees it?")) } footer: {
                    if !mayFlip { Text(entry?.onlyMe == true ? L("Only the person who wrote it can share it.") : L("Only the person who wrote it can make it private.")) }
                    else if entry?.onlyMe == true && visibility == "household" { Text(L("The others see what changes from now on. The earlier values stay with you.")) }
                    else if visibility == "household" { Text(L("Permanent guests like grandma, the way House info works.")) }
                }
                if let e = entry {
                    Section(L("Photo")) {
                        if let p = e.photo {
                            RemoteImage(url: api.imageURL(p), api: api).frame(height: 160).clipShape(RoundedRectangle(cornerRadius: 10))
                                .accessibilityLabel(LF("Photo of %@", e.text))
                        }
                        PhotosPicker(selection: $photoItem, matching: .images) {
                            Label(e.photo == nil ? L("Add photo") : L("Other photo"), systemImage: "camera")
                        }
                        if e.photo != nil {
                            Button(L("Remove photo"), role: .destructive) { Task { try? await api.knowledgeRemovePhoto(e.id); await reload() } }
                        }
                    }
                    if !e.history.isEmpty {
                        Section(L("Before")) {
                            ForEach(e.history) { h in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(h.shown)
                                        Text([h.by, ServerDate.relative(h.at ?? h.until)].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink3)
                                    }
                                    Spacer()
                                    Button(L("Bring back")) { Task { await history(h, restore: true) } }
                                        .buttonStyle(.bordered)
                                        .accessibilityLabel(LF("Bring back %@", h.shown))
                                }
                                .swipeActions {
                                    Button(role: .destructive) { Task { await history(h, restore: false) } } label: { Label(L("Remove"), systemImage: "trash") }
                                }
                                .accessibilityAction(named: L("Remove from the history")) { Task { await history(h, restore: false) } }
                            }
                        }
                    }
                    Section {
                        Button(role: .destructive) { confirmDelete = true } label: { Label(L("Delete"), systemImage: "trash") }
                    } footer: {
                        Text([e.author, e.origin.map(originText), ServerDate.relative(e.createdAt)].compactMap { $0 }.joined(separator: " · "))
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(isNew ? L("Remember something") : (entry?.subject ?? L("Change")))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save(consent: false) } }.disabled(busy || !canSave)
                }
            }
            .onChange(of: photoItem) { _, item in
                guard let item, let id = entry?.id else { return }
                Task {
                    if let d = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: d), let j = img.jpegData(compressionQuality: 0.8) {
                        do { try await api.knowledgePhoto(id, jpeg: j); await reload() } catch { self.error = APIError.from(error).localizedDescription }
                    }
                    photoItem = nil
                }
            }
            .alert(L("Save health information?"), isPresented: $askConsent) {
                Button(L("Not now"), role: .cancel) {}
                Button(L("Save")) { Task { await save(consent: true) } }
            } message: {
                Text(L("Allergies are health data. ToHuus stores them encrypted in your household and only uses them for warnings on recipes. They only go to the assistant if you allow that in the settings."))
            }
            .alert(L("Share health information?"), isPresented: $askShare) {
                Button(L("Not now"), role: .cancel) {}
                Button(L("Share anyway")) { Task { await save(consent: true) } }
            } message: {
                Text(L("This looks like health information. Then everyone in the household sees it. It goes to the assistant only if you allowed that in the settings."))
            }
            .confirmationDialog(L("Delete this?"), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Delete"), role: .destructive) { Task { await remove() } }
            }
        }
    }

    private func originText(_ o: String) -> String {
        switch o {
        case "assistant": return L("via the assistant")
        case "telegram": return L("via Telegram")
        case "share": return L("shared")
        case "mcp": return L("via MCP")
        default: return L("in the app")
        }
    }

    private func reload() async {
        guard let id = entry?.id else { return }
        if let e = try? await api.knowledgeEntry(id) { entry = e }
    }

    private func save(consent: Bool) async {
        busy = true
        defer { busy = false }
        do {
            var body: [String: Any] = [:]
            if let e = entry {
                if !e.isCard && property.trimmed.isEmpty {
                    if text.trimmed != e.text { body["text"] = text.trimmed }
                } else {
                    if subject.trimmed != (e.subject ?? "") { body["subject"] = subject.trimmed; body["subjectRef"] = subjectRef ?? NSNull() }
                    if property.trimmed != (e.property ?? "") { body["property"] = property.trimmed }
                    if value.trimmed != (e.value ?? "") { body["value"] = value.trimmed }
                }
                if note.trimmed != (e.note ?? "") { body["note"] = note.trimmed.isEmpty ? NSNull() : note.trimmed }
                if visibility != (e.visibility ?? "household") { body["visibility"] = visibility }
                if guests != (e.guests ?? false) { body["guests"] = guests }
                if body.isEmpty { dismiss(); return }
                if consent { body["consent"] = true }
                switch try await api.knowledgeUpdate(e.id, body) {
                case .needsConsent: askConsent = true
                case .needsShareConsent: askShare = true
                case let .done(entry, _, undo):
                    done(LF("Changed: %@", entry?.text ?? e.text), undo)
                    dismiss()
                }
                return
            }
            let card = !subject.trimmed.isEmpty && !property.trimmed.isEmpty && !value.trimmed.isEmpty
            if card {
                body = ["subject": subject.trimmed, "property": property.trimmed, "value": value.trimmed, "guests": guests]
                if let subjectRef { body["subjectRef"] = subjectRef }
            } else {
                body = ["text": text.trimmed.isEmpty ? value.trimmed : text.trimmed, "guests": guests]
            }
            if !note.trimmed.isEmpty { body["note"] = note.trimmed }
            if visibilityTouched || visibility == "me" { body["visibility"] = visibility }
            if consent { body["consent"] = true }
            switch try await api.knowledgeCreate(body) {
            case .needsConsent, .needsShareConsent: askConsent = true
            case let .done(entry, before, undo):
                let t = entry?.text ?? text
                done(before.map { LF("Changed: %@ (before: %@)", t, $0) } ?? LF("Noted: %@", t), undo)
                Haptics.success()
                dismiss()
            }
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func history(_ h: KnowledgeHistory, restore: Bool) async {
        guard let id = entry?.id else { return }
        do {
            let r = restore ? try await api.knowledgeRestore(id, h.i) : try await api.knowledgeRemoveHistory(id, h.i)
            if case let .done(e, _, undo) = r {
                if let e { entry = e }
                done(restore ? L("Earlier value is back.") : L("Removed from the history."), undo)
                if restore { dismiss() }
            }
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func remove() async {
        guard let e = entry else { return }
        do {
            let undo = try await api.knowledgeDelete(e.id)
            done(LF("Deleted: %@", e.text), undo)
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// The cards about one person or place, as a Form section in their screen (web: KnowledgeFor).
struct KnowledgeSection: View {
    let api: APIClient
    /// 'u3', 'k2', 'l5'
    let ref: String
    let name: String
    var canAdd = true
    @State private var entries: [KnowledgeEntry] = []
    @State private var subjects: [KnowledgeSubject] = []
    @State private var editing: KnowledgeDraft?
    @State private var loaded = false

    var body: some View {
        Section {
            ForEach(entries) { e in
                KnowledgeRow(entry: e, api: api)
                    .contentShape(Rectangle())
                    .onTapGesture { if canAdd { editing = KnowledgeDraft(entry: e) } }
            }
            if loaded && entries.isEmpty {
                Text(LF("Nothing about %@ yet, e.g. sizes or measurements.", name)).font(.subheadline).foregroundStyle(Theme.ink3)
            }
            if canAdd {
                Button { editing = KnowledgeDraft(subject: name, subjectRef: ref) } label: { Label(L("Add"), systemImage: "plus") }
            }
            NavigationLink { KnowledgeView(api: api, ref: ref) } label: { Text(L("Show all")) }
        } header: { Label(L("What ToHuus remembers"), systemImage: "brain") }
        .task { await load() }
        .sheet(item: $editing) { d in
            KnowledgeEditor(api: api, draft: d, subjects: subjects) { _, _ in Task { await load() } }
        }
    }

    private func load() async {
        if let l = try? await api.knowledge(ref: ref) {
            entries = l.entries
            subjects = l.subjects
        }
        loaded = true
    }
}

private extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
