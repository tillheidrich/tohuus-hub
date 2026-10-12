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

    func filtered(search: String, place: Int?, onlyAttention: Bool, category: Int? = nil) -> [ProductInfo] {
        products.filter { p in
            if let category, p.categoryId != category { return false }
            if !search.isEmpty {
                let hay = [p.name, p.brand ?? "", p.spot ?? ""].joined(separator: " ")
                if hay.range(of: search, options: [.caseInsensitive, .diacriticInsensitive]) == nil { return false }
            }
            if let place {
                let here = p.stock.contains { $0.locationId == place && ($0.qty ?? 0) > 0 } || (p.stock.isEmpty && p.defaultLocationId == place)
                if !here { return false }
            }
            if onlyAttention { return ["low", "empty", "expiring", "expired"].contains(p.status ?? "") }
            return true
        }
    }
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
    @State private var attention = false
    @State private var showScanner = false
    @State private var scanned: BarcodeLookup?
    @State private var scannedCode = ""
    @State private var path: [Int] = []
    // 0.3 parity: grouping, category filter, quick check, "Wo ist was?", leftovers, labels
    @AppStorage("pantry.group") private var groupRaw = PantryGrouping.none.rawValue
    @State private var category: Int?
    @State private var showCheck = false
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
            .navigationDestination(for: Int.self) { id in ProductDetailView(productId: id, store: store) }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Button { showCheck = true } label: { Label(L("Quick stock check"), systemImage: "checklist") }
                        Button { showFind = true } label: { Label(L("Where is what?"), systemImage: "mappin.and.ellipse") }
                        Divider()
                        Button { showLeftovers = true } label: { Label(L("Put leftovers away"), systemImage: "takeoutbag.and.cup.and.straw") }
                        Button { showLabelScan = true } label: { Label(L("Scan a box label"), systemImage: "qrcode.viewfinder") }
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
                        showScanner = true
                    } label: {
                        Image(systemName: "barcode.viewfinder")
                    }
                    .accessibilityLabel(L("Scan barcode"))
                }
            }
            .sheet(isPresented: $showCheck) { QuickCheckView(store: store) }
            .sheet(isPresented: $showFind) { FindView(store: store) { id in showFind = false; open(id) } }
            .sheet(isPresented: $showLeftovers) { LeftoversSheet(store: store) }
            .sheet(isPresented: $showLabelScan) {
                ScannerSheet(title: L("Scan a box label"), symbologies: [.qr]) { code in scannedLabel = ScannedLabel(raw: code) }
            }
            .sheet(item: $scannedLabel) { l in LabelSheet(raw: l.raw, store: store) { id in scannedLabel = nil; open(id) } }
            .task {
                #if DEBUG
                let d = UserDefaults.standard
                if d.bool(forKey: "debugCheck") { showCheck = true }
                if d.bool(forKey: "debugFind") { showFind = true }
                if d.bool(forKey: "debugLeftovers") { showLeftovers = true }
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
                NewProductSheet(result: r, store: store) { newId in
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
                let items = model.filtered(search: search, place: place, onlyAttention: attention, category: category)
                if items.isEmpty && !model.loading {
                    EmptyStateView(systemImage: "cabinet", title: search.isEmpty ? L("Nothing here yet.") : L("Nothing found."),
                                   message: L("Receipts and ticks fill the pantry by themselves – no need to count."))
                        .listRowBackground(Color.clear)
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
                Color.clear.frame(height: 72).listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .canvasBackground()
            .searchable(text: $search, isPresented: $searching, prompt: L("Search the pantry"))
            .onChange(of: app.searchRequest) { _, _ in consumeSearch() }
            .onAppear { consumeSearch() }
            .refreshable { await model.load(store.api) }
            .task(id: store.revision("stock") + store.revision("products")) { await model.load(store.api) }
    }

    @ViewBuilder private func productLink(_ p: ProductInfo) -> some View {
        if wide {
            Button { selected = p.id } label: { ProductRow(product: p, api: store.api).contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .listRowBackground(selected == p.id ? Theme.primarySoft : Color.clear)
                .hoverEffect(.highlight)
        } else {
            NavigationLink(value: p.id) { ProductRow(product: p, api: store.api) }
        }
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
                chip(L("All"), selected: place == nil && !attention) { place = nil; attention = false }
                chip(L("Needs attention"), selected: attention) { attention.toggle() }
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

    var body: some View {
        HStack(spacing: Theme.Space.s3) {
            RemoteImage(url: api.imageURL(product.imagePath), api: api, placeholder: "shippingbox")
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
            VStack(alignment: .leading, spacing: 2) {
                Text(product.name).font(Theme.rowFont).foregroundStyle(Theme.ink)
                Text([product.brand, product.amountLabel].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 0)
            if let s = product.statusLabel { StatusPill(text: s, status: product.status) }
        }
        .padding(.vertical, 2)
    }
}

/// A scanned code that isn't in the household yet: create it (data from Open Food Facts when found).
struct NewProductSheet: View {
    let result: ScanResult
    let store: ServerStore
    let done: (Int?) -> Void
    @State private var name = ""
    @State private var brand = ""
    @State private var qty = 1
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if let img = result.lookup.remoteImage {
                        RemoteImage(url: URL(string: img), api: nil).frame(height: 140).clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                    }
                    TextField(L("Name"), text: $name)
                    TextField(L("Brand"), text: $brand)
                    Stepper(LF("%d at home", qty), value: $qty, in: 0...99)
                } footer: {
                    Text(result.lookup.remoteName == nil ? L("This code is unknown. Give it a name and ToHuus will recognise it next time.")
                         : L("Found in Open Food Facts."))
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .navigationTitle(L("New product"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { done(nil) } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                }
            }
            .onAppear {
                name = result.lookup.remoteName ?? ""
                brand = result.lookup.remoteBrand ?? ""
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            let id = try await store.api.createProduct(name: name, brand: brand.isEmpty ? nil : brand, code: result.code,
                                                      imageURL: result.lookup.remoteImage, initialQty: qty > 0 ? Double(qty) : nil)
            store.touch("products", "stock")
            done(id)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
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

/// a scanned QR code from a ToHuus label
struct ScannedLabel: Identifiable {
    let raw: String
    var id: String { raw }
}
