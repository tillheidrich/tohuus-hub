import Charts
import SwiftUI

/// What opens from the spending screen. Each sheet has its own navigation stack: drill-down → receipt → line → price history.
enum SpendSheet: Identifiable {
    case drill(SpendDrill)
    case expense(SpendEntry?)
    case budgets
    case excluded
    case prices(Int)
    case pricePicker

    var id: String {
        switch self {
        case .drill(let d): return "drill-\(d.id)"
        case .expense(let e): return "expense-\(e?.id ?? 0)"
        case .budgets: return "budgets"
        case .excluded: return "excluded"
        case .prices(let id): return "prices-\(id)"
        case .pricePicker: return "price-picker"
        }
    }
}

struct SpendDrill: Hashable, Identifiable {
    var title: String
    var from: String
    var to: String
    var category: String?
    var store: String?
    var tag: String?
    var excludedOnly = false
    var id: String { [title, from, to, category ?? "", store ?? "", tag ?? "", excludedOnly ? "x" : ""].joined(separator: "|") }
}

struct SpendSheetView: View {
    let store: ServerStore
    let sheet: SpendSheet
    let meta: SpendMeta?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                switch sheet {
                case .drill(let d): SpendDrillView(store: store, drill: d, meta: meta)
                case .expense(let e): ExpenseEditView(store: store, entry: e, meta: meta)
                case .budgets: BudgetsEditView(store: store, meta: meta)
                case .excluded: ExcludedListView(store: store)
                case .prices(let id): PriceHistoryView(store: store, productId: id)
                case .pricePicker: PricePickerView(store: store)
                }
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
        }
    }
}

// MARK: - drill-down

/// The receipts behind a bar, a category or a shop – grouped by receipt; own expenses stand alone.
struct SpendDrillView: View {
    let store: ServerStore
    let drill: SpendDrill
    let meta: SpendMeta?
    @State private var data: SpendEntries?
    @State private var error: String?
    @State private var askReason = false
    @State private var reason = ""
    @State private var toast: ToastMessage?

    private struct EntryGroup: Identifiable {
        var key: String
        var receiptId: Int?
        var store: String
        var day: String
        var entries: [SpendEntry]
        var id: String { key }
    }

