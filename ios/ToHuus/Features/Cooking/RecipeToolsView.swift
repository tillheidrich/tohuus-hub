import SwiftUI
import UIKit

/// Rezepte-Werkzeuge (web: Settings › Areas & places › Recipes & imports, RecipeImports.tsx + RecipePhotos.tsx): recipe photos (state, load
/// again on the server, or load them through this phone when the server can't reach the photo site), "Import with any
/// AI", the open recipe database, recipe packages and other apps, and the JSON export.
struct RecipeToolsView: View {
    let store: ServerStore
    /// a recipe was saved (open database) → open it
    var openRecipe: ((Int) -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var status: RecipePhotoStatus?
    @State private var statusError = false
    @State private var busy = false
    @State private var phone: PhoneRun?
    @State private var stop = false
    @State private var message: String?
    @State private var showAI = false
    @State private var staged: StagedImport?
    @State private var exportURL: URL?
    @State private var exporting = false

    struct PhoneRun: Equatable {
        var total: Int
        var done = 0
        var failed = 0
        var running = true
    }

    var body: some View {
        NavigationStack {
            Form {
                photosSection
                Section {
                    NavigationLink {
                        OpenRecipeBrowser(store: store) { id in dismiss(); openRecipe?(id) }
                    } label: {
                        row(L("Discover recipes"), L("Open recipe database with photos"), "globe.europe.africa")
                    }
                    NavigationLink {
                        RecipePackageView(store: store) { dismiss() }
                    } label: {
                        row(L("Recipe package and other apps"), L("Many recipes at once – also from Mealie, Paprika & co."), "shippingbox")
                    }
                    Button { showAI = true } label: {
                        row(L("Import with any AI"), L("Copy a prompt into ChatGPT, Claude or Le Chat, paste the answer here."), "sparkles")
                    }
                    .buttonStyle(.plain)
                } header: { Text(L("Bring recipes in")) }
                Section {
                    if let exportURL {
                        ShareLink(item: exportURL) { Label(L("Share recipes file"), systemImage: "square.and.arrow.up") }
                    } else {
                        Button { Task { await export() } } label: {
                            HStack {
                                Label(L("Download recipes"), systemImage: "arrow.down.doc")
                                if exporting { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(exporting)
                    }
                } header: { Text(L("Export recipes")) } footer: {
                    Text(L("All recipes as one JSON file in the same format – you can import it here again or in another ToHuus Hub. Your own way of cooking and ratings stay out."))
                }
                Section {
                    Text(L("With an MCP connection your assistant can do all of this directly (recipes_import_bulk, recipes_search_open)."))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                    HelpLink(slug: "rezepte-importieren", title: L("Taking over recipes"))
                }
            }
            .themedList()
            .navigationTitle(L("Recipe tools"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { stop = true; dismiss() } } }
            .task { await loadStatus() }
            .task {
                // live while the server is still downloading
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(2.5))
                    if (status?.pending ?? 0) > 0 { await loadStatus() }
                }
            }
            .sheet(isPresented: $showAI) {
                AIImportSheet(store: store) { s in
                    showAI = false
                    Task { @MainActor in
                        try? await Task.sleep(for: .milliseconds(400))
                        staged = s
                    }
                }
            }
            .sheet(item: $staged) { s in
                ImportPreviewSheet(store: store, staged: s) { finished in
                    staged = nil
                    if finished { store.touch("recipes"); Task { await loadStatus() } }
                }
            }
        }
    }

    private func row(_ title: String, _ detail: String, _ icon: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).foregroundStyle(Theme.ink)
                Text(detail).font(.caption).foregroundStyle(Theme.ink3)
            }
        } icon: { Image(systemName: icon).foregroundStyle(Theme.primaryText) }
        .contentShape(Rectangle())
    }

    // MARK: photos

    @ViewBuilder private var photosSection: some View {
        if statusError {
            Section { Label(L("Photo status could not be loaded."), systemImage: "exclamationmark.circle").foregroundStyle(Theme.ink2) }
        } else if let s = status, (s.total ?? 0) > 0 {
            let total = s.total ?? 0, loaded = s.loaded ?? 0
            let missing = total - loaded
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(LF("Photos: %d loaded, %d waiting, %d failed", loaded, s.waiting ?? 0, s.failedTotal ?? 0)).font(.subheadline)
                    ProgressView(value: Double(loaded), total: Double(max(1, total))).tint(Theme.primary)
                    if (s.pending ?? 0) > 0 { Text(LF("Downloading in the background – %d to go.", s.pending ?? 0)).font(.caption).foregroundStyle(Theme.ink3) }
                    if missing > 0 { Text(L("Until a photo is stored here, the recipe shows it from the original website.")).font(.caption).foregroundStyle(Theme.ink3) }
                    ForEach(s.reasons, id: \.self) { r in Text("\(r.reason) · \(r.n)").font(.caption).foregroundStyle(Theme.ink3) }
                }
                .padding(.vertical, 4)
                if missing > 0 {
                    Button { Task { await retry() } } label: { Label(L("Load missing photos"), systemImage: "arrow.clockwise") }
                        .disabled(busy || phone?.running == true)
                    if phone?.running == true {
                        Button(role: .destructive) { stop = true } label: { Label(L("Stop"), systemImage: "stop.circle") }
                    } else {
                        Button { Task { await viaPhone() } } label: { Label(L("Load photos through this phone"), systemImage: "iphone.and.arrow.forward") }
                            .disabled(busy)
                    }
                }
                if let p = phone {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(value: Double(p.done), total: Double(max(1, p.total))).tint(Theme.primary)
                        Text(LF("%d of %d through this phone", p.done, p.total) + (p.failed > 0 ? " · " + LF("%d not possible", p.failed) : ""))
                            .font(.caption.monospacedDigit()).foregroundStyle(Theme.ink3)
                    }
                }
                if let message { Text(message).font(.caption).foregroundStyle(Theme.ink2) }
            } header: {
                Text(L("Recipe photos"))
            } footer: {
                if missing > 0 && phone == nil {
                    Text(L("If the server cannot reach the photo website, this phone can load the photos and hand them to the server. Keep this screen open until it is done."))
                }
            }
        }
    }

    private func loadStatus() async {
        do { status = try await store.api.recipePhotoStatus(); statusError = false } catch { if status == nil { statusError = true } }
    }

    private func retry() async {
        busy = true
        defer { busy = false }
        do {
            let n = try await store.api.retryRecipePhotos()
            message = n > 0 ? LF("%d photos are being loaded again", n) : L("All photos are there")
            await loadStatus()
        } catch { message = APIError.from(error).localizedDescription }
    }

    /// The phone loads each photo from its original site (long side ≤ 1600 px, JPEG) and sends it to the server –
    /// three at a time, like the web's browser fallback.
    private func viaPhone() async {
        stop = false
        message = nil
        let list: [MissingRecipePhoto]
        do { list = try await store.api.missingRecipePhotos().filter { !$0.urls.isEmpty } } catch {
            message = APIError.from(error).localizedDescription
            return
        }
        guard !list.isEmpty else { message = L("All photos are there"); return }
        phone = PhoneRun(total: list.count)
        let api = store.api
        await withTaskGroup(of: Bool.self) { group in
            var next = 0
            while next < min(3, list.count) {
                let m = list[next]
                next += 1
                group.addTask { await Self.transfer(m, api: api) }
            }
            while let ok = await group.next() {
                phone?.done += 1
                if !ok { phone?.failed += 1 }
                if next < list.count && !stop {
                    let m = list[next]
                    next += 1
                    group.addTask { await Self.transfer(m, api: api) }
                }
            }
        }
        phone?.running = false
        store.touch("recipes")
        await loadStatus()
        if let p = phone {
            message = p.failed > 0 ? LF("%d photos loaded, %d not possible", p.done - p.failed, p.failed) : LF("%d photos loaded", p.done)
        }
    }

    private nonisolated static func transfer(_ m: MissingRecipePhoto, api: APIClient) async -> Bool {
        for s in m.urls {
            guard let url = URL(string: s) else { continue }
            var req = URLRequest(url: url, timeoutInterval: 30)
            req.setValue("image/*", forHTTPHeaderField: "Accept")
            guard let (data, resp) = try? await URLSession.shared.data(for: req),
                  ((resp as? HTTPURLResponse)?.statusCode ?? 0) < 400,
                  let img = UIImage(data: data),
                  let jpeg = recipeJPEG(img) else { continue }
            if (try? await api.uploadMissingRecipePhoto(m.id, jpeg: jpeg)) != nil { return true }
        }
        return false
    }

    // MARK: export

    private func export() async {
        exporting = true
        defer { exporting = false }
        do {
            let data = try await store.api.recipesExportJSON()
            let day = Date().formatted(.iso8601.year().month().day())
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("tohuus-rezepte-\(day).json")
            try data.write(to: url, options: .atomic)
            exportURL = url
        } catch { message = APIError.from(error).localizedDescription }
    }
}

