import SwiftUI

/// "Mitversorgen": before a visit, walk through what usually goes to them – "da" or "fehlt" – and put what's missing on
/// their list in one go (web: shop/forms.tsx CareCheckSheet; GET /api/care/:id/check, POST /api/care/:id/missing).
struct CareCheckSheet: View {
    let list: ListRef
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var check: CareCheck?
    @State private var spent: CareSpent?
    @State private var missing: Set<String> = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let note = list.note, !note.isEmpty {
                    Section {
                        Label(note, systemImage: "note.text").font(.subheadline)
                    } header: {
                        Text(L("Handover"))
                    }
                }
                if let s = spent, (s.lines ?? 0) > 0, let total = s.total {
                    Text(LF("Spent for them this month: %@", Money.format(total)))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                }
                if let check {
                    if check.items.isEmpty {
                        Text(L("As soon as things were on this list, they show up here for the next check."))
                            .foregroundStyle(Theme.ink3)
                    }
                    Section {
                        ForEach(check.items) { i in row(i) }
                    } footer: {
                        if !check.items.isEmpty { Text(L("Everything is “there” until you mark it missing.")) }
                    }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity)
                }
                if let error { Text(error).foregroundStyle(Theme.empty) }
            }
            .themedList()
            .navigationTitle(LF("Fridge check for %@", list.name))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    Task { await save() }
                } label: {
                    Text(missing.count == 1 ? L("Put 1 missing thing on the list") : LF("Put %d missing things on the list", missing.count))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(missing.isEmpty || busy)
                .padding(.horizontal).padding(.bottom, 8)
                .background(.bar)
            }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    private func row(_ i: CareCheck.Item) -> some View {
        let miss = missing.contains(i.text)
        return HStack(spacing: Theme.Space.s3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(i.text)
                if i.onList == true {
                    Text(L("already on the list")).font(.caption).foregroundStyle(Theme.ink3)
                } else if let n = i.times, n > 1 {
                    Text(LF("%d times on this list", n)).font(.caption).foregroundStyle(Theme.ink3)
                }
            }
            Spacer(minLength: 0)
            Picker(i.text, selection: Binding(get: { miss }, set: { m in
                Haptics.tick()
                if m { missing.insert(i.text) } else { missing.remove(i.text) }
            })) {
                Text(L("there")).tag(false)
                Text(L("missing")).tag(true)
            }
            .pickerStyle(.segmented)
            .frame(width: 170)
            .disabled(i.onList == true)
        }
        .frame(minHeight: 44)
    }

    private func load() async {
        guard let id = list.id.int else { return }
        do {
            check = try await store.api.careCheck(listId: id)
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
        spent = try? await store.api.careSpent(listId: id)
    }

    private func save() async {
        guard let id = list.id.int else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await store.api.careMissing(listId: id, names: Array(missing))
            Haptics.success()
            store.touch("shopping")
            await store.refreshList()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
