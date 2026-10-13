import SwiftUI

// Geld wave 2 (q-money) – web: money/entry.tsx, money/lists.tsx. "Haushalt / Nur meins", badges, money lists
// ("Pizzaabend": split equally or by person, who paid, who gives whom), categories & sharing.

/// "Haushalt / Nur meins" – stored in SharedConfig "money.view" (Geld tab and the detail screen share it).
struct MoneyViewSwitch: View {
    @Binding var view: String

    var body: some View {
        Picker(L("Whose money"), selection: $view) {
            Text(L("Household")).tag("household")
            Text(L("Just mine")).tag("mine")
        }
        .pickerStyle(.segmented)
    }
}

/// Small marks on a spending row: personal, for one person, your part, attachment.
struct MoneyEntryBadges: View {
    let e: SpendEntry

    var body: some View {
        if let p = e.personal {
            badge(p.forName.map { LF("belongs to %@", $0) } ?? L("just mine"), "lock")
        } else if let n = e.forName {
            badge(LF("for %@", n), "person")
        }
        if e.part { badge(L("your part"), nil) }
        if e.hasAttachment {
            Image(systemName: "paperclip").font(.caption2).foregroundStyle(Theme.ink3).accessibilityLabel(L("with attachment"))
        }
    }

    private func badge(_ text: String, _ icon: String?) -> some View {
        HStack(spacing: 2) {
            if let icon { Image(systemName: icon).font(.system(size: 9)) }
            Text(text).lineLimit(1)
        }
        .font(.caption2.weight(.medium))
        .padding(.horizontal, 6).padding(.vertical, 2)
        .background(Theme.surface2, in: Capsule())
        .foregroundStyle(Theme.ink2)
    }
}

// MARK: - lists card (Geld tab)

struct MoneyListsCard: View {
    let lists: [MoneyListSummary]
    let onNew: () -> Void
    @State private var showDone = false

    var body: some View {
        Card(title: L("Splitting"), systemImage: "person.2") {
            let open = lists.filter { $0.settled != true }
            let done = lists.filter { $0.settled == true }
            if lists.isEmpty {
                Text(L("Pizza evening, barbecue, a weekend away: put the costs on a money list and see who gives whom how much."))
                    .font(.subheadline).foregroundStyle(Theme.ink2)
            }
            ForEach(open + (showDone ? done : [])) { l in
                NavigationLink(value: MoneyRoute.list(l.id)) {
                    HStack(alignment: .firstTextBaseline, spacing: Theme.Space.s2) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 4) {
                                if l.visibility == "private" { Image(systemName: "lock").font(.caption).accessibilityLabel(L("private")) }
                                Text(l.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                            }
                            Text(subline(l)).font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 0)
                        Text(Money.format(l.total)).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.ink)
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if !done.isEmpty {
                Button(showDone ? L("Hide settled lists") : LF("Show settled lists (%lld)", done.count)) { showDone.toggle() }
                    .font(.subheadline)
            }
            Button(action: onNew) { Label(L("New money list"), systemImage: "plus") }
                .buttonStyle(SecondaryButtonStyle())
        }
    }

