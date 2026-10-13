import SwiftUI

/// Check a receipt and book it in (web: ImportReview.tsx). Lines that need a look come first; each line can be linked
/// to a product (or become a new one), corrected (quantity, unit, price), sent to a place or left out.
/// Corrections are remembered for the next receipts.
struct ImportReviewView: View {
    let store: ServerStore
    let importId: Int
    @Environment(\.dismiss) private var dismiss
    @State private var imp: ImportDetail?
    @State private var places: [Place] = []
    @State private var error: String?
    @State private var busy = false
    @State private var showRest = false
    @State private var pickFor: ImportLine?
    @State private var placeFor: ImportLine?
    @State private var fixFor: ImportLine?
    @State private var confirmDiscard = false
    @State private var toast: ToastMessage?

    var body: some View {
        ScrollView {
            if let imp {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    header(imp)
                    banners(imp)
                    let look = imp.lines.filter(\.needsLook)
                    let sure = imp.lines.filter { $0.action == "add" && $0.status == "ok" }
                    let rest = imp.lines.filter(\.skipped)
                    if !look.isEmpty { group(L("Quick check"), look, imp) }
                    if !sure.isEmpty { group(L("Recognised"), sure, imp) }
                    if !rest.isEmpty {
                        Button {
                            withAnimation { showRest.toggle() }
                        } label: {
                            Label(LF("%d not included (not delivered, returned, deposit)", rest.count), systemImage: showRest ? "chevron.up" : "chevron.down")
                                .font(.subheadline)
                        }
                        .frame(minHeight: 44)
                        if showRest { group(nil, rest, imp) }
                    }
                    if imp.lines.isEmpty {
                        EmptyStateView(art: .receipt, title: L("No lines on this receipt."))
                    }
                }
                .padding(Theme.Space.s4)
                .padding(.bottom, imp.readonly ? Theme.Space.s4 : 96)
            } else if let error {
                ErrorBanner(message: error) { Task { await load() } }.padding(Theme.Space.s4)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
            }
        }
        .canvasBackground()
        .navigationTitle(L("Check receipt"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let imp, !imp.readonly {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button { Task { await rematch() } } label: { Label(L("Match again"), systemImage: "arrow.triangle.2.circlepath") }
                        Button(role: .destructive) { confirmDiscard = true } label: { Label(L("Discard receipt"), systemImage: "trash") }
                    } label: { Image(systemName: "ellipsis.circle") }
                    .accessibilityLabel(L("More"))
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let imp, !imp.readonly { bottomBar(imp) }
        }
        .task { await load() }
        .sheet(item: $pickFor) { line in
            ProductPickSheet(store: store, initial: searchSeed(line.name)) { choice in
                switch choice {
                case .product(let p):
                    var b: [String: JSONValue] = ["product_id": .number(Double(p.id)), "action": .string("add")]
                    if line.locationId == nil, let d = p.defaultLocationId { b["location_id"] = .number(Double(d)) }
                    Task { await update(line, b) }
                case .new(let name):
                    Task { await update(line, ["action": .string("new"), "product_id": .null, "name": .string(name)]) }
                }
            }
        }
        .sheet(item: $placeFor) { line in
            PlacePickSheet(places: places, selected: line.locationId) { place in
                Task { await update(line, ["location_id": .number(Double(place.id))]) }
            }
        }
        .sheet(item: $fixFor) { line in
            LineFixSheet(line: line) { body in
                Task { await update(line, body) }
            }
        }
        .confirmationDialog(L("Discard this receipt?"), isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button(L("Discard"), role: .destructive) { Task { await discard() } }
        } message: {
            Text(L("Nothing is booked in. The receipt stays in the history as discarded."))
        }
        .toast($toast)
    }

    // MARK: parts

