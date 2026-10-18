import PhotosUI
import SwiftUI
import UIKit

// Receipt check, 18 Oct 2026 (web: ImportReview.tsx ReceiptFix / AdjustSheet / RereadSheet): when the total does not
// add up, "Add discount or deposit" in one step (amount prefilled with the gap) and "Read again with AI"; rows filled in
// from the total are named; an AI reading can be undone. The AI step says once what leaves the phone.

/// Photos the iPhone read itself (only the text went to ToHuus) – kept in memory for this session, so "Read again with
/// AI" can use the original without asking for it again. Never written to disk.
@MainActor
enum ReceiptPhotoCache {
    private static var photos: [Int: [UIImage]] = [:]
    static func put(_ id: Int, _ images: [UIImage]) {
        photos[id] = Array(images.prefix(8))
        // a long session: only the latest few receipts
        if photos.count > 6, let oldest = photos.keys.sorted().first { photos[oldest] = nil }
    }
    static func get(_ id: Int) -> [UIImage]? { photos[id] }
}

enum ReceiptFixStart: Hashable { case adjust, reread }

// MARK: - API

struct RereadAIResult: Decodable, Sendable {
    var proposal: Proposal
    var input: String?
    var current: Current
    struct Proposal: Decodable, Sendable {
        var total: Double?
        var sumMatches: Bool?
        var itemsSum: Double?
        @Lossy var lines: [Line]
    }
    struct Line: Decodable, Sendable, Hashable {
        var name: String
        var qty: Double?
        var price: Double?
        var deposit: Bool?
    }
    struct Current: Decodable, Sendable {
        var lines: Int?
        var itemsSum: Double?
        var sumMatches: Bool?
    }
}

struct RereadApplyResult: Decodable, Sendable {
    var lines: Int?
    var carried: Int?
}

extension APIClient {
    /// POST /api/imports/:id/adjust { kind: discount|deposit, amount, line_id? }
    func adjustImport(_ id: Int, kind: String, amount: Double, lineId: Int?) async throws {
        var body: [String: Any] = ["kind": kind, "amount": amount]
        body["line_id"] = lineId.map { $0 as Any } ?? NSNull()
        _ = try await send("POST", "api/imports/\(id)/adjust", json: body, as: Ignored.self)
    }

    /// POST /api/imports/:id/reread-ai (multipart "files": the photos; none → what the server keeps with the receipt)
    func rereadImportAI(_ id: Int, images: [UIImage]) async throws -> RereadAIResult {
        var mp = Multipart()
        for (i, img) in images.prefix(8).enumerated() {
            if let d = img.jpegData(compressionQuality: 0.8) { mp.addFile("files", filename: "receipt-\(i + 1).jpg", mimeType: "image/jpeg", data: d) }
        }
        mp.addField("source", "review")
        return try await upload("api/imports/\(id)/reread-ai", multipart: mp, timeout: 180)
    }

    func applyImportAI(_ id: Int) async throws -> RereadApplyResult { try await send("POST", "api/imports/\(id)/reread-ai/apply", json: [:]) }
    func undoImportAI(_ id: Int) async throws { _ = try await send("POST", "api/imports/\(id)/reread-ai/undo", json: [:], as: Ignored.self) }
}

// MARK: - the section below the recognition card

struct ReceiptFixSection: View {
    let store: ServerStore
    let imp: ImportDetail
    let report: RecognitionReport
    let onChanged: () async -> Void
    var start: ReceiptFixStart? = nil
    @State private var showAdjust = false
    @State private var showReread = false
    @State private var started = false
    @State private var toast: ToastMessage?

