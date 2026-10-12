import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Share extension: receipts (PDF, screenshot, photo), recipe or e-receipt links and text. Sends straight to the
/// server with the app's token (App Group keychain); when offline it queues the payload for the app.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel(context: extensionContext)
        let host = UIHostingController(rootView: ShareView(model: model))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        Task { await model.load() }
    }
}

@MainActor
final class ShareModel: ObservableObject {
    enum State: Equatable { case loading, ready, sending, done(String), failed(String) }

    @Published var state: State = .loading
    @Published var files: [(name: String, mime: String, data: Data)] = []
    @Published var url: URL?
    @Published var text: String?
    private weak var context: NSExtensionContext?

    let session = SessionInfo.load()
    let token = SessionInfo.token

    init(context: NSExtensionContext?) { self.context = context }

    var signedIn: Bool { session != nil && token != nil }

    func load() async {
        let items = (context?.inputItems as? [NSExtensionItem]) ?? []
        for item in items {
            for provider in item.attachments ?? [] {
                await read(provider)
            }
        }
        state = .ready
    }

    private func read(_ p: NSItemProvider) async {
        if p.hasItemConformingToTypeIdentifier(UTType.pdf.identifier), files.count < 8,
           let data = await Self.data(p, UTType.pdf.identifier) {
            files.append(("receipt-\(files.count + 1).pdf", "application/pdf", data))
        } else if p.hasItemConformingToTypeIdentifier(UTType.image.identifier), files.count < 8,
                  let data = await Self.data(p, UTType.image.identifier) {
            let jpeg = UIImage(data: data)?.jpegData(compressionQuality: 0.8) ?? data
            files.append(("photo-\(files.count + 1).jpg", "image/jpeg", jpeg))
        } else if p.hasItemConformingToTypeIdentifier(UTType.url.identifier), let u = await Self.url(p) {
            if u.isFileURL, let data = try? Data(contentsOf: u) {
                let isPdf = u.pathExtension.lowercased() == "pdf"
                files.append((u.lastPathComponent, isPdf ? "application/pdf" : "image/jpeg", data))
            } else {
                url = u
            }
        } else if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier), let t = await Self.text(p) {
            if let u = URL(string: t.trimmingCharacters(in: .whitespacesAndNewlines)), u.scheme?.hasPrefix("http") == true {
                url = u
            } else {
                text = t
            }
        }
    }

    // NSItemProvider callbacks → async; only Sendable values leave the callbacks
    private static func data(_ p: NSItemProvider, _ type: String) async -> Data? {
        await withCheckedContinuation { (c: CheckedContinuation<Data?, Never>) in
            _ = p.loadDataRepresentation(forTypeIdentifier: type) { data, _ in c.resume(returning: data) }
        }
    }

    private static func url(_ p: NSItemProvider) async -> URL? {
        await withCheckedContinuation { (c: CheckedContinuation<URL?, Never>) in
            p.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                c.resume(returning: item as? URL)
            }
        }
    }

    private static func text(_ p: NSItemProvider) async -> String? {
        await withCheckedContinuation { (c: CheckedContinuation<String?, Never>) in
            p.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                c.resume(returning: item as? String)
            }
        }
    }

    func send(_ kind: PendingUpload.Kind) async {
        guard let session, let token else { return }
        state = .sending
        var item = PendingUpload(kind: kind)
        var payload: [Data] = []
        switch kind {
        case .receiptFiles:
            item.files = files.map { .init(storedName: UUID().uuidString, originalName: $0.name, mimeType: $0.mime) }
            payload = files.map(\.data)
        case .receiptURL, .recipeURL:
            item.url = url?.absoluteString
            if kind == .recipeURL, let text, !text.isEmpty, text != url?.absoluteString { item.text = String(text.prefix(4000)) }
        case .text:
            item.text = text
        }
        do {
            try await ShareUploader(session: session, token: token).upload(item, files: payload)
            state = .done(kind == .recipeURL ? L("The recipe is in ToHuus.") : L("Sent to ToHuus."))
        } catch ShareUploader.UploadError.offline {
            UploadQueue.enqueue(item, fileData: payload)
            state = .done(L("No connection – ToHuus sends it as soon as you open the app."))
        } catch ShareUploader.UploadError.needsConfirm {
            item.confirm = true
            UploadQueue.enqueue(item)
            state = .done(L("A Cookidoo recipe – open ToHuus to confirm the ingredients."))
        } catch ShareUploader.UploadError.server(let message) {
            state = .failed(message)
        } catch {
            state = .failed(error.localizedDescription)
        }
        if case .done = state {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            close()
        }
    }

    func close() {
        context?.completeRequest(returningItems: nil)
    }
}

struct ShareView: View {
    @ObservedObject var model: ShareModel

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                if !model.signedIn {
                    Text(L("Please sign in to the ToHuus app first.")).font(.headline)
                } else {
                    switch model.state {
                    case .loading:
                        ProgressView().frame(maxWidth: .infinity)
                    case .ready, .failed:
                        content
                        if case .failed(let m) = model.state { Text(m).foregroundStyle(.red).font(.footnote) }
                    case .sending:
                        HStack { ProgressView(); Text(L("Sending …")) }
                    case .done(let m):
                        Label(m, systemImage: "checkmark.circle.fill").foregroundStyle(Color(red: 0.09, green: 0.42, blue: 0.31))
                    }
                }
                Spacer()
            }
            .padding(20)
            .navigationTitle("ToHuus")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { model.close() } } }
        }
        .tint(Color(red: 0.09, green: 0.42, blue: 0.31))
    }

    @ViewBuilder private var content: some View {
        if !model.files.isEmpty {
            Label(LF("%d files", model.files.count), systemImage: "doc.on.doc")
            Button(L("Add as receipt")) { Task { await model.send(.receiptFiles) } }
                .buttonStyle(.borderedProminent)
        } else if let url = model.url {
            Text(url.host() ?? url.absoluteString).font(.subheadline).foregroundStyle(.secondary)
            Button(L("Save as recipe")) { Task { await model.send(.recipeURL) } }
                .buttonStyle(.borderedProminent)
            Button(L("It's an e-receipt")) { Task { await model.send(.receiptURL) } }
                .buttonStyle(.bordered)
        } else if let text = model.text {
            Text(text).lineLimit(6).font(.subheadline)
            Button(L("Import into ToHuus")) { Task { await model.send(.text) } }
                .buttonStyle(.borderedProminent)
        } else {
            Text(L("ToHuus can't use this. Share a receipt, a photo, a PDF or a link."))
        }
    }
}
