import SwiftUI

/// GET /api/quality/stats
struct RecognitionStats: Decodable, Sendable {
    var imports: Int?
    var lines: Int?
    var share: Double?
    var learned: Int?
    var corrected: Int?
    var unknown: Int?
    @Lossy var stores: [Store]
    @Lossy var recent: [Recent]
    var rules: Int?

    struct Store: Decodable, Sendable, Hashable {
        var store: String?
        var imports: Int?
        var lines: Int?
        var share: Double?
    }

    struct Recent: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var shop: String?
        var createdAt: String?
        var lines: Int?
        var share: Double?
    }
}

/// GET /api/quality/rules → { rules, units }
struct RecognitionRules: Decodable, Sendable {
    @Lossy var rules: [RecognitionRule]
}

struct RecognitionRule: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    /// line | store
    var kind: String?
    var store: String?
    var example: String?
    var productId: Int?
    var productName: String?
    var qtyFactor: Double?
    var unit: String?
    var ignore: Bool?
    var storeName: String?
    var hits: Int?
    var updatedAt: String?
    var lastUsedAt: String?
}

/// The share of recognised lines as "87 %".
func percentText(_ share: Double?) -> String {
    guard let share else { return "–" }
    return "\(Int((share * 100).rounded())) %"
}

/// Bon-Erkennung (web: pages/Recognition.tsx, /import/quality): how well receipts are read – overall and per store,
/// calm numbers, nothing per person – and the rules learned from corrections, editable and deletable.
/// GET /api/quality/stats, GET /api/quality/rules, PATCH/DELETE /api/quality/rules/:id.
struct ReceiptRecognitionView: View {
    let store: ServerStore
    @State private var stats: RecognitionStats?
    @State private var rules: [RecognitionRule] = []
    @State private var statsError: String?
    @State private var rulesError: String?
    @State private var editing: RecognitionRule?
    @State private var toast: ToastMessage?
    @State private var loaded = false

    private var api: APIClient { store.api }

