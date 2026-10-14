import SwiftUI

/// What the web's product page has around the stock card (web: pages/FreshParts.tsx FreshPanel, Share.tsx RunsOutRow,
/// Leftovers.tsx PutAwayButton): eaten / opened / freeze / thaw / thrown away for the whole product, the run-out
/// estimate, when it was last checked, the shelf life after opening and in the freezer, "runs out regularly", and
/// portioning into labelled boxes.
struct FreshActionsCard: View {
    let product: ProductInfo
    let more: ProductMore
    let fresh: FreshProduct?
    let freshMore: FreshMore?
    let store: ServerStore
    /// toast text; the page reloads
    let changed: (String) -> Void
    /// a leftover that was eaten up: the page can go back
    var eatenUp: () -> Void = {}
    @State private var sheet: Sheet?
    @State private var busy = false

    enum Sheet: String, Identifiable {
        case freeze, thaw, waste, shelf
        var id: String { rawValue }
    }

    private var entries: [FreshProduct.Entry] { fresh?.entries ?? [] }

    var body: some View {
        Card(title: L("Keep it fresh"), systemImage: "leaf") {
            FlowLayout(spacing: 8) {
                if more.isLeftover {
                    action(L("Eaten"), "fork.knife", primary: true) { Task { await eat() } }
                } else if fresh?.canOpen == true {
                    action(L("Opened"), "drop") { Task { await open() } }
                }
                if fresh?.canFreeze == true && fresh?.hasFreezer == true {
                    action(L("Freeze"), "snowflake") { sheet = .freeze }
                }
                if fresh?.canThaw == true {
                    action(L("Thaw"), "sun.max") { sheet = .thaw }
                }
                if (product.total ?? 0) > 0 {
                    action(L("Thrown away"), "trash") { sheet = .waste }
                }
            }
            .disabled(busy)
            if let f = freshMore?.forecast {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        StatusPill(text: L("Estimate"), status: nil)
                        Text(f.daysLeft <= 0 ? L("probably running out about now") : LF("probably running out in ~%d days", f.daysLeft))
                            .font(.subheadline)
                    }
                    Text(f.method == "usage"
                         ? LF("From %d booked uses (about %@ %@ per week). Stock is never changed automatically.", f.basis ?? 0, num(f.perWeek ?? 0), product.unit ?? "")
                         : LF("From %d purchases – usage is rarely booked, so this is rough. Stock is never changed automatically.", f.basis ?? 0))
                        .font(.caption).foregroundStyle(Theme.ink3)
                }
            }
            HStack {
                Text(checkedLine).font(.caption).foregroundStyle(Theme.ink3)
                Spacer()
                if !more.isLeftover {
                    Button(freshMore?.openDays.map { LF("%d days after opening", $0) } ?? L("Shelf life")) { sheet = .shelf }
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: 44)
                } else if let r = freshMore?.recipeId {
                    NavigationLink { RecipeDetailView(recipeId: r, store: store) } label: { Label(L("Recipe"), systemImage: "arrow.right") }
                        .font(.caption.weight(.semibold))
                        .frame(minHeight: 44)
                }
            }
        }
        .sheet(item: $sheet) { s in
            switch s {
            case .freeze, .thaw:
                let thaw = s == .thaw
                let max = entries.filter { thaw ? $0.inFreezer == true : $0.inFreezer != true }.reduce(0.0) { $0 + ($1.qty ?? 0) }
                FreshQtySheet(
                    title: thaw ? LF("Take %@ out of the freezer", product.name) : LF("Freeze %@", product.name),
                    max: max, initial: thaw ? 1 : nil, unit: product.unit ?? "", level: product.isLevel,
                    help: thaw ? L("Goes back where it came from, to be eaten within 1–2 days.")
                        : LF("Keeps about %d days in the freezer – the best-before date is set accordingly.", freshMore?.freezerDays ?? freshMore?.defaultFreezerDays ?? fresh?.freezerDays ?? fresh?.defaultFreezerDays ?? 90),
                    cta: thaw ? L("Thaw") : L("Freeze")
                ) { qty in Task { await freezeOrThaw(thaw ? "thaw" : "freeze", qty) } }
            case .waste:
                WasteSheet(product: product) { qty, reason in Task { await waste(qty, reason) } }
            case .shelf:
                ShelfLifeSheet(productId: product.id, fresh: freshMore, api: store.api) {
                    store.touch("stock")
                    changed(L("Saved"))
                }
            }
        }
    }

    private var checkedLine: String {
        guard let at = freshMore?.confirmedAt, !at.isEmpty else { return L("never checked") }
        let s = CheckText.since(freshMore?.confirmedDays, checked: true)
        return [s, freshMore?.confirmedBy].compactMap { $0 }.joined(separator: " · ")
    }

    private func num(_ v: Double) -> String { v.formatted(.number.precision(.fractionLength(0...1))) }

    private func action(_ title: String, _ icon: String, primary: Bool = false, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14).padding(.vertical, 10)
                .foregroundStyle(primary ? Theme.onPrimary : Theme.ink)
                .background(primary ? Theme.primary : Theme.surface2, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .frame(minHeight: 44)
    }

    private func eat() async {
        busy = true
        defer { busy = false }
        do {
            let left = try await store.api.eatLeftover(product.id)
            Haptics.success()
            store.touch("stock", "products")
            changed(LF("Enjoy – %@ is marked as eaten", product.name))
            if left <= 0 { eatenUp() }
        } catch { changed(APIError.from(error).localizedDescription) }
    }

    private func open() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.freshAction(product.id, "open", entryId: nil)
            Haptics.success()
            store.touch("stock")
            changed(r.useBy.flatMap { ServerDate.shortDay($0) }.map { LF("Opened – use by %@", $0) } ?? L("Marked as opened"))
        } catch { changed(APIError.from(error).localizedDescription) }
    }

    private func freezeOrThaw(_ action: String, _ qty: Double?) async {
        do {
            let r = try await store.api.freezeOrThaw(product.id, action, qty: qty)
            Haptics.success()
            store.touch("stock")
            if action == "thaw" {
                changed(r.eatBy.flatMap { ServerDate.shortDay($0) }.map { LF("Thawed – eat by %@", $0) } ?? L("Thawed"))
            } else {
                changed(r.bestBefore.flatMap { ServerDate.shortDay($0) }.map { LF("Frozen – keeps until %@", $0) } ?? L("Frozen"))
            }
        } catch { changed(APIError.from(error).localizedDescription) }
    }

    private func waste(_ qty: Double?, _ reason: String) async {
        do {
            try await store.api.wasteProduct(product.id, qty: qty, reason: reason)
            Haptics.success()
            store.touch("stock", "products")
            changed(L("Noted. Thanks for logging it."))
        } catch { changed(APIError.from(error).localizedDescription) }
    }
}

