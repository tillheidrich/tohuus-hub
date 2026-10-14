import CoreTransferable
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// Holiday handover ("Übergabe") natively (web: pages/Handover.tsx, server: routes/handover.ts, lib/handover.ts,
// docs/handover.md). What the people looking after the home do while the household is away – feed the cat, water
// the plants – with instructions, photos and short videos.
//
// - HandoverView(api:tripId:): the trip's tab for members – items, who sees them, what was ticked per day, templates.
// - HandoverGuestView(api:): what a permanent guest chosen for a trip sees (web /uebergabe) – today first, tick if you
//   like, all instructions below.
// The guest / house-sitter link page (GET /api/guest/:token/handover) stays in the browser – a sitter opens the link.

// MARK: - models (API: docs/handover.md)

struct HandoverDone: Decodable, Sendable, Hashable {
    var by: String?
    var at: String?
}

struct HandoverTick: Decodable, Sendable, Hashable {
    /// morning | noon | evening | "" (once that day)
    var slot: String
    var done: HandoverDone?
}

/// An item of a trip's handover. In a day plan (`days[].plan`, `today`) it also carries `ticks`.
struct HandoverItem: Decodable, Sendable, Hashable, Identifiable {
    var id: Int
    /// pet | plants | post | bins | home | other
    var kind: String
    var title: String
    var instructions: String?
    /// daily | days | once | asneeded
    var rhythm: String
    /// 1 = Monday … 7 = Sunday (rhythm `days`)
    var weekdays: [Int]?
    /// YYYY-MM-DD (rhythm `once`)
    var day: String?
    var slots: [String]?
    var media: [HGMedia]?
    var ticks: [HandoverTick]?
}

struct HandoverAccessLink: Decodable, Sendable, Hashable {
    var id: Int
    var until: String?
}

struct HandoverAccess: Decodable, Sendable, Hashable {
    var links: [HandoverAccessLink]
    var guests: [Int]
    var sitterLinkId: Int?
}

struct HandoverDay: Decodable, Sendable, Hashable, Identifiable {
    var day: String
    var plan: [HandoverItem]
    var id: String { day }
}

/// GET /api/away/trips/:id/handover → { items, access, days }
struct HandoverOverview: Decodable, Sendable {
    @Lossy var items: [HandoverItem]
    var access: HandoverAccess
    @Lossy var days: [HandoverDay]
}

struct HandoverTripLite: Decodable, Sendable, Hashable {
    var id: Int
    var name: String
    var startDay: String?
    var endDay: String?
}

/// GET /api/handover/mine → [{ trip, day, today, items }]
struct HandoverViewerTrip: Decodable, Sendable, Identifiable {
    var trip: HandoverTripLite
    var day: String
    @Lossy var today: [HandoverItem]
    @Lossy var items: [HandoverItem]
    var id: Int { trip.id }
}

struct HandoverTemplate: Decodable, Sendable, Hashable, Identifiable {
    var id: Int
    var name: String
    var count: Int?
    var titles: [String]?
}

struct HandoverSourceTrip: Decodable, Sendable, Hashable, Identifiable {
    var id: Int
    var name: String
    var startDay: String?
    var count: Int?
}

/// GET /api/away/trips/:id/handover/sources → { templates, trips }
struct HandoverSources: Decodable, Sendable {
    @Lossy var templates: [HandoverTemplate]
    @Lossy var trips: [HandoverSourceTrip]
}

/// POST /api/away/trips/:id/handover/apply → { added, items }
struct HandoverApplied: Decodable, Sendable {
    var added: Int
}

/// What an item editor sends (POST …/handover/items, PATCH /away/handover/items/:id).
struct HandoverItemInput: Sendable {
    var kind: String
    var title: String
    var instructions: String
    var rhythm: String
    var weekdays: [Int]
    var day: String?
    var slots: [String]
}

enum HandoverLimits {
    /// server/lib/handover.ts MEDIA_PER_ITEM
    static let perItem = 6
    static let maxBytes = 100 * 1024 * 1024
}

/// a JSON value or null
private func handoverNul(_ v: Any?) -> Any { v ?? NSNull() }

// MARK: - API

extension APIClient {
    func handoverOverview(trip: Int) async throws -> HandoverOverview { try await get("api/away/trips/\(trip)/handover") }

