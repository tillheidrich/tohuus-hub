import PhotosUI
import SwiftUI

/// "Produkt bearbeiten" (web Product.tsx ProductSheet): name, brand, category, place and exact spot, how it is
/// counted, minimum, note and image. PATCH /api/products/:id with only what changed.
struct ProductEditSheet: View {
    let product: ProductInfo
    let extra: ProductExtra
    let places: [Place]
    let categories: [ProductCategory]
    let store: ServerStore
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var brand = ""
    @State private var categoryId: Int?
    @State private var placeId: Int?
    @State private var spot = ""
    @State private var trackMode = "count"
    @State private var minQty = 0
    @State private var unit = ""
    @State private var notes = ""
    @State private var photo: PhotosPickerItem?
    @State private var newImage: UIImage?
    @State private var busy = false
    @State private var error: String?

    private var usablePlaces: [Place] { places.filter { $0.system != true } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: Theme.Space.s3) {
                        Group {
                            if let newImage {
                                Image(uiImage: newImage).resizable().scaledToFill()
                            } else {
                                RemoteImage(url: store.api.imageURL(product.imagePath), api: store.api, placeholder: "shippingbox")
                            }
                        }
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                        PhotosPicker(selection: $photo, matching: .images) {
                            Label(product.imagePath == nil && newImage == nil ? L("Add a photo") : L("Change the photo"), systemImage: "camera")
                        }
                    }
                    TextField(L("Name"), text: $name)
                    TextField(L("Brand"), text: $brand)
                }
                Section(L("Category")) {
                    Picker(L("Category"), selection: $categoryId) {
                        Text(L("None")).tag(Int?.none)
                        ForEach(categories) { c in Text(c.name).tag(Int?.some(c.id)) }
                    }
                }
                Section {
                    Picker(L("Where does it live?"), selection: $placeId) {
                        Text(L("No place")).tag(Int?.none)
                        ForEach(usablePlaces) { p in Text(p.path ?? p.name).tag(Int?.some(p.id)) }
                    }
                    TextField(L("Exact spot, e.g. left shelf, top compartment"), text: $spot)
                } header: {
                    Text(L("Place"))
                } footer: {
                    Text(L("Helps with “Where is it?” – for babysitters and visitors too."))
                }
                Section {
                    Picker(L("How should it be counted?"), selection: $trackMode) {
                        Text(L("Pieces")).tag("count")
                        Text(L("Fill level")).tag("level")
                        Text(L("Don't count")).tag("none")
                    }
                    .pickerStyle(.segmented)
                    if trackMode == "count" {
                        Stepper(value: $minQty, in: 0...99) {
                            HStack {
                                Text(L("Keep at least"))
                                Spacer()
                                Text(minQty == 0 ? L("doesn't matter") : "\(minQty)").foregroundStyle(Theme.ink2).monospacedDigit()
                            }
                        }
                        TextField(L("Unit, e.g. pcs, pack, bottle"), text: $unit)
                    }
                } header: {
                    Text(L("Counting"))
                } footer: {
                    Text(trackFooter)
                }
                Section(L("Note")) {
                    TextField(L("e.g. only the lactose-free one"), text: $notes, axis: .vertical).lineLimit(1...3)
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .navigationTitle(L("Edit product"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear(perform: fill)
            .onChange(of: photo) { _, p in
                guard let p else { return }
                Task {
                    if let d = try? await p.loadTransferable(type: Data.self), let img = UIImage(data: d) { newImage = img }
                }
            }
        }
    }

    private var trackFooter: String {
        switch trackMode {
        case "level": return L("For fruit, veg, bread: just “full – half – low – empty”. Less upkeep.")
        case "none": return L("For coffee from the machine or things ordered in: only for recipes.")
        default: return L("For packs, bottles, cans: count exactly. Below the minimum it goes on the list by itself.")
        }
    }

    private func fill() {
        name = product.name
        brand = product.brand ?? ""
        categoryId = product.categoryId
        placeId = product.defaultLocationId
        spot = product.spot ?? ""
        trackMode = product.trackMode ?? "count"
        minQty = Int((product.minQty ?? 0).rounded())
        unit = product.unit ?? ""
        notes = product.notes ?? ""
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var f: [String: Any] = [:]
        let t = { (s: String) in s.trimmingCharacters(in: .whitespacesAndNewlines) }
        let null = { (s: String) -> Any in t(s).isEmpty ? NSNull() : t(s) }
        if t(name) != product.name { f["name"] = t(name) }
        if t(brand) != (product.brand ?? "") { f["brand"] = null(brand) }
        if categoryId != product.categoryId { f["category_id"] = categoryId.map { $0 as Any } ?? NSNull() }
        if placeId != product.defaultLocationId { f["default_location_id"] = placeId.map { $0 as Any } ?? NSNull() }
        if t(spot) != (product.spot ?? "") { f["spot"] = null(spot) }
        if trackMode != (product.trackMode ?? "count") { f["track_mode"] = trackMode }
        if trackMode == "count" && Double(minQty) != (product.minQty ?? 0) { f["min_qty"] = minQty }
        if trackMode == "count" && !t(unit).isEmpty && t(unit) != (product.unit ?? "") { f["unit"] = t(unit) }
        if t(notes) != (product.notes ?? "") { f["notes"] = null(notes) }
        do {
            if !f.isEmpty {
                let body = try JSONSerialization.data(withJSONObject: f)
                try await store.api.patchProduct(product.id, body: body)
            }
            if let img = newImage, let jpeg = img.resizedForUpload().jpegData(compressionQuality: 0.8) {
                try await store.api.uploadProductImage(product.id, jpeg: jpeg)
            }
            Haptics.success()
            store.touch("products", "stock")
            saved()
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

extension UIImage {
    /// at most 1600 px on the long side – enough for a product photo, small to send
    func resizedForUpload(max: CGFloat = 1600) -> UIImage {
        let long = Swift.max(size.width, size.height)
        guard long > max else { return self }
        let scale = max / long
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        return UIGraphicsImageRenderer(size: target).image { _ in draw(in: CGRect(origin: .zero, size: target)) }
    }
}

/// "+ mit Datum / Ort": put some away with a place and an optional best-before date (POST /api/stock/adjust).
struct AddBatchSheet: View {
    let product: ProductInfo
    let places: [Place]
    let store: ServerStore
    let done: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var qty = 1
    @State private var placeId: Int?
    @State private var hasDate = false
    @State private var date = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Stepper(value: $qty, in: 1...99) {
                        HStack {
                            Text(L("Quantity"))
                            Spacer()
                            Text([String(qty), product.unit].compactMap { $0 }.joined(separator: " ")).monospacedDigit().foregroundStyle(Theme.ink2)
                        }
                    }
                    Picker(L("Where to?"), selection: $placeId) {
                        Text(L("No place")).tag(Int?.none)
                        ForEach(places.filter { $0.system != true }) { p in Text(p.path ?? p.name).tag(Int?.some(p.id)) }
                    }
                }
                Section {
                    Toggle(L("With best-before date"), isOn: $hasDate.animation())
                    if hasDate {
                        DatePicker(L("Best before"), selection: $date, displayedComponents: .date)
                    }
                } footer: {
                    Text(L("Optional. With a date, ToHuus reminds you in time to use it."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .navigationTitle(LF("Put away %@", product.name))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Put away")) { Task { await save() } }.disabled(busy) }
            }
            .onAppear { placeId = product.defaultLocationId }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try await store.api.addBatch(productId: product.id, qty: Double(qty), locationId: placeId, bestBefore: hasDate ? ServerDate.day(date) : nil)
            Haptics.success()
            store.touch("stock")
            done(LF("%d put away", qty))
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// Best-before date of one batch (PATCH /api/stock/:id).
struct BatchDateSheet: View {
    let entry: FreshProduct.Entry
    let store: ServerStore
    let done: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                DatePicker(L("Best before"), selection: $date, displayedComponents: .date)
                    .datePickerStyle(.graphical)
                if entry.bestBefore != nil {
                    Button(L("Remove the date"), role: .destructive) { Task { await save(nil) } }
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .navigationTitle(L("Best before"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Save")) { Task { await save(ServerDate.day(date)) } } }
            }
            .onAppear { date = ServerDate.parse(entry.bestBefore) ?? Date() }
        }
        .presentationDetents([.large])
    }

    private func save(_ day: String?) async {
        do {
            try await store.api.patchBatch(entry.id, bestBefore: .some(day))
            store.touch("stock")
            done()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// "Wo kaufen?" on the product page (PUT /api/products/:id/buy-at).
struct ProductBuyAtSheet: View {
    let product: ProductInfo
    @State var stores: [String]
    let store: ServerStore
    let done: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var suggestions: BuyAtSuggestions?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    BuyAtEditor(stores: $stores, suggestions: suggestions)
                } footer: {
                    Text(L("Only you decide this – the app never fills it in. Leave it empty if it doesn't matter."))
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .navigationTitle(L("Where to buy?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Save")) { Task { await save() } } }
            }
            .task { suggestions = try? await store.api.buyAtSuggestions() }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        do {
            try await store.api.setProductBuyAt(product.id, stores: stores)
            store.touch("products", "shopping")
            done()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
