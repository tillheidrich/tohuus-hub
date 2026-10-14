import Observation
import SwiftUI

@MainActor
@Observable
final class PantryModel {
    private(set) var products: [ProductInfo] = []
    private(set) var places: [Place] = []
    private(set) var categories: [ProductCategory] = []
    private(set) var loading = false
    var error: String?

    func load(_ api: APIClient) async {
        loading = true
        defer { loading = false }
        do {
            async let p = api.products()
            async let l = api.places()
            async let c = api.categories()
            products = try await p
            places = (try? await l) ?? places
            categories = (try? await c) ?? categories
            error = nil
        } catch {
            let e = APIError.from(error)
            if !(e.isOffline && !products.isEmpty) { self.error = e.localizedDescription }
        }
    }

    /// web Stock.tsx: things that aren't counted live in "Where is what?", not here; every word must match;
    /// status filters as on the web (attention = use soon, or low/out where someone keeps a minimum or a fill level)
    func filtered(search: String, place: Int?, status: PantryStatus, category: Int? = nil) -> [ProductInfo] {
        let words = search.split(separator: " ").map(String.init)
        return products.filter { p in
            if p.trackMode == "none" { return false }
            if let category, p.categoryId != category { return false }
            if !words.isEmpty {
                let hay = [p.name, p.brand ?? "", p.size ?? "", p.spot ?? ""].joined(separator: " ")
                if !words.allSatisfy({ hay.range(of: $0, options: [.caseInsensitive, .diacriticInsensitive]) != nil }) { return false }
            }
            if let place {
                let here = p.stock.contains { $0.locationId == place && ($0.qty ?? 0) > 0 } || (p.defaultLocationId == place && (p.total ?? 0) <= 0)
                if !here { return false }
            }
            let s = p.status ?? ""
            switch status {
            case .all: return true
            case .expiring: return s == "expiring" || s == "expired"
            case .low: return s == "low"
            case .empty: return s == "empty"
            case .instock: return (p.total ?? 0) > 0
            case .attention:
                let watched = (p.minQty ?? 0) > 0 || p.isLevel
                return s == "expiring" || s == "expired" || ((s == "low" || s == "empty") && watched)
            }
        }
    }

    /// products at home (web eyebrow "{n} products at home")
    var atHome: Int { products.filter { ($0.total ?? 0) > 0 && $0.trackMode != "none" }.count }
}

struct PantryView: View {
    let store: ServerStore
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var width: CGFloat = 0
    /// list + detail side by side only when there is room (not in a narrow Split View or iPad portrait with sidebar)
    private var wide: Bool { sizeClass == .regular && width >= 700 }
    @State private var searching = false
    /// regular width: the product shown next to the list
    @State private var selected: Int?
    @State private var model = PantryModel()
    @State private var search = ""
    @State private var place: Int?
    @State private var status = PantryStatus.all
    @State private var boxes: [LeftoverBox] = []
    @State private var waste: WasteMonth?
    @State private var openBox: LeftoverBox?
    @State private var showLabels = false
    @State private var showPlaces = false
    @State private var newName: String?
    @State private var showScanner = false
    @State private var scanned: BarcodeLookup?
    @State private var scannedCode = ""
    @State private var path: [Int] = []
    // 0.3 parity: grouping, category filter, quick check, "Wo ist was?", leftovers, labels
    @AppStorage("pantry.group") private var groupRaw = PantryGrouping.none.rawValue
    @State private var category: Int?
    @State private var showCheck = false
    @State private var showNew = false
    @State private var showFind = false
    @State private var showLeftovers = false
    @State private var showLabelScan = false
    @State private var scannedLabel: ScannedLabel?
    private var grouping: PantryGrouping { PantryGrouping(rawValue: groupRaw) ?? .none }

