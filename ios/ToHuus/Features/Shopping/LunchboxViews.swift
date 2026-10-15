import SwiftUI

/// On the list (main list, not in the shop): "Brotdose für die Woche – auf die Liste?" on its weekday, with a holiday
/// pause (web: shop/forms.tsx LunchboxSuggestion). Shows nothing when nothing is due.
struct LunchboxSuggestionSection: View {
    let store: ServerStore
    var onAdded: (Int) -> Void = { _ in }
    @State private var box: Lunchbox?
    @State private var pausing = false
    @State private var until = Calendar.current.date(byAdding: .day, value: 14, to: Date()) ?? Date()
    @State private var busy = false

    var body: some View {
        Group {
            if let due = box?.due, !(due.items ?? []).isEmpty {
                Section {
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Lunchbox for the week")).font(.subheadline.weight(.semibold))
                                Text((due.items ?? []).joined(separator: ", ")).font(.caption).foregroundStyle(Theme.ink2)
                            }
                        } icon: {
                            Image(systemName: "takeoutbag.and.cup.and.straw").foregroundStyle(Theme.primaryText)
                        }
                        if pausing {
                            DatePicker(L("Holidays until"), selection: $until, in: Date()..., displayedComponents: .date)
                                .font(.subheadline)
                        }
                        HStack {
                            Button(L("Put on the list")) { Task { await add() } }
                                .buttonStyle(.borderedProminent)
                                .disabled(busy)
                            if pausing {
                                Button(L("Pause")) { Task { await pause() } }.buttonStyle(.bordered)
                            } else {
                                Button { pausing = true } label: { Label(L("Holidays"), systemImage: "sun.horizon") }
                                    .buttonStyle(.bordered)
                            }
                        }
                        .controlSize(.small)
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(Theme.primarySoft)
            }
        }
        .task(id: store.revision("shopping")) {
            box = try? await store.api.lunchbox()
        }
    }

    private func add() async {
        busy = true
        defer { busy = false }
        do {
            let n = try await store.api.addLunchbox()
            Haptics.success()
            onAdded(n)
            box = try? await store.api.lunchbox()
            store.touch("shopping")
            await store.refreshList()
        } catch {}
    }

    private func pause() async {
        try? await store.api.setLunchbox(pausedUntil: .some(ServerDate.day(until)))
        pausing = false
        box = try? await store.api.lunchbox()
    }
}

/// Settings › Household (families): what goes into the lunchbox each week (web: shop/forms.tsx LunchboxCard).
struct LunchboxSettingsView: View {
    let api: APIClient
    @State private var box: Lunchbox?
    @State private var items = ""
    @State private var error: String?

    var body: some View {
        Form {
            if let box {
                Section {
                    Toggle(L("Lunchbox regulars"), isOn: Binding(get: { box.enabled ?? false }, set: { v in save { try await api.setLunchbox(enabled: v) } }))
                } footer: {
                    Text(L("Once a week as a suggestion for the list – paused in the holidays."))
                }
                if box.enabled == true {
                    Section {
                        TextField(L("e.g. apples, cucumber, wholemeal bread"), text: $items, axis: .vertical)
                            .lineLimit(1...4)
                            .onSubmit(saveItems)
                        Picker(L("Suggest on"), selection: Binding(get: { box.weekday ?? 0 }, set: { v in save { try await api.setLunchbox(weekday: v) } })) {
                            ForEach(0..<7, id: \.self) { i in Text(Calendar.current.weekdaySymbols[i]).tag(i) }
                        }
                    } header: {
                        Text(L("What goes in"))
                    } footer: {
                        Text(L("Separate with commas."))
                    }
                    Section {
                        if let p = box.pausedUntil {
                            LabeledContent(L("Paused until"), value: ServerDate.shortDay(p) ?? p)
                            Button(L("Resume")) { save { try await api.setLunchbox(pausedUntil: .some(nil)) } }
                        } else {
                            Text(L("Not paused")).foregroundStyle(Theme.ink3)
                        }
                    } header: {
                        Text(L("Holidays"))
                    }
                }
            } else if error == nil {
                ProgressView()
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(L("Lunchbox regulars"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onDisappear(perform: saveItems)
    }

    private func load() async {
        do {
            let b = try await api.lunchbox()
            box = b
            items = (b.items ?? []).joined(separator: ", ")
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func saveItems() {
        let list = items.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard box != nil, list != (box?.items ?? []) else { return }
        save { try await api.setLunchbox(items: list) }
    }

    private func save(_ change: @escaping @MainActor () async throws -> Void) {
        Task {
            do {
                try await change()
                Haptics.tick()
                await load()
            } catch { self.error = APIError.from(error).localizedDescription }
        }
    }
}

/// Settings row: "Brotdosen-Klassiker" – only for families (web: shown on Settings › Household when form = family).
struct LunchboxSettingsLink: View {
    let api: APIClient
    @State private var family = false

    var body: some View {
        Group {
            if family {
                NavigationLink { LunchboxSettingsView(api: api) } label: {
                    Label(L("Lunchbox regulars"), systemImage: "takeoutbag.and.cup.and.straw")
                }
            }
        }
        .task {
            let me = try? await api.meLite()
            family = me?.home?["form"]?.string == "family" && me?.isMember == true
        }
    }
}
