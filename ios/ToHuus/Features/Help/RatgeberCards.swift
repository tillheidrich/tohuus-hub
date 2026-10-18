import SwiftUI

// Ratgeber cards (server: GET /api/ratgeber, built from the website's posts; web: pages/RatgeberCards.tsx).
// Short guide articles next to the features they explain; the article opens on the website (content, not a feature).

struct RatgeberPost: Decodable, Sendable, Hashable, Identifiable {
    var slug: String
    var title: String
    var teaser: String
    var area: String?
    var url: String
    var id: String { slug }
}

private struct RatgeberAnswer: Decodable { @Lossy var posts: [RatgeberPost] }

extension APIClient {
    func ratgeber(areas: [String] = []) async throws -> [RatgeberPost] {
        let q = areas.isEmpty ? [] : [URLQueryItem(name: "area", value: areas.joined(separator: ","))]
        return try await get("api/ratgeber", query: q, as: RatgeberAnswer.self).posts
    }
}

/// A list section with up to `max` guide cards for these areas – nothing when there are none (or an older server).
struct RatgeberSection: View {
    let api: APIClient
    var areas: [String] = []
    var max = 3
    @State private var posts: [RatgeberPost] = []
    @State private var loader = LoadTrigger()

    var body: some View {
        // loads from the body: in a List there is no invisible view to hang a .task on (Design/LoadSlot.swift)
        let _ = loader.run { posts = (try? await api.ratgeber(areas: areas)) ?? [] }
        if !posts.isEmpty {
            Section {
                ForEach(posts.prefix(max)) { p in
                    if let url = URL(string: p.url) {
                        Link(destination: url) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(p.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                Text(p.teaser).font(.caption).foregroundStyle(Theme.ink3).lineLimit(3)
                                Label(L("Read on the website"), systemImage: "arrow.up.right.square").font(.caption).foregroundStyle(Theme.primaryText)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            } header: {
                Label(L("From the guide"), systemImage: "book")
            }
        }
    }
}
