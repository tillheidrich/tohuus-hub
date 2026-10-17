import SwiftUI

/// Help articles on the website (contract: docs/help-slugs.md – the app only links slugs listed there).
enum Help {
    static let base = SharedConfig.siteURL.appendingPathComponent("hilfe")

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
        ("cookidoo", L("Cookidoo, Monsieur Cuisine & co.")),
        ("geld", L("Money: groceries and household")),
        ("gemeinsam-einkaufen", L("Shopping together")),
        ("benachrichtigungen", L("Notifications")),
        ("sprechen", L("Speak")),
        ("ki-an-oder-aus", L("With or without AI")),
        ("hausinfo", L("House info for guests and sitters")),
        ("hausinfo-codes", L("Sharing codes safely")),
        ("haushalt-teilen", L("Sharing the household")),
        ("erinnerungen-spiegeln", L("Mirror to Apple Reminders")),
        ("wer-sieht-was", L("Who sees what?")),
        ("daten-export", L("Taking your data with you")),
        ("gut-zu-wissen", L("Good to know")),
        ("datenschutz-kurz", L("Privacy in short")),
        ("abo-und-kuendigen", L("Subscription and cancelling")),
        ("fragen", L("Frequent questions")),
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
                Text(LF("The help pages open on %@.", SharedConfig.siteURL.host() ?? ""))
            }
        }
        .themedList()
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

/// GET /api/facts?lang= (public) → { version, retrieved, help, facts: [{ id, topic, title, text, tohuus, sources: [{ title, publisher, url, retrieved, note? }] }] }
struct Fact: Decodable, Sendable, Identifiable, Hashable {
    var id: String
    var title: String
    var text: String?
    /// what ToHuus does with it
    var tohuus: String?
    var topic: String?
    var sources: [Source] = []
    /// the big number or word for a card ("86 %", "Danke") – nil for the older facts
    var value: String?
    /// the website's ready share pictures (4:5 feed, 9:16 story)
    var imageFeed: String?
    var imageStory: String?

    struct Source: Decodable, Sendable, Hashable {
        var title: String?
        var publisher: String?
        var url: String?
        var label: String { [publisher, title].compactMap { $0 }.joined(separator: ": ") }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        guard let t = c.first(String.self, "title", "headline", "fact") else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "no title"))
        }
        title = t
        id = c.first(FlexID.self, "id", "slug")?.value ?? t
        text = c.first(String.self, "text", "body", "summary")
        tohuus = c.first(String.self, "tohuus")
        topic = c.first(String.self, "topic", "area", "category")
        value = c.first(String.self, "value")
        if let img = c.first(JSONValue.self, "images") {
            imageFeed = img["feed"]?.string
            imageStory = img["story"]?.string
        }
        if let list = try? c.decode(Lossy<Source>.self, forKey: AnyKey("sources")), !list.wrappedValue.isEmpty {
            sources = list.wrappedValue
        } else if let one = c.first(JSONValue.self, "source") {
            sources = [Source(title: one.string ?? one.first("title", "name")?.string, publisher: one["publisher"]?.string,
                              url: one.first("url", "link")?.string ?? c.first(String.self, "sourceUrl"))]
        }
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
                        if let t = f.tohuus { Label(t, systemImage: "house").font(.caption).foregroundStyle(Theme.primaryText) }
                        ForEach(f.sources, id: \.self) { src in
                            if let u = src.url.flatMap(URL.init(string:)) {
                                Link(LF("Source: %@", src.label), destination: u).font(.caption)
                            } else {
                                Text(LF("Source: %@", src.label)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            Section { HelpLink(slug: "gut-zu-wissen", title: L("About this section")) }
        }
        .themedList()
        .navigationTitle(L("Good to know"))
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let api = app.api else { return }
        do {
            let lang = Locale.current.language.languageCode?.identifier == "en" ? "en" : "de"
            facts = try await api.get("api/facts", query: [URLQueryItem(name: "lang", value: lang)], as: FactsResponse.self).facts
            state = .ready
        } catch APIError.notFound {
            state = .missing
        } catch {
            state = .failed(APIError.from(error).localizedDescription)
        }
    }
}
