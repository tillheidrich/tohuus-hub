import SwiftUI
import WatchKit

/// The list on the wrist: sorted by the chosen shop, tick with a tap (undo for a few seconds), "Sprechen" on top.
struct WatchListView: View {
    @Environment(WatchStore.self) private var store

    var body: some View {
        List {
            if !store.signedIn {
                Text(L("Open ToHuus on your iPhone once – the watch takes the sign-in from there."))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                speakRow
                if let reply = store.reply {
                    Text(reply).font(.footnote).foregroundStyle(.secondary)
                        .onTapGesture { store.reply = nil }
                }
                if store.list.openItems.isEmpty {
                    Label(L("Nothing missing right now."), systemImage: "checkmark.circle")
                        .foregroundStyle(.secondary)
                }
                ForEach(store.list.sections) { section in
                    Section(ShopSectionKey.label(section.key)) {
                        ForEach(section.items) { item in row(item) }
                    }
                }
                if !store.list.basket.isEmpty || !store.list.done.isEmpty {
                    Section(L("Done")) {
                        ForEach((store.list.basket + store.list.done).prefix(6)) { item in row(item) }
                    }
                }
                statusRow
            }
        }
        .navigationTitle(L("Shopping"))
        .toolbar {
            if store.signedIn && store.api != nil && !store.list.stores.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink {
                        StorePicker()
                    } label: {
                        Image(systemName: "storefront")
                    }
                    .accessibilityLabel(L("Sort by shop"))
                }
            }
        }
        .overlay(alignment: .bottom) { undoBar }
        .refreshable { await store.refresh() }
    }

    private var speakRow: some View {
        TextFieldLink(prompt: Text(L("e.g. 2 milk and bread"))) {
            Label(L("Speak"), systemImage: "mic.fill")
                .foregroundStyle(Color("AccentColor"))
        } onSubmit: { text in
            Task { await store.say(text) }
        }
        .disabled(store.busy)
    }

    private func row(_ item: ShopItem) -> some View {
        Button {
            WKHaptic.tick()
            store.toggle(item)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: item.isChecked ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(item.isChecked ? Color("AccentColor") : .secondary)
                VStack(alignment: .leading, spacing: 1) {
                    Text([item.qtyLabel, item.productName ?? item.text].compactMap { $0 }.joined(separator: " "))
                        .strikethrough(item.isChecked)
                        .foregroundStyle(item.isChecked ? .secondary : .primary)
                    if let note = item.note, !note.isEmpty, item.source != "recipe" {
                        Text(note).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .accessibilityValue(item.isChecked ? L("done") : L("open"))
    }

    @ViewBuilder private var statusRow: some View {
        if store.pendingCount > 0 {
            Label(LF("%d changes wait for the iPhone or Wi-Fi", store.pendingCount), systemImage: "arrow.triangle.2.circlepath")
                .font(.caption2)
                .foregroundStyle(.secondary)
        } else if let at = store.lastUpdate {
            Text(at.formatted(date: .omitted, time: .shortened))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var undoBar: some View {
        if let item = store.undoItem {
            Button {
                store.undo()
            } label: {
                Label(LF("Undo “%@”", item.productName ?? item.text), systemImage: "arrow.uturn.backward")
                    .lineLimit(1)
                    .font(.footnote)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 4)
            .task(id: item.id) {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                if store.undoItem?.id == item.id { store.undoItem = nil }
            }
        }
    }
}

struct StorePicker: View {
    @Environment(WatchStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List {
            Button {
                store.storeId = nil
                dismiss()
            } label: {
                Label(L("No particular shop"), systemImage: store.storeId == nil ? "checkmark" : "cart")
            }
            ForEach(store.list.stores) { s in
                Button {
                    store.storeId = s.id
                    dismiss()
                } label: {
                    Label(s.name, systemImage: store.storeId == s.id ? "checkmark" : "storefront")
                }
            }
        }
        .navigationTitle(L("Sort by shop"))
    }
}

enum WKHaptic {
    @MainActor static func tick() { WKInterfaceDevice.current().play(.click) }
}