    var body: some View {
        List {
            if let statsError {
                Section {
                    Text(L("Could not load the numbers.")).foregroundStyle(Theme.empty)
                    Text(statsError).font(.caption).foregroundStyle(Theme.ink3)
                    Button(L("Try again")) { Task { await load() } }
                }
            } else if let s = stats, (s.imports ?? 0) > 0 {
                overview(s)
                Section {
                    ForEach(s.stores, id: \.self) { st in
                        VStack(alignment: .leading, spacing: Theme.Space.s1) {
                            HStack {
                                Label(st.store ?? L("Store unknown"), systemImage: "storefront")
                                Spacer()
                                Text(percentText(st.share)).font(.subheadline.monospacedDigit())
                            }
                            ProgressView(value: min(max(st.share ?? 0, 0), 1)).tint(Theme.primary)
                            Text([count(st.imports ?? 0, one: L("1 receipt"), many: "%d receipts"), count(st.lines ?? 0, one: L("1 line"), many: "%d lines")].joined(separator: " · "))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        .accessibilityElement(children: .combine)
                    }
                } header: {
                    Text(L("By store"))
                }
            } else if loaded {
                Section {
                    EmptyStateView(art: .receipt, title: L("No receipts yet"),
                                   message: L("Once a few receipts are in, you see here how many lines were recognised without anybody having to correct them."))
                }
            }
            Section {
                if let rulesError {
                    Text(L("Could not load the rules.")).foregroundStyle(Theme.empty)
                    Text(rulesError).font(.caption).foregroundStyle(Theme.ink3)
                } else if loaded, rules.isEmpty {
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        Label(L("Nothing learned yet"), systemImage: "sparkles").font(.headline)
                        Text(L("When you correct a line while checking an import – another product, a pack of 10, “skip the carrier bag” – ToHuus Hub remembers it for this household and does it on its own next time."))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                    }
                }
                ForEach(rules) { r in
                    Button { editing = r } label: {
                        HStack(spacing: Theme.Space.s3) {
                            Image(systemName: r.kind == "store" ? "storefront" : "doc.plaintext").foregroundStyle(Theme.ink2).frame(width: 24).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(r.example ?? "–").font(.subheadline.monospaced()).lineLimit(2)
                                Text(Self.ruleText(r)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                            Spacer()
                            if let h = r.hits, h > 0 { Text(LF("used %d×", h)).font(.caption).foregroundStyle(Theme.ink3) }
                        }
                    }
                    .foregroundStyle(Theme.ink)
                    .swipeActions {
                        Button(role: .destructive) { Task { await forget(r) } } label: { Label(L("Forget"), systemImage: "trash") }
                    }
                }
            } header: {
                HStack {
                    Text(L("Learned from your corrections"))
                    Spacer()
                    if !rules.isEmpty { Text(rules.count == 1 ? L("1 rule") : LF("%d rules", rules.count)) }
                }
            } footer: {
                Text(L("Rules stay in this household. Nothing is shared – unless you send an anonymised receipt yourself via “Help improve recognition” in an import."))
            }
        }
        .themedList()
        .navigationTitle(L("Receipt recognition"))
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
        .sheet(item: $editing) { r in
            RecognitionRuleSheet(store: store, rule: r) { text in
                if let text { toast = ToastMessage(text: text) }
                Task { await load() }
            }
        }
    }

    private func overview(_ s: RecognitionStats) -> some View {
        Section {
            VStack(alignment: .leading, spacing: Theme.Space.s2) {
                Text(percentText(s.share)).font(.system(size: 44, weight: .semibold, design: .rounded)).foregroundStyle(Theme.primaryText)
                Text(LF("of the lines on the last %d receipts were recognised without a correction.", s.imports ?? 0))
                    .font(.subheadline)
                ProgressView(value: min(max(s.share ?? 0, 0), 1)).tint(Theme.primary)
                Text(details(s)).font(.caption).foregroundStyle(Theme.ink3)
            }
            .padding(.vertical, Theme.Space.s1)
            .accessibilityElement(children: .combine)
            if s.recent.count > 2 {
                HStack(alignment: .bottom, spacing: 4) {
                    ForEach(s.recent) { r in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Theme.primary.opacity(0.75))
                            .frame(maxWidth: .infinity)
                            .frame(height: max(6, CGFloat(r.share ?? 0) * 56))
                            .accessibilityLabel("\(r.shop ?? L("Store unknown")) · \(ServerDate.parse(r.createdAt)?.formatted(date: .abbreviated, time: .omitted) ?? "") · \(percentText(r.share))")
                    }
                }
                .frame(height: 60, alignment: .bottom)
                .accessibilityElement(children: .contain)
                .accessibilityLabel(L("Recent receipts"))
            }
        }
    }

    private func details(_ s: RecognitionStats) -> String {
        var parts: [String] = []
        if let n = s.learned, n > 0 { parts.append(LF("%d lines came from rules you taught", n)) }
        if let n = s.corrected, n > 0 { parts.append(LF("%d lines were corrected", n)) }
        if let n = s.unknown, n > 0 { parts.append(LF("%d lines were new or not recognised", n)) }
        return parts.isEmpty ? L("Nothing had to be corrected.") : parts.joined(separator: " · ")
    }

    private func count(_ n: Int, one: String, many: String) -> String { n == 1 ? one : LF(many, n) }

    static func unitLabel(_ u: String) -> String { u == "Stk" ? L("pcs") : u == "Pck" ? L("pack") : u }

    static func ruleText(_ r: RecognitionRule) -> String {
        if r.kind == "store" { return LF("is %@", r.storeName ?? "") }
        var parts: [String] = []
        if r.ignore == true { parts.append(L("skipped")) }
        if let p = r.productName { parts.append("→ \(p)") }
        if let q = r.qtyFactor { parts.append(LF("counts as %@", q.formatted())) }
        if let u = r.unit { parts.append(unitLabel(u)) }
        parts.append(r.store.map { LF("only at %@", $0) } ?? L("at every store"))
        return parts.joined(separator: " · ")
    }

    private func load() async {
        defer { loaded = true }
        do {
            stats = try await api.get("api/quality/stats", query: [URLQueryItem(name: "limit", value: "20")], as: RecognitionStats.self)
            statsError = nil
        } catch { statsError = APIError.from(error).localizedDescription }
        do {
            rules = try await api.get("api/quality/rules", as: RecognitionRules.self).rules
            rulesError = nil
        } catch { rulesError = APIError.from(error).localizedDescription }
    }

