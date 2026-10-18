import SwiftUI
import UniformTypeIdentifiers

/// Haushaltswissen: import and export (docs/knowledge.md › Import und Export). Same as the web (KnowledgeIO.tsx):
/// a file from Files (Markdown, text, CSV, JSON – also Obsidian/Notion exports) or pasted text → preview → take over
/// the picked rows, with one undo. Export as Markdown, CSV or JSON through the share sheet ("In Dateien sichern" too).
/// A file handed to ToHuus with „Öffnen in ToHuus“ (ToHuusApp.handle) – shown in the import sheet below.
struct OpenedKnowledgeFile: Identifiable {
    let id = UUID()
    let source: KnowledgeImportSource
}

struct KnowledgeImportSheet: View {
    let api: APIClient
    var onDone: (String, String?) -> Void
    /// a file opened from outside: the sheet starts with it and goes straight to the preview
    var initialSource: KnowledgeImportSource? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var picking = false
    @State private var source: KnowledgeImportSource?
    @State private var pasted = ""
    @State private var target = "household"
    @State private var update = true
    @State private var preview: KnowledgeImportPreview?
    @State private var picked: Set<Int> = []
    @State private var busy = false
    @State private var error: String?
    @State private var askConsent = false

    static var types: [UTType] {
        [UTType(filenameExtension: "md"), UTType("net.daringfireball.markdown"), .plainText, .commaSeparatedText, .tabSeparatedText, .json, .text].compactMap { $0 }
    }

    private var current: KnowledgeImportSource? {
        if let source { return source }
        let t = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.count >= 2 ? KnowledgeImportSource(text: pasted) : nil
    }

    var body: some View {
        NavigationStack {
            Group {
                if let preview { previewList(preview) } else { form }
            }
            .navigationTitle(L("Import"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if preview != nil { Button(L("Back")) { preview = nil } } else { Button(L("Cancel")) { dismiss() } }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if preview != nil {
                        Button(LF("Take over %lld", picked.count)) { Task { await apply(consent: false) } }
                            .disabled(busy || picked.isEmpty)
                    } else {
                        Button(L("Show preview")) { Task { await showPreview() } }
                            .disabled(busy || current == nil)
                    }
                }
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: Self.types, allowsMultipleSelection: false) { result in
                guard case let .success(urls) = result, let url = urls.first else { return }
                do {
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    let data = try Data(contentsOf: url)
                    guard data.count <= APIClient.knowledgeImportMaxBytes else {
                        error = LF("The file is too big (at most %lld KB).", APIClient.knowledgeImportMaxBytes / 1024)
                        return
                    }
                    source = KnowledgeImportSource(filename: url.lastPathComponent, data: data)
                    error = nil
                } catch { self.error = error.localizedDescription }
            }
            .alert(L("Save health information?"), isPresented: $askConsent) {
                Button(L("Not now"), role: .cancel) {}
                Button(L("Save")) { Task { await apply(consent: true) } }
            } message: {
                Text(L("Allergies are health data. ToHuus stores them encrypted in your household and only uses them for warnings on recipes. They only go to the assistant if you allow that in the settings."))
            }
            .overlay { if busy { ProgressView() } }
            .task {
                guard let initialSource, source == nil, preview == nil else { return }
                source = initialSource
                await showPreview()
            }
        }
    }