    var body: some View {
        List {
            if let error { Text(error).foregroundStyle(Theme.empty) }
            if let data {
                let groups = grouped(data.entries)
                Section {
                    Text(subtitle(data.entries)).font(.subheadline).foregroundStyle(Theme.ink2)
                }
                if groups.isEmpty {
                    EmptyStateView(art: .receipt, title: L("Nothing in this period")).listRowBackground(Color.clear)
                }
                ForEach(groups) { g in
                    Section {
                        if let rid = g.receiptId {
                            NavigationLink { SpendReceiptView(store: store, receiptId: rid, meta: meta) } label: { groupHead(g, own: false) }
                            ForEach(g.entries) { e in
                                NavigationLink { SpendLineView(store: store, entry: e, meta: meta) } label: { SpendEntryRow(e: e) }
                            }
                        } else if let e = g.entries.first {
                            NavigationLink { ExpenseEditView(store: store, entry: e, meta: meta) } label: { groupHead(g, own: true) }
                        }
                    }
                }
                if data.truncated == true { Text(L("Only the first 1000 entries are shown.")).font(.caption).foregroundStyle(Theme.ink3) }
                if let scope = ruleScope, !data.entries.isEmpty {
                    Section {
                        Button {
                            if ruleActive(data.entries) { Task { await toggleRule(scope) } } else { askReason = true }
                        } label: {
                            Label(ruleActive(data.entries) ? LF("Count %@ again", ruleRef) : LF("Don’t count %@", ruleRef), systemImage: "eye.slash")
                        }
                    }
                }
            } else if error == nil {
                HStack { Spacer(); ProgressView(); Spacer() }
            }
        }
        .themedList()
        .navigationTitle(drill.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .alert(LF("Why should %@ not count? (optional)", ruleRef), isPresented: $askReason) {
            TextField(L("Reason (optional)"), text: $reason)
            Button(L("Leave out")) { if let s = ruleScope { Task { await toggleRule(s) } } }
            Button(L("Cancel"), role: .cancel) {}
        }
        .toast($toast)
    }

    private var ruleScope: String? { drill.category != nil ? "category" : drill.store != nil ? "store" : nil }
    private var ruleRef: String { drill.category ?? drill.store ?? "" }
    private func ruleActive(_ list: [SpendEntry]) -> Bool { list.allSatisfy { $0.excluded?.scope == ruleScope } }

    private func subtitle(_ list: [SpendEntry]) -> String {
        let counted = list.filter { $0.excluded == nil }.reduce(0) { $0 + $1.price }
        let when = drill.from == drill.to ? SpendDates.longDay(drill.from) : SpendDates.rangeLabel(drill.from, drill.to)
        return when + " · " + Money.format(counted)
    }

    private func groupHead(_ g: EntryGroup, own: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(g.store).font(.headline).foregroundStyle(Theme.ink)
                HStack(spacing: 6) {
                    Text(SpendDates.dayLabel(g.day)).font(.caption).foregroundStyle(Theme.ink3)
                    if own { StatusPill(text: L("own expense"), status: nil) }
                }
            }
            Spacer()
            Text(Money.format(g.entries.filter { $0.excluded == nil }.reduce(0) { $0 + $1.price }))
                .font(.subheadline.monospacedDigit().weight(.semibold))
        }
    }

    private func grouped(_ list: [SpendEntry]) -> [EntryGroup] {
        var out: [EntryGroup] = []
        var index: [String: Int] = [:]
        for e in list {
            let k = e.receiptId.map { "r\($0)" } ?? e.key
            if let i = index[k] { out[i].entries.append(e) } else {
                index[k] = out.count
                out.append(EntryGroup(key: k, receiptId: e.receiptId, store: e.store, day: e.day, entries: [e]))
            }
        }
        return out
    }

    private func load() async {
        do {
            data = try await store.api.spendEntries(from: drill.from, to: drill.to, category: drill.category, store: drill.store, tag: drill.tag, excludedOnly: drill.excludedOnly,
                                                    view: SharedConfig.defaults.string(forKey: "money.view"))
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func toggleRule(_ scope: String) async {
        do {
            if let d = data, ruleActive(d.entries) {
                try await store.api.countAgain(scope: scope, ref: ruleRef)
                toast = ToastMessage(text: L("Counted again"))
            } else {
                try await store.api.excludeSpend(scope: scope, ref: ruleRef, reason: reason.isEmpty ? nil : reason)
                toast = ToastMessage(text: LF("%@ no longer counts", ruleRef))
            }
            reason = ""
            store.touch("imports")
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

struct SpendEntryRow: View {
    let e: SpendEntry

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text(e.name).font(.subheadline).foregroundStyle(e.excluded == nil ? Theme.ink : Theme.ink3)
                HStack(spacing: 4) {
                    Text(e.category).font(.caption).foregroundStyle(Theme.ink3)
                    if e.categoryChanged == true { Text("· " + L("changed")).font(.caption).foregroundStyle(Theme.ink3) }
                    ForEach(e.tags, id: \.self) { t in
                        Text(t).font(.caption2.weight(.medium)).padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Theme.surface2, in: Capsule())
                    }
                    if let x = e.excluded {
                        Label(x.reason ?? L("left out"), systemImage: "eye.slash").font(.caption2).foregroundStyle(Theme.ink3)
                    }
                    MoneyEntryBadges(e: e)
                }
            }
            Spacer()
            Text(Money.format(e.price)).font(.subheadline.monospacedDigit()).foregroundStyle(e.excluded == nil ? Theme.ink : Theme.ink3)
                .strikethrough(e.excluded != nil)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Quick reasons for leaving something out (web: REASONS).
struct ReasonPicker: View {
    @Binding var reason: String
    private let options = [L("Business"), L("Gift"), L("Party"), L("For someone else")]

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(options, id: \.self) { o in ChoiceChip(title: o, on: reason == o) { reason = reason == o ? "" : o } }
        }
        TextField(L("Reason (optional)"), text: $reason)
    }
}

// MARK: - one receipt

struct SpendReceiptView: View {
    let store: ServerStore
    let receiptId: Int
    let meta: SpendMeta?
    @State private var data: SpendReceipt?
    @State private var tags: [String] = []
    @State private var reason = ""
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var openList: Int?
    @State private var splitting = false

    private var members: [MoneyMember] { meta?.members ?? [] }

    var body: some View {
        Form {
            if let error { Text(error).foregroundStyle(Theme.empty) }
            if let d = data {
                Section {
                    LabeledContent(L("Counted"), value: Money.format(d.counted ?? 0))
                    if (d.excludedTotal ?? 0) > 0 { LabeledContent(L("Not counted"), value: Money.format(d.excludedTotal)) }
                    if (d.discounts ?? 0) > 0 { LabeledContent(L("Saved"), value: Money.format(d.discounts)) }
                }
                Section {
                    ForEach(d.entries) { e in
                        NavigationLink { SpendLineView(store: store, entry: e, meta: meta) } label: { SpendEntryRow(e: e) }
                    }
                }
                // q-money: who paid, single lines for one person, personal receipt, split as a money list
                if members.count > 1 && d.personal == nil {
                    Section(L("Who paid?")) {
                        let payer = d.paidBy ?? members.first { $0.name == d.actor }?.id
                        FlowLayout(spacing: 6) {
                            ForEach(members) { m in
                                ChoiceChip(title: m.name, on: payer == m.id) { Task { await run { try await store.api.setReceiptPayer(receiptId, userId: m.id) } } }
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    Section {
                        ForEach(d.entries) { e in
                            Picker(selection: Binding(get: { e.forUserId }, set: { v in Task { await run { try await store.api.setLineOwner(receipt: receiptId, line: e.id, userId: v) } } })) {
                                Text(L("Household")).tag(Int?.none)
                                ForEach(members) { m in Text(m.name).tag(Int?.some(m.id)) }
                            } label: {
                                Text(e.name).font(.subheadline).lineLimit(2)
                            }
                        }
                    } header: { Text(L("For whom?")) } footer: { Text(L("Something on it belongs to one person? Choose them next to the item.")) }
                }
                if let me = meta?.me {
                    Section {
                        Toggle(isOn: Binding(get: { d.personal != nil }, set: { on in Task { await run { try await store.api.setReceiptPersonal(receiptId, forUserId: on ? me : nil) } } })) {
                            Text(d.personal.map { $0.forUserId == me ? L("This receipt is just mine") : LF("Belongs to %@", $0.forName ?? "") } ?? L("This receipt is just mine"))
                        }
                        .disabled(d.personal.map { $0.forUserId != me && $0.byUserId != me } ?? false)
                    } footer: { Text(L("Personal receipts are only in your “Just mine” – nobody else sees them, not even in the household numbers.")) }
                }
                Section {
                    Button {
                        Task { await split() }
                    } label: { HStack { Label(L("Split this receipt"), systemImage: "person.2"); if splitting { Spacer(); ProgressView() } } }
                        .disabled(splitting)
                }
                Section(L("Tags for the whole receipt")) {
                    TagEditor(label: L("Tags"), values: $tags, suggestions: meta?.tags ?? [])
                        .onChange(of: tags) { _, v in Task { try? await store.api.setReceiptTags(receiptId, tags: v); store.touch("imports") } }
                }
                Section {
                    if let ex = d.exclusion {
                        Text(L("This receipt is not counted") + (ex.reason.map { ": \($0)" } ?? "") + ".")
                        Button(L("Count again")) { Task { await toggle() } }
                    } else {
                        ReasonPicker(reason: $reason)
                        Button { Task { await toggle() } } label: { Label(L("Leave out"), systemImage: "eye.slash") }
                    }
                } header: { Text(L("Don’t count this receipt")) }
                Section {
                    NavigationLink(L("Check receipt")) { ImportReviewView(store: store, importId: receiptId) }
                }
            }
        }
        .themedList()
        .navigationTitle(data.map { [$0.store, $0.day.map(SpendDates.longDay)].compactMap { $0 }.joined(separator: " · ") } ?? L("Receipt"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .toast($toast)
        .navigationDestination(item: $openList) { id in MoneyListView(store: store, listId: id) }
    }

    private func run(_ fn: () async throws -> Void) async {
        do {
            try await fn()
            store.touch("imports")
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func split() async {
        splitting = true
        defer { splitting = false }
        do {
            let l = try await store.api.createMoneyList(title: data?.store, people: nil, count: nil, from: .receipt(receiptId), privateList: false, shareWith: [])
            store.touch("imports")
            openList = l.id
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func load() async {
        do {
            let d = try await store.api.spendReceipt(receiptId)
            data = d
            tags = d.tags
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func toggle() async {
        do {
            if let ex = data?.exclusion {
                try await store.api.countAgain(ex.id)
                toast = ToastMessage(text: L("Counted again"))
            } else {
                try await store.api.excludeSpend(scope: "receipt", ref: String(receiptId), reason: reason.isEmpty ? nil : reason)
                toast = ToastMessage(text: L("Receipt no longer counts"))
            }
            reason = ""
            store.touch("imports")
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

// MARK: - one line

struct SpendLineView: View {
    let store: ServerStore
    let entry: SpendEntry
    let meta: SpendMeta?
    @Environment(\.dismiss) private var dismiss
    @State private var category = ""
    @State private var tags: [String] = []
    @State private var reason = ""
    @State private var whole = false
    @State private var toast: ToastMessage?

    var body: some View {
        Form {
            Section {
                LabeledContent(entry.store + " · " + SpendDates.longDay(entry.day) + ((entry.qty ?? 1) != 1 ? " · \(fmtQty(entry.qty ?? 1))×" : ""),
                               value: Money.format(entry.price))
                    .font(.subheadline)
            }
            Section {
                TextField(entry.categoryOriginal ?? L("Uncategorised"), text: $category)
                if let cats = meta?.categories, !cats.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) { ForEach(cats.prefix(20), id: \.self) { c in ChoiceChip(title: c, on: category == c) { category = c } } }
                    }
                }
            } header: { Text(L("Category in the statistics")) } footer: {
                Text(L("Only changes the statistics – the product keeps its category."))
            }
            Section { TagEditor(label: L("Tags"), values: $tags, suggestions: meta?.tags ?? []) }
            Section {
                Button(L("Save")) { Task { await save() } }
                if let pid = entry.productId {
                    NavigationLink { PriceHistoryView(store: store, productId: pid) } label: { Label(L("Price history"), systemImage: "chart.line.uptrend.xyaxis") }
                }
            }
            Section {
                if let ex = entry.excluded {
                    Text(LF("Not counted because of %@", scopeLabel(ex.scope)) + (ex.reason.map { ": \($0)" } ?? "") + ".")
                    if ex.scope == "line" || ex.scope == "product" {
                        Button(L("Count again")) { Task { await exclude() } }
                    } else {
                        Text(L("Change that in the list of things that are not counted.")).font(.caption).foregroundStyle(Theme.ink3)
                    }
                } else {
                    ReasonPicker(reason: $reason)
                    if entry.productId != nil { Toggle(L("Never count this product"), isOn: $whole) }
                    Button { Task { await exclude() } } label: { Label(L("Leave out"), systemImage: "eye.slash") }
                }
            } header: { Text(L("Don’t count in the statistics")) }
        }
        .themedList()
        .navigationTitle(entry.name)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            category = entry.categoryChanged == true ? entry.category : ""
            tags = entry.tags
        }
        .toast($toast)
    }

    private func fmtQty(_ q: Double) -> String { q.rounded() == q ? String(Int(q)) : String(q) }

    private func scopeLabel(_ s: String) -> String {
        switch s {
        case "line": return L("this item")
        case "receipt": return L("the whole receipt")
        case "product": return L("this product")
        case "category": return L("the category")
        case "store": return L("the shop")
        default: return L("this expense")
        }
    }

    private func save() async {
        do {
            let c = category.trimmingCharacters(in: .whitespaces)
            try await store.api.updateSpendLine(entry.id, category: c.isEmpty ? nil : c, tags: tags)
            store.touch("imports")
            dismiss()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func exclude() async {
        do {
            if let ex = entry.excluded {
                try await store.api.countAgain(ex.id)
            } else {
                let scope = whole && entry.productId != nil ? "product" : "line"
                try await store.api.excludeSpend(scope: scope, ref: String(scope == "product" ? entry.productId ?? 0 : entry.id), reason: reason.isEmpty ? nil : reason)
            }
            store.touch("imports")
            dismiss()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

// MARK: - budgets

struct BudgetsEditView: View {
    let store: ServerStore
    let meta: SpendMeta?
    @State private var rows: [BudgetsResponse.BudgetRow] = []
    @State private var category = ""
    @State private var period = "month"
    @State private var amount = ""
    @State private var notify = true
    @State private var busy = false
    @State private var toast: ToastMessage?

    var body: some View {
        Form {
            Section {
                Text(L("Entirely optional. A budget shows a bar and a calm forecast. If you like, you get a short note at 80 % and when it is reached."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if !rows.isEmpty {
                Section(L("Your budgets")) {
                    ForEach(rows) { b in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(b.category.isEmpty ? L("All spending") : b.category)
                                    Text(Money.format(b.amount) + " " + (b.period == "week" ? L("per week") : L("per month")))
                                        .font(.caption).foregroundStyle(Theme.ink3)
                                }
                                Spacer()
                                Toggle(L("Notify"), isOn: Binding(get: { b.notifies }, set: { v in
                                    Task { await save(category: b.category, period: b.period, amount: b.amount, notify: v) }
                                }))
                                .labelsHidden()
                                .accessibilityLabel(LF("Notify for %@", b.category.isEmpty ? L("All spending") : b.category))
                            }
                        }
                        .swipeActions {
                            Button(role: .destructive) {
                                Task { await save(category: b.category, period: b.period, amount: nil, notify: nil) }
                            } label: { Label(L("Remove"), systemImage: "trash") }
                        }
                    }
                }
            }
            Section(L("New budget")) {
                Picker(L("For"), selection: $category) {
                    Text(L("All spending")).tag("")
                    ForEach(meta?.categories ?? [], id: \.self) { Text($0).tag($0) }
                }
                TextField(category.isEmpty ? "600" : "40", text: $amount).keyboardType(.decimalPad)
                Picker(L("Period"), selection: $period) {
                    Text(L("per month")).tag("month")
                    Text(L("per week")).tag("week")
                }
                .pickerStyle(.segmented)
                Toggle(L("Notify at 80 % and 100 %"), isOn: $notify)
                Button(L("Save")) {
                    Task { await save(category: category, period: period, amount: Double(amount.replacingOccurrences(of: ",", with: ".")), notify: notify, clearField: true) }
                }
                .disabled(busy || (Double(amount.replacingOccurrences(of: ",", with: ".")) ?? 0) <= 0)
            }
        }
        .themedList()
        .navigationTitle(L("Budgets"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .toast($toast)
    }

    private func load() async { rows = (try? await store.api.spendBudgets().budgets) ?? rows }

    private func save(category: String, period: String, amount: Double?, notify: Bool?, clearField: Bool = false) async {
        busy = true
        defer { busy = false }
        do {
            try await store.api.setBudget(category: category.isEmpty ? nil : category, period: period, amount: amount, notify: notify)
            toast = ToastMessage(text: amount == nil ? L("Budget removed") : L("Budget saved"))
            if clearField { self.amount = "" }
            store.touch("imports")
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

// MARK: - left out

struct ExcludedListView: View {
    let store: ServerStore
    @State private var rows: [SpendExclusion]?
    @State private var toast: ToastMessage?

    var body: some View {
        List {
            Section {
                Text(L("These stay visible in the lists, greyed out, and are summed separately. Products and stock are not changed."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let rows {
                if rows.isEmpty {
                    EmptyStateView(art: .done, title: L("Everything counts"),
                                   message: L("Open a receipt line, a receipt, a category or a shop to leave it out – e.g. things bought for work or as a gift."))
                        .listRowBackground(Color.clear)
                }
                ForEach(rows) { x in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(x.label ?? x.ref?.value ?? "–")
                            Text([SpendExclusion.scopeName(x.scope), x.reason, (x.count ?? 0) > 0 ? Money.format(x.total) : nil].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer()
                        Button(L("Count again")) { Task { await restore(x.id) } }
                            .buttonStyle(.bordered)
                            .font(.caption.weight(.semibold))
                    }
                }
            } else {
                HStack { Spacer(); ProgressView(); Spacer() }
            }
        }
        .themedList()
        .navigationTitle(L("Left out"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .toast($toast)
    }

    private func load() async { rows = (try? await store.api.spendExclusions()) ?? [] }

    private func restore(_ id: Int) async {
        do {
            try await store.api.countAgain(id)
            toast = ToastMessage(text: L("Counted again"))
            store.touch("imports")
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

// MARK: - price history

struct PriceHistoryView: View {
    let store: ServerStore
    let productId: Int
    @State private var data: PriceHistory?
    @State private var shops: [ShopPrice] = []
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                if let error { ErrorBanner(message: error) { Task { await load() } } }
                if let p = data?.product { header(p) }
                if !shops.isEmpty { shopsCard }
                if let d = data {
                    if d.points.isEmpty {
                        EmptyStateView(art: .receipt, title: L("No comparable prices yet"), message: L("Weighed goods and items without a price are left out."))
                    } else {
                        if let c = d.change, c.direction != "same" {
                            HStack(spacing: Theme.Space.s3) {
                                Image(systemName: c.direction == "up" ? "arrow.up.right" : "arrow.down.right")
                                Text(String(format: "%@%.0f %%", c.pct > 0 ? "+" : "−", abs(c.pct))).fontWeight(.semibold)
                                Text((c.fromDate.map { LF("since %@", SpendDates.longDay(String($0.prefix(10)))) } ?? "") + ": \(Money.format(c.from)) → \(Money.format(c.to))")
                            }
                            .font(.subheadline)
                            .foregroundStyle(c.direction == "up" ? Theme.warning : Theme.primaryText)
                            .padding(Theme.Space.s3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(c.direction == "up" ? Theme.warningSoft : Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                        }
                        if d.points.count >= 2 {
                            Card {
                                Chart(d.points) { p in
                                    LineMark(x: .value(L("Date"), SpendDates.toDate(String(p.date.prefix(10)))), y: .value(L("Price"), p.unitPrice))
                                        .foregroundStyle(Theme.primary)
                                        .lineStyle(StrokeStyle(lineWidth: 2))
                                    PointMark(x: .value(L("Date"), SpendDates.toDate(String(p.date.prefix(10)))), y: .value(L("Price"), p.unitPrice))
                                        .foregroundStyle(Theme.primary)
                                }
                                .chartYAxis { AxisMarks(position: .leading) }
                                .frame(height: 160)
                            }
                        }
                        Card {
                            ForEach(d.points.reversed().prefix(12)) { p in
                                HStack {
                                    Text(SpendDates.longDay(String(p.date.prefix(10))) + (p.shop.map { " · \($0)" } ?? "")).font(.subheadline)
                                    Spacer()
                                    Text(Money.format(p.unitPrice)).font(.subheadline.monospacedDigit().weight(.semibold))
                                }
                            }
                        }
                        Text(LF("Spent in total: %@", Money.format(d.spentTotal ?? 0))).font(.caption).foregroundStyle(Theme.ink3)
                    }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(Theme.Space.s4)
        }
        .canvasBackground()
        .navigationTitle(data?.product?.name ?? L("Price history"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func header(_ p: PriceHistory.Product) -> some View {
        HStack(spacing: Theme.Space.s3) {
            RemoteImage(url: store.api.imageURL(p.imagePath), api: store.api, placeholder: "basket")
                .frame(width: 56, height: 56)
                .background(Theme.surface2)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name).font(Theme.title(Theme.FontSize.l)).foregroundStyle(Theme.ink)
                if let b = p.brand, !b.isEmpty { Text(b).font(.subheadline).foregroundStyle(Theme.ink3) }
            }
            Spacer(minLength: 0)
        }
    }

    /// GET /api/prices/product/:id – the latest price per shop, cheapest first ("Wo war's günstiger")
    private var shopsCard: some View {
        Card(title: L("Where it was cheaper"), systemImage: "storefront") {
            ForEach(Array(shops.enumerated()), id: \.offset) { i, s in
                HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.shop ?? "–").font(.subheadline.weight(i == 0 ? .semibold : .regular)).foregroundStyle(Theme.ink)
                        Text([s.day.map { SpendDates.longDay(String($0.prefix(10))) }, s.baseLabel].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                    Spacer(minLength: 0)
                    if i == 0 && shops.count > 1 {
                        Text(L("cheapest")).font(.caption.weight(.semibold)).foregroundStyle(Theme.primaryText)
                            .padding(.horizontal, 8).padding(.vertical, 2)
                            .background(Theme.primarySoft, in: Capsule())
                    }
                    Text(Money.format(s.price)).font(.subheadline.monospacedDigit().weight(.semibold)).foregroundStyle(Theme.ink)
                }
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func load() async {
        do { data = try await store.api.priceHistory(productId); error = nil }
        catch { self.error = APIError.from(error).localizedDescription }
        shops = (try? await store.api.prices(product: productId)) ?? []
    }
}

struct PricePickerView: View {
    let store: ServerStore
    @State private var all: [PricedProduct] = []
    @State private var loaded = false
    @State private var query = ""

    var body: some View {
        List {
            let q = query.lowercased()
            let list = all.filter { q.isEmpty || "\($0.brand ?? "") \($0.name)".lowercased().contains(q) }.prefix(60)
            ForEach(Array(list)) { p in
                NavigationLink { PriceHistoryView(store: store, productId: p.id) } label: {
                    HStack(spacing: Theme.Space.s3) {
                        RemoteImage(url: store.api.imageURL(p.imagePath), api: store.api, placeholder: "basket")
                            .frame(width: 36, height: 36).clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                        VStack(alignment: .leading) {
                            Text(p.name)
                            Text((p.purchases ?? 0) == 1 ? L("bought once") : LF("bought %d times", p.purchases ?? 0)).font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
            }
            if list.isEmpty && !all.isEmpty { Text(L("Nothing found.")).foregroundStyle(Theme.ink3) }
            if loaded && all.isEmpty {
                EmptyStateView(art: .receipt, title: L("No prices yet"),
                               message: L("Prices come from your receipts. Once the same thing shows up on a few receipts, you see here where it was cheaper."))
                    .listRowBackground(Color.clear)
            }
        }
        .themedList()
        .searchable(text: $query, prompt: L("Search products"))
        .navigationTitle(L("Price history"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            all = (try? await store.api.pricedProducts()) ?? []
            loaded = true
        }
    }
}
