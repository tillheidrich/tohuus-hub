import SwiftUI

/// A new product – from a scanned code (data and picture from Open Food Facts when found) or by hand. While the
/// name is typed, pictures from Open Food Facts are offered (web Product.tsx ProductSheet `offHits`); an own photo
/// works too. POST /api/products, then POST /api/products/:id/image for an own photo.
struct NewProductSheet: View {
    let code: String?
    let lookup: BarcodeLookup?
    let places: [Place]
    let categories: [ProductCategory]
    let store: ServerStore
    let done: (Int?) -> Void
    @State private var name = ""
    @State private var brand = ""
    @State private var categoryId: Int?
    @State private var placeId: Int?
    @State private var trackMode = "count"
    @State private var qty = 1
    @State private var hits: [OffHit] = []
    @State private var pickedHit: OffHit?
    @State private var ownPhoto: UIImage?
    @State private var busy = false
    @State private var error: String?

    private var usablePlaces: [Place] { places.filter { $0.system != true } }
    private var scannedImage: String? { lookup?.remoteImage }
    private var pictureURL: String? { pickedHit?.image ?? pickedHit?.imageSmall ?? scannedImage }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: Theme.Space.s3) {
                        picture
                            .frame(width: 72, height: 72)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                        VStack(alignment: .leading, spacing: 6) {
                            PhotoSourceMenu(picked: { ownPhoto = $0; pickedHit = nil }) {
                                Label(ownPhoto == nil ? L("Take your own photo") : L("Another photo"), systemImage: "camera")
                                    .font(.subheadline.weight(.semibold))
                            }
                            if ownPhoto != nil || pickedHit != nil {
                                Button(L("Remove the picture"), role: .destructive) { ownPhoto = nil; pickedHit = nil }
                                    .font(.subheadline)
                            }
                        }
                        .buttonStyle(.borderless)
                    }
                    .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                    TextField(L("Name"), text: $name)
                    TextField(L("Brand"), text: $brand)
                } footer: {
                    Text(footer)
                }
                if !hits.isEmpty && ownPhoto == nil && scannedImage == nil {
                    Section {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Theme.Space.s3) {
                                ForEach(hits) { h in hitButton(h) }
                            }
                            .padding(.vertical, 4)
                        }
                    } header: {
                        Text(L("Picture from Open Food Facts?"))
                    } footer: {
                        Text(L("Tap one to use its picture. Free under CC BY-SA."))
                    }
                }
                Section {
                    Picker(L("Category"), selection: $categoryId) {
                        Text(L("None")).tag(Int?.none)
                        ForEach(categories) { c in Text(c.name).tag(Int?.some(c.id)) }
                    }
                    Picker(L("Where does it live?"), selection: $placeId) {
                        Text(L("No place")).tag(Int?.none)
                        ForEach(usablePlaces) { p in Text(p.path ?? p.name).tag(Int?.some(p.id)) }
                    }
                    Picker(L("How should it be counted?"), selection: $trackMode) {
                        Text(L("Pieces")).tag("count")
                        Text(L("Fill level")).tag("level")
                        Text(L("Don't count")).tag("none")
                    }
                    if trackMode == "count" {
                        Stepper(LF("%d at home", qty), value: $qty, in: 0...99)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .navigationTitle(L("New product"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { done(nil) } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }.disabled(trimmedName.isEmpty || busy)
                }
            }
            .onAppear {
                if name.isEmpty { name = lookup?.remoteName ?? "" }
                if brand.isEmpty { brand = lookup?.remoteBrand ?? "" }
                #if DEBUG
                if name.isEmpty, let n = UserDefaults.standard.string(forKey: "debugNewProductName") { name = n }
                #endif
            }
            .onChange(of: categoryId) { _, cid in
                guard let c = categories.first(where: { $0.id == cid }) else { return }
                if placeId == nil { placeId = c.defaultLocationId }
                if let t = c.trackMode { trackMode = t }
            }
            .task(id: "\(brand) \(name)") { await suggest() }
        }
        .presentationDetents([.large])
    }

    @ViewBuilder private var picture: some View {
        if let ownPhoto {
            Image(uiImage: ownPhoto).resizable().scaledToFill()
        } else {
            RemoteImage(url: URL(string: pictureURL ?? ""), api: nil, placeholder: "shippingbox")
        }
    }

    private var footer: String {
        if code == nil { return L("Name it the way you say it at home. ToHuus finds a picture by itself if you don't choose one.") }
        return lookup?.remoteName == nil ? L("This code is unknown. Give it a name and ToHuus will recognise it next time.")
            : L("Found in Open Food Facts.")
    }

    private func hitButton(_ h: OffHit) -> some View {
        let on = pickedHit?.code == h.code
        return Button {
            pickedHit = on ? nil : h
            if !on && brand.trimmingCharacters(in: .whitespaces).isEmpty, let b = h.brand { brand = b }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                RemoteImage(url: URL(string: h.imageSmall ?? h.image ?? ""), api: nil, placeholder: "photo")
                    .frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(on ? Theme.primary : Theme.line, lineWidth: on ? 3 : 1))
                    .overlay(alignment: .topTrailing) {
                        if on {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.onPrimary, Theme.primary).padding(4)
                        }
                    }
                Text(h.name).font(.caption).foregroundStyle(Theme.ink).lineLimit(2).frame(width: 84, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(LF("Use the picture of %@", [h.brand, h.name].compactMap { $0 }.joined(separator: " ")))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// pictures for what is typed (only when no picture came with the scan)
    private func suggest() async {
        guard scannedImage == nil else { return }
        let q = "\(brand) \(name)".trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 4 else { hits = []; return }
        try? await Task.sleep(nanoseconds: 700_000_000)
        if Task.isCancelled { return }
        let r = (try? await store.api.searchOFF(q)) ?? []
        if Task.isCancelled { return }
        hits = Array(r.filter(\.fits).prefix(6))
        if let p = pickedHit, !hits.contains(p) { hits.insert(p, at: 0) }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var body: [String: Any] = ["name": trimmedName, "track_mode": trackMode]
        let b = brand.trimmingCharacters(in: .whitespacesAndNewlines)
        if !b.isEmpty { body["brand"] = b }
        if let categoryId { body["category_id"] = categoryId }
        if let placeId { body["default_location_id"] = placeId; body["initial_location_id"] = placeId }
        if let code { body["code"] = code }
        if ownPhoto == nil, let url = pictureURL { body["image_url"] = url }
        if trackMode == "count" && qty > 0 { body["initial_qty"] = qty }
        if trackMode == "level" { body["initial_qty"] = 3 }
        do {
            let id = try await store.api.createProductFull(body)
            if let id, let img = ownPhoto, let jpeg = img.resizedForUpload().jpegData(compressionQuality: 0.8) {
                try? await store.api.uploadProductImage(id, jpeg: jpeg)
            }
            Haptics.success()
            store.touch("products", "stock")
            done(id)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
