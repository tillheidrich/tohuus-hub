import SwiftUI

// Denkarbeit-Check (server: lib/loadcards.ts, docs/mental-load.md, web: pages/LoadCards.tsx): a deck of cards for the
// invisible part of running a home. Everyone answers privately; the household view appears only when everyone
// agreed to compare. Each card says how ToHuus can take that thing off your head. No scores, no ranking.

struct LoadDeck: Decodable, Sendable {
    struct Area: Decodable, Sendable, Hashable, Identifiable { var key: String; var title: String; var id: String { key } }
    struct Help: Decodable, Sendable, Hashable { var text: String; var path: String }
    struct Household: Decodable, Sendable, Hashable {
        var who: [String: [String]]
        var nobody: Bool?
        var both: Bool?
    }
    struct Card: Decodable, Sendable, Hashable, Identifiable {
        var key: String
        var area: String
        var text: String
        var help: Help?
        var mine: String?
        var household: Household?
        var id: String { key }
    }
    struct Summary: Decodable, Sendable { var total: Int; var answered: Int; var me: Int; var shared: Int; var other: Int; var na: Int }
    @Lossy var areas: [Area]
    @Lossy var cards: [Card]
    var summary: Summary
    var compare: Bool
    var meCompare: Bool
    var members: Int
}

extension APIClient {
    func loadDeck() async throws -> LoadDeck { try await get("api/blick/cards") }
    func answerLoadCard(_ key: String, _ answer: String?) async throws -> LoadDeck {
        try await send("PUT", "api/blick/cards/\(key)", json: ["answer": answer.map { $0 as Any } ?? NSNull()], as: LoadDeck.self)
    }
    func taskFromLoadCard(_ key: String) async throws -> Int {
        struct R: Decodable { var id: Int }
        return try await send("POST", "api/blick/cards/\(key)/task", json: [:], as: R.self).id
    }
}

enum LoadAnswers {
    static let all: [(key: String, title: String)] = [
        ("me", L("Mostly me")), ("shared", L("We share it")), ("other", L("Mostly someone else")), ("na", L("Not our thing")),
    ]
    /// short labels for the answer buttons (the full one is the accessibility label)
    static let short: [String: String] = ["me": L("Me"), "shared": L("We share"), "other": L("Someone else"), "na": L("Not for us")]
}

/// Entry row (Aufgaben › Wer hat was im Blick)
struct LoadCardsLink: View {
    let api: APIClient
    var body: some View {
        NavigationLink { LoadCardsView(api: api) } label: {
            VStack(alignment: .leading, spacing: 2) {
                Label(L("Mental load check"), systemImage: "brain.head.profile")
                Text(L("33 cards for the invisible work – who keeps what in mind? Private, no scores."))
                    .font(.caption).foregroundStyle(Theme.ink3)
            }
        }
    }
}

struct LoadCardsView: View {
    let api: APIClient
    @State private var deck: LoadDeck?
    @State private var area = "all"
    @State private var error: String?
    @State private var toast: ToastMessage?

