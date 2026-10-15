import SwiftUI

/// "Regeln für …": what a kid may wish for (whole groups or single items, hide single items of a group), limits
/// ("ice cream once a day", "sweets only after 15:00"), quiet hours and how many wishes may be open at once.
/// Web: KidsSettings.tsx RulesSheet. PATCH /api/kids/:id { rules }.
struct KidRulesView: View {
    let api: APIClient
    let kid: KidProfile
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var rules = KidRules()
    @State private var categories: [ProductCategory] = []
    @State private var products: [ProductInfo] = []
    @State private var loaded = false
    @State private var picker = false
    @State private var busy = false
    @State private var error: String?

    private var byId: [Int: ProductInfo] { Dictionary(products.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a }) }

    private var visible: [ProductInfo] {
        products.filter { p in
            !rules.blocked.contains(p.id) && (rules.products.contains(p.id) || (p.categoryId.map { rules.categories.contains($0) } ?? false))
        }
    }

    /// what a limit can point at: allowed groups and single items outside them
    private var targets: [KidTarget] {
        let groups = rules.categories.map { c in KidTarget(key: "c\(c)", name: categoryName(c)) }
        let singles = visible.filter { p in !(p.categoryId.map { rules.categories.contains($0) } ?? false) }.map { KidTarget(key: "p\($0.id)", name: $0.name) }
        return groups + singles
    }

    var body: some View {
        Form {
            if !loaded {
                Section { ProgressView().frame(maxWidth: .infinity) }.listRowBackground(Color.clear)
            } else {
                Section {
                    ForEach(categories) { c in
                        Toggle(isOn: Binding(get: { rules.categories.contains(c.id) }, set: { on in
                            if on { rules.categories.append(c.id) } else { rules.categories.removeAll { $0 == c.id } }
                        })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(c.name)
                                Text(L("whole group")).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                } header: { Text(LF("What %@ can wish for", kid.name)) }

                Section {
                    if visible.isEmpty {
                        Text(L("Nothing allowed yet – switch on a group or add single items.")).font(.subheadline).foregroundStyle(Theme.ink3)
                    } else {
                        FlowLayout(spacing: 6) {
                            ForEach(visible) { p in
                                Button { hide(p) } label: {
                                    HStack(spacing: 4) {
                                        Text(p.name)
                                        Image(systemName: "eye.slash").font(.caption2)
                                    }
                                    .font(.subheadline)
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .foregroundStyle(p.isTracked && (p.total ?? 0) <= 0 ? Theme.ink3 : Theme.ink)
                                    .background(Theme.surface2, in: Capsule())
                                    .padding(.vertical, 5)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel(LF("Hide %@", p.name))
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    Button { picker = true } label: { Label(L("Single item"), systemImage: "plus") }
                } header: { Text(LF("Visible now (%d)", visible.count)) } footer: {
                    Text(L("Only what’s in the house shows on the tablet. Keep it short – six to nine pictures work best."))
                }

                if !rules.blocked.isEmpty {
                    Section(L("Hidden from a group")) {
                        ForEach(rules.blocked, id: \.self) { id in
                            HStack {
                                Text(byId[id]?.name ?? "#\(id)").foregroundStyle(Theme.ink2)
                                Spacer()
                                Button(L("Show again")) { rules.blocked.removeAll { $0 == id } }.buttonStyle(.borderless)
                            }
                        }
                    }
                }

                Section {
                    ForEach($rules.limits) { $l in
                        LimitEditor(limit: $l, targets: targets, fallbackName: l.categoryId.map(categoryName) ?? byId[l.productId ?? -1]?.name ?? "?")
                    }
                    .onDelete { rules.limits.remove(atOffsets: $0) }
                    Button { addLimit() } label: { Label(L("Limit"), systemImage: "plus") }
                        .disabled(targets.isEmpty)
                } header: { Text(L("Limits")) } footer: {
                    Text(L("For example “ice cream once a day” or “sweets only after 15:00”."))
                }

                Section {
                    Toggle(isOn: Binding(get: { rules.quiet != nil }, set: { on in rules.quiet = on ? KidRules.Quiet(from: "19:30", to: "07:00") : nil })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Label(L("Quiet hours"), systemImage: "moon")
                            Text(L("No wishes – the tablet shows a moon.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    if let q = rules.quiet {
                        DatePicker(L("from"), selection: Binding(get: { KidTime.date(q.from) }, set: { rules.quiet?.from = KidTime.string($0) }), displayedComponents: .hourAndMinute)
                        DatePicker(L("until"), selection: Binding(get: { KidTime.date(q.to) }, set: { rules.quiet?.to = KidTime.string($0) }), displayedComponents: .hourAndMinute)
                    }
                }

                Section {
                    Picker(L("Open wishes at the same time"), selection: $rules.maxOpen) {
                        Text("1").tag(1)
                        Text("2").tag(2)
                        Text("3").tag(3)
                    }
                    .pickerStyle(.segmented)
                } header: { Text(L("Open wishes at the same time")) } footer: {
                    Text(L("More wishes only after a grown-up answered."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
        }
        .themedList()
        .navigationTitle(LF("Rules for %@", kid.name))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(L("Save")) { Task { await save() } }.disabled(busy || !loaded)
            }
        }
        .task { await load() }
        .sheet(isPresented: $picker) {
            KidProductPicker(api: api, products: products) { p in
                if !rules.products.contains(p.id) { rules.products.append(p.id) }
                rules.blocked.removeAll { $0 == p.id }
            }
        }
    }

    private func categoryName(_ id: Int) -> String { categories.first { $0.id == id }?.name ?? "?" }

    private func hide(_ p: ProductInfo) {
        if rules.products.contains(p.id) { rules.products.removeAll { $0 == p.id } } else { rules.blocked.append(p.id) }
    }

    private func addLimit() {
        guard let first = targets.first else { return }
        let id = Int(first.key.dropFirst()) ?? 0
        rules.limits.append(first.key.hasPrefix("c") ? KidLimit(categoryId: id) : KidLimit(productId: id))
    }

    private func load() async {
        guard !loaded else { return }
        rules = kid.rules
        async let c = api.categories()
        async let p = api.products()
        categories = (try? await c) ?? []
        do { products = try await p } catch { self.error = APIError.from(error).localizedDescription }
        loaded = true
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try await api.saveKid(kid.id, ["rules": rules.json])
            Haptics.success()
            saved()
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// One limit: what, how often a day, between which times.
private struct LimitEditor: View {
    @Binding var limit: KidLimit
    let targets: [KidTarget]
    let fallbackName: String

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            Picker(L("What"), selection: Binding(get: { limit.target }, set: { v in
                let id = Int(v.dropFirst())
                if v.hasPrefix("c") { limit.categoryId = id; limit.productId = nil } else { limit.productId = id; limit.categoryId = nil }
            })) {
                ForEach(targets, id: \.key) { Text($0.name).tag($0.key) }
                if !targets.contains(where: { $0.key == limit.target }) { Text(fallbackName).tag(limit.target) }
            }
            Picker(L("Per day"), selection: Binding(get: { limit.perDay ?? 0 }, set: { limit.perDay = $0 == 0 ? nil : $0 })) {
                Text(L("any number")).tag(0)
                Text(L("once a day")).tag(1)
                ForEach(2...4, id: \.self) { n in Text(LF("%d× a day", n)).tag(n) }
            }
            Toggle(L("Only between certain times"), isOn: Binding(get: { limit.from != nil || limit.to != nil }, set: { on in
                limit.from = on ? "15:00" : nil
                limit.to = on ? "18:00" : nil
            }))
            if limit.from != nil || limit.to != nil {
                DatePicker(L("from"), selection: Binding(get: { KidTime.date(limit.from ?? "00:00") }, set: { limit.from = KidTime.string($0) }), displayedComponents: .hourAndMinute)
                DatePicker(L("until"), selection: Binding(get: { KidTime.date(limit.to ?? "23:59") }, set: { limit.to = KidTime.string($0) }), displayedComponents: .hourAndMinute)
            }
        }
        .padding(.vertical, 4)
    }
}

/// What a limit can point at: "c3" (a group) or "p12" (one item).
struct KidTarget: Hashable {
    let key: String
    let name: String
}

/// "HH:MM" ⇄ Date (today) for the time pickers.
enum KidTime {
    static func date(_ s: String) -> Date {
        let parts = s.split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: parts.first ?? 0, minute: parts.count > 1 ? parts[1] : 0, second: 0, of: Date()) ?? Date()
    }
    static func string(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}

/// Pick one product (searchable).
struct KidProductPicker: View {
    let api: APIClient
    let products: [ProductInfo]
    let picked: (ProductInfo) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var hits: [ProductInfo] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let all = products.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        return q.isEmpty ? all : all.filter { $0.name.lowercased().contains(q) || ($0.brand?.lowercased().contains(q) ?? false) }
    }

    var body: some View {
        NavigationStack {
            List(hits) { p in
                Button {
                    picked(p)
                    dismiss()
                } label: {
                    HStack(spacing: Theme.Space.s3) {
                        ProductThumb(path: p.imagePath, api: api, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.name).foregroundStyle(Theme.ink)
                            if let s = p.spot { Text(s).font(.caption).foregroundStyle(Theme.ink3) }
                        }
                    }
                }
            }
            .themedList()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L("Search"))
            .navigationTitle(L("Single item"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
        }
    }
}

/// "Wo ist …? für …": up to 12 things a kid may fetch alone, and photos of the places (also for babysitters).
/// Web: KidsSettings.tsx FindSheet. PATCH /api/kids/:id { find_ids }, POST/DELETE /api/kids/places/:id/photo.
struct KidFindView: View {
    let api: APIClient
    let kid: KidProfile
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var ids: [Int] = []
    @State private var products: [ProductInfo] = []
    @State private var places: [KidPlace] = []
    @State private var loaded = false
    @State private var picker = false
    @State private var busyPlace: Int?
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                if ids.isEmpty {
                    Text(L("Nothing chosen – the tablet shows no “Where is …?”.")).font(.subheadline).foregroundStyle(Theme.ink3)
                }
                ForEach(ids, id: \.self) { id in
                    let p = products.first { $0.id == id }
                    HStack(spacing: Theme.Space.s3) {
                        ProductThumb(path: p?.imagePath, api: api, size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p?.name ?? "#\(id)")
                            if let s = p?.spot { Text(s).font(.caption).foregroundStyle(Theme.ink3) }
                        }
                    }
                }
                .onDelete { ids.remove(atOffsets: $0) }
                Button { picker = true } label: { Label(L("Add"), systemImage: "plus") }.disabled(ids.count >= 12)
            } header: { Text(LF("Things (%d/12)", ids.count)) } footer: {
                Text(LF("A few things %@ may fetch alone – plasters, toothpaste, a cup. Off by default.", kid.name))
            }
            Section {
                ForEach(places) { l in
                    HStack(spacing: Theme.Space.s3) {
                        Group {
                            if let ph = l.photo {
                                RemoteImage(url: api.imageURL(ph), api: api, placeholder: "camera")
                            } else {
                                Image(systemName: "camera").foregroundStyle(Theme.ink3).frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.surface2)
                            }
                        }
                        .frame(width: 52, height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                        .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(l.name)
                            if let h = l.hint { Text(h).font(.caption).foregroundStyle(Theme.ink3) }
                        }
                        Spacer()
                        if busyPlace == l.id { ProgressView() }
                        PhotoSourceMenu(picked: { img in Task { await upload(l, img) } }) {
                            Text(l.photo == nil ? L("Photo") : L("Replace")).font(.subheadline.weight(.semibold))
                        }
                        .disabled(busyPlace != nil)
                    }
                    .swipeActions {
                        if l.photo != nil {
                            Button(L("Remove photo"), role: .destructive) { Task { await removePhoto(l) } }
                        }
                    }
                }
            } header: { Text(L("Photos of places")) } footer: {
                Text(L("A photo of the cupboard says more than “bathroom, mirror cabinet” – for kids and babysitters."))
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(LF("Where is …? for %@", kid.name))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) { Button(L("Save")) { Task { await save() } }.disabled(!loaded) }
        }
        .task { await load() }
        .sheet(isPresented: $picker) {
            KidProductPicker(api: api, products: products) { p in if !ids.contains(p.id) && ids.count < 12 { ids.append(p.id) } }
        }
    }

    private func load() async {
        if !loaded { ids = kid.findIds }
        async let p = api.products()
        async let l = api.kidPlaces()
        products = (try? await p) ?? []
        do { places = try await l } catch { self.error = APIError.from(error).localizedDescription }
        loaded = true
    }

    private func upload(_ l: KidPlace, _ img: UIImage) async {
        busyPlace = l.id
        defer { busyPlace = nil }
        guard let jpeg = img.resizedForUpload().jpegData(compressionQuality: 0.82) else { return }
        do {
            try await api.uploadKidPlacePhoto(l.id, jpeg: jpeg)
            places = (try? await api.kidPlaces()) ?? places
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func removePhoto(_ l: KidPlace) async {
        do {
            try await api.deleteKidPlacePhoto(l.id)
            places = (try? await api.kidPlaces()) ?? places
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func save() async {
        do {
            try await api.saveKid(kid.id, ["find_ids": ids])
            Haptics.success()
            saved()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
