import SwiftUI

/// "Weitere Liste" (web: shop/fill.tsx NewListSheet): one-tap presets, a name, "I shop this for someone else" (a care
/// list with its own section in the shop and a handover note) and who sees it. The new list is shown right away.
struct NewListSheet: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var care = false
    @State private var visibility = "household"
    @State private var shareWith: [Int] = []
    @State private var members: [Member] = []
    @State private var me: MeLite?
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private static let presets: [(String, String, String)] = [
        (L("DIY store"), "store", "hammer"),
        (L("Drugstore"), "store", "drop"),
        (L("Presents"), "gifts", "gift"),
        (L("For Grandma"), "care", "heart"),
    ]

    private var canHide: Bool { me?.isMember == true }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ShopChipFlow {
                        ForEach(Array(Self.presets.enumerated()), id: \.offset) { _, p in
                            ShopToggleChip(title: p.0, systemImage: p.2, on: false) {
                                Task { await create(p.0, kind: p.1) }
                            }
                        }
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text(L("Quick start"))
                }
                Section {
                    TextField(L("Name, e.g. Garden centre"), text: $name)
                        .focused($focused)
                        .submitLabel(.done)
                        .onSubmit { Task { await create(name, kind: care ? "care" : "other") } }
                    Toggle(isOn: $care) {
                        Text(L("I shop this for someone else (own section in the store, handover note)"))
                            .font(.subheadline)
                    }
                } footer: {
                    Text(L("Each list keeps its own items. Nothing moves between lists unless you move it."))
                }
                if canHide {
                    Section(L("Who sees it?")) {
                        VisibilityPicker(visibility: $visibility, shareWith: $shareWith, members: members, meId: me?.userId)
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Another list"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Create list")) { Task { await create(name, kind: care ? "care" : "other") } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task {
                me = try? await store.api.meLite()
                members = (try? await store.api.members()) ?? []
                focused = true
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func create(_ raw: String, kind: String) async {
        let n = String(raw.trimmingCharacters(in: .whitespaces).prefix(60))
        guard !n.isEmpty, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let made = try await store.api.createShopList(name: n, kind: kind, visibility: canHide ? visibility : nil, shareWith: shareWith)
            Haptics.success()
            if let id = made { await store.setList(id) } else { await store.refreshList() }
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
