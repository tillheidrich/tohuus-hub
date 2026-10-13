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
    @State private var newListName = ""
    @State private var showNewList = false
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
    @AppStorage("list.density") private var densityRaw = ListDensity.normal.rawValue
    @AppStorage("list.fontScale") private var fontScale = 1.0
    /// Dynamic Type on top of the list's own size setting (1 at the default text size)
    @ScaledMetric(relativeTo: .body) private var typeScale: CGFloat = 1
    @FocusState private var inputFocused: Bool

    struct UndoAction: Equatable {
        let item: ShopItem
        let wasChecked: Bool
        let text: String
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
                if !shopMode {
                    addSection
                    if !suggestions.isEmpty { suggestionStrip }
                    if !forecast.isEmpty { forecastSection }
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
                                .dropDestination(for: String.self) { items, _ in drop(items, into: section.key) }
                        }
                    } header: {
                        Label(ShopSectionKey.label(section.key), systemImage: ShopSectionKey.icon(section.key))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(dropSection == section.key ? Theme.primaryText : Theme.ink2)
                            .dropDestination(for: String.self) { items, _ in drop(items, into: section.key) } isTargeted: { on in
                                dropSection = on ? section.key : nil
                            }
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
                        Text(LF("In the basket (%d) – crossed out until you're done", store.list.basket.count))
                    }
                }
                doneSection
                estimateSection
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
            .sheet(isPresented: $showShopSettings) { ShopSettingsSheet(store: store) }
            .sheet(item: $manageList) { l in ManageListSheet(list: l, store: store) }
            .sheet(item: $shareText) { t in ShopActivitySheet(items: [t.text]).presentationDetents([.medium, .large]) }
            .overlay(alignment: .top) { toastView }
            .alert(L("New list"), isPresented: $showNewList) {
                TextField(L("Name, e.g. Drugstore"), text: $newListName)
                Button(L("Create")) { createList() }
                Button(L("Cancel"), role: .cancel) { newListName = "" }
            }
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
            .onAppear { consumeAdd() }
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
                    Task { await store.checkout(toStock: true); Haptics.success() }
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

    @ViewBuilder private var estimateSection: some View {
        if let est = store.list.expected, let total = est.total {
            Section {
                LabeledContent {
                    Text("≈ " + Money.format(total, currency: est.currency)).font(.headline)
                } label: {
                    VStack(alignment: .leading) {
                        Text(L("Expected total"))
                        if let priced = est.priced, let unpriced = est.unpriced, unpriced > 0 {
                            Text(LF("prices known for %d of %d things", priced, priced + unpriced)).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
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
        if !others.isEmpty || !mine.isEmpty {
            Section {
                ForEach(others) { trip in
                    HStack(spacing: Theme.Space.s3) {
                        Image(systemName: "figure.walk.motion").foregroundStyle(Theme.primaryText)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(trip.store.map { LF("%@ is shopping at %@", trip.user.name, $0.name) } ?? LF("%@ is shopping right now", trip.user.name))
                                .font(.subheadline.weight(.semibold))
                            Text(tripLine(trip)).font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 0)
                        Button(L("Add a wish")) { wishTrip = trip }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
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
        .accessibilityAction(named: L("Remove")) { Task { await store.delete(item) } }
        .draggable(ItemDrag(id: item.id).payload)
        .swipeActions(edge: .leading) {
            if !item.isChecked && item.id > 0 && (me?.claimsOn ?? true) {
                let mine = item.claim != nil && item.claim?.userId == me?.userId
                Button {
                    Task { await claim(item, on: !mine) }
                } label: {
                    Label(mine ? L("Release") : L("I'll get it"), systemImage: mine ? "hand.raised.slash" : "hand.raised.fill")
                }
                .tint(mine ? Theme.ink3 : Theme.primary)
            }
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Task { await store.delete(item) }
            } label: {
                Label(L("Remove"), systemImage: "trash")
            }
            Button {
                detailItem = item
            } label: {
                Label(L("Details"), systemImage: "square.and.pencil")
            }
            .tint(Theme.info)
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
            Button(role: .destructive) { Task { await store.delete(item) } } label: { Label(L("Remove"), systemImage: "trash") }
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
            if single, store.isOnline, let hints = try? await store.api.guardHints(text: text), let ask = hints.first(where: \.asks) {
                guardMessage = ask.text
                guardText = text
                return
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
                            HStack(spacing: 6) {
                                ProductThumb(path: s.image, api: store.api, size: 26)
                                Image(systemName: "plus").imageScale(.small)
                                Text(s.name).lineLimit(1)
                            }
                                .font(.subheadline)
                                .padding(.leading, s.image == nil ? 12 : 5).padding(.trailing, 12).padding(.vertical, s.image == nil ? 8 : 5)
                                .background(Theme.primarySoft, in: Capsule())
                                .foregroundStyle(Theme.primaryText)
                        }
                        .buttonStyle(.plain)
                        .hoverEffect(.lift)
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

    // MARK: lists

    private func setPrivate(_ on: Bool) {
        tripPrivate = on
        Task { try? await store.api.setTripPrivacy(on) }
    }

    private func createList() {
        let name = newListName.trimmingCharacters(in: .whitespaces)
        newListName = ""
        guard !name.isEmpty else { return }
        Task {
            try? await store.api.createShopList(name: name)
            await store.refreshList()
        }
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
        if store.list.lists.count > 1 || listsSupported {
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
                        Button { showNewList = true } label: { Label(L("New list"), systemImage: "plus") }
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
                Button { showOffers = true } label: { Label(L("Offers"), systemImage: "tag") }
                Button { showWishes = true } label: { Label(L("Wishes & Merkliste"), systemImage: "gift") }
                Divider()
                Button { showPaste = true } label: { Label(L("Paste a list"), systemImage: "doc.on.clipboard") }
                Button { Task { await shareList() } } label: { Label(L("Share the list"), systemImage: "square.and.arrow.up") }
                Button { showShopSettings = true } label: { Label(L("Shops & aisles"), systemImage: "storefront") }
            } label: {
                // receipts, paper lists, usuals, wishes, sharing – more than receipts, so the general "more" symbol
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel(L("More for the list"))
            .accessibilityHint(L("Receipts, paper lists, usuals, wishes and sharing"))
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
