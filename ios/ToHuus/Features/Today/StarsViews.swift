import SwiftUI

// Sterne (server: lib/points.ts, docs/points.md, web: pages/Stars.tsx) – optional, off twice by default: the server
// must allow it, then a household admin switches it on for chosen areas. "Eure Woche zusammen" and my own stars;
// other members only when everyone agreed to compare; children see theirs. No ranking, no streaks.

struct StarsWeek: Decodable, Sendable {
    struct Area: Decodable, Sendable, Hashable { var area: String; var total: Int; var mine: Int? }
    struct Person: Decodable, Sendable, Hashable { var name: String; var stars: Int }
    struct Week: Decodable, Sendable {
        var total: Int
        var mine: Int?
        @Lossy var byArea: [Area]
        var people: [Person]?
        @Lossy var kids: [Person]
    }
    var allowed: Bool
    var on: Bool
    var areas: [String]
    var hidden: Bool?
    var week: Week?
}

extension APIClient {
    func stars() async throws -> StarsWeek { try await get("api/points") }
    func setStars(on: Bool, areas: [String]) async throws -> StarsWeek {
        try await send("PUT", "api/points/settings", json: ["on": on, "areas": areas], as: StarsWeek.self)
    }
}

enum StarsLabels {
    static let areas = ["tasks", "shop", "cook", "money"]
    static func title(_ a: String) -> String {
        switch a {
        case "tasks": return L("Tasks")
        case "shop": return L("Shopping")
        case "cook": return L("Cooking")
        default: return L("Money")
        }
    }
}

/// Heute › "Sterne diese Woche" – nothing at all unless the household switched stars on
struct StarsCard: View {
    let api: APIClient
    let refresh: Int
    @State private var s: StarsWeek?

    var body: some View {
        Group {
            if let s, s.on, let w = s.week {
                Card(title: L("Stars this week"), systemImage: "star.fill") {
                    VStack(alignment: .leading, spacing: 4) {
                        (Text(LF("%d together", w.total)).font(.subheadline.weight(.semibold))
                            + Text(w.mine.map { " · " + LF("%d from you", $0) } ?? "").font(.subheadline).foregroundStyle(Theme.ink3))
                        Text(w.byArea.map { "\(StarsLabels.title($0.area)): \($0.total)" }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Theme.ink3)
                        let names = (w.people ?? []) + w.kids
                        if !names.isEmpty {
                            Text(names.map { "\($0.name) \($0.stars)" }.joined(separator: " · ")).font(.caption)
                        }
                    }
                }
            }
        }
        .task(id: refresh) { s = try? await api.stars() }
    }
}

/// Mehr › Haushalt: stars on/off and areas (admins) – only when the server allows stars
struct StarsSettingsSection: View {
    let api: APIClient
    let admin: Bool
    @State private var s: StarsWeek?
    @State private var error: String?

    var body: some View {
        Group {
            if let s, s.allowed {
                Section {
                    Toggle(L("Count stars"), isOn: Binding(get: { s.on }, set: { v in Task { await save(on: v, areas: s.areas.isEmpty ? ["tasks"] : s.areas) } }))
                        .tint(Theme.primary)
                        .disabled(!admin)
                    if s.on {
                        ForEach(StarsLabels.areas, id: \.self) { a in
                            let sel = s.areas.contains(a)
                            Button {
                                Task { await save(on: true, areas: sel ? s.areas.filter { $0 != a } : s.areas + [a]) }
                            } label: {
                                HStack {
                                    Text(StarsLabels.title(a)).foregroundStyle(Theme.ink)
                                    Spacer()
                                    if sel { Image(systemName: "checkmark").foregroundStyle(Theme.primaryText) }
                                }
                            }
                            .disabled(!admin || (sel && s.areas.count == 1))
                            .accessibilityAddTraits(sel ? .isSelected : [])
                        }
                    }
                    if let error { Text(error).font(.caption).foregroundStyle(Theme.empty) }
                } header: {
                    Text(L("Stars"))
                } footer: {
                    Text(L("Optional. A star for each thing someone does for the household – a task, the list, planning a meal, a receipt. You see your week together and your own stars; no rankings, no streaks. Gentle mode hides them."))
                }
            }
        }
        .task { s = try? await api.stars() }
    }

    private func save(on: Bool, areas: [String]) async {
        do {
            s = try await api.setStars(on: on, areas: areas)
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
