import SwiftUI

/// Short, calm mark for a line on the receipt check – nothing for lines that were simply recognised (web: GradeBadge).
struct GradeBadge: View {
    let grade: String?

    var body: some View {
        switch grade {
        case "learned":
            HStack(spacing: 4) {
                Image(systemName: "sparkles").font(.system(size: 9))
                Text(L("learned")).font(.caption.weight(.medium))
            }
            .foregroundStyle(Theme.info)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Theme.infoSoft, in: Capsule())
        case "suggested": StatusPill(text: L("likely"), status: "low")
        case "unmatched": StatusPill(text: L("not recognised"), status: nil)
        default: EmptyView()
        }
    }
}

/// "Erkennung" on the receipt check (web: QualityReport.tsx RecognitionCard): how many lines were recognised, the shop
/// and how it was found (changeable), whether the lines add up to the total, the learned rules, and – opt-in, per
/// receipt – "Help improve recognition" with an anonymised test file the person shares themselves.
struct RecognitionCardView: View {
    let store: ServerStore
    let importId: Int
    let readonly: Bool
    let report: RecognitionReport
    let onChanged: () -> Void
    @State private var open = false
    @State private var showStore = false
    @State private var showFixture = false
    @State private var showRules = false

    var body: some View {
        let c = report.counts
        let learned = c?.learned ?? 0
        let sure = (c?.sure ?? 0) + (c?.ignored ?? 0)
        let suggested = c?.suggested ?? 0
        let unmatched = c?.unmatched ?? 0
        let goods = report.goods ?? 0
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { open.toggle() }
            } label: {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Recognition")).font(.headline).foregroundStyle(Theme.ink)
                        Text((goods > 0 ? LF("%d of %d lines recognised automatically", learned + sure, goods) : L("No product lines"))
                             + (report.shop.map { " · \($0)" } ?? ""))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                    Spacer()
                    Text(open ? L("Less") : L("Details")).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.primaryText)
                }
                .contentShape(Rectangle())
                .frame(minHeight: 44)
            }
            .buttonStyle(.plain)
            .accessibilityHint(open ? L("Hides the details") : L("Shows the details"))
            if goods > 0 {
                GradeBar(parts: [(learned, Theme.info), (sure, Theme.primary), (suggested, Theme.mustard), (unmatched, Theme.lineStrong)], total: goods)
                    .frame(height: 8)
                    .accessibilityHidden(true)
            }
            if open {
                VStack(alignment: .leading, spacing: Theme.Space.s3) {
                    VStack(alignment: .leading, spacing: 4) {
                        if learned > 0 { legend(Theme.info, LF("learned from your corrections: %d", learned)) }
                        legend(Theme.primary, LF("recognised: %d", sure))
                        if suggested > 0 { legend(Theme.mustard, LF("likely, please check: %d", suggested)) }
                        if unmatched > 0 { legend(Theme.lineStrong, LF("not recognised: %d", unmatched)) }
                    }
                    Divider().overlay(Theme.line)
                    HStack(alignment: .top, spacing: Theme.Space.s3) {
                        Image(systemName: "storefront").foregroundStyle(Theme.ink2).frame(width: 22)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(report.shop ?? L("Store unknown")).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                            Text(storeVia).font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 4)
                        Button { showStore = true } label: {
                            Label(report.shop == nil ? L("set store") : L("change"), systemImage: "pencil")
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(Theme.surface2, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .frame(minHeight: 44)
                    }
                    if let matches = report.sumMatches, let total = report.total {
                        HStack(alignment: .top, spacing: Theme.Space.s3) {
                            Image(systemName: matches ? "checkmark.circle" : "exclamationmark.circle")
                                .foregroundStyle(matches ? Theme.primaryText : Theme.low).frame(width: 22)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(matches ? LF("The lines add up to the receipt total (%@).", Money.format(total))
                                             : LF("The lines add up to %@, the receipt says %@ – a line may be missing or misread.", Money.format(report.itemsSum ?? 0), Money.format(total)))
                                    .font(.subheadline).foregroundStyle(Theme.ink)
                                if let d = report.receiptDiscount, d != 0 {
                                    Text(LF("Includes a discount on the whole purchase: %@", Money.format(d))).font(.caption).foregroundStyle(Theme.ink3)
                                }
                            }
                        }
                    }
                    Button { showRules = true } label: {
                        HStack(spacing: Theme.Space.s3) {
                            Image(systemName: "sparkles").foregroundStyle(Theme.ink2).frame(width: 22)
                            Text((report.rules ?? 0) == 1 ? L("Learned from your corrections: 1 rule") : LF("Learned from your corrections: %d rules", report.rules ?? 0))
                                .font(.subheadline).foregroundStyle(Theme.ink)
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if !readonly && goods > 0 {
                        Text(L("Corrections you make here are remembered for this household – next time the same receipt line is recognised on its own."))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                    if report.kind != "shelf" {
                        Button { showFixture = true } label: { Label(L("Help improve recognition"), systemImage: "checkmark.shield") }
                            .buttonStyle(SecondaryButtonStyle())
                    }
                }
                .transition(.opacity)
            }
        }
        .padding(Theme.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        .sheet(isPresented: $showStore) {
            StorePickSheet(store: store, importId: importId, current: report.shop, learnable: report.storeLearnable ?? true) { onChanged() }
        }
        .sheet(isPresented: $showFixture) { FixtureSheet(store: store, importId: importId) }
        .sheet(isPresented: $showRules) { NavigationStack { ReceiptRecognitionView(store: store).toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { showRules = false } } } } }
    }

    private var storeVia: String {
        switch report.storeVia {
        case "header": return L("recognised from the receipt header")
        case "text": return L("recognised from the web address or company name")
        case "layout": return L("recognised from the layout")
        case "learned": return report.storeDetected.map { LF("learned from your correction (detected: %@)", $0) } ?? L("learned from your correction")
        case "corrected": return L("corrected by you")
        case "model": return L("read by the image model")
        default: return L("not recognised")
        }
    }

    private func legend(_ c: Color, _ t: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2).fill(c).frame(width: 10, height: 10).accessibilityHidden(true)
            Text(t).font(.caption).foregroundStyle(Theme.ink2)
        }
    }
}

