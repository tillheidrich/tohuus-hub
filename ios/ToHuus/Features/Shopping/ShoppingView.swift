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
    @State private var showPaperList = false
    @State private var detailItem: ShopItem?
    @State private var wishTrip: Trip?
    @State private var wishText = ""
    @State private var showRecent = false
    @State private var showUsuals = false
    @State private var showOffers = false
    @State private var showWishes = false
    @State private var guardText: String?
    @State private var guardMessage = ""
    @State private var tripPrivate = false
    @State private var listsSupported = false
    @State private var dropSection: String?
    // 0.3 parity: claims, discreet adding, paste, forecast, list & shop settings
    @State private var me: MeLite?
    @State private var visibility: RowVisibility = .all
    @State private var forecast: [ForecastItem] = []
    @State private var showPaste = false
    @State private var showShopSettings = false
    @State private var manageList: ListRef?
    @State private var shareText: ShareText?
    @State private var toast: String?
    // 14 Oct 2026 parity: import, new-list sheet, care check, typing suggestions, put away on tick, aisle order in the shop
    @State private var showImport = false
    @State private var showNewListSheet = false
    @State private var careList: ListRef?
    @State private var orderStore: StoreRef?
    @State private var showNewStore = false
    @State private var newStoreName = ""
    @State private var showListLook = false
    @State private var products: [ProductInfo] = []
    @State private var usualCount: [Int: Int] = [:]
    @State private var showUnpriced = false
    @AppStorage("list.toStock") private var toStock = true
    @AppStorage("list.density") private var densityRaw = ListDensity.normal.rawValue
    @AppStorage("list.fontScale") private var fontScale = 1.0
    /// Dynamic Type on top of the list's own size setting (1 at the default text size)
    @ScaledMetric(relativeTo: .body) private var typeScale: CGFloat = 1
    @FocusState private var inputFocused: Bool

    struct UndoAction: Equatable {
        let item: ShopItem
        let wasChecked: Bool
        let text: String
        /// removed rather than ticked: undo puts it back on the list
        var deleted = false
    }

    private var density: ListDensity { ListDensity(rawValue: densityRaw) ?? .normal }
    /// what moves in the list: rows added, ticked (they slide to "ticked"), removed
    private var listSignature: [Int] {
        store.list.sections.flatMap { $0.items.map(\.id) } + [-1] + store.list.basket.map(\.id) + [-2] + store.list.done.map(\.id)
    }
    private var others: [Trip] { store.trips.filter { !$0.isMine } }
    private var myTrip: Trip? { store.trips.first { $0.isMine } }

    var body: some View {
        NavigationStack {
            List {
                liveSection
                topSections
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
                groupSections
                if shopMode && !store.list.basket.isEmpty {
                    Section {
                        ForEach(store.list.basket) { item in row(item) }
                        Toggle(L("Put into stock"), isOn: $toStock)
                        Button {
                            Task {
                                await store.checkout(toStock: toStock)
                                Haptics.success()
                                show(L("Done shopping"))
                            }
                        } label: {
                            Label(L("Done shopping"), systemImage: "checkmark.seal")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .listRowBackground(Color.clear)
                    } header: {
                        Text(LF("In the basket (%d) – crossed out until you're done", store.list.basket.count))
                    }
                }
                doneSection
                estimateSection
                if !shopMode && !app.isGuest {
                    ExtrasListSection(api: store.api, refresh: extrasRefresh)
                }
                if !shopMode && !app.isGuest && (me?.claimsOn ?? true) { whoGetsWhatSection }
                Color.clear.frame(height: 72).listRowBackground(Color.clear)
            }
            .listStyle(.insetGrouped)
            .environment(\.defaultMinListRowHeight, density.minRowHeight)
            .scrollContentBackground(.hidden)
            .canvasBackground()
            // adding inserts the row, ticking slides it down to "ticked" – still with Reduce Motion
            .motion(value: listSignature)
            .refreshable {
                await store.flush()
                await store.refreshList()
                await store.refreshTrips()
                await loadSuggestions()
            }
            .navigationTitle(title)
            .rootChrome()
            .toolbar { toolbar }
            .safeAreaInset(edge: .top) {
                HStack { SyncBadge(online: store.isOnline, pending: store.pendingCount); Spacer() }
                    .padding(.horizontal)
            }
            .overlay(alignment: .bottom) { undoBar }
            .sheet(isPresented: $showReceipt) { ReceiptCaptureView(store: store) }
            .sheet(isPresented: $showPaperList) { PaperListSheet(store: store) }
            .sheet(item: $detailItem) { item in ItemDetailSheet(item: item, store: store) }
            .alert(wishTrip.map { LF("A wish for %@", $0.user.name) } ?? L("A wish for the trip"),
                   isPresented: Binding(get: { wishTrip != nil }, set: { if !$0 { wishTrip = nil } })) {
                TextField(L("e.g. oat milk"), text: $wishText)
                Button(L("Send")) { sendWish() }
                Button(L("Cancel"), role: .cancel) { wishText = ""; wishTrip = nil }
            } message: {
                Text(L("The person shopping gets it right away and answers “I'll get it” or “Can't do it”."))
            }
            .alert(L("Add anyway?"), isPresented: Binding(get: { guardText != nil }, set: { if !$0 { guardText = nil } })) {
                Button(L("Add")) { if let t = guardText { Task { await store.add(text: t) } }; guardText = nil }
                Button(L("Cancel"), role: .cancel) { guardText = nil }
            } message: {
                Text(guardMessage)
            }
            .sheet(isPresented: $showRecent) { RecentDoneSheet(store: store) }
            .sheet(isPresented: $showUsuals) { UsualsSheet(store: store) }
            .sheet(isPresented: $showOffers) { OffersView(store: store) }
            .sheet(isPresented: $showWishes) { NavigationStack { WishesView(api: store.api).toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Done")) { showWishes = false } } } } }
            .onAppear {
                // simulator checks: -debugWishes YES (debug builds only)
                #if DEBUG
                if UserDefaults.standard.bool(forKey: "debugWishes") { showWishes = true }
                #endif
            }
            .sheet(isPresented: $showPaste) { PasteListSheet(store: store) }
            .sheet(isPresented: $showImport) { ImportListSheet(store: store) }
            .sheet(isPresented: $showNewListSheet) { NewListSheet(store: store) }
            .sheet(item: $careList) { l in CareCheckSheet(list: l, store: store) }
            .sheet(item: $orderStore) { s in
                NavigationStack {
                    StoreOrderView(shop: s, store: store) {}
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { orderStore = nil } } }
                }
            }
            .sheet(isPresented: $showListLook) {
                NavigationStack {
                    ListDisplaySettingsView()
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { showListLook = false } } }
                }
                .presentationDetents([.medium, .large])
            }
            .alert(L("Another store"), isPresented: $showNewStore) {
                TextField(L("e.g. Edeka, dm, weekly market"), text: $newStoreName)
                Button(L("Add store")) { createStore() }
                Button(L("Cancel"), role: .cancel) { newStoreName = "" }
            } message: {
                Text(L("Each store learns its own aisle order."))
            }
            .onChange(of: shopMode) { _, on in UIApplication.shared.isIdleTimerDisabled = on }
            .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
            .sheet(isPresented: $showShopSettings) { ShopSettingsSheet(store: store) }
            .sheet(item: $manageList) { l in ManageListSheet(list: l, store: store) }
            .sheet(item: $shareText) { t in ShopActivitySheet(items: [t.text]).presentationDetents([.medium, .large]) }
            .overlay(alignment: .top) { toastView }
            .task(id: store.revision("shopping") + store.revision("stock")) {
                await loadSuggestions()
                await loadForecast()
                await store.refreshTrips()
            }
            .task {
                listsSupported = (try? await store.api.shopLists()) != nil
                tripPrivate = (try? await store.api.tripPrivacy()) ?? false
                me = try? await store.api.meLite()
                #if DEBUG
                let d = UserDefaults.standard
                if d.bool(forKey: "debugShopSettings") { showShopSettings = true }
                if d.bool(forKey: "debugPaste") { showPaste = true }
                if d.bool(forKey: "debugItemSheet") {
                    try? await Task.sleep(nanoseconds: 800_000_000)
                    detailItem = store.list.openItems.first
                }
                #endif
            }
            .onChange(of: app.requestedStore, initial: true) { _, id in
                guard let id else { return }
                app.requestedStore = nil
                enterShop(id)
            }
            .onChange(of: app.addRequest) { _, _ in consumeAdd() }
            .onAppear {
                consumeAdd()
                UIApplication.shared.isIdleTimerDisabled = shopMode
            }
        }
    }

    private func consumeAdd() {
        guard app.addPending else { return }
        app.addPending = false
        if shopMode { leaveShop() }
        Task {
            // the field exists only after the first layout pass
            try? await Task.sleep(nanoseconds: 300_000_000)
            inputFocused = true
        }
    }

    @ViewBuilder private var doneSection: some View {
        if !shopMode && !store.list.done.isEmpty {
            Section {
                ForEach(store.list.done) { item in row(item) }
                Button(L("Finish shopping")) {
                    Task {
                        await store.checkout(toStock: toStock)
                        Haptics.success()
                        show(L("Done shopping"))
                    }
                }
                .font(.subheadline.weight(.semibold))
            } header: {
                HStack {
                    Text(L("Ticked – crossed out until you finish"))
                    Spacer()
                    Button(L("Recently done")) { showRecent = true }.font(.footnote)
                }
            }
        }
    }

    /// changes whenever rows, ticks or extra marks change – reloads the extras bar
    private var extrasRefresh: Int {
        var h = Hasher()
        for i in store.list.openItems + store.list.basket + store.list.done { h.combine(i.id); h.combine(i.checkedAt); h.combine(i.extra); h.combine(i.qty) }
        return h.finalize()
    }

    @ViewBuilder private var estimateSection: some View {
        if let est = store.list.expected, let total = est.total {
            Section {
                Button {
                    withAnimation { showUnpriced.toggle() }
                } label: {
                    LabeledContent {
                        Text("≈ " + Money.format(total, currency: est.currency)).font(.headline).foregroundStyle(Theme.ink)
                    } label: {
                        VStack(alignment: .leading) {
                            Text(L("Expected total")).foregroundStyle(Theme.ink)
                            if let priced = est.priced, let unpriced = est.unpriced, unpriced > 0 {
                                Text(LF("prices known for %d of %d things", priced, priced + unpriced)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                }
                .buttonStyle(.plain)
                if showUnpriced {
                    Text(LF("From the last receipt prices of %d items.", est.priced ?? 0)
                         + ((est.unpricedNames ?? []).isEmpty ? "" : " " + LF("No price yet: %@.", (est.unpricedNames ?? []).joined(separator: ", "))))
                        .font(.caption).foregroundStyle(Theme.ink3)
                }
            }
        }
    }

    private var title: String {
        if shopMode { return store.list.store?.name ?? L("In the shop") }
        if let l = store.list.currentList, store.list.lists.count > 1, !l.isMain { return l.name }
        return L("Shopping")
    }

    // MARK: live shopping together

    /// Shopping together: trips start by themselves from ticks in a shop (GET /api/shop/trips).
    @ViewBuilder private var liveSection: some View {
        let mine = myTrip?.openAddOns ?? []
        if !others.isEmpty || myTrip != nil {
            Section {
                ForEach(others) { trip in
                    HStack(spacing: Theme.Space.s3) {
                        ShopMemberDot(name: trip.user.name, color: trip.user.color, size: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(trip.store.map { LF("%@ is shopping at %@", trip.user.name, $0.name) } ?? LF("%@ is shopping right now", trip.user.name))
                                .font(.subheadline.weight(.semibold))
                            Text(tripLine(trip)).font(.caption).foregroundStyle(Theme.ink3)
                            if !trip.basket.isEmpty {
                                Text(trip.basket.map(\.text).joined(separator: ", ")).font(.caption).foregroundStyle(Theme.ink2).lineLimit(2)
                            }
                            if !trip.addOns.isEmpty {
                                Text(L("Asked for") + ": " + trip.addOns.map { $0.done == true ? "✓ " + $0.text : $0.text }.joined(separator: ", "))
                                    .font(.caption).foregroundStyle(Theme.ink3).lineLimit(2)
                            }
                        }
                        Spacer(minLength: 0)
                        Button(L("Add a wish")) { wishTrip = trip }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityAction(named: L("Add a wish")) { wishTrip = trip }
                }
                if let t = myTrip {
                    Toggle(isOn: Binding(get: { tripPrivate }, set: { setPrivate($0) })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.store.map { LF("You’re shopping at %@", $0.name) } ?? L("You’re shopping")).font(.subheadline.weight(.semibold))
                            Text(tripPrivate ? L("Only you see this trip.") : L("The others see what’s in your basket and can ask you for something."))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    .accessibilityHint(L("My shopping stays private"))
                }
                ForEach(mine) { a in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(a.from.map { LF("%@ asks: %@", $0, a.text) } ?? a.text).font(.subheadline)
                        HStack {
                            Button(L("I'll get it")) { Task { await answer(a, accept: true) } }.buttonStyle(.borderedProminent)
                            Button(L("Can't do it")) { Task { await answer(a, accept: false) } }.buttonStyle(.bordered)
                        }
                        .controlSize(.small)
                    }
                }
            }
            .listRowBackground(Theme.primarySoft)
        }
    }

    private func tripLine(_ t: Trip) -> String {
        var parts: [String] = []
        if !t.basket.isEmpty { parts.append(LF("%d in the basket", t.basket.count)) }
        if let since = ServerDate.relative(t.startedAt) { parts.append(LF("since %@", since)) }
        return parts.joined(separator: " · ")
    }

    private func sendWish() {
        let text = wishText.trimmingCharacters(in: .whitespaces)
        let trip = wishTrip
        wishText = ""
        wishTrip = nil
        guard !text.isEmpty, let trip else { return }
        Task {
            do {
                try await store.api.addToTrip(trip.id, text: text)
                Haptics.success()
            } catch {
                // the trip just ended: the wish simply goes on the list
                await store.add(text: text)
            }
            await store.refreshList()
            await store.refreshTrips()
        }
    }

    private func answer(_ a: Trip.AddOn, accept: Bool) async {
        try? await store.api.answerAddon(a.id, accept: accept)
        Haptics.tick()
        await store.refreshList()
        await store.refreshTrips()
    }

    private func enterShop(_ id: Int?) {
        shopMode = true
        Task { await store.setStore(id, shopMode: true) }
    }

    private func leaveShop() {
        shopMode = false
        Task { await store.setStore(nil, shopMode: false) }
    }

    // MARK: rows

    /// picture next to the row: bigger in the shop, smaller in the compact list, never above 56 pt
    private var thumbSize: CGFloat {
        let base: CGFloat = shopMode ? 44 : (density == .compact ? 28 : 36)
        return min(56, base * fontScale)
    }

    @ViewBuilder
    private func row(_ item: ShopItem) -> some View {
        let checked = item.isChecked
        let size = (shopMode ? 21 : Theme.FontSize.row * density.fontFactor) * fontScale * typeScale
        Button {
            toggle(item)
        } label: {
            HStack(alignment: .center, spacing: Theme.Space.s3) {
                Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: (shopMode ? 30 : 24) * fontScale * min(typeScale, 1.6)))
                    .foregroundStyle(checked ? Theme.primary : Theme.lineStrong)
                    .contentTransition(.symbolEffect(.replace))
                    .accessibilityHidden(true)
                // own photo of the row first, else the product picture (decision 1.0: rows show it when there is one)
                ProductThumb(path: item.photoPath ?? item.imagePath, api: store.api, size: thumbSize)
                    .opacity(checked ? 0.5 : 1)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        if let q = item.qtyLabel { Text(q).foregroundStyle(Theme.primaryText).fontWeight(.semibold) }
                        // crossed out until the trip is done (basket) or the row is cleared
                        Text(item.productName ?? item.text)
                            .strikethrough(checked)
                            .foregroundStyle(checked ? Theme.ink3 : Theme.ink)
                        if item.extra == true {
                            Image(systemName: "sparkles").font(.caption).foregroundStyle(Theme.ink3)
                                .accessibilityLabel(L("Extra"))
                        }
                        SampleTag(on: app.sampleMarks.shopping.contains(item.id))
                        if let note = item.note, item.source != "recipe", !note.isEmpty {
                            Text(note).foregroundStyle(Theme.ink3)
                        }
                    }
                    .font(.system(size: size))
                    if let sub = substituteLine(item) {
                        Label(sub, systemImage: "arrow.triangle.swap").font(.caption).foregroundStyle(Theme.ink2)
                    }
                    if !checked, let hint = item.sizeHint ?? item.priceHint, density != .compact {
                        Label(hint, systemImage: item.sizeHint != nil ? "lightbulb" : "eurosign").font(.caption).foregroundStyle(Theme.ink2)
                    }
                    if let share = item.share, !checked {
                        Label(share.subline, systemImage: share.icon).labelStyle(ShopTightLabelStyle()).font(.caption).foregroundStyle(Theme.ink2).lineLimit(2)
                    }
                    if !checked, let extra = extraLine(item) {
                        Text(extra).font(.caption).foregroundStyle(Theme.ink2).lineLimit(2)
                    }
                    if !checked, let claim = item.claim, (me?.claimsOn ?? true) {
                        Label(claimLine(claim), systemImage: "hand.raised.fill").labelStyle(ShopTightLabelStyle())
                            .font(.caption.weight(.semibold)).foregroundStyle(Theme.primaryText).lineLimit(1)
                    }
                    if density != .compact && !shopMode {
                        Text(checked ? doneLine(item) : item.originLine).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, shopMode ? 10 : density.verticalPadding)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityValue(checked ? L("done") : L("open"))
        .accessibilityHint(checked ? L("Double-tap to put it back on the list") : L("Double-tap to tick it off"))
        .accessibilityAction(named: L("Details")) { detailItem = item }
        .accessibilityAction(named: L("Remove")) { remove(item) }
        .draggable(ItemDrag(id: item.id).payload)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            // swipe right = tick, the same as a tap (pon); "I'll get it" second
            Button { toggle(item) } label: {
                Label(item.isChecked ? L("Put back") : L("Tick off"), systemImage: item.isChecked ? "arrow.uturn.backward" : "checkmark")
            }
            .tint(Theme.primary)
            if !item.isChecked && item.id > 0 && (me?.claimsOn ?? true) && !app.isGuest {
                let mine = item.claim != nil && item.claim?.userId == me?.userId
                Button {
                    Task { await claim(item, on: !mine) }
                } label: {
                    Label(mine ? L("Release") : L("I'll get it"), systemImage: mine ? "hand.raised.slash" : "hand.raised.fill")
                }
                .tint(mine ? Theme.ink3 : Theme.info)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            // a full swipe left edits rather than deletes – what you need most, without losing a row by accident
            Button {
                detailItem = item
            } label: {
                Label(L("Details"), systemImage: "square.and.pencil")
            }
            .tint(Theme.info)
            Button(role: .destructive) {
                remove(item)
            } label: {
                Label(L("Remove"), systemImage: "trash")
            }
        }
        .contextMenu {
            Button { detailItem = item } label: { Label(L("Edit row"), systemImage: "square.and.pencil") }
            if !item.isChecked && item.id > 0 && (me?.claimsOn ?? true) {
                if item.claim != nil && item.claim?.userId == me?.userId {
                    Button { Task { await claim(item, on: false) } } label: { Label(L("Release"), systemImage: "hand.raised.slash") }
                } else {
                    Button { Task { await claim(item, on: true) } } label: { Label(L("I'll get it"), systemImage: "hand.raised.fill") }
                }
            }
            if item.isChecked && item.id > 0 {
                Button { Task { await restore(item) } } label: { Label(L("Put back"), systemImage: "arrow.uturn.backward") }
            }
            if !item.isChecked && item.id > 0 && store.list.lists.count > 1 {
                Menu {
                    ForEach(store.list.lists.filter { $0.id.value != (store.list.listId?.value ?? "0") }) { l in
                        Button(l.name) { Task { await moveToList(item.id, l) } }
                    }
                } label: { Label(L("To another list"), systemImage: "list.bullet") }
            }
            if !item.isChecked && item.id > 0 {
                Menu {
                    ForEach(ShopSectionKey.all, id: \.self) { key in
                        Button { Task { await move(item.id, to: key) } } label: {
                            Label(ShopSectionKey.label(key), systemImage: ShopSectionKey.icon(key))
                        }
                    }
                } label: { Label(L("Move to"), systemImage: "arrow.up.arrow.down") }
            }
            Button(role: .destructive) { remove(item) } label: { Label(L("Remove"), systemImage: "trash") }
        }
    }

    private func substituteLine(_ item: ShopItem) -> String? {
        switch item.substitute {
        case "ok": return L("Substitute is fine")
        case "ask": return L("Ask before taking a substitute")
        case "exact": return L("Exactly this one")
        default: return nil
        }
    }

    private func restore(_ item: ShopItem) async {
        _ = try? await store.api.restoreItem(item.id)
        Haptics.tick()
        await store.refreshList()
    }

    private func moveToList(_ id: Int, _ l: ListRef) async {
        try? await store.api.moveItemToList(id, listId: l.id.int ?? 0)
        Haptics.tick()
        await store.refreshList()
    }

    private func doneLine(_ item: ShopItem) -> String {
        let when = ServerDate.relative(item.checkedAt)
        switch (item.checkedBy, when) {
        case let (by?, when?): return LF("done by %@ · %@", by, when)
        case let (by?, nil): return LF("done by %@", by)
        case let (nil, when?): return when
        default: return item.originLine
        }
    }

    private func drop(_ payloads: [String], into section: String) -> Bool {
        guard let id = payloads.compactMap(ItemDrag.init(payload:)).first?.id, id > 0 else { return false }
        Task { await move(id, to: section) }
        return true
    }

    private func move(_ id: Int, to section: String) async {
        do {
            try await store.api.moveItem(id, section: section)
            Haptics.tick()
            await store.refreshList()
        } catch {
            store.touch("shopping")
        }
    }

    /// remove with a way back (the row is put on the list again; discreet rows stay removed – their name is not here)
    private func remove(_ item: ShopItem) {
        Haptics.tick()
        Task { await store.delete(item) }
        guard item.share == nil, item.id > 0 else { return }
        undo = UndoAction(item: item, wasChecked: item.isChecked, text: LF("“%@” removed", item.productName ?? item.text), deleted: true)
    }

    private func toggle(_ item: ShopItem) {
        Haptics.tick()
        let on = !item.isChecked
        Task {
            if shopMode {
                await store.setInBasket(item, on, storeId: store.list.store?.id)
            } else {
                await store.setChecked(item, on, toStock: toStock)
            }
        }
        if on {
            let name = item.productName ?? item.text
            undo = UndoAction(item: item, wasChecked: false,
                              text: !shopMode && toStock && item.productId != nil ? LF("%@ put away", name) : LF("“%@” ticked off", name))
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
                        if u.deleted {
                            let name = target.productName ?? target.text
                            if let pid = target.productId {
                                await store.addProduct(pid, name: target.text.isEmpty ? name : target.text, qty: target.qty, onShownList: true)
                            } else {
                                await store.add(text: [target.qtyLabel, target.text].compactMap { $0 }.joined(separator: " "))
                            }
                        } else if shopMode { await store.setInBasket(target, false, storeId: store.list.store?.id) }
                        else { await store.setChecked(target, false) }
                    }
                }
                .fontWeight(.semibold)
                .foregroundStyle(Theme.mustard)
                .keyboardShortcut("z", modifiers: .command)
            }
            .font(.subheadline)
            .foregroundStyle(Theme.onBlock)
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Theme.block, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .padding(.horizontal, 16)
            .padding(.trailing, 64)
            .padding(.bottom, 12)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .task(id: u) {
                A11yTiming.announce(u.text)
                await A11yTiming.hold(4)
                if !Task.isCancelled, undo == u { undo = nil }
            }
        }
    }

    // MARK: add

    private var addSection: some View {
        Section {
            HStack(spacing: Theme.Space.s2) {
                Image(systemName: "plus.circle.fill").foregroundStyle(Theme.primary).font(.title3).accessibilityHidden(true)
                TextField(L("What's missing? e.g. 2 milk, bread"), text: $input)
                    .focused($inputFocused)
                    .submitLabel(.done)
                    .onSubmit(submit)
                    .onChange(of: input) { _, new in Task { await updatePreview(new) } }
                    .onChange(of: inputFocused) { _, on in if on { Task { await loadProducts() } } }
                    .task(id: store.revision("stock")) { products = []; if inputFocused { await loadProducts() } }
                if !input.isEmpty {
                    Button(L("Add"), action: submit).fontWeight(.semibold)
                } else {
                    Button { showPaste = true } label: { Image(systemName: "doc.on.clipboard").tapTarget() }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(L("Paste a list"))
                }
                Menu {
                    Picker(L("Who sees it?"), selection: $visibility) {
                        ForEach(RowVisibility.allCases) { v in Label(v.title, systemImage: v.icon).tag(v) }
                    }
                } label: {
                    Image(systemName: visibility == .all ? "eye" : (visibility == .private ? "lock.fill" : "eye.slash.fill"))
                        .foregroundStyle(visibility == .all ? Theme.ink3 : Theme.primaryText)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(L("Who sees it?"))
                .accessibilityValue(visibility.title)
            }
            if visibility != .all {
                Label(visibility.explanation, systemImage: visibility.icon)
                    .font(.caption).foregroundStyle(Theme.primaryText)
            }
            ForEach(typedMatches) { m in typedRow(m.product, qty: m.qty) }
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
        inputFocused = true
        if visibility != .all {
            let vis = visibility
            visibility = .all
            Task { await addHidden(text, vis) }
            return
        }
        Task {
            // "laut Bon vorgestern gekauft", "im Vorrat 2": ask once, never block (offline: just add)
            let single = QuickAddParser.fragments(text).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.count == 1
            if single, store.isOnline, let hints = try? await store.api.guardHints(text: text) {
                if let ask = hints.first(where: \.asks) {
                    guardMessage = ask.text
                    guardText = text
                    return
                }
                // "steht schon drauf …" and "lieber 250 g?" are worth a line, not a question (like the web)
                if let note = hints.first(where: { $0.kind == "on_list" }) ?? hints.first(where: { $0.kind == "waste" }) {
                    show(note.kind == "on_list" ? "\(text.trimmingCharacters(in: .whitespaces)): \(note.text)" : note.text)
                }
            }
            await store.add(text: text)
        }
    }

    /// Shows what will be added (the local copy of the server parser).
    private func updatePreview(_ text: String) async {
        preview = QuickAddParser.parse(text).map {
            QuickAddPreview(raw: $0.raw, name: $0.name, qty: $0.qty, unit: $0.unit, amount: $0.amount)
        }
    }

    // MARK: suggestions

    /// "Vorschläge": what ToHuus remembers is due – never put on the list silently, always accept or "not now"
    private var suggestionStrip: some View {
        Section {
            ForEach(suggestions.prefix(6)) { s in
                HStack(spacing: Theme.Space.s3) {
                    Button {
                        Task { await acceptSuggestion(s) }
                    } label: {
                        HStack(spacing: Theme.Space.s3) {
                            ProductThumb(path: s.image, api: store.api, size: 32)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                Text(s.detail).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(Theme.primary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(LF("Put %@ on the list", s.name))
                    Button {
                        Task { await dismissSuggestion(s) }
                    } label: {
                        Image(systemName: "xmark").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3).tapTarget()
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(LF("Not now: %@", s.name))
                }
                .swipeActions {
                    Button { Task { await dismissSuggestion(s) } } label: { Label(L("Not now"), systemImage: "xmark") }
                }
            }
        } header: {
            HStack {
                Text(L("Suggestions"))
                Spacer()
                Text(L("ToHuus remembers what you buy regularly")).textCase(nil).font(.caption2)
            }
        }
    }

    private func acceptSuggestion(_ s: RhythmItem) async {
        Haptics.tick()
        suggestions.removeAll { $0.productId == s.productId }
        do { try await store.api.acceptRhythm(s.productId) } catch { await store.addProduct(s.productId, name: s.name, onShownList: true) }
        show(LF("%@ is on the shopping list", s.name))
        store.touch("shopping")
        await store.refreshList()
    }

    /// dismissed twice → the server stops suggesting it
    private func dismissSuggestion(_ s: RhythmItem) async {
        Haptics.tick()
        suggestions.removeAll { $0.productId == s.productId }
        try? await store.api.dismissRhythm(s.productId)
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

    // MARK: lists

    private func setPrivate(_ on: Bool) {
        tripPrivate = on
        Task { try? await store.api.setTripPrivacy(on) }
    }


    // MARK: toolbar

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Menu {
                Button {
                    leaveShop()
                } label: {
                    Label(L("At home"), systemImage: shopMode ? "house" : "checkmark")
                }
                Toggle(L("My shopping stays private"), isOn: Binding(get: { tripPrivate }, set: { setPrivate($0) }))
                Section(L("I'm in the shop")) {
                    ForEach(store.list.stores) { s in
                        Button {
                            enterShop(s.id)
                        } label: {
                            Label(s.name, systemImage: store.list.store?.id == s.id && shopMode ? "checkmark" : "storefront")
                        }
                    }
                    Button {
                        enterShop(nil)
                    } label: {
                        Label(L("Another shop"), systemImage: "cart")
                    }
                }
            } label: {
                Image(systemName: shopMode ? "storefront.fill" : "storefront")
            }
            .accessibilityLabel(L("Shop mode"))
        }
        if (store.list.lists.count > 1 || listsSupported) && !app.isGuest {
            ToolbarItem(placement: .principal) {
                Menu {
                    ForEach(store.list.lists) { l in
                        Button {
                            Task { await store.setList(l.id.value) }
                        } label: {
                            Label(l.open.map { "\(l.name) (\($0))" } ?? l.name,
                                  systemImage: (store.list.listId?.value ?? "0") == l.id.value ? "checkmark" : (visibilitySymbol(l.visibility) ?? "list.bullet"))
                        }
                    }
                    if listsSupported {
                        Button { showNewListSheet = true } label: { Label(L("Another list"), systemImage: "plus") }
                    }
                    if let l = store.list.currentList, !l.isMain {
                        Button { manageList = l } label: { Label(L("Edit this list"), systemImage: "pencil") }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Text(title).font(.headline)
                        Image(systemName: "chevron.down").font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(Theme.ink)
                }
                .accessibilityLabel(L("Choose list"))
            }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button { showReceipt = true } label: { Label(L("Add receipt"), systemImage: "doc.text.viewfinder") }
                Button { showPaperList = true } label: { Label(L("Photograph a paper list"), systemImage: "list.bullet.rectangle") }
                Divider()
                Button { showUsuals = true } label: { Label(L("Our usuals"), systemImage: "star") }
                Button { showRecent = true } label: { Label(L("Recently done"), systemImage: "clock.arrow.circlepath") }
                if !app.isGuest {
                    Button { showOffers = true } label: { Label(L("Offers"), systemImage: "tag") }
                    Button { showWishes = true } label: { Label(L("Wishes & Merkliste"), systemImage: "gift") }
                }
                Divider()
                Button { showPaste = true } label: { Label(L("Paste a list"), systemImage: "doc.on.clipboard") }
                Button { showImport = true } label: { Label(L("From another app"), systemImage: "square.and.arrow.down.on.square") }
                Button { Task { await shareList() } } label: { Label(L("Share the list"), systemImage: "square.and.arrow.up") }
                Divider()
                Toggle(isOn: $toStock) { Label(L("Put away when checked off"), systemImage: "archivebox") }
                Button { showListLook = true } label: { Label(L("How the list looks for me"), systemImage: "textformat.size") }
                Button { showShopSettings = true } label: { Label(L("Shops & aisles"), systemImage: "storefront") }
            } label: {
                // receipts, paper lists, usuals, wishes, sharing – more than receipts, so the general "more" symbol
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel(L("More for the list"))
            .accessibilityHint(L("Receipts, paper lists, usuals, offers, import, sharing and how the list looks"))
        }
    }
}

/// Drag payload for a list row ("tohuus-item:<id>").
struct ItemDrag {
    let id: Int
    var payload: String { "tohuus-item:\(id)" }
    init(id: Int) { self.id = id }
    init?(payload: String) {
        guard payload.hasPrefix("tohuus-item:"), let n = Int(payload.dropFirst(12)) else { return nil }
        id = n
    }
}

/// Mehr › So sieht die Liste aus: row density and text size (this device only).
enum ListDensity: String, CaseIterable, Identifiable {
    case compact, normal, large
    var id: String { rawValue }

    var title: String {
        switch self {
        case .compact: return L("Compact")
        case .normal: return L("Standard")
        case .large: return L("Large")
        }
    }

    var minRowHeight: CGFloat { self == .compact ? 36 : (self == .large ? 60 : 44) }
    var verticalPadding: CGFloat { self == .compact ? 0 : (self == .large ? 8 : 2) }
    var fontFactor: CGFloat { self == .large ? 1.15 : 1 }
}

struct ListDisplaySettingsView: View {
    @Environment(AppModel.self) private var app
    @AppStorage("list.density") private var densityRaw = ListDensity.normal.rawValue
    @AppStorage("list.fontScale") private var fontScale = 1.0

    var body: some View {
        Form {
            Section {
                Picker(L("Rows"), selection: $densityRaw) {
                    ForEach(ListDensity.allCases) { d in Text(d.title).tag(d.rawValue) }
                }
                .pickerStyle(.segmented)
                VStack(alignment: .leading) {
                    Text(L("Text size"))
                    Slider(value: $fontScale, in: 0.9...1.4, step: 0.05) {
                        Text(L("Text size"))
                    } minimumValueLabel: {
                        Image(systemName: "textformat.size.smaller")
                    } maximumValueLabel: {
                        Image(systemName: "textformat.size.larger")
                    }
                }
            } footer: {
                Text(L("Saved for you on every device. The text also follows the iPhone's text size."))
            }
            Section(L("Preview")) {
                HStack(spacing: Theme.Space.s3) {
                    Image(systemName: "circle").font(.system(size: 24 * fontScale)).foregroundStyle(Theme.lineStrong)
                    VStack(alignment: .leading) {
                        Text(L("2× Milk")).font(.system(size: Theme.FontSize.row * (ListDensity(rawValue: densityRaw)?.fontFactor ?? 1) * fontScale))
                        if densityRaw != ListDensity.compact.rawValue {
                            Text(L("Sam · today 09:12")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
            }
        }
        .navigationTitle(L("How the list looks"))
        .onChange(of: densityRaw) { _, _ in save() }
        .onChange(of: fontScale) { _, _ in save() }
    }
}

extension ListDisplaySettingsView {
    /// PUT /api/list/prefs – per person, so the web app and other devices follow
    func save() {
        let d = densityRaw, f = fontScale
        Task { try? await app.api?.setListPrefs(density: d, fontScale: f) }
    }
}

/// Takes the person's list prefs from /api/me (listPrefs) into the local settings the list reads.
enum ListPrefsSync {
    static func adopt(_ p: JSONValue) {
        if let d = p["density"]?.string, ListDensity(rawValue: d) != nil { UserDefaults.standard.set(d, forKey: "list.density") }
        if let f = p["fontScale"]?.double, (0.9...1.4).contains(f) { UserDefaults.standard.set(f, forKey: "list.fontScale") }
    }
}

// MARK: - 0.3 parity: claims, discreet adding, forecast, share

/// Text handed to the share sheet ("Liste teilen").
struct ShareText: Identifiable {
    let text: String
    var id: String { text }
}

extension ShoppingView {
    fileprivate func claimLine(_ c: ShopItem.Claim) -> String {
        if let mine = me?.userId, c.userId == mine { return L("You'll get it") }
        return LF("%@ gets it", c.name ?? "–")
    }

    /// "Ich hol's" / release (POST /api/claims) – just so nobody buys it twice
    fileprivate func claim(_ item: ShopItem, on: Bool) async {
        Haptics.tick()
        do {
            try await store.api.claimItem(item.id, on: on)
            store.touch("shopping")
            await store.refreshList()
        } catch {
            show(APIError.from(error).localizedDescription)
        }
    }

    /// discreet / only me: straight to the server, the real name never enters the shared list (or the offline queue)
    fileprivate func addHidden(_ text: String, _ vis: RowVisibility) async {
        do {
            let n = try await store.api.addHidden(text: text, visibility: vis)
            Haptics.success()
            show(vis == .private ? L("Added – only you can see it") : (n > 1 ? LF("%d added discreetly", n) : L("Added discreetly")))
            await store.refreshList()
        } catch {
            input = text
            show(APIError.from(error).isOffline ? L("No connection – try again when you're back online") : APIError.from(error).localizedDescription)
        }
    }

    fileprivate func loadForecast() async {
        guard app.moduleOn("stock"), let r = try? await store.api.forecast(within: 7) else { forecast = []; return }
        let open = Set(store.list.openItems.compactMap(\.productId))
        forecast = r.items.filter { $0.onShoppingList != true && !open.contains($0.productId) }.prefix(6).map { $0 }
    }

    /// "Wird bald knapp" – estimates from usage and purchases; never changes stock, one tap puts it on the list
    fileprivate var forecastSection: some View {
        Section {
            ForEach(forecast) { f in
                HStack(spacing: Theme.Space.s3) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(f.name).font(.subheadline)
                        Text(f.line).font(.caption).foregroundStyle(Theme.ink3)
                    }
                    Spacer(minLength: 0)
                    Button {
                        Task {
                            await store.addProduct(f.productId, name: f.name)
                            forecast.removeAll { $0.productId == f.productId }
                            Haptics.tick()
                        }
                    } label: {
                        Image(systemName: "plus").font(.body.weight(.semibold)).foregroundStyle(Theme.onPrimary)
                            .frame(width: 34, height: 34).background(Theme.primary, in: Circle())
                            .tapTarget()
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(LF("Put %@ on the list", f.name))
                }
            }
        } header: {
            Text(L("Running low soon"))
        } footer: {
            Text(L("An estimate from past purchases and usage. Your stock is never changed by it."))
        }
    }

    /// GET /api/shopping/export.txt → share sheet (private rows stay out, discreet ones keep their placeholder)
    fileprivate func shareList() async {
        do {
            let text = try await store.api.exportList()
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { show(L("The list is empty.")); return }
            shareText = ShareText(text: (store.list.currentList?.name ?? L("Shopping list")) + "\n" + text)
        } catch {
            show(APIError.from(error).localizedDescription)
        }
    }

    fileprivate func show(_ text: String) { toast = text }

    @ViewBuilder fileprivate var toastView: some View {
        if let toast {
            Text(toast)
                .font(.subheadline)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(Theme.ink, in: Capsule())
                .foregroundStyle(Theme.canvas)
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .task(id: toast) {
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                    self.toast = nil
                }
        }
    }
}

/// UIActivityViewController for plain text (copy, Messages, WhatsApp …).
struct ShopActivitySheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - 14 Oct 2026 parity: groups, "I'm at", care lists, shop tools, typing suggestions, who gets what

/// One block of the list: an aisle (or another store / a care list in the shop), or "Mira is getting these" while
/// someone else is shopping – what they took on waits in their group, nobody buys it twice.
struct ShopGroup: Identifiable {
    let key: String
    let title: String
    let items: [ShopItem]
    var taken = false
    var id: String { key }
}

/// a product that matches what is being typed (and the quantity typed with it)
struct TypedMatch: Identifiable {
    let product: ProductInfo
    let qty: Double?
    var id: Int { product.id }
}

extension ShoppingView {
    fileprivate var isMainList: Bool { (store.list.listId?.value ?? "0") == "0" }

    fileprivate func sectionTitle(_ key: String) -> String {
        if key.hasPrefix("list:") {
            let id = String(key.dropFirst(5))
            return store.list.lists.first { $0.id.value == id }?.name ?? L("Other list")
        }
        return ShopSectionKey.label(key)
    }

    fileprivate var groups: [ShopGroup] {
        var shoppers: [Int: String] = [:]
        for t in others { if let id = t.user.id { shoppers[id] = t.user.name } }
        let taken: (ShopItem) -> Bool = { i in i.claim?.userId.map { shoppers[$0] != nil } ?? false }
        var out = store.list.sections.map { ShopGroup(key: $0.key, title: sectionTitle($0.key), items: $0.items.filter { !taken($0) }) }
            .filter { !$0.items.isEmpty }
        let open = store.list.sections.flatMap(\.items)
        for (uid, name) in shoppers.sorted(by: { $0.value < $1.value }) {
            let theirs = open.filter { $0.claim?.userId == uid }
            if !theirs.isEmpty { out.append(ShopGroup(key: "taken:\(uid)", title: LF("%@ is getting these", name), items: theirs, taken: true)) }
        }
        return out
    }

    /// "Ich bin bei …": sorts the list by that shop's aisles without switching to the shop view
    fileprivate var atStoreSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Space.s2) {
                    Label(L("I’m at"), systemImage: "storefront").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink2)
                    ForEach(store.list.stores) { s in
                        let on = store.storeId == s.id && !shopMode
                        ShopToggleChip(title: s.name, on: on) {
                            Haptics.tick()
                            Task { await store.setStore(on ? nil : s.id, shopMode: false) }
                        }
                        .accessibilityHint(L("Sorts the list by this shop's aisles"))
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
    }

    /// a list somebody shops for someone else: the handover note and the fridge check before the visit
    fileprivate func careSection(_ l: ListRef) -> some View {
        Section {
            if let note = l.note, !note.isEmpty {
                Label {
                    Text(L("Handover") + ": ").fontWeight(.semibold) + Text(note)
                } icon: {
                    Image(systemName: "note.text").foregroundStyle(Theme.primaryText)
                }
                .font(.subheadline)
            }
            Button { careList = l } label: {
                Label(L("Fridge check before the visit"), systemImage: "refrigerator")
            }
        }
    }

    /// in the shop: switch the shop, add one, set its aisle order
    fileprivate var shopToolsSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Space.s2) {
                    ForEach(store.list.stores) { s in
                        ShopToggleChip(title: s.name, systemImage: "storefront", on: store.list.store?.id == s.id) {
                            Haptics.tick()
                            enterShop(s.id)
                        }
                    }
                    ShopToggleChip(title: L("Other store"), systemImage: "plus", on: false) { showNewStore = true }
                }
                .padding(.vertical, 2)
            }
            HStack {
                Label(L("Sorted by aisle · works without a connection, too"), systemImage: "arrow.up.arrow.down")
                    .font(.caption).foregroundStyle(Theme.ink3)
                Spacer(minLength: 0)
                if let s = store.list.store, store.list.sections.count > 1 {
                    Button(L("Change the aisle order")) { orderStore = s }.font(.caption.weight(.semibold))
                }
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
    }

    fileprivate func createStore() {
        let name = newStoreName.trimmingCharacters(in: .whitespaces)
        newStoreName = ""
        guard !name.isEmpty else { return }
        Task {
            do {
                try await store.api.createStore(name: name)
                let all = (try? await store.api.stores()) ?? []
                Haptics.success()
                enterShop(all.last { $0.name == name }?.id)
            } catch {
                show(APIError.from(error).localizedDescription)
            }
        }
    }

    /// "Wer holt was" – who said "I'll get it" for what, just so nobody buys twice (no points, no ranking)
    @ViewBuilder fileprivate var whoGetsWhatSection: some View {
        let open = store.list.sections.flatMap(\.items)
        let claimed = open.filter { $0.claim != nil }
        if !claimed.isEmpty {
            let names = Array(Set(claimed.compactMap { $0.claim?.name })).sorted()
            Section {
                ForEach(names, id: \.self) { name in
                    let mine = claimed.filter { $0.claim?.name == name }
                    HStack(alignment: .top, spacing: Theme.Space.s3) {
                        ShopMemberDot(name: name, color: mine.first?.claim?.color, size: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name).font(.subheadline.weight(.semibold))
                            Text(mine.map { $0.productName ?? $0.text }.joined(separator: ", ")).font(.caption).foregroundStyle(Theme.ink2)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
                let rest = open.filter { $0.claim == nil }
                if !rest.isEmpty {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Still open")).font(.subheadline.weight(.semibold))
                        Text(rest.map { $0.productName ?? $0.text }.joined(separator: ", ")).font(.caption).foregroundStyle(Theme.ink3).lineLimit(3)
                    }
                    .accessibilityElement(children: .combine)
                }
            } header: {
                Text(L("Who gets what"))
            } footer: {
                Text(L("Just so nobody buys it twice. No points, no ranking."))
            }
        }
    }

    /// second line of a row: for whom (WG), where to buy, and in the shop what was bought last time
    fileprivate func extraLine(_ item: ShopItem) -> String? {
        var parts: [String] = []
        if let o = item.owner?.name { parts.append(LF("for %@", o)) }
        if let b = item.buyAt, !b.isEmpty { parts.append(LF("at %@", b.joined(separator: ", "))) }
        if shopMode, (item.note ?? "").isEmpty, let l = item.lastBought {
            let last = [l.name, l.size, l.shop, l.price.map { Money.format($0) }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            if !last.isEmpty { parts.append(LF("last time: %@", last)) }
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    // MARK: typing suggestions (fast add, like pon / That Shopping List)

    /// products matching what is typed: exact, then starts with, then a word starts with, then contains –
    /// the often-bought first. One fragment only ("2 milk" still matches milk and keeps the 2).
    fileprivate var typedMatches: [TypedMatch] {
        guard !input.isEmpty, !products.isEmpty else { return [] }
        let parsed = QuickAddParser.parse(input)
        guard parsed.count == 1, let first = parsed.first else { return [] }
        let n = first.name.trimmingCharacters(in: .whitespaces).lowercased()
        guard n.count >= 2 else { return [] }
        func rank(_ p: ProductInfo) -> Int? {
            let name = p.name.lowercased()
            if name == n { return 0 }
            if name.hasPrefix(n) { return 1 }
            if name.split(separator: " ").contains(where: { $0.hasPrefix(n) }) { return 2 }
            if (p.brand.map { "\($0) \(p.name)" } ?? p.name).lowercased().contains(n) { return 3 }
            return nil
        }
        let scored = products.compactMap { p in rank(p).map { (p, $0) } }
        let top = scored.sorted { a, b in
            if a.1 != b.1 { return a.1 < b.1 }
            let ca = usualCount[a.0.id] ?? 0, cb = usualCount[b.0.id] ?? 0
            if ca != cb { return ca > cb }
            return a.0.name.count < b.0.name.count
        }
        return top.prefix(6).map { TypedMatch(product: $0.0, qty: first.qty) }
    }

    fileprivate func typedRow(_ p: ProductInfo, qty: Double?) -> some View {
        let onList = store.list.openItems.contains { $0.productId == p.id }
        let stock = (p.total ?? 0) > 0 ? LF("%@ in stock", Self.number(p.total ?? 0)) : L("not in stock")
        return Button {
            addSuggested(p, qty: qty)
        } label: {
            HStack(spacing: Theme.Space.s3) {
                ProductThumb(path: p.imagePath, api: store.api, size: 32)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        if let q = qty, q != 1 { Text(Self.number(q) + "×").foregroundStyle(Theme.primaryText).fontWeight(.semibold) }
                        Text(p.name).foregroundStyle(Theme.ink)
                    }
                    .font(.subheadline)
                    Text([p.brand, onList ? L("already on the list") : stock].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(onList ? Theme.primaryText : Theme.ink3)
                }
                Spacer(minLength: 0)
                Image(systemName: "plus.circle").foregroundStyle(Theme.primary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(LF("Put %@ on the list", p.name))
    }

    fileprivate static func number(_ v: Double) -> String {
        v.rounded() == v ? String(Int(v)) : String(v).replacingOccurrences(of: ".", with: ",")
    }

    /// a tapped suggestion: linked to the product, the field empties and keeps the keyboard for the next one
    fileprivate func addSuggested(_ p: ProductInfo, qty: Double?) {
        Haptics.tick()
        input = ""
        preview = []
        inputFocused = true
        if visibility != .all {
            let vis = visibility
            visibility = .all
            let text = qty.map { "\(Self.number($0)) \(p.name)" } ?? p.name
            Task { await addHidden(text, vis) }
            return
        }
        Task { await store.addProduct(p.id, name: p.name, qty: qty, onShownList: true) }
    }

    fileprivate func loadProducts() async {
        guard products.isEmpty, !app.isGuest else { return }
        products = (try? await store.api.products()) ?? []
        let u = (try? await store.api.usuals()) ?? []
        usualCount = Dictionary(u.map { ($0.productId, $0.count ?? 0) }, uniquingKeysWith: { a, _ in a })
    }
}

extension ShoppingView {
    @ViewBuilder fileprivate var topSections: some View {
        if !shopMode {
            addSection
            if !store.list.stores.isEmpty { atStoreSection }
            if let l = store.list.currentList, l.kind == "care" { careSection(l) }
            if isMainList && !app.isGuest {
                LunchboxSuggestionSection(store: store) { n in show(LF("%d lunchbox things on the list", n)) }
            }
            if !suggestions.isEmpty { suggestionStrip }
            if !forecast.isEmpty { forecastSection }
            if isMainList && !app.isGuest {
                OffersStripSection(store: store) { showOffers = true }
            }
        } else if !store.list.stores.isEmpty || store.list.store != nil {
            shopToolsSection
        }
    }

    @ViewBuilder fileprivate var groupSections: some View {
        ForEach(groups) { section in
            Section {
                ForEach(section.items) { item in
                    if section.taken {
                        row(item)
                    } else {
                        row(item)
                            .dropDestination(for: String.self) { items, _ in drop(items, into: section.key) }
                    }
                }
            } header: {
                if section.taken {
                    Label(section.title, systemImage: "figure.walk.motion")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.primaryText)
                } else {
                    HStack {
                        Label(section.title, systemImage: ShopSectionKey.icon(section.key))
                        Spacer()
                        Text("\(section.items.count)").monospacedDigit().foregroundStyle(Theme.ink3)
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(dropSection == section.key ? Theme.primaryText : Theme.ink2)
                    .dropDestination(for: String.self) { items, _ in drop(items, into: section.key) } isTargeted: { on in
                        dropSection = on ? section.key : nil
                    }
                }
            }
        }
    }
}
