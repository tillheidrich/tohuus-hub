import PhotosUI
import SwiftUI
import UniformTypeIdentifiers
import VisionKit

/// "Bon hinzufügen": document camera, photos or files → POST /api/imports/upload (multipart field `files`).
struct ReceiptCaptureView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    let store: ServerStore
    /// read photos on the iPhone first (Apple Vision) – always when the household has no AI for receipts
    @State private var readOnDevice = true
    @State private var showPaperList = false
    @State private var showScanner = false
    @State private var showFiles = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var uploading = false
    @State private var results: [ImportResult] = []
    @State private var applied: Set<Int> = []
    @State private var error: String?
    @State private var showEBon = false
    @State private var openImport: Int?

    typealias UploadFile = (name: String, mime: String, data: Data)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    Text(L("Receipts show ToHuus what you bought, what it cost and how often. Paper, photo, PDF or e-receipt – all fine."))
                        .foregroundStyle(Theme.ink2)
                    Toggle(isOn: $readOnDevice) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Read photos on this iPhone"))
                            Text(app.receiptAIOn ? L("Only the recognised text goes to ToHuus, not the photo.")
                                                 : L("Without AI ToHuus reads the photo here and sends only the text."))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    .disabled(!app.receiptAIOn)
                    .onAppear { if !app.receiptAIOn { readOnDevice = true } else { readOnDevice = SharedConfig.defaults.object(forKey: "ocr.device") as? Bool ?? false } }
                    .onChange(of: readOnDevice) { _, on in SharedConfig.defaults.set(on, forKey: "ocr.device") }
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
                    Button {
                        showEBon = true
                    } label: {
                        Label(L("Digital receipt (QR code or link)"), systemImage: "qrcode.viewfinder")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Button {
                        showPaperList = true
                    } label: {
                        Label(L("Photograph a paper list"), systemImage: "list.bullet.rectangle")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    if uploading {
                        HStack { ProgressView(); Text(L("Reading the receipt …")).foregroundStyle(Theme.ink2) }
                    }
                    if let error { ErrorBanner(message: error) }
                    ForEach(results, id: \.stableId) { r in resultRow(r) }
                    NavigationLink {
                        ImportsListView(store: store)
                    } label: {
                        Label(L("All receipts"), systemImage: "doc.on.doc")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(minHeight: 44)
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(L("Add receipt"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .sheet(isPresented: $showPaperList) { PaperListSheet(store: store) }
            .sheet(isPresented: $showEBon) {
                EBonSheet(store: store) { r in
                    if let id = r.id { openImport = id }
                }
            }
            .navigationDestination(item: $openImport) { id in ImportReviewView(store: store, importId: id) }
            .fullScreenCover(isPresented: $showScanner) {
                DocumentScanner { images in
                    showScanner = false
                    Task { await handle(images) }
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
                    var images: [UIImage] = []
                    for item in items {
                        if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) { images.append(img) }
                    }
                    photoItems = []
                    await handle(images)
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
                        NavigationLink(L("Show receipt")) { ImportReviewView(store: store, importId: id) }
                            .font(.subheadline)
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
                        NavigationLink {
                            ImportReviewView(store: store, importId: id)
                        } label: {
                            Label(L("Check the lines first"), systemImage: "list.bullet.rectangle")
                                .font(.subheadline.weight(.semibold))
                        }
                        .frame(minHeight: 44)
                    }
                }
            }
        }
    }

    /// Photos: read on the device and send the text (POST /api/imports/text), or upload the pictures.
    private func handle(_ images: [UIImage]) async {
        guard !images.isEmpty else { return }
        if readOnDevice || !app.receiptAIOn {
            uploading = true
            error = nil
            var lines: [String] = []
            for img in images { lines += (try? await DeviceOCR.lines(in: img)) ?? [] }
            uploading = false
            if lines.isEmpty {
                error = L("No text found on the photo. Try again in better light.")
                return
            }
            // Apple Intelligence on this iPhone (if the person chose it): tidy the lines before they are sent
            if OnDeviceAI.active(app) {
                uploading = true
                if let tidy = await OnDeviceAI.tidyReceipt(lines) { lines = tidy }
                uploading = false
            }
            do {
                uploading = true
                defer { uploading = false }
                let r = try await store.api.importLines(lines, mode: "receipt")
                let note = r.sumMatches == false ? L("The total doesn't add up – please check the lines.") : nil
                results = [ImportResult(file: nil, id: r.id, error: note, title: r.title ?? L("Receipt"), duplicate: nil, lines: nil)] + results
                store.touch("imports")
                Haptics.success()
                return
            } catch APIError.notFound {
                // server without device text import yet: send the pictures after all
            } catch {
                self.error = APIError.from(error).localizedDescription
                return
            }
        }
        let files = images.enumerated().compactMap { i, img -> UploadFile? in
            img.jpegData(compressionQuality: 0.8).map { ("receipt-\(i + 1).jpg", "image/jpeg", $0) }
        }
        await upload(files)
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
    final class Coordinator: NSObject, @preconcurrency VNDocumentCameraViewControllerDelegate {
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