/// A stacked bar of shares (one row, anchored at zero, a hairline gap between parts).
struct GradeBar: View {
    let parts: [(Int, Color)]
    let total: Int

    var body: some View {
        GeometryReader { g in
            HStack(spacing: 1) {
                ForEach(Array(parts.enumerated()), id: \.offset) { _, p in
                    if p.0 > 0 { Rectangle().fill(p.1).frame(width: max(2, g.size.width * CGFloat(p.0) / CGFloat(max(total, 1)) - 1)) }
                }
                Spacer(minLength: 0)
            }
            .background(Theme.surface2)
            .clipShape(Capsule())
        }
    }
}

// MARK: - which shop

/// "Welcher Laden ist das?" – the household's recent shops first, then the common chains alphabetically (no chain
/// preferred); the choice is learned for receipts like this one when the import has receipt text.
struct StorePickSheet: View {
    let store: ServerStore
    let importId: Int
    let current: String?
    let learnable: Bool
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var known: [String] = []
    @State private var busy = false
    @State private var error: String?
    @State private var toast: ToastMessage?

    private static let chains = ["Aldi Nord", "Aldi Süd", "Budni", "dm", "Edeka", "Globus", "Kaufland", "Lidl", "Müller", "Netto", "Norma", "Penny", "REWE", "Rossmann", "tegut"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    FlowLayout(spacing: 6) {
                        ForEach(known, id: \.self) { s in
                            ChoiceChip(title: s, on: s == current) { Task { await save(s) } }
                                .disabled(busy)
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    TextField(L("e.g. farm shop at the market"), text: $name)
                        .submitLabel(.done)
                        .onSubmit { Task { await save(name) } }
                } header: { Text(L("Or type the name")) } footer: {
                    if !learnable { Text(L("This import has no receipt text, so the store is only set for this import.")) }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Which store is this?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Save")) { Task { await save(name) } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task {
                name = current ?? ""
                let recent = ((try? await store.api.imports()) ?? []).compactMap(\.shop).filter { !$0.isEmpty }
                var seen = Set<String>()
                known = Array((recent + Self.chains).filter { seen.insert($0).inserted }.prefix(18))
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save(_ raw: String) async {
        let shop = raw.trimmingCharacters(in: .whitespaces)
        guard !shop.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.setImportStore(importId, shop: shop)
            store.touch("imports")
            Haptics.success()
            onSaved()
            dismiss()
            _ = r
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

// MARK: - help improve recognition

/// Opt-in, per receipt: build the anonymised test file, show it, and let the person decide what to do with it –
/// share the file, open a prefilled GitHub issue or an e-mail. Nothing is sent automatically.
struct FixtureSheet: View {
    let store: ServerStore
    let importId: Int
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var names = true
    @State private var checked = false
    @State private var fixture: RecognitionFixture?
    @State private var error: String?
    @State private var loading = false
    @State private var file: ExportFile?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(L("This turns the receipt into an anonymised test file for the ToHuus project, so receipts from this shop are read better for everyone. Nothing is sent automatically – you decide whether to share the file, open a prefilled GitHub issue or an e-mail."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                    Toggle(isOn: $names) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Include product names"))
                            Text(L("How you named the products (e.g. “Oat milk”) helps to learn abbreviations. Leave it off if your product names are personal."))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
                if loading { Section { HStack { Spacer(); ProgressView(); Spacer() } } }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                if let fx = fixture, !loading {
                    Section {
                        Text(L("Removed or changed:") + " " + (fx.removed.isEmpty ? L("nothing personal found") : fx.removed.map(\.label).joined(separator: ", "))
                             + ". " + L("Prices, quantities and the shop chain stay – that is what the reader needs."))
                            .font(.caption)
                        if fx.source == "lines" {
                            Label(L("There is no receipt text for this import (photo), so the file is rebuilt from the recognised lines."), systemImage: "info.circle")
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                        if let c = fx.check, !c.same {
                            Label(LF("After anonymising, the receipt reads slightly differently (%d → %d lines). That is fine – the maintainer sees it in the file.", c.linesBefore ?? 0, c.linesAfter ?? 0), systemImage: "info.circle")
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                    Section(L("Preview")) {
                        ScrollView(.horizontal) {
                            Text(fx.text).font(.caption.monospaced()).foregroundStyle(Theme.ink).textSelection(.enabled)
                                .fixedSize(horizontal: true, vertical: false)
                                .padding(.vertical, 4)
                        }
                        .frame(maxHeight: 280)
                    }
                    Section {
                        Toggle(L("I read the preview and there is nothing personal left in it."), isOn: $checked)
                        Button { shareFile(fx) } label: { Label(L("Share file"), systemImage: "square.and.arrow.up") }
                            .disabled(!checked)
                        if let s = fx.issueUrl, let url = URL(string: s) {
                            Button { openURL(url) } label: { Label(L("GitHub issue"), systemImage: "arrow.up.right.square") }
                                .disabled(!checked)
                        }
                        if let s = fx.mailto, let url = URL(string: s) {
                            Button { openURL(url) } label: { Label(L("E-mail"), systemImage: "envelope") }
                                .disabled(!checked)
                        }
                    } footer: {
                        VStack(alignment: .leading, spacing: 4) {
                            if fx.issueTruncated == true || fx.mailTruncated == true {
                                Text(L("The receipt is too long for a link – share the file first and attach it to the issue or e-mail."))
                            }
                            if fx.mailTo == nil { Text(L("The e-mail opens without a recipient – the project address is in the README.")) }
                        }
                    }
                }
            }
            .themedList()
            .navigationTitle(L("Help improve recognition"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .task(id: names) { await load() }
            .sheet(item: $file) { f in ShareSheet(items: [f.url]).ignoresSafeArea() }
        }
    }

    private func load() async {
        loading = true
        checked = false
        defer { loading = false }
        do {
            fixture = try await store.api.recognitionFixture(importId, names: names)
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func shareFile(_ fx: RecognitionFixture) {
        let safe = fx.filename.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe.isEmpty ? "receipt.txt" : safe)
        do {
            try Data(fx.text.utf8).write(to: url, options: .atomic)
            file = ExportFile(url: url)
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// A thin share bar (0…1), one calm colour, anchored at zero.
struct ShareMeter: View {
    let share: Double
    var tint: Color = Theme.primary

    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surface2)
                Capsule().fill(tint).frame(width: max(share > 0 ? 4 : 0, g.size.width * min(max(share, 0), 1)))
            }
        }
        .accessibilityHidden(true)
    }
}