    private func header(_ imp: ImportDetail) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            let eyebrow = [imp.shop, ServerDate.parse(imp.day)?.formatted(.dateTime.weekday(.abbreviated).day().month(.wide))]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            if !eyebrow.isEmpty {
                Text(eyebrow.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(Theme.ink3).tracking(0.6)
            }
            Text(imp.title).font(Theme.title(Theme.FontSize.h1)).foregroundStyle(Theme.ink)
                .accessibilityAddTraits(.isHeader)
            if let t = imp.finalTotal ?? imp.total {
                Text(Money.format(t)).font(.headline.monospacedDigit()).foregroundStyle(Theme.ink2)
            }
        }
    }

    @ViewBuilder
    private func banners(_ imp: ImportDetail) -> some View {
        if imp.reconciled {
            note("checkmark.circle.fill", Theme.primarySoft, imp.finalTotal.map { LF("Matched with the receipt. Anything returned at pickup has been taken out – paid: %@.", Money.format($0)) }
                ?? L("Matched with the receipt. Anything returned at pickup has been taken out."))
        } else if imp.kind == "rewe-avis" && !imp.readonly {
            note("info.circle", Theme.infoSoft, L("This notice is still provisional. Add the eBon after pickup and ToHuus matches what you actually took home."))
        }
        if imp.readonly {
            let text = imp.status == "applied"
                ? (ServerDate.parse(imp.appliedAt).map { LF("Booked on %@.", $0.formatted(date: .abbreviated, time: .omitted)) } ?? L("Booked."))
                : L("Discarded.")
            note("checkmark.circle", Theme.surface2, text)
        }
    }

    private func note(_ icon: String, _ bg: Color, _ text: String) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            Image(systemName: icon).foregroundStyle(Theme.primaryText)
            Text(text).font(.subheadline).foregroundStyle(Theme.ink)
            Spacer(minLength: 0)
        }
        .padding(Theme.Space.s3)
        .background(bg, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
    }

    private func group(_ title: String?, _ lines: [ImportLine], _ imp: ImportDetail) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            if let title {
                HStack {
                    Text(title).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Text("\(lines.count)").font(.subheadline).foregroundStyle(Theme.ink3)
                }
            }
            VStack(spacing: 0) {
                ForEach(Array(lines.enumerated()), id: \.element.id) { i, l in
                    if i > 0 { Divider().overlay(Theme.line) }
                    lineRow(l, readonly: imp.readonly)
                }
            }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        }
    }

    private func lineRow(_ l: ImportLine, readonly: Bool) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            RemoteImage(url: store.api.imageURL(l.productImage), api: store.api, placeholder: "basket")
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                .opacity(l.skipped ? 0.5 : 1)
            VStack(alignment: .leading, spacing: 4) {
                Text(l.name).font(.body).foregroundStyle(l.skipped ? Theme.ink3 : Theme.ink)
                    .strikethrough(l.skipped && !l.isDeposit, color: Theme.ink3)
                if let r = l.receiptName, r != l.name {
                    Text(LF("Receipt: %@", r)).font(.caption.monospaced()).foregroundStyle(Theme.ink3)
                }
                if l.statusLabel != nil || l.note != nil {
                    HStack(spacing: 6) {
                        if let s = l.statusLabel { StatusPill(text: s, status: l.statusTone) }
                        if let n = l.note { Text(n).font(.caption).foregroundStyle(Theme.ink3) }
                    }
                }
                if !readonly && !l.skipped {
                    FlowLayout(spacing: 6) {
                        if l.action == "new" {
                            pill(L("new product"), "sparkles", on: true) { pickFor = l }
                            if l.productId != nil, let pn = l.productName {
                                pill(LF("is it “%@”?", pn), nil) { Task { await update(l, ["product_id": .number(Double(l.productId ?? 0)), "action": .string("add")]) } }
                            }
                        } else {
                            pill("→ " + (l.productName ?? L("match")), nil) { pickFor = l }
                        }
                        pill(placeName(l.locationId), "mappin") { placeFor = l }
                        pill(L("correct"), "pencil") { fixFor = l }
                    }
                    .padding(.top, 2)
                } else if readonly, let pn = l.productName {
                    Text("→ " + pn).font(.caption).foregroundStyle(Theme.ink3)
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 6) {
                if !readonly && !l.isDeposit {
                    if !l.skipped { qtyStepper(l) }
                    Button(l.skipped ? L("include after all") : L("skip")) {
                        let back = l.productId != nil ? "add" : "new"
                        Task { await update(l, ["action": .string(l.skipped ? back : "skip"), "qty": .number(l.skipped && l.qty == 0 ? 1 : l.qty)]) }
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(l.skipped ? Theme.primaryText : Theme.ink3)
                    .frame(minHeight: 32)
                }
                if readonly {
                    Text(l.skipped ? "–" : (l.qty > 0 ? "+" : "") + qtyText(l.qty)).font(.caption.monospacedDigit()).foregroundStyle(Theme.ink2)
                }
                if let p = l.price, !l.isDeposit {
                    Text(Money.format(p)).font(.caption.monospacedDigit()).foregroundStyle(Theme.ink3)
                }
            }
        }
        .padding(Theme.Space.s3)
    }

    private func qtyStepper(_ l: ImportLine) -> some View {
        HStack(spacing: 0) {
            Button { Task { await update(l, ["qty": .number(max(0, l.qty - 1))]) } } label: { Image(systemName: "minus").frame(width: 36, height: 36) }
                .accessibilityLabel(L("Less"))
            Text(qtyText(l.qty)).font(.subheadline.monospacedDigit().weight(.semibold)).frame(minWidth: 26)
            Button { Task { await update(l, ["qty": .number(l.qty + 1)]) } } label: { Image(systemName: "plus").frame(width: 36, height: 36) }
                .accessibilityLabel(L("More"))
        }
        .foregroundStyle(Theme.ink)
        .background(Theme.surface2, in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityValue(qtyText(l.qty))
    }

    private func pill(_ text: String, _ icon: String?, on: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 3) {
                if let icon { Image(systemName: icon).font(.caption2) }
                Text(text).lineLimit(1)
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 9).padding(.vertical, 6)
            .foregroundStyle(on ? Theme.primaryText : Theme.ink2)
            .background(on ? Theme.primarySoft : Theme.surface2, in: Capsule())
            .frame(minHeight: 32)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func bottomBar(_ imp: ImportDetail) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Button(L("Discard")) { confirmDiscard = true }
                .foregroundStyle(Theme.ink2)
                .frame(minHeight: 44)
            Button {
                Task { await apply() }
            } label: {
                HStack { if busy { ProgressView().tint(Theme.onPrimary) }; Text(LF("Book in %d", imp.bookCount)) }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || imp.bookCount == 0)
        }
        .padding(.horizontal, Theme.Space.s4)
        .padding(.vertical, Theme.Space.s3)
        .background(.bar)
    }

    // MARK: helpers

    private func qtyText(_ q: Double) -> String { q.rounded() == q ? String(Int(q)) : String(format: "%.1f", q) }

    private func placeName(_ id: Int?) -> String {
        guard let id, let p = places.first(where: { $0.id == id }) else { return L("Choose place") }
        return p.path ?? p.name
    }

    /// the web seeds the search with the last two words without the pack size
    private func searchSeed(_ name: String) -> String {
        let cut = name.replacingOccurrences(of: #"\s+\d.*$"#, with: "", options: .regularExpression)
        return cut.split(separator: " ").suffix(2).joined(separator: " ")
    }

    private func load() async {
        do {
            async let i = store.api.importDetail(importId)
            async let p = store.api.places()
            imp = try await i
            places = ((try? await p) ?? []).filter { $0.system != true }
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func update(_ line: ImportLine, _ body: [String: JSONValue]) async {
        do {
            let r = try await store.api.patchImportLine(importId: importId, lineId: line.id, body)
            let learned = r.learned ?? []
            if learned.contains(where: { ["product", "ignore", "qty", "unit", "price", "store"].contains($0) }) {
                toast = ToastMessage(text: L("Got it – remembered for the next receipts."))
            }
            store.touch("imports")
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func apply() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.applyImportResult(importId)
            store.touch("imports", "stock", "shopping", "products")
            Haptics.success()
            let n = r.applied ?? 0
            let text = (r.created ?? 0) > 0 ? LF("%d items booked in, %d new products – pictures follow shortly", n, r.created ?? 0) : LF("%d items booked in", n)
            toast = ToastMessage(text: text)
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func discard() async {
        do {
            try await store.api.discardImport(importId)
            store.touch("imports")
            dismiss()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func rematch() async {
        do {
            let n = try await store.api.rematchImport(importId)
            toast = ToastMessage(text: LF("%d more matched", n))
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

// MARK: - sheets

/// "Which product is it?" – search the household's products or make a new one from the receipt name.
struct ProductPickSheet: View {
    enum Choice { case product(ProductInfo), new(String) }
    let store: ServerStore
    let initial: String
    let onChoose: (Choice) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var products: [ProductInfo] = []

    var body: some View {
        NavigationStack {
            List {
                let q = query.trimmingCharacters(in: .whitespaces)
                if q.count >= 2 {
                    Button {
                        dismiss(); onChoose(.new(q))
                    } label: {
                        Label(LF("New product “%@”", q), systemImage: "plus.circle")
                    }
                }
                ForEach(filtered(q)) { p in
                    Button {
                        dismiss(); onChoose(.product(p))
                    } label: {
                        HStack(spacing: Theme.Space.s3) {
                            RemoteImage(url: store.api.imageURL(p.imagePath), api: store.api, placeholder: "basket")
                                .frame(width: 36, height: 36).clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
                            VStack(alignment: .leading) {
                                Text(p.name).foregroundStyle(Theme.ink)
                                if let b = p.brand, !b.isEmpty { Text(b).font(.caption).foregroundStyle(Theme.ink3) }
                            }
                        }
                    }
                }
            }
            .themedList()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L("Search products"))
            .navigationTitle(L("Which product is it?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .task {
                query = initial
                products = (try? await store.api.products()) ?? []
            }
        }
    }

    private func filtered(_ q: String) -> [ProductInfo] {
        guard !q.isEmpty else { return Array(products.prefix(60)) }
        let words = q.lowercased().split(separator: " ")
        let hits = products.filter { p in
            let hay = "\(p.brand ?? "") \(p.name)".lowercased()
            return words.contains { hay.contains($0) }
        }
        return Array(hits.sorted { a, b in
            let sa = words.filter { "\(a.brand ?? "") \(a.name)".lowercased().contains($0) }.count
            let sb = words.filter { "\(b.brand ?? "") \(b.name)".lowercased().contains($0) }.count
            return sa == sb ? a.name < b.name : sa > sb
        }.prefix(60))
    }
}

/// "Where does it go?"
struct PlacePickSheet: View {
    let places: [Place]
    let selected: Int?
    let onPick: (Place) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(places) { p in
                Button {
                    dismiss(); onPick(p)
                } label: {
                    HStack {
                        Image(systemName: "mappin.circle").foregroundStyle(Theme.primaryText)
                        Text(p.path ?? p.name).foregroundStyle(Theme.ink)
                        Spacer()
                        if p.id == selected { Image(systemName: "checkmark").foregroundStyle(Theme.primaryText) }
                    }
                }
            }
            .overlay { if places.isEmpty { EmptyStateView(art: .shelf, title: L("No places yet.")) } }
            .navigationTitle(L("Where does it go?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// "Zeile korrigieren": quantity (pack size is learned), unit, price on the receipt.
struct LineFixSheet: View {
    let line: ImportLine
    let onSave: ([String: JSONValue]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var qty = ""
    @State private var unit = "Stk"
    @State private var price = ""
    @State private var invalid = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(line.receiptName ?? line.raw ?? line.name).font(.callout.monospaced()).foregroundStyle(Theme.ink2)
                }
                Section {
                    TextField(L("Quantity"), text: $qty).keyboardType(.decimalPad)
                } header: { Text(L("Quantity")) } footer: {
                    Text(L("A pack of 10 eggs on one line? Enter 10 – it is remembered as the pack size."))
                }
                Section(L("Unit")) {
                    Picker(L("Unit"), selection: $unit) {
                        ForEach(ImportUnits.all, id: \.self) { Text(ImportUnits.label($0)).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
                Section(L("Price on the receipt")) {
                    TextField("0,00", text: $price).keyboardType(.decimalPad)
                }
                if invalid { Section { Text(L("Please enter a valid number.")).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Correct this line"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Save")) { save() } }
            }
            .onAppear {
                qty = num(line.qty)
                unit = line.unit.flatMap { ImportUnits.all.contains($0) ? $0 : nil } ?? "Stk"
                price = line.price.map(num) ?? ""
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func num(_ d: Double) -> String {
        let s = d.rounded() == d ? String(Int(d)) : String(d)
        return s.replacingOccurrences(of: ".", with: ",")
    }

    private func parse(_ s: String) -> Double? {
        let t = s.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: ".")
        return t.isEmpty ? nil : Double(t)
    }

    private func save() {
        guard let q = parse(qty), q >= 0, q <= 999 else { invalid = true; return }
        let p = parse(price)
        if !price.trimmingCharacters(in: .whitespaces).isEmpty && p == nil { invalid = true; return }
        var body: [String: JSONValue] = [:]
        if q != line.qty { body["qty"] = .number(q) }
        if unit != (line.unit ?? "Stk") { body["unit"] = (unit == "Stk" && line.unit == nil) ? .null : .string(unit) }
        if p != line.price { body["price"] = p.map { .number($0) } ?? .null }
        dismiss()
        if !body.isEmpty { onSave(body) }
    }
}
