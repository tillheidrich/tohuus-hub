import PhotosUI
import SwiftUI
import VisionKit

/// "Zuletzt erledigt" (GET /api/list/recent) with "Zurückholen" (POST /api/list/items/:id/restore).
struct RecentDoneSheet: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var rows: [ShopItem] = []
    @State private var restored: Set<Int> = []
    @State private var loading = true
    @State private var missing = false

    var body: some View {
        NavigationStack {
            List {
                if missing {
                    Text(L("Your server doesn't have this section yet.")).foregroundStyle(Theme.ink3)
                } else if rows.isEmpty && !loading {
                    Text(L("Nothing done in the last days.")).foregroundStyle(Theme.ink3)
                }
                ForEach(rows) { r in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text([r.qtyLabel, r.text].compactMap { $0 }.joined(separator: " "))
                            Text([r.checkedBy, ServerDate.relative(r.checkedAt)].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer()
                        if restored.contains(r.id) {
                            Image(systemName: "checkmark").foregroundStyle(Theme.primaryText)
                        } else {
                            Button(L("Put back")) { Task { await restore(r) } }
                                .buttonStyle(.bordered).controlSize(.small)
                        }
                    }
                }
            }
            .themedList()
            .navigationTitle(L("Recently done"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    private func load() async {
        defer { loading = false }
        do { rows = try await store.api.recentDone() } catch APIError.notFound { missing = true } catch {}
    }

    private func restore(_ r: ShopItem) async {
        _ = try? await store.api.restoreItem(r.id)
        restored.insert(r.id)
        Haptics.tick()
        await store.refreshList()
    }
}

/// "Unsere Üblichen" (GET /api/list/usuals): everything ever bought, most frequent first – one tap puts it on the list.
struct UsualsSheet: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var rows: [Usual] = []
    @State private var added: Set<Int> = []
    @State private var search = ""
    @State private var missing = false

    var body: some View {
        NavigationStack {
            List {
                if missing { Text(L("Your server doesn't have this section yet.")).foregroundStyle(Theme.ink3) }
                ForEach(rows.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }) { u in
                    HStack(spacing: Theme.Space.s3) {
                        ProductThumb(path: u.imagePath, api: store.api, size: 40)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(u.name)
                            if let c = u.count { Text(LF("bought %d times", c)).font(.caption).foregroundStyle(Theme.ink3) }
                        }
                        Spacer()
                        if u.onList == true || added.contains(u.productId) {
                            Text(L("on the list")).font(.caption).foregroundStyle(Theme.primaryText)
                        } else {
                            Button {
                                added.insert(u.productId)
                                Haptics.tick()
                                Task { await store.addProduct(u.productId, name: u.name) }
                            } label: {
                                Image(systemName: "plus.circle.fill").font(.title2)
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Theme.primary)
                            .accessibilityLabel(LF("Put %@ on the list", u.name))
                        }
                    }
                }
            }
            .themedList()
            .searchable(text: $search)
            .navigationTitle(L("Our usuals"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task {
                do { rows = try await store.api.usuals() } catch APIError.notFound { missing = true } catch {}
            }
        }
    }
}

/// Offers from what the household brings in itself (nothing from offer feeds): a flyer photo, a link to a flyer picture
/// or PDF, or pasted text (POST /api/offers/scan) – grouped per shop, matched with the list and what is due.
struct OffersView: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var offers: [Offer] = []
    @State private var photo: PhotosPickerItem?
    @State private var showCamera = false
    @State private var scanning = false
    @State private var error: String?
    @State private var missing = false
    @State private var link = ""
    @State private var pasted = ""

    private struct OfferShopGroup: Identifiable {
        let shop: String
        let offers: [Offer]
        var id: String { shop }
    }

    private static func hot(_ o: Offer) -> Bool { o.due == true || o.onList == true }

    /// per shop: shops with something due or on the list first, then by name; offers without a shop last
    private var byShop: [OfferShopGroup] {
        let groups = Dictionary(grouping: offers) { ($0.shop ?? "").trimmingCharacters(in: .whitespaces) }
        return groups.map { key, value in
            OfferShopGroup(shop: key, offers: value.sorted { Self.hot($0) && !Self.hot($1) })
        }
        .sorted { a, b in
            if a.shop.isEmpty != b.shop.isEmpty { return !a.shop.isEmpty }
            let ha = a.offers.contains(where: Self.hot)
            let hb = b.offers.contains(where: Self.hot)
            if ha != hb { return ha }
            return a.shop.localizedCaseInsensitiveCompare(b.shop) == .orderedAscending
        }
    }

    private var linkOK: Bool {
        let u = link.trimmingCharacters(in: .whitespaces)
        return u.hasPrefix("http://") || u.hasPrefix("https://")
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if VNDocumentCameraAvailable.isSupported {
                        Button { showCamera = true } label: { Label(L("Photograph a flyer page"), systemImage: "camera") }
                    }
                    PhotosPicker(selection: $photo, matching: .images) { Label(L("Choose a flyer photo"), systemImage: "photo") }
                    HStack {
                        TextField(L("Link to a flyer picture or PDF"), text: $link)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .onSubmit { Task { await scanLink() } }
                        Button(L("Read")) { Task { await scanLink() } }
                            .disabled(scanning || !linkOK)
                    }
                    TextField(L("…or paste: “Lidl until 18.10. coffee 9,99 €”"), text: $pasted, axis: .vertical)
                        .lineLimit(2...5)
                    if !pasted.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Button { Task { await scanText() } } label: { Label(L("Read the text"), systemImage: "tag") }
                            .disabled(scanning)
                    }
                    if scanning { HStack { ProgressView(); Text(L("Reading …")) } }
                    if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
                } header: {
                    Text(L("An offer"))
                } footer: {
                    Text(L("A flyer page, a price tag or a shared offer – ToHuus checks it against your list and what is due. Nothing is fetched from offer sites."))
                }
                if missing { Text(L("Your server doesn't have this section yet.")).foregroundStyle(Theme.ink3) }
                ForEach(byShop) { group in
                    Section {
                        ForEach(group.offers) { o in
                            OfferRowView(offer: o, store: store) { await load() }
                        }
                    } header: {
                        Label(group.shop.isEmpty ? L("Other shops") : group.shop, systemImage: "storefront")
                    }
                }
            }
            .themedList()
            .navigationTitle(L("Offers"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task { await load() }
            .refreshable { await load() }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { await scan(img) }
                    photo = nil
                }
            }
            .fullScreenCover(isPresented: $showCamera) {
                DocumentScanner { images in
                    showCamera = false
                    if let first = images.first { Task { await scan(first) } }
                } onCancel: { showCamera = false }
                    .ignoresSafeArea()
            }
        }
    }

    private func load() async {
        do { offers = try await store.api.offers() } catch APIError.notFound { missing = true } catch {}
    }

    private func scan(_ img: UIImage) async {
        guard let jpeg = img.jpegData(compressionQuality: 0.8) else { return }
        scanning = true
        defer { scanning = false }
        do { finish(try await store.api.scanOffers(jpeg: jpeg)) } catch { self.error = APIError.from(error).localizedDescription }
        await load()
    }

    private func scanLink() async {
        let u = link.trimmingCharacters(in: .whitespaces)
        guard linkOK else { return }
        scanning = true
        defer { scanning = false }
        do {
            finish(try await store.api.scanOffers(url: u))
            if error == nil { link = "" }
        } catch { self.error = APIError.from(error).localizedDescription }
        await load()
    }

    private func scanText() async {
        let t = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        scanning = true
        defer { scanning = false }
        do {
            finish(try await store.api.scanOffers(text: t))
            if error == nil { pasted = "" }
        } catch { self.error = APIError.from(error).localizedDescription }
        await load()
    }

    private func finish(_ found: [Offer]) {
        error = found.isEmpty ? L("No prices found – try a sharper photo or paste the text.") : nil
        if !found.isEmpty { Haptics.success() }
    }
}

