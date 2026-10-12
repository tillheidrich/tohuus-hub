import SwiftUI
import UniformTypeIdentifiers

// Recipe sources (web: pages/RecipeImports.tsx, RecipePackage.tsx): browse the open recipe database with pictures and
// take a recipe over with one tap; upload a recipe package or another app's export (Files), preview, pick, import.

// MARK: - open recipe database

/// Kochen › Rezepte › „Rezepte entdecken“: TheMealDB through the server (ingredients translated, steps in English).
struct OpenRecipeBrowser: View {
    let store: ServerStore
    /// a recipe was saved → open it
    var onSaved: (Int) -> Void
    var initialQuery: String?
    @State private var query = ""
    @State private var chip: String? = "chicken"
    @State private var results: [OpenRecipeHit]?
    @State private var loading = false
    @State private var error: String?
    @State private var show: OpenRecipeHit?
    @FocusState private var focused: Bool

    /// German label → English search word (the database is English).
    private static let chips: [(String, String)] = [
        ("Chicken", "chicken"), ("Pasta", "pasta"), ("Curry", "curry"), ("Soup", "soup"), ("Fish", "fish"),
        ("Rice", "rice"), ("Pancakes", "pancakes"), ("Cake", "cake"), ("Beef", "beef"), ("Salad", "salad"),
    ]

