import SwiftUI
import UniformTypeIdentifiers

/// "Aus einer anderen App übernehmen" (web: shop/bridges.tsx ImportListSheet): Bring!, AnyList, Notes or WhatsApp as
/// shared text, Google Keep's Takeout file, a CSV or JSON export. First a preview (dry run), then "Add n items".
/// POST /api/list/import (multipart text | file, list_id, dry_run). Ticked items of the old app stay out.
struct ImportListSheet: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var file: (data: Data, name: String)?
    @State private var rows: [ListImportPreview.Row]?
    @State private var skipped = 0
    @State private var picking = false
    @State private var busy = false
    @State private var error: String?

    private var listId: Int { store.list.listId?.int ?? 0 }
    private var ready: Bool { file != nil || !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                if let rows {
                    Section {
                        if rows.isEmpty { Text(L("No open items found.")).foregroundStyle(Theme.ink3) }
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                if let q = r.qty, q != 1 {
                                    Text(q.rounded() == q ? "\(Int(q))×" : "\(q)×").foregroundStyle(Theme.primaryText).fontWeight(.semibold)
                                }
                                Text(r.name)
                                if let n = r.note, !n.isEmpty { Text(n).foregroundStyle(Theme.ink3) }
                            }
                        }
                    } header: {
                        Text(L("This comes over"))
                    } footer: {
                        if skipped > 0 { Text(LF("%d ticked items stay out.", skipped)) }
                    }
                } else {
                    Section {
                        PasteButton(payloadType: String.self) { strings in
                            guard let s = strings.first else { return }
                            Task { @MainActor in
                                file = nil
                                text = s
                            }
                        }
                        .buttonBorderShape(.capsule)
                        .labelStyle(.titleAndIcon)
                        TextField(L("Paste the list here …"), text: $text, axis: .vertical)
                            .lineLimit(4...10)
                            .disabled(file != nil)
                    } footer: {
                        Text(L("Bring!, AnyList, Notes, WhatsApp: share the list as text and paste it here. Google Keep: the Takeout file of the note. Ticked items stay out."))
                    }
                    Section {
                        Button { picking = true } label: {
                            Label(file?.name ?? L("Choose a file (JSON, CSV, TXT)"), systemImage: "doc.badge.plus")
                        }
                        if file != nil {
                            Button(L("Remove"), role: .destructive) { file = nil }
                        }
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Take over a list from another app"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if rows != nil {
                        Button(L("Back")) { rows = nil }
                    } else {
                        Button(L("Cancel")) { dismiss() }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if let rows {
                        Button(rows.count == 1 ? L("Add 1 item") : LF("Add %d items", rows.count)) { Task { await send(dry: false) } }
                            .disabled(busy || rows.isEmpty)
                    } else {
                        Button(L("Show what comes over")) { Task { await send(dry: true) } }
                            .disabled(busy || !ready)
                    }
                }
            }
            .overlay { if busy { ProgressView() } }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.json, .commaSeparatedText, .plainText, .text]) { result in
                guard case .success(let url) = result else { return }
                let ok = url.startAccessingSecurityScopedResource()
                defer { if ok { url.stopAccessingSecurityScopedResource() } }
                if let data = try? Data(contentsOf: url), data.count <= 500_000 {
                    file = (data, url.lastPathComponent)
                    error = nil
                } else {
                    error = L("File too large")
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func send(dry: Bool) async {
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.importList(text: file == nil ? text : nil, file: file, listId: listId, dryRun: dry)
            error = nil
            if dry {
                rows = r.items
                skipped = r.skippedChecked ?? 0
            } else {
                Haptics.success()
                store.touch("shopping")
                await store.refreshList()
                dismiss()
            }
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
