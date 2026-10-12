import SwiftUI

/// Paste a copied list (WhatsApp, notes, e-mail): POST /api/share/parse shows the lines, the chosen ones go on the
/// list with POST /api/shop/quick-add. PasteButton reads the clipboard without the system prompt.
struct PasteListSheet: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var lines: [SharePreview.Line] = []
    @State private var chosen: Set<Int> = []
    @State private var busy = false
    @State private var parsed = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PasteButton(payloadType: String.self) { strings in
                        guard let s = strings.first else { return }
                        Task { @MainActor in
                            text = s
                            await parse()
                        }
                    }
                    .buttonBorderShape(.capsule)
                    .labelStyle(.titleAndIcon)
                    TextField(L("Or type or paste here – one thing per line"), text: $text, axis: .vertical)
                        .lineLimit(3...8)
                    if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !parsed {
                        Button(L("Show what's in it")) { Task { await parse() } }
                    }
                } footer: {
                    Text(L("A list from a message or a note. You choose what goes on the list."))
                }
                if parsed {
                    Section {
                        if lines.isEmpty { Text(L("No list lines found in it.")).foregroundStyle(Theme.ink3) }
                        ForEach(Array(lines.enumerated()), id: \.offset) { i, l in
                            Button {
                                if chosen.contains(i) { chosen.remove(i) } else { chosen.insert(i) }
                            } label: {
                                HStack(spacing: Theme.Space.s3) {
                                    Image(systemName: chosen.contains(i) ? "checkmark.circle.fill" : "circle")
                                        .font(.title3)
                                        .foregroundStyle(chosen.contains(i) ? Theme.primary : Theme.lineStrong)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(l.label).foregroundStyle(Theme.ink)
                                        if l.onList == true {
                                            Text(L("already on the list")).font(.caption).foregroundStyle(Theme.ink3)
                                        } else if let p = l.product, l.confident == true {
                                            Text(LF("as %@", [p.brand, p.name].compactMap { $0 }.joined(separator: " "))).font(.caption).foregroundStyle(Theme.ink3)
                                        }
                                    }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    } header: {
                        Text(L("Found"))
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .navigationTitle(L("Paste a list"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(chosen.count == 1 ? L("Add 1") : LF("Add %d", chosen.count)) { Task { await add() } }
                        .disabled(chosen.isEmpty || busy)
                }
            }
            .onChange(of: text) { _, _ in parsed = false }
        }
        .presentationDetents([.medium, .large])
    }

    private func parse() async {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.parseShared(t)
            lines = r.items
            chosen = Set(r.items.indices.filter { r.items[$0].onList != true || r.items[$0].qty != nil })
            error = nil
        } catch {
            // offline or an older server: one line per row, as typed
            lines = t.split(whereSeparator: \.isNewline).map { SharePreview.Line(name: String($0).trimmingCharacters(in: CharacterSet(charactersIn: "-•*· \t"))) }
                .filter { !$0.name.isEmpty }
            chosen = Set(lines.indices)
        }
        parsed = true
    }

    private func add() async {
        busy = true
        defer { busy = false }
        let pick = lines.indices.filter(chosen.contains).map { lines[$0] }
        do {
            try await store.api.quickAdd(pick, listId: store.list.listId?.int)
            Haptics.success()
            store.touch("shopping")
            await store.refreshList()
            dismiss()
        } catch {
            // offline: through the queue, line by line
            for l in pick { await store.add(text: l.label) }
            dismiss()
        }
    }
}

extension SharePreview.Line {
    init(name: String) { self.name = name }
}