    private func forget(_ r: RecognitionRule) async {
        do {
            _ = try await api.send("DELETE", "api/quality/rules/\(r.id)", as: Ignored.self)
            toast = ToastMessage(text: L("Forgotten. The next receipts are read without this rule."))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// One learned rule: skip the line, the product, how many one line counts as, the unit, at every store; or a store
/// name for a store rule. Forgetting it is one tap.
struct RecognitionRuleSheet: View {
    let store: ServerStore
    @State var rule: RecognitionRule
    let onDone: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var storeName = ""
    @State private var pack = ""
    @State private var picking = false
    @State private var error: String?

    private let units = ["Stk", "g", "kg", "ml", "l", "Pck"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(rule.example ?? "–").font(.subheadline.monospaced()).textSelection(.enabled)
                }
                if rule.kind == "store" {
                    Section {
                        TextField(L("Store name"), text: $storeName)
                        Button(L("Save")) { Task { await save(["store_name": storeName.trimmingCharacters(in: .whitespaces)], close: true) } }
                            .disabled(storeName.trimmingCharacters(in: .whitespaces).isEmpty)
                    } header: { Text(L("Store name")) }
                } else {
                    Section {
                        Toggle(isOn: Binding(get: { rule.ignore == true }, set: { v in Task { await save(["ignore": v]) } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Skip this line"))
                                Text(L("For carrier bags, vouchers and things that never go into stock.")).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .tint(Theme.primary)
                    }
                    if rule.ignore != true {
                        Section {
                            Button { picking = true } label: {
                                LabeledContent(L("Product"), value: rule.productName ?? L("Choose product"))
                            }
                            .foregroundStyle(Theme.ink)
                            HStack {
                                TextField("1", text: $pack).keyboardType(.numberPad)
                                    .onChange(of: pack) { _, v in let d = v.filter(\.isNumber); if d != v { pack = d } }
                                Button(L("Save")) {
                                    let body: [String: Any] = ["qty_factor": Int(pack).map { $0 as Any } ?? NSNull()]
                                    Task { await save(body) }
                                }
                                .buttonStyle(.borderless)
                            }
                            Picker(L("Unit"), selection: Binding(get: { rule.unit ?? "Stk" }, set: { u in
                                let value: Any = u == "Stk" ? (NSNull() as Any) : (u as Any)
                                let body: [String: Any] = ["unit": value]
                                Task { await save(body) }
                            })) {
                                ForEach(units, id: \.self) { u in Text(ReceiptRecognitionView.unitLabel(u)).tag(u) }
                            }
                        } footer: {
                            Text(L("One receipt line counts as"))
                        }
                    }
                    Section {
                        Toggle(isOn: Binding(get: { rule.store == nil }, set: { v in if v { Task { await save(["all_stores": true]) } } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("At every store"))
                                Text(rule.store.map { LF("Learned at %@.", $0) } ?? L("Applies everywhere.")).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .tint(Theme.primary)
                        .disabled(rule.store == nil)
                    }
                }
                Section {
                    Text(rule.lastUsedAt.flatMap { ServerDate.parse($0) }.map { LF("Last used %@.", $0.formatted(date: .abbreviated, time: .omitted)) } ?? L("Not used yet."))
                        .font(.caption).foregroundStyle(Theme.ink3)
                    Button(role: .destructive) { Task { await forget() } } label: { Label(L("Forget this rule"), systemImage: "trash") }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Learned rule"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { onDone(nil); dismiss() } } }
            .onAppear {
                storeName = rule.storeName ?? ""
                pack = rule.qtyFactor.map { String(Int($0)) } ?? ""
            }
            .sheet(isPresented: $picking) {
                ProductPickSheet(store: store, initial: rule.productName ?? "") { choice in
                    if case .product(let p) = choice { Task { await save(["product_id": p.id, "ignore": false]) } }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save(_ body: [String: Any], close: Bool = false) async {
        do {
            rule = try await store.api.send("PATCH", "api/quality/rules/\(rule.id)", json: body, as: RecognitionRule.self)
            error = nil
            if close { onDone(L("Saved")); dismiss() }
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func forget() async {
        do {
            _ = try await store.api.send("DELETE", "api/quality/rules/\(rule.id)", as: Ignored.self)
            onDone(L("Forgotten. The next receipts are read without this rule."))
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
