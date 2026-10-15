import SwiftUI

/// The order menu (web: /bestellen/karte, Menu.tsx): groups, items, pictures, choices, who sees what, stock links and
/// templates – one place for everything the household, guests and parties can ask for.
/// Native: drag to reorder items (Edit), swipe to hide or take off the menu, hold for "who sees it".
/// Permanent guests can look but not change (like the web).
struct MenuEditorView: View {
    let store: ServerStore
    @Environment(AppModel.self) private var app
    @State private var data: MenuData?
    @State private var error: String?
    @State private var editing: MenuEditItem?
    @State private var creating: GroupKey?
    @State private var stockFor: GroupKey?
    @State private var showTemplates = false
    @State private var showNewGroup = false
    @State private var renaming: MenuGroup?
    @State private var renameText = ""
    @State private var removingGroup: MenuGroup?
    @State private var removingItem: MenuEditItem?
    @State private var editMode: EditMode = .inactive
    @State private var toast: ToastMessage?

    struct GroupKey: Identifiable { let groupId: Int?; var id: String { "\(groupId ?? -1)" } }

    private var api: APIClient { store.api }
    private var canEdit: Bool { !app.isGuest }
    private var groups: [MenuGroup] { data?.groups ?? [] }

    var body: some View {
        List {
            Section {
                Text(L("The little things your household can ask each other for – and what guests and parties see. Changes show up right away."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
                if !canEdit {
                    Label(L("Only the household can change the menu – you can look at it here."), systemImage: "eye")
                        .font(.footnote).foregroundStyle(Theme.ink2)
                }
                if data?.partyLive == true {
                    Label(L("A party is on – items for “Parties” are visible right now."), systemImage: "party.popper")
                        .font(.footnote).foregroundStyle(Theme.clay)
                }
            }
            if canEdit {
                Section {
                    Button { stockFor = GroupKey(groupId: nil) } label: { Label(L("Add from stock"), systemImage: "shippingbox") }
                    Button { creating = GroupKey(groupId: nil) } label: { Label(L("Menu-only item"), systemImage: "plus") }
                    Button { showTemplates = true } label: { Label(L("Templates"), systemImage: "sparkles") }
                    Button { showNewGroup = true } label: { Label(L("New group"), systemImage: "folder.badge.plus") }
                }
            }
            if let error, data == nil {
                Section { ErrorBanner(message: error) { Task { await load() } } }
            } else if data == nil {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }
            }
            if let d = data, (d.count ?? 0) == 0, groups.allSatisfy({ $0.items.isEmpty }) {
                Section {
                    EmptyStateView(systemImage: "fork.knife", title: L("Nothing on the menu yet"),
                                   message: L("Start with a template, add drinks and snacks from your stock, or make your own items like tap water or coffee."),
                                   actionTitle: canEdit ? L("Templates") : nil, action: canEdit ? { showTemplates = true } : nil)
                        .listRowBackground(Color.clear)
                }
            }
            ForEach(Array(groups.enumerated()), id: \.element.id) { gi, g in
                Section {
                    if g.items.isEmpty {
                        Text(L("Empty – add something here.")).font(.subheadline).foregroundStyle(Theme.ink3)
                    }
                    ForEach(g.items) { it in itemRow(it) }
                        .onMove { from, to in move(in: g, from: from, to: to) }
                        .moveDisabled(!canEdit)
                    if canEdit && editMode == .inactive {
                        HStack(spacing: Theme.Space.s4) {
                            Button { stockFor = GroupKey(groupId: g.id) } label: { Label(L("From your stock"), systemImage: "shippingbox") }
                            Button { creating = GroupKey(groupId: g.id) } label: { Label(L("Menu-only"), systemImage: "plus") }
                        }
                        .font(.subheadline)
                        .buttonStyle(.borderless)
                    }
                } header: { groupHeader(g, index: gi) }
            }
            if canEdit && data != nil {
                Section {} footer: {
                    Text(L("“From stock” items are marked out when they run out, and serving books them out. Menu-only items (tap water, coffee) are never counted – give them ingredients from stock to see when milk or coffee runs low."))
                }
            }
        }
        .themedList()
        .environment(\.editMode, $editMode)
        .navigationTitle(L("The menu"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if canEdit && !groups.isEmpty {
                ToolbarItem(placement: .primaryAction) {
                    Button(editMode == .active ? L("Done") : L("Sort")) {
                        withAnimation { editMode = editMode == .active ? .inactive : .active }
                    }
                }
            }
        }
        .task(id: store.revision("products") + store.revision("orders")) { await load() }
        .refreshable { await load() }
        .sheet(item: $editing) { it in
            MenuItemSheet(store: store, item: it, groups: groups, presetGroup: nil) { msg in done(msg) }
        }
        .sheet(item: $creating) { k in
            MenuItemSheet(store: store, item: nil, groups: groups, presetGroup: k.groupId) { msg in done(msg) }
        }
        .sheet(item: $stockFor) { k in
            MenuStockPicker(store: store, groups: groups, presetGroup: k.groupId) { Task { await load() } }
        }
        .sheet(isPresented: $showTemplates) {
            MenuTemplatesSheet(api: api) { r in
                Task {
                    await load()
                    if let hint = r.stockHint, !hint.isEmpty {
                        try? await Task.sleep(nanoseconds: 500_000_000)
                        stockFor = GroupKey(groupId: r.groupId)
                    }
                }
            }
        }
        .sheet(isPresented: $showNewGroup) {
            NewMenuGroupSheet(api: api) { Task { await load() } }
        }
        .alert(L("Group name"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField(L("Name"), text: $renameText)
            Button(L("Save")) {
                if let g = renaming { Task { await run(L("Saved")) { try await api.renameMenuGroup(g.id, name: String(renameText.trimmingCharacters(in: .whitespaces).prefix(40))) } } }
            }
            Button(L("Cancel"), role: .cancel) {}
        }
        .confirmationDialog(removeGroupTitle, isPresented: Binding(get: { removingGroup != nil }, set: { if !$0 { removingGroup = nil } }),
                            titleVisibility: .visible, presenting: removingGroup) { g in
            Button(L("Remove group"), role: .destructive) { Task { await removeGroup(g) } }
            Button(L("Cancel"), role: .cancel) {}
        }
        .confirmationDialog(removingItem.map { $0.fromStock ? LF("Take “%@” off the menu? It stays in your stock.", $0.name) : LF("Take “%@” off the menu?", $0.name) } ?? "",
                            isPresented: Binding(get: { removingItem != nil }, set: { if !$0 { removingItem = nil } }),
                            titleVisibility: .visible, presenting: removingItem) { it in
            Button(L("Off the menu"), role: .destructive) { Task { await run(nil) { try await api.removeMenuItem(it.id) } } }
            Button(L("Cancel"), role: .cancel) {}
        }
        .toast($toast)
    }

    // MARK: rows

    private func itemRow(_ it: MenuEditItem) -> some View {
        Button { if canEdit { editing = it } } label: {
            HStack(spacing: Theme.Space.s3) {
                RemoteImage(url: api.imageURL(it.imagePath), api: api, placeholder: it.fromStock ? "shippingbox" : "cup.and.saucer")
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(it.name).foregroundStyle(Theme.ink)
                    Text(source(it)).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2)
                    let tags = badges(it)
                    if !tags.isEmpty {
                        FlowLayout(spacing: 4) {
                            ForEach(tags, id: \.text) { b in
                                Text(b.text).font(.caption2.weight(.semibold))
                                    .padding(.horizontal, 6).padding(.vertical, 2)
                                    .foregroundStyle(b.ink)
                                    .background(b.bg, in: Capsule())
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!canEdit)
        .swipeActions(edge: .trailing) {
            if canEdit {
                Button(role: .destructive) { removingItem = it } label: { Label(L("Off the menu"), systemImage: "trash") }
                let hidden = it.availability == "hidden"
                Button { Task { await setAvailability(it, hidden ? "available" : "hidden") } } label: {
                    Label(hidden ? L("Show") : L("Hide"), systemImage: hidden ? "eye" : "eye.slash")
                }
                .tint(Theme.info)
            }
        }
        .contextMenu {
            if canEdit {
                Button { editing = it } label: { Label(L("Edit"), systemImage: "pencil") }
                Menu {
                    ForEach(MenuAvailability.all, id: \.self) { a in
                        Button { Task { await setAvailability(it, a) } } label: {
                            if (it.availability ?? "available") == a { Label(MenuAvailability.label(a), systemImage: "checkmark") } else { Text(MenuAvailability.label(a)) }
                        }
                    }
                } label: { Label(L("Who sees it"), systemImage: "eye") }
                Button(role: .destructive) { removingItem = it } label: { Label(L("Off the menu"), systemImage: "trash") }
            }
        }
    }

    private func source(_ it: MenuEditItem) -> String {
        if it.fromStock { return LF("from stock · %@", MenuQty.text(it.total, unit: it.unit, trackMode: it.trackMode)) }
        if !it.ingredients.isEmpty { return LF("menu-only · uses %@", it.ingredients.map(\.name).joined(separator: ", ")) }
        return L("menu-only")
    }

    private struct Badge { let text: String; let ink: Color; let bg: Color }

    private func badges(_ it: MenuEditItem) -> [Badge] {
        var out: [Badge] = []
        if let a = it.availability, a != "available" { out.append(Badge(text: MenuAvailability.label(a), ink: Theme.info, bg: Theme.infoSoft)) }
        if let h = it.hint, !h.isEmpty {
            out.append(it.state == "out" ? Badge(text: h, ink: Theme.empty, bg: Theme.emptySoft) : Badge(text: h, ink: Theme.low, bg: Theme.lowSoft))
        }
        if !it.options.isEmpty { out.append(Badge(text: L("with choices"), ink: Theme.ink2, bg: Theme.surface2)) }
        if it.askNote == true { out.append(Badge(text: L("asks for a note"), ink: Theme.ink2, bg: Theme.surface2)) }
        return out
    }

    private func groupHeader(_ g: MenuGroup, index: Int) -> some View {
        HStack {
            Text(g.name)
            Text("\(g.items.count)").foregroundStyle(Theme.ink3)
            Spacer()
            if canEdit {
                Menu {
                    Button { renameText = g.name; renaming = g } label: { Label(L("Rename"), systemImage: "pencil") }
                    Button { Task { await moveGroup(index, -1) } } label: { Label(L("Move group up"), systemImage: "arrow.up") }
                        .disabled(index == 0)
                    Button { Task { await moveGroup(index, 1) } } label: { Label(L("Move group down"), systemImage: "arrow.down") }
                        .disabled(index == groups.count - 1)
                    Button(role: .destructive) { removingGroup = g } label: { Label(L("Remove group"), systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.body).frame(minWidth: 44, minHeight: 32)
                }
                .accessibilityLabel(LF("Group “%@”", g.name))
            }
        }
    }

    private var removeGroupTitle: String {
        guard let g = removingGroup else { return "" }
        if g.items.isEmpty { return LF("Remove the group “%@”?", g.name) }
        if let o = otherGroup(g) { return LF("Remove “%@”? Its %d items move to “%@”.", g.name, g.items.count, o.name) }
        return LF("Remove “%@” and take its %d items off the menu?", g.name, g.items.count)
    }

    private func otherGroup(_ g: MenuGroup) -> MenuGroup? {
        guard let i = groups.firstIndex(where: { $0.id == g.id }) else { return nil }
        return i + 1 < groups.count ? groups[i + 1] : i > 0 ? groups[i - 1] : nil
    }

    // MARK: actions

    private func load() async {
        do { data = try await api.menuData(); error = nil }
        catch { self.error = APIError.from(error).localizedDescription }
    }

    private func run(_ ok: String?, _ fn: () async throws -> Void) async {
        do {
            try await fn()
            if let ok { toast = ToastMessage(text: ok) }
            store.touch("products")
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
            await load()
        }
    }

    private func done(_ msg: String?) {
        if let msg { toast = ToastMessage(text: msg) }
        store.touch("products")
        Task { await load() }
    }

    private func setAvailability(_ it: MenuEditItem, _ a: String) async {
        await run(nil) { try await api.patchMenuItem(it.id, ["availability": a]) }
        Haptics.tick()
    }

    private func move(in g: MenuGroup, from: IndexSet, to: Int) {
        guard let gi = data?.groups.firstIndex(where: { $0.id == g.id }) else { return }
        data?.groups[gi].items.move(fromOffsets: from, toOffset: to)
        let ids = data?.groups[gi].items.map(\.id) ?? []
        Task { await run(nil) { try await api.orderMenuItems(group: g.id, ids: ids) } }
    }

    private func moveGroup(_ i: Int, _ d: Int) async {
        var ids = groups.map(\.id)
        let j = i + d
        guard j >= 0, j < ids.count else { return }
        ids.swapAt(i, j)
        await run(nil) { try await api.orderMenuGroups(ids) }
    }

    private func removeGroup(_ g: MenuGroup) async {
        let other = g.items.isEmpty ? nil : otherGroup(g)
        await run(nil) { try await api.deleteMenuGroup(g.id, moveTo: other?.id, removeItems: !g.items.isEmpty && other == nil) }
    }
}

// MARK: - templates, groups, stock

struct MenuTemplatesSheet: View {
    let api: APIClient
    let onApplied: (MenuTemplateResult) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var list: [MenuTemplateInfo]?
    @State private var busy: String?
    @State private var error: String?
    @State private var toast: ToastMessage?

    var body: some View {
        NavigationStack {
            List {
                if let list {
                    ForEach(list) { k in
                        HStack(alignment: .top, spacing: Theme.Space.s3) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(k.title).font(.headline)
                                if let l = k.lead { Text(l).font(.subheadline).foregroundStyle(Theme.ink2) }
                                Text((k.items ?? []).joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink3)
                            }
                            Spacer(minLength: 0)
                            if k.applied == true {
                                Text(L("Added")).font(.subheadline).foregroundStyle(Theme.ink3)
                            } else {
                                Button(L("Add")) { Task { await apply(k) } }
                                    .buttonStyle(.bordered)
                                    .disabled(busy != nil)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } else if let error {
                    Text(error).foregroundStyle(Theme.empty)
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }
                }
            }
            .themedList()
            .navigationTitle(L("Templates"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .toast($toast)
            .task {
                do { list = try await api.menuTemplates() } catch { self.error = APIError.from(error).localizedDescription }
            }
        }
    }

    private func apply(_ k: MenuTemplateInfo) async {
        busy = k.key
        defer { busy = nil }
        do {
            let r = try await api.applyMenuTemplate(k.key)
            let n = r.added?.count ?? 0
            Haptics.success()
            onApplied(r)
            if (r.stockHint ?? []).isEmpty {
                toast = ToastMessage(text: n > 0 ? LF("%d added to “%@”", n, k.group ?? "") : L("Everything from this template is already on the menu."))
                list = try? await api.menuTemplates()
            } else {
                dismiss()
            }
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

struct NewMenuGroupSheet: View {
    let api: APIClient
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("e.g. Hot drinks"), text: $name).focused($focused).submitLabel(.done)
                        .onSubmit { Task { await save() } }
                } header: { Text(L("Name")) }
                Section {
                    FlowLayout(spacing: 8) {
                        ForEach([L("Drinks"), L("Hot drinks"), L("Snacks"), L("Ice cream"), L("Takeaway")], id: \.self) { x in
                            ChoiceChip(title: x, on: name == x) { name = x }
                        }
                    }
                    .padding(.vertical, 4)
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("New group"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Add group")) { Task { await save() } }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }

    private func save() async {
        let n = String(name.trimmingCharacters(in: .whitespaces).prefix(40))
        guard !n.isEmpty else { return }
        do {
            try await api.createMenuGroup(n)
            onDone()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// "Add from stock": drinks, snacks and ice cream you have at home first, search for anything else.
struct MenuStockPicker: View {
    let store: ServerStore
    let groups: [MenuGroup]
    let presetGroup: Int?
    let onAdded: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var group: Int?
    @State private var hits: [MenuSuggestion]?
    @State private var added: Set<Int> = []
    @State private var toast: ToastMessage?

    var body: some View {
        NavigationStack {
            List {
                if !groups.isEmpty {
                    Section {
                        FlowLayout(spacing: 8) {
                            ForEach(groups) { g in ChoiceChip(title: g.name, on: group == g.id) { group = g.id } }
                        }
                        .padding(.vertical, 4)
                    } header: { Text(L("Into the group")) }
                }
                Section {
                    if let hits {
                        if hits.isEmpty {
                            Text(query.isEmpty ? L("No drinks, snacks or ice cream in stock yet – search for anything else.")
                                               : LF("Nothing in stock matches “%@”.", query))
                                .font(.subheadline).foregroundStyle(Theme.ink3)
                        }
                        ForEach(hits) { p in
                            Button { Task { await add(p) } } label: {
                                HStack(spacing: Theme.Space.s3) {
                                    ProductThumb(path: p.imagePath, api: store.api, size: 40)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(p.name).foregroundStyle(Theme.ink)
                                        Text([p.brand, MenuQty.text(p.total, unit: p.unit, trackMode: p.trackMode)].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                            .font(.caption).foregroundStyle(Theme.ink3)
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: added.contains(p.id) ? "checkmark.circle.fill" : "plus.circle")
                                        .foregroundStyle(Theme.primaryText)
                                        .accessibilityLabel(added.contains(p.id) ? L("Added") : L("Add"))
                                }
                            }
                            .disabled(added.contains(p.id))
                        }
                    } else {
                        HStack { Spacer(); ProgressView(); Spacer() }
                    }
                } footer: {
                    if query.isEmpty { Text(L("Suggestions: drinks, snacks and ice cream you have at home.")) }
                }
            }
            .themedList()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L("Search your stock – cola, crisps, ice cream …"))
            .navigationTitle(L("Add from stock"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .toast($toast)
            .onAppear { if group == nil { group = presetGroup ?? groups.first?.id } }
            .task(id: query) {
                if !query.isEmpty { try? await Task.sleep(nanoseconds: 250_000_000) }
                if Task.isCancelled { return }
                hits = (try? await store.api.menuSuggestions(query.trimmingCharacters(in: .whitespaces))) ?? []
            }
        }
    }

    private func add(_ p: MenuSuggestion) async {
        do {
            var body: [String: Any] = ["source": "stock", "product_id": p.id]
            if let group { body["group_id"] = group }
            try await store.api.addMenuItem(body)
            added.insert(p.id)
            Haptics.tick()
            toast = ToastMessage(text: LF("“%@” is on the menu", p.name))
            store.touch("products")
            onAdded()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// Pick a stock product (ingredient, or "take it from a stock product instead").
struct MenuProductPicker: View {
    let api: APIClient
    let title: String
    let onPick: (BarProduct) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var products: [BarProduct]?
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                if let products {
                    let q = query.trimmingCharacters(in: .whitespaces).lowercased()
                    let list = products.filter { $0.trackMode != "none" && (q.isEmpty || "\($0.name) \($0.brand ?? "")".lowercased().contains(q)) }
                    ForEach(list.prefix(80)) { p in
                        Button { onPick(p); dismiss() } label: {
                            HStack(spacing: Theme.Space.s3) {
                                ProductThumb(path: p.imagePath, api: api, size: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.name).foregroundStyle(Theme.ink)
                                    Text(p.amountText).font(.caption).foregroundStyle(Theme.ink3)
                                }
                            }
                        }
                    }
                } else {
                    HStack { Spacer(); ProgressView(); Spacer() }
                }
            }
            .themedList()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .task { products = (try? await api.barProducts()) ?? [] }
        }
    }
}

// MARK: - item sheet

/// A choice group while editing ("Milk": cow's, oat; pick one; required; preselected).
struct OptionDraft: Identifiable, Hashable {
    var id = UUID()
    var group: String
    var choices: [String]
    var multi: Bool
    var required: Bool
    var defaults: [String]
    var newChoice = ""

    init(group: String, choices: [String], multi: Bool, required: Bool, defaults: [String]) {
        self.group = group
        self.choices = choices
        self.multi = multi
        self.required = required
        self.defaults = defaults
    }

    init(_ o: MenuOption) {
        self.init(group: o.group, choices: o.choices, multi: o.multi ?? false, required: o.required ?? false, defaults: o.default ?? [])
    }

    var json: [String: Any] {
        let c = choices.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return ["group": group.trimmingCharacters(in: .whitespaces), "choices": c, "multi": multi, "required": required,
                "default": defaults.filter(c.contains)]
    }
    var isValid: Bool { !group.trimmingCharacters(in: .whitespaces).isEmpty && choices.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty } }

    static func presets() -> [OptionDraft] {
        [OptionDraft(group: L("Size"), choices: [L("Small"), L("Large")], multi: false, required: true, defaults: [L("Small")]),
         OptionDraft(group: L("Milk"), choices: [L("Cow’s milk"), L("Oat milk"), L("Lactose-free")], multi: false, required: false, defaults: []),
         OptionDraft(group: L("Sugar"), choices: [L("No sugar"), L("A little"), L("Lots")], multi: false, required: false, defaults: [])]
    }
}

struct IngredientDraft: Identifiable, Hashable {
    var productId: Int
    var name: String
    var unit: String?
    var amount: Double
    var id: Int { productId }
}

struct MenuItemSheet: View {
    let store: ServerStore
    let item: MenuEditItem?
    let groups: [MenuGroup]
    let presetGroup: Int?
    let onDone: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var desc = ""
    @State private var groupId: Int?
    @State private var unit = ""
    @State private var availability = "available"
    @State private var whenOut = "mark"
    @State private var askNote = false
    @State private var noteHint = ""
    @State private var options: [OptionDraft] = []
    @State private var ingredients: [IngredientDraft] = []
    @State private var picking: PickMode?
    @State private var showPhoto = false
    @State private var confirmRemove = false
    @State private var busy = false
    @State private var error: String?
    @State private var imagePath: String?
    @State private var filled = false

    enum PickMode: String, Identifiable { case ingredient, link; var id: String { rawValue } }

    private var isNew: Bool { item == nil }
    private var fromStock: Bool { item?.fromStock == true }

    var body: some View {
        NavigationStack {
            Form {
                if let item {
                    Section {
                        HStack(spacing: Theme.Space.s4) {
                            RemoteImage(url: store.api.imageURL(imagePath), api: store.api, placeholder: "photo")
                                .frame(width: 72, height: 72)
                                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 4) {
                                Button { showPhoto = true } label: {
                                    Label(imagePath == nil ? L("Add a picture") : L("Change picture"), systemImage: "camera")
                                }
                                .buttonStyle(.bordered)
                                if item.fromStock { Text(L("Same picture as in stock.")).font(.caption).foregroundStyle(Theme.ink3) }
                            }
                        }
                    }
                }
                Section {
                    TextField(L("e.g. Cappuccino, tap water, fruit plate"), text: $name)
                        .onChange(of: name) { _, v in if v.count > 80 { name = String(v.prefix(80)) } }
                } header: { Text(L("Name")) } footer: {
                    if fromStock { Text(L("This also renames it in stock.")) }
                }
                Section {
                    TextField(L("e.g. with oat milk foam, ice cold"), text: $desc)
                        .onChange(of: desc) { _, v in if v.count > 200 { desc = String(v.prefix(200)) } }
                } header: { Text(L("Short description (optional)")) }
                if !groups.isEmpty {
                    Section {
                        Picker(L("Group"), selection: Binding(get: { groupId ?? groups.first?.id ?? 0 }, set: { groupId = $0 })) {
                            ForEach(groups) { g in Text(g.name).tag(g.id) }
                        }
                    }
                }
                Section {
                    Picker(L("Who sees it"), selection: $availability) {
                        ForEach(MenuAvailability.all, id: \.self) { a in Text(MenuAvailability.label(a)).tag(a) }
                    }
                    .pickerStyle(.segmented)
                } header: { Text(L("Who sees it")) } footer: { Text(MenuAvailability.help(availability)) }

                if fromStock, let item {
                    Section {
                        LabeledContent(L("From your stock"), value: MenuQty.text(item.total, unit: item.unit, trackMode: item.trackMode))
                        NavigationLink(L("Open in stock")) { ProductDetailView(productId: item.id, store: store) }
                        Picker(L("When it runs out"), selection: $whenOut) {
                            Text(L("Show as “all gone”")).tag("mark")
                            Text(L("Hide it")).tag("hide")
                        }
                    } footer: { Text(L("Serving an order books it out of stock.")) }
                } else {
                    Section {
                        ForEach($ingredients) { $ing in
                            HStack {
                                Text(ing.name).lineLimit(1)
                                Spacer(minLength: 0)
                                TextField("0", value: $ing.amount, format: .number)
                                    .keyboardType(.decimalPad)
                                    .multilineTextAlignment(.trailing)
                                    .frame(width: 64)
                                    .accessibilityLabel(L("Amount per serving"))
                                Text(ing.unit ?? "").font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .onDelete { ingredients.remove(atOffsets: $0) }
                        if ingredients.count < 3 {
                            Button { picking = .ingredient } label: { Label(L("Ingredient from stock"), systemImage: "plus") }
                        }
                        if !isNew {
                            Button { picking = .link } label: { Label(L("Take it from a stock product instead"), systemImage: "bolt") }
                        }
                    } header: {
                        Text(L("Menu-only"))
                    } footer: {
                        Text(L("Not counted in stock – it’s simply there (tap water, coffee).") + " "
                             + L("E.g. a cappuccino uses milk and coffee: when one of them is low, it shows “maybe not”. Serving books the amount per serving (counted items only; 0 = just watch it)."))
                    }
                }

                ForEach($options) { $o in
                    Section {
                        HStack {
                            TextField(L("e.g. Milk"), text: $o.group).accessibilityLabel(L("Name of the choice"))
                            Button(role: .destructive) { options.removeAll { $0.id == o.id } } label: { Image(systemName: "trash") }
                                .buttonStyle(.borderless)
                                .accessibilityLabel(L("Remove choice"))
                        }
                        FlowLayout(spacing: 6) {
                            ForEach(o.choices, id: \.self) { c in
                                choiceChip(c, on: o.defaults.contains(c), toggle: { toggleDefault(o.id, c) }, remove: { removeChoice(o.id, c) })
                            }
                        }
                        .padding(.vertical, 2)
                        HStack {
                            TextField(L("Add …"), text: $o.newChoice).onSubmit { addChoice(o.id) }
                                .accessibilityLabel(L("New choice"))
                            Button { addChoice(o.id) } label: { Image(systemName: "plus.circle.fill") }
                                .buttonStyle(.borderless)
                                .disabled(o.newChoice.trimmingCharacters(in: .whitespaces).isEmpty || o.choices.count >= 12)
                                .accessibilityLabel(L("Add"))
                        }
                        Picker(L("Choices"), selection: Binding(get: { o.multi }, set: { v in setMulti(o.id, v) })) {
                            Text(L("Pick one")).tag(false)
                            Text(L("Pick several")).tag(true)
                        }
                        .pickerStyle(.segmented)
                        Toggle(L("Required"), isOn: $o.required).tint(Theme.primary)
                    } header: {
                        Text(o.group.isEmpty ? L("Choices") : o.group)
                    } footer: { Text(L("Tap a choice to preselect it.")) }
                }
                Section {
                    if options.isEmpty {
                        Text(L("E.g. size, milk or sugar – guests tap what they want.")).font(.subheadline).foregroundStyle(Theme.ink3)
                    }
                    FlowLayout(spacing: 8) {
                        ChoiceChip(title: L("Add a choice"), systemImage: "plus", on: false) {
                            options.append(OptionDraft(group: "", choices: [], multi: false, required: false, defaults: []))
                        }
                        ForEach(OptionDraft.presets().filter { p in !options.contains { $0.group.lowercased() == p.group.lowercased() } }, id: \.group) { p in
                            ChoiceChip(title: p.group, systemImage: "plus", on: false) { options.append(p) }
                        }
                    }
                    .disabled(options.count >= 6)
                    .padding(.vertical, 4)
                } header: { Text(options.isEmpty ? L("Choices") : "") }

                Section {
                    Toggle(isOn: $askNote) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Ask for a note"))
                            Text(L("The person ordering is asked for a wish – which flavour, which pizza.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    .tint(Theme.primary)
                    if askNote {
                        TextField(L("Question, e.g. Which flavour?"), text: $noteHint)
                            .accessibilityLabel(L("Question for the note"))
                            .onChange(of: noteHint) { _, v in if v.count > 80 { noteHint = String(v.prefix(80)) } }
                    }
                }
                Section {
                    TextField(L("e.g. cup, glass, bowl"), text: $unit)
                        .onChange(of: unit) { _, v in if v.count > 20 { unit = String(v.prefix(20)) } }
                } header: { Text(L("Unit")) }
                if !isNew {
                    Section {
                        Button(role: .destructive) { confirmRemove = true } label: { Label(L("Off the menu"), systemImage: "trash") }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(isNew ? L("New menu item") : (item?.name ?? ""))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isNew ? L("Add to menu") : L("Save")) { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .sheet(item: $picking) { mode in
                MenuProductPicker(api: store.api, title: mode == .link ? L("Take it from a stock product instead") : L("Ingredient from stock")) { p in
                    if mode == .link { Task { await link(p) } } else { addIngredient(p) }
                }
            }
            .sheet(isPresented: $showPhoto) {
                if let item {
                    ProductImageSheet(productId: item.id, name: name, brand: item.brand, currentPath: imagePath, credit: item.imageCredit, store: store) {
                        Task {
                            let d = try? await store.api.menuData()
                            imagePath = d?.groups.flatMap(\.items).first { $0.id == item.id }?.imagePath ?? imagePath
                        }
                    }
                }
            }
            .confirmationDialog(fromStock ? LF("Take “%@” off the menu? It stays in your stock.", item?.name ?? "") : LF("Take “%@” off the menu?", item?.name ?? ""),
                                isPresented: $confirmRemove, titleVisibility: .visible) {
                Button(L("Off the menu"), role: .destructive) { Task { await remove() } }
                Button(L("Cancel"), role: .cancel) {}
            }
            .onAppear(perform: fill)
        }
    }

    private func choiceChip(_ c: String, on: Bool, toggle: @escaping () -> Void, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 2) {
            Button(action: toggle) { Text(c).font(.subheadline) }
                .buttonStyle(.borderless)
                .foregroundStyle(on ? Theme.onPrimary : Theme.ink)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityHint(L("Preselected"))
            Button(action: remove) { Image(systemName: "xmark").font(.caption2.weight(.bold)) }
                .buttonStyle(.borderless)
                .foregroundStyle(on ? Theme.onPrimary : Theme.ink3)
                .frame(minWidth: 28, minHeight: 32)
                .accessibilityLabel(LF("Remove %@", c))
        }
        .padding(.leading, 12).padding(.trailing, 4).padding(.vertical, 4)
        .background(on ? Theme.primary : Theme.surface2, in: Capsule())
    }

    private func toggleDefault(_ id: UUID, _ c: String) {
        guard let i = options.firstIndex(where: { $0.id == id }) else { return }
        if options[i].defaults.contains(c) { options[i].defaults.removeAll { $0 == c } }
        else { options[i].defaults = options[i].multi ? options[i].defaults + [c] : [c] }
    }

    private func removeChoice(_ id: UUID, _ c: String) {
        guard let i = options.firstIndex(where: { $0.id == id }) else { return }
        options[i].choices.removeAll { $0 == c }
        options[i].defaults.removeAll { $0 == c }
    }

    private func setMulti(_ id: UUID, _ v: Bool) {
        guard let i = options.firstIndex(where: { $0.id == id }) else { return }
        options[i].multi = v
        if !v { options[i].defaults = Array(options[i].defaults.prefix(1)) }
    }

    private func addChoice(_ id: UUID) {
        guard let i = options.firstIndex(where: { $0.id == id }) else { return }
        let v = String(options[i].newChoice.trimmingCharacters(in: .whitespaces).prefix(40))
        guard !v.isEmpty, !options[i].choices.contains(v), options[i].choices.count < 12 else { return }
        options[i].choices.append(v)
        options[i].newChoice = ""
    }

    private func fill() {
        guard !filled else { return }
        filled = true
        name = item?.name ?? ""
        desc = item?.description ?? ""
        groupId = item?.groupId ?? presetGroup ?? groups.first?.id
        unit = item?.unit ?? L("pc")
        availability = item?.availability ?? "available"
        whenOut = item?.whenOut ?? "mark"
        askNote = item?.askNote ?? false
        noteHint = item?.noteHint ?? ""
        options = (item?.options ?? []).map(OptionDraft.init)
        ingredients = (item?.ingredients ?? []).map { IngredientDraft(productId: $0.productId, name: $0.name, unit: $0.unit, amount: $0.amount) }
        imagePath = item?.imagePath
    }

    private func payload(includeIngredients: Bool = true) -> [String: Any] {
        var b: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespaces),
            "description": desc.trimmingCharacters(in: .whitespaces).isEmpty ? NSNull() : desc.trimmingCharacters(in: .whitespaces),
            "availability": availability,
            "when_out": whenOut,
            "ask_note": askNote,
            "note_hint": noteHint.trimmingCharacters(in: .whitespaces).isEmpty ? NSNull() : noteHint.trimmingCharacters(in: .whitespaces),
            "options": options.filter(\.isValid).map(\.json),
        ]
        if let groupId { b["group_id"] = groupId }
        let u = unit.trimmingCharacters(in: .whitespaces)
        if !u.isEmpty { b["unit"] = u }
        if includeIngredients && !fromStock {
            b["ingredients"] = ingredients.map { ["product_id": $0.productId, "amount": max(0, min(1000, $0.amount))] as [String: Any] }
        }
        return b
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            if let item {
                try await store.api.patchMenuItem(item.id, payload())
            } else {
                var b = payload()
                b["source"] = "menu"
                try await store.api.addMenuItem(b)
            }
            Haptics.success()
            dismiss()
            onDone(L("Saved"))
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func addIngredient(_ p: BarProduct) {
        guard p.trackMode != "none", !ingredients.contains(where: { $0.productId == p.id }), ingredients.count < 3 else { return }
        ingredients.append(IngredientDraft(productId: p.id, name: p.name, unit: p.unit, amount: p.trackMode == "count" ? 0.1 : 0))
    }

    private func link(_ p: BarProduct) async {
        guard let item else { return }
        guard p.trackMode != "none" else {
            error = L("Pick a product that is tracked in stock.")
            return
        }
        do {
            var b = payload(includeIngredients: false)
            b["link_product_id"] = p.id
            try await store.api.patchMenuItem(item.id, b)
            dismiss()
            onDone(LF("“%@” now comes from stock", p.name))
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func remove() async {
        guard let item else { return }
        do {
            try await store.api.removeMenuItem(item.id)
            dismiss()
            onDone(nil)
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