    /// new item (`id` nil) on the trip, or changes to an existing one → the item
    func saveHandoverItem(id: Int?, trip: Int, _ input: HandoverItemInput) async throws -> HandoverItem {
        let body: [String: Any] = [
            "kind": input.kind,
            "title": input.title,
            "instructions": input.instructions,
            "rhythm": input.rhythm,
            "weekdays": input.weekdays,
            "day": handoverNul(input.day),
            "slots": input.slots,
        ]
        if let id { return try await send("PATCH", "api/away/handover/items/\(id)", json: body) }
        return try await send("POST", "api/away/trips/\(trip)/handover/items", json: body)
    }

    func deleteHandoverItem(_ id: Int) async throws {
        _ = try await send("DELETE", "api/away/handover/items/\(id)", as: Ignored.self)
    }

    /// POST /api/away/handover/items/:id/media – multipart `file`; photos, videos up to 100 MB
    func uploadHandoverMedia(item: Int, data: Data, filename: String, mime: String) async throws -> HGMedia {
        var mp = Multipart()
        mp.addFile("file", filename: filename, mimeType: mime, data: data)
        return try await upload("api/away/handover/items/\(item)/media", multipart: mp, timeout: 600)
    }

    func deleteHandoverMedia(item: Int, media: Int) async throws {
        _ = try await send("DELETE", "api/away/handover/items/\(item)/media/\(media)", as: Ignored.self)
    }

    /// PUT /api/away/trips/:id/handover/access { links: [{ id, until }], guests: [userId] }
    func setHandoverAccess(trip: Int, links: [HandoverAccessLink], guests: [Int]) async throws {
        var list: [[String: Any]] = []
        for l in links { list.append(["id": l.id, "until": handoverNul(l.until)]) }
        let body: [String: Any] = ["links": list, "guests": guests]
        _ = try await send("PUT", "api/away/trips/\(trip)/handover/access", json: body, as: Ignored.self)
    }

    func saveHandoverTemplate(trip: Int, name: String) async throws {
        _ = try await send("POST", "api/away/trips/\(trip)/handover/template", json: ["name": name], as: Ignored.self)
    }

    func deleteHandoverTemplate(_ id: Int) async throws {
        _ = try await send("DELETE", "api/away/handover/templates/\(id)", as: Ignored.self)
    }

    func handoverSources(trip: Int) async throws -> HandoverSources { try await get("api/away/trips/\(trip)/handover/sources") }

    /// adds the items of a template or of an earlier trip (with copies of their photos and videos)
    func applyHandover(trip: Int, templateId: Int?, fromTrip: Int?) async throws -> HandoverApplied {
        var body: [String: Any] = [:]
        if let templateId { body["templateId"] = templateId }
        if let fromTrip { body["tripId"] = fromTrip }
        return try await send("POST", "api/away/trips/\(trip)/handover/apply", json: body)
    }

    /// permanent guests chosen for a trip (web /uebergabe)
    func handoverMine() async throws -> [HandoverViewerTrip] {
        try await get("api/handover/mine", as: Lossy<HandoverViewerTrip>.self).wrappedValue
    }

    /// POST /api/handover/done { itemId, day, slot, done }
    func handoverDone(item: Int, day: String, slot: String, done: Bool) async throws {
        let body: [String: Any] = ["itemId": item, "day": day, "slot": slot, "done": done]
        _ = try await send("POST", "api/handover/done", json: body, as: Ignored.self)
    }
}

// MARK: - labels

enum HandoverLabels {
    static let kinds = ["pet", "plants", "post", "bins", "home", "other"]
    static let rhythms = ["daily", "days", "once", "asneeded"]
    static let slotKeys = ["morning", "noon", "evening"]

    static func icon(_ kind: String) -> String {
        switch kind {
        case "pet": return "pawprint"
        case "plants": return "leaf"
        case "post": return "envelope"
        case "bins": return "trash"
        case "home": return "house"
        default: return "info.circle"
        }
    }

    static func kindName(_ kind: String) -> String {
        switch kind {
        case "pet": return L("Animals")
        case "plants": return L("Plants")
        case "post": return L("Post")
        case "bins": return L("Bins")
        case "home": return L("Flat")
        default: return L("Other")
        }
    }