/// How many to freeze or thaw (web QtySheet).
struct FreshQtySheet: View {
    let title: String
    let max: Double
    let initial: Double?
    let unit: String
    let level: Bool
    let help: String
    let cta: String
    let save: (Double?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var qty: Double = 1

    var body: some View {
        NavigationStack {
            Form {
                if !level && max > 1 {
                    Stepper(value: $qty, in: 1...Swift.max(1, max), step: 1) {
                        LabeledContent(L("How many?"), value: "\(qty.formatted()) \(unit)")
                    }
                }
                Section {
                    Button(cta) { save(level ? nil : Swift.min(qty, max)); dismiss() }
                        .buttonStyle(PrimaryButtonStyle())
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                } footer: {
                    Text(help)
                }
            }
            .themedList()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .onAppear { qty = Swift.max(1, Swift.min(max, initial ?? max)) }
        }
        .presentationDetents([.medium])
    }
}

/// "Thrown away" with how many and why (web WasteSheet) – helps to see patterns, POST /api/fresh/products/:id/waste.
struct WasteSheet: View {
    let product: ProductInfo
    let save: (Double?, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var qty: Double = 1
    @State private var reason = "expired"

    private var total: Double { product.total ?? 0 }
    private var counted: Bool { product.trackMode == nil || product.trackMode == "count" }

    var body: some View {
        NavigationStack {
            Form {
                if counted && total > 1 {
                    Stepper(value: $qty, in: 1...Swift.max(1, total), step: 1) {
                        LabeledContent(L("How many?"), value: "\(qty.formatted()) \(product.unit ?? "")")
                    }
                }
                Section {
                    FlowLayout(spacing: 8) {
                        ForEach(CheckText.wasteReasons, id: \.0) { r in
                            ChoiceChip(title: r.1, on: reason == r.0) { reason = r.0 }
                        }
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text(L("Why? (optional – helps to see patterns)"))
                }
                Section {
                    Button(L("Log it")) { save(counted ? Swift.min(qty, total) : nil, reason); dismiss() }
                        .buttonStyle(PrimaryButtonStyle())
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
            }
            .themedList()
            .navigationTitle(L("Thrown away"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .onAppear { qty = Swift.max(1, total) }
        }
        .presentationDetents([.medium, .large])
    }
}

/// Days after opening and days in the freezer for this product (web ShelfSheet, PATCH /api/fresh/products/:id).
struct ShelfLifeSheet: View {
    let productId: Int
    let fresh: FreshMore?
    let api: APIClient
    let saved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var opened = ""
    @State private var frozen = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(fresh?.defaultDaysAfterOpening.map { LF("Default: %d days", $0) } ?? L("No rule – keeps until best-before"), text: $opened)
                        .keyboardType(.numberPad)
                } header: {
                    Text(L("Days after opening"))
                } footer: {
                    Text(L("Used for warnings once a pack is opened. 0 = no limit after opening."))
                }
                Section {
                    TextField(LF("Default: %d days", fresh?.defaultFreezerDays ?? 90), text: $frozen)
                        .keyboardType(.numberPad)
                } header: {
                    Text(L("Days in the freezer"))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Shelf life"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Save")) { Task { await save() } } }
            }
            .onAppear {
                opened = fresh?.daysAfterOpening.map(String.init) ?? ""
                frozen = fresh?.freezerDays.map(String.init) ?? ""
            }
            .onChange(of: opened) { _, v in let d = v.filter(\.isNumber); if d != v { opened = d } }
            .onChange(of: frozen) { _, v in let d = v.filter(\.isNumber); if d != v { frozen = d } }
        }
        .presentationDetents([.medium])
    }

