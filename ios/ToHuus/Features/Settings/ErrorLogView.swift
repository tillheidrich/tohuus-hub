import SwiftUI

/// Settings › Hilfe › Fehlerprotokoll: what went wrong on this device (ErrorLog.swift) – to look at, to share as a
/// text file with the developer, or to send again. No list or receipt content is in it.
struct ErrorLogView: View {
    @State private var entries: [ErrorLog.Entry] = []
    @State private var text = ""
    @State private var confirmClear = false

    var body: some View {
        List {
            Section {
                Text(L("If something does not work, the app notes it here and sends it to the ToHuus team – without your lists, receipts or messages. You can also share the list yourself."))
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
            if entries.isEmpty {
                Section { Text(L("Nothing went wrong lately.")).foregroundStyle(Theme.ink3) }
            } else {
                Section {
                    ForEach(entries) { e in
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(e.at.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(Theme.ink3)
                                if let s = e.status { Text("\(s)").font(.caption.monospacedDigit()).foregroundStyle(Theme.ink3) }
                                Spacer()
                                if e.sent { Image(systemName: "checkmark.icloud").font(.caption).foregroundStyle(Theme.ink3).accessibilityLabel(L("Sent")) }
                            }
                            Text(e.message).font(.footnote)
                            if let r = e.route { Text(r).font(.caption2.monospaced()).foregroundStyle(Theme.ink3) }
                        }
                    }
                }
            }
            Section {
                ShareLink(item: text, subject: Text(L("ToHuus – error log"))) {
                    Label(L("Share error log"), systemImage: "square.and.arrow.up")
                }
                .disabled(entries.isEmpty)
                Button { Task { await ErrorLog.shared.flush(); await load() } } label: {
                    Label(L("Send to the ToHuus team again"), systemImage: "paperplane")
                }
                .disabled(entries.isEmpty)
                Button(L("Clear"), role: .destructive) { confirmClear = true }.disabled(entries.isEmpty)
            }
        }
        .navigationTitle(L("Error log"))
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog(L("Clear the error log on this device?"), isPresented: $confirmClear, titleVisibility: .visible) {
            Button(L("Clear"), role: .destructive) { Task { await ErrorLog.shared.clear(); await load() } }
        }
    }

    private func load() async {
        entries = await ErrorLog.shared.all()
        text = await ErrorLog.shared.text()
    }
}