    private var form: some View {
        Form {
            // pasting comes first – most notes live in Notes, a mail or a few cells (Till 18 Oct 2026); a file second
            Section {
                Text(L("Paste text, from Notes, an e-mail or cells from Excel or Numbers. Or choose a file (CSV, text, Markdown). You see everything before it is saved."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if source == nil {
                Section(L("Paste text")) {
                    TextEditor(text: $pasted)
                        .font(.system(.footnote, design: .monospaced))
                        .frame(minHeight: 120)
                        .accessibilityLabel(L("Paste text"))
                }
            }
            Section {
                Button { picking = true } label: {
                    Label(source?.filename ?? L("Choose file"), systemImage: source == nil ? "doc.badge.plus" : "doc.text")
                }
                if source != nil {
                    Button(L("Remove file"), role: .destructive) { source = nil }
                }
            } header: { Text(source == nil ? L("Or choose a file") : L("File")) } footer: {
                Text(L("Exports from Obsidian or Notion (Markdown) work too."))
            }
            Section {
                Picker(L("Who sees the new entries?"), selection: $target) {
                    Text(L("Whole household")).tag("household")
                    Text(L("Only me")).tag("me")
                }
                Toggle(L("Update values that are already there"), isOn: $update)
            } footer: { Text(L("Health things stay private. Codes and passwords are left out.")) }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
    }

    private func previewList(_ p: KnowledgeImportPreview) -> some View {
        List {
            Section {
                Text(LF("%lld new, %lld changed, %lld already there", p.counts.create, p.counts.update, p.counts.skip)).font(.headline)
                if p.counts.blocked > 0 { Text(LF("%lld left out", p.counts.blocked)).foregroundStyle(Theme.ink2) }
                if p.truncated == true { Text(LF("Only the first %lld entries are read.", p.items.count)).font(.caption).foregroundStyle(Theme.ink3) }
                if p.items.isEmpty { Text(L("ToHuus found nothing to take over in it.")).foregroundStyle(Theme.ink2) }
            }
            Section {
                ForEach(p.items) { x in
                    Button {
                        guard x.canTake else { return }
                        if picked.contains(x.i) { picked.remove(x.i) } else { picked.insert(x.i) }
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Image(systemName: x.canTake ? (picked.contains(x.i) ? "checkmark.circle.fill" : "circle") : "minus.circle")
                                .foregroundStyle(x.canTake ? Theme.primary : Theme.ink3)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(x.shown).foregroundStyle(x.canTake ? Theme.ink : Theme.ink3)
                                if let n = x.note { Text(n).font(.caption).foregroundStyle(Theme.ink3) }
                                Text(reason(x)).font(.caption).foregroundStyle(x.action == "create" ? Theme.primary : Theme.ink2)
                            }
                            Spacer(minLength: 0)
                            if x.visibility == "me" { Image(systemName: "lock").foregroundStyle(Theme.ink3).accessibilityLabel(L("Only for you")) }
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(x.canTake && picked.contains(x.i) ? .isSelected : [])
                }
            }
        }
        .themedList()
    }

    private func reason(_ x: KnowledgeImportItem) -> String {
        switch x.action {
        case "create": return L("new")
        case "update": return LF("%@ → %@", x.before ?? "", x.value ?? "")
        default:
            switch x.reason {
            case "unchanged": return L("already there")
            case "exists": return L("already there, stays as it is")
            case "twice": return L("twice in the file")
            case "secret": return L("codes belong in House info")
            case "limit": return L("no room left")
            case "health": return L("health, only in the app")
            default: return ""
            }
        }
    }

    private func showPreview() async {
        guard let src = current else { return }
        busy = true
        defer { busy = false }
        do {
            let p = try await api.knowledgeImportPreview(src, target: target, update: update)
            picked = Set(p.items.filter(\.canTake).map(\.i))
            preview = p
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func apply(consent: Bool) async {
        guard let src = current else { return }
        busy = true
        defer { busy = false }
        do {
            switch try await api.knowledgeImport(src, target: target, update: update, pick: Array(picked).sorted(), consent: consent) {
            case .needsConsent: askConsent = true
            case let .done(r):
                Haptics.success()
                onDone(LF("Taken over: %lld new, %lld updated.", r.created, r.updated), r.undo)
                dismiss()
            }
        } catch { self.error = APIError.from(error).localizedDescription; preview = nil }
    }
}

struct KnowledgeExportSheet: View {
    let api: APIClient
    var total: Int
    /// what the search shows right now (nil: everything is shown)
    var shownIds: [Int]?
    /// the screen shows one person's or place's cards: export only those
    var onlyThese = false
    @Environment(\.dismiss) private var dismiss
    @State private var format = "md"
    @State private var onlyShown = false
    @State private var file: URL?
    @State private var busy = false
    @State private var error: String?

    private var partial: Bool { !onlyThese && (shownIds?.count ?? 0) > 0 && (shownIds?.count ?? 0) < total }
    private var hint: String {
        switch format {
        case "csv": return L("For Excel or Numbers.")
        case "json": return L("Everything incl. earlier values. To move or import again.")
        default: return L("Easy to read, grouped by topic. Opens in any notes app.")
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(L("Format"), selection: $format) {
                        Text("Markdown").tag("md")
                        Text("CSV").tag("csv")
                        Text("JSON").tag("json")
                    }
                    .pickerStyle(.segmented)
                    Text(hint).font(.caption).foregroundStyle(Theme.ink2)
                    if partial {
                        Picker(L("What"), selection: $onlyShown) {
                            Text(LF("Everything (%lld)", total)).tag(false)
                            Text(LF("What is shown (%lld)", shownIds?.count ?? 0)).tag(true)
                        }
                    }
                } footer: { Text(L("Only what you can see. Private entries of the others never.")) }
                Section {
                    if let file {
                        ShareLink(item: file) { Label(L("Share or save to Files"), systemImage: "square.and.arrow.up") }
                    } else {
                        Button { Task { await make() } } label: {
                            HStack { Label(L("Create file"), systemImage: "doc.badge.arrow.up"); if busy { Spacer(); ProgressView() } }
                        }
                        .disabled(busy || total == 0)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .navigationTitle(L("Export"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Done")) { dismiss() } } }
            .onChange(of: format) { _, _ in file = nil }
            .onChange(of: onlyShown) { _, _ in file = nil }
        }
    }

    private func make() async {
        busy = true
        defer { busy = false }
        do {
            file = try await api.knowledgeExport(format: format, ids: onlyThese || (partial && onlyShown) ? shownIds : nil)
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