    private var term: String {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.count >= 2 ? q : (chip ?? "")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Text(LC("Free and open, in English. Ingredients come over in your language and units, the English original stays visible."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                searchField
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Self.chips, id: \.1) { label, word in
                            let on = query.trimmingCharacters(in: .whitespaces).count < 2 && chip == word
                            Button {
                                query = ""
                                chip = word
                                focused = false
                            } label: {
                                Text(LC(label)).font(.subheadline.weight(.semibold))
                                    .padding(.horizontal, 14).frame(minHeight: 36)
                                    .background(on ? Theme.primary : Theme.surface, in: Capsule())
                                    .overlay(Capsule().stroke(on ? Color.clear : Theme.line, lineWidth: 1))
                                    .foregroundStyle(on ? Theme.onPrimary : Theme.ink)
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 2)
                }
                content
            }
            .padding(Theme.Space.s4)
            .padding(.bottom, 40)
        }
        .canvasBackground()
        .navigationTitle(LC("Discover recipes"))
        .navigationBarTitleDisplayMode(.inline)
        .task(id: term) { await search() }
        .onAppear { if let initialQuery, query.isEmpty { query = initialQuery } }
        .sheet(item: $show) { hit in
            OpenRecipePreviewSheet(store: store, hit: hit) { id in
                show = nil
                onSaved(id)
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.ink3)
            TextField(LC("Dish in English, e.g. lasagne, curry"), text: $query)
                .focused($focused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.ink3) }
                    .accessibilityLabel(LC("Clear"))
            }
        }
        .padding(10)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(Theme.line, lineWidth: 1))
    }

    @ViewBuilder private var content: some View {
        if let error {
            ErrorBanner(message: error) { Task { await search(force: true) } }
        } else if loading && results == nil {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
        } else if let results, results.isEmpty {
            Text(LCF("Nothing found for “%@”. Try an English word.", term)).font(.subheadline).foregroundStyle(Theme.ink3)
        } else if let results {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: Theme.Space.s3)], spacing: Theme.Space.s3) {
                ForEach(results) { h in
                    Button { show = h } label: { card(h) }
                        .buttonStyle(.plain)
                        .hoverEffect(.lift)
                }
            }
            .opacity(loading ? 0.5 : 1)
        }
    }

    private func card(_ h: OpenRecipeHit) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .aspectRatio(4 / 3, contentMode: .fit)
                .overlay(RemoteImage(url: store.api.imageURL(h.thumb), api: store.api, placeholder: "fork.knife"))
                .clipped()
            VStack(alignment: .leading, spacing: 2) {
                Text(h.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                    .lineLimit(2).multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                let sub = [h.category, h.area].compactMap { $0 }.joined(separator: " · ")
                if !sub.isEmpty { Text(sub).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1) }
            }
            .padding(10)
        }
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private func search(force: Bool = false) async {
        let t = term
        guard !t.isEmpty else { results = nil; return }
        if !force { try? await Task.sleep(for: .milliseconds(400)) }
        guard !Task.isCancelled, t == term else { return }
        loading = true
        defer { loading = false }
        do {
            let r = try await store.api.openRecipes(t)
            guard t == term else { return }
            results = r
            error = nil
        } catch {
            if Task.isCancelled { return }
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// One open recipe before saving: photo, ingredients (with English original), steps. „In unsere Rezepte“ saves it.
struct OpenRecipePreviewSheet: View {
    let store: ServerStore
    let hit: OpenRecipeHit
    var onSaved: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var rec: OpenRecipePreview?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    Color.clear
                        .aspectRatio(16 / 10, contentMode: .fit)
                        .overlay(RemoteImage(url: store.api.imageURL(rec?.imageUrl ?? hit.image), api: store.api, placeholder: "fork.knife"))
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
                    Text(rec?.title ?? hit.title).font(Theme.title())
                        .fixedSize(horizontal: false, vertical: true)
                    if let error {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else if let rec {
                        let tags = rec.tags ?? [hit.category, hit.area].compactMap { $0 }
                        if !tags.isEmpty {
                            FlowLayout { ForEach(tags, id: \.self) { StatusPill(text: $0, status: nil) } }
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            Text(LC("Ingredients")).font(.headline)
                            ForEach(Array(rec.ingredients.enumerated()), id: \.offset) { _, i in
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(i.text).foregroundStyle(Theme.ink)
                                    if let o = i.orig, !o.isEmpty, o != i.text {
                                        Label(o, systemImage: "character.bubble").font(.caption).foregroundStyle(Theme.ink3)
                                    }
                                }
                                .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        if !rec.steps.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(LC("Instructions")).font(.headline)
                                if Locale.current.language.languageCode?.identifier != "en" {
                                    Text(LC("The steps stay in English.")).font(.caption).foregroundStyle(Theme.ink3)
                                }
                                ForEach(Array(rec.steps.enumerated()), id: \.offset) { n, s in
                                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                                        Text("\(n + 1).").font(.subheadline.weight(.bold).monospacedDigit()).foregroundStyle(Theme.primaryText)
                                        Text(s.text).font(.subheadline).foregroundStyle(Theme.ink2)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                }
                            }
                        }
                    } else {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 20)
                    }
                }
                .padding(Theme.Space.s4)
                .padding(.bottom, 90)
            }
            .canvasBackground()
            .safeAreaInset(edge: .bottom) {
                Button { Task { await save() } } label: {
                    Label(busy ? LC("Saving …") : LC("Save to our recipes"), systemImage: "square.and.arrow.down")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(rec == nil || busy)
                .padding(.horizontal, Theme.Space.s4)
                .padding(.vertical, Theme.Space.s3)
                .background(.bar)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .task { await load() }
        }
    }

    private func load() async {
        do {
            rec = try await store.api.openRecipe(hit.id)
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.importOpenRecipe(hit.id)
            store.touch("recipes")
            Haptics.success()
            onSaved(r.id)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

// MARK: - recipe package / app exports

/// Kochen › Rezept hinzufügen › „Rezeptpaket“: zip/JSON from ToHuus, Mealie, Paprika, Tandoor, Nextcloud, CSV …
/// from the Files app → preview → pick → import with progress. Plus the prompt for your own AI and the export.
struct RecipePackageView: View {
    let store: ServerStore
    var onDone: () -> Void
    @State private var picking = false
    @State private var busy = false
    @State private var error: String?
    @State private var staged: StagedImport?
    @State private var prompts: [String: String] = [:]
    @State private var promptLang = Locale.current.language.languageCode?.identifier == "de" ? "de" : "en"
    @State private var showPrompt = false
    @State private var copied = false
    @State private var exportURL: URL?
    @State private var exporting = false

    private static let types: [UTType] = [.zip, .json, .commaSeparatedText, .data]

    var body: some View {
        Form {
            Section {
                Button { picking = true } label: {
                    HStack(spacing: Theme.Space.s3) {
                        Image(systemName: busy ? "hourglass" : "doc.badge.arrow.up").font(.title2).foregroundStyle(Theme.primaryText)
                            .frame(width: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(busy ? LC("Reading the file …") : LC("Choose file")).font(.headline).foregroundStyle(Theme.ink)
                            Text(LC("zip, JSON, .paprikarecipes or CSV – up to 100 MB")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    .padding(.vertical, 6)
                }
                .disabled(busy)
                if let error { Text(error).font(.subheadline).foregroundStyle(Theme.low) }
            } header: {
                Text(LC("Upload recipe package"))
            } footer: {
                Text(LC("Many recipes at once: a ToHuus package (zip with photos) or the export of another app – Mealie, Paprika, Tandoor, Nextcloud Cookbook, KitchenOwl, CSV. You see everything first and pick what comes in. Recipes that are already here are updated, not doubled."))
            }
            Section {
                Picker(LC("Language of the prompt"), selection: $promptLang) {
                    Text("Deutsch").tag("de")
                    Text("English").tag("en")
                }
                Button {
                    UIPasteboard.general.string = prompts[promptLang]
                    copied = true
                    Haptics.success()
                } label: {
                    Label(copied ? LC("Copied") : LC("Copy prompt"), systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .disabled(prompts[promptLang] == nil)
                DisclosureGroup(LC("Show prompt"), isExpanded: $showPrompt) {
                    Text(prompts[promptLang] ?? "").font(.caption.monospaced()).foregroundStyle(Theme.ink2).textSelection(.enabled)
                }
            } header: {
                Text(LC("Let your own AI build it"))
            } footer: {
                Text(LC("Copy the prompt into any chat assistant, add your cookbook pages, screenshots or notes, and upload what comes back here."))
            }
            Section {
                if let exportURL {
                    ShareLink(item: exportURL) { Label(LC("Share recipe package"), systemImage: "square.and.arrow.up") }
                } else {
                    Button { Task { await export() } } label: {
                        HStack {
                            Label(LC("Export as recipe package"), systemImage: "shippingbox")
                            if exporting { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(exporting)
                }
            } footer: {
                Text(LC("All recipes with photos in one zip – the same format comes back in here or into another ToHuus."))
            }
            Section { HelpLink(slug: "rezeptpaket", title: LC("Recipe package")) }
        }
        .navigationTitle(LC("Recipe package"))
        .navigationBarTitleDisplayMode(.inline)
        .fileImporter(isPresented: $picking, allowedContentTypes: Self.types) { result in
            if case .success(let url) = result { Task { await read(url) } }
        }
        .onChange(of: promptLang) { _, _ in copied = false }
        .task { if prompts.isEmpty, let t = try? await store.api.recipePackageTemplate() { prompts = t.prompts } }
        .sheet(item: $staged) { s in
            ImportPreviewSheet(store: store, staged: s) { finished in
                staged = nil
                if finished { onDone() }
            }
        }
    }

    private func read(_ url: URL) async {
        busy = true
        error = nil
        defer { busy = false }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            guard data.count <= 100 * 1024 * 1024 else { error = LC("The file is larger than 100 MB."); return }
            staged = try await store.api.detectRecipeFile(data, filename: url.lastPathComponent)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func export() async {
        exporting = true
        defer { exporting = false }
        do {
            let data = try await store.api.recipePackage()
            let day = Date().formatted(.iso8601.year().month().day())
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("tohuus-rezeptpaket-\(day).zip")
            try data.write(to: url, options: .atomic)
            exportURL = url
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// Preview of a staged import: what is new, what is updated, possible doubles start unticked. Then import with progress.
struct ImportPreviewSheet: View {
    let store: ServerStore
    let staged: StagedImport
    /// true = something was imported
    var onClose: (Bool) -> Void
    @State private var selected: Set<Int> = []
    @State private var job: ImportJobState?
    @State private var error: String?
    @State private var running = false

    var body: some View {
        NavigationStack {
            List {
                if let job, job.finished {
                    finishedSection(job)
                } else if let job {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            ProgressView(value: Double(job.done), total: Double(max(1, job.total)))
                            Text(LCF("%d of %d recipes", job.done, job.total)).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.ink2)
                        }
                        .padding(.vertical, 6)
                    }
                } else {
                    Section {
                        Text(summary).font(.subheadline).foregroundStyle(Theme.ink2)
                        if let w = staged.warnings, !w.isEmpty { ForEach(w, id: \.self) { Text($0).font(.caption).foregroundStyle(Theme.ink3) } }
                        if !staged.errors.isEmpty {
                            Text(LCF("%d could not be read", staged.errors.count)).font(.caption).foregroundStyle(Theme.low)
                        }
                    }
                    Section {
                        ForEach(staged.recipes) { r in row(r) }
                    } header: {
                        HStack {
                            Text(LCF("%d chosen", selected.count))
                            Spacer()
                            Button(selected.count == staged.recipes.count ? LC("None") : LC("All")) {
                                selected = selected.count == staged.recipes.count ? [] : Set(staged.recipes.map(\.index))
                            }
                            .font(.caption.weight(.semibold))
                        }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.low) } }
            }
            .navigationTitle(job?.finished == true ? LC("Import finished") : LC("Preview"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(job?.finished == true ? L("Done") : L("Close")) { onClose(job?.finished == true) }.disabled(running)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if job == nil {
                    Button { Task { await start() } } label: {
                        Text(LCF("Import %d recipes", selected.count))
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(selected.isEmpty || running)
                    .padding(.horizontal, Theme.Space.s4)
                    .padding(.vertical, Theme.Space.s3)
                    .background(.bar)
                }
            }
            .interactiveDismissDisabled(running)
            .onAppear { selected = Set(staged.recipes.filter { $0.similarId == nil }.map(\.index)) }
        }
    }

    private var summary: String {
        let label = staged.formatLabel ?? staged.format ?? ""
        let upd = staged.updates ?? 0
        return upd > 0 ? LCF("%@: %d recipes, %d of them already here (they are updated).", label, staged.count, upd)
                       : LCF("%@: %d recipes.", label, staged.count)
    }

    private func row(_ r: StagedRecipe) -> some View {
        let on = selected.contains(r.index)
        return Button {
            if on { selected.remove(r.index) } else { selected.insert(r.index) }
        } label: {
            HStack(spacing: Theme.Space.s3) {
                RemoteImage(url: store.api.imageURL(r.image), api: store.api, placeholder: "fork.knife")
                    .frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.title).foregroundStyle(Theme.ink).lineLimit(2)
                    let parts: [String] = [
                        r.ingredients.map { LCF("%d ingredients", $0) },
                        r.existingId != nil ? LC("updates the one here") : nil,
                        r.similarId != nil ? LC("same name already here") : nil,
                    ].compactMap { $0 }
                    Text(parts.joined(separator: " · ")).font(.caption)
                        .foregroundStyle(r.similarId != nil ? Theme.low : Theme.ink3)
                }
                Spacer(minLength: 4)
                Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.title3)
                    .foregroundStyle(on ? Theme.primary : Theme.ink3)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    @ViewBuilder private func finishedSection(_ j: ImportJobState) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Label(LC("Done"), systemImage: "checkmark.circle.fill").font(.headline).foregroundStyle(Theme.primaryText)
                if (j.created ?? 0) > 0 { Text(LCF("%d new recipes", j.created ?? 0)) }
                if (j.updated ?? 0) > 0 { Text(LCF("%d updated", j.updated ?? 0)) }
                if (j.images ?? 0) > 0 { Text(LCF("%d photos", j.images ?? 0)) }
                if (j.imagesPending ?? 0) > 0 { Text(LCF("%d photos are still loading in the background.", j.imagesPending ?? 0)).font(.caption).foregroundStyle(Theme.ink3) }
                if (j.failed ?? 0) > 0 { Text(LCF("%d could not be read", j.failed ?? 0)).foregroundStyle(Theme.low) }
                if let e = j.error { Text(e).foregroundStyle(Theme.low) }
            }
            .padding(.vertical, 6)
        }
    }

    private func start() async {
        running = true
        defer { running = false }
        error = nil
        do {
            let all = selected.count == staged.recipes.count
            let id = try await store.api.commitImport(session: staged.session, include: all ? nil : selected.sorted())
            job = ImportJobState(total: selected.count, done: 0, finished: false, errors: Lossy<StagedError>(wrappedValue: []))
            while !Task.isCancelled {
                let j = try await store.api.importJob(id)
                job = j
                if j.finished { break }
                try await Task.sleep(for: .milliseconds(600))
            }
            store.touch("recipes")
            Haptics.success()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
