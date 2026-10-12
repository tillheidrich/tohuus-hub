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
                    HStack {
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

/// Offers from a flyer the household photographs itself (nothing from offer feeds): POST /api/offers/scan.
struct OffersView: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var offers: [Offer] = []
    @State private var photo: PhotosPickerItem?
    @State private var showCamera = false
    @State private var scanning = false
    @State private var error: String?
    @State private var missing = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if VNDocumentCameraAvailable.isSupported {
                        Button { showCamera = true } label: { Label(L("Photograph a flyer"), systemImage: "camera") }
                    }
                    PhotosPicker(selection: $photo, matching: .images) { Label(L("Choose a flyer photo"), systemImage: "photo") }
                    if scanning { HStack { ProgressView(); Text(L("Reading …")) } }
                    if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
                } footer: {
                    Text(L("Only what you photograph yourself – ToHuus doesn't fetch offers from anywhere."))
                }
                if missing { Text(L("Your server doesn't have this section yet.")).foregroundStyle(Theme.ink3) }
                ForEach(offers) { o in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(o.name).font(.headline)
                            Spacer()
                            if let p = o.price { Text(Money.format(p)).font(.headline).foregroundStyle(Theme.primaryText) }
                        }
                        Text([o.shop, o.size, o.validTo.flatMap { ServerDate.shortDay($0) }.map { LF("until %@", $0) }].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Theme.ink3)
                        ForEach(o.hints ?? [], id: \.self) { h in Text(h).font(.caption).foregroundStyle(Theme.ink2) }
                        if o.onList != true {
                            Button(L("Put it on the list")) {
                                Task {
                                    try? await store.api.addOffer(o.id)
                                    Haptics.success()
                                    await load()
                                    await store.refreshList()
                                }
                            }
                            .buttonStyle(.bordered).controlSize(.small)
                        } else {
                            Text(L("on the list")).font(.caption).foregroundStyle(Theme.primaryText)
                        }
                    }
                    .swipeActions {
                        Button(role: .destructive) { Task { try? await store.api.deleteOffer(o.id); await load() } } label: {
                            Label(L("Remove"), systemImage: "trash")
                        }
                    }
                }
            }
            .navigationTitle(L("Offers"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task { await load() }
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
        do {
            let found = try await store.api.scanOffers(jpeg: jpeg)
            error = found.isEmpty ? L("No offers found on the photo.") : nil
            await load()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

enum VNDocumentCameraAvailable {
    @MainActor static var isSupported: Bool { VNDocumentCameraViewController.isSupported }
}
