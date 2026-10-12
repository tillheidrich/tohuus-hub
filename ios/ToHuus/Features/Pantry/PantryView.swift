import Observation
import SwiftUI

@MainActor
@Observable
final class PantryModel {
    private(set) var products: [ProductInfo] = []
    private(set) var places: [Place] = []
    private(set) var loading = false
    var error: String?

    func load(_ api: APIClient) async {
        loading = true
        defer { loading = false }
        do {
            async let p = api.products()
            async let l = api.places()
            products = try await p
            places = (try? await l) ?? places
            error = nil
        } catch {
            let e = APIError.from(error)
            if !(e.isOffline && !products.isEmpty) { self.error = e.localizedDescription }
        }
    }

    func filtered(search: String, place: Int?, onlyAttention: Bool) -> [ProductInfo] {
        products.filter { p in
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
    @State private var model = PantryModel()
    @State private var search = ""
    @State private var place: Int?
    @State private var attention = false
    @State private var showScanner = false
    @State private var scanned: BarcodeLookup?
    @State private var scannedCode = ""
    @State private var path: [Int] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                filterBar
                if let error = model.error {
                    ErrorBanner(message: error) { Task { await model.load(store.api) } }.listRowBackground(Color.clear)
                }
                let items = model.filtered(search: search, place: place, onlyAttention: attention)
                if items.isEmpty && !model.loading {
                    EmptyStateView(systemImage: "cabinet", title: search.isEmpty ? L("Nothing here yet.") : L("Nothing found."),
                                   message: L("Receipts and ticks fill the pantry by themselves – no need to count."))
                        .listRowBackground(Color.clear)
                }
                ForEach(items) { p in
                    NavigationLink(value: p.id) { ProductRow(product: p, api: store.api) }
                }
                Color.clear.frame(height: 72).listRowBackground(Color.clear)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .canvasBackground()
            .searchable(text: $search, prompt: L("Search the pantry"))
            .navigationTitle(L("Pantry"))
            .navigationDestination(for: Int.self) { id in ProductDetailView(productId: id, store: store) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showScanner = true
                    } label: {
                        Image(systemName: "barcode.viewfinder")
                    }
                    .accessibilityLabel(L("Scan barcode"))
                }
            }
            .refreshable { await model.load(store.api) }
            .task(id: store.revision("stock") + store.revision("products")) { await model.load(store.api) }
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
                        if let newId { path.append(newId) }
                    }
                }
            }
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.s2) {
                chip(L("All"), selected: place == nil && !attention) { place = nil; attention = false }
                chip(L("Needs attention"), selected: attention) { attention.toggle() }
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
                path.append(local.id)
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