    var body: some View {
        List {
            Section {
                Text(L("Noticing, planning and remembering is work too – it just doesn’t show. Go through the cards: who usually keeps this in mind? Your answers are yours. The household sees them only when everyone agrees."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let error { Section { ErrorBanner(message: error) { Task { await load() } } }.listRowBackground(Color.clear) }
            if let d = deck {
                if d.summary.answered > 0 { summary(d) }
                talk(d)
                Section {
                    Picker(L("Area"), selection: $area) {
                        Text(L("All")).tag("all")
                        ForEach(d.areas) { a in Text(a.title).tag(a.key) }
                    }
                }
                ForEach(d.cards.filter { area == "all" || $0.area == area }) { c in card(c, d) }
                RatgeberSection(api: api, areas: ["aufgaben", "kopf", "zuhause"])
                if d.members >= 2 {
                    Section {
                        Toggle(isOn: Binding(get: { d.meCompare }, set: { v in Task { await setCompare(v) } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Compare with the household"))
                                Text(d.compare ? L("Everyone agreed – the household sees who said what.") : L("Only when everyone switches this on does the household see the answers."))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .tint(Theme.primary)
                    }
                }
            } else if error == nil {
                HStack { Spacer(); ProgressView(); Spacer() }.listRowBackground(Color.clear)
            }
        }
        .themedList()
        .navigationTitle(L("Mental load check"))
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
    }

    private func summary(_ d: LoadDeck) -> some View {
        Section {
            Text(LF("You keep %d things mostly in mind yourself, you share %d, someone else takes care of %d.", d.summary.me, d.summary.shared, d.summary.other))
                .font(.subheadline.weight(.semibold))
            let help = d.cards.filter { $0.mine == "me" && $0.help != nil }.prefix(5)
            if !help.isEmpty {
                Text(L("ToHuus can take some of it off your head:")).font(.caption).foregroundStyle(Theme.ink3)
                ForEach(Array(help)) { c in
                    Text("\(c.text): \(c.help?.text ?? "")").font(.caption)
                }
            }
        } header: {
            Text(LF("%d of %d answered", d.summary.answered, d.summary.total))
        }
    }

    @ViewBuilder private func talk(_ d: LoadDeck) -> some View {
        let cards = d.cards.filter { $0.household?.nobody == true || $0.household?.both == true }
        if d.compare && !cards.isEmpty {
            Section(L("Worth a chat")) {
                ForEach(cards) { c in
                    Text(c.household?.nobody == true ? "\(c.text): \(L("everyone thinks someone else does it"))"
                         : "\(c.text): \(LF("%@ each say “mostly me”", (c.household?.who["me"] ?? []).joined(separator: ", ")))")
                        .font(.subheadline)
                }
            }
        }
    }

    private func card(_ c: LoadDeck.Card, _ d: LoadDeck) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Text(c.text).font(.headline)
                // four short answers as one compact control (web: .load-answers)
                HStack(spacing: 4) {
                    ForEach(LoadAnswers.all, id: \.key) { a in
                        let on = c.mine == a.key
                        Button { Task { await answer(c, a.key) } } label: {
                            Text(L(LoadAnswers.short[a.key] ?? a.title))
                                .font(.footnote.weight(.semibold))
                                .multilineTextAlignment(.center)
                                .minimumScaleFactor(0.85)
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .foregroundStyle(on ? Theme.canvas : Theme.ink2)
                                .background(on ? Theme.ink : Color.clear, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(L(a.title))
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                .padding(3)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                if let h = c.household {
                    Text(LoadAnswers.all.compactMap { a in
                        let names = h.who[a.key] ?? []
                        return names.isEmpty ? nil : "\(L(a.title)): \(names.joined(separator: ", "))"
                    }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Theme.ink3)
                }
                if let help = c.help, c.mine == "me" {
                    Label("\(L("How ToHuus helps")): \(help.text)", systemImage: "sparkles").font(.caption).foregroundStyle(Theme.ink2)
                }
                if c.mine == "me" {
                    Button { Task { await toTask(c) } } label: { Label(L("Make it a task"), systemImage: "plus.circle") }
                        .font(.subheadline)
                }
            }
            .padding(.vertical, 4)
        } header: {
            Text(d.areas.first { $0.key == c.area }?.title ?? "")
        }
    }

    private func load() async {
        do {
            deck = try await api.loadDeck()
            error = nil
        } catch APIError.notFound {
            error = L("Your server doesn't have this section yet.")
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func answer(_ c: LoadDeck.Card, _ a: String) async {
        do {
            deck = try await api.answerLoadCard(c.key, c.mine == a ? nil : a)
            Haptics.tick()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func toTask(_ c: LoadDeck.Card) async {
        do {
            _ = try await api.taskFromLoadCard(c.key)
            toast = ToastMessage(text: L("Saved as a task you keep in mind."))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func setCompare(_ on: Bool) async {
        do {
            _ = try await api.setBlickCompare(on)
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}
