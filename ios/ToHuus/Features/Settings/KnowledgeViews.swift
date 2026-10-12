import SwiftUI

/// Help articles on the website (contract: docs/help-slugs.md – the app only links slugs listed there).
enum Help {
    static let base = URL(string: "https://tohuus.heidrich-digital.de/hilfe/")!

    static func url(_ slug: String) -> URL { base.appendingPathComponent("\(slug).html") }

    /// slug → title, in the order of docs/help-slugs.md (only the ones the app links)
    static let articles: [(slug: String, title: String)] = [
        ("erste-schritte", L("First steps")),
        ("so-funktioniert-tohuus", L("How ToHuus works")),
        ("einkaufsliste", L("The shopping list")),
        ("merkt-sich", L("What ToHuus remembers")),
        ("kassenbons", L("Reading receipts")),
        ("vorrat", L("Pantry (optional)")),
        ("kochen", L("Cooking with what's at home")),
        ("rezepte-importieren", L("Taking over recipes")),
        ("geld", L("Money: groceries and household")),
        ("sprechen", L("Speak")),
        ("ki-an-oder-aus", L("With or without AI")),
        ("haushalt-teilen", L("Sharing the household")),
        ("wer-sieht-was", L("Who sees what?")),
        ("daten-export", L("Taking your data with you")),
        ("gut-zu-wissen", L("Good to know")),
    ]
}

struct HelpLink: View {
    let slug: String
    let title: String

    var body: some View {
        Link(destination: Help.url(slug)) {
            HStack {
                Label(title, systemImage: "questionmark.circle")
                Spacer()
                Image(systemName: "arrow.up.right").font(.footnote).foregroundStyle(Theme.ink3)
            }
        }
    }
}

struct HelpListView: View {
    var body: some View {
        List {
            Section {
                ForEach(Help.articles, id: \.slug) { a in HelpLink(slug: a.slug, title: a.title) }
            } footer: {
                Text(L("The help pages open on tohuus.heidrich-digital.de."))
            }
        }
        .navigationTitle(L("Help"))
    }
}

/// "So funktioniert ToHuus" – the product in five short points, in the app's own words.
struct HowItWorksView: View {
    private let points: [(icon: String, title: String, text: String)] = [
        ("cart", L("One list for everyone"),
         L("Whoever notices something is missing puts it on the list – by typing, speaking or from a receipt. Every row shows where it came from.")),
        ("clock.arrow.circlepath", L("ToHuus remembers"),
         L("From receipts and ticks ToHuus learns how often you buy things. When something is probably due, it suggests it – it never puts anything on the list by itself.")),
        ("arrow.uturn.backward", L("Suggestions, not automatic"),
         L("Every suggestion shows its reason, and everything can be undone. Say “not now” twice and ToHuus stops suggesting it.")),
        ("fork.knife", L("Cook with what's at home"),
         L("ToHuus shows what you can cook today and what's missing for it. The week plan is optional.")),
        ("eurosign.circle", L("Know where the money goes"),
         L("Receipts show what groceries and household cost per month, per shop and per category – and which prices went up.")),
        ("hand.raised", L("Nothing to maintain"),
         L("You don't have to count stock or keep anything up to date. The more you capture, the better ToHuus knows your home – but it works from day one.")),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                ForEach(points, id: \.title) { p in
                    Card(title: p.title, systemImage: p.icon) {
                        Text(p.text).font(.subheadline).foregroundStyle(Theme.ink2)
                    }
                }
                HelpLink(slug: "so-funktioniert-tohuus", title: L("Read more"))
                HelpLink(slug: "wer-sieht-was", title: L("Who sees what?"))
            }
            .padding(Theme.Space.s4)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .canvasBackground()
        .navigationTitle(L("How ToHuus works"))
    }
}

/// GET /api/facts – "Gut zu wissen": short facts with their source (server: branch b-recipes/b-core).
struct Fact: Decodable, Sendable, Identifiable, Hashable {
    var id: String
    var title: String
    var text: String?
    var source: String?
    var sourceUrl: String?
    var topic: String?

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        guard let t = c.first(String.self, "title", "headline", "fact") else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "no title"))
        }
        title = t
        id = c.first(FlexID.self, "id", "slug")?.value ?? t
        text = c.first(String.self, "text", "body", "summary")
        if let src = c.first(JSONValue.self, "source") {
            source = src.string ?? src.first("name", "title")?.string
            sourceUrl = src.first("url", "link")?.string
        }
        sourceUrl = sourceUrl ?? c.first(String.self, "sourceUrl", "url", "link")
        topic = c.first(String.self, "topic", "area", "category")
    }
}

struct FactsResponse: Decodable, Sendable {
    var facts: [Fact]
    init(from decoder: Decoder) throws {
        if (try? decoder.unkeyedContainer()) != nil {
            facts = try Lossy<Fact>(from: decoder).wrappedValue
            return
        }
        let c = try decoder.container(keyedBy: AnyKey.self)
        facts = (try? c.decode(Lossy<Fact>.self, forKey: AnyKey("facts")).wrappedValue)
            ?? (try? c.decode(Lossy<Fact>.self, forKey: AnyKey("items")).wrappedValue) ?? []
    }
}

struct FactsView: View {
    @Environment(AppModel.self) private var app
    @State private var facts: [Fact] = []
    @State private var state: LoadState = .loading

    enum LoadState { case loading, ready, missing, failed(String) }

    var body: some View {
        List {
            switch state {
            case .loading:
                ProgressView()
            case .missing:
                Text(L("Your server doesn't have this section yet."))
                    .foregroundStyle(Theme.ink3)
            case .failed(let m):
                Text(m).foregroundStyle(Theme.empty)
            case .ready:
                ForEach(facts) { f in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(f.title).font(.headline)
                        if let t = f.text { Text(t).font(.subheadline).foregroundStyle(Theme.ink2) }
                        if let s = f.source {
                            if let u = f.sourceUrl.flatMap(URL.init(string:)) {
                                Link(LF("Source: %@", s), destination: u).font(.caption)
                            } else {
                                Text(LF("Source: %@", s)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            Section { HelpLink(slug: "gut-zu-wissen", title: L("About this section")) }
        }
        .navigationTitle(L("Good to know"))
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let api = app.api else { return }
        do {
            facts = try await api.get("api/facts", as: FactsResponse.self).facts
            state = .ready
        } catch APIError.notFound {
            state = .missing
        } catch {
            state = .failed(APIError.from(error).localizedDescription)
        }
    }
}
