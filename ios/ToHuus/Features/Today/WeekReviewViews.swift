import SwiftUI

// Wochenrückblick (server: lib/weekly.ts, docs/week-review.md, web: pages/WeekReview.tsx).
// "Das habt ihr geschafft" (the household, no names) and "Das hast du geschafft" (only the person themselves).
// Positive only: no comparison between people, no money, a quiet week gets a kind sentence.
// On "Heute" in the first three days of a new week until "Gesehen"; the page works for any week.

struct WeekReview: Decodable, Sendable {
    struct Part: Decodable, Sendable {
        var title: String
        @Lossy var cards: [YearReview.Card]
    }
    var from: String
    var to: String
    var on: Bool = true
    var show: Bool = false
    var title: String
    var household: Part
    var mine: Part?
    var quiet: String?
}

extension APIClient {
    /// GET /api/week-review?week= – default last week
    func weekReview(week: String? = nil) async throws -> WeekReview {
        try await get("api/week-review", query: week.map { [URLQueryItem(name: "week", value: $0)] } ?? [])
    }
    /// POST /api/week-review/seen { from } – "Heute" stops offering it
    func weekReviewSeen(from: String) async throws {
        _ = try await send("POST", "api/week-review/seen", json: ["from": from], as: Ignored.self)
    }
    /// PUT /api/week-review/settings { on } – personal switch for the "Heute" card
    func weekReviewSetOn(_ on: Bool) async throws {
        _ = try await send("PUT", "api/week-review/settings", json: ["on": on], as: Ignored.self)
    }
}

enum WeekDays {
    private static let iso: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    static func shift(_ day: String, _ days: Int) -> String {
        guard let d = iso.date(from: day) else { return day }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        return iso.string(from: cal.date(byAdding: .day, value: days, to: d) ?? d)
    }
    static func label(_ day: String) -> String {
        guard let d = iso.date(from: day) else { return day }
        return d.formatted(.dateTime.day().month(.abbreviated).locale(Locale.current).timeZone(TimeZone(identifier: "UTC")!))
    }
    static var today: String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }
}

/// Heute › last week's review, Monday to Wednesday until "Gesehen" – nothing otherwise
struct WeekReviewTeaser: View {
    let api: APIClient
    let refresh: Int
    @State private var data: WeekReview?
    @State private var error: String?

    var body: some View {
        Group {
            if let d = data, d.show {
                VStack(alignment: .leading, spacing: Theme.Space.s3) {
                    NavigationLink {
                        WeekReviewView(api: api) { Task { data = try? await api.weekReview() } }
                    } label: {
                        HStack(spacing: Theme.Space.s3) {
                            Image(systemName: "sparkles").font(.title3).foregroundStyle(Theme.mustard).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(d.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                Text(subtitle(d)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3).accessibilityHidden(true)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    Button(L("Seen")) { Task { await seen(d) } }
                        .buttonStyle(.bordered)
                        .frame(minHeight: 44)
                    if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
                }
                .padding(Theme.Space.s4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
            }
        }
        .task(id: refresh) { data = try? await api.weekReview() }
    }

    private func subtitle(_ d: WeekReview) -> String {
        if let m = d.mine, let c = m.cards.first { return "\(m.title): \(c.value) \(c.title)" }
        return d.household.title
    }

    private func seen(_ d: WeekReview) async {
        do {
            try await api.weekReviewSeen(from: d.from)
            data = try? await api.weekReview()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// "Eure Woche to Huus" – the household's week and, only for me, mine
struct WeekReviewView: View {
    let api: APIClient
    var onSeen: () -> Void = {}
    @State private var week: String?
    @State private var data: WeekReview?
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                if let error { ErrorBanner(message: error) { Task { await load() } } }
                if let d = data {
                    weekSwitch(d)
                    if let quiet = d.quiet {
                        EmptyStateView(systemImage: "sparkles", title: quiet)
                    } else {
                        if !d.household.cards.isEmpty {
                            Text(d.household.title).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                            ForEach(d.household.cards) { c in cardView(c) }
                        }
                        if let m = d.mine, !m.cards.isEmpty {
                            VStack(alignment: .leading, spacing: 2) {
                                Label(m.title, systemImage: "hand.thumbsup").font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                                Text(L("Only you see this part.")).font(.footnote).foregroundStyle(Theme.ink3)
                            }
                            .padding(.top, Theme.Space.s2)
                            ForEach(m.cards) { c in cardView(c) }
                        }
                    }
                    if d.mine != nil {
                        Toggle(isOn: Binding(get: { d.on }, set: { v in Task { await setOn(v) } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Show on Heute")).font(.subheadline.weight(.semibold))
                                Text(L("At the start of each week, until you’ve seen it.")).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .tint(Theme.primary)
                        .padding(Theme.Space.s4)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
                        .padding(.top, Theme.Space.s2)
                    }
                } else if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(Theme.Space.s4)
            .padding(.bottom, 80)
        }
        .canvasBackground()
        .navigationTitle(data?.title ?? L("Week in review"))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task(id: week ?? "") { await load() }
    }

    private func weekSwitch(_ d: WeekReview) -> some View {
        let next = WeekDays.shift(d.to, 1)
        return HStack {
            Button { week = WeekDays.shift(d.from, -1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .accessibilityLabel(L("Previous week"))
            Spacer()
            Text("\(WeekDays.label(d.from)) – \(WeekDays.label(d.to))").font(.headline.monospacedDigit())
            Spacer()
            Button { week = next } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .accessibilityLabel(L("Next week"))
                .disabled(next > WeekDays.today)
        }
        .foregroundStyle(Theme.primaryText)
    }

    private func cardView(_ c: YearReview.Card) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: ReviewStyle.icon(c.area)).font(.title3).foregroundStyle(Theme.ink2).accessibilityHidden(true)
            Text(c.value).font(.system(.largeTitle, design: .rounded, weight: .bold)).foregroundStyle(Theme.ink)
                .minimumScaleFactor(0.6).lineLimit(2)
            Text(c.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
            if let t = c.text { Text(t).font(.footnote).foregroundStyle(Theme.ink2) }
            ForEach(c.list, id: \.self) { x in
                Text("· " + x).font(.footnote).foregroundStyle(Theme.ink2)
            }
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(alignment: .top) {
            UnevenRoundedRectangle(topLeadingRadius: Theme.Radius.lg, topTrailingRadius: Theme.Radius.lg)
                .fill(ReviewStyle.color(c.area)).frame(height: 6)
        }
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let d = try await api.weekReview(week: week)
            data = d
            error = nil
            // opening last week's review counts as seen – "Heute" stops offering it
            if week == nil, d.show {
                try? await api.weekReviewSeen(from: d.from)
                onSeen()
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func setOn(_ on: Bool) async {
        do {
            try await api.weekReviewSetOn(on)
            data?.on = on
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// Aufgaben › a row to the week in review
struct WeekReviewLink: View {
    let api: APIClient
    var body: some View {
        Section {
            NavigationLink {
                WeekReviewView(api: api)
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Week in review"))
                        Text(L("What you did together last week – and what you did.")).font(.caption).foregroundStyle(Theme.ink3)
                    }
                } icon: {
                    Image(systemName: "sparkles").foregroundStyle(Theme.mustard)
                }
            }
        }
    }
}
