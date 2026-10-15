import SwiftUI

// Rückblick – "Euer Jahr to Huus" (server: lib/review.ts, docs/review.md, web: pages/Review.tsx). Built but not
// active: nothing shows unless the server allows it (YEAR_REVIEW=on / back office). The household as "we" – no names,
// no ranking, nothing private; no money card in gentle mode. On "Heute" only from 1 December to 15 January.

struct YearReview: Decodable, Sendable {
    struct Card: Decodable, Sendable, Identifiable, Hashable {
        var key: String
        var area: String
        var value: String
        var title: String
        var text: String?
        var list: [String] = []
        var id: String { key }
    }
    var allowed: Bool
    var season: Int?
    var year: Int?
    var enough: Bool = false
    var title: String?
    var intro: String?
    var outro: String?
    @Lossy var cards: [Card]
}

struct YearReviewPeek: Decodable, Sendable {
    var allowed: Bool
    var season: Int?
}

extension APIClient {
    /// GET /api/review?year= – `{ allowed: false }` unless the server offers it
    func yearReview(year: Int? = nil) async throws -> YearReview {
        try await get("api/review", query: year.map { [URLQueryItem(name: "year", value: String($0))] } ?? [])
    }
    /// GET /api/review?peek=1 – only whether it is on and in season (for "Heute")
    func yearReviewPeek() async throws -> YearReviewPeek {
        try await get("api/review", query: [URLQueryItem(name: "peek", value: "1")])
    }
}

enum ReviewStyle {
    static func icon(_ area: String) -> String {
        switch area {
        case "shop": return "cart"
        case "cook": return "frying.pan"
        case "tasks": return "checkmark.circle"
        case "pantry": return "shippingbox"
        default: return "eurosign.circle"
        }
    }
    static func color(_ area: String) -> Color {
        switch area {
        case "shop": return Theme.primary
        case "cook": return Theme.clay
        case "tasks": return Theme.sage
        case "pantry": return Theme.mustard
        default: return Theme.info
        }
    }
}

/// Heute › a small card in December and early January – nothing otherwise
struct ReviewTeaser: View {
    let api: APIClient
    let refresh: Int
    @State private var peek: YearReviewPeek?

    var body: some View {
        Group {
            if let p = peek, p.allowed, let year = p.season {
                NavigationLink {
                    YearReviewView(api: api)
                } label: {
                    HStack(spacing: Theme.Space.s3) {
                        Image(systemName: "sparkles").font(.title3).foregroundStyle(Theme.mustard)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(LF("Your year at home %d", year)).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                            Text(L("What you did together – no ranking, just what happened.")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3)
                    }
                    .padding(Theme.Space.s4)
                    .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .task(id: refresh) { peek = try? await api.yearReviewPeek() }
    }
}

/// "Euer Jahr to Huus" – the cards of one year
struct YearReviewView: View {
    let api: APIClient
    @State private var year: Int?
    @State private var data: YearReview?
    @State private var error: String?
    @State private var loading = false
    @State private var sharing: ShareCardSpec?
    private let now = Calendar.current.component(.year, from: Date())

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                if let error { ErrorBanner(message: error) { Task { await load() } } }
                if let d = data {
                    if !d.allowed {
                        EmptyStateView(art: .receipt, title: L("The year in review is not switched on"), message: L("This server doesn’t offer it (yet)."))
                    } else {
                        yearSwitch(d.year ?? now)
                        if let intro = d.intro { Text(intro).font(.subheadline).foregroundStyle(Theme.ink2) }
                        if !d.enough {
                            EmptyStateView(art: .receipt, title: L("Not much to look back on yet"), message: L("Use ToHuus for a while – the year fills up by itself."))
                        } else {
                            // household cards only ("we", no names, nothing private) – each can leave as a picture
                            ForEach(d.cards) { c in
                                ReviewCardView(card: c) {
                                    sharing = ShareCardSpec(area: ShareCardTheme.area(c.area), eyebrow: L("Our year") + " · " + String(d.year ?? now),
                                                            value: c.value, title: c.title, text: c.text, list: c.list)
                                }
                            }
                            if let outro = d.outro { Text(outro).font(.subheadline.weight(.semibold)).padding(.top, Theme.Space.s2) }
                        }
                    }
                } else if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(Theme.Space.s4)
            .padding(.bottom, 80)
        }
        .canvasBackground()
        .navigationTitle(data?.title ?? L("Year in review"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task(id: year ?? 0) { await load() }
        .sheet(item: $sharing) { spec in ShareCardSheet(spec: spec) }
    }

    private func yearSwitch(_ shown: Int) -> some View {
        HStack {
            Button { year = shown - 1 } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .accessibilityLabel(L("Previous year"))
            Spacer()
            Text(String(shown)).font(.headline.monospacedDigit())
            Spacer()
            Button { year = shown + 1 } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .accessibilityLabel(L("Next year"))
                .disabled(shown >= now)
        }
        .foregroundStyle(Theme.primaryText)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            data = try await api.yearReview(year: year)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}
