import Charts
import SwiftUI

struct MoneyView: View {
    let store: ServerStore
    @State private var month = Date()
    @State private var overview: MoneyOverview?
    @State private var error: String?
    @State private var loading = false
    @State private var cheapest: [CheapestProduct] = []
    @State private var showReceipt = false
    @State private var path: [MoneyRoute] = []
    // q-money: Haushalt / Nur meins, own entries, money lists
    @AppStorage("money.view", store: SharedConfig.defaults) private var view = "household"
    @State private var meta: SpendMeta?
    @State private var lists: [MoneyListSummary] = []
    @State private var showExpense = false
    @State private var allPurchases = false

    private var monthKey: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM"
        return f.string(from: month)
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                CardStack(spacing: Theme.Space.s4) {
                    if !(meta?.members ?? []).isEmpty { MoneyViewSwitch(view: $view) }
                    if view == "mine" {
                        Label(L("Only what belongs to you: your personal entries and items marked for you. Nobody else sees them."), systemImage: "lock")
                            .font(.caption).foregroundStyle(Theme.ink2)
                    }
                    monthSwitcher
                    moreLinks
                    if let error { ErrorBanner(message: error) { Task { await load() } } }
                    if let o = overview {
                        let nothing = (o.total ?? 0) == 0 && o.byCategory.isEmpty
                        if !nothing { totalCard(o) }
                        if !o.purchases.isEmpty { purchasesCard(o) }
                        if !nothing && !o.byWeek.isEmpty { weekChart(o) }
                        if !o.byCategory.isEmpty { barChart(L("By category"), "square.grid.2x2", o.byCategory, o.currency) }
                        if !o.byShop.isEmpty { barChart(L("By shop"), "storefront", o.byShop, o.currency) }
                        if !o.priceChanges.isEmpty { priceCard(o) }
                        if !o.hints.isEmpty { hintsCard(o) }
                        if o.historyLimited {
                            Text(L("This month is further back than your plan remembers. “Haushalt” keeps the full history."))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        if view != "mine" { MoneyListsCard(lists: lists) { path.append(.newList) } }
                        // list2 G: shared flat – who is ahead this month (hides itself for other household forms)
                        if view != "mine" { WgBalanceCard(api: store.api, month: monthKey) }
                        if !cheapest.isEmpty && view != "mine" { cheapestCard }
                        if nothing && view == "mine" {
                            EmptyStateView(art: .receipt, title: L("Nothing of your own this month"),
                                           message: L("Mark an expense or receipt as “just for me”, or a receipt item as yours – it shows up here."),
                                           actionTitle: L("Add a personal expense")) { showExpense = true }
                        } else if nothing {
                            EmptyStateView(art: .receipt, title: L("No receipts this month yet."),
                                           message: L("Add a receipt photo or forward your e-receipts – ToHuus does the rest."),
                                           actionTitle: L("Add receipt")) { showReceipt = true }
                        }
                    } else if loading {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                    }
                    Button {
                        showReceipt = true
                    } label: {
                        Label(L("Add receipt"), systemImage: "doc.text.viewfinder")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    Button { showExpense = true } label: { Label(L("Add an expense"), systemImage: "plus") }
                        .buttonStyle(SecondaryButtonStyle())
                    NavigationLink(value: MoneyRoute.settings) {
                        Label(L("Categories & sharing"), systemImage: "gearshape").font(.subheadline)
                    }
                    .frame(minHeight: 44)
                }
                .padding(Theme.Space.s4)
                .padding(.bottom, 80)
            }
            .canvasBackground()
            .navigationTitle(L("Money"))
            .rootChrome()
            .refreshable { await load() }
            .task(id: "\(monthKey)-\(view)-\(store.revision("imports"))") { await load() }
            .sheet(isPresented: $showReceipt) { ReceiptCaptureView(store: store) }
            .sheet(isPresented: $showExpense) {
                NavigationStack {
                    ExpenseEditView(store: store, entry: nil, meta: meta, startPersonal: view == "mine")
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { showExpense = false } } }
                }
            }
            .navigationDestination(for: MoneyRoute.self) { r in
                switch r {
                case .detail: SpendView(store: store)
                case .receipts: ImportsListView(store: store) { showReceipt = true }
                case .review(let id): ImportReviewView(store: store, importId: id)
                case .spendReceipt(let id): SpendReceiptView(store: store, receiptId: id, meta: meta)
                case .expense(let e): ExpenseEditView(store: store, entry: e, meta: meta)
                case .prices(let id): PriceHistoryView(store: store, productId: id)
                case .pricePicker: PricePickerView(store: store)
                case .list(let id): MoneyListView(store: store, listId: id)
                case .newList:
                    NewMoneyListView(store: store) { id in
                        path.removeLast()
                        path.append(.list(id))
                    }
                case .settings: MoneySettingsView(store: store)
                case .recognition: ReceiptRecognitionView(store: store)
                case .printers: PrintersView(api: store.api)
                }
            }
            .onAppear {
                #if DEBUG
                // simulator checks: -debugMoney detail | receipts | review:<id> | recognition | printers | receipt:<id> | list:<id>
                if path.isEmpty, let d = UserDefaults.standard.string(forKey: "debugMoney") {
                    if d == "detail" { path = [.detail] }
                    else if d == "receipts" { path = [.receipts] }
                    else if d == "prices" { path = [.pricePicker] }
                    else if d.hasPrefix("price:"), let id = Int(d.dropFirst(6)) { path = [.prices(id)] }
                    else if d.hasPrefix("review:"), let id = Int(d.dropFirst(7)) { path = [.receipts, .review(id)] }
                    else if d.hasPrefix("list:"), let id = Int(d.dropFirst(5)) { path = [.list(id)] }
                    else if d == "newlist" { path = [.newList] }
                    else if d == "settings" { path = [.settings] }
                    else if d == "recognition" { path = [.receipts, .recognition] }
                    else if d == "printers" { path = [.printers] }
                    else if d.hasPrefix("receipt:"), let id = Int(d.dropFirst(8)) { path = [.spendReceipt(id)] }
                    else if d == "expense" { showExpense = true }
                    else if d == "mine" { view = "mine" }
                }
                #endif
            }
        }
    }

    /// Spending in detail and the receipts – the web's Spending and Imports pages, natively.
    private var moreLinks: some View {
        HStack(spacing: Theme.Space.s3) {
            NavigationLink(value: MoneyRoute.detail) {
                linkTile(L("In detail"), L("Periods, budgets, export"), "chart.bar.xaxis")
            }
            NavigationLink(value: MoneyRoute.receipts) {
                linkTile(L("Receipts"), L("Check and book in"), "doc.text")
            }
        }
        .buttonStyle(.plain)
    }

    private func linkTile(_ title: String, _ sub: String, _ icon: String) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: icon).font(.title3).foregroundStyle(Theme.primaryText)
                .frame(width: 36, height: 36)
                .background(Theme.primarySoft, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(sub).font(.caption).foregroundStyle(Theme.ink3).lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(Theme.Space.s3)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        .contentShape(Rectangle())
    }

    /// GET /api/prices/cheapest – products you bought in two or more shops, where they were cheapest.
    /// A row opens the price history with the per-shop prices; "All prices" searches every product with prices.
    private var cheapestCard: some View {
        Card(title: L("Where it was cheaper"), systemImage: "arrow.down.circle") {
            ForEach(cheapest.prefix(6)) { c in
                NavigationLink(value: MoneyRoute.prices(c.productId)) {
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(c.name).font(.subheadline).foregroundStyle(Theme.ink)
                            Text(c.shops.prefix(3).map { "\($0.shop ?? "–") \(Money.format($0.price))" }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 0)
                        if let s = c.saving, s > 0 { Text("−" + Money.format(s)).font(.subheadline).foregroundStyle(Theme.primaryText) }
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            NavigationLink(value: MoneyRoute.pricePicker) {
                Label(L("All prices"), systemImage: "magnifyingglass").font(.subheadline.weight(.semibold))
            }
            .foregroundStyle(Theme.primaryText)
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            overview = try await store.api.moneyOverview(month: monthKey, view: view)
            error = nil
            cheapest = (try? await store.api.cheapest()) ?? []
            if meta == nil { meta = try? await store.api.spendMeta() }
            lists = (try? await store.api.moneyLists()) ?? []
        } catch APIError.notFound {
            overview = nil
            error = L("This server can't show the money overview yet.")
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private var monthSwitcher: some View {
        HStack {
            Button { shift(-1) } label: { Image(systemName: "chevron.left").tapTarget() }
                .accessibilityLabel(L("Previous month"))
            Spacer()
            Text(month.formatted(.dateTime.month(.wide).year())).font(.headline)
            Spacer()
            Button { shift(1) } label: { Image(systemName: "chevron.right").tapTarget() }
                .disabled(Calendar.current.isDate(month, equalTo: Date(), toGranularity: .month))
                .accessibilityLabel(L("Next month"))
        }
        .padding(.vertical, 4)
    }

    private func shift(_ by: Int) {
        if let d = Calendar.current.date(byAdding: .month, value: by, to: month) { month = d }
    }

    private func totalCard(_ o: MoneyOverview) -> some View {
        let ongoing = Calendar.current.isDate(month, equalTo: Date(), toGranularity: .month)
        return Card(title: ongoing ? L("So far this month") : L("Spent this month"), systemImage: "eurosign.circle") {
            Text(Money.format(o.total ?? 0, currency: o.currency))
                .font(Theme.number())
                .foregroundStyle(Theme.ink)
                .numberTransition(o.total ?? 0)
            if let vs = o.vsLastMonth {
                let up = vs > 0
                Label(LF("%@ %% vs. last month", String(format: "%+.0f", vs)), systemImage: up ? "arrow.up.right" : "arrow.down.right")
                    .font(.subheadline)
                    .foregroundStyle(up ? Theme.low : Theme.primaryText)
            }
            if let b = o.budget, b > 0 {
                let t = o.total ?? 0
                let pct = Int((t / b * 100).rounded())
                VStack(alignment: .leading, spacing: 4) {
                    ShareMeter(share: t / b, tint: t > b ? Theme.low : Theme.primary).frame(height: 8)
                    Text(t > b
                         ? LF("%@ over the budget of %@", Money.format(t - b, currency: o.currency), Money.format(b, currency: o.currency))
                         : LF("%d %% of %@ · %@ left", pct, Money.format(b, currency: o.currency), Money.format(b - t, currency: o.currency)))
                        .font(.caption).foregroundStyle(t > b ? Theme.low : Theme.ink2)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(L("Budget"))
                .accessibilityValue(LF("%@ of %@", Money.format(t, currency: o.currency), Money.format(b, currency: o.currency)))
            }
        }
    }

    private func weekChart(_ o: MoneyOverview) -> some View {
        Card(title: L("Per week"), systemImage: "chart.bar") {
            Chart(o.byWeek) { w in
                BarMark(x: .value(L("Week"), weekLabel(w.label)), y: .value(L("Amount"), w.value))
                    .foregroundStyle(Theme.primary)
                    .cornerRadius(3)
            }
            .chartYAxis { AxisMarks(position: .leading) }
            .frame(height: 160)
        }
    }

    private func weekLabel(_ raw: String) -> String {
        if let d = ServerDate.parse(raw) { return d.formatted(.dateTime.day().month(.abbreviated)) }
        return raw
    }

    /// Horizontal bars as plain rows: label, bar, amount – readable at every text size.
    private func barChart(_ title: String, _ icon: String, _ data: [MoneyOverview.Amount], _ currency: String?) -> some View {
        let top = Array(data.sorted { $0.value > $1.value }.prefix(8))
        let maxValue = max(top.first?.value ?? 1, 0.01)
        return Card(title: title, systemImage: icon) {
            ForEach(top) { a in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(a.label).font(.subheadline).foregroundStyle(Theme.ink).lineLimit(1)
                        Spacer()
                        Text(Money.format(a.value, currency: currency)).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.ink2)
                    }
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Theme.surface2)
                            Capsule().fill(Theme.sage).frame(width: max(4, geo.size.width * a.value / maxValue))
                        }
                    }
                    .frame(height: 6)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func priceCard(_ o: MoneyOverview) -> some View {
        Card(title: L("Price changes"), systemImage: "tag") {
            ForEach(o.priceChanges.prefix(8)) { p in
                HStack {
                    VStack(alignment: .leading) {
                        Text(p.name).font(.subheadline)
                        if let s = p.shop { Text(s).font(.caption).foregroundStyle(Theme.ink3) }
                    }
                    Spacer()
                    if let b = p.before, let a = p.after {
                        Text("\(Money.format(b, currency: o.currency)) → \(Money.format(a, currency: o.currency))")
                            .font(.caption).foregroundStyle(Theme.ink2)
                    }
                    if let pct = p.pct {
                        Text(String(format: "%+.0f %%", pct)).font(.caption.weight(.semibold))
                            .foregroundStyle(pct > 0 ? Theme.low : Theme.primaryText)
                    }
                }
            }
        }
    }

    /// The month's purchases, newest first – tap one for its items (receipt) or the expense form (own expense).
    private func purchasesCard(_ o: MoneyOverview) -> some View {
        let shown = allPurchases ? o.purchases : Array(o.purchases.prefix(6))
        return Card(title: L("Purchases"), systemImage: "bag") {
            ForEach(shown) { p in
                NavigationLink(value: p.kind == "expense" ? (p.entry.map { MoneyRoute.expense($0) } ?? .detail) : .spendReceipt(p.id)) {
                    HStack(alignment: .center, spacing: Theme.Space.s2) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 4) {
                                Text(p.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                                if p.personal { Image(systemName: "lock.fill").font(.caption2).foregroundStyle(Theme.ink3).accessibilityLabel(L("Just mine")) }
                            }
                            Text(purchaseSub(p)).font(.caption).foregroundStyle(Theme.ink3)
                            if !p.preview.isEmpty {
                                Text(p.preview.joined(separator: ", ") + (p.kind == "receipt" && p.items > p.preview.count ? " …" : ""))
                                    .font(.caption).foregroundStyle(Theme.ink3).lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                        Text(p.excluded ? L("Doesn’t count") : Money.format(p.total, currency: o.currency))
                            .font(.subheadline.weight(.semibold).monospacedDigit())
                            .foregroundStyle(p.excluded ? Theme.ink3 : Theme.ink)
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if o.purchases.count > 6 {
                Button { allPurchases.toggle() } label: {
                    Text(allPurchases ? L("Show less") : LF("Show all %d", o.purchases.count)).frame(minHeight: 44).contentShape(Rectangle())
                }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.primaryText)
                    .frame(minHeight: 44)
            }
        }
    }

    private func purchaseSub(_ p: MoneyOverview.Purchase) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        var day = p.day
        if let d = f.date(from: p.day) { day = d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)) }
        let what = p.kind == "expense" ? L("Own expense") : (p.items == 1 ? L("1 article") : LF("%d articles", p.items))
        return "\(day) · \(what)"
    }

    private func hintsCard(_ o: MoneyOverview) -> some View {
        Card(title: L("Hints"), systemImage: "lightbulb") {
            ForEach(o.hints) { h in
                Label(h.text, systemImage: "circle.fill").labelStyle(HintLabelStyle()).font(.subheadline)
            }
        }
    }
}

enum MoneyRoute: Hashable {
    case detail, receipts, pricePicker
    case review(Int)
    case prices(Int)
    case list(Int)
    case newList
    case settings
    case spendReceipt(Int)
    case expense(SpendEntry)
    case recognition
    case printers
}

private struct HintLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            configuration.icon.font(.system(size: 5)).foregroundStyle(Theme.primaryText)
            configuration.title
        }
    }
}
