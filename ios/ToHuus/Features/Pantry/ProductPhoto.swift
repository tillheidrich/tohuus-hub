import PhotosUI
import SwiftUI
import UIKit

// Product pictures (web Product.tsx ImageSheet): take a photo, pick one from Fotos, or choose a picture from
// Open Food Facts. Saved right away with POST /api/products/:id/image (multipart `image`, or `url` + `code`).

/// The system camera. Only offered where a camera exists (not in the simulator).
struct CameraPicker: UIViewControllerRepresentable {
    static var available: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }
    let picked: (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let c = UIImagePickerController()
        c.sourceType = .camera
        c.delegate = context.coordinator
        return c
    }

    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(picked: picked) }

    @MainActor
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let picked: (UIImage?) -> Void
        init(picked: @escaping (UIImage?) -> Void) { self.picked = picked }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            picked(info[.originalImage] as? UIImage)
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picked(nil) }
    }
}

/// "Foto aufnehmen" / "Aus Fotos wählen" as a menu; hands back the picture.
struct PhotoSourceMenu<Label: View>: View {
    let picked: (UIImage) -> Void
    @ViewBuilder let label: () -> Label
    @State private var showCamera = false
    @State private var showLibrary = false
    @State private var item: PhotosPickerItem?

    var body: some View {
        Menu {
            if CameraPicker.available {
                Button { showCamera = true } label: { SwiftUI.Label(L("Take a photo"), systemImage: "camera") }
            }
            Button { showLibrary = true } label: { SwiftUI.Label(L("Choose from Photos"), systemImage: "photo.on.rectangle") }
        } label: {
            label()
        }
        .photosPicker(isPresented: $showLibrary, selection: $item, matching: .images)
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { img in
                showCamera = false
                if let img { picked(img) }
            }
            .ignoresSafeArea()
        }
        .onChange(of: item) { _, p in
            guard let p else { return }
            item = nil
            Task {
                if let d = try? await p.loadTransferable(type: Data.self), let img = UIImage(data: d) { picked(img) }
            }
        }
    }
}

/// Small square product picture; shows nothing when there is no picture (rows stay calm).
struct ProductThumb: View {
    let path: String?
    let api: APIClient
    var size: CGFloat = 36

    var body: some View {
        if let path, !path.isEmpty {
            RemoteImage(url: api.imageURL(path), api: api, placeholder: "shippingbox")
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size >= 40 ? Theme.Radius.base : Theme.Radius.sm))
                .overlay(RoundedRectangle(cornerRadius: size >= 40 ? Theme.Radius.base : Theme.Radius.sm).stroke(Theme.line, lineWidth: 0.5))
                .accessibilityHidden(true)
        }
    }
}

/// "Produktbild": own photo or a picture from Open Food Facts. Saves at once (like the web), then calls `saved`.
struct ProductImageSheet: View {
    let productId: Int
    let name: String
    let brand: String?
    let currentPath: String?
    let credit: String?
    let store: ServerStore
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var hits: [OffHit] = []
    @State private var searching = false
    @State private var busy = false
    @State private var error: String?
    @State private var preview: UIImage?

    private let columns = [GridItem(.adaptive(minimum: 96), spacing: Theme.Space.s3)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    HStack(spacing: Theme.Space.s4) {
                        Group {
                            if let preview {
                                Image(uiImage: preview).resizable().scaledToFill()
                            } else {
                                RemoteImage(url: store.api.imageURL(currentPath), api: store.api, placeholder: "shippingbox")
                            }
                        }
                        .frame(width: 96, height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
                        VStack(alignment: .leading, spacing: Theme.Space.s2) {
                            Text(name).font(.headline).foregroundStyle(Theme.ink).lineLimit(2)
                            if let credit, preview == nil, currentPath != nil {
                                Text(credit).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2)
                            }
                            PhotoSourceMenu(picked: { img in Task { await upload(img) } }) {
                                Label(currentPath == nil ? L("Add a photo") : L("Take your own photo"), systemImage: "camera")
                                    .font(.subheadline.weight(.semibold))
                            }
                            .disabled(busy)
                        }
                        Spacer(minLength: 0)
                    }

                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        Text(L("Or a picture from Open Food Facts")).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        HStack {
                            Image(systemName: "magnifyingglass").foregroundStyle(Theme.ink3)
                            TextField(L("Search Open Food Facts"), text: $query)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .submitLabel(.search)
                        }
                        .padding(10)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
                    }

                    if searching && hits.isEmpty {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, Theme.Space.s4)
                    } else if hits.isEmpty && query.trimmingCharacters(in: .whitespaces).count > 2 {
                        Text(L("No pictures found. Try fewer words or the brand.")).font(.footnote).foregroundStyle(Theme.ink3)
                    }
                    LazyVGrid(columns: columns, spacing: Theme.Space.s3) {
                        ForEach(hits) { h in
                            Button {
                                Task { await pick(h) }
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    // fixed box first, picture inside: wide pictures never push the grid apart
                                    Color.clear
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 96)
                                        .overlay { RemoteImage(url: URL(string: h.imageSmall ?? h.image ?? ""), api: nil, placeholder: "photo") }
                                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
                                    Text(h.name).font(.caption).foregroundStyle(Theme.ink).lineLimit(2)
                                    if let b = h.brand { Text(b).font(.caption2).foregroundStyle(Theme.ink3).lineLimit(1) }
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .disabled(busy)
                            .accessibilityLabel(LF("Use the picture of %@", [h.brand, h.name].compactMap { $0 }.joined(separator: " ")))
                        }
                    }
                    if !hits.isEmpty {
                        Text(L("Pictures from Open Food Facts, free under CC BY-SA. ToHuus notes where the picture comes from."))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                    if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .overlay { if busy { ProgressView().controlSize(.large) } }
            .navigationTitle(L("Product picture"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } }
            }
            .onAppear { if query.isEmpty { query = [brand, name].compactMap { $0 }.joined(separator: " ") } }
            .task(id: query) { await search() }
        }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count > 2 else { hits = []; return }
        try? await Task.sleep(nanoseconds: 500_000_000)
        if Task.isCancelled { return }
        searching = true
        defer { searching = false }
        let r = (try? await store.api.searchOFF(q)) ?? []
        if Task.isCancelled { return }
        hits = r.filter(\.fits)
    }

    private func pick(_ h: OffHit) async {
        guard let url = h.image ?? h.imageSmall else { return }
        busy = true
        defer { busy = false }
        do {
            try await store.api.setProductImage(productId, url: url, code: h.code)
            finish()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func upload(_ img: UIImage) async {
        preview = img
        busy = true
        defer { busy = false }
        guard let jpeg = img.resizedForUpload().jpegData(compressionQuality: 0.8) else { return }
        do {
            try await store.api.uploadProductImage(productId, jpeg: jpeg)
            finish()
        } catch {
            preview = nil
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func finish() {
        Haptics.success()
        store.touch("products", "stock", "shopping")
        saved()
        dismiss()
    }
}