    private var off: Bool { report.sumMatches == false }
    private var many: Bool {
        let goods = report.goods ?? 0
        let unclear = (report.counts?.unmatched ?? 0) - (report.newLines ?? 0)
        return goods > 2 && Double(unclear) >= Double(goods) / 2
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            if !report.assumed.isEmpty {
                banner("info.circle", Theme.infoSoft) {
                    Text(LF("Not on the photo, added so the total adds up: %@. Please check quickly.", report.assumed.map(\.label).joined(separator: " · ")))
                        .font(.subheadline).foregroundStyle(Theme.ink)
                }
            }
            if off || many {
                banner("exclamationmark.circle", Theme.surface2) {
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        Text(gapText).font(.subheadline).foregroundStyle(Theme.ink)
                        if off {
                            Button { showAdjust = true } label: { Label(L("Add discount or deposit"), systemImage: "plus.circle") }
                                .buttonStyle(SecondaryButtonStyle())
                        }
                        if report.ai?.available != false {
                            Button { showReread = true } label: { Label(L("Read again with AI"), systemImage: "sparkles") }
                                .buttonStyle(SecondaryButtonStyle())
                        }
                        if let left = report.ai?.left, left <= 5 {
                            Text(left == 0 ? L("No AI readings left for today.") : LF("AI readings left today: %d", left))
                                .font(.caption).foregroundStyle(Theme.ink3)
                        }
                    }
                }
            }
            HStack(spacing: Theme.Space.s4) {
                if !off && !many && report.ai?.available == true {
                    Button { showReread = true } label: { Label(L("Read again with AI"), systemImage: "sparkles").font(.subheadline) }
                        .frame(minHeight: 44)
                }
                if report.aiUndo == true {
                    Button { Task { await undo() } } label: { Label(L("Undo the AI reading"), systemImage: "arrow.uturn.backward").font(.subheadline) }
                        .frame(minHeight: 44)
                }
            }
        }
        .sheet(isPresented: $showAdjust) {
            AdjustReceiptSheet(store: store, imp: imp, difference: report.difference ?? 0) { await onChanged() }
        }
        .sheet(isPresented: $showReread) {
            RereadAISheet(store: store, imp: imp, report: report) { await onChanged() }
        }
        .toast($toast)
        .onAppear {
            guard !started, let start else { return }
            started = true
            if start == .adjust && off { showAdjust = true }
            if start == .reread { showReread = true }
        }
    }

    private var gapText: String {
        if off, let d = report.difference {
            return d < 0 ? LF("%@ too much in the lines – usually a discount that was not read.", Money.format(-d))
                         : LF("%@ missing in the lines – often deposit or a line that was not read.", Money.format(d))
        }
        return L("Many lines were not recognised.")
    }

    private func banner<C: View>(_ icon: String, _ bg: Color, @ViewBuilder _ content: () -> C) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            Image(systemName: icon).foregroundStyle(Theme.primaryText)
            content()
            Spacer(minLength: 0)
        }
        .padding(Theme.Space.s3)
        .background(bg, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
    }

    private func undo() async {
        do {
            try await store.api.undoImportAI(imp.id)
            store.touch("imports")
            toast = ToastMessage(text: L("Back to the earlier lines."))
            await onChanged()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

// MARK: - add a missed discount or deposit

struct AdjustReceiptSheet: View {
    let store: ServerStore
    let imp: ImportDetail
    let difference: Double
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "discount"
    @State private var amount = ""
    @State private var lineId: Int? = nil
    @State private var error: String?
    @State private var busy = false

    private var items: [ImportLine] { imp.lines.filter { $0.status == "ok" && ($0.price ?? 0) > 0 } }

    var body: some View {
        NavigationStack {
            Form {
                Picker(L("Kind"), selection: $kind) {
                    Text(L("Discount")).tag("discount")
                    Text(L("Deposit")).tag("deposit")
                }
                .pickerStyle(.segmented)
                Section(L("Amount")) {
                    TextField("0,00", text: $amount).keyboardType(.decimalPad)
                }
                if kind == "discount" {
                    Section {
                        Picker(L("On which item?"), selection: $lineId) {
                            Text(L("On the whole purchase")).tag(Int?.none)
                            ForEach(items) { l in Text("\(l.name) · \(Money.format(l.price ?? 0))").tag(Int?.some(l.id)) }
                        }
                    } footer: {
                        Text(L("The discount usually sits right below its item on the receipt."))
                    }
                } else {
                    Section { } footer: { Text(L("Deposit counts as money, not as stock.")) }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.low) } }
            }
            .navigationTitle(L("Add discount or deposit"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button(L("Add")) { Task { await save() } }.disabled(busy) }
            }
            .onAppear {
                kind = difference < 0 ? "discount" : "deposit"
                if difference != 0 { amount = String(format: "%.2f", abs(difference)).replacingOccurrences(of: ".", with: ",") }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        guard let n = Double(amount.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: ".")), n > 0 else {
            error = L("Please enter a valid number.")
            return
        }
        busy = true
        defer { busy = false }
        do {
            try await store.api.adjustImport(imp.id, kind: kind, amount: n, lineId: kind == "discount" ? lineId : nil)
            store.touch("imports")
            Haptics.success()
            await onDone()
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

// MARK: - read again with AI

struct RereadAISheet: View {
    let store: ServerStore
    let imp: ImportDetail
    let report: RecognitionReport
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var images: [UIImage] = []
    @State private var pick: [PhotosPickerItem] = []
    @State private var needPhoto = false
    @State private var busy = false
    @State private var result: RereadAIResult?
    @State private var error: String?

    /// what goes to the AI for this receipt
    private var what: String {
        if !images.isEmpty { return L("the photo of this receipt") }
        if report.hasSource == true { return L("the photo or PDF of this receipt") }
        return L("the text of this receipt")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    if let ai = report.ai, !ai.available {
                        unavailable(ai)
                    } else if let r = result {
                        proposal(r)
                    } else {
                        ask
                    }
                    if let error { ErrorBanner(message: error) }
                }
                .padding(Theme.Space.s4)
            }
            .canvasBackground()
            .navigationTitle(L("Read again with AI"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } } }
            .onAppear {
                // the photo the iPhone read itself, if this session still has it
                if images.isEmpty, let cached = ReceiptPhotoCache.get(imp.id) { images = cached }
                // device-read receipts keep no photo on the server: ask for it right away
                if images.isEmpty && report.hasSource != true && imp.meta?["source"]?.string == "ocr-device" { needPhoto = true }
            }
            .onChange(of: pick) { _, items in
                guard !items.isEmpty else { return }
                Task {
                    var out: [UIImage] = []
                    for item in items { if let d = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: d) { out.append(img) } }
                    images = out
                    pick = []
                }
            }
        }
    }

    private var ask: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            if needPhoto && images.isEmpty {
                Text(L("The photo of this receipt is not stored. Choose it once more.")).font(.subheadline).foregroundStyle(Theme.ink)
                PhotosPicker(selection: $pick, maxSelectionCount: 8, matching: .images) {
                    Label(L("Choose the photo again"), systemImage: "photo.on.rectangle")
                }
                .buttonStyle(SecondaryButtonStyle())
            } else if !images.isEmpty {
                Label(LF("%d photo(s) from this receipt", images.count), systemImage: "photo").font(.subheadline).foregroundStyle(Theme.ink2)
            }
            Text(LF("For this, %@ goes to the AI (Mistral, France, via OpenRouter). Just this once.", what))
                .font(.body).foregroundStyle(Theme.ink)
            if let left = report.ai?.left {
                Text(LF("Counts as one AI reading – %d left today.", left)).font(.caption).foregroundStyle(Theme.ink3)
            }
            Button {
                Task { await run() }
            } label: {
                HStack { if busy { ProgressView().tint(Theme.onPrimary) }; Label(busy ? L("Reading …") : L("Read with AI"), systemImage: "sparkles") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || (needPhoto && images.isEmpty))
            Button(L("Cancel")) { dismiss() }.frame(minHeight: 44)
        }
    }

    private func unavailable(_ ai: RecognitionReport.AIState) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            if ai.paused == true || ai.left == 0 {
                Text(L("No AI readings left for today. Tomorrow it works again – or add the missing row yourself."))
            } else {
                Text(L("AI is off for you or this household. If you want it, switch it on in Settings › With or without AI."))
            }
        }
        .font(.body).foregroundStyle(Theme.ink)
    }

    private func proposal(_ r: RereadAIResult) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text(LF("Now: %d lines, %@", r.current.lines ?? 0, Money.format(r.current.itemsSum ?? 0)) + (r.current.sumMatches == true ? " ✓" : ""))
                .font(.subheadline).foregroundStyle(Theme.ink2)
            Text(LF("AI: %d lines, %@", r.proposal.lines.count, Money.format(r.proposal.itemsSum ?? 0)) + (r.proposal.sumMatches == true ? " ✓ " + L("adds up") : ""))
                .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
            VStack(spacing: 0) {
                ForEach(Array(r.proposal.lines.enumerated()), id: \.offset) { i, l in
                    if i > 0 { Divider().overlay(Theme.line) }
                    HStack {
                        Text(((l.qty ?? 1) != 1 ? "\(Int(l.qty ?? 1)) × " : "") + l.name + (l.deposit == true ? " · " + L("deposit") : ""))
                            .font(.subheadline).foregroundStyle(Theme.ink)
                        Spacer()
                        Text(l.price.map { Money.format($0) } ?? "–").font(.subheadline.monospacedDigit()).foregroundStyle(Theme.ink2)
                    }
                    .padding(.vertical, 8).padding(.horizontal, Theme.Space.s3)
                }
            }
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
            Text(L("Your own corrections stay where the same item shows up. You can undo it afterwards."))
                .font(.caption).foregroundStyle(Theme.ink3)
            Button { Task { await take() } } label: { Text(L("Take the AI reading")) }
                .buttonStyle(PrimaryButtonStyle()).disabled(busy)
            Button(L("Keep the current lines")) { dismiss() }.frame(minHeight: 44)
        }
    }

    private func run() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            result = try await store.api.rereadImportAI(imp.id, images: images)
        } catch {
            if case .server(let status, _) = APIError.from(error), status == 422, images.isEmpty {
                needPhoto = true
                return
            }
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func take() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await store.api.applyImportAI(imp.id)
            store.touch("imports")
            Haptics.success()
            await onDone()
            _ = r
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