/// Rename a list, change its note, or remove it (open rows go back to the shopping list).
struct ManageListSheet: View {
    let list: ListRef
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var note = ""
    @State private var confirmDelete = false
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section(L("Name")) {
                    TextField(L("Name"), text: $name)
                }
                Section {
                    TextField(list.kind == "care" ? L("e.g. milk into the fridge, receipt in the drawer") : L("Note"), text: $note, axis: .vertical)
                        .lineLimit(2...5)
                } header: {
                    Text(list.kind == "care" ? L("Handover note") : L("Note"))
                }
                Section {
                    Button(L("Remove list"), role: .destructive) { confirmDelete = true }
                } footer: {
                    Text(L("Open things on it move to the shopping list."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .navigationTitle(list.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog(LF("Remove “%@”?", list.name), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Remove list"), role: .destructive) { Task { await remove() } }
            }
            .onAppear {
                name = list.name
                note = list.note ?? ""
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        guard let id = list.id.int else { return }
        busy = true
        defer { busy = false }
        do {
            let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
            try await store.api.updateShopList(id, name: name.trimmingCharacters(in: .whitespaces), note: n.isEmpty ? nil : n)
            await store.refreshList()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func remove() async {
        guard let id = list.id.int else { return }
        do {
            try await store.api.deleteShopList(id)
            await store.setList("0")
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// "Läden & Gänge": the household's shops, add one, and per shop the order of the aisles (drag to sort).
struct ShopSettingsSheet: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var stores: [StoreRef] = []
    @State private var newName = ""
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if stores.isEmpty && !loading {
                        Text(L("No shops yet. Add the ones you go to – ToHuus learns their aisle order as you shop."))
                            .font(.subheadline).foregroundStyle(Theme.ink3)
                    }
                    ForEach(stores) { s in
                        NavigationLink {
                            StoreOrderView(shop: s, store: store) { Task { await load() } }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.name)
                                Text((s.trips ?? 0) > 0 ? LF("aisle order learned from %d trips", s.trips ?? 0) : L("aisle order not learned yet"))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                    .onDelete { idx in
                        let gone = idx.map { stores[$0] }
                        stores.remove(atOffsets: idx)
                        Task {
                            for s in gone { try? await store.api.deleteStore(s.id) }
                            await store.refreshList()
                        }
                    }
                    HStack {
                        TextField(L("Add a shop, e.g. Edeka"), text: $newName)
                            .submitLabel(.done)
                            .onSubmit { Task { await add() } }
                        Button(L("Add")) { Task { await add() } }
                            .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                } header: {
                    Text(L("Shops"))
                } footer: {
                    Text(L("Tap a shop to sort its aisles. In the shop, the list follows this order."))
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .navigationTitle(L("Shops & aisles"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task { await load() }
        }
    }

    private func load() async {
        defer { loading = false }
        do { stores = try await store.api.stores(); error = nil } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func add() async {
        let n = newName.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        newName = ""
        do {
            try await store.api.createStore(name: n)
            Haptics.success()
            await load()
            await store.refreshList()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// One shop: its name and the walking order of the aisles (drag the handles).
struct StoreOrderView: View {
    let shop: StoreRef
    let store: ServerStore
    let changed: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var order: [String] = []
    @State private var saved = false
    @State private var error: String?

    var body: some View {
        List {
            Section(L("Name")) {
                TextField(L("Name"), text: $name)
            }
            Section {
                ForEach(order, id: \.self) { key in
                    Label(ShopSectionKey.label(key), systemImage: ShopSectionKey.icon(key))
                }
                .onMove { from, to in order.move(fromOffsets: from, toOffset: to) }
            } header: {
                Text(L("Aisle order"))
            } footer: {
                Text(L("Drag the aisles into the order you walk through the shop."))
            }
            if let error { Text(error).foregroundStyle(Theme.empty) }
        }
        .environment(\.editMode, .constant(.active))
        .navigationTitle(shop.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(L("Save")) { Task { await save() } }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .onAppear {
            name = shop.name
            let known = (shop.order ?? []).filter { ShopSectionKey.all.contains($0) }
            order = known + ShopSectionKey.all.filter { !known.contains($0) }
        }
    }

    private func save() async {
        do {
            let n = name.trimmingCharacters(in: .whitespaces)
            if n != shop.name { try await store.api.renameStore(shop.id, name: n) }
            try await store.api.setStoreOrder(shop.id, order: order)
            Haptics.success()
            changed()
            await store.refreshList()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
