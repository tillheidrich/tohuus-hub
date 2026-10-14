import SwiftUI

/// GET /api/blick – "Wer hat was im Blick" (server: lib/blick.ts, web: pages/Blick.tsx)
struct Blick: Decodable, Sendable {
    struct Share: Decodable, Sendable, Hashable { var name: String; var share: Int }
    struct Area: Decodable, Sendable, Identifiable, Hashable {
        var area: String
        var active: Bool
        var people: [String]
        var shares: [Share]?
        var mine: Int?
        var id: String { area }
    }
    struct Loose: Decodable, Sendable, Identifiable, Hashable { var id: Int; var name: String }
    var days: Int
    var compare: Bool
    var meCompare: Bool
    var optedIn: Int
    var members: Int
    var areas: [Area]
    var keepsTasksInMind: [String]?
    var looseTasks: [Loose]
}

extension APIClient {
    func blick() async throws -> Blick { try await get("api/blick") }
    func setBlickCompare(_ on: Bool) async throws -> Blick { try await send("PUT", "api/blick/compare", json: ["on": on], as: Blick.self) }
}

/// Who noticed, planned, took care of receipts and did tasks in the last four weeks. Names only, alphabetical –
/// no ranking. Shares appear only when every member agreed; everyone sees their own number.
struct BlickSection: View {
    let api: APIClient
    /// changes when the Aufgaben page reloads
    let refresh: Int
    var onOpenTask: (Int) -> Void = { _ in }
    @State private var blick: Blick?
    @State private var error: String?

    private static let areaInfo: [String: (icon: String, title: String, what: String)] = [
        "shop": ("cart", "Shopping", "noticed what was missing or shopped"),
        "cook": ("frying.pan", "Cooking", "planned what to eat"),
        "money": ("wallet.pass", "Money", "brought in receipts and bills"),
        "tasks": ("checklist", "Tasks", "did household tasks"),
    ]

    var body: some View {
        Group {
            if let b = blick, b.areas.contains(where: \.active) {
                Section {
                    ForEach(b.areas.filter(\.active)) { a in areaRow(a) }
                    if !b.looseTasks.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Label(L("Nobody keeps these in mind yet"), systemImage: "eye").font(.subheadline.weight(.semibold))
                            ForEach(b.looseTasks) { x in
                                Button(x.name) { onOpenTask(x.id) }.font(.subheadline).frame(minHeight: 32)
                            }
                        }
                    }
                    if b.members >= 2 {
                        Toggle(isOn: Binding(get: { b.meCompare }, set: { on in Task { await setCompare(on) } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Compare shares"))
                                Text(b.compare ? L("Everyone agreed – shares are shown.") : LF("Shares appear only when everyone agrees (%d of %d).", b.optedIn, b.members))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .tint(Theme.primary)
                    }
                    if let error { Text(error).font(.caption).foregroundStyle(Theme.empty) }
                } header: {
                    Text(L("Who keeps what in mind"))
                } footer: {
                    Text(LF("The last %d days. Noticing and planning is work too.", b.days))
                }
            }
        }
        .task(id: refresh) { blick = try? await api.blick() }
    }

    private func areaRow(_ a: Blick.Area) -> some View {
        let info = Self.areaInfo[a.area] ?? ("circle", a.area, "")
        return VStack(alignment: .leading, spacing: 6) {
            Label(L(info.title), systemImage: info.icon).font(.subheadline.weight(.semibold))
            Text(L(info.what)).font(.caption).foregroundStyle(Theme.ink3)
            FlowLayout(spacing: 8) {
                ForEach(a.people, id: \.self) { n in
                    HStack(spacing: 4) {
                        PersonAvatar(name: n, size: 22, api: api)
                        Text(a.shares?.first(where: { $0.name == n }).map { "\(n) · \($0.share) %" } ?? n).font(.caption)
                    }
                }
            }
            if let shares = a.shares {
                GeometryReader { g in
                    HStack(spacing: 0) {
                        ForEach(Array(shares.enumerated()), id: \.element) { i, s in
                            Rectangle().fill(Theme.primary.opacity(1 - Double(i) * 0.25))
                                .frame(width: g.size.width * CGFloat(s.share) / 100)
                        }
                    }
                }
                .frame(height: 6)
                .background(Theme.line)
                .clipShape(RoundedRectangle(cornerRadius: 1))
                .accessibilityHidden(true)
            }
            if let mine = a.mine, mine > 0 { Text(LF("You: %d", mine)).font(.caption).foregroundStyle(Theme.ink3) }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private func setCompare(_ on: Bool) async {
        do {
            blick = try await api.setBlickCompare(on)
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