/// "Mit jeder KI importieren": copy the prompt, let any assistant read a photo, page or text, paste the answer back –
/// then the same preview as a file (POST /api/recipes/import/paste).
struct AIImportSheet: View {
    let store: ServerStore
    let onStaged: (StagedImport) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var template: AIImportTemplate?
    @State private var lang = Locale.current.language.languageCode?.identifier == "de" ? "de" : "en"
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    @State private var copied = false
    @State private var showPrompt = false
    @State private var showFormat = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label(L("Copy the prompt."), systemImage: "1.circle")
                    Label(L("Paste it into ChatGPT, Claude, Le Chat or any other assistant and add the recipe: a photo, a cookbook page, a link or text."), systemImage: "2.circle")
                    Label(L("Copy the whole answer and paste it below."), systemImage: "3.circle")
                }
                .font(.subheadline)
                Section {
                    Picker(L("Language of the prompt"), selection: $lang) {
                        Text("Deutsch").tag("de")
                        Text("English").tag("en")
                    }
                    Button {
                        UIPasteboard.general.string = template?.prompts[lang]
                        copied = true
                        Haptics.success()
                    } label: { Label(copied ? L("Copied") : L("Copy prompt"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                    .disabled(template?.prompts[lang] == nil)
                    DisclosureGroup(L("Show prompt"), isExpanded: $showPrompt) {
                        Text(template?.prompts[lang] ?? "").font(.caption.monospaced()).foregroundStyle(Theme.ink2).textSelection(.enabled)
                    }
                    if let ex = template?.example, !ex.isEmpty {
                        DisclosureGroup(L("Show the JSON format"), isExpanded: $showFormat) {
                            Text(ex).font(.caption2.monospaced()).foregroundStyle(Theme.ink2).textSelection(.enabled)
                            Button { UIPasteboard.general.string = ex; Haptics.success() } label: { Label(L("Copy example"), systemImage: "doc.on.doc") }
                        }
                    }
                }
                Section {
                    TextEditor(text: $text)
                        .font(.caption.monospaced())
                        .frame(minHeight: 160)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    if text.isEmpty {
                        PasteButton(payloadType: String.self) { s in
                            Task { @MainActor in text = s.joined(separator: "\n") }
                        }
                    }
                } header: { Text(L("Answer of the assistant")) } footer: {
                    Text(L("It is fine if the answer has text or ``` around the JSON."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.low) } }
            }
            .themedList()
            .navigationTitle(L("Import with any AI"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? L("Checking…") : L("Check and preview")) { Task { await check() } }
                        .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
                }
            }
            .onChange(of: lang) { _, _ in copied = false }
            .task {
                do { template = try await store.api.aiImportTemplate() } catch { self.error = APIError.from(error).localizedDescription }
            }
        }
    }

    private func check() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            let s = try await store.api.pasteRecipeImport(text)
            text = ""
            onStaged(s)
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
