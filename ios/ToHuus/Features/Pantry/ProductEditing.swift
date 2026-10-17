import PhotosUI
import SwiftUI

/// "Produkt bearbeiten" (web Product.tsx ProductForm): name, brand, size, category, place and exact spot, how it is
/// counted, minimum, date on the pack, always stocked, on the order menu ("Bring mir was"), note and image; find a
/// picture again, delete (admins). PATCH /api/products/:id with only what changed.
struct ProductEditSheet: View {
    let product: ProductInfo
    let extra: ProductExtra
    var more = ProductMore()
    let places: [Place]
    let categories: [ProductCategory]
    let store: ServerStore
    let saved: () -> Void
    var deleted: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app: AppModel?
    @State private var size = ""
    @State private var isStaple = false
    @State private var orderable = false
    @State private var orderGroup = ""
    /// nil = automatic by name
    @State private var dateKind: String?
    @State private var autoKind: String?
    @State private var confirmDelete = false
    @State private var finding = false
    @State private var note: String?
    @State private var name = ""
    @State private var brand = ""
    @State private var categoryId: Int?
    @State private var placeId: Int?
    @State private var spot = ""
    @State private var trackMode = "count"
    @State private var minQty = 0
    @State private var unit = ""
    @State private var notes = ""
    @State private var imagePath: String?
    @State private var showImage = false
    @State private var busy = false
    @State private var error: String?

    private var usablePlaces: [Place] { places.filter { $0.system != true } }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button { showImage = true } label: {
                        HStack(spacing: Theme.Space.s3) {
                            RemoteImage(url: store.api.imageURL(imagePath), api: store.api, placeholder: "shippingbox")
                                .frame(width: 64, height: 64)
                                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                            Label(imagePath == nil ? L("Add a picture") : L("Change the picture"), systemImage: "camera")
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    TextField(L("Name"), text: $name)
                    TextField(L("Brand"), text: $brand)
                    TextField(L("Size, e.g. 500g, 1l, 6 rolls"), text: $size)
                    Button {
                        Task { await findImage() }
                    } label: {
                        HStack { Label(L("Find image"), systemImage: "arrow.triangle.2.circlepath"); if finding { Spacer(); ProgressView() } }
                    }
                    .disabled(finding)
                } footer: {
                    if let note { Text(note) }
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
                    if trackMode == "level" {
                        // fill level: running low from "low" (default) or already from "half" (min_qty 2)
                        Picker(L("Running low from"), selection: $minQty) {
                            Text(L("low")).tag(0)
                            Text(L("half")).tag(2)
                        }
                    }
                } header: {
                    Text(L("Counting"))
                } footer: {
                    Text(trackFooter)
                }
                if trackMode != "none" {
                    Section {
                        Picker(L("Date on the pack"), selection: $dateKind) {
                            Text(L("Automatic")).tag(String?.none)
                            Text(L("Best before")).tag(String?.some("best_before"))
                            Text(L("Use by")).tag(String?.some("use_by"))
                        }
                        .pickerStyle(.segmented)
                    } header: {
                        Text(L("Date on the pack"))
                    } footer: {
                        Text(dateFooter)
                    }
                }
                Section {
                    Toggle(isOn: $isStaple) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Always stocked"))
                            Text(L("A staple – counts as available for recipes.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    Toggle(isOn: $orderable.animation()) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("On the order menu"))
                            Text(L("Family and guests can order it. Pictures, choices and groups are set in the menu.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    if orderable {
                        TextField(L("Bar section, e.g. drinks, ice cream, snacks"), text: $orderGroup)
                    }
                }
                .tint(Theme.primary)
                Section(L("Note")) {
                    TextField(L("e.g. only the lactose-free one"), text: $notes, axis: .vertical).lineLimit(1...3)
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                if app?.isAdmin == true {
                    Section {
                        Button(role: .destructive) { confirmDelete = true } label: { Label(L("Delete"), systemImage: "trash") }
                    }
                }
            }
            .themedList()
            .confirmationDialog(LF("Delete %@?", product.name), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Delete"), role: .destructive) { Task { await remove() } }
            } message: {
                Text(L("The product, its stock and its history are removed."))
            }
            .task(id: name) {
                try? await Task.sleep(nanoseconds: 400_000_000)
                let n = name.trimmingCharacters(in: .whitespaces)
                if !Task.isCancelled, !n.isEmpty { autoKind = try? await store.api.autoDateKind(n) }
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
            .sheet(isPresented: $showImage) {
                ProductImageSheet(productId: product.id, name: product.name, brand: product.brand, currentPath: imagePath,
                                  credit: extra.imageCredit, store: store) {
                    Task {
                        if let (p, _) = try? await store.api.productFull(product.id) { imagePath = p.imagePath }
                        saved()
                    }
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

    private var dateFooter: String {
        let auto = dateKind == nil && autoKind != nil ? LF("Automatic: %@.", autoKind == "use_by" ? L("use-by") : L("best-before")) + " " : ""
        return auto + ((dateKind ?? autoKind) == "use_by"
            ? L("Use by (minced meat, fresh fish, poultry, raw milk): after the date, don’t eat it anymore.")
            : L("Best before: after the date it is usually still fine – look, smell, taste."))
    }

    private func findImage() async {
        finding = true
        defer { finding = false }
        let ok = (try? await store.api.findProductImage(product.id)) ?? false
        note = ok ? L("Image found") : L("No matching image found")
        if ok, let (p, _) = try? await store.api.productFull(product.id) { imagePath = p.imagePath }
        saved()
    }

    private func remove() async {
        do {
            try await store.api.deleteProduct(product.id)
            Haptics.success()
            store.touch("products", "stock")
            dismiss()
            deleted()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func fill() {
        size = more.size ?? product.size ?? ""
        isStaple = more.isStaple ?? extra.isStaple ?? false
        orderable = more.orderable ?? false
        orderGroup = more.orderGroup ?? ""
        dateKind = more.dateKind ?? product.dateKind
        name = product.name
        imagePath = product.imagePath
        brand = product.brand ?? ""
        categoryId = product.categoryId
        placeId = product.defaultLocationId
        spot = product.spot ?? ""
        trackMode = product.trackMode ?? "count"
        minQty = Int((product.minQty ?? 0).rounded())
        // fill level: running low from "low" (0) or "half" (2) – the picker only knows these two
        if trackMode == "level" { minQty = minQty >= 2 ? 2 : 0 }
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
        if (trackMode == "count" || trackMode == "level") && Double(minQty) != (product.minQty ?? 0) { f["min_qty"] = minQty }
        if trackMode == "count" && !t(unit).isEmpty && t(unit) != (product.unit ?? "") { f["unit"] = t(unit) }
        if t(notes) != (product.notes ?? "") { f["notes"] = null(notes) }
        if t(size) != (more.size ?? product.size ?? "") { f["size"] = null(size) }
        if isStaple != (more.isStaple ?? extra.isStaple ?? false) { f["is_staple"] = isStaple }
        if orderable != (more.orderable ?? false) { f["orderable"] = orderable }
        if orderable && t(orderGroup) != (more.orderGroup ?? "") { f["order_group"] = null(orderGroup) }
        if trackMode != "none" && dateKind != (more.dateKind ?? product.dateKind) { f["date_kind"] = dateKind.map { $0 as Any } ?? NSNull() }
        do {
            if !f.isEmpty {
                let body = try JSONSerialization.data(withJSONObject: f)
                try await store.api.patchProduct(product.id, body: body)
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
            .themedList()
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
            .themedList()
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
            .themedList()
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