    static func slotName(_ slot: String) -> String {
        switch slot {
        case "morning": return L("morning")
        case "noon": return L("midday")
        case "evening": return L("evening")
        default: return L("once that day")
        }
    }

    static func rhythmName(_ rhythm: String) -> String {
        switch rhythm {
        case "daily": return L("Every day")
        case "days": return L("On days")
        case "once": return L("Once")
        default: return L("When needed")
        }
    }

    static func weekdays() -> [String] { [L("Mon"), L("Tue"), L("Wed"), L("Thu"), L("Fri"), L("Sat"), L("Sun")] }

    /// "Mo., 14. Okt."
    static func day(_ s: String?) -> String { ServerDate.shortDay(s) ?? "?" }

    /// "every day, morning and evening" · "Mon, Thu" · "on 14 Oct" · "when needed" (web: rhythmText)
    static func rhythmText(_ i: HandoverItem) -> String {
        let slots = i.slots ?? []
        let when = slots.map { slotName($0) }.joined(separator: L(" and "))
        let names = weekdays()
        let base: String
        switch i.rhythm {
        case "daily": base = L("every day")
        case "days": base = (i.weekdays ?? []).filter { $0 >= 1 && $0 <= 7 }.map { names[$0 - 1] }.joined(separator: ", ")
        case "once": base = LF("on %@", i.day == nil ? "?" : day(i.day))
        default: base = L("when needed")
        }
        return !when.isEmpty && i.rhythm != "asneeded" ? base + ", " + when : base
    }
}

// MARK: - household side (trip tab)

/// The trip's "Übergabe" for members: what to do, who sees it, what was ticked; templates and taking over.
struct HandoverView: View {
    let api: APIClient
    let tripId: Int
    @State private var data: HandoverOverview?
    @State private var links: [GuestLink] = []
    @State private var people: [PersonDirEntry] = []
    @State private var error: String?
    @State private var edit: HandoverEditTarget?
    @State private var showReuse = false
    @State private var askTemplate = false
    @State private var templateName = ""
    @State private var toast: ToastMessage?

    init(api: APIClient, tripId: Int) {
        self.api = api
        self.tripId = tripId
    }

