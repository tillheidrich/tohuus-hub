import SwiftUI

/// "Was ToHuus sich merkt" (GET/POST/DELETE /api/memory): things the household asked ToHuus to remember.
/// Everyone can add a line or forget one; "nur für mich" stays with the author. Health notes need a confirmation once.
struct MemoryView: View {
    let api: APIClient
    @State private var rows: [MemoryRow]?
    @State private var text = ""
    @State private var onlyMe = false
    @State private var busy = false
    @State private var askConsent = false
    @State private var error: String?
    @State private var toast: ToastMessage?

    var body: some View {
        List {
            Section {
                Text(L("Things you asked ToHuus to remember – for example “we don’t eat pork” or “Mira shops on Saturdays”. Delete anything at any time."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            Section {
                TextField(L("e.g. We shop at Aldi on Saturdays"), text: $text, axis: .vertical)
                    .lineLimit(1...3)
                    .submitLabel(.done)
                Toggle(L("Only for me – the others don’t see it"), isOn: $onlyMe)
                Button {
                    Task { await add(consent: false) }
                } label: {
                    HStack { Label(L("Remember"), systemImage: "plus"); if busy { Spacer(); ProgressView() } }
                }
                .disabled(busy || text.trimmingCharacters(in: .whitespaces).count < 2)
            } header: { Text(L("Remember something new")) }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            if let rows {
                if rows.isEmpty {
                    EmptyStateView(art: .book, title: L("Nothing yet"), message: L("Tell the assistant “remember that …” or add a line above."))
                        .listRowBackground(Color.clear)
                } else {
                    Section {
                        ForEach(rows) { m in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(m.text).font(.body).foregroundStyle(Theme.ink)
                                Text(meta(m)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                            .padding(.vertical, 2)
                            .swipeActions {
                                Button(role: .destructive) { Task { await forget(m) } } label: { Label(L("Forget"), systemImage: "trash") }
                            }
                            .accessibilityAction(named: L("Forget")) { Task { await forget(m) } }
                        }
                    } footer: { Text(L("Swipe to forget a line.")) }
                }
            } else {
                HStack { Spacer(); ProgressView(); Spacer() }
            }
        }
        .themedList()
        .navigationTitle(L("What ToHuus remembers"))
        .task { await load() }
        .refreshable { await load() }
        .alert(L("Save health information?"), isPresented: $askConsent) {
            Button(L("Not now"), role: .cancel) {}
            Button(L("Save")) { Task { await add(consent: true) } }
        } message: {
            Text(L("Allergies are health data. ToHuus stores them encrypted in your household and only uses them for warnings on recipes. They only go to the assistant if you allow that in the settings."))
        }
        .toast($toast)
    }

    private func meta(_ m: MemoryRow) -> String {
        [m.kindLabel, m.onlyMe == true ? L("only for me") : nil, m.sensitive == true ? L("sensitive – stays with you unless allowed") : nil,
         m.createdBy, ServerDate.relative(m.createdAt)].compactMap { $0 }.joined(separator: " · ")
    }

    private func load() async {
        do { rows = try await api.memory(); error = nil }
        catch { self.error = APIError.from(error).localizedDescription; if rows == nil { rows = [] } }
    }

    private func add(consent: Bool) async {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard t.count >= 2 else { return }
        busy = true
        defer { busy = false }
        do {
            switch try await api.remember(t, onlyMe: onlyMe, consent: consent) {
            case .saved:
                text = ""
                Haptics.success()
                await load()
            case .needsConsent:
                askConsent = true
            }
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func forget(_ m: MemoryRow) async {
        do {
            try await api.forget(m.id)
            rows?.removeAll { $0.id == m.id }
            toast = ToastMessage(text: LF("Forgotten: %@", m.text), actionTitle: L("Undo")) {
                Task {
                    _ = try? await api.remember(m.text, kind: m.kind, person: m.person, onlyMe: m.onlyMe == true, consent: true)
                    await load()
                }
            }
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}
