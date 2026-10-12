import SwiftUI

struct ShoppingView: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    @State private var input = ""
    @State private var preview: [QuickAddPreview] = []
    @State private var suggestions: [RhythmItem] = []
    @State private var undo: UndoAction?
    @State private var shopMode = false
    @State private var showReceipt = false
    @FocusState private var inputFocused: Bool

    struct UndoAction: Equatable {
        let item: ShopItem
        let wasChecked: Bool
        let text: String
    }

    var body: some View {
        NavigationStack {
            List {
                if !shopMode {
                    addSection
                    if !suggestions.isEmpty { suggestionStrip }
                }
                if let err = store.lastError {
                    ErrorBanner(message: err) { Task { await store.refreshList() } }
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 4, trailing: 16))
                }
                if store.list.sections.isEmpty && store.list.basket.isEmpty {
                    EmptyStateView(systemImage: "checkmark.circle", title: L("Nothing missing right now."),
                                   message: L("Type what's missing, or tell the assistant."))
                        .listRowBackground(Color.clear)
                }
                ForEach(store.list.sections) { section in
                    Section {
                        ForEach(section.items) { item in
                            row(item)
                        }
                    } header: {
                        Label(ShopSectionKey.label(section.key), systemImage: ShopSectionKey.icon(section.key))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.ink2)
                    }
                }
                if shopMode && !store.list.basket.isEmpty {
                    Section {
                        ForEach(store.list.basket) { item in row(item) }
                        Button {
                            Task {
                                await store.checkout(toStock: true)
                                Haptics.success()
                            }
                        } label: {
                            Label(L("Done shopping"), systemImage: "checkmark.seal")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .listRowBackground(Color.clear)
                    } header: {
                        Text(LF("In the basket (%d)", store.list.basket.count))
                    }
                }
                if !shopMode && !store.list.done.isEmpty {
                    Section {
                        ForEach(store.list.done) { item in row(item) }
                    } header: {
                        HStack {
                            Text(L("Done today"))
                            Spacer()
                            Button(L("Clear")) { Task { await store.clearDone() } }.font(.footnote)
                        }
                    }
                }
                Color.clear.frame(height: 72).listRowBackground(Color.clear)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .canvasBackground()
            .refreshable {
                await store.flush()
                await store.refreshList()
                await loadSuggestions()
            }
            .navigationTitle(shopMode ? (store.list.store?.name ?? L("In the shop")) : L("Shopping"))
            .toolbar { toolbar }
            .safeAreaInset(edge: .top) {
                HStack { SyncBadge(online: store.isOnline, pending: store.pendingCount); Spacer() }
                    .padding(.horizontal)
            }
            .overlay(alignment: .bottom) { undoBar }
            .sheet(isPresented: $showReceipt) { ReceiptCaptureView(store: store) }
            .task(id: store.revision("shopping")) { await loadSuggestions() }
        }
    }

    // MARK: rows

    @ViewBuilder
    private func row(_ item: ShopItem) -> some View {
        let checked = item.isChecked
        Button {
            toggle(item)
        } label: {
            HStack(alignment: .center, spacing: Theme.Space.s3) {
                Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: shopMode ? 30 : 24))
                    .foregroundStyle(checked ? Theme.primary : Theme.lineStrong)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        if let q = item.qtyLabel { Text(q).foregroundStyle(Theme.primaryText).fontWeight(.semibold) }
                        Text(item.productName ?? item.text)
                            .strikethrough(checked && !item.isInBasket)
                            .foregroundStyle(checked ? Theme.ink3 : Theme.ink)
                        if let note = item.note, item.source != "recipe" {
                            Text(note).foregroundStyle(Theme.ink3)
                        }
                    }
                    .font(.system(size: shopMode ? 21 : Theme.FontSize.row))
                    if !shopMode {
                        Text(item.originLine).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1)
                    } else if let claim = item.claim?.name {
                        Text(LF("%@ takes care of it", claim)).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                Spacer(minLength: 0)
                if let path = item.imagePath, !shopMode {
                    RemoteImage(url: store.api.imageURL(path), api: store.api)
                        .frame(width: 36, height: 36)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                }
            }
            .padding(.vertical, shopMode ? 10 : 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(checked ? L("done") : L("open"))
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Task { await store.delete(item) }
            } label: {
                Label(L("Remove"), systemImage: "trash")
            }
        }
    }

    private func toggle(_ item: ShopItem) {
        Haptics.tick()
        let on = !item.isChecked
        Task {
            if shopMode {
                await store.setInBasket(item, on, storeId: store.list.store?.id)
            } else {
                await store.setChecked(item, on)
            }
        }
        if on {
            undo = UndoAction(item: item, wasChecked: false, text: LF("“%@” ticked off", item.productName ?? item.text))
        }
    }

    @ViewBuilder private var undoBar: some View {
        if let u = undo {
            HStack {
                Text(u.text).lineLimit(1)
                Spacer()
                Button(L("Undo")) {
                    var item = u.item
                    item.checkedAt = Date().description
                    let target = item
                    undo = nil
                    Task {
                        if shopMode { await store.setInBasket(target, false, storeId: store.list.store?.id) }
                        else { await store.setChecked(target, false) }
                    }
                }
                .fontWeight(.semibold)
                .foregroundStyle(Theme.mustard)
            }
            .font(.subheadline)
            .foregroundStyle(Theme.canvas)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Theme.ink, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .padding(.horizontal, 16)
            .padding(.trailing, 64)
            .padding(.bottom, 12)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task(id: u) {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                if undo == u { undo = nil }
            }
        }
    }

    // MARK: add

    private var addSection: some View {
        Section {
            HStack(spacing: Theme.Space.s2) {
                Image(systemName: "plus.circle.fill").foregroundStyle(Theme.primary).font(.title3)
                TextField(L("What's missing? e.g. 2 milk, bread"), text: $input)
                    .focused($inputFocused)
                    .submitLabel(.done)
                    .onSubmit(submit)
                    .onChange(of: input) { _, new in Task { await updatePreview(new) } }
                if !input.isEmpty {
                    Button(L("Add"), action: submit).fontWeight(.semibold)
                }
            }
            if preview.count > 1 || preview.first.map({ $0.qty != nil || $0.amount != nil }) == true {
                Text(preview.map { p in
                    [p.qty.map { $0.rounded() == $0 ? "\(Int($0))×" : "\($0)×" }, p.amount, p.name].compactMap { $0 }.joined(separator: " ")
                }.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(Theme.ink2)
            }
        }
    }

    private func submit() {
        let text = input
        input = ""
        preview = []
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        Haptics.tick()
        Task { await store.add(text: text) }
        inputFocused = true
    }

    /// Shows what will be added: the server parser when online, the local copy otherwise.
    private func updatePreview(_ text: String) async {
        let local = QuickAddParser.parse(text).map {
            QuickAddPreview(raw: $0.raw, name: $0.name, qty: $0.qty, unit: $0.unit, amount: $0.amount)
        }
        preview = local
    }

    // MARK: suggestions

    private var suggestionStrip: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Space.s2) {
                    ForEach(suggestions) { s in
                        Button {
                            Task {
                                do { try await store.api.acceptRhythm(s.productId) } catch { await store.addProduct(s.productId, name: s.name) }
                                suggestions.removeAll { $0.productId == s.productId }
                                store.touch("shopping")
                                await store.refreshList()
                            }
                        } label: {
                            Label(s.name, systemImage: "plus")
                                .font(.subheadline)
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(Theme.primarySoft, in: Capsule())
                                .foregroundStyle(Theme.primaryText)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button(L("Don't suggest")) {
                                Task {
                                    try? await store.api.dismissRhythm(s.productId)
                                    suggestions.removeAll { $0.productId == s.productId }
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text(L("ToHuus remembers – probably due"))
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
    }

    private func loadSuggestions() async {
        guard let all = try? await store.api.rhythm() else { return }
        let openIds = Set(store.list.openItems.compactMap(\.productId))
        let today = ServerDate.day()
        suggestions = all.filter { r in
            !openIds.contains(r.productId) && r.onList != true && r.muted != true && (r.suggested ?? ((r.dueOn ?? "9999") <= today))
        }
        .prefix(10).map { $0 }
    }

    // MARK: toolbar

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Menu {
                Button {
                    shopMode = false
                    Task { await store.setStore(nil, shopMode: false) }
                } label: {
                    Label(L("At home"), systemImage: shopMode ? "house" : "checkmark")
                }
                Section(L("I'm in the shop")) {
                    ForEach(store.list.stores) { s in
                        Button {
                            shopMode = true
                            Task { await store.setStore(s.id, shopMode: true) }
                        } label: {
                            Label(s.name, systemImage: store.list.store?.id == s.id && shopMode ? "checkmark" : "storefront")
                        }
                    }
                    Button {
                        shopMode = true
                        Task { await store.setStore(nil, shopMode: true) }
                    } label: {
                        Label(L("Another shop"), systemImage: "cart")
                    }
                }
            } label: {
                Image(systemName: shopMode ? "storefront.fill" : "storefront")
            }
            .accessibilityLabel(L("Shop mode"))
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                showReceipt = true
            } label: {
                Image(systemName: "doc.text.viewfinder")
            }
            .accessibilityLabel(L("Add receipt"))
        }
    }
}