    var body: some View {
        NavigationStack(path: $path) {
            HStack(spacing: 0) {
                list
                    .frame(width: wide ? 380 : nil)
                    .frame(maxWidth: wide ? 380 : .infinity)
                if wide {
                    Divider()
                    Group {
                        if let selected {
                            ProductDetailView(productId: selected, store: store).id(selected)
                        } else {
                            EmptyStateView(systemImage: "cabinet", title: L("Choose something on the left."))
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .canvasBackground()
                }
            }
            .onGeometryChangeCompat { w in width = w }
            .navigationTitle(L("Pantry"))
            .rootChrome()
            .navigationDestination(for: Int.self) { id in ProductDetailView(productId: id, store: store) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button { showCheck = true } label: { Label(L("Quick stock check"), systemImage: "checklist") }
                        Button { showFind = true } label: { Label(L("Where is what?"), systemImage: "mappin.and.ellipse") }
                        Divider()
                        Button { showLeftovers = true } label: { Label(L("Put leftovers away"), systemImage: "takeoutbag.and.cup.and.straw") }
                        Button { showLabelScan = true } label: { Label(L("Scan a box label"), systemImage: "qrcode.viewfinder") }
                        if NFCLabels.available {
                            Button {
                                Task { if let link = try? await NFCLabels.read() { scannedLabel = ScannedLabel(raw: link) } }
                            } label: { Label(L("Read NFC tag"), systemImage: "wave.3.right") }
                        }
                        if !app.isGuest {
                            Divider()
                            Button { showLabels = true } label: { Label(L("QR labels"), systemImage: "qrcode") }
                            Button { showPlaces = true } label: { Label(L("Places & categories"), systemImage: "square.grid.2x2") }
                        }
                    } label: {
                        Image(systemName: "checklist")
                    }
                    .accessibilityLabel(L("Check and find"))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker(L("Group by"), selection: $groupRaw) {
                            ForEach(PantryGrouping.allCases) { g in Label(g.title, systemImage: g.icon).tag(g.rawValue) }
                        }
                        if !model.categories.isEmpty {
                            Picker(L("Category"), selection: $category) {
                                Text(L("All categories")).tag(Int?.none)
                                ForEach(model.categories) { c in Text(c.name).tag(Int?.some(c.id)) }
                            }
                        }
                    } label: {
                        Image(systemName: category == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                    }
                    .accessibilityLabel(L("Group and filter"))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showNew = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(L("New product"))
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showScanner = true
                    } label: {
                        Image(systemName: "barcode.viewfinder")
                    }
                    .accessibilityLabel(L("Scan barcode"))
                }
            }
            .sheet(isPresented: $showNew) {
                NewProductSheet(code: nil, lookup: nil, places: model.places, categories: model.categories, store: store) { newId in
                    showNew = false
                    Task {
                        await model.load(store.api)
                        if let newId { open(newId) }
                    }
                }
            }
            .sheet(isPresented: $showCheck) { QuickCheckView(store: store) }
            .sheet(isPresented: $showLabels) {
                NavigationStack {
                    LabelsView(api: store.api)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Done")) { showLabels = false } } }
                }
            }
            .sheet(isPresented: $showPlaces, onDismiss: { Task { await model.load(store.api) } }) {
                NavigationStack {
                    PlacesSettingsView(api: store.api)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Done")) { showPlaces = false } } }
                }
            }
            .sheet(item: $openBox) { b in
                NavigationStack { BoxDetail(code: b.code, store: store) { Task { await loadExtras() } } }
                    .presentationDetents([.medium, .large])
            }
            .sheet(item: Binding(get: { newName.map(NewName.init) }, set: { if $0 == nil { newName = nil } })) { n in
                NewProductSheet(code: nil, lookup: nil, places: model.places, categories: model.categories, store: store, initialName: n.id) { newId in
                    newName = nil
                    Task {
                        await model.load(store.api)
                        if let newId { open(newId) }
                    }
                }
            }
            .sheet(isPresented: $showFind) { FindView(store: store) { id in showFind = false; open(id) } }
            .sheet(isPresented: $showLeftovers) { LeftoversSheet(store: store) }
            .sheet(isPresented: $showLabelScan) {
                ScannerSheet(title: L("Scan a box label"), symbologies: [.qr]) { code in scannedLabel = ScannedLabel(raw: code) }
            }
            .sheet(item: $scannedLabel) { l in LabelQuickActionView(raw: l.raw, store: store) { id in scannedLabel = nil; open(id) } }
            .task {
                #if DEBUG
                let d = UserDefaults.standard
                if d.bool(forKey: "debugCheck") { showCheck = true }
                if d.bool(forKey: "debugFind") { showFind = true }
                if d.bool(forKey: "debugLeftovers") { showLeftovers = true }
                if d.bool(forKey: "debugNewProduct") { showNew = true }
                if let code = d.string(forKey: "debugLabel") { scannedLabel = ScannedLabel(raw: code) }
                if d.integer(forKey: "debugProduct") > 0 {
                    try? await Task.sleep(nanoseconds: 600_000_000)
                    open(d.integer(forKey: "debugProduct"))
                }
                #endif
            }
            .sheet(isPresented: $showScanner) {
                ScannerSheet(title: L("Scan barcode"), symbologies: [.ean13, .ean8, .upce, .code128]) { code in
                    Task { await lookup(code) }
                }
            }
            .sheet(item: Binding(get: { scanned.map { ScanResult(lookup: $0, code: scannedCode) } }, set: { if $0 == nil { scanned = nil } })) { r in
                NewProductSheet(code: r.code, lookup: r.lookup, places: model.places, categories: model.categories, store: store) { newId in
                    scanned = nil
                    Task {
                        await model.load(store.api)
                        if let newId { open(newId) }
                    }
                }
            }
        }
    }

    private func consumeSearch() {
        guard app.searchPending else { return }
        app.searchPending = false
        searching = true
    }

    private func open(_ id: Int) {
        if wide { selected = id } else { path.append(id) }
    }

    private var list: some View {
            List {
                filterBar
                if let error = model.error {
                    ErrorBanner(message: error) { Task { await model.load(store.api) } }.listRowBackground(Color.clear)
                }
                let items = model.filtered(search: search, place: place, status: status, category: category)
                let q = search.trimmingCharacters(in: .whitespaces)
                if items.isEmpty && !model.loading {
                    if q.isEmpty {
                        EmptyStateView(systemImage: "cabinet", title: L("Nothing here yet."),
                                       message: L("Receipts and ticks fill the pantry by themselves – no need to count."))
                            .listRowBackground(Color.clear)
                    } else {
                        EmptyStateView(systemImage: "cabinet", title: LF("Nothing for “%@”", q),
                                       actionTitle: LF("Add “%@”", q), action: { newName = q })
                            .listRowBackground(Color.clear)
                    }
                }
                if q.isEmpty && place == nil && status == .all && category == nil && !boxes.isEmpty {
                    Section {
                        ForEach(boxes) { b in
                            Button { openBox = b } label: { BoxRow(box: b, api: store.api) }
                                .buttonStyle(.plain)
                        }
                    } header: {
                        HStack {
                            Text(L("Leftovers & frozen")).font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink2)
                            Spacer()
                            Button(L("Labels")) { showLabels = true }.font(.footnote.weight(.semibold))
                        }
                    }
                }
                if grouping == .none {
                    ForEach(items) { p in productLink(p) }
                } else {
                    ForEach(groups(items), id: \.key) { g in
                        Section {
                            ForEach(g.items) { p in productLink(p) }
                        } header: {
                            Text(g.title).font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink2)
                        }
                    }
                }
                if let w = waste, w.count > 0 {
                    WasteCardView(waste: w).listRowBackground(Color.clear).listRowSeparator(.hidden)
                }
                Text(L("Some product images from Open Food Facts (CC BY-SA), data under ODbL."))
                    .font(.caption2).foregroundStyle(Theme.ink3)
                    .listRowBackground(Color.clear).listRowSeparator(.hidden)
                Color.clear.frame(height: 72).listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .canvasBackground()
            .searchable(text: $search, isPresented: $searching, prompt: L("Search the pantry"))
            .onChange(of: app.searchRequest) { _, _ in consumeSearch() }
            .onAppear { consumeSearch() }
            .refreshable { await model.load(store.api) }
            .task(id: store.revision("stock") + store.revision("products")) {
                await model.load(store.api)
                await loadExtras()
            }
    }

    @ViewBuilder private func productLink(_ p: ProductInfo) -> some View {
        Group {
            if wide {
                Button { selected = p.id } label: { ProductRow(product: p, api: store.api).contentShape(Rectangle()) }
                    .buttonStyle(.plain)
                    .listRowBackground(selected == p.id ? Theme.primarySoft : Color.clear)
                    .hoverEffect(.highlight)
            } else {
                NavigationLink(value: p.id) { ProductRow(product: p, api: store.api) }
            }
        }
        // web Stock.tsx: a stepper on every row – here a swipe, a long press, or the VoiceOver actions
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if p.isLevel {
                Button { Task { await setLevel(p, min(3, Int((p.total ?? 0).rounded()) + 1)) } } label: { Label(L("Fuller"), systemImage: "plus") }.tint(Theme.primary)
            } else {
                Button { Task { await adjust(p, 1) } } label: { Label(L("One more"), systemImage: "plus") }.tint(Theme.primary)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if p.isLevel {
                Button { Task { await setLevel(p, max(0, Int((p.total ?? 0).rounded()) - 1)) } } label: { Label(L("Less"), systemImage: "minus") }.tint(Theme.ink2)
            } else if (p.total ?? 0) > 0 {
                Button { Task { await adjust(p, -1) } } label: { Label(L("One less"), systemImage: "minus") }.tint(Theme.ink2)
            }
        }
        .contextMenu {
            if p.isLevel {
                ForEach([(3, L("full")), (2, L("half")), (1, L("low")), (0, L("empty"))], id: \.0) { v in
                    Button(v.1) { Task { await setLevel(p, v.0) } }
                }
            } else {
                Button { Task { await adjust(p, 1) } } label: { Label(L("One more"), systemImage: "plus") }
                Button { Task { await adjust(p, -1) } } label: { Label(L("One less"), systemImage: "minus") }.disabled((p.total ?? 0) <= 0)
            }
        }
        .accessibilityAction(named: L("One more")) { Task { await adjust(p, 1) } }
        .accessibilityAction(named: L("One less")) { Task { await adjust(p, -1) } }
    }

    /// the place the change applies to: the filtered place, else where it is, else its usual place (web Stock.tsx)
    private func placeFor(_ p: ProductInfo) -> Int? {
        place ?? p.stock.first { ($0.qty ?? 0) > 0 }?.locationId ?? p.defaultLocationId
    }

    private func adjust(_ p: ProductInfo, _ delta: Double) async {
        if delta < 0 && (p.total ?? 0) <= 0 { return }
        Haptics.tick()
        do {
            try await store.api.adjustStock(productId: p.id, delta: delta, locationId: placeFor(p))
            store.touch("stock")
        } catch { model.error = APIError.from(error).localizedDescription }
    }

    private func setLevel(_ p: ProductInfo, _ v: Int) async {
        Haptics.tick()
        do {
            try await store.api.adjustStock(productId: p.id, set: Double(v), locationId: placeFor(p))
            store.touch("stock")
        } catch { model.error = APIError.from(error).localizedDescription }
    }

    private func loadExtras() async {
        guard app.moduleOn("stock") else { return }
        async let b = try? store.api.boxes()
        async let w = try? store.api.wasteMonth()
        boxes = await b ?? boxes
        waste = await w ?? waste
    }

    /// sections by place (where the stock is, else the usual place) or by category, in the household's order
    private func groups(_ items: [ProductInfo]) -> [(key: String, title: String, items: [ProductInfo])] {
        var out: [(key: String, title: String, items: [ProductInfo])] = []
        switch grouping {
        case .place:
            for pl in model.places {
                let here = items.filter { p in
                    let at = p.stock.first { ($0.qty ?? 0) > 0 }?.locationId ?? p.defaultLocationId
                    return at == pl.id
                }
                if !here.isEmpty { out.append(("p\(pl.id)", pl.path ?? pl.name, here)) }
            }
            let known = Set(model.places.map(\.id))
            let rest = items.filter { p in
                let at = p.stock.first { ($0.qty ?? 0) > 0 }?.locationId ?? p.defaultLocationId
                return at == nil || !known.contains(at!)
            }
            if !rest.isEmpty { out.append(("p-", L("No place"), rest)) }
        case .category:
            for c in model.categories {
                let here = items.filter { $0.categoryId == c.id }
                if !here.isEmpty { out.append(("c\(c.id)", c.name, here)) }
            }
            let known = Set(model.categories.map(\.id))
            let rest = items.filter { $0.categoryId == nil || !known.contains($0.categoryId!) }
            if !rest.isEmpty { out.append(("c-", L("No category"), rest)) }
        case .none:
            out.append(("all", "", items))
        }
        return out
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.s2) {
                chip(L("All"), selected: place == nil && status == .all) { place = nil; status = .all }
                ForEach(PantryStatus.allCases.filter { $0 != .all }) { st in
                    chip(st.title, selected: status == st) { status = status == st ? .all : st }
                }
                if let c = category, let cat = model.categories.first(where: { $0.id == c }) {
                    chip(cat.name + "  ✕", selected: true) { category = nil }
                }
                ForEach(model.places.filter { $0.system != true }) { p in
                    chip(p.name, selected: place == p.id) { place = place == p.id ? nil : p.id }
                }
            }
            .padding(.vertical, 4)
        }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(selected ? Theme.primary : Theme.surface, in: Capsule())
                .foregroundStyle(selected ? Theme.onPrimary : Theme.ink)
                .overlay(Capsule().stroke(selected ? Color.clear : Theme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func lookup(_ code: String) async {
        do {
            let r = try await store.api.lookupBarcode(code)
            if let local = r.local {
                open(local.id)
            } else {
                scannedCode = code
                scanned = r
            }
        } catch {
            model.error = APIError.from(error).localizedDescription
        }
    }
}

struct ScanResult: Identifiable {
    let lookup: BarcodeLookup
    let code: String
    var id: String { code }
}

struct ProductRow: View {
    let product: ProductInfo
    let api: APIClient
    /// optional: rows can show up where the app model is not in the environment
    @Environment(AppModel.self) private var app: AppModel?

    var body: some View {
        HStack(spacing: Theme.Space.s3) {
            RemoteImage(url: api.imageURL(product.imagePath), api: api, placeholder: "shippingbox")
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(product.name).font(Theme.rowFont).foregroundStyle(Theme.ink)
                    SampleTag(on: app?.sampleMarks.products.contains(product.id) == true)
                }
                Text([product.brand, product.amountLabel, expiry].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 0)
            if let s = product.statusLabel { StatusPill(text: s, status: product.status) }
        }
        .padding(.vertical, 2)
    }

    /// next best-before while something is at home (web Stock.tsx expiryText)
    private var expiry: String? {
        guard (product.total ?? 0) > 0, let d = ServerDate.shortDay(product.nextExpiry) else { return nil }
        return product.dateKind == "use_by" ? LF("use by %@", d) : LF("best before %@", d)
    }
}

