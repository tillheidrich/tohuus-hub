import LinkPresentation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Share extension: receipts (PDF, screenshot, photo), recipe or e-receipt links and text. Sends straight to the
/// server with the app's token (App Group keychain); when offline it queues the payload for the app.
/// Since 20 Oct 2026 also "Als Wunsch speichern": a link from Safari or a shop app, a photo or a text becomes a wish
/// on a chosen wish list – title and picture of a link are read here with LinkPresentation, never by the server.
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
    /// "Als Wunsch speichern": the person's wish lists, the chosen one, a title read from the link
    @Published var wishLists: [ShareWishList] = []
    @Published var wishListId: Int?
    @Published var wishTitle = ""
    @Published var wishImage: Data?
    @Published var wishMode = false
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
        if signedIn { await loadWishLists() }
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
        // the receipt shows "Auf dem iPhone geteilt" (server/lib/import-origin.ts)
        item.origin = "share"
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
            state = .done(L("A recipe from Cookidoo or another kitchen appliance app – open ToHuus to confirm the ingredients."))
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

    // MARK: wish

    private func request(_ path: String, method: String = "GET") -> URLRequest? {
        guard let session, let token else { return nil }
        var req = URLRequest(url: session.serverURL.appendingPathComponent(path))
        req.httpMethod = method
        req.timeoutInterval = 30
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let h = session.householdId { req.setValue(h, forHTTPHeaderField: "X-Household") }
        req.setValue("ios", forHTTPHeaderField: "X-ToHuus-Client")
        return req
    }

    func loadWishLists() async {
        guard let req = request("api/wishes/lists") else { return }
        guard let r = try? await URLSession.shared.data(for: req), (r.1 as? HTTPURLResponse)?.statusCode == 200 else { return }
        let data = r.0
        let dec = JSONDecoder()
        dec.keyDecodingStrategy = .convertFromSnakeCase
        // lists the person runs (own or "Ich bearbeite mit") first
        let all = (try? dec.decode([ShareWishList].self, from: data)) ?? []
        wishLists = all.filter { $0.role != "member" } + all.filter { $0.role == "member" }
        wishListId = wishLists.first?.id
        if let url {
            wishTitle = Self.titleFromURL(url)
            let md = await Self.readLink(url)
            if let t = md.title, !t.isEmpty { wishTitle = String(t.prefix(160)) }
            wishImage = md.image
        } else if let t = text {
            wishTitle = String(t.trimmingCharacters(in: .whitespacesAndNewlines).prefix(160))
        }
    }

    /// LinkPresentation on the device: page title and picture
    static func readLink(_ url: URL) async -> (title: String?, image: Data?) {
        await withCheckedContinuation { (c: CheckedContinuation<(title: String?, image: Data?), Never>) in
            DispatchQueue.main.async {
                let p = LPMetadataProvider()
                p.timeout = 8
                p.startFetchingMetadata(for: url) { md, _ in
                    let title = md?.title
                    guard let ip = md?.imageProvider else { return c.resume(returning: (title, nil)) }
                    _ = ip.loadDataRepresentation(for: .image) { data, _ in c.resume(returning: (title, data)) }
                }
            }
        }
    }

    /// "…/lego-city-feuerwehrstation-60320.html" → "Lego city feuerwehrstation" (the web does the same)
    static func titleFromURL(_ url: URL) -> String {
        let parts = url.pathComponents.map { ($0 as NSString).deletingPathExtension }
            .filter { $0.count > 3 && $0.range(of: "[a-zA-ZäöüÄÖÜ]{3}", options: .regularExpression) != nil }
        guard let best = parts.max(by: { $0.filter { "-_".contains($0) }.count < $1.filter { "-_".contains($0) }.count }) else { return url.host() ?? "" }
        let words = best.split(whereSeparator: { "-_+ ".contains($0) }).map(String.init).filter { $0.range(of: "^[a-zA-Z]*[0-9]{4,}[a-zA-Z]*$", options: .regularExpression) == nil }
        let s = words.prefix(10).joined(separator: " ")
        return s.prefix(1).uppercased() + s.dropFirst()
    }

    func saveWish() async {
        guard let listId = wishListId, !wishTitle.trimmingCharacters(in: .whitespaces).isEmpty, var req = request("api/wishes/lists/\(listId)/items", method: "POST") else { return }
        state = .sending
        var body: [String: Any] = ["title": wishTitle.trimmingCharacters(in: .whitespacesAndNewlines)]
        if let url, !url.isFileURL {
            body["links"] = [["url": url.absoluteString, "label": url.host()?.replacingOccurrences(of: "www.", with: "") ?? NSNull(), "title": wishTitle, "site": url.host() ?? NSNull()] as [String: Any]]
        } else if let t = text, t != wishTitle {
            body["note"] = String(t.prefix(2000))
        }
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard (200..<300).contains(code), let id = obj?["id"] as? Int else {
                state = .failed((obj?["error"] as? String) ?? "HTTP \(code)")
                return
            }
            // the shared photo, else the page picture, becomes the wish's photo
            let photo = files.first(where: { $0.mime == "image/jpeg" })?.data ?? wishImage.flatMap { UIImage(data: $0)?.jpegData(compressionQuality: 0.8) }
            if let photo, var up = request("api/wishes/items/\(id)/photo", method: "POST") {
                var mp = Multipart()
                mp.addFile("image", filename: "wish.jpg", mimeType: "image/jpeg", data: photo)
                up.setValue(mp.contentType, forHTTPHeaderField: "Content-Type")
                _ = try? await URLSession.shared.upload(for: up, from: mp.finished())
            }
            let name = wishLists.first { $0.id == listId }?.name ?? ""
            state = .done(LF("Saved as a wish on “%@”.", name))
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            close()
        } catch {
            state = .failed(L("No connection. Try again when you are online."))
        }
    }
}