    private func subline(_ l: MoneyListSummary) -> String {
        var parts = [l.people == 1 ? L("1 person") : LF("%lld people", l.people)]
        if let pp = l.perPerson, l.people > 1 { parts.append(LF("%@ each", Money.format(pp))) }
        if l.settled == true { parts.append(L("settled")) }
        else if let o = l.openTransfers, o > 0 { parts.append(o == 1 ? L("1 transfer open") : LF("%lld transfers open", o)) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - one money list

struct MoneyListView: View {
    let store: ServerStore
    let listId: Int
    @Environment(\.dismiss) private var dismiss
    @State private var list: MoneyList?
    @State private var meta: SpendMeta?
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var newName = ""
    @State private var newAmount = ""
    @State private var newPerson = ""
    @State private var confirmDelete = false
    @State private var share = false

    private func num(_ s: String) -> Double? { Double(s.replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: "")) }

    var body: some View {
        Form {
            if let error { Text(error).foregroundStyle(Theme.empty) }
            if let l = list {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(Money.format(l.split.total)).font(.system(size: 34, weight: .semibold, design: .rounded))
                        if let pp = l.split.perPerson, l.people.count > 1 {
                            Text(LF("%lld people · %@ each", l.people.count, Money.format(pp))).font(.subheadline).foregroundStyle(Theme.ink2)
                        }
                        if l.visibility == "private" {
                            Label(l.shareWith.isEmpty ? L("Private – only you see it") : L("Private"), systemImage: "lock").font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    Picker(L("How to split"), selection: Binding(get: { l.mode }, set: { m in Task { await run { try await store.api.updateMoneyList(listId, mode: m) } } })) {
                        Text(L("Equally")).tag("equal")
                        Text(L("By person")).tag("items")
                    }
                    .pickerStyle(.segmented)
                }
                Section {
                    ForEach(l.items) { i in itemRow(l, i) }
                        .onDelete { idx in
                            for n in idx { let item = l.items[n]; Task { await run { try await store.api.deleteMoneyListItem(listId, item: item.id) } } }
                        }
                    HStack {
                        TextField(L("What, e.g. drinks"), text: $newName)
                        TextField("0,00", text: $newAmount).keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(maxWidth: 90)
                            .accessibilityLabel(L("Amount"))
                        Button {
                            let n = newName.trimmingCharacters(in: .whitespaces)
                            let a = num(newAmount) ?? 0
                            Task {
                                await run { try await store.api.addMoneyListItem(listId, name: n, amount: a) }
                                newName = ""
                                newAmount = ""
                            }
                        } label: { Image(systemName: "plus.circle.fill").font(.title3) }
                            .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                            .accessibilityLabel(L("Add cost"))
                    }
                    if l.items.count > 1 && l.people.count > 1 {
                        Menu {
                            ForEach(l.people) { p in Button(p.name) { Task { await run { try await store.api.moneyListPaidAll(listId, by: p.id) } } } }
                        } label: { Label(L("Paid everything:"), systemImage: "creditcard") }
                    }
                } header: { Text(L("Costs")) }

                Section {
                    ForEach(l.split.people) { p in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(p.name).font(.subheadline.weight(.semibold))
                                Text(LF("paid %@ · share %@", Money.format(p.paid), Money.format(p.share))).font(.caption).foregroundStyle(Theme.ink3)
                            }
                            Spacer()
                            Text((p.balance > 0.004 ? "+" : "") + Money.format(p.balance))
                                .font(.subheadline.monospacedDigit().weight(.semibold))
                                .foregroundStyle(p.balance > 0.004 ? Theme.primaryText : Theme.ink)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    .onDelete { idx in
                        guard l.people.count > 1 else { return }
                        let gone = Set(idx.map { l.split.people[$0].id })
                        Task { await run { try await store.api.setMoneyListPeople(listId, l.people.filter { !gone.contains($0.id) }.map(personBody)) } }
                    }
                    HStack {
                        TextField(L("Add a person"), text: $newPerson)
                        Button {
                            let n = newPerson.trimmingCharacters(in: .whitespaces)
                            let m = meta?.members?.first { $0.name.lowercased() == n.lowercased() }
                            let add = m.map { MoneyPersonInput(userId: $0.id) } ?? MoneyPersonInput(name: n)
                            Task {
                                await run { try await store.api.setMoneyListPeople(listId, l.people.map(personBody) + [add]) }
                                newPerson = ""
                            }
                        } label: { Image(systemName: "plus.circle.fill").font(.title3) }
                            .disabled(newPerson.trimmingCharacters(in: .whitespaces).isEmpty)
                            .accessibilityLabel(L("Add a person"))
                    }
                } header: { Text(L("Who shares")) }

                Section {
                    if l.split.unpaid > 0.004 {
                        Text(LF("%@ without a payer yet – choose who paid for each cost.", Money.format(l.split.unpaid))).font(.caption).foregroundStyle(Theme.ink3)
                    }
                    if l.split.transfers.isEmpty, l.split.total > 0, l.split.unpaid < 0.005 {
                        Label(L("All even."), systemImage: "checkmark.circle").foregroundStyle(Theme.primaryText)
                    }
                    ForEach(l.split.transfers) { t in
                        HStack {
                            Text(LF("%@ gives %@ %@", t.fromName, t.toName, Money.format(t.amount))).font(.subheadline)
                            Spacer()
                            Button(L("Done")) { Task { await run { try await store.api.addMoneyListPayment(listId, from: t.from, to: t.to, amount: t.amount) } } }
                                .buttonStyle(.bordered)
                        }
                    }
                    ForEach(l.payments) { p in
                        HStack {
                            Text("✓ " + LF("%@ gave %@ %@", name(l, p.from), name(l, p.to), Money.format(p.amount))).font(.caption).foregroundStyle(Theme.ink2)
                            Spacer()
                            Button(L("Undo")) { Task { await run { try await store.api.deleteMoneyListPayment(listId, payment: p.id) } } }.font(.caption)
                        }
                    }
                    if !l.split.transfers.isEmpty {
                        Button { Task { await run { try await store.api.updateMoneyList(listId, settled: true) } } } label: {
                            Label(L("Everything is settled"), systemImage: "checkmark.circle")
                        }
                    } else if l.settledAt != nil {
                        Button(L("Open again")) { Task { await run { try await store.api.updateMoneyList(listId, settled: false) } } }
                    }
                } header: { Text(L("Settle up")) } footer: { Text(L("ToHuus never moves money – settle it however you like.")) }

                Section(L("Share")) {
                    Text(l.shareText).font(.caption).foregroundStyle(Theme.ink2).textSelection(.enabled)
                    ShareLink(item: l.shareText, subject: Text(l.title)) { Label(L("Share"), systemImage: "square.and.arrow.up") }
                    Button { UIPasteboard.general.string = l.shareText; toast = ToastMessage(text: L("Copied")) } label: {
                        Label(L("Copy text"), systemImage: "doc.on.doc")
                    }
                    if let url = mailURL(l) { Link(destination: url) { Label(L("E-mail"), systemImage: "envelope") } }
                }
                if l.mine == true {
                    Section {
                        Toggle(L("Only me"), isOn: Binding(get: { l.visibility == "private" }, set: { on in
                            Task { await run { try await store.api.updateMoneyList(listId, visibility: on ? "private" : "household") } }
                        }))
                        if l.visibility == "private" {
                            ForEach((meta?.members ?? []).filter { $0.id != meta?.me }) { m in
                                Toggle(LF("Also show to %@", m.name), isOn: Binding(get: { l.shareWith.contains(m.id) }, set: { on in
                                    let next = on ? l.shareWith + [m.id] : l.shareWith.filter { $0 != m.id }
                                    Task { await run { try await store.api.updateMoneyList(listId, shareWith: next) } }
                                }))
                            }
                        }
                    } header: { Text(L("Who sees the list?")) } footer: { Text(L("A private list never shows up for anyone else – handy for a present.")) }
                }
                Section { Button(L("Delete list"), role: .destructive) { confirmDelete = true } }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(list?.title ?? L("Money list"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
        .confirmationDialog(L("Delete this money list?"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(L("Delete"), role: .destructive) {
                Task {
                    do {
                        try await store.api.deleteMoneyList(listId)
                        store.touch("imports")
                        dismiss()
                    } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
                }
            }
        }
    }

    private func itemRow(_ l: MoneyList, _ i: MoneyList.Item) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(i.name).font(.subheadline)
                Spacer()
                AmountField(value: i.amount) { v in Task { await run { try await store.api.updateMoneyListItem(listId, item: i.id, amount: v) } } }
            }
            HStack {
                Picker(L("Paid by …"), selection: Binding(get: { i.paidBy }, set: { v in
                    Task { await run { try await store.api.updateMoneyListItem(listId, item: i.id, paidBy: .some(v)) } }
                })) {
                    Text(L("Paid by …")).tag(Int?.none)
                    ForEach(l.people) { p in Text(LF("%@ paid", p.name)).tag(Int?.some(p.id)) }
                }
                .labelsHidden()
                if l.mode == "items" {
                    Picker(L("For whom?"), selection: Binding(get: { i.forPerson }, set: { v in
                        Task { await run { try await store.api.updateMoneyListItem(listId, item: i.id, forPerson: .some(v)) } }
                    })) {
                        Text(L("for everyone")).tag(Int?.none)
                        ForEach(l.people) { p in Text(LF("for %@", p.name)).tag(Int?.some(p.id)) }
                    }
                    .labelsHidden()
                }
            }
            .font(.caption)
        }
    }

    private func personBody(_ p: MoneyList.Person) -> MoneyPersonInput { MoneyPersonInput(id: p.id, userId: p.userId, name: p.name) }

    private func name(_ l: MoneyList, _ id: Int) -> String { l.people.first { $0.id == id }?.name ?? "" }

    private func mailURL(_ l: MoneyList) -> URL? {
        var c = URLComponents()
        c.scheme = "mailto"
        c.queryItems = [URLQueryItem(name: "subject", value: l.title), URLQueryItem(name: "body", value: l.shareText)]
        return c.url
    }

    private func load() async {
        do {
            list = try await store.api.moneyList(listId)
            if meta == nil { meta = try? await store.api.spendMeta() }
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func run(_ fn: () async throws -> MoneyList) async {
        do {
            list = try await fn()
            store.touch("imports")
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// An amount that saves when you leave the field.
private struct AmountField: View {
    let value: Double
    let onSave: (Double) -> Void
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        TextField("0,00", text: $text)
            .keyboardType(.decimalPad)
            .multilineTextAlignment(.trailing)
            .font(.subheadline.monospacedDigit())
            .frame(maxWidth: 90)
            .focused($focused)
            .onAppear { text = String(format: "%.2f", value).replacingOccurrences(of: ".", with: ",") }
            .onChange(of: value) { _, v in text = String(format: "%.2f", v).replacingOccurrences(of: ".", with: ",") }
            .onChange(of: focused) { _, f in
                guard !f, let v = Double(text.replacingOccurrences(of: ",", with: ".")), abs(v - value) > 0.004 else { return }
                onSave(v)
            }
            .accessibilityLabel(L("Amount"))
    }
}

// MARK: - new list

struct NewMoneyListView: View {
    let store: ServerStore
    let onCreated: (Int) -> Void
    @State private var meta: SpendMeta?
    @State private var sources: MoneySources?
    @State private var title = ""
    @State private var kind = "empty"
    @State private var ref: Int?
    @State private var withNames = true
    @State private var picked: Set<Int> = []
    @State private var guests: [String] = []
    @State private var guest = ""
    @State private var count = 4
    @State private var privateList = false
    @State private var shareWith: Set<Int> = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section(L("Name")) { TextField(L("e.g. Pizza evening"), text: $title) }
            Section {
                Picker(L("What goes on it?"), selection: $kind) {
                    Text(L("I’ll type it")).tag("empty")
                    Text(L("A shopping list")).tag("shopping")
                    Text(L("A shopping trip")).tag("trip")
                    Text(L("A receipt")).tag("receipt")
                }
                if let s = sources {
                    switch kind {
                    case "shopping":
                        Picker(L("Which list?"), selection: $ref) {
                            ForEach(s.lists) { l in Text("\(l.name) (\(l.items))").tag(Int?.some(l.id)) }
                        }
                    case "trip":
                        if s.trips.isEmpty { Text(L("No shopping trips in the last two weeks.")).font(.caption).foregroundStyle(Theme.ink3) }
                        else {
                            Picker(L("Which shopping trip?"), selection: $ref) {
                                Text(L("Choose …")).tag(Int?.none)
                                ForEach(s.trips) { t in Text("\(t.user.name) · \(SpendDates.longDay(String(t.startedAt.prefix(10))))\(t.store.map { " · \($0)" } ?? "")").tag(Int?.some(t.id)) }
                            }
                        }
                    case "receipt":
                        if s.receipts.isEmpty { Text(L("No receipts yet.")).font(.caption).foregroundStyle(Theme.ink3) }
                        else {
                            Picker(L("Which receipt?"), selection: $ref) {
                                Text(L("Choose …")).tag(Int?.none)
                                ForEach(s.receipts) { r in Text("\(r.store) · \(SpendDates.longDay(r.day))").tag(Int?.some(r.id)) }
                            }
                        }
                    default: EmptyView()
                    }
                }
            } footer: { if kind == "shopping" { Text(L("Prices come from your last receipts – you can change every amount.")) } }
            Section(L("Who shares?")) {
                Picker(L("Who shares?"), selection: $withNames) {
                    Text(L("With names")).tag(true)
                    Text(L("Just a number")).tag(false)
                }
                .pickerStyle(.segmented)
                if withNames {
                    ForEach(meta?.members ?? []) { m in
                        Toggle(m.name, isOn: Binding(get: { picked.contains(m.id) }, set: { on in if on { picked.insert(m.id) } else { picked.remove(m.id) } }))
                    }
                    ForEach(guests, id: \.self) { g in Text(g) }
                        .onDelete { guests.remove(atOffsets: $0) }
                    HStack {
                        TextField(L("Someone else, e.g. Ben"), text: $guest)
                        Button {
                            guests.append(guest.trimmingCharacters(in: .whitespaces))
                            guest = ""
                        } label: { Image(systemName: "plus.circle.fill").font(.title3) }
                            .disabled(guest.trimmingCharacters(in: .whitespaces).isEmpty)
                            .accessibilityLabel(L("Add a person"))
                    }
                } else {
                    Stepper(count == 1 ? L("1 person") : LF("%lld people", count), value: $count, in: 1...40)
                }
            }
            Section {
                Toggle(L("Only me"), isOn: $privateList)
                if privateList {
                    ForEach((meta?.members ?? []).filter { $0.id != meta?.me }) { m in
                        Toggle(LF("Also show to %@", m.name), isOn: Binding(get: { shareWith.contains(m.id) }, set: { on in if on { shareWith.insert(m.id) } else { shareWith.remove(m.id) } }))
                    }
                }
            } header: { Text(L("Who sees the list?")) } footer: { Text(L("A private list never shows up for anyone else – handy for a present.")) }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            Section {
                Button { Task { await create() } } label: { HStack { Text(L("Create money list")); if busy { Spacer(); ProgressView() } } }
                    .disabled(busy || !ready)
            }
        }
        .navigationTitle(L("New money list"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            meta = try? await store.api.spendMeta()
            picked = Set((meta?.members ?? []).map(\.id))
            sources = try? await store.api.moneySources()
        }
        .onChange(of: kind) { _, k in ref = k == "shopping" ? sources?.lists.first?.id : nil }
    }

    private var ready: Bool {
        let people = withNames ? picked.count + guests.count : count
        return people >= 1 && (kind == "empty" || ref != nil)
    }

    private func create() async {
        busy = true
        defer { busy = false }
        let from: MoneySource? = {
            guard let r = ref else { return nil }
            switch kind {
            case "shopping": return .shopping(listId: r)
            case "trip": return .trip(r)
            case "receipt": return .receipt(r)
            default: return nil
            }
        }()
        let people: [MoneyPersonInput]? = withNames
            ? (meta?.members ?? []).filter { picked.contains($0.id) }.map { MoneyPersonInput(userId: $0.id) } + guests.map { MoneyPersonInput(name: $0) }
            : nil
        do {
            let l = try await store.api.createMoneyList(title: title.trimmingCharacters(in: .whitespaces), people: people, count: withNames ? nil : count,
                                                        from: from, privateList: privateList, shareWith: Array(shareWith))
            store.touch("imports")
            onCreated(l.id)
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

// MARK: - categories & sharing

struct MoneySettingsView: View {
    let store: ServerStore
    @State private var meta: SpendMeta?
    @State private var renaming: String?
    @State private var newName = ""
    @State private var add = ""
    @State private var toast: ToastMessage?

    var body: some View {
        Form {
            Section {
                ForEach(meta?.moneyCategories ?? [], id: \.self) { c in
                    if renaming == c {
                        HStack {
                            TextField(LF("New name for %@", c), text: $newName)
                            Button(L("Save")) { Task { await run { try await store.api.renameMoneyCategory(from: c, to: newName) }; renaming = nil } }
                                .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    } else {
                        Button { renaming = c; newName = c } label: { Text(c).foregroundStyle(Theme.ink) }
                            .accessibilityHint(L("Rename"))
                    }
                }
                .onDelete { idx in
                    guard let cats = meta?.moneyCategories, cats.count > 1 else { return }
                    let gone = Set(idx.map { cats[$0] })
                    Task { await run { try await store.api.setMoneyCategories(cats.filter { !gone.contains($0) }) } }
                }
                HStack {
                    TextField(L("New category, e.g. Garden"), text: $add)
                    Button(L("Add")) {
                        let cats = meta?.moneyCategories ?? []
                        let n = add.trimmingCharacters(in: .whitespaces)
                        Task { await run { try await store.api.setMoneyCategories(cats + [n]) }; add = "" }
                    }
                    .disabled(add.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } header: { Text(L("Categories")) } footer: { Text(L("Categories for your own entries. Renaming changes them everywhere, also in budgets.")) }
            if (meta?.members?.count ?? 0) > 1 {
                Section {
                    Toggle(L("Leave items for one person out of the household numbers"), isOn: Binding(get: { meta?.assignedOut ?? false }, set: { on in
                        Task { await run { try await store.api.setAssignedOut(on) } }
                    }))
                } footer: { Text(L("E.g. the cola that belongs to Sam. They still show on the receipt and in “Just mine”.")) }
            }
        }
        .navigationTitle(L("Categories & sharing"))
        .navigationBarTitleDisplayMode(.inline)
        .task { meta = try? await store.api.spendMeta() }
        .toast($toast)
    }

    private func run(_ fn: () async throws -> Void) async {
        do {
            try await fn()
            meta = try? await store.api.spendMeta()
            store.touch("imports")
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}
