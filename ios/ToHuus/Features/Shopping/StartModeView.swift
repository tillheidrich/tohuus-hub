import SwiftUI

/// Settings › Household: "Was soll mitgezählt werden?" – everything, or only what runs out (the start mode).
/// Switching never deletes anything (web: pages/Share.tsx StartModeCard + StaplesPicker; GET/PUT /api/share/start-mode,
/// GET/PUT /api/share/staples). Only admins switch the mode; everybody may pick what runs out.
struct StartModeView: View {
    let api: APIClient
    let isAdmin: Bool
    @State private var info: StartModeInfo?
    @State private var picker = false
    /// switching to the start mode with nothing picked yet: pick first, the mode follows on save
    @State private var switching = false
    @State private var error: String?
    @State private var toast: ToastMessage?

    var body: some View {
        Form {
            Section {
                if let info {
                    Picker(L("What should be tracked?"), selection: Binding(get: { info.mode ?? "full" }, set: { m in Task { await setMode(m) } })) {
                        Text(L("Only what runs out")).tag("staples")
                        Text(L("Everything")).tag("full")
                    }
                    .pickerStyle(.segmented)
                    .disabled(!isAdmin)
                    Text(info.isStaples
                         ? LF("%d things are tracked. Everything else is simply not counted and never warned about.", info.staples ?? 0)
                         : L("Everything in stock is tracked, with warnings when it runs low or should be used."))
                        .font(.footnote).foregroundStyle(Theme.ink2)
                    Button { switching = false; picker = true } label: {
                        Label(L("Choose what runs out"), systemImage: "checklist")
                    }
                } else if error == nil {
                    ProgressView()
                }
            } header: {
                Text(L("What should be tracked?"))
            } footer: {
                Text(isAdmin ? L("Starting small helps: track only the things that regularly run out. You can switch to everything at any time – nothing is deleted.")
                     : L("Only admins can change this."))
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(L("What should be tracked?"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $picker) {
            NavigationStack {
                StaplesPickerView(api: api, switchMode: isAdmin && switching) { count in
                    picker = false
                    switching = false
                    toast = ToastMessage(text: count == 1 ? L("1 thing is tracked") : LF("%d things are tracked", count))
                    Task { await load() }
                }
            }
        }
        .toast($toast)
    }

    private func load() async {
        do { info = try await api.startMode(); error = nil } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func setMode(_ mode: String) async {
        guard isAdmin, mode != info?.mode else { return }
        if mode == "staples" && (info?.staples ?? 0) == 0 {
            switching = true
            picker = true
            return
        }
        do {
            info = try await api.setStartMode(mode)
            Haptics.success()
            toast = ToastMessage(text: mode == "full" ? L("Everything is tracked again – nothing was lost") : L("Only what runs out is tracked now"))
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// "Was geht bei euch regelmäßig aus?" – tap what regularly runs out; only these are tracked.
struct StaplesPickerView: View {
    let api: APIClient
    var switchMode = false
    let onSaved: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var data: StaplesPicker?
    @State private var keys: Set<String> = []
    @State private var ids: Set<Int> = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        List {
            Section {
                Text(L("Tap what regularly runs out at your place. Only these are tracked – no counting, no warnings for anything else. We assume you have them now; tap “low” when one runs low and it lands on the shopping list."))
                    .font(.footnote).foregroundStyle(Theme.ink2)
            }
            if let data {
                if !data.suggestions.isEmpty {
                    Section(L("Bought more than once")) {
                        chips(data.suggestions.map { p in (p.name, ids.contains(p.id), { toggle(id: p.id) }) })
                    }
                }
                if !data.own.isEmpty {
                    Section(L("Your own")) {
                        chips(data.own.map { p in (p.name, ids.contains(p.id), { toggle(id: p.id) }) })
                    }
                }
                ForEach(data.groups) { g in
                    Section(g.label) {
                        chips(g.items.map { i in (i.name, keys.contains(i.key), { toggle(key: i.key) }) })
                    }
                }
                Section {
                    Text(L("Missing something? Mark any product as “runs out regularly” on its page – Today also suggests what you bought more than once."))
                        .font(.footnote).foregroundStyle(Theme.ink3)
                }
            } else if error == nil {
                ProgressView().frame(maxWidth: .infinity)
            }
            if let error { Text(error).foregroundStyle(Theme.empty) }
        }
        .themedList()
        .navigationTitle(L("What runs out at your place?"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button(L("Save")) { Task { await save() } }.disabled(busy || keys.count + ids.count == 0)
            }
        }
        .safeAreaInset(edge: .bottom) {
            Text(keys.count + ids.count == 1 ? L("Track this 1 thing") : LF("Track these %d things", keys.count + ids.count))
                .font(.footnote).foregroundStyle(Theme.ink2)
                .frame(maxWidth: .infinity).padding(8).background(.bar)
        }
        .task { await load() }
    }

    private func chips(_ items: [(String, Bool, () -> Void)]) -> some View {
        ShopChipFlow {
            ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                ShopToggleChip(title: it.0, systemImage: it.1 ? "checkmark" : "plus", on: it.1, action: it.2)
            }
        }
        .padding(.vertical, 4)
    }

    private func toggle(key: String) {
        Haptics.tick()
        if keys.contains(key) { keys.remove(key) } else { keys.insert(key) }
    }

    private func toggle(id: Int) {
        Haptics.tick()
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
    }

    private func load() async {
        do {
            let d = try await api.staplesPicker()
            data = d
            keys = Set(d.groups.flatMap { $0.items.filter { $0.on == true }.map(\.key) })
            ids = Set(d.own.map(\.id))
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            let n = try await api.saveStaples(keys: Array(keys), productIds: Array(ids), mode: switchMode ? "staples" : nil)
            Haptics.success()
            onSaved(n)
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
