import SwiftUI

struct ProductDetailView: View {
    let productId: Int
    let store: ServerStore
    @State private var product: ProductInfo?
    @State private var extra = ProductExtra()
    @State private var fresh: FreshProduct?
    @State private var places: [Place] = []
    @State private var categories: [ProductCategory] = []
    @State private var error: String?
    @State private var busy = false
    @State private var toast: String?
    @State private var prices: [ShopPrice] = []
    @State private var showEdit = false
    @State private var showImage = false
    @State private var showBatch = false
    @State private var showBuyAt = false
    @State private var dateEntry: FreshProduct.Entry?
    // web parity (docs/ios-native-places.md): order menu, staple, barcodes, receipts, fresh panel, runs out, labels
    @State private var more = ProductMore()
    @State private var freshMore: FreshMore?
    @State private var showPortion = false
    @Environment(AppModel.self) private var app: AppModel?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                if let p = product {
                    header(p)
                    amountCard(p)
                    batchesCard(p)
                    if p.trackMode != "none" {
                        FreshActionsCard(product: p, more: more, fresh: fresh, freshMore: freshMore, store: store, changed: { msg in
                            toast = msg
                            Task { await load() }
                        }, eatenUp: { dismiss() })
                    }
                    actions(p)
                    if p.trackMode != "none" && !more.isLeftover {
                        RunsOutRow(productId: p.id, on: more.runsOutOn, api: store.api) { store.touch("products") }
                    }
                    whereCard(p)
                    if !prices.isEmpty { pricesCard }
                    if !p.history.isEmpty { historyCard(p) }
                } else if let error {
                    ErrorBanner(message: error) { Task { await load() } }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(Theme.Space.s4)
            .padding(.bottom, 80)
        }
        .canvasBackground()
        .navigationTitle(product?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(L("Edit")) { showEdit = true }.disabled(product == nil)
            }
            if let p = product, app?.isGuest != true {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { LabelsView(api: store.api, kind: .product, preselect: p.id) } label: { Image(systemName: "qrcode") }
                        .accessibilityLabel(L("QR label"))
                }
            }
        }
        .task(id: store.revision("stock") + store.revision("products")) { await load() }
        .sheet(isPresented: $showEdit) {
            if let p = product {
                ProductEditSheet(product: p, extra: extra, more: more, places: places, categories: categories, store: store, saved: {
                    Task { await load() }
                }, deleted: { dismiss() })
            }
        }
        .sheet(isPresented: $showImage) {
            if let p = product {
                ProductImageSheet(productId: p.id, name: p.name, brand: p.brand, currentPath: p.imagePath, credit: extra.imageCredit,
                                  store: store) { Task { await load() } }
            }
        }
        .sheet(isPresented: $showBatch) {
            if let p = product {
                AddBatchSheet(product: p, places: places, store: store) { msg in
                    toast = msg
                    Task { await load() }
                }
            }
        }
        .sheet(isPresented: $showBuyAt) {
            if let p = product { ProductBuyAtSheet(product: p, stores: extra.stores, store: store) { Task { await load() } } }
        }
        .sheet(item: $dateEntry) { e in
            BatchDateSheet(entry: e, store: store) { Task { await load() } }
        }
        .sheet(isPresented: $showPortion) {
            if let p = product {
                PortionLabelSheet(product: p, leftover: more.isLeftover, hasFreezer: fresh?.hasFreezer ?? places.contains { $0.kind == "freezer" },
                                  api: store.api) { msg in
                    toast = msg
                    store.touch("stock", "products")
                    Task { await load() }
                }
            }
        }
        .onAppear {
            #if DEBUG
            if UserDefaults.standard.bool(forKey: "debugProductImage") {
                Task { try? await Task.sleep(nanoseconds: 1_200_000_000); showImage = true }
            }
            if UserDefaults.standard.bool(forKey: "debugProductEdit") {
                Task { try? await Task.sleep(nanoseconds: 1_200_000_000); showEdit = true }
            }
            #endif
        }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast).font(.subheadline).padding(12).background(Theme.ink, in: Capsule()).foregroundStyle(Theme.canvas)
                    .padding(.bottom, 24)
                    .task(id: toast) { try? await Task.sleep(nanoseconds: 2_500_000_000); self.toast = nil }
            }
        }
    }

    /// GET /api/prices/product/:id – from the household's own receipts, cheapest first
    private var pricesCard: some View {
        Card(title: L("Prices from your receipts"), systemImage: "eurosign") {
            ForEach(Array(prices.prefix(5).enumerated()), id: \.offset) { i, p in
                HStack {
                    Text(p.shop ?? "–").fontWeight(i == 0 ? .semibold : .regular)
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text(Money.format(p.price)).fontWeight(i == 0 ? .semibold : .regular)
                        Text([p.baseLabel, ServerDate.shortDay(p.day)].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                .font(.subheadline)
            }
        }
    }

    private func load() async {
        let api = store.api
        do {
            // one GET /api/products/:id, read three ways
            let data = try await api.getData("api/products/\(productId)")
            product = try api.decode(ProductInfo.self, from: data)
            extra = (try? api.decode(ProductExtra.self, from: data)) ?? ProductExtra()
            more = (try? api.decode(ProductMore.self, from: data)) ?? ProductMore()
            error = nil
            async let f = try? api.getData("api/fresh/products/\(productId)")
            async let pl = try? api.places()
            async let c = try? api.categories()
            async let pr = try? api.prices(product: productId)
            if let fd = await f {
                fresh = try? api.decode(FreshProduct.self, from: fd)
                freshMore = try? api.decode(FreshMore.self, from: fd)
            }
            places = await pl ?? places
            categories = await c ?? categories
            prices = await pr ?? []
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func placeName(_ id: Int?) -> String {
        guard let id else { return L("No place") }
        return places.first { $0.id == id }.map { $0.path ?? $0.name } ?? L("No place")
    }

    private func header(_ p: ProductInfo) -> some View {
        HStack(spacing: Theme.Space.s4) {
            Button { showImage = true } label: {
                RemoteImage(url: store.api.imageURL(p.imagePath), api: store.api, placeholder: "camera")
                    .frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: p.imagePath == nil ? "plus" : "camera.fill")
                            .font(.caption2.weight(.bold)).foregroundStyle(Theme.onPrimary)
                            .frame(width: 24, height: 24).background(Theme.primary, in: Circle())
                            .overlay(Circle().stroke(Theme.canvas, lineWidth: 2))
                            .offset(x: 4, y: 4)
                    }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(p.imagePath == nil ? L("Add a picture") : L("Change the picture"))
            VStack(alignment: .leading, spacing: 4) {
                Text(p.name).font(Theme.title(Theme.FontSize.h2))
                let sub = [p.brand, categories.first { $0.id == p.categoryId }?.name].compactMap { $0 }.joined(separator: " · ")
                if !sub.isEmpty { Text(sub).foregroundStyle(Theme.ink2) }
                FlowLayout(spacing: 6) {
                    if let size = p.size, !size.isEmpty { StatusPill(text: size, status: nil) }
                    if let s = p.statusLabel { StatusPill(text: s, status: p.status) }
                    if more.isStaple == true { StatusPill(text: L("always stocked"), status: nil) }
                    if more.orderable == true {
                        // the menu editor (pictures, choices, groups) – web /bestellen/karte?item=
                        NavigationLink { MenuEditorView(store: store) } label: {
                            StatusPill(text: L("on the order menu"), status: "ok")
                        }
                        .accessibilityHint(L("Opens the menu"))
                    }
                }
            }
        }
    }

    private func amountCard(_ p: ProductInfo) -> some View {
        Card(title: L("At home"), systemImage: "cabinet") {
            if p.isLevel {
                Picker(L("Level"), selection: Binding(get: { Int((p.total ?? 0).rounded()) }, set: { v in Task { await set(Double(v)) } })) {
                    Text(L("empty")).tag(0)
                    Text(L("low")).tag(1)
                    Text(L("half")).tag(2)
                    Text(L("full")).tag(3)
                }
                .pickerStyle(.segmented)
            } else if p.isTracked {
                HStack {
                    Button { Task { await adjust(-1) } } label: { Image(systemName: "minus.circle.fill").font(.title) }
                        .disabled((p.total ?? 0) <= 0 || busy)
                        .accessibilityLabel(L("One less"))
                    Spacer()
                    Text(p.amountLabel).font(.title2.weight(.semibold)).monospacedDigit()
                    Spacer()
                    Button { Task { await adjust(1) } } label: { Image(systemName: "plus.circle.fill").font(.title) }
                        .disabled(busy)
                        .accessibilityLabel(L("One more"))
                }
                .foregroundStyle(Theme.primary)
                if let m = p.minQty, m > 0 {
                    Text(LF("Keep at least %@", String(format: "%g", m))).font(.caption).foregroundStyle(Theme.ink3)
                }
            } else {
                Text(L("This product isn't counted – ToHuus just remembers when you buy it.")).font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let w = p.perWeek { Text(LF("About %@ per week", String(format: "%.1f", w))).font(.caption).foregroundStyle(Theme.ink3) }
        }
    }

    /// Batches: where, how many, best before, opened / frozen – with the actions per batch
    private func batchesCard(_ p: ProductInfo) -> some View {
        Card(title: L("Where and until when"), systemImage: "calendar") {
            let entries = fresh?.entries ?? p.stock.map {
                FreshProduct.Entry(id: $0.id, locationId: $0.locationId, qty: $0.qty, bestBefore: $0.bestBefore, openedAt: $0.openedAt, bbEstimated: $0.bbEstimated == 1)
            }
            if entries.isEmpty {
                Text(L("Nothing at home right now.")).font(.subheadline).foregroundStyle(Theme.ink3)
            }
            ForEach(entries) { e in batchRow(p, e) }
            if p.isTracked {
                Button { showBatch = true } label: { Label(L("Put some away – with date and place"), systemImage: "plus") }
                    .font(.subheadline.weight(.semibold))
                    .padding(.top, 2)
            }
        }
    }

    private func batchRow(_ p: ProductInfo, _ e: FreshProduct.Entry) -> some View {
        HStack(alignment: .center, spacing: Theme.Space.s3) {
            VStack(alignment: .leading, spacing: 3) {
                Text(placeName(e.locationId)).font(.subheadline.weight(.semibold))
                HStack(spacing: 6) {
                    Text(dateLine(e)).font(.caption).foregroundStyle(Theme.ink2)
                    if e.inFreezer == true { StatusPill(text: L("frozen"), status: nil) }
                    if e.openedAt != nil { StatusPill(text: L("opened"), status: "expiring") }
                }
            }
            Spacer(minLength: 0)
            Text(String(format: "%g", e.qty ?? 0)).font(.subheadline).monospacedDigit()
            Menu {
                Button { dateEntry = e } label: { Label(L("Change the date"), systemImage: "calendar") }
                if e.openedAt == nil && e.inFreezer != true {
                    Button { Task { await freshAct(p, "open", e) } } label: { Label(L("Opened"), systemImage: "drop") }
                }
                if e.inFreezer == true {
                    Button { Task { await freshAct(p, "thaw", e) } } label: { Label(L("Thaw"), systemImage: "sun.max") }
                } else if fresh?.hasFreezer == true {
                    Button { Task { await freshAct(p, "freeze", e) } } label: { Label(L("Freeze"), systemImage: "snowflake") }
                }
                let others = places.filter { $0.id != e.locationId && $0.system != true }
                if !others.isEmpty {
                    Menu {
                        ForEach(others) { pl in
                            Button(pl.path ?? pl.name) { Task { await move(e, to: pl) } }
                        }
                    } label: { Label(L("Move to"), systemImage: "arrow.right.square") }
                }
            } label: {
                Image(systemName: "ellipsis.circle").font(.title3).foregroundStyle(Theme.primaryText)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(LF("Actions for %@", placeName(e.locationId)))
        }
    }

    private func dateLine(_ e: FreshProduct.Entry) -> String {
        if let u = e.useBy ?? e.bestBefore, let d = ServerDate.shortDay(u) {
            if e.openedAt != nil || e.inFreezer == true { return LF("use by %@", d) }
            // no printed date yet – the usual shelf life (web: Product.tsx, same wording)
            return e.bbEstimated == true ? LF("best before %@", d) + " · " + L("estimated") : LF("best before %@", d)
        }
        return L("no date")
    }

    private func actions(_ p: ProductInfo) -> some View {
        VStack(spacing: Theme.Space.s3) {
            if !more.isLeftover {
                Button {
                    Task { await usedUp() }
                } label: {
                    Label(L("Used up – put it on the list"), systemImage: "arrow.uturn.down.circle")
                }
                .buttonStyle(PrimaryButtonStyle())
                Button {
                    Task {
                        await store.addProduct(p.id, name: p.name)
                        toast = L("On the list.")
                    }
                } label: {
                    Label(L("Just put it on the list"), systemImage: "cart.badge.plus")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            if p.trackMode != "none" {
                let fridgeOnly = more.isLeftover || fresh?.hasFreezer == false
                Button { showPortion = true } label: {
                    Label(fridgeOnly ? L("Label") : L("Freeze & label"), systemImage: "tag")
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityHint(fridgeOnly ? L("Label leftovers") : L("Portion, freeze, label"))
            }
        }
        .disabled(busy)
    }

    /// Where it lives, the exact spot, how it is counted and where to buy it
    private func whereCard(_ p: ProductInfo) -> some View {
        Card(title: L("Details"), systemImage: "info.circle") {
            detailRow(L("Usually kept in"), placeName(p.defaultLocationId))
            if let spot = p.spot, !spot.isEmpty { detailRow(L("Exact spot"), spot) }
            detailRow(L("Counting"), trackLabel(p.trackMode))
            if let codes = more.codes, !codes.isEmpty { detailRow(L("Barcode"), codes.joined(separator: ", ")) }
            if let aliases = more.aliases, !aliases.isEmpty { detailRow(L("On receipts"), aliases.prefix(4).map { $0.alias.uppercased() }.joined(separator: " · ")) }
            if let n = p.notes, !n.isEmpty { detailRow(L("Note"), n) }
            Divider()
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Where to buy?")).font(.caption).foregroundStyle(Theme.ink3)
                    Text(extra.stores.isEmpty ? L("Anywhere – no shop set") : extra.stores.joined(separator: " · "))
                        .font(.subheadline.weight(extra.stores.isEmpty ? .regular : .semibold))
                        .foregroundStyle(extra.stores.isEmpty ? Theme.ink3 : Theme.ink)
                }
                Spacer()
                Button(extra.stores.isEmpty ? L("Add shop") : L("Change")) { showBuyAt = true }
                    .buttonStyle(.bordered).controlSize(.small)
            }
        }
    }

    private func detailRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.subheadline).foregroundStyle(Theme.ink2)
            Spacer(minLength: 12)
            Text(value).font(.subheadline).multilineTextAlignment(.trailing)
        }
    }

    /// movement reasons in words (web Product.tsx reasonText)
    static func reasonText(_ r: String?) -> String? {
        guard let r else { return nil }
        let words: [String: String] = [
            "import": L("Purchase imported"), "manual": L("by hand"), "consume": L("used"), "order": L("Guest order"),
            "cook": L("while cooking"), "inventory": L("Stocktake"), "purchase": L("bought"), "assistant": L("via assistant"),
            "move": L("moved"), "undo": L("undone"), "scan": L("via scan"), "waste": L("thrown away"), "freeze": L("frozen"),
            "thaw": L("thawed"), "leftover": L("leftovers put away"),
        ]
        return words[r] ?? r
    }

    private func trackLabel(_ m: String?) -> String {
        switch m {
        case "level": return L("Fill level")
        case "none": return L("Not counted")
        default: return L("Pieces")
        }
    }

    private func historyCard(_ p: ProductInfo) -> some View {
        Card(title: L("History"), systemImage: "clock") {
            ForEach(p.history.prefix(8)) { m in
                HStack {
                    Text((m.delta ?? 0) > 0 ? "+\(String(format: "%g", m.delta ?? 0))" : String(format: "%g", m.delta ?? 0)).monospacedDigit()
                        .foregroundStyle((m.delta ?? 0) > 0 ? Theme.primaryText : Theme.ink2)
                        .frame(width: 44, alignment: .leading)
                    Text([Self.reasonText(m.reason), m.actor].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")).foregroundStyle(Theme.ink2)
                    Spacer()
                    Text(ServerDate.relative(m.createdAt) ?? "").foregroundStyle(Theme.ink3)
                }
                .font(.caption)
            }
        }
    }

    // MARK: actions

    private func adjust(_ delta: Double) async {
        busy = true
        defer { busy = false }
        Haptics.tick()
        do {
            try await store.api.adjustStock(productId: productId, delta: delta)
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func set(_ value: Double) async {
        busy = true
        defer { busy = false }
        do {
            try await store.api.adjustStock(productId: productId, set: value)
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func freshAct(_ p: ProductInfo, _ action: String, _ e: FreshProduct.Entry) async {
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.freshAction(p.id, action, entryId: e.id, qty: action == "open" ? nil : e.qty)
            Haptics.success()
            switch action {
            case "open": toast = r.useBy.flatMap { ServerDate.shortDay($0) }.map { LF("Opened – use by %@", $0) } ?? L("Marked as opened")
            case "freeze": toast = r.bestBefore.flatMap { ServerDate.shortDay($0) }.map { LF("Frozen – keeps until %@", $0) } ?? L("Frozen")
            default: toast = r.eatBy.flatMap { ServerDate.shortDay($0) }.map { LF("Thawed – eat by %@", $0) } ?? L("Thawed")
            }
            store.touch("stock")
            await load()
        } catch { toast = APIError.from(error).localizedDescription }
    }

    private func move(_ e: FreshProduct.Entry, to place: Place) async {
        do {
            try await store.api.patchBatch(e.id, locationId: place.id)
            Haptics.tick()
            toast = LF("Moved to %@", place.name)
            store.touch("stock")
            await load()
        } catch { toast = APIError.from(error).localizedDescription }
    }

    private func usedUp() async {
        busy = true
        defer { busy = false }
        do {
            try await store.api.usedUp(productId)
            Haptics.success()
            toast = L("Used up and on the list.")
            store.touch("stock", "shopping")
            await store.refreshList()
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

extension FreshProduct.Entry {
    init(id: Int, locationId: Int?, qty: Double?, bestBefore: String?, openedAt: String?, bbEstimated: Bool = false) {
        self.id = id
        self.locationId = locationId
        self.qty = qty
        self.bestBefore = bestBefore
        self.openedAt = openedAt
        self.bbEstimated = bbEstimated
    }
}
