import PhotosUI
import SwiftUI

/// A Cookidoo link waiting for confirmation (from the share sheet or the import sheet).
struct CookidooDraftRequest: Identifiable, Equatable, Sendable {
    var url: String
    var text: String?
    var id: String { url }
}

/// Kochen › Rezept hinzufügen: link (also social posts with their caption), photos, or text.
/// Cookidoo in ToHuus Cloud answers 409 `cookidoo_confirm` → the confirm sheet (link + ingredients only).
struct RecipeImportSheet: View {
    let store: ServerStore
    /// a recipe from the open database was saved → open it (CookingView)
    var openRecipe: ((Int) -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var mode = 0
    @State private var url = ""
    @State private var caption = ""
    @State private var text = ""
    @State private var photos: [PhotosPickerItem] = []
    @State private var busy = false
    @State private var message: String?
    @State private var cookidoo: CookidooDraftRequest?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    NavigationLink {
                        OpenRecipeBrowser(store: store) { id in
                            dismiss()
                            openRecipe?(id)
                        }
                    } label: {
                        Label { VStack(alignment: .leading, spacing: 2) {
                            Text(LC("Discover recipes"))
                            Text(LC("Open recipe database with photos")).font(.caption).foregroundStyle(Theme.ink3)
                        } } icon: { Image(systemName: "globe.europe.africa") }
                    }
                    NavigationLink {
                        RecipePackageView(store: store) { dismiss() }
                    } label: {
                        Label { VStack(alignment: .leading, spacing: 2) {
                            Text(LC("Recipe package"))
                            Text(LC("Many recipes at once – also from Mealie, Paprika & co.")).font(.caption).foregroundStyle(Theme.ink3)
                        } } icon: { Image(systemName: "shippingbox") }
                    }
                }
                Picker("", selection: $mode) {
                    Text(L("Link")).tag(0)
                    Text(L("Photo")).tag(1)
                    Text(L("Text")).tag(2)
                }
                .pickerStyle(.segmented)
                switch mode {
                case 0:
                    Section {
                        TextField(L("Recipe link, Instagram or TikTok post"), text: $url)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        TextField(L("Caption of the post (optional)"), text: $caption, axis: .vertical).lineLimit(2...6)
                    } footer: {
                        Text(L("For social posts the caption often is the recipe – paste it if the link alone isn't enough."))
                    }
                case 1:
                    Section {
                        let pickLabel = photos.isEmpty ? L("Choose photos (up to 6)") : LF("%d photos chosen", photos.count)
                        PhotosPicker(selection: $photos, maxSelectionCount: 6, matching: .images) {
                            Label(pickLabel, systemImage: "photo.on.rectangle")
                        }
                    } footer: {
                        Text(L("A cookbook page, a handwritten card or the display of a kitchen appliance."))
                    }
                default:
                    Section {
                        TextEditor(text: $text).frame(minHeight: 180)
                    } footer: {
                        Text(L("Paste the recipe – title, ingredients and steps."))
                    }
                }
                if busy { HStack { ProgressView(); Text(L("Reading …")) } }
                if let message { Text(message).foregroundStyle(Theme.ink2) }
                Section {
                    HelpLink(slug: "rezepte-importieren", title: L("Taking over recipes"))
                    HelpLink(slug: "cookidoo", title: L("Cookidoo recipes"))
                }
            }
            .themedList()
            .navigationTitle(L("Add recipe"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Take it over")) { Task { await run() } }.disabled(busy || !ready)
                }
            }
            .sheet(item: $cookidoo) { d in
                CookidooConfirmView(store: store, request: d) { done in
                    cookidoo = nil
                    if done { dismiss() }
                }
            }
        }
    }

    private var ready: Bool {
        switch mode {
        case 0: return url.lowercased().hasPrefix("http")
        case 1: return !photos.isEmpty
        default: return text.trimmingCharacters(in: .whitespacesAndNewlines).count > 10
        }
    }

    private func run() async {
        busy = true
        defer { busy = false }
        message = nil
        do {
            switch mode {
            case 0:
                var body: [String: Any] = ["url": url.trimmingCharacters(in: .whitespaces)]
                if !caption.isEmpty { body["text"] = caption }
                let r = try await store.api.sendRaw("POST", "api/recipes/import/url", json: body, timeout: 90)
                if r.status == 409, r.body["code"]?.string == "cookidoo_confirm" {
                    cookidoo = CookidooDraftRequest(url: url, text: caption.isEmpty ? nil : caption)
                    return
                }
                guard (200..<300).contains(r.status) else { throw APIError.server(status: r.status, message: r.body["error"]?.string ?? "") }
            case 1:
                var mp = Multipart()
                for (i, item) in photos.enumerated() {
                    if let d = try? await item.loadTransferable(type: Data.self), let jpg = UIImage(data: d)?.jpegData(compressionQuality: 0.8) {
                        mp.addFile("files", filename: "recipe-\(i + 1).jpg", mimeType: "image/jpeg", data: jpg)
                    }
                }
                _ = try await store.api.upload("api/recipes/import/photo", multipart: mp, as: Ignored.self, timeout: 180)
            default:
                _ = try await store.api.send("POST", "api/recipes/import/text", json: ["text": text], as: Ignored.self, timeout: 90)
            }
            store.touch("recipes")
            Haptics.success()
            dismiss()
        } catch {
            message = APIError.from(error).localizedDescription
        }
    }
}

