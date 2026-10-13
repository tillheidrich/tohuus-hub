import SwiftUI

/// "Geld im Detail" – web: Spending.tsx. Week / month / year / all time, the last 12 periods, every bar and every
/// category or shop opens its receipts; budgets, own expenses, things left out, price history, CSV export.
struct SpendView: View {
    let store: ServerStore
    @State private var kind: String = SharedConfig.defaults.string(forKey: "spend.kind") ?? "month"
    @State private var anchor = SpendDates.today
    @State private var tag: String?
    @State private var stats: SpendStats?
    @State private var meta: SpendMeta?
    @State private var error: String?
    @State private var loading = false
    @State private var sheet: SpendSheet?
    @State private var exportFile: ExportFile?
    @State private var exporting = false
    @State private var toast: ToastMessage?
    @State private var showAllCats = false
    @State private var showAllStores = false
    /// q-money: "Haushalt / Nur meins" – shared with the Geld tab
    @AppStorage("money.view", store: SharedConfig.defaults) private var view = "household"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s5) {
                controls
                if let error { ErrorBanner(message: error) { Task { await load() } } }
                if let s = stats {
                    if s.hasData == false {
                        Card {
                            EmptyStateView(art: .receipt, title: L("No receipts yet"),
                                           message: L("Spending appears here as soon as you book in a receipt. Prices come straight from the receipt."),
                                           actionTitle: L("Add an expense without a receipt")) { sheet = .expense(nil) }
                        }
                    } else {
                        hero(s)
                        budgets(s)
                        if !s.trend.isEmpty {
                            section(kind == "week" ? L("Last 12 weeks") : kind == "month" ? L("Last 12 months") : L("Last years")) {
                                ColumnsChart(columns: s.trend.map { b in
                                    ColumnsChart.Column(key: b.from, label: SpendDates.short(kind, b.from), title: SpendDates.periodLabel(kind, b.from, b.to), value: b.total, extra: 0, on: b.from == s.from)
                                }, hint: L("Tap a bar to open that period")) { key in anchor = key }
                            }
                        }
                        section(L("In this period"), trailing: s.unit == "day" ? L("per day") : s.unit == "month" ? L("per month") : L("per year")) {
                            if s.total == 0 && (s.excluded?.total ?? 0) == 0 {
                                Card { EmptyStateView(art: .receipt, title: L("Nothing in this period")) }
                            } else {
                                ColumnsChart(columns: s.timeline.enumerated().map { i, b in
                                    ColumnsChart.Column(key: b.key, label: SpendDates.bucketLabel(s.unit, kind, b.from, b.key, i, s.timeline.count),
                                          title: SpendDates.bucketTitle(s.unit, b.from, b.key), value: b.total, extra: b.excluded ?? 0, on: false)
                                }, hint: L("Tap a bar for its receipts")) { key in
                                    if let b = s.timeline.first(where: { $0.key == key }) {
                                        sheet = .drill(SpendDrill(title: SpendDates.bucketTitle(s.unit, b.from, b.key), from: b.from, to: b.to, tag: tag))
                                    }
                                }
                            }
                        }
                        if s.total > 0 {
                            section(L("By category")) {
                                hbars(s.byCategory.map { ($0.name, $0.total, nil) }, showAll: $showAllCats) { name in
                                    sheet = .drill(SpendDrill(title: name, from: s.from, to: s.to, category: name, tag: tag))
                                }
                            }
                            section(L("By shop")) {
                                hbars(s.byStore.map { st in
                                    (st.name, st.total, (st.baskets ?? 0) > 1 ? LF("%d purchases · on average %@", st.baskets ?? 0, Money.format(st.avgBasket ?? 0)) : L("1 purchase"))
                                }, showAll: $showAllStores) { name in
                                    sheet = .drill(SpendDrill(title: name, from: s.from, to: s.to, store: name, tag: tag))
                                }
                            }
                            composition(s)
                        }
                        if !s.top.isEmpty { topItems(s) }
                        VStack(alignment: .leading, spacing: 6) {
                            Text(L("Counted: booked receipts and orders plus your own expenses. Items that were unavailable or handed back are left out. Deposit is included in the total."))
                                .font(.caption).foregroundStyle(Theme.ink3)
                            Button(L("What is not counted?")) { sheet = .excluded }.font(.caption.weight(.semibold))
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
        .navigationTitle(L("Spending in detail"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Menu {
                    Button { Task { await export(all: false) } } label: { Label(LF("CSV – %@", periodTitle), systemImage: "tablecells") }
                    Button { Task { await export(all: true) } } label: { Label(L("Everything (CSV)"), systemImage: "tray.full") }
                } label: {
                    if exporting { ProgressView() } else { Image(systemName: "square.and.arrow.up") }
                }
                .accessibilityLabel(L("Export"))
                Button { sheet = .expense(nil) } label: { Image(systemName: "plus") }
                    .accessibilityLabel(L("Add an expense"))
            }
        }
        .refreshable { await load() }
        .task(id: "\(kind)|\(anchor)|\(tag ?? "")|\(view)|\(store.revision("imports"))") { await load() }
        .onChange(of: kind) { _, k in SharedConfig.defaults.set(k, forKey: "spend.kind") }
        .sheet(item: $sheet, onDismiss: { Task { await load() } }) { s in
            SpendSheetView(store: store, sheet: s, meta: meta)
        }
        .sheet(item: $exportFile) { f in ShareSheet(items: [f.url]).ignoresSafeArea() }
        .toast($toast)
    }

    // MARK: controls

    private var periodTitle: String {
        if let s = stats { return kind == "all" ? L("All time") : SpendDates.periodLabel(kind, s.from, s.to) }
        let r = SpendDates.range(kind, anchor, weekStart: weekStart)
        return SpendDates.periodLabel(kind, r.from, r.to)
    }

    private var weekStart: Int { stats?.weekStart ?? 1 }

    private var canNext: Bool {
        guard kind != "all" else { return false }
        return SpendDates.range(kind, SpendDates.shift(kind, anchor, 1), weekStart: weekStart).from <= SpendDates.today
    }

    private var controls: some View {
        VStack(spacing: Theme.Space.s3) {
            if !(meta?.members ?? []).isEmpty { MoneyViewSwitch(view: $view) }
            Picker(L("Period"), selection: Binding(get: { kind }, set: { kind = $0; anchor = SpendDates.today })) {
                Text(L("Week")).tag("week")
                Text(L("Month")).tag("month")
                Text(L("Year")).tag("year")
                Text(L("All time")).tag("all")
            }
            .pickerStyle(.segmented)
            HStack {
                if kind != "all" {
                    Button { anchor = SpendDates.shift(kind, anchor, -1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                        .accessibilityLabel(L("Previous period"))
                }
                Spacer()
                Text(kind == "all" ? (stats.flatMap { $0.hasData == true ? SpendDates.rangeLabel($0.from, $0.to) : nil } ?? L("All time")) : periodTitle)
                    .font(.headline)
                Spacer()
                if kind != "all" {
                    Button { anchor = SpendDates.shift(kind, anchor, 1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                        .disabled(!canNext)
                        .accessibilityLabel(L("Next period"))
                }
            }
            .frame(minHeight: 44)
            if let tags = meta?.tags, !tags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ChoiceChip(title: L("All"), on: tag == nil) { tag = nil }
                        ForEach(tags, id: \.self) { t in ChoiceChip(title: t, systemImage: "tag", on: tag == t) { tag = tag == t ? nil : t } }
                    }
                }
            }
        }
    }

    private func section<C: View>(_ title: String, trailing: String? = nil, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink).accessibilityAddTraits(.isHeader)
                Spacer()
                if let trailing { Text(trailing).font(.caption).foregroundStyle(Theme.ink3) }
            }
            content()
        }
    }

    // MARK: hero

    private func hero(_ s: SpendStats) -> some View {
        Card {
            Text((s.ongoing == true ? L("So far") : L("Total")).uppercased()).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3).tracking(0.6)
            Text(Money.format(s.total, currency: s.currency))
                .font(Theme.number(.serif)).monospacedDigit()
                .foregroundStyle(Theme.ink)
                .numberTransition(s.total ?? 0)
            Text([
                (s.receipts ?? 0) == 1 ? L("1 receipt") : LF("%d receipts", s.receipts ?? 0),
                (s.manual?.count ?? 0) > 0 ? ((s.manual?.count ?? 0) == 1 ? L("1 own expense") : LF("%d own expenses", s.manual?.count ?? 0)) : nil,
                (s.deposit ?? 0) > 0 ? LF("incl. %@ deposit", Money.format(s.deposit ?? 0, currency: s.currency)) : nil,
            ].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(Theme.ink3)
            if let prev = s.compare?.previous {
                Divider().overlay(Theme.line)
                compareRow(kind == "week" ? L("The week before") : kind == "month" ? SpendDates.monthName(prev.from) : String(prev.from.prefix(4)),
                           value: prev.total, sub: prev.toDate.map { LF("by this day %@", Money.format($0, currency: s.currency)) },
                           delta: delta(s.total, prev.toDate ?? prev.total), currency: s.currency)
            }
            if let ly = s.compare?.lastYear {
                compareRow(kind == "week" ? L("Same week last year") : SpendDates.monthYear(ly.from), value: ly.total, sub: nil,
                           delta: s.ongoing == true ? nil : delta(s.total, ly.total), currency: s.currency)
            }
            if let ex = s.excluded, (ex.total ?? 0) > 0 {
                Button {
                    sheet = .drill(SpendDrill(title: L("Left out"), from: s.from, to: s.to, tag: tag, excludedOnly: true))
                } label: {
                    HStack {
                        Image(systemName: "eye.slash")
                        VStack(alignment: .leading, spacing: 2) {
                            Text(LF("Not counted: %@", Money.format(ex.total ?? 0, currency: s.currency))).font(.subheadline)
                            Text(ex.byReason.prefix(3).map(\.name).joined(separator: ", ")).font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption)
                    }
                    .foregroundStyle(Theme.ink)
                    .padding(Theme.Space.s3)
                    .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func delta(_ cur: Double, _ prev: Double) -> String? {
        guard prev > 0 else { return nil }
        let d = (cur - prev) / prev * 100
        if abs(d) < 1 { return "±0 %" }
        return String(format: "%@%.0f %%", d > 0 ? "+" : "−", abs(d))
    }

    private func compareRow(_ title: String, value: Double, sub: String?, delta: String?, currency: String?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.subheadline).foregroundStyle(Theme.ink2)
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                HStack(spacing: 6) {
                    Text(value > 0 ? Money.format(value, currency: currency) : "–").font(.subheadline.monospacedDigit()).foregroundStyle(Theme.ink)
                    if let delta { Text(delta).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink2) }
                }
                if let sub { Text(sub).font(.caption).foregroundStyle(Theme.ink3) }
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: budgets

    @ViewBuilder
    private func budgets(_ s: SpendStats) -> some View {
        if s.budgets.isEmpty {
            Button { sheet = .budgets } label: { Label(L("Set a budget (optional)"), systemImage: "target") }
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
        } else {
            section(L("Budgets")) {
                Card {
                    ForEach(s.budgets) { b in BudgetBar(b: b, currency: s.currency) }
                    Button(L("Change")) { sheet = .budgets }.font(.subheadline.weight(.semibold))
                }
            }
        }
    }

    // MARK: lists

    private func hbars(_ rows: [(String, Double, String?)], showAll: Binding<Bool>, onPick: @escaping (String) -> Void) -> some View {
        let maxV = max(rows.map(\.1).max() ?? 0.01, 0.01)
        let list = showAll.wrappedValue ? rows : Array(rows.prefix(8))
        return Card {
            ForEach(list, id: \.0) { r in
                Button { onPick(r.0) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(r.0).font(.subheadline).foregroundStyle(Theme.ink).lineLimit(1)
                            Spacer()
                            Text(Money.format(r.1)).font(.subheadline.monospacedDigit().weight(.semibold)).foregroundStyle(Theme.ink)
                            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(Theme.ink3)
                        }
                        GeometryReader { g in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Theme.surface2)
                                Capsule().fill(Theme.primary).frame(width: max(4, g.size.width * r.1 / maxV))
                            }
                        }
                        .frame(height: 6)
                        if let sub = r.2 { Text(sub).font(.caption).foregroundStyle(Theme.ink3) }
                    }
                    .contentShape(Rectangle())
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
            }
            if rows.count > 8 {
                Button(showAll.wrappedValue ? L("Show less") : LF("Show all %d", rows.count)) { showAll.wrappedValue.toggle() }
                    .font(.subheadline.weight(.semibold))
            }
        }
    }

    private func composition(_ s: SpendStats) -> some View {
        let goods = s.goods ?? s.total
        let dep = s.deposit ?? 0
        let goodsShare = s.total > 0 ? goods / s.total : 1
        return section(L("Where the money went")) {
            Card {
                GeometryReader { g in
                    HStack(spacing: 2) {
                        Rectangle().fill(Theme.primary).frame(width: max(4, g.size.width * goodsShare))
                        if dep > 0 { Rectangle().fill(Theme.mustard) }
                    }
                    .clipShape(Capsule())
                }
                .frame(height: 12)
                .accessibilityLabel(LF("Goods %@, deposit %@", Money.format(goods), Money.format(dep)))
                HStack(spacing: Theme.Space.s4) {
                    legend(Theme.primary, L("Goods"), Money.format(goods))
                    legend(Theme.mustard, L("Deposit"), Money.format(dep))
                }
                HStack(alignment: .top, spacing: Theme.Space.s5) {
                    fact(L("Saved through discounts"), (s.discounts ?? 0) > 0 ? Money.format(s.discounts) : "–")
                    if (s.manual?.count ?? 0) > 0 { fact(L("Own expenses"), Money.format(s.manual?.total ?? 0)) }
                    if let w = s.waste?.value { fact(L("Thrown away (estimate)"), Money.format(w)) }
                }
            }
        }
    }

    private func legend(_ c: Color, _ t: String, _ v: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2).fill(c).frame(width: 10, height: 10)
            Text(t).font(.caption).foregroundStyle(Theme.ink2)
            Text(v).font(.caption.monospacedDigit().weight(.semibold)).foregroundStyle(Theme.ink)
        }
    }

    private func fact(_ t: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(t).font(.caption).foregroundStyle(Theme.ink3)
            Text(v).font(.subheadline.monospacedDigit().weight(.semibold)).foregroundStyle(Theme.ink)
        }
    }

    private func topItems(_ s: SpendStats) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            HStack {
                Text(L("Top items")).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink).accessibilityAddTraits(.isHeader)
                Spacer()
                Button(L("Price history")) { sheet = .pricePicker }.font(.subheadline.weight(.semibold))
            }
            Card {
                ForEach(Array(s.top.enumerated()), id: \.element.id) { i, x in
                    Button {
                        if let pid = x.productId { sheet = .prices(pid) }
                    } label: {
                        HStack(spacing: Theme.Space.s3) {
                            Text("\(i + 1)").font(.caption.monospacedDigit()).foregroundStyle(Theme.ink3).frame(width: 18)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(x.name).font(.subheadline).foregroundStyle(Theme.ink)
                                if let q = x.qty, q > 1 { Text(LF("%@ times", q.rounded() == q ? String(Int(q)) : String(q))).font(.caption).foregroundStyle(Theme.ink3) }
                            }
                            Spacer()
                            Text(Money.format(x.total)).font(.subheadline.monospacedDigit().weight(.semibold)).foregroundStyle(Theme.ink)
                            if x.productId != nil { Image(systemName: "chart.line.uptrend.xyaxis").font(.caption).foregroundStyle(Theme.ink3) }
                        }
                        .frame(minHeight: 40)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(x.productId == nil)
                }
            }
        }
    }

    // MARK: data

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let s = try await store.api.spendStats(period: kind, date: kind == "all" ? nil : anchor, tag: tag, view: view)
            stats = s
            error = nil
            if meta == nil { meta = try? await store.api.spendMeta() }
        } catch APIError.notFound {
            error = L("This server can't show the detailed spending yet.")
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func export(all: Bool) async {
        exporting = true
        defer { exporting = false }
        do {
            let data = try await store.api.spendExportCSV(period: all ? "all" : kind, date: all || kind == "all" ? nil : anchor, tag: all ? nil : tag, view: view)
            let name: String
            if all || kind == "all" { name = "tohuus-ausgaben-alles.csv" }
            else {
                let r = stats.map { ($0.from, $0.to) } ?? (anchor, anchor)
                name = "tohuus-ausgaben-\(r.0)_\(r.1).csv"
            }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try data.write(to: url, options: .atomic)
            exportFile = ExportFile(url: url)
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

struct ExportFile: Identifiable {
    let url: URL
    var id: String { url.path }
}

/// One budget: label, spent of amount, a bar with the forecast tick, a calm line underneath.
struct BudgetBar: View {
    let b: BudgetState
    var currency: String?

    var body: some View {
        let share = b.amount > 0 ? min(b.spent / b.amount, 1) : 0
        let tone: Color = b.state == "over" ? Theme.empty : b.state == "near" ? Theme.warning : Theme.primary
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(b.label).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Spacer()
                Text(Money.format(b.spent, currency: currency)).font(.subheadline.monospacedDigit().weight(.semibold))
                Text("/ " + Money.format(b.amount, currency: currency)).font(.caption.monospacedDigit()).foregroundStyle(Theme.ink3)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surface2)
                    Capsule().fill(tone).frame(width: max(4, g.size.width * share))
                    if b.ongoing == true, let f = b.forecast, f > b.spent, b.amount > 0 {
                        Rectangle().fill(Theme.ink2).frame(width: 2, height: 12)
                            .offset(x: min(g.size.width - 2, g.size.width * min(f / b.amount, 1)))
                    }
                }
            }
            .frame(height: 8)
            Text([
                b.period == "week" ? L("per week") : L("per month"),
                b.state == "over" ? L("Budget reached") : LF("%@ left", Money.format(b.remaining ?? max(0, b.amount - b.spent), currency: currency)),
                b.ongoing == true && (b.daysLeft ?? 0) > 0 && (b.forecast ?? b.spent) != b.spent
                    ? LF("at this pace about %@ by the end", Money.format(b.forecast ?? 0, currency: currency)) : nil,
            ].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(b.state == "over" ? Theme.empty : Theme.ink3)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(LF("%@: %@ of %@", b.label, Money.format(b.spent, currency: currency), Money.format(b.amount, currency: currency)))
    }
}

/// Column chart as buttons (web: Columns): every bar is its own target; the readout above shows the value.
struct ColumnsChart: View {
    struct Column: Identifiable {
        var key: String
        var label: String
        var title: String
        var value: Double
        var extra: Double
        var on: Bool
        var id: String { key }
    }
    let columns: [Column]
    let hint: String
    let onPick: (String) -> Void
    @State private var focus: String?

    var body: some View {
        let maxV = max(columns.map { $0.value + $0.extra }.max() ?? 0, 0.01)
        let shown = columns.first { $0.key == focus } ?? columns.first { $0.on }
        let dense = columns.count > 16
        Card {
            Group {
                if let shown {
                    HStack(spacing: 6) {
                        Text(Money.format(shown.value)).font(.headline.monospacedDigit())
                        Text(shown.title).font(.subheadline).foregroundStyle(Theme.ink3)
                        if shown.extra > 0 { Text("· " + LF("%@ not counted", Money.format(shown.extra))).font(.caption).foregroundStyle(Theme.ink3) }
                    }
                } else {
                    Text(hint).font(.subheadline).foregroundStyle(Theme.ink3)
                }
            }
            .frame(minHeight: 22)
            HStack(alignment: .bottom, spacing: dense ? 2 : 6) {
                ForEach(columns) { c in
                    Button {
                        focus = c.key
                        onPick(c.key)
                    } label: {
                        VStack(spacing: 4) {
                            VStack(spacing: 0) {
                                Spacer(minLength: 0)
                                if c.extra > 0 {
                                    RoundedRectangle(cornerRadius: 2).fill(Theme.sand)
                                        .frame(height: max(2, 120 * c.extra / maxV))
                                }
                                if c.value > 0 {
                                    RoundedRectangle(cornerRadius: 3)
                                        .fill(c.on || focus == c.key ? Theme.primary : Theme.sage)
                                        .frame(height: max(2, 120 * c.value / maxV))
                                }
                            }
                            .frame(height: 120)
                            Text(c.label).font(.caption2).foregroundStyle(c.on ? Theme.ink : Theme.ink3)
                                .lineLimit(1).minimumScaleFactor(0.6)
                                .frame(height: 12)
                        }
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(c.title)
                    .accessibilityValue(Money.format(c.value))
                }
            }
            if columns.contains(where: { $0.extra > 0 }) {
                HStack(spacing: Theme.Space.s4) {
                    HStack(spacing: 4) { RoundedRectangle(cornerRadius: 2).fill(Theme.sage).frame(width: 10, height: 10); Text(L("Counted")) }
                    HStack(spacing: 4) { RoundedRectangle(cornerRadius: 2).fill(Theme.sand).frame(width: 10, height: 10); Text(L("Left out")) }
                }
                .font(.caption).foregroundStyle(Theme.ink3)
            }
        }
    }
}

/// Day strings "YYYY-MM-DD" like the server (server/lib/spend2.ts); all arithmetic in UTC at noon.
enum SpendDates {
    private static var cal: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }
    private static func date(_ d: String) -> Date {
        let p = d.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return Date() }
        return cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) ?? Date()
    }
    private static func iso(_ d: Date) -> String {
        let c = cal.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
    static var today: String { ServerDate.day() }

    static func addDays(_ d: String, _ n: Int) -> String { iso(cal.date(byAdding: .day, value: n, to: date(d)) ?? date(d)) }
    static func addMonths(_ d: String, _ n: Int) -> String { iso(cal.date(byAdding: .month, value: n, to: date(d)) ?? date(d)) }

    static func range(_ kind: String, _ anchor: String, weekStart: Int) -> (from: String, to: String) {
        switch kind {
        case "week":
            let wd = cal.component(.weekday, from: date(anchor)) - 1 // 0 = Sunday
            let back = (wd - weekStart + 7) % 7
            let from = addDays(anchor, -back)
            return (from, addDays(from, 6))
        case "year":
            return (String(anchor.prefix(4)) + "-01-01", String(anchor.prefix(4)) + "-12-31")
        default:
            let first = String(anchor.prefix(8)) + "01"
            return (first, addDays(addMonths(first, 1), -1))
        }
    }

    static func shift(_ kind: String, _ anchor: String, _ n: Int) -> String {
        kind == "week" ? addDays(anchor, 7 * n) : addMonths(anchor, kind == "year" ? 12 * n : n)
    }

    private static func fmt(_ d: String, _ style: Date.FormatStyle) -> String { date(d).formatted(style) }
    private static var utc: Date.FormatStyle { var f = Date.FormatStyle(); f.timeZone = TimeZone(identifier: "UTC")!; return f }

    static func monthName(_ d: String) -> String { fmt(d, utc.month(.wide)) }
    static func monthYear(_ d: String) -> String { fmt(d, utc.month(.wide).year()) }

    static func rangeLabel(_ from: String, _ to: String) -> String {
        let sameYear = from.prefix(4) == to.prefix(4)
        let a = sameYear ? fmt(from, utc.day().month(.abbreviated)) : fmt(from, utc.day().month(.abbreviated).year())
        return a + " – " + fmt(to, utc.day().month(.abbreviated).year())
    }

    static func periodLabel(_ kind: String, _ from: String, _ to: String) -> String {
        switch kind {
        case "month": return monthYear(from)
        case "year": return String(from.prefix(4))
        case "all": return L("All time")
        default: return rangeLabel(from, to)
        }
    }

    static func short(_ kind: String, _ from: String) -> String {
        switch kind {
        case "month": return fmt(from, utc.month(.abbreviated))
        case "year": return String(from.prefix(4))
        default: return fmt(from, utc.day().month(.defaultDigits))
        }
    }

    static func bucketLabel(_ unit: String?, _ kind: String, _ from: String, _ key: String, _ i: Int, _ n: Int) -> String {
        if unit == "month" { return fmt(from, utc.month(.narrow)) }
        if unit == "year" { return key }
        if kind == "week" { return fmt(from, utc.weekday(.abbreviated)) }
        let d = Int(from.suffix(2)) ?? 0
        return d == 1 || d % 5 == 0 || i == n - 1 ? String(d) : ""
    }

    static func bucketTitle(_ unit: String?, _ from: String, _ key: String) -> String {
        if unit == "month" { return monthYear(from) }
        if unit == "year" { return key }
        return fmt(from, utc.weekday(.wide).day().month(.wide))
    }

    static func dayLabel(_ d: String) -> String { fmt(d, utc.weekday(.abbreviated).day().month(.abbreviated)) }
    static func longDay(_ d: String) -> String { fmt(d, utc.day().month(.abbreviated).year()) }

    static func toDate(_ d: String) -> Date { date(d) }
    static func fromDate(_ d: Date) -> String {
        var c = Calendar.current
        c.timeZone = .current
        let x = c.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", x.year ?? 0, x.month ?? 0, x.day ?? 0)
    }
}
