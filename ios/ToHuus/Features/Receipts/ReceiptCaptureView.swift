import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VisionKit

/// "Bon hinzufügen": document camera, photos or files → POST /api/imports/upload (multipart field `files`).
struct ReceiptCaptureView: View {
    @Environment(\.dismiss) private var dismiss
    let store: ServerStore
    @State private var showScanner = false
    @State private var showFiles = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var uploading = false
    @State private var results: [ImportResult] = []
    @State private var applied: Set<Int> = []
    @State private var error: String?

    typealias UploadFile = (name: String, mime: String, data: Data)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    Text(L("Receipts show ToHuus what you bought, what it cost and how often. Paper, photo, PDF or e-receipt – all fine."))
                        .foregroundStyle(Theme.ink2)
                    if VNDocumentCameraViewController.isSupported {
                        Button {
                            showScanner = true
                        } label: {
                            Label(L("Scan receipt"), systemImage: "doc.viewfinder")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                    }
                    PhotosPicker(selection: $photoItems, maxSelectionCount: 8, matching: .images) {
                        Label(L("Choose photos"), systemImage: "photo.on.rectangle")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Button {
                        showFiles = true
                    } label: {
                        Label(L("Choose PDF or file"), systemImage: "folder")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    if uploading {
                        HStack { ProgressView(); Text(L("Reading the receipt …")).foregroundStyle(Theme.ink2) }
                    }
                    if let error { ErrorBanner(message: error) }
                    ForEach(results, id: \.stableId) { r in resultRow(r) }
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(L("Add receipt"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .fullScreenCover(isPresented: $showScanner) {
                DocumentScanner { images in
                    showScanner = false
                    let files = images.enumerated().compactMap { i, img -> UploadFile? in
                        img.jpegData(compressionQuality: 0.8).map { ("receipt-\(i + 1).jpg", "image/jpeg", $0) }
                    }
                    if !files.isEmpty { Task { await upload(files) } }
                } onCancel: {
                    showScanner = false
                }
                .ignoresSafeArea()
            }
            .fileImporter(isPresented: $showFiles, allowedContentTypes: [.pdf, .image, .plainText], allowsMultipleSelection: true) { result in
                guard case .success(let urls) = result else { return }
                let files = urls.prefix(8).compactMap { url -> UploadFile? in
                    let ok = url.startAccessingSecurityScopedResource()
                    defer { if ok { url.stopAccessingSecurityScopedResource() } }
                    guard let data = try? Data(contentsOf: url) else { return nil }
                    let type = UTType(filenameExtension: url.pathExtension)
                    return (url.lastPathComponent, type?.preferredMIMEType ?? "application/octet-stream", data)
                }
                Task { await upload(Array(files)) }
            }
            .onChange(of: photoItems) { _, items in
                guard !items.isEmpty else { return }
                Task {
                    var files: [UploadFile] = []
                    for (i, item) in items.enumerated() {
                        if let data = try? await item.loadTransferable(type: Data.self) {
                            let img = UIImage(data: data)?.jpegData(compressionQuality: 0.8) ?? data
                            files.append(("photo-\(i + 1).jpg", "image/jpeg", img))
                        }
                    }
                    photoItems = []
                    await upload(files)
                }
            }
        }
    }

    private func resultRow(_ r: ImportResult) -> some View {
        Card {
            if let e = r.error {
                Label(e, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.low).font(.subheadline)
            } else {
                Label(r.title ?? r.file ?? L("Receipt"), systemImage: "checkmark.circle").foregroundStyle(Theme.primaryText)
                if r.duplicate == true {
                    Text(L("This receipt was already there.")).font(.caption).foregroundStyle(Theme.ink3)
                } else if let id = r.id {
                    if applied.contains(id) {
                        Text(L("Taken over. ToHuus remembers it.")).font(.caption).foregroundStyle(Theme.ink2)
                    } else {
                        Button(L("Take it over")) {
                            Task {
                                do {
                                    try await store.api.applyImport(id)
                                    applied.insert(id)
                                    store.touch("imports", "stock", "shopping")
                                } catch { self.error = APIError.from(error).localizedDescription }
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        Text(L("You can check the lines in the web app under Receipts.")).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
    }

    private func upload(_ files: [UploadFile]) async {
        guard !files.isEmpty else { return }
        uploading = true
        defer { uploading = false }
        error = nil
        do {
            let r = try await store.api.uploadReceipt(files: files)
            results = r.results + results
            store.touch("imports")
            Haptics.success()
        } catch APIError.offline {
            // keep it for later: the app sends the queue when it is back online
            let queued = files.map { PendingUpload.QueuedFile(storedName: UUID().uuidString, originalName: $0.name, mimeType: $0.mime) }
            UploadQueue.enqueue(PendingUpload(kind: .receiptFiles, files: queued), fileData: files.map(\.data))
            error = L("No connection – the receipt is saved and will be sent later.")
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// VNDocumentCameraViewController wrapper.
struct DocumentScanner: UIViewControllerRepresentable {
    let onScan: ([UIImage]) -> Void
    let onCancel: () -> Void

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let vc = VNDocumentCameraViewController()
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ vc: VNDocumentCameraViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan, onCancel: onCancel) }

    @MainActor
    final class Coordinator: NSObject, VNDocumentCameraViewControllerDelegate {
        let onScan: ([UIImage]) -> Void
        let onCancel: () -> Void
        init(onScan: @escaping ([UIImage]) -> Void, onCancel: @escaping () -> Void) {
            self.onScan = onScan
            self.onCancel = onCancel
        }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            onScan((0..<scan.pageCount).map { scan.imageOfPage(at: $0) })
        }

        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { onCancel() }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { onCancel() }
    }
}