    private func save() async {
        let o = Int(opened).map { Swift.max(0, $0) }
        let f = Int(frozen).map { Swift.max(1, $0) }
        do {
            try await api.setShelfLife(productId, daysAfterOpening: o, freezerDays: f)
            saved()
            dismiss()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}

/// "Runs out regularly" (web RunsOutRow): used by the start mode "only what runs out".
struct RunsOutRow: View {
    let productId: Int
    let on: Bool
    let api: APIClient
    let changed: () -> Void
    @State private var value = false
    @State private var staples = false
    @State private var error: String?

    var body: some View {
        Card {
            Toggle(isOn: Binding(get: { value }, set: { v in Task { await set(v) } })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Runs out regularly")).font(.subheadline.weight(.semibold))
                    Text(staples ? (value ? L("Tracked – you’ll be reminded when it runs low.") : L("Not tracked right now: your household only tracks what runs out."))
                         : L("Used by the start mode “only what runs out”."))
                        .font(.caption).foregroundStyle(Theme.ink3)
                    if let error { Text(error).font(.caption).foregroundStyle(Theme.empty) }
                }
            }
            .tint(Theme.primary)
        }
        .onAppear { value = on }
        .onChange(of: on) { _, v in value = v }
        .task { staples = (try? await api.stockStartMode()) == "staples" }
    }

    private func set(_ v: Bool) async {
        value = v
        do {
            try await api.markRunsOut(productId, v)
            error = nil
            changed()
        } catch {
            value = !v
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// Portion into labelled boxes (web PutAwayButton on the product): how many portions and containers, fridge or
/// freezer – the boxes get codes and the labels can be printed right away.
struct PortionLabelSheet: View {
    let product: ProductInfo
    let leftover: Bool
    let hasFreezer: Bool
    let api: APIClient
    let done: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var portions = 1
    @State private var boxes = 1
    @State private var place = "freezer"
    @State private var created: [BoxPick] = []
    @State private var busy = false
    @State private var error: String?
    @State private var file: LabelSheetFile?

    var body: some View {
        NavigationStack {
            Form {
                if created.isEmpty {
                    Section {
                        Stepper(value: $portions, in: 1...50) {
                            LabeledContent(L("Portions"), value: "\(portions)")
                        }
                        Stepper(value: $boxes, in: 1...Swift.max(1, Swift.min(12, portions))) {
                            LabeledContent(L("Containers"), value: "\(boxes)")
                        }
                        if hasFreezer {
                            Picker(L("Where to?"), selection: $place) {
                                Label(L("Fridge"), systemImage: "refrigerator").tag("fridge")
                                Label(L("Freezer"), systemImage: "snowflake").tag("freezer")
                            }
                            .pickerStyle(.segmented)
                        }
                    } footer: {
                        Text(L("Each container gets its own label with name, date, eat-by and a QR code."))
                    }
                    Section {
                        Button {
                            Task { await save() }
                        } label: { Label(L("Put away"), systemImage: "tag") }
                            .buttonStyle(PrimaryButtonStyle())
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                            .disabled(busy)
                    }
                } else {
                    Section {
                        ForEach(created) { b in
                            LabeledContent(b.name, value: b.prettyCode).font(.subheadline.monospaced())
                        }
                    } header: {
                        Text(L("Put away – the labels"))
                    }
                    Section {
                        Button { Task { await sheet(print: true) } } label: { Label(L("Print labels"), systemImage: "printer") }
                        Button { Task { await sheet(print: false) } } label: { Label(L("Share the PDF"), systemImage: "square.and.arrow.up") }
                    } footer: {
                        Text(L("Print the label or write the code on the lid. Scanning it later shows what's inside."))
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(leftover || !hasFreezer ? L("Label leftovers") : L("Portion, freeze, label"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(created.isEmpty ? L("Cancel") : L("Done")) { dismiss() } }
            }
            .onAppear {
                place = leftover || !hasFreezer ? "fridge" : "freezer"
                let total = Int((product.total ?? 1).rounded())
                portions = product.trackMode == "count" && total > 0 ? (leftover ? total : 1) : 1
            }
            .sheet(item: $file) { f in LabelSheetPreview(file: f) }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            created = try await api.portionProduct(productId: product.id, name: product.name, portions: Double(portions),
                                                   boxes: Swift.min(boxes, portions), place: hasFreezer ? place : "fridge")
            Haptics.success()
            done(created.count == 1 ? L("1 box put away") : LF("%d boxes put away", created.count))
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func sheet(print: Bool) async {
        do {
            let data = try await api.boxSheetPDF(created.map(\.code), layout: "3x8", skip: 0)
            let f = LabelSheetFile(data: data, name: L("Labels"))
            if print { LabelPrinting.print(data, name: f.name) } else { file = f }
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
