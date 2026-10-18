import SwiftUI

/// Settings › Places (web: pages/PlacesSettings.tsx PlacesSettings + CategorySettings, server: routes/places.ts and
/// routes/core.ts /categories). The places as a tree: order (drag or "Move up/down"), icon, name, climate, inside
/// which place, owner (shared flats), directions, archive, delete – plus the categories (where new products go and how
/// they're counted) and who lives here. Members see everything; only admins change it (the server checks too).
struct PlacesSettingsView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var places: [PlaceRow] = []
    @State private var categories: [ProductCategory] = []
    @State private var setup: HomeSetup?
    @State private var loaded = false
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var editing: PlaceRow?
    @State private var editingCategory: ProductCategory?
    @State private var newName = ""
    @State private var newParent: Int?
    @State private var newClimate = ""
    @State private var busy = false
    @State private var newCategory = false
    @State private var categoryName = ""

    private var admin: Bool { app.isAdmin }
    private var active: [PlaceRow] { places.filter { !$0.isArchived || $0.isSystem } }
    private var archived: [PlaceRow] { places.filter { $0.isArchived && !$0.isSystem } }
    private var personal: Bool { setup?.ui?.personalPlaces ?? false }

    var body: some View {
        List {
            Section {
                Text(L("Rooms, shelves and devices where things are kept – only the ones you really have."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let error { Section { ErrorBanner(message: error) { Task { await load() } } }.listRowBackground(Color.clear) }
            placesSection
            if admin { addSection }
            if !archived.isEmpty { archivedSection }
            categoriesSection
            HouseholdFormSections(api: api, setup: setup, admin: admin) { await load() }
        }
        .themedList()
        .navigationTitle(L("Places"))
        .toolbar {
            if admin && active.count > 1 {
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
            }
        }
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
        .sheet(item: $editing) { p in
            PlaceEditSheet(place: p, places: places, personal: personal, api: api) { msg in
                if let msg { toast = ToastMessage(text: msg) }
                Task { await load() }
            }
        }
        .sheet(item: $editingCategory) { c in
            CategoryEditSheet(category: c, places: active.filter { !$0.isSystem }, admin: admin, api: api) { Task { await load() } }
        }
        .alert(L("New category"), isPresented: $newCategory) {
            TextField(L("Name"), text: $categoryName)
            Button(L("Cancel"), role: .cancel) { categoryName = "" }
            Button(L("Add")) { Task { await addCategory() } }
        }
    }

    // MARK: places

    private var placesSection: some View {
        Section {
            if !loaded && error == nil {
                HStack { Spacer(); ProgressView(); Spacer() }
            } else if active.isEmpty {
                EmptyStateView(systemImage: "house", title: L("No places yet"),
                               message: L("That is fine – things you add without a place show up under “not assigned yet”. Add a place whenever it helps."))
                    .listRowBackground(Color.clear)
            }
            ForEach(active) { p in
                placeRow(p)
                    .moveDisabled(!admin || p.isSystem)
            }
            .onMove(perform: moveAction)
        } header: {
            Text(L("Places"))
        } footer: {
            if admin && active.count > 1 { Text(L("Hold and drag to change the order, or use “Edit”. A place moves among the places at the same level.")) }
        }
    }

    private func placeRow(_ p: PlaceRow) -> some View {
        let sib = p.isSystem ? [] : siblings(of: p)
        let i = sib.firstIndex { $0.id == p.id } ?? -1
        return Button {
            if admin && !p.isSystem { editing = p }
        } label: {
            HStack(spacing: Theme.Space.s3) {
                if (p.depth ?? 0) > 0 {
                    Image(systemName: "arrow.turn.down.right").font(.caption).foregroundStyle(Theme.ink3)
                        .padding(.leading, CGFloat((p.depth ?? 1) - 1) * 18)
                        .accessibilityHidden(true)
                }
                PlaceGlyph(icon: p.icon)
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.name).font(Theme.rowFont).foregroundStyle(Theme.ink)
                    let sub = subtitle(p)
                    if !sub.isEmpty { Text(sub).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2) }
                }
                Spacer(minLength: 0)
                Text("\(p.productCount ?? 0)").font(.subheadline.monospacedDigit()).foregroundStyle(Theme.ink3)
                    .accessibilityLabel(LF("%d things stored here", p.productCount ?? 0))
                if admin && !p.isSystem {
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3).accessibilityHidden(true)
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint(admin && !p.isSystem ? L("Opens the place to edit it") : "")
        .swipeActions(edge: .trailing) {
            if admin && !p.isSystem {
                Button { Task { await archive(p) } } label: { Label(L("Archive"), systemImage: "archivebox") }.tint(Theme.ink2)
            }
        }
        .contextMenu {
            if admin && !p.isSystem {
                Button { editing = p } label: { Label(L("Edit"), systemImage: "pencil") }
                Button { Task { await step(p, -1) } } label: { Label(L("Move up"), systemImage: "arrow.up") }.disabled(i <= 0)
                Button { Task { await step(p, 1) } } label: { Label(L("Move down"), systemImage: "arrow.down") }.disabled(i < 0 || i >= sib.count - 1)
                Button { Task { await archive(p) } } label: { Label(L("Archive"), systemImage: "archivebox") }
            }
        }
        .accessibilityActions {
            if admin && !p.isSystem && i > 0 { Button(L("Move up")) { Task { await step(p, -1) } } }
            if admin && !p.isSystem && i >= 0 && i < sib.count - 1 { Button(L("Move down")) { Task { await step(p, 1) } } }
        }
    }

    private func subtitle(_ p: PlaceRow) -> String {
        [p.isSystem ? L("Things without a place") : PlaceText.climate(p.climate),
         p.ownerName.map { LF("belongs to %@", $0) },
         (p.hint ?? "").isEmpty ? nil : p.hint]
            .compactMap { $0 }.joined(separator: " · ")
    }

    private var addSection: some View {
        Section {
            TextField(personal ? L("New place, e.g. Mika’s shelf, shared fridge") : L("New place, e.g. hallway cupboard, shelf above the fridge"), text: $newName)
                .submitLabel(.done)
                .onSubmit { Task { await add() } }
            Picker(L("Inside"), selection: $newParent) {
                Text(L("nowhere (top level)")).tag(Int?.none)
                ForEach(active.filter { !$0.isSystem }) { p in Text(p.label).tag(Int?.some(p.id)) }
            }
            Picker(L("Climate"), selection: $newClimate) {
                Text(L("detect from the name")).tag("")
                ForEach(PlaceText.climates, id: \.self) { c in Text(PlaceText.climate(c)).tag(c) }
            }
            Button {
                Task { await add() }
            } label: {
                Label(L("Add"), systemImage: "plus")
            }
            .disabled(busy || newName.trimmingCharacters(in: .whitespaces).isEmpty)
        } header: {
            Text(L("Add a place"))
        }
    }

    private var archivedSection: some View {
        Section {
            DisclosureGroup(archived.count == 1 ? L("1 archived place") : LF("%d archived places", archived.count)) {
                ForEach(archived) { p in
                    HStack(spacing: Theme.Space.s3) {
                        PlaceGlyph(icon: p.icon)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.label)
                            Text((p.productCount ?? 0) > 0 ? LF("%d things are still stored here", p.productCount ?? 0) : L("Empty"))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 0)
                        if admin {
                            Button(L("Bring back")) { Task { await restore(p) } }
                                .buttonStyle(.bordered).controlSize(.small)
                        }
                    }
                }
            }
        } footer: {
            Text(L("Archived places disappear from the pickers; what is stored stays visible."))
        }
    }

    // MARK: categories

    private var categoriesSection: some View {
        Section {
            ForEach(categories) { c in
                Button { editingCategory = c } label: {
                    HStack(spacing: Theme.Space.s3) {
                        PlaceGlyph(icon: "tag")
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.name).foregroundStyle(Theme.ink)
                            Text([placeName(c.defaultLocationId) ?? L("no place"), PlaceText.track(c.trackMode)].joined(separator: " · "))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3).accessibilityHidden(true)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
            }
            if admin {
                Button { categoryName = ""; newCategory = true } label: { Label(L("New category"), systemImage: "plus") }
            }
        } header: {
            Text(L("Categories"))
        } footer: {
            Text(L("Decide where new products go and how precisely they’re counted."))
        }
    }

    private func placeName(_ id: Int?) -> String? {
        guard let id else { return nil }
        return places.first { $0.id == id }?.label
    }

    // MARK: actions

    /// only admins reorder (the server checks too)
    private var moveAction: ((IndexSet, Int) -> Void)? {
        guard admin else { return nil }
        return { from, to in move(from: from, to: to) }
    }

    private func siblings(of p: PlaceRow) -> [PlaceRow] {
        active.filter { !$0.isSystem && $0.parentId == p.parentId }
    }

    private func load() async {
        do {
            async let pl = api.placeTree()
            async let c = try? api.categories()
            async let s = try? api.homeSetup()
            places = try await pl
            categories = await c ?? categories
            setup = await s ?? setup
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
        loaded = true
    }

    /// drag in the list: the place lands among its siblings at the nearest slot (web dropOn)
    private func move(from source: IndexSet, to dest: Int) {
        let list = active
        guard let i = source.first, i < list.count else { return }
        let item = list[i]
        guard !item.isSystem else { return }
        let sib = siblings(of: item)
        let flat = Dictionary(uniqueKeysWithValues: list.enumerated().map { ($1.id, $0) })
        var ids = sib.map(\.id).filter { $0 != item.id }
        let pos = ids.filter { (flat[$0] ?? 0) < dest }.count
        ids.insert(item.id, at: min(pos, ids.count))
        guard ids != sib.map(\.id) else { return }
        // show the new order right away, the server's tree follows
        var shown = list.map(\.id)
        shown.move(fromOffsets: source, toOffset: dest)
        let byId = Dictionary(uniqueKeysWithValues: places.map { ($0.id, $0) })
        places = shown.compactMap { byId[$0] } + places.filter { $0.isArchived && !$0.isSystem }
        Task { await order(ids) }
    }

    private func step(_ p: PlaceRow, _ dir: Int) async {
        var ids = siblings(of: p).map(\.id)
        guard let i = ids.firstIndex(of: p.id), i + dir >= 0, i + dir < ids.count else { return }
        ids.swapAt(i, i + dir)
        await order(ids)
    }

    private func order(_ ids: [Int]) async {
        do {
            try await api.orderPlaces(ids)
            Haptics.tick()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
        await load()
    }

    private func add() async {
        let name = String(newName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        guard !name.isEmpty, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await api.createPlace(name: name, parentId: newParent, climate: newClimate.isEmpty ? nil : newClimate)
            Haptics.success()
            newName = ""
            newClimate = ""
            toast = ToastMessage(text: LF("%@ added", name))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func archive(_ p: PlaceRow) async {
        do {
            try await api.patchPlace(p.id, ["archived": true])
            toast = ToastMessage(text: LF("%@ archived", p.name), actionTitle: L("Undo")) {
                Task { try? await api.patchPlace(p.id, ["archived": false]); await load() }
            }
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func restore(_ p: PlaceRow) async {
        do {
            try await api.patchPlace(p.id, ["archived": false])
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func addCategory() async {
        let name = categoryName.trimmingCharacters(in: .whitespacesAndNewlines)
        categoryName = ""
        guard !name.isEmpty else { return }
        do {
            try await api.createCategory(name: String(name.prefix(60)))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// The words for climates and counting – the same English source texts as the web (CLIMATE_LABEL, track modes).
enum PlaceText {
    static let climates = ["ambient", "chilled", "frozen"]

    static func climate(_ c: String?) -> String {
        switch c {
        case "chilled": return L("Chilled")
        case "frozen": return L("Freezing")
        default: return L("Room temperature")
        }
    }

    static func track(_ m: String?) -> String {
        switch m {
        case "level": return L("Fill level")
        case "none": return L("don’t count")
        default: return L("Pieces")
        }
    }
}

/// Place icon in a soft square (web `.thumb` with `Ic`).
struct PlaceGlyph: View {
    let icon: String?
    var size: CGFloat = 36

    var body: some View {
        Image(systemName: PlaceIcon.symbol(icon))
            .font(.system(size: size * 0.45))
            .foregroundStyle(Theme.primaryText)
            .frame(width: size, height: size)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .accessibilityHidden(true)
    }
}

// MARK: - one place

/// The place sheet (web PlaceSheet): icon, name, climate, inside which place, owner, directions, archive, delete.
struct PlaceEditSheet: View {
    let place: PlaceRow
    let places: [PlaceRow]
    let personal: Bool
    let api: APIClient
    /// toast text (nil = nothing to say), then reload
    let done: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var icon = ""
    @State private var climate = "ambient"
    @State private var parentId: Int?
    @State private var ownerId: Int?
    @State private var hint = ""
    @State private var members: [Member] = []
    @State private var confirmDelete = false
    @State private var busy = false
    @State private var error: String?

    private var stored: Int { place.productCount ?? 0 }

    /// every place except itself and what is inside it (the server checks too)
    private var parentOptions: [PlaceRow] {
        var blocked: Set<Int> = [place.id]
        var grew = true
        while grew {
            grew = false
            for l in places where l.parentId.map({ blocked.contains($0) }) == true && !blocked.contains(l.id) {
                blocked.insert(l.id)
                grew = true
            }
        }
        return places.filter { !$0.isSystem && !$0.isArchived && !blocked.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("Name"), text: $name)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 48), spacing: 8)], spacing: 8) {
                        ForEach(PlaceIcon.choices, id: \.self) { i in
                            Button { icon = i } label: {
                                Image(systemName: PlaceIcon.symbol(i))
                                    .font(.title3)
                                    .frame(width: 48, height: 48)
                                    .foregroundStyle(icon == i ? Theme.onPrimary : Theme.primaryText)
                                    .background(icon == i ? Theme.primary : Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(i.replacingOccurrences(of: "-", with: " "))
                            .accessibilityAddTraits(icon == i ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text(L("Name and icon"))
                }
                Section {
                    Picker(L("Climate"), selection: $climate) {
                        ForEach(PlaceText.climates, id: \.self) { c in Text(PlaceText.climate(c)).tag(c) }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text(L("Climate"))
                } footer: {
                    Text(L("“Frozen” places are offered for freezing, “chilled” ones for leftovers. Nothing else depends on the name."))
                }
                Section {
                    Picker(L("Inside"), selection: $parentId) {
                        Text(L("nowhere (top level)")).tag(Int?.none)
                        ForEach(parentOptions) { p in Text(p.label).tag(Int?.some(p.id)) }
                    }
                    if personal || place.ownerUserId != nil {
                        Picker(L("Belongs to"), selection: $ownerId) {
                            Text(L("everyone (shared)")).tag(Int?.none)
                            ForEach(members) { m in Text(m.name).tag(Int?.some(m.id)) }
                        }
                    }
                    TextField(L("Directions, e.g. in the hallway, second door on the right"), text: $hint, axis: .vertical)
                        .lineLimit(1...3)
                } footer: {
                    Text(L("Directions help babysitters and visitors find it."))
                }
                // Haushaltswissen: measurements and numbers of this room (KnowledgeView.swift)
                KnowledgeSection(api: api, ref: "l\(place.id)", name: place.name)
                Section {
                    Button {
                        Task { await archive() }
                    } label: { Label(L("Archive"), systemImage: "archivebox") }
                    Button(role: .destructive) {
                        confirmDelete = true
                    } label: { Label(L("Delete"), systemImage: "trash") }
                    .disabled(stored > 0)
                } footer: {
                    Text(stored > 0 ? L("There is still something stored at this location.") + " " + L("Archived places disappear from the pickers; what is stored stays visible.")
                         : (place.children ?? 0) > 0 ? L("Archived places disappear from the pickers; what is stored stays visible. Deleting moves the places inside one level up.")
                         : L("Archived places disappear from the pickers; what is stored stays visible."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(place.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog(LF("Delete %@?", place.name), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Delete"), role: .destructive) { Task { await remove() } }
            } message: {
                Text((place.children ?? 0) > 0 ? L("The places inside move one level up. Nothing that is stored gets lost.") : L("The place is empty, nothing gets lost."))
            }
            .onAppear(perform: fill)
            .task { members = (try? await api.members()) ?? [] }
        }
        .presentationDetents([.large])
    }

    private func fill() {
        name = place.name
        icon = place.icon ?? ""
        climate = place.climate ?? "ambient"
        parentId = place.parentId
        ownerId = place.ownerUserId
        hint = place.hint ?? ""
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var b: [String: Any] = [:]
        let n = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        if n != place.name { b["name"] = n }
        if !icon.isEmpty && icon != (place.icon ?? "") { b["icon"] = icon }
        if climate != (place.climate ?? "ambient") { b["climate"] = climate }
        if parentId != place.parentId { b["parent_id"] = parentId.map { $0 as Any } ?? NSNull() }
        if ownerId != place.ownerUserId { b["owner_user_id"] = ownerId.map { $0 as Any } ?? NSNull() }
        let h = String(hint.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        if h != (place.hint ?? "") { b["hint"] = h.isEmpty ? NSNull() : h }
        do {
            if !b.isEmpty { try await api.patchPlace(place.id, b) }
            Haptics.success()
            done(nil)
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func archive() async {
        do {
            try await api.patchPlace(place.id, ["archived": true])
            done(LF("%@ archived", place.name))
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func remove() async {
        do {
            try await api.deletePlace(place.id)
            Haptics.success()
            done(LF("%@ deleted", place.name))
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - one category

/// Category: where new products go and how they're counted (web CategorySettings); admins can also rename it.
struct CategoryEditSheet: View {
    let category: ProductCategory
    let places: [PlaceRow]
    let admin: Bool
    let api: APIClient
    let done: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var placeId: Int?
    @State private var track = "count"
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("Name"), text: $name).disabled(!admin)
                }
                Section {
                    Picker(L("Place for new products"), selection: $placeId) {
                        Text(L("no place")).tag(Int?.none)
                        ForEach(places) { p in Text(p.label).tag(Int?.some(p.id)) }
                    }
                    Picker(L("How to count"), selection: $track) {
                        Text(L("Pieces")).tag("count")
                        Text(L("Fill level")).tag("level")
                        Text(L("don’t count")).tag("none")
                    }
                } footer: {
                    Text(L("Only for new products – what is already there keeps its place and counting."))
                }
                .disabled(!admin)
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(category.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(admin ? L("Cancel") : L("Done")) { dismiss() } }
                if admin {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(L("Save")) { Task { await save() } }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .onAppear {
                name = category.name
                placeId = category.defaultLocationId
                track = category.trackMode ?? "count"
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        var b: [String: Any] = [:]
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if n != category.name { b["name"] = n }
        if placeId != category.defaultLocationId { b["default_location_id"] = placeId.map { $0 as Any } ?? NSNull() }
        if track != (category.trackMode ?? "count") { b["track_mode"] = track }
        do {
            if !b.isEmpty { try await api.patchCategory(category.id, b) }
            done()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - household form

/// Who lives here and how (web HouseholdFormCard): changes only what the app shows and suggests. Reusable – the
/// Settings › Household screen can show the same sections.
struct HouseholdFormSections: View {
    let api: APIClient
    let setup: HomeSetup?
    let admin: Bool
    let reload: () async -> Void
    @State private var error: String?

    private var forms: [(String, String, String)] {
        [
            ("single", L("Just me"), L("No “who’s getting it”, no votes – just your lists.")),
            ("couple", L("The two of us"), L("Shared lists, votes for dinner, no kids section.")),
            ("family", L("Family"), L("Everything, including kids and guests.")),
            ("shared", L("Shared flat"), L("Shared and personal places, no family wording.")),
        ]
    }
    private var presets: [(String, String)] {
        [("flat", L("Flat")), ("terraced", L("Terraced house")), ("house", L("House")), ("shared", L("Shared flat or shared home")), ("other", L("Something else"))]
    }

    var body: some View {
        Section {
            ForEach(forms, id: \.0) { f in
                let on = setup?.form == f.0 && setup?.formChosen == true
                Button {
                    Task { await save(["form": f.0]) }
                } label: {
                    HStack(spacing: Theme.Space.s3) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(f.1).foregroundStyle(Theme.ink)
                            Text(f.2).font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 0)
                        if on { Image(systemName: "checkmark").foregroundStyle(Theme.primaryText) }
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!admin)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        } header: {
            Text(L("Who lives here?"))
        } footer: {
            Text(L("This only changes what the app shows and suggests – nothing is locked, and you can switch any time."))
        }
        Section {
            FlowLayout(spacing: 8) {
                ForEach(presets, id: \.0) { p in
                    ChoiceChip(title: p.1, on: setup?.preset == p.0) {
                        guard admin else { return }
                        let value: Any = setup?.preset == p.0 ? NSNull() : p.0
                        Task { await save(["preset": value]) }
                    }
                    .disabled(!admin)
                }
            }
            .padding(.vertical, 4)
            if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
        } header: {
            Text(L("How do you live?"))
        } footer: {
            Text(L("Only for suggestions and the picture of your home – places are always your own."))
        }
    }

    private func save(_ body: [String: Any]) async {
        do {
            try await api.saveHomeSetup(body)
            Haptics.tick()
            error = nil
            await reload()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
