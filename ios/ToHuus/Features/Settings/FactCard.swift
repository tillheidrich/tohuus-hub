import SwiftUI

/// The facts, loaded once per app start and language (GET /api/facts is public and the same for everyone).
@MainActor
enum FactCache {
    private static var facts: [String: [Fact]] = [:]

    static func load(_ api: APIClient, lang: String = "de") async -> [Fact] {
        if let f = facts[lang] { return f }
        guard let r = try? await api.get("api/facts", query: [URLQueryItem(name: "lang", value: lang)], as: FactsResponse.self) else { return [] }
        facts[lang] = r.facts
        return r.facts
    }

    /// one fact of a topic, a different one each day (the same all day long)
    static func ofTheDay(_ all: [Fact], topic: String, date: Date = Date()) -> Fact? {
        let list = all.filter { $0.topic == topic }
        guard !list.isEmpty else { return nil }
        let day = Calendar.current.ordinality(of: .day, in: .era, for: date) ?? 0
        return list[day % list.count]
    }
}

/// "Gut zu wissen" (15 Oct 2026): one small, sourced fact on a screen where it fits – mental load on Im Kopf, care on
/// Für wen ich da bin, appreciation on the week review, calm under "Fertig für heute", single parents when the review
/// says so. One per screen, rotating by day, German households only (the sources are German). "Teilen" sends the
/// website's picture (story or feed) or draws the same card on the phone.
struct FactCard: View {
    let api: APIClient
    let topic: String
    /// inside a List (a Section) or as a free card
    var inList = false
    @Environment(AppModel.self) private var app
    @State private var fact: Fact?
    @State private var sharing: ShareCardSpec?
    @State private var loader = LoadTrigger()

    var body: some View {
        // not a Group: .task on an empty Group never runs, the card would never load (Design/LoadSlot.swift)
        if inList {
            // in a List there is no invisible view to hang a .task on: load from the body
            let _ = loader.run(id: topic) { await load() }
            if let f = fact { Section { content(f).sheet(item: $sharing) { spec in ShareCardSheet(spec: spec) } } }
        } else {
            LoadSlot {
                if let f = fact {
                    content(f).padding(Theme.Space.s4).background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg)).overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                }
            }
            .task(id: topic) { await load() }
            .sheet(item: $sharing) { spec in ShareCardSheet(spec: spec) }
        }
    }

    private func load() async {
        guard app.householdIsGerman else { fact = nil; return }
        fact = FactCache.ofTheDay(await FactCache.load(api), topic: topic)
    }

    private func content(_ f: Fact) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            Text(L("Good to know"))
                .font(.caption.weight(.semibold)).textCase(.uppercase).tracking(1)
                .foregroundStyle(Theme.primaryText)
            if let v = f.value, !v.isEmpty {
                Text(v)
                    .font(.system(.largeTitle, design: .serif, weight: .regular))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1).minimumScaleFactor(0.5)
            }
            Text(f.title).font(.headline).foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            if let t = f.text, !t.isEmpty {
                Text(t).font(.subheadline).foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s3) {
                if let src = f.sources.first {
                    let name = src.publisher ?? src.title ?? ""
                    if let u = src.url.flatMap(URL.init(string:)) {
                        Link(LF("Source: %@", name), destination: u)
                            .font(.caption)
                            .frame(minHeight: 44, alignment: .leading)
                            .accessibilityHint(L("Opens the source in the browser"))
                    } else {
                        Text(LF("Source: %@", name)).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                Spacer(minLength: 0)
                ShareCardButton { sharing = spec(f) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func spec(_ f: Fact) -> ShareCardSpec {
        ShareCardSpec(area: "fact", eyebrow: L("Good to know"), value: f.value ?? "", title: f.title, text: f.text,
                      source: f.sources.first.flatMap { $0.publisher ?? $0.title },
                      remoteFeed: f.imageFeed.flatMap(URL.init(string:)), remoteStory: f.imageStory.flatMap(URL.init(string:)))
    }
}
