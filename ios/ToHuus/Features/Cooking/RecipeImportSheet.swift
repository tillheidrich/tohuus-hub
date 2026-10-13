import PhotosUI
import SwiftUI

/// A link of Cookidoo or another kitchen appliance platform (Monsieur Cuisine, Cookit, Kenwood …) waiting for
/// confirmation (from the share sheet or the import sheet).
struct CookidooDraftRequest: Identifiable, Equatable, Sendable {
    var url: String
    var text: String?
    /// the platform's name from the server's draft ("Monsieur Cuisine"); nil → asked for with the draft
    var platform: String? = nil
    var id: String { url }
}

/// Kochen › Rezept hinzufügen: link (also social posts with their caption), photos, or text.
/// Cookidoo and the other appliance platforms in ToHuus Cloud answer 409 `cookidoo_confirm` → the confirm sheet.
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
                    HelpLink(slug: "cookidoo", title: L("Cookidoo, Monsieur Cuisine & co."))
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
                    let label = r.body["draft"]?["platform"]?["label"]?.string
                    cookidoo = CookidooDraftRequest(url: url, text: caption.isEmpty ? nil : caption, platform: label)
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

/// Cookidoo, Monsieur Cuisine, Cookit … in ToHuus Cloud: ToHuus never contacts the platform. The person confirms title,
/// ingredients and – if they like – the steps (typed, pasted text sorted by AI or by lines, or read from their own
/// screenshots); kept privately in the household.
struct CookidooConfirmView: View {
    let store: ServerStore
    let request: CookidooDraftRequest
    let finish: (Bool) -> Void
    @Environment(AppModel.self) private var app
    @State private var title = ""
    @State private var ingredients = ""
    @State private var steps = ""
    @State private var servings = ""
    @State private var shots: [PhotosPickerItem] = []
    @State private var pasted = ""
    @State private var platform: String?
    @State private var busy = false
    @State private var error: String?

    /// "Cookidoo", "Monsieur Cuisine" … (older servers send no platform: Cookidoo)
    private var appName: String { platform ?? request.platform ?? "Cookidoo" }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(LF("ToHuus keeps the name, the link, the ingredients and – if you add them – the steps, privately in your household. ToHuus never fetches anything from %@ itself.", appName))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                    Text(request.url).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1)
                }
                Section(L("Title")) { TextField(L("Title"), text: $title) }
                Section {
                    TextEditor(text: $pasted).frame(minHeight: 100)
                    Button {
                        Task { await readText() }
                    } label: {
                        Label(app.aiOn ? L("Read with AI") : L("Sort the text"), systemImage: app.aiOn ? "sparkles" : "text.alignleft")
                    }
                    .disabled(busy || pasted.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
                } header: {
                    Text(L("Paste text"))
                } footer: {
                    Text(LF("Copy the whole recipe in the %@ app and paste it here. You check it before saving.", appName))
                }
                Section {
                    TextEditor(text: $ingredients).frame(minHeight: 160)
                    if app.aiOn {
                        PhotosPicker(selection: $shots, maxSelectionCount: 4, matching: .images) {
                            Label(L("Read from screenshots"), systemImage: "text.viewfinder")
                        }
                    }
                } header: {
                    Text(L("Ingredients, one per line"))
                } footer: {
                    Text(LF("Copy them from %@, or take a screenshot of the ingredient list.", appName))
                }
                Section(L("Steps, one per line (optional)")) { TextEditor(text: $steps).frame(minHeight: 120) }
                Section(L("Servings")) { TextField(L("e.g. 4"), text: $servings).keyboardType(.numberPad) }
                if busy { ProgressView() }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .themedList()
            .navigationTitle(LF("%@ recipe", appName))
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

    /// POST /api/recipes/import/cookidoo/draft { url, text? } → { url, external_id, title, ingredients, platform? { id, label } }
    private func draft() async {
        var body: [String: Any] = ["url": request.url]
        if let t = request.text { body["text"] = t }
        guard let d = try? await store.api.send("POST", "api/recipes/import/cookidoo/draft", json: body, as: JSONValue.self) else { return }
        if title.isEmpty { title = d["title"]?.string ?? "" }
        if let label = d["platform"]?["label"]?.string { platform = label }
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
            if let list = r["steps"]?.array, !list.isEmpty { steps = list.compactMap(\.string).joined(separator: "\n") }
            if let s = r["servings"]?.int { servings = String(s) }
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    /// POST /api/recipes/import/device/read-text { text } → { title, ingredients, steps, servings, ai } – AI when it is on,
    /// else sorted by lines; nothing saved
    private func readText() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.send("POST", "api/recipes/import/device/read-text", json: ["text": pasted], as: JSONValue.self, timeout: 90)
            if title.isEmpty, let t = r["title"]?.string { title = t }
            let found = (r["ingredients"]?.array ?? []).compactMap(\.string)
            if !found.isEmpty { ingredients = (lines + found).joined(separator: "\n") }
            if let list = r["steps"]?.array, !list.isEmpty { steps = list.compactMap(\.string).joined(separator: "\n") }
            if servings.isEmpty, let s = r["servings"]?.int { servings = String(s) }
            if found.isEmpty {
                error = L("No ingredients found in the text.")
            } else {
                error = nil
                pasted = ""
            }
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    /// POST /api/recipes/import/cookidoo { url, title, ingredients[], steps?, servings? }
    private func save() async {
        busy = true
        defer { busy = false }
        var body: [String: Any] = ["url": request.url, "title": title.trimmingCharacters(in: .whitespaces), "ingredients": lines]
        if let s = Int(servings) { body["servings"] = s }
        let stepLines = steps.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        if !stepLines.isEmpty { body["steps"] = stepLines }
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