    var body: some View {
        List {
            Section {
                Text(L("What the people looking after your home should do – feed the cat, water the plants – with how it works, photos and short videos. Only the people you choose see it; they can tick what they did."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let error { Section { ErrorBanner(message: error) { Task { await load() } } }.listRowBackground(Color.clear) }
            if let data {
                itemsSection(data)
                accessSection(data.access)
                if !data.items.isEmpty { progressSection(data.days) }
            } else if error == nil {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            }
        }
        .themedList()
        .navigationTitle(L("Handover"))
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $edit) { t in
            HandoverItemSheet(api: api, tripId: tripId, item: t.item) { Task { await load() } }
        }
        .sheet(isPresented: $showReuse) {
            HandoverReuseSheet(api: api, tripId: tripId) { added in
                showReuse = false
                toast = ToastMessage(text: LF("%d items taken over", added))
                Task { await load() }
            }
        }
        .alert(L("Name of the template"), isPresented: $askTemplate) {
            TextField(L("Our handover"), text: $templateName)
            Button(L("Save")) { Task { await saveTemplate() } }
            Button(L("Cancel"), role: .cancel) {}
        }
        .toast($toast)
    }

    @ViewBuilder
    private func itemsSection(_ data: HandoverOverview) -> some View {
        Section {
            if data.items.isEmpty {
                Text(L("Nothing yet. Start with a template or an earlier trip, or add the first item."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            ForEach(data.items) { i in
                Button { edit = HandoverEditTarget(item: i) } label: { itemRow(i) }
                    .accessibilityLabel(i.title)
                    .accessibilityHint(LF("Edit %@", i.title))
            }
            Button { edit = HandoverEditTarget(item: nil) } label: { Label(L("Handover item"), systemImage: "plus") }
            Button { showReuse = true } label: { Label(L("Take over …"), systemImage: "doc.on.doc") }
            if !data.items.isEmpty {
                Button {
                    templateName = L("Our handover")
                    askTemplate = true
                } label: { Label(L("Save as template"), systemImage: "square.and.arrow.down") }
            }
        } header: { Text(L("What to do")) }
    }

    private func itemRow(_ i: HandoverItem) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: HandoverLabels.icon(i.kind))
                .foregroundStyle(Theme.primaryText)
                .frame(width: 32, height: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(i.title).foregroundStyle(Theme.ink)
                let n = i.media?.count ?? 0
                Text(HandoverLabels.rhythmText(i) + (n > 0 ? " · " + LF("%d photos/videos", n) : ""))
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 4)
            Image(systemName: "pencil").font(.caption).foregroundStyle(Theme.ink3).accessibilityHidden(true)
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private func accessSection(_ access: HandoverAccess) -> some View {
        let otherLinks = links.filter { $0.id != access.sitterLinkId }
        let guests = guestPeople()
        Section {
            ForEach(otherLinks) { l in
                Toggle(isOn: Binding(get: { access.links.contains { $0.id == l.id } }, set: { on in Task { await setLink(l.id, on: on) } })) {
                    Text(l.name) + Text(" · " + L("guest link")).font(.caption).foregroundStyle(Theme.ink3)
                }
            }
            ForEach(guests, id: \.key) { g in
                Toggle(isOn: Binding(get: { access.guests.contains(g.uid) }, set: { on in Task { await setGuest(g.uid, on: on) } })) {
                    Text(g.name) + Text(" · " + L("permanent guest")).font(.caption).foregroundStyle(Theme.ink3)
                }
            }
            if otherLinks.isEmpty && guests.isEmpty {
                Text(L("Other guest links and permanent guests appear here to choose from."))
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
        } header: {
            Text(L("Who sees the handover"))
        } footer: {
            Text(access.sitterLinkId != nil
                 ? L("The house-sitter link of this trip always sees it.")
                 : L("Create the house-sitter link in the tab “House sitter” – it sees the handover automatically."))
        }
    }

    private func progressSection(_ days: [HandoverDay]) -> some View {
        Section(L("What was ticked")) {
            ForEach(days) { d in
                let ticks = d.plan.flatMap { $0.ticks ?? [] }
                let doneTicks = ticks.filter { $0.done != nil }
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
                    Label(HandoverLabels.day(d.day), systemImage: "calendar")
                        .font(.subheadline)
                    Spacer(minLength: 4)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(ticks.isEmpty ? L("nothing planned") : LF("%d of %d", doneTicks.count, ticks.count))
                            .font(.subheadline).foregroundStyle(Theme.ink)
                        let who = Self.names(doneTicks)
                        if !who.isEmpty { Text(who).font(.caption).foregroundStyle(Theme.ink3) }
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    /// who ticked, each once, in order
    static func names(_ ticks: [HandoverTick]) -> String {
        var out: [String] = []
        for t in ticks {
            if let by = t.done?.by, !by.isEmpty, !out.contains(by) { out.append(by) }
        }
        return out.joined(separator: ", ")
    }

    private struct GuestPerson { var key: String; var name: String; var uid: Int }

    /// permanent guests with an account (u<id>) – children and members cannot be chosen
    private func guestPeople() -> [GuestPerson] {
        var out: [GuestPerson] = []
        for p in people where p.kind == "guest" && p.key.hasPrefix("u") {
            if let uid = Int(p.key.dropFirst()) { out.append(GuestPerson(key: p.key, name: p.name, uid: uid)) }
        }
        return out
    }

    private func load() async {
        do {
            data = try await api.handoverOverview(trip: tripId)
            error = nil
        } catch APIError.notFound {
            error = L("Your server doesn't have this section yet.")
        } catch { self.error = APIError.from(error).localizedDescription }
        if let l = try? await api.guestLinks() { links = l }
        if let p = try? await api.peopleDirectory() { people = p }
    }

    private func saveAccess(links: [HandoverAccessLink], guests: [Int]) async {
        do {
            try await api.setHandoverAccess(trip: tripId, links: links, guests: guests)
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func setLink(_ id: Int, on: Bool) async {
        guard let access = data?.access else { return }
        var next = access.links.filter { $0.id != id }
        if on { next.append(HandoverAccessLink(id: id, until: nil)) }
        await saveAccess(links: next, guests: access.guests)
    }

    private func setGuest(_ uid: Int, on: Bool) async {
        guard let access = data?.access else { return }
        var next = access.guests.filter { $0 != uid }
        if on { next.append(uid) }
        await saveAccess(links: access.links, guests: next)
    }

    private func saveTemplate() async {
        let name = templateName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        do {
            try await api.saveHandoverTemplate(trip: tripId, name: String(name.prefix(80)))
            toast = ToastMessage(text: L("Saved as a template – take it over for the next trip."))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

struct HandoverEditTarget: Identifiable {
    var item: HandoverItem?
    let id = UUID()
}

// MARK: - item editor

/// New or edit a handover item (web: Handover.tsx ItemSheet). Photos and videos picked here are sent after saving;
/// videos are made smaller first (720p), like on Hausinfo cards.
private struct HandoverItemSheet: View {
    let api: APIClient
    let tripId: Int
    let item: HandoverItem?
    let onChanged: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "pet"
    @State private var title = ""
    @State private var instructions = ""
    @State private var rhythm = "daily"
    @State private var weekdays: [Int] = []
    @State private var day = Date()
    @State private var slots: [String] = ["morning"]
    @State private var media: [HGMedia] = []
    @State private var picks: [PhotosPickerItem] = []
    @State private var pending: [PhotosPickerItem] = []
    /// set once the item exists (a new item after its first save) – a failed upload keeps the sheet open on it
    @State private var savedId: Int?
    @State private var busy: String?
    @State private var error: String?
    @State private var confirmDelete = false

    private var canSave: Bool {
        busy == nil && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !(rhythm == "days" && weekdays.isEmpty)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section(L("Kind")) {
                    FlowLayout(spacing: Theme.Space.s2) {
                        ForEach(HandoverLabels.kinds, id: \.self) { k in
                            ChoiceChip(title: HandoverLabels.kindName(k), systemImage: HandoverLabels.icon(k), on: kind == k) { kind = k }
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section(L("What")) {
                    TextField(L("e.g. Feed the cat"), text: $title)
                        .onChange(of: title) { _, v in if v.count > 100 { title = String(v.prefix(100)) } }
                }
                Section(L("How it works")) {
                    TextField(L("e.g. Half a tin, fresh water. The food is in the left cupboard."), text: $instructions, axis: .vertical)
                        .lineLimit(4...12)
                        .onChange(of: instructions) { _, v in if v.count > 2000 { instructions = String(v.prefix(2000)) } }
                }
                Section(L("How often")) {
                    Picker(L("How often"), selection: $rhythm) {
                        ForEach(HandoverLabels.rhythms, id: \.self) { r in Text(HandoverLabels.rhythmName(r)).tag(r) }
                    }
                    .pickerStyle(.segmented)
                    if rhythm == "days" {
                        FlowLayout(spacing: Theme.Space.s2) {
                            ForEach(1...7, id: \.self) { d in
                                ChoiceChip(title: HandoverLabels.weekdays()[d - 1], on: weekdays.contains(d)) { toggleWeekday(d) }
                            }
                        }
                        .padding(.vertical, 4)
                        .accessibilityElement(children: .contain)
                        .accessibilityLabel(L("Weekdays"))
                    }
                    if rhythm == "once" {
                        DatePicker(L("Day"), selection: $day, displayedComponents: .date)
                    }
                    if rhythm != "asneeded" {
                        FlowLayout(spacing: Theme.Space.s2) {
                            ForEach(HandoverLabels.slotKeys, id: \.self) { s in
                                ChoiceChip(title: HandoverLabels.slotName(s), on: slots.contains(s)) { toggleSlot(s) }
                            }
                        }
                        .padding(.vertical, 4)
                        .accessibilityElement(children: .contain)
                        .accessibilityLabel(L("When"))
                    }
                }
                mediaSection
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                if let busy {
                    Section { HStack(spacing: Theme.Space.s2) { ProgressView(); Text(busy).font(.footnote) } }
                }
                if item != nil || savedId != nil {
                    Section { Button(L("Delete"), role: .destructive) { confirmDelete = true } }
                }
            }
            .themedList()
            .navigationTitle(item == nil && savedId == nil ? L("New item") : L("Edit item"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(pending.isEmpty ? L("Save") : L("Save and upload")) { Task { await save() } }
                        .disabled(!canSave)
                }
            }
            .confirmationDialog(L("Delete this item?"), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Delete"), role: .destructive) { Task { await remove() } }
            }
            .onChange(of: picks) { _, items in
                guard !items.isEmpty else { return }
                let room = max(0, HandoverLimits.perItem - media.count - pending.count)
                pending.append(contentsOf: items.prefix(room))
                picks = []
            }
            .onAppear {
                guard let i = item else { return }
                kind = i.kind
                title = i.title
                instructions = i.instructions ?? ""
                rhythm = i.rhythm
                weekdays = i.weekdays ?? []
                day = ServerDate.parse(i.day) ?? Date()
                slots = i.slots ?? []
                media = i.media ?? []
                savedId = i.id
            }
        }
        .interactiveDismissDisabled(busy != nil)
    }

    private var mediaSection: some View {
        Section {
            if !media.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Space.s2) {
                        ForEach(media) { m in
                            HGMediaThumb(media: m, api: api, size: 80)
                                .overlay(alignment: .topTrailing) {
                                    Button { Task { await removeMedia(m) } } label: {
                                        Image(systemName: "xmark.circle.fill").font(.title3).symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, Color.black.opacity(0.55))
                                    }
                                    .accessibilityLabel(L("Remove"))
                                    .padding(2)
                                }
                        }
                    }
                }
            }
            ForEach(pending.indices, id: \.self) { idx in
                HStack {
                    let isVideo = pending[idx].supportedContentTypes.contains { $0.conforms(to: .movie) }
                    Label(isVideo ? L("Video") : L("Photo"), systemImage: isVideo ? "video" : "photo")
                        .font(.subheadline)
                    Spacer()
                    Button { pending.remove(at: idx) } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless)
                        .foregroundStyle(Theme.empty)
                        .accessibilityLabel(L("Remove"))
                }
            }
            if busy == nil && media.count + pending.count < HandoverLimits.perItem {
                PhotosPicker(selection: $picks, maxSelectionCount: HandoverLimits.perItem - media.count - pending.count,
                             matching: .any(of: [.images, .videos])) {
                    Label(L("Add a photo or video"), systemImage: "photo.badge.plus")
                }
            }
        } header: {
            Text(L("Photos and videos"))
        } footer: {
            Text(LF("Photos, and videos of about 5 minutes – the app makes them smaller before sending (up to 100 MB). Up to %d per item.", HandoverLimits.perItem))
        }
    }

    private func toggleWeekday(_ d: Int) {
        if let i = weekdays.firstIndex(of: d) { weekdays.remove(at: i) } else { weekdays.append(d); weekdays.sort() }
    }

    private func toggleSlot(_ s: String) {
        if let i = slots.firstIndex(of: s) { slots.remove(at: i) } else { slots.append(s) }
        slots.sort { (HandoverLabels.slotKeys.firstIndex(of: $0) ?? 9) < (HandoverLabels.slotKeys.firstIndex(of: $1) ?? 9) }
    }

    private func save() async {
        error = nil
        busy = L("Saving …")
        let input = HandoverItemInput(
            kind: kind,
            title: String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100)),
            instructions: String(instructions.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000)),
            rhythm: rhythm,
            weekdays: rhythm == "days" ? weekdays : [],
            day: rhythm == "once" ? ServerDate.day(day) : nil,
            slots: rhythm == "asneeded" ? [] : slots
        )
        let saved: HandoverItem
        do {
            saved = try await api.saveHandoverItem(id: savedId, trip: tripId, input)
        } catch {
            self.error = APIError.from(error).localizedDescription
            busy = nil
            return
        }
        savedId = saved.id
        onChanged()
        let ok = await upload(to: saved.id)
        busy = nil
        if ok { dismiss() }
    }

    /// sends the picked photos and videos one by one; false when one failed (the sheet stays open on the saved item)
    private func upload(to id: Int) async -> Bool {
        var failed = false
        let items = pending
        for (n, item) in items.enumerated() {
            let count = items.count > 1 ? " (\(n + 1)/\(items.count))" : ""
            do {
                if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                    busy = L("Making the video smaller …") + count
                    guard let movie = try await item.loadTransferable(type: PickedMovie.self) else { continue }
                    let small = try await VideoShrink.shrink(movie.url)
                    defer {
                        try? FileManager.default.removeItem(at: movie.url)
                        if small != movie.url { try? FileManager.default.removeItem(at: small) }
                    }
                    let data = try Data(contentsOf: small, options: .mappedIfSafe)
                    if data.count > HandoverLimits.maxBytes {
                        error = L("Even made smaller, this video is larger than 100 MB. Shorten it in Photos (Edit › trim) and add it again.")
                        failed = true
                        continue
                    }
                    busy = L("Sending …") + count
                    media.append(try await api.uploadHandoverMedia(item: id, data: data, filename: "video.mp4", mime: "video/mp4"))
                } else {
                    busy = L("Sending …") + count
                    guard let raw = try await item.loadTransferable(type: Data.self), let img = UIImage(data: raw),
                          let jpeg = img.jpegData(compressionQuality: 0.85) else { continue }
                    media.append(try await api.uploadHandoverMedia(item: id, data: jpeg, filename: "photo.jpg", mime: "image/jpeg"))
                }
                pending.removeAll { $0 == item }
            } catch {
                self.error = APIError.from(error).localizedDescription
                failed = true
            }
        }
        if !items.isEmpty {
            onChanged()
            if !failed { Haptics.success() }
        }
        return !failed
    }

    private func removeMedia(_ m: HGMedia) async {
        guard let id = savedId else { return }
        do {
            try await api.deleteHandoverMedia(item: id, media: m.id)
            media.removeAll { $0.id == m.id }
            onChanged()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func remove() async {
        guard let id = savedId else { return }
        do {
            try await api.deleteHandoverItem(id)
            onChanged()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - taking over a template or an earlier trip

private struct HandoverReuseSheet: View {
    let api: APIClient
    let tripId: Int
    let onApplied: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var data: HandoverSources?
    @State private var error: String?
    @State private var busy = false
    @State private var deleting: HandoverTemplate?

    var body: some View {
        NavigationStack {
            List {
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                if let data {
                    Section(L("Templates")) {
                        if data.templates.isEmpty {
                            Text(L("No templates yet – “Save as template” on a trip makes one."))
                                .font(.footnote).foregroundStyle(Theme.ink2)
                        }
                        ForEach(data.templates) { x in
                            HStack(spacing: Theme.Space.s3) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(x.name).foregroundStyle(Theme.ink)
                                    let titles = (x.titles ?? []).joined(separator: ", ")
                                    if !titles.isEmpty { Text(titles).font(.caption).foregroundStyle(Theme.ink3) }
                                }
                                Spacer(minLength: 4)
                                Button(L("Take over")) { Task { await apply(templateId: x.id, fromTrip: nil) } }
                                    .buttonStyle(.bordered)
                                    .disabled(busy)
                                Button { deleting = x } label: { Image(systemName: "trash") }
                                    .buttonStyle(.borderless)
                                    .foregroundStyle(Theme.empty)
                                    .frame(minWidth: 44, minHeight: 44)
                                    .accessibilityLabel(LF("Delete %@", x.name))
                            }
                        }
                    }
                    Section {
                        if data.trips.isEmpty {
                            Text(L("No earlier trip with a handover yet."))
                                .font(.footnote).foregroundStyle(Theme.ink2)
                        }
                        ForEach(data.trips) { x in
                            HStack(spacing: Theme.Space.s3) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(x.name).foregroundStyle(Theme.ink)
                                    Text(HandoverLabels.day(x.startDay) + " · " + LF("%d items", x.count ?? 0))
                                        .font(.caption).foregroundStyle(Theme.ink3)
                                }
                                Spacer(minLength: 4)
                                Button(L("Take over")) { Task { await apply(templateId: nil, fromTrip: x.id) } }
                                    .buttonStyle(.bordered)
                                    .disabled(busy)
                            }
                        }
                    } header: {
                        Text(L("Earlier trips"))
                    } footer: {
                        Text(L("Taking over adds the items with their photos and videos – nothing already there is replaced."))
                    }
                } else if error == nil {
                    HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
                }
            }
            .themedList()
            .navigationTitle(L("Take over a handover"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .task { await load() }
            .confirmationDialog(L("Delete this template?"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                                titleVisibility: .visible) {
                Button(L("Delete"), role: .destructive) {
                    if let t = deleting { Task { await removeTemplate(t.id) } }
                    deleting = nil
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func load() async {
        do {
            data = try await api.handoverSources(trip: tripId)
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func apply(templateId: Int?, fromTrip: Int?) async {
        busy = true
        defer { busy = false }
        do {
            let r = try await api.applyHandover(trip: tripId, templateId: templateId, fromTrip: fromTrip)
            onApplied(r.added)
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func removeTemplate(_ id: Int) async {
        do {
            try await api.deleteHandoverTemplate(id)
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - guest side (permanent guests, web /uebergabe)

/// Mehr › Übergabe for a permanent guest chosen for a trip: today first (tick if you like), then how everything works.
struct HandoverGuestView: View {
    let api: APIClient
    @State private var trips: [HandoverViewerTrip]?
    @State private var error: String?
    @State private var busy = false
    @State private var toast: ToastMessage?

    init(api: APIClient) {
        self.api = api
    }

    var body: some View {
        List {
            Section {
                Text(L("While the household is away")).font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let error { Section { ErrorBanner(message: error) { Task { await load() } } }.listRowBackground(Color.clear) }
            if let trips {
                if trips.isEmpty {
                    EmptyStateView(systemImage: "pawprint", title: L("No handover right now"), message: L("It shows here while the trip is on."))
                        .listRowBackground(Color.clear)
                }
                ForEach(trips) { v in
                    HandoverDaySections(trip: v, busy: busy) { item, slot, done in
                        Task { await tick(item: item, day: v.day, slot: slot, done: done) }
                    }
                }
            } else if error == nil {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            }
        }
        .themedList()
        .navigationTitle(L("Handover"))
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
    }

    private func load() async {
        do {
            trips = try await api.handoverMine()
            error = nil
        } catch APIError.notFound {
            error = L("Your server doesn't have this section yet.")
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func tick(item: Int, day: String, slot: String, done: Bool) async {
        busy = true
        defer { busy = false }
        do {
            try await api.handoverDone(item: item, day: day, slot: slot, done: done)
            Haptics.tick()
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// One shared trip: "Today, …" with a row per item and time of day, then "How it works" (web: Handover.tsx DayList).
private struct HandoverDaySections: View {
    let trip: HandoverViewerTrip
    let busy: Bool
    let onTick: (Int, String, Bool) -> Void

    var body: some View {
        let due = trip.today.filter { !($0.ticks ?? []).isEmpty }
        let asNeeded = trip.today.filter { ($0.ticks ?? []).isEmpty }
        Section {
            if due.isEmpty {
                Text(L("Nothing planned for today.")).font(.subheadline).foregroundStyle(Theme.ink2)
            }
            ForEach(due) { i in
                ForEach(i.ticks ?? [], id: \.slot) { tk in
                    tickRow(i, tk)
                }
            }
            if !asNeeded.isEmpty {
                Text(LF("When needed: %@", asNeeded.map { $0.title }.joined(separator: ", ")))
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
        } header: {
            HStack {
                Text(LF("Today, %@", HandoverLabels.day(trip.day)))
                Spacer()
                Text(trip.trip.name).textCase(nil)
            }
        } footer: {
            Text(L("Ticking is optional – it just lets the household see that all is well."))
        }
        Section(L("How it works")) {
            ForEach(trip.items) { i in itemCard(i) }
        }
    }

    private func tickRow(_ i: HandoverItem, _ tk: HandoverTick) -> some View {
        let done = tk.done != nil
        let doneBy = tk.done.map { LF("done by %@", $0.by ?? "?") }
        return Button { onTick(i.id, tk.slot, !done) } label: {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(done ? Theme.primary : Theme.ink3)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(i.title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                        .strikethrough(done, color: Theme.ink3)
                    Text([HandoverLabels.slotName(tk.slot), doneBy].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityAddTraits(done ? .isSelected : [])
    }

    private func itemCard(_ i: HandoverItem) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
                Image(systemName: HandoverLabels.icon(i.kind)).foregroundStyle(Theme.primaryText).accessibilityHidden(true)
                Text(i.title).font(.headline).foregroundStyle(Theme.ink)
                Spacer(minLength: 4)
                Text(HandoverLabels.rhythmText(i))
                    .font(.caption2).foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Theme.surface2, in: Capsule())
            }
            if let ins = i.instructions, !ins.isEmpty {
                Text(ins).font(.subheadline).foregroundStyle(Theme.ink)
            }
            if let m = i.media, !m.isEmpty { HGMediaStrip(media: m, title: i.title).padding(.top, 4) }
        }
        .padding(.vertical, 4)
    }
}