/// Mehr › Vorrat: how the pantry list is grouped (this device only)
enum PantryGrouping: String, CaseIterable, Identifiable {
    case none, place, category
    var id: String { rawValue }
    var title: String {
        switch self {
        case .none: return L("Not grouped")
        case .place: return L("By place")
        case .category: return L("By category")
        }
    }
    var icon: String {
        switch self {
        case .none: return "list.bullet"
        case .place: return "mappin.and.ellipse"
        case .category: return "tag"
        }
    }
}

/// Stock filters as on the web (Stock.tsx STATUS_FILTERS)
enum PantryStatus: String, CaseIterable, Identifiable {
    case all, attention, expiring, low, empty, instock
    var id: String { rawValue }
    var title: String {
        switch self {
        case .all: return L("Everything")
        case .attention: return L("Needs attention")
        case .expiring: return L("Use soon")
        case .low: return L("Low")
        case .empty: return L("Out")
        case .instock: return L("In stock")
        }
    }
}

private struct NewName: Identifiable { let id: String }

/// "What we threw away in …" (web FreshParts.tsx WasteCard, GET /api/fresh/waste)
struct WasteCardView: View {
    let waste: WasteMonth

    var body: some View {
        Card(title: LF("What we threw away in %@", monthName), systemImage: "trash") {
            Text(waste.items.prefix(5).map { ($0.trackMode == "count" ? "\(($0.qty ?? 0).formatted())× " : "") + $0.name }.joined(separator: ", ")
                 + (waste.items.count > 5 ? " " + LF("+%d more", waste.items.count - 5) : ""))
                .font(.subheadline)
            if let r = waste.byReason, !r.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(r.sorted { $0.value > $1.value }, id: \.key) { e in
                        StatusPill(text: "\(reason(e.key)) · \(e.value)", status: nil)
                    }
                }
            }
            if let tip = waste.tip, !tip.isEmpty { Text(tip).font(.caption).foregroundStyle(Theme.ink2) }
        }
    }

    private var monthName: String {
        guard let d = ServerDate.parse(waste.month + "-15") else { return waste.month }
        return d.formatted(.dateTime.month(.wide))
    }

    private func reason(_ k: String) -> String {
        CheckText.wasteReasons.first { $0.0 == k }?.1 ?? L("Other")
    }
}

/// a scanned QR code from a ToHuus label
struct ScannedLabel: Identifiable {
    let raw: String
    var id: String { raw }
}
