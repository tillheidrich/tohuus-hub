import SwiftUI

// Extras im Wocheneinkauf (server: lib/extras.ts, docs/extras.md, web: shop/extras.tsx): a weekly allowance for
// treats and little luxuries. Quiet, never red, never blocking.

/// GET /api/list/extras
struct ExtrasWeek: Decodable, Sendable, Equatable {
    var on: Bool
    var mode: String?
    var weekly: Double?
    var from: String?
    var to: String?
    var used: Double
    var planned: Double
    var left: Double?
    var over: Bool?
    var unpriced: Int?
    @Lossy var items: [Item]

    struct Item: Decodable, Sendable, Equatable, Identifiable {
        var id: Int
        var text: String
        var qty: Double?
        var done: Bool?
    }

    var isMoney: Bool { mode == "money" }

    func amount(_ n: Double) -> String {
        isMoney ? Money.format(n) : (n.rounded() == n ? String(Int(n)) : String(format: "%.1f", n).replacingOccurrences(of: ".", with: ","))
    }

    /// "Extras diese Woche: 8 € von 15 €"
    var line: String {
        guard let weekly else { return "" }
        return LF("Extras this week: %@ of %@", amount(used + planned), amount(weekly))
    }
}

extension APIClient {
    func extrasWeek() async throws -> ExtrasWeek { try await get("api/list/extras") }
    func setExtrasAllowance(mode: String, weekly: Double) async throws -> ExtrasWeek {
        try await send("PUT", "api/list/extras/settings", json: ["mode": mode, "weekly": weekly], as: ExtrasWeek.self)
    }
    func extrasOff() async throws -> ExtrasWeek { try await send("PUT", "api/list/extras/settings", json: ["off": true], as: ExtrasWeek.self) }
    func setItemExtra(_ id: Int, extra: Bool?) async throws {
        let _: OkResponse = try await send("POST", "api/list/items/\(id)/extra", json: ["extra": extra.map { $0 as Any } ?? NSNull()], as: OkResponse.self)
    }
}

/// The bar on the list (web: ExtrasBar) – only when the household set an allowance.
struct ExtrasListSection: View {
    let api: APIClient
    /// changes whenever the list changes
    let refresh: Int
    @State private var week: ExtrasWeek?
    @State private var open = false
    @State private var loader = LoadTrigger()

    var body: some View {
        // loads from the body: in a List there is no invisible view to hang a .task on (Design/LoadSlot.swift)
        let _ = loader.run(id: refresh) { week = try? await api.extrasWeek() }
        if let w = week, w.on, let weekly = w.weekly, weekly > 0 {
            Section {
                Button {
                    withAnimation { open.toggle() }
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Label(w.line, systemImage: "sparkles").foregroundStyle(Theme.ink)
                            Spacer()
                            Text(w.over == true ? L("used up") : w.left.map { LF("%@ left", w.amount($0)) } ?? "")
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        meter(w, weekly: weekly)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityHint(L("Shows what counts as extra this week"))
                if open {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(w.isMoney ? LF("Bought: %@. Still on the list: about %@.", w.amount(w.used), w.amount(w.planned))
                                       : LF("Bought: %@. Still on the list: %@.", w.amount(w.used), w.amount(w.planned)))
                        if let n = w.unpriced, n > 0 { Text(LF("%d without a price yet.", n)) }
                        if !w.items.isEmpty { Text(w.items.map { ($0.done == true ? "✓ " : "") + $0.text }.joined(separator: " · ")) }
                        if w.over == true { Text(L("This week’s extras are used up. Nothing is blocked – you decide.")) }
                        Text(L("Mark a row as extra (or not) in its details."))
                    }
                    .font(.caption).foregroundStyle(Theme.ink3)
                }
            }
        }
    }

    private func meter(_ w: ExtrasWeek, weekly: Double) -> some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.line)
                Capsule().fill(Theme.primary.opacity(0.35)).frame(width: g.size.width * min(1, (w.used + w.planned) / weekly))
                Capsule().fill(Theme.primary).frame(width: g.size.width * min(1, w.used / weekly))
            }
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }
}

/// "Zählt als Extra" in the row details (web: ExtraToggle) – saved at once and remembered for the product.
struct ExtraToggleSection: View {
    let api: APIClient
    let item: ShopItem
    var onChange: () -> Void = {}
    @State private var extra: Bool?
    @State private var error: String?

    var body: some View {
        Section {
            Toggle(isOn: Binding(get: { extra ?? item.extra ?? false }, set: { v in Task { await save(v) } })) {
                Label(L("Counts as extra"), systemImage: "sparkles")
            }
            .tint(Theme.primary)
            if let error { Text(error).font(.caption).foregroundStyle(Theme.empty) }
        } header: {
            Text(L("Extras allowance"))
        } footer: {
            Text(L("Sweets, snacks, ice cream and drinks count by themselves. What you set here is remembered."))
        }
    }

    private func save(_ v: Bool) async {
        extra = v
        do {
            try await api.setItemExtra(item.id, extra: v)
            error = nil
            onChange()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// Mehr › Haushalt: the weekly allowance (web: ExtrasSettingsCard). Admins change it, everyone sees it.
struct ExtrasSettingsSection: View {
    let api: APIClient
    let admin: Bool
    @State private var week: ExtrasWeek?
    @State private var mode = "money"
    @State private var value = ""
    @State private var note: String?

    var body: some View {
        Section {
            if admin {
                Picker(L("Count in"), selection: $mode) {
                    Text(L("Money per week")).tag("money")
                    Text(L("Number of things per week")).tag("count")
                }
                .pickerStyle(.segmented)
                TextField(mode == "money" ? L("Amount per week") : L("Things per week"), text: $value)
                    .keyboardType(.decimalPad)
                Button(week?.on == true ? L("Save") : L("Switch on")) { Task { await save(on: true) } }
                if week?.on == true {
                    Button(L("Switch off"), role: .destructive) { Task { await save(on: false) } }
                }
            } else {
                Text(week?.on == true ? (week?.line ?? "") : L("Not set. An admin of the household can switch it on."))
            }
            if let note { Text(note).font(.caption).foregroundStyle(Theme.ink3) }
        } header: {
            Text(L("Extras in the weekly shop"))
        } footer: {
            Text(L("A weekly allowance for treats and little luxuries – sweets, snacks, ice cream, drinks, or whatever you mark. The list shows how much of it is used. It never blocks anything."))
        }
        .task { await load() }
    }

    private func load() async {
        guard let w = try? await api.extrasWeek() else { return }
        apply(w)
    }

    private func apply(_ w: ExtrasWeek) {
        week = w
        if w.on { mode = w.mode ?? "money" }
        value = w.weekly.map { $0.rounded() == $0 ? String(Int($0)) : String($0).replacingOccurrences(of: ".", with: ",") } ?? ""
    }

    private func save(on: Bool) async {
        do {
            if on {
                guard let n = Double(value.replacingOccurrences(of: ",", with: ".")), n > 0 else {
                    note = L("Please enter an amount above zero.")
                    return
                }
                apply(try await api.setExtrasAllowance(mode: mode, weekly: n))
                note = L("Saved")
            } else {
                apply(try await api.extrasOff())
                note = L("Extras allowance switched off")
            }
        } catch { note = APIError.from(error).localizedDescription }
    }
}
