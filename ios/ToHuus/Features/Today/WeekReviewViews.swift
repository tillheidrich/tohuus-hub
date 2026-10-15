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
    /// week | month (GET /api/month-review has the same shape)
    var period: String?
    var from: String
    var to: String
    var on: Bool = true
    var show: Bool = false
    var title: String
    var household: Part
    var mine: Part?
    var quiet: String?
    /// a kind line under the title, e.g. for a single parent: "Alles auf deinen Schultern – und schau, was du geschafft hast."
    var note: String?
}

extension APIClient {
    /// GET /api/week-review?week= – default last week
    func weekReview(week: String? = nil) async throws -> WeekReview {
        try await get("api/week-review", query: week.map { [URLQueryItem(name: "week", value: $0)] } ?? [])
    }
    /// GET /api/month-review?month= – any day of the month, default last month
    func monthReview(month: String? = nil) async throws -> WeekReview {
        try await get("api/month-review", query: month.map { [URLQueryItem(name: "month", value: $0)] } ?? [])
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
    /// "Oktober 2026"
    static func monthLabel(_ day: String) -> String {
        guard let d = iso.date(from: day) else { return day }
        return d.formatted(.dateTime.month(.wide).year().locale(Locale.current).timeZone(TimeZone(identifier: "UTC")!))
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

/// "Eure Woche to Huus" – the household's week (or month) and, only for me, mine. Every card can leave as a picture.
struct WeekReviewView: View {
    let api: APIClient
    var onSeen: () -> Void = {}
    @State private var period = "week"
    /// a day in the shown week / month; nil = the last one
    @State private var day: String?
    @State private var data: WeekReview?
    @State private var error: String?
    @State private var loading = false
    @State private var sharing: ShareCardSpec?

    private var isMonth: Bool { period == "month" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Picker(L("Period"), selection: Binding(get: { period }, set: { period = $0; day = nil })) {
                    Text(L("Week")).tag("week")
                    Text(L("Month")).tag("month")
                }
                .pickerStyle(.segmented)
                if let error { ErrorBanner(message: error) { Task { await load() } } }
                if let d = data, (d.period ?? "week") == period {
                    periodSwitch(d)
                    if let note = d.note, !note.isEmpty {
                        Text(note).font(.subheadline).foregroundStyle(Theme.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let quiet = d.quiet {
                        EmptyStateView(systemImage: "sparkles", title: quiet)
                    } else {
                        if !d.household.cards.isEmpty {
                            HStack(alignment: .firstTextBaseline) {
                                Text(d.household.title).font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                                Spacer(minLength: Theme.Space.s2)
                                ShareCardButton(title: isMonth ? L("Share the month") : L("Share the week")) { sharing = summarySpec(d) }
                            }
                            ForEach(d.household.cards) { c in
                                ReviewCardView(card: c) { sharing = cardSpec(c, d, personal: false) }
                            }
                        }
                        if let m = d.mine, !m.cards.isEmpty {
                            VStack(alignment: .leading, spacing: 2) {
                                Label(m.title, systemImage: "hand.thumbsup").font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                                Text(L("Only you see this part.")).font(.footnote).foregroundStyle(Theme.ink3)
                            }
                            .padding(.top, Theme.Space.s2)
                            ForEach(m.cards) { c in
                                ReviewCardView(card: c) { sharing = cardSpec(c, d, personal: true) }
                            }
                        }
                    }
                    if d.mine != nil && !isMonth {
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
                } else if loading || data != nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(Theme.Space.s4)
            .padding(.bottom, 80)
        }
        .canvasBackground()
        .navigationTitle(data?.title ?? (isMonth ? L("Month in review") : L("Week in review")))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task(id: period + (day ?? "")) { await load() }
        .sheet(item: $sharing) { spec in ShareCardSheet(spec: spec) }
    }

    private func range(_ d: WeekReview) -> String {
        isMonth ? WeekDays.monthLabel(d.from) : "\(WeekDays.label(d.from)) – \(WeekDays.label(d.to))"
    }

    private func periodSwitch(_ d: WeekReview) -> some View {
        let next = WeekDays.shift(d.to, 1)
        return HStack {
            Button { day = WeekDays.shift(d.from, -1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                .accessibilityLabel(isMonth ? L("Previous month") : L("Previous week"))
            Spacer()
            Text(range(d)).font(.headline.monospacedDigit())
                .accessibilityAddTraits(.updatesFrequently)
            Spacer()
            Button { day = next } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                .accessibilityLabel(isMonth ? L("Next month") : L("Next week"))
                .disabled(next > WeekDays.today)
        }
        .foregroundStyle(Theme.primaryText)
    }

    private func eyebrow(_ d: WeekReview, personal: Bool) -> String {
        let who = personal ? (isMonth ? L("My month") : L("My week")) : (isMonth ? L("Our month") : L("Our week"))
        return who + " · " + range(d)
    }

    /// A card as a picture (docs/sharing.md): personal cards carry no list (it could hold private tasks or thoughts),
    /// "für jemanden da gewesen" never the person's name.
    private func cardSpec(_ c: YearReview.Card, _ d: WeekReview, personal: Bool) -> ShareCardSpec {
        let neutral = c.key == "my_carefor"
        return ShareCardSpec(area: ShareCardTheme.area(c.area), eyebrow: eyebrow(d, personal: personal), value: c.value,
                             title: neutral ? (c.value == "1" ? L("time you were there for someone") : L("times you were there for someone")) : c.title,
                             text: c.text, list: personal ? [] : c.list)
    }

    /// The whole week (or month) on one picture: the first card big, the next three as a list. Household cards only.
    private func summarySpec(_ d: WeekReview) -> ShareCardSpec {
        let cards = d.household.cards
        let first = cards.first
        return ShareCardSpec(area: ShareCardTheme.area(first?.area ?? "tasks"), eyebrow: eyebrow(d, personal: false),
                             value: first?.value ?? "", title: first?.title ?? "", text: nil,
                             list: cards.dropFirst().prefix(3).map { "\($0.value) \($0.title)" })
    }

    private func load() async {
        loading = true
        defer { loading = false }
        let asked = period
        do {
            let d = asked == "month" ? try await api.monthReview(month: day) : try await api.weekReview(week: day)
            guard asked == period else { return }
            data = d
            error = nil
            // opening last week's review counts as seen – "Heute" stops offering it
            if asked == "week", day == nil, d.show {
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

/// One review card (week, month, year) with an optional "Teilen" for the picture.
struct ReviewCardView: View {
    let card: YearReview.Card
    var onShare: (() -> Void)?

    var body: some View {
        let c = card
        VStack(alignment: .leading, spacing: 4) {
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
            .accessibilityElement(children: .combine)
            if let onShare {
                ShareCardButton(action: onShare)
                    .accessibilityLabel(LF("Share “%@” as image", "\(c.value) \(c.title)"))
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
