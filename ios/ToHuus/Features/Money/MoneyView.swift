import Charts
import SwiftUI

struct MoneyView: View {
    let store: ServerStore
    @State private var month = Date()
    @State private var overview: MoneyOverview?
    @State private var error: String?
    @State private var loading = false
    @State private var showReceipt = false

    private var monthKey: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM"
        return f.string(from: month)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    monthSwitcher
                    if let error { ErrorBanner(message: error) { Task { await load() } } }
                    if let o = overview {
                        totalCard(o)
                        if !o.byWeek.isEmpty { weekChart(o) }
                        if !o.byCategory.isEmpty { barChart(L("By category"), "square.grid.2x2", o.byCategory, o.currency) }
                        if !o.byShop.isEmpty { barChart(L("By shop"), "storefront", o.byShop, o.currency) }
                        if !o.priceChanges.isEmpty { priceCard(o) }
                        if !o.hints.isEmpty { hintsCard(o) }
                        if o.total == nil && o.byCategory.isEmpty {
                            EmptyStateView(systemImage: "doc.text", title: L("No receipts this month yet."),
                                           message: L("Add a receipt photo or forward your e-receipts – ToHuus does the rest."))
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
                }
                .padding(Theme.Space.s4)
                .padding(.bottom, 80)
            }
            .canvasBackground()
            .navigationTitle(L("Money"))
            .refreshable { await load() }
            .task(id: "\(monthKey)-\(store.revision("imports"))") { await load() }
            .sheet(isPresented: $showReceipt) { ReceiptCaptureView(store: store) }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            overview = try await store.api.moneyOverview(month: monthKey)
            error = nil
        } catch APIError.notFound {
            overview = nil
            error = L("This server can't show the money overview yet.")
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private var monthSwitcher: some View {
        HStack {
            Button { shift(-1) } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel(L("Previous month"))
            Spacer()
            Text(month.formatted(.dateTime.month(.wide).year())).font(.headline)
            Spacer()
            Button { shift(1) } label: { Image(systemName: "chevron.right") }
                .disabled(Calendar.current.isDate(month, equalTo: Date(), toGranularity: .month))
                .accessibilityLabel(L("Next month"))
        }
        .padding(.vertical, 4)
    }

    private func shift(_ by: Int) {
        if let d = Calendar.current.date(byAdding: .month, value: by, to: month) { month = d }
    }

    private func totalCard(_ o: MoneyOverview) -> some View {
        Card(title: L("Food & household"), systemImage: "eurosign.circle") {
            Text(Money.format(o.total ?? 0, currency: o.currency))
                .font(.system(size: 36, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.ink)
            if let vs = o.vsLastMonth {
                let up = vs > 0
                Label(LF("%@ %% vs. last month", String(format: "%+.0f", vs)), systemImage: up ? "arrow.up.right" : "arrow.down.right")
                    .font(.subheadline)
                    .foregroundStyle(up ? Theme.low : Theme.primaryText)
            }
            if let b = o.budget, b > 0 {
                let t = o.total ?? 0
                ProgressView(value: min(t / b, 1)) {
                    Text(LF("%@ of %@ budget", Money.format(t, currency: o.currency), Money.format(b, currency: o.currency))).font(.caption)
                }
                .tint(t > b ? Theme.low : Theme.primary)
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

    private func barChart(_ title: String, _ icon: String, _ data: [MoneyOverview.Amount], _ currency: String?) -> some View {
        let top = Array(data.sorted { $0.value > $1.value }.prefix(8))
        return Card(title: title, systemImage: icon) {
            Chart(top) { a in
                BarMark(x: .value(L("Amount"), a.value), y: .value(title, a.label))
                    .foregroundStyle(Theme.sage)
                    .cornerRadius(3)
                    .annotation(position: .trailing) {
                        Text(Money.format(a.value, currency: currency)).font(.caption2).foregroundStyle(Theme.ink2)
                    }
            }
            .chartXAxis(.hidden)
            .frame(height: CGFloat(top.count) * 30 + 10)
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

    private func hintsCard(_ o: MoneyOverview) -> some View {
        Card(title: L("Hints"), systemImage: "lightbulb") {
            ForEach(o.hints) { h in
                Label(h.text, systemImage: "circle.fill").labelStyle(HintLabelStyle()).font(.subheadline)
            }
        }
    }
}

private struct HintLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            configuration.icon.font(.system(size: 5)).foregroundStyle(Theme.primaryText)
            configuration.title
        }
    }
}