/// Cookidoo in ToHuus Cloud: ToHuus never contacts Cookidoo. The person confirms title and ingredients (typed, pasted
/// or read from their own screenshot); stored are title, link and ingredients – cooking happens in Cookidoo.
struct CookidooConfirmView: View {
    let store: ServerStore
    let request: CookidooDraftRequest
    let finish: (Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var title = ""
    @State private var ingredients = ""
    @State private var servings = ""
    @State private var shots: [PhotosPickerItem] = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(L("Cookidoo recipes stay in Cookidoo. ToHuus keeps the link, the title and the ingredients – so it knows what's missing and can put it on the list."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                    Text(request.url).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1)
                }
                Section(L("Title")) { TextField(L("Title"), text: $title) }
                Section {
                    TextEditor(text: $ingredients).frame(minHeight: 160)
                    if app.aiOn {
                        PhotosPicker(selection: $shots, maxSelectionCount: 4, matching: .images) {
                            Label(L("Read a screenshot of the ingredient list"), systemImage: "text.viewfinder")
                        }
                    }
                } header: {
                    Text(L("Ingredients, one per line"))
                } footer: {
                    Text(L("Copy them from Cookidoo, or take a screenshot of the ingredient list."))
                }
                Section(L("Servings")) { TextField(L("e.g. 4"), text: $servings).keyboardType(.numberPad) }
                if busy { ProgressView() }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .themedList()
            .navigationTitle(L("Cookidoo recipe"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { finish(false) } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save() } }
                        .disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty || lines.isEmpty)
                }
            }
            .task { await draft() }
            .onChange(of: shots) { _, items in
                guard !items.isEmpty else { return }
                Task { await read(items) }
            }
        }
    }

    private var lines: [String] {
        ingredients.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// POST /api/recipes/import/cookidoo/draft { url, text? } → { url, external_id, title, ingredients }
    private func draft() async {
        var body: [String: Any] = ["url": request.url]
        if let t = request.text { body["text"] = t }
        guard let d = try? await store.api.send("POST", "api/recipes/import/cookidoo/draft", json: body, as: JSONValue.self) else { return }
        if title.isEmpty { title = d["title"]?.string ?? "" }
        if ingredients.isEmpty, let list = d["ingredients"]?.array { ingredients = list.compactMap(\.string).joined(separator: "\n") }
    }

    /// POST /api/recipes/import/cookidoo/read (multipart files ≤ 4) → { title, ingredients, servings } – needs AI, nothing saved
    private func read(_ items: [PhotosPickerItem]) async {
        busy = true
        defer { busy = false; shots = [] }
        var mp = Multipart()
        for (i, item) in items.enumerated() {
            if let d = try? await item.loadTransferable(type: Data.self), let jpg = UIImage(data: d)?.jpegData(compressionQuality: 0.8) {
                mp.addFile("files", filename: "cookidoo-\(i + 1).jpg", mimeType: "image/jpeg", data: jpg)
            }
        }
        do {
            let r = try await store.api.upload("api/recipes/import/cookidoo/read", multipart: mp, as: JSONValue.self, timeout: 120)
            if title.isEmpty, let t = r["title"]?.string { title = t }
            if let list = r["ingredients"]?.array { ingredients = list.compactMap(\.string).joined(separator: "\n") }
            if let s = r["servings"]?.int { servings = String(s) }
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    /// POST /api/recipes/import/cookidoo { url, title, ingredients[], servings? }
    private func save() async {
        busy = true
        defer { busy = false }
        var body: [String: Any] = ["url": request.url, "title": title.trimmingCharacters(in: .whitespaces), "ingredients": lines]
        if let s = Int(servings) { body["servings"] = s }
        do {
            _ = try await store.api.send("POST", "api/recipes/import/cookidoo", json: body, as: Ignored.self)
            store.touch("recipes")
            Haptics.success()
            finish(true)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