/// GET /api/wishes/lists (only what the share sheet needs)
struct ShareWishList: Decodable, Identifiable, Hashable {
    var id: Int
    var name: String
    var role: String?
    var forName: String?
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
        if model.wishMode {
            wishForm
        } else {
            mainContent
            if !model.wishLists.isEmpty && (model.url != nil || model.text != nil || model.files.contains { $0.mime == "image/jpeg" }) {
                Button { model.wishMode = true } label: { Label(L("Save as a wish"), systemImage: "gift") }
                    .buttonStyle(.bordered)
            }
        }
    }

    @ViewBuilder private var wishForm: some View {
        Text(L("Save as a wish")).font(.headline)
        HStack(spacing: 12) {
            if let d = model.wishImage ?? model.files.first(where: { $0.mime == "image/jpeg" })?.data, let img = UIImage(data: d) {
                Image(uiImage: img).resizable().scaledToFill().frame(width: 64, height: 64)
                    .clipShape(UnevenRoundedRectangle(topLeadingRadius: 32, bottomLeadingRadius: 6, bottomTrailingRadius: 6, topTrailingRadius: 32))
            }
            TextField(L("What is it?"), text: $model.wishTitle, axis: .vertical).textFieldStyle(.roundedBorder)
        }
        Picker(L("On which list?"), selection: $model.wishListId) {
            ForEach(model.wishLists) { l in Text(l.forName.map { "\(l.name) · \($0)" } ?? l.name).tag(Int?.some(l.id)) }
        }
        Button(L("Save wish")) { Task { await model.saveWish() } }
            .buttonStyle(.borderedProminent)
            .disabled(model.wishTitle.trimmingCharacters(in: .whitespaces).isEmpty || model.wishListId == nil)
        Button(L("Back")) { model.wishMode = false }.buttonStyle(.borderless)
    }

    @ViewBuilder private var mainContent: some View {
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