/// One offer: price, name, shop and hints, with "auf die Liste" and swipe to remove.
struct OfferRowView: View {
    let offer: Offer
    let store: ServerStore
    var compact = false
    let changed: () async -> Void

    private var hot: Bool { offer.due == true || offer.onList == true }

    private var subline: String {
        var parts: [String] = []
        if compact, let s = offer.shop, !s.isEmpty { parts.append(s) }
        if let s = offer.size, !s.isEmpty { parts.append(s) }
        if let d = ServerDate.shortDay(offer.validTo) { parts.append(LF("until %@", d)) }
        parts += (offer.hints ?? []).filter { !$0.isEmpty }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Space.s3) {
            Text(offer.price.map { Money.format($0) } ?? "–")
                .font(.subheadline.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(hot ? Theme.onPrimary : Theme.primaryText)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(hot ? Theme.primary : Theme.primarySoft, in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(offer.name).font(.subheadline.weight(.semibold))
                if !subline.isEmpty { Text(subline).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2) }
            }
            Spacer(minLength: 0)
            if offer.onList == true || offer.added == true {
                Text(L("on the list")).font(.caption).foregroundStyle(Theme.primaryText)
            } else {
                Button {
                    Task {
                        try? await store.api.addOffer(offer.id)
                        Haptics.success()
                        store.touch("shopping")
                        await changed()
                        await store.refreshList()
                    }
                } label: {
                    Image(systemName: "plus.circle.fill").font(.title2).tapTarget()
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.primary)
                .accessibilityLabel(LF("Put %@ on the list", offer.name))
            }
        }
        .swipeActions {
            Button(role: .destructive) {
                Task {
                    try? await store.api.deleteOffer(offer.id)
                    await changed()
                }
            } label: {
                Label(L("Remove"), systemImage: "trash")
            }
        }
    }
}

/// On the main list (not in the shop): up to six current offers somebody brought in; nothing when there are none.
struct OffersStripSection: View {
    let store: ServerStore
    let openAll: () -> Void
    @State private var offers: [Offer] = []

    var body: some View {
        Group {
            if !offers.isEmpty {
                Section {
                    ForEach(offers.prefix(6)) { o in
                        OfferRowView(offer: o, store: store, compact: true) { await load() }
                    }
                } header: {
                    HStack {
                        Text(L("Offers"))
                        Spacer()
                        Button(L("All offers"), action: openAll).font(.footnote)
                    }
                }
            }
        }
        .task(id: store.revision("shopping")) { await load() }
    }

    private func load() async { offers = (try? await store.api.offers()) ?? [] }
}

enum VNDocumentCameraAvailable {
    @MainActor static var isSupported: Bool { VNDocumentCameraViewController.isSupported }
}
